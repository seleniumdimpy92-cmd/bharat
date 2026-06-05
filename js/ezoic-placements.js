/* ── ezoic-placements.js ──────────────────────────────────────────
 * Auto-discovers every Ezoic ad placeholder on the current page and
 * fires a single ezstandalone.showAds(...allIds) call. Per Ezoic's
 * Step-3 guidance:
 *   "Pages with multiple placements should pass all placement IDs
 *    into a single showAds() call. This reduces server requests
 *    and improves loading speed."
 *
 * Public API (window.EzoicPlacements):
 *   • refresh()              — re-scan DOM, call showAds() for any
 *                              placeholders NOT yet shown. Use this
 *                              after dynamically inserting new
 *                              <div id="ezoic-pub-ad-placeholder-NNN">
 *                              into the page (modal, infinite scroll,
 *                              tab switch, etc.).
 *   • show(...ids)           — explicit showAds(id1, id2, ...) — same
 *                              effect as Ezoic's example. Mostly for
 *                              code that already knows which IDs it
 *                              just appended.
 *   • destroy(...ids)        — call ezstandalone.destroyPlaceholders
 *                              for the given IDs. Use when removing
 *                              the corresponding <div>s from the DOM.
 *   • destroyAll()           — wraps ezstandalone.destroyAll().
 *   • refreshAllForNewPage() — for SPA-style nav changes: calls
 *                              ezstandalone.showAds() with NO args,
 *                              which Ezoic interprets as "refresh
 *                              every existing placeholder + anchor +
 *                              video ad locations on the new URL".
 *                              Hook this into your router after a
 *                              client-side navigation completes.
 *
 * All API calls are no-ops if ezstandalone never loads (ad-blocker,
 * network error, etc.) — they NEVER throw, NEVER break the page.
 *
 * Why a helper instead of hard-coding showAds(101, 102, ...)?
 *   • Keeps the markup clean — every page just drops as many
 *     <div id="ezoic-pub-ad-placeholder-NNN"></div> blocks as it
 *     wants, with NO inline <script> tags scattered through the
 *     content (Ezoic's docs allow this, but it bloats the DOM).
 *   • Numeric IDs can be re-arranged or renamed without editing
 *     this file or any per-page <script> blocks.
 *   • Single source of truth for showAds / destroyPlaceholders /
 *     destroyAll — keeps Ezoic's "Dynamic Content" guidance applied
 *     consistently across the codebase.
 *
 * Loaded at the END of <body> on every public page that has
 * placeholders. Admin pages don't include this script.
 *
 * IMPORTANT — do NOT add inline styles to the placeholder divs.
 * Reserving space (e.g. min-height) makes Ezoic show empty white
 * boxes when an ad doesn't fill. Per Ezoic docs, the loader sets
 * the size itself once an ad lands. Just put bare divs.
 * ──────────────────────────────────────────────────────────────── */
