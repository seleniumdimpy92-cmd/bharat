/* ── One-off package creator: ROYAL PACKAGE (4B) — 2026 ──────────────
 * Adds the "Royal Package (4B) — 2026" package extracted from the
 * brochure at  package/ROYAL PACKAGE (4B).pdf .
 *
 * Source: Bharat Transport & Tourism — Andaman Itinerary
 *         ROYAL PACKAGE (4B) — 2026  (4 Nights / 5 Days)
 *         ₹29,500 per head | min 6 persons
 *
 * USAGE
 *   1. Open https://andamanvoyages.in/dashboard while signed in as admin.
 *   2. Open DevTools Console (F12 → Console tab).
 *   3. Paste the WHOLE block below (everything inside the IIFE), Enter.
 *   4. Wait for the green "✓ Package created" toast.
 *
 * Safety
 *   - Uses PackagesStore.publish() with the admin auth already in the
 *     page, so Firestore rules apply (admin-only writes).
 *   - APPENDS the new package — existing packages are untouched.
 *   - Re-running with the same id will prompt to replace.
 * ─────────────────────────────────────────────────────────────────── */

(async function () {
    if (!window.PackagesStore || typeof window.PackagesStore.publish !== 'function') {
        alert('PackagesStore not available. Make sure you are on /dashboard and signed in as admin.');
        return;
    }

    const newPkg = {
        id: 'royal-4b-2026',
        name: 'Royal Package (4B) — 2026',
        desc: '4N/5D | Port Blair + Havelock + Neil | Star Hotels + AC Cruise (Premium) + AC Personal Car',
        price: 29500,
        duration: '4 Nights / 5 Days',
        category: 'Royal',
        rating: 4.7,
        image: 'images/beach3.jpg', // replace later via the package edit UI
        visible: true,
        order: 6,
        createdAt: new Date().toISOString(),
        createdVia: 'manual-from-brochure',
        sourceFile: 'package/ROYAL PACKAGE (4B).pdf',

        // Per-head pricing & group rules
        pricePerHead: 29500,
        minPersons: 6,
        gstPercent: 5,            // 5% GST extra (excluded from package cost)

        places: [
            'Port Blair',
            'Cellular Jail',
            'Light & Sound Show (Cellular Jail)',
            'Marina Park',
            'Havelock Island',
            'Radhanagar Beach (No. 7)',
            'Elephant Beach',
            'Neil Island',
            'Bharatpur Beach',
            'Laxmanpur Beach',
            'Sitapur Beach',
            'Sunset Point (Neil)',
            'Corbyn\u2019s Cove Beach',
            '1943 Netaji Flag Point'
        ],

        inclusions: [
            'Accommodation (Star Category)',
            'Resort at Havelock & Neil',
            'Welcome Drinks',
            'Food (Breakfast & Dinner)',
            'All Transportation by AC Personal Car',
            'All Entry Fees',
            'Toll Tax',
            'Parking',
            'Airport Pickup & Drop',
            'A.C. Cruise for Havelock & Neil (Premium Class)'
        ],

        exclusions: [
            'Lunch',
            'Elephant Beach boat cost',
            'Personal activities (water-sports, scuba, snorkelling, sea-walk, jet-ski, etc.)',
            'Mineral water, cool drinks, ice cream and any type of beverages',
            '5% GST',
            'Up & Down Flight Fare',
            'Anything which is not mentioned in this package'
        ],

        // ── Day-wise Itinerary (verbatim from brochure) ──────────────
        itinerary: [
            {
                day: 1,
                title: 'Arrival in Port Blair — Cellular Jail, Light & Sound Show & Marina Park',
                stay:  'Port Blair',
                meals: ['Dinner'],
                details:
                    'Arrival at Port Blair, transfer to hotel. After lunch the tour will start with a visit to the historic CELLULAR JAIL, where the heroic saga of the Indian freedom struggle is brought alive. Then visit the LIGHT AND SOUND SHOW at Cellular Jail. Afterwards proceed to MARINA PARK and then back to the respective hotel. Overnight stay at Port Blair.'
            },
            {
                day: 2,
                title: 'Port Blair → Havelock Island — Radhanagar Beach & Elephant Beach',
                stay:  'Havelock Island',
                meals: ['Breakfast', 'Dinner'],
                details:
                    'In the morning, departure by inter-island cruise to HAVELOCK ISLAND — a major tourist destination owing to its rich marine life, white sand beaches and dense evergreen forests, at a distance of about 57 km north-east of the capital city, Port Blair. Visit RADHANAGAR BEACH (No. 7), recipient of an "A" rating from the World Tourism Organization (WTO). Then visit ELEPHANT BEACH by speed boat (OWN COST). Night stay at Havelock Island.'
            },
            {
                day: 3,
                title: 'Havelock → Neil Island — Bharatpur, Laxmanpur & Sunset Point',
                stay:  'Neil Island',
                meals: ['Breakfast', 'Dinner'],
                details:
                    'After breakfast, departure to NEIL ISLAND — about 30 km to the north-eastern part of Port Blair. Neil Island is famous for its marine life and popularly known as the "vegetable bowl of Andaman." After arrival, visit BHARATPUR BEACH (famous for coral watching and swimming), then LAXMANPUR BEACH (live coral and natural rock formation) and afternoon visit to the SUNSET POINT. Night stay near SITAPUR BEACH at Neil Island.'
            },
            {
                day: 4,
                title: 'Neil → Port Blair — Corbyn\u2019s Cove Beach & 1943 Netaji Flag Point',
                stay:  'Port Blair',
                meals: ['Breakfast', 'Dinner'],
                details:
                    'After breakfast, departure to PORT BLAIR. After lunch, visit CORBYN\u2019S COVE BEACH (the beach is just 10 km from the city centre and a prominent sightseeing place in Andaman; with pleasant blue sea water and lush green coconut palms, the beach allows visitors to relax alongside and enjoy several water sports available on the shore of the beach). Then visit the 1943 NETAJI FLAG POINT (on 30 December 1943, Netaji Subhash Chandra Bose visited Andaman and hoisted the Tricolor for the first time on free Indian soil — much before India attained Independence — declaring the island a free territory from British rule. The place where he hoisted the flag stands today as a great memorial, and one of the best places to visit on a heritage tour of Andaman). Night stay at Port Blair.'
            },
            {
                day: 5,
                title: 'Departure — Airport Drop',
                stay:  null,
                meals: ['Breakfast'],
                details:
                    'After breakfast, check-out from the hotel and transfer to Port Blair Airport for your onward flight. Tour ends with sweet memories of Andaman.'
            }
        ],

        // ── Booking & Cancellation ──────────────────────────────────
        bookingPolicy: {
            advancePerHead: 5000,
            currency: 'INR',
            note: 'Bookings are normally reserved on payment of ₹5,000/- per head as an advance of total package amount.',
            payee: 'BHARAT TRANSPORT & TOURISM',
            paymentModes: ['Cheque', 'Draft', 'Online']
        },
        cancellationPolicy: [
            { window: '01-07 days before', charge: 'No refund of any amount' },
            { window: '08-29 days before', charge: '50% of advance amount (per head)' },
            { window: '30 days or above',  charge: 'Minimum ₹3,000 per head' }
        ],

        // ── Terms & Conditions (verbatim from brochure) ──────────────
        terms: [
            'Tour schedule may change under circumstances such as bad weather & specific problems.',
            'Full payment must be paid on Day 1 after check-in to the hotel.',
            'Hotel check-in and check-out time: 8:00 AM.',
            'After confirmation of tour itinerary, no addition or alteration is allowed.',
            'Rates based on a minimum of 6 persons.',
            'Package cost is from Port Blair to Port Blair.',
            'Management will not undertake any kind of loss, liability, claim or damage to life, accident, theft/robbery or any other situation that happens during travel.',
            'If a single person occupies a Double Bed Room, extra cost will be borne by the guest.',
            '5% GST will be applicable.',
            'Covering places as per itinerary only.'
        ]
    };

    try {
        const current = await window.PackagesStore.load();
        const list = (current && Array.isArray(current.data)) ? current.data.slice() : [];
        if (list.some(p => p.id === newPkg.id)) {
            if (!confirm('A package with id "' + newPkg.id + '" already exists. Replace it?')) return;
            const idx = list.findIndex(p => p.id === newPkg.id);
            list[idx] = newPkg;
        } else {
            list.push(newPkg);
        }
        await window.PackagesStore.publish(list);
        console.log('%c\u2713 Royal Package (4B) — 2026 created successfully',
            'color:#27ae60;font-weight:bold;font-size:1.1rem');
        if (window.Toast && window.Toast.success) window.Toast.success('Royal Package (4B) — 2026 added');
        else alert('\u2713 Package created. Refresh the dashboard to see it.');
    } catch (err) {
        console.error('[create-royal-pkg] failed:', err);
        alert('\u274C Failed: ' + (err && err.message || err));
    }
})();