/* ── firestore.js — minimal Firestore REST helper ────────────────
 * Cloudflare Workers can't import the Firebase Admin SDK (it's
 * Node-only and ~3 MB). Instead we mint our own OAuth2 access token
 * from the service-account key, then call the Firestore REST API
 * directly. The token is cached in module scope so successive emails
 * within the same isolate reuse it.
 * ──────────────────────────────────────────────────────────────── */

import { importPkcs8PrivateKey, signJwt } from './lib.js';

let _cachedToken = null;          // { token, exp (epoch sec) }
const TOKEN_BUFFER_SEC = 60;      // refresh 60 s before real expiry

/* Returns a bearer access-token string with the firestore-data scope. */
export async function getFirestoreAccessToken(env) {
    const now = Math.floor(Date.now() / 1000);
    if (_cachedToken && _cachedToken.exp - TOKEN_BUFFER_SEC > now) {
        return _cachedToken.token;
    }
    if (!env.FIREBASE_SERVICE_ACCOUNT_KEY) {
        throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY secret not set');
    }

    let sa;
    try { sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_KEY); }
    catch (err) { throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY is not valid JSON: ' + err.message); }
    if (!sa.client_email || !sa.private_key) {
        throw new Error('Service-account JSON missing client_email or private_key');
    }

    const key = await importPkcs8PrivateKey(sa.private_key);
    const iat = now;
    const exp = now + 3600;
    const jwt = await signJwt(
        { alg: 'RS256', typ: 'JWT' },
        {
            iss: sa.client_email,
            scope: 'https://www.googleapis.com/auth/datastore',
            aud: 'https://oauth2.googleapis.com/token',
            iat, exp
        },
        key
    );

    const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=' + jwt
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.access_token) {
        throw new Error('OAuth token exchange failed: ' + res.status + ' ' + JSON.stringify(json));
    }

    _cachedToken = { token: json.access_token, exp };
    return json.access_token;
}

/* ── Firestore typed-value encoder ───────────────────────────────
 * Firestore REST takes typed values: { stringValue, integerValue, ...}.
 * We support the limited set we need for receivedEmails docs.
 * Null / undefined fields are dropped to keep docs compact. */
function toFirestoreValue(v) {
    if (v === null || v === undefined)        return { nullValue: null };
    if (typeof v === 'string')                return { stringValue: v };
    if (typeof v === 'boolean')               return { booleanValue: v };
    if (typeof v === 'number') {
        if (Number.isInteger(v))              return { integerValue: String(v) };
        return { doubleValue: v };
    }
    if (v instanceof Date) {
        return { timestampValue: v.toISOString() };
    }
    if (Array.isArray(v)) {
        return { arrayValue: { values: v.map(toFirestoreValue) } };
    }
    if (typeof v === 'object') {
        const fields = {};
        for (const k of Object.keys(v)) {
            if (v[k] !== undefined) fields[k] = toFirestoreValue(v[k]);
        }
        return { mapValue: { fields } };
    }
    return { stringValue: String(v) };
}

function fieldsFromObject(obj) {
    const fields = {};
    for (const k of Object.keys(obj || {})) {
        if (obj[k] === undefined) continue;
        fields[k] = toFirestoreValue(obj[k]);
    }
    return fields;
}

/* Idempotent create: POST to /<collection>?documentId=<docId>.
 *
 * Firestore's `createDocument` REST endpoint already rejects with 409
 * ALREADY_EXISTS when a doc with the same ID already exists, so we
 * don't need any extra precondition headers. (The `currentDocument`
 * precondition is only valid on the `patch` / `delete` endpoints.)
 *
 * Returns true if the doc was created, false if it already existed
 * (Cloudflare may retry on transient errors and SHA-256(Message-ID)
 * keeps the doc ID stable across retries). Anything else throws. */
export async function firestoreCreateIfMissing(env, token, collection, docId, data) {
    const projectId = env.FIREBASE_PROJECT_ID;
    if (!projectId) throw new Error('FIREBASE_PROJECT_ID not configured');

    const url = 'https://firestore.googleapis.com/v1/projects/' + projectId +
        '/databases/(default)/documents/' + encodeURIComponent(collection) +
        '?documentId=' + encodeURIComponent(docId);

    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': 'Bearer ' + token,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ fields: fieldsFromObject(data) })
    });

    if (res.ok) return true;

    const txt = await res.text().catch(() => '');
    if (res.status === 409 || /already exists/i.test(txt)) return false;
    throw new Error('Firestore create failed: ' + res.status + ' ' + txt);
}

/* ── Firestore typed-value DECODER ───────────────────────────────
 * Inverse of toFirestoreValue. Used when this Worker needs to READ
 * a doc (e.g. /settings/inboxAutoReply) to pick up live template
 * settings the admin edited from the dashboard. */
function fromFirestoreValue(v) {
    if (!v || typeof v !== 'object') return null;
    if ('nullValue'    in v) return null;
    if ('stringValue'  in v) return v.stringValue;
    if ('booleanValue' in v) return v.booleanValue;
    if ('integerValue' in v) return Number(v.integerValue);
    if ('doubleValue'  in v) return Number(v.doubleValue);
    if ('timestampValue' in v) return v.timestampValue;
    if ('arrayValue'   in v) {
        const arr = (v.arrayValue && v.arrayValue.values) || [];
        return arr.map(fromFirestoreValue);
    }
    if ('mapValue' in v) {
        return fieldsToObject((v.mapValue && v.mapValue.fields) || {});
    }
    return null;
}
function fieldsToObject(fields) {
    const out = {};
    for (const k of Object.keys(fields || {})) {
        out[k] = fromFirestoreValue(fields[k]);
    }
    return out;
}

/* POST /<collection> — Firestore auto-generates the doc ID.
 * Used to append append-only log records (e.g. /sentEmails) where we
 * don't care about the ID. Returns the auto-generated docId on success. */
export async function firestoreAddDoc(env, token, collection, data) {
    const projectId = env.FIREBASE_PROJECT_ID;
    if (!projectId) throw new Error('FIREBASE_PROJECT_ID not configured');

    const url = 'https://firestore.googleapis.com/v1/projects/' + projectId +
        '/databases/(default)/documents/' + encodeURIComponent(collection);

    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': 'Bearer ' + token,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ fields: fieldsFromObject(data) })
    });

    if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error('Firestore addDoc failed: ' + res.status + ' ' + txt);
    }
    const json = await res.json().catch(() => ({}));
    // Firestore returns the full resource name; pull the trailing ID.
    const name = String(json.name || '');
    const id = name.split('/').pop() || '';
    return id;
}

/* GET /<collection>/<docId> — returns the doc data, or null if it
 * doesn't exist yet. Used by the auto-reply path to pick up the live
 * /settings/inboxAutoReply template the admin set in the dashboard. */
export async function firestoreGetDoc(env, token, collection, docId) {
    const projectId = env.FIREBASE_PROJECT_ID;
    if (!projectId) throw new Error('FIREBASE_PROJECT_ID not configured');

    const url = 'https://firestore.googleapis.com/v1/projects/' + projectId +
        '/databases/(default)/documents/' + encodeURIComponent(collection) +
        '/' + encodeURIComponent(docId);

    const res = await fetch(url, {
        method: 'GET',
        headers: {
            'Authorization': 'Bearer ' + token,
            'Accept': 'application/json'
        }
    });

    if (res.status === 404) return null;
    if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error('Firestore get failed: ' + res.status + ' ' + txt);
    }
    const json = await res.json().catch(() => ({}));
    return fieldsToObject(json.fields || {});
}
