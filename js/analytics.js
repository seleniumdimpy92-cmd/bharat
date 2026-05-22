/* ── analytics.js ───────────────────────────────────────────────
   Lightweight Google Analytics 4 helper.

   Public API:
     window.Analytics.track(eventName, params)
     window.Analytics.viewItem(pkg)
     window.Analytics.beginCheckout(pkg, totalPrice)
     window.Analytics.purchase(orderId, pkg, totalPrice, currency)
     window.Analytics.search(query)

   Behavior:
     - Reads window.GA4_CONFIG.measurementId from firebase-config.js
     - Loads gtag.js exactly once
     - Skips init entirely on the admin dashboard (so admin clicks
       don't pollute your visitor stats)
     - All track calls are no-ops if GA4 isn't configured yet —
       safe to call on every page even before you have an ID.
   ──────────────────────────────────────────────────────────────── */

(function () {
    'use strict';

    const cfg = window.GA4_CONFIG || {};
    const id  = cfg.measurementId || '';
    const isAdminDashboard = /\/dashboard(\.html)?$/i.test(location.pathname);
    const isPlaceholder = !id || /REPLACE_WITH_YOUR_GA4/i.test(id);

    function isReady() {
        return !isPlaceholder && typeof window.gtag === 'function';
    }

    function loadGtag() {
        if (isPlaceholder || isAdminDashboard) return;          // skip
        if (window.__gaLoaded) return;
        window.__gaLoaded = true;

        // Inject gtag.js
        const s = document.createElement('script');
        s.async = true;
        s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
        document.head.appendChild(s);

        window.dataLayer = window.dataLayer || [];
        window.gtag = function gtag() { window.dataLayer.push(arguments); };
        window.gtag('js', new Date());
        window.gtag('config', id, {
            // Anonymize IP at the edge (GDPR-friendly default)
            anonymize_ip: true,
            // Don't send a default pageview here — we let enhanced
            // measurement on the GA4 side handle it; or override per
            // page if you want richer page_view params.
            send_page_view: true
        });
    }

    function track(eventName, params) {
        if (!isReady()) return;
        try { window.gtag('event', eventName, params || {}); }
        catch (err) { /* swallow — analytics must never break the site */ }
    }

    // ── Travel/booking shortcuts ───────────────────────────────
    function viewItem(pkg) {
        if (!pkg) return;
        track('view_item', {
            currency: 'INR',
            value: Number(pkg.price) || 0,
            items: [{
                item_id:    pkg.id   || '',
                item_name:  pkg.name || '',
                item_category: pkg.category || 'package',
                price:      Number(pkg.price) || 0,
                quantity:   1
            }]
        });
    }

    function beginCheckout(pkg, totalPrice) {
        if (!pkg) return;
        track('begin_checkout', {
            currency: 'INR',
            value: Number(totalPrice || pkg.price) || 0,
            items: [{
                item_id:    pkg.id   || '',
                item_name:  pkg.name || '',
                item_category: pkg.category || 'package',
                price:      Number(pkg.price) || 0,
                quantity:   1
            }]
        });
    }

    function purchase(orderId, pkg, totalPrice, currency) {
        if (!pkg) return;
        track('purchase', {
            transaction_id: orderId || ('ord_' + Date.now()),
            currency: currency || 'INR',
            value:    Number(totalPrice || pkg.price) || 0,
            items: [{
                item_id:    pkg.id   || '',
                item_name:  pkg.name || '',
                item_category: pkg.category || 'package',
                price:      Number(pkg.price) || 0,
                quantity:   1
            }]
        });
    }

    function search(q) {
        if (!q) return;
        track('search', { search_term: String(q).slice(0, 100) });
    }

    // ── Boot ───────────────────────────────────────────────────
    if (!isAdminDashboard) loadGtag();

    window.Analytics = {
        track,
        viewItem,
        beginCheckout,
        purchase,
        search,
        isReady
    };
})();