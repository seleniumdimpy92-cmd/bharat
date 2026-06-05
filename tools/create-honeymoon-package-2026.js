/* ── One-off package creator: HONEYMOON PACKAGE (4A) — 2026 ──────────
 * Adds the "Honeymoon Package (4A) — 2026" extracted from the
 * brochure at  package/HONEYMOON PACKAGE(4A).pdf .
 *
 * Source: Bharat Transport & Tourism — Andaman Itinerary
 *         HONEYMOON PACKAGE (4A) — 2026  (4 Nights / 5 Days)
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
        id: 'honeymoon-4a-2026',
        name: 'Honeymoon Package (4A) — 2026',
        desc: '4N/5D | Port Blair + Havelock | Beach Resort + Candlelight Dinner + Photoshoot + AC Premium Cruise',
        price: 29500,
        duration: '4 Nights / 5 Days',
        category: 'Honeymoon',
        rating: 4.8,
        image: 'images/beach4.jpg', // replace later via the package edit UI
        visible: true,
        order: 7,
        createdAt: new Date().toISOString(),
        createdVia: 'manual-from-brochure',
        sourceFile: 'package/HONEYMOON PACKAGE(4A).pdf',

        // Per-head pricing & group rules
        pricePerHead: 29500,
        minPersons: 6,
        gstPercent: 5,            // 5% GST extra (excluded from package cost)

        places: [
            'Port Blair',
            'Cellular Jail',
            'Light & Sound Show (Cellular Jail)',
            'Marina Park',
            'Havelock Island (Swaraj Dweep)',
            'Radhanagar Beach (No. 7)',
            'Elephant Beach',
            'Kalapathar Beach',
            'Corbyn\u2019s Cove Beach',
            '1943 Netaji Flag Point'
        ],

        inclusions: [
            'Accommodation (Star Category)',
            'Beach Resort at Havelock',
            'Welcome Drinks & Bouquet',
            'Food (Breakfast)',
            'Flower Bed Decoration with Honeymoon Cake',
            '1 Night Candlelight Dinner',
            'All Transportation by AC Personal Car',
            'Elephant Beach by Speed Boat with Snorkelling',
            'All Entry Fees',
            'Photoshoot at Radhanagar Beach (15 minutes)',
            'Toll Tax',
            'Parking',
            'Airport Pickup & Drop',
            'A.C. Cruise for Havelock (Premium Class)'
        ],

        exclusions: [
            'Lunch & Dinner (other than the included candlelight dinner)',
            'Personal activities (water-sports, scuba, sea-walk, jet-ski, etc.)',
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
                meals: [],
                details:
                    'Arrival at Port Blair, transfer to hotel. After lunch the tour will start with a visit to the historic CELLULAR JAIL, where the heroic saga of the Indian freedom struggle is brought alive. Then visit the LIGHT AND SOUND SHOW at Cellular Jail. Afterwards proceed to MARINA PARK and then back to the respective hotel. Overnight stay at Port Blair.'
            },
            {
                day: 2,
                title: 'Port Blair → Havelock Island — Radhanagar Beach (with photoshoot)',
                stay:  'Havelock Island',
                meals: ['Breakfast'],
                details:
                    'In the morning, departure by inter-island cruise to HAVELOCK ISLAND — a major tourist destination owing to its rich marine life, white sand beaches and dense evergreen forests, at a distance of about 57 km north-east of the capital city, Port Blair. Visit RADHANAGAR BEACH (No. 7), recipient of an "A" rating from the World Tourism Organization (WTO). Enjoy a complimentary 15-minute couple photoshoot at Radhanagar Beach. In the evening, enjoy your honeymoon flower-bed decoration with cake and a romantic 1-night candlelight dinner at the resort. Night stay at Havelock Island.'
            },
            {
                day: 3,
                title: 'Havelock — Elephant Beach (snorkelling) & Kalapathar Beach',
                stay:  'Havelock Island',
                meals: ['Breakfast'],
                details:
                    'In the morning, after breakfast, departure to ELEPHANT BEACH by speed boat. Elephant Beach, located on Havelock Island (Swaraj Dweep) in the Andamans, is a premier, action-packed destination renowned for its crystal-clear turquoise waters, vibrant coral reefs and shallow white-sand shores — enjoy snorkelling here (included). Then visit KALAPATHAR BEACH, a scenic, tranquil destination renowned for its striking contrast of white sand, turquoise waters and large black boulders. Overnight stay at Havelock Island.'
            },
            {
                day: 4,
                title: 'Havelock → Port Blair — Corbyn\u2019s Cove Beach & 1943 Netaji Flag Point',
                stay:  'Port Blair',
                meals: ['Breakfast'],
                details:
                    'After breakfast, departure to PORT BLAIR. After lunch, visit CORBYN\u2019S COVE BEACH (the beach is just 10 km from the city centre and a prominent sightseeing place in Andaman; with pleasant blue sea water and lush green coconut palms, the beach allows visitors to relax alongside and enjoy several water sports available on the shore of the beach). Then visit the 1943 NETAJI FLAG POINT (on 30 December 1943, Netaji Subhash Chandra Bose visited Andaman and hoisted the Tricolor for the first time on free Indian soil — much before India attained Independence — declaring the island a free territory from British rule. The place where he hoisted the flag stands today as a great memorial, and one of the best places to visit on a heritage tour of Andaman). Overnight stay at Port Blair.'
            },
            {
                day: 5,
                title: 'Departure — Airport Drop',
                stay:  null,
                meals: ['Breakfast'],
                details:
                    'After breakfast, check-out from the hotel and transfer to Port Blair Airport for your onward flight. Tour ends with sweet honeymoon memories of Andaman.'
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
        console.log('%c\u2713 Honeymoon Package (4A) — 2026 created successfully',
            'color:#27ae60;font-weight:bold;font-size:1.1rem');
        if (window.Toast && window.Toast.success) window.Toast.success('Honeymoon Package (4A) — 2026 added');
        else alert('\u2713 Package created. Refresh the dashboard to see it.');
    } catch (err) {
        console.error('[create-honeymoon-pkg] failed:', err);
        alert('\u274C Failed: ' + (err && err.message || err));
    }
})();