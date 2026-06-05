/* ── telegram-bridge Worker ────────────────────────────────────
 * Bridges the website's custom live-chat with the admin's Telegram.
 *
 *   POST /notify    — js/chat.js calls this when a customer message lands.
 *                     We pull the parent /chats/{sessionId} doc, format a
 *                     digest with customer name/email + the latest message,
 *                     and DM the admin via Telegram Bot API sendMessage.
 *
 *   POST /webhook   — Telegram delivers admin replies here. We optionally
 *                     check the X-Telegram-Bot-Api-Secret-Token header,
 *                     find the latest active /chats session (or use a
 *                     "/reply <sessionId> <text>" command to target a
 *                     specific session), and append the reply into
 *                     /chats/{sessionId}/messages so the customer's
 *                     open browser tab receives it via Firestore live-sync.
 *
 *   GET  /webhook   — health check (Telegram doesn't use GET verification
 *                     like Meta does; we keep this for sanity testing).
 *
 *   GET  /set-webhook?url=…  — admin-friendly helper to register the
 *                              webhook with Telegram. Set this once after
 *                              deploying the worker.
 *
 * Setup walkthrough: telegram_setup.md
 * ───────────────────────────────────────────────────────────── */

import {
    getFirestoreAccessToken,
    firestoreGetDoc, firestoreAddDoc, firestoreSetDoc,
    firestoreQueryLatestActiveSession
} from './firestore.js';

