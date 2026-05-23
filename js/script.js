// Modal controls - Define globally for onclick handlers
let currentBasePrice = 21999;
let currentPackage = 'standard';

// ── Dynamic Package Loading ──────────────────────────────────
const INCL_ICONS = {
    'Hotels': 'fa-bed', 'Deluxe Hotels': 'fa-bed', '5* Resorts': 'fa-bed',
    'Ferries': 'fa-ship', 'Premium Ferries': 'fa-ship', 'VIP Ferries': 'fa-ship',
    'Breakfast': 'fa-utensils', 'Snorkeling': 'fa-swimmer', 'Scuba Dive': 'fa-fish',
    'Romantic Setup': 'fa-heart', 'Photoshoot': 'fa-camera', 'Dinner': 'fa-wine-glass',
    'Live Payment': 'fa-check-circle', 'Instant': 'fa-bolt'
};

function getInclIcon(inc) {
    return INCL_ICONS[inc] || 'fa-check';
}

// Hard-coded defaults — used only if both jsonbin.io AND the repo file fail
const DEFAULT_PACKAGES = [
    { id:'budget',    name:'Budget Andaman Escape',    desc:'4N/5D | Port Blair + Havelock | Basic Hotels + Ferries', price:15999, rating:4.2, image:'images/beach1.jpg', inclusions:['Hotels','Ferries','Breakfast'], visible:true },
    { id:'standard',  name:'Standard Andaman Bliss',   desc:'6N/7D | Port Blair + Havelock + Neil | Deluxe + Activities', price:21999, rating:4.6, image:'images/beach2.jpg', inclusions:['Deluxe Hotels','Premium Ferries','Snorkeling'], visible:true },
    { id:'luxury',    name:'Luxury Andaman Retreat',   desc:'6N/7D | All Islands | 5* Resorts + Scuba + Private Transfers', price:28999, rating:4.8, image:'images/beach3.jpg', inclusions:['5* Resorts','VIP Ferries','Scuba Dive'], visible:true },
    { id:'honeymoon', name:'Honeymoon Paradise',       desc:'5N/6D | Romantic Stays + Candlelight Dinner + Photos', price:24999, rating:4.9, image:'images/beach4.jpg', inclusions:['Romantic Setup','Photoshoot','Dinner'], visible:true },
    { id:'test',      name:'🧪 Payment Test Package',  desc:'Test the live payment gateway for ₹1 only', price:1, rating:5.0, image:'images/beach1.jpg', inclusions:['Live Payment','Instant'], visible:true }
];

async function loadAndRenderSitePackages() {
    if (window.PackagesStore) {
        // Stale-while-revalidate: render cached instantly, then refresh from
        // jsonbin / repo file and re-render once fresh data arrives.
        await window.PackagesStore.loadWithStaleWhileRevalidate(function (data) {
            window._packages = data;
            renderSitePackages();
        });
        if (window._packages && window._packages.length) return;
    }
    // PackagesStore script missing or both remote sources empty — use defaults
    window._packages = DEFAULT_PACKAGES;
    renderSitePackages();
}

// ── MMT-style listing helpers ───────────────────────────────────
// Active filter / tab / sort state (module-scoped)
const mmtState = { cat: 'all', sort: 'popular', dur: [], budget: [], hotel: [], theme: [] };

// Derived helpers from a package
function pkgDuration(pkg) {
    // Try parse leading number from `duration` (e.g. "6 Nights / 7 Days") or fallback by id heuristics
    const d = pkg.duration || pkg.desc || '';
    const m = String(d).match(/(\d+)\s*N/i) || String(d).match(/(\d+)\s*Night/i);
    if (m) return parseInt(m[1], 10);
    return ({ budget: 4, standard: 6, luxury: 6, honeymoon: 5 }[pkg.id] || 5);
}
function pkgRoute(pkg) {
    if (Array.isArray(pkg.cities) && pkg.cities.length) return pkg.cities;
    return ({
        budget:    ['1N Port Blair', '2N Havelock', '1N Port Blair'],
        standard:  ['1N Port Blair', '2N Havelock', '1N Neil Island', '2N Port Blair'],
        luxury:    ['2N Port Blair', '3N Havelock', '1N Neil Island'],
        honeymoon: ['1N Port Blair', '3N Havelock', '1N Neil Island'],
        test:      ['Test Package']
    }[pkg.id] || ['Andaman Tour']);
}
function pkgCategory(pkg) {
    if (pkg.id === 'test') return 'budget';
    if (pkg.id === 'budget') return 'budget';
    if (pkg.id === 'honeymoon') return 'honeymoon';
    if (pkg.id === 'luxury') return 'premium';
    if (pkg.id === 'standard') return 'standard';
    return 'standard';
}
function pkgHotelCategory(pkg) {
    return ({ budget: 3, standard: 3, luxury: 5, honeymoon: 4, test: 3 }[pkg.id] || 3);
}
function pkgPerks(pkg) {
    return ({
        budget:    ['Daily Breakfast', 'Cellular Jail Visit'],
        standard:  ['Snorkeling at Elephant Beach', 'Visit to Radhanagar Beach'],
        luxury:    ['Scuba Diving Included', 'Private Beach Access', 'Spa Treatments'],
        honeymoon: ['Candlelight Dinner', 'Couple Photoshoot', 'Sunset Cruise'],
        test:      ['Live Razorpay Test']
    }[pkg.id] || []);
}

