/**
 * Cloudflare Email Worker for /customize enquiries.
 *
 * Triggered by an HTTP POST from https://andamanvoyages.in/customize.
 * Authenticates the request, builds an RFC-822 email and dispatches it
 * via the SEND_EMAIL binding (Cloudflare Email Routing).
 *
 * Required bindings (configured in wrangler.toml):
 *   - SEND_EMAIL    type=send_email, destination_address=booking@andamanvoyages.in
 *   - ALLOWED_ORIGIN  (var) e.g. "https://andamanvoyages.in"
 *   - SHARED_TOKEN   (secret) optional shared token sent as
 *                    `x-cz-token` header — only required when running
 *                    behind a non-CF proxy. Set to "" to disable.
 *
 * The worker:
 *   1. CORS-preflight handles OPTIONS.
 *   2. Validates Origin against ALLOWED_ORIGIN (so random sites can't abuse it).
 *   3. (Optional) Validates the x-cz-token header.
 *   4. Validates payload shape.
 *   5. Builds an RFC-822 multipart/alternative MIME message.
 *   6. Sends via env.SEND_EMAIL.send().
 */

import { EmailMessage } from 'cloudflare:email';
import { createMimeMessage } from 'mimetext/browser';
import { sha256Hex } from './lib.js';

// Defaults — overridable via env.FROM_EMAIL / env.FROM_NAME / env.TO_EMAIL
// (set in wrangler.toml [vars] block).
//
// IMPORTANT — Cloudflare's send_email binding requires that FROM_EMAIL is
// either:
//   (a) a verified Email Routing "destination address", OR
//   (b) on a domain you have Email Routing enabled for (sender address).
// If sending fails with 'destination address not verified', go to
// Email Routing → Destination Addresses and verify the FROM address.
const DEFAULT_FROM_EMAIL = 'enquiries@andamanvoyages.in';
const DEFAULT_FROM_NAME  = 'Andaman Voyages Enquiries';
// NOTE: This MUST be a verified destination address in Cloudflare Email
// Routing (Cloudflare → Email Routing → Destination Addresses → Verified).
// Cloudflare's send_email binding refuses any other recipient.
const DEFAULT_TO_EMAIL   = 'debjyoti.office@gmail.com';

// ── Whitelist of OUR official sender mailboxes ─────────────────
// Every outgoing email MUST come FROM one of these addresses. If
// FROM_EMAIL is misconfigured to anything else, we silently fall
// back to enquiries@ rather than impersonating an unrelated address.
//
// Override in wrangler.jsonc with:
//   "ALLOWED_SENDERS": "info@andamanvoyages.in,booking@andamanvoyages.in,..."
const OFFICIAL_SENDERS = [
    'info@andamanvoyages.in',
    'booking@andamanvoyages.in',
    'cancellation@andamanvoyages.in',
    'enquiries@andamanvoyages.in',
    'noreply@andamanvoyages.in'
];

function pickSender(env) {
    const allowed = (env.ALLOWED_SENDERS || OFFICIAL_SENDERS.join(','))
        .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    const want = (env.FROM_EMAIL || DEFAULT_FROM_EMAIL).trim().toLowerCase();
    if (allowed.includes(want)) return want;
    // Fall back to the first allowed sender; never impersonate
    // an outside address even if env is misconfigured.
    console.warn(
        'customize-email: FROM_EMAIL "' + want + '" not in ALLOWED_SENDERS — falling back to ' + allowed[0]
    );
    return allowed[0] || DEFAULT_FROM_EMAIL;
}

