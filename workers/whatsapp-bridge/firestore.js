/* ── firestore.js — minimal Firestore REST helper ────────────────
 * Adapted from workers/email-router/firestore.js. Adds
 * firestoreSetDoc + firestoreQueryLatestActiveSession that this
 * worker needs but email-router doesn't.
 * ──────────────────────────────────────────────────────────────── */

let _cachedToken = null;          // { token, exp (epoch sec) }
const TOKEN_BUFFER_SEC = 60;

/* ──────── OAuth2 token (service-account → Firestore data scope) ── */
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

/* ──────── Typed-value codec ──────── */
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

/* ──────── Public REST helpers ──────── */

/* GET /<collection>/<docId>. Returns the data as a plain object,
 * or null if the doc doesn't exist. */
export async function firestoreGetDoc(env, token, collection, docId) {
    const projectId = env.FIREBASE_PROJECT_ID;
    if (!projectId) throw new Error('FIREBASE_PROJECT_ID not configured');
    const url = 'https://firestore.googleapis.com/v1/projects/' + projectId +
        '/databases/(default)/documents/' + encodeURIComponent(collection) +
        '/' + encodeURIComponent(docId);
    const res = await fetch(url, {
        method: 'GET',
        headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/json' }
    });
    if (res.status === 404) return null;
    if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error('Firestore get failed: ' + res.status + ' ' + txt);
    }
    const json = await res.json().catch(() => ({}));
    return fieldsToObject(json.fields || {});
}

/* PATCH /<path> with merge semantics. `path` can be either
 * "collection/docId" or "collection/docId/sub/docId". Uses the
 * `updateMask` REST trick so unspecified fields are preserved. */
export async function firestoreSetDoc(env, token, path, data) {
    const projectId = env.FIREBASE_PROJECT_ID;
    if (!projectId) throw new Error('FIREBASE_PROJECT_ID not configured');

    const fields = fieldsFromObject(data);
    const fieldNames = Object.keys(fields);
    const mask = fieldNames.map(n => 'updateMask.fieldPaths=' + encodeURIComponent(n)).join('&');

    const url = 'https://firestore.googleapis.com/v1/projects/' + projectId +
        '/databases/(default)/documents/' + path.split('/').map(encodeURIComponent).join('/') +
        '?' + mask;
    const res = await fetch(url, {
        method: 'PATCH',
        headers: {
            'Authorization': 'Bearer ' + token,
            'Content-Type':  'application/json'
        },
        body: JSON.stringify({ fields })
    });
    if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error('Firestore set failed: ' + res.status + ' ' + txt);
    }
    const json = await res.json().catch(() => ({}));
    return fieldsToObject(json.fields || {});
}

/* POST /<path> — Firestore auto-generates the doc ID.
 * `path` is the collection-or-subcollection path, e.g.
 * "chats/{sessionId}/messages". Returns the new docId. */
export async function firestoreAddDoc(env, token, path, data) {
    const projectId = env.FIREBASE_PROJECT_ID;
    if (!projectId) throw new Error('FIREBASE_PROJECT_ID not configured');
    const url = 'https://firestore.googleapis.com/v1/projects/' + projectId +
        '/databases/(default)/documents/' + path.split('/').map(encodeURIComponent).join('/');
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': 'Bearer ' + token,
            'Content-Type':  'application/json'
        },
        body: JSON.stringify({ fields: fieldsFromObject(data) })
    });
    if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error('Firestore addDoc failed: ' + res.status + ' ' + txt);
    }
    const json = await res.json().catch(() => ({}));
    const name = String(json.name || '');
    return name.split('/').pop() || '';
}

/* runQuery → most-recent /chats doc with unreadByAdmin === true.
 * Used to route an admin's WhatsApp reply back to the customer
 * who's currently waiting for a response. */
export async function firestoreQueryLatestActiveSession(env, token) {
    const projectId = env.FIREBASE_PROJECT_ID;
    if (!projectId) throw new Error('FIREBASE_PROJECT_ID not configured');
    const url = 'https://firestore.googleapis.com/v1/projects/' + projectId +
        '/databases/(default)/documents:runQuery';
    const body = {
        structuredQuery: {
            from:  [{ collectionId: 'chats' }],
            where: {
                fieldFilter: {
                    field:  { fieldPath: 'unreadByAdmin' },
                    op:     'EQUAL',
                    value:  { booleanValue: true }
                }
            },
            orderBy: [
                { field: { fieldPath: 'lastMessageAt' }, direction: 'DESCENDING' }
            ],
            limit: 1
        }
    };
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': 'Bearer ' + token,
            'Content-Type':  'application/json'
        },
        body: JSON.stringify(body)
    });
    if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error('Firestore query failed: ' + res.status + ' ' + txt);
    }
    const arr = await res.json().catch(() => []);
    if (!Array.isArray(arr)) return null;
    for (const row of arr) {
        if (!row || !row.document) continue;
        const name = String(row.document.name || '');
        const id   = name.split('/').pop();
        if (!id) continue;
        return { id, data: fieldsToObject(row.document.fields || {}) };
    }
    return null;
}

/* ───────── PEM → CryptoKey + JWT signer ───────── */
function base64UrlEncode(str) {
    return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function base64UrlEncodeBytes(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return base64UrlEncode(bin);
}
async function importPkcs8PrivateKey(pem) {
    const body = String(pem || '')
        .replace(/-----BEGIN [^-]+-----/, '')
        .replace(/-----END [^-]+-----/, '')
        .replace(/\s+/g, '');
    if (!body) throw new Error('empty private key PEM');
    const bin = atob(body);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    return crypto.subtle.importKey(
        'pkcs8',
        buf.buffer,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['sign']
    );
}

async function signJwt(header, payload, key) {
    const enc = new TextEncoder();
    const headerStr  = base64UrlEncode(JSON.stringify(header));
    const payloadStr = base64UrlEncode(JSON.stringify(payload));
    const data = enc.encode(headerStr + '.' + payloadStr);
    const sig = await crypto.subtle.sign({ name: 'RSASSA-PKCS1-v1_5' }, key, data);
    return headerStr + '.' + payloadStr + '.' + base64UrlEncodeBytes(new Uint8Array(sig));
}