function applyFilters(packages) {
    return packages.filter(pkg => {
        if (pkg.visible === false) return false;
        // Category tab
        if (mmtState.cat !== 'all' && pkgCategory(pkg) !== mmtState.cat) return false;
        // Duration filter
        if (mmtState.dur.length) {
            const d = pkgDuration(pkg);
            const ok = mmtState.dur.some(range => {
                if (range === '1-3') return d >= 1 && d <= 3;
                if (range === '4-5') return d >= 4 && d <= 5;
                if (range === '6-7') return d >= 6 && d <= 7;
                if (range === '8+')  return d >= 8;
                return true;
            });
            if (!ok) return false;
        }
        // Budget filter
        if (mmtState.budget.length) {
            const p = Number(pkg.price);
            const ok = mmtState.budget.some(range => {
                if (range === '0-15000')      return p < 15000;
                if (range === '15000-22000')  return p >= 15000 && p <= 22000;
                if (range === '22000-30000')  return p > 22000 && p <= 30000;
                if (range === '30000+')       return p > 30000;
                return true;
            });
            if (!ok) return false;
        }
        // Hotel category filter
        if (mmtState.hotel.length) {
            const h = pkgHotelCategory(pkg);
            if (!mmtState.hotel.map(Number).includes(h)) return false;
        }
        return true;
    });
}

function sortPackages(arr) {
    const a = arr.slice();
    switch (mmtState.sort) {
        case 'price-asc':  a.sort((x, y) => x.price - y.price); break;
        case 'price-desc': a.sort((x, y) => y.price - x.price); break;
        case 'rating':     a.sort((x, y) => (y.rating || 0) - (x.rating || 0)); break;
        case 'duration':   a.sort((x, y) => pkgDuration(x) - pkgDuration(y)); break;
        default: /* popular = leave order */ break;
    }
    return a;
}

function updateTabCounts(packages) {
    const counts = { all: 0, budget: 0, honeymoon: 0, premium: 0, standard: 0 };
    packages.filter(p => p.visible !== false).forEach(p => {
        counts.all += 1;
        const c = pkgCategory(p);
        if (counts[c] != null) counts[c] += 1;
    });
    Object.keys(counts).forEach(k => {
        const el = document.querySelector(`[data-count="${k}"]`);
        if (el) el.textContent = `(${counts[k]})`;
    });
}

function renderSitePackages() {
    const grid = document.getElementById('packagesGrid');
    if (!grid || !window._packages) return;

    updateTabCounts(window._packages);

    const filtered = sortPackages(applyFilters(window._packages));

    if (!filtered.length) {
        grid.innerHTML = `
            <div class="mmt-empty">
                <i class="fas fa-search"></i>
                <h3>No packages match your filters</h3>
                <p>Try widening your filters or switching tabs.</p>
            </div>`;
        return;
    }

    grid.innerHTML = filtered.map(pkg => {
        const isTest = pkg.id === 'test' || pkg.price <= 1;
        const isSoldOut = pkg.soldOut === true;
        const dur = pkgDuration(pkg);
        const days = dur + 1;
        const route = pkgRoute(pkg);
        const perks = pkgPerks(pkg);
        const incl = (pkg.inclusions || []).slice(0, 6);
        const totalPrice = isTest ? pkg.price : pkg.price * 2;
        const emi = Math.round(pkg.price / 6);
        // Sold-out always wins as the headline tag.
        const tag = isSoldOut
            ? 'Sold Out'
            : (pkg.id === 'standard' ? 'Deal of the day' : (pkg.id === 'luxury' ? 'AD Premium' : ''));
        const tagClass = isSoldOut ? 'mmt-card-tag mmt-card-tag-soldout' : 'mmt-card-tag';

        return `
        <div class="mmt-card${isSoldOut ? ' mmt-card-soldout' : ''}" data-pkgid="${pkg.id}" data-name="${pkg.id}">
            <div class="mmt-card-img" data-nav="${pkg.id}" style="background-image:url('${pkg.image}');">
                ${tag ? `<span class="${tagClass}">${tag}</span>` : ''}
                <span class="mmt-more-options">${perks.length} More Options Available</span>
            </div>
            <div class="mmt-card-body">
                <div class="mmt-card-title-row">
                    <h3 class="mmt-card-title" data-nav="${pkg.id}">${pkg.name}</h3>
                    <span class="mmt-card-duration">${dur}N/${days}D</span>
                </div>
                <div class="mmt-route">
                    ${route.map((r, i) => `<span>${r}</span>${i < route.length - 1 ? '<span class="dot"></span>' : ''}`).join('')}
                </div>
                ${incl.length ? `
                <div class="mmt-incl-grid">
                    ${incl.map(i => `<div class="mmt-incl-item">${i}</div>`).join('')}
                </div>` : ''}
                ${perks.length ? `
                <div class="mmt-perks">
                    ${perks.map(p => `<div class="mmt-perk"><i class="fas fa-check"></i> ${p}</div>`).join('')}
                </div>` : ''}
            </div>
            <div class="mmt-card-price">
                ${tag === 'Deal of the day' ? `<div class="mmt-price-tagline">Specially Curated For You</div>` : ''}
                ${pkg.price >= 20000 ? `<div class="mmt-price-emi">No Cost EMI at <strong>₹${emi.toLocaleString()}</strong>/month</div>` : ''}
                <div class="mmt-price-row">
                    <span class="mmt-price-amt">₹${Number(pkg.price).toLocaleString()}</span>
                    <span class="mmt-price-per">${isTest ? '/test' : '/person'}</span>
                </div>
                ${!isTest ? `<div class="mmt-price-total">Total Price ₹${totalPrice.toLocaleString()}</div>` : ''}
                ${isSoldOut
                    ? `<button class="mmt-card-cta mmt-card-cta-soldout" data-action="enquire" data-pkg="${pkg.id}">
                         <i class="fas fa-times-circle"></i> Sold Out — Notify Me
                       </button>`
                    : `<button class="mmt-card-cta" data-action="book" data-pkg="${pkg.id}">
                         ${isTest ? 'Pay ₹1 Now' : 'Book Now'}
                       </button>`}
                ${(!isTest && !isSoldOut) ? `<button class="mmt-card-cta-secondary" data-action="customize" data-pkg="${pkg.id}">Customize</button>` : ''}
            </div>
        </div>`;
    }).join('');
}

