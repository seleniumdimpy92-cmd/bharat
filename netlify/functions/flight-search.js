/**
 * /api/flight-search — Live flight search adapter.
 *
 * Tries providers in this order, falling back gracefully:
 *   1. Skyscanner via RapidAPI    (env: SKYSCANNER_RAPIDAPI_KEY)
 *   2. Amadeus Self-Service API   (env: AMADEUS_API_KEY + AMADEUS_API_SECRET)
 *   3. Local seasonal estimates   (always works, no key needed)
 *
 * The frontend always gets the same JSON shape back, so swapping providers
 * never requires a frontend change.
 *
 * Query params:
 *   from     — origin IATA or "City (IATA)" string (required)
 *   to       — destination IATA, default IXZ
 *   date     — YYYY-MM-DD (required)
 *   returnDate — YYYY-MM-DD (optional, round-trip)
 *   adults   — int, default 1
 *   children — int, default 0
 *   cabin    — economy | premium-economy | business | first
 *
 * Response:
 *   {
 *     source: "skyscanner" | "amadeus" | "estimate",
 *     currency: "INR",
 *     flights: [ { airline:{c,n,col}, fno, dep, arr, du, st, sx,
 *                  pp, tp, fr, to, pax, best } ],
 *     params: {...echoed input...},
 *     fetchedAt: ISO,
 *     disclaimer: "..."
 *   }
 */

'use strict';

/* ── helpers ─────────────────────────────────────────────────── */
function iata(s) {
    if (!s) return '';
    s = String(s).trim();
    var m = s.match(/\(([A-Z]{3})\)/);
    if (m) return m[1];
    if (/^[A-Z]{3}$/.test(s)) return s;
    return s.toUpperCase().slice(0, 3);
}
function pad(n) { return n < 10 ? '0' + n : '' + n; }
function tm(t) { return pad(Math.floor(t / 60) % 24) + ':' + pad(t % 60); }
function dur(min) { var h = Math.floor(min / 60), m = min % 60; return h + 'h ' + (m ? pad(m) + 'm' : ''); }
function isoToMin(s) {
    if (!s) return 0;
    var d = new Date(s);
    return d.getUTCHours() * 60 + d.getUTCMinutes();
}
function durationToMin(iso) {
    if (!iso) return 0;
    var m = String(iso).match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
    if (!m) return 0;
    return (parseInt(m[1] || 0, 10) * 60) + parseInt(m[2] || 0, 10);
}

/* ── airline brand colors (consistent across providers) ──────── */
var AIRLINE_COLORS = {
    '6E':{n:'IndiGo',col:'#001f5b'},
    'AI':{n:'Air India',col:'#cc0000'},
    'SG':{n:'SpiceJet',col:'#a50034'},
    'UK':{n:'Vistara',col:'#3b1d62'},
    'I5':{n:'Air India Express',col:'#ff6900'},
    'QP':{n:'Akasa Air',col:'#ff8c1a'},
    'BA':{n:'British Airways',col:'#1c5dac'},
    'EK':{n:'Emirates',col:'#d71921'},
    'QR':{n:'Qatar Airways',col:'#5c0632'},
    'EY':{n:'Etihad',col:'#bd8b13'}
};
function airline(code, fallbackName) {
    var c = String(code || '').toUpperCase();
    if (AIRLINE_COLORS[c]) return { c: c, n: AIRLINE_COLORS[c].n, col: AIRLINE_COLORS[c].col };
    return { c: c || '??', n: fallbackName || c || 'Airline', col: '#0d7a8a' };
}