(function () {
    'use strict';

    // Track which IDs we've already passed to showAds() in THIS pageview,
    // so refresh() only fires the call for genuinely new placeholders.
    // (Calling showAds() twice with the same ID re-bids the slot, which
    // counts as a duplicate impression and gets penalised by some ad
    // networks — keep the bookkeeping clean.)
    var shownIds = Object.create(null);

    function dlog() {
        if (window.console && console.debug) {
            try { console.debug.apply(console, ['[ezoic-placements]'].concat([].slice.call(arguments))); }
            catch (_) {}
        }
    }

    function pushCmd(fn) {
        // The Ezoic command queue is initialised in the <head> on every
        // public page (see the privacy + header script block). If for
        // any reason it's missing, lazily create it so we don't blow up.
        if (!window.ezstandalone) window.ezstandalone = {};
        if (!window.ezstandalone.cmd) window.ezstandalone.cmd = [];
        try { window.ezstandalone.cmd.push(fn); } catch (_) {}
    }

    function collectPlacementIds(root) {
        root = root || document;
        var nodes = root.querySelectorAll('[id^="ezoic-pub-ad-placeholder-"]');
        var ids = [];
        for (var i = 0; i < nodes.length; i++) {
            var m = String(nodes[i].id || '').match(/^ezoic-pub-ad-placeholder-(\d+)$/);
            if (m) ids.push(parseInt(m[1], 10));
        }
        // De-dupe in case the same id is dropped twice (templates etc).
        ids = ids.filter(function (v, i, a) { return a.indexOf(v) === i; });
        return ids;
    }

    function showInternal(ids) {
        if (!ids || !ids.length) return;
        pushCmd(function () {
            if (typeof window.ezstandalone.showAds !== 'function') return;
            // Pass all IDs as separate args, exactly as Ezoic's docs
            // prescribe: showAds(101, 102, 103, ...).
            window.ezstandalone.showAds.apply(window.ezstandalone, ids);
        });
        for (var i = 0; i < ids.length; i++) shownIds[ids[i]] = true;
    }

    function destroyInternal(ids) {
        if (!ids || !ids.length) return;
        pushCmd(function () {
            if (typeof window.ezstandalone.destroyPlaceholders !== 'function') return;
            window.ezstandalone.destroyPlaceholders.apply(window.ezstandalone, ids);
        });
        for (var i = 0; i < ids.length; i++) delete shownIds[ids[i]];
    }

    /* ── public API ──────────────────────────────────────── */
    var api = {
        // Re-scan DOM. Call ezstandalone.showAds() for any placeholders
        // we haven't shown yet in this pageview. Safe to call many
        // times — only NEW IDs are passed to showAds().
        refresh: function () {
            var allIds = collectPlacementIds();
            var newIds = [];
            for (var i = 0; i < allIds.length; i++) {
                if (!shownIds[allIds[i]]) newIds.push(allIds[i]);
            }
            if (newIds.length) {
                dlog('refresh: showing new placements', newIds);
                showInternal(newIds);
            } else {
                dlog('refresh: no new placeholders to show');
            }
            return newIds;
        },

        // Explicitly show one or more placement IDs. Caller knows what
        // IDs they just appended (e.g. infinite scroll with deterministic
        // per-article IDs). Equivalent to Ezoic's basic example block.
        show: function () {
            var ids = [].slice.call(arguments).map(Number).filter(function (n) {
                return isFinite(n) && n > 0;
            });
            if (!ids.length) return;
            dlog('show:', ids);
            showInternal(ids);
        },

        // Destroy specific placements (e.g. the user closed a modal that
        // had ads in it). Always call BEFORE removing the corresponding
        // <div>s from the DOM, otherwise Ezoic's bookkeeping gets confused.
        destroy: function () {
            var ids = [].slice.call(arguments).map(Number).filter(function (n) {
                return isFinite(n) && n > 0;
            });
            if (!ids.length) return;
            dlog('destroy:', ids);
            destroyInternal(ids);
        },

        // Destroy ALL placeholders Ezoic currently has bookkeeping for.
        // Useful when ripping out a whole section of the page (e.g.
        // resetting an SPA route to a blank state).
        destroyAll: function () {
            dlog('destroyAll');
            pushCmd(function () {
                if (typeof window.ezstandalone.destroyAll !== 'function') return;
                window.ezstandalone.destroyAll();
            });
            shownIds = Object.create(null);
        },

        // SPA-style "I just navigated to a new page" hook. Per Ezoic's
        // Dynamic Content docs:
        //   "When switching between pageviews dynamically, it is
        //    important to re-call ezstandalone.showAds() to force ads
        //    to refresh on the new URL."
        // Calling with NO arguments tells Ezoic to refresh every
        // existing placeholder + anchor + video ad on the new URL.
        // We follow it up with a `refresh()` so any newly-rendered
        // placeholders that weren't on the previous page also light up.
        refreshAllForNewPage: function () {
            dlog('refreshAllForNewPage');
            pushCmd(function () {
                if (typeof window.ezstandalone.showAds !== 'function') return;
                window.ezstandalone.showAds();
            });
            // The next pageview is a fresh canvas — clear our tracking
            // and re-scan DOM so refresh() catches new placeholders.
            shownIds = Object.create(null);
            api.refresh();
        }
    };

    // Expose the API for any code that wants to hook into dynamic
    // content events (modals, route changes, infinite scroll, etc.).
    window.EzoicPlacements = api;

    /* ── initial page-load showAds() ──────────────────────── */
    function init() {
        var ids = collectPlacementIds();
        dlog('initial placements:', ids);
        showInternal(ids);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        // Already past DOMContentLoaded — run on next tick so any
        // late-rendered placeholders (e.g. injected by JS) are caught
        // in the same call.
        setTimeout(init, 0);
    }
})();