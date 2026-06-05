/* ── mime.js — minimal RFC-822 / MIME parser ─────────────────────
 * Cloudflare's EmailMessage gives us a raw stream; we already drained
 * it to a string in worker.js. This module extracts the bits the
 * dashboard cares about: headers (decoded), text/plain body,
 * text/html body, and attachment metadata (no contents — those go
 * to R2 in a future phase).
 *
 * Scope of what this parser handles:
 *   • Header unfolding (continuation lines starting with WSP).
 *   • RFC-2047 encoded-word decoding for header values
 *     (=?charset?Q?...?= and =?charset?B?...?=).
 *   • Quoted-printable + base64 body decoding.
 *   • multipart/* with one level of nesting (alternative inside
 *     mixed is the common case — we recurse to depth 4).
 *
 * Out of scope (low value for travel inquiries):
 *   • signed/encrypted (S/MIME, PGP) bodies.
 *   • DKIM-Signature decoding (we read the spam header instead).
 *   • Charsets other than utf-8 / latin1 / us-ascii.
 * ──────────────────────────────────────────────────────────────── */

import { b64decode } from './lib.js';

const CRLF_SPLIT = /\r?\n/;

/* Public entry point. Returns:
 *   { messageId, from, to, cc, subject, date, inReplyTo,
 *     textPlain, textHtml, attachments: [{filename,mimeType,sizeBytes}],
 *     spamScore } */
export function parseRfc822(raw) {
    const { headerLines, bodyText } = splitHeaderBody(String(raw || ''));
    const headers = parseHeaders(headerLines);

    const ctRaw = headerOne(headers, 'content-type') || 'text/plain';
    const cte   = (headerOne(headers, 'content-transfer-encoding') || '7bit').toLowerCase().trim();
    const ct    = parseContentType(ctRaw);

    const out = {
        messageId: stripAngle(headerOne(headers, 'message-id') || ''),
        from:      decodeHeader(headerOne(headers, 'from') || ''),
        to:        decodeHeader(headerOne(headers, 'to') || ''),
        cc:        decodeHeader(headerOne(headers, 'cc') || ''),
        subject:   decodeHeader(headerOne(headers, 'subject') || ''),
        date:      headerOne(headers, 'date') || '',
        inReplyTo: stripAngle(headerOne(headers, 'in-reply-to') || ''),
        spamScore: headerOne(headers, 'x-cloudflare-spam-score') ||
                   headerOne(headers, 'x-spam-score') || '',
        textPlain: '',
        textHtml:  '',
        attachments: []
    };

    if (ct.type.startsWith('multipart/') && ct.params.boundary) {
        walkMultipart(bodyText, ct.params.boundary, out, 0);
    } else {
        const decoded = decodeBody(bodyText, cte, ct.params.charset);
        if (ct.type === 'text/html') out.textHtml  = decoded;
        else                         out.textPlain = decoded;
    }
    return out;
}

/* ── helpers ──────────────────────────────────────────────────── */

function splitHeaderBody(raw) {
    // RFC-822 separates headers from body with a blank line.
    // Tolerate both CRLF and LF input (Cloudflare normalises to CRLF).
    const idx = raw.search(/\r?\n\r?\n/);
    if (idx < 0) return { headerLines: raw.split(CRLF_SPLIT), bodyText: '' };
    const headerBlock = raw.slice(0, idx);
    const sepLen = raw.slice(idx).match(/^\r?\n\r?\n/)[0].length;
    return {
        headerLines: headerBlock.split(CRLF_SPLIT),
        bodyText:    raw.slice(idx + sepLen)
    };
}

/* RFC-822 header continuation: lines beginning with WSP belong to
 * the previous header. Returns lower-case-keyed map → array of vals. */
function parseHeaders(lines) {
    const headers = {};
    let cur = null;
    for (const ln of lines) {
        if (/^[ \t]/.test(ln) && cur) { cur.value += ' ' + ln.replace(/^\s+/, ''); continue; }
        const m = /^([!-9;-~]+):\s?(.*)$/.exec(ln);  // legal header chars
        if (!m) { cur = null; continue; }
        cur = { name: m[1].toLowerCase(), value: m[2] };
        (headers[cur.name] = headers[cur.name] || []).push(cur);
    }
    const flat = {};
    for (const k of Object.keys(headers)) flat[k] = headers[k].map(h => h.value);
    return flat;
}

function headerOne(headers, name) {
    const a = headers[name.toLowerCase()];
    return (a && a[0]) || '';
}

function stripAngle(s) {
    return String(s || '').trim().replace(/^<+|>+$/g, '');
}

/* Parse `text/plain; charset=utf-8; format=flowed` style headers. */
function parseContentType(raw) {
    const parts = String(raw || '').split(';').map(s => s.trim());
    const type  = (parts.shift() || '').toLowerCase();
    const params = {};
    for (const p of parts) {
        if (!p) continue;
        const m = /^([A-Za-z0-9_-]+)\s*=\s*"?([^";]+)"?/.exec(p);
        if (m) params[m[1].toLowerCase()] = m[2];
    }
    return { type, params };
}

