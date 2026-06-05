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

    // Wrap each letter of the brand text in <span class="bl"> so the
    // hover wave animation (in style.css) works on EVERY page, not just
    // pages that load js/script.js.
    function wrapBrandLetters() {
        document.querySelectorAll('.brand-line1, .brand-line2').forEach(line => {
            // Already wrapped? skip
            if (line.querySelector('.bl')) return;
            const text = line.textContent;
            line.innerHTML = '';
            for (const ch of text) {
                const sp = document.createElement('span');
                sp.className = 'bl';
                if (ch === ' ') {
                    sp.style.width = '.35em';
                    sp.innerHTML = '&nbsp;';
                } else {
                    sp.textContent = ch;
                }
                line.appendChild(sp);
            }
        });
    }

    // ── Canonical site navigation ─────────────────────────────
    // Every page across the site should show the same nav order:
    //   Home · Packages · Flights · Cabs · Gallery · Dashboard
    // (Bookings / Customize / Profile / Settings / Contact / Help / Terms
    //  all live inside the AD avatar dropdown — see build() below.)
    // Anything else the page's own HTML put into #topnav is wiped, then
    // the canonical list is injected. The matching item is highlighted
    // as `.active` based on the current pathname.
    var CANONICAL_NAV = [
        { href: '/',         label: 'Home',      icon: 'fa-home',              match: ['/','/index'] },
        { href: '/#packages', label: 'Packages',  icon: 'fa-suitcase-rolling', match: ['/#packages'] },
        { href: '/flights',  label: 'Flights',   icon: 'fa-plane',             match: ['/flights'] },
        { href: '/cabs',     label: 'Cabs',      icon: 'fa-taxi',              match: ['/cabs'] },
        { href: '/gallery',  label: 'Gallery',   icon: 'fa-images',            match: ['/gallery'] },
        { href: '/dashboard',label: 'Dashboard', icon: 'fa-th-large',          match: ['/dashboard'] }
    ];
    function normalizeTopnav(topnav) {
        if (!topnav) return;
        // Skip the dashboard's sidebar nav — it has different items + JS.
        if (topnav.querySelector('.sidebar-link')) return;
        var path = (location.pathname || '/').replace(/\/index(\.html)?$/i, '/').replace(/\.html$/i, '');
        if (!path) path = '/';
        var hash = location.hash || '';
        var fullPath = path + hash;
        function isActive(item) {
            // Exact path-or-path+hash match
            if (item.match.indexOf(fullPath) >= 0) return true;
            // Special-case: "/" should be active for both "/" and "/index"
            if (item.href === '/' && (path === '/' || path === '')) return !hash;
            return false;
        }
        var html = CANONICAL_NAV.map(function (it) {
            var active = isActive(it) ? ' active' : '';
            return '<a href="' + it.href + '" class="topnav-item' + active + '">' +
                   '<i class="fas ' + it.icon + '"></i><span>' + it.label + '</span></a>';
        }).join('');
        topnav.innerHTML = html;
    }

    function build() {
        wrapBrandLetters();
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
        // Force every page to show the same nav items in the same order.
        // Runs BEFORE the AD avatar is injected so the avatar always lands
        // at the end of the bar.
        normalizeTopnav(topnav);
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
            '<a class="um-item" href="/customize"><i class="fas fa-sliders-h"></i> Customize Trip</a>' +
            '<a class="um-item" href="/profile"><i class="fas fa-user"></i> Profile</a>' +
            '<a class="um-item" href="/settings"><i class="fas fa-cog"></i> Settings</a>' +
            '<a class="um-item um-admin-only" href="/dashboard" style="display:none;"><i class="fas fa-th-large"></i> Admin Dashboard</a>' +
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
            // Resolve the avatar URL, with a sensible fallback chain:
            //   1. Customer's chosen photoURL (Cloudinary upload OR preset
            //      from /images/avatars/).
            //   2. The default anonymous-silhouette preset shipped under
            //      /images/avatars/avatar-default.png — same image the
            //      profile-page picker offers as the "Use default" tile.
            //   3. (Only if the user is NOT signed in) fall back to the
            //      old initials avatar — there's no profile to point at.
            // The DEFAULT_AVATAR_URL constant comes from UsersStore so we
            // don't hard-code the path in two places. Wrapped in a try
            // so we degrade gracefully if dataStore.js hasn't loaded yet.
            let photo = (u && u.photoURL) ? String(u.photoURL) : '';
            if (!photo && u) {
                try {
                    const def = window.UsersStore && window.UsersStore.DEFAULT_AVATAR_URL;
                    if (def) photo = String(def);
                } catch (_) {}
            }
            // If the photo is a Cloudinary URL, swap it for a 96×96
            // thumbnail variant (~5-10 KB instead of the 1-6 MB original).
            // The topbar avatar is rendered at 38-44 px, so 96px gives us
            // 2× retina without bloating bandwidth. Local /images/avatars
            // PNGs and other URLs pass through unchanged.
            if (photo && typeof window.cdnAvatarUrl === 'function') {
                photo = window.cdnAvatarUrl(photo, 96);
            }
            // Render avatar — photo if available, else initials.
            // Both the topbar button (wrap) and dropdown header (drop)
            // share the same .um-initials node, so we reuse it.
            //
            // ⚠️ CRITICAL: comparing img.src to `photo` doesn't work
            // naively. The browser RESOLVES img.src to an absolute URL
            // ("https://andamanvoyages.in/images/avatars/avatar-5.png")
            // but the photoURL we get from the profile is often relative
            // ("images/avatars/avatar-5.png"). A direct `!==` compare is
            // therefore ALWAYS true → the <img> reassigns its src on
            // every refreshMenu() tick → the browser refetches the
            // image. Combined with the 1-second poll for 30s + 5–10
            // auth-change firings on page load, we observed ~2,500
            // requests for the same avatar PNG (229 MB transfer).
            //
            // Fix: stash the resolved URL we LAST set on the img in a
            // data-attribute (cheap string compare against the same
            // representation we set, never against the absolute form).
            const renderAvatarNode = (el) => {
                if (!el) return;
                if (photo) {
                    el.classList.add('um-has-photo');
                    // Reuse a single <img> to avoid layout thrash on repeat
                    // calls.
                    //
                    // ⚠️ DO NOT call `el.textContent = ''` here — that
                    // detaches every child including any existing <img>,
                    // which forces us to create a fresh <img> every call,
                    // which forces the browser to re-fetch the avatar PNG
                    // (the original 2,500-request bug). Instead, look up
                    // an existing <img>: if one is there, just update its
                    // src (or skip if URL unchanged); if not, sweep any
                    // stray text node (the initials placeholder) and add
                    // a new <img>.
                    let img = el.querySelector('img');
                    if (!img) {
                        // First-paint or transitioned from initials view —
                        // sweep any leftover text nodes (`?` placeholder /
                        // initials), then add the <img>.
                        while (el.firstChild) el.removeChild(el.firstChild);
                        img = document.createElement('img');
                        img.alt = 'Profile picture';
                        img.draggable = false;
                        el.appendChild(img);
                    }
                    // Compare against the URL we LAST set — never against
                    // img.src (which is the resolved absolute form, so
                    // a relative path would always look "different").
                    if (img.dataset.umLastSrc !== photo) {
                        img.src = photo;
                        img.dataset.umLastSrc = photo;
                    }
                } else {
                    el.classList.remove('um-has-photo');
                    // Switching from photo back to initials — wipe everything
                    // (including any cached <img>) before laying down the text.
                    el.textContent = initials;
                }
            };
            wrap.querySelectorAll('.um-initials').forEach(renderAvatarNode);
            drop.querySelectorAll('.um-initials').forEach(renderAvatarNode);
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