export default {
    async fetch(request, env, ctx) {
        const origin = request.headers.get('Origin') || '';
        const allowed = (env.ALLOWED_ORIGIN || '').trim();

        // CORS preflight
        if (request.method === 'OPTIONS') {
            return cors(new Response(null, { status: 204 }), origin, allowed);
        }

        if (request.method !== 'POST') {
            return cors(new Response('Method not allowed', { status: 405 }), origin, allowed);
        }

        // Origin allow-list (cheap abuse defence)
        if (allowed && origin !== allowed) {
            return cors(json({ error: 'origin not allowed' }, 403), origin, allowed);
        }

        // Optional shared-token check
        if (env.SHARED_TOKEN) {
            const got = request.headers.get('x-cz-token') || '';
            if (got !== env.SHARED_TOKEN) {
                return cors(json({ error: 'unauthorized' }, 401), origin, allowed);
            }
        }

        // Parse + validate payload
        let body;
        try { body = await request.json(); }
        catch { return cors(json({ error: 'invalid json' }, 400), origin, allowed); }

        const errs = validate(body);
        if (errs.length) return cors(json({ error: errs[0] }, 400), origin, allowed);

        // Build + send the email
        try {
            const fromEmail = pickSender(env);
            const fromName  = (env.FROM_NAME  || DEFAULT_FROM_NAME).trim();
            const toEmail   = (env.TO_EMAIL   || DEFAULT_TO_EMAIL).trim();

            const subject  = `Custom Andaman Trip Enquiry - ${body.traveller.name} (${body.ref})`;
            const textBody = buildText(body);
            const htmlBody = buildHtml(body);

            const msg = createMimeMessage();
            msg.setSender({ name: fromName, addr: fromEmail });
            msg.setRecipient(toEmail);
            // We do NOT CC the user — Cloudflare's send_email binding only
            // allows sending to verified destinations, and arbitrary user
            // emails won't be on that list. The user's email is captured in
            // the body of the message; the team replies manually to it.
            msg.setSubject(subject);
            msg.addMessage({ contentType: 'text/plain', data: textBody });
            msg.addMessage({ contentType: 'text/html',  data: htmlBody });

            const email = new EmailMessage(fromEmail, toEmail, msg.asRaw());
            await env.SEND_EMAIL.send(email);

            // ── Mirror to Firestore /receivedEmails ───────────────
            // The send_email binding above only delivers to verified
            // Gmail destinations (Cloudflare's restriction), so the
            // mail never enters Email Routing → email-router → Firestore.
            // We write a parallel record here ourselves so the dashboard
            // Inbox → Enquiries tab still sees it (with toast / beep
            // / unread badge from the existing onSnapshot listener).
            // Best-effort: a Firestore failure must NOT break the user-
            // facing email send, so we swallow + log.
            try {
                console.log('customize-email: starting mirror for ref', body.ref, 'has MIRROR_TOKEN:', !!env.MIRROR_TOKEN);
                await mirrorToFirestore(env, {
                    ref:        body.ref,
                    fromEmail, fromName,
                    toEmail:    'enquiries@andamanvoyages.in',
                    subject,
                    textBody, htmlBody,
                    traveller:  body.traveller || {},
                });
                console.log('customize-email: mirror succeeded for ref', body.ref);
            } catch (err) {
                console.error('customize-email: firestore mirror failed:', err && err.stack || err && err.message || String(err));
            }

            return cors(json({ ok: true, ref: body.ref }, 200), origin, allowed);
        } catch (err) {
            console.error('SEND_EMAIL failed:', err && err.stack || err);
            return cors(json({ error: 'send failed', detail: String(err && err.message || err) }, 502), origin, allowed);
        }
    }
};

// ─── helpers ───────────────────────────────────────────────────

function json(obj, status = 200) {
    return new Response(JSON.stringify(obj), {
        status,
        headers: { 'Content-Type': 'application/json' }
    });
}

function cors(resp, origin, allowed) {
    const h = new Headers(resp.headers);
    h.set('Access-Control-Allow-Origin',  allowed || origin || '*');
    h.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    h.set('Access-Control-Allow-Headers', 'Content-Type, x-cz-token');
    h.set('Access-Control-Max-Age',       '86400');
    h.set('Vary',                         'Origin');
    return new Response(resp.body, { status: resp.status, headers: h });
}

function validate(b) {
    const errs = [];
    if (!b || typeof b !== 'object')               errs.push('payload missing');
    if (!b.ref)                                    errs.push('ref missing');
    if (!b.traveller || typeof b.traveller !== 'object') errs.push('traveller missing');
    if (b.traveller && !b.traveller.name)          errs.push('name missing');
    if (b.traveller && !b.traveller.email)         errs.push('email missing');
    if (!b.trip || typeof b.trip !== 'object')     errs.push('trip missing');
    if (b.trip && !b.trip.start)                   errs.push('start missing');
    if (b.trip && (!Array.isArray(b.trip.islands) || !b.trip.islands.length)) errs.push('islands missing');
    return errs;
}