function getPkgPrice(pkgId) {
    if (window._packages) {
        const p = window._packages.find(x => x.id === pkgId);
        if (p) return p.price;
    }
    return {budget:15999, standard:21999, luxury:28999, honeymoon:24999, test:1}[pkgId] || 0;
}

function updateTotal() {
    let total = window.currentBasePrice || currentBasePrice;
    const totalPriceEl = document.getElementById('totalPrice');
    if (!totalPriceEl) return;
    
    const checkboxes = document.querySelectorAll('#customForm input[type="checkbox"]');
    checkboxes.forEach(cb => {
        if (cb.checked) total += parseInt(cb.value);
    });
    totalPriceEl.textContent = `Total: ₹${total.toLocaleString()}`;
}

window.openCustomize = function(pkg) {
    const customizeModal = document.getElementById('customizeModal');
    if (!customizeModal) { console.error('customizeModal not found'); return; }
    customizeModal.style.display = 'block';
    document.getElementById('modalTitle').textContent = `Customize ${pkg.charAt(0).toUpperCase() + pkg.slice(1)} Package`;
    window.currentPackage = pkg;
    window.currentBasePrice = getPkgPrice(pkg);
    updateTotal();
};

window.closeCustomize = function() {
    document.getElementById('customizeModal').style.display = 'none';
};

window.proceedToPayment = function() {
    // 🔒 Require login before opening the payment modal
    if (typeof requireLoginOrPrompt === 'function' && !requireLoginOrPrompt('book ' + window.currentPackage)) {
        document.getElementById('customizeModal').style.display = 'none';
        return;
    }
    const totalStr = document.getElementById('totalPrice').textContent.match(/₹([\d,]+)/)[1].replace(/,/g, '');
    const total = parseFloat(totalStr);
    document.getElementById('finalAmount').textContent = `₹${total.toLocaleString()}`;
    document.getElementById('bookingDetails').textContent = `Package: ${window.currentPackage.charAt(0).toUpperCase() + window.currentPackage.slice(1)}, Duration: ${document.getElementById('duration').value}, Guests: ${document.getElementById('rooms').value}`;
    document.getElementById('customizeModal').style.display = 'none';
    document.getElementById('paymentModal').style.display = 'block';
};

window.closePayment = function() {
    document.getElementById('paymentModal').style.display = 'none';
};

window.confirmBooking = async function() {
    if (!arePaymentsEnabled()) {
        // Close any open payment modal and show the call-to-book alert.
        const pm = document.getElementById('paymentModal');
        if (pm) pm.style.display = 'none';
        showPaymentsDisabledAlert();
        return;
    }
    // 🔒 Final defence: even if the modal somehow opened without login, block payment.
    if (typeof requireLoginOrPrompt === 'function' && !requireLoginOrPrompt('pay for ' + window.currentPackage)) {
        const pm = document.getElementById('paymentModal');
        if (pm) pm.style.display = 'none';
        return;
    }
    const priceStr = document.getElementById('finalAmount').textContent.replace(/[^0-9]/g, '');
    const price = parseFloat(priceStr);
    const details = document.getElementById('bookingDetails').textContent;
    
    // Get user info (optional - can work without login for demo)
    const token = localStorage.getItem('token');
    const currentUser = localStorage.getItem('currentUser');
    
    // Initialize Razorpay payment
    const options = {
        key: 'rzp_live_SLfG8nnKN3tXPC', // Live key
        amount: price * 100, // Amount in paise
        currency: 'INR',
        name: 'Bharat Tours & Travels',
        description: `${window.currentPackage} Package - Travel Booking`,
        image: 'https://andamanvoyages.in/images/logo.png',
        handler: async function(response) {
            // Payment successful
            const bookingData = {
                package_name: window.currentPackage,
                duration: document.getElementById('duration') ? document.getElementById('duration').value : 'Standard',
                price,
                guests: document.getElementById('rooms') ? document.getElementById('rooms').value : '2 Adults',
                details,
                payment_id: response.razorpay_payment_id,
                payment_method: 'razorpay',
                status: 'confirmed'
            };
            
            try {
                if (window.createBooking) {
                    await window.createBooking(bookingData);
                    alert('🎉 Booking confirmed! Payment successful.\n\nPayment ID: ' + response.razorpay_payment_id + '\n\nYour confirmation will be sent to your email.');
                } else {
                    alert('🎉 Payment successful!\n\nPayment ID: ' + response.razorpay_payment_id + '\n\nBooking details:\n' + JSON.stringify(bookingData, null, 2));
                }
                document.getElementById('paymentModal').style.display = 'none';
                if (window.openProfile) window.openProfile();
            } catch (err) {
                alert('Payment was successful!\n\nPayment ID: ' + response.razorpay_payment_id + '\n\nNote: Booking save encountered an issue. Please contact support with your Payment ID.');
                console.error('Booking save error:', err);
                document.getElementById('paymentModal').style.display = 'none';
            }
        },
        prefill: {
            name: currentUser ? JSON.parse(currentUser).username : 'Guest User',
            email: currentUser ? JSON.parse(currentUser).email : 'guest@example.com',
            contact: '8880195191'
        },
        notes: {
            package: window.currentPackage,
            duration: document.getElementById('duration') ? document.getElementById('duration').value : 'Standard'
        },
        theme: {
            color: '#0d7a8a' // Teal color to match our theme
        }
    };
    
    // Check if Razorpay is loaded
    if (typeof Razorpay === 'undefined') {
        alert('❌ Payment system not loaded. Please refresh the page and try again.');
        console.error('Razorpay script not found');
        return;
    }

    
    const rzp1 = new Razorpay(options);
    
    rzp1.on('payment.failed', function (response) {
        alert('❌ Payment failed!\n\nError: ' + response.error.description + '\n\nPlease try again or contact support.');
        console.error('Payment error:', response);
    });
    
    rzp1.open();
};

