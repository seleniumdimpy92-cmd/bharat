/* ── lib.js — small crypto + encoding helpers ────────────────────
 * Shared utilities used by firestore.js (JWT signing) and worker.js
 * (Message-ID hashing, raw-stream → string, base64 decode for MIME).
 *
 * Kept tiny + dependency-free so the bundled Worker stays well under
 * the 1 MB free-tier limit.
 * ──────────────────────────────────────────────────────────────── */

const _enc = new TextEncoder();
const _dec = new TextDecoder();

/* Base64-URL encode raw bytes (Uint8Array | ArrayBuffer) */
export function b64url(bytes) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let s = '';
    for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/* Standard base64 → bytes */
export function b64decode(input) {
    let s = String(input || '').replace(/\s+/g, '');
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    let bin;
    try { bin = atob(s); } catch (_) { return new Uint8Array(); }
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

/* SHA-256 hex digest of a string. Used to derive a Firestore-safe
 * doc ID from the RFC-822 Message-ID header (which can contain `@`,
 * `<`, `>` and other chars that aren't legal in Firestore IDs). */
export async function sha256Hex(str) {
    const buf = await crypto.subtle.digest('SHA-256', _enc.encode(String(str)));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/* Drain message.raw (a ReadableStream) into a JS string, capped at
 * `maxBytes` so a malicious 100 MB email can't OOM the Worker (free
 * tier has 128 MB RAM total). Cloudflare hard-rejects > 25 MB anyway. */
export async function streamToString(stream, maxBytes) {
    const reader = stream.getReader();
    const chunks = [];
    let total = 0;
    const cap = Math.max(1, Number(maxBytes) || 5_000_000);
    while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value) continue;
        total += value.byteLength;
        if (total > cap) {
            chunks.push(value.subarray(0, value.byteLength - (total - cap)));
            try { reader.releaseLock(); } catch (_) {}
            break;
        }
        chunks.push(value);
    }
    let len = 0;
    for (const c of chunks) len += c.byteLength;
    const merged = new Uint8Array(len);
    let off = 0;
    for (const c of chunks) { merged.set(c, off); off += c.byteLength; }
    return _dec.decode(merged);
}

/* PEM-encoded RSA private key (from a Firebase service-account JSON)
 * → WebCrypto key object usable for RS256 signing. */
export async function importPkcs8PrivateKey(pem) {
    const body = String(pem || '')
        .replace(/-----BEGIN [^-]+-----/g, '')
        .replace(/-----END [^-]+-----/g, '')
        .replace(/\s+/g, '');
    const der = b64decode(body);
    return crypto.subtle.importKey(
        'pkcs8',
        der.buffer,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['sign']
    );
}

/* Sign `header.payload` with the imported RSA key and return the full
 * compact-JWS string. */
export async function signJwt(headerObj, payloadObj, key) {
    const header  = b64url(_enc.encode(JSON.stringify(headerObj)));
    const payload = b64url(_enc.encode(JSON.stringify(payloadObj)));
    const data    = _enc.encode(header + '.' + payload);
    const sig     = await crypto.subtle.sign({ name: 'RSASSA-PKCS1-v1_5' }, key, data);
    return header + '.' + payload + '.' + b64url(new Uint8Array(sig));
}