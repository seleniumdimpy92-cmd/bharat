/* ── ai-assistant Worker ────────────────────────────────────────
 * AI helpers powered by Google Gemini 1.5 Flash (free tier).
 *
 * Endpoints
 *   GET  /                health check
 *   POST /summarize       { text, subject?, from? } → { summary, intent, urgency, tags[] }
 *   POST /draft-reply     { emailText, subject?, from?, bookingContext? } → { reply }
 *   GET  /daily-report    (admin) generates today's report and emails it
 *                         ?dryRun=1 returns JSON without sending
 *
 * Scheduled handler
 *   Cron once a day at 02:30 UTC = 08:00 IST (see wrangler.jsonc).
 *   Reads yesterday's bookings + receivedEmails from Firestore,
 *   asks Gemini to write a 5-bullet executive summary, and emails
 *   it via Brevo to env.REPORT_TO_EMAIL.
 *
 * Auth
 *   /summarize, /draft-reply and /daily-report require an admin
 *   Firebase ID token in `Authorization: Bearer …`.
 *
 * Deploy
 *     cd workers/ai-assistant && npm install
 *     npx wrangler login
 *     npx wrangler secret put GEMINI_API_KEY
 *     npx wrangler secret put BREVO_API_KEY
 *     printf %s '<service-account JSON>' | \
 *         npx wrangler secret put FIREBASE_SERVICE_ACCOUNT_KEY
 *     npx wrangler deploy
 *
 * Then paste the worker URL into dashboard.html as
 *     window.AI_ASSISTANT_WORKER_URL = 'https://ai-assistant.<sub>.workers.dev';
 * ─────────────────────────────────────────────────────────────── */

import {
    corsHeaders, jsonResponse, requireAdmin, HttpError
} from './auth.js';
import { callGemini, tryParseJson, extractPackageFromImage } from './gemini.js';
import { getFirestoreAccessToken, queryFirestore }  from './firestore.js';
import { sendBrevoEmail }                           from './brevo.js';
import { handlePasswordReset }                      from './password-reset.js';

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: corsHeaders(env, request) });
        }
        if (request.method === 'GET' && url.pathname === '/') {
            return jsonResponse(env, request, {
                ok: true,
                service: 'ai-assistant',
                model: env.AI_MODEL || env.GEMINI_MODEL || '@cf/meta/llama-3.1-8b-instruct'
            });
        }
        try {
            if (request.method === 'POST' && url.pathname === '/summarize') {
                return await handleSummarize(request, env);
            }
            if (request.method === 'POST' && url.pathname === '/draft-reply') {
                return await handleDraftReply(request, env);
            }
            if (request.method === 'GET' && url.pathname === '/daily-report') {
                return await handleDailyReport(request, env, url);
            }
            if (request.method === 'POST' && url.pathname === '/extract-package') {
                return await handleExtractPackage(request, env);
            }
            // Public (unauthenticated) endpoint — sends a branded
            // password-reset email via Brevo so it doesn't go to spam.
            // Anti-enumeration + per-IP rate limit live inside the handler.
            if (request.method === 'POST' && url.pathname === '/password-reset') {
                return await handlePasswordReset(request, env, corsHeaders);
            }
        } catch (err) {
            const status = (err && err.status) || 500;
            console.error('ai-assistant error:', err && err.stack || err);
            return jsonResponse(env, request, { error: String(err && err.message || err) }, status);
        }
        return jsonResponse(env, request, { error: 'Not found' }, 404);
    },

    async scheduled(event, env, ctx) {
        try {
            const report = await generateDailyReport(env);
            await sendDailyReportEmail(env, report);
            console.log('ai-assistant: daily report sent ok');
        } catch (err) {
            console.error('ai-assistant scheduled task failed:', err && err.stack || err);
        }
    }
};

/* ═══════════════════════════════════════════════════════════
 * /summarize — 1-line summary + intent / urgency / tags
 * ══════════════════════════════════════════════════════════ */
