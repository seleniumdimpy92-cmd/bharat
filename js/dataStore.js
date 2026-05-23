// ── Firebase-backed data store (Auth + Firestore) ────────────────
// Replaces the previous jsonbin.io implementation. All public pages and
// the admin dashboard go through this module.
//
// Public surface (set on `window`):
//   PackagesStore.load()                 → load all packages (with cache)
//   PackagesStore.loadWithStaleWhileRevalidate(cb)
//   PackagesStore.publish(packagesArray) → admin-only; writes all packages
//   UsersStore.login(identifier, pwd)    → identifier = email OR username
//   UsersStore.register({username,email,password,fullName?,phone?})
//   UsersStore.logout()
//   UsersStore.onAuthChange(cb)          → cb(profile|null)
//   UsersStore.getCurrentUser()          → cached profile or null
//   UsersStore.isAdmin()                 → bool
//   UsersStore.updateProfile({fullName?,phone?})
//
// Implementation note: the Firebase JS SDK is ES-modules-only on the
// CDN. We dynamically import it once at startup and stash the resolved
// promise on `window.__firebaseReady` so callers can `await` it.

(function () {
    const ADMIN_EMAILS = (Array.isArray(window.ADMIN_EMAILS) && window.ADMIN_EMAILS.length)
        ? window.ADMIN_EMAILS.map(e => String(e).toLowerCase())
        : [String(window.ADMIN_EMAIL || 'deb@andamanvoyages.in').toLowerCase()];
    const ADMIN_EMAIL  = ADMIN_EMAILS[0]; // legacy single
    function isAdminEmail(email) {
        return !!email && ADMIN_EMAILS.indexOf(String(email).toLowerCase()) >= 0;
    }
    const SDK_VERSION  = '10.13.2';
    const APP_URL       = `https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-app.js`;
    const AUTH_URL      = `https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-auth.js`;
    const FIRESTORE_URL = `https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-firestore.js`;

    const PACKAGES_CACHE_KEY = 'sitePackages';
    const USER_CACHE_KEY     = 'currentUser';

    // ── Bootstrap Firebase once ────────────────────────────────
    window.__firebaseReady = (async function init() {
        if (!window.FIREBASE_CONFIG) {
            throw new Error('Missing window.FIREBASE_CONFIG (load js/firebase-config.js first)');
        }
        const [
            { initializeApp },
            authMod,
            firestoreMod
        ] = await Promise.all([
            import(APP_URL),
            import(AUTH_URL),
            import(FIRESTORE_URL)
        ]);

        const app  = initializeApp(window.FIREBASE_CONFIG);
        const auth = authMod.getAuth(app);
        try { await authMod.setPersistence(auth, authMod.browserLocalPersistence); } catch (_) {}
        const db   = firestoreMod.getFirestore(app);

        // Wire auth-state listener so the cached profile stays in sync
        authMod.onAuthStateChanged(auth, async (authUser) => {
            if (!authUser) {
                cacheProfile(null);
                fireAuthListeners(null);
                return;
            }
            let extra = null;
            try { extra = await fetchUserDoc(authUser.uid); } catch (_) {}
            const profile = profileFromUser(authUser, extra);
            cacheProfile(profile);
            fireAuthListeners(profile);
        });

        return { app, auth, db, firebaseAuth: authMod, firestore: firestoreMod };
    })();

    // Surface init errors so callers can fail fast
    window.__firebaseReady.catch(err => console.error('Firebase init failed:', err));

    // ── Local cache helpers ─────────────────────────────────────
    function getCachedPackages() {
        try {
            const raw = localStorage.getItem(PACKAGES_CACHE_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) && parsed.length ? parsed : null;
        } catch (_) { return null; }
    }
    function setCachedPackages(data) {
        try { localStorage.setItem(PACKAGES_CACHE_KEY, JSON.stringify(data)); } catch (_) {}
    }

    async function loadFromRepoFile() {
        try {
            const res = await fetch('data/packages.json?t=' + Date.now(), { cache: 'no-store' });
            if (!res.ok) return null;
            const data = await res.json();
            return Array.isArray(data) && data.length ? data : null;
        } catch (_) { return null; }
    }

    // ───────────────────────────────────────────────────────────
    // PackagesStore
    // ───────────────────────────────────────────────────────────
    async function loadFromFirestore() {
        const { db, firestore } = await window.__firebaseReady;
        const snap = await firestore.getDocs(firestore.collection(db, 'packages'));
        if (snap.empty) return null;

        const list = [];
        snap.forEach(d => {
            const data = d.data() || {};
            list.push({ id: d.id, ...data });
        });
        list.sort((a, b) => {
            const oa = (a.order != null) ? a.order : 999;
            const ob = (b.order != null) ? b.order : 999;
            return oa - ob;
        });
        return list;
    }

    async function loadPackages() {
        // 1. Authoritative: Firestore
        try {
            const data = await loadFromFirestore();
            if (data && data.length) {
                setCachedPackages(data);
                return { data, source: 'firestore' };
            }
        } catch (e) {
            console.warn('Firestore packages read failed; falling back', e);
        }
        // 2. Static fallback file in the repo
        const repoData = await loadFromRepoFile();
        if (repoData) {
            setCachedPackages(repoData);
            return { data: repoData, source: 'repo' };
        }
        // 3. Cached
        const cached = getCachedPackages();
        if (cached) return { data: cached, source: 'cache' };

        return { data: null, source: 'none' };
    }

    async function loadPackagesSWR(onUpdate) {
        const cached = getCachedPackages();
        if (cached && typeof onUpdate === 'function') {
            try { onUpdate(cached, 'cache'); } catch (_) {}
        }
        const fresh = await loadPackages();
        if (fresh.data && typeof onUpdate === 'function') {
            try { onUpdate(fresh.data, fresh.source); } catch (_) {}
        }
        return fresh;
    }

    async function publishPackages(packages) {
        if (!Array.isArray(packages)) throw new Error('packages must be an array');
        setCachedPackages(packages);

        const { db, auth, firestore } = await window.__firebaseReady;
        const user = auth.currentUser;
        if (!user) throw new Error('You must be signed in as the admin to publish.');
        if (!isAdminEmail(user.email)) throw new Error('Only an admin user can publish packages.');

        // Strategy: write/merge each provided package, delete packages in
        // Firestore that aren't in the new list. Single batch.
        const colRef = firestore.collection(db, 'packages');
        const existingSnap = await firestore.getDocs(colRef);
        const newIds = new Set(packages.map(p => String(p.id)));
        const batch = firestore.writeBatch(db);

        packages.forEach((pkg, idx) => {
            const id = String(pkg.id || ('pkg_' + Date.now() + '_' + idx));
            const docRef = firestore.doc(db, 'packages', id);
            const payload = {
                ...pkg,
                id,
                order: idx,
                updatedAt: firestore.serverTimestamp()
            };
            batch.set(docRef, payload, { merge: false });
        });

        existingSnap.forEach(d => {
            if (!newIds.has(d.id)) {
                batch.delete(firestore.doc(db, 'packages', d.id));
            }
        });

        await batch.commit();
        return { count: packages.length };
    }

    window.PackagesStore = {
        load: loadPackages,
        loadWithStaleWhileRevalidate: loadPackagesSWR,
        publish: publishPackages,
        clearKey: function () {},                 // no-op (Firebase Auth manages creds)
        get isConfigured() { return true; }
    };

    // ───────────────────────────────────────────────────────────
    // SettingsStore — site-wide flags (e.g. payments enabled)
    //   Firestore doc: /settings/site
    //   Public read, admin-only write (enforced in firestore.rules).
    // ───────────────────────────────────────────────────────────
    const SETTINGS_CACHE_KEY = 'siteSettings';
    const SETTINGS_DEFAULT   = {
        paymentsEnabled: true,
        paymentsDisabledMessage: '',
        // When true, security.js blocks DevTools shortcuts/right-click for normal
        // visitors. Admins are always allowed to use DevTools regardless.
        consoleLockEnabled: true,
        // Default % of total trip cost charged as advance to confirm a booking.
        // Stored as a percentage number (e.g. 5 means 5%, 10 means 10%).
        // Can be overridden per-user via users/{uid}.advanceRate.
        advanceRate: 5
    };

    function getCachedSettings() {
        try {
            const raw = localStorage.getItem(SETTINGS_CACHE_KEY);
            if (!raw) return null;
            const obj = JSON.parse(raw);
            return Object.assign({}, SETTINGS_DEFAULT, obj || {});
        } catch (_) {
            return null;
        }
    }
    function setCachedSettings(s) {
        try { localStorage.setItem(SETTINGS_CACHE_KEY, JSON.stringify(s)); } catch (_) {}
    }

    async function loadSettings() {
        try {
            const { db, firestore } = await window.__firebaseReady;
            const ref  = firestore.doc(db, 'settings', 'site');
            const snap = await firestore.getDoc(ref);
            if (snap.exists()) {
                const data = Object.assign({}, SETTINGS_DEFAULT, snap.data() || {});
                setCachedSettings(data);
                return data;
            }
        } catch (e) {
            console.warn('Settings read failed; using cache/defaults', e);
        }
        const cached = getCachedSettings();
        return cached || Object.assign({}, SETTINGS_DEFAULT);
    }

    async function saveSettings(patch) {
        const { db, auth, firestore } = await window.__firebaseReady;
        const user = auth.currentUser;
        if (!user) throw new Error('You must be signed in as the admin to change settings.');
        if (!isAdminEmail(user.email)) throw new Error('Only an admin user can change settings.');

        const ref = firestore.doc(db, 'settings', 'site');
        const payload = Object.assign({}, patch || {}, { updatedAt: firestore.serverTimestamp() });
        await firestore.setDoc(ref, payload, { merge: true });

        // Update local cache so subsequent reads on this device are instant.
        const merged = Object.assign({}, getCachedSettings() || SETTINGS_DEFAULT, patch || {});
        setCachedSettings(merged);
        return merged;
    }

    window.SettingsStore = {
        load:  loadSettings,
        save:  saveSettings,
        cached: getCachedSettings,
        DEFAULTS: Object.freeze(Object.assign({}, SETTINGS_DEFAULT))
    };

    // ───────────────────────────────────────────────────────────
    // UsersStore
    // ───────────────────────────────────────────────────────────
    let _currentProfile = null;
    const _authListeners = [];

    function fireAuthListeners(profile) {
        _authListeners.forEach(fn => {
            try { fn(profile); } catch (_) {}
        });
    }

    function cacheProfile(profile) {
        _currentProfile = profile;
        if (profile) {
            try { localStorage.setItem(USER_CACHE_KEY, JSON.stringify(profile)); } catch (_) {}
            try { localStorage.setItem('token', 'firebase'); } catch (_) {}
        } else {
            try { localStorage.removeItem(USER_CACHE_KEY); } catch (_) {}
            try { localStorage.removeItem('token'); } catch (_) {}
        }
    }

    function profileFromUser(authUser, extra) {
        if (!authUser) return null;
        const isAdmin = isAdminEmail(authUser.email);
        return {
            id: authUser.uid,
            uid: authUser.uid,
            email: authUser.email || '',
            username: (extra && extra.username) || authUser.displayName || (authUser.email || '').split('@')[0],
            fullName: (extra && extra.fullName) || authUser.displayName || '',
            phone:    (extra && extra.phone) || '',
            role:     isAdmin ? 'admin' : ((extra && extra.role) || 'user')
        };
    }

    async function fetchUserDoc(uid) {
        const { db, firestore } = await window.__firebaseReady;
        try {
            const snap = await firestore.getDoc(firestore.doc(db, 'users', uid));
            return snap.exists() ? snap.data() : null;
        } catch (_) { return null; }
    }

    async function lookupUsername(username) {
        const { db, firestore } = await window.__firebaseReady;
        try {
            const snap = await firestore.getDoc(firestore.doc(db, 'usernames', username.toLowerCase()));
            return snap.exists() ? snap.data() : null;
        } catch (_) { return null; }
    }

    async function registerUser({ username, email, password, fullName, phone }) {
        username = (username || '').trim();
        email    = (email || '').trim().toLowerCase();
        if (!username || !email || !password) throw new Error('All fields are required.');
        if (username.length < 3) throw new Error('Username must be at least 3 characters long.');
        if (username.toLowerCase() === 'deb') throw new Error('This username is reserved.');

        const { db, auth, firebaseAuth, firestore } = await window.__firebaseReady;

        // Best-effort uniqueness check (rules enforce too)
        const existing = await lookupUsername(username);
        if (existing) throw new Error('Username already taken.');

        const cred = await firebaseAuth.createUserWithEmailAndPassword(auth, email, password);
        const uid = cred.user.uid;

        try { await firebaseAuth.updateProfile(cred.user, { displayName: username }); } catch (_) {}

        // ── Send verification email (free, unlimited via Firebase Auth) ──
        // Admins are exempt — they're trusted by the email allowlist.
        var emailVerifSent = false;
        var emailVerifError = null;
        if (!isAdminEmail(email)) {
            try {
                // The redirect URL must be on your Firebase Authorized Domains
                // list (Firebase Console → Authentication → Settings →
                // Authorized domains). If it isn't, the call fails with
                // 'auth/unauthorized-continue-uri'. As a fallback we omit
                // the continue URL (Firebase then uses its default page).
                try {
                    await firebaseAuth.sendEmailVerification(cred.user, {
                        url: window.location.origin + '/index.html?verified=1',
                        handleCodeInApp: false
                    });
                    emailVerifSent = true;
                } catch (innerErr) {
                    if (innerErr && innerErr.code === 'auth/unauthorized-continue-uri') {
                        console.warn('Continue URL not authorized, retrying without redirect…');
                        await firebaseAuth.sendEmailVerification(cred.user);
                        emailVerifSent = true;
                    } else {
                        throw innerErr;
                    }
                }
            } catch (err) {
                emailVerifError = err && (err.code || err.message) || String(err);
                console.error('[Firebase] sendEmailVerification FAILED:', err);
                console.error('  → code:', err && err.code);
                console.error('  → message:', err && err.message);
                console.error('  → If code is auth/unauthorized-continue-uri:');
                console.error('     Add your domain at https://console.firebase.google.com/project/' +
                    (window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.projectId) +
                    '/authentication/settings (Authorized domains).');
            }
        }

        const batch = firestore.writeBatch(db);
        batch.set(firestore.doc(db, 'users', uid), {
            uid,
            email,
            username,
            usernameLower: username.toLowerCase(),
            fullName: fullName || '',
            phone: phone || '',
            role: isAdminEmail(email) ? 'admin' : 'user',
            emailVerified: !!cred.user.emailVerified, // false for non-admins
            createdAt: firestore.serverTimestamp()
        });
        batch.set(firestore.doc(db, 'usernames', username.toLowerCase()), {
            uid,
            email,
            username
        });
        await batch.commit();

        var profile = profileFromUser(cred.user, {
            username, fullName: fullName || '', phone: phone || '',
            role: isAdminEmail(email) ? 'admin' : 'user',
            emailVerified: !!cred.user.emailVerified
        });
        profile.emailVerifSent = emailVerifSent; // surface to UI
        return profile;
    }

    // Re-send the email-verification message for the currently signed-in user
    async function resendEmailVerification() {
        const { auth, firebaseAuth } = await window.__firebaseReady;
        if (!auth.currentUser) throw new Error('You must be signed in to resend.');
        if (auth.currentUser.emailVerified) throw new Error('Your email is already verified.');
        await firebaseAuth.sendEmailVerification(auth.currentUser, {
            url: window.location.origin + '/index.html?verified=1',
            handleCodeInApp: false
        });
    }

    // Force-refresh the auth user, then mirror the latest emailVerified
    // flag into the Firestore profile so admin tables and gates see it.
    async function refreshEmailVerifiedStatus() {
        const { auth, db, firestore } = await window.__firebaseReady;
        const u = auth.currentUser;
        if (!u) return false;
        try { await u.reload(); } catch (_) {}
        const ok = !!u.emailVerified;
        try {
            await firestore.updateDoc(firestore.doc(db, 'users', u.uid), {
                emailVerified: ok,
                emailVerifiedAt: ok ? firestore.serverTimestamp() : null
            });
        } catch (err) {
            console.warn('Failed to mirror emailVerified to Firestore:', err);
        }
        return ok;
    }

    // identifier may be a username OR an email
    async function loginUser(identifier, password) {
        if (!identifier || !password) throw new Error('Please enter your username/email and password.');
        const { auth, firebaseAuth } = await window.__firebaseReady;

        let email = identifier.trim();
        if (email.indexOf('@') === -1) {
            // Treat as username — look up the email
            const map = await lookupUsername(email);
            if (!map || !map.email) throw new Error('Invalid username/email or password.');
            email = map.email;
        }
        try {
            const cred = await firebaseAuth.signInWithEmailAndPassword(auth, email, password);
            const extra = await fetchUserDoc(cred.user.uid).catch(() => null);

            // Soft-disable: if the admin marked this profile disabled, refuse login.
            if (extra && extra.disabled === true) {
                try { await firebaseAuth.signOut(auth); } catch (_) {}
                throw new Error('This account has been disabled. Please contact support.');
            }

            // onAuthStateChanged will run cacheProfile; but also return a profile now
            const profile = profileFromUser(cred.user, extra);
            cacheProfile(profile);
            return profile;
        } catch (err) {
            // Map common Firebase errors to friendly text
            const code = err && err.code;
            if (code === 'auth/wrong-password' || code === 'auth/user-not-found' || code === 'auth/invalid-credential') {
                throw new Error('Invalid username/email or password.');
            }
            if (code === 'auth/too-many-requests') {
                throw new Error('Too many failed attempts. Please try again in a few minutes.');
            }
            throw new Error(err.message || 'Login failed.');
        }
    }

    async function logoutUser() {
        const { auth, firebaseAuth } = await window.__firebaseReady;
        await firebaseAuth.signOut(auth);
        cacheProfile(null);
    }

    // ── Forgot password / username helpers ──
    async function sendPasswordReset(identifier) {
        if (!identifier) throw new Error('Please enter your username or email.');
        const { auth, firebaseAuth } = await window.__firebaseReady;
        let email = identifier.trim();
        if (email.indexOf('@') === -1) {
            const map = await lookupUsername(email);
            if (!map || !map.email) throw new Error('We could not find that username.');
            email = map.email;
        }
        try {
            await firebaseAuth.sendPasswordResetEmail(auth, email);
            return email;
        } catch (err) {
            const code = err && err.code;
            if (code === 'auth/user-not-found') throw new Error('No account found for that email.');
            if (code === 'auth/invalid-email') throw new Error('That does not look like a valid email.');
            throw new Error(err.message || 'Could not send reset email.');
        }
    }

    // Find the username(s) tied to an email.
    // Uses a Firestore query on usersnames.email (works because rules
    // allow public read of the usernames collection).
    async function lookupUsernamesByEmail(email) {
        if (!email) throw new Error('Please enter your email.');
        const { db, firestore } = await window.__firebaseReady;
        const lower = email.trim().toLowerCase();
        const q = firestore.query(
            firestore.collection(db, 'usernames'),
            firestore.where('email', '==', lower)
        );
        const snap = await firestore.getDocs(q);
        const out = [];
        snap.forEach(d => {
            const data = d.data() || {};
            if (data.username) out.push(data.username);
            else out.push(d.id);
        });
        return out;
    }

    async function updateProfile(updates) {
        const { db, auth, firestore } = await window.__firebaseReady;
        const user = auth.currentUser;
        if (!user) throw new Error('Not signed in.');
        const allowed = {};
        if (typeof updates.fullName === 'string') allowed.fullName = updates.fullName;
        if (typeof updates.phone    === 'string') allowed.phone    = updates.phone;
        if (!Object.keys(allowed).length) return _currentProfile;
        await firestore.setDoc(firestore.doc(db, 'users', user.uid), allowed, { merge: true });
        if (_currentProfile) {
            Object.assign(_currentProfile, allowed);
            cacheProfile(_currentProfile);
        }
        return _currentProfile;
    }

    function onAuthChange(cb) {
        if (typeof cb !== 'function') return () => {};
        _authListeners.push(cb);
        // Fire immediately with the current cached profile (may be null)
        try { cb(_currentProfile); } catch (_) {}
        return function unsubscribe() {
            const i = _authListeners.indexOf(cb);
            if (i >= 0) _authListeners.splice(i, 1);
        };
    }

    function getCurrentUser() {
        if (_currentProfile) return _currentProfile;
        try {
            const raw = localStorage.getItem(USER_CACHE_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (_) { return null; }
    }

    function isAdmin() {
        const u = getCurrentUser();
        return !!u && (isAdminEmail(u.email) || u.role === 'admin' || u.username === 'deb');
    }

    // ── Admin-only helpers (Firestore rules also enforce these) ──
    function ensureAdmin() {
        if (!isAdmin()) throw new Error('Admin access required.');
    }

    async function listAllUsers() {
        ensureAdmin();
        const { db, firestore } = await window.__firebaseReady;
        const snap = await firestore.getDocs(firestore.collection(db, 'users'));
        const list = [];
        snap.forEach(d => list.push({ uid: d.id, ...(d.data() || {}) }));
        // newest first
        list.sort((a, b) => {
            const ta = (a.createdAt && a.createdAt.toMillis) ? a.createdAt.toMillis() : 0;
            const tb = (b.createdAt && b.createdAt.toMillis) ? b.createdAt.toMillis() : 0;
            return tb - ta;
        });
        return list;
    }

    // Soft-disable: flips a `disabled` boolean on the user's profile doc.
    // The login flow checks this and refuses entry.
    async function setUserDisabled(uid, disabled) {
        ensureAdmin();
        const { db, firestore } = await window.__firebaseReady;
        await firestore.setDoc(
            firestore.doc(db, 'users', uid),
            { disabled: !!disabled, disabledAt: disabled ? firestore.serverTimestamp() : null },
            { merge: true }
        );
    }

    // Removes the user's Firestore profile + username mapping.
    // ⚠️ Does NOT delete the Firebase Auth account itself — that requires
    // server-side Admin SDK. We provide a Console deep-link instead.
    async function deleteUserProfile(uid, username) {
        ensureAdmin();
        const { db, firestore } = await window.__firebaseReady;
        const batch = firestore.writeBatch(db);
        batch.delete(firestore.doc(db, 'users', uid));
        if (username) {
            batch.delete(firestore.doc(db, 'usernames', username.toLowerCase()));
        }
        await batch.commit();
    }

    // Direct password-reset for an arbitrary email (admin convenience).
    async function adminSendPasswordReset(email) {
        ensureAdmin();
        if (!email) throw new Error('No email provided.');
        const { auth, firebaseAuth } = await window.__firebaseReady;
        await firebaseAuth.sendPasswordResetEmail(auth, email);
        return email;
    }

    // Admin-only: set or clear a per-user advance-rate override (percentage).
    // Pass a number 0–100 to override; pass null/undefined to clear and fall
    // back to the global SettingsStore advanceRate.
    async function adminSetUserAdvanceRate(uid, ratePercentOrNull) {
        ensureAdmin();
        if (!uid) throw new Error('uid is required.');
        const { db, firestore } = await window.__firebaseReady;

        let payload;
        if (ratePercentOrNull === null || ratePercentOrNull === undefined || ratePercentOrNull === '') {
            // deleteField clears the override so checkout falls back to global.
            payload = { advanceRate: firestore.deleteField() };
        } else {
            const n = Number(ratePercentOrNull);
            if (!isFinite(n) || n < 0 || n > 100) {
                throw new Error('Advance rate must be a number between 0 and 100.');
            }
            payload = { advanceRate: n };
        }
        await firestore.setDoc(firestore.doc(db, 'users', uid), payload, { merge: true });
    }

    // Returns the advance rate (in percent) that should apply to a given
    // user. Logic:
    //   1. If the user's profile has a numeric advanceRate, use that.
    //   2. Otherwise use the site-wide SettingsStore advanceRate.
    //   3. Fallback to 5 if neither is configured.
    async function getEffectiveAdvanceRate(profile) {
        // per-user override?
        if (profile && typeof profile.advanceRate === 'number' && isFinite(profile.advanceRate)) {
            return profile.advanceRate;
        }
        // global default
        try {
            const s = await window.SettingsStore.load();
            if (s && typeof s.advanceRate === 'number' && isFinite(s.advanceRate)) {
                return s.advanceRate;
            }
        } catch (_) {}
        return 5;
    }

    window.UsersStore = {
        login:                    loginUser,
        register:                 registerUser,
        logout:                   logoutUser,
        onAuthChange:             onAuthChange,
        getCurrentUser:           getCurrentUser,
        isAdmin:                  isAdmin,
        updateProfile:            updateProfile,
        sendPasswordReset:        sendPasswordReset,
        lookupUsernamesByEmail:   lookupUsernamesByEmail,
        // email-verification:
        resendEmailVerification:  resendEmailVerification,
        refreshEmailVerifiedStatus: refreshEmailVerifiedStatus,
        // admin-only:
        listAllUsers:             listAllUsers,
        setUserDisabled:          setUserDisabled,
        deleteUserProfile:        deleteUserProfile,
        adminSendPasswordReset:   adminSendPasswordReset,
        adminSetUserAdvanceRate:  adminSetUserAdvanceRate,
        getEffectiveAdvanceRate:  getEffectiveAdvanceRate,
        // expose so checkout.js can grab the latest profile (incl. advanceRate)
        fetchUserDoc: async function (uid) {
            return fetchUserDoc(uid);
        }
    };
})();