// ── Site-settings cache + payments-disabled helper ──────────
window._siteSettings = { paymentsEnabled: true, paymentsDisabledMessage: '' };

function arePaymentsEnabled() {
    return window._siteSettings && window._siteSettings.paymentsEnabled !== false;
}

function showPaymentsDisabledAlert() {
    const msg = (window._siteSettings && window._siteSettings.paymentsDisabledMessage)
        ? window._siteSettings.paymentsDisabledMessage
        : 'Online payments are temporarily unavailable.\n\nTo book this package, please call or WhatsApp us:\n\n📞 +91 88801 95191\n📞 +91 94341 25698\n\nOr email: booking@andamanvoyages.in\n\nWe\'ll confirm your booking and arrange a payment link / bank transfer.';
    alert('🛎️ ' + msg);
}

// ── Login-required helper ─────────────────────────────────
// Cache the live Firebase auth instance once it's ready, so
// isUserLoggedIn() can do a synchronous check on every click.
window.__authInstance = null;
window.__firebaseAuthReady = false;
if (window.__firebaseReady && typeof window.__firebaseReady.then === 'function') {
    window.__firebaseReady.then(({ auth, firebaseAuth }) => {
        window.__authInstance = auth;
        // Wait for the FIRST auth-state event (definitive answer about login state).
        // Until this fires, Firebase may still be restoring a persisted session.
        if (firebaseAuth && typeof firebaseAuth.onAuthStateChanged === 'function') {
            const stop = firebaseAuth.onAuthStateChanged(auth, (u) => {
                window.__firebaseAuthReady = true;
                // If Firebase says no user, scrub stale local cache too.
                if (!u) {
                    try { localStorage.removeItem('currentUser'); } catch (e) {}
                    try { localStorage.removeItem('token'); } catch (e) {}
                }
            });
        } else {
            window.__firebaseAuthReady = true;
        }
    }).catch(() => { window.__firebaseAuthReady = true; });
}

function isUserLoggedIn() {
    // 1) Primary source of truth: live Firebase Auth instance (modular SDK v9+)
    if (window.__authInstance) {
        const u = window.__authInstance.currentUser;
        const ok = !!(u && u.uid);
        // Debug aid: leave a breadcrumb in console so we can verify the check.
        try { console.debug('[auth] isUserLoggedIn (Firebase)=', ok, u && u.email); } catch (e) {}
        return ok;
    }
    // 2) Firebase not yet ready → require BOTH localStorage entries (token + uid)
    //    so any orphan value gets rejected.
    try {
        const cu = JSON.parse(localStorage.getItem('currentUser') || 'null');
        const tok = localStorage.getItem('token');
        const ok = !!(cu && (cu.uid || cu.id) && tok);
        try { console.debug('[auth] isUserLoggedIn (localStorage)=', ok); } catch (e) {}
        return ok;
    } catch (e) { return false; }
}

function requireLoginOrPrompt(intentLabel) {
    if (isUserLoggedIn()) return true;
    // Remember what the user was trying to do, so we can resume after login.
    try {
        sessionStorage.setItem('postLoginIntent', JSON.stringify({
            type: 'book',
            pkg: window.currentPackage || null,
            label: intentLabel || 'continue booking',
            ts: Date.now()
        }));
    } catch (e) {}
    // No browser alert — just open the login modal silently.
    if (typeof window.openLogin === 'function') window.openLogin();
    return false;
}

window.bookPackage = function(pkg) {
    try {
        if (!arePaymentsEnabled()) { showPaymentsDisabledAlert(); return; }
        window.currentPackage = pkg;
        // Build a cart object and navigate to the dedicated checkout page.
        const pkgData = (window._packages || []).find(p => p.id === pkg) ||
                        { id: pkg, name: pkg, price: getPkgPrice(pkg), image: '', duration: '' };
        const sc = (function () {
            try { return JSON.parse(sessionStorage.getItem('searchContext') || 'null'); } catch (e) { return null; }
        })();
        const cart = {
            pkgId: pkgData.id,
            name: pkgData.name,
            price: pkgData.price,
            image: pkgData.image || 'images/beach1.jpg',
            duration: pkgData.duration || '',
            adults: (sc && sc.adults) || 2,
            children: (sc && sc.children) || 0,
            travelDate: (sc && sc.date) || '',
            addons: [],
            duration_pref: '',
            meals: ''
        };
        try { sessionStorage.setItem('checkoutCart', JSON.stringify(cart)); } catch (e) {}
        window.location.href = '/checkout';
    } catch (e) {
        console.error('Error in bookPackage:', e);
        if (window.Toast) window.Toast.error('Could not start booking: ' + e.message);
    }
};

// Additional global functions
window.quickSearch = function() {
    document.querySelector('#packages').scrollIntoView({ behavior: 'smooth' });
    alert('Searching best Andaman packages for your dates!');
};

window.searchPackages = function() {
    alert('Redirecting to Andaman packages...');
    document.querySelector('#packages').scrollIntoView({ behavior: 'smooth' });
};

window.openRegister = function() {
    document.getElementById('registerModal').style.display = 'block';
};

window.closeRegister = function() {
    document.getElementById('registerModal').style.display = 'none';
};

window.openLogin = function() {
    document.getElementById('loginModal').style.display = 'block';
};

