/* ── Phase 3 Option B — "Tweak this trip" widget for /package ──
 *
 * In-place price-update widget rendered just below the package hero.
 * Pre-fills From / Date / Adults / Kids from the homepage searchContext
 * (with sensible defaults when missing — Bangalore, today + 30 days,
 * 2 adults, 0 kids). On the Update Price button click the visitor STAYS
 * on this package — the hero badge + booking-card price refresh based
 * on chosen heads, and the new searchContext is persisted so the
 * downstream Book Now / Customize / checkout flows pick it up.
 *
 * Exposes window.PkgTweakTrip.wire(pkg) — called from package.html's
 * renderPage() once the booking card is in the DOM.
 *
 * Depends on:
 *   - js/cities.js exposing window.INDIAN_CITIES (loaded earlier in head)
 *   - js/analytics.js for the search() event (no-op if missing)
 *
 * No category field — visitor has already chosen this package, so
 * filtering it out by category would be self-defeating.
 */
(function () {
    'use strict';

    function fmtINR(n) {
        return '\u20B9' + Number(n || 0).toLocaleString('en-IN');
    }

    function todayPlus(days) {
        var d = new Date();
        d.setDate(d.getDate() + (Number(days) || 0));
        return d.toISOString().slice(0, 10);
    }

    // Repaint hero price-badge + booking-card price for the chosen heads.
    // Per-person rate is constant (the package's price); total = perHead × heads.
    function paintPrice(pkg, adults, children) {
        var isTest = pkg.id === 'test' || Number(pkg.price) <= 1;
        var perHead = Number(pkg.price) || 0;
        var heads = Math.max(1, (Number(adults) || 0) + (Number(children) || 0));

        var heroBadge = document.querySelector('.pkg-hero-meta .price-badge');
        if (heroBadge) {
            heroBadge.textContent = fmtINR(perHead) + (isTest ? ' /test' : ' /person');
        }

        var bcPrice = document.querySelector('.booking-card .bc-price');
        if (bcPrice) {
            bcPrice.innerHTML = fmtINR(perHead) +
                ' <span>' + (isTest ? '/test' : '/person') + '</span>';
            var card = bcPrice.parentElement;
            var oldTotal = card && card.querySelector('.bc-price-total');
            if (oldTotal) oldTotal.remove();
            if (!isTest && heads > 1) {
                var total = perHead * heads;
                var row = document.createElement('div');
                row.className = 'bc-price-total';
                row.innerHTML = 'Total for ' + heads + ' guest' +
                    (heads === 1 ? '' : 's') + ': <strong>' + fmtINR(total) + '</strong>';
                bcPrice.insertAdjacentElement('afterend', row);
            }
        }
    }

    function wire(pkg) {
        var tt = document.getElementById('pkgTweakTrip');
        if (!tt) return;

        var fromEl     = document.getElementById('ttFrom');
        var dateEl     = document.getElementById('ttDate');
        var adultsEl   = document.getElementById('ttAdults');
        var childrenEl = document.getElementById('ttChildren');
        var btn        = document.getElementById('ttSearchBtn');

        // Populate the city <select>. js/cities.js' DOMContentLoaded helper
        // already fired before renderPage() injected this widget, so do
        // it manually. Default = Bangalore (Bengaluru).
        if (fromEl && fromEl.tagName === 'SELECT' && !fromEl.options.length) {
            var cities = Array.isArray(window.INDIAN_CITIES) ? window.INDIAN_CITIES : [];
            var defaultCity = fromEl.getAttribute('data-default') || 'Bangalore (Bengaluru)';
            cities.forEach(function (city) {
                var opt = document.createElement('option');
                opt.value = city;
                opt.textContent = city;
                if (city === defaultCity) opt.selected = true;
                fromEl.appendChild(opt);
            });
        }

        // Date min = today; default = today + 30 days when empty.
        if (dateEl) {
            dateEl.min = todayPlus(0);
            if (!dateEl.value) dateEl.value = todayPlus(30);
        }

        // Pre-fill from sessionStorage.searchContext (set by the homepage
        // hero SEARCH). Defaults above already cover the empty case.
        var sc = null;
        try { sc = JSON.parse(sessionStorage.getItem('searchContext') || 'null'); } catch (e) {}
        if (sc) {
            if (fromEl && sc.from) {
                var wantedCity = String(sc.from).trim().toLowerCase();
                var match = Array.prototype.find.call(fromEl.options || [], function (o) {
                    return o.value.toLowerCase() === wantedCity;
                });
                if (match) fromEl.value = match.value;
            }
            if (dateEl && sc.date) dateEl.value = sc.date;
            if (adultsEl && sc.adults != null) {
                var wA = String(sc.adults);
                if (Array.prototype.some.call(adultsEl.options, function (o) { return o.value === wA; })) {
                    adultsEl.value = wA;
                }
            }
            if (childrenEl && sc.children != null) {
                var wC = String(sc.children);
                if (Array.prototype.some.call(childrenEl.options, function (o) { return o.value === wC; })) {
                    childrenEl.value = wC;
                }
            }
        }

        // Initial paint from current values so the price already reflects
        // sessionStorage when the page first renders.
        paintPrice(pkg,
            adultsEl ? adultsEl.value : 2,
            childrenEl ? childrenEl.value : 0);

        if (btn) {
            btn.addEventListener('click', function () {
                var from     = fromEl ? String(fromEl.value || '').trim() : '';
                var date     = dateEl ? dateEl.value : '';
                var adults   = adultsEl   ? (parseInt(adultsEl.value, 10)   || 2) : 2;
                var children = childrenEl ? (parseInt(childrenEl.value, 10) || 0) : 0;

                if (!from) {
                    alert('Please choose your travelling-from city.');
                    if (fromEl) fromEl.focus();
                    return;
                }
                if (!date) {
                    alert('Please pick a travel date.');
                    if (dateEl) dateEl.focus();
                    return;
                }

                // Persist for downstream booking flow (Book Now / Customize
                // / checkout.html all read sessionStorage.searchContext).
                var ctx = {
                    from: from,
                    to: 'Andaman',
                    date: date,
                    adults: adults,
                    children: children,
                    totalPersons: adults + children
                };
                try { sessionStorage.setItem('searchContext', JSON.stringify(ctx)); } catch (e) {}

                // GA4 search event — best-effort, no-op when Analytics not loaded.
                try {
                    if (window.Analytics && window.Analytics.search) {
                        window.Analytics.search(
                            from + ' \u2192 Andaman | ' + date + ' | ' +
                            adults + 'A' + children + 'C (package page tweak)'
                        );
                    }
                } catch (e) {}

                // Repaint price for THIS package — no navigation away.
                paintPrice(pkg, adults, children);

                // Friendly confirmation toast (or alert fallback) so the
                // visitor knows the price was updated for their party size.
                var heads = Math.max(1, adults + children);
                var msg = '\u2713 Price updated for ' + heads + ' guest' +
                          (heads === 1 ? '' : 's') + ' on ' + date + '.';
                if (window.Toast && window.Toast.success) {
                    window.Toast.success(msg);
                }
            });
        }
    }

    window.PkgTweakTrip = { wire: wire };
})();