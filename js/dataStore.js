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
    const JSONBIN_BIN_ID = 'REPLACE_WITH_YOUR_BIN_ID';
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

    // Public: dashboard publish.
    // Returns a promise that resolves on success, rejects with Error on failure.
    function getKey() {
        let key = localStorage.getItem(KEY_STORAGE) || '';
        if (!key) {
            key = prompt(
                'To publish package changes globally, paste your jsonbin.io Master Key.\n\n' +
                'Get it from: https://jsonbin.io/app/api-keys (starts with "$2a$10$…").\n\n' +
                'The key is stored only in this browser (localStorage key "jsonbinKey").'
            );
            if (key && key.trim()) {
                localStorage.setItem(KEY_STORAGE, key.trim());
            }
            return key ? key.trim() : '';
        }
        return key;
    }

    function clearKey() {
        localStorage.removeItem(KEY_STORAGE);
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