/* ── 1) Skyscanner via RapidAPI ──────────────────────────────── */
async function trySkyscanner(p) {
    var key = process.env.SKYSCANNER_RAPIDAPI_KEY;
    var host = process.env.SKYSCANNER_RAPIDAPI_HOST || 'sky-scanner3.p.rapidapi.com';
    if (!key) return null;

    try {
        var url = 'https://' + host + '/flights/search-one-way' +
            '?fromEntityId=' + encodeURIComponent(p.fromIATA) +
            '&toEntityId='   + encodeURIComponent(p.toIATA) +
            '&departDate='   + encodeURIComponent(p.date) +
            '&adults='       + p.adults +
            '&cabinClass='   + (p.cabin === 'business' ? 'business' :
                                p.cabin === 'first' ? 'first' :
                                p.cabin === 'premium-economy' ? 'premium_economy' : 'economy') +
            '&currency=INR&market=IN&locale=en-IN';

        var r = await fetch(url, { headers: {
            'x-rapidapi-key':  key,
            'x-rapidapi-host': host
        }});
        if (!r.ok) return null;
        var json = await r.json();

        // RapidAPI Skyscanner shape varies; we try the common one
        var itineraries = (json && json.data && json.data.itineraries) || [];
        if (!itineraries.length) return null;

        var flights = itineraries.slice(0, 8).map(function (it) {
            var leg   = (it.legs && it.legs[0]) || {};
            var seg   = (leg.segments && leg.segments[0]) || {};
            var carr  = (leg.carriers && leg.carriers.marketing && leg.carriers.marketing[0]) || {};
            var price = it.price || {};
            var pp    = Math.round((price.raw || 0));
            var tp    = pp * (p.adults + p.children);
            var depMin = isoToMin(leg.departure);
            var arrMin = isoToMin(leg.arrival);
            var blockMin = leg.durationInMinutes || (arrMin - depMin + (arrMin < depMin ? 1440 : 0));
            var stops    = leg.stopCount || 0;
            return {
                a: airline(carr.code || carr.alternateId, carr.name),
                fno: (carr.code || '') + ' ' + (seg.flightNumber || ''),
                dep: pad(Math.floor(depMin / 60)) + ':' + pad(depMin % 60),
                arr: pad(Math.floor(arrMin / 60) % 24) + ':' + pad(arrMin % 60),
                du:  dur(blockMin),
                st:  stops,
                sx:  stops === 0 ? 'Non-stop' : (stops + ' Stop' + (stops > 1 ? 's' : '')),
                pp:  pp,
                tp:  tp,
                fr:  p.fromIATA,
                to:  p.toIATA,
                pax: p.adults + p.children
            };
        }).filter(function (f) { return f.pp > 0; });

        if (!flights.length) return null;
        flights.sort(function (a, b) { return a.tp - b.tp; });
        flights[0].best = true;
        return { source: 'skyscanner', flights: flights };
    } catch (e) {
        console.error('Skyscanner error:', e.message);
        return null;
    }
}

