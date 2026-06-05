/* ── brevo.js — minimal Brevo v3 transactional-email send ──── */

// ── Hard-coded list of OUR five official mailboxes ─────────────
// Defence-in-depth: even if REPORT_FROM_EMAIL or env.FROM_EMAIL is
// misconfigured, this Worker can never send FROM an address outside
// this list. Update only if a new official mailbox is added in
// Cloudflare Email Routing AND verified in Brevo.
const OFFICIAL_SENDERS = [
    'info@andamanvoyages.in',
    'booking@andamanvoyages.in',
    'cancellation@andamanvoyages.in',
    'enquiries@andamanvoyages.in',
    'noreply@andamanvoyages.in'
];

function ensureOfficial(addr) {
    const a = String(addr || '').trim().toLowerCase();
    if (OFFICIAL_SENDERS.includes(a)) return a;
    console.warn('ai-assistant brevo: From "' + a + '" not official — falling back to info@');
    return 'info@andamanvoyages.in';
}

export async function sendBrevoEmail(env, opts) {
    if (!env.BREVO_API_KEY) throw new Error('BREVO_API_KEY secret not set');
    const fromEmail = ensureOfficial(opts.fromEmail || env.REPORT_FROM_EMAIL || env.FROM_EMAIL);
    const fromName  = opts.fromName  || env.REPORT_FROM_NAME  || env.FROM_NAME || 'Andaman Voyages';
    if (!fromEmail) throw new Error('Brevo: from email not configured');
    if (!opts.to)   throw new Error('Brevo: to email is required');

    // Brevo's /v3/smtp/email rejects `name: ''` with
    // {"code":"missing_parameter","message":"name is missing in to"}
    // — when no display name is provided we must omit the field entirely.
    const toEntry = { email: opts.to };
    if (opts.toName && String(opts.toName).trim()) {
        toEntry.name = String(opts.toName).trim();
    }

    const body = {
        sender:   { email: fromEmail, name: fromName },
        to:       [toEntry],
        subject:  String(opts.subject || '(no subject)'),
        htmlContent: String(opts.html || ''),
        textContent: String(opts.text || stripHtml(opts.html || ''))
    };
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
            'api-key': env.BREVO_API_KEY,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        },
        body: JSON.stringify(body)
    });
    if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error('Brevo send failed: ' + res.status + ' ' + txt);
    }
    return res.json();
}

function stripHtml(html) {
    return String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}