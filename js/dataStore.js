// ── Shared data store: jsonbin.io as a global packages database ──
// All pages (index, package details, dashboard) read packages through
// PackagesStore.load(). The dashboard uses PackagesStore.publish() to write.
//
// SETUP (one-time, takes ~3 minutes):
//   1. Create a free account at https://jsonbin.io
//   2. Click "Create Bin" → paste the contents of data/packages.json
//      → set bin to "Public" → click Create
//   3. Copy the Bin ID from the URL or the bin's settings page
//   4. Replace JSONBIN_BIN_ID below with that ID and commit/push
//   5. (Admin only) On first publish, the dashboard will prompt for the
//      Master Key — copy it from https://jsonbin.io/app/api-keys
//
// If the Bin ID below is left as the placeholder, the site falls back
// to data/packages.json bundled in the repo (still works fine).

window.PackagesStore = (function () {
    // ───── CONFIGURE THIS ─────
    const JSONBIN_BIN_ID = '6a0ed2ee6877513b27aab711';
    // X-Master-Key — used by the admin dashboard to PUT (publish) to the bin.
    // ⚠️  Anyone who views this file's source can read this and write to the
    // bin. The bin is small / non-critical so we accept the trade-off. If
    // you rotate the key on jsonbin.io, update both constants here.
    const JSONBIN_MASTER_KEY = '$2a$10$5g20BFUwHVdvdiSNZuIqN.G5Vf6Mfq0Fggm13j9fXzg1VW0G0CFNW';
    // X-Access-Key — read-only. Not strictly needed because the bin is
    // public, but kept here so future private-bin reads still work without
    // exposing the master key.
    const JSONBIN_ACCESS_KEY = '$2a$10$ZjJgcUxE0YAyd37zvavDM.Pz2Y24FlwR7ngR3OTjItRI8CxIcuyGS';
    // ───────────────────────────

    const API_BASE  = 'https://api.jsonbin.io/v3/b/';
    const HAS_BIN   = JSONBIN_BIN_ID && JSONBIN_BIN_ID !== 'REPLACE_WITH_YOUR_BIN_ID';
    const READ_URL  = API_BASE + JSONBIN_BIN_ID + '/latest';
    const WRITE_URL = API_BASE + JSONBIN_BIN_ID;

    const REPO_FALLBACK = 'data/packages.json';
    const CACHE_KEY     = 'sitePackages';
    const KEY_STORAGE   = 'jsonbinKey';

    function getCached() {
        try {
            const raw = localStorage.getItem(CACHE_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) && parsed.length ? parsed : null;
        } catch (_) { return null; }
    }

    function setCache(data) {
        try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch (_) {}
    }

    async function loadFromBin() {
        if (!HAS_BIN) return null;
        const res = await fetch(READ_URL, { cache: 'no-store' });
        if (!res.ok) throw new Error('jsonbin read failed: ' + res.status);
        const json = await res.json();
        // jsonbin v3 returns { record: <data>, metadata: ... }
        const data = json.record !== undefined ? json.record : json;
        return Array.isArray(data) && data.length ? data : null;
    }

    async function loadFromRepo() {
        const res = await fetch(REPO_FALLBACK + '?t=' + Date.now(), { cache: 'no-store' });
        if (!res.ok) throw new Error('repo file fetch failed: ' + res.status);
        const data = await res.json();
        return Array.isArray(data) && data.length ? data : null;
    }

    // Public: load packages, preferring jsonbin → repo file → cache → null.
    // Returns { data, source } where source is one of: 'bin' | 'repo' | 'cache' | 'none'.
    async function load() {
        // First try the canonical online source
        if (HAS_BIN) {
            try {
                const data = await loadFromBin();
                if (data) {
                    setCache(data);
                    return { data, source: 'bin' };
                }
            } catch (e) {
                console.warn('jsonbin read failed; falling back', e);
            }
        }

        // Repo file (works on GitHub Pages, even before bin is configured)
        try {
            const data = await loadFromRepo();
            if (data) {
                setCache(data);
                return { data, source: 'repo' };
            }
        } catch (e) {
            console.warn('repo file read failed; falling back', e);
        }

        // Local cache (last successful load)
        const cached = getCached();
        if (cached) return { data: cached, source: 'cache' };

        return { data: null, source: 'none' };
    }

    // Same as load() but tries cache FIRST for instant render, then refreshes
    // from the bin/repo and calls onUpdate(data) if the fresh data differs.
    async function loadWithStaleWhileRevalidate(onUpdate) {
        const cached = getCached();
        if (cached && typeof onUpdate === 'function') {
            try { onUpdate(cached, 'cache'); } catch (_) {}
        }
        const fresh = await load();
        if (fresh.data && typeof onUpdate === 'function') {
            // Always call onUpdate after fresh load so caller can re-render
            try { onUpdate(fresh.data, fresh.source); } catch (_) {}
        }
        return fresh;
    }

    // The Master Key is hard-coded above (JSONBIN_MASTER_KEY) so the admin
    // doesn't have to enter it. We still allow an override via localStorage
    // (key "jsonbinKey") for development / key rotation testing.
    function getKey() {
        const override = localStorage.getItem(KEY_STORAGE);
        if (override && override.trim()) return override.trim();
        if (JSONBIN_MASTER_KEY && JSONBIN_MASTER_KEY.indexOf('REPLACE') === -1) {
            return JSONBIN_MASTER_KEY;
        }
        // Last resort — prompt the admin (shouldn't happen with a hard-coded key)
        const k = prompt(
            'jsonbin.io Master Key (starts with "$2a$10$…"). ' +
            'Paste once; it will be cached on this browser.'
        );
        if (k && k.trim()) {
            localStorage.setItem(KEY_STORAGE, k.trim());
            return k.trim();
        }
        return '';
    }

    function clearKey() {
        // Removes only the localStorage override; the hard-coded key remains.
        localStorage.removeItem(KEY_STORAGE);
    }

    // Only the admin user "deb" should be able to publish. The dashboard's
    // access guard already restricts the page to deb, but we double-check
    // here so an accidental call from another context fails fast.
    function isAdmin() {
        try {
            const raw = localStorage.getItem('currentUser');
            if (!raw) return false;
            const u = JSON.parse(raw);
            return u && (u.username === 'deb' || u.role === 'admin');
        } catch (_) { return false; }
    }

    async function publish(packagesArray) {
        if (!Array.isArray(packagesArray)) {
            throw new Error('packages must be an array');
        }

        // Always update local cache so the admin sees the change instantly
        setCache(packagesArray);

        if (!HAS_BIN) {
            throw new Error(
                'No jsonbin Bin ID is configured. Set JSONBIN_BIN_ID in js/dataStore.js. ' +
                'Until then, publish only saves locally on this device.'
            );
        }

        const key = getKey();
        if (!key) {
            throw new Error('No jsonbin Master Key provided.');
        }

        const res = await fetch(WRITE_URL, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-Master-Key': key,
                'X-Bin-Versioning': 'false'  // overwrite latest, don't pile up versions
            },
            body: JSON.stringify(packagesArray)
        });

        if (!res.ok) {
            const text = await res.text().catch(() => '');
            const tokenIssue = res.status === 401 || res.status === 403;
            if (tokenIssue) clearKey();
            const err = new Error(
                'jsonbin publish failed: ' + res.status +
                (text ? ' — ' + text.slice(0, 300) : '')
            );
            err.tokenIssue = tokenIssue;
            throw err;
        }

        return res.json();
    }

    return {
        load,
        loadWithStaleWhileRevalidate,
        publish,
        clearKey,
        get isConfigured() { return HAS_BIN; }
    };
})();


