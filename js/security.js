/* Anti-snoop / security hardening (deterrent layer, dynamic toggle)
 *
 * Behaviour:
 *   • Always shows the console scam-warning text (cheap to do, useful).
 *   • DevTools/right-click/keyboard restrictions are applied ONLY when
 *     BOTH of these are true:
 *       1) site setting consoleLockEnabled === true  (admin-toggleable
 *          from the dashboard, stored in Firestore /settings/site)
 *       2) the current user is NOT an admin
 *
 *   So: admins ALWAYS have full DevTools access. The admin can also
 *   disable the lock entirely for everyone via the dashboard switch.
 *
 *   Real security stays in Firestore rules, Firebase Auth, and Razorpay
 *   merchant settlement — this file is just a UX deterrent.
 */
(function () {
    'use strict';

    // 1) Always-on console scam warning (Facebook / Gmail style)
    try {
        var bigStyle = 'color:#fff;background:#e74c3c;font-size:24px;font-weight:bold;padding:8px 16px;border-radius:4px;';
        var subStyle = 'color:#e74c3c;font-size:14px;';
        console.log('%c\u26A0  STOP!', bigStyle);
        console.log('%cThis is a developer console. If someone told you to paste code here to "unlock" something, they are trying to steal your account or payment details.\n\nNever paste code from strangers.\nFor support, call +91 88801 95191 or email booking@andamanvoyages.in', subStyle);
    } catch (e) {}

    // ── Helpers to inspect site settings + admin status ──
    var ADMIN_EMAILS = (Array.isArray(window.ADMIN_EMAILS) && window.ADMIN_EMAILS.length)
        ? window.ADMIN_EMAILS.map(function (e) { return String(e).toLowerCase(); })
        : [String(window.ADMIN_EMAIL || 'deb@andamanvoyages.in').toLowerCase()];

    function currentUserIsAdmin() {
        // 1) Live Firebase Auth (most reliable)
        try {
            if (window.__authInstance && window.__authInstance.currentUser) {
                var em = (window.__authInstance.currentUser.email || '').toLowerCase();
                if (em && ADMIN_EMAILS.indexOf(em) >= 0) return true;
            }
        } catch (e) {}
        // 2) Fall back to the cached profile (auth.js writes this on login)
        try {
            var cu = JSON.parse(localStorage.getItem('currentUser') || 'null');
            if (cu) {
                var em2 = (cu.email || '').toLowerCase();
                if (em2 && ADMIN_EMAILS.indexOf(em2) >= 0) return true;
                if (cu.role === 'admin') return true;
            }
        } catch (e) {}
        return false;
    }

    function getLockSetting() {
        // Defaults to true so the lock is applied even before settings load.
        try {
            var s = JSON.parse(localStorage.getItem('siteSettings') || 'null');
            if (s && s.consoleLockEnabled === false) return false;
        } catch (e) {}
        return true;
    }

    // ── Decide whether to apply the lock ──
    var locked = false;
    function shouldLock() {
        return getLockSetting() && !currentUserIsAdmin();
    }

    // Handlers we attach so we can DETACH them when the admin toggles off
    function onContextMenu(e) {
        var t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
        e.preventDefault();
    }
    function onKeyDown(e) {
        var key = (e.key || '').toLowerCase();
        if (e.key === 'F12') { e.preventDefault(); return; }
        if ((e.ctrlKey || e.metaKey) && key === 'u') { e.preventDefault(); return; }
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && (key === 'i' || key === 'j' || key === 'c')) {
            e.preventDefault(); return;
        }
        if ((e.ctrlKey || e.metaKey) && key === 's') {
            var t = e.target;
            if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
            e.preventDefault();
        }
    }

    function applyLock() {
        if (locked) return;
        document.addEventListener('contextmenu', onContextMenu);
        document.addEventListener('keydown', onKeyDown);
        locked = true;
        try { console.debug('[security] console lock ON (non-admin viewer)'); } catch (e) {}
    }
    function releaseLock() {
        if (!locked) return;
        document.removeEventListener('contextmenu', onContextMenu);
        document.removeEventListener('keydown', onKeyDown);
        locked = false;
        try { console.debug('[security] console lock OFF (admin or setting disabled)'); } catch (e) {}
    }

    function evaluate() {
        if (shouldLock()) applyLock();
        else releaseLock();
    }

    // Run an initial evaluation immediately. We will re-evaluate after Firebase
    // settles so admins coming in via cached creds also get unlocked.
    evaluate();

    // Re-check when Firebase auth state changes (login/logout)
    if (window.__firebaseReady && typeof window.__firebaseReady.then === 'function') {
        window.__firebaseReady.then(function (fb) {
            if (fb && fb.firebaseAuth && fb.firebaseAuth.onAuthStateChanged) {
                fb.firebaseAuth.onAuthStateChanged(fb.auth, function () {
                    evaluate();
                });
            }
        }).catch(function () {});
    }

    // Re-check whenever settings are reloaded / changed via SettingsStore
    function watchSettingsStore() {
        if (window.SettingsStore && typeof window.SettingsStore.load === 'function') {
            window.SettingsStore.load().then(function () { evaluate(); }).catch(function () {});
            // Wrap save() to re-evaluate after admin toggles a setting locally
            var origSave = window.SettingsStore.save;
            if (origSave && !window.SettingsStore.__lockWrapped) {
                window.SettingsStore.save = function (patch) {
                    return origSave(patch).then(function (r) { evaluate(); return r; });
                };
                window.SettingsStore.__lockWrapped = true;
            }
            return;
        }
        // Wait for SettingsStore to load
        setTimeout(watchSettingsStore, 200);
    }
    watchSettingsStore();

    // Re-check when localStorage updates from another tab (e.g. admin toggled in another tab)
    window.addEventListener('storage', function (e) {
        if (e.key === 'siteSettings' || e.key === 'currentUser') evaluate();
    });

    // Soft DevTools-detection (only when locked) — emits a warning, not a block
    var lastWarn = 0;
    setInterval(function () {
        if (!locked) return;
        var diffH = window.outerHeight - window.innerHeight;
        var diffW = window.outerWidth - window.innerWidth;
        if ((diffH > 200 || diffW > 200) && Date.now() - lastWarn > 60000) {
            lastWarn = Date.now();
            try {
                console.log('%cDeveloper tools detected. For security, please close them while using this site.', 'color:#e74c3c;font-size:14px;');
            } catch (e) {}
        }
    }, 1500);

    // Expose a tiny debug helper so admins can manually re-check from the console
    window.__securityCheck = evaluate;
})();