/* Mirror this enquiry into Firestore /receivedEmails so the
 * dashboard's Enquiries tab sees it. Rather than juggle a second
 * service-account secret here, we delegate to the email-router
 * Worker's /mirror endpoint — that Worker already holds the
 * FIREBASE_SERVICE_ACCOUNT_KEY. Auth is a shared bearer token
 * (env.MIRROR_TOKEN — same value on both Workers).
 *
 * Doc ID is SHA-256(customize:<ref>) so retries from the browser
 * dedupe naturally. */
async function mirrorToFirestore(env, info) {
    const token = (env.MIRROR_TOKEN || '').trim();
    if (!token || !env.EMAIL_ROUTER) {
        // Mirror not configured — skip silently. The gmail send still works.
        return;
    }
    const docId = await sha256Hex('customize:' + (info.ref || Math.random()));
    const fromHeader = info.fromName
        ? `${info.fromName} <${info.fromEmail}>`
        : info.fromEmail;
    const replyTo = (info.traveller && info.traveller.email) || '';
    const fields = {
        messageId:    'customize-' + info.ref,
        envelopeFrom: info.fromEmail,
        envelopeTo:   'enquiries@andamanvoyages.in',
        from:         fromHeader,
        to:           'enquiries@andamanvoyages.in',
        cc:           '',
        subject:      info.subject,
        date:         new Date().toUTCString(),
        inReplyTo:    '',
        spamScore:    '',
        textPlain:    String(info.textBody || '').slice(0, 100_000),
        textHtml:     String(info.htmlBody || '').slice(0, 200_000),
        attachments:  [],
        rawSize:      String(info.htmlBody || '').length,
        mailbox:      'enquiries@andamanvoyages.in',
        unread:       true,
        receivedAt:   new Date().toISOString(),
        replyTo:      replyTo,
        source:       'customize-form'
    };
    // Service binding — Cloudflare routes this in-zone, no 1042 error.
    // The host part of the URL is ignored when calling a service binding;
    // only the path (/mirror) matters.
    const res = await env.EMAIL_ROUTER.fetch('https://internal/mirror', {
        method: 'POST',
        headers: {
            'Content-Type':  'application/json',
            'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify({ docId, fields })
    });
    if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error('mirror responded ' + res.status + ': ' + txt);
    }
}

function escHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
        ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])
    );
}

function buildText(d) {
    const L = [];
    L.push(`NEW CUSTOM-TRIP ENQUIRY  (${d.ref})`);
    L.push(`Submitted: ${d.createdAt || new Date().toISOString()}`);
    L.push('');
    L.push('-- TRAVELLER --');
    L.push(`Name:        ${d.traveller.name}`);
    L.push(`Email:       ${d.traveller.email}`);
    L.push(`Phone:       ${d.traveller.phone || ''}`);
    L.push(`Preferred:   ${d.traveller.preferred || ''}`);
    if (d.user) L.push(`Account:     ${d.user.username || '(none)'} / ${d.user.email || ''} (uid ${d.user.uid || '?'})`);
    L.push('');
    L.push('-- TRIP --');
    L.push(`Dates:       ${d.trip.start || '?'} to ${d.trip.end || '?'}`);
    L.push(`Travellers:  ${d.trip.adults || 0} adult(s) + ${d.trip.children || 0} child(ren)`);
    L.push(`Departure:   ${d.trip.city || '(not specified)'}`);
    L.push(`Budget:      ${d.trip.budget || '(flexible)'}`);
    L.push('');
    L.push(`Islands:     ${(d.trip.islands || []).join(', ') || '(any)'}`);
    L.push(`Hotel:       ${(d.trip.hotel || []).join(', ') || '(not chosen)'}`);
    L.push(`Vibe:        ${(d.trip.vibe  || []).join(', ') || '(any)'}`);
    L.push(`Inclusions:  ${(d.trip.inclusions || []).join(', ') || '(defaults)'}`);
    L.push(`Activities:  ${(d.trip.activities || []).join(', ') || '(none)'}`);
    L.push('');
    if (d.trip.notes) { L.push('-- NOTES --'); L.push(d.trip.notes); L.push(''); }
    L.push('-- REPLY --');
    L.push(`Please send a personalised quote within 2 working hours to:`);
    L.push(`  Email:    ${d.traveller.email}`);
    L.push(`  WhatsApp: ${d.traveller.phone || ''}`);
    L.push('');
    L.push(`Reference: ${d.ref}`);
    return L.join('\n');
}

