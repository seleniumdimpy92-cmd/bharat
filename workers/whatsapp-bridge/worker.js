/* ── whatsapp-bridge Worker ─────────────────────────────────────
 * Bridges the website's custom live-chat with the admin's WhatsApp.
 *
 *   POST /notify    — js/chat.js calls this when a customer message lands.
 *                     We read the latest message from /chats/{sessionId},
 *                     DM the admin via WhatsApp Cloud API.
 *
 *   GET  /webhook   — Meta's "verify" handshake (one-time on setup).
 *   POST /webhook   — Meta delivers the admin's WhatsApp reply here.
 *                     We HMAC-verify the body, look up the most recent
 *                     active session, and append the admin reply into
 *                     /chats/{sessionId}/messages so it streams to the
 *                     customer's open browser.
 *
 * Setup: see whatsapp_setup.md
 * ──────────────────────────────────────────────────────────────── */

import {
    getFirestoreAccessToken,
    firestoreGetDoc, firestoreAddDoc, firestoreSetDoc,
    firestoreQueryLatestActiveSession
} from './firestore.js';

const META_GRAPH = 'https://graph.facebook.com/v20.0';

export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        // CORS preflight (only /notify is called from the browser)
        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: corsHeaders(env, request) });
        }

        if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
            return jsonResponse(env, request, {
                ok: true,
                service: 'whatsapp-bridge',
                hasAccessToken:    !!env.META_ACCESS_TOKEN,
                hasAppSecret:      !!env.META_APP_SECRET,
                hasVerifyToken:    !!env.META_WEBHOOK_VERIFY_TOKEN,
                hasServiceAccount: !!env.FIREBASE_SERVICE_ACCOUNT_KEY
            });
        }

        // Meta webhook — GET = verify, POST = inbound message
        if (url.pathname === '/webhook') {
            if (request.method === 'GET')  return handleWebhookVerify(request, env);
            if (request.method === 'POST') return handleWebhookEvent(request, env);
        }

        if (request.method === 'POST' && url.pathname === '/notify') {
            return handleNotify(request, env);
        }

        return jsonResponse(env, request, { error: 'Not found' }, 404);
    }
};

/* ── CORS ────────────────────────────────────────────────────── */
function corsHeaders(env, request) {
    const origin = request.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
    const allowOrigin = allowed.includes(origin) ? origin : (allowed[0] || '*');
    return {
        'Access-Control-Allow-Origin': allowOrigin,
        'Vary': 'Origin',
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    };
}
function jsonResponse(env, request, body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            ...corsHeaders(env, request)
        }
    });
}

/* ── Webhook verify (Meta one-time challenge) ───────────────── */
function handleWebhookVerify(request, env) {
    const url = new URL(request.url);
    const mode      = url.searchParams.get('hub.mode');
    const token     = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');
    const want      = String(env.META_WEBHOOK_VERIFY_TOKEN || '');
    if (mode === 'subscribe' && want && token === want) {
        return new Response(challenge || '', { status: 200 });
    }
    return new Response('verify failed', { status: 403 });
}

/* ── Inbound: admin replies on WhatsApp ─────────────────────── */
async function handleWebhookEvent(request, env) {
    // Verify HMAC signature so random people can't spoof us.
    const raw = await request.text();
    if (!await verifyMetaSignature(raw, request.headers.get('x-hub-signature-256') || '', env.META_APP_SECRET)) {
        console.warn('[whatsapp-bridge] invalid Meta signature');
        return new Response('bad signature', { status: 401 });
    }

    let body;
    try { body = JSON.parse(raw); }
    catch (_) { return new Response('bad json', { status: 400 }); }

    // Walk the Meta payload — entries → changes → value.messages[].
    const entries = Array.isArray(body.entry) ? body.entry : [];
    for (const entry of entries) {
        const changes = Array.isArray(entry.changes) ? entry.changes : [];
        for (const ch of changes) {
            const v = (ch && ch.value) || {};
            const msgs = Array.isArray(v.messages) ? v.messages : [];
            for (const m of msgs) {
                if (m.type !== 'text' || !m.text || !m.text.body) continue;
                const adminPhone = String(m.from || '').replace(/\D/g, '');
                const text       = String(m.text.body || '').trim();
                if (!text) continue;
                try { await routeAdminReply(env, adminPhone, text, m); }
                catch (err) { console.error('[whatsapp-bridge] route reply failed:', err); }
            }
        }
    }
    // Always 200 — Meta retries 5xx aggressively.
    return new Response('ok', { status: 200 });
}

/* When the admin replies on WhatsApp, drop the text into the
 * latest active chat session. We pick the session with the most
 * recent unreadByAdmin === true (i.e. the customer who's currently
 * waiting). For Phase 1 this works fine for one customer at a time;
 * Phase 2 can move to per-session "magic words" or quick-reply
 * buttons that include the sessionId. */
