/* Checkout / Cart Page Logic — uses Toast for all notifications, no native alerts */
(function () {
    'use strict';

    // Razorpay key id used by the checkout.
    //   • LIVE (default): real cards / real money — production.
    //   • TEST: rzp_test_… key → fake gateway (use the test cards listed at
    //     https://razorpay.com/docs/payments/payments/test-card-details/).
    //
    // Admins can flip the site to TEST mode from Dashboard → Settings →
    // Razorpay Test Mode (writes /settings/site.razorpayTestMode in
    // Firestore). When that flag is true AND `razorpayTestKeyId` is
    // populated, we use the test key here. Everything else (refund
    // Worker secrets, booking flow, emails) is unchanged.
    var RAZORPAY_KEY_LIVE = 'rzp_live_SuU1aVUD8Ce71w';
    var RAZORPAY_KEY = RAZORPAY_KEY_LIVE;            // overridden async by resolveRazorpayKey()
    var GST_RATE = 0.05;

    // Resolve the Razorpay key from SettingsStore. If admin has flipped
    // the site to TEST mode AND set a test key id, swap it in. Falls back
    // to the hard-coded LIVE key on any failure (so prod is never broken
    // by a Firestore hiccup).
    function resolveRazorpayKey() {
        return new Promise(function (resolve) {
            try {
                if (!window.SettingsStore || typeof window.SettingsStore.load !== 'function') {
                    return resolve();
                }
                window.SettingsStore.load().then(function (s) {
                    if (s && s.razorpayTestMode === true && s.razorpayTestKeyId) {
                        RAZORPAY_KEY = String(s.razorpayTestKeyId).trim();
                        // Visible warning so staff don't mistake test mode
                        // for a real-money checkout.
                        try {
                            console.warn(
                                '%c[Razorpay TEST MODE]%c using key ' + RAZORPAY_KEY +
                                ' — no real money will move. Toggle off in Dashboard → Settings.',
                                'background:#f39c12;color:#fff;padding:2px 6px;border-radius:3px;font-weight:700;',
                                'color:#a04000;'
                            );
                        } catch (_) {}
                    }
                    resolve();
                }).catch(function () { resolve(); });
            } catch (_) { resolve(); }
        });
    }

    // ── Booking advance: flat per-head amounts ─────────────────────────
    // Replaces the older "5% of total trip cost" model. The exact rule is
    // documented at /terms#cancellation; this code is the single source of
    // truth for what Razorpay actually charges.
    //
    //   • Luxury / Premium / Honeymoon  → ₹11,000 / head
    //   • Budget / Standard / everything else → ₹6,000 / head
    //
    // The 'test' package (and any package priced ≤ ₹1) is treated as a
    // zero-advance booking — Razorpay is skipped entirely and the booking
    // confirms instantly via the FREE- payment-id shortcut. This makes the
    // smoke-test flow free for staff to run end-to-end without real money.
    var ADVANCE_LUXURY   = 11000;
    var ADVANCE_STANDARD = 6000;
    // Package-id → head price. Anything not in this map falls back to STANDARD.
    var ADVANCE_BY_PKG = {
        budget:    ADVANCE_STANDARD,
        standard:  ADVANCE_STANDARD,
        luxury:    ADVANCE_LUXURY,
        premium:   ADVANCE_LUXURY,
        honeymoon: ADVANCE_LUXURY
    };

    // Per-head advance for the package currently in the cart.
    // If a "Launch advance" coupon is currently applied (admin-toggleable
    // in Dashboard → Conversion Boosters), use the flat coupon amount
    // (e.g. ₹2,000) instead of the package's normal ₹6K/₹11K.
    // Detect the smoke-test package — used to bypass the Razorpay
    // gateway entirely so staff can run the full booking flow end-to-end
    // without a real charge. The package itself still calculates its
    // normal trip cost / advance / balance (so the UI looks identical
    // to a real booking) — only the Razorpay step is skipped, and the
    // booking is confirmed straight away with a synthetic FREE-* id.
    //
    // We match by:
    //   • exact pkgId === 'test' (the seeded default)
    //   • pkgId / name containing the word "test" (admin-created variants
    //     like "payment-test", "Payment Test Package", "test-2026")
    function isTestPackage() {
        if (!state.cart) return false;
        var id = String(state.cart.pkgId || '').toLowerCase();
        var nm = String(state.cart.name  || '').toLowerCase();
        if (id === 'test') return true;
        if (/(^|[\s\-_])test([\s\-_]|$)/.test(id)) return true;
        if (/(^|[\s\-_])test([\s\-_]|$)/.test(nm)) return true;
        return false;
    }

    function advancePerHead() {
        if (state.coupon && typeof state.coupon.advanceOverride === 'number' && state.coupon.advanceOverride > 0) {
            return state.coupon.advanceOverride;
        }
        if (!state.cart) return ADVANCE_STANDARD;
        // Look up by package id; case-insensitive.
        var key = String(state.cart.pkgId || '').toLowerCase();
        if (ADVANCE_BY_PKG[key]) return ADVANCE_BY_PKG[key];
        // Soft heuristic — if the package name contains "luxury", "premium",
        // or "honeymoon" we still apply the higher tier even when the id
        // doesn't match (e.g. admin-created packages with custom ids).
        var nm = String(state.cart.name || '').toLowerCase();
        if (/luxury|premium|honeymoon/.test(nm)) return ADVANCE_LUXURY;
        return ADVANCE_STANDARD;
    }

    // Headcount (children counted as full heads for advance — the policy
    // says "₹6,000 per traveller", not "per adult").
    function headCount() {
        if (!state.cart) return 1;
        var n = (Number(state.cart.adults) || 0) + (Number(state.cart.children) || 0);
        return Math.max(1, n);
    }

    // For backwards-compat with code below that referenced ADVANCE_RATE
    // (e.g. the SettingsStore async loader that used to override it).
    // The Razorpay description used to say "5% advance for…"; we keep
    // a tiny helper that produces a human label like "₹6,000 advance".
    function fmtAdvanceLabel() {
        var per = advancePerHead();
        return R + Number(per).toLocaleString('en-IN') + '/head';
    }
    var COUPONS = {
        'WELCOME500':  { type: 'flat',    value: 500,  label: 'Rs.500 off',  min: 5000  },
        'ANDAMAN10':   { type: 'percent', value: 10,   label: '10% off',     min: 10000, cap: 3000 },
        'HONEYMOON15': { type: 'percent', value: 15,   label: '15% off',     min: 20000, cap: 5000 }
    };
    var DEFAULTS = [
        { id: 'budget',    name: 'Budget Andaman Escape',  price: 15999, image: 'images/beach1.jpg', duration: '4N/5D' },
        { id: 'standard',  name: 'Standard Andaman Bliss', price: 21999, image: 'images/beach2.jpg', duration: '6N/7D' },
        { id: 'luxury',    name: 'Luxury Andaman Retreat', price: 28999, image: 'images/beach3.jpg', duration: '6N/7D' },
        { id: 'honeymoon', name: 'Honeymoon Paradise',     price: 24999, image: 'images/beach4.jpg', duration: '5N/6D' },
        { id: 'test',      name: 'Payment Test Package',   price: 1,     image: 'images/beach1.jpg', duration: 'Test'  }
    ];
    var ADDONS = [
        { id: 'scuba',       name: 'Scuba Diving',       price: 2000 },
        { id: 'snorkel',     name: 'Snorkeling',         price: 1500 },
        { id: 'candlelight', name: 'Candlelight Dinner', price: 3000 },
        { id: 'photoshoot',  name: 'Photoshoot',         price: 1000 },
        { id: 'seawalk',     name: 'Sea Walk',           price: 2500 }
    ];

    var state = { cart: null, coupon: null, customerDiscount: 0, customerName: '', activeLock: null };
    var R = '\u20B9';

    // ── Price-Lock constants ────────────────────────────────────────
    // ₹500 per head, 10-day validity. The fee is non-refundable; if the
    // customer converts the lock to a booking within the window, the
    // fee is deducted from the advance. After 10 days the lock expires
    // and the fee is forfeited. See LocksStore in js/dataStore.js.
    var LOCK_PRICE_PER_HEAD = (window.LocksStore && window.LocksStore.PRICE_PER_HEAD) || 500;
    var LOCK_VALIDITY_MS    = (window.LocksStore && window.LocksStore.VALIDITY_MS)    || (10 * 24 * 60 * 60 * 1000);

    // ── Firebase auth ──
    window.__authInstance = null;
    if (window.__firebaseReady && typeof window.__firebaseReady.then === 'function') {
        window.__firebaseReady.then(function (fb) {
            window.__authInstance = fb.auth;
            if (fb.firebaseAuth && fb.firebaseAuth.onAuthStateChanged) {
                fb.firebaseAuth.onAuthStateChanged(fb.auth, function (u) {
                    updateAuthLink(u);
                    if (u) prefillFromUser(u);
                });
            }
        }).catch(function () {});
    }
    function isLoggedIn() {
        if (window.__authInstance && window.__authInstance.currentUser) return true;
        try {
            var cu = JSON.parse(localStorage.getItem('currentUser') || 'null');
            return !!(cu && (cu.uid || cu.id) && localStorage.getItem('token'));
        } catch (e) { return false; }
    }
    function updateAuthLink(user) {
        var link = document.getElementById('navAuthLink');
        if (!link) return;
        if (user && user.email) {
            link.textContent = (user.displayName || user.email.split('@')[0]).slice(0, 18);
            link.href = '/';
        } else {
            link.textContent = 'Login';
            link.href = '/#login';
        }
    }
    function prefillFromUser(user) {
        var n = document.getElementById('travelerName');
        var e = document.getElementById('travelerEmail');
        if (n && !n.value) n.value = user.displayName || '';
        if (e && !e.value) e.value = user.email || '';
        try {
            var cu = JSON.parse(localStorage.getItem('currentUser') || 'null');
            if (cu) {
                if (n && !n.value) n.value = cu.fullName || cu.username || '';
                var p = document.getElementById('travelerPhone');
                if (p && !p.value && cu.phone) p.value = cu.phone;
            }
        } catch (e) {}
    }

    // ── Cart load/save ──
    function loadCart() {
        try {
            var raw = sessionStorage.getItem('checkoutCart');
            if (raw) { var c = JSON.parse(raw); if (c && c.pkgId) return c; }
        } catch (e) {}
        var params = new URLSearchParams(window.location.search);
        var pkgId = params.get('pkg');
        if (pkgId) {
            var pkg = findPackage(pkgId);
            if (pkg) return {
                pkgId: pkg.id, name: pkg.name, price: pkg.price, image: pkg.image, duration: pkg.duration,
                adults: parseInt(params.get('adults'), 10) || 2,
                children: parseInt(params.get('children'), 10) || 0,
                travelDate: params.get('date') || '',
                addons: [], duration_pref: '', meals: ''
            };
        }
        return null;
    }
    function findPackage(pkgId) {
        try {
            var c = JSON.parse(localStorage.getItem('packagesCache') || 'null');
            if (Array.isArray(c)) { var h = c.find(function (p) { return p.id === pkgId; }); if (h) return h; }
        } catch (e) {}
        return DEFAULTS.find(function (p) { return p.id === pkgId; });
    }
    function saveCart() {
        try { sessionStorage.setItem('checkoutCart', JSON.stringify(state.cart)); } catch (e) {}
    }

    // ── Pricing ──
    function calcSubtotal() {
        if (!state.cart) return 0;
        var c = state.cart;
        var people = (Number(c.adults) || 0) + (Number(c.children) || 0) * 0.5;
        if (people < 1) people = 1;
        var addons = (c.addons || []).reduce(function (s, a) { return s + (a.price || 0); }, 0);
        return Math.round(c.price * people + addons);
    }
    // Coupon discount (entered via the coupon input)
    function calcCouponDiscount(sub) {
        if (!state.coupon) return 0;
        var co = state.coupon;
        if (sub < (co.min || 0)) return 0;
        var d = co.type === 'flat' ? co.value : Math.round(sub * co.value / 100);
        if (co.cap) d = Math.min(d, co.cap);
        return Math.min(d, sub);
    }
    // Per-customer discount % (admin-configured, applied to the subtotal
    // BEFORE GST, separate from any coupon code).
    function calcCustomerDiscount(sub) {
        var pct = Number(state.customerDiscount) || 0;
        if (!pct || pct <= 0) return 0;
        return Math.min(sub, Math.round(sub * pct / 100));
    }
    // Combined discount (used by the rest of the pipeline)
    function calcDiscount(sub) {
        var d = calcCouponDiscount(sub) + calcCustomerDiscount(sub);
        return Math.min(d, sub);
    }
    function calcGst(t) { return Math.round(t * GST_RATE); }
    function calcTotal() {
        var s = calcSubtotal(), d = calcDiscount(s), t = s - d;
        return t + calcGst(t);
    }
    // Booking advance is now a flat per-head amount (₹6,000 or ₹11,000),
    // NOT a percentage of the total trip cost. See ADVANCE_BY_PKG above.
    // Returns 0 when the per-head advance is explicitly 0 — in that case
    // startPayment() skips the Razorpay gateway and confirms the booking
    // directly (admin-issued comp / 100 %-discount coupon flow).
    function calcAdvance() {
        var perHead = advancePerHead();
        if (perHead <= 0) return 0;
        // Cap at the actual total — guards against a tiny test cart where
        // headcount × per-head would exceed the trip cost.
        var raw = Math.min(calcTotal(), Math.max(1, perHead * headCount()));
        // If an active price-lock is in effect, deduct the lock fee
        // already paid (₹500/head × heads at lock time) from what we
        // charge now. The lock fee is non-refundable so it always
        // counts against the advance regardless of headcount changes.
        if (state.activeLock) {
            var locked = Number(state.activeLock.totalPaid || 0);
            if (locked > 0) raw = Math.max(0, raw - locked);
        }
        return raw;
    }
    function calcBalance() { return Math.max(0, calcTotal() - calcAdvance()); }

    // Lock fee already paid against the current cart's package — used
    // by the Razorpay description and the "you save ₹X" banner.
    function lockCreditApplied() {
        return state.activeLock ? Number(state.activeLock.totalPaid || 0) : 0;
    }

    // ── HTML builder ──
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function fmt(n) { return Number(n).toLocaleString(); }

    function emptyHtml() {
        return '<div class="co-empty" style="grid-column:1/-1;background:#fff;border-radius:12px;">' +
            '<i class="fas fa-shopping-cart"></i>' +
            '<h2 style="margin:.5rem 0;">Your cart is empty</h2>' +
            '<p>Browse our handpicked Andaman packages and start planning your dream trip.</p>' +
            '<p style="margin-top:1.2rem;"><a href="/#packages" style="display:inline-block;padding:.8rem 1.5rem;background:#0d7a8a;color:#fff;text-decoration:none;border-radius:8px;font-weight:700;">Browse Packages</a></p>' +
            '</div>';
    }

    function cartCard() {
        var c = state.cart;
        var people = (Number(c.adults) || 0) + (Number(c.children) || 0);
        return '<div class="co-card"><h2><i class="fas fa-suitcase-rolling"></i> Your Package</h2>' +
            '<div class="cart-item">' +
            '<div class="img" style="background-image:url(\'' + esc(c.image || 'images/beach1.jpg') + '\');"></div>' +
            '<div class="info"><p class="name">' + esc(c.name) + '</p>' +
            '<p class="meta"><i class="fas fa-clock"></i> ' + esc(c.duration || '') + ' &middot; ' +
            '<i class="fas fa-users"></i> ' + people + ' Traveler' + (people !== 1 ? 's' : '') +
            ' (' + c.adults + ' Adult' + (c.adults !== 1 ? 's' : '') +
            (c.children > 0 ? ', ' + c.children + ' Child' + (c.children !== 1 ? 'ren' : '') : '') + ')' +
            (c.travelDate ? '<br><i class="fas fa-calendar"></i> ' + esc(c.travelDate) : '') + '</p>' +
            '<p class="price" style="margin:.5rem 0 0;">' + R + fmt(c.price) + ' /person</p></div>' +
            '<button class="remove-btn" id="removeItemBtn"><i class="fas fa-trash"></i> Remove</button>' +
            '</div></div>';
    }

    // Resolve the included meal plan for the cart's package tier.
    // Budget / Standard  → all three meals (breakfast + lunch + dinner)
    // Luxury / Premium / Honeymoon (and everything else) → breakfast only
    // The plan is fixed by the package and NOT customer-selectable, so
    // we render it as a read-only chip rather than a <select>.
    function mealPlanForCart() {
        var perHead = advancePerHead();
        var key = String(state.cart && state.cart.pkgId || '').toLowerCase();
        var nm  = String(state.cart && state.cart.name  || '').toLowerCase();
        // Budget / Standard tier (₹6,000 head advance) gets all 3 meals.
        // We also catch admin-named packages whose id isn't 'budget'/'standard'
        // by checking the per-head bucket.
        if (perHead === ADVANCE_STANDARD || /budget|standard/.test(key) || /budget|standard/.test(nm)) {
            return {
                code: 'all',
                label: 'Breakfast + Lunch + Dinner',
                note: 'All 3 meals included — Budget & Standard packages.'
            };
        }
        return {
            code: 'breakfast',
            label: 'Breakfast only',
            note: 'Only breakfast is included for Luxury / Premium / Honeymoon packages.'
        };
    }

    function customizeCard() {
        var sel = (state.cart.addons || []).map(function (a) { return a.id; });
        var addonsH = ADDONS.map(function (a) {
            var ch = sel.indexOf(a.id) >= 0;
            return '<label class="addon' + (ch ? ' checked' : '') + '">' +
                '<span class="a-name">' + esc(a.name) + '</span>' +
                '<span class="a-price">+' + R + fmt(a.price) + '</span>' +
                '<input type="checkbox" data-addon="' + a.id + '" data-price="' + a.price + '" data-name="' + esc(a.name) + '"' + (ch ? ' checked' : '') + '>' +
                '</label>';
        }).join('');

        // Locked-in meal plan — derived from the package tier, not user-editable.
        // We still write the chosen value to a hidden #mealPlan input so the
        // existing wireEvents()/Razorpay notes pipeline keeps working unchanged.
        var meal = mealPlanForCart();
        // Persist on the cart for downstream consumers.
        state.cart.meals = meal.label;

        return '<div class="co-card"><h2><i class="fas fa-sliders-h"></i> Customize Your Trip</h2>' +
            '<div class="co-form-row">' +
                '<div class="co-field"><label>Duration Preference</label><select id="durationPref">' +
                    '<option value="">Standard (as per package)</option>' +
                    '<option>4 Nights / 5 Days</option><option>5 Nights / 6 Days</option>' +
                    '<option>6 Nights / 7 Days</option><option>7 Nights / 8 Days</option>' +
                '</select></div>' +
                '<div class="co-field">' +
                    '<label>Meal Plan <small style="color:#7a8b96;font-weight:500;">(included with package)</small></label>' +
                    '<div class="meal-plan-locked" title="' + esc(meal.note) + '">' +
                        '<i class="fas fa-utensils"></i> ' +
                        '<strong>' + esc(meal.label) + '</strong>' +
                        '<i class="fas fa-lock" style="margin-left:auto;font-size:.78rem;opacity:.55;" aria-hidden="true"></i>' +
                    '</div>' +
                    '<small style="display:block;color:#7a8b96;font-size:.78rem;margin-top:.3rem;line-height:1.45;">' + esc(meal.note) + '</small>' +
                    '<input type="hidden" id="mealPlan" value="' + esc(meal.label) + '">' +
                '</div>' +
            '</div>' +
            '<label style="display:block;font-weight:600;color:#2c3e50;font-size:.85rem;margin:.5rem 0 .5rem;text-transform:uppercase;letter-spacing:.4px;">Optional Add-ons</label>' +
            '<div class="addons">' + addonsH + '</div>' +
            '</div>';
    }

    function travelerCard() {
        var c = state.cart;
        return '<div class="co-card"><h2><i class="fas fa-user-edit"></i> Traveler Details</h2>' +
            '<div class="co-form-row">' +
                '<div class="co-field"><label>Full Name <span class="req">*</span></label><input type="text" id="travelerName" required placeholder="As per government ID"></div>' +
                '<div class="co-field"><label>Phone <span class="req">*</span></label><input type="tel" id="travelerPhone" required placeholder="+91 88801 95191"></div>' +
            '</div>' +
            '<div class="co-form-row">' +
                '<div class="co-field"><label>Email <span class="req">*</span></label><input type="email" id="travelerEmail" required placeholder="you@example.com"></div>' +
                '<div class="co-field"><label>Travel Date <span class="req">*</span></label><input type="date" id="travelerDate" required value="' + esc(c.travelDate || '') + '" min="' + new Date().toISOString().slice(0,10) + '"></div>' +
            '</div>' +
            '<div class="co-form-row full"><div class="co-field"><label>Special Requests (optional)</label><textarea id="travelerNotes" rows="2" placeholder="Anniversary, dietary preferences..."></textarea></div></div>' +
            '</div>';
    }

    function summaryCard() {
        var s = calcSubtotal();
        var couponD   = calcCouponDiscount(s);
        var customerD = calcCustomerDiscount(s);
        var d = couponD + customerD;
        if (d > s) d = s;
        var taxable = s - d, gst = calcGst(taxable), total = taxable + gst;
        var advance = calcAdvance();
        var balance = Math.max(0, total - advance);
        var c = state.cart;
        var people = headCount();
        var perHead = advancePerHead();
        var isLuxuryTier = perHead === ADVANCE_LUXURY;
        // Test packages still display the normal advance/total lines (so
        // the booking flow looks identical to staff doing a smoke test),
        // but the Pay button + handler bypass Razorpay entirely. We use
        // this flag below to swap the button label and skip the popup.
        var isTest = isTestPackage();

        // Cancellation rule values for this tier — keeps the UI in sync
        // with /terms#cancellation without re-reading anything.
        // Sliding scale (per head, refund grows the earlier you cancel):
        //   30+ days  → ₹4,000 (Budget/Std) / ₹6,500 (Luxury) refunded
        //   8–29 days → 50% of advance retained (rest refunded)
        //   0–7 days  → no refund — full advance forfeited
        var cxlRef30   = isLuxuryTier ? 6500 : 4000;        // ≥30d refund   / head
        var cxlFee30   = perHead - cxlRef30;                 // ≥30d retained / head
        var cxlFee8    = Math.round(perHead / 2);            // 50% of advance
        var cxlRef8    = perHead - cxlFee8;                  // remaining 50%
        var tierLabel  = isLuxuryTier ? 'Luxury / Premium / Honeymoon' : 'Budget / Standard';

        var couponHtml = state.coupon
            ? '<div class="coupon-applied"><i class="fas fa-check-circle"></i> ' + esc(state.coupon.code) + ' applied — ' + esc(state.coupon.label) + ' <a href="#" id="removeCouponLink" style="float:right;color:#0a5a68;">Remove</a></div>'
            : '';
        return '<div class="co-card summary"><h2><i class="fas fa-receipt"></i> Price Summary</h2>' +
            '<div class="co-form-row full"><div class="co-field"><label>Coupon Code</label>' +
                '<div class="coupon-row"><input type="text" id="couponInput" placeholder="WELCOME500 / ANDAMAN10" value="' + esc(state.coupon ? state.coupon.code : '') + '"><button id="applyCouponBtn" type="button">Apply</button></div>' +
                couponHtml +
            '</div></div>' +
            '<div class="row"><span>Base price (' + people + ' traveler' + (people !== 1 ? 's' : '') + ')</span><span>' + R + fmt(s) + '</span></div>' +
            (couponD > 0 ? '<div class="row" style="color:#0a5a68;"><span>Coupon discount</span><span>- ' + R + fmt(couponD) + '</span></div>' : '') +
            (customerD > 0 ? '<div class="row" style="color:#a04000;"><span><i class="fas fa-tags"></i> Loyalty discount (' + state.customerDiscount + '%' + (state.customerName ? ' &middot; ' + esc(state.customerName) : '') + ')</span><span>- ' + R + fmt(customerD) + '</span></div>' : '') +
            '<div class="row"><span>GST (5%)</span><span>' + R + fmt(gst) + '</span></div>' +
            '<div class="row total"><span>Total Trip Cost</span><span class="val">' + R + fmt(total) + '</span></div>' +

            // ── Active price-lock banner ──
            // When the customer has a paid, unexpired price-lock against
            // this package, surface it prominently — show how much credit
            // they already have, when it expires, and a one-click "Use my
            // lock" CTA that drives them straight into the discounted
            // advance flow. Also include a small "Cancel lock" link
            // (purely bookkeeping; the fee is non-refundable).
            (state.activeLock
                ? (function () {
                      var l = state.activeLock;
                      var paid = Number(l.totalPaid || 0);
                      var expMs = Number(l.expiresAtMs || (l.expiresAt && l.expiresAt.toMillis ? l.expiresAt.toMillis() : 0));
                      var msLeft = Math.max(0, expMs - Date.now());
                      var daysLeft = Math.ceil(msLeft / (24 * 60 * 60 * 1000));
                      var expStr = expMs ? new Date(expMs).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
                      return '<div class="active-lock-banner">' +
                          '<div class="active-lock-head"><i class="fas fa-stopwatch"></i> Price-Lock Active</div>' +
                          '<div class="active-lock-body">' +
                              '<div><strong>' + R + fmt(paid) + '</strong> already paid &middot; deducted from your advance.</div>' +
                              '<div class="active-lock-expiry"><i class="fas fa-clock"></i> Valid until <strong>' + esc(expStr) + '</strong>' +
                                  (daysLeft > 0 ? ' (' + daysLeft + ' day' + (daysLeft !== 1 ? 's' : '') + ' left)' : ' (expires today)') +
                              '</div>' +
                              '<div class="active-lock-ref" style="font-size:.78rem;color:#5a6877;margin-top:.25rem;">Lock ref: ' + esc(l.lockRef || l.id || '') + '</div>' +
                          '</div>' +
                          '<a href="#" id="cancelActiveLockLink" class="active-lock-cancel">Cancel lock</a>' +
                      '</div>';
                  })()
                : '') +

            // Advance / balance split — flat ₹6K / ₹11K per head, NOT a %.
            // When advance is 0 (admin-issued comp / 100 %-discount coupon) we
            // collapse the "Pay now" line and just promise full settlement
            // during/after the trip — the Razorpay step is skipped entirely.
            // For test packages we DISPLAY the normal advance figure (so
            // staff can verify the math) but mark it as "TEST — no charge"
            // and the Pay button below skips Razorpay.
            '<div class="advance-split">' +
                (isTest
                    ? '<div class="row" style="color:#0a5a68;"><span><i class="fas fa-flask"></i> Pay now <small>(' + R + fmt(perHead) + ' &times; ' + people + ' &mdash; test package)</small></span><span class="adv-amt"><strong>' + R + fmt(advance) + '</strong> <small style="color:#7a8b96;">(test &mdash; no charge)</small></span></div>'
                    : (advance > 0
                        ? '<div class="row"><span><i class="fas fa-credit-card"></i> Pay now <small>(' + R + fmt(perHead) + ' &times; ' + people + ' ' + (people === 1 ? 'traveller' : 'travellers') + ')</small></span><span class="adv-amt">' + R + fmt(advance) + '</span></div>'
                        : '<div class="row" style="color:#0a5a68;"><span><i class="fas fa-gift"></i> Pay now</span><span class="adv-amt"><strong>FREE</strong> &mdash; no advance required</span></div>')) +
                '<div class="row" style="color:#5a6877;font-size:.9rem;"><span><i class="fas fa-handshake"></i> ' + ((advance > 0 && !isTest) ? 'Balance during or after travel' : 'Pay during or after travel') + '</span><span>' + R + fmt(balance) + '</span></div>' +
            '</div>' +
            (isTest
                ? '<div style="background:#fff8e7;color:#8a6d3b;border-left:3px solid #f39c12;padding:.65rem .9rem;border-radius:6px;margin:.6rem 0 1rem;font-size:.85rem;line-height:1.5;"><i class="fas fa-flask"></i> <strong>Test booking</strong> &mdash; this package skips the Razorpay payment step. The booking will be confirmed instantly with no money charged. Use this to validate the end-to-end flow.</div>'
                : '') +

            // Mandatory T&C / Cancellation acceptance — Pay button stays
            // disabled until this is ticked. Customers must explicitly
            // acknowledge BOTH the Terms & Conditions and the Cancellation
            // Policy before any money changes hands; this is required by
            // Razorpay's merchant guidelines for travel/refund-eligible
            // bookings and protects us in any future dispute.
            // The two links open inline modals (so the customer doesn't
            // navigate away from the cart) — see openPolicyModal() below.
            '<label class="tnc-accept" for="tncAcceptBox">' +
                '<input type="checkbox" id="tncAcceptBox">' +
                '<span>I have read and agree to the ' +
                    '<a href="#" data-policy="terms">Terms &amp; Conditions</a>' +
                    ' and the ' +
                    '<a href="#" data-policy="cancel">Cancellation Policy</a>.' +
                '</span>' +
            '</label>' +

            '<button class="btn-pay" id="payBtn" disabled' + (isTest ? ' data-test-booking="1"' : '') + '>' +
                (isTest
                    ? '<i class="fas fa-flask"></i> Confirm Test Booking &mdash; No Payment'
                    : (advance > 0
                        ? '<i class="fas fa-lock"></i> Pay ' + R + fmt(advance) + ' Advance &amp; Confirm'
                        : '<i class="fas fa-check-circle"></i> Confirm Booking &mdash; No Payment Now')) +
            '</button>' +

            // ── Price-Lock alternative ─────────────────────────────
            // Customers who aren't ready to commit to the full advance
            // can pay ₹500/head NOW to lock today's price for 10 days.
            // The fee is non-refundable; if they convert to a booking
            // within the window, the ₹500/head is deducted from the
            // advance. After 10 days the lock expires (fee forfeited).
            // We hide this option for test packages, zero-advance carts,
            // and when an active lock is already in effect (in which
            // case the cart already shows the discounted advance).
            (!isTest && advance > 0 && !state.activeLock
                ? '<div class="lock-divider"><span>OR</span></div>' +
                  '<button class="btn-lock" id="lockBtn" type="button" disabled>' +
                      '<i class="fas fa-stopwatch"></i> Lock this price for 10 days &mdash; ' +
                      R + fmt(LOCK_PRICE_PER_HEAD * people) +
                      ' <small>(' + R + fmt(LOCK_PRICE_PER_HEAD) + ' &times; ' + people + ', non-refundable)</small>' +
                  '</button>' +
                  '<small class="lock-help"><i class="fas fa-info-circle"></i> Pay ' + R + fmt(LOCK_PRICE_PER_HEAD) + '/head now to freeze today&apos;s price for 10 days. ' +
                      'Convert to a full booking within 10 days and the lock fee is deducted from the advance. ' +
                      'After 10 days the lock expires and the fee is forfeited (non-refundable).</small>'
                : '') +

            // Embedded Razorpay container — checkout renders inline here (no popup)
            '<div id="rzp-embed-container" class="rzp-embed-container" style="display:none;"></div>' +
            '<a href="/#packages" style="text-decoration:none;"><button class="btn-secondary" type="button"><i class="fas fa-arrow-left"></i> Continue Browsing</button></a>' +

            // Cancellation policy summary — three-tier sliding scale.
            // Single source of truth duplicated in /terms#cancellation and
            // in the POLICY_HTML.cancel modal below; keep all three in sync.
            '<div class="cxl-policy">' +
                '<strong><i class="fas fa-info-circle"></i> Cancellation Policy <small style="font-weight:500;color:#5a6877;">— ' + esc(tierLabel) + ', ' + R + fmt(perHead) + '/head advance</small></strong>' +
                '<ul>' +
                    '<li><strong>30 days or more</strong> before travel: ' + R + fmt(cxlFee30) + '/head retained &mdash; <strong>' + R + fmt(cxlRef30) + '/head refunded</strong>.</li>' +
                    '<li><strong>8 – 29 days</strong> before travel: 50% of advance retained &mdash; <strong>' + R + fmt(cxlRef8) + '/head refunded</strong>.</li>' +
                    '<li><strong>0 – 7 days</strong> before travel (or no-show): <strong>no refund</strong> &mdash; full advance forfeited.</li>' +
                '</ul>' +
                '<small>Balance of ' + R + fmt(balance) + ' is paid directly during or after your trip — UPI / bank transfer / cash. <a href="/terms#cancellation" style="color:#0a5a68;">Full policy →</a></small>' +
            '</div>' +

            '<div class="payment-trust"><i class="fas fa-shield-alt"></i> Secured by Razorpay &middot; PCI-DSS compliant<br><i class="fas fa-headset"></i> 24/7 support: <a href="tel:+918880195191" style="color:#0a5a68;font-weight:600;">+91 88801 95191</a></div>' +
            '</div>';
    }

    function render() {
        var wrap = document.getElementById('checkoutWrap');
        if (!wrap) return;
        if (!state.cart) { wrap.innerHTML = emptyHtml(); return; }
        wrap.innerHTML = '<div>' + cartCard() + customizeCard() + travelerCard() + '</div><div>' + summaryCard() + '</div>';
        wireEvents();
        if (window.__authInstance && window.__authInstance.currentUser) prefillFromUser(window.__authInstance.currentUser);
        else prefillFromUser({});
    }

    function wireEvents() {
        var c = state.cart;
        if (!c) return;

        document.querySelectorAll('.addon input[type="checkbox"]').forEach(function (cb) {
            cb.addEventListener('change', function () {
                var id = cb.dataset.addon, nm = cb.dataset.name, pr = parseInt(cb.dataset.price, 10) || 0;
                if (cb.checked) {
                    if (!c.addons.some(function (a) { return a.id === id; })) c.addons.push({ id: id, name: nm, price: pr });
                } else {
                    c.addons = c.addons.filter(function (a) { return a.id !== id; });
                }
                saveCart();
                render();
            });
        });

        var dur = document.getElementById('durationPref');
        if (dur) { dur.value = c.duration_pref || ''; dur.addEventListener('change', function () { c.duration_pref = dur.value; saveCart(); }); }
        var meals = document.getElementById('mealPlan');
        if (meals) { meals.value = c.meals || ''; meals.addEventListener('change', function () { c.meals = meals.value; saveCart(); }); }

        var rm = document.getElementById('removeItemBtn');
        if (rm) rm.addEventListener('click', function () {
            window.Toast.confirm('Remove this package from your cart?', { danger: true, yesLabel: 'Remove' }).then(function (yes) {
                if (!yes) return;
                state.cart = null; state.coupon = null;
                try { sessionStorage.removeItem('checkoutCart'); } catch (e) {}
                render();
            });
        });

        var apply = document.getElementById('applyCouponBtn');
        if (apply) apply.addEventListener('click', applyCoupon);
        var inp = document.getElementById('couponInput');
        if (inp) inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); applyCoupon(); } });

        var rmCo = document.getElementById('removeCouponLink');
        if (rmCo) rmCo.addEventListener('click', function (e) { e.preventDefault(); state.coupon = null; window.Toast.info('Coupon removed.'); render(); });

        var pay = document.getElementById('payBtn');
        if (pay) pay.addEventListener('click', startPayment);

        // Lock-this-price button — second checkout option.
        var lockBtn = document.getElementById('lockBtn');
        if (lockBtn) lockBtn.addEventListener('click', startLockPayment);

        // T&C / Cancellation acceptance gate — toggle BOTH the Pay
        // button's and the Lock-Price button's enabled state directly
        // off the checkbox, so the user gets visual feedback the moment
        // they tick it. Both options require the same acceptance.
        var tncBox = document.getElementById('tncAcceptBox');
        if (tncBox) {
            tncBox.addEventListener('change', function () {
                if (pay)     pay.disabled     = !tncBox.checked;
                if (lockBtn) lockBtn.disabled = !tncBox.checked;
            });
        }

        // "Use my lock" — convert active price-lock into the full
        // booking. Same flow as the regular Pay button, the advance
        // calculation already knows about state.activeLock.
        var useLockBtn = document.getElementById('useLockBtn');
        if (useLockBtn) useLockBtn.addEventListener('click', startPayment);

        // "Cancel lock" — flip the lock to status='cancelled'. The
        // ₹500/head fee is non-refundable so this is just bookkeeping
        // (it stops the lock showing up as "active" on the customer's
        // /bookings page).
        var cancelLockLink = document.getElementById('cancelActiveLockLink');
        if (cancelLockLink) cancelLockLink.addEventListener('click', function (e) {
            e.preventDefault();
            window.Toast.confirm(
                'Cancel this price-lock? The ' + R + fmt(state.activeLock.totalPaid || 0) +
                ' you paid is non-refundable and will be forfeited.',
                { danger: true, yesLabel: 'Yes, cancel lock' }
            ).then(function (yes) {
                if (!yes) return;
                if (!window.LocksStore || !window.LocksStore.cancelLock) return;
                window.LocksStore.cancelLock(state.activeLock.lockRef || state.activeLock.id)
                    .then(function () {
                        window.Toast.info('Price-lock cancelled. The fee is forfeited.');
                        state.activeLock = null;
                        render();
                    })
                    .catch(function (err) {
                        window.Toast.error(err && err.message || 'Could not cancel the lock.');
                    });
            });
        });

        // Wire the T&C / Cancellation policy inline-modal links. We
        // intentionally use data-policy attributes (not target="_blank")
        // so the customer never leaves the cart page.
        document.querySelectorAll('.tnc-accept a[data-policy]').forEach(function (a) {
            a.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();         // don't toggle the checkbox
                openPolicyModal(a.dataset.policy);
            });
        });
    }

    // ── Policy modal — Terms & Conditions / Cancellation Policy ──────
    // Inline modal so the customer doesn't lose their cart by navigating
    // to /terms. Content is hard-coded here (single source of truth lives
    // at /terms — but for the in-checkout summary we keep a tighter
    // version that's faster to scan and matches what they're agreeing to).
    var POLICY_HTML = {
        terms: [
            '<h3><i class="fas fa-file-contract"></i> Terms &amp; Conditions</h3>',
            '<p style="color:#888;font-size:.85rem;margin:0 0 1rem;">Last updated: 22 May 2026 &middot; <a href="/terms" target="_blank" rel="noopener" style="color:#0a5a68;">View full terms in new tab →</a></p>',
            '<h4>1. Booking &amp; Payment</h4>',
            '<ul>',
                '<li>To confirm a booking, a <strong>per-person booking advance</strong> is required:',
                    '<ul>',
                        '<li>Budget &amp; Standard: <strong>₹6,000 / traveller</strong></li>',
                        '<li>Luxury / Premium / Honeymoon: <strong>₹11,000 / traveller</strong></li>',
                    '</ul>',
                '</li>',
                '<li>The remaining balance is paid directly to us <strong>during or after your trip</strong> — UPI, bank transfer or cash.</li>',
                '<li>Booking is confirmed only after we send a written confirmation (email/WhatsApp).</li>',
            '</ul>',
            '<h4>2. Inclusions &amp; Exclusions</h4>',
            '<p>Each package page lists exactly what\'s included. Anything not explicitly mentioned is treated as an exclusion. Common exclusions: airfare, lunch &amp; dinner, optional water sports, personal expenses, travel insurance.</p>',
            '<h4>3. Travel Documents</h4>',
            '<p>Indian citizens: valid government photo ID. Foreign nationals: valid passport + Restricted Area Permit (free on arrival at Port Blair airport).</p>',
            '<h4>4. Force Majeure</h4>',
            '<p>We are not liable for delays / cancellations caused by weather (cyclones, rough seas), flight or ferry cancellations, government restrictions, civil unrest, pandemics, strikes, or any acts of God. Best-effort alternative arrangements only.</p>',
            '<h4>5. Behaviour &amp; Liability</h4>',
            '<p>The Company is a tour operator and does not own/operate suppliers (hotels, ferries, dive operators). Liability is limited to the booking cost. Travel insurance is strongly advised.</p>',
            '<h4>6. Governing Law</h4>',
            '<p>Governed by the laws of India. Disputes are subject to the exclusive jurisdiction of the courts of Kolkata, West Bengal.</p>'
        ].join(''),
        cancel: [
            '<h3><i class="fas fa-info-circle"></i> Cancellation &amp; Refund Policy</h3>',
            '<p style="color:#888;font-size:.85rem;margin:0 0 1rem;">Last updated: 26 May 2026 &middot; <a href="/terms#cancellation" target="_blank" rel="noopener" style="color:#0a5a68;">View full policy in new tab →</a></p>',
            '<p>Cancellations must be requested in writing at <a href="mailto:cancellation@andamanvoyages.in" style="color:#0a5a68;">cancellation@andamanvoyages.in</a> with your Booking Reference. Refunds follow a <strong>three-tier sliding scale</strong> based on how many days are left before your travel start date.</p>',
            '<div style="overflow-x:auto;margin:1rem 0;">',
              '<table class="cxl-table" style="width:100%;border-collapse:collapse;font-size:.92rem;">',
                '<thead>',
                  '<tr style="background:#0d7a8a;color:#fff;text-align:left;">',
                    '<th style="padding:.7rem .8rem;font-weight:700;">Days before travel</th>',
                    '<th style="padding:.7rem .8rem;font-weight:700;">Budget / Standard<br><small style="opacity:.8;font-weight:500;">(₹6,000 advance / head)</small></th>',
                    '<th style="padding:.7rem .8rem;font-weight:700;">Luxury / Premium / Honeymoon<br><small style="opacity:.8;font-weight:500;">(₹11,000 advance / head)</small></th>',
                  '</tr>',
                '</thead>',
                '<tbody>',
                  '<tr style="border-bottom:1px solid #e3e8ef;">',
                    '<td style="padding:.7rem .8rem;font-weight:700;">30 days or more</td>',
                    '<td style="padding:.7rem .8rem;">₹2,000 / head retained →<br><strong style="color:#0a5a68;">₹4,000 / head refunded</strong></td>',
                    '<td style="padding:.7rem .8rem;">₹4,500 / head retained →<br><strong style="color:#0a5a68;">₹6,500 / head refunded</strong></td>',
                  '</tr>',
                  '<tr style="border-bottom:1px solid #e3e8ef;background:#f9fbfc;">',
                    '<td style="padding:.7rem .8rem;font-weight:700;">8 – 29 days</td>',
                    '<td style="padding:.7rem .8rem;">50% of advance retained →<br><strong style="color:#0a5a68;">₹3,000 / head refunded</strong></td>',
                    '<td style="padding:.7rem .8rem;">50% of advance retained →<br><strong style="color:#0a5a68;">₹5,500 / head refunded</strong></td>',
                  '</tr>',
                  '<tr>',
                    '<td style="padding:.7rem .8rem;font-weight:700;">0 – 7 days <small style="font-weight:500;color:#7a8b96;">or no-show</small></td>',
                    '<td style="padding:.7rem .8rem;color:#c0392b;"><strong>No refund</strong> — full advance forfeited</td>',
                    '<td style="padding:.7rem .8rem;color:#c0392b;"><strong>No refund</strong> — full advance forfeited</td>',
                  '</tr>',
                '</tbody>',
              '</table>',
            '</div>',
            '<p style="margin-top:1rem;"><strong>Worked example:</strong> A family of 4 books a Standard package and pays ₹6,000 × 4 = ₹24,000 advance.',
            '<ul>',
              '<li>Cancel <strong>35 days</strong> before travel → refund = ₹4,000 × 4 = <strong>₹16,000</strong>.</li>',
              '<li>Cancel <strong>20 days</strong> before travel → refund = ₹3,000 × 4 = <strong>₹12,000</strong>.</li>',
              '<li>Cancel <strong>5 days</strong> before travel → <strong>no refund</strong>; full ₹24,000 forfeited.</li>',
            '</ul></p>',
            '<p><strong>Note:</strong> Non-refundable third-party charges (flight tickets, peak-season ferry bookings, hotel pre-payment penalties) are deducted in addition to the slabs above. Approved refunds are processed within 7–10 working days to the original payment method.</p>',

            // ── Price-Lock terms (separate from booking advance) ──
            // Customers who pay the ₹500/head price-lock fee are subject
            // to a different (simpler) refund rule: the fee is always
            // non-refundable. We surface that here so they don\'t click
            // "I agree" thinking the standard booking-cancellation slabs
            // also apply to the lock fee.
            '<h4 style="margin-top:1.5rem;color:#0a5a68;"><i class="fas fa-stopwatch"></i> Price-Lock Fee — Special Rules</h4>',
            '<p>If you choose to <strong>lock today\'s price for 10 days</strong> (₹500 per traveller fee) instead of paying the full booking advance:</p>',
            '<ul>',
              '<li>The lock fee is <strong>strictly non-refundable</strong>. It buys you 10 days of price protection — that protection has been delivered the moment you pay.</li>',
              '<li>If you <strong>convert the lock into a confirmed booking within 10 days</strong>, the entire ₹500/head you paid is <strong>deducted from the booking advance</strong>. You only pay the difference.</li>',
              '<li>If you <strong>do not book within 10 days</strong>, the lock automatically expires and the fee is forfeited. The price you locked is no longer guaranteed.</li>',
              '<li>You may cancel an active price-lock at any time, but the fee is still <strong>not returned</strong>. Cancellation only stops the lock from showing as "active" in your account.</li>',
              '<li>Locks are <strong>tied to the package and headcount</strong> at the time of payment. Changing the package or adding travellers may require a fresh lock.</li>',
            '</ul>',
            '<p style="background:#fff8e7;color:#8a6d3b;border-left:3px solid #f39c12;padding:.6rem .9rem;border-radius:6px;margin:.8rem 0 0;font-size:.88rem;line-height:1.5;"><strong>In short:</strong> Lock fee is non-refundable. Book within 10 days → it counts toward your advance. Don\'t book within 10 days → fee is lost.</p>'
        ].join('')
    };

    function openPolicyModal(which) {
        var html = POLICY_HTML[which];
        if (!html) return;
        // Lazy-create the overlay once, reuse it for both policies.
        var modal = document.getElementById('policyModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'policyModal';
            modal.className = 'policy-modal';
            modal.innerHTML =
                '<div class="policy-modal-card" role="dialog" aria-modal="true" aria-labelledby="policyModalTitle">' +
                    '<button type="button" class="policy-modal-close" aria-label="Close">&times;</button>' +
                    '<div class="policy-modal-body" id="policyModalBody"></div>' +
                    '<div class="policy-modal-foot">' +
                        '<button type="button" class="btn-pay" id="policyAcceptBtn" style="margin:0;">' +
                            '<i class="fas fa-check"></i> I have read &amp; understood' +
                        '</button>' +
                    '</div>' +
                '</div>';
            document.body.appendChild(modal);

            // Click outside the card → close
            modal.addEventListener('click', function (e) {
                if (e.target === modal) closePolicyModal();
            });
            modal.querySelector('.policy-modal-close').addEventListener('click', closePolicyModal);
            modal.querySelector('#policyAcceptBtn').addEventListener('click', function () {
                // Auto-tick the T&C checkbox when user clicks "I have read"
                // and close the modal — saves them an extra click.
                var box = document.getElementById('tncAcceptBox');
                if (box) {
                    box.checked = true;
                    var pay = document.getElementById('payBtn');
                    if (pay) pay.disabled = false;
                }
                closePolicyModal();
            });
            // ESC key closes
            document.addEventListener('keydown', function (e) {
                if (e.key === 'Escape' && modal.classList.contains('open')) closePolicyModal();
            });
        }
        document.getElementById('policyModalBody').innerHTML = html;
        modal.classList.add('open');
        // Trap scroll on body so the page behind doesn't move while the
        // overlay is open (a common UX bug with iframe checkouts).
        document.body.style.overflow = 'hidden';
    }
    function closePolicyModal() {
        var modal = document.getElementById('policyModal');
        if (!modal) return;
        modal.classList.remove('open');
        document.body.style.overflow = '';
    }

    function applyCoupon() {
        var inp = document.getElementById('couponInput');
        if (!inp) return;
        var code = (inp.value || '').trim().toUpperCase();
        if (!code) { window.Toast.warning('Please enter a coupon code.'); return; }
        var co = COUPONS[code];

        // ── Dynamic LAUNCH coupon (admin-configured in SettingsStore) ──
        // If the entered code matches the launch-advance coupon AND the
        // admin has the toggle ON, fabricate a coupon object that:
        //   • Doesn't discount the trip cost (type:flat, value:0)
        //   • Sets advanceOverride so advancePerHead() returns the flat
        //     amount (e.g. ₹2,000) instead of ₹6K/₹11K.
        if (!co) {
            try {
                var settings = (window.SettingsStore && typeof window.SettingsStore.cached === 'function')
                    ? window.SettingsStore.cached() : null;
                if (settings &&
                    settings.launchAdvanceCouponEnabled === true &&
                    String(settings.launchAdvanceCouponCode || '').toUpperCase() === code) {
                    var flat = Math.max(500, Number(settings.launchAdvanceCouponAmount) || 2000);
                    co = {
                        type: 'flat',
                        value: 0,
                        min: 0,
                        label: '₹' + flat.toLocaleString('en-IN') + '/head advance — pay rest later',
                        advanceOverride: flat
                    };
                }
            } catch (_) {}
        }

        if (!co) { window.Toast.error('Invalid coupon code.'); return; }
        var s = calcSubtotal();
        if (s < (co.min || 0)) { window.Toast.warning('This coupon needs a minimum order of ' + R + fmt(co.min) + '.'); return; }
        state.coupon = Object.assign({ code: code }, co);
        window.Toast.success('Coupon applied! ' + co.label);
        render();
    }

    function validate() {
        var errs = [];
        var n = (document.getElementById('travelerName') || {}).value || '';
        var em = (document.getElementById('travelerEmail') || {}).value || '';
        var p = (document.getElementById('travelerPhone') || {}).value || '';
        var dt = (document.getElementById('travelerDate') || {}).value || '';
        if (n.trim().length < 2) errs.push('Please enter your full name.');
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) errs.push('Please enter a valid email.');
        if ((p.match(/\d/g) || []).length < 8) errs.push('Please enter a valid phone (at least 8 digits).');
        // Travel date — required, must not be in the past.
        if (!dt) {
            errs.push('Please select a Travel Date.');
        } else {
            var today = new Date(); today.setHours(0, 0, 0, 0);
            var picked = new Date(dt + 'T00:00:00');
            if (isNaN(picked.getTime())) {
                errs.push('Travel Date is invalid.');
            } else if (picked < today) {
                errs.push('Travel Date cannot be in the past.');
            }
        }
        return errs;
    }

    function startPayment() {
        if (!state.cart) return;
        // T&C / Cancellation policy must be accepted first. We check this
        // up-front (before login / validation) because if the user hasn't
        // ticked the box we don't even want to send them through the rest
        // of the funnel — show the warning, focus the checkbox, and stop.
        var tncBox = document.getElementById('tncAcceptBox');
        if (tncBox && !tncBox.checked) {
            window.Toast.warning('Please accept the Terms & Conditions and Cancellation Policy to continue.', { duration: 5000 });
            try { tncBox.focus({ preventScroll: false }); tncBox.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
            return;
        }
        if (!isLoggedIn()) {
            try { sessionStorage.setItem('postLoginIntent', JSON.stringify({ type: 'checkout', ts: Date.now() })); } catch (e) {}
            window.Toast.info('Please log in to continue with payment.', { duration: 3000 });
            setTimeout(function () { window.location.href = '/#login'; }, 700);
            return;
        }
        // Require verified email (admins exempt). This prevents bookings
        // from accounts where the email address might not be reachable.
        var u = window.__authInstance && window.__authInstance.currentUser;
        var ADMIN_EMAILS = (Array.isArray(window.ADMIN_EMAILS) && window.ADMIN_EMAILS.length)
            ? window.ADMIN_EMAILS.map(function (e) { return String(e).toLowerCase(); })
            : [];
        var isAdmin = u && u.email && ADMIN_EMAILS.indexOf(String(u.email).toLowerCase()) >= 0;
        if (u && !u.emailVerified && !isAdmin) {
            window.Toast.warning(
                'Please verify your email before booking. We sent a verification link to ' +
                u.email + ' when you registered. Click that link, then refresh this page.',
                { duration: 9000 }
            );
            // Offer one-tap resend
            if (window.UsersStore && window.UsersStore.resendEmailVerification) {
                window.Toast.confirm(
                    'Resend the verification email to ' + u.email + '?',
                    { yesLabel: 'Yes, resend' }
                ).then(function (yes) {
                    if (!yes) return;
                    window.UsersStore.resendEmailVerification()
                        .then(function () { window.Toast.success('Verification email re-sent. Check your inbox.'); })
                        .catch(function (err) { window.Toast.error(err && err.message || 'Could not resend.'); });
                });
            }
            return;
        }
        var errs = validate();
        if (errs.length) { window.Toast.warning(errs.join('\n')); return; }

        var total   = calcTotal();
        var advance = calcAdvance();
        var balance = total - advance;
        var ref = 'BTT' + Date.now().toString().slice(-8) + Math.random().toString(36).slice(2, 4).toUpperCase();
        var name = document.getElementById('travelerName').value.trim();
        var email = document.getElementById('travelerEmail').value.trim();
        var phone = document.getElementById('travelerPhone').value.trim();
        var date = (document.getElementById('travelerDate') || {}).value || '';
        var notes = (document.getElementById('travelerNotes') || {}).value || '';

        // ── Test-package shortcut ───────────────────────────────
        // The "Payment Test Package" (any package with 'test' in its id
        // or name) skips Razorpay entirely so staff can validate the
        // booking flow end-to-end without a live charge. The booking
        // record stores the *displayed* advance/total so reports look
        // right, but payment_id is prefixed TEST- so admins can spot
        // and filter test rows out of revenue stats.
        if (isTestPackage()) {
            try {
                window.Analytics && window.Analytics.beginCheckout({
                    id:    state.cart.pkgId,
                    name:  state.cart.name,
                    price: total,
                    category: 'package'
                }, total);
            } catch (e) {}
            // Force advance/balance to 0 so the booking record + email
            // never claim "₹X paid" for a test booking — the customer
            // (staff) didn't actually pay anything.
            var testResp = { razorpay_payment_id: 'TEST-' + ref };
            onPaymentSuccess(testResp, ref, total, 0, total, name, email, phone, date, notes);
            return;
        }

        // ── Zero-advance shortcut ────────────────────────────────
        // If the cart's advance is ₹0 (admin-issued comp / 100%-discount
        // coupon / launch coupon set to zero) we don't need to open the
        // Razorpay gateway at all. Build a synthetic "payment" response
        // and confirm the booking directly. Customer still gets the same
        // confirmation email + booking record; payment_id is prefixed
        // with FREE- so admins can spot it in the dashboard at a glance.
        if (advance <= 0) {
            try {
                window.Analytics && window.Analytics.beginCheckout({
                    id:    state.cart.pkgId,
                    name:  state.cart.name,
                    price: total,
                    category: 'package'
                }, total);
            } catch (e) {}
            var fakeResp = { razorpay_payment_id: 'FREE-' + ref };
            onPaymentSuccess(fakeResp, ref, total, advance, balance, name, email, phone, date, notes);
            return;
        }

        if (typeof Razorpay === 'undefined') { window.Toast.error('Payment gateway not loaded. Please refresh.'); return; }

        var payBtn = document.getElementById('payBtn');
        var payBtnLabel = '<i class="fas fa-lock"></i> Pay ' + R + fmt(advance) + ' Advance &amp; Confirm';
        if (payBtn) { payBtn.disabled = true; payBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Opening payment...'; }

        // Show the embedded payment container (replaces the pay button + scrolls into view)
        var embedHost = document.getElementById('rzp-embed-container');
        if (embedHost) {
            embedHost.innerHTML = '<div class="rzp-embed-loading"><i class="fas fa-spinner fa-spin"></i> Loading secure payment form…</div>';
            embedHost.style.display = 'block';
            try { embedHost.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
        }

        var rzpOptions = {
            key: RAZORPAY_KEY,
            amount: advance * 100,            // ← charge only the 5% advance
            currency: 'INR',
            name: 'Bharat Transport & Tourism',
            description: 'Booking advance (' + R + Number(advancePerHead()).toLocaleString('en-IN') + '/head x ' + headCount() + ') for ' + state.cart.name + ' (Ref ' + ref + ')',
            image: 'https://andamanvoyages.in/images/logo.png',
            prefill: { name: name, email: email, contact: phone },
            notes: {
                booking_ref: ref,
                package: state.cart.pkgId,
                adults: String(state.cart.adults),
                children: String(state.cart.children),
                travel_date: date,
                addons: (state.cart.addons || []).map(function (a) { return a.name; }).join(', '),
                coupon: state.coupon ? state.coupon.code : '',
                special_requests: notes,
                total_trip_cost: String(total),
                advance_paid:    String(advance),
                balance_due:     String(balance),
                payment_type:    'advance_per_head'
            },
            theme: { color: '#0d7a8a' },
            handler: function (response) { onPaymentSuccess(response, ref, total, advance, balance, name, email, phone, date, notes); },
            modal: {
                ondismiss: function () {
                    if (payBtn) { payBtn.disabled = false; payBtn.innerHTML = payBtnLabel; }
                    if (embedHost) { embedHost.style.display = 'none'; embedHost.innerHTML = ''; }
                    window.Toast.info('Payment cancelled.');
                }
            }
        };
        // Razorpay's parent_id option embeds the checkout inline inside the
        // given container instead of opening it as a floating modal popup.
        // If unsupported by the loaded SDK, Razorpay silently falls back to
        // the popup, so this is safe to set.
        if (embedHost) rzpOptions.parent_id = 'rzp-embed-container';

        var rzp = new Razorpay(rzpOptions);

        rzp.on('payment.failed', function (r) {
            if (payBtn) { payBtn.disabled = false; payBtn.innerHTML = payBtnLabel; }
            if (embedHost) { embedHost.style.display = 'none'; embedHost.innerHTML = ''; }
            window.Toast.error('Payment failed: ' + ((r && r.error && r.error.description) || 'Unknown error'), { duration: 8000 });
            try { window.Analytics && window.Analytics.track('payment_failed', { value: advance, currency: 'INR' }); } catch (e) {}
        });

        // GA4 — checkout funnel step (track full trip value as the conversion goal)
        try {
            window.Analytics && window.Analytics.beginCheckout({
                id:    state.cart.pkgId,
                name:  state.cart.name,
                price: total,
                category: 'package'
            }, total);
        } catch (e) {}

        rzp.open();
    }

    // ── Price-Lock payment flow ──────────────────────────────────────
    // Pay ₹500 / head NOW to freeze today's package price for 10 days.
    // Mirrors startPayment() but charges only the lock fee, writes a
    // /priceLocks/{lockRef} doc instead of /bookings/{bookingRef}, and
    // shows a "lock confirmed" success screen with countdown CTA.
    //
    // The fee is non-refundable. If the customer converts the lock to
    // a booking within the 10-day window, calcAdvance() automatically
    // deducts the fee from the advance. After 10 days the lock expires
    // and the fee is forfeited (status flips to 'expired' on next
    // listMyLocks() call from /bookings).
    function startLockPayment() {
        if (!state.cart) return;

        // Same gates as the regular pay flow — T&C, login, email
        // verification, traveler details. Customers are committing
        // real money for a real refund-eligible product.
        var tncBox = document.getElementById('tncAcceptBox');
        if (tncBox && !tncBox.checked) {
            window.Toast.warning('Please accept the Terms & Conditions and Cancellation Policy to continue.', { duration: 5000 });
            try { tncBox.focus({ preventScroll: false }); tncBox.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
            return;
        }
        if (!isLoggedIn()) {
            try { sessionStorage.setItem('postLoginIntent', JSON.stringify({ type: 'checkout', ts: Date.now() })); } catch (e) {}
            window.Toast.info('Please log in to lock this price.', { duration: 3000 });
            setTimeout(function () { window.location.href = '/#login'; }, 700);
            return;
        }
        var u = window.__authInstance && window.__authInstance.currentUser;
        var ADMIN_EMAILS = (Array.isArray(window.ADMIN_EMAILS) && window.ADMIN_EMAILS.length)
            ? window.ADMIN_EMAILS.map(function (e) { return String(e).toLowerCase(); })
            : [];
        var isAdmin = u && u.email && ADMIN_EMAILS.indexOf(String(u.email).toLowerCase()) >= 0;
        if (u && !u.emailVerified && !isAdmin) {
            window.Toast.warning(
                'Please verify your email before locking a price. Check ' + u.email + ' for the link.',
                { duration: 8000 }
            );
            return;
        }
        var errs = validate();
        if (errs.length) { window.Toast.warning(errs.join('\n')); return; }

        var people  = headCount();
        var lockFee = LOCK_PRICE_PER_HEAD * people;
        var lockRef = 'BTL' + Date.now().toString().slice(-8) + Math.random().toString(36).slice(2, 4).toUpperCase();
        var name    = document.getElementById('travelerName').value.trim();
        var email   = document.getElementById('travelerEmail').value.trim();
        var phone   = document.getElementById('travelerPhone').value.trim();
        var date    = (document.getElementById('travelerDate') || {}).value || '';
        var notes   = (document.getElementById('travelerNotes') || {}).value || '';

        if (typeof Razorpay === 'undefined') {
            window.Toast.error('Payment gateway not loaded. Please refresh.');
            return;
        }

        var lockBtn = document.getElementById('lockBtn');
        var lockBtnLabel = '<i class="fas fa-stopwatch"></i> Lock this price for 10 days &mdash; ' +
            R + fmt(lockFee) + ' <small>(' + R + fmt(LOCK_PRICE_PER_HEAD) + ' &times; ' + people + ', non-refundable)</small>';
        if (lockBtn) {
            lockBtn.disabled = true;
            lockBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Opening payment...';
        }

        var embedHost = document.getElementById('rzp-embed-container');
        if (embedHost) {
            embedHost.innerHTML = '<div class="rzp-embed-loading"><i class="fas fa-spinner fa-spin"></i> Loading secure payment form…</div>';
            embedHost.style.display = 'block';
            try { embedHost.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
        }

        var rzpOptions = {
            key:      RAZORPAY_KEY,
            amount:   lockFee * 100,
            currency: 'INR',
            name:     'Bharat Transport & Tourism',
            description: 'Price-lock fee (' + R + fmt(LOCK_PRICE_PER_HEAD) + '/head x ' + people +
                         ') for ' + state.cart.name + ' — 10-day validity (Ref ' + lockRef + ')',
            image:    'https://andamanvoyages.in/images/logo.png',
            prefill:  { name: name, email: email, contact: phone },
            notes: {
                lock_ref:       lockRef,
                package:        state.cart.pkgId,
                adults:         String(state.cart.adults),
                children:       String(state.cart.children),
                travel_date:    date,
                payment_type:   'price_lock',
                lock_validity:  '10_days',
                fee_per_head:   String(LOCK_PRICE_PER_HEAD),
                total_lock_fee: String(lockFee),
                non_refundable: 'true'
            },
            theme: { color: '#0d7a8a' },
            handler: function (response) {
                onLockPaymentSuccess(response, lockRef, lockFee, people, name, email, phone, date, notes);
            },
            modal: {
                ondismiss: function () {
                    if (lockBtn) { lockBtn.disabled = false; lockBtn.innerHTML = lockBtnLabel; }
                    if (embedHost) { embedHost.style.display = 'none'; embedHost.innerHTML = ''; }
                    window.Toast.info('Lock payment cancelled.');
                }
            }
        };
        if (embedHost) rzpOptions.parent_id = 'rzp-embed-container';

        var rzp = new Razorpay(rzpOptions);
        rzp.on('payment.failed', function (r) {
            if (lockBtn) { lockBtn.disabled = false; lockBtn.innerHTML = lockBtnLabel; }
            if (embedHost) { embedHost.style.display = 'none'; embedHost.innerHTML = ''; }
            window.Toast.error('Lock payment failed: ' + ((r && r.error && r.error.description) || 'Unknown error'), { duration: 8000 });
        });
        rzp.open();
    }

    // Successful price-lock charge → write the lock doc and show
    // confirmation screen. We deliberately DO NOT clear the cart —
    // the customer still has 10 days to come back and convert it.
    //
    // Resilience strategy (after the 2026-06 incident where a customer
    // paid ₹5,000 and saw "could not save the lock" with no recovery
    // path):
    //   1) ALWAYS write a fallback record to localStorage immediately,
    //      keyed under `pendingLocks`. This guarantees we have the
    //      payment id, lock ref, and amount on disk even before
    //      Firestore is touched. The customer can refresh, log in,
    //      come back later — the data is there.
    //   2) Try Firestore via LocksStore.createLock. If it throws because
    //      auth isn't ready yet, wait a moment and retry once.
    //   3) When Firestore eventually succeeds, clear the pendingLocks
    //      entry. When it fails for good, surface the REAL error
    //      message to the customer so they can give support actionable
    //      info, not just a generic "contact support".
    //   4) Either way, show the success screen — the money has already
    //      moved at Razorpay, so we don't ever go backwards on the UX.
    function onLockPaymentSuccess(response, lockRef, lockFee, people, name, email, phone, date, notes) {
        var paymentId = (response && response.razorpay_payment_id) || ('LOCK-' + lockRef);
        var pkg = state.cart || {};

        // Always-runs fallback: persist the lock locally so it never gets lost.
        var localRecord = {
            lockRef:       lockRef,
            packageId:     pkg.pkgId,
            packageName:   pkg.name,
            packagePrice:  pkg.price,
            people:        people,
            pricePerHead:  LOCK_PRICE_PER_HEAD,
            totalPaid:     lockFee,
            paymentId:     paymentId,
            travelerName:  name,
            travelerEmail: email,
            travelerPhone: phone,
            travelDate:    date,
            paidAt:        new Date().toISOString(),
            expiresAtMs:   Date.now() + LOCK_VALIDITY_MS,
            status:        'active',
            firestoreSaved: false
        };
        try {
            var pending = JSON.parse(localStorage.getItem('pendingLocks') || '[]');
            if (!Array.isArray(pending)) pending = [];
            // De-dupe: replace any existing entry for the same lockRef.
            pending = pending.filter(function (p) { return p && p.lockRef !== lockRef; });
            pending.push(localRecord);
            localStorage.setItem('pendingLocks', JSON.stringify(pending));
        } catch (lsErr) {
            console.warn('[checkout] could not write pendingLocks to localStorage:', lsErr);
        }

        // Always show the success screen first (money has moved). The
        // Firestore write happens in the background; we update the
        // success screen banner if it later fails / succeeds.
        state.activeLock = Object.assign({}, localRecord, { id: lockRef });
        renderLockSuccess(lockRef, paymentId, lockFee, people, email);

        // Try the Firestore save with one retry to handle the case
        // where Firebase auth isn't fully resolved at the moment the
        // Razorpay callback fires (common race in the embedded flow).
        function tryCreate() {
            if (!window.LocksStore || !window.LocksStore.createLock) {
                return Promise.reject(new Error('LocksStore is not loaded on this page.'));
            }
            return window.LocksStore.createLock({
                bookingRef:    lockRef,
                packageId:     pkg.pkgId,
                packageName:   pkg.name,
                packagePrice:  pkg.price,
                people:        people,
                pricePerHead:  LOCK_PRICE_PER_HEAD,
                totalPaid:     lockFee,
                paymentId:     paymentId,
                travelerName:  name,
                travelerEmail: email,
                travelerPhone: phone
            });
        }

        function markFirestoreOk(saved) {
            // Update the local pendingLocks entry so the recovery code
            // in onCheckoutInit() knows it's safe to drop next time.
            try {
                var pending = JSON.parse(localStorage.getItem('pendingLocks') || '[]');
                pending = pending.filter(function (p) { return p && p.lockRef !== lockRef; });
                localStorage.setItem('pendingLocks', JSON.stringify(pending));
            } catch (_) {}
            state.activeLock = Object.assign({
                id: (saved && saved.id) || lockRef,
                lockRef: lockRef,
                expiresAtMs: Date.now() + LOCK_VALIDITY_MS
            }, saved || {});
        }

        function bubbleError(err) {
            var msg = (err && (err.message || err.code)) || String(err || 'unknown');
            console.error('[checkout] LocksStore.createLock FAILED — payment_id=' + paymentId +
                ' lock_ref=' + lockRef + ' people=' + people + ' fee=' + lockFee, err);
            // Friendlier toast that surfaces what actually went wrong AND
            // reassures the customer that their money is safe + the lock
            // is recorded locally so support can recover it.
            window.Toast.error(
                'Payment received (₹' + fmt(lockFee) + ', ID ' + paymentId + '). ' +
                'Saving the lock to our database failed: ' + msg + '. ' +
                'Don\'t worry — your payment ID + lock reference (' + lockRef + ') are saved on this device. ' +
                'Please email booking@andamanvoyages.in or call +91 88801 95191 with these details.',
                { duration: 18000 }
            );
        }

        tryCreate().then(markFirestoreOk).catch(function (err1) {
            console.warn('[checkout] createLock first attempt failed, retrying in 1.5s:', err1);
            // One retry after a short delay to let Firebase auth settle
            setTimeout(function () {
                tryCreate().then(markFirestoreOk).catch(bubbleError);
            }, 1500);
        });
    }

    // Confirmation screen for a successful price-lock. Mirrors
    // renderSuccess() but with lock-specific copy + a clear "what
    // happens next" note.
    function renderLockSuccess(lockRef, paymentId, lockFee, people, email) {
        var wrap = document.getElementById('checkoutWrap');
        if (!wrap) return;
        var expMs = Date.now() + LOCK_VALIDITY_MS;
        var expStr = new Date(expMs).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

        // Step bar — we DON'T move to "Confirmation" because the
        // booking isn't confirmed yet. Just keep the user on step 3.
        var steps = document.querySelectorAll('.co-step');
        steps.forEach(function (st, i) { st.classList.remove('active'); if (i < 3) st.classList.add('done'); });
        if (steps[2]) { steps[2].classList.add('active'); steps[2].classList.remove('done'); }

        wrap.innerHTML =
            '<div class="co-card" style="grid-column:1/-1;text-align:center;padding:3rem 1.5rem;">' +
                '<div style="width:80px;height:80px;border-radius:50%;background:#fff4dd;color:#d68910;display:inline-flex;align-items:center;justify-content:center;font-size:2.5rem;margin-bottom:1rem;"><i class="fas fa-stopwatch"></i></div>' +
                '<h2 style="color:#0a5a68;margin:0 0 .5rem;font-size:1.6rem;">Price Locked!</h2>' +
                '<p style="color:#5a6877;margin:0 0 1.5rem;font-size:1rem;max-width:580px;margin-left:auto;margin-right:auto;">Today\'s price is frozen for 10 days. Come back anytime before <strong>' + esc(expStr) + '</strong> to complete your booking — the ' + R + fmt(lockFee) + ' you just paid will be deducted from the advance. We\'ve emailed your lock receipt to <strong>' + esc(email) + '</strong>.</p>' +
                '<div style="display:inline-block;background:#f8fafb;padding:1.1rem 1.5rem;border-radius:10px;text-align:left;font-size:.92rem;color:#2c3e50;border:1px dashed #cfd9df;">' +
                    '<div style="margin-bottom:.45rem;"><span style="color:#7f8c8d;">Lock Reference:</span> <strong>' + esc(lockRef) + '</strong></div>' +
                    '<div style="margin-bottom:.45rem;"><span style="color:#7f8c8d;">Payment ID:</span> <strong>' + esc(paymentId) + '</strong></div>' +
                    '<hr style="border:none;border-top:1px dashed #cfd9df;margin:.6rem 0;">' +
                    '<div style="margin-bottom:.4rem;"><span style="color:#7f8c8d;">Lock Fee Paid:</span> <strong>' + R + fmt(lockFee) + '</strong> <small style="color:#7a8b96;">(' + R + fmt(LOCK_PRICE_PER_HEAD) + ' × ' + people + ' travellers)</small></div>' +
                    '<div style="margin-bottom:.4rem;color:#0a5a68;"><span><i class="fas fa-clock"></i> Valid Until:</span> <strong>' + esc(expStr) + '</strong> <small style="color:#7a8b96;">(10 days)</small></div>' +
                '</div>' +

                '<div style="background:#fff8e7;color:#8a6d3b;border-left:3px solid #f39c12;padding:.75rem 1rem;border-radius:6px;margin:1.25rem auto 0;max-width:560px;text-align:left;font-size:.9rem;line-height:1.55;">' +
                    '<i class="fas fa-info-circle"></i> <strong>Important:</strong> The ' + R + fmt(lockFee) + ' lock fee is <strong>non-refundable</strong>. ' +
                    'If you complete your booking within 10 days, this amount is deducted from the advance. ' +
                    'After 10 days the lock expires and the fee is forfeited.' +
                '</div>' +

                '<div style="margin-top:2rem;display:flex;gap:.75rem;justify-content:center;flex-wrap:wrap;">' +
                    '<a href="/checkout" style="background:#0d7a8a;color:#fff;padding:.7rem 1.5rem;border-radius:8px;text-decoration:none;font-weight:600;"><i class="fas fa-credit-card"></i> Complete Booking Now</a>' +
                    '<a href="/bookings" style="background:#ecf0f1;color:#2c3e50;padding:.7rem 1.5rem;border-radius:8px;text-decoration:none;font-weight:600;"><i class="fas fa-suitcase-rolling"></i> View My Locks</a>' +
                '</div>' +
                '<p style="color:#7f8c8d;font-size:.85rem;margin-top:1.5rem;">Need help? Call <a href="tel:+918880195191" style="color:#0d7a8a;font-weight:600;">+91 88801 95191</a> &middot; Quote lock ref <strong>' + esc(lockRef) + '</strong></p>' +
            '</div>';

        window.Toast.success('Price locked for 10 days! Lock ref: ' + lockRef, { duration: 8000 });
    }

    function onPaymentSuccess(response, ref, total, advance, balance, name, email, phone, date, notes) {
        // Distinguish a zero-advance booking (synthetic FREE-* payment id —
        // no real Razorpay charge happened) so the dashboard reports show
        // accurate stats and emails read correctly. Everything else stays
        // the same — same booking record shape, same confirmation email.
        var isFreeBooking = !!(advance <= 0 || /^FREE-/i.test(String(response.razorpay_payment_id || '')));
        var booking = {
            booking_ref: ref,
            package_name: state.cart.pkgId,
            package_label: state.cart.name,
            price: total,                     // total trip cost (kept for back-compat)
            total_trip_cost: total,
            advance_paid: advance,            // amount actually charged via Razorpay (0 for FREE)
            balance_due:  balance,            // amount owed at end of trip
            payment_status: isFreeBooking ? 'no_advance_required' : 'partial_advance',
            adults: state.cart.adults,
            children: state.cart.children,
            travel_date: date,
            duration: state.cart.duration_pref || state.cart.duration,
            meals: state.cart.meals,
            addons: state.cart.addons,
            coupon: state.coupon ? state.coupon.code : '',
            traveler: { name: name, email: email, phone: phone, notes: notes },
            payment_id: response.razorpay_payment_id,
            payment_method: isFreeBooking ? 'no_payment' : 'razorpay',
            status: 'confirmed'
        };

        // Save (Firestore via createBooking, or localStorage fallback)
        var saved = Promise.resolve();
        if (typeof window.createBooking === 'function') {
            saved = window.createBooking(booking).catch(function (e) { console.warn('createBooking failed:', e); });
        }
        try {
            var list = JSON.parse(localStorage.getItem('bookings') || '[]');
            var u = JSON.parse(localStorage.getItem('currentUser') || 'null');
            list.push(Object.assign({}, booking, { id: Date.now(), userId: u ? (u.uid || u.id) : 'guest', createdAt: new Date().toISOString() }));
            localStorage.setItem('bookings', JSON.stringify(list));
        } catch (e) {}

        // GA4 — purchase complete. Track full trip value as the conversion (not just advance).
        try {
            window.Analytics && window.Analytics.purchase(
                ref,
                { id: state.cart.pkgId, name: state.cart.name, price: state.cart.price, category: 'package' },
                total,
                'INR'
            );
        } catch (e) {}

        // Clear cart
        try { sessionStorage.removeItem('checkoutCart'); } catch (e) {}
        state.cart = null; state.coupon = null;

        // Fire-and-forget booking confirmation email (Firebase
        // Trigger Email extension picks it up from the `mail`
        // collection). Customer is cc'd, booking@ is the To. Falls
        // through silently if the extension isn't installed yet.
        try {
            if (window.BookingEmails && window.BookingEmails.sendBookingConfirmation) {
                window.BookingEmails.sendBookingConfirmation(booking);
            }
        } catch (e) { /* never block UX on email */ }

        // If this booking consumed an active price-lock, flip it to
        // status='used' so it stops appearing on /bookings as "active"
        // and the audit trail shows which booking consumed it. We do
        // this AFTER the booking record is safely written so a failed
        // markLockUsed call never orphans the booking. Errors here are
        // logged but never surfaced — the lock metadata is secondary
        // to the actual booking.
        if (state.activeLock) {
            var lockToConsume = state.activeLock.lockRef || state.activeLock.id;
            if (lockToConsume && window.LocksStore && window.LocksStore.markLockUsed) {
                try {
                    window.LocksStore.markLockUsed(lockToConsume, ref).catch(function (err) {
                        console.warn('[checkout] markLockUsed failed (booking still confirmed):', err);
                    });
                } catch (err) {
                    console.warn('[checkout] markLockUsed threw (booking still confirmed):', err);
                }
            }
            state.activeLock = null;
        }

        saved.then(function () {
            renderSuccess(ref, response.razorpay_payment_id, total, advance, balance, email);
        });
    }

    function renderSuccess(ref, paymentId, total, advance, balance, email) {
        var wrap = document.getElementById('checkoutWrap');
        if (!wrap) return;
        var isFreeBooking = !!(advance <= 0 || /^FREE-/i.test(String(paymentId || '')));
        // Update step bar to "Confirmation"
        var steps = document.querySelectorAll('.co-step');
        steps.forEach(function (st, i) { st.classList.remove('active'); if (i < 4) st.classList.add('done'); });
        if (steps[3]) { steps[3].classList.add('active'); steps[3].classList.remove('done'); var num = steps[3].querySelector('.num'); if (num) num.innerHTML = '<i class="fas fa-check"></i>'; }

        // Headline + lede vary slightly so the customer doesn't see a
        // "payment was successful" line when no money actually changed
        // hands. The booking record + email content remain identical.
        var headline = isFreeBooking ? 'Booking Confirmed — No Payment Required' : 'Booking Confirmed!';
        var lede = isFreeBooking
            ? 'Your seat is reserved. No payment was required at this stage. The full trip amount will be collected during or after your trip. We\'ve emailed your confirmation to <strong>' + esc(email) + '</strong>.'
            : 'Your booking advance payment was successful and your seat is reserved. We\'ve emailed your confirmation to <strong>' + esc(email) + '</strong>.';
        var advanceRow = isFreeBooking
            ? '<div style="margin-bottom:.4rem;color:#0a5a68;"><span><i class="fas fa-gift"></i> Advance Paid:</span> <strong>FREE &mdash; no payment now</strong></div>'
            : '<div style="margin-bottom:.4rem;color:#0a5a68;"><span>Advance Paid:</span> <strong>' + R + fmt(advance) + '</strong></div>';
        var balanceLabel = isFreeBooking ? 'Total payable during or after travel' : 'Balance during or after travel';
        var balanceNote = isFreeBooking
            ? '<i class="fas fa-info-circle"></i> <strong>Trip payment:</strong> ' + R + fmt(balance) + ' will be collected during or after your trip via UPI / bank transfer / cash. No payment is needed right now.'
            : '<i class="fas fa-info-circle"></i> <strong>Balance payment:</strong> ' + R + fmt(balance) + ' will be collected during or after your trip via UPI / bank transfer / cash. We will not charge this amount until your trip is in progress.';

        wrap.innerHTML =
            '<div class="co-card" style="grid-column:1/-1;text-align:center;padding:3rem 1.5rem;">' +
                '<div style="width:80px;height:80px;border-radius:50%;background:#e8f8f5;color:#0a5a68;display:inline-flex;align-items:center;justify-content:center;font-size:2.5rem;margin-bottom:1rem;"><i class="fas fa-check-circle"></i></div>' +
                '<h2 style="color:#0a5a68;margin:0 0 .5rem;font-size:1.6rem;">' + esc(headline) + '</h2>' +
                '<p style="color:#5a6877;margin:0 0 1.5rem;font-size:1rem;">' + lede + '</p>' +
                '<div style="display:inline-block;background:#f8fafb;padding:1.1rem 1.5rem;border-radius:10px;text-align:left;font-size:.92rem;color:#2c3e50;border:1px dashed #cfd9df;">' +
                    '<div style="margin-bottom:.45rem;"><span style="color:#7f8c8d;">Booking Ref:</span> <strong>' + esc(ref) + '</strong></div>' +
                    '<div style="margin-bottom:.45rem;"><span style="color:#7f8c8d;">' + (isFreeBooking ? 'Reference' : 'Payment ID') + ':</span> <strong>' + esc(paymentId) + '</strong></div>' +
                    '<hr style="border:none;border-top:1px dashed #cfd9df;margin:.6rem 0;">' +
                    '<div style="margin-bottom:.4rem;"><span style="color:#7f8c8d;">Total Trip Cost:</span> <strong>' + R + fmt(total) + '</strong></div>' +
                    advanceRow +
                    '<div style="color:#a04000;"><span>' + esc(balanceLabel) + ':</span> <strong>' + R + fmt(balance) + '</strong></div>' +
                '</div>' +

                '<div style="background:#fff8e7;color:#8a6d3b;border-left:3px solid #f39c12;padding:.75rem 1rem;border-radius:6px;margin:1.25rem auto 0;max-width:520px;text-align:left;font-size:.9rem;line-height:1.55;">' +
                    balanceNote +
                '</div>' +

                '<div style="margin-top:2rem;display:flex;gap:.75rem;justify-content:center;flex-wrap:wrap;">' +
                    '<a href="/bookings" style="background:#0d7a8a;color:#fff;padding:.7rem 1.5rem;border-radius:8px;text-decoration:none;font-weight:600;"><i class="fas fa-suitcase-rolling"></i> View My Bookings</a>' +
                    '<a href="/" style="background:#ecf0f1;color:#2c3e50;padding:.7rem 1.5rem;border-radius:8px;text-decoration:none;font-weight:600;"><i class="fas fa-home"></i> Back to Home</a>' +
                '</div>' +
                '<p style="color:#7f8c8d;font-size:.85rem;margin-top:1.5rem;">Need help? Call <a href="tel:+918880195191" style="color:#0d7a8a;font-weight:600;">+91 88801 95191</a> &middot; Quote ref <strong>' + esc(ref) + '</strong></p>' +
            '</div>';

        var toastMsg = isFreeBooking
            ? 'Booking confirmed — no advance required. Ref: ' + ref
            : 'Booking confirmed! Advance ' + R + fmt(advance) + ' paid. Ref: ' + ref;
        window.Toast.success(toastMsg, { duration: 8000 });
    }

    // The booking advance is now a flat per-head amount (see ADVANCE_BY_PKG
    // at the top of the file), not a percentage. The old resolveAdvanceRate()
    // function read /settings/site.advanceRate + per-user overrides — both of
    // which are obsolete under the new policy. We keep an empty stub so the
    // existing init code below can still call it without breaking.
    function resolveAdvanceRate() { return Promise.resolve(); }

    // On page load (and after auth state changes), check whether the
    // logged-in user has an active price-lock against the cart's package.
    // If yes, stash it on state.activeLock so calcAdvance() / summaryCard()
    // immediately reflect the credit. Falls back silently on any error —
    // the customer can always pay the full advance instead.
    function resolveActiveLock() {
        return new Promise(function (resolve) {
            try {
                if (!state.cart || !state.cart.pkgId) { state.activeLock = null; return resolve(); }
                if (!window.LocksStore || !window.LocksStore.getActiveLock) {
                    state.activeLock = null;
                    return resolve();
                }
                window.LocksStore.getActiveLock(state.cart.pkgId).then(function (lock) {
                    state.activeLock = lock || null;
                    resolve();
                }).catch(function () {
                    state.activeLock = null;
                    resolve();
                });
            } catch (_) {
                state.activeLock = null;
                resolve();
            }
        });
    }

    // Pull the logged-in customer's admin-configured discount % (if any)
    // from their Firestore user doc and stash it on `state` so calcDiscount()
    // can include it in the order summary. Re-runs whenever auth state
    // changes (login / logout) or on initial page load.
    function resolveCustomerDiscount() {
        return new Promise(function (resolve) {
            try {
                if (!window.__firebaseReady || !window.__firebaseReady.then) {
                    state.customerDiscount = 0; state.customerName = '';
                    return resolve();
                }
                window.__firebaseReady.then(function (fb) {
                    var u = fb.auth && fb.auth.currentUser;
                    if (!u || !window.UsersStore || !window.UsersStore.fetchUserDoc) {
                        state.customerDiscount = 0; state.customerName = '';
                        return resolve();
                    }
                    window.UsersStore.fetchUserDoc(u.uid).then(function (profile) {
                        if (window.UsersStore.getEffectiveDiscount) {
                            state.customerDiscount = window.UsersStore.getEffectiveDiscount(profile);
                        } else {
                            state.customerDiscount = (profile && typeof profile.discountPercent === 'number')
                                ? profile.discountPercent : 0;
                        }
                        state.customerName = (profile && (profile.fullName || profile.username)) || '';
                        resolve();
                    }).catch(function () {
                        state.customerDiscount = 0; state.customerName = '';
                        resolve();
                    });
                }).catch(function () {
                    state.customerDiscount = 0; state.customerName = '';
                    resolve();
                });
            } catch (_) {
                state.customerDiscount = 0; state.customerName = '';
                resolve();
            }
        });
    }

    // Render a small persistent banner at the top of the cart when the
    // site is in Razorpay TEST mode, so staff don't accidentally think
    // they're charging a real customer (and so QA testers spot a stale
    // toggle the moment they land on /checkout). Re-renders idempotently.
    function renderTestModeBanner() {
        try {
            if (RAZORPAY_KEY === RAZORPAY_KEY_LIVE) {
                var b = document.getElementById('rzpTestBanner');
                if (b) b.remove();
                return;
            }
            if (document.getElementById('rzpTestBanner')) return;
            var bar = document.createElement('div');
            bar.id = 'rzpTestBanner';
            bar.style.cssText = 'position:sticky;top:0;z-index:9000;background:#f39c12;color:#fff;font-weight:700;text-align:center;padding:.55rem 1rem;font-size:.92rem;letter-spacing:.2px;box-shadow:0 2px 6px rgba(0,0,0,.18);';
            bar.innerHTML = '🧪 RAZORPAY TEST MODE — payments use the test gateway, no real money will move. ' +
                            '<a href="https://razorpay.com/docs/payments/payments/test-card-details/" target="_blank" rel="noopener" style="color:#fff;text-decoration:underline;">Test card details ↗</a>';
            document.body.insertBefore(bar, document.body.firstChild);
        } catch (_) {}
    }

    // ── Init ──
    document.addEventListener('DOMContentLoaded', function () {
        state.cart = loadCart();
        // Render immediately with the default 5% so the page paints fast,
        // then re-render once we've read the live rate from Firestore (and
        // checked for a per-user override). Auth may resolve a moment later,
        // so we also re-resolve when the auth state changes.
        render();
        // Resolve the Razorpay key (live vs test) early so the very first
        // payment click already uses the right gateway. Banner is shown
        // after the key resolves.
        resolveRazorpayKey().then(renderTestModeBanner);
        // Resolve the logged-in customer's admin-set discount % (if any)
        // and any legacy advance-rate override, then re-render so the
        // order summary shows the discount line and the lower total.
        Promise.all([resolveAdvanceRate(), resolveCustomerDiscount(), resolveActiveLock()]).then(function () { render(); });
        if (window.__firebaseReady && window.__firebaseReady.then) {
            window.__firebaseReady.then(function (fb) {
                if (fb.firebaseAuth && fb.firebaseAuth.onAuthStateChanged) {
                    fb.firebaseAuth.onAuthStateChanged(fb.auth, function () {
                        // Re-fetch user-specific override + discount + active
                        // price-lock for this package, then re-render. The
                        // active-lock query is per-user, so we have to wait
                        // until auth resolves before we can ask Firestore.
                        Promise.all([resolveAdvanceRate(), resolveCustomerDiscount(), resolveActiveLock()])
                            .then(function () { render(); });
                    });
                }
            }).catch(function () {});
        }
    });
})();
