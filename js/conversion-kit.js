/* ── Conversion Kit ──────────────────────────────────────────────
 * Settings-driven widgets that lift conversion on every public page.
 *
 * Widgets injected (each gated by a SettingsStore flag):
 *   1. Sticky urgency bar         (top, package.html only)
 *   2. Floating WhatsApp button   (bottom-right, every public page)
 *   3. Exit-intent coupon popup   (every page, once per session)
 *
 * Admin can flip each widget off in Dashboard → Settings →
 * Conversion Boosters. Skipped on /dashboard and /migrate.
 *
 * Styles live in css/conversion-kit.css (loaded separately).
 * ────────────────────────────────────────────────────────────── */

(function () {
    'use strict';

    // Don't run on admin pages.
    var path = (location.pathname || '').toLowerCase();
    if (path.indexOf('/dashboard') === 0 || path.indexOf('/migrate') === 0) return;

    var DEFAULTS = {
        // Red urgency bar + countdown timer disabled per request — felt
        // too pushy / scammy. Can still be re-enabled per-tenant via
        // SettingsStore (admin → conversion kit settings).
        urgencyBarEnabled:        false,
        urgencyBarMessage:        '\uD83D\uDD25 Bookings closing soon \u2014 reserve your seats today',
        whatsappFabEnabled:       true,
        whatsappFabNumber:        '918880195191',
        whatsappFabMessage:       "Hi! I'm interested in an Andaman package — could you share more details?",
        exitIntentCouponEnabled:  true,
        exitIntentCouponCode:     'COMEBACK10',
        exitIntentCouponPercent:  10
    };

    function getSettings() {
        try {
            var cached = (window.SettingsStore && typeof window.SettingsStore.cached === 'function')
                ? window.SettingsStore.cached() : null;
            if (cached) return Object.assign({}, DEFAULTS, cached);
        } catch (_) {}
        return Object.assign({}, DEFAULTS);
    }

    function isPackagePage() {
        return /\/package(\.html)?(?:[?#]|$)/i.test(location.pathname + location.search);
    }

    function pad(n) { return n < 10 ? '0' + n : '' + n; }

    function escapeText(s) {
        return String(s == null ? '' : s).replace(/[<>]/g, '');
    }

    // ── 1. Urgency bar (package.html only) ─────────────────────
    function injectUrgencyBar(s) {
        if (!s.urgencyBarEnabled) return;
        if (!isPackagePage()) return;
        if (document.getElementById('ck-urgency-bar')) return;

        var msg = escapeText(s.urgencyBarMessage || DEFAULTS.urgencyBarMessage);

        var bar = document.createElement('div');
        bar.id = 'ck-urgency-bar';
        bar.innerHTML =
            '<span class="ck-urgency-text"></span>' +
            '<span class="ck-urgency-timer" id="ck-urgency-timer">--:--:--</span>';
        bar.querySelector('.ck-urgency-text').textContent = msg;
        document.body.appendChild(bar);

        function tick() {
            var now = new Date();
            var end = new Date(now);
            end.setHours(23, 59, 59, 999);
            var diff = Math.max(0, end - now);
            var hh = Math.floor(diff / 3600000);
            var mm = Math.floor((diff % 3600000) / 60000);
            var ss = Math.floor((diff % 60000) / 1000);
            var t = document.getElementById('ck-urgency-timer');
            if (!t) return;
            t.textContent = pad(hh) + ':' + pad(mm) + ':' + pad(ss);
        }
        tick();
        setInterval(tick, 1000);
    }

    // ── 2. WhatsApp floating button ────────────────────────────
    function injectWhatsappFab(s) {
        if (!s.whatsappFabEnabled) return;
        if (document.getElementById('ck-wa-fab')) return;
        var num = String(s.whatsappFabNumber || '').replace(/\D/g, '');
        if (!num) return;
        var msg = encodeURIComponent(String(s.whatsappFabMessage || ''));
        var href = 'https://wa.me/' + num + (msg ? '?text=' + msg : '');

        // Use Font Awesome's brand icon if available (it's loaded site-wide),
        // else fall back to a unicode WhatsApp glyph.
        var iconHTML = '<i class="fab fa-whatsapp" style="color:#fff;font-size:30px;"></i>';

        var a = document.createElement('a');
        a.id = 'ck-wa-fab';
        a.href = href;
        a.target = '_blank';
        a.rel = 'noopener';
        a.title = 'Chat with us on WhatsApp';
        a.innerHTML = iconHTML + '<span class="ck-wa-pulse"></span>';
        document.body.appendChild(a);
    }

    // ── 3. Exit-intent coupon popup ────────────────────────────
    var EXIT_KEY = 'ck_exitIntentShown';

    function injectExitIntent(s) {
        if (!s.exitIntentCouponEnabled) return;
        try { if (sessionStorage.getItem(EXIT_KEY) === '1') return; } catch (_) {}

        var code = String(s.exitIntentCouponCode || 'COMEBACK10')
            .toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 32);
        var pct  = Math.max(1, Math.min(50, Number(s.exitIntentCouponPercent) || 10));

        var modal = document.createElement('div');
        modal.id = 'ck-exit-modal';
        var html =
            '<div class="ck-exit-card">' +
            '  <button type="button" class="ck-exit-close" aria-label="Close">\u00D7</button>' +
            '  <div class="ck-exit-emoji">\uD83C\uDF34</div>' +
            '  <h3>Wait! Don\'t leave empty-handed</h3>' +
            '  <p>Here\'s <strong>' + pct + '% off</strong> your Andaman trip — just for visiting today.</p>' +
            '  <div class="ck-exit-code">' +
            '    <span class="ck-exit-label">Your coupon</span>' +
            '    <code class="ck-exit-coupon">' + code + '</code>' +
            '    <button type="button" class="ck-exit-copy">Copy</button>' +
            '  </div>' +
            '  <a class="ck-exit-cta" href="/#packages">Browse Packages \u2192</a>' +
            '  <p class="ck-exit-fine">Apply at checkout \u00B7 valid 24 hrs \u00B7 one per customer</p>' +
            '</div>';
        modal.innerHTML = html;
        document.body.appendChild(modal);

        var close = function () {
            modal.classList.remove('ck-open');
            try { sessionStorage.setItem(EXIT_KEY, '1'); } catch (_) {}
        };
        modal.addEventListener('click', function (e) { if (e.target === modal) close(); });
        modal.querySelector('.ck-exit-close').addEventListener('click', close);
        modal.querySelector('.ck-exit-copy').addEventListener('click', function () {
            try { navigator.clipboard.writeText(code); } catch (_) {}
            this.textContent = '\u2713 Copied';
            var btn = this;
            setTimeout(function () { btn.textContent = 'Copy'; }, 1500);
        });

        var armed = true;
        var open = function () {
            if (!armed) return;
            armed = false;
            modal.classList.add('ck-open');
        };

        document.addEventListener('mouseout', function (e) {
            if (!e.toElement && !e.relatedTarget && (e.clientY || 0) <= 0) open();
        });

        if (matchMedia && matchMedia('(max-width: 768px)').matches) {
            setTimeout(function () { open(); }, 30000);
        }
    }

    function inject() {
        var s = getSettings();
        try { injectUrgencyBar(s); }   catch (e) { console.warn('[ck] urgency bar failed', e); }
        try { injectWhatsappFab(s); }  catch (e) { console.warn('[ck] whatsapp fab failed', e); }
        try { injectExitIntent(s); }   catch (e) { console.warn('[ck] exit intent failed', e); }
    }

    function start() {
        // Inject immediately with cached settings (instant render).
        inject();
        // Then re-fetch from Firestore — if the live values differ from
        // the cache (e.g. admin just toggled something off), re-render.
        if (window.SettingsStore && typeof window.SettingsStore.load === 'function') {
            window.SettingsStore.load().then(function (s) {
                // If any toggle changed since the cached run, blow away
                // the previously injected elements and re-inject.
                var changed = false;
                ['urgencyBarEnabled', 'whatsappFabEnabled', 'exitIntentCouponEnabled'].forEach(function (k) {
                    if (Boolean(s[k]) !== Boolean(getSettings()[k])) changed = true;
                });
                if (changed) {
                    ['ck-urgency-bar', 'ck-wa-fab', 'ck-exit-modal'].forEach(function (id) {
                        var el = document.getElementById(id);
                        if (el) el.remove();
                    });
                    inject();
                }
            }).catch(function () {});
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }
})();