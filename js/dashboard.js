// Dashboard JavaScript
document.addEventListener('DOMContentLoaded', function () {
    // ── Data Layer ──────────────────────────────────────────────
    const DB = {
        users: JSON.parse(localStorage.getItem('users') || '[]'),
        bookings: JSON.parse(localStorage.getItem('bookings') || '[]'),
        saveBookings() {
            localStorage.setItem('bookings', JSON.stringify(this.bookings));
        }
    };

    const PACKAGES = {
        budget: { name: 'Budget Andaman Escape', price: 15999, color: '#3498db' },
        standard: { name: 'Standard Andaman Bliss', price: 21999, color: '#1abc9c' },
        luxury: { name: 'Luxury Andaman Retreat', price: 28999, color: '#9b59b6' },
        honeymoon: { name: 'Honeymoon Paradise', price: 24999, color: '#e74c3c' },
        test: { name: 'Payment Test', price: 1, color: '#95a5a6' }
    };

    // Set user display
    const currentUser = JSON.parse(localStorage.getItem('currentUser') || 'null');
    const dashUsername = document.getElementById('dashUsername');
    if (currentUser && dashUsername) {
        dashUsername.textContent = currentUser.username;
    }

    // ── Sidebar Navigation ──────────────────────────────────────
    const sidebarLinks = document.querySelectorAll('.sidebar-link[data-section]');
    const sections = document.querySelectorAll('.dashboard-section');
    const pageTitle = document.getElementById('pageTitle');

    const sectionTitles = {
        overview: 'Dashboard Overview',
        bookings: 'All Bookings',
        packages: 'Package Performance',
        customers: 'Customers',
        revenue: 'Revenue Analytics'
    };

    sidebarLinks.forEach(link => {
        link.addEventListener('click', function (e) {
            e.preventDefault();
            const section = this.dataset.section;

            sidebarLinks.forEach(l => l.classList.remove('active'));
            this.classList.add('active');

            sections.forEach(s => s.classList.remove('active'));
            const target = document.getElementById('section-' + section);
            if (target) target.classList.add('active');

            if (pageTitle) pageTitle.textContent = sectionTitles[section] || 'Dashboard';

            // Refresh data on tab switch
            if (section === 'customers') {
                if (typeof refreshCustomers === 'function') refreshCustomers();
            }

            // Close sidebar on mobile
            document.getElementById('sidebar').classList.remove('open');
        });
    });

    // Mobile sidebar toggle
    const menuToggle = document.getElementById('menuToggle');
    const sidebar = document.getElementById('sidebar');
    const sidebarClose = document.getElementById('sidebarClose');

    if (menuToggle) {
        menuToggle.addEventListener('click', () => sidebar.classList.add('open'));
    }
    if (sidebarClose) {
        sidebarClose.addEventListener('click', () => sidebar.classList.remove('open'));
    }

    // ── Helpers ─────────────────────────────────────────────────
    function formatCurrency(amount) {
        return '₹' + Number(amount).toLocaleString('en-IN');
    }

    function formatDate(dateStr) {
        if (!dateStr) return '-';
        const d = new Date(dateStr);
        return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    }

    function getPackageName(key) {
        if (PACKAGES[key]) return PACKAGES[key].name;
        return key ? key.charAt(0).toUpperCase() + key.slice(1) : 'Unknown';
    }

    function getUserName(userId) {
        const user = DB.users.find(u => u.id === userId);
        return user ? user.username : 'Guest';
    }

    // ── Overview Stats ──────────────────────────────────────────
    function renderOverview() {
        const bookings = DB.bookings;
        const confirmed = bookings.filter(b => b.status !== 'cancelled');
        const cancelled = bookings.filter(b => b.status === 'cancelled');
        const totalRevenue = confirmed.reduce((sum, b) => sum + (b.price || 0), 0);

        document.getElementById('totalBookings').textContent = bookings.length;
        document.getElementById('totalRevenue').textContent = formatCurrency(totalRevenue);
        document.getElementById('totalCustomers').textContent = DB.users.length;
        document.getElementById('confirmedBookings').textContent = confirmed.length;

        // Donut chart
        const total = bookings.length;
        const confirmedCount = confirmed.length;
        const cancelledCount = cancelled.length;

        document.getElementById('donutTotal').textContent = total;
        document.getElementById('legendConfirmed').textContent = confirmedCount;
        document.getElementById('legendCancelled').textContent = cancelledCount;

        const chart = document.getElementById('statusChart');
        if (total > 0) {
            const confirmedDeg = (confirmedCount / total) * 360;
            chart.style.background = `conic-gradient(
                #1abc9c 0deg ${confirmedDeg}deg,
                #e74c3c ${confirmedDeg}deg 360deg
            )`;
        } else {
            chart.style.background = 'conic-gradient(#ddd 0deg 360deg)';
        }

        // Revenue by package bar chart
        renderRevenueBarChart();

        // Recent bookings table
        renderRecentBookings();
    }

    function renderRevenueBarChart() {
        const container = document.getElementById('revenueChart');
        const confirmed = DB.bookings.filter(b => b.status !== 'cancelled');

        const packageRevenue = {};
        confirmed.forEach(b => {
            const key = b.package_name || 'unknown';
            if (!packageRevenue[key]) packageRevenue[key] = 0;
            packageRevenue[key] += b.price || 0;
        });

        const entries = Object.entries(packageRevenue).sort((a, b) => b[1] - a[1]);

        if (entries.length === 0) {
            container.innerHTML = '<p class="chart-empty">No revenue data yet</p>';
            return;
        }

        const maxVal = Math.max(...entries.map(e => e[1]));

        container.innerHTML = entries.map(([pkg, rev]) => {
            const pct = maxVal > 0 ? (rev / maxVal) * 100 : 0;
            const color = PACKAGES[pkg] ? PACKAGES[pkg].color : '#1abc9c';
            return `
                <div class="bar-item">
                    <span class="bar-label">${getPackageName(pkg)}</span>
                    <div class="bar-track">
                        <div class="bar-fill" style="width: ${pct}%; background: ${color};">${formatCurrency(rev)}</div>
                    </div>
                </div>
            `;
        }).join('');
    }

    function renderRecentBookings() {
        const tbody = document.getElementById('recentBookingsBody');
        const recent = [...DB.bookings].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)).slice(0, 5);

        if (recent.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="table-empty">No bookings yet</td></tr>';
            return;
        }

        tbody.innerHTML = recent.map(b => `
            <tr>
                <td>#${String(b.id).slice(-6)}</td>
                <td>${getPackageName(b.package_name)}</td>
                <td>${getUserName(b.userId)}</td>
                <td>${b.duration || '-'}</td>
                <td>${formatCurrency(b.price || 0)}</td>
                <td><span class="badge badge-${b.status || 'confirmed'}">${(b.status || 'confirmed').toUpperCase()}</span></td>
                <td>${formatDate(b.createdAt)}</td>
            </tr>
        `).join('');
    }

    // ── All Bookings ────────────────────────────────────────────
    function renderAllBookings(filter, search) {
        const tbody = document.getElementById('allBookingsBody');
        let bookings = [...DB.bookings].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

        if (filter && filter !== 'all') {
            bookings = bookings.filter(b => (b.status || 'confirmed') === filter);
        }

        if (search) {
            const q = search.toLowerCase();
            bookings = bookings.filter(b =>
                getPackageName(b.package_name).toLowerCase().includes(q) ||
                getUserName(b.userId).toLowerCase().includes(q) ||
                String(b.id).includes(q)
            );
        }

        if (bookings.length === 0) {
            tbody.innerHTML = '<tr><td colspan="9" class="table-empty">No bookings found</td></tr>';
            return;
        }

        tbody.innerHTML = bookings.map(b => `
            <tr>
                <td>#${String(b.id).slice(-6)}</td>
                <td>${getPackageName(b.package_name)}</td>
                <td>${getUserName(b.userId)}</td>
                <td>${b.duration || '-'}</td>
                <td>${b.guests || '-'}</td>
                <td>${formatCurrency(b.price || 0)}</td>
                <td><span class="badge badge-${b.status || 'confirmed'}">${(b.status || 'confirmed').toUpperCase()}</span></td>
                <td>${formatDate(b.createdAt)}</td>
                <td>
                    ${(b.status || 'confirmed') !== 'cancelled'
                        ? `<button class="action-btn action-btn-cancel" data-id="${b.id}">Cancel</button>`
                        : '-'}
                </td>
            </tr>
        `).join('');

        // Attach cancel handlers
        tbody.querySelectorAll('.action-btn-cancel').forEach(btn => {
            btn.addEventListener('click', function () {
                const id = Number(this.dataset.id);
                if (confirm('Cancel this booking?')) {
                    const booking = DB.bookings.find(b => b.id === id);
                    if (booking) {
                        booking.status = 'cancelled';
                        DB.saveBookings();
                        refreshAll();
                    }
                }
            });
        });
    }

    // Booking search and filter
    const bookingSearch = document.getElementById('bookingSearch');
    const bookingFilter = document.getElementById('bookingFilter');

    if (bookingSearch) {
        bookingSearch.addEventListener('input', () => {
            renderAllBookings(bookingFilter.value, bookingSearch.value);
        });
    }
    if (bookingFilter) {
        bookingFilter.addEventListener('change', () => {
            renderAllBookings(bookingFilter.value, bookingSearch.value);
        });
    }

    // ── Package Editor ──────────────────────────────────────────
    let packagesData = [];

    const SITE_IMAGES = [
        'images/beach1.jpg', 'images/beach2.jpg', 'images/beach3.jpg',
        'images/beach4.jpg', 'images/neil1.jpg', 'images/neil2.jpg',
        'images/neil3.jpg', 'images/neil4.jpg', 'images/neil6.jpg',
        'images/ross2.jpg', 'images/ross3.jpg'
    ];

    async function loadAndRenderPackages() {
        const container = document.getElementById('packageCards');
        container.innerHTML = '<p style="padding:2rem;color:#888;text-align:center;"><i class="fas fa-spinner fa-spin"></i> Loading packages…</p>';

        if (window.PackagesStore) {
            await window.PackagesStore.loadWithStaleWhileRevalidate(function (data) {
                packagesData = data;
                renderPackageEditorCards();
            });
            if (packagesData && packagesData.length) return;
        }

        // Fallback hard-coded defaults
        packagesData = Object.entries(PACKAGES).map(([id, p]) => ({
            id, name: p.name, desc: '', price: p.price,
            rating: 4.5, image: 'images/beach1.jpg', inclusions: [], visible: true
        }));
        renderPackageEditorCards();
    }

    function renderPackages() {
        loadAndRenderPackages();
    }

    // ── Itinerary Defaults (same as package.html) ───────────────
    const ITINERARY_DEFAULTS = {
        budget: {
            duration: '4 Nights / 5 Days',
            highlights: ['Radhanagar Beach', 'Cellular Jail', 'Ross Island', 'Havelock Ferry'],
            exclusions: ['Airfare', 'Lunch & Dinner', 'Personal expenses', 'Travel insurance'],
            days: [
                { day:1, title:'Arrival in Port Blair', desc:'Welcome to Andaman! Airport pickup and hotel check-in.', activities:['Airport pickup & hotel check-in','Visit Cellular Jail National Memorial','Light & Sound Show','Overnight in Port Blair'] },
                { day:2, title:'Port Blair – Havelock Island', desc:'Journey to Havelock Island by ferry.', activities:['Breakfast at hotel','Ferry to Havelock Island (90 min)','Check-in to beach resort','Radhanagar Beach (Asia\'s Best Beach)','Sunset at Beach No. 7'] },
                { day:3, title:'Havelock – Beach Day', desc:'Explore pristine beaches and crystal clear waters.', activities:['Morning at Elephant Beach by boat','Snorkeling at coral reef','Lunch at local seafood restaurant','Evening leisure at beach','Bonfire on the beach (optional)'] },
                { day:4, title:'Havelock – Return to Port Blair', desc:'Return journey and explore Port Blair.', activities:['Ferry back to Port Blair','Ross Island & North Bay Island tour','Shopping at Aberdeen Bazaar','Overnight in Port Blair'] },
                { day:5, title:'Departure Day', desc:'Farewell to the Andaman Islands.', activities:['Breakfast and hotel check-out','Airport transfer','Departure'] }
            ]
        },
        standard: {
            duration: '6 Nights / 7 Days',
            highlights: ['Havelock Island', 'Neil Island', 'Scuba Diving', 'Cellular Jail'],
            exclusions: ['Airfare', 'Lunch', 'Additional water sports', 'Personal expenses'],
            days: [
                { day:1, title:'Arrival in Port Blair', desc:'Arrive at Veer Savarkar Airport.', activities:['Airport reception & deluxe hotel check-in','Visit Cellular Jail','Light & Sound Show','Welcome dinner'] },
                { day:2, title:'Port Blair Sightseeing', desc:'Explore historical and natural wonders.', activities:['Anthropological Museum','Chidiya Tapu sunset point','Corbyn\'s Cove Beach','Evening at leisure'] },
                { day:3, title:'Port Blair – Havelock Island', desc:'Transfer to Havelock Island.', activities:['Premium ferry to Havelock','Check-in to deluxe resort','Radhanagar Beach','Sunset photography'] },
                { day:4, title:'Havelock – Water Adventures', desc:'Thrilling underwater experiences.', activities:['Beginner Scuba Diving','Snorkeling at Elephant Beach','Glass-bottom boat ride','Beachside barbecue dinner'] },
                { day:5, title:'Havelock – Neil Island', desc:'Scenic ferry to Neil Island.', activities:['Ferry to Neil Island','Natural Bridge','Bharatpur & Laxmanpur Beaches','Cycling around island'] },
                { day:6, title:'Neil Island – Port Blair', desc:'Last island day before return.', activities:['Sunrise at Laxmanpur Beach','Ferry back to Port Blair','Shopping at Sagarika Emporium','Farewell dinner'] },
                { day:7, title:'Departure', desc:'Time to say goodbye.', activities:['Breakfast and check-out','Airport transfer','Depart with memories'] }
            ]
        },
        luxury: {
            duration: '6 Nights / 7 Days',
            highlights: ['5-Star Resort', 'Private Beach', 'Advanced Scuba', 'Private Yacht'],
            exclusions: ['Airfare', 'Alcohol & bar bills', 'Personal shopping', 'Travel insurance'],
            days: [
                { day:1, title:'Royal Welcome to Port Blair', desc:'Experience luxury from the moment you land.', activities:['Private car airport pickup','Check-in to 5-star sea-facing suite','Welcome cocktails & personal concierge','Private beach dinner under stars'] },
                { day:2, title:'Port Blair VIP Sightseeing', desc:'Exclusive private guided tour.', activities:['Rooftop breakfast with sea view','Private Cellular Jail heritage tour','Private boat to Ross Island','Snorkeling with personal instructor','Spa treatment'] },
                { day:3, title:'Private Yacht to Havelock', desc:'Sail to Havelock in style.', activities:['Gourmet breakfast','Private yacht transfer to Havelock','Check-in to exclusive beach villa','Private beach access','Sundowner cocktails'] },
                { day:4, title:'Havelock – Adventure Luxury', desc:'Best of luxury and adventure.', activities:['Advanced Scuba Diving (PADI)','Private snorkeling charter','Freshly caught seafood lunch','Spa massage session','Private candlelight beach dinner'] },
                { day:5, title:'Havelock Free Day', desc:'Completely personalized day.', activities:['Sunrise yoga on beach','Optional: fishing / jet ski / parasailing','Gourmet beach picnic','Professional photoshoot','Evening bonfire with live music'] },
                { day:6, title:'Havelock – Neil – Port Blair', desc:'Scenic island hopping back.', activities:['Private speedboat to Neil Island','Neil Island exclusive tour','Premium ferry to Port Blair','Farewell gala dinner'] },
                { day:7, title:'VIP Departure', desc:'Farewell befitting royalty.', activities:['Late checkout privilege','Optional spa morning','Private car to airport','Departure'] }
            ]
        },
        honeymoon: {
            duration: '5 Nights / 6 Days',
            highlights: ['Romantic Beach Dinners', 'Couple Spa', 'Photoshoot', 'Sunset Cruise'],
            exclusions: ['Airfare', 'Lunch', 'Additional spa sessions', 'Personal expenses'],
            days: [
                { day:1, title:'Romantic Arrival', desc:'Begin your love story in paradise.', activities:['Flower bouquet welcome','Couple\'s suite with sea view','Room decorated with flowers','Candlelight beach dinner','Bonfire under the stars'] },
                { day:2, title:'Port Blair Romantic Exploration', desc:'Discover beauty together.', activities:['Breakfast in bed','Private sightseeing of Port Blair','Cellular Jail visit','Couple\'s spa and wellness','Sunset cruise with cocktails'] },
                { day:3, title:'Ferry to Havelock – Beach Romance', desc:'Havelock\'s beaches are made for couples.', activities:['Ferry to Havelock','Couple\'s beach villa check-in','Radhanagar Beach stroll','Professional couple photoshoot','Romantic beachside dinner'] },
                { day:4, title:'Havelock – Adventure for Two', desc:'Create thrilling memories together.', activities:['Couple\'s Scuba Diving','Snorkeling at Elephant Beach','Private picnic lunch','Couple\'s spa massage','Stargazing on beach'] },
                { day:5, title:'Havelock – Last Beach Day', desc:'Soak in every last moment.', activities:['Sunrise yoga on beach','Leisure morning at private beach','Last photoshoot session','Ferry back to Port Blair','Farewell romantic dinner'] },
                { day:6, title:'Departure', desc:'Until next time, paradise.', activities:['Breakfast and check-out','Souvenir shopping','Airport transfer','Departure with beautiful memories'] }
            ]
        },
        test: {
            duration: 'Instant',
            highlights: ['Live Razorpay Integration', 'Secure Payment'],
            exclusions: ['No actual travel included'],
            days: [
                { day:1, title:'Payment Test', desc:'₹1 test to verify the payment gateway.', activities:['Click Pay ₹1 Now','Complete Razorpay payment','Receive booking confirmation'] }
            ]
        }
    };

    // ── Itinerary Full-Page Editor ──────────────────────────────
    // Get the working itinerary data for a package (merged with defaults)
    function getIteData(pkgIdx) {
        const pkg = packagesData[pkgIdx];
        const defKey = (pkg.id && ITINERARY_DEFAULTS[pkg.id]) ? pkg.id : 'budget';
        const def = ITINERARY_DEFAULTS[defKey];
        return {
            duration:   pkg.duration   || def.duration,
            highlights: (pkg.highlights && pkg.highlights.length) ? pkg.highlights : def.highlights,
            exclusions: (pkg.exclusions && pkg.exclusions.length) ? pkg.exclusions : def.exclusions,
            days:       (pkg.days && pkg.days.length)            ? pkg.days       : def.days
        };
    }

    function buildDayCard(pkgIdx, dayIdx, day) {
        const el = document.createElement('div');
        el.className = 'ite-day-card';
        el.innerHTML = `
            <div class="ite-day-header">
                <span class="pkg-day-num">Day ${day.day}</span>
                <button type="button" class="btn-del-day" title="Remove day">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="pkg-edit-row">
                <label>Title</label>
                <input type="text" class="pkg-input" value="${escHtml(day.title||'')}" placeholder="e.g. Arrival in Port Blair">
            </div>
            <div class="pkg-edit-row">
                <label>Description</label>
                <input type="text" class="pkg-input" value="${escHtml(day.desc||'')}" placeholder="Short description of the day">
            </div>
            <div class="pkg-edit-row">
                <label>Activities <small>(one per line)</small></label>
                <textarea class="pkg-input pkg-textarea" rows="5" placeholder="Airport pickup&#10;Hotel check-in&#10;City tour"></textarea>
            </div>
        `;
        // Set textarea value directly (avoids HTML entity issues)
        el.querySelector('textarea').value = (day.activities || []).join('\n');

        // Bind events
        el.querySelector('.btn-del-day').addEventListener('click', () => window._iteDeleteDay(pkgIdx, dayIdx));
        el.querySelector('input[placeholder*="Arrival"]').addEventListener('input', function() {
            packagesData[pkgIdx].days[dayIdx].title = this.value;
        });
        el.querySelector('input[placeholder*="Short"]').addEventListener('input', function() {
            packagesData[pkgIdx].days[dayIdx].desc = this.value;
        });
        el.querySelector('textarea').addEventListener('input', function() {
            packagesData[pkgIdx].days[dayIdx].activities = this.value.split('\n').map(s => s.trim()).filter(Boolean);
        });
        return el;
    }

    function renderIteDaysContainer(pkgIdx) {
        const container = document.getElementById('ite-days-container');
        if (!container) return;
        container.innerHTML = '';
        const days = packagesData[pkgIdx].days || [];
        if (days.length === 0) {
            container.innerHTML = '<p class="days-empty">No days yet. Click &ldquo;+ Add Day&rdquo; to start.</p>';
            return;
        }
        days.forEach((day, dayIdx) => {
            container.appendChild(buildDayCard(pkgIdx, dayIdx, day));
        });
    }

    function renderItineraryEditor(pkgIdx) {
        const pkg = packagesData[pkgIdx];
        const data = getIteData(pkgIdx);

        // Ensure packagesData has the merged values
        pkg.days       = data.days.map(d => ({ ...d, activities: [...(d.activities||[])] }));
        pkg.duration   = data.duration;
        pkg.highlights = data.highlights.slice();
        pkg.exclusions = data.exclusions.slice();

        document.getElementById('itePkgName').textContent = pkg.name;

        const body = document.getElementById('iteBody');
        body.innerHTML = `
            <div class="ite-inner-wrap">
                <div class="ite-section">
                    <div class="ite-section-title"><i class="fas fa-info-circle"></i> Overview</div>
                    <div class="ite-fields-grid">
                        <div class="pkg-edit-row">
                            <label>Duration</label>
                            <select id="ite-duration" class="pkg-input">
                                ${Array.from({length:14},(_,i)=>`<option value="${i+1} Night${i>0?'s':''} / ${i+2} Days">${i+1} Night${i>0?'s':''} / ${i+2} Days</option>`).join('')}
                            </select>
                        </div>
                        <div class="pkg-edit-row">
                            <label>Highlights <small>(comma-separated)</small></label>
                            <input id="ite-highlights" type="text" class="pkg-input" placeholder="e.g. Radhanagar Beach, Cellular Jail">
                        </div>
                        <div class="pkg-edit-row">
                            <label>Exclusions <small>(comma-separated)</small></label>
                            <input id="ite-exclusions" type="text" class="pkg-input" placeholder="e.g. Airfare, Lunch, Travel Insurance">
                        </div>
                    </div>
                </div>
                <div class="ite-section">
                    <div class="ite-section-title"><i class="fas fa-calendar-day"></i> Day-by-Day Itinerary</div>
                    <div id="ite-days-container" class="ite-days-container"></div>
                    <button type="button" class="btn-add-day" id="ite-add-day-btn">
                        <i class="fas fa-plus"></i> Add Day
                    </button>
                </div>
            </div>
        `;

        // Set field values directly (avoids escaping issues)
        const durSel = document.getElementById('ite-duration');
        durSel.value = pkg.duration || '';
        // If no match, fall back to first option
        if (!durSel.value) durSel.selectedIndex = 0;
        document.getElementById('ite-highlights').value = (pkg.highlights || []).join(', ');
        document.getElementById('ite-exclusions').value = (pkg.exclusions || []).join(', ');

        // Bind overview fields — duration change also syncs day cards
        document.getElementById('ite-duration').addEventListener('change', function() {
            packagesData[pkgIdx].duration = this.value;
            // Parse target day count from e.g. "4 Nights / 5 Days" → 5
            const match = this.value.match(/(\d+)\s*Days?/i);
            if (!match) return;
            const targetDays = parseInt(match[1]);
            const days = packagesData[pkgIdx].days;
            const currentCount = days.length;
            if (targetDays === currentCount) return;
            if (targetDays > currentCount) {
                // Add blank days up to target
                for (let i = currentCount + 1; i <= targetDays; i++) {
                    days.push({ day: i, title: 'Day ' + i, desc: '', activities: [] });
                }
            } else {
                // Trim excess days (warn if content exists)
                const excess = days.slice(targetDays);
                const hasContent = excess.some(d => d.title && d.title !== 'Day ' + d.day || (d.activities && d.activities.length));
                if (hasContent && !confirm(`Remove ${currentCount - targetDays} day(s) from the end? Any content in those days will be lost.`)) {
                    // Revert select
                    this.value = packagesData[pkgIdx].duration;
                    return;
                }
                days.splice(targetDays);
                days.forEach((d, i) => { d.day = i + 1; });
            }
            renderIteDaysContainer(pkgIdx);
        });
        document.getElementById('ite-highlights').addEventListener('input', function() {
            packagesData[pkgIdx].highlights = this.value.split(',').map(s => s.trim()).filter(Boolean);
        });
        document.getElementById('ite-exclusions').addEventListener('input', function() {
            packagesData[pkgIdx].exclusions = this.value.split(',').map(s => s.trim()).filter(Boolean);
        });

        // Add day button
        document.getElementById('ite-add-day-btn').addEventListener('click', () => window._iteAddDay(pkgIdx));

        // Render days
        renderIteDaysContainer(pkgIdx);
    }

    function renderPackageEditorCards() {
        const container = document.getElementById('packageCards');
        if (!packagesData.length) {
            container.innerHTML = '<p style="padding:2rem;color:#888;text-align:center;">No packages yet. Click "Add Package".</p>';
            return;
        }

        container.innerHTML = packagesData.map((pkg, idx) => `
            <div class="pkg-edit-card" data-idx="${idx}">
                <div class="pkg-edit-header">
                    <span class="pkg-edit-num">#${idx + 1}</span>
                    <label class="pkg-visible-toggle">
                        <input type="checkbox" ${pkg.visible !== false ? 'checked' : ''}
                            onchange="window._pkgUpdate(${idx},'visible',this.checked)">
                        <span>Visible</span>
                    </label>
                    <button class="btn-del-pkg" onclick="window._pkgDelete(${idx})" title="Delete package">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
                <div class="pkg-edit-body">
                    <div class="pkg-edit-row">
                        <label>Package Name</label>
                        <input type="text" class="pkg-input" value="${escHtml(pkg.name)}"
                            placeholder="e.g. Budget Andaman Escape"
                            oninput="window._pkgUpdate(${idx},'name',this.value)">
                    </div>
                    <div class="pkg-edit-row">
                        <label>Description</label>
                        <input type="text" class="pkg-input" value="${escHtml(pkg.desc || '')}"
                            placeholder="e.g. 4N/5D | Port Blair + Havelock"
                            oninput="window._pkgUpdate(${idx},'desc',this.value)">
                    </div>
                    <div class="pkg-edit-row pkg-edit-row-2col">
                        <div>
                            <label>Price (₹)</label>
                            <input type="number" class="pkg-input" value="${pkg.price}" min="1"
                                oninput="window._pkgUpdate(${idx},'price',parseInt(this.value)||1)">
                        </div>
                        <div>
                            <label>Rating (0–5)</label>
                            <input type="number" class="pkg-input" value="${pkg.rating}" min="0" max="5" step="0.1"
                                oninput="window._pkgUpdate(${idx},'rating',parseFloat(this.value)||0)">
                        </div>
                    </div>
                    <div class="pkg-edit-row">
                        <label>Inclusions <small>(comma-separated)</small></label>
                        <input type="text" class="pkg-input" value="${escHtml((pkg.inclusions||[]).join(', '))}"
                            placeholder="e.g. Hotels, Ferries, Breakfast"
                            oninput="window._pkgUpdate(${idx},'inclusions',this.value.split(',').map(s=>s.trim()).filter(Boolean))">
                    </div>
                    <div class="pkg-edit-row">
                        <label>Image</label>
                        <select class="pkg-input" onchange="window._pkgUpdate(${idx},'image',this.value)">
                            ${SITE_IMAGES.map(img => `<option value="${img}" ${pkg.image===img?'selected':''}>${img.split('/').pop()}</option>`).join('')}
                        </select>
                    </div>
                </div>
                <!-- Itinerary Editor Button -->
                <div class="pkg-ite-footer">
                    <button type="button" class="btn-edit-itinerary" onclick="window._openItineraryEditor(${idx})">
                        <i class="fas fa-map-marked-alt"></i> Edit Itinerary
                        <span class="ite-badge">${(pkg.days && pkg.days.length) ? pkg.days.length : (ITINERARY_DEFAULTS[pkg.id] ? ITINERARY_DEFAULTS[pkg.id].days.length : 0)} days</span>
                    </button>
                </div>
            </div>
        `).join('');
    }

    function escHtml(str) {
        return String(str).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    // Global helpers called by inline onchange/oninput
    window._pkgUpdate = function(idx, field, value) { packagesData[idx][field] = value; };

    window._pkgDelete = function(idx) {
        if (!confirm(`Delete "${packagesData[idx].name}"?`)) return;
        packagesData.splice(idx, 1);
        renderPackageEditorCards();
    };

    window._pkgDayUpdate = function(pkgIdx, dayIdx, field, value) {
        if (!packagesData[pkgIdx] || !packagesData[pkgIdx].days) return;
        packagesData[pkgIdx].days[dayIdx][field] = value;
    };

    // Full-page editor: add / delete day
    window._iteDeleteDay = function(pkgIdx, dayIdx) {
        if (!packagesData[pkgIdx] || !packagesData[pkgIdx].days) return;
        if (!confirm('Remove Day ' + (dayIdx + 1) + '?')) return;
        packagesData[pkgIdx].days.splice(dayIdx, 1);
        packagesData[pkgIdx].days.forEach((d, i) => { d.day = i + 1; });
        renderIteDaysContainer(pkgIdx);
    };

    window._iteAddDay = function(pkgIdx) {
        if (!packagesData[pkgIdx]) return;
        if (!packagesData[pkgIdx].days) packagesData[pkgIdx].days = [];
        const nextDay = packagesData[pkgIdx].days.length + 1;
        packagesData[pkgIdx].days.push({ day: nextDay, title: 'Day ' + nextDay, desc: '', activities: [] });
        renderIteDaysContainer(pkgIdx);
    };

    // Open full-page itinerary editor
    window._openItineraryEditor = function(pkgIdx) {
        window._currentIteIdx = pkgIdx;
        renderItineraryEditor(pkgIdx);
        document.getElementById('itineraryEditor').style.display = 'flex';
        document.getElementById('iteBody').scrollTop = 0;
    };

    window._closeItineraryEditor = function() {
        document.getElementById('itineraryEditor').style.display = 'none';
        const idx = window._currentIteIdx;
        if (idx != null) {
            // Update badge with real day count
            const badge = document.querySelector(`[data-idx="${idx}"] .ite-badge`);
            if (badge) badge.textContent = (packagesData[idx].days||[]).length + ' days';
        }
        window._currentIteIdx = null;
    };

    window.addNewPackage = function() {
        packagesData.push({
            id: 'pkg_' + Date.now(),
            name: 'New Package',
            desc: '',
            price: 10000,
            rating: 4.0,
            image: 'images/beach1.jpg',
            inclusions: ['Hotels', 'Ferries'],
            visible: true,
            days: []
        });
        renderPackageEditorCards();
        document.getElementById('packageCards').lastElementChild?.scrollIntoView({ behavior: 'smooth' });
    };

    // Wire up toolbar buttons (CSP-safe — no inline onclick)
    const addPackageBtn = document.getElementById('addPackageBtn');
    if (addPackageBtn) addPackageBtn.addEventListener('click', () => window.addNewPackage());

    const publishBtnEl = document.getElementById('publishBtn');
    if (publishBtnEl) publishBtnEl.addEventListener('click', () => window.saveAndPublishPackages());

    // ── Save & Publish via PackagesStore (jsonbin.io) ───────────
    // Pushes the current packagesData to the global jsonbin store. The
    // master key is asked once and saved in localStorage on this device.
    window.saveAndPublishPackages = async function () {
        const btn = document.getElementById('publishBtn');
        const status = document.getElementById('publishStatus');

        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Publishing…';
        status.style.display = 'block';
        status.className = 'publish-status publish-info';
        status.innerHTML = '⏳ Publishing to global database…';

        if (!window.PackagesStore) {
            status.className = 'publish-status publish-error';
            status.innerHTML = '❌ Data store script (js/dataStore.js) failed to load. Refresh the page.';
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-cloud-upload-alt"></i> Save & Publish';
            return;
        }

        try {
            await window.PackagesStore.publish(packagesData);
            status.className = 'publish-status publish-success';
            status.innerHTML =
                '✅ Published! Changes are live globally. Other devices will see them on next page load.';
            btn.innerHTML = '<i class="fas fa-check"></i> Published!';
        } catch (err) {
            const msg = (err && err.message) ? err.message : 'unknown error';
            status.className = 'publish-status publish-error';

            if (err && err.tokenIssue) {
                status.innerHTML =
                    '❌ jsonbin rejected the key. It has been cleared — click Save & Publish again to enter a new Master Key from <a href="https://jsonbin.io/app/api-keys" target="_blank">jsonbin.io/app/api-keys</a>.';
            } else if (msg.indexOf('No jsonbin Bin ID') !== -1) {
                status.innerHTML =
                    '⚠️ ' + msg + ' Saved locally on this device only.';
            } else if (msg.indexOf('No jsonbin Master Key') !== -1) {
                status.innerHTML =
                    '⚠️ No Master Key provided. Saved locally on this device only.';
            } else {
                status.innerHTML = '⚠️ Publish failed: ' + msg + '. Saved locally on this device only.';
            }
            btn.innerHTML = '<i class="fas fa-cloud-upload-alt"></i> Save & Publish';
        }

        setTimeout(() => {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-cloud-upload-alt"></i> Save & Publish';
        }, 4000);
    };

    // Helper for admins to clear the saved jsonbin master key (e.g. on a shared device).
    window.clearJsonbinKey = function () {
        if (window.PackagesStore && window.PackagesStore.clearKey) {
            window.PackagesStore.clearKey();
            alert('jsonbin Master Key cleared. You will be asked again on the next publish.');
        }
    };

    // ── Customers (Firestore-backed) ────────────────────────────
    let _allCustomers = [];                // last loaded from Firestore
    let _customerSearchTerm = '';

    let _customerError = null;

    async function fetchAllCustomers() {
        _customerError = null;
        if (!window.UsersStore || !window.UsersStore.listAllUsers) {
            _customerError = 'UsersStore not loaded — refresh the page.';
            return [];
        }
        try {
            return await window.UsersStore.listAllUsers();
        } catch (err) {
            console.warn('listAllUsers failed:', err);
            _customerError = err && err.message ? err.message : String(err);
            return [];
        }
    }

    function renderCustomers(search) {
        if (typeof search === 'string') _customerSearchTerm = search;
        const tbody = document.getElementById('customersBody');
        if (!tbody) return;

        const q = (_customerSearchTerm || '').toLowerCase();
        const list = !q ? _allCustomers : _allCustomers.filter(u =>
            (u.username || '').toLowerCase().includes(q) ||
            (u.email    || '').toLowerCase().includes(q) ||
            (u.fullName || '').toLowerCase().includes(q)
        );

        if (_customerError) {
            tbody.innerHTML = `<tr><td colspan="7" class="table-empty" style="color:#a04000;">
                ⚠️ ${escHtml(_customerError)}<br>
                <small style="color:#888;">
                    Most likely fix: open <a href="https://console.firebase.google.com/project/andaman-b886d/firestore/rules" target="_blank">Firestore Rules</a>
                    and publish the latest <code>firestore.rules</code> from the repo.
                </small>
            </td></tr>`;
            return;
        }

        if (list.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="table-empty">No customers found</td></tr>';
            return;
        }

        const projectId = (window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.projectId) || '';
        tbody.innerHTML = list.map(u => {
            const isDisabled = u.disabled === true;
            const userBookings = DB.bookings.filter(b => (b.userId === u.uid || b.userId === u.id) && b.status !== 'cancelled');
            const totalSpent = userBookings.reduce((s, b) => s + (b.price || 0), 0);
            const consoleUrl = projectId
                ? `https://console.firebase.google.com/project/${projectId}/authentication/users`
                : '';

            const statusBadge = isDisabled
                ? '<span class="badge badge-cancelled">DISABLED</span>'
                : (u.role === 'admin'
                    ? '<span class="badge badge-confirmed">ADMIN</span>'
                    : '<span class="badge badge-confirmed">ACTIVE</span>');

            const safeEmail = String(u.email || '').replace(/'/g, "\\'");
            const safeUsername = String(u.username || '').replace(/'/g, "\\'");

            return `
                <tr>
                    <td title="${u.uid}">#${String(u.uid || '').slice(-6)}</td>
                    <td>${u.username || '-'}${u.fullName ? `<br><small style="color:#888;">${u.fullName}</small>` : ''}</td>
                    <td>${u.email || '-'}</td>
                    <td>${userBookings.length}</td>
                    <td>${formatCurrency(totalSpent)}</td>
                    <td>${statusBadge}</td>
                    <td style="white-space:nowrap;">
                        <button class="action-btn" title="Send password reset email"
                                onclick="window._adminResetPassword('${safeEmail}')">
                            <i class="fas fa-key"></i> Reset
                        </button>
                        <button class="action-btn ${isDisabled ? 'action-btn-cancel' : ''}"
                                title="${isDisabled ? 'Re-enable account' : 'Disable login for this account'}"
                                onclick="window._adminToggleDisabled('${u.uid}', ${isDisabled})">
                            <i class="fas ${isDisabled ? 'fa-unlock' : 'fa-ban'}"></i> ${isDisabled ? 'Enable' : 'Disable'}
                        </button>
                        <button class="action-btn action-btn-cancel"
                                title="Delete this user's profile from Firestore"
                                onclick="window._adminDeleteUser('${u.uid}', '${safeUsername}')">
                            <i class="fas fa-trash"></i> Delete
                        </button>
                        ${consoleUrl ? `
                        <a class="action-btn" href="${consoleUrl}" target="_blank" rel="noopener"
                           title="Open Firebase Console to fully delete the auth account">
                            <i class="fas fa-external-link-alt"></i> Auth
                        </a>` : ''}
                    </td>
                </tr>
            `;
        }).join('');
    }

    async function refreshCustomers() {
        _allCustomers = await fetchAllCustomers();
        renderCustomers(_customerSearchTerm);
    }

    // Inline-onclick admin handlers
    window._adminResetPassword = async function (email) {
        if (!email) return;
        if (!confirm('Send a password-reset email to ' + email + '?')) return;
        try {
            await window.UsersStore.adminSendPasswordReset(email);
            alert('✅ Password reset email sent to ' + email);
        } catch (err) {
            alert('❌ ' + (err.message || 'Failed to send reset email.'));
        }
    };

    window._adminToggleDisabled = async function (uid, currentlyDisabled) {
        if (!uid) return;
        const action = currentlyDisabled ? 're-enable' : 'disable';
        if (!confirm(`Are you sure you want to ${action} this user's login?`)) return;
        try {
            await window.UsersStore.setUserDisabled(uid, !currentlyDisabled);
            await refreshCustomers();
        } catch (err) {
            alert('❌ ' + (err.message || 'Failed to update user.'));
        }
    };

    window._adminDeleteUser = async function (uid, username) {
        if (!uid) return;
        if (!confirm(
            'Delete this user\'s Firestore profile?\n\n' +
            '• Their profile + username will be removed.\n' +
            '• Their Firebase Auth account is NOT deleted automatically — open the "Auth" link to delete it in the Firebase Console.'
        )) return;
        try {
            await window.UsersStore.deleteUserProfile(uid, username);
            await refreshCustomers();
        } catch (err) {
            alert('❌ ' + (err.message || 'Failed to delete user.'));
        }
    };

    const customerSearch = document.getElementById('customerSearch');
    if (customerSearch) {
        customerSearch.addEventListener('input', () => renderCustomers(customerSearch.value));
    }

    // ── Revenue Analytics ───────────────────────────────────────
    function renderRevenue() {
        const bookings = DB.bookings;
        const confirmed = bookings.filter(b => b.status !== 'cancelled');
        const cancelled = bookings.filter(b => b.status === 'cancelled');

        const totalRevenue = confirmed.reduce((s, b) => s + (b.price || 0), 0);
        const avgBooking = confirmed.length > 0 ? totalRevenue / confirmed.length : 0;
        const cancelledRevenue = cancelled.reduce((s, b) => s + (b.price || 0), 0);

        // Top package
        const packageRevenue = {};
        confirmed.forEach(b => {
            const key = b.package_name || 'unknown';
            if (!packageRevenue[key]) packageRevenue[key] = 0;
            packageRevenue[key] += b.price || 0;
        });
        const topPkg = Object.entries(packageRevenue).sort((a, b) => b[1] - a[1])[0];

        document.getElementById('revTotalRevenue').textContent = formatCurrency(totalRevenue);
        document.getElementById('revAvgBooking').textContent = formatCurrency(Math.round(avgBooking));
        document.getElementById('revTopPackage').textContent = topPkg ? getPackageName(topPkg[0]) : '-';
        document.getElementById('revCancelledRevenue').textContent = formatCurrency(cancelledRevenue);

        // Revenue breakdown
        const breakdownContainer = document.getElementById('revenueBreakdown');
        const entries = Object.entries(packageRevenue).sort((a, b) => b[1] - a[1]);

        if (entries.length === 0) {
            breakdownContainer.innerHTML = '<p class="chart-empty">No revenue data yet</p>';
        } else {
            const maxRev = Math.max(...entries.map(e => e[1]));
            const colors = ['#1abc9c', '#3498db', '#9b59b6', '#e74c3c', '#f39c12'];

            breakdownContainer.innerHTML = entries.map(([pkg, rev], i) => {
                const pct = maxRev > 0 ? (rev / maxRev) * 100 : 0;
                const color = PACKAGES[pkg] ? PACKAGES[pkg].color : colors[i % colors.length];
                return `
                    <div class="revenue-item">
                        <span class="revenue-item-name">${getPackageName(pkg)}</span>
                        <div class="revenue-item-bar">
                            <div class="revenue-item-fill" style="width: ${pct}%; background: ${color};"></div>
                        </div>
                        <span class="revenue-item-amount">${formatCurrency(rev)}</span>
                    </div>
                `;
            }).join('');
        }

        // Monthly trend
        renderMonthlyTrend();
    }

    function renderMonthlyTrend() {
        const container = document.getElementById('monthlyTrend');
        const confirmed = DB.bookings.filter(b => b.status !== 'cancelled');

        if (confirmed.length === 0) {
            container.innerHTML = '<p class="chart-empty">No trend data yet</p>';
            return;
        }

        // Group by month
        const monthly = {};
        confirmed.forEach(b => {
            const d = new Date(b.createdAt || Date.now());
            const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
            if (!monthly[key]) monthly[key] = { count: 0, revenue: 0 };
            monthly[key].count++;
            monthly[key].revenue += b.price || 0;
        });

        const sorted = Object.entries(monthly).sort((a, b) => a[0].localeCompare(b[0])).slice(-12);
        const maxCount = Math.max(...sorted.map(e => e[1].count));

        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

        container.innerHTML = sorted.map(([key, data]) => {
            const pct = maxCount > 0 ? (data.count / maxCount) * 100 : 0;
            const [year, month] = key.split('-');
            const label = monthNames[parseInt(month) - 1] + ' ' + year.slice(2);

            return `
                <div class="trend-bar">
                    <span class="trend-bar-value">${data.count}</span>
                    <div class="trend-bar-fill" style="height: ${Math.max(pct, 3)}%;"></div>
                    <span class="trend-bar-label">${label}</span>
                </div>
            `;
        }).join('');
    }

    // ── Refresh All ─────────────────────────────────────────────
    function refreshAll() {
        // Reload data from localStorage
        DB.users = JSON.parse(localStorage.getItem('users') || '[]');
        DB.bookings = JSON.parse(localStorage.getItem('bookings') || '[]');

        renderOverview();
        renderAllBookings(
            bookingFilter ? bookingFilter.value : 'all',
            bookingSearch ? bookingSearch.value : ''
        );
        renderPackages();
        renderCustomers(customerSearch ? customerSearch.value : '');
        renderRevenue();
    }

    // Initial render
    refreshAll();
    // Also fetch customers from Firestore once on load (so the count and
    // table are ready by the time the user clicks the Customers tab).
    if (typeof refreshCustomers === 'function') {
        refreshCustomers();
    }

    // Auto-refresh when localStorage changes (e.g. from another tab)
    window.addEventListener('storage', refreshAll);
});