/* RFC-2047 encoded-word decoder.  =?utf-8?Q?Hello=20World?=  →  Hello World */
function decodeHeader(raw) {
    return String(raw || '').replace(
        /=\?([^?]+)\?([QqBb])\?([^?]*)\?=(?:\s+(?==\?))?/g,
        (_, charset, enc, txt) => {
            try {
                if (enc.toUpperCase() === 'B') {
                    return new TextDecoder(normCharset(charset)).decode(b64decode(txt));
                }
                // Q-encoding: underscores = spaces, =HH = byte.
                const bytes = [];
                for (let i = 0; i < txt.length; i++) {
                    const c = txt[i];
                    if (c === '_') bytes.push(0x20);
                    else if (c === '=' && i + 2 < txt.length) {
                        bytes.push(parseInt(txt.substr(i + 1, 2), 16) || 0x3F);
                        i += 2;
                    } else bytes.push(c.charCodeAt(0));
                }
                return new TextDecoder(normCharset(charset)).decode(new Uint8Array(bytes));
            } catch (_) { return txt; }
        }
    );
}

function normCharset(c) {
    const x = String(c || '').toLowerCase();
    if (x === 'us-ascii' || x === 'ascii') return 'utf-8';
    return x || 'utf-8';
}

/* Decode a body section per its CTE. Returns a JS string. */
function decodeBody(body, cte, charset) {
    const enc = String(cte || '7bit').toLowerCase();
    const cs  = normCharset(charset);
    if (enc === 'base64') {
        try { return new TextDecoder(cs).decode(b64decode(body)); }
        catch (_) { return body; }
    }
    if (enc === 'quoted-printable') {
        const out = [];
        // Strip soft line breaks ("=" at end of line), decode =HH bytes.
        const cleaned = body.replace(/=\r?\n/g, '');
        for (let i = 0; i < cleaned.length; i++) {
            const c = cleaned[i];
            if (c === '=' && i + 2 < cleaned.length && /^[0-9A-Fa-f]{2}$/.test(cleaned.substr(i + 1, 2))) {
                out.push(parseInt(cleaned.substr(i + 1, 2), 16));
                i += 2;
            } else out.push(c.charCodeAt(0));
        }
        try { return new TextDecoder(cs).decode(new Uint8Array(out)); }
        catch (_) { return cleaned; }
    }
    return body; // 7bit / 8bit / binary — already a string
}

/* Walk a multipart body. `out` is mutated to accumulate parts. */
function walkMultipart(body, boundary, out, depth) {
    if (depth > 4) return;
    const dash = '--' + boundary;
    const parts = [];
    let i = body.indexOf(dash);
    if (i < 0) return;
    i += dash.length;
    while (i < body.length) {
        // close-delimiter "--boundary--" terminates the multipart
        if (body.substr(i, 2) === '--') break;
        // skip CRLF after the boundary
        if (body[i] === '\r') i++;
        if (body[i] === '\n') i++;
        const next = body.indexOf(dash, i);
        if (next < 0) break;
        let segEnd = next;
        // trim the trailing CRLF that precedes the boundary
        if (body[segEnd - 1] === '\n') segEnd--;
        if (body[segEnd - 1] === '\r') segEnd--;
        parts.push(body.slice(i, segEnd));
        i = next + dash.length;
    }
    for (const part of parts) {
        const { headerLines, bodyText } = splitHeaderBody(part);
        const h     = parseHeaders(headerLines);
        const ctRaw = headerOne(h, 'content-type') || 'text/plain';
        const cte   = (headerOne(h, 'content-transfer-encoding') || '7bit').toLowerCase().trim();
        const ct    = parseContentType(ctRaw);
        const cd    = headerOne(h, 'content-disposition') || '';
        const isAttachment = /^attachment/i.test(cd) ||
                             /\bfilename\s*=/i.test(cd) ||
                             (ct.params.name && !ct.type.startsWith('text/'));

        if (ct.type.startsWith('multipart/') && ct.params.boundary) {
            walkMultipart(bodyText, ct.params.boundary, out, depth + 1);
            continue;
        }
        if (isAttachment) {
            const filename = (cd.match(/filename\s*=\s*"?([^";]+)"?/i) || [, ct.params.name || ''])[1];
            const decoded  = decodeBody(bodyText, cte, ct.params.charset);
            out.attachments.push({
                filename: String(filename || 'unnamed').slice(0, 200),
                mimeType: ct.type,
                sizeBytes: decoded.length
            });
            continue;
        }
        const decoded = decodeBody(bodyText, cte, ct.params.charset);
        if (ct.type === 'text/html' && !out.textHtml)        out.textHtml  = decoded;
        else if (ct.type === 'text/plain' && !out.textPlain) out.textPlain = decoded;
    }
}