window.closeLogin = function() {
    document.getElementById('loginModal').style.display = 'none';
};

window.openProfile = function() {
    document.getElementById('profileModal').style.display = 'block';
};

window.closeProfile = function() {
    document.getElementById('profileModal').style.display = 'none';
};

document.addEventListener('DOMContentLoaded', function() {
    // ── Load packages from API ─────────────────────────────────
    loadAndRenderSitePackages();

    // 🔑 Open the login modal automatically when navigating to #login
    // (e.g. from package.html when user tries to book without being logged in)
    function showLoginRequiredNotice() {
        const modal = document.getElementById('loginModal');
        if (!modal) return;
        const content = modal.querySelector('.modal-content');
        if (!content || content.querySelector('#loginRequiredNotice')) return;
        const notice = document.createElement('div');
        notice.id = 'loginRequiredNotice';
        notice.style.cssText = 'background:#fff8e7;color:#8a6d3b;padding:.7rem .9rem;border-radius:6px;border-left:3px solid #f39c12;margin:0 0 1rem;font-size:.92rem;line-height:1.45;';
        notice.innerHTML = '<i class="fas fa-info-circle"></i> Please log in to continue with your booking. Your package selection has been saved &mdash; payment will resume automatically after sign-in.';
        const h2 = content.querySelector('h2');
        if (h2 && h2.nextSibling) h2.parentNode.insertBefore(notice, h2.nextSibling);
        else content.insertBefore(notice, content.firstChild);
    }
    const _hasPendingIntent = (function () {
        try { return !!sessionStorage.getItem('postLoginIntent'); } catch (e) { return false; }
    })();
    if ((window.location.hash === '#login' || _hasPendingIntent) && !isUserLoggedIn()) {
        // Small delay so DOM is fully ready
        setTimeout(() => {
            showLoginRequiredNotice();
            if (typeof window.openLogin === 'function') window.openLogin();
        }, 100);
    }

    // ── Load site settings from Firestore (payments toggle, etc.) ──
    if (window.SettingsStore && typeof window.SettingsStore.load === 'function') {
        // Use cached value first (instant), then fetch fresh and re-apply
        const cached = window.SettingsStore.cached && window.SettingsStore.cached();
        if (cached) {
            window._siteSettings = cached;
            applyPaymentsState();
        }
        window.SettingsStore.load().then(s => {
            window._siteSettings = s || window._siteSettings;
            applyPaymentsState();
        }).catch(err => console.warn('Settings load failed:', err));
    }

    function applyPaymentsState() {
        const enabled = arePaymentsEnabled();
        // Re-render package cards so the CTA labels update
        if (typeof renderSitePackages === 'function') renderSitePackages();
        // Show/hide a banner above #packages
        let banner = document.getElementById('paymentsDisabledBanner');
        if (!enabled) {
            if (!banner) {
                banner = document.createElement('div');
                banner.id = 'paymentsDisabledBanner';
                banner.className = 'payments-disabled-banner';
                const target = document.getElementById('packages') || document.querySelector('main');
                if (target) target.parentNode.insertBefore(banner, target);
            }
            const customMsg = (window._siteSettings && window._siteSettings.paymentsDisabledMessage) || '';
            banner.innerHTML =
                '<i class="fas fa-info-circle"></i> ' +
                (customMsg ||
                'Online payments are temporarily unavailable. Please call <a href="tel:+918880195191">+91 88801 95191</a> or email <a href="mailto:booking@andamanvoyages.in">booking@andamanvoyages.in</a> to book.');
        } else if (banner) {
            banner.remove();
        }

        // Also tweak the modal "Pay Now" button label and the modal subtitle
        const cb = document.getElementById('confirmBookingBtn');
        if (cb) cb.innerHTML = enabled
            ? '<i class="fas fa-credit-card"></i> Pay Now with Razorpay'
            : '<i class="fas fa-phone-alt"></i> Call to Book — Payments Disabled';
    }

    // ── Hero Carousel ──────────────────────────────────────────
    (function initCarousel() {
        const slides = document.querySelectorAll('.carousel-slide');
        const dotsContainer = document.getElementById('carouselDots');
        const prevBtn = document.getElementById('carouselPrev');
        const nextBtn = document.getElementById('carouselNext');
        if (!slides.length) return;

        let current = 0;
        let autoTimer = null;

        // Build dots
        slides.forEach((_, i) => {
            const dot = document.createElement('button');
            dot.className = 'carousel-dot' + (i === 0 ? ' active' : '');
            dot.setAttribute('aria-label', `Slide ${i + 1}`);
            dot.addEventListener('click', () => goTo(i));
            dotsContainer.appendChild(dot);
        });

        function goTo(index) {
            slides[current].classList.remove('active');
            dotsContainer.children[current].classList.remove('active');
            current = (index + slides.length) % slides.length;
            slides[current].classList.add('active');
            dotsContainer.children[current].classList.add('active');
        }

        function next() { goTo(current + 1); }
        function prev() { goTo(current - 1); }

        function startAuto() {
            stopAuto();
            autoTimer = setInterval(next, 4500);
        }
        function stopAuto() {
            if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
        }

        prevBtn.addEventListener('click', () => { prev(); startAuto(); });
        nextBtn.addEventListener('click', () => { next(); startAuto(); });

        // Pause on hover
        const carousel = document.querySelector('.hero-carousel');
        carousel.addEventListener('mouseenter', stopAuto);
        carousel.addEventListener('mouseleave', startAuto);

        // Touch / swipe support
        let touchStartX = 0;
        carousel.addEventListener('touchstart', e => { touchStartX = e.touches[0].clientX; }, { passive: true });
        carousel.addEventListener('touchend', e => {
            const diff = touchStartX - e.changedTouches[0].clientX;
            if (Math.abs(diff) > 50) { diff > 0 ? next() : prev(); startAuto(); }
        }, { passive: true });

        startAuto();
    })();

    // Mobile hamburger: slide-down topnav
    const hamburgerBtn = document.getElementById('hamburgerBtn');
    if (hamburgerBtn) hamburgerBtn.addEventListener('click', () => {
        document.body.classList.toggle('nav-open');
    });

    // Topbar scroll state — adds .scrolled when the page is scrolled past 30px,
    // bumping the translucent header to a more opaque look so text stays legible.
    (function () {
        const tb = document.querySelector('.topbar');
        if (!tb) return;
        const apply = () => {
            if (window.scrollY > 30) tb.classList.add('scrolled');
            else                     tb.classList.remove('scrolled');
        };
        apply();
        window.addEventListener('scroll', apply, { passive: true });
    })();

    // Wrap every letter of the brand name in <span class="bl"> so we can
    // animate them one-by-one on hover (sequential wave + tilt + colour).
    (function wrapBrandLetters() {
        document.querySelectorAll('.brand-line1, .brand-line2').forEach(line => {
            const text = line.textContent;
            line.innerHTML = '';
            for (const ch of text) {
                if (ch === ' ') {
                    // Preserve normal spacing — empty span won't animate but keeps gap
                    const sp = document.createElement('span');
                    sp.className = 'bl';
                    sp.style.width = '.35em';
                    sp.innerHTML = '&nbsp;';
                    line.appendChild(sp);
                } else {
                    const sp = document.createElement('span');
                    sp.className = 'bl';
                    sp.textContent = ch;
                    line.appendChild(sp);
                }
            }
        });
    })();

    // ── Move .topbar-contact (phone+email) BELOW the search bar ─
    // On the home page we drop it just under the .mmt-searchbar in the
    // hero section. On every other page we drop it just below the topbar
    // so users can still see the numbers without crowding the header.
    (function relocateContactStrip() {
        const tc = document.querySelector('.topbar > .topbar-contact');
        if (!tc) return;
        const parent = tc.parentElement;
        // Pull it out of the topbar
        parent.removeChild(tc);
        tc.classList.add('contact-strip-floating');
        const searchBar = document.querySelector('.mmt-searchbar');
        if (searchBar && searchBar.parentElement) {
            // Place AFTER the search bar in the hero
            searchBar.parentElement.insertBefore(tc, searchBar.nextSibling);
        } else {
            // Fallback: pin it just under the topbar
            tc.style.position = 'fixed';
            tc.style.top      = 'calc(var(--tb-h) - 0.4rem)';
            tc.style.right    = '1rem';
            tc.style.zIndex   = '88';
            document.body.appendChild(tc);
        }
    })();

    // User menu is now built by js/user-menu.js (loaded from every page)
    document.addEventListener('click', (e) => {
        if (!document.body.classList.contains('nav-open')) return;
        const topnav = document.getElementById('topnav');
        if (topnav && topnav.contains(e.target)) {
            // Clicked a nav link → close menu
            if (e.target.closest('.topnav-item')) document.body.classList.remove('nav-open');
            return;
        }
        if (hamburgerBtn && !hamburgerBtn.contains(e.target)) {
            document.body.classList.remove('nav-open');
        }
    });

    // Top nav active-state highlight on click
    document.querySelectorAll('.topnav-item').forEach(a => {
        a.addEventListener('click', function () {
            // Don't toggle for CTAs (Login/Sign Up) or non-hash links
            if (this.classList.contains('topnav-cta')) return;
            const href = this.getAttribute('href');
            if (!href || !href.startsWith('#')) return;
            document.querySelectorAll('.topnav-item').forEach(x => x.classList.remove('active'));
            this.classList.add('active');
        });
    });

    // Bookings section: wire Login + Register buttons
    const bookingsLoginBtn = document.getElementById('bookingsLoginBtn');
    if (bookingsLoginBtn) bookingsLoginBtn.addEventListener('click', () => window.openLogin && window.openLogin());
    const bookingsRegisterBtn = document.getElementById('bookingsRegisterBtn');
    if (bookingsRegisterBtn) bookingsRegisterBtn.addEventListener('click', () => window.openRegister && window.openRegister());

    // Bookings tabs (All / Upcoming / Completed / Cancelled)
    document.querySelectorAll('.bk-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.bk-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            // Render filtered bookings if the data is available
            if (window.renderBookings) {
                window.renderBookings(tab.dataset.bkFilter || 'all');
            }
        });
    });

    // Toggle logged-out vs logged-in state in the Bookings section
    function refreshBookingsSection() {
        const loggedOut = document.getElementById('bookingsLoggedOut');
        const loggedIn  = document.getElementById('bookingsLoggedIn');
        const isLoggedIn = !!localStorage.getItem('token') || !!window.currentUser;
        if (loggedOut) loggedOut.style.display = isLoggedIn ? 'none' : '';
        if (loggedIn)  loggedIn.style.display  = isLoggedIn ? '' : 'none';
        if (isLoggedIn && window.loadAndRenderUserBookings) {
            window.loadAndRenderUserBookings();
        }
    }
    refreshBookingsSection();
    // Re-run when login/logout occurs
    window.addEventListener('storage', refreshBookingsSection);
    document.addEventListener('auth:changed', refreshBookingsSection);

    // 🔁 Auto-resume booking after successful login
    document.addEventListener('auth:changed', () => {
        try {
            const raw = sessionStorage.getItem('postLoginIntent');
            if (!raw) return;
            const intent = JSON.parse(raw);
            // Ignore stale intents (older than 30 minutes)
            if (!intent || (Date.now() - (intent.ts || 0)) > 30 * 60 * 1000) {
                sessionStorage.removeItem('postLoginIntent');
                return;
            }
            sessionStorage.removeItem('postLoginIntent');
            if (intent.type === 'checkout') {
                if (window.Toast) window.Toast.success('Welcome back! Redirecting to checkout…');
                setTimeout(() => { window.location.href = '/checkout'; }, 600);
                return;
            }
            if (intent.type === 'book' && intent.pkg && typeof window.bookPackage === 'function') {
                // Small delay so login modal has time to close cleanly
                setTimeout(() => window.bookPackage(intent.pkg), 250);
            }
        } catch (e) { console.warn('postLoginIntent resume failed:', e); }
    });

    // Sign Up nav link
    const signUpNavLink = document.getElementById('signUpNavLink');
    if (signUpNavLink) {
        signUpNavLink.addEventListener('click', (e) => { e.preventDefault(); window.openRegister(); });
    }

    // Add event listener for Login/Profile button
    const loginLink = document.getElementById('authLink');
    if (loginLink) {
        // Update listener based on login state
        const updateAuthLinkListener = () => {
            if (loginLink.onclick) loginLink.onclick = null;
            loginLink.addEventListener('click', (e) => {
                e.preventDefault();
                // Check for token or currentUser
                const hasToken = localStorage.getItem('token');
                if (hasToken || window.currentUser) {
                    window.openProfile();
                } else {
                    window.openLogin();
                }
            });
        };
        
        // Set up listener after a short delay to allow auth.js to load
        setTimeout(updateAuthLinkListener, 100);
        
        // Re-update listener when auth state changes
        const originalLogin = window.login;
        window.login = function(...args) {
            const result = originalLogin.apply(this, args);
            setTimeout(updateAuthLinkListener, 100);
            return result;
        };
        
        const originalLogout = window.logout;
        window.logout = function(...args) {
            originalLogout.apply(this, args);
            setTimeout(updateAuthLinkListener, 100);
        };
    }

    // Close buttons — handle both old .close class and new data-close attribute
    document.querySelectorAll('.close, [data-close]').forEach(btn => {
        btn.addEventListener('click', () => {
            const modalId = btn.dataset.close;
            if (modalId) {
                const m = document.getElementById(modalId);
                if (m) m.style.display = 'none';
            } else {
                const modal = btn.closest('.modal');
                if (modal) modal.style.display = 'none';
            }
        });
    });

    // In-form navigation links
    const goToRegister = document.getElementById('goToRegister');
    if (goToRegister) goToRegister.addEventListener('click', (e) => { e.preventDefault(); window.closeLogin && window.closeLogin(); window.openRegister(); });

    const goToLogin = document.getElementById('goToLogin');
    if (goToLogin) goToLogin.addEventListener('click', (e) => { e.preventDefault(); window.closeRegister && window.closeRegister(); window.openLogin(); });

    // Smooth scrolling
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            const href = this.getAttribute('href');
            // Skip if href is just "#" or empty, or if link has onclick handler
            if ((href === '#' || !href) || this.getAttribute('onclick')) {
                e.preventDefault();
                return;
            }
            e.preventDefault();
            const target = document.querySelector(href);
            if (target) {
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        });
    });

    // ── MMT-style listing event wiring ─────────────────────────
    // Tab clicks (All / Budget / Honeymoon / Premium / Standard)
    document.querySelectorAll('#mmtTabs .mmt-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('#mmtTabs .mmt-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            mmtState.cat = tab.dataset.cat || 'all';
            renderSitePackages();
        });
    });

    // Tab arrow scroll
    document.querySelectorAll('#mmtTabs [data-tab-scroll]').forEach(btn => {
        btn.addEventListener('click', () => {
            const tabs = document.getElementById('mmtTabs');
            if (!tabs) return;
            tabs.scrollBy({ left: btn.dataset.tabScroll === 'right' ? 200 : -200, behavior: 'smooth' });
        });
    });

    // Filter group accordion + checkbox changes
    document.querySelectorAll('.mmt-filter-group').forEach(group => {
        const head = group.querySelector('.mmt-filter-head');
        if (head) {
            head.addEventListener('click', () => group.classList.toggle('open'));
        }
    });
    document.querySelectorAll('#mmtFilters input[type="checkbox"]').forEach(cb => {
        cb.addEventListener('change', () => {
            const name = cb.name; // 'dur' | 'budget' | 'hotel' | 'theme'
            if (!Array.isArray(mmtState[name])) mmtState[name] = [];
            if (cb.checked) {
                if (!mmtState[name].includes(cb.value)) mmtState[name].push(cb.value);
            } else {
                mmtState[name] = mmtState[name].filter(v => v !== cb.value);
            }
            renderSitePackages();
        });
    });



    // View toggle (Grid / List)
    (function () {
        const grid = document.getElementById('packagesGrid');
        if (!grid) return;
        const buttons = document.querySelectorAll('.mmt-view-toggle .view-btn');
        function applyView(view) {
            grid.classList.remove('view-grid', 'view-list');
            grid.classList.add(view === 'list' ? 'view-list' : 'view-grid');
            buttons.forEach(b => b.classList.toggle('active', b.dataset.view === view));
            try { localStorage.setItem('pkgView', view); } catch (e) {}
        }
        // Restore preference
        const saved = (function () { try { return localStorage.getItem('pkgView'); } catch (e) { return null; } })();
        if (saved === 'list' || saved === 'grid') applyView(saved);
        buttons.forEach(b => b.addEventListener('click', () => applyView(b.dataset.view)));
    })();

    // Sort dropdown
    const mmtSort = document.getElementById('mmtSort');
    if (mmtSort) {
        mmtSort.addEventListener('change', () => {
            mmtState.sort = mmtSort.value;
            renderSitePackages();
        });
    }

    // Search button (top navy bar) — captures search criteria
    const mmtSearchBtn = document.getElementById('mmtSearchBtn');
    if (mmtSearchBtn) {
        mmtSearchBtn.addEventListener('click', () => {
            const fromEl = document.getElementById('mmtFrom');
            const dateEl = document.getElementById('mmtDate');
            const adultsEl = document.getElementById('mmtAdults');
            const childrenEl = document.getElementById('mmtChildren');

            const from = fromEl ? fromEl.value.trim() : '';
            const date = dateEl ? dateEl.value : '';
            const adults = adultsEl ? parseInt(adultsEl.value, 10) : 2;
            const children = childrenEl ? parseInt(childrenEl.value, 10) : 0;

            if (!from) {
                alert('Please enter your travelling-from city.');
                if (fromEl) fromEl.focus();
                return;
            }
            if (!date) {
                alert('Please select a travel date.');
                if (dateEl) dateEl.focus();
                return;
            }

            // Persist search context for downstream use (booking/customize flow)
            window.searchContext = {
                from, to: 'Andaman', date, adults, children,
                totalPersons: adults + children
            };
            try { sessionStorage.setItem('searchContext', JSON.stringify(window.searchContext)); } catch (e) {}

            // GA4 — search event
            try {
                window.Analytics && window.Analytics.search(`${from} → Andaman | ${date} | ${adults}A${children}C`);
            } catch (e) {}

            // Reset to ALL and refresh, then scroll into view
            mmtState.cat = 'all';
            document.querySelectorAll('#mmtTabs .mmt-tab').forEach(t => {
                t.classList.toggle('active', t.dataset.cat === 'all');
            });
            renderSitePackages();
            const grid = document.getElementById('packagesGrid');
            if (grid) grid.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
    }

    // Card click delegation (Book / Customize / Enquire / View Details)
    const grid = document.getElementById('packagesGrid');
    if (grid) {
        grid.addEventListener('click', (e) => {
            const bookBtn = e.target.closest('[data-action="book"]');
            if (bookBtn) { e.stopPropagation(); window.bookPackage(bookBtn.dataset.pkg); return; }
            const enqBtn = e.target.closest('[data-action="enquire"]');
            if (enqBtn) {
                e.stopPropagation();
                const pkgId = enqBtn.dataset.pkg;
                const pkg = (window._packages || []).find(p => p.id === pkgId);
                const name = pkg ? pkg.name : pkgId;
                alert(
                    '⚠️ "' + name + '" is currently SOLD OUT.\n\n' +
                    'Drop us a line to be notified when this package is available again, ' +
                    'or to ask about similar packages with open dates:\n\n' +
                    '📞 +91 88801 95191 / +91 94341 25698\n' +
                    '📧 booking@andamanvoyages.in'
                );
                return;
            }
            const custBtn = e.target.closest('[data-action="customize"]');
            if (custBtn) { e.stopPropagation(); window.openCustomize(custBtn.dataset.pkg); return; }
            const navEl = e.target.closest('[data-nav]');
            if (navEl) { window.location.href = '/package?id=' + navEl.dataset.nav; return; }
        });
    }

    // Legacy compatibility (in case old #packageSearch / #sortSelect still exist)
    const packageSearch = document.getElementById('packageSearch');
    if (packageSearch) {
        packageSearch.addEventListener('input', (e) => {
            const q = e.target.value.toLowerCase();
            document.querySelectorAll('#packagesGrid .mmt-card, #packagesGrid .package-card').forEach(card => {
                const name = (card.getAttribute('data-name') || '').toLowerCase();
                card.style.display = name.includes(q) ? '' : 'none';
            });
        });
    }

    // Form handlers for auth
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const email = document.getElementById('loginEmail').value;
            const password = document.getElementById('loginPassword').value;
            window.login(email, password).catch(err => alert(err.message || 'Login failed'));
        });
    }

    const registerForm = document.getElementById('registerForm');
    if (registerForm) {
        registerForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const fullName = (document.getElementById('regFullName') || {}).value || '';
            const username = document.getElementById('regUsername').value;
            const email    = document.getElementById('regEmail').value;
            const phone    = (document.getElementById('regPhone') || {}).value || '';
            const password = document.getElementById('regPassword').value;
            window.register({ username, email, password, fullName, phone })
                .catch(err => alert(err.message || 'Registration failed'));
        });
    }

    // Customization form
    const checkboxes = document.querySelectorAll('#customForm input[type="checkbox"]');
    checkboxes.forEach(cb => cb.addEventListener('change', updateTotal));

    // Proceed to Payment button (in customize modal)
    const proceedPaymentBtn = document.getElementById('proceedPaymentBtn');
    if (proceedPaymentBtn) proceedPaymentBtn.addEventListener('click', window.proceedToPayment);

    // Confirm Booking / Pay Now button (in payment modal)
    const confirmBookingBtn = document.getElementById('confirmBookingBtn');
    if (confirmBookingBtn) confirmBookingBtn.addEventListener('click', window.confirmBooking);

    // Logout button
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) logoutBtn.addEventListener('click', () => window.logout && window.logout());

    // Close modals on outside click
    window.onclick = function(event) {
        const customizeModal = document.getElementById('customizeModal');
        const paymentModal = document.getElementById('paymentModal');
        const loginModal = document.getElementById('loginModal');
        const registerModal = document.getElementById('registerModal');
        const profileModal = document.getElementById('profileModal');
        if (event.target == customizeModal) customizeModal.style.display = 'none';
        if (event.target == paymentModal) paymentModal.style.display = 'none';
        if (event.target == loginModal) loginModal.style.display = 'none';
        if (event.target == registerModal) registerModal.style.display = 'none';
        if (event.target == profileModal) profileModal.style.display = 'none';
    }
});
