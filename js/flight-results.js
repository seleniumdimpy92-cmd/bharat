/* flight-results.js — Renders the flight-search results page.
 *
 * The site is hosted on GitHub Pages (static hosting), so there is no
 * server-side flight-search proxy. Instead, the page shows a live-fare
 * aggregator bar that deep-links visitors out to Google Flights,
 * Skyscanner, MakeMyTrip, etc. — those are the legal, real-time price
 * sources. Sample itinerary cards are no longer rendered.
 *
 * Public API:
 *   window.FlightResults.render(containerEl, params, partnerOpenFn)
 */
(function () {
    'use strict';

    function esc(s) {
        return String(s).replace(/[&<>"']/g, function (c) {
            return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];
        });
    }
    function inr(n) { return '\u20B9' + Math.round(n).toLocaleString('en-IN'); }

    function buildCard(f, openFn, params) {
        var badge = f.best
            ? '<span class="fr-badge fr-badge-best"><i class="fas fa-bolt"></i> Lowest fare</span>'
            : '';
        var col = f.st === 0 ? '#16a085' : '#f39c12';
        var paxL = f.pax > 1 ? (' for ' + f.pax + ' travelers') : '';
        var c = document.createElement('div');
        c.className = 'fr-card';
        c.innerHTML =
            '<div class="fr-card-main">' +
              '<div class="fr-airline">' +
                '<div class="fr-airline-logo" style="background:' + (f.a && f.a.col || '#0d7a8a') + ';">' + esc((f.a && f.a.c) || '??') + '</div>' +
                '<div><div class="fr-airline-name">' + esc((f.a && f.a.n) || 'Airline') + '</div><div class="fr-flight-no">' + esc(f.fno || '') + '</div></div>' +
              '</div>' +
              '<div class="fr-route">' +
                '<div class="fr-time-block"><div class="fr-time">' + esc(f.dep) + '</div><div class="fr-iata">' + esc(f.fr) + '</div></div>' +
                '<div class="fr-route-mid">' +
                  '<div class="fr-duration">' + esc(f.du) + '</div>' +
                  '<div class="fr-route-line"><span class="fr-plane"><i class="fas fa-plane"></i></span></div>' +
                  '<div class="fr-stop" style="color:' + col + ';">' + esc(f.sx) + '</div>' +
                '</div>' +
                '<div class="fr-time-block"><div class="fr-time">' + esc(f.arr) + '</div><div class="fr-iata">' + esc(f.to) + '</div></div>' +
              '</div>' +
              '<div class="fr-price-block">' + badge +
                '<div class="fr-price">' + inr(f.tp) + '</div>' +
                '<div class="fr-price-sub">total' + paxL + '</div>' +
                '<div class="fr-price-pp">' + inr(f.pp) + ' / pax</div>' +
              '</div>' +
            '</div>' +
            '<div class="fr-actions">' +
              '<span class="fr-actions-label"><i class="fas fa-external-link-alt"></i> Book on:</span>' +
              '<button type="button" class="fr-btn fr-mmt" data-partner="makemytrip">MakeMyTrip</button>' +
              '<button type="button" class="fr-btn fr-emt" data-partner="easemytrip">EaseMyTrip</button>' +
              '<button type="button" class="fr-btn fr-ct"  data-partner="cleartrip">Cleartrip</button>' +
              '<button type="button" class="fr-btn fr-sky" data-partner="skyscanner">Skyscanner</button>' +
            '</div>';

        c.querySelectorAll('.fr-btn').forEach(function (b) {
            b.addEventListener('click', function () {
                if (typeof openFn === 'function') openFn(b.dataset.partner, params);
            });
        });
        return c;
    }

    function renderHeader(containerEl, data, params) {
        var n = data.flights.length;
        var src = data.source === 'skyscanner' ? 'Skyscanner (live)'
                : data.source === 'amadeus'    ? 'Amadeus (live)'
                : 'estimated fares';
        var liveBadge = data.source === 'estimate'
            ? '<span class="fr-source fr-source-est">Estimated</span>'
            : '<span class="fr-source fr-source-live"><i class="fas fa-circle"></i> Live</span>';

        var hd = document.createElement('div');
        hd.className = 'fr-header';
        hd.innerHTML =
            '<div class="fr-header-title">' +
              '<i class="fas fa-plane-departure"></i> ' +
              '<strong>' + n + ' flights</strong> from <strong>' + esc(params.from || data.params.from) + '</strong> to <strong>' + esc(params.to || data.params.to) + '</strong> on ' + esc(data.params.date) +
              ' ' + liveBadge +
            '</div>' +
            '<div class="fr-header-note"><i class="fas fa-info-circle"></i> ' +
              'Prices via <strong>' + src + '</strong>. ' +
              'Click any partner button for live availability and to book.' +
            '</div>';
        containerEl.appendChild(hd);
    }

    function renderFooter(containerEl, data) {
        var ft = document.createElement('div');
        ft.className = 'fr-footer';
        ft.innerHTML =
            '<i class="fas fa-shield-alt" style="color:#16a085;"></i> ' +
            esc(data.disclaimer || 'Bharat Tours redirects to trusted partners. We may earn a small affiliate commission at no extra cost to you.');
        containerEl.appendChild(ft);
    }

    function renderLoading(containerEl) {
        containerEl.innerHTML =
            '<div class="fr-loading">' +
              '<i class="fas fa-spinner fa-spin"></i> ' +
              '<span>Searching live flights…</span>' +
            '</div>';
    }
    function renderError(containerEl, msg) {
        containerEl.innerHTML =
            '<div class="fr-error">' +
              '<i class="fas fa-exclamation-circle"></i> ' +
              esc(msg || 'Could not load flights. Please try again.') +
            '</div>';
    }

    // No server-side flight search on GitHub Pages — return an empty
    // result-set so the render() path falls through to the live-fare
    // aggregator bar (Google Flights, Skyscanner, MMT, EMT, Cleartrip).
    function fetchFlights(params) {
        return Promise.resolve({
            flights: [],
            source:  'estimate',
            params:  params || {},
            disclaimer: 'Bharat Tours redirects to trusted partners. We may earn a small affiliate commission at no extra cost to you.'
        });
    }

    /* ─────────────────────────────────────────────────────────
       Live external search links (legal alternatives to scraping):
         • Google Flights — deep-link in new tab (X-Frame-Options
           SAMEORIGIN means we can't iframe it, but we can pre-fill).
         • Skyscanner widget — embedded via Travelpayouts script.
       ───────────────────────────────────────────────────────── */
    function googleFlightsUrl(p) {
        var fr = (p.from || '').match(/\(([A-Z]{3})\)/) ? p.from.match(/\(([A-Z]{3})\)/)[1] : (p.from || '').toUpperCase().slice(0,3);
        var to = (p.to   || 'IXZ').match(/\(([A-Z]{3})\)/) ? p.to.match(/\(([A-Z]{3})\)/)[1] : 'IXZ';
        var d  = p.date || '';
        var ad = p.adults || 1;
        var ch = p.children || 0;
        // Google Flights URL spec: /travel/flights?q=Flights%20to%20IXZ%20from%20BLR%20on%20YYYY-MM-DD
        var q = 'Flights to ' + to + ' from ' + fr + ' on ' + d +
                (ch ? ' for ' + ad + ' adults ' + ch + ' children' : (ad>1 ? ' for ' + ad + ' adults' : ''));
        return 'https://www.google.com/travel/flights?q=' + encodeURIComponent(q) + '&hl=en&curr=INR';
    }

    function renderLiveBar(containerEl, params) {
        var bar = document.createElement('div');
        bar.className = 'fr-live-bar';
        bar.innerHTML =
            '<div class="fr-live-bar-title">' +
              '<i class="fas fa-bolt"></i> Get the live fare from these aggregators' +
            '</div>' +
            '<div class="fr-live-bar-buttons">' +
              '<a class="fr-live-btn fr-live-google" target="_blank" rel="noopener nofollow">' +
                '<i class="fab fa-google"></i> Google Flights' +
              '</a>' +
              '<button class="fr-live-btn fr-live-sky" type="button" data-partner="skyscanner">' +
                '<i class="fas fa-search"></i> Skyscanner' +
              '</button>' +
              '<button class="fr-live-btn fr-live-mmt" type="button" data-partner="makemytrip">' +
                'MakeMyTrip' +
              '</button>' +
              '<button class="fr-live-btn fr-live-emt" type="button" data-partner="easemytrip">' +
                'EaseMyTrip' +
              '</button>' +
              '<button class="fr-live-btn fr-live-ct" type="button" data-partner="cleartrip">' +
                'Cleartrip' +
              '</button>' +
            '</div>' +
            '<div class="fr-live-bar-note">' +
              'Each opens with your search pre-filled in a new tab — you see and pay the real live fare on their site.' +
            '</div>';
        // Wire Google link
        bar.querySelector('.fr-live-google').href = googleFlightsUrl(params);
        // Wire partner buttons
        bar.querySelectorAll('button[data-partner]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                if (btn.dataset.partner === 'skyscanner' && window.SkyscannerWidget && typeof window.SkyscannerWidget.open === 'function') {
                    window.SkyscannerWidget.open(params);
                    return;
                }
                if (typeof window.__flightOpenFn === 'function') {
                    window.__flightOpenFn(btn.dataset.partner, params);
                }
            });
        });
        containerEl.appendChild(bar);
    }

    function render(containerEl, params, openFn) {
        if (!containerEl) return;
        // Stash the openFn so the live bar can use it
        window.__flightOpenFn = openFn;

        renderLoading(containerEl);

        fetchFlights(params).then(function (data) {
            containerEl.innerHTML = '';
            // Top: live-fare aggregator buttons (legal real-time options)
            renderLiveBar(containerEl, params);

            if (!data || !data.flights || !data.flights.length) {
                var noResults = document.createElement('div');
                noResults.className = 'fr-empty';
                noResults.innerHTML = '<i class="fas fa-info-circle"></i> No sample itineraries found. Use the buttons above for live results.';
                containerEl.appendChild(noResults);
                return;
            }
            renderHeader(containerEl, data, params);
            data.flights.forEach(function (f) {
                containerEl.appendChild(buildCard(f, openFn, params));
            });
            renderFooter(containerEl, data);

            try { containerEl.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) {}
        }).catch(function (err) {
            console.error('FlightResults fetch failed:', err);
            // Even on error, show the live bar so users aren't stuck
            containerEl.innerHTML = '';
            renderLiveBar(containerEl, params);
            var msg = document.createElement('div');
            msg.className = 'fr-error';
            msg.innerHTML = '<i class="fas fa-exclamation-circle"></i> Sample fares unavailable right now. Use the buttons above to compare live prices on the major aggregators.';
            containerEl.appendChild(msg);
        });
    }

    window.FlightResults = {
        render: render,
        fetchFlights: fetchFlights,
        googleFlightsUrl: googleFlightsUrl
    };
})();
