/* Checkout / Cart Page Logic — uses Toast for all notifications, no native alerts */
(function () {
    'use strict';

    var RAZORPAY_KEY = 'rzp_live_SLfG8nnKN3tXPC';
    var GST_RATE = 0.05;
    var ADVANCE_RATE = 0.05;   // 5% advance to confirm booking; balance due after travel
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

    var state = { cart: null, coupon: null };
    var R = '\u20B9';

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
            link.href = 'index.html';
        } else {
            link.textContent = 'Login';
            link.href = 'index.html#login';
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
    function calcDiscount(sub) {
        if (!state.coupon) return 0;
        var co = state.coupon;
        if (sub < (co.min || 0)) return 0;
        var d = co.type === 'flat' ? co.value : Math.round(sub * co.value / 100);
        if (co.cap) d = Math.min(d, co.cap);
        return Math.min(d, sub);
    }
    function calcGst(t) { return Math.round(t * GST_RATE); }
    function calcTotal() {
        var s = calcSubtotal(), d = calcDiscount(s), t = s - d;
        return t + calcGst(t);
    }
    function calcAdvance() { return Math.max(1, Math.round(calcTotal() * ADVANCE_RATE)); }
    function calcBalance() { return calcTotal() - calcAdvance(); }

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
            '<p style="margin-top:1.2rem;"><a href="index.html#packages" style="display:inline-block;padding:.8rem 1.5rem;background:#0d7a8a;color:#fff;text-decoration:none;border-radius:8px;font-weight:700;">Browse Packages</a></p>' +
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
        return '<div class="co-card"><h2><i class="fas fa-sliders-h"></i> Customize Your Trip</h2>' +
            '<div class="co-form-row">' +
                '<div class="co-field"><label>Duration Preference</label><select id="durationPref">' +
                    '<option value="">Standard (as per package)</option>' +
                    '<option>4 Nights / 5 Days</option><option>5 Nights / 6 Days</option>' +
                    '<option>6 Nights / 7 Days</option><option>7 Nights / 8 Days</option>' +
                '</select></div>' +
                '<div class="co-field"><label>Meal Plan</label><select id="mealPlan">' +
                    '<option value="">Breakfast Only (default)</option>' +
                    '<option>Breakfast + Dinner</option><option>All Meals</option>' +
                '</select></div>' +
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
                '<div class="co-field"><label>Travel Date</label><input type="date" id="travelerDate" value="' + esc(c.travelDate || '') + '"></div>' +
            '</div>' +
            '<div class="co-form-row full"><div class="co-field"><label>Special Requests (optional)</label><textarea id="travelerNotes" rows="2" placeholder="Anniversary, dietary preferences..."></textarea></div></div>' +
            '</div>';
    }

    function summaryCard() {
        var s = calcSubtotal(), d = calcDiscount(s), taxable = s - d, gst = calcGst(taxable), total = taxable + gst;
        var advance = Math.max(1, Math.round(total * ADVANCE_RATE));
        var balance = total - advance;
        var c = state.cart;
        var people = (Number(c.adults) || 0) + (Number(c.children) || 0);
        var couponHtml = state.coupon
            ? '<div class="coupon-applied"><i class="fas fa-check-circle"></i> ' + esc(state.coupon.code) + ' applied — ' + esc(state.coupon.label) + ' <a href="#" id="removeCouponLink" style="float:right;color:#0a5a68;">Remove</a></div>'
            : '';
        return '<div class="co-card summary"><h2><i class="fas fa-receipt"></i> Price Summary</h2>' +
            '<div class="co-form-row full"><div class="co-field"><label>Coupon Code</label>' +
                '<div class="coupon-row"><input type="text" id="couponInput" placeholder="WELCOME500 / ANDAMAN10" value="' + esc(state.coupon ? state.coupon.code : '') + '"><button id="applyCouponBtn" type="button">Apply</button></div>' +
                couponHtml +
            '</div></div>' +
            '<div class="row"><span>Base price (' + people + ' traveler' + (people !== 1 ? 's' : '') + ')</span><span>' + R + fmt(s) + '</span></div>' +
            (d > 0 ? '<div class="row" style="color:#0a5a68;"><span>Coupon discount</span><span>- ' + R + fmt(d) + '</span></div>' : '') +
            '<div class="row"><span>GST (5%)</span><span>' + R + fmt(gst) + '</span></div>' +
            '<div class="row total"><span>Total Trip Cost</span><span class="val">' + R + fmt(total) + '</span></div>' +

            // Advance / balance split — the headline of this booking model
            '<div class="advance-split">' +
                '<div class="row"><span><i class="fas fa-credit-card"></i> Pay now <small>(5% advance)</small></span><span class="adv-amt">' + R + fmt(advance) + '</span></div>' +
                '<div class="row" style="color:#5a6877;font-size:.9rem;"><span><i class="fas fa-handshake"></i> Balance after travel</span><span>' + R + fmt(balance) + '</span></div>' +
            '</div>' +

            '<button class="btn-pay" id="payBtn"><i class="fas fa-lock"></i> Pay ' + R + fmt(advance) + ' Advance &amp; Confirm</button>' +
            '<a href="index.html#packages" style="text-decoration:none;"><button class="btn-secondary" type="button"><i class="fas fa-arrow-left"></i> Continue Browsing</button></a>' +

            // Cancellation policy summary
            '<div class="cxl-policy">' +
                '<strong><i class="fas fa-info-circle"></i> Cancellation Policy</strong>' +
                '<ul>' +
                    '<li><strong>60+ days</strong> before travel: 95% refund <em>(5% fee on advance)</em></li>' +
                    '<li><strong>30–60 days</strong> before travel: 90% refund <em>(10% fee on advance)</em></li>' +
                    '<li><strong>Within 30 days</strong> of travel: 50% refund <em>(50% fee on advance)</em></li>' +
                '</ul>' +
                '<small>Balance of ' + R + fmt(balance) + ' is paid directly at the end of your trip — UPI / bank transfer / cash.</small>' +
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
    }

    function applyCoupon() {
        var inp = document.getElementById('couponInput');
        if (!inp) return;
        var code = (inp.value || '').trim().toUpperCase();
        if (!code) { window.Toast.warning('Please enter a coupon code.'); return; }
        var co = COUPONS[code];
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
        if (n.trim().length < 2) errs.push('Please enter your full name.');
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) errs.push('Please enter a valid email.');
        if ((p.match(/\d/g) || []).length < 8) errs.push('Please enter a valid phone (at least 8 digits).');
        return errs;
    }

    function startPayment() {
        if (!state.cart) return;
        if (!isLoggedIn()) {
            try { sessionStorage.setItem('postLoginIntent', JSON.stringify({ type: 'checkout', ts: Date.now() })); } catch (e) {}
            window.Toast.info('Please log in to continue with payment.', { duration: 3000 });
            setTimeout(function () { window.location.href = 'index.html#login'; }, 700);
            return;
        }
        var errs = validate();
        if (errs.length) { window.Toast.warning(errs.join('\n')); return; }
        if (typeof Razorpay === 'undefined') { window.Toast.error('Payment gateway not loaded. Please refresh.'); return; }

        var total   = calcTotal();
        var advance = calcAdvance();
        var balance = total - advance;
        var ref = 'BTT' + Date.now().toString().slice(-8) + Math.random().toString(36).slice(2, 4).toUpperCase();
        var name = document.getElementById('travelerName').value.trim();
        var email = document.getElementById('travelerEmail').value.trim();
        var phone = document.getElementById('travelerPhone').value.trim();
        var date = (document.getElementById('travelerDate') || {}).value || '';
        var notes = (document.getElementById('travelerNotes') || {}).value || '';

        var payBtn = document.getElementById('payBtn');
        var payBtnLabel = '<i class="fas fa-lock"></i> Pay ' + R + fmt(advance) + ' Advance &amp; Confirm';
        if (payBtn) { payBtn.disabled = true; payBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Opening payment...'; }

        var rzp = new Razorpay({
            key: RAZORPAY_KEY,
            amount: advance * 100,            // ← charge only the 5% advance
            currency: 'INR',
            name: 'Bharat Tours & Travels',
            description: '5% advance for ' + state.cart.name + ' (Ref ' + ref + ')',
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
                payment_type:    'advance_5pct'
            },
            theme: { color: '#0d7a8a' },
            handler: function (response) { onPaymentSuccess(response, ref, total, advance, balance, name, email, phone, date, notes); },
            modal: {
                ondismiss: function () {
                    if (payBtn) { payBtn.disabled = false; payBtn.innerHTML = payBtnLabel; }
                    window.Toast.info('Payment cancelled.');
                }
            }
        });

        rzp.on('payment.failed', function (r) {
            if (payBtn) { payBtn.disabled = false; payBtn.innerHTML = payBtnLabel; }
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

    function onPaymentSuccess(response, ref, total, advance, balance, name, email, phone, date, notes) {
        var booking = {
            booking_ref: ref,
            package_name: state.cart.pkgId,
            package_label: state.cart.name,
            price: total,                     // total trip cost (kept for back-compat)
            total_trip_cost: total,
            advance_paid: advance,            // amount actually charged via Razorpay
            balance_due:  balance,            // amount owed at end of trip
            payment_status: 'partial_advance',
            adults: state.cart.adults,
            children: state.cart.children,
            travel_date: date,
            duration: state.cart.duration_pref || state.cart.duration,
            meals: state.cart.meals,
            addons: state.cart.addons,
            coupon: state.coupon ? state.coupon.code : '',
            traveler: { name: name, email: email, phone: phone, notes: notes },
            payment_id: response.razorpay_payment_id,
            payment_method: 'razorpay',
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

        saved.then(function () {
            renderSuccess(ref, response.razorpay_payment_id, total, advance, balance, email);
        });
    }

    function renderSuccess(ref, paymentId, total, advance, balance, email) {
        var wrap = document.getElementById('checkoutWrap');
        if (!wrap) return;
        // Update step bar to "Confirmation"
        var steps = document.querySelectorAll('.co-step');
        steps.forEach(function (st, i) { st.classList.remove('active'); if (i < 4) st.classList.add('done'); });
        if (steps[3]) { steps[3].classList.add('active'); steps[3].classList.remove('done'); var num = steps[3].querySelector('.num'); if (num) num.innerHTML = '<i class="fas fa-check"></i>'; }

        wrap.innerHTML =
            '<div class="co-card" style="grid-column:1/-1;text-align:center;padding:3rem 1.5rem;">' +
                '<div style="width:80px;height:80px;border-radius:50%;background:#e8f8f5;color:#0a5a68;display:inline-flex;align-items:center;justify-content:center;font-size:2.5rem;margin-bottom:1rem;"><i class="fas fa-check-circle"></i></div>' +
                '<h2 style="color:#0a5a68;margin:0 0 .5rem;font-size:1.6rem;">Booking Confirmed!</h2>' +
                '<p style="color:#5a6877;margin:0 0 1.5rem;font-size:1rem;">Your 5% advance payment was successful and your seat is reserved. We\'ve emailed your confirmation to <strong>' + esc(email) + '</strong>.</p>' +
                '<div style="display:inline-block;background:#f8fafb;padding:1.1rem 1.5rem;border-radius:10px;text-align:left;font-size:.92rem;color:#2c3e50;border:1px dashed #cfd9df;">' +
                    '<div style="margin-bottom:.45rem;"><span style="color:#7f8c8d;">Booking Ref:</span> <strong>' + esc(ref) + '</strong></div>' +
                    '<div style="margin-bottom:.45rem;"><span style="color:#7f8c8d;">Payment ID:</span> <strong>' + esc(paymentId) + '</strong></div>' +
                    '<hr style="border:none;border-top:1px dashed #cfd9df;margin:.6rem 0;">' +
                    '<div style="margin-bottom:.4rem;"><span style="color:#7f8c8d;">Total Trip Cost:</span> <strong>' + R + fmt(total) + '</strong></div>' +
                    '<div style="margin-bottom:.4rem;color:#0a5a68;"><span>Advance Paid (5%):</span> <strong>' + R + fmt(advance) + '</strong></div>' +
                    '<div style="color:#a04000;"><span>Balance Due After Travel:</span> <strong>' + R + fmt(balance) + '</strong></div>' +
                '</div>' +

                '<div style="background:#fff8e7;color:#8a6d3b;border-left:3px solid #f39c12;padding:.75rem 1rem;border-radius:6px;margin:1.25rem auto 0;max-width:520px;text-align:left;font-size:.9rem;line-height:1.55;">' +
                    '<i class="fas fa-info-circle"></i> <strong>Balance payment:</strong> ' + R + fmt(balance) + ' will be collected on the last day of your trip via UPI / bank transfer / cash. We will not charge this amount until your travel ends.' +
                '</div>' +

                '<div style="margin-top:2rem;display:flex;gap:.75rem;justify-content:center;flex-wrap:wrap;">' +
                    '<a href="bookings.html" style="background:#0d7a8a;color:#fff;padding:.7rem 1.5rem;border-radius:8px;text-decoration:none;font-weight:600;"><i class="fas fa-suitcase-rolling"></i> View My Bookings</a>' +
                    '<a href="index.html" style="background:#ecf0f1;color:#2c3e50;padding:.7rem 1.5rem;border-radius:8px;text-decoration:none;font-weight:600;"><i class="fas fa-home"></i> Back to Home</a>' +
                '</div>' +
                '<p style="color:#7f8c8d;font-size:.85rem;margin-top:1.5rem;">Need help? Call <a href="tel:+918880195191" style="color:#0d7a8a;font-weight:600;">+91 88801 95191</a> &middot; Quote ref <strong>' + esc(ref) + '</strong></p>' +
            '</div>';

        window.Toast.success('Booking confirmed! Advance ' + R + fmt(advance) + ' paid. Ref: ' + ref, { duration: 8000 });
    }

    // ── Init ──
    document.addEventListener('DOMContentLoaded', function () {
        state.cart = loadCart();
        render();
    });
})();
