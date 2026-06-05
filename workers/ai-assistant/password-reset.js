// password-reset.js
// Generate a Firebase password-reset link via Identity Toolkit and email
// it via Brevo from a verified andamanvoyages.in sender so it lands in
// the inbox (not spam — Firebase's default sender domain is rejected).

import { getFirestoreAccessToken } from './firestore.js';
import { sendBrevoEmail }          from './brevo.js';

const _ipHits = new Map();
const RATE_WINDOW_MS = 60000;
const RATE_MAX_HITS  = 5;

function ipAllowed(ip) {
    if (!ip) return true;
    const now = Date.now();
    const arr = (_ipHits.get(ip) || []).filter(t => now - t < RATE_WINDOW_MS);
    if (arr.length >= RATE_MAX_HITS) { _ipHits.set(ip, arr); return false; }
    arr.push(now); _ipHits.set(ip, arr);
    return true;
}

export async function handlePasswordReset(request, env, corsFn) {
    const headers = corsFn(env, request);
    let body;
    try { body = await request.json(); }
    catch (e) { return jsonR({ error: 'invalid json' }, 400, headers); }

    const email = String(body.email || '').trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return jsonR({ error: 'invalid email' }, 400, headers);
    }
    const ip = request.headers.get('CF-Connecting-IP') || '';
    if (!ipAllowed(ip)) return jsonR({ error: 'rate limited' }, 429, headers);

    try { await sendResetIfExists(env, email); }
    catch (err) { console.error('password-reset failed for', email, err && err.stack || err); }
    return jsonR({ ok: true }, 200, headers);
}

function jsonR(obj, status, headers) {
    return new Response(JSON.stringify(obj), {
        status,
        headers: Object.assign({ 'Content-Type': 'application/json' }, headers)
    });
}

async function sendResetIfExists(env, email) {
    const fsToken = await getFirestoreAccessToken(env);
    if (!(await firestoreEmailExists(env, fsToken, email))) {
        console.log('password-reset: no account for', email);
        return;
    }
    const link = await generatePasswordResetLink(env, email);
    await sendBrevoEmail(env, {
        to: email,
        subject: 'Reset your Andaman Voyages password',
        html: buildHtml(email, link),
        text: buildText(email, link),
        fromEmail: 'noreply@andamanvoyages.in',
        fromName:  'Andaman Voyages'
    });
}

async function firestoreEmailExists(env, token, email) {
    const url = 'https://firestore.googleapis.com/v1/projects/' +
        env.FIREBASE_PROJECT_ID + '/databases/(default)/documents:runQuery';
    const sq = {
        from: [{ collectionId: 'usernames' }],
        where: { fieldFilter: {
            field: { fieldPath: 'email' },
            op: 'EQUAL',
            value: { stringValue: email }
        } },
        limit: 1
    };
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ structuredQuery: sq })
    });
    if (!res.ok) return true;
    const arr = await res.json().catch(() => []);
    return Array.isArray(arr) && arr.some(r => r && r.document);
}

async function generatePasswordResetLink(env, email) {
    const token = await getIdentityToolkitAccessToken(env);
    const url = 'https://identitytoolkit.googleapis.com/v1/projects/' +
        env.FIREBASE_PROJECT_ID + '/accounts:sendOobCode';
    const continueUrl = (env.PASSWORD_RESET_CONTINUE_URL || 'https://andamanvoyages.in/?reset=1').trim();
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestType: 'PASSWORD_RESET', email, returnOobLink: true, continueUrl })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.oobLink) {
        throw new Error('sendOobCode failed: ' + res.status + ' ' + JSON.stringify(data));
    }
    return data.oobLink;
}

