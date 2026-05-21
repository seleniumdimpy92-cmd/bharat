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

async function loadAndRenderSitePackages() {
    // 1. Try cached copy first for instant render (avoids blank state)
    const cached = localStorage.getItem('sitePackages');
    if (cached) {
        try {
            const parsed = JSON.parse(cached);
            if (Array.isArray(parsed) && parsed.length) {
                window._packages = parsed;
                renderSitePackages();
            }
        } catch (_) { /* ignore parse errors */ }
    }

    // 2. Then fetch the canonical JSON from the repo (committed by admin via
    //    the GitHub API). Cache-bust so visitors always see the latest.
    try {
        const res = await fetch('data/packages.json?t=' + Date.now(), { cache: 'no-store' });
        if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data) && data.length) {
                window._packages = data;
                localStorage.setItem('sitePackages', JSON.stringify(data));
                renderSitePackages();
                return;
            }
        }
    } catch (_) { /* fall through to defaults */ }

    // 3. Last-resort hard-coded defaults
    if (!window._packages) {
        window._packages = [
            { id:'budget',    name:'Budget Andaman Escape',    desc:'4N/5D | Port Blair + Havelock | Basic Hotels + Ferries', price:15999, rating:4.2, image:'images/beach1.jpg', inclusions:['Hotels','Ferries','Breakfast'], visible:true },
            { id:'standard',  name:'Standard Andaman Bliss',   desc:'6N/7D | Port Blair + Havelock + Neil | Deluxe + Activities', price:21999, rating:4.6, image:'images/beach2.jpg', inclusions:['Deluxe Hotels','Premium Ferries','Snorkeling'], visible:true },
            { id:'luxury',    name:'Luxury Andaman Retreat',   desc:'6N/7D | All Islands | 5* Resorts + Scuba + Private Transfers', price:28999, rating:4.8, image:'images/beach3.jpg', inclusions:['5* Resorts','VIP Ferries','Scuba Dive'], visible:true },
            { id:'honeymoon', name:'Honeymoon Paradise',       desc:'5N/6D | Romantic Stays + Candlelight Dinner + Photos', price:24999, rating:4.9, image:'images/beach4.jpg', inclusions:['Romantic Setup','Photoshoot','Dinner'], visible:true },
            { id:'test',      name:'🧪 Payment Test Package',  desc:'Test the live payment gateway for ₹1 only', price:1, rating:5.0, image:'images/beach1.jpg', inclusions:['Live Payment','Instant'], visible:true }
        ];
        renderSitePackages();
    }
}

