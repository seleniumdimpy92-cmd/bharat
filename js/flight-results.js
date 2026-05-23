/* flight-results.js — Fetches live flight prices from /.netlify/functions/flight-search
 * (which itself proxies Skyscanner via RapidAPI / Amadeus / falls back to estimates),
 * then renders cards with airline, time, duration, stops, price, and 4 partner deep-links.
 *
 * Public API:
 *   window.FlightResults.render(containerEl, params, partnerOpenFn)
 */
(function () {
    'use strict';

    var API_URL = '/.netlify/functions/flight-search';

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

    function fetchFlights(params) {
        var qs = new URLSearchParams({
            from:       params.from || '',
            to:         params.to || 'IXZ',
            date:       params.date || '',
            returnDate: params.returnDate || '',
            adults:     String(params.adults || 1),
            children:   String(params.children || 0),
            cabin:      params.cabin || 'economy'
        }).toString();
        return fetch(API_URL + '?' + qs, { headers: { 'Accept': 'application/json' } })
            .then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
            });
    }

    function render(containerEl, params, openFn) {
        if (!containerEl) return;
        renderLoading(containerEl);

        fetchFlights(params).then(function (data) {
            containerEl.innerHTML = '';
            if (!data || !data.flights || !data.flights.length) {
                renderError(containerEl, 'No flights found for this route. Try a different date.');
                return;
            }
            renderHeader(containerEl, data, params);
            data.flights.forEach(function (f) {
                containerEl.appendChild(buildCard(f, openFn, params));
            });
            renderFooter(containerEl, data);

            // Smooth scroll into view
            try { containerEl.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) {}
        }).catch(function (err) {
            console.error('FlightResults fetch failed:', err);
            renderError(containerEl, 'Could not load live flights. Please try again or click a partner below to search directly.');
        });
    }

    window.FlightResults = {
        render: render,
        fetchFlights: fetchFlights
    };
})();