async function handleSummarize(request, env) {
    await requireAdmin(request, env);
    const body = await request.json().catch(() => ({}));
    const text    = String(body.text    || '').slice(0, 8000);
    const subject = String(body.subject || '').slice(0, 300);
    const from    = String(body.from    || '').slice(0, 200);
    if (!text && !subject) throw new HttpError(400, 'text or subject required');

    const prompt = `You are an assistant for an Andaman Islands tour operator
("Bharat Transport & Tourism / Andaman Voyages"). Read this customer email
and respond with ONE JSON object only — no explanation, no markdown fences.

Schema:
{
  "summary":  "<= 25 word one-liner of what the customer wants",
  "intent":   "enquiry" | "booking" | "cancellation" | "complaint" |
              "payment_query" | "itinerary_change" | "other",
  "urgency":  "low" | "normal" | "high",
  "tags":     ["short","kebab-case","tags"]   (max 4)
}

Email metadata:
  From:    ${from}
  Subject: ${subject}

Email body:
"""
${text}
"""`;

    const { text: out } = await callGemini(env, prompt, {
        json: true, maxTokens: 256, temperature: 0.2
    });
    const parsed = tryParseJson(out) || {
        summary: out.slice(0, 200),
        intent: 'other',
        urgency: 'normal',
        tags: []
    };
    return jsonResponse(env, request, {
        ok: true,
        summary: String(parsed.summary || '').slice(0, 240),
        intent:  String(parsed.intent  || 'other'),
        urgency: String(parsed.urgency || 'normal'),
        tags:    Array.isArray(parsed.tags) ? parsed.tags.slice(0, 4) : []
    });
}

/* ═══════════════════════════════════════════════════════════
 * /draft-reply — writes a polite suggested reply
 * ══════════════════════════════════════════════════════════ */
async function handleDraftReply(request, env) {
    await requireAdmin(request, env);
    const body = await request.json().catch(() => ({}));
    const emailText = String(body.emailText || '').slice(0, 8000);
    const subject   = String(body.subject   || '').slice(0, 300);
    const from      = String(body.from      || '').slice(0, 200);
    const ctxObj    = body.bookingContext || null;
    const ctxStr    = ctxObj ? JSON.stringify(ctxObj).slice(0, 2000) : '';

    if (!emailText) throw new HttpError(400, 'emailText required');

    const prompt = `You are a customer-service writer for Andaman Voyages
(Bharat Transport & Tourism), an Andaman Islands holiday operator based in
Port Blair.

Tone:
  • Friendly and professional, never salesy.
  • Indian English. Short sentences. Bullet points where helpful.
  • Always sign off as the team, e.g. "Warm regards, Team Andaman Voyages".

Strict rules:
  • Never invent prices, dates, hotel names or ferry timings — if the
    customer asks, say you'll confirm and reply within 1–2 hours.
  • Booking advance is fixed: ₹6,000 per traveller for Budget/Standard,
    ₹11,000/traveller for Luxury/Premium/Honeymoon.
  • Phone: +91 88801 95191 / +91 94341 25698.
  • Email: booking@andamanvoyages.in
  • Office hours: 9 AM – 9 PM IST.
  • Output ONLY the email body (no subject line, no greeting like "Hi
    Sir/Madam," — start with the actual content paragraph).

Customer's email metadata:
  From:    ${from}
  Subject: ${subject}

${ctxStr ? 'Booking context (JSON):\n' + ctxStr + '\n' : ''}
Customer's email body:
"""
${emailText}
"""

Now write the reply.`;

    const { text } = await callGemini(env, prompt, {
        json: false, maxTokens: 800, temperature: 0.6
    });
    return jsonResponse(env, request, { ok: true, reply: String(text || '').trim() });
}

/* ═══════════════════════════════════════════════════════════
 * /daily-report — admin-triggered or scheduled
 * ══════════════════════════════════════════════════════════ */
async function handleDailyReport(request, env, url) {
    await requireAdmin(request, env);
    const dryRun = url.searchParams.get('dryRun') === '1';
    const report = await generateDailyReport(env);
    if (!dryRun) await sendDailyReportEmail(env, report);
    return jsonResponse(env, request, { ok: true, dryRun, ...report });
}