let _itTokenCache = null;
async function getIdentityToolkitAccessToken(env) {
    const now = Math.floor(Date.now() / 1000);
    if (_itTokenCache && _itTokenCache.exp - 60 > now) return _itTokenCache.token;
    if (!env.FIREBASE_SERVICE_ACCOUNT_KEY) throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY not set');
    const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_KEY);
    const key = await importPkcs8(sa.private_key);
    const exp = now + 3600;
    const head = b64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const payload = b64Url(JSON.stringify({
        iss: sa.client_email,
        scope: 'https://www.googleapis.com/auth/cloud-platform',
        aud: 'https://oauth2.googleapis.com/token',
        iat: now, exp
    }));
    const sig = await crypto.subtle.sign({ name: 'RSASSA-PKCS1-v1_5' }, key,
        new TextEncoder().encode(head + '.' + payload));
    const jwt = head + '.' + payload + '.' + b64UrlBytes(new Uint8Array(sig));
    const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=' + jwt
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.access_token) throw new Error('OAuth failed: ' + res.status + ' ' + JSON.stringify(j));
    _itTokenCache = { token: j.access_token, exp };
    return j.access_token;
}

function b64Url(s) { return b64UrlBytes(new TextEncoder().encode(s)); }
function b64UrlBytes(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function importPkcs8(pem) {
    const cleaned = String(pem || '')
        .replace(/-----BEGIN [^-]+-----/g, '')
        .replace(/-----END [^-]+-----/g, '')
        .replace(/\s+/g, '');
    const bin = atob(cleaned);
    const der = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) der[i] = bin.charCodeAt(i);
    return crypto.subtle.importKey('pkcs8', der,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
}

function buildHtml(email, link) {
    const e = esc(email), l = esc(link);
    return '<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#f0f4f7;padding:24px;color:#1c2b48;">' +
        '<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 6px 20px rgba(8,30,42,.08);">' +
        '<div style="background:linear-gradient(135deg,#0d7a8a,#16a085);color:#fff;padding:22px 28px;">' +
        '<div style="font-size:13px;letter-spacing:.14em;text-transform:uppercase;opacity:.85;">Andaman Voyages</div>' +
        '<h1 style="margin:.3rem 0 0;font-size:22px;">Reset your password</h1>' +
        '</div>' +
        '<div style="padding:24px 28px;line-height:1.55;font-size:15px;">' +
        '<p>Hello,</p>' +
        '<p>We received a request to reset the password for your Andaman Voyages account: <strong>' + e + '</strong>.</p>' +
        '<p>Click the button below to set a new password. This link expires in 1 hour for security.</p>' +
        '<p style="text-align:center;margin:1.6rem 0;">' +
        '<a href="' + l + '" style="background:#0d7a8a;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;display:inline-block;">Reset password</a>' +
        '</p>' +
        '<p style="font-size:13px;color:#666;">Or copy and paste this link:<br><a href="' + l + '" style="color:#0d7a8a;word-break:break-all;">' + l + '</a></p>' +
        '<hr style="margin:1.6rem 0;border:0;border-top:1px solid #eee;">' +
        '<p style="font-size:13px;color:#888;">If you did not request a password reset, you can safely ignore this email.</p>' +
        '<p style="font-size:13px;color:#888;">Need help? Write to <a href="mailto:booking@andamanvoyages.in" style="color:#0d7a8a;">booking@andamanvoyages.in</a>.</p>' +
        '<p style="margin-top:1.4rem;">Warm regards,<br><strong>Team Andaman Voyages</strong></p>' +
        '</div>' +
        '<div style="padding:14px 28px;background:#0d2b3a;color:#cdd9e0;font-size:12px;text-align:center;">Andaman Voyages - Port Blair - andamanvoyages.in</div>' +
        '</div></div>';
}

function buildText(email, link) {
    return 'Hello,\n\nWe received a request to reset the password for your Andaman Voyages account: ' + email + '.\n\n' +
        'Click the link below to set a new password (expires in 1 hour):\n' + link + '\n\n' +
        'If you did not request a password reset, you can safely ignore this email.\n\n' +
        'Need help? Write to booking@andamanvoyages.in\n\n' +
        'Warm regards,\nTeam Andaman Voyages\nandamanvoyages.in\n';
}