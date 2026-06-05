/* ── auth.js — Firebase ID-token verification & admin gate ────── */

export class HttpError extends Error {
    constructor(status, message) { super(message); this.status = status; }
}

export function corsHeaders(env, request) {
    const origin = request.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
    const allowOrigin = allowed.includes(origin) ? origin : (allowed[0] || '*');
    return {
        'Access-Control-Allow-Origin': allowOrigin,
        'Vary': 'Origin',
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400'
    };
}
export function jsonResponse(env, request, body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(env, request) }
    });
}

export async function requireAdmin(request, env) {
    const auth = request.headers.get('Authorization') || '';
    const m = /^Bearer\s+(.+)$/i.exec(auth);
    if (!m) throw new HttpError(401, 'Missing Authorization header');
    let claims;
    try { claims = await verifyFirebaseIdToken(m[1].trim(), env.FIREBASE_PROJECT_ID); }
    catch (err) { throw new HttpError(401, 'Auth failed: ' + (err.message || 'unknown')); }
    const callerEmail = String(claims.email || '').toLowerCase();
    const adminList = (env.ADMIN_EMAILS || '').split(',')
        .map(s => s.trim().toLowerCase()).filter(Boolean);
    if (!adminList.includes(callerEmail)) {
        throw new HttpError(403, 'Not an admin: ' + callerEmail);
    }
    return claims;
}

const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
let _jwksCache = null, _jwksCachedAt = 0;
const JWKS_TTL_MS = 60 * 60 * 1000;
async function getJwks(forceRefresh) {
    if (!forceRefresh && _jwksCache && (Date.now() - _jwksCachedAt) < JWKS_TTL_MS) {
        return _jwksCache;
    }
    const res = await fetch(JWKS_URL);
    if (!res.ok) throw new Error('JWKS fetch failed: ' + res.status);
    _jwksCache = await res.json();
    _jwksCachedAt = Date.now();
    return _jwksCache;
}
function b64UrlToString(input) {
    input = input.replace(/-/g, '+').replace(/_/g, '/');
    while (input.length % 4) input += '=';
    return atob(input);
}
function b64UrlToBytes(input) {
    const bin = b64UrlToString(input);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    return buf;
}

async function verifyFirebaseIdToken(idToken, projectId) {
    if (!projectId) throw new Error('FIREBASE_PROJECT_ID not configured');
    const parts = idToken.split('.');
    if (parts.length !== 3) throw new Error('Malformed JWT');
    const [h64, p64, s64] = parts;
    const header = JSON.parse(b64UrlToString(h64));
    const payload = JSON.parse(b64UrlToString(p64));
    if (header.alg !== 'RS256') throw new Error('Unsupported alg ' + header.alg);
    if (!header.kid) throw new Error('Missing kid');
    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.exp !== 'number' || payload.exp <= now) throw new Error('Token expired');
    if (typeof payload.iat !== 'number' || payload.iat > now + 60) throw new Error('Token issued in the future');
    if (payload.aud !== projectId) throw new Error('Wrong audience: ' + payload.aud);
    if (payload.iss !== 'https://securetoken.google.com/' + projectId) throw new Error('Wrong issuer: ' + payload.iss);
    if (!payload.sub) throw new Error('Missing sub');
    let jwks = await getJwks(false);
    let jwk = (jwks.keys || []).find(k => k.kid === header.kid);
    if (!jwk) { jwks = await getJwks(true); jwk = (jwks.keys || []).find(k => k.kid === header.kid); }
    if (!jwk) throw new Error('Unknown kid ' + header.kid);
    const key = await crypto.subtle.importKey('jwk', jwk,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify({ name: 'RSASSA-PKCS1-v1_5' },
        key, b64UrlToBytes(s64),
        new TextEncoder().encode(h64 + '.' + p64));
    if (!ok) throw new Error('Bad signature');
    return payload;
}