async function generateDailyReport(env) {
    const token = await getFirestoreAccessToken(env);
    const sinceMs = Date.now() - 24 * 60 * 60 * 1000;
    const sinceIso = new Date(sinceMs).toISOString();

    // Bookings created in the last 24 h. The bookings collection in
    // Firestore stores `createdAt` as a server timestamp (ISO string in
    // many docs, integer ms in some legacy docs). We query with the
    // string form which is what new docs use; older docs are skipped
    // by Firestore's strict-typed comparison — fine for a daily summary.
    let bookings = [];
    try {
        bookings = await queryFirestore(env, token, 'bookings', {
            where:    [{ field: 'createdAt', op: 'GREATER_THAN_OR_EQUAL', value: sinceIso }],
            orderBy:  'createdAt',
            orderDirection: 'DESCENDING',
            limit:    100
        });
    } catch (e) { console.warn('bookings query failed:', e.message); }

    // Received emails in the last 24 h.
    let emails = [];
    try {
        emails = await queryFirestore(env, token, 'receivedEmails', {
            where:    [{ field: 'receivedAt', op: 'GREATER_THAN_OR_EQUAL', value: sinceIso }],
            orderBy:  'receivedAt',
            orderDirection: 'DESCENDING',
            limit:    100
        });
    } catch (e) { console.warn('receivedEmails query failed:', e.message); }

    // Build raw stats
    const stats = {
        bookingsCount: bookings.length,
        confirmedCount: bookings.filter(b => (b.status || '').toLowerCase() === 'confirmed').length,
        cancelledCount: bookings.filter(b => (b.status || '').toLowerCase() === 'cancelled').length,
        revenue: bookings.reduce((s, b) => s + (Number(b.amount) || 0), 0),
        emailsCount: emails.length,
        unreadEmails: emails.filter(e => !e.read).length
    };

    // Compact data for Gemini (avoid overwhelming the prompt)
    const slimBookings = bookings.slice(0, 30).map(b => ({
        id:      b._id || b.bookingRef,
        package: b.packageName || b.package || '?',
        amount:  b.amount,
        status:  b.status,
        guests:  b.adults || b.guests,
        date:    b.travelDate || b.tripStart,
        customer:(b.customerName || b.customer || '').slice(0, 60)
    }));
    const slimEmails = emails.slice(0, 30).map(e => ({
        from:    (e.from || '').slice(0, 80),
        subject: (e.subject || '').slice(0, 120),
        mailbox: e.toAddress || e.mailbox || '',
        snippet: (e.text || e.snippet || '').slice(0, 200)
    }));

    // Ask Gemini for a 5-bullet executive summary in plain HTML.
    // Markdown is intentionally avoided so the email body renders
    // cleanly in Gmail / Outlook without an MD-to-HTML conversion.
    const prompt = `You are the AI ops analyst for Andaman Voyages
(Bharat Transport & Tourism). Write a daily executive report for the
business owner. Output MUST be valid HTML (no markdown, no <html> or
<body> wrapper — just the inner HTML I can drop inside an email).

Structure:
  <h2>Summary</h2>
  <ul> 5 bullets — top facts, trends, and red flags </ul>
  <h2>Action items for today</h2>
  <ol> 3 prioritised tasks </ol>

Stats (last 24 h):
${JSON.stringify(stats, null, 2)}

Bookings (compact):
${JSON.stringify(slimBookings, null, 2)}

Emails (compact):
${JSON.stringify(slimEmails, null, 2)}

Be concrete (mention package names + ₹ amounts). If both lists are
empty, say it was a quiet day and suggest 3 promotional ideas.`;

    let html = '';
    try {
        const out = await callGemini(env, prompt, {
            json: false, maxTokens: 900, temperature: 0.5
        });
        html = String(out.text || '').trim();
    } catch (e) {
        html = '<p><em>Gemini call failed: ' + escapeHtml(e.message) + '</em></p>';
    }

    return {
        date:    new Date().toISOString().slice(0, 10),
        stats,
        html,
        sampleBookings: slimBookings,
        sampleEmails:   slimEmails
    };
}

async function sendDailyReportEmail(env, report) {
    const to = env.REPORT_TO_EMAIL;
    if (!to) throw new Error('REPORT_TO_EMAIL not configured');
    const r = report || {};
    const s = r.stats || {};
    const subject = `📊 Andaman Voyages — Daily AI Report for ${r.date || ''}`;
    const html =
        `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:680px;margin:0 auto;color:#1c2b48;">` +
        `<div style="background:linear-gradient(135deg,#0d7a8a,#16a085);color:#fff;padding:20px 24px;border-radius:10px 10px 0 0;">` +
        `<h1 style="margin:0;font-size:1.3rem;">📊 Daily AI Report</h1>` +
        `<p style="margin:.25rem 0 0;opacity:.9;">${escapeHtml(r.date || '')} · last 24 h</p>` +
        `</div>` +
        `<div style="background:#fff;border:1px solid #e3e8ef;border-top:0;padding:20px 24px;border-radius:0 0 10px 10px;">` +
        `<table cellpadding="0" cellspacing="0" style="width:100%;margin-bottom:1rem;">` +
        `<tr>` +
        `<td style="padding:.45rem .75rem;background:#e8f8f5;border-radius:6px;color:#0d7a8a;font-weight:700;">📅 ${s.bookingsCount || 0} bookings</td>` +
        `<td width="6"></td>` +
        `<td style="padding:.45rem .75rem;background:#eaf2f8;border-radius:6px;color:#3498db;font-weight:700;">💰 ₹${formatINR(s.revenue || 0)}</td>` +
        `<td width="6"></td>` +
        `<td style="padding:.45rem .75rem;background:#fef9e7;border-radius:6px;color:#a04000;font-weight:700;">📨 ${s.emailsCount || 0} emails</td>` +
        `</tr>` +
        `</table>` +
        (r.html || '<p>No content.</p>') +
        `<hr style="margin:1.25rem 0;border:0;border-top:1px solid #eee;">` +
        `<p style="font-size:.78rem;color:#888;">Generated by ai-assistant · Gemini 1.5 Flash · ` +
            `<a href="https://andamanvoyages.in/dashboard" style="color:#0d7a8a;">Open dashboard</a></p>` +
        `</div></div>`;

    return sendBrevoEmail(env, {
        to, subject, html,
        fromEmail: env.REPORT_FROM_EMAIL,
        fromName:  env.REPORT_FROM_NAME
    });
}

