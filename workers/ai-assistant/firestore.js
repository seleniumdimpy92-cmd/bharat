/* ── firestore.js — service-account OAuth + Firestore REST ──── */

let _saTokenCache = null;
const SA_TOKEN_BUFFER_SEC = 60;

export async function getFirestoreAccessToken(env) {
    const now = Math.floor(Date.now() / 1000);
    if (_saTokenCache && _saTokenCache.exp - SA_TOKEN_BUFFER_SEC > now) {
        return _saTokenCache.token;
    }
    if (!env.FIREBASE_SERVICE_ACCOUNT_KEY) {
        throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY secret not set');
    }
    let sa;
    try { sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_KEY); }
    catch (e) { throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY is not valid JSON: ' + e.message); }
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
    _saTokenCache = { token: json.access_token, exp };
    return json.access_token;
}

async function signJwt(header, payload, key) {
    const enc = (obj) => b64UrlEncode(new TextEncoder().encode(JSON.stringify(obj)));
    const head = enc(header);
    const body = enc(payload);
    const sig = await crypto.subtle.sign({ name: 'RSASSA-PKCS1-v1_5' }, key,
        new TextEncoder().encode(head + '.' + body));
    return head + '.' + body + '.' + b64UrlEncode(new Uint8Array(sig));
}
function b64UrlEncode(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function importPkcs8PrivateKey(pem) {
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

/* Run a Firestore structured query (REST). Returns plain JS objects
   already converted from Firestore typed values. */
export async function queryFirestore(env, token, collection, opts) {
    const projectId = env.FIREBASE_PROJECT_ID;
    if (!projectId) throw new Error('FIREBASE_PROJECT_ID not configured');
    opts = opts || {};
    const url = 'https://firestore.googleapis.com/v1/projects/' + projectId +
        '/databases/(default)/documents:runQuery';
    const where = (opts.where || []).map(w => ({
        fieldFilter: {
            field: { fieldPath: w.field },
            op: w.op,
            value: toFirestoreValue(w.value)
        }
    }));
    const sq = {
        from: [{ collectionId: collection }],
        limit: opts.limit || 50
    };
    if (where.length === 1) sq.where = { fieldFilter: where[0].fieldFilter };
    if (where.length > 1) sq.where = { compositeFilter: { op: 'AND', filters: where } };
    if (opts.orderBy) {
        sq.orderBy = [{
            field: { fieldPath: opts.orderBy },
            direction: opts.orderDirection || 'DESCENDING'
        }];
    }

    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': 'Bearer ' + token,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ structuredQuery: sq })
    });
    if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error('Firestore query failed: ' + res.status + ' ' + txt);
    }
    const arr = await res.json();
    const out = [];
    (arr || []).forEach(row => {
        if (!row || !row.document) return;
        const doc = fromFirestoreDoc(row.document);
        out.push(doc);
    });
    return out;
}

function toFirestoreValue(v) {
    if (v === null || v === undefined) return { nullValue: null };
    if (typeof v === 'string')          return { stringValue: v };
    if (typeof v === 'boolean')         return { booleanValue: v };
    if (typeof v === 'number') {
        if (Number.isInteger(v))        return { integerValue: String(v) };
        return { doubleValue: v };
    }
    if (v instanceof Date)              return { timestampValue: v.toISOString() };
    if (Array.isArray(v))               return { arrayValue: { values: v.map(toFirestoreValue) } };
    if (typeof v === 'object') {
        const fields = {};
        for (const k of Object.keys(v)) {
            if (v[k] !== undefined) fields[k] = toFirestoreValue(v[k]);
        }
        return { mapValue: { fields } };
    }
    return { stringValue: String(v) };
}

function fromFirestoreValue(v) {
    if (v == null) return null;
    if ('stringValue'   in v) return v.stringValue;
    if ('booleanValue'  in v) return v.booleanValue;
    if ('integerValue'  in v) return Number(v.integerValue);
    if ('doubleValue'   in v) return v.doubleValue;
    if ('timestampValue'in v) return v.timestampValue;
    if ('nullValue'     in v) return null;
    if ('arrayValue'    in v) return ((v.arrayValue && v.arrayValue.values) || []).map(fromFirestoreValue);
    if ('mapValue'      in v) {
        const o = {};
        const f = (v.mapValue && v.mapValue.fields) || {};
        for (const k of Object.keys(f)) o[k] = fromFirestoreValue(f[k]);
        return o;
    }
    return null;
}
function fromFirestoreDoc(doc) {
    const out = { _id: (doc.name || '').split('/').pop() };
    const f = doc.fields || {};
    for (const k of Object.keys(f)) out[k] = fromFirestoreValue(f[k]);
    return out;
}