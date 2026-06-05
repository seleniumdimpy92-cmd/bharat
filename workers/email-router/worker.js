/* ── email-router Worker — inbound mail handler ──────────────────
 * Runs on every email Cloudflare Email Routing delivers to one of
 * our domain mailboxes (booking@, info@, cancellation@). It:
 *
 *   1. Drains the raw RFC-822 stream into a string.
 *   2. Parses headers + bodies with our hand-rolled mime.js.
 *   3. Derives a stable doc ID = SHA-256(Message-ID), so retries
 *      from Cloudflare are idempotent.
 *   4. Writes a record to Firestore /receivedEmails/{docId} via the
 *      REST API, authenticated with a service-account access token.
 *   5. Forwards the original message to a verified Gmail destination
 *      so the existing mobile / desktop client experience is intact.
 *
 * The Worker also exposes a tiny HTTP fetch() handler (just `/` and
 * `/health`) so wrangler tail / browser sanity-checks confirm the
 * deploy is live. There is *no* /poll endpoint — the dashboard reads
 * Firestore directly with admin-rule auth.
 *
 * Deploy:
 *     cd workers/email-router
 *     npm install
 *     npx wrangler login
 *     printf %s '<full service-account JSON>' | npx wrangler secret put FIREBASE_SERVICE_ACCOUNT_KEY
 *     npx wrangler deploy
 *
 * Then in Cloudflare → Email → Email Routing → Routes, add
 * "Send to a Worker → email-router" as an action on each address rule.
 * ──────────────────────────────────────────────────────────────── */

import { sha256Hex, streamToString } from './lib.js';
import { parseRfc822 } from './mime.js';
import { getFirestoreAccessToken, firestoreCreateIfMissing, firestoreGetDoc, firestoreAddDoc } from './firestore.js';

// ── Hard-coded list of OUR five official mailboxes ─────────────
// Every outgoing auto-reply MUST come FROM one of these. Even if
// AUTO_REPLY_FROM_EMAIL env or the user-editable Firestore doc
// (/settings/inboxAutoReply.defaultFrom) names something else, we
// override it to noreply@ rather than impersonate an outside address.
// The downstream inbox-mail/worker.js enforces the same list as a
// final defence in depth.
const OFFICIAL_SENDERS = [
    'info@andamanvoyages.in',
    'booking@andamanvoyages.in',
    'cancellation@andamanvoyages.in',
    'enquiries@andamanvoyages.in',
    'noreply@andamanvoyages.in'
];

export default {
    /* HTTP handler — health-check + /mirror endpoint.
     * Inbound MX-routed mail uses email() below; the /mirror endpoint
     * lets sibling Workers (e.g. customize-email) write a synthetic
     * /receivedEmails doc using THIS Worker's service-account credentials,
     * so they don't need the secret of their own. */
    async fetch(request, env) {
        const url = new URL(request.url);
        if (url.pathname === '/' || url.pathname === '/health') {
            return Response.json({
                ok: true,
                service: 'email-router',
                allowedInboxes: parseList(env.ALLOWED_INBOXES),
                forwardTo: env.FORWARD_ALL_TO || null,
                hasServiceAccount: !!env.FIREBASE_SERVICE_ACCOUNT_KEY
            });
        }
        if (url.pathname === '/mirror' && request.method === 'POST') {
            return handleMirror(request, env);
        }
        return new Response('Not found', { status: 404 });
    },

    /* Email handler — Cloudflare invokes this once per inbound message. */
    async email(message, env, ctx) {
        // ── 1) Sanity-check the recipient ────────────────────────
        // Cloudflare's routing rule should already gate this, but a
        // wildcard rule mis-config would let arbitrary addresses
        // through. We hard-stop on anything not in ALLOWED_INBOXES.
        const recipient = String(message.to || '').toLowerCase().trim();
        const allowed   = parseList(env.ALLOWED_INBOXES);
        if (allowed.length && !allowed.includes(recipient)) {
            console.warn('email-router: recipient not in ALLOWED_INBOXES:', recipient);
            try { message.setReject('Recipient not accepted by this worker.'); }
            catch (_) {}
            return;
        }

        // ── 2) Drain the raw stream ──────────────────────────────
        const maxBytes = Number(env.MAX_RAW_BYTES) || 5_000_000;
        let raw = '';
        try { raw = await streamToString(message.raw, maxBytes); }
        catch (err) {
            console.error('email-router: stream read failed:', err);
            // Still attempt forward so a parse failure doesn't lose mail.
            await tryForward(message, env);
            return;
        }

        // ── 3) Parse + persist (best-effort) ─────────────────────
        let parsed = null;
        try { parsed = parseRfc822(raw); }
        catch (err) { console.error('email-router: parse failed:', err); }

        if (parsed) {
            try { await persistToFirestore(message, parsed, raw, env); }
            catch (err) { console.error('email-router: firestore write failed:', err); }
        }

        // ── 4) Forward to Gmail so existing clients keep working ─
        await tryForward(message, env);

        // ── 5) Auto-reply with a templated acknowledgement ───────
        // Customers who fired off an enquiry get an instant friendly
        // confirmation while you're out of office / asleep. The
        // template is picked by the recipient mailbox below
        // (booking@ / info@ / cancellation@ / enquiries@). Disable
        // by setting AUTO_REPLY_ENABLED='0' in wrangler.jsonc.
        try { await sendAutoReply(message, parsed, env); }
        catch (err) { console.error('email-router: auto-reply failed:', err && err.stack || err); }
    }
};