async function routeAdminReply(env, adminPhone, text, rawMsg) {
    const token = await getFirestoreAccessToken(env);
    const session = await firestoreQueryLatestActiveSession(env, token);
    if (!session) {
        console.warn('[whatsapp-bridge] admin replied but no active chat session found');
        return;
    }
    await firestoreAddDoc(env, token,
        ['chats', session.id, 'messages'].join('/'),
        {
            role:        'admin',
            text:        text,
            senderName:  'Andaman Voyages Team',
            senderPhone: adminPhone,
            via:         'whatsapp',
            createdAt:   new Date()
        }
    );
    // Mark the parent doc so the customer's chat clears its unread badge.
    await firestoreSetDoc(env, token, ['chats', session.id].join('/'), {
        lastMessage:    text.slice(0, 280),
        lastMessageAt:  new Date(),
        lastMessageBy:  'admin',
        unreadByAdmin:  false,
        unreadByCustomer: true
    });
    console.log('[whatsapp-bridge] routed admin reply to session', session.id);
}

/* ── Outbound: customer sent a chat message ─────────────────── */
async function handleNotify(request, env) {
    let body;
    try { body = await request.json(); }
    catch (_) { return jsonResponse(env, request, { error: 'bad json' }, 400); }

    const sessionId = String(body.sessionId || '').trim();
    const preview   = String(body.preview   || '').slice(0, 500);
    if (!sessionId) return jsonResponse(env, request, { error: 'sessionId required' }, 400);
    if (!env.META_ACCESS_TOKEN) return jsonResponse(env, request, { error: 'META_ACCESS_TOKEN not configured' }, 503);

    // Look up which mailbox to send to.  We pull /settings/site to read
    // whatsappBridgePhoneNumberId (Meta phone-number-id) and whatsappBridgeAdminPhone.
    let settings = null;
    try {
        const t = await getFirestoreAccessToken(env);
        settings = await firestoreGetDoc(env, t, 'settings', 'site');
    } catch (err) {
        return jsonResponse(env, request, { error: 'settings read failed: ' + (err.message || err) }, 500);
    }
    if (!settings || !settings.whatsappBridgeEnabled) {
        return jsonResponse(env, request, { error: 'bridge disabled in /settings/site' }, 503);
    }
    const phoneNumberId = String(settings.whatsappBridgePhoneNumberId || '').replace(/\D/g, '');
    const adminPhone    = String(settings.whatsappBridgeAdminPhone    || '').replace(/\D/g, '');
    if (!phoneNumberId || !adminPhone) {
        return jsonResponse(env, request, { error: 'phoneNumberId or adminPhone not configured in /settings/site' }, 503);
    }

    // Fetch the parent /chats/{sessionId} doc to enrich the message
    // with the customer's name/email so the admin can reply usefully.
    let parent = null;
    try {
        const t = await getFirestoreAccessToken(env);
        parent = await firestoreGetDoc(env, t, 'chats', sessionId);
    } catch (_) {}
    const customerLabel = (parent && (parent.customerName || parent.customerEmail))
        ? ` from ${parent.customerName || parent.customerEmail}`
        : '';

    // DM the admin with a digest. Reply on WhatsApp → /webhook → back into chat.
    const text =
        '💬 New chat' + customerLabel + ':\n\n' +
        '"' + preview + '"\n\n' +
        '↩ Reply to this WhatsApp message and it will go back to the customer.\n' +
        'session: ' + sessionId;

    let metaRes;
    try {
        metaRes = await fetch(
            META_GRAPH + '/' + encodeURIComponent(phoneNumberId) + '/messages',
            {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer ' + env.META_ACCESS_TOKEN,
                    'Content-Type':  'application/json'
                },
                body: JSON.stringify({
                    messaging_product: 'whatsapp',
                    to: adminPhone,
                    type: 'text',
                    text: { body: text }
                })
            }
        );
    } catch (err) {
        return jsonResponse(env, request, { error: 'meta request failed: ' + (err.message || err) }, 502);
    }
    const json = await metaRes.json().catch(() => ({}));
    if (!metaRes.ok) {
        return jsonResponse(env, request, {
            error: 'meta rejected: ' + metaRes.status,
            detail: json
        }, 502);
    }
    return jsonResponse(env, request, { ok: true, messageId: (json.messages && json.messages[0] && json.messages[0].id) || '' });
}

/* ── Meta HMAC verify ──────────────────────────────────────── */
async function verifyMetaSignature(raw, header, secret) {
    if (!secret) {
        // No secret configured — refuse so we don't accept arbitrary callers.
        console.warn('[whatsapp-bridge] META_APP_SECRET not set — rejecting webhook');
        return false;
    }
    if (!header || !header.startsWith('sha256=')) return false;
    const expected = header.slice('sha256='.length).trim();

    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
        'raw',
        enc.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(raw));
    const hex = Array.from(new Uint8Array(sigBuf))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    // Constant-time compare (length + char loop)
    if (hex.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < hex.length; i++) {
        diff |= hex.charCodeAt(i) ^ expected.charCodeAt(i);
    }
    return diff === 0;
}