const TELEGRAM_API = 'https://api.telegram.org';

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
                service: 'telegram-bridge',
                hasBotToken:        !!env.TELEGRAM_BOT_TOKEN,
                hasWebhookSecret:   !!env.TELEGRAM_WEBHOOK_SECRET,
                hasServiceAccount:  !!env.FIREBASE_SERVICE_ACCOUNT_KEY,
                projectId:          env.FIREBASE_PROJECT_ID || ''
            });
        }

        // Convenience helper: register the webhook with Telegram.
        // Visit:  https://<worker>/set-webhook?url=https://<worker>/webhook
        // (and ensure TELEGRAM_WEBHOOK_SECRET is set as a secret).
        if (request.method === 'GET' && url.pathname === '/set-webhook') {
            return handleSetWebhook(request, env);
        }

        if (url.pathname === '/webhook') {
            if (request.method === 'GET')  return jsonResponse(env, request, { ok: true, hint: 'POST only — Telegram sends updates here' });
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

/* ── Webhook setup helper ──────────────────────────────────── */
async function handleSetWebhook(request, env) {
    if (!env.TELEGRAM_BOT_TOKEN) {
        return jsonResponse(env, request, { error: 'TELEGRAM_BOT_TOKEN not configured' }, 503);
    }
    const url = new URL(request.url);
    const target = url.searchParams.get('url') || (url.origin + '/webhook');
    if (!/^https:\/\//.test(target)) {
        return jsonResponse(env, request, { error: 'webhook url must be https://' }, 400);
    }
    const body = {
        url: target,
        allowed_updates: ['message'],
        drop_pending_updates: false
    };
    if (env.TELEGRAM_WEBHOOK_SECRET) {
        body.secret_token = String(env.TELEGRAM_WEBHOOK_SECRET);
    }
    const apiUrl = TELEGRAM_API + '/bot' + env.TELEGRAM_BOT_TOKEN + '/setWebhook';
    let res;
    try {
        res = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
    } catch (err) {
        return jsonResponse(env, request, { error: 'telegram request failed: ' + (err.message || err) }, 502);
    }
    const json = await res.json().catch(() => ({}));
    return jsonResponse(env, request, {
        ok: res.ok && !!json.ok,
        registeredUrl: target,
        usedSecretHeader: !!env.TELEGRAM_WEBHOOK_SECRET,
        telegram: json
    }, res.ok ? 200 : 502);
}

/* ── Inbound: admin replies on Telegram ─────────────────────── */
async function handleWebhookEvent(request, env) {
    // Optional secret-token check. Telegram echoes the value we set
    // in setWebhook back as a header on every update — if it doesn't
    // match, we know someone else is posting to our webhook URL.
    if (env.TELEGRAM_WEBHOOK_SECRET) {
        const got = request.headers.get('x-telegram-bot-api-secret-token') || '';
        if (got !== String(env.TELEGRAM_WEBHOOK_SECRET)) {
            console.warn('[telegram-bridge] secret token mismatch');
            return new Response('bad secret', { status: 401 });
        }
    }

    let body;
    try { body = await request.json(); }
    catch (_) { return new Response('bad json', { status: 400 }); }

    const msg = body && body.message;
    if (!msg || !msg.text) {
        // Could be edited_message, callback_query, etc. — ignore.
        return new Response('ok', { status: 200 });
    }

    const chatId = msg.chat && msg.chat.id;
    const fromId = msg.from && msg.from.id;
    const fromName = ((msg.from && (msg.from.first_name || msg.from.username)) || 'Admin');
    const text = String(msg.text || '').trim();
    // Diagnostic: log every inbound message so wrangler tail surfaces the
    // chat-id even if the welcome reply fails. Trim text to 80 chars to
    // keep logs compact.
    console.log('[telegram-bridge] inbound:', JSON.stringify({
        chatId: chatId,
        fromId: fromId,
        fromName: fromName,
        textPreview: text.slice(0, 80),
        textLen: text.length
    }));
    if (!text || !chatId) return new Response('ok', { status: 200 });

    // ── Bot-friendly commands ─────────────────────────────────
    // /start                              → quick "you're connected" reply
    // /chatid                             → echo the current chat_id (so admin
    //                                         can copy it into Settings)
    // /reply <sessionId> <text…>          → route to a specific session
    // /help                               → show commands
    // anything else                       → treated as reply to the latest
    //                                         active session (Phase 1 default)
    let targetSessionId = null;
    let replyText = text;

    if (/^\/start\b/i.test(text)) {
        await tgSendMessage(env, chatId,
            '🟢 Bharat Transport & Tourism — Telegram bridge is connected.\n\n' +
            'Your Telegram chat-id is: <b>' + chatId + '</b>\n' +
            'Open Dashboard → Settings → Telegram Bridge and paste this id, or use /chatid anytime to read it back.\n\n' +
            'When customers chat on the website, you will get a digest message here.\n' +
            'Reply to that digest (or just type a message) and the customer will receive your text in their browser within ~1 second.\n\n' +
            'Commands:\n' +
            '/chatid    – show your chat-id\n' +
            '/reply <sessionId> <text> – reply to a specific session\n' +
            '/help      – this help'
        );
        return new Response('ok', { status: 200 });
    }
    if (/^\/chatid\b/i.test(text)) {
        await tgSendMessage(env, chatId, 'Chat-id: <b>' + chatId + '</b>');
        return new Response('ok', { status: 200 });
    }
    if (/^\/help\b/i.test(text)) {
        await tgSendMessage(env, chatId,
            'Commands:\n' +
            '/start     – connect / re-show welcome\n' +
            '/chatid    – show your chat-id\n' +
            '/reply <sessionId> <text> – reply to a specific session\n' +
            'Anything else → routed to the latest active customer.'
        );
        return new Response('ok', { status: 200 });
    }

    // /reply <sessionId> <text...>
    const replyMatch = text.match(/^\/reply\s+(\S+)\s+([\s\S]+)$/i);
    if (replyMatch) {
        targetSessionId = String(replyMatch[1]).trim();
        replyText = String(replyMatch[2]).trim();
    }

    // If the admin replied to our digest message, the original digest's
    // session id is in the quoted text. Pull it out so multi-customer
    // conversations stay properly routed.
    if (!targetSessionId && msg.reply_to_message && msg.reply_to_message.text) {
        const m = String(msg.reply_to_message.text).match(/session:\s*([A-Za-z0-9_-]+)/i);
        if (m && m[1]) targetSessionId = m[1];
    }

    try {
        await routeAdminReply(env, chatId, fromId, fromName, replyText, targetSessionId);
    } catch (err) {
        console.error('[telegram-bridge] route reply failed:', err);
        // Tell the admin what went wrong so the message isn't silently lost.
        try {
            await tgSendMessage(env, chatId,
                '⚠️ Could not deliver to the customer: ' + (err.message || err) +
                '\nTry again, or use /reply <sessionId> <text> with a specific session.'
            );
        } catch (_) {}
    }
    return new Response('ok', { status: 200 });
}

async function routeAdminReply(env, tgChatId, tgFromId, tgFromName, text, explicitSessionId) {
    const token = await getFirestoreAccessToken(env);

    let sessionId = explicitSessionId;
    if (!sessionId) {
        const session = await firestoreQueryLatestActiveSession(env, token);
        if (!session) throw new Error('no active chat session waiting for a reply');
        sessionId = session.id;
    }

    await firestoreAddDoc(env, token,
        ['chats', sessionId, 'messages'].join('/'),
        {
            role:        'admin',
            text:        text,
            senderName:  'Andaman Voyages Team',
            senderTelegramId: String(tgFromId || ''),
            via:         'telegram',
            createdAt:   new Date()
        }
    );
    await firestoreSetDoc(env, token, ['chats', sessionId].join('/'), {
        lastMessage:      text.slice(0, 280),
        lastMessageAt:    new Date(),
        lastMessageBy:    'admin',
        unreadByAdmin:    false,
        unreadByCustomer: true
    });

    // Confirm to the admin that we routed it.
    try {
        await tgSendMessage(env, tgChatId, '✅ Sent to customer (session ' + sessionId + ').');
    } catch (_) {}

    console.log('[telegram-bridge] routed admin reply to session', sessionId);
}

/* ── Outbound: customer sent a chat message ─────────────────── */
async function handleNotify(request, env) {
    let body;
    try { body = await request.json(); }
    catch (_) { return jsonResponse(env, request, { error: 'bad json' }, 400); }

    const sessionId = String(body.sessionId || '').trim();
    const preview   = String(body.preview   || '').slice(0, 1000);
    if (!sessionId) return jsonResponse(env, request, { error: 'sessionId required' }, 400);
    if (!env.TELEGRAM_BOT_TOKEN) return jsonResponse(env, request, { error: 'TELEGRAM_BOT_TOKEN not configured' }, 503);

    // Pull /settings/site to read telegramBridgeChatId + the on/off
    // toggle. Same pattern as the WhatsApp bridge — admin manages
    // the public side via Dashboard → Settings.
    let settings = null;
    try {
        const t = await getFirestoreAccessToken(env);
        settings = await firestoreGetDoc(env, t, 'settings', 'site');
    } catch (err) {
        return jsonResponse(env, request, { error: 'settings read failed: ' + (err.message || err) }, 500);
    }
    if (!settings || !settings.telegramBridgeEnabled) {
        return jsonResponse(env, request, { error: 'bridge disabled in /settings/site' }, 503);
    }
    const adminChatId = String(settings.telegramBridgeChatId || '').trim();
    if (!adminChatId) {
        return jsonResponse(env, request, { error: 'telegramBridgeChatId not configured in /settings/site' }, 503);
    }

    // Enrich the message with parent-chat metadata (customer name + email).
    // We keep the access-token from the settings read above to avoid a
    // second OAuth round-trip — getFirestoreAccessToken caches anyway, but
    // belt and braces.
    let parent = null;
    let token = null;
    try {
        token = await getFirestoreAccessToken(env);
        parent = await firestoreGetDoc(env, token, 'chats', sessionId);
    } catch (_) {}
    const customerName  = (parent && parent.customerName)  || '';
    const customerEmail = (parent && parent.customerEmail) || '';
    const customerLabel = customerName ? customerName + (customerEmail ? ' (' + customerEmail + ')' : '')
                       : (customerEmail || 'a website visitor');
    const customerPage  = (parent && parent.page)        || '';

    // Conversation-thread heuristic: if we've sent a digest for this
    // session before and stored its Telegram message-id on the parent
    // /chats doc, send the new digest as a reply_to_message of the first
    // one. Telegram then visually threads them in the bot chat — admin
    // sees a clean per-customer conversation instead of a mixed feed.
    //
    // The first digest of a session uses a richer "intro" header
    // (customer name + email + first-page URL); follow-up messages from
    // the same customer use a compact body. Both end with the
    // <code>session: ...</code> marker so /reply auto-detection in the
    // /webhook handler keeps working when the admin uses any message in
    // the thread as the reply target.
    const priorDigestId =
        parent && parent.telegramDigestMessageId
            ? Number(parent.telegramDigestMessageId)
            : 0;

    let text;
    if (priorDigestId) {
        // Follow-up message — compact body, threaded under the original.
        text =
            '<i>"' + escapeHtml(preview) + '"</i>\n' +
            '<code>session: ' + escapeHtml(sessionId) + '</code>';
    } else {
        // First contact — full intro card with customer details.
        const subParts = [];
        if (customerEmail) subParts.push('📧 ' + escapeHtml(customerEmail));
        if (customerPage)  subParts.push('📄 ' + escapeHtml(customerPage.slice(0, 60)));
        const subLine = subParts.length ? subParts.join('  ·  ') + '\n\n' : '';
        text =
            '💬 <b>New chat from ' + escapeHtml(customerName || customerEmail || 'a website visitor') + '</b>\n' +
            subLine +
            '<i>"' + escapeHtml(preview) + '"</i>\n\n' +
            '↩ Reply to this message and it will go straight to the customer.\n' +
            '<code>session: ' + escapeHtml(sessionId) + '</code>';
    }

    let res;
    try {
        res = await tgSendMessage(env, adminChatId, text, priorDigestId);
    } catch (err) {
        return jsonResponse(env, request, { error: 'telegram request failed: ' + (err.message || err) }, 502);
    }
    if (!res.ok) {
        // If the prior message was deleted from the bot chat, Telegram
        // returns 'message to be replied not found' — retry without the
        // reply target so the admin still gets the digest.
        if (priorDigestId && res.body && res.body.description &&
            /reply.*not found/i.test(res.body.description)) {
            try {
                res = await tgSendMessage(env, adminChatId, text, 0);
            } catch (_) {}
        }
        if (!res.ok) {
            return jsonResponse(env, request, {
                error: 'telegram rejected: ' + (res.status || ''),
                detail: res.body
            }, 502);
        }
    }

    // Store the FIRST digest's message-id on the parent /chats doc so
    // future digests for the same session can reply_to it. Best-effort —
    // if Firestore write fails the bridge keeps working, just without
    // the threading on the next message.
    const sentMessageId = (res.body && res.body.result && res.body.result.message_id) || null;
    if (sentMessageId && !priorDigestId && token) {
        try {
            await firestoreSetDoc(env, token, ['chats', sessionId].join('/'), {
                telegramDigestMessageId: Number(sentMessageId)
            });
        } catch (_) {}
    }

    return jsonResponse(env, request, {
        ok: true,
        messageId: sentMessageId,
        threaded: !!priorDigestId
    });
}

/* ── Telegram sendMessage helper ──────────────────────────────
 * Optional 4th arg `replyToMessageId`: when truthy, the new message is
 * sent as a reply to that message-id, which makes Telegram visually
 * thread it in the bot chat. We use this in handleNotify() so all
 * digests for the same /chats session group under the original
 * "💬 New chat from <name>" intro card. */
async function tgSendMessage(env, chatId, text, replyToMessageId) {
    if (!env.TELEGRAM_BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN not configured');
    const url = TELEGRAM_API + '/bot' + env.TELEGRAM_BOT_TOKEN + '/sendMessage';
    const payload = {
        chat_id: chatId,
        text: text,
        parse_mode: 'HTML',
        disable_web_page_preview: true
    };
    if (replyToMessageId && Number(replyToMessageId) > 0) {
        payload.reply_parameters = {
            message_id: Number(replyToMessageId),
            allow_sending_without_reply: true
        };
    }
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    let json = null;
    try { json = await res.json(); } catch (_) {}
    return { ok: res.ok && (json && json.ok), status: res.status, body: json };
}

/* Tiny HTML escaper for the parse_mode='HTML' sendMessage payload. */
function escapeHtml(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