/* ── helpers ──────────────────────────────────────────────────── */

function parseList(s) {
    return String(s || '')
        .split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
}

async function tryForward(message, env) {
    const to = String(env.FORWARD_ALL_TO || '').trim();
    if (!to) return;
    try {
        // message.forward() expects a string address (matched against
        // verified destinations) OR the binding name. We use the raw
        // destination address — Cloudflare will check it's verified.
        await message.forward(to);
    } catch (err) {
        // If the explicit address fails, fall back to the named
        // send_email binding (defined in wrangler.jsonc).
        console.warn('email-router: forward to', to, 'failed:', err && err.message);
        try {
            if (env.GMAIL_FORWARD && typeof env.GMAIL_FORWARD.send === 'function') {
                // For named SendEmail bindings we'd call .send(message),
                // but message.forward() with the binding name is the
                // documented path. Try it as a last resort.
                await message.forward('GMAIL_FORWARD');
            }
        } catch (err2) {
            console.error('email-router: fallback forward failed:', err2);
        }
    }
}

/* /mirror — accept a JSON payload from sibling Workers and write it
 * to /receivedEmails. Auth is via a shared secret env.MIRROR_TOKEN
 * (Bearer scheme); rejects anything else with 401. */
async function handleMirror(request, env) {
    const auth = request.headers.get('Authorization') || '';
    const want = (env.MIRROR_TOKEN || '').trim();
    if (!want) {
        return Response.json({ error: 'mirror not configured' }, { status: 503 });
    }
    if (auth !== 'Bearer ' + want) {
        return Response.json({ error: 'unauthorized' }, { status: 401 });
    }
    let body;
    try { body = await request.json(); }
    catch { return Response.json({ error: 'invalid json' }, { status: 400 }); }

    const docId  = String(body.docId || '').trim();
    const fields = body.fields;
    if (!docId || !fields || typeof fields !== 'object') {
        return Response.json({ error: 'docId and fields required' }, { status: 400 });
    }

    try {
        const token   = await getFirestoreAccessToken(env);
        const created = await firestoreCreateIfMissing(env, token, 'receivedEmails', docId, fields);
        return Response.json({ ok: true, created });
    } catch (err) {
        console.error('email-router /mirror failed:', err);
        return Response.json({ error: 'firestore write failed', detail: String(err && err.message || err) }, { status: 500 });
    }
}