function buildHtml(d) {
    const row  = (k, v) => `<tr><td style="padding:4px 12px;color:#777;white-space:nowrap;">${escHtml(k)}</td><td style="padding:4px 12px;color:#0d2b3a;font-weight:600;">${escHtml(v || '—')}</td></tr>`;
    const list = (k, arr, fb) => row(k, (arr && arr.length) ? arr.join(', ') : (fb || '—'));
    const notes = d.trip.notes
        ? `<h3 style="margin:1.5rem 0 .5rem;color:#0d2b3a;">Notes from customer</h3>
           <p style="background:#f8fafb;padding:.8rem 1rem;border-left:3px solid #0d7a8a;color:#3d4f5a;">
             ${escHtml(d.trip.notes).replace(/\n/g, '<br>')}
           </p>`
        : '';
    return `<div style="font-family:Arial,Helvetica,sans-serif;background:#f0f4f7;padding:24px;">
      <div style="max-width:640px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 6px 20px rgba(8,30,42,.08);">
        <div style="background:linear-gradient(135deg,#0d7a8a,#16a085);color:#fff;padding:22px 28px;">
          <div style="font-size:13px;letter-spacing:.14em;text-transform:uppercase;opacity:.85;">New custom-trip enquiry</div>
          <h1 style="margin:.3rem 0 0;font-size:24px;">${escHtml(d.traveller.name)}</h1>
          <div style="opacity:.9;font-size:13px;margin-top:6px;">Reference: <strong>${escHtml(d.ref)}</strong> · ${escHtml(d.createdAt || '')}</div>
        </div>
        <div style="padding:24px 28px;">          <h3 style="margin:0 0 .5rem;color:#0d2b3a;font-size:16px;">Traveller</h3>
          <table style="width:100%;border-collapse:collapse;font-size:14px;">
            ${row('Name',      d.traveller.name)}
            ${row('Email',     d.traveller.email)}
            ${row('Phone',     d.traveller.phone)}
            ${row('Preferred', d.traveller.preferred)}
            ${d.user ? row('Account', `${d.user.username || '(none)'} · ${d.user.email || ''} · uid ${d.user.uid || '?'}`) : ''}
          </table>
          <h3 style="margin:1.4rem 0 .5rem;color:#0d2b3a;font-size:16px;">Trip</h3>
          <table style="width:100%;border-collapse:collapse;font-size:14px;">
            ${row('Dates',      `${d.trip.start || '?'} to ${d.trip.end || '?'}`)}
            ${row('Travellers', `${d.trip.adults || 0} adult(s) + ${d.trip.children || 0} child(ren)`)}
            ${row('Departure',  d.trip.city || '(not specified)')}
            ${row('Budget',     d.trip.budget || '(flexible)')}
            ${list('Islands',    d.trip.islands,    '(any)')}
            ${list('Hotel',      d.trip.hotel,      '(not chosen)')}
            ${list('Vibe',       d.trip.vibe,       '(any)')}
            ${list('Inclusions', d.trip.inclusions, '(defaults)')}
            ${list('Activities', d.trip.activities, '(none)')}
          </table>
          ${notes}
          <div style="margin-top:1.6rem;padding:14px 16px;background:#fff8e1;border-radius:10px;color:#7a5400;font-size:13px;">
            <strong>Reply target:</strong> ${escHtml(d.traveller.email)} · WhatsApp ${escHtml(d.traveller.phone || '')} · within 2 working hours please.
          </div>
        </div>
        <div style="padding:14px 28px;background:#0d2b3a;color:#cdd9e0;font-size:12px;text-align:center;">
          Sent automatically from andamanvoyages.in /customize
        </div>
      </div>
    </div>`;
}