/* ── 2) Amadeus Self-Service ─────────────────────────────────── */
var amadeusToken = { access: null, expiresAt: 0 };
async function getAmadeusToken() {
    if (amadeusToken.access && Date.now() < amadeusToken.expiresAt - 30000) return amadeusToken.access;
    var k = process.env.AMADEUS_API_KEY;
    var s = process.env.AMADEUS_API_SECRET;
    if (!k || !s) return null;
    try {
        var r = await fetch('https://test.api.amadeus.com/v1/security/oauth2/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'grant_type=client_credentials&client_id=' + encodeURIComponent(k) +
                  '&client_secret=' + encodeURIComponent(s)
        });
        if (!r.ok) return null;
        var j = await r.json();
        amadeusToken.access = j.access_token;
        amadeusToken.expiresAt = Date.now() + (j.expires_in || 1800) * 1000;
        return amadeusToken.access;
    } catch (e) { return null; }
}
async function tryAmadeus(p) {
    var tok = await getAmadeusToken();
    if (!tok) return null;
    try {
        var cabinMap = {'economy':'ECONOMY','premium-economy':'PREMIUM_ECONOMY','business':'BUSINESS','first':'FIRST'};
        var qs = [
            'originLocationCode=' + p.fromIATA,
            'destinationLocationCode=' + p.toIATA,
            'departureDate=' + p.date,
            'adults=' + p.adults,
            'children=' + p.children,
            'travelClass=' + (cabinMap[p.cabin] || 'ECONOMY'),
            'currencyCode=INR',
            'max=10',
            'nonStop=false'
        ].join('&');
        if (p.returnDate) qs += '&returnDate=' + p.returnDate;

        var r = await fetch('https://test.api.amadeus.com/v2/shopping/flight-offers?' + qs, {
            headers: { 'Authorization': 'Bearer ' + tok }
        });
        if (!r.ok) return null;
        var j = await r.json();
        var offers = (j && j.data) || [];
        if (!offers.length) return null;

        var flights = offers.slice(0, 8).map(function (offer) {
            var itin = (offer.itineraries && offer.itineraries[0]) || {};
            var segs = itin.segments || [];
            var firstSeg = segs[0] || {};
            var lastSeg  = segs[segs.length - 1] || {};
            var carCode = firstSeg.carrierCode || '';
            var stops   = Math.max(0, segs.length - 1);
            var blockMin = durationToMin(itin.duration);
            var depMin = isoToMin(firstSeg.departure && firstSeg.departure.at);
            var arrMin = isoToMin(lastSeg.arrival && lastSeg.arrival.at);
            var price  = offer.price || {};
            var tp     = Math.round(parseFloat(price.grandTotal || price.total || 0));
            var pp     = (p.adults + p.children) > 0 ? Math.round(tp / (p.adults + p.children)) : tp;
            var via = '';
            if (stops >= 1 && segs[0] && segs[0].arrival) via = ' via ' + segs[0].arrival.iataCode;

            return {
                a:   airline(carCode),
                fno: carCode + ' ' + (firstSeg.number || ''),
                dep: pad(Math.floor(depMin / 60)) + ':' + pad(depMin % 60),
                arr: pad(Math.floor(arrMin / 60) % 24) + ':' + pad(arrMin % 60),
                du:  dur(blockMin),
                st:  stops,
                sx:  (stops === 0 ? 'Non-stop' : (stops + ' Stop' + (stops > 1 ? 's' : ''))) + via,
                pp:  pp,
                tp:  tp,
                fr:  p.fromIATA,
                to:  p.toIATA,
                pax: p.adults + p.children
            };
        }).filter(function (f) { return f.pp > 0; });

        if (!flights.length) return null;
        flights.sort(function (a, b) { return a.tp - b.tp; });
        flights[0].best = true;
        return { source: 'amadeus', flights: flights };
    } catch (e) {
        console.error('Amadeus error:', e.message);
        return null;
    }
}

/* ── 3) Local seasonal estimates (always works, no API key) ──── */
var BASE = {
    BLR:5800, BOM:7400, DEL:8900, MAA:4900, CCU:4200, HYD:6300, PNQ:7800,
    AMD:9200, GOI:8400, GOX:8500, COK:7100, TRV:7500, CCJ:7300, IXE:7000,
    CJB:6400, IXM:6800, TRZ:6900, JAI:9700, LKO:9200, IXC:10100, ATQ:10500,
    SXR:11800, IXJ:10800, IXL:12400, DED:10200, VNS:8800, IDR:9000, BHO:9300,
    NAG:8200, RPR:7400, IXR:7000, PAT:7600, BBI:5600, VTZ:5900, TIR:6200,
    VGA:6300, GAU:8400, IMF:9000, IXA:7800, DIB:9200, IXS:8600, IXB:7200,
    STV:8800, BDQ:9000, RAJ:9400, BHJ:9600, UDR:9800, JDH:10300, IXU:8400,
    ISK:8600, KLH:8200, HBX:7100, MYQ:6400, IXG:7300
};
var EST_AIRLINES = [
    {c:'6E',n:'IndiGo',col:'#001f5b',m:0.95},
    {c:'AI',n:'Air India',col:'#cc0000',m:1.10},
    {c:'SG',n:'SpiceJet',col:'#a50034',m:0.92},
    {c:'UK',n:'Vistara',col:'#3b1d62',m:1.18},
    {c:'I5',n:'Air India Express',col:'#ff6900',m:0.98},
    {c:'QP',n:'Akasa Air',col:'#ff8c1a',m:0.94}
];
var DIRECT = ['MAA','CCU','BLR','DEL','HYD','BOM','VTZ','BBI'];
function rng(seed){var s=0;for(var i=0;i<seed.length;i++)s=((s<<5)-s+seed.charCodeAt(i))|0;return function(){s=(s*9301+49297)%233280;return Math.abs(s)/233280;};}

