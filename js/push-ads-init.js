/* ── push-ads-init.js ─────────────────────────────────────────────
 * Registers /sw.js (the third-party push-notification ad-network
 * service worker) on every public page that includes this script.
 *
 * What this does:
 *   1. Calls navigator.serviceWorker.register('/sw.js') so the browser
 *      installs and activates the worker.
 *   2. Once registered, the worker delegates to the ad network's
 *      script (3nbf4.com / zoneId 11068987) which then handles the
 *      push-permission prompt + subscription + ad delivery.
 *
 * What this does NOT do:
 *   • Modify, restrict, or filter what the ad network sends.
 *   • Run on admin / booking / checkout pages — those pages don't
 *     load this script (intentional — keeps the booking funnel
 *     ad-free for converting customers).
 *
 * SAFETY GUARDS — register() is skipped (and any previously-installed
 *   /sw.js is actively UNREGISTERED) when ANY of these is true:
 *
 *   1. Browser doesn't support service workers (old browser, webview).
 *   2. Page is on plain HTTP (service workers require HTTPS, except
 *      on localhost where we keep dev workflow intact).
 *   3. Page is inside an iframe (ad slots / Razorpay overlay don't
 *      need their own copy of the SW).
 *   4. The current visitor is an ADMIN or STAFF user (signed in via
 *      js/firebase-config.js → window.ADMIN_EMAILS / STAFF_EMAILS,
 *      OR `currentUser.role === 'admin'|'staff'`). Admins shouldn't
 *      see ad-network notifications and shouldn't pollute the
 *      network's analytics either.
 *   5. The site-wide setting `pushAdsEnabled` is FALSE in the
 *      Firestore /settings/site doc (admin can flip this from
 *      Dashboard → Settings without redeploying — see
 *      js/dashboard.js → "Push Ads" toggle).
 *   6. The visitor turned it off on this device — either:
 *        • localStorage.disable_push_ads === '1', or
 *        • URL contains ?push_ads=off (sets the localStorage flag
 *          and unregisters the worker, then strips the param).
 *
 * Public API (window.PushAds) for testing / admin tooling:
 *   • PushAds.enable()       — clears the local kill switch.
 *   • PushAds.disable()      — sets the local kill switch + unregisters.
 *   • PushAds.unregister()   — forcibly tears down /sw.js (no flag set).
 *   • PushAds.status()       — returns {supported, registered, killed}.
 *
 * ⚠️ Operational risks documented in ezoic_ads_setup.md and sw.js
 * — the user opted-in to "full integration; accept the risks".
 * ──────────────────────────────────────────────────────────────── */
