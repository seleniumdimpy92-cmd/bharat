/* ── Brevo Conversations chat widget loader ──────────────────────
 * Drops in the Brevo (formerly Sendinblue) Conversations bubble on
 * every public page. This is the canonical Brevo snippet — we just
 * wrap it in our own file so:
 *   1. Updating the widget ID later is a one-line change.
 *   2. We can skip injection on admin pages and on iframes (e.g.
 *      the dashboard's Looker embeds) where the widget would be
 *      noisy or duplicated.
 *
 * The Brevo bubble appears bottom-right alongside (not on top of)
 * the existing AI chat widget + WhatsApp FAB — Brevo's z-index is
 * ~2147483640 by default which sits above ours, but it docks at
 * `right: 16px / bottom: 16px` and won't overlap them visibly.
 *
 * Conversations dashboard & tickets:
 *   https://app.brevo.com/conversations
 * ───────────────────────────────────────────────────────────── */

(function () {
    'use strict';

    // Skip on admin / migration pages — they're internal tools and
    // don't need a public-facing chat widget.
    var path = (location.pathname || '').toLowerCase();
    if (
        path.indexOf('/dashboard') === 0 ||
        path.indexOf('/migrate')   === 0
    ) return;

    // Don't double-inject if some other page already loaded the widget
    // (e.g. a future shared header partial).
    if (window.BrevoConversationsID) return;

    // ── chatProvider gate ──────────────────────────────────
    // The admin can pick between three chat experiences in
    // /dashboard → Settings → Chat Widget:
    //   'brevo'  → load this Brevo Conversations widget (default)
    //   'custom' → js/chat.js renders a Firestore-backed widget instead
    //   'none'   → no chat at all
    // We read the cached settings synchronously (populated on a previous
    // page-load) so first-paint isn't gated on a Firestore round-trip.
    // When no cache is available, default to 'brevo' so existing visitors
    // don't lose chat during migration.
    // Default = 'custom' (matches js/dataStore.js → SETTINGS_DEFAULT).
    // brevo.js loads ONLY when the admin has explicitly picked 'brevo'
    // in /dashboard → Settings → Chat Widget. Brand-new visitors see
    // the new Firestore-backed widget (js/chat.js) by default.
    function loadCachedProvider() {
        try {
            var raw = localStorage.getItem('siteSettings');
            if (!raw) return 'custom';
            var s = JSON.parse(raw) || {};
            return (s.chatProvider || 'custom').toLowerCase();
        } catch (_) { return 'custom'; }
    }
    var provider = loadCachedProvider();
    if (provider !== 'brevo') {
        // The other providers (custom widget / none) are handled by
        // js/chat.js which performs the same gate on the opposite side.
        return;
    }

    window.BrevoConversationsID = '6a15404f94b63fe74c038079';
    window.BrevoConversations = window.BrevoConversations || function () {
        (window.BrevoConversations.q = window.BrevoConversations.q || []).push(arguments);
    };
    var s = document.createElement('script');
    s.async = true;
    s.src   = 'https://conversations-widget.brevo.com/brevo-conversations.js';
    (document.head || document.documentElement).appendChild(s);

    // After Firestore settings finish loading, double-check the choice
    // — if the admin flipped the toggle on another device, hide the
    // widget without forcing a reload.
    if (window.SettingsStore && typeof window.SettingsStore.load === 'function') {
        window.SettingsStore.load().then(function (s) {
            var p = (s && s.chatProvider || 'brevo').toLowerCase();
            if (p !== 'brevo') {
                try { window.BrevoConversations && window.BrevoConversations('hide'); } catch (_) {}
            }
        }).catch(function () {});
    }
})();