function renderSitePackages() {
    const grid = document.getElementById('packagesGrid');
    if (!grid || !window._packages) return;

    const visible = window._packages.filter(p => p.visible !== false);
    grid.innerHTML = visible.map(pkg => {
        const isTest = pkg.id === 'test' || pkg.price <= 1;
        return `
        <div class="package-card" data-name="${pkg.id}" data-pkgid="${pkg.id}" style="cursor:pointer;">
            <div class="card-image" data-nav="${pkg.id}" style="background-image:linear-gradient(rgba(0,0,0,0.3),rgba(0,0,0,0.3)),url('${pkg.image}');background-size:cover;background-position:center;position:relative;cursor:pointer;">
                <div style="position:absolute;bottom:10px;right:10px;background:rgba(26,188,156,0.9);color:#fff;padding:0.25rem 0.7rem;border-radius:20px;font-size:0.75rem;font-weight:700;display:flex;align-items:center;gap:0.3rem;">
                    <i class="fas fa-eye"></i> View Details
                </div>
            </div>
            <div class="card-content">
                <div class="rating">${Number(pkg.rating).toFixed(1)} <i class="fas fa-star"></i></div>
                <h3 class="package-title" data-nav="${pkg.id}" style="cursor:pointer;">${pkg.name}</h3>
                <p class="package-desc">${pkg.desc || ''}</p>
                <div class="price">₹${Number(pkg.price).toLocaleString()} <span>${isTest ? '/test' : '/person'}</span></div>
                <div class="inclusions">
                    ${(pkg.inclusions || []).map(inc => `<span class="inclusion-badge"><i class="fas ${getInclIcon(inc)}"></i> ${inc}</span>`).join('')}
                </div>
                <div style="display:flex;gap:0.5rem;margin-top:0.5rem;">
                    ${!isTest ? `<button class="btn-outline" style="flex:1;" data-action="customize" data-pkg="${pkg.id}">Customize</button>` : ''}
                    <button class="btn-primary" style="flex:1;" data-action="book" data-pkg="${pkg.id}">${isTest ? 'Pay ₹1 Now' : 'Book Now'}</button>
                </div>
            </div>
        </div>`;
    }).join('');

    // Event delegation — one listener on the grid, handles all cards
    grid.addEventListener('click', function handler(e) {
        // Book Now
        const bookBtn = e.target.closest('[data-action="book"]');
        if (bookBtn) { e.stopPropagation(); window.bookPackage(bookBtn.dataset.pkg); return; }

        // Customize
        const custBtn = e.target.closest('[data-action="customize"]');
        if (custBtn) { e.stopPropagation(); window.openCustomize(custBtn.dataset.pkg); return; }

        // Card image or title — navigate to details
        const navEl = e.target.closest('[data-nav]');
        if (navEl) { window.location.href = 'package.html?id=' + navEl.dataset.nav; return; }
    });
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
        image: 'https://bharatandaman.netlify.app/images/logo.png',
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
            contact: '9876543210'
        },
        notes: {
            package: window.currentPackage,
            duration: document.getElementById('duration') ? document.getElementById('duration').value : 'Standard'
        },
        theme: {
            color: '#1abc9c' // Teal color to match our theme
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

window.bookPackage = function(pkg) {
    try {
        window.currentPackage = pkg;
        const price = getPkgPrice(pkg);
        const paymentModal = document.getElementById('paymentModal');
        if (!paymentModal) { alert('Booking system error. paymentModal not found'); return; }
        const finalAmountEl = document.getElementById('finalAmount');
        const bookingDetailsEl = document.getElementById('bookingDetails');
        if (finalAmountEl) finalAmountEl.textContent = `₹${Number(price).toLocaleString()}`;
        if (bookingDetailsEl) bookingDetailsEl.textContent = `Package: ${pkg.charAt(0).toUpperCase() + pkg.slice(1)}`;
        paymentModal.style.display = 'block';
    } catch (e) {
        console.error('Error in bookPackage:', e);
        alert('An error occurred: ' + e.message);
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

    // Mobile menu toggle
    const hamburger = document.querySelector('.hamburger');
    const navMenu = document.querySelector('.nav-menu');

    if (hamburger && navMenu) {
        hamburger.addEventListener('click', () => {
            hamburger.classList.toggle('active');
            navMenu.classList.toggle('active');
        });

        document.querySelectorAll('.nav-menu a').forEach(n => n.addEventListener('click', () => {
            hamburger.classList.remove('active');
            navMenu.classList.remove('active');
        }));
    }

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

    // Package search and filter
    const packageSearch = document.getElementById('packageSearch');
    const sortSelect = document.getElementById('sortSelect');
    const packageCards = document.querySelectorAll('.package-card');

    function filterPackages(query) {
        packageCards.forEach(card => {
            const name = card.getAttribute('data-name').toLowerCase();
            card.style.display = name.includes(query.toLowerCase()) ? 'block' : 'none';
        });
    }

    if (packageSearch) {
        packageSearch.addEventListener('input', (e) => filterPackages(e.target.value));
    }

    if (sortSelect) {
        sortSelect.addEventListener('change', (e) => {
            const cardsArray = Array.from(packageCards);
            cardsArray.sort((a, b) => {
                // Simple sort by data-price or rating - extend as needed
                return 0; // Placeholder
            }).forEach(card => document.getElementById('packagesGrid').appendChild(card));
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
            const username = document.getElementById('regUsername').value;
            const email = document.getElementById('regEmail').value;
            const password = document.getElementById('regPassword').value;
            window.register(username, email, password).catch(err => alert(err.message || 'Registration failed'));
        });
    }

    // Customization form
    const checkboxes = document.querySelectorAll('#customForm input[type="checkbox"]');
    checkboxes.forEach(cb => cb.addEventListener('change', updateTotal));

    // Find Packages button
    const findPkgsBtn = document.getElementById('findPkgsBtn');
    if (findPkgsBtn) findPkgsBtn.addEventListener('click', window.quickSearch);

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