async function persistToFirestore(message, parsed, raw, env) {
    // Stable doc ID: SHA-256 of Message-ID (or, if absent, the entire
    // raw blob). Firestore IDs allow 1–1500 chars and the chars
    // [0-9A-Za-z._-] — hex digests are safe.
    const idSource = parsed.messageId || raw;
    const docId = await sha256Hex(idSource);

    const doc = {
        messageId:    parsed.messageId || '',
        envelopeFrom: String(message.from || ''),
        envelopeTo:   String(message.to   || ''),
        from:         parsed.from || '',
        to:           parsed.to   || '',
        cc:           parsed.cc   || '',
        subject:      parsed.subject || '(no subject)',
        date:         parsed.date    || '',
        inReplyTo:    parsed.inReplyTo || '',
        spamScore:    parsed.spamScore || '',
        textPlain:    (parsed.textPlain || '').slice(0, 100_000),
        textHtml:     (parsed.textHtml  || '').slice(0, 200_000),
        attachments:  Array.isArray(parsed.attachments) ? parsed.attachments.slice(0, 50) : [],
        rawSize:      Number(message.rawSize) || raw.length,
        mailbox:      String(message.to || '').toLowerCase(),
        unread:       true,
        receivedAt:   new Date().toISOString()
    };

    const token = await getFirestoreAccessToken(env);
    const created = await firestoreCreateIfMissing(env, token, 'receivedEmails', docId, doc);
    if (!created) console.log('email-router: dedup hit for', docId);
}
/* ════════════════════════════════════════════════════════════════
 * Auto-reply: send a templated acknowledgement back to the sender.
 *
 * Triggered after every successful inbound message. Picks a short
 * email body based on the recipient mailbox (so a customer who wrote
 * to cancellation@ sees cancellation-specific copy, not booking copy).
 *
 * Loop-safety:
 *   - Skipped if AUTO_REPLY_ENABLED != "1".
 *   - Skipped if BREVO_API_KEY secret missing.
 *   - Skipped if sender address is one of OUR own (prevents the worker
 *     looping when forwarded mail bounces back into the inbox).
 *   - Skipped if subject contains any of AUTO_REPLY_SKIP_PATTERNS.
 *   - Skipped if the sender doesn't look like a real address.
 * ═══════════════════════════════════════════════════════════════ */
