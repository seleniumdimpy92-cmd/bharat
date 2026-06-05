/* ── Razorpay Refund Worker ────────────────────────────────────────
 * POST /refund  → initiates a refund on a Razorpay payment.
 * GET  /        → health check.
 *
 * Why a Worker (and not browser → Razorpay)?
 *   • The Razorpay key SECRET grants full refund/capture/payouts access
 *     to your account. It MUST never reach the browser. Living in
 *     Worker secrets keeps it server-side only.
 *   • Razorpay's API doesn't allow CORS from arbitrary origins.
 *   • We can audit every refund through Worker logs.
 *
 * Security:
 *   • CORS allow-list (ALLOWED_ORIGIN var).
 *   • Caller must include a Firebase ID token in `Authorization: Bearer …`.
 *     We verify the JWT signature against Google's JWKs and require
 *     the email to be in ADMIN_EMAILS — refunds are admin-only.
 *   • The Razorpay key id + secret live in Worker secrets
 *     (RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET).
 *
 * Request body (JSON):
 *   {
 *     "paymentId":  "pay_XYZ",          // Razorpay payment id
 *     "amount":     1234.50,            // INR (rupees, not paise)
 *     "bookingRef": "AV-1700000000000", // for our records
 *     "reason":     "Customer cancellation",
 *     "speed":      "normal" | "optimum"  // optional, default 'normal'
 *   }
 *
 * Response (200 on success):
 *   {
 *     "ok":           true,
 *     "refundId":     "rfnd_ABC",
 *     "amount":       1234.50,         // INR
 *     "status":       "processed" | "pending" | "failed",
 *     "speedRequested":"normal",
 *     "speedProcessed":"normal",
 *     "createdAt":    1700000000
 *   }
 *
 * Deploy (one time):
 *     cd workers/refund
 *     npm install
 *     npx wrangler login
 *     npx wrangler secret put RAZORPAY_KEY_ID      # rzp_live_… or rzp_test_…
 *     npx wrangler secret put RAZORPAY_KEY_SECRET  # the matching secret
 *     npx wrangler deploy
 *
 * After deploy, paste the Worker URL into bookings.html / dashboard.html:
 *     window.REFUND_WORKER_URL = 'https://refund.<sub>.workers.dev';
 * ───────────────────────────────────────────────────────────────── */

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: corsHeaders(env, request) });
        }
        if (request.method === 'GET' && url.pathname === '/') {
            return jsonResponse(env, request, { ok: true, service: 'refund' });
        }
        if (request.method === 'POST' && url.pathname === '/refund') {
            return handleRefund(request, env);
        }
        if (request.method === 'GET' && url.pathname.startsWith('/payment-status/')) {
            return handlePaymentStatus(request, env);
        }
        return jsonResponse(env, request, { error: 'Not found' }, 404);
    }
};

function corsHeaders(env, request) {
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

function jsonResponse(env, request, body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            'Content-Type': 'application/json',
            ...corsHeaders(env, request)
        }
    });
}

async function handleRefund(request, env) {
    let body;
    try { body = await request.json(); }
    catch (_) { return jsonResponse(env, request, { error: 'Invalid JSON body' }, 400); }

    // ── 1. Auth: Firebase ID token must belong to an admin ──────
    const auth = request.headers.get('Authorization') || '';
    const m = /^Bearer\s+(.+)$/i.exec(auth);
    if (!m) return jsonResponse(env, request, { error: 'Missing Authorization header' }, 401);
    const idToken = m[1].trim();

    let claims;
    try {
        claims = await verifyFirebaseIdToken(idToken, env.FIREBASE_PROJECT_ID);
    } catch (err) {
        return jsonResponse(env, request, { error: 'Auth failed: ' + (err.message || 'unknown') }, 401);
    }
    const callerEmail = String(claims.email || '').toLowerCase();
    const adminList = (env.ADMIN_EMAILS || '')
        .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    if (!adminList.includes(callerEmail)) {
        return jsonResponse(env, request, { error: 'Not an admin: ' + callerEmail }, 403);
    }

    // ── 2. Validate payload ─────────────────────────────────────
    const paymentId  = String(body.paymentId || '').trim();
    const amountINR  = Number(body.amount);
    const bookingRef = String(body.bookingRef || '').trim();
    const reason     = String(body.reason || 'cancellation').trim().slice(0, 500);
    const speed      = (body.speed === 'optimum') ? 'optimum' : 'normal';

    if (!/^pay_[A-Za-z0-9]+$/.test(paymentId)) {
        return jsonResponse(env, request, { error: 'paymentId must be a Razorpay pay_… id' }, 400);
    }
    if (!Number.isFinite(amountINR) || amountINR <= 0) {
        return jsonResponse(env, request, { error: 'amount (INR) must be a positive number' }, 400);
    }
    if (amountINR > 1000000) {
        // Sanity cap — no single travel refund should exceed ₹10 lakh.
        // Tweak via env.MAX_REFUND_INR if you ever need to.
        const max = Number(env.MAX_REFUND_INR) || 1000000;
        if (amountINR > max) {
            return jsonResponse(env, request, { error: 'amount exceeds MAX_REFUND_INR (' + max + ')' }, 400);
        }
    }
    if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
        return jsonResponse(env, request, { error: 'RAZORPAY_KEY_ID/SECRET not configured' }, 500);
    }

    // ── 3. Call Razorpay refunds API ────────────────────────────
    // https://razorpay.com/docs/api/refunds/create-instant/
    const amountPaise = Math.round(amountINR * 100);
    const basicAuth = btoa(env.RAZORPAY_KEY_ID + ':' + env.RAZORPAY_KEY_SECRET);
    const rpUrl = 'https://api.razorpay.com/v1/payments/' + encodeURIComponent(paymentId) + '/refund';
    const rpBody = {
        amount: amountPaise,
        speed:  speed,
        notes: {
            booking_ref:  bookingRef,
            reason:       reason,
            initiated_by: callerEmail
        }
    };

    let rpRes, rpJson;
    try {
        rpRes = await fetch(rpUrl, {
            method: 'POST',
            headers: {
                'Content-Type':  'application/json',
                'Authorization': 'Basic ' + basicAuth
            },
            body: JSON.stringify(rpBody)
        });
        rpJson = await rpRes.json();
    } catch (err) {
        return jsonResponse(env, request, {
            error: 'Razorpay network error: ' + (err.message || 'unknown')
        }, 502);
    }

    if (!rpRes.ok) {
        const desc = (rpJson && rpJson.error && (rpJson.error.description || rpJson.error.code)) ||
                     ('HTTP ' + rpRes.status);
        return jsonResponse(env, request, {
            error: 'Razorpay rejected refund: ' + desc,
            razorpay: rpJson && rpJson.error ? rpJson.error : null
        }, 502);
    }

    // ── 4. Return refund object ─────────────────────────────────
    return jsonResponse(env, request, {
        ok:             true,
        refundId:       rpJson.id,                                // rfnd_…
        paymentId:      rpJson.payment_id || paymentId,
        amount:         (rpJson.amount || amountPaise) / 100,    // INR
        currency:       rpJson.currency || 'INR',
        status:         rpJson.status || 'pending',              // processed | pending | failed
        speedRequested: rpJson.speed_requested || speed,
        speedProcessed: rpJson.speed_processed || null,
        createdAt:      rpJson.created_at || Math.floor(Date.now() / 1000),
        notes:          rpJson.notes || rpBody.notes,
        bookingRef:     bookingRef,
        initiatedBy:    callerEmail
    });
}

