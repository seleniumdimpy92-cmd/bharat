/* ── One-off package creator ──────────────────────────────────
 * Creates the "Andaman Customized Package — Feb 2026" package
 * extracted from the 8-page brochure that the AI Import couldn't
 * fully read because of low-resolution OCR + watermark interference.
 *
 * USAGE
 *   1. Open https://andamanvoyages.in/dashboard while signed in as admin.
 *   2. Open DevTools Console (F12 → Console tab).
 *   3. Copy the WHOLE block below (everything inside the IIFE), paste,
 *      hit Enter.
 *   4. Wait for the green "✓ Package created" toast.
 *
 * Safety
 *   - Uses PackagesStore.publish() with the admin auth already in the
 *     page, so Firestore rules apply (admin-only writes).
 *   - APPENDS the new package — the existing 5 packages are untouched.
 *   - If you need to re-run, change the id below to avoid collision.
 * ───────────────────────────────────────────────────────────── */

(async function () {
    if (!window.PackagesStore || typeof window.PackagesStore.publish !== 'function') {
        alert('PackagesStore not available. Make sure you are on /dashboard and signed in as admin.');
        return;
    }

    const newPkg = {
        id: 'customized-feb-2026',
        name: 'Andaman Customized Package — Feb 2026',
        desc: '8N/9D | Port Blair + Havelock + Neil + Baratang | AC Hotels + AC Cruise + Ferries',
        price: 24500,
        duration: '8 Nights / 9 Days',
        category: 'Standard',
        rating: 4.7,
        image: 'images/beach2.jpg',  // replace later via the package edit UI
        visible: true,
        order: 5,
        createdAt: new Date().toISOString(),
        createdVia: 'manual-from-brochure',

        places: [
            'Port Blair', 'Cellular Jail', 'Marina Park',
            'Ross Island', 'North Bay Island',
            'Havelock Island', 'Radhanagar Beach',
            'Neil Island', 'Bharatpur Beach', 'Laxmanpur Beach', 'Sitapur Beach',
            'Corbyn\u2019s Cove Beach', '1943 Netaji Flag Point', 'Ramakrishna Mission',
            'Baratang Island', 'Jarawa Reserve Forest', 'Limestone Cave',
            'Chatham Saw Mill', 'Anthropological Museum', 'Fisheries Aquarium', 'Samudrika Naval Museum'
        ],

        inclusions: [
            'AC Accommodation (8 nights)',
            'All Meals (Breakfast, Lunch & Dinner)',
            'AC Transportation',
            'Boat to Ross & North Bay Island',
            'AC Cruise Ship (Havelock & Neil Island)',
            'Forest Permit',
            'Jarawa Permit',
            'Parking Charges',
            'Airport Pickup & Drop',
            'Tour Guide / Driver'
        ],

        exclusions: [
            'Entry Fees at monuments',
            'Light & Sound Show at Cellular Jail',
            'Personal activities (Scuba diving, Snorkeling, Sea-walk, Speedboat, Glass boat, Water scooter, Jet-ski, any rides)',
            'Baratang Safari & Limestone Cave boat cost',
            'Mineral water, cold drinks, ice cream and any beverages',
            '5% GST',
            'Up & Down Flight Fare',
            'Anything not mentioned in the itinerary'
        ],

        itinerary: [
            {
                day: 1,
                date: '14/2/26',
                title: 'Arrival in Port Blair — Cellular Jail & Light & Sound Show',
                details: 'Arrival at Port Blair, transfer to hotel. After lunch, the tour will start with a visit to the historic CELLULAR JAIL, where the heroic saga of the Indian freedom struggle is brought alive. Then visit the LIGHT AND SOUND SHOW at Cellular Jail, afterwards proceed to MARINA PARK and then back to respective hotel. Overnight stay at Port Blair.'
            },
            {
                day: 2,
                date: '15/2/26',
                title: 'Ross Island & North Bay Island',
                details: 'In the morning after breakfast, proceed to ROSS ISLAND \u2014 the former residential and administrative island of the British during their rule of South-East Asia, nicknamed the \u201CParis of the East.\u201D Afternoon visit to NORTH BAY ISLAND, located in the Andaman & Nicobar Islands, a popular destination known for its coral reefs. Overnight stay at Port Blair.'
            },
            {
                day: 3,
                date: '16/2/26',
                title: 'Departure to Havelock Island \u2014 Radhanagar Beach',
                details: 'In the morning, departure by inter-island cruise to HAVELOCK ISLAND \u2014 a major tourist destination owing to its rich marine life, white sand beaches and dense evergreen forests, at a distance of about 57 km north-east of the capital city, Port Blair. Attractions of Havelock Island are RADHANAGAR BEACH (No. 7), recipient of an \u201CA\u201D rating from the World Tourism Organization (WTO). Night stay at Havelock Island.'
            },
            {
                day: 4,
                date: '17/2/26',
                title: 'Departure to Neil Island \u2014 Bharatpur & Laxmanpur Beaches',
                details: 'After breakfast, departure to NEIL ISLAND \u2014 about 30 km to the north-eastern part of Port Blair. Neil Island is famous for its marine life and popularly known as the \u201Cvegetable bowl of Andaman.\u201D After arrival, visit BHARATPUR BEACH (famous for coral watching and swimming), then LAXMANPUR BEACH I & II, and visit the live coral and natural rock formation. Afternoon visit to sunset point. Night stay near SITAPUR BEACH at Neil Island.'
            },
            {
                day: 5,
                date: '18/2/26',
                title: 'Neil Island \u2014 Day at Leisure / More Beaches',
                details: 'A second day on NEIL ISLAND. Explore Sitapur Beach at sunrise, revisit Bharatpur Beach for snorkelling, swim at Laxmanpur Beach, and admire the famous Howrah Bridge natural rock formation. Catch the sunset at the western beach before returning to the hotel. Night stay at Neil Island.'
            },
            {
                day: 6,
                date: '19/2/26',
                title: 'Back to Port Blair \u2014 Corbyn\u2019s Cove, Netaji Flag Point & Ramakrishna Mission',
                details: 'After breakfast, back to PORT BLAIR. Afternoon visit to CORBYN\u2019S COVE BEACH (the beach is just 10 km from the city centre, a prominent sightseeing place in Andaman; with pleasant blue sea water and lush green coconut palms, the beach allows visitors to relax alongside and enjoy several water sports available on the shore). Then visit the 1943 NETAJI FLAG POINT (on 30 December 1943, Netaji Subhash Chandra Bose visited Andaman and hoisted the Tricolor for the first time on free Indian soil, much before India attained Independence \u2014 declaring the island a free territory from British rule. The place where he hoisted the flag stands today as a great memorial). Then visit RAMAKRISHNA MISSION. Night stay at Port Blair.'
            },
            {
                day: 7,
                date: '20/2/26',
                title: 'Baratang Island via Jarawa Reserve Forest \u2014 Limestone Caves & Mangroves',
                details: 'Early morning, proceed to BARATANG ISLAND through the JARAWA RESERVE FOREST \u2014 Massive island, Jarawa forest, Limestone Cave (OWN COST) and mangrove creeks. It has everything that will set your holiday mood on. Situated at a distance of 100 km from Port Blair and known for its geological and natural wonders. Evening, return to Port Blair. Night stay at Port Blair.'
            },
            {
                day: 8,
                date: '21/2/26',
                title: 'Port Blair Sightseeing \u2014 Saw Mill, Museums & Aquarium',
                details: 'After breakfast, full-day \u201CPORT BLAIR SIGHTSEEING\u201D which covers CHATHAM SAW MILL \u2014 one of the oldest and largest Saw Mills in Asia (closed for visitors but viewable from outside); ANTHROPOLOGICAL MUSEUM \u2014 illustrates the Negrito tribes of the Andaman; FISHERIES AQUARIUM \u2014 exhibits species of marine life endemic to the islands and found in the Indo-Pacific and Bay of Bengal; SAMUDRIKA NAVAL MUSEUM \u2014 a good collection of shells, corals and species. Night stay at Port

        // ── Extra metadata captured from the brochure ──────────────────
        bookingPolicy: {
            advancePercent: 30,
            payee: 'TOURISM WORLD',
            payeeLocation: 'Kolkata',
            paymentModes: ['Cheque', 'Draft', 'Online']
        },
        cancellationPolicy: [
            { window: '01-07 days before', charge: '100% (no refund)' },
            { window: '08-10 days before', charge: '75% of total' },
            { window: '11-14 days before', charge: '50% of total' },
            { window: '15+ days before',  charge: 'Min ₹3,000' }
        ],
        terms: [
            'Tour schedule may change due to bad weather or specific problems.',
            'Full payment must be paid on Day 1 after hotel check-in.',
            'Hotel check-in & check-out time: 8:00 AM.',
            'Once itinerary is confirmed, no additions or alterations allowed.',
            'Rates based on minimum 12 persons.',
            'Resorts will be ₹1,500/- higher than hotels on package cost.',
            'Extra cost for personal car, AC car, AC room & additional tour.',
            'Package cost is from Port Blair to Port Blair.',
            'Management is not liable for loss, accident, theft/robbery during travel.',
            'Single occupancy of double room costs extra.',
            '5% GST applicable.',
            'Covers places as per itinerary only.'
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
        console.log('%c\u2713 Package created successfully', 'color:#27ae60;font-weight:bold;font-size:1.1rem');
        if (window.Toast && window.Toast.success) window.Toast.success('Customized Feb 2026 package added');
        else alert('\u2713 Package created. Refresh the dashboard to see it.');
    } catch (err) {
        console.error.error('[create-pkg] failed:', err);
        alert('\u274C Failed: ' + (err && err.message || err));
    }
})();