async function sendAutoReply(message, parsed, env) {
    // ── Load user-editable settings from Firestore ──────────────
    // The admin dashboard writes to /settings/inboxAutoReply via
    // js/inbox-autoreply.js. We read it here so toggles from the UI
    // (Enable / Send immediately / custom subject + body) take effect
    // immediately without a Worker re-deploy.
    //
    // Doc shape:
    //   { enabled: bool, sendImmediately: bool, cooldownHours: int,
    //     defaultFrom: 'mailbox' | 'booking@…',
    //     subject: 'string with {{placeholders}}',
    //     body:    'string with {{placeholders}}' }
    //
    // Resolution:
    //   • If the doc exists AND enabled=false  → skip (admin turned it off)
    //   • If the doc exists AND sendImmediately=false → skip (admin only
    //     wants drafts, not auto-send)
    //   • If the doc exists AND has a custom subject/body → use those
    //   • Otherwise fall back to the env-flag + hard-coded TEMPLATES below.
    //
    // Env override remains a safety kill-switch: if AUTO_REPLY_ENABLED='0'
    // in wrangler.jsonc, nothing is sent regardless of the dashboard
    // setting.
    let userCfg = null;
    try {
        const t = await getFirestoreAccessToken(env);
        userCfg = await firestoreGetDoc(env, t, 'settings', 'inboxAutoReply');
    } catch (err) {
        console.warn('email-router: could not read /settings/inboxAutoReply:', err && err.message);
    }

    const envSwitchOn  = String(env.AUTO_REPLY_ENABLED || '0') === '1';
    const userEnabled  = userCfg ? !!userCfg.enabled         : null;
    const userSendNow  = userCfg ? !!userCfg.sendImmediately : null;

    // Decide whether to send. The dashboard, if present, is authoritative;
    // the env flag is only a hard-OFF kill-switch.
    if (!envSwitchOn) {
        console.log('email-router: auto-reply skipped — AUTO_REPLY_ENABLED!=1');
        return;
    }
    if (userCfg) {
        if (!userEnabled) {
            console.log('email-router: auto-reply skipped — disabled in dashboard');
            return;
        }
        if (!userSendNow) {
            console.log('email-router: auto-reply skipped — dashboard wants draft-only');
            return;
        }
    }

    // Auth: we used to require BREVO_API_KEY here and call Brevo
    // directly. That meant the same key had to be duplicated as a
    // secret on TWO Workers (inbox-mail + email-router). Instead we
    // now POST to inbox-mail's /internal/send endpoint, which already
    // owns the Brevo key. The two Workers share a single
    // INTERNAL_SEND_TOKEN secret for auth.
    if (!env.INTERNAL_SEND_TOKEN) {
        console.warn('email-router: INTERNAL_SEND_TOKEN secret not set — auto-reply skipped');
        return;
    }
    if (!env.INBOX_MAIL_URL) {
        console.warn('email-router: INBOX_MAIL_URL not configured — auto-reply skipped');
        return;
    }

    const fromHeader = (parsed && parsed.from) || '';
    const envFrom    = String(message.from || '');
    const senderAddr = extractEmailAddr(envFrom) || extractEmailAddr(fromHeader);
    if (!senderAddr) {
        console.log('email-router: auto-reply skipped — could not parse sender');
        return;
    }

    const allOurAddrs = parseList(env.ALLOWED_INBOXES).concat([
        String(env.AUTO_REPLY_FROM_EMAIL || '').toLowerCase(),
        String(env.FORWARD_ALL_TO || '').toLowerCase()
    ]);
    if (allOurAddrs.includes(senderAddr.toLowerCase())) {
        console.log('email-router: auto-reply skipped — sender is one of our own:', senderAddr);
        return;
    }

    const skipPatterns = parseList(env.AUTO_REPLY_SKIP_PATTERNS);
    const haystack = [senderAddr, (parsed && parsed.subject) || '', envFrom, fromHeader].join(' ').toLowerCase();
    if (skipPatterns.some(p => p && haystack.includes(p))) {
        console.log('email-router: auto-reply skipped — sender/subject matches skip pattern');
        return;
    }

    const recipient = String(message.to || '').toLowerCase().trim();

    // ── Build the email body ────────────────────────────────────
    // Prefer the user template (from /settings/inboxAutoReply) if one
    // is set; otherwise fall back to the hard-coded TEMPLATES below.
    const origSubject = (parsed && parsed.subject) || '(no subject)';
    let replySubject;
    let textContent;
    let htmlContent;
    let templateId;

    if (userCfg && (userCfg.subject || userCfg.body)) {
        const ph = {
            senderName:       extractNameFromHeader(fromHeader) || senderAddr.split('@')[0],
            senderEmail:      senderAddr,
            firstName:        (extractNameFromHeader(fromHeader) || senderAddr.split('@')[0]).split(/\s+/)[0] || 'there',
            subject:          origSubject,
            originalSubject:  origSubject,
            mailbox:          recipient,
            date:             new Date().toLocaleString()
        };
        const subj = userCfg.subject || ('Re: ' + origSubject);
        const body = userCfg.body    || '';
        replySubject = renderPlaceholders(subj, ph);
        textContent  = renderPlaceholders(body, ph);
        htmlContent  = plainToHtml(textContent);
        templateId   = 'user-template';
    } else {
        const tpl = pickTemplate(recipient);
        replySubject = /^re:\s/i.test(origSubject) ? origSubject : ('Re: ' + origSubject);
        textContent  = tpl.text;
        htmlContent  = tpl.html;
        templateId   = tpl.id;
    }

    // From-mailbox: prefer the user-chosen "defaultFrom" (when not 'mailbox'),
    // else the env default, else fall back to info@.
    //
    // Defence-in-depth: even though inbox-mail/worker.js will reject any
    // non-whitelisted From, we filter through OFFICIAL_SENDERS here too so
    // a misconfigured Firestore /settings/inboxAutoReply doc can't even
    // attempt to send from an outside address.
    let fromEmail = String(env.AUTO_REPLY_FROM_EMAIL || 'info@andamanvoyages.in');
    if (userCfg && userCfg.defaultFrom && userCfg.defaultFrom !== 'mailbox') {
        fromEmail = String(userCfg.defaultFrom);
    } else if (userCfg && userCfg.defaultFrom === 'mailbox') {
        // Reply from the same mailbox the mail came in on.
        fromEmail = recipient || fromEmail;
    }
    fromEmail = String(fromEmail).trim().toLowerCase();
    if (!OFFICIAL_SENDERS.includes(fromEmail)) {
        console.warn(
            'email-router: auto-reply From "' + fromEmail + '" not in OFFICIAL_SENDERS — falling back to noreply@'
        );
        fromEmail = 'noreply@andamanvoyages.in';
    }
    const fromName = String(env.AUTO_REPLY_FROM_NAME || 'Andaman Voyages');

    // RFC-3834 / Auto-Submitted headers + threading. The downstream
    // /internal/send endpoint also injects defaults for these, but
    // setting them here too keeps the threading sane (In-Reply-To /
    // References point at the original sender's Message-ID).
    const extraHeaders = {};
    if (parsed && parsed.messageId) {
        extraHeaders['In-Reply-To'] = parsed.messageId;
        extraHeaders['References']  = parsed.messageId;
    }
    extraHeaders['Auto-Submitted']           = 'auto-replied';
    extraHeaders['X-Auto-Response-Suppress'] = 'All';

    // Post to inbox-mail's /internal/send so we reuse the existing
    // BREVO_API_KEY secret on that Worker instead of duplicating it.
    const sendUrl = String(env.INBOX_MAIL_URL).replace(/\/+$/, '') + '/internal/send';
    const body = {
        from:    fromEmail,
        to:      senderAddr,
        replyTo: recipient,           // so customer replies land back in the right mailbox
        subject: replySubject,
        text:    textContent,
        html:    htmlContent,
        headers: extraHeaders
    };

    try {
        const res = await fetch(sendUrl, {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + env.INTERNAL_SEND_TOKEN,
                'Content-Type':  'application/json',
                'Accept':        'application/json'
            },
            body: JSON.stringify(body)
        });
        if (!res.ok) {
            const txt = await res.text().catch(() => '');
            console.error('email-router: /internal/send rejected:', res.status, txt);
            return;
        }
        console.log('email-router: auto-replied to', senderAddr, '(template:', templateId + ')');

        // ── Log the auto-reply to /sentEmails ─────────────────
        // Without this, server-side auto-replies never show up in the
        // dashboard's "Sent" tab — only browser-initiated sends do.
        // We mirror the schema js/inbox.js writes so loadSent() picks
        // it up automatically (sorted by createdAt desc).
        try {
            const sendJson = await res.clone().json().catch(() => ({}));
            const t = await getFirestoreAccessToken(env);
            await firestoreAddDoc(env, t, 'sentEmails', {
                from:        fromEmail,
                to:          senderAddr,
                subject:     replySubject,
                bodyText:    textContent || '',
                sentBy:      'auto-reply',
                messageId:   String(sendJson.messageId || ''),
                sentAt:      String(sendJson.sentAt || new Date().toISOString()),
                autoReply:   true,
                templateId:  templateId,
                inReplyToMailId: (parsed && parsed.messageId) || '',
                createdAt:   new Date()
            });
        } catch (logErr) {
            console.warn('email-router: failed to log auto-reply to /sentEmails:', logErr && logErr.message);
        }
    } catch (err) {
        console.error('email-router: /internal/send network error:', err && err.message);
    }
}