async function handlePaymentStatus(request, env) {
    const url = new URL(request.url);
    const parts = url.pathname.split('/');
    const paymentId = parts[2];

    if (!/^pay_[A-Za-z0-9]+$/.test(paymentId)) {
        return jsonResponse(env, request, { error: 'Invalid paymentId' }, 400);
    }

    if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
        return jsonResponse(env, request, { error: 'Razorpay keys not configured' }, 500);
    }

    const basicAuth = btoa(env.RAZORPAY_KEY_ID + ':' + env.RAZORPAY_KEY_SECRET);
    const rpUrl = 'https://api.razorpay.com/v1/payments/' + encodeURIComponent(paymentId);

    try {
        const rpRes = await fetch(rpUrl, {
            method: 'GET',
            headers: { 'Authorization': 'Basic ' + basicAuth }
        });
        const rpJson = await rpRes.json();

        if (!rpRes.ok) {
            return jsonResponse(env, request, { error: 'Razorpay API error', details: rpJson }, rpRes.status);
        }

        return jsonResponse(env, request, {
            ok: true,
            status: rpJson.status,
            id: rpJson.id,
            amount: rpJson.amount / 100,
            currency: rpJson.currency
        });
    } catch (err) {
        return jsonResponse(env, request, { error: 'Worker error: ' + err.message }, 500);
    }
}

// ── Firebase ID-token verification ──────────────────────────────
// Firebase ID tokens are signed with the keys published at this URL (JWK format).
// We use the JWK variant so the keys can be imported straight into
// WebCrypto (subtle.importKey).
const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
let _jwksCache = null;
let _jwksCachedAt = 0;
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

function base64UrlToString(input) {
    input = input.replace(/-/g, '+').replace(/_/g, '/');
    while (input.length % 4) input += '=';
    return atob(input);
}
function base64UrlToBytes(input) {
    const bin = base64UrlToString(input);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    return buf;
}

async function verifyFirebaseIdToken(idToken, projectId) {
    if (!projectId) throw new Error('FIREBASE_PROJECT_ID not configured');

    const parts = idToken.split('.');
    if (parts.length !== 3) throw new Error('Malformed JWT');
    const [headerB64, payloadB64, sigB64] = parts;

    const header = JSON.parse(base64UrlToString(headerB64));
    const payload = JSON.parse(base64UrlToString(payloadB64));

    if (header.alg !== 'RS256') throw new Error('Unsupported alg ' + header.alg);
    if (!header.kid)            throw new Error('Missing kid');

    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.exp !== 'number' || payload.exp <= now) throw new Error('Token expired');
    if (typeof payload.iat !== 'number' || payload.iat > now + 60) throw new Error('Token issued in the future');
    if (payload.aud !== projectId) throw new Error('Wrong audience: ' + payload.aud);
    if (payload.iss !== 'https://securetoken.google.com/' + projectId) {
        throw new Error('Wrong issuer: ' + payload.iss);
    }
    if (!payload.sub) throw new Error('Missing sub');

    let jwks = await getJwks(false);
    let jwk = (jwks.keys || []).find(k => k.kid === header.kid);
    if (!jwk) {
        jwks = await getJwks(true);
        jwk = (jwks.keys || []).find(k => k.kid === header.kid);
    }
    if (!jwk) throw new Error('Unknown kid ' + header.kid);

    const key = await crypto.subtle.importKey(
        'jwk',
        jwk,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['verify']
    );

    const signedData = new TextEncoder().encode(headerB64 + '.' + payloadB64);
    const signature = base64UrlToBytes(sigB64);

    const ok = await crypto.subtle.verify(
        { name: 'RSASSA-PKCS1-v1_5' },
        key,
        signature,
        signedData
    );
    if (!ok) throw new Error('Bad signature');

    return payload;
}