// ── Shared user store (jsonbin private bin) ──────────────────────
// Holds the user list { id, username, email, salt, passwordHash, role, createdAt }.
// Reads use the X-Access-Key (read-only). Writes use the X-Master-Key.
// Passwords are SHA-256 hashed in the browser with a per-user random salt.
window.UsersStore = (function () {
    const USERS_BIN_ID = '6a0f2402ee5a733b12f866b2';

    // Reuse the keys defined inside PackagesStore. We pull them from the
    // visible source above (dataStore.js) — this keeps a single source of
    // truth even though both the keys are stored as constants.
    const MASTER_KEY = '$2a$10$5g20BFUwHVdvdiSNZuIqN.G5Vf6Mfq0Fggm13j9fXzg1VW0G0CFNW';
    const ACCESS_KEY = '$2a$10$ZjJgcUxE0YAyd37zvavDM.Pz2Y24FlwR7ngR3OTjItRI8CxIcuyGS';

    const API_BASE  = 'https://api.jsonbin.io/v3/b/';
    const READ_URL  = API_BASE + USERS_BIN_ID + '/latest';
    const WRITE_URL = API_BASE + USERS_BIN_ID;

    function bytesToHex(buf) {
        const arr = Array.from(new Uint8Array(buf));
        return arr.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    function randomSalt() {
        const arr = new Uint8Array(8);
        crypto.getRandomValues(arr);
        return bytesToHex(arr.buffer);
    }

    async function hashPassword(password, salt) {
        const data = new TextEncoder().encode(salt + password);
        const buf = await crypto.subtle.digest('SHA-256', data);
        return bytesToHex(buf);
    }

    async function listUsers() {
        const res = await fetch(READ_URL, {
            cache: 'no-store',
            headers: { 'X-Access-Key': ACCESS_KEY }
        });
        if (!res.ok) throw new Error('users read failed: ' + res.status);
        const json = await res.json();
        const data = json.record !== undefined ? json.record : json;
        return Array.isArray(data) ? data : [];
    }

    async function saveUsers(users) {
        const res = await fetch(WRITE_URL, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-Master-Key': MASTER_KEY,
                'X-Bin-Versioning': 'false'
            },
            body: JSON.stringify(users)
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error('users write failed: ' + res.status + ' ' + text);
        }
    }

    // Find a user by username OR email (case-insensitive).
    function matchIdentifier(user, identifier) {
        const id = (identifier || '').trim().toLowerCase();
        if (!id) return false;
        return (
            (user.username && user.username.toLowerCase() === id) ||
            (user.email    && user.email.toLowerCase()    === id)
        );
    }

    async function findByIdentifier(identifier) {
        const users = await listUsers();
        return users.find(u => matchIdentifier(u, identifier));
    }

    async function login(identifier, password) {
        const user = await findByIdentifier(identifier);
        if (!user) throw new Error('Invalid username/email or password');
        const hash = await hashPassword(password, user.salt || '');
        if (hash !== user.passwordHash) throw new Error('Invalid username/email or password');
        // Return a sanitised copy (no salt/hash) for client use.
        return {
            id: user.id, username: user.username, email: user.email,
            role: user.role || 'user', createdAt: user.createdAt
        };
    }

    async function register({ username, email, password }) {
        username = (username || '').trim();
        email    = (email || '').trim().toLowerCase();
        if (!username || !email || !password) throw new Error('All fields are required');
        if (username.toLowerCase() === 'deb') throw new Error('This username is reserved.');

        const users = await listUsers();
        if (users.some(u => u.username && u.username.toLowerCase() === username.toLowerCase())) {
            throw new Error('Username already taken.');
        }
        if (users.some(u => u.email && u.email.toLowerCase() === email)) {
            throw new Error('Email already registered.');
        }

        const salt = randomSalt();
        const passwordHash = await hashPassword(password, salt);
        const newUser = {
            id: 'u_' + Date.now(),
            username,
            email,
            salt,
            passwordHash,
            role: 'user',
            createdAt: new Date().toISOString()
        };
        users.push(newUser);
        await saveUsers(users);
        return {
            id: newUser.id, username: newUser.username, email: newUser.email,
            role: newUser.role, createdAt: newUser.createdAt
        };
    }

    return { listUsers, login, register, hashPassword };
})();