function extractEmailAddr(s) {
    s = String(s || '');
    const m1 = /<\s*([^>\s]+@[^>\s]+)\s*>/.exec(s);
    if (m1) return m1[1].trim();
    const m2 = /([^\s,;<>"]+@[^\s,;<>"]+)/.exec(s);
    return m2 ? m2[1].trim() : '';
}

/* Extract a display-name from a "Foo Bar <foo@bar.com>" header.
   Returns '' when only a bare email is present. */
function extractNameFromHeader(s) {
    s = String(s || '');
    const m = /^([^<]+?)\s*<.+>$/.exec(s);
    if (!m) return '';
    return m[1].trim().replace(/^"|"$/g, '');
}

/* Replace {{placeholders}} (case-sensitive) in a template string. */
function renderPlaceholders(tpl, vars) {
    let out = String(tpl == null ? '' : tpl);
    for (const k of Object.keys(vars || {})) {
        out = out.split('{{' + k + '}}').join(String(vars[k] == null ? '' : vars[k]));
    }
    return out;
}

/* Convert plain-text (with \n line breaks) into a minimal HTML body
   suitable for email clients. Each blank line starts a new <p>. */
function plainToHtml(text) {
    return String(text || '')
        .split(/\n{2,}/)
        .map(p =>
            '<p style="margin:0 0 12px;">' +
                p.replace(/[&<>]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;' }[c]))
                 .replace(/\n/g, '<br>') +
            '</p>'
        ).join('\n');
}

function pickTemplate(recipient) {
    const r = String(recipient || '').toLowerCase();
    if (r.startsWith('cancellation@'))  return TEMPLATES.cancellation;
    if (r.startsWith('booking@'))       return TEMPLATES.booking;
    if (r.startsWith('enquiries@') || r.startsWith('enquiry@')) return TEMPLATES.enquiry;
    return TEMPLATES.info;
}

/* ── Template strings — edit at will. The HTML versions render in
 *  Gmail / Outlook / Apple Mail without external CSS or images. ── */
const SIGNATURE = {
    text:
        'Warm regards,\n' +
        'Team Andaman Voyages\n' +
        'Bharat Transport & Tourism\n' +
        '+91 88801 95191 / +91 94341 25698\n' +
        'booking@andamanvoyages.in\n' +
        'https://andamanvoyages.in',
    html:
        '<p style="margin:1.25rem 0 0;color:#1c2b48;line-height:1.6;">' +
            'Warm regards,<br>' +
            '<strong>Team Andaman Voyages</strong><br>' +
            '<span style="color:#5a6877;">Bharat Transport &amp; Tourism</span><br>' +
            '<a href="tel:+918880195191" style="color:#0d7a8a;text-decoration:none;">+91 88801 95191</a> / +91 94341 25698<br>' +
            '<a href="mailto:booking@andamanvoyages.in" style="color:#0d7a8a;text-decoration:none;">booking@andamanvoyages.in</a><br>' +
            '<a href="https://andamanvoyages.in" style="color:#0d7a8a;text-decoration:none;">andamanvoyages.in</a>' +
        '</p>'
};

function wrapHtml(headline, paragraphs) {
    return (
        '<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:620px;margin:0 auto;color:#1c2b48;line-height:1.55;">' +
            '<div style="background:linear-gradient(135deg,#0d7a8a,#16a085);color:#fff;padding:18px 22px;border-radius:10px 10px 0 0;">' +
                '<h2 style="margin:0;font-size:1.15rem;font-weight:700;">' + headline + '</h2>' +
            '</div>' +
            '<div style="background:#fff;border:1px solid #e3e8ef;border-top:0;padding:20px 22px;border-radius:0 0 10px 10px;">' +
                paragraphs.map(p => '<p style="margin:0 0 .9rem;">' + p + '</p>').join('') +
                SIGNATURE.html +
            '</div>' +
        '</div>'
    );
}

const TEMPLATES = {
    booking: {
        id: 'booking',
        text:
            'Hi there,\n\n' +
            'Thanks for writing to Andaman Voyages — we have received your booking-related email and our team will get back to you within 1-2 hours during business hours (9 AM - 9 PM IST).\n\n' +
            'For anything urgent — flight changes, ferry timing, or pickup co-ordination — please call or WhatsApp us on +91 88801 95191. We are happy to help.\n\n' +
            'In the meantime, you can browse our latest packages at https://andamanvoyages.in.\n\n' +
            SIGNATURE.text,
        html: wrapHtml(
            "We've got your booking enquiry",
            [
                'Hi there,',
                "Thanks for writing to <strong>Andaman Voyages</strong> — we've received your email and our team will get back to you within <strong>1-2 hours</strong> during business hours (9 AM - 9 PM IST).",
                'For anything urgent — flight changes, ferry timing, or pickup coordination — please call or WhatsApp us on <a href="tel:+918880195191" style="color:#0d7a8a;font-weight:600;">+91 88801 95191</a>. We are happy to help.',
                'In the meantime, you can browse our latest packages at <a href="https://andamanvoyages.in" style="color:#0d7a8a;">andamanvoyages.in</a>.'
            ]
        )
    },

    cancellation: {
        id: 'cancellation',
        text:
            'Hi there,\n\n' +
            'We have received your cancellation request. Our team will review your booking and respond within 1-2 hours during business hours (9 AM - 9 PM IST).\n\n' +
            'Refund policy in brief:\n' +
            '  - More than 7 days before travel: Rs. 2,000-4,000 per traveller refunded (depending on package tier).\n' +
            '  - Within 7 days of travel or no-show: full advance forfeited.\n\n' +
            'Full policy: https://andamanvoyages.in/terms#cancellation\n\n' +
            'If you would like to talk to us first before cancelling, please call +91 88801 95191 — sometimes a date change is easier than a full cancellation.\n\n' +
            SIGNATURE.text,
        html: wrapHtml(
            "We've received your cancellation request",
            [
                'Hi there,',
                "We've received your cancellation request. Our team will review your booking and respond within <strong>1-2 hours</strong> during business hours (9 AM - 9 PM IST).",
                'Refund policy in brief:<br>' +
                    '<span style="display:inline-block;margin:.25rem 0 0 1rem;color:#3a4a55;">' +
                        '• More than 7 days before travel: ₹2,000-4,000 per traveller refunded (by package tier).<br>' +
                        '• Within 7 days of travel or no-show: full advance forfeited.' +
                    '</span><br>' +
                    '<a href="https://andamanvoyages.in/terms#cancellation" style="color:#0d7a8a;">Read the full policy →</a>',
                'If you would like to talk to us first before cancelling, please call <a href="tel:+918880195191" style="color:#0d7a8a;font-weight:600;">+91 88801 95191</a> — sometimes a date change is easier than a full cancellation.'
            ]
        )
    },

    enquiry: {
        id: 'enquiry',
        text:
            'Hi there,\n\n' +
            'Thank you for your enquiry about Andaman Voyages! We have received your message and our team will reply with detailed itinerary options + pricing within 1-2 hours.\n\n' +
            'A few quick links while you wait:\n' +
            '  - All Andaman packages: https://andamanvoyages.in/#packages\n' +
            '  - Customise your own trip: https://andamanvoyages.in/customize\n' +
            '  - Talk on WhatsApp: +91 88801 95191\n\n' +
            SIGNATURE.text,
        html: wrapHtml(
            'Thank you for your enquiry',
            [
                'Hi there,',
                "Thank you for your enquiry about <strong>Andaman Voyages</strong>! We've received your message and our team will reply with detailed itinerary options + pricing within <strong>1-2 hours</strong>.",
                'A few quick links while you wait:<br>' +
                    '<span style="display:inline-block;margin:.25rem 0 0 1rem;">' +
                        '🏝 <a href="https://andamanvoyages.in/#packages" style="color:#0d7a8a;">All Andaman packages</a><br>' +
                        '🛠 <a href="https://andamanvoyages.in/customize" style="color:#0d7a8a;">Customise your own trip</a><br>' +
                        '💬 <a href="https://wa.me/918880195191" style="color:#25d366;font-weight:600;">Chat on WhatsApp</a>' +
                    '</span>'
            ]
        )
    },

    info: {
        id: 'info',
        text:
            'Hi there,\n\n' +
            'Thanks for reaching out to Andaman Voyages — your message is in our queue and our team will reply within 1-2 hours during business hours (9 AM - 9 PM IST).\n\n' +
            'For anything urgent, please call or WhatsApp us on +91 88801 95191.\n\n' +
            SIGNATURE.text,
        html: wrapHtml(
            "Thanks — we'll be in touch soon",
            [
                'Hi there,',
                "Thanks for reaching out to <strong>Andaman Voyages</strong> — your message is in our queue and our team will reply within <strong>1-2 hours</strong> during business hours (9 AM - 9 PM IST).",
                'For anything urgent, please call or WhatsApp us on <a href="tel:+918880195191" style="color:#0d7a8a;font-weight:600;">+91 88801 95191</a>.'
            ]
        )
    }
};