function buildEstimates(p) {
    var base = BASE[p.fromIATA] || 7500;
    var cm = ({'economy':1,'premium-economy':1.55,'business':3.2,'first':5.5})[p.cabin] || 1;
    var d = Math.max(0, Math.round((new Date(p.date).getTime() - Date.now()) / 86400000));
    var dm = d <= 3 ? 1.35 : d <= 7 ? 1.18 : d <= 14 ? 1.06 : d > 60 ? 0.92 : 1;
    var R = rng(p.fromIATA + p.toIATA + p.date + p.cabin);
    var canDirect = DIRECT.indexOf(p.fromIATA) >= 0;
    var slots = [360, 480, 600, 780, 960, 1080, 1200];
    var out = [];
    for (var i = 0; i < 5; i++) {
        var a = EST_AIRLINES[Math.floor(R() * EST_AIRLINES.length)];
        var depMin = slots[i % slots.length] + Math.floor(R() * 35);
        var st = (canDirect && R() < 0.55) ? 0 : 1;
        var bm = st === 0 ? 130 + Math.floor(R() * 50) : 230 + Math.floor(R() * 200);
        var arrMin = depMin + bm;
        var px = base * cm * dm * a.m * (0.92 + R() * 0.16);
        if (st === 1) px *= 0.88;
        var tot = p.adults * px + p.children * px * 0.75;
        var via = st === 1 ? ' via ' + ['MAA','CCU','BLR','DEL'][Math.floor(R() * 4)] : '';
        out.push({
            a: { c: a.c, n: a.n, col: a.col },
            fno: a.c + ' ' + Math.floor(100 + R() * 9000),
            dep: tm(depMin),
            arr: tm(arrMin % 1440),
            du:  dur(bm),
            st:  st,
            sx:  (st === 0 ? 'Non-stop' : '1 Stop') + via,
            pp:  Math.round(px),
            tp:  Math.round(tot),
            fr:  p.fromIATA,
            to:  p.toIATA,
            pax: p.adults + p.children
        });
    }
    out.sort(function (x, y) { return x.tp - y.tp; });
    if (out.length) out[0].best = true;
    return { source: 'estimate', flights: out };
}

/* ── handler ─────────────────────────────────────────────────── */
exports.handler = async function (event) {
    var headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=120' // 2-min CDN cache
    };
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: headers, body: '' };

    var q = (event.queryStringParameters || {});
    var p = {
        from:       q.from || '',
        to:         q.to || 'IXZ',
        fromIATA:   iata(q.from),
        toIATA:     iata(q.to || 'IXZ'),
        date:       q.date || new Date().toISOString().slice(0, 10),
        returnDate: q.returnDate || '',
        adults:     Math.max(1, parseInt(q.adults, 10) || 1),
        children:   Math.max(0, parseInt(q.children, 10) || 0),
        cabin:      (q.cabin || 'economy').toLowerCase()
    };

    if (!p.fromIATA) {
        return { statusCode: 400, headers: headers, body: JSON.stringify({ error: 'from is required' }) };
    }

    // Try providers in priority order
    var result = await trySkyscanner(p);
    if (!result || !result.flights || !result.flights.length) result = await tryAmadeus(p);
    if (!result || !result.flights || !result.flights.length) result = buildEstimates(p);

    var disclaimer = result.source === 'estimate'
        ? 'Prices shown are seasonal estimates based on average fares. The booking partner shows the live fare at checkout.'
        : 'Prices fetched from ' + result.source + ' and are subject to availability at the booking partner.';

    return {
        statusCode: 200,
        headers: headers,
        body: JSON.stringify({
            source:     result.source,
            currency:   'INR',
            flights:    result.flights,
            params:     { from: p.fromIATA, to: p.toIATA, date: p.date, returnDate: p.returnDate,
                          adults: p.adults, children: p.children, cabin: p.cabin },
            fetchedAt:  new Date().toISOString(),
            disclaimer: disclaimer
        })
    };
};
