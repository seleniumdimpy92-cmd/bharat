// Dashboard JavaScript
document.addEventListener('DOMContentLoaded', function () {
    // ── Data Layer ──────────────────────────────────────────────
    // DB.bookings is a merge of:
    //   1. localStorage `bookings`  → seeded test bookings + legacy/local entries
    //   2. Firestore `bookings/*`   → REAL customer bookings (Razorpay live + test mode)
    //
    // Admins can read the entire `bookings/*` collection per firestore.rules
    // (line ~98). Without this Firestore pull, real Razorpay test-mode bookings
    // made by customers never appeared in the admin dashboard, which meant the
    // Refund button was missing too — admins thought refunds were broken when
    // really the booking just wasn't loaded.
    const DB = {
        users: JSON.parse(localStorage.getItem('users') || '[]'),
        bookings: JSON.parse(localStorage.getItem('bookings') || '[]'),
        // Cache of bookings pulled from Firestore on this page-load.
        // Refilled by loadFirestoreBookings(); merged into DB.bookings by
        // refreshAll() so renders stay in sync.
        firestoreBookings: [],
        saveBookings() {
            localStorage.setItem('bookings', JSON.stringify(this.bookings));
        }
    };
    const selectedBookingIds = new Set();
    let activeBookingPreviewId = null;
    // FIX: set true when user closes the booking preview with ×.
    // renderAllBookings() skips auto-opening the panel while this is true.
    // Clicking a row or the ID button clears it.
    let bookingPreviewClosed = false;

    // ── Firestore booking loader (admin-only) ───────────────────
    // Pulls every doc from the `bookings/*` collection. Tagged with
    // `_fsId` so the cancel + refund flows (which already key off
    // _fsId in js/refund.js → saveRefundToBooking) keep working
    // unchanged. Returns [] on any error so a Firestore outage just
    // falls back to the localStorage view.
    async function loadFirestoreBookings() {
        if (!window.__firebaseReady) return [];
        try {
            const fb = await window.__firebaseReady;
            const coll = fb.firestore.collection(fb.db, 'bookings');
            const snap = await fb.firestore.getDocs(coll);
            const out = [];
            snap.forEach((doc) => {
                const data = doc.data() || {};
                // Preserve the Firestore doc id so refund / cancel writes
                // hit the right document. Don't clobber a hand-set `id`
                // from the booking payload — fall back to it instead.
                data._fsId = doc.id;
                if (!data.id) data.id = doc.id;
                out.push(data);
            });
            return out;
        } catch (err) {
            console.warn('[dashboard] Firestore bookings load failed (rules? offline?):', err);
            return [];
        }
    }

    // Merge Firestore bookings on top of localStorage ones.
    //   • De-dupes by booking_ref (preferred) or id.
    //   • Firestore wins on conflict — it's the authoritative store.
    //   • localStorage-only entries (admin-seeded test bookings, legacy
    //     guest bookings without a Firestore mirror) are kept verbatim.
    function mergeBookingsForDashboard(lsArr, fsArr) {
        const byKey = {};
        const keyOf = (b) => String(b && (b.booking_ref || b.id) || '');

        (lsArr || []).forEach((b) => {
            const k = keyOf(b);
            if (k) byKey[k] = b;
        });
        (fsArr || []).forEach((b) => {
            const k = keyOf(b);
            if (!k) return;
            // Firestore data is authoritative; merge LS fields under FS so
            // admin edits saved server-side win (status, refundId, etc).
            const existing = byKey[k] || {};
            byKey[k] = Object.assign({}, existing, b);
        });
        return Object.keys(byKey).map((k) => byKey[k]);
    }

    const PACKAGES = {
        budget: { name: 'Budget Andaman Escape', price: 15999, color: '#3498db' },
        standard: { name: 'Standard Andaman Bliss', price: 21999, color: '#0d7a8a' },
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
        locks:    'Price Locks',
        packages: 'Package Performance',
        gallery:  'Photo Gallery',
        analytics:'Analytics — Google Analytics 4',
        customers: 'Customers',
        revenue: 'Revenue Analytics',
        inbox: 'Admin Inbox',
        settings: 'Site Settings'
    };

    // Persist the last-open dashboard tab so refreshes/reloads don't
    // kick the admin back to Overview every time.
    function activateSection(section, opts) {
        opts = opts || {};
        if (!section) section = 'overview';

        sidebarLinks.forEach(l => l.classList.remove('active'));
        const activeLink = document.querySelector('.sidebar-link[data-section="' + section + '"]');
        if (activeLink) activeLink.classList.add('active');

        sections.forEach(s => s.classList.remove('active'));
        const target = document.getElementById('section-' + section);
        if (target) target.classList.add('active');

        if (pageTitle) pageTitle.textContent = sectionTitles[section] || 'Dashboard';

        try { localStorage.setItem('dashboardActiveSection', section); } catch (_) {}

        // Refresh data on tab switch
        if (section === 'customers') {
            if (typeof refreshCustomers === 'function') refreshCustomers();
        }

        // Close mobile nav drawer (if open) when a section is selected
        if (!opts.keepNavOpen) document.body.classList.remove('nav-open');
    }

    sidebarLinks.forEach(link => {
        link.addEventListener('click', function (e) {
            e.preventDefault();
            activateSection(this.dataset.section || 'overview');
        });
    });

    // Restore last-open tab on hard refresh.
    try {
        var savedSection = localStorage.getItem('dashboardActiveSection') || 'overview';
        // Staff users cannot open hidden/admin-only sections. Fall back to
        // packages (their default) if the saved section isn't visible.
        if (window.__dashRole === 'staff') {
            var staffAllowed = { packages: true, gallery: true };
            if (!staffAllowed[savedSection]) savedSection = 'packages';
        }
        activateSection(savedSection, { keepNavOpen: true });
    } catch (_) {}

    // Make Overview stat tiles navigable:
    //   Total Bookings      → Bookings tab
    //   Total Revenue       → Revenue tab
    //   Total Customers     → Customers tab
    //   Confirmed           → Bookings tab
    // This turns the overview cards into quick shortcuts.
    (function wireOverviewTiles() {
        var links = [
            { id: 'totalBookings',     section: 'bookings'  },
            { id: 'totalRevenue',      section: 'revenue'   },
            { id: 'totalCustomers',    section: 'customers' },
            { id: 'confirmedBookings', section: 'bookings'  },
            { id: 'overviewInboxValue', section: 'inbox'    }
        ];
        links.forEach(function (cfg) {
            var valEl = document.getElementById(cfg.id);
            if (!valEl) return;
            var card = valEl.closest && valEl.closest('.stat-card');
            if (!card) return;
            card.style.cursor = 'pointer';
            card.title = 'Open ' + (sectionTitles[cfg.section] || cfg.section);
            card.addEventListener('click', function () {
                activateSection(cfg.section);
            });
        });
    })();

    // Mobile hamburger: toggle topnav drawer (matches main site behaviour)
    const hamburgerBtn = document.getElementById('hamburgerBtn');
    if (hamburgerBtn) {
        hamburgerBtn.addEventListener('click', () => {
            document.body.classList.toggle('nav-open');
        });
    }
    document.addEventListener('click', (e) => {
        if (!document.body.classList.contains('nav-open')) return;
        const topnav = document.getElementById('topnav');
        if (topnav && topnav.contains(e.target)) {
            if (e.target.closest('.topnav-item')) document.body.classList.remove('nav-open');
            return;
        }
        if (hamburgerBtn && !hamburgerBtn.contains(e.target)) {
            document.body.classList.remove('nav-open');
        }
    });

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

        // Customer count: prefer Firestore-loaded list (admin only), else localStorage fallback
        const customerCount = (Array.isArray(_allCustomers) && _allCustomers.length)
            ? _allCustomers.length
            : DB.users.length;

        document.getElementById('totalBookings').textContent = bookings.length;
        document.getElementById('totalRevenue').textContent = formatCurrency(totalRevenue);
        document.getElementById('totalCustomers').textContent = customerCount;
        document.getElementById('confirmedBookings').textContent = confirmed.length;

        // Re-bind the Overview tiles on every render. Some browsers/theme
        // states can replace or repaint enough of the stat cards that the
        // one-time DOMContentLoaded listeners feel flaky. Setting the click
        // handler directly on the card each render makes the behaviour
        // deterministic.
        [
            ['totalBookings', 'bookings'],
            ['totalRevenue', 'revenue'],
            ['totalCustomers', 'customers'],
            ['confirmedBookings', 'bookings']
        ].forEach(function (pair) {
            var valEl = document.getElementById(pair[0]);
            if (!valEl || !valEl.closest) return;
            var card = valEl.closest('.stat-card');
            if (!card) return;
            card.style.cursor = 'pointer';
            card.onclick = function () { activateSection(pair[1]); };
        });

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
                #0d7a8a 0deg ${confirmedDeg}deg,
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

    async function renderOverviewUnreadInbox() {
        const body = document.getElementById('overviewUnreadInboxBody');
        const openBtn = document.getElementById('overviewOpenInboxBtn');
        if (openBtn && !openBtn.__wired) {
            openBtn.__wired = true;
            openBtn.addEventListener('click', function () {
                activateSection('inbox');
            });
        }
        if (!body) return;

        body.innerHTML = '<tr><td colspan="3" class="table-empty">Loading unread mails…</td></tr>';

        try {
            if (!window.__firebaseReady) {
                body.innerHTML = '<tr><td colspan="3" class="table-empty">Inbox service not ready.</td></tr>';
                return;
            }
            const fb = await window.__firebaseReady;
            const q = fb.firestore.query(
                fb.firestore.collection(fb.db, 'receivedEmails'),
                fb.firestore.where('unread', '==', true)
            );
            const snap = await fb.firestore.getDocs(q);
            const rows = [];
            snap.forEach(function (doc) {
                const data = doc.data() || {};
                rows.push({
                    id: doc.id,
                    from: data.from || '',
                    subject: data.subject || '',
                    text: data.text || data.bodyText || data.body || data.snippet || '',
                    html: data.html || '',
                    receivedAt: data.receivedAt || data.date || '',
                    mailbox: data.mailbox || ''
                });
            });

            rows.sort(function (a, b) {
                return new Date(b.receivedAt || 0) - new Date(a.receivedAt || 0);
            });

            const inboxValue = document.getElementById('overviewInboxValue');
            if (inboxValue) inboxValue.textContent = String(rows.length);

            const top = rows.slice(0, 5);
            if (!top.length) {
                body.innerHTML = '<tr><td colspan="3" class="table-empty">No unread mails.</td></tr>';
                return;
            }

            function shortFrom(v) {
                var s = String(v || '').trim();
                var m = s.match(/<([^>]+)>/);
                return (m ? m[1] : s).slice(0, 32);
            }
            function shortSub(v) {
                var s = String(v || '(no subject)').trim();
                return s.length > 52 ? s.slice(0, 49) + '…' : s;
            }
            function fmtInboxDate(v) {
                var d = new Date(v || '');
                if (isNaN(d.getTime())) return '—';
                return d.toLocaleString('en-IN', {
                    day: '2-digit', month: 'short',
                    hour: '2-digit', minute: '2-digit'
                });
            }
            function shortBodyOrId(r) {
                var bodyText = String(r.text || '').replace(/\s+/g, ' ').trim();
                if (bodyText) return bodyText.length > 52 ? bodyText.slice(0, 49) + '…' : bodyText;
                return String(r.id || '').slice(0, 18) || '—';
            }
            function bodyOrIdTitle(r) {
                return String(r.text || '').trim() || String(r.id || '');
            }

            body.innerHTML = top.map(function (r) {
                return '<tr data-open-inbox="1" style="cursor:pointer;">' +
                    '<td>' + escHtml(fmtInboxDate(r.receivedAt)) + '</td>' +
                    '<td title="' + escHtml(r.from) + '">' + escHtml(shortFrom(r.from)) + '</td>' +
                    '<td title="' + escHtml(bodyOrIdTitle(r)) + '">' + escHtml(shortBodyOrId(r)) + '</td>' +
                '</tr>';
            }).join('');

            Array.prototype.forEach.call(
                body.querySelectorAll('tr[data-open-inbox="1"]'),
                function (tr) {
                    tr.addEventListener('click', function () {
                        activateSection('inbox');
                    });
                }
            );
        } catch (err) {
            console.warn('[dashboard] overview unread inbox load failed:', err);
            const inboxValue = document.getElementById('overviewInboxValue');
            if (inboxValue) inboxValue.textContent = '—';
            body.innerHTML = '<tr><td colspan="3" class="table-empty">Could not load unread mails.</td></tr>';
        }
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
            const color = PACKAGES[pkg] ? PACKAGES[pkg].color : '#0d7a8a';
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

        function esc(v) {
            return escHtml(v == null ? '' : String(v));
        }

        function bookingLabel(b) {
            return b.booking_ref || b.id || '-';
        }

        function tripSummary(b) {
            var parts = [];
            if (b.duration) parts.push(String(b.duration));
            if (b.guests != null && b.guests !== '') parts.push(String(b.guests) + ' guest' + (Number(b.guests) === 1 ? '' : 's'));
            if (!parts.length && (b.travel_date || b.date)) parts.push(formatDate(b.travel_date || b.date));
            return parts.join(' • ') || '-';
        }

        if (recent.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="table-empty">No bookings yet</td></tr>';
            return;
        }

        tbody.innerHTML = recent.map(b => `
            <tr>
                <td title="${esc(bookingLabel(b))}">${esc(bookingLabel(b))}</td>
                <td>${esc(getUserName(b.userId))}</td>
                <td>${esc(getPackageName(b.package_name))}</td>
                <td title="${esc(tripSummary(b))}">${esc(tripSummary(b))}</td>
                <td><span class="badge badge-${esc(b.status || 'confirmed')}">${esc((b.status || 'confirmed').toUpperCase())}</span></td>
                <td>${esc(formatDate(b.createdAt))}</td>
            </tr>
        `).join('');
    }

    // ── All Bookings ────────────────────────────────────────────
    function getBookingPaymentState(booking) {
        if (!booking || typeof booking !== 'object') return { label: '-', class: '' };
        const paymentId = String(booking.payment_id || '');
        const raw = String(
            booking.payment_status ||
            booking.paymentStatus ||
            booking.razorpay_status ||
            booking.status_text ||
            ''
        ).trim().toLowerCase();

        // 1. Explicit Razorpay states
        if (booking.refundId || booking.refundedAt || String(booking.refundStatus || '').toLowerCase() === 'refunded' || raw === 'refunded') return { label: 'Refunded', class: 'badge-failed' };
        if (raw === 'failed')     return { label: 'Failed', class: 'badge-failed' };
        if (raw === 'captured')   return { label: 'Captured', class: 'badge-captured' };
        if (raw === 'authorized') return { label: 'Authorized', class: 'badge-authorized' };

        // 2. Internal logic overrides
        if (/^FREE-/i.test(paymentId) || raw === 'no_advance_required') return { label: 'No Advance', class: 'badge-authorized' };
        
        if (String(booking.status || '').toLowerCase() === 'cancelled') {
            const refundDue = (window.Refund && window.Refund.computeRefundAmount)
                ? Number(window.Refund.computeRefundAmount(booking) || 0)
                : 0;
            return { label: refundDue > 0 ? 'Refund Pending' : 'Cancelled', class: 'badge-failed' };
        }

        // 3. Fallback
        if (raw === 'partial_advance') return { label: 'Advance Paid', class: 'badge-authorized' };
        if (raw) return { label: raw.replace(/_/g, ' ').replace(/\b\w/g, function (m) { return m.toUpperCase(); }), class: 'badge-authorized' };
        
        return { label: '-', class: '' };
    }

    async function fetchRazorpayPaymentStatus(paymentId) {
        // Only fetch for real Razorpay payment IDs (always start with pay_).
        // TEST-* / FREE-* / numeric legacy IDs are not in Razorpay at all.
        if (!/^pay_[A-Za-z0-9]+$/i.test(String(paymentId || ''))) return null;

        // Auto-select worker URL:
        //   • Payments created in test mode have IDs that only exist in the
        //     Razorpay TEST environment — use REFUND_TEST_WORKER_URL.
        //   • Live payments use REFUND_WORKER_URL.
        // We can't tell from the ID alone which mode was used, so we try
        // the test worker first (if configured), then fall back to live.
        // If only one worker is configured we use that one.
        const testUrl = window.REFUND_TEST_WORKER_URL || null;
        const liveUrl = window.REFUND_WORKER_URL || null;
        if (!testUrl && !liveUrl) return null;

        async function tryFetch(workerUrl) {
            try {
                const res = await fetch(`${workerUrl}/payment-status/${paymentId}`);
                const data = await res.json().catch(() => null);
                if (!data || data.error || !data.status) return null;
                return data;
            } catch (_) {
                return null;
            }
        }

        // If both workers are configured, try test first (test payments are
        // common during dev/QA). If the test worker doesn't know the ID,
        // fall back to the live worker.
        if (testUrl && liveUrl) {
            const fromTest = await tryFetch(testUrl);
            if (fromTest) return fromTest;
            return tryFetch(liveUrl);
        }
        return tryFetch(testUrl || liveUrl);
    }

    async function renderBookingPreview(booking) {
        const preview = document.getElementById('bookingPreview');
        if (!preview) return;
        if (!booking) {
            preview.innerHTML = '<div class="inbox-preview-empty">' +
                '<i class="fas fa-receipt"></i>' +
                '<p>Select a booking row to view customer and package details.</p>' +
            '</div>';
            return;
        }
        // If panel was hidden by × button, restore it before rendering content.
        // Only restore when bookingPreviewClosed is false (i.e. user actively
        // opened a row). When true, the close handler already hid it and we
        // must not silently reopen it here.
        if (preview.style.display === 'none' && !bookingPreviewClosed) {
            preview.style.display = '';
            const split = document.getElementById('bookingsSplit');
            const divider = split && split.querySelector('.inbox-divider');
            if (divider) divider.style.display = '';
            if (split) restoreBookingsSplitWidth(split);
        }

        const pkg = PACKAGES[booking.package_name] || {};
        const traveler = booking.traveler || {};
        const customerName = traveler.name || booking.customerName || booking.fullName || getUserName(booking.userId);
        const customerEmail = traveler.email || booking.customerEmail || booking.email || '-';
        const customerPhone = traveler.phone || booking.customerPhone || booking.phone || '-';
        const bookingRef = booking.booking_ref || booking.id || '-';
        const amountPaid = booking.advance_paid || booking.amountPaid || 0;
        const balanceDue = booking.balance_due || booking.balanceDue || 0;
        const packagePrice = booking.price || pkg.price || 0;
        const packageName = getPackageName(booking.package_name);
        const tripDate = booking.travel_date || booking.date || '';
        const status = String(booking.status || 'confirmed').toUpperCase();

        // Fetch live status if it's a Razorpay payment and sync it back to Firestore
        // BEFORE computing paymentState so the badge reflects the live value.
        let liveStatus = null;
        if (booking.payment_id && !/^FREE-/i.test(booking.payment_id)) {
            liveStatus = await fetchRazorpayPaymentStatus(booking.payment_id);
            // Write the live status back to the booking so future loads reflect it
            if (liveStatus && liveStatus.status) {
                const liveStatusStr = String(liveStatus.status).toLowerCase();
                if (liveStatusStr !== String(booking.payment_status || '').toLowerCase()) {
                    booking.payment_status = liveStatusStr;
                    // Persist to Firestore
                    if (window.__firebaseReady) {
                        try {
                            const fb = await window.__firebaseReady;
                            const docId = booking._fsId || booking.id;
                            if (docId) {
                                const ref = fb.firestore.doc(fb.db, 'bookings', String(docId));
                                await fb.firestore.updateDoc(ref, { payment_status: liveStatusStr });
                            }
                        } catch (_) {}
                    }
                    // Also flag refunded status
                    if (liveStatusStr === 'refunded' && !booking.refundStatus) {
                        booking.refundStatus = 'refunded';
                    }
                    DB.saveBookings();
                    // Update just the table row payment badge without
                    // triggering another full preview re-render (which
                    // would cause an infinite loop since this function
                    // itself is async and still running).
                    renderAllBookings(
                        bookingFilter ? bookingFilter.value : 'all',
                        bookingSearch ? bookingSearch.value : ''
                    );
                }
            }
        }

        // Compute paymentState AFTER the live fetch so it reflects the
        // updated booking.payment_status value written above.
        const paymentState = getBookingPaymentState(booking);

        const isRazorpay = window.Refund && window.Refund.isRazorpayPayment && window.Refund.isRazorpayPayment(booking);
        const liveStatusStr = liveStatus ? String(liveStatus.status || '').toLowerCase() : '';
        const isAuthorized  = liveStatusStr === 'authorized';
        const isAlreadyRefunded = !!booking.refundId || !!booking.refundedAt ||
            String(booking.refundStatus || '').toLowerCase() === 'refunded' ||
            liveStatusStr === 'refunded';
        const isCancelled = String(booking.status || '').toLowerCase() === 'cancelled';

        // ── Preview pane action buttons — same state-machine as actionCellHtml ──
        // AUTHORIZED  → no buttons (payment not captured yet, Razorpay rejects refunds)
        // CAPTURED + confirmed → Cancel only
        // CAPTURED + cancelled → Refund button
        // Already refunded     → "Refunded ₹X" badge, no buttons
        // Non-Razorpay/FREE    → Cancel only (when not yet cancelled)
        let actionsHtml = '';

        if (isAlreadyRefunded) {
            // Refunded — show badge, nothing else
            actionsHtml += '<span class="badge badge-failed" style="margin-left:.4rem;padding:.35rem .7rem;">Refunded ' + formatCurrency(booking.refundAmount || 0) + '</span>';
        } else if (isRazorpay && isAuthorized) {
            // AUTHORIZED — Refund is not possible (payment not captured), but
            // the booking CAN be cancelled. The card hold will expire
            // automatically in Razorpay; no refund step is needed.
            if (!isCancelled) {
                actionsHtml += '<button type="button" class="action-btn action-btn-cancel" data-preview-cancel="' +
                    escHtml(String(booking.id)) + '" style="background:#fff3f3;color:#e74c3c;border:1px solid #f5c6cb;">' +
                    '<i class="fas fa-ban"></i> Cancel Booking</button>';
                actionsHtml += '<span style="font-size:.78rem;color:#888;display:block;margin-top:.3rem;">' +
                    '⚠️ Payment is AUTHORIZED (not yet captured). Cancelling the booking will NOT auto-refund — ' +
                    'the ₹12,000 card hold will expire automatically in Razorpay. ' +
                    'Or capture it first then cancel for a proper refund.</span>';
            }
        } else if (isRazorpay && isCancelled) {
            // CAPTURED + cancelled → Refund button
            // Use advance_paid if set, otherwise fall back to full price
            // (admin may have not set advance_paid on older bookings)
            const previewAdvance = Number(booking.advance_paid) || Number(booking.price) || 0;
            const previewSuggested = (window.Refund && window.Refund.computeRefundAmount)
                ? Number(window.Refund.computeRefundAmount(booking) || 0)
                : 0;
            const previewRefundLabel = previewSuggested > 0
                ? 'Refund ' + formatCurrency(previewSuggested)
                : (previewAdvance > 0 ? 'Refund ' + formatCurrency(previewAdvance) : 'Refund…');
            actionsHtml += '<button type="button" class="action-btn action-btn-refund" data-preview-refund="' +
                escHtml(String(booking.id)) + '" style="background:#fff5e6;color:#a04000;border:1px solid #f1c27d;">' +
                '<i class="fas fa-undo-alt"></i> ' + escHtml(previewRefundLabel) + '</button>';
        } else {
            // confirmed (or non-Razorpay) → Cancel button only
            if (!isCancelled) {
                actionsHtml += '<button type="button" class="action-btn action-btn-cancel" data-preview-cancel="' +
                    escHtml(String(booking.id)) + '" style="background:#fff3f3;color:#e74c3c;border:1px solid #f5c6cb;">' +
                    '<i class="fas fa-ban"></i> Cancel Booking</button>';
            }
        }

        preview.innerHTML = ''
            + '<div class="ipv-head">'
            +   '<button type="button" class="ipv-close" title="Close" style="position:absolute;top:.6rem;right:.6rem;background:none;border:none;font-size:1.1rem;color:#888;cursor:pointer;padding:.2rem .4rem;line-height:1;z-index:2;" aria-label="Close preview">&times;</button>'
            +   '<h3 class="ipv-subject">' + escHtml(packageName) + '</h3>'
            +   '<div class="ipv-meta">'
            +     '<div class="ipv-row"><strong>Booking:</strong> ' + escHtml(String(bookingRef)) + '</div>'
            +     '<div class="ipv-row"><strong>Status:</strong> ' + escHtml(status) + '</div>'
            +     '<div class="ipv-row"><strong>Created:</strong> ' + escHtml(formatDate(booking.createdAt)) + '</div>'
            +   '</div>'
            +   (actionsHtml ? '<div class="ipv-actions" style="margin-top:.6rem;display:flex;gap:.4rem;flex-wrap:wrap;align-items:center;">' + actionsHtml + '</div>' : '')
            + '</div>'
            + '<div class="ipv-body">'
            +   '<div class="rd-summary" style="margin-bottom:1rem;">'
            +     '<div class="rd-row"><span class="rd-k">Customer</span><span class="rd-v">' + escHtml(String(customerName || '-')) + '</span></div>'
            +     '<div class="rd-row"><span class="rd-k">Email</span><span class="rd-v">' + escHtml(String(customerEmail || '-')) + '</span></div>'
            +     '<div class="rd-row"><span class="rd-k">Phone</span><span class="rd-v">' + escHtml(String(customerPhone || '-')) + '</span></div>'
            +     '<div class="rd-row"><span class="rd-k">Guests</span><span class="rd-v">' + escHtml(String(booking.guests || booking.adults || '-')) + '</span></div>'
            +   '</div>'
            +   '<div class="rd-summary" style="margin-bottom:1rem;">'
            +     '<div class="rd-row"><span class="rd-k">Package</span><span class="rd-v">' + escHtml(String(packageName)) + '</span></div>'
            +     '<div class="rd-row"><span class="rd-k">Travel date</span><span class="rd-v">' + escHtml(tripDate ? formatDate(tripDate) : '-') + '</span></div>'
            +     '<div class="rd-row"><span class="rd-k">Payment ID</span><span class="rd-v">' + escHtml(String(booking.payment_id || '-')) + '</span></div>'
            +     '<div class="rd-row"><span class="rd-k">Payment status</span><span class="rd-v">' + escHtml(paymentState.label) + '</span></div>'
            +     (liveStatus ? '<div class="rd-row"><span class="rd-k">Razorpay (Live)</span><span class="rd-v">' + escHtml(liveStatus.status.toUpperCase()) + '</span></div>' : '')
            +   '</div>'
            +   '<div class="rd-summary">'
            +     '<div class="rd-row"><span class="rd-k">Package amount</span><span class="rd-v">' + escHtml(formatCurrency(packagePrice)) + '</span></div>'
            +     '<div class="rd-row"><span class="rd-k">Advance paid</span><span class="rd-v">' + escHtml(formatCurrency(amountPaid)) + '</span></div>'
            +     '<div class="rd-row"><span class="rd-k">Balance due</span><span class="rd-v">' + escHtml(formatCurrency(balanceDue)) + '</span></div>'
            +     '<div class="rd-row"><span class="rd-k">Refund</span><span class="rd-v">' + escHtml(booking.refundAmount ? formatCurrency(booking.refundAmount) : '-') + '</span></div>'
            +   '</div>'
            + '</div>';

        // Wire up preview pane action buttons
        const previewRefundBtn = preview.querySelector('[data-preview-refund]');
        if (previewRefundBtn) {
            previewRefundBtn.addEventListener('click', async function () {
                const id = this.dataset.previewRefund;
                if (!window.Refund || !window.Refund.processRefund) return;
                const advance = Number(booking.advance_paid) || 0;
                if (advance <= 0) {
                    if (window.Toast) window.Toast.warning('No advance was paid for this booking.');
                    return;
                }
                const suggested = window.Refund.computeRefundAmount ? window.Refund.computeRefundAmount(booking) : 0;
                const amount = await openRefundDialog(booking, { suggested: suggested, advance: advance });
                if (amount == null) return;
                const me = JSON.parse(localStorage.getItem('currentUser') || 'null');
                const refundedBy = (me && (me.email || me.username)) || 'admin';

                this.disabled = true;

                // ── ₹0 → auto-settle (no actual refund call) ─────
                // See the table-row Refund handler above for the full
                // rationale; same flow mirrored here for the preview
                // pane's Refund button.
                if (amount === 0) {
                    this.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Settling…';
                    try {
                        const fakeRefund = {
                            ok: true,
                            refundId: 'SETTLED-' + Date.now(),
                            amount: 0,
                            status: 'settled',
                            currency: 'INR',
                            initiatedBy: refundedBy
                        };
                        await window.Refund.saveRefundToBooking(booking, fakeRefund);
                        if (window.Refund.logRefund) {
                            window.Refund.logRefund(booking, fakeRefund, refundedBy);
                        }
                        booking.refundId = fakeRefund.refundId;
                        booking.refundAmount = 0;
                        booking.refundStatus = 'settled';
                        booking.refundedAt = new Date().toISOString();
                        DB.saveBookings();
                        refreshAll();
                        if (window.Toast) {
                            window.Toast.success('Booking closed out with no refund (auto-settled).');
                        }
                    } catch (e) {
                        if (window.Toast) window.Toast.error('Auto-settle failed: ' + (e && e.message));
                    }
                    return;
                }

                this.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Refunding…';
                try {
                    const refund = await window.Refund.processRefund(booking, { amount: amount, reason: 'Manual refund from admin preview' });
                    if (refund && refund.ok && !refund.skipped) {
                        await window.Refund.saveRefundToBooking(booking, refund);
                        booking.refundId = refund.refundId;
                        booking.refundAmount = refund.amount;
                        booking.refundStatus = refund.status || 'pending';
                        DB.saveBookings();
                        refreshAll();
                        if (window.Toast) window.Toast.success('Refund initiated: ' + refund.refundId);
                    } else {
                        if (window.Toast) window.Toast.error('Refund failed: ' + (refund && refund.error || 'unknown'));
                    }
                } catch (e) {
                    if (window.Toast) window.Toast.error('Refund threw: ' + (e && e.message));
                }
            });
        }
        const previewCancelBtn = preview.querySelector('[data-preview-cancel]');
        if (previewCancelBtn) {
            previewCancelBtn.addEventListener('click', function () {
                const tableBtn = document.querySelector('#allBookingsBody .action-btn-cancel[data-id="' + booking.id + '"]');
                if (tableBtn) tableBtn.click();
                else if (window.Toast) window.Toast.info('Use the Cancel button in the row to cancel.');
            });
        }

        // Wire the × close button — hide preview pane, expand table to full width
        const previewCloseBtn = preview.querySelector('.ipv-close');
        if (previewCloseBtn) {
            previewCloseBtn.addEventListener('click', function () {
                activeBookingPreviewId = null;
                bookingPreviewClosed   = true;   // FIX: prevent auto-reopen on re-render
                // Hide the preview pane and divider, expand the table.
                // Same trick as the inbox: bump --inbox-list-w to 100% so the
                // grid collapses to a single column without us touching the
                // grid-template-columns directly. Saved width is preserved
                // in localStorage and gets re-applied on next row click.
                const split = document.getElementById('bookingsSplit');
                const divider = split && split.querySelector('.inbox-divider');
                if (split) split.style.setProperty('--inbox-list-w', '100%');
                if (divider) divider.style.display = 'none';
                preview.style.display = 'none';
                // Deselect highlighted row
                document.querySelectorAll('#allBookingsBody tr.selected')
                    .forEach(r => r.classList.remove('selected'));
            });
        }
    }

    // Restore the bookings list-pane width to whatever the admin last set
    // (or the 70% default). Mirrors the inbox split's storage convention so
    // the close-and-reopen workflow remembers the previous size.
    function restoreBookingsSplitWidth(split) {
        if (!split) return;
        const STORAGE_KEY = 'bookingsSplitRatio';
        let saved = parseFloat(localStorage.getItem(STORAGE_KEY) || '');
        if (!isFinite(saved) || saved < 18 || saved > 92) saved = 70;
        split.style.setProperty('--inbox-list-w', saved.toFixed(2) + '%');
    }

    function setActiveBookingPreview(id, bookings, skipRerender) {
        const bookingId = String(id || '');
        activeBookingPreviewId = bookingId || null;
        bookingPreviewClosed   = false;   // FIX: user explicitly clicked a row → show panel
        const rows = Array.isArray(bookings) ? bookings : [];
        const booking = rows.find((row) => String(row.id) === bookingId) || null;
        // Re-show the preview pane + divider (always, since user explicitly clicked)
        const preview = document.getElementById('bookingPreview');
        const split = document.getElementById('bookingsSplit');
        if (preview) preview.style.display = '';
        const divider = split && split.querySelector('.inbox-divider');
        if (divider) divider.style.display = '';
        if (split) restoreBookingsSplitWidth(split);
        renderBookingPreview(booking);
        if (!skipRerender) {
            renderAllBookings(
                bookingFilter ? bookingFilter.value : 'all',
                bookingSearch ? bookingSearch.value : ''
            );
        }
    }

    function renderAllBookings(filter, search) {
        const tbody = document.getElementById('allBookingsBody');
        let bookings = [...DB.bookings].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

        // Update pill counts on every render so they stay in sync
        updateBookingStatusCounts();

        if (filter && filter !== 'all') {
            if (filter === 'refunded') {
                // Refunded = has a refundId OR refundStatus === 'refunded'
                bookings = bookings.filter(b =>
                    !!b.refundId || String(b.refundStatus || '').toLowerCase() === 'refunded'
                );
            } else {
                bookings = bookings.filter(b => (b.status || 'confirmed') === filter);
            }
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
            selectedBookingIds.clear();
            activeBookingPreviewId = null;
            tbody.innerHTML = '<tr><td colspan="11" class="table-empty">No bookings found</td></tr>';
            updateBookingsBulkUi();
            renderBookingPreview(null);
            return;
        }

        // Build the action-cell HTML for each booking. Two independent
        // buttons so the admin can refund WITHOUT cancelling (e.g. partial
        // goodwill refund, or a customer who paid twice) AND cancel
        // separately. Both buttons hide / morph based on current state:
        //   • Cancel  → only when status !== 'cancelled'
        //   • Refund  → only on Razorpay-paid bookings that haven't been
        //               refunded yet. After a refund the cell shows a
        //               muted "Refunded ₹X" badge instead of the button.
        // Build the action-cell HTML for one booking row.
        //
        // Refund-button visibility policy (2026-05 update):
        //   • The button shows on EVERY Razorpay-paid booking that hasn't
        //     already been refunded — including cancelled bookings AND
        //     bookings inside the 0-7 day "no refund" customer slab.
        //   • Why: the slab maths are the *suggested* customer-facing
        //     auto-refund. Admin discretion overrides that — goodwill
        //     refunds, partial refunds, or fixing a duplicate charge
        //     are valid reasons to refund regardless of slab. The
        //     handler already supports a custom-amount prompt; we just
        //     need to surface the button.
        //   • The button label still shows the suggested amount when
        //     non-zero (so the admin sees the slab maths up-front), and
        //     falls back to "Refund…" when the suggested amount is 0
        //     (slab=0 OR cancelled long ago) — clicking opens the prompt
        //     where the admin types a custom amount.
        // ── Action cell logic ───────────────────────────────────
        // Business rules (driven by live Razorpay payment state):
        //
        //   AUTHORIZED  → payment held but NOT yet captured.
        //                  Razorpay does not allow refunds on uncaptured
        //                  payments. Show nothing — admin must capture or
        //                  void via Razorpay dashboard first.
        //
        //   CAPTURED + confirmed  → Cancel button only. No refund until
        //                           the booking is first cancelled.
        //
        //   CAPTURED + cancelled  → Refund button (slab amount or custom).
        //                           advance_paid must be > 0.
        //
        //   Already refunded      → "Refunded ₹X" badge, no buttons.
        //
        //   FREE / non-Razorpay   → Cancel button only (no refund path).
        //
        // The "live" payment status is stored back to the booking doc by
        // saveRefundToBooking / cancel handlers, so we read it from the
        // booking object (Firestore-sourced) rather than making a live
        // API call per row.
        function actionCellHtml(b) {
            var html = '';
            var status = String(b.status || 'confirmed').toLowerCase();
            var isRzp = window.Refund && window.Refund.isRazorpayPayment &&
                        window.Refund.isRazorpayPayment(b);
            var alreadyRefunded = !!(b && (
                b.refundId ||
                b.refundedAt ||
                String(b.refundStatus  || '').toLowerCase() === 'refunded'
            ));

            // Determine the Razorpay payment state from what's stored on
            // the booking. The live fetch only happens in the preview pane.
            var rzpState = String(
                b.payment_status || b.paymentStatus || b.razorpay_status || ''
            ).trim().toLowerCase();
            // 'authorized' means the card hold exists but money hasn't moved —
            // Razorpay rejects refunds at this stage.
            var isAuthorized = (rzpState === 'authorized');

            var cancelStyle  = 'background:#edf8f1;color:#1f7a46;border:1px solid #cfead8;';
            var refundStyle  = 'background:#fff8eb;color:#a66307;border:1px solid #f3dfb6;';
            var refundedStyle = 'background:#fdeeee;color:#b24a4a;border:1px solid #f3c9c9;';

            // ── Already refunded → badge only, no further action ──
            if (alreadyRefunded) {
                html += ' <span class="badge badge-refunded" ' +
                        'style="' + refundedStyle + '"' +
                        ' title="Refund ID ' + (b.refundId || '') +
                        ' · Status: ' + (b.refundStatus || 'refunded') + '">' +
                        'Refunded ' + formatCurrency(b.refundAmount || 0) +
                        '</span>';
                return html;   // no cancel / refund buttons once refunded
            }

            // ── AUTHORIZED → nothing actionable (can't capture/void here) ──
            if (isRzp && isAuthorized) {
                return '<span style="font-size:.76rem;color:#888;" ' +
                       'title="Payment is AUTHORIZED but not yet captured. ' +
                       'Capture or void via Razorpay Dashboard first.">' +
                       '⏳ Authorized</span>';
            }

            // ── Cancel button: show only when booking is not yet cancelled ──
            if (status !== 'cancelled') {
                html += '<button class="action-btn action-btn-cancel" ' +
                        'style="' + cancelStyle + '" data-id="' + b.id + '">Cancel</button>';
            }

            // ── Refund button: cancelled + Razorpay + advance > 0 ──────────
            if (isRzp && status === 'cancelled' && Number(b.advance_paid) > 0) {
                var suggested = (window.Refund && window.Refund.computeRefundAmount)
                    ? window.Refund.computeRefundAmount(b) : 0;
                var btnLabel = suggested > 0
                    ? 'Refund ' + formatCurrency(suggested)
                    : 'Refund ₹0 (custom)';
                var btnTitle = suggested > 0
                    ? 'Slab refund: ' + formatCurrency(suggested) + '. Click to confirm or adjust.'
                    : '0–7 day no-refund slab. Click to issue a goodwill / custom refund.';
                html += ' <button class="action-btn action-btn-refund" ' +
                        'style="' + refundStyle + '" data-id="' + b.id +
                        '" title="' + btnTitle + '">' + btnLabel + '</button>';
            }

            return html || '-';
        }

        tbody.innerHTML = bookings.map(b => {
            var rowStatus = String(b.status || 'confirmed').toLowerCase();
            var rowSuggested = (window.Refund && window.Refund.computeRefundAmount)
                ? window.Refund.computeRefundAmount(b) : 0;
            var rowStyle = '';
            // Soft full-row shades requested by user:
            //   • confirmed/non-cancelled → green
            //   • cancelled + refundable  → yellow
            //   • refunded                → red
            if (b && b.refundId) {
                // Slightly deeper soft red
                rowStyle = 'background:#fbe4e4;';
            } else if (rowStatus === 'cancelled' && rowSuggested > 0) {
                // Slightly deeper soft yellow
                rowStyle = 'background:#fff1d6;';
            } else if (rowStatus !== 'cancelled') {
                // Slightly deeper soft green
                rowStyle = 'background:#e5f5e9;';
            }
            const bookingId = String(b.id);
            const isSelected = selectedBookingIds.has(bookingId);
            const previewSelected = activeBookingPreviewId === bookingId;
            const paymentState = getBookingPaymentState(b);
            return `
            <tr style="${rowStyle}" class="${previewSelected ? 'selected' : ''}" data-booking-row="1" data-id="${bookingId}">
                <td><input type="checkbox" class="booking-row-select" data-id="${bookingId}" ${isSelected ? 'checked' : ''} aria-label="Select booking ${bookingId}"></td>
                <td><button type="button" class="action-btn booking-open-preview" data-id="${bookingId}" style="padding:.25rem .55rem;">#${String(b.id).slice(-6)}</button></td>
                <td>${getPackageName(b.package_name)}</td>
                <td>${getUserName(b.userId)}</td>
                <td>${b.duration || '-'}</td>
                <td>${b.guests || '-'}</td>
                <td>${formatCurrency(b.price || 0)}</td>
                <td style="font-size:.82rem;color:#5a6877;">${escHtml((b.status || 'confirmed').toUpperCase())}</td>
                <td style="white-space:nowrap;overflow:visible;max-width:none;font-size:.82rem;color:#5a6877;">
                    ${escHtml(paymentState.label)}
                    ${b.payment_id && /^pay_/i.test(String(b.payment_id))
                        ? `<a href="https://dashboard.razorpay.com/app/payments/${encodeURIComponent(b.payment_id)}" target="_blank" rel="noopener" title="View ${b.payment_id} in Razorpay" style="display:inline-block;margin-left:5px;color:#0d7a8a;font-size:11px;vertical-align:middle;text-decoration:none;" onclick="event.stopPropagation()"><i class="fas fa-external-link-alt"></i></a>`
                        : ''}
                </td>
                <td>${formatDate(b.createdAt)}</td>
                <td>${actionCellHtml(b)}</td>
            </tr>
        `;
        }).join('');

        Array.prototype.forEach.call(
            tbody.querySelectorAll('.booking-row-select'),
            function (cb) {
                cb.addEventListener('click', function (e) {
                    e.stopPropagation();
                });
                cb.addEventListener('change', function () {
                    const id = String(this.dataset.id || '');
                    if (!id) return;
                    if (this.checked) selectedBookingIds.add(id);
                    else selectedBookingIds.delete(id);
                    updateBookingsBulkUi();
                });
            }
        );

        Array.prototype.forEach.call(
            tbody.querySelectorAll('tr[data-booking-row="1"]'),
            function (tr) {
                tr.addEventListener('click', function (e) {
                    if (e.target.closest('button, a, input, label')) return;
                    const id = String(this.dataset.id || '');
                    setActiveBookingPreview(id, bookings);
                });
            }
        );

        Array.prototype.forEach.call(
            tbody.querySelectorAll('.booking-open-preview'),
            function (btn) {
                btn.addEventListener('click', function (e) {
                    e.preventDefault();
                    e.stopPropagation();
                    const id = String(this.dataset.id || '');
                    setActiveBookingPreview(id, bookings);
                });
            }
        );

        const selectAll = document.getElementById('bookingSelectAll');
        if (selectAll) {
            const visibleIds = bookings.map((b) => String(b.id));
            const selectableCount = visibleIds.length;
            const selectedVisibleCount = visibleIds.filter((id) => selectedBookingIds.has(id)).length;
            selectAll.checked = selectableCount > 0 && selectedVisibleCount === selectableCount;
            selectAll.indeterminate = selectedVisibleCount > 0 && selectedVisibleCount < selectableCount;
            if (!selectAll.__bulkWired) {
                selectAll.__bulkWired = true;
                selectAll.addEventListener('change', function () {
                    const rows = Array.prototype.slice.call(
                        document.querySelectorAll('#allBookingsBody .booking-row-select')
                    );
                    rows.forEach((rowCb) => {
                        const id = String(rowCb.dataset.id || '');
                        rowCb.checked = this.checked;
                        if (!id) return;
                        if (this.checked) selectedBookingIds.add(id);
                        else selectedBookingIds.delete(id);
                    });
                    updateBookingsBulkUi();
                });
            }
        }

        updateBookingsBulkUi();
        // FIX: if the user explicitly closed the panel, do NOT auto-reopen it.
        // Only render/open the preview when the panel is in an open state.
        if (!bookingPreviewClosed) {
            if (!activeBookingPreviewId && bookings.length) {
                setActiveBookingPreview(String(bookings[0].id), bookings, true);
            } else {
                const previewBooking = bookings.find((row) => String(row.id) === String(activeBookingPreviewId)) || null;
                renderBookingPreview(previewBooking || null);
            }
        }

        // Stand-alone Refund handler — issues a refund without touching
        // the booking's status. Useful for goodwill refunds, partial
        // refunds, or fixing duplicate charges. Cancellation has its
        // own button below; the two flows are intentionally separate.
        //
        // 2026-05 UI refresh: switched from window.prompt() (which leaks
        // booking refs into a browser-chrome dialog and looks unprofessional)
        // to a proper modal built with openRefundDialog(). Same logic, way
        // nicer UX — admin sees a clean form with the booking summary,
        // an editable amount field, slab info, and Cancel/Refund buttons.
        tbody.querySelectorAll('.action-btn-refund').forEach(btn => {
            btn.addEventListener('click', async function () {
                const rawId = this.dataset.id;
                const booking = DB.bookings.find(b =>
                    String(b.id) === String(rawId)
                );
                if (!booking) return;

                if (!window.Refund || !window.Refund.processRefund) {
                    if (window.Toast) window.Toast.error('Refund helper not loaded.');
                    return;
                }
                if (booking.refundId) {
                    if (window.Toast) window.Toast.info('Already refunded (' + booking.refundId + ').');
                    return;
                }

                // Suggested amount per the customer-facing slab policy.
                // May be 0 (slab=0 / past-travel / cancelled) — in that
                // case the dialog still opens so the admin can issue a
                // manual / goodwill refund, capped by advance_paid.
                const suggested = window.Refund.computeRefundAmount
                    ? window.Refund.computeRefundAmount(booking) : 0;
                const advance = Number(booking.advance_paid) || 0;
                if (advance <= 0) {
                    if (window.Toast) window.Toast.warning('Nothing to refund — no advance was charged for this booking.');
                    return;
                }

                const me = JSON.parse(localStorage.getItem('currentUser') || 'null');
                const refundedBy = (me && (me.email || me.username)) || 'admin';

                // Open the styled modal and wait for the admin to
                // confirm an amount (or cancel).
                const amount = await openRefundDialog(booking, {
                    suggested: suggested,
                    advance: advance
                });
                if (amount == null) return; // user cancelled

                const origLabel = btn.innerHTML;
                btn.disabled = true;

                // ── ₹0 → auto-settle (no actual refund call) ──────
                // Admin chose to close out the booking without sending
                // any money back. Skip the Razorpay round-trip entirely
                // and just mark the booking as settled in Firestore +
                // localStorage so it stops appearing in the "Refund
                // Pending" filter / yellow-row UI.
                if (amount === 0) {
                    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Settling…';
                    try {
                        const settledAt = new Date().toISOString();
                        // Mirror the same shape saveRefundToBooking writes,
                        // but with a synthetic refundId and amount = 0 so
                        // the dashboard treats it as "closed out".
                        const fakeRefund = {
                            ok: true,
                            refundId: 'SETTLED-' + Date.now(),
                            amount: 0,
                            status: 'settled',
                            currency: 'INR',
                            initiatedBy: refundedBy
                        };
                        await window.Refund.saveRefundToBooking(booking, fakeRefund);
                        window.Refund.logRefund(booking, fakeRefund, refundedBy);
                        booking.refundId = fakeRefund.refundId;
                        booking.refundAmount = 0;
                        booking.refundStatus = 'settled';
                        booking.refundedAt = settledAt;
                        DB.saveBookings();
                        refreshAll();
                        if (window.Toast) {
                            window.Toast.success(
                                'Booking closed out with no refund (auto-settled).'
                            );
                        }
                    } catch (e) {
                        if (window.Toast) window.Toast.error('Auto-settle failed: ' + (e && e.message));
                    } finally {
                        btn.disabled = false;
                        btn.innerHTML = origLabel;
                    }
                    return;
                }

                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Refunding…';
                try {
                    const refund = await window.Refund.processRefund(booking, {
                        amount: amount,
                        reason: 'Manual refund from admin dashboard by ' + refundedBy
                    });
                    if (refund && refund.ok && !refund.skipped) {
                        await window.Refund.saveRefundToBooking(booking, refund);
                        window.Refund.logRefund(booking, refund, refundedBy);
                        booking.refundId = refund.refundId;
                        booking.refundAmount = refund.amount;
                        booking.refundStatus = refund.status || 'pending';
                        booking.refundedAt = new Date().toISOString();
                        DB.saveBookings();
                        refreshAll();
                        if (window.Toast) {
                            window.Toast.success(
                                '₹' + Number(refund.amount).toLocaleString('en-IN') +
                                ' refund ' + (refund.status === 'processed' ? 'processed' : 'initiated') +
                                '. Razorpay ID: ' + refund.refundId
                            );
                        }
                    } else if (refund && refund.skipped) {
                        if (window.Toast) window.Toast.info('Refund skipped: ' + refund.reason);
                    } else {
                        var refundErr = String(refund && refund.error || 'unknown');
                        if (/fully refunded already/i.test(refundErr)) {
                            booking.refundStatus = 'refunded';
                            booking.refundedAt = new Date().toISOString();
                            DB.saveBookings();
                            refreshAll();
                            if (window.Toast) window.Toast.info('Razorpay reports this payment was already fully refunded.');
                        } else if (/greater than.*payment amount|exceeds.*payment/i.test(refundErr)) {
                            // The refund amount exceeds what Razorpay has on record for
                            // this payment. This happens when:
                            //   a) advance_paid in Firestore is stale/wrong
                            //   b) a partial refund was already issued outside the dashboard
                            //   c) the payment was a test ₹1 charge
                            // Fetch the real Razorpay payment amount and re-open the dialog
                            // so admin can enter the correct (lower) amount.
                            let actualAmount = 0;
                            try {
                                const liveData = await fetchRazorpayPaymentStatus(booking.payment_id);
                                if (liveData && liveData.amount) {
                                    actualAmount = Number(liveData.amount);
                                }
                            } catch (_) {}
                            btn.disabled = false;
                            btn.innerHTML = origLabel;
                            if (window.Toast) {
                                window.Toast.error(
                                    'Refund amount exceeds the actual Razorpay payment.' +
                                    (actualAmount > 0
                                        ? ' The payment on record is ' + formatCurrency(actualAmount) +
                                          '. Please enter an amount ≤ ' + formatCurrency(actualAmount) + '.'
                                        : ' Please enter a lower amount.'),
                                    { duration: 10000 }
                                );
                            }
                            // Re-open dialog with corrected cap
                            const correctedAdvance = actualAmount > 0 ? actualAmount : advance;
                            const correctedAmount = await openRefundDialog(booking, {
                                suggested: Math.min(suggested, correctedAdvance),
                                advance: correctedAdvance
                            });
                            if (correctedAmount == null) return;
                            btn.disabled = true;
                            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Refunding…';
                            try {
                                const retry = await window.Refund.processRefund(booking, {
                                    amount: correctedAmount,
                                    reason: 'Manual refund from admin dashboard by ' + refundedBy + ' (corrected amount)'
                                });
                                if (retry && retry.ok && !retry.skipped) {
                                    await window.Refund.saveRefundToBooking(booking, retry);
                                    window.Refund.logRefund(booking, retry, refundedBy);
                                    booking.refundId = retry.refundId;
                                    booking.refundAmount = retry.amount;
                                    booking.refundStatus = retry.status || 'pending';
                                    booking.refundedAt = new Date().toISOString();
                                    DB.saveBookings();
                                    refreshAll();
                                    if (window.Toast) {
                                        window.Toast.success(
                                            '₹' + Number(retry.amount).toLocaleString('en-IN') +
                                            ' refund ' + (retry.status === 'processed' ? 'processed' : 'initiated') +
                                            '. Razorpay ID: ' + retry.refundId
                                        );
                                    }
                                } else {
                                    if (window.Toast) window.Toast.error('Refund FAILED: ' + (retry && retry.error || 'unknown'));
                                }
                            } catch (e2) {
                                if (window.Toast) window.Toast.error('Refund threw: ' + (e2 && e2.message));
                            }
                        } else {
                            if (window.Toast) window.Toast.error('Refund FAILED: ' + refundErr);
                        }
                    }
                } catch (e) {
                    if (window.Toast) window.Toast.error('Refund threw: ' + (e && e.message));
                } finally {
                    btn.disabled = false;
                    btn.innerHTML = origLabel;
                }
            });
        });

        // Attach cancel handlers — match by string OR numeric id so that
        // legacy numeric booking ids and the new string "TEST-..." ids
        // both work. After the cancel goes through we also fire-and-forget
        // a cancellation email to cancellation@andamanvoyages.in (the
        // customer is cc'd) — same Trigger Email pattern as the booking
        // confirmation. The email is best-effort: any Firestore / rules /
        // extension issue is logged but never blocks the UI.
        tbody.querySelectorAll('.action-btn-cancel').forEach(btn => {
            btn.addEventListener('click', async function () {
                const rawId = this.dataset.id;
                const booking = DB.bookings.find(b =>
                    String(b.id) === String(rawId)
                );
                if (!booking) return;

                const isRzp = window.Refund && window.Refund.isRazorpayPayment &&
                              window.Refund.isRazorpayPayment(booking);

                // ── Block cancellation if payment is AUTHORIZED (not yet captured) ──
                // An AUTHORIZED payment has a card hold but money hasn't moved.
                // Cancelling the booking in this state is problematic because:
                //   1. We can't refund an uncaptured payment (Razorpay rejects it).
                //   2. The customer's card hold will eventually expire on its own.
                // Admin must either: capture the payment first (then cancel + refund),
                // or void/release it directly via the Razorpay Dashboard.
                if (isRzp && booking.payment_id) {
                    const btnEl = this;
                    const origLabel = btnEl.innerHTML;
                    btnEl.disabled = true;
                    btnEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

                    let liveStatus = null;
                    try {
                        liveStatus = await fetchRazorpayPaymentStatus(booking.payment_id);
                    } catch (_) {}

                    btnEl.disabled = false;
                    btnEl.innerHTML = origLabel;

                    if (liveStatus && String(liveStatus.status || '').toLowerCase() === 'authorized') {
                        if (window.Toast) {
                            window.Toast.error(
                                'Cannot cancel — payment is AUTHORIZED but not yet captured.\n\n' +
                                'Go to Razorpay Dashboard → Payments → ' + booking.payment_id +
                                ' and either:\n• Capture it first, then cancel here\n• Void/release the authorization directly',
                                { duration: 10000 }
                            );
                        } else {
                            alert(
                                'Cannot cancel this booking.\n\n' +
                                'The Razorpay payment is AUTHORIZED but not yet CAPTURED.\n\n' +
                                'Please go to your Razorpay Dashboard and either:\n' +
                                '1. Capture the payment first, then cancel here\n' +
                                '2. Void / release the authorization directly in Razorpay\n\n' +
                                'Payment ID: ' + booking.payment_id
                            );
                        }
                        return;
                    }
                }

                // Compute the suggested refund up-front so the admin
                // sees what'll happen before they confirm.
                let suggestedRefund = 0;
                if (window.Refund && window.Refund.computeRefundAmount) {
                    suggestedRefund = window.Refund.computeRefundAmount(booking);
                }

                let confirmMsg = 'Cancel this booking?\n\nThis will:\n' +
                    '• Mark the booking as cancelled\n' +
                    '• Email the customer + cancellation@andamanvoyages.in';
                if (isRzp && suggestedRefund > 0) {
                    confirmMsg += '\n• Auto-refund ₹' + suggestedRefund.toLocaleString('en-IN') +
                                  ' to the original payment method (Razorpay)';
                } else if (isRzp) {
                    confirmMsg += '\n• No refund (0–7 day no-refund slab)';
                }
                if (!confirm(confirmMsg)) return;

                booking.status = 'cancelled';
                booking.cancelledAt = new Date().toISOString();
                DB.saveBookings();
                refreshAll();

                // Identify who cancelled, for the email's "Cancelled by" line.
                const me = JSON.parse(localStorage.getItem('currentUser') || 'null');
                const cancelledBy = (me && (me.email || me.username)) || 'admin';

                // ── Cancellation email (admin token → Brevo Worker) ──
                let mailMsg = '';
                if (window.BookingEmails && window.BookingEmails.sendBookingCancellation) {
                    try {
                        const sent = await window.BookingEmails.sendBookingCancellation(booking, {
                            cancelledBy: cancelledBy,
                            reason: 'Cancelled from admin dashboard'
                        });
                        mailMsg = sent ? 'Email sent.' : 'Email NOT sent.';
                    } catch (e) { mailMsg = 'Email error.'; }
                } else {
                    mailMsg = 'Email helper not loaded.';
                }

                // ── Auto-process refund if applicable ─────────────────
                let refundMsg = '';
                if (window.Refund && window.Refund.processRefund) {
                    try {
                        const refund = await window.Refund.processRefund(booking, {
                            reason: 'Cancelled from admin dashboard by ' + cancelledBy
                        });
                        if (refund && refund.ok && !refund.skipped) {
                            await window.Refund.saveRefundToBooking(booking, refund);
                            window.Refund.logRefund(booking, refund, cancelledBy);
                            // Mirror on the local DB record so the table re-render shows it
                            booking.refundId = refund.refundId;
                            booking.refundAmount = refund.amount;
                            booking.refundStatus = refund.status || 'pending';
                            booking.refundedAt = new Date().toISOString();
                            DB.saveBookings();
                            refreshAll();
                            refundMsg = ' ₹' + Number(refund.amount).toLocaleString('en-IN') +
                                        ' refund ' + (refund.status === 'processed' ? 'processed' : 'initiated') + '.';
                        } else if (refund && refund.skipped) {
                            refundMsg = ' Refund skipped (' + refund.reason + ').';
                        } else if (refund && !refund.ok) {
                            refundMsg = ' Refund FAILED: ' + (refund.error || 'unknown') + '.';
                        }
                    } catch (e) {
                        refundMsg = ' Refund threw: ' + (e && e.message);
                    }
                }

                if (window.Toast && window.Toast.success) {
                    window.Toast.success('Booking cancelled. ' + mailMsg + refundMsg);
                }
            });
        });
    }

    // ── Booking status pill tabs ─────────────────────────────────
    // These pill buttons replace the old <select> filter. Clicking a pill
    // updates the hidden <select> (for backward-compat with any code that
    // reads bookingFilter.value) and re-renders the table.
    function updateBookingStatusCounts() {
        const all       = DB.bookings;
        const confirmed = all.filter(b => String(b.status || 'confirmed').toLowerCase() === 'confirmed');
        const cancelled = all.filter(b => String(b.status || '').toLowerCase() === 'cancelled');
        const refunded  = all.filter(b => !!b.refundId || String(b.refundStatus || '').toLowerCase() === 'refunded');

        const setCount = (id, n) => {
            const el = document.getElementById(id);
            if (el) el.textContent = String(n);
        };
        setCount('bkCountAll',       all.length);
        setCount('bkCountConfirmed', confirmed.length);
        setCount('bkCountCancelled', cancelled.length);
        setCount('bkCountRefunded',  refunded.length);
    }

    (function wireBookingStatusTabs() {
        const tabs = document.querySelectorAll('.bk-status-tab[data-bk-status]');
        tabs.forEach(function (tab) {
            tab.addEventListener('click', function () {
                const status = this.getAttribute('data-bk-status') || 'all';
                // Update aria / active state on all tabs
                tabs.forEach(function (t) {
                    t.classList.toggle('active', t === tab);
                    t.setAttribute('aria-selected', t === tab ? 'true' : 'false');
                });
                // Sync the hidden <select> so renderAllBookings reads correct value
                if (bookingFilter) bookingFilter.value = status;
                renderAllBookings(status, bookingSearch ? bookingSearch.value : '');
            });
        });
    })();

    // Booking search and filter
    const bookingSearch = document.getElementById('bookingSearch');
    const bookingFilter = document.getElementById('bookingFilter');

    if (bookingSearch) {
        bookingSearch.addEventListener('input', () => {
            renderAllBookings(bookingFilter ? bookingFilter.value : 'all', bookingSearch.value);
        });
    }
    if (bookingFilter) {
        bookingFilter.addEventListener('change', () => {
            renderAllBookings(bookingFilter.value, bookingSearch ? bookingSearch.value : '');
        });
    }

    // ── Seed / Clear test bookings (admin convenience) ────────
    // Adds a couple of fake confirmed bookings to localStorage so the
    // admin can verify the Cancel button + status badges + revenue
    // breakdown without needing to push a real Razorpay payment
    // through. The data lives ONLY on this device's localStorage —
    // it never reaches Firestore — so it's a 100 %-safe sandbox.
    const seedFakeBookingsBtn  = document.getElementById('seedFakeBookingsBtn');
    const clearFakeBookingsBtn = document.getElementById('clearFakeBookingsBtn');
    const BOOKINGS_ARCHIVE_KEY = 'bookingsArchive';

    function readBookingsArchive() {
        try {
            const raw = JSON.parse(localStorage.getItem(BOOKINGS_ARCHIVE_KEY) || '[]');
            return Array.isArray(raw) ? raw : [];
        } catch (_) {
            return [];
        }
    }

    function writeBookingsArchive(rows) {
        localStorage.setItem(BOOKINGS_ARCHIVE_KEY, JSON.stringify(Array.isArray(rows) ? rows : []));
    }

    function isArchivableBooking(booking) {
        if (!booking || typeof booking !== 'object') return false;
        const status = String(booking.status || '').toLowerCase();
        return status === 'cancelled' || !!booking.refundId || !!booking.refundedAt;
    }

    function getLocalOnlyBookings() {
        return JSON.parse(localStorage.getItem('bookings') || '[]');
    }

    function persistBulkBookings(activeRows, archivedRows, opts) {
        opts = opts || {};
        localStorage.setItem('bookings', JSON.stringify(activeRows || []));
        if (Array.isArray(archivedRows) && archivedRows.length) {
            const existingArchive = readBookingsArchive();
            const archiveMap = {};
            existingArchive.forEach((row) => {
                const key = String((row && (row.booking_ref || row.id)) || '');
                if (key) archiveMap[key] = row;
            });
            archivedRows.forEach((row) => {
                const key = String((row && (row.booking_ref || row.id)) || '');
                if (key) archiveMap[key] = row;
                else existingArchive.push(row);
            });
            const mergedArchive = Object.keys(archiveMap).map((key) => archiveMap[key]).concat(
                existingArchive.filter((row) => {
                    const key = String((row && (row.booking_ref || row.id)) || '');
                    return !key;
                })
            );
            writeBookingsArchive(mergedArchive);
        }
        DB.bookings = activeRows || [];
        if (opts.clearSelected !== false) selectedBookingIds.clear();
        refreshAll();
    }

    function updateBookingsBulkUi() {
        const archiveBtn = document.getElementById('bulkArchiveBookingsBtn');
        const deleteBtn = document.getElementById('bulkDeleteBookingsBtn');
        const count = selectedBookingIds.size;
        if (archiveBtn) {
            archiveBtn.disabled = count === 0;
            archiveBtn.innerHTML = '<i class="fas fa-box-archive"></i> Arch.' + (count ? ' (' + count + ')' : '');
        }
        if (deleteBtn) {
            deleteBtn.disabled = count === 0;
            deleteBtn.innerHTML = '<i class="fas fa-trash"></i> Del.' + (count ? ' (' + count + ')' : '');
        }
    }

    function archiveSelectedBookings() {
        const selectedIds = Array.from(selectedBookingIds);
        if (!selectedIds.length) {
            if (window.Toast && window.Toast.info) window.Toast.info('Select one or more bookings first.');
            return;
        }
        const localRows = getLocalOnlyBookings();
        const selectedSet = new Set(selectedIds);
        const activeRows = [];
        const archivedRows = [];
        const skippedRows = [];

        localRows.forEach((row) => {
            const id = String((row && row.id) || '');
            if (!selectedSet.has(id)) {
                activeRows.push(row);
                return;
            }
            archivedRows.push(Object.assign({}, row, {
                archivedAt: new Date().toISOString(),
                archivedReason: isArchivableBooking(row) ? 'selected_archive_closed' : 'selected_archive_manual'
            }));
        });

        selectedIds.forEach((id) => {
            if (!localRows.some((row) => String((row && row.id) || '') === id)) skippedRows.push(id);
        });

        if (!archivedRows.length) {
            if (window.Toast && window.Toast.info) {
                window.Toast.info('Selected bookings are not available in localStorage on this device.');
            }
            return;
        }

        if (!confirm(
            'Archive ' + archivedRows.length + ' selected local booking(s)?\n\n' +
            '• They will be removed from the active dashboard list\n' +
            '• They will be stored in localStorage "' + BOOKINGS_ARCHIVE_KEY + '"\n' +
            '• Firestore-only rows are skipped'
        )) return;

        persistBulkBookings(activeRows, archivedRows);
        if (window.Toast && window.Toast.success) {
            window.Toast.success(
                'Archived ' + archivedRows.length + ' selected booking(s).' +
                (skippedRows.length ? ' Skipped ' + skippedRows.length + ' Firestore-only row(s).' : '')
            );
        }
    }

    function deleteSelectedBookings() {
        const selectedIds = Array.from(selectedBookingIds);
        if (!selectedIds.length) {
            if (window.Toast && window.Toast.info) window.Toast.info('Select one or more bookings first.');
            return;
        }
        const localRows = getLocalOnlyBookings();
        const selectedSet = new Set(selectedIds);
        const activeRows = [];
        let deletedCount = 0;

        localRows.forEach((row) => {
            const id = String((row && row.id) || '');
            if (selectedSet.has(id)) {
                deletedCount++;
                return;
            }
            activeRows.push(row);
        });

        if (!deletedCount) {
            if (window.Toast && window.Toast.info) {
                window.Toast.info('Selected bookings are not available in localStorage on this device.');
            }
            return;
        }

        if (!confirm(
            'Delete ' + deletedCount + ' selected local booking(s)?\n\n' +
            '• This removes them from this device only\n' +
            '• They will NOT be archived\n' +
            '• Firestore-only rows are skipped'
        )) return;

        persistBulkBookings(activeRows, [], { clearSelected: true });
        if (window.Toast && window.Toast.success) {
            window.Toast.success('Deleted ' + deletedCount + ' selected local booking(s).');
        }
    }

    function makeFakeBooking(overrides) {
        const now = Date.now();
        // Travel date 35 days out → puts us in the 30+ day refund slab
        // (so computeRefundAmount returns a non-zero amount and the
        // Refund button actually appears in the table). Without this,
        // the seeded booking sat in the 0-7 day slab → ₹0 refund →
        // button hidden, which is what tripped admins up before.
        const travelInDays = 35;
        const travel = new Date(now + travelInDays * 24 * 60 * 60 * 1000)
            .toISOString().slice(0, 10);
        // Synthetic Razorpay-style payment id (`pay_TEST…`). The Refund
        // button visibility check (js/refund.js → isRazorpayPayment)
        // requires the id to start with `pay_` AND not be `FREE-…`.
        // Using `pay_TEST…` makes the button render so the UX can be
        // validated end-to-end. The actual refund call will then fail
        // gracefully at Razorpay because the id doesn't exist on their
        // side — admin gets a clear "id does not exist" toast, which is
        // the expected outcome for a fake booking.
        const fakePid = 'pay_TEST' +
            now.toString(36) + Math.random().toString(36).slice(2, 6);
        // Per-head advance for a Standard pkg = ₹6,000 × 2 heads = ₹12,000.
        // Override per-call as needed.
        return Object.assign({
            id: 'TEST-' + now + '-' + Math.floor(Math.random() * 1000),
            userId: 'fake-user-' + Math.floor(Math.random() * 9999),
            package_name: 'standard',
            duration: '6 Nights / 7 Days',
            guests: 2,
            adults: 2,
            children: 0,
            price: 21999,
            advance_paid: 12000,
            balance_due: 9999,
            travel_date: travel,
            status: 'confirmed',
            payment_id: fakePid,
            payment_status: 'partial_advance',
            createdAt: new Date(now).toISOString()
        }, overrides || {});
    }

    if (seedFakeBookingsBtn) {
        seedFakeBookingsBtn.addEventListener('click', () => {
            const existing = JSON.parse(localStorage.getItem('bookings') || '[]');
            const newOnes = [
                makeFakeBooking({
                    id: 'TEST-' + Date.now() + '-A',
                    package_name: 'budget',
                    duration: '4 Nights / 5 Days',
                    guests: 2,
                    price: 15999,
                    status: 'confirmed',
                    customerName: 'Test Customer A',
                    customerEmail: 'test-a@example.com',
                    customerPhone: '+91 99999 11111'
                }),
                makeFakeBooking({
                    id: 'TEST-' + Date.now() + '-B',
                    package_name: 'honeymoon',
                    duration: '5 Nights / 6 Days',
                    guests: 2,
                    price: 24999,
                    status: 'confirmed',
                    customerName: 'Test Customer B',
                    customerEmail: 'test-b@example.com',
                    customerPhone: '+91 99999 22222'
                })
            ];
            const merged = existing.concat(newOnes);
            localStorage.setItem('bookings', JSON.stringify(merged));
            DB.bookings = merged;
            refreshAll();
            const msg = '✓ Added ' + newOnes.length + ' test booking(s). They live only in this browser\'s localStorage — Cancel/refund will NOT charge any real card. Use "Archive Closed Bookings" to move cancelled/refunded rows out of the active list.';
            if (window.Toast && window.Toast.success) window.Toast.success(msg);
            else alert(msg);
        });
    }

    if (clearFakeBookingsBtn) {
        clearFakeBookingsBtn.addEventListener('click', () => {
            const existing = JSON.parse(localStorage.getItem('bookings') || '[]');
            const active = [];
            const toArchive = [];

            existing.forEach((booking) => {
                if (isArchivableBooking(booking)) toArchive.push(booking);
                else active.push(booking);
            });

            if (!toArchive.length) {
                if (window.Toast && window.Toast.info) {
                    window.Toast.info('No cancelled or refunded local bookings to archive.');
                } else {
                    alert('No cancelled or refunded local bookings to archive.');
                }
                return;
            }

            if (!confirm(
                'Archive ' + toArchive.length + ' cancelled/refunded local booking(s)?\n\n' +
                '• Active bookings will stay in the dashboard\n' +
                '• Archived rows will be moved to localStorage "' + BOOKINGS_ARCHIVE_KEY + '"\n' +
                '• Firestore bookings are NOT touched'
            )) return;

            const archivedAt = new Date().toISOString();
            persistBulkBookings(
                active,
                toArchive.map((booking) => Object.assign({}, booking, {
                    archivedAt: archivedAt,
                    archivedReason: booking.refundId ? 'refunded_or_closed' : 'cancelled'
                }))
            );
            if (window.Toast && window.Toast.success) {
                window.Toast.success(
                    'Archived ' + toArchive.length + ' closed booking(s). ' +
                    active.length + ' active booking(s) kept in the dashboard.'
                );
            }
        });
    }

    const bulkArchiveBookingsBtn = document.getElementById('bulkArchiveBookingsBtn');
    const bulkDeleteBookingsBtn = document.getElementById('bulkDeleteBookingsBtn');
    if (bulkArchiveBookingsBtn) bulkArchiveBookingsBtn.addEventListener('click', archiveSelectedBookings);
    if (bulkDeleteBookingsBtn) bulkDeleteBookingsBtn.addEventListener('click', deleteSelectedBookings);
    updateBookingsBulkUi();

    // ── Package Editor ──────────────────────────────────────────
    let packagesData = [];

    const SITE_IMAGES = [
        'images/beach1.jpg', 'images/beach2.jpg', 'images/beach3.jpg',
        'images/beach4.jpg', 'images/neil1.jpg', 'images/neil2.jpg',
        'images/neil3.jpg', 'images/neil4.jpg', 'images/neil6.jpg',
        'images/ross2.jpg', 'images/ross3.jpg'
    ];

    // Track whether the package editor has been hydrated yet — once hydrated
    // we MUST NOT re-fetch / re-render from refreshAll() because that would
    // wipe in-progress edits and re-trigger Firestore reads on every tick.
    let packagesHydrated = false;

    async function loadAndRenderPackages() {
        const container = document.getElementById('packageCards');
        container.innerHTML = '<p style="padding:2rem;color:#888;text-align:center;"><i class="fas fa-spinner fa-spin"></i> Loading packages…</p>';

        if (window.PackagesStore) {
            // Single fetch only — avoid the "stale-while-revalidate" double
            // callback that previously caused two re-renders (and therefore
            // two Firestore round-trips and lost typing focus).
            try {
                const result = await window.PackagesStore.load();
                if (result && Array.isArray(result.data) && result.data.length) {
                    packagesData = result.data;
                    renderPackageEditorCards();
                    packagesHydrated = true;
                    return;
                }
            } catch (e) {
                console.warn('PackagesStore.load failed', e);
            }
        }

        // Fallback hard-coded defaults
        packagesData = Object.entries(PACKAGES).map(([id, p]) => ({
            id, name: p.name, desc: '', price: p.price,
            rating: 4.5, image: 'images/beach1.jpg', inclusions: [], visible: true
        }));
        renderPackageEditorCards();
        packagesHydrated = true;
    }

    function renderPackages() {
        // Only fetch from the network once. Subsequent refreshAll() ticks
        // (e.g. after a booking cancel, after `storage` events from other
        // tabs, after settings save) must NOT re-load the package editor —
        // it would discard any unsaved edits and hammer Firestore.
        if (packagesHydrated) return;
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
        // Ensure imageIds + blocks always exist so we can mutate them safely.
        // Phase 2 (package_redesign_plan.md): the typed `blocks[]` array is
        // additive — when it has rows, the public renderer shows an MMT-style
        // typed timeline. When empty, the renderer falls back to the legacy
        // `activities[]` plain list. Existing packages keep working unchanged.
        if (!Array.isArray(day.imageIds)) day.imageIds = [];
        if (!Array.isArray(day.blocks))   day.blocks   = [];

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
            <!-- Activities — line-by-line list editor with per-row
                 description + image upload (collapsed by default).
                 Logic in js/itinerary-list-editors.js. -->
            <div class="pkg-edit-row">
                <label>Activities <small>(one per row · click ⌃ for description / image)</small></label>
                <div class="ite-act-list-host" data-act-list></div>
            </div>
            <!-- Per-day gallery: uses gallery collection. Photos uploaded
                 here get packageRef = pkg.id and dayNumber = day.day so
                 they also appear on the public /gallery page. -->
            <div class="ite-day-gallery">
                <div class="ite-day-gallery-head">
                    <label>Day Photos <small>(<span class="ite-day-gallery-count">0</span>)</small></label>
                    <div class="ite-day-gallery-actions">
                        <button type="button" class="btn-day-pick"   title="Choose from existing gallery">
                            <i class="fas fa-images"></i> Pick
                        </button>
                        <button type="button" class="btn-day-upload" title="Upload new photo(s) for this day">
                            <i class="fas fa-cloud-upload-alt"></i> Upload
                        </button>
                        <input type="file" class="ite-day-file-input" accept="image/*" multiple style="display:none;">
                    </div>
                </div>
                <div class="ite-day-gallery-strip"></div>
                <div class="ite-day-gallery-status"></div>
            </div>
            <!-- Phase 2: typed trip-blocks (MMT-style timeline). Empty → public renderer falls back to activities[]. -->
            <div class="ite-blocks-section" data-day-blocks>
                <div class="ite-blocks-head">
                    <label>Trip Blocks <small>(<span class="ite-blocks-count">0</span>) — leave empty to keep the plain Activities list above</small></label>
                </div>
                <div class="ite-blocks-toolbar"></div>
                <div class="ite-blocks-list"></div>
            </div>
        `;
        // Bind events
        el.querySelector('.btn-del-day').addEventListener('click', () => window._iteDeleteDay(pkgIdx, dayIdx));
        el.querySelector('input[placeholder*="Arrival"]').addEventListener('input', function() {
            packagesData[pkgIdx].days[dayIdx].title = this.value;
        });
        el.querySelector('input[placeholder*="Short"]').addEventListener('input', function() {
            packagesData[pkgIdx].days[dayIdx].desc = this.value;
        });

        // Wire the activity list editor (replaces the legacy
        // newline-separated textarea). Each activity can be a plain
        // string (legacy) or an object { title, desc, imageUrl } —
        // the editor preserves the simple string shape until the user
        // fills in extras, so old packages keep their old payload.
        if (window.IteListEditors && typeof window.IteListEditors.wireActivityList === 'function') {
            const actHost = el.querySelector('[data-act-list]');
            if (actHost) {
                window.IteListEditors.wireActivityList(actHost, day, {
                    uploadDefaults: function (d) {
                        const pkg = packagesData[pkgIdx];
                        return {
                            title:      (pkg && pkg.name ? pkg.name + ' — Day ' + d.day : 'Day ' + d.day),
                            category:   '',
                            date:       new Date().toISOString().slice(0, 10),
                            place:      '',
                            packageRef: pkg && (pkg.id || pkg.name) || ''
                        };
                    }
                });
            }
        }

        // ── Day-gallery wiring ────────────────────────────
        const stripEl  = el.querySelector('.ite-day-gallery-strip');
        const countEl  = el.querySelector('.ite-day-gallery-count');
        const statusEl = el.querySelector('.ite-day-gallery-status');
        const fileEl   = el.querySelector('.ite-day-file-input');

        function refreshStrip() {
            const ids = packagesData[pkgIdx].days[dayIdx].imageIds || [];
            countEl.textContent = ids.length;
            if (!ids.length) {
                stripEl.innerHTML = '<p class="ite-day-gallery-empty">No photos yet. Click <strong>Pick</strong> to attach existing photos, or <strong>Upload</strong> to add new ones.</p>';
                return;
            }
            // Resolve thumbs from the gallery cache (populated lazily below)
            stripEl.innerHTML = ids.map((gid, i) => {
                const item = window._iteGalleryCache && window._iteGalleryCache[gid];
                const src  = item ? (item.thumbUrl || item.url) : '';
                const cap  = item ? escHtml(item.title || '') : '…';
                return `
                <div class="ite-day-thumb" data-gid="${escHtml(gid)}">
                    ${src ? `<img src="${escHtml(src)}" alt="${cap}" loading="lazy">` : `<div class="ite-day-thumb-loading"><i class="fas fa-spinner fa-spin"></i></div>`}
                    <button type="button" class="ite-day-thumb-rm" title="Remove from this day">
                        <i class="fas fa-times"></i>
                    </button>
                </div>`;
            }).join('');

            // Wire remove buttons
            stripEl.querySelectorAll('.ite-day-thumb-rm').forEach((btn, i) => {
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const arr = packagesData[pkgIdx].days[dayIdx].imageIds || [];
                    arr.splice(i, 1);
                    refreshStrip();
                    setStatus('Removed from day. Click Save & Publish to keep the change.');
                });
            });

            // Lazy-load any missing thumbs in the cache, then re-render
            const missing = ids.filter(gid => !(window._iteGalleryCache && window._iteGalleryCache[gid]));
            if (missing.length) {
                ensureGalleryCache().then(() => refreshStrip()).catch(() => {});
            }
        }

        function setStatus(msg, isError) {
            statusEl.textContent = msg || '';
            statusEl.style.color = isError ? '#c0392b' : '#0d7a8a';
        }

        // ── Pick from existing gallery ─────────────────────
        el.querySelector('.btn-day-pick').addEventListener('click', async () => {
            try {
                await ensureGalleryCache();
                openGalleryPicker(pkgIdx, dayIdx, refreshStrip);
            } catch (err) {
                setStatus('Could not load gallery: ' + (err && err.message ? err.message : err), true);
            }
        });

        // ── Upload new photos for this day ──────────────────
        // Two-step flow:
        //   1) User picks file(s) → we open a metadata dialog with all
        //      five MANDATORY fields (Title, Category, Date, Place,
        //      Package). Defaults are pre-populated from the current
        //      package + day so the common case is one click, but the
        //      user MUST review them before upload starts.
        //   2) Once they hit "Upload", we feed each file through
        //      GalleryStore.uploadGalleryImage with the user-confirmed
        //      meta. Cancelling resets the file input.
        el.querySelector('.btn-day-upload').addEventListener('click', () => fileEl.click());
        fileEl.addEventListener('change', async () => {
            const files = Array.from(fileEl.files || []);
            if (!files.length) return;
            if (!window.GalleryStore || typeof window.GalleryStore.uploadGalleryImage !== 'function') {
                setStatus('Gallery uploader not available.', true);
                fileEl.value = '';
                return;
            }
            const pkg  = packagesData[pkgIdx];
            const dayN = packagesData[pkgIdx].days[dayIdx].day;
            // Smart defaults — these are pre-filled, but the dialog
            // forces the user to read/confirm before upload.
            const defaults = {
                title:      pkg.name + ' — Day ' + dayN,
                category:   '',
                date:       new Date().toISOString().slice(0, 10),
                place:      '',
                packageRef: pkg.id || pkg.name
            };

            try {
                const meta = await openDayUploadMetaDialog(defaults, files);
                if (!meta) {                  // user cancelled
                    fileEl.value = '';
                    setStatus('');
                    return;
                }
                for (let i = 0; i < files.length; i++) {
                    setStatus('Uploading ' + (i+1) + '/' + files.length + ': ' + files[i].name + '…');
                    const item = await window.GalleryStore.uploadGalleryImage(files[i], {
                        title:      files.length > 1 ? meta.title + ' (' + (i+1) + ')' : meta.title,
                        category:   meta.category,
                        date:       meta.date,
                        place:      meta.place,
                        packageRef: meta.packageRef,
                        order:      9999
                    });
                    // Cache + attach to day
                    if (!window._iteGalleryCache) window._iteGalleryCache = {};
                    window._iteGalleryCache[item.id] = item;
                    if (!Array.isArray(packagesData[pkgIdx].days[dayIdx].imageIds)) {
                        packagesData[pkgIdx].days[dayIdx].imageIds = [];
                    }
                    packagesData[pkgIdx].days[dayIdx].imageIds.push(item.id);
                }
                fileEl.value = '';
                setStatus('✓ Uploaded ' + files.length + ' photo(s). Click Save & Publish to keep the link.');
                refreshStrip();
            } catch (err) {
                console.error('Day-photo upload failed:', err);
                setStatus('Upload failed: ' + (err && err.message ? err.message : err), true);
                fileEl.value = '';
            }
        });

        // Initial paint
        refreshStrip();

        // Phase 2: wire the typed trip-blocks editor (MMT-style timeline).
        // Self-contained module in js/itinerary-blocks.js — mutates day.blocks directly.
        if (window.IteBlocks && typeof window.IteBlocks.wire === 'function') {
            window.IteBlocks.wire(el.querySelector('[data-day-blocks]'), day);
        }

        return el;
    }

    // ── Day-photo upload metadata dialog ────────────────────────
    // Pops a modal where the user MUST confirm/edit Title, Category,
    // Date, Place and Package before the per-day upload starts. The
    // five fields mirror the main Gallery upload form (same dropdown
    // values pulled from SettingsStore). Resolves to the meta object
    // when the user clicks Upload, or `null` if they cancel/close.
    function openDayUploadMetaDialog(defaults, files) {
        return new Promise((resolve) => {
            // Lazy-create the modal once
            let modal = document.getElementById('iteDayUploadModal');
            if (!modal) {
                modal = document.createElement('div');
                modal.id = 'iteDayUploadModal';
                modal.className = 'gal-edit-modal';
                // The itinerary overlay (.ite-overlay) sits at z-index 100000,
                // so the day-upload dialog MUST sit above it or it's invisible.
                // The gallery edit modal's default z-index of 1000 (from
                // css/gallery.css) hides it behind the overlay → the dialog
                // appears to "not open" even though .open is set. Force a
                // higher z-index right on the element so we don't have to
                // touch the shared CSS.
                modal.style.zIndex = '100002';
                modal.innerHTML = `
                    <div class="gal-edit-card" style="max-width:560px;">
                        <div class="gal-edit-head">
                            <h3>
                                <i class="fas fa-cloud-upload-alt"></i>
                                Photo details — required
                            </h3>
                            <button type="button" class="gal-edit-close" aria-label="Close"><i class="fas fa-times"></i></button>
                        </div>
                        <div class="gal-edit-body">
                            <p style="margin:0 0 .35rem;font-size:.86rem;color:#5a6877;line-height:1.5;">
                                These tags are required so the photos appear correctly in the public
                                gallery (year / place / package grouping). Defaults are pre-filled
                                from the package and day — review and edit if needed.
                            </p>
                            <p id="iteDayUploadFileNote" style="margin:0 0 .35rem;font-size:.82rem;color:#16a085;font-weight:600;"></p>
                            <label>Title <span class="agf-req" style="color:#e74c3c;">*</span>
                                <input type="text" data-f="title" placeholder="e.g. Day 2 — Havelock arrival">
                            </label>
                            <label>Category <span class="agf-req" style="color:#e74c3c;">*</span>
                                <select data-f="category" data-dropdown="category">
                                    <option value="">— Choose category —</option>
                                </select>
                            </label>
                            <div class="gal-edit-row2">
                                <label>Date <span class="agf-req" style="color:#e74c3c;">*</span>
                                    <input type="date" data-f="date">
                                </label>
                                <label>Place <span class="agf-req" style="color:#e74c3c;">*</span>
                                    <select data-f="place" data-dropdown="place">
                                        <option value="">— Choose place —</option>
                                    </select>
                                </label>
                            </div>
                            <label>Package <span class="agf-req" style="color:#e74c3c;">*</span>
                                <select data-f="packageRef" data-dropdown="package">
                                    <option value="">— Choose package —</option>
                                </select>
                            </label>
                            <div id="iteDayUploadError" style="display:none;color:#c0392b;font-size:.86rem;margin-top:.25rem;padding:.55rem .75rem;background:#fdedec;border-radius:6px;border:1px solid #f5b7b1;"></div>
                        </div>
                        <div class="gal-edit-foot">
                            <button type="button" class="gal-edit-cancel">Cancel</button>
                            <button type="button" class="gal-edit-save" data-action="upload">
                                <i class="fas fa-upload"></i> Upload
                            </button>
                        </div>
                    </div>
                `;
                document.body.appendChild(modal);
            }

            // Populate dropdowns from SettingsStore (admin-managed lists)
            if (typeof window.__populateGalleryDropdowns === 'function') {
                window.__populateGalleryDropdowns(modal);
            }

            // Pre-fill defaults
            const setVal = (f, v) => {
                const el = modal.querySelector('[data-f="' + f + '"]');
                if (el) el.value = (v == null ? '' : v);
            };
            setVal('title',      defaults.title);
            setVal('category',   defaults.category || '');
            setVal('date',       defaults.date);
            setVal('place',      defaults.place || '');
            setVal('packageRef', defaults.packageRef || '');

            // Show file count / names so the user knows what they're tagging
            const note = modal.querySelector('#iteDayUploadFileNote');
            if (note) {
                const fileNames = (files || []).map(f => f.name).slice(0, 3).join(', ');
                const more = (files || []).length > 3 ? ` (+${(files || []).length - 3} more)` : '';
                note.textContent = '📎 ' + (files || []).length + ' file(s): ' + fileNames + more;
            }

            // Hide any previous error
            const errEl = modal.querySelector('#iteDayUploadError');
            if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }

            // Wire close / cancel — clone to drop previous listeners
            function close(result) {
                modal.classList.remove('open');
                resolve(result);
            }
            const closeBtn  = modal.querySelector('.gal-edit-close');
            const cancelBtn = modal.querySelector('.gal-edit-cancel');
            const uploadBtn = modal.querySelector('[data-action="upload"]');
            const newClose  = closeBtn.cloneNode(true);
            const newCancel = cancelBtn.cloneNode(true);
            const newUpload = uploadBtn.cloneNode(true);
            closeBtn.parentNode.replaceChild(newClose,  closeBtn);
            cancelBtn.parentNode.replaceChild(newCancel, cancelBtn);
            uploadBtn.parentNode.replaceChild(newUpload, uploadBtn);

            newClose.addEventListener('click',  () => close(null));
            newCancel.addEventListener('click', () => close(null));
            modal.onclick = (e) => { if (e.target === modal) close(null); };

            newUpload.addEventListener('click', () => {
                const getVal = (f) => {
                    const el = modal.querySelector('[data-f="' + f + '"]');
                    return el ? String(el.value || '').trim() : '';
                };
                const meta = {
                    title:      getVal('title'),
                    category:   getVal('category'),
                    date:       getVal('date'),
                    place:      getVal('place'),
                    packageRef: getVal('packageRef')
                };
                // Validate — every field is mandatory
                const missing = [];
                if (!meta.title)      missing.push('Title');
                if (!meta.category)   missing.push('Category');
                if (!meta.date)       missing.push('Date');
                if (!meta.place)      missing.push('Place');
                if (!meta.packageRef) missing.push('Package');
                if (missing.length) {
                    if (errEl) {
                        errEl.style.display = 'block';
                        errEl.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Please fill: ' +
                            missing.map(m => '<strong>' + m + '</strong>').join(', ');
                    }
                    // Flash the first missing field
                    const map = { Title:'title', Category:'category', Date:'date', Place:'place', Package:'packageRef' };
                    const firstEl = modal.querySelector('[data-f="' + map[missing[0]] + '"]');
                    if (firstEl) {
                        firstEl.classList.add('agf-field-flash');
                        setTimeout(() => firstEl.classList.remove('agf-field-flash'), 1600);
                        try { firstEl.focus(); } catch (_) {}
                    }
                    return;
                }
                close(meta);
            });

            modal.classList.add('open');
            // Auto-focus title for quick edits
            setTimeout(() => {
                const t = modal.querySelector('[data-f="title"]');
                if (t) try { t.focus(); t.select && t.select(); } catch (_) {}
            }, 50);
        });
    }

    // ── Gallery cache + picker (used by per-day gallery) ────────
    // Caches every gallery doc by id so day-thumbs render instantly,
    // and powers the multi-select picker. One Firestore read per
    // editor session; subsequent picks are free.
    async function ensureGalleryCache() {
        if (window._iteGalleryCache && window._iteGalleryCacheLoaded) return;
        if (!window.GalleryStore || typeof window.GalleryStore.loadGalleryItems !== 'function') {
            throw new Error('GalleryStore not loaded');
        }
        const items = await window.GalleryStore.loadGalleryItems();
        window._iteGalleryCache = {};
        items.forEach(it => { window._iteGalleryCache[it.id] = it; });
        window._iteGalleryCacheLoaded = true;
    }

    function openGalleryPicker(pkgIdx, dayIdx, onDone) {
        // Lazy-create the modal once
        let modal = document.getElementById('iteGalleryPickerModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'iteGalleryPickerModal';
            modal.className = 'ite-gpicker-modal';
            modal.innerHTML = `
                <div class="ite-gpicker-card">
                    <div class="ite-gpicker-head">
                        <h3><i class="fas fa-images"></i> Pick photos for this day</h3>
                        <button type="button" class="ite-gpicker-close" aria-label="Close"><i class="fas fa-times"></i></button>
                    </div>
                    <div class="ite-gpicker-toolbar">
                        <input type="text" class="ite-gpicker-search" placeholder="Search by title, place, package, category…">
                        <span class="ite-gpicker-count">0 photos</span>
                    </div>
                    <div class="ite-gpicker-grid"></div>
                    <div class="ite-gpicker-foot">
                        <button type="button" class="ite-gpicker-cancel">Cancel</button>
                        <button type="button" class="ite-gpicker-save"><i class="fas fa-check"></i> Add Selected</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
            modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('open'); });
            modal.querySelector('.ite-gpicker-close').addEventListener('click', () => modal.classList.remove('open'));
            modal.querySelector('.ite-gpicker-cancel').addEventListener('click', () => modal.classList.remove('open'));
        }

        const grid = modal.querySelector('.ite-gpicker-grid');
        const search = modal.querySelector('.ite-gpicker-search');
        const countEl = modal.querySelector('.ite-gpicker-count');
        const saveBtn = modal.querySelector('.ite-gpicker-save');

        const allItems = Object.values(window._iteGalleryCache || {})
            .sort((a, b) => (a.order || 9999) - (b.order || 9999));
        const selected = new Set(packagesData[pkgIdx].days[dayIdx].imageIds || []);

        function renderGrid(filterText) {
            const q = (filterText || '').toLowerCase();
            const filtered = !q ? allItems : allItems.filter(it =>
                (it.title || '').toLowerCase().includes(q) ||
                (it.place || '').toLowerCase().includes(q) ||
                (it.packageRef || '').toLowerCase().includes(q) ||
                (it.category || '').toLowerCase().includes(q)
            );
            countEl.textContent = filtered.length + ' photo' + (filtered.length === 1 ? '' : 's');
            if (!filtered.length) {
                grid.innerHTML = '<p class="ite-gpicker-empty">No photos found. Upload some from the Gallery page first, or use the <strong>Upload</strong> button on this day.</p>';
                return;
            }
            grid.innerHTML = filtered.map(it => {
                const isOn = selected.has(it.id);
                const meta = [it.place, it.packageRef, it.category].filter(Boolean).join(' · ');
                return `
                <label class="ite-gpicker-tile ${isOn ? 'is-selected' : ''}" data-gid="${escHtml(it.id)}">
                    <input type="checkbox" ${isOn ? 'checked' : ''}>
                    <img src="${escHtml(it.thumbUrl || it.url)}" alt="${escHtml(it.title || '')}" loading="lazy">
                    <div class="ite-gpicker-tile-cap">
                        <strong>${escHtml(it.title || '(no title)')}</strong>
                        ${meta ? `<small>${escHtml(meta)}</small>` : ''}
                    </div>
                </label>`;
            }).join('');

            grid.querySelectorAll('.ite-gpicker-tile').forEach(tile => {
                const cb = tile.querySelector('input[type="checkbox"]');
                tile.addEventListener('click', e => {
                    if (e.target !== cb) {
                        e.preventDefault();
                        cb.checked = !cb.checked;
                    }
                    const gid = tile.dataset.gid;
                    if (cb.checked) selected.add(gid); else selected.delete(gid);
                    tile.classList.toggle('is-selected', cb.checked);
                });
            });
        }

        renderGrid('');
        search.value = '';
        search.oninput = () => renderGrid(search.value);

        // Save button — replace listener fresh each time
        const newSave = saveBtn.cloneNode(true);
        saveBtn.parentNode.replaceChild(newSave, saveBtn);
        newSave.addEventListener('click', () => {
            packagesData[pkgIdx].days[dayIdx].imageIds = Array.from(selected);
            modal.classList.remove('open');
            if (typeof onDone === 'function') onDone();
        });

        modal.classList.add('open');
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
                            <label>Highlights <small>(one per row)</small></label>
                            <div id="ite-highlights" class="ite-list-host"></div>
                        </div>
                        <div class="pkg-edit-row">
                            <label>Inclusions <small>(one per row)</small></label>
                            <div id="ite-inclusions" class="ite-list-host"></div>
                        </div>
                        <div class="pkg-edit-row">
                            <label>Exclusions <small>(one per row)</small></label>
                            <div id="ite-exclusions" class="ite-list-host"></div>
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

        // Wire the line-by-line list editors for Highlights / Inclusions /
        // Exclusions. Logic lives in js/itinerary-list-editors.js. Each
        // editor reads/writes directly to the corresponding pkg field.
        if (window.IteListEditors && typeof window.IteListEditors.wireStringList === 'function') {
            const wire = window.IteListEditors.wireStringList;
            wire(document.getElementById('ite-highlights'),
                () => packagesData[pkgIdx].highlights,
                (a) => { packagesData[pkgIdx].highlights = a; },
                { placeholder: 'e.g. Radhanagar Beach', addLabel: 'Add Highlight' });
            wire(document.getElementById('ite-inclusions'),
                () => packagesData[pkgIdx].inclusions,
                (a) => { packagesData[pkgIdx].inclusions = a; },
                { placeholder: 'e.g. Daily breakfast', addLabel: 'Add Inclusion' });
            wire(document.getElementById('ite-exclusions'),
                () => packagesData[pkgIdx].exclusions,
                (a) => { packagesData[pkgIdx].exclusions = a; },
                { placeholder: 'e.g. Airfare', addLabel: 'Add Exclusion' });
        }

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
        // Highlights / Inclusions / Exclusions are now wired by
        // IteListEditors.wireStringList above (line-by-line editor).
        // The legacy comma-separated input listeners have been removed.

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

        // Phase 1.2 — Category dropdown.
        // Allowed values mirror the public filter pills the user requested
        // in package_redesign_plan.md. Empty string = no category (treated
        // as "Standard" by the public renderer for back-compat).
        const PKG_CATEGORIES = ['Budget','Standard','Deluxe','Luxury','Royal','Honeymoon'];

        container.innerHTML = packagesData.map((pkg, idx) => `
            <div class="pkg-edit-card" data-idx="${idx}">
                <div class="pkg-edit-header">
                    <span class="pkg-edit-num">#${idx + 1}</span>
                    <label class="pkg-visible-toggle">
                        <input type="checkbox" ${pkg.visible !== false ? 'checked' : ''}
                            onchange="window._pkgUpdate(${idx},'visible',this.checked)">
                        <span>Visible</span>
                    </label>
                    <label class="pkg-visible-toggle ${pkg.soldOut ? 'is-soldout' : ''}">
                        <input type="checkbox" ${pkg.soldOut === true ? 'checked' : ''}
                            onchange="window._pkgUpdate(${idx},'soldOut',this.checked)">
                        <span>Sold&nbsp;Out</span>
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
                    <div class="pkg-edit-row pkg-edit-row-2col">
                        <div>
                            <label>Category</label>
                            <select class="pkg-input" onchange="window._pkgUpdate(${idx},'category',this.value)">
                                <option value="" ${!pkg.category ? 'selected' : ''}>— Choose —</option>
                                ${PKG_CATEGORIES.map(c => `<option value="${c}" ${pkg.category === c ? 'selected' : ''}>${c}</option>`).join('')}
                            </select>
                        </div>
                        <div>
                            <label>Image</label>
                            <select class="pkg-input" onchange="window._pkgUpdate(${idx},'image',this.value)">
                                ${SITE_IMAGES.map(img => `<option value="${img}" ${pkg.image===img?'selected':''}>${img.split('/').pop()}</option>`).join('')}
                            </select>
                        </div>
                    </div>
                    <div class="pkg-edit-row">
                        <label>Inclusions <small>(comma-separated)</small></label>
                        <input type="text" class="pkg-input" value="${escHtml((pkg.inclusions||[]).join(', '))}"
                            placeholder="e.g. Hotels, Ferries, Breakfast"
                            oninput="window._pkgUpdate(${idx},'inclusions',this.value.split(',').map(s=>s.trim()).filter(Boolean))">
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

    // ── Seed Sample Packages (10 curated Andaman trips) ────────
    // Adds these to whatever's already in Firestore; skips IDs that already exist.
    const SAMPLE_SEED_PACKAGES = [
        { id:'weekend',           name:'Weekend Andaman Quickie',      desc:"2N/3D | Port Blair only | Cellular Jail + Corbyn's Cove",                        price:9999,  rating:4.1, image:'images/neil1.jpg',  inclusions:['Hotel','Sightseeing','Breakfast'],                          visible:true },
        { id:'scuba',             name:'Scuba Diving Special',         desc:'5N/6D | Havelock + Neil | 4 Dives + PADI Certification',                          price:26999, rating:4.8, image:'images/neil2.jpg',  inclusions:['PADI Course','4 Boat Dives','Hotels','Ferries'],            visible:true },
        { id:'family',            name:'Family Andaman Joy',           desc:'6N/7D | Port Blair + Havelock + Neil | Family Rooms + Activities',               price:23999, rating:4.7, image:'images/beach2.jpg', inclusions:['Family Rooms','All Meals','Glass-bottom Boat','Sightseeing'],visible:true },
        { id:'adventure',         name:'Adventure Andaman Pro',        desc:'7N/8D | All Islands | Scuba + Sea-walk + Trekking + Kayaking',                    price:32999, rating:4.7, image:'images/neil4.jpg',  inclusions:['Scuba Dive','Sea Walk','Sea Kayaking','Premium Hotels'],    visible:true },
        { id:'ross-northbay',     name:'Ross & North Bay Day Tour',    desc:'1 Day | Port Blair Day Trip | Ross Island + North Bay Snorkeling',               price:2499,  rating:4.4, image:'images/ross2.jpg',  inclusions:['Boat Transfers','Snorkeling','Glass-bottom Boat'],          visible:true },
        { id:'baratang',          name:'Baratang Limestone Adventure', desc:'1 Day | Limestone Caves + Mud Volcano + Mangrove Creek',                          price:3499,  rating:4.3, image:'images/beach1.jpg', inclusions:['AC Transport','Boat Ride','Forest Permit','Lunch'],         visible:true },
        { id:'diglipur',          name:'Diglipur Explorer',            desc:'8N/9D | Port Blair + Havelock + Diglipur (North Andaman) | Saddle Peak',          price:36999, rating:4.6, image:'images/neil6.jpg',  inclusions:['Hotels','Ferries','Saddle Peak Trek','Turtle Beach Visit'], visible:true },
        { id:'premium-honeymoon', name:'Premium Honeymoon Voyage',     desc:'7N/8D | Havelock 5★ Beach Villa + Neil + Private Yacht Sunset',                    price:44999, rating:4.9, image:'images/beach3.jpg', inclusions:['5★ Beach Villa','Private Yacht','Couple Spa','Photoshoot','All Meals'], visible:true },
        { id:'solo',              name:'Solo Traveller Backpack',      desc:'5N/6D | Hostels + Group Tours + Flexible Itinerary',                              price:13999, rating:4.4, image:'images/neil3.jpg',  inclusions:['Hostel Beds','Ferries','Group Sightseeing'],                visible:true },
        { id:'senior',            name:'Senior-Friendly Andaman',      desc:'5N/6D | Slower Pace | Ground-floor Rooms + Private Cars + Doctor on Call',        price:27999, rating:4.7, image:'images/ross3.jpg',  inclusions:['Ground-floor Rooms','Private AC Cars','Soft Diet','Medical Backup'], visible:true }
    ];

    const seedPackagesBtn = document.getElementById('seedPackagesBtn');
    if (seedPackagesBtn) {
        seedPackagesBtn.addEventListener('click', async () => {
            const status = document.getElementById('publishStatus');
            const existingIds = new Set((packagesData || []).map(p => p.id));
            const toAdd = SAMPLE_SEED_PACKAGES.filter(p => !existingIds.has(p.id));

            if (!toAdd.length) {
                if (status) {
                    status.style.display = 'block';
                    status.className = 'publish-status publish-info';
                    status.innerHTML = 'ℹ️ All 10 sample packages are already in your catalogue. Nothing to add.';
                }
                return;
            }

            const ok = confirm(
                `This will add ${toAdd.length} sample Andaman package${toAdd.length === 1 ? '' : 's'} ` +
                `to your Firestore catalogue and publish immediately.\n\n` +
                toAdd.map(p => `• ${p.name} — ₹${p.price.toLocaleString()}`).join('\n') +
                '\n\nProceed?'
            );
            if (!ok) return;

            // Append to in-memory array, re-render, and reuse the existing publish flow
            packagesData = (packagesData || []).concat(toAdd);
            renderPackageEditorCards();

            if (status) {
                status.style.display = 'block';
                status.className = 'publish-status publish-info';
                status.innerHTML = `⏳ Adding ${toAdd.length} package${toAdd.length === 1 ? '' : 's'} and publishing to Firestore…`;
            }

            try {
                await window.saveAndPublishPackages();
            } catch (err) {
                console.error('Seed publish failed:', err);
            }
        });
    }

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
            const result = await window.PackagesStore.publish(packagesData);
            status.className = 'publish-status publish-success';
            // Staff gets a slightly different message — they can update,
            // not create or delete, so call out exactly what landed.
            if (result && result.role === 'staff') {
                const skippedNote = result.skipped
                    ? ' ' + result.skipped + ' new package(s) were skipped — ask an admin to add them.'
                    : '';
                status.innerHTML =
                    '✅ Saved! ' + result.count + ' package(s) updated and live globally.' + skippedNote;
            } else {
                status.innerHTML =
                    '✅ Published! Changes are live globally. Other devices will see them on next page load.';
            }
            btn.innerHTML = '<i class="fas fa-check"></i> Saved!';
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
            tbody.innerHTML = `<tr><td colspan="8" class="table-empty" style="color:#a04000;">
                ⚠️ ${escHtml(_customerError)}<br>
                <small style="color:#888;">
                    Most likely fix: open <a href="https://console.firebase.google.com/project/andaman-b886d/firestore/rules" target="_blank">Firestore Rules</a>
                    and publish the latest <code>firestore.rules</code> from the repo.
                </small>
            </td></tr>`;
            return;
        }

        if (list.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" class="table-empty">No customers found</td></tr>';
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

            // Per-user DISCOUNT badge (admin-configured, applied at checkout).
            // Replaces the old "advance rate" override — the advance is now a
            // flat per-head amount and is no longer customer-overridable.
            const hasDiscount = (typeof u.discountPercent === 'number' && isFinite(u.discountPercent) && u.discountPercent > 0);
            const discBtnLabel = hasDiscount ? (u.discountPercent + '% off') : 'Discount';
            const discBtnTitle = hasDiscount
                ? 'This customer gets ' + u.discountPercent + '% discount on every booking. Click to change or clear.'
                : 'Set a personal discount % for this customer (auto-applied at checkout).';
            const discBtnStyle = hasDiscount
                ? 'background:#fff5e6;color:#a04000;border:1px solid #f1c27d;'
                : '';
            const discCurrentVal = hasDiscount ? u.discountPercent : '';

            return `
                <tr>
                    <td title="${u.uid}">#${String(u.uid || '').slice(-6)}</td>
                    <td>${u.username || '-'}${u.fullName ? `<br><small style="color:#888;">${u.fullName}</small>` : ''}</td>
                    <td>${u.email || '-'}</td>
                    <td>${u.phone ? `<a href="tel:${u.phone}" style="color:#0d7a8a;text-decoration:none;">${u.phone}</a>` : '<span style="color:#bbb;">—</span>'}</td>
                    <td>${userBookings.length}</td>
                    <td>${formatCurrency(totalSpent)}</td>
                    <td>${statusBadge}</td>
                    <td style="white-space:nowrap;">
                        <button class="action-btn" title="Send password reset email"
                                onclick="window._adminResetPassword('${safeEmail}')">
                            <i class="fas fa-key"></i> Reset
                        </button>
                        <button class="action-btn"
                                style="${discBtnStyle}"
                                title="${discBtnTitle}"
                                onclick="window._adminPromptCustomerDiscount('${u.uid}', '${discCurrentVal}')">
                            <i class="fas fa-tags"></i> ${discBtnLabel}
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
        // Update Overview count too (uses _allCustomers when available)
        try { renderOverview(); } catch (_) {}
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
            const colors = ['#0d7a8a', '#3498db', '#9b59b6', '#e74c3c', '#f39c12'];

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

    // ── Refund Dialog (custom modal) ────────────────────────────
    // Replaces the default window.prompt() with a proper styled modal
    // so the booking ref / customer / slab info doesn't leak into the
    // browser-chrome dialog. Same behaviour: returns the chosen amount
    // (number) on OK, or null on Cancel.
    //
    // Layout:
    //   ┌────────────────────────────────────────────────┐
    //   │  💸 Issue Refund                          [X] │
    //   ├────────────────────────────────────────────────┤
    //   │  Booking: BTT752243472R                       │
    //   │  Customer: <name>                             │
    //   │  Advance paid: ₹22,000                        │
    //   │  Suggested (slab): ₹0  ⚠ goodwill only       │
    //   │                                                │
    //   │  Refund amount (₹)                             │
    //   │  ┌────────────────────────────┐               │
    //   │  │ 22000                      │               │
    //   │  └────────────────────────────┘               │
    //   │  Refund goes to original Razorpay payment.    │
    //   ├────────────────────────────────────────────────┤
    //   │                    [Cancel]  [💸 Refund ₹X]   │
    //   └────────────────────────────────────────────────┘
    function openRefundDialog(booking, opts) {
        opts = opts || {};
        const suggested = Number(opts.suggested) || 0;
        const advance   = Number(opts.advance)   || 0;
        const ref       = booking.booking_ref || booking.id || '—';
        const custName  = (booking.traveler && booking.traveler.name) ||
                          booking.customerName || booking.fullName ||
                          (booking.userId ? '(user ' + String(booking.userId).slice(-6) + ')' : '—');
        const promptDefault = suggested > 0 ? suggested : advance;

        // Lazy-create the modal once. We mount it on document.body so it
        // sits above the dashboard topbar (z-index 1000+).
        let modal = document.getElementById('refundDialogModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'refundDialogModal';
            // Reuse the inbox-compose-modal CSS class for its overlay
            // styling — it's already defined inline in dashboard.html
            // and gives us a clean white card on a dimmed backdrop.
            modal.className = 'inbox-compose-modal';
            modal.innerHTML = `
                <div class="ic-card" style="max-width:480px;">
                    <div class="ic-head">
                        <h3><i class="fas fa-undo-alt"></i> Issue Refund</h3>
                        <button type="button" class="ic-close" aria-label="Close"><i class="fas fa-times"></i></button>
                    </div>
                    <div class="ic-body" id="refundDialogBody"></div>
                    <div class="ic-foot">
                        <button type="button" class="ic-cancel">Cancel</button>
                        <button type="button" class="ic-send" data-action="refund"><i class="fas fa-undo-alt"></i> Refund</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
        }

        // Build/refresh body each open so the booking-specific info is current.
        const body = modal.querySelector('#refundDialogBody');
        const slabRow = suggested > 0
            ? `<div class="rd-row"><span class="rd-k">Slab refund</span>
                 <span class="rd-v rd-good">${formatCurrency(suggested)}</span></div>`
            : `<div class="rd-row"><span class="rd-k">Slab refund</span>
                 <span class="rd-v rd-warn">₹0 — goodwill / manual only</span></div>`;
        body.innerHTML = `
            <div class="rd-summary">
                <div class="rd-row"><span class="rd-k">Booking ref</span>
                    <span class="rd-v"><code>${escHtml(ref)}</code></span></div>
                <div class="rd-row"><span class="rd-k">Customer</span>
                    <span class="rd-v">${escHtml(custName)}</span></div>
                <div class="rd-row"><span class="rd-k">Advance paid</span>
                    <span class="rd-v"><strong>${formatCurrency(advance)}</strong></span></div>
                ${slabRow}
            </div>
            <label class="rd-amount-label">
                Refund amount (₹) <span style="color:#999;font-weight:400;">— max ${formatCurrency(advance)}</span>
                <div class="rd-amount-input-wrap">
                    <span class="rd-rupee">₹</span>
                    <input type="number" id="refundDialogAmount"
                           min="0" max="${advance}" step="1"
                           value="${promptDefault}"
                           inputmode="numeric"
                           autocomplete="off">
                </div>
                <small id="refundDialogHint" style="color:#5a6877;font-size:.78rem;margin-top:.3rem;display:block;">
                    Refund goes to the original Razorpay payment method.
                    Enter <strong>0</strong> to close out the booking with no refund (auto-settle).
                </small>
            </label>
            <div id="refundDialogError" class="rd-error" style="display:none;"></div>
        `;

        // Inject scoped styles once. Kept inline so this stays a
        // single-file change — no separate CSS edit needed.
        if (!document.getElementById('refundDialogStyles')) {
            const styles = document.createElement('style');
            styles.id = 'refundDialogStyles';
            styles.textContent = `
                #refundDialogModal .rd-summary {
                    background: #f7fafb;
                    border: 1px solid #e3e8ef;
                    border-radius: 10px;
                    padding: .85rem 1rem;
                    margin-bottom: 1rem;
                }
                #refundDialogModal .rd-row {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    gap: .75rem;
                    padding: .25rem 0;
                    font-size: .9rem;
                }
                #refundDialogModal .rd-row + .rd-row {
                    border-top: 1px dashed #e3e8ef;
                    padding-top: .35rem;
                    margin-top: .15rem;
                }
                #refundDialogModal .rd-k {
                    color: #5a6877;
                    font-weight: 500;
                    font-size: .82rem;
                    text-transform: uppercase;
                    letter-spacing: .03em;
                }
                #refundDialogModal .rd-v {
                    color: #1c2b48;
                    font-weight: 600;
                    text-align: right;
                }
                #refundDialogModal .rd-v code {
                    background: #fff;
                    padding: .15rem .45rem;
                    border-radius: 4px;
                    border: 1px solid #d6dfe5;
                    font-size: .82rem;
                }
                #refundDialogModal .rd-good { color: #0d7a8a; }
                #refundDialogModal .rd-warn { color: #a04000; }
                #refundDialogModal .rd-amount-label {
                    display: block;
                    font-size: .82rem;
                    font-weight: 600;
                    color: #5a6877;
                    text-transform: uppercase;
                    letter-spacing: .03em;
                }
                #refundDialogModal .rd-amount-input-wrap {
                    display: flex;
                    align-items: stretch;
                    margin-top: .4rem;
                    border: 1.5px solid #cfd9df;
                    border-radius: 10px;
                    background: #fff;
                    overflow: hidden;
                    transition: border-color .15s, box-shadow .15s;
                }
                #refundDialogModal .rd-amount-input-wrap:focus-within {
                    border-color: #0d7a8a;
                    box-shadow: 0 0 0 3px rgba(13,122,138,.18);
                }
                #refundDialogModal .rd-rupee {
                    background: #f7fafb;
                    border-right: 1px solid #e3e8ef;
                    padding: .65rem .9rem;
                    font-weight: 700;
                    font-size: 1.1rem;
                    color: #5a6877;
                    display: flex;
                    align-items: center;
                }
                #refundDialogModal #refundDialogAmount {
                    flex: 1;
                    border: 0;
                    padding: .65rem .85rem;
                    font: inherit;
                    font-size: 1.05rem;
                    font-weight: 700;
                    color: #1c2b48;
                    background: transparent;
                    outline: none;
                    -moz-appearance: textfield;
                }
                #refundDialogModal #refundDialogAmount::-webkit-outer-spin-button,
                #refundDialogModal #refundDialogAmount::-webkit-inner-spin-button {
                    -webkit-appearance: none;
                    margin: 0;
                }
                #refundDialogModal .rd-error {
                    margin-top: .65rem;
                    padding: .55rem .75rem;
                    background: #fdedec;
                    border: 1px solid #f5b7b1;
                    color: #c0392b;
                    font-size: .85rem;
                    border-radius: 8px;
                }
                #refundDialogModal .ic-send i { margin-right: .25rem; }
            `;
            document.head.appendChild(styles);
        }

        return new Promise((resolve) => {
            const input   = modal.querySelector('#refundDialogAmount');
            const errEl   = modal.querySelector('#refundDialogError');
            const sendBtn = modal.querySelector('[data-action="refund"]');
            const closeBtn  = modal.querySelector('.ic-close');
            const cancelBtn = modal.querySelector('.ic-cancel');

            // Update button label as the admin types so they can see the
            // exact amount they're about to refund. Special-case 0 →
            // "Mark settled (no refund)" so the admin knows clicking will
            // simply close out the booking without sending money back.
            function syncSendBtn() {
                const n = Number(input.value);
                const safe = (isFinite(n) && n >= 0) ? n : 0;
                if (safe === 0) {
                    sendBtn.innerHTML = '<i class="fas fa-check-circle"></i> Mark settled (no refund)';
                } else {
                    sendBtn.innerHTML = '<i class="fas fa-undo-alt"></i> Refund ' + formatCurrency(safe);
                }
            }

            function showError(msg) {
                if (!errEl) return;
                errEl.style.display = 'block';
                errEl.innerHTML = '<i class="fas fa-exclamation-triangle"></i> ' + msg;
            }
            function clearError() {
                if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
            }

            function close(result) {
                modal.classList.remove('open');
                // Drop transient listeners so the next open starts clean.
                input.oninput = null;
                document.removeEventListener('keydown', onKey);
                resolve(result);
            }

            function submit() {
                clearError();
                const raw = String(input.value || '').trim();
                if (!raw) {
                    showError('Please enter a refund amount (0 to settle without refund).');
                    input.focus();
                    return;
                }
                const n = Number(raw.replace(/[^0-9.]/g, ''));
                if (!isFinite(n) || n < 0) {
                    showError('Refund amount cannot be negative. Enter 0 to close out the booking with no refund.');
                    input.focus();
                    return;
                }
                if (n > advance) {
                    showError('Refund cannot exceed the advance paid (' +
                        formatCurrency(advance) + ').');
                    input.focus();
                    return;
                }
                // All good — resolve with the validated amount (0 = auto-settle / no refund).
                close(Math.round(n));
            }

            function onKey(e) {
                if (e.key === 'Escape') { e.preventDefault(); close(null); }
                if (e.key === 'Enter')  { e.preventDefault(); submit();   }
            }

            // Clone+replace handlers each open so we never stack them.
            const newClose  = closeBtn.cloneNode(true);
            const newCancel = cancelBtn.cloneNode(true);
            const newSend   = sendBtn.cloneNode(true);
            closeBtn.parentNode.replaceChild(newClose,  closeBtn);
            cancelBtn.parentNode.replaceChild(newCancel, cancelBtn);
            sendBtn.parentNode.replaceChild(newSend,  sendBtn);

            newClose.addEventListener('click',  () => close(null));
            newCancel.addEventListener('click', () => close(null));
            newSend.addEventListener('click',   submit);
            modal.onclick = (e) => { if (e.target === modal) close(null); };

            // Refresh references to the new (replaced) input/sendBtn
            const inputRef   = modal.querySelector('#refundDialogAmount');
            const sendBtnRef = modal.querySelector('[data-action="refund"]');
            inputRef.oninput = function () {
                clearError();
                const n = Number(inputRef.value);
                const safe = (isFinite(n) && n >= 0) ? n : 0;
                if (safe === 0) {
                    sendBtnRef.innerHTML = '<i class="fas fa-check-circle"></i> Mark settled (no refund)';
                } else {
                    sendBtnRef.innerHTML = '<i class="fas fa-undo-alt"></i> Refund ' + formatCurrency(safe);
                }
            };
            inputRef.oninput();   // initial paint of button label
            document.addEventListener('keydown', onKey);

            modal.classList.add('open');
            // Auto-focus the amount field and select its contents so the
            // admin can just type a new number to override.
            setTimeout(() => {
                try { inputRef.focus(); inputRef.select(); } catch (_) {}
            }, 60);
        });
    }

    // ── Refresh All ─────────────────────────────────────────────
    // DB.bookings is the union of localStorage (legacy + admin-seeded
    // test bookings) and the Firestore bookings collection (real
    // customer bookings, including Razorpay test-mode runs).
    // DB.firestoreBookings is the cached Firestore list — we only re-pull
    // it when the admin clicks "Refresh from Firestore" or the page loads,
    // to avoid hammering the free-tier read budget on every storage event.
    function refreshAll() {
        // Reload data from localStorage
        DB.users = JSON.parse(localStorage.getItem('users') || '[]');
        const ls = JSON.parse(localStorage.getItem('bookings') || '[]');
        DB.bookings = mergeBookingsForDashboard(ls, DB.firestoreBookings || []);

        renderOverview();
        renderAllBookings(
            bookingFilter ? bookingFilter.value : 'all',
            bookingSearch ? bookingSearch.value : ''
        );
        renderPackages();
        renderCustomers(customerSearch ? customerSearch.value : '');
        renderRevenue();
        renderOverviewUnreadInbox();
    }

    // ── Pull Firestore bookings on page load ────────────────────
    // This is what makes real Razorpay test-mode bookings (made by
    // customers from /checkout) actually appear in the admin's
    // "All Bookings" table — and therefore show the Refund button.
    // Wrapped in its own async closure so the rest of the dashboard
    // renders synchronously from localStorage first (instant paint),
    // then upgrades the table once Firestore responds (a second or two later).
    async function refreshFirestoreBookings(opts) {
        opts = opts || {};
        const fs = await loadFirestoreBookings();
        DB.firestoreBookings = fs;
        refreshAll();
        if (opts.toast && window.Toast) {
            const live = (fs || []).filter(b => !/^TEST-/i.test(String(b.id || ''))).length;
            window.Toast.success('Pulled ' + (fs || []).length + ' bookings from Firestore (' + live + ' live, ' + ((fs || []).length - live) + ' test).');
        }
    }

    // Initial render — fast path from localStorage
    refreshAll();
    // Then upgrade with Firestore data (admin reads ALL bookings per rules).
    refreshFirestoreBookings();
    // Also fetch customers from Firestore once on load (so the count and
    // table are ready by the time the user clicks the Customers tab).
    if (typeof refreshCustomers === 'function') {
        refreshCustomers();
    }

    // ── "Refresh from Firestore" button — wired dynamically so we
    // can drop it into the Bookings toolbar without touching the
    // dashboard.html markup. The button sits next to the existing
    // "Seed Test Bookings" / "Clear Bookings" admin controls.
    (function injectRefreshFsBtn() {
        const seedBtn = document.getElementById('seedFakeBookingsBtn');
        if (!seedBtn || !seedBtn.parentNode) return;
        // Don't add twice (HMR / re-init guard)
        if (document.getElementById('refreshFsBookingsBtn')) return;
        const btn = document.createElement('button');
        btn.id = 'refreshFsBookingsBtn';
        btn.className = 'btn-add-package';
        btn.style.background = '#16a085';
        btn.title = 'Re-pull every booking from the Firestore bookings/* collection (admin only).';
        btn.innerHTML = '<i class="fas fa-sync-alt"></i> Refresh';
        btn.addEventListener('click', async () => {
            const orig = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading…';
            try {
                await refreshFirestoreBookings({ toast: true });
            } catch (e) {
                if (window.Toast) window.Toast.error('Failed to load bookings: ' + (e && e.message));
            } finally {
                btn.disabled = false;
                btn.innerHTML = orig;
            }
        });
        // Insert before the "Seed Test Bookings" button so it reads:
        // [Refresh from Firestore]  [Seed Test Bookings]  [Clear Bookings]
        seedBtn.parentNode.insertBefore(btn, seedBtn);
    })();

    // ── Bookings split: draggable + responsive (mirrors inbox) ─
    // Same machinery as initResizableSplit() in js/inbox-receiver.js,
    // but for #bookingsSplit / #bookingsDivider. The list-pane width is
    // driven by the --inbox-list-w CSS variable on the split element
    // (default 70 % set inline in dashboard.html). Drag the divider
    // to resize, double-click to reset, ←/→ keys to nudge, all
    // persisted in localStorage under 'bookingsSplitRatio'.
    // Below 980 px the inbox-split rule auto-collapses to a single
    // column; we don't need to do anything extra for mobile.
    (function initBookingsResizableSplit() {
        const split   = document.getElementById('bookingsSplit');
        const divider = document.getElementById('bookingsDivider');
        if (!split || !divider) return;

        const STORAGE_KEY = 'bookingsSplitRatio';
        const MIN_PCT = 25;   // never shrink the list below 25% — it has 11 columns
        const MAX_PCT = 92;   // and never blow the reader away entirely
        const DEFAULT_PCT = 70;

        function applyPct(pct) {
            const clamped = Math.max(MIN_PCT, Math.min(MAX_PCT, pct));
            split.style.setProperty('--inbox-list-w', clamped.toFixed(2) + '%');
            return clamped;
        }

        // Restore saved ratio on init (or 70% default).
        let saved = parseFloat(localStorage.getItem(STORAGE_KEY) || '');
        if (!isFinite(saved) || saved < MIN_PCT || saved > MAX_PCT) saved = DEFAULT_PCT;
        applyPct(saved);

        let dragging = false;
        function onDown(ev) {
            ev.preventDefault();
            dragging = true;
            divider.classList.add('active');
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
        }
        function onMove(ev) {
            if (!dragging) return;
            const rect = split.getBoundingClientRect();
            if (!rect.width) return;
            const x = (ev.touches ? ev.touches[0].clientX : ev.clientX) - rect.left;
            applyPct((x / rect.width) * 100);
        }
        function onUp() {
            if (!dragging) return;
            dragging = false;
            divider.classList.remove('active');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            const num = parseFloat(split.style.getPropertyValue('--inbox-list-w'));
            if (isFinite(num)) {
                try { localStorage.setItem(STORAGE_KEY, String(num)); } catch (_) {}
            }
        }

        divider.addEventListener('mousedown',  onDown);
        divider.addEventListener('touchstart', onDown, { passive: false });
        document.addEventListener('mousemove', onMove);
        document.addEventListener('touchmove', onMove, { passive: false });
        document.addEventListener('mouseup',   onUp);
        document.addEventListener('touchend',  onUp);

        // Double-click to reset to default 70 %
        divider.addEventListener('dblclick', function () {
            applyPct(DEFAULT_PCT);
            try { localStorage.setItem(STORAGE_KEY, String(DEFAULT_PCT)); } catch (_) {}
        });
        // Keyboard: ←/→ nudge by 2 % when divider is focused
        divider.addEventListener('keydown', function (ev) {
            if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
            ev.preventDefault();
            const cur  = parseFloat(split.style.getPropertyValue('--inbox-list-w')) || DEFAULT_PCT;
            const next = ev.key === 'ArrowLeft' ? cur - 2 : cur + 2;
            const final = applyPct(next);
            try { localStorage.setItem(STORAGE_KEY, String(final)); } catch (_) {}
        });
    })();

    // ── Site Settings (Firestore-backed) ────────────────────────
    const settingsToggle = document.getElementById('paymentsEnabledToggle');
    const settingsMessage = document.getElementById('paymentsDisabledMessage');
    const settingsCurrentInfo = document.getElementById('settingsCurrentInfo');
    const saveSettingsBtn = document.getElementById('saveSettingsBtn');
    const settingsStatus = document.getElementById('settingsStatus');

    async function loadSiteSettings() {
        if (!window.SettingsStore) return;
        try {
            const s = await window.SettingsStore.load();
            if (settingsToggle) settingsToggle.checked = s.paymentsEnabled !== false;
            if (settingsMessage) settingsMessage.value = s.paymentsDisabledMessage || '';
            // Advance / commission rate
            const advRateInput = document.getElementById('advanceRateInput');
            const advRateInfo  = document.getElementById('advanceRateInfo');
            if (advRateInput) {
                const rate = (typeof s.advanceRate === 'number' && isFinite(s.advanceRate)) ? s.advanceRate : 5;
                advRateInput.value = rate;
                if (advRateInfo) {
                    advRateInfo.textContent = 'Current global rate: ' + rate + '%';
                    advRateInfo.style.color = '#0a5a68';
                }
            }
            if (settingsCurrentInfo) {
                settingsCurrentInfo.textContent = s.paymentsEnabled === false
                    ? '⚠️ Online payments are currently DISABLED on the live site.'
                    : '✅ Online payments are LIVE.';
                settingsCurrentInfo.style.color = s.paymentsEnabled === false ? '#c0392b' : '#0a5a68';
            }
        } catch (e) {
            console.warn('Could not load settings:', e);
        }
    }
    loadSiteSettings();

    if (saveSettingsBtn) {
        saveSettingsBtn.addEventListener('click', async () => {
            if (!window.SettingsStore) {
                alert('Settings store not loaded. Refresh the page.');
                return;
            }
            saveSettingsBtn.disabled = true;
            saveSettingsBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';
            settingsStatus.style.display = 'block';
            settingsStatus.className = 'publish-status publish-info';
            settingsStatus.innerHTML = '⏳ Saving settings to Firebase…';

            try {
                const patch = {
                    paymentsEnabled: !!(settingsToggle && settingsToggle.checked),
                    paymentsDisabledMessage: (settingsMessage && settingsMessage.value || '').trim()
                };
                await window.SettingsStore.save(patch);
                settingsStatus.className = 'publish-status publish-success';
                settingsStatus.innerHTML = patch.paymentsEnabled
                    ? '✅ Settings saved. Online payments are now LIVE.'
                    : '✅ Settings saved. Online payments are now DISABLED — visitors will see the call-to-book CTA instead.';
                if (settingsCurrentInfo) {
                    settingsCurrentInfo.textContent = patch.paymentsEnabled
                        ? '✅ Online payments are LIVE.'
                        : '⚠️ Online payments are currently DISABLED on the live site.';
                    settingsCurrentInfo.style.color = patch.paymentsEnabled ? '#0a5a68' : '#c0392b';
                }
            } catch (err) {
                settingsStatus.className = 'publish-status publish-error';
                settingsStatus.innerHTML = '❌ ' + (err.message || 'Failed to save settings.');
            } finally {
                setTimeout(() => {
                    saveSettingsBtn.disabled = false;
                    saveSettingsBtn.innerHTML = '<i class="fas fa-save"></i> Save Settings';
                }, 2000);
            }
        });
    }

    // ── Save Advance Rate (global %) ────────────────────────────
    const saveAdvanceRateBtn = document.getElementById('saveAdvanceRateBtn');
    if (saveAdvanceRateBtn) {
        saveAdvanceRateBtn.addEventListener('click', async () => {
            const input = document.getElementById('advanceRateInput');
            const info  = document.getElementById('advanceRateInfo');
            if (!window.SettingsStore || !input) {
                alert('Settings store not loaded. Refresh the page.');
                return;
            }
            const n = Number(input.value);
            if (!isFinite(n) || n < 0 || n > 100) {
                if (info) {
                    info.textContent = '❌ Enter a number between 0 and 100.';
                    info.style.color = '#c0392b';
                }
                return;
            }
            saveAdvanceRateBtn.disabled = true;
            saveAdvanceRateBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';
            try {
                await window.SettingsStore.save({ advanceRate: n });
                if (info) {
                    info.textContent = '✅ Saved. New global advance rate: ' + n + '%';
                    info.style.color = '#0a5a68';
                }
                if (window.Toast) window.Toast.success('Advance rate updated to ' + n + '%');
            } catch (err) {
                if (info) {
                    info.textContent = '❌ ' + (err.message || 'Failed to save.');
                    info.style.color = '#c0392b';
                }
            } finally {
                setTimeout(() => {
                    saveAdvanceRateBtn.disabled = false;
                    saveAdvanceRateBtn.innerHTML = '<i class="fas fa-save"></i> Save Advance Rate';
                }, 1500);
            }
        });
    }

    // ── Per-customer DISCOUNT (Customers tab) ──────────
    // Admins can set a percentage discount that gets auto-applied at
    // checkout for this specific customer (loyalty / VIP / corporate).
    window._adminPromptCustomerDiscount = async function (uid, currentValue) {
        if (!uid) return;
        const cur = (currentValue !== undefined && currentValue !== null && currentValue !== '')
            ? String(currentValue) : '';
        const input = prompt(
            'Set personal discount (%) for this customer.\n\n' +
            '• Enter a number between 0 and 100. Example: 10 = 10% off every booking.\n' +
            '• Leave blank or enter "0" to remove the discount.\n' +
            '• Discount is auto-applied at checkout, on top of any coupon code.',
            cur
        );
        if (input === null) return; // cancelled
        const trimmed = String(input).trim();
        let valueToSave = null;
        if (trimmed !== '' && trimmed !== '0') {
            const n = Number(trimmed);
            if (!isFinite(n) || n < 0 || n > 100) {
                alert('❌ Please enter a number between 0 and 100, or leave blank to clear.');
                return;
            }
            if (n > 0) valueToSave = n;
        }
        try {
            await window.UsersStore.adminSetUserDiscount(uid, valueToSave);
            if (window.Toast) {
                window.Toast.success(valueToSave === null
                    ? 'Discount cleared for this customer.'
                    : 'Customer discount set to ' + valueToSave + '%. It will auto-apply at checkout.');
            }
            await refreshCustomers();
        } catch (err) {
            alert('❌ ' + (err.message || 'Failed to update discount.'));
        }
    };

    // Backwards-compat: the old "Adv: %" button was renamed to a per-customer
    // discount in 2026 because the booking advance is now a flat per-head
    // amount (₹6,000 / ₹11,000) and is no longer customer-overridable. If
    // any cached HTML still calls _adminPromptAdvanceRate, route it to the
    // new discount prompt so it doesn't throw a ReferenceError.
    window._adminPromptAdvanceRate = function (uid, currentValue) {
        return window._adminPromptCustomerDiscount(uid, currentValue);
    };

    // ── Developer Console Lock toggle (Firestore-backed) ─────────
    const consoleLockToggle = document.getElementById('consoleLockToggle');
    const saveConsoleLockBtn = document.getElementById('saveConsoleLockBtn');
    const consoleLockInfo = document.getElementById('consoleLockInfo');

    async function loadConsoleLockSetting() {
        if (!window.SettingsStore) return;
        try {
            const s = await window.SettingsStore.load();
            const on = s.consoleLockEnabled !== false; // default true
            if (consoleLockToggle) consoleLockToggle.checked = on;
            if (consoleLockInfo) {
                consoleLockInfo.textContent = on
                    ? '🔒 Console lock is ON for non-admin visitors. Admins are always exempt.'
                    : '🔓 Console lock is OFF — anyone can use DevTools right now.';
                consoleLockInfo.style.color = on ? '#0a5a68' : '#c0392b';
            }
        } catch (e) {
            console.warn('Could not load console-lock setting:', e);
        }
    }
    loadConsoleLockSetting();

    if (saveConsoleLockBtn) {
        saveConsoleLockBtn.addEventListener('click', async () => {
            if (!window.SettingsStore) {
                if (window.Toast) window.Toast.error('Settings store not loaded. Refresh the page.');
                else alert('Settings store not loaded. Refresh the page.');
                return;
            }
            saveConsoleLockBtn.disabled = true;
            saveConsoleLockBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';
            try {
                const on = !!(consoleLockToggle && consoleLockToggle.checked);
                await window.SettingsStore.save({ consoleLockEnabled: on });
                if (consoleLockInfo) {
                    consoleLockInfo.textContent = on
                        ? '🔒 Console lock is ON for non-admin visitors. Admins are always exempt.'
                        : '🔓 Console lock is OFF — anyone can use DevTools right now.';
                    consoleLockInfo.style.color = on ? '#0a5a68' : '#c0392b';
                }
                if (window.Toast) {
                    window.Toast.success(on
                        ? 'Console lock enabled for visitors.'
                        : 'Console lock disabled for everyone.');
                }
                // Apply immediately on this page (admin → no-op since admins are exempt,
                // but the cache is updated for any other open tab)
                if (typeof window.__securityCheck === 'function') window.__securityCheck();
            } catch (err) {
                if (window.Toast) window.Toast.error(err.message || 'Failed to save.');
                else alert('❌ ' + (err.message || 'Failed to save.'));
            } finally {
                setTimeout(() => {
                    saveConsoleLockBtn.disabled = false;
                    saveConsoleLockBtn.innerHTML = '<i class="fas fa-save"></i> Save Console Lock';
                }, 1500);
            }
        });
    }

    // ── Push-Notification Ads kill switch (Settings) ───────────
    // Mirrors the consoleLock / paymentsEnabled patterns: a Firestore-
    // backed boolean (settings.pushAdsEnabled) plus a per-device kill
    // shortcut. js/push-ads-init.js reads the same flag via SettingsStore
    // on every public page-load and either registers OR unregisters
    // /sw.js based on the value, so flipping this off here propagates
    // to all visitors within ~1 minute (no redeploy).
    const pushAdsToggle      = document.getElementById('pushAdsEnabledToggle');
    const pushAdsBadge       = document.getElementById('pushAdsBadge');
    const pushAdsInfo        = document.getElementById('pushAdsInfo');
    const savePushAdsBtn     = document.getElementById('savePushAdsBtn');
    const killPushAdsLocalBtn = document.getElementById('killPushAdsThisDeviceBtn');

    function paintPushAdsBadge(on) {
        if (!pushAdsBadge) return;
        if (on) {
            pushAdsBadge.textContent = 'LIVE';
            pushAdsBadge.style.background = '#c0392b';
            pushAdsBadge.title = 'Push-notification ads are LIVE for non-admin visitors. Booking pages stay ad-free.';
        } else {
            pushAdsBadge.textContent = 'OFF';
            pushAdsBadge.style.background = '#7a8b96';
            pushAdsBadge.title = 'Push-notification ads are disabled site-wide. Existing subscribers will be unregistered on their next visit.';
        }
    }

    function paintPushAdsInfo(on) {
        if (!pushAdsInfo) return;
        if (on) {
            pushAdsInfo.innerHTML =
                '🔔 <strong>Active</strong> &mdash; <code style="background:#fef9e7;padding:.05rem .3rem;border-radius:3px;">/sw.js</code> ' +
                'is registered on every public page for non-admin visitors.';
            pushAdsInfo.style.color = '#a04000';
        } else {
            pushAdsInfo.innerHTML =
                '🚫 <strong>Disabled site-wide</strong> &mdash; visitors that previously opted in will be ' +
                'auto-unregistered on their next page-load.';
            pushAdsInfo.style.color = '#0a5a68';
        }
    }

    async function loadPushAdsSetting() {
        if (!window.SettingsStore) return;
        try {
            const s = await window.SettingsStore.load();
            // Default-on: matches the user's "full integration; accept the risks" decision.
            const on = s.pushAdsEnabled !== false;
            if (pushAdsToggle) pushAdsToggle.checked = on;
            paintPushAdsBadge(on);
            paintPushAdsInfo(on);
        } catch (e) {
            console.warn('Could not load push-ads setting:', e);
            paintPushAdsBadge(true);
            paintPushAdsInfo(true);
        }
    }
    loadPushAdsSetting();

    // Live preview as the admin toggles, before they hit Save.
    if (pushAdsToggle) {
        pushAdsToggle.addEventListener('change', () => {
            const on = !!pushAdsToggle.checked;
            paintPushAdsBadge(on);
            paintPushAdsInfo(on);
        });
    }

    if (savePushAdsBtn) {
        savePushAdsBtn.addEventListener('click', async () => {
            if (!window.SettingsStore) {
                if (window.Toast) window.Toast.error('Settings store not loaded. Refresh the page.');
                return;
            }
            const on = !!(pushAdsToggle && pushAdsToggle.checked);
            // Friendly confirm when turning OFF — there's no take-back for
            // already-subscribed users (Ezoic/AdSense will re-scan within
            // their compliance windows). Just make sure the admin meant it.
            if (!on) {
                const cached = (window.SettingsStore.cached && window.SettingsStore.cached()) || {};
                const wasOn = cached.pushAdsEnabled !== false;
                if (wasOn && typeof window.confirm === 'function' &&
                    !window.confirm(
                        '🚫 Disable push-notification ads site-wide?\n\n' +
                        '• New visitors will not see the prompt.\n' +
                        '• Existing subscribers will be auto-unregistered on their next page-load.\n' +
                        '• You can flip this back on anytime.\n\n' +
                        'Continue?'
                    )) {
                    pushAdsToggle.checked = wasOn;
                    paintPushAdsBadge(wasOn);
                    paintPushAdsInfo(wasOn);
                    return;
                }
            }
            savePushAdsBtn.disabled = true;
            savePushAdsBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';
            try {
                await window.SettingsStore.save({ pushAdsEnabled: on });
                paintPushAdsBadge(on);
                paintPushAdsInfo(on);
                if (window.Toast) {
                    window.Toast.success(on
                        ? 'Push-notification ads enabled site-wide. Worker re-registers on visitors\' next page-load.'
                        : 'Push-notification ads disabled site-wide. Existing subscribers will be unregistered on their next visit.');
                }
            } catch (err) {
                if (window.Toast) window.Toast.error(err.message || 'Failed to save push-ads setting.');
                else alert('❌ ' + (err.message || 'Failed to save.'));
            } finally {
                setTimeout(() => {
                    savePushAdsBtn.disabled = false;
                    savePushAdsBtn.innerHTML = '<i class="fas fa-save"></i> Save Push-Ads Setting';
                }, 1500);
            }
        });
    }

    // "Kill on this device" — uses the public PushAds API exposed by
    // js/push-ads-init.js to set the local kill switch + tear down the
    // worker on the admin's current browser, without flipping the
    // global Firestore setting. Useful for QA / "I want to feel what
    // a real visitor sees but without the prompt".
    if (killPushAdsLocalBtn) {
        killPushAdsLocalBtn.addEventListener('click', async () => {
            // js/push-ads-init.js is only loaded on PUBLIC pages, so
            // window.PushAds is unavailable on the dashboard. Fall back
            // to setting the localStorage flag directly.
            try {
                if (window.PushAds && typeof window.PushAds.disable === 'function') {
                    await window.PushAds.disable();
                } else {
                    try { localStorage.setItem('disable_push_ads', '1'); } catch (_) {}
                    // We can't unregister /sw.js from the dashboard origin
                    // because it was installed under '/'. The next time the
                    // admin visits a public page, push-ads-init.js will see
                    // the kill flag and call unregisterSw() automatically.
                }
                if (window.Toast) {
                    window.Toast.success(
                        'Push-ads killed on this device. The next public page-load will unregister /sw.js. ' +
                        'Re-enable with PushAds.enable() in DevTools console.',
                        { duration: 8000 }
                    );
                }
            } catch (err) {
                if (window.Toast) window.Toast.error('Failed to kill local push ads: ' + (err && err.message));
            }
        });
    }

    // ── Razorpay LIVE / TEST mode toggle (Settings) ───────────
    // Reads & writes razorpayTestMode + razorpayTestKeyId on
    // /settings/site. js/checkout.js then auto-picks up the
    // change on the next public-page load (it calls
    // SettingsStore.load() before opening the gateway). LIVE is
    // the safe default — if anything goes sideways with the
    // SettingsStore read, checkout falls back to the hard-coded
    // live key in js/checkout.js.
    const razorpayTestModeToggle = document.getElementById('razorpayTestModeToggle');
    const razorpayTestKeyInput   = document.getElementById('razorpayTestKeyInput');
    const razorpayModeBadge      = document.getElementById('razorpayModeBadge');
    const razorpayModeInfo       = document.getElementById('razorpayModeInfo');
    const saveRazorpayModeBtn    = document.getElementById('saveRazorpayModeBtn');

    function paintRazorpayBadge(testOn, keyId) {
        if (!razorpayModeBadge) return;
        if (testOn && keyId) {
            razorpayModeBadge.textContent = 'TEST';
            razorpayModeBadge.style.background = '#f39c12';
            razorpayModeBadge.title = 'Public checkout is using the Razorpay TEST gateway. No real money.';
        } else if (testOn && !keyId) {
            razorpayModeBadge.textContent = 'TEST (no key)';
            razorpayModeBadge.style.background = '#c0392b';
            razorpayModeBadge.title = 'Test mode is ON but no test key id is set — checkout is falling back to LIVE.';
        } else {
            razorpayModeBadge.textContent = 'LIVE';
            razorpayModeBadge.style.background = '#0a5a68';
            razorpayModeBadge.title = 'Public checkout is using the Razorpay LIVE gateway — real money.';
        }
    }

    function paintRazorpayInfo(testOn, keyId) {
        if (!razorpayModeInfo) return;
        if (testOn && keyId) {
            razorpayModeInfo.innerHTML =
                '🧪 <strong>TEST MODE active</strong> &mdash; using key <code style="background:#fef9e7;padding:.05rem .3rem;border-radius:3px;">' +
                keyId.slice(0, 12) + '…</code>. No real money will move on /checkout.';
            razorpayModeInfo.style.color = '#a04000';
        } else if (testOn && !keyId) {
            razorpayModeInfo.innerHTML =
                '⚠️ Test mode is ON but the test key field is empty &mdash; ' +
                'checkout will fall back to LIVE keys. Paste your <code>rzp_test_…</code> key above.';
            razorpayModeInfo.style.color = '#c0392b';
        } else {
            razorpayModeInfo.innerHTML =
                '✅ <strong>LIVE MODE</strong> &mdash; the public checkout uses real Razorpay keys. Real money is processed.';
            razorpayModeInfo.style.color = '#0a5a68';
        }
    }

    async function loadRazorpayModeSetting() {
        if (!window.SettingsStore) return;
        try {
            const s = await window.SettingsStore.load();
            const on  = s.razorpayTestMode === true;
            const key = String(s.razorpayTestKeyId || '').trim();
            if (razorpayTestModeToggle) razorpayTestModeToggle.checked = on;
            if (razorpayTestKeyInput)   razorpayTestKeyInput.value     = key;
            paintRazorpayBadge(on, key);
            paintRazorpayInfo(on, key);
        } catch (e) {
            console.warn('Could not load Razorpay-mode setting:', e);
        }
    }
    loadRazorpayModeSetting();

    // Live preview as the admin types/toggles — keeps the badge and
    // info line in sync BEFORE they hit Save, so they can see what
    // their change is going to do without committing to it.
    if (razorpayTestModeToggle) {
        razorpayTestModeToggle.addEventListener('change', () => {
            const on  = !!razorpayTestModeToggle.checked;
            const key = (razorpayTestKeyInput && razorpayTestKeyInput.value || '').trim();
            paintRazorpayBadge(on, key);
            paintRazorpayInfo(on, key);
        });
    }
    if (razorpayTestKeyInput) {
        razorpayTestKeyInput.addEventListener('input', () => {
            const on  = !!(razorpayTestModeToggle && razorpayTestModeToggle.checked);
            const key = razorpayTestKeyInput.value.trim();
            paintRazorpayBadge(on, key);
            paintRazorpayInfo(on, key);
        });
    }

    if (saveRazorpayModeBtn) {
        saveRazorpayModeBtn.addEventListener('click', async () => {
            if (!window.SettingsStore) {
                if (window.Toast) window.Toast.error('Settings store not loaded. Refresh the page.');
                return;
            }
            const on  = !!(razorpayTestModeToggle && razorpayTestModeToggle.checked);
            const key = razorpayTestKeyInput ? razorpayTestKeyInput.value.trim() : '';

            // Validate the test key shape when the toggle is being turned ON.
            // Razorpay test keys ALWAYS start with `rzp_test_` (live keys
            // start with `rzp_live_`). Reject mistakes loudly so the admin
            // doesn't accidentally point checkout at a non-existent key
            // and 500 every customer at the gateway.
            if (on) {
                if (!key) {
                    if (window.Toast) window.Toast.warning('Paste your Razorpay TEST Key ID before turning test mode on.');
                    if (razorpayTestKeyInput) razorpayTestKeyInput.focus();
                    return;
                }
                if (!/^rzp_test_[A-Za-z0-9]{6,}$/.test(key)) {
                    if (window.Toast) {
                        window.Toast.error(
                            'That doesn\'t look like a Razorpay test key. ' +
                            'It must start with "rzp_test_" — get it from Razorpay Dashboard → Test Mode → API Keys.',
                            { duration: 8000 }
                        );
                    }
                    if (razorpayTestKeyInput) razorpayTestKeyInput.focus();
                    return;
                }
            }

            // Final safety prompt when flipping FROM live → test on prod.
            // We only ask if the toggle is actually changing state.
            try {
                const cached = (window.SettingsStore.cached && window.SettingsStore.cached()) || {};
                const wasOn = cached.razorpayTestMode === true;
                if (on !== wasOn) {
                    const msg = on
                        ? '⚠️ Switch the public checkout to Razorpay TEST MODE?\n\n' +
                          '• Real customers will see the test gateway and CANNOT actually pay.\n' +
                          '• Use this for QA / staging only.\n\n' +
                          'Continue?'
                        : '✅ Switch the public checkout back to Razorpay LIVE MODE?\n\n' +
                          '• Real money will start processing again.\n' +
                          '• Make sure the refund Worker is also using LIVE secrets (see razorpay_test_mode_guide.md → Step 3).\n\n' +
                          'Continue?';
                    if (typeof window.confirm === 'function' && !window.confirm(msg)) {
                        return;
                    }
                }
            } catch (_) {}

            saveRazorpayModeBtn.disabled = true;
            saveRazorpayModeBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';
            try {
                await window.SettingsStore.save({
                    razorpayTestMode:  on,
                    razorpayTestKeyId: key
                });
                paintRazorpayBadge(on, key);
                paintRazorpayInfo(on, key);
                if (window.Toast) {
                    window.Toast.success(on
                        ? 'Razorpay TEST mode is now active. Public checkout will use the test key on next page load.'
                        : 'Razorpay LIVE mode is now active. Real payments will be processed again.', { duration: 6000 });
                }
                // Friendly reminder if turning TEST on — admins regularly
                // forget to also swap the refund Worker secret.
                if (on && window.Toast) {
                    setTimeout(() => {
                        window.Toast.info(
                            '🔑 Reminder: also update the refund Worker secrets to TEST credentials, ' +
                            'otherwise refunds will fail. See razorpay_test_mode_guide.md → Step 3.',
                            { duration: 9000 }
                        );
                    }, 1500);
                }
            } catch (err) {
                if (window.Toast) window.Toast.error(err.message || 'Failed to save Razorpay mode.');
                else alert('❌ ' + (err.message || 'Failed to save.'));
            } finally {
                setTimeout(() => {
                    saveRazorpayModeBtn.disabled = false;
                    saveRazorpayModeBtn.innerHTML = '<i class="fas fa-save"></i> Save Razorpay Mode';
                }, 1500);
            }
        });
    }

    // Auto-refresh when localStorage changes (e.g. from another tab)
    window.addEventListener('storage', refreshAll);

    // ── Dashboard Theme Picker (Settings → Appearance) ──────────
    // The theme is bootstrapped before paint by an inline script in
    // dashboard.html that adds a 'theme-<name>' class to body. Here
    // we wire the swatches to swap the class live and persist the
    // choice in localStorage. Six themes ship: hacker (default),
    // light, ocean, sunset, midnight, cyberpunk.
    (function initThemePicker() {
        var THEMES = ['hacker','light','ocean','sunset','midnight','cyberpunk'];
        var picker = document.getElementById('themePickerGrid');
        if (!picker) return;

        function getActive() {
            var t = (localStorage.getItem('adminDashboardTheme') || 'hacker').toLowerCase();
            return THEMES.indexOf(t) >= 0 ? t : 'hacker';
        }

        function markActive(theme) {
            picker.querySelectorAll('.theme-swatch').forEach(function (sw) {
                sw.classList.toggle('active', sw.dataset.theme === theme);
            });
        }

        function applyTheme(theme) {
            if (THEMES.indexOf(theme) < 0) theme = 'hacker';
            // Remove all theme-* classes, keep everything else intact.
            THEMES.forEach(function (t) { document.body.classList.remove('theme-' + t); });
            document.body.classList.add('theme-' + theme);
            try { localStorage.setItem('adminDashboardTheme', theme); } catch (_) {}
            markActive(theme);
            // Friendly toast confirmation (when Toast is loaded)
            if (window.Toast && window.Toast.success) {
                var label = theme.charAt(0).toUpperCase() + theme.slice(1);
                window.Toast.success('Theme switched to ' + label + '.', { duration: 2000 });
            }
        }

        // Click + keyboard activation
        picker.addEventListener('click', function (e) {
            var sw = e.target.closest('.theme-swatch');
            if (!sw) return;
            applyTheme(sw.dataset.theme);
        });
        picker.addEventListener('keydown', function (e) {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            var sw = e.target.closest('.theme-swatch');
            if (!sw) return;
            e.preventDefault();
            applyTheme(sw.dataset.theme);
        });

        // Initial state — match the class that the FOUC bootstrapper applied
        markActive(getActive());
    })();

    // ── Conversion Boosters (Settings → Conversion Boosters) ──
    // Single Save button writes all 9 fields in one Firestore call.
    (function initConversionBoosters() {
        var saveBtn = document.getElementById('saveConversionBoostersBtn');
        if (!saveBtn) return;
        var statusEl = document.getElementById('ckSaveStatus');

        // Map of field id → settings key + parser. Booleans for toggles,
        // string for text fields, number for the two numeric fields.
        var FIELDS = [
            { id: 'ckUrgencyToggle',         key: 'urgencyBarEnabled',       type: 'bool' },
            { id: 'ckUrgencyMessage',        key: 'urgencyBarMessage',       type: 'str'  },
            { id: 'ckWhatsappToggle',        key: 'whatsappFabEnabled',      type: 'bool' },
            { id: 'ckWhatsappNumber',        key: 'whatsappFabNumber',       type: 'str'  },
            { id: 'ckWhatsappMessage',       key: 'whatsappFabMessage',      type: 'str'  },
            { id: 'ckExitToggle',            key: 'exitIntentCouponEnabled', type: 'bool' },
            { id: 'ckExitCode',              key: 'exitIntentCouponCode',    type: 'str'  },
            { id: 'ckExitPercent',           key: 'exitIntentCouponPercent', type: 'num'  },
            { id: 'ckLaunchToggle',          key: 'launchAdvanceCouponEnabled', type: 'bool' },
            { id: 'ckLaunchCode',            key: 'launchAdvanceCouponCode',    type: 'str'  },
            { id: 'ckLaunchAmount',          key: 'launchAdvanceCouponAmount',  type: 'num'  },
            { id: 'ckGoogleReviewsToggle',   key: 'googleReviewsEnabled',    type: 'bool' },
            { id: 'ckLandingPagesToggle',    key: 'landingPagesEnabled',     type: 'bool' }
        ];

        function setStatus(msg, color) {
            if (statusEl) {
                statusEl.textContent = msg || '';
                statusEl.style.color = color || '#0a5a68';
            }
        }

        function readField(f) {
            var el = document.getElementById(f.id);
            if (!el) return null;
            if (f.type === 'bool') return !!el.checked;
            if (f.type === 'num')  {
                var n = Number(el.value);
                return isFinite(n) ? n : null;
            }
            return String(el.value || '').trim();
        }

        function writeField(f, val) {
            var el = document.getElementById(f.id);
            if (!el) return;
            if (f.type === 'bool') el.checked = val !== false;
            else                   el.value   = (val == null ? '' : String(val));
        }

        // Load current values from settings into the form
        async function loadIntoForm() {
            if (!window.SettingsStore) return;
            try {
                var s = await window.SettingsStore.load();
                FIELDS.forEach(function (f) {
                    if (Object.prototype.hasOwnProperty.call(s, f.key)) writeField(f, s[f.key]);
                });
            } catch (err) {
                console.warn('Could not load conversion boosters:', err);
            }
        }
        loadIntoForm();

        // Save all fields → Firestore
        saveBtn.addEventListener('click', async function () {
            if (!window.SettingsStore) {
                setStatus('Settings store not loaded — refresh.', '#c0392b');
                return;
            }
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';
            setStatus('Saving boosters to Firebase…', '#0a5a68');

            var patch = {};
            FIELDS.forEach(function (f) {
                var v = readField(f);
                if (v !== null) patch[f.key] = v;
            });

            try {
                await window.SettingsStore.save(patch);
                setStatus('✅ Saved. New visitors see the latest config now.', '#0a5a68');
                if (window.Toast && window.Toast.success) {
                    window.Toast.success('Conversion boosters updated.');
                }
            } catch (err) {
                setStatus('❌ ' + (err.message || 'Failed to save.'), '#c0392b');
            } finally {
                setTimeout(function () {
                    saveBtn.disabled = false;
                    saveBtn.innerHTML = '<i class="fas fa-save"></i> Save All Boosters';
                }, 1500);
            }
        });
    })();
});