(function () {
    'use strict';

    var KILL_KEY       = 'disable_push_ads';
    var REGISTERED_KEY = '__pushAdsSwRegistered';
    var SW_PATH        = '/sw.js';

    // Companion tag-script: in-page push / banner format from the same
    // ad network as /sw.js. Loading it adds a second monetisation surface
    // alongside the push-notification opt-in. Same kill switches apply
    // (admin/staff auto-skip + Firestore pushAdsEnabled + per-device flag).
    var TAG_SCRIPT_SRC = 'https://quge5.com/88/tag.min.js';
    var TAG_SCRIPT_ZONE = '243859';
    var TAG_SCRIPT_ID = '__pushAdsTagScript';   // dedupe sentinel

    function dlog() {
        if (window.console && console.debug) {
            try { console.debug.apply(console, ['[push-ads]'].concat([].slice.call(arguments))); }
            catch (_) {}
        }
    }

    /* ── 0. Honour ?push_ads=off / ?push_ads=on query params ─── */
    // The flag is consumed (URL is cleaned via history.replaceState)
    // so users don't accidentally share the kill switch with friends.
    (function consumeQueryFlag() {
        try {
            var params = new URLSearchParams(location.search);
            var v = (params.get('push_ads') || '').toLowerCase();
            if (!v) return;
            if (v === 'off' || v === '0' || v === 'false' || v === 'no') {
                try { localStorage.setItem(KILL_KEY, '1'); } catch (_) {}
                dlog('?push_ads=off → kill switch SET on this device');
            } else if (v === 'on' || v === '1' || v === 'true' || v === 'yes') {
                try { localStorage.removeItem(KILL_KEY); } catch (_) {}
                dlog('?push_ads=on → kill switch CLEARED on this device');
            }
            params.delete('push_ads');
            var qs = params.toString();
            history.replaceState(null, '',
                location.pathname + (qs ? ('?' + qs) : '') + location.hash);
        } catch (_) {}
    })();

    /* ── helpers ───────────────────────────────────────────────── */

    function localKillSwitchOn() {
        try { return localStorage.getItem(KILL_KEY) === '1'; }
        catch (_) { return false; }
    }

    function isAdminOrStaff() {
        try {
            var raw = localStorage.getItem('currentUser');
            if (!raw) return false;
            var u = JSON.parse(raw);
            if (!u) return false;
            // Role flag (set by Firebase Auth login flow).
            var role = String(u.role || '').toLowerCase();
            if (role === 'admin' || role === 'staff') return true;
            // Email match against the global allow-lists (firebase-config.js).
            var email = String(u.email || '').toLowerCase();
            if (!email) return false;
            var admins = (window.ADMIN_EMAILS || []).map(function (e) {
                return String(e).toLowerCase();
            });
            var staff  = (window.STAFF_EMAILS || []).map(function (e) {
                return String(e).toLowerCase();
            });
            if (admins.indexOf(email) >= 0) return true;
            if (staff.indexOf(email) >= 0) return true;
            return false;
        } catch (_) {
            return false;
        }
    }

    // Site-wide kill switch from Firestore /settings/site → pushAdsEnabled.
    // Returns a Promise<boolean> — true means "ads ARE enabled site-wide".
    // Falls through to true (ads on) if SettingsStore isn't available, so
    // a Firestore outage doesn't accidentally turn ads off everywhere.
    function siteWideEnabled() {
        return new Promise(function (resolve) {
            try {
                if (!window.SettingsStore || typeof window.SettingsStore.load !== 'function') {
                    return resolve(true);
                }
                window.SettingsStore.load().then(function (s) {
                    // Default: enabled (matches the user's "full integration" decision).
                    resolve(!s || s.pushAdsEnabled !== false);
                }).catch(function () {
                    resolve(true);
                });
            } catch (_) { resolve(true); }
        });
    }

    function alreadyRegisteredFlag() {
        try { return sessionStorage.getItem(REGISTERED_KEY) === '1'; }
        catch (_) { return false; }
    }
    function markRegistered() {
        try { sessionStorage.setItem(REGISTERED_KEY, '1'); } catch (_) {}
    }
    function clearRegisteredFlag() {
        try { sessionStorage.removeItem(REGISTERED_KEY); } catch (_) {}
    }

    function unregisterSw() {
        clearRegisteredFlag();
        // Pair the SW unregister with the tag-script removal — both come
        // from the same network and should be torn down together.
        removeTagScript();
        if (!('serviceWorker' in navigator)) return Promise.resolve(false);
        return navigator.serviceWorker.getRegistrations()
            .then(function (regs) {
                var killed = 0;
                var work = regs.map(function (r) {
                    var url = (r.active && r.active.scriptURL) ||
                              (r.installing && r.installing.scriptURL) ||
                              (r.waiting && r.waiting.scriptURL) || '';
                    // Only kill OUR SW; never touch a future first-party PWA worker.
                    if (url && url.indexOf(SW_PATH) >= 0) {
                        killed++;
                        return r.unregister().catch(function () {});
                    }
                    return null;
                }).filter(Boolean);
                return Promise.all(work).then(function () {
                    if (killed > 0) dlog('unregistered', killed, 'push-ads service worker(s)');
                    return killed > 0;
                });
            })
            .catch(function () { return false; });
    }

    function register() {
        if (alreadyRegisteredFlag()) return;
        try {
            // scope: '/' so the worker can deliver notifications across
            // the whole site. The ad network expects this — narrowing
            // scope would break delivery the moment the user navigates.
            navigator.serviceWorker.register(SW_PATH, { scope: '/' })
                .then(function (reg) {
                    markRegistered();
                    dlog('service worker registered:', reg && reg.scope);
                })
                .catch(function (err) {
                    if (window.console && console.warn) {
                        console.warn('[push-ads] service worker registration failed:', err && err.message);
                    }
                });
        } catch (err) {
            if (window.console && console.warn) {
                console.warn('[push-ads] register() threw:', err && err.message);
            }
        }

        // Also inject the in-page tag script (zone 243859) — second
        // monetisation surface from the same network. We append it
        // dynamically (instead of putting it in the HTML) so the kill
        // switches above are guaranteed to apply BEFORE it loads.
        injectTagScript();
    }

    // Inject the third-party tag.min.js exactly once per page. Idempotent —
    // re-calling does nothing if the script is already on the page (or if
    // we previously removed it via removeTagScript()).
    function injectTagScript() {
        if (document.getElementById(TAG_SCRIPT_ID)) {
            dlog('tag script already injected');
            return;
        }
        try {
            var s = document.createElement('script');
            s.id = TAG_SCRIPT_ID;
            s.src = TAG_SCRIPT_SRC;
            s.async = true;
            s.setAttribute('data-zone', TAG_SCRIPT_ZONE);
            // data-cfasync="false" stops Cloudflare's Rocket Loader
            // from rewriting + delaying the script. Documented by
            // Cloudflare; matches the snippet the ad network ships.
            s.setAttribute('data-cfasync', 'false');
            (document.head || document.documentElement).appendChild(s);
            dlog('tag script injected (zone ' + TAG_SCRIPT_ZONE + ')');
        } catch (err) {
            if (window.console && console.warn) {
                console.warn('[push-ads] tag script injection failed:', err && err.message);
            }
        }
    }

    // Tear down the in-page tag script (best-effort — once the third-party
    // code has executed it may have stamped its own iframes / event
    // listeners that we can't clean up without a page reload). We can,
    // however, prevent it from re-loading on subsequent SPA-style
    // navigations by removing the <script> tag.
    function removeTagScript() {
        var el = document.getElementById(TAG_SCRIPT_ID);
        if (el && el.parentNode) {
            el.parentNode.removeChild(el);
            dlog('tag script element removed (already-loaded ad iframes may persist until reload)');
        }
    }

    /* ── pre-flight gates (fast, synchronous) ─────────────────── */
    if (!('serviceWorker' in navigator)) {
        dlog('skip: service workers not supported');
        return;
    }
    var proto = (location.protocol || '').toLowerCase();
    var host  = (location.hostname || '').toLowerCase();
    var isLocal = host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local');
    if (proto !== 'https:' && !isLocal) {
        dlog('skip: not HTTPS');
        return;
    }
    if (window.top !== window.self) {
        dlog('skip: inside iframe');
        return;
    }

    /* ── public API for testing / admin / dashboard tooling ───── */
    window.PushAds = {
        // Set the local kill switch + tear down the worker on this device.
        // The next page-load will see the kill switch and skip register().
        disable: function () {
            try { localStorage.setItem(KILL_KEY, '1'); } catch (_) {}
            return unregisterSw();
        },
        // Clear the local kill switch. Worker will re-register on next load.
        enable: function () {
            try { localStorage.removeItem(KILL_KEY); } catch (_) {}
            dlog('local kill switch CLEARED — worker will register on next load');
            return Promise.resolve(true);
        },
        // Tear down the worker WITHOUT setting the kill switch — useful when
        // diagnosing or hot-swapping the SW file.
        unregister: function () {
            return unregisterSw();
        },
        // Quick status snapshot for the console / dashboard.
        status: function () {
            return navigator.serviceWorker.getRegistrations()
                .then(function (regs) {
                    var ours = regs.filter(function (r) {
                        var u = (r.active && r.active.scriptURL) || '';
                        return u.indexOf(SW_PATH) >= 0;
                    });
                    return {
                        supported:  true,
                        registered: ours.length > 0,
                        scope:      ours.length ? ours[0].scope : null,
                        killed:     localKillSwitchOn(),
                        adminOrStaff: isAdminOrStaff()
                    };
                })
                .catch(function () {
                    return { supported: true, registered: false, killed: localKillSwitchOn(),
                             adminOrStaff: isAdminOrStaff(), error: true };
                });
        }
    };

    /* ── decision time ────────────────────────────────────────── */

    // Decide whether to register the worker, OR to actively
    // unregister any previously-installed copy. We always honour the
    // kill conditions even on a returning visitor — that way an admin
    // who flips the global toggle off in the dashboard sees their
    // existing browsers stop receiving push ads on the next page-load.
    function decide() {
        // Local kill switch wins immediately — no async I/O needed.
        if (localKillSwitchOn()) {
            dlog('skip: local kill switch ON (localStorage.disable_push_ads=1)');
            unregisterSw();
            return;
        }
        // Admin / staff user → never register, and unregister any
        // SW that was installed on the same device when the user was
        // a regular visitor (e.g., before they logged in).
        if (isAdminOrStaff()) {
            dlog('skip: admin/staff user — unregistering any existing push-ads SW');
            unregisterSw();
            return;
        }
        // Site-wide toggle (Firestore /settings/site → pushAdsEnabled).
        // Async — but the page is already loaded by now so the small
        // delay doesn't matter for performance.
        siteWideEnabled().then(function (on) {
            if (!on) {
                dlog('skip: site-wide pushAdsEnabled is FALSE — unregistering');
                unregisterSw();
                return;
            }
            register();
        });
    }

    /* ── 1.5-sec defer so we run AFTER all critical render assets ─ */
    if (document.readyState === 'complete') {
        setTimeout(decide, 1500);
    } else {
        window.addEventListener('load', function () {
            setTimeout(decide, 1500);
        }, { once: true });
    }
})();