function formatINR(n) {
    n = Math.round(Number(n) || 0);
    return n.toLocaleString('en-IN');
}
function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
        ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

/* ═══════════════════════════════════════════════════════════
 * /extract-package — admin uploads a brochure (image/PDF page).
 * Worker calls Cloudflare Workers AI vision model and extracts
 * structured package fields (name, price, itinerary, etc).
 *
 * Body: { imageUrl: "https://res.cloudinary.com/.../brochure.jpg" }
 * Response: { ok, fields: {...}, raw }
 *
 * The frontend uploads the file to Cloudinary first (existing
 * unsigned preset), gets back a public URL, and posts it here.
 * That keeps this worker simple — it just fetches one URL.
 * ══════════════════════════════════════════════════════════ */
async function handleExtractPackage(request, env) {
    await requireAdmin(request, env);
    const body = await request.json().catch(() => ({}));
    const imageUrl = String(body.imageUrl || '').trim();
    if (!imageUrl) throw new HttpError(400, 'imageUrl required');
    if (!/^https?:\/\//i.test(imageUrl)) throw new HttpError(400, 'imageUrl must be http(s)');

    let result;
    try {
        result = await extractPackageFromImage(env, imageUrl);
    } catch (err) {
        throw new HttpError(500, err.message || 'extraction failed');
    }

    if (!result.ok || !result.fields) {
        return jsonResponse(env, request, {
            ok: false,
            error: 'AI could not parse a valid JSON package from the image. Try a sharper photo or single-page brochure.',
            raw: result.raw
        }, 422);
    }

    // Normalise + sanitise the extracted fields before sending back
    const f = result.fields || {};
    const safe = {
        name:        String(f.name || '').slice(0, 120).trim() || 'Untitled Package',
        desc:        String(f.desc || '').slice(0, 240).trim(),
        price:       sanitiseNumber(f.price, 0),
        duration:    String(f.duration || '').slice(0, 60).trim(),
        category:    sanitiseCategory(f.category),
        rating:      Math.max(0, Math.min(5, Number(f.rating) || 4.5)),
        inclusions:  sanitiseStringArray(f.inclusions, 12, 60),
        exclusions:  sanitiseStringArray(f.exclusions, 12, 60),
        places:      sanitiseStringArray(f.places, 10, 60),
        itinerary:   sanitiseItinerary(f.itinerary)
    };

    return jsonResponse(env, request, { ok: true, fields: safe, raw: result.raw });
}

function sanitiseNumber(v, fallback) {
    if (typeof v === 'number' && isFinite(v)) return Math.max(0, Math.round(v));
    if (typeof v === 'string') {
        const n = Number(v.replace(/[^\d.]/g, ''));
        if (isFinite(n) && n > 0) return Math.round(n);
    }
    return fallback;
}
function sanitiseCategory(v) {
    const allowed = ['Budget','Standard','Luxury','Premium','Honeymoon','Family','Adventure'];
    const s = String(v || '').trim();
    const hit = allowed.find(c => c.toLowerCase() === s.toLowerCase());
    return hit || '';
}
function sanitiseStringArray(arr, maxItems, maxLen) {
    if (!Array.isArray(arr)) return [];
    return arr.slice(0, maxItems)
        .map(x => String(x || '').slice(0, maxLen).trim())
        .filter(Boolean);
}
function sanitiseItinerary(arr) {
    if (!Array.isArray(arr)) return [];
    return arr.slice(0, 14).map((d, i) => ({
        day:     Number(d && d.day) || (i + 1),
        title:   String((d && d.title) || '').slice(0, 120).trim(),
        details: String((d && d.details) || '').slice(0, 600).trim()
    })).filter(d => d.title || d.details);
}
