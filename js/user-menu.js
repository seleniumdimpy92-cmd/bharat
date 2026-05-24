/* ── user-menu.js ────────────────────────────────────────────────
   Adds a circular gradient "AD" avatar button at the right end of the
   topbar's #topnav element, with a dropdown action-sheet menu:
     • My Bookings
     • Profile
     • Dashboard / Settings  (admin-only)
     • Database Mirror       (admin-only)
     • Contact / Help / Terms
     • Login / Logout

   Works on every page that has <nav id="topnav"> and <header class="topbar">.
   No other dependencies beyond firebase-config.js (for ADMIN_EMAILS).

   Auto-hides any legacy ".topbar-user" element so we never show two avatars.
   ──────────────────────────────────────────────────────────────── */

(function () {
    'use strict';

    function readCurrentUser() {
        try {
            const cu  = JSON.parse(localStorage.getItem('currentUser') || 'null');
            const tok = localStorage.getItem('token');
            // Treat as logged-in only if we have both a profile object AND a
            // token. Stops the menu showing stale "logged-in" state when a
            // previous session left a `currentUser` blob behind but the
            // token has since been cleared by Firebase.
            if (cu && (cu.uid || cu.id) && tok) return cu;
            return null;
        } catch (e) { return null; }
    }
    function getInitials(u) {
        if (!u) return '?';
        const n = (u.fullName || u.username || u.email || '').trim();
        if (!n) return '?';
        const parts = n.split(/[\s@.]+/).filter(Boolean);
        if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
        return parts[0].slice(0, 2).toUpperCase();
    }
    function isAdmin(u) {
        if (!u) return false;
        const adminEmails = (Array.isArray(window.ADMIN_EMAILS) && window.ADMIN_EMAILS.length)
            ? window.ADMIN_EMAILS.map(e => String(e).toLowerCase())
            : ['deb@andamanvoyages.in'];
        const email = String(u.email || '').toLowerCase();
        return u.role === 'admin' || adminEmails.includes(email)
            || (u.username || '').toLowerCase() === 'deb';
    }

    function build() {
        // Hide any old text "Admin" badge in the dashboard topbar
        document.querySelectorAll('.topbar-user').forEach(el => {
            el.style.display = 'none';
        });
        // Hide the legacy Login + Sign Up buttons in the public topnav
        // (their functionality is now in this AD avatar menu)
        ['authLink', 'signUpNavLink'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });

        const topbar = document.querySelector('.topbar');
        const topnav = document.getElementById('topnav');
        if (!topbar) return;
        if (topbar.querySelector('.user-menu-wrap')) return;   // already built

        // Place the avatar DIRECTLY in the .topbar (not inside #topnav)
        // so it stays visible even when the mobile drawer is collapsed.
        // The dropdown is appended to <body> so it can never be clipped
        // by an overflow:auto / hidden parent.
        const wrap = document.createElement('div');
        wrap.className = 'user-menu-wrap';
        wrap.innerHTML =
            '<button type="button" class="user-menu-btn" id="userMenuBtn" '+
                'aria-haspopup="true" aria-expanded="false" title="Account">' +
                '<span class="um-initials">?</span>' +
                '<span class="um-dot"></span>' +
            '</button>';
        // Insert the avatar just before the hamburger if there is one,
        // otherwise as the last child of the topbar.
        const hamburger = topbar.querySelector('.hamburger');
        if (hamburger) {
            topbar.insertBefore(wrap, hamburger);
        } else {
            topbar.appendChild(wrap);
        }

        const drop = document.createElement('div');
        drop.className = 'user-menu-dropdown user-menu-dropdown-floating';
        drop.id = 'userMenuDropdown';
        drop.setAttribute('role', 'menu');
        drop.innerHTML =
            '<div class="um-header">' +
                '<span class="um-avatar um-initials">?</span>' +
                '<div style="min-width:0;">' +
                    '<div class="um-name">Guest</div>' +
                    '<div class="um-email">Not signed in</div>' +
                '</div>' +
            '</div>' +
            '<a class="um-item" href="/bookings"><i class="fas fa-calendar-check"></i> My Bookings</a>' +
            '<a class="um-item" href="javascript:void(0)" data-um-act="profile"><i class="fas fa-user"></i> Profile</a>' +
            '<a class="um-item um-admin-only" href="/dashboard" style="display:none;"><i class="fas fa-th-large"></i> Dashboard</a>' +
            '<a class="um-item um-admin-only" href="/dashboard#section-settings" style="display:none;"><i class="fas fa-cog"></i> Settings</a>' +
            '<a class="um-item um-admin-only" href="/migrate" target="_blank" rel="noopener" style="display:none;"><i class="fas fa-clone"></i> Database Mirror</a>' +
            '<div class="um-divider"></div>' +
            '<a class="um-item" href="/about#contact"><i class="fas fa-headset"></i> Contact</a>' +
            '<a class="um-item" href="javascript:void(0)" data-um-act="help"><i class="fas fa-question-circle"></i> Help</a>' +
            '<a class="um-item" href="/terms"><i class="fas fa-file-alt"></i> Terms</a>' +
            '<div class="um-divider"></div>' +
            '<a class="um-item um-login-only" href="javascript:void(0)" data-um-act="login"><i class="fas fa-sign-in-alt"></i> Login / Sign Up</a>' +
            '<a class="um-item um-danger um-logout-only" href="javascript:void(0)" data-um-act="logout" style="display:none;"><i class="fas fa-sign-out-alt"></i> Logout</a>';
        document.body.appendChild(drop);

        const btn = wrap.querySelector('.user-menu-btn');

        function positionDropdown() {
            const rect = btn.getBoundingClientRect();
            // Anchor the top-right of the dropdown to the bottom-right of the button,
            // shifted down by 12 px (matches the previous arrow tail).
            const dropRight = window.innerWidth - rect.right;
            drop.style.top   = (rect.bottom + 12) + 'px';
            drop.style.right = Math.max(8, dropRight) + 'px';
        }

        function refreshMenu() {
            const u = readCurrentUser();
            const initials = getInitials(u);
            // Initials live in BOTH wrap (avatar btn) and drop (header avatar)
            wrap.querySelectorAll('.um-initials').forEach(e => e.textContent = initials);
            drop.querySelectorAll('.um-initials').forEach(e => e.textContent = initials);
            // The remaining elements (name/email + show/hide flags) are all
            // inside the dropdown which now lives on <body>, NOT inside wrap.
            const nameEl  = drop.querySelector('.um-name');
            const emailEl = drop.querySelector('.um-email');
            if (u) {
                btn.classList.add('um-online');
                if (nameEl)  nameEl.textContent  = u.fullName || u.username || 'Account';
                if (emailEl) emailEl.textContent = u.email || '';
                drop.querySelectorAll('.um-login-only').forEach(e => e.style.display = 'none');
                drop.querySelectorAll('.um-logout-only').forEach(e => e.style.display = '');
                if (isAdmin(u)) {
                    drop.querySelectorAll('.um-admin-only').forEach(e => e.style.display = '');
                } else {
                    drop.querySelectorAll('.um-admin-only').forEach(e => e.style.display = 'none');
                }
            } else {
                btn.classList.remove('um-online');
                if (nameEl)  nameEl.textContent  = 'Guest';
                if (emailEl) emailEl.textContent = 'Not signed in';
                drop.querySelectorAll('.um-login-only').forEach(e => e.style.display = '');
                drop.querySelectorAll('.um-logout-only').forEach(e => e.style.display = 'none');
                drop.querySelectorAll('.um-admin-only').forEach(e => e.style.display = 'none');
            }
        }
        refreshMenu();
        document.addEventListener('auth:changed', refreshMenu);
        window.addEventListener('storage', refreshMenu);

        // Subscribe to the data-layer's auth listener if available — this is
        // the most reliable signal because dataStore.cacheProfile() runs
        // INSIDE the same tab, and a same-tab localStorage.setItem does NOT
        // fire the 'storage' event. UsersStore exposes onAuthChange via the
        // _authListeners array in js/dataStore.js.
        if (window.UsersStore && typeof window.UsersStore.onAuthChange === 'function') {
            window.UsersStore.onAuthChange(function () { refreshMenu(); });
        }

        // Cheap safety net: poll every 1 s for the first 30 s after page
        // load so the avatar reflects login status promptly even if neither
        // auth:changed nor onAuthChange fired (e.g. on dashboard.html where
        // js/auth.js is not loaded but dataStore.js writes localStorage on
        // its own).
        let _polls = 0;
        const _t = setInterval(() => {
            refreshMenu();
            if (++_polls > 30) clearInterval(_t);
        }, 1000);

        function closeMenu() {
            wrap.classList.remove('open');
            drop.classList.remove('open');
            btn.setAttribute('aria-expanded', 'false');
        }
        function openMenu() {
            // Close any other open menus first
            document.querySelectorAll('.user-menu-wrap.open').forEach(w => {
                if (w !== wrap) w.classList.remove('open');
            });
            document.querySelectorAll('.user-menu-dropdown.open').forEach(d => {
                if (d !== drop) d.classList.remove('open');
            });
            positionDropdown();
            wrap.classList.add('open');
            drop.classList.add('open');
            btn.setAttribute('aria-expanded', 'true');
        }

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (wrap.classList.contains('open')) closeMenu();
            else                                 openMenu();
        });
        document.addEventListener('click', (e) => {
            if (!wrap.contains(e.target) && !drop.contains(e.target)) {
                closeMenu();
            }
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') closeMenu();
        });
        window.addEventListener('resize', () => {
            if (wrap.classList.contains('open')) positionDropdown();
        });
        window.addEventListener('scroll', () => {
            if (wrap.classList.contains('open')) positionDropdown();
        }, { passive: true });

        drop.addEventListener('click', (e) => {
            const item = e.target.closest('[data-um-act]');
            if (!item) return;
            const act = item.dataset.umAct;
            closeMenu();
            if (act === 'profile') {
                if (typeof window.openProfile === 'function') window.openProfile();
                else if (!readCurrentUser() && typeof window.openLogin === 'function') window.openLogin();
                else window.location.href = '/dashboard';
            } else if (act === 'login') {
                if (typeof window.openLogin === 'function') window.openLogin();
                else window.location.href = '/#login';
            } else if (act === 'logout') {
                if (typeof window.logout === 'function') {
                    window.logout();
                } else {
                    try {
                        localStorage.removeItem('token');
                        localStorage.removeItem('currentUser');
                    } catch (_) {}
                    window.location.href = '/';
                }
            } else if (act === 'help') {
                alert(
                    'Need help?\n\n' +
                    '📞 Call: +91 88801 95191 / +91 94341 25698\n' +
                    '📧 Email: booking@andamanvoyages.in\n\n' +
                    'We reply within 1–2 hours during 9 AM – 9 PM IST.'
                );
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', build);
    } else {
        build();
    }
    // Expose for callers that re-render the topnav
    window.UserMenu = { build, refresh: function () {
        document.querySelectorAll('.user-menu-wrap').forEach(w => w.remove());
        build();
    }};
})();