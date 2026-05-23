/* ── flights.js ─────────────────────────────────────────────────
   Flight search + affiliate deep-link module.

   Public API:
     window.FlightSearch.openPartner(partner, params)
     window.FlightSearch.PARTNERS
     window.FlightSearch.buildUrl(partner, params)

   `params`: { from, to, date, returnDate, adults, children, infants, cabin }

   Affiliate IDs come from window.FLIGHT_AFFILIATES (firebase-config.js).
   ──────────────────────────────────────────────────────────────── */

(function () {
    'use strict';

    var IATA_MAP = {
        'mumbai': 'BOM', 'delhi': 'DEL', 'new delhi': 'DEL',
        'bangalore': 'BLR', 'bengaluru': 'BLR',
        'kolkata': 'CCU', 'chennai': 'MAA', 'hyderabad': 'HYD',
        'pune': 'PNQ', 'ahmedabad': 'AMD', 'goa': 'GOI',
        'kochi': 'COK', 'cochin': 'COK',
        'thiruvananthapuram': 'TRV', 'jaipur': 'JAI', 'lucknow': 'LKO',
        'chandigarh': 'IXC', 'coimbatore': 'CJB', 'indore': 'IDR',
        'nagpur': 'NAG', 'visakhapatnam': 'VTZ', 'bhubaneswar': 'BBI',
        'guwahati': 'GAU', 'patna': 'PAT', 'raipur': 'RPR',
        'ranchi': 'IXR', 'srinagar': 'SXR', 'amritsar': 'ATQ',
        'varanasi': 'VNS', 'surat': 'STV', 'tiruchirappalli': 'TRZ',
        'madurai': 'IXM', 'mangalore': 'IXE', 'mangaluru': 'IXE',
        'port blair': 'IXZ', 'andaman': 'IXZ'
    };

    function toIATA(input) {
        if (!input) return '';
        var s = String(input).trim();
        if (/^[A-Z]{3}$/.test(s)) return s;
        var m = s.match(/\(([A-Z]{3})\)\s*$/);
        if (m) return m[1];
        return IATA_MAP[s.toLowerCase()] || s.toUpperCase();
    }

    var PARTNERS = [
        { id: 'makemytrip', name: 'MakeMyTrip',
          tagline: "India's #1 travel site",
          color: '#eb2026',
          features: ['Pay later', 'Free cancellation', 'EMI options'] },
        { id: 'easemytrip', name: 'EaseMyTrip',
          tagline: 'Lowest fares guaranteed',
          color: '#0a4d9d',
          features: ['Zero convenience fee', 'Best for domestic'] },
        { id: 'cleartrip', name: 'Cleartrip',
          tagline: 'Hassle-free booking',
          color: '#f57c00',
          features: ['Express checkout', 'Trusted by millions'] },
        { id: 'skyscanner', name: 'Skyscanner',
          tagline: 'Compare 100s of airlines',
          color: '#0770e3',
          features: ['Best for international', 'Price alerts'] }
    ];

    function fmtSlashDate(d) {
        if (!d) return '';
        var p = String(d).split('-');
        if (p.length !== 3) return '';
        return p[2] + '/' + p[1] + '/' + p[0];
    }

    function affiliateOf(id) {
        return (window.FLIGHT_AFFILIATES && window.FLIGHT_AFFILIATES[id]) || {};
    }

    function buildUrl(partner, p) {
        p = p || {};
        var from = toIATA(p.from);
        var to   = toIATA(p.to || 'IXZ');
        var date = p.date || '';
        var ret  = p.returnDate || '';
        var adults   = Math.max(1, parseInt(p.adults, 10) || 1);
        var children = Math.max(0, parseInt(p.children, 10) || 0);
        var infants  = Math.max(0, parseInt(p.infants, 10) || 0);
        var cabin    = (p.cabin || 'economy').toLowerCase();
        var aff      = affiliateOf(partner);
        var qs;

        if (partner === 'makemytrip') {
            var mmtTrip = ret ? 'R' : 'O';
            var mmtCabin = ({
                'economy': 'E', 'premium-economy': 'PE',
                'business': 'B', 'first': 'F'
            })[cabin] || 'E';
            var itinerary = from + '-' + to + '-' + fmtSlashDate(date);
            if (ret) itinerary += '_' + to + '-' + from + '-' + fmtSlashDate(ret);
            qs = [
                'itinerary=' + encodeURIComponent(itinerary),
                'tripType=' + mmtTrip,
                'paxType=' + encodeURIComponent('A-' + adults + '_C-' + children + '_I-' + infants),
                'cabinClass=' + mmtCabin,
                'intl=false'
            ];
            if (aff.tag) qs.push('affiliate_id=' + encodeURIComponent(aff.tag));
            if (aff.subId) qs.push('utm_source=affiliate&utm_medium=' + encodeURIComponent(aff.subId));
            return 'https://www.makemytrip.com/flight/search?' + qs.join('&');
        }

        if (partner === 'easemytrip') {
            var emtCabin = ({
                'economy': '0', 'premium-economy': '1',
                'business': '2', 'first': '3'
            })[cabin] || '0';
            var srch = from + '-' + from + '-India|' + to + '-' + to + '-India|' + fmtSlashDate(date);
            if (ret) srch += '|' + to + '-' + to + '-India|' + from + '-' + from + '-India|' + fmtSlashDate(ret);
            qs = [
                'srch=' + encodeURIComponent(srch),
                'px=' + adults + '-' + children + '-' + infants,
                'cbn=' + emtCabin,
                'ar=undefined',
                'isow=' + (ret ? 'false' : 'true')
            ];
            if (aff.tag) qs.push('aff=' + encodeURIComponent(aff.tag));
            if (aff.subId) qs.push('subaff=' + encodeURIComponent(aff.subId));
            return 'https://flight.easemytrip.com/FlightList/Index?' + qs.join('&');
        }

        if (partner === 'cleartrip') {
            var ctCabin = ({
                'economy': 'Economy', 'premium-economy': 'PremiumEconomy',
                'business': 'Business', 'first': 'First'
            })[cabin] || 'Economy';
            qs = [
                'from=' + encodeURIComponent(from),
                'to=' + encodeURIComponent(to),
                'depart_date=' + encodeURIComponent(fmtSlashDate(date)),
                'adults=' + adults,
                'childs=' + children,
                'infants=' + infants,
                'class=' + ctCabin,
                'intl=N',
                'sd=t'
            ];
            if (ret) qs.push('return_date=' + encodeURIComponent(fmtSlashDate(ret)));
            if (aff.tag) qs.push('affilate_id=' + encodeURIComponent(aff.tag));
            if (aff.subId) qs.push('utm_source=' + encodeURIComponent(aff.subId));
            return 'https://www.cleartrip.com/flights/results?' + qs.join('&');
        }

        if (partner === 'skyscanner') {
            var date2 = (date || '').replace(/-/g, '').slice(2); // YYMMDD
            var ret2  = (ret  || '').replace(/-/g, '').slice(2);
            var path  = '/transport/flights/' +
                encodeURIComponent(from.toLowerCase()) + '/' +
                encodeURIComponent(to.toLowerCase()) + '/' +
                date2 + '/' + (ret2 ? ret2 + '/' : '');
            qs = [
                'adults=' + adults,
                'children=' + children,
                'infants=' + infants,
                'cabinclass=' + cabin,
                'rtn=' + (ret ? '1' : '0'),
                'preferdirects=false'
            ];
            if (aff.tag)   qs.push('associateid=' + encodeURIComponent(aff.tag));
            if (aff.subId) qs.push('utm_source=' + encodeURIComponent(aff.subId));
            return 'https://www.skyscanner.co.in' + path + '?' + qs.join('&');
        }

        return '#';
    }

    function openPartner(partner, params) {
        var url = buildUrl(partner, params);
        if (!url || url === '#') return;

        // GA4 tracking — see which partners get the most clicks
        try {
            if (window.Analytics && window.Analytics.track) {
                window.Analytics.track('flight_search_redirect', {
                    partner: partner,
                    from: toIATA((params || {}).from),
                    to:   toIATA((params || {}).to || 'IXZ'),
                    date: (params || {}).date || '',
                    return_date: (params || {}).returnDate || '',
                    adults: (params || {}).adults || 1,
                    children: (params || {}).children || 0,
                    infants: (params || {}).infants || 0,
                    cabin: (params || {}).cabin || 'economy',
                    trip_type: (params || {}).returnDate ? 'roundtrip' : 'oneway'
                });
            }
        } catch (e) {}

        // Tally to localStorage so the admin can see clicks even without GA4
        try {
            var k = 'flightRedirectStats';
            var raw = localStorage.getItem(k);
            var stats = raw ? JSON.parse(raw) : {};
            stats[partner] = (stats[partner] || 0) + 1;
            stats._lastClickedAt = new Date().toISOString();
            localStorage.setItem(k, JSON.stringify(stats));
        } catch (e) {}

        window.open(url, '_blank', 'noopener');
    }

    window.FlightSearch = {
        PARTNERS:    PARTNERS,
        IATA_MAP:    IATA_MAP,
        toIATA:      toIATA,
        buildUrl:    buildUrl,
        openPartner: openPartner
    };
})();