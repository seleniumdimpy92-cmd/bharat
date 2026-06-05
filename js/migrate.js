/* ── migrate.js ──────────────────────────────────────────────
   Standalone admin tool: copy all Firestore documents between two
   Firebase projects (primary ↔ secondary).

   Pattern: we load TWO Firebase apps in parallel, named "PRI" and
   "SEC", each with its own auth + firestore. Reads from one, writes
   to the other. Cloudinary images are NOT touched — gallery URLs in
   the doc data already point at Cloudinary so they keep working as
   long as both projects share the same gallery doc payload.

   This file is loaded as <script type="module"> so we can `import`
   the Firebase v10 modular SDK directly.
   ────────────────────────────────────────────────────────────── */

const SDK = '10.13.2';
const APP_URL  = `https://www.gstatic.com/firebasejs/${SDK}/firebase-app.js`;
const AUTH_URL = `https://www.gstatic.com/firebasejs/${SDK}/firebase-auth.js`;
const FS_URL   = `https://www.gstatic.com/firebasejs/${SDK}/firebase-firestore.js`;

// Collections we know the site uses. Edit this array if you add a new one.
const KNOWN_COLLECTIONS = [
    { name: 'packages', label: 'Packages',           note: 'tour package catalogue' },
    { name: 'users',    label: 'User profiles',       note: 'usernames, phone, role' },
    { name: 'bookings', label: 'Bookings',            note: 'paid + pending bookings' },
    { name: 'gallery',  label: 'Gallery (Firestore meta)', note: 'images live in Cloudinary' },
    { name: 'settings', label: 'Site settings',       note: 'payments toggle, advance %, etc.' }
];

// Lazy-load the SDK once
const sdkReady = (async () => {
    const [appMod, authMod, fsMod] = await Promise.all([
        import(APP_URL),
        import(AUTH_URL),
        import(FS_URL)
    ]);
    return { appMod, authMod, fsMod };
})();

// Initialise both Firebase apps in parallel
async function initBothApps() {
    const { appMod, authMod, fsMod } = await sdkReady;

    if (!window.FIREBASE_PROJECTS || !window.FIREBASE_PROJECTS.primary || !window.FIREBASE_PROJECTS.secondary) {
        throw new Error('FIREBASE_PROJECTS map missing — load js/firebase-config.js first');
    }
    const priCfg = window.FIREBASE_PROJECTS.primary;
    const secCfg = window.FIREBASE_PROJECTS.secondary;

    const priApp = appMod.initializeApp(priCfg, 'PRI');
    const secApp = appMod.initializeApp(secCfg, 'SEC');

    const PRI = {
        cfg: priCfg, app: priApp,
        auth: authMod.getAuth(priApp),
        db:   fsMod.getFirestore(priApp)
    };
    const SEC = {
        cfg: secCfg, app: secApp,
        auth: authMod.getAuth(secApp),
        db:   fsMod.getFirestore(secApp)
    };
    try { await authMod.setPersistence(PRI.auth, authMod.browserLocalPersistence); } catch(_){}
    try { await authMod.setPersistence(SEC.auth, authMod.browserLocalPersistence); } catch(_){}
    return { PRI, SEC, authMod, fsMod };
}

// ── DOM helpers ───────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const logBox = $('logBox');
function logLine(level, msg) {
    const el = document.createElement('div');
    el.className = level || '';
    el.textContent = msg;
    logBox.appendChild(el);
    logBox.scrollTop = logBox.scrollHeight;
}
function clearLog() { logBox.textContent = ''; }
function setProgress(pct) {
    const bar = $('progBar');
    if (bar) bar.style.width = Math.max(0, Math.min(100, pct)) + '%';
}
function setStatus(side, ok, text) {
    const el = side === 'PRI' ? $('authStPri') : $('authStSec');
    el.classList.remove('ok','err');
    if (ok === true)  el.classList.add('ok');
    if (ok === false) el.classList.add('err');
    el.textContent = text;
}

// ── Render the static project IDs and collection list ─────────
function renderStaticUI() {
    const pri = window.FIREBASE_PROJECTS.primary;
    const sec = window.FIREBASE_PROJECTS.secondary;
    $('pidPri').textContent = pri.projectId;
    $('pidSec').textContent = sec.projectId;
    $('authPidPri').textContent = pri.projectId;
    $('authPidSec').textContent = sec.projectId;
    $('leadPriId').textContent = pri.projectId;
    $('leadSecId').textContent = sec.projectId;

    // Mark the active one
    const active = window.FIREBASE_USE === 'secondary' ? 'sec' : 'pri';
    if (active === 'pri') $('labelPri').classList.add('active');
    else                  $('labelSec').classList.add('active');

    // Collections
    const box = $('collectionsBox');
    box.innerHTML = '';
    KNOWN_COLLECTIONS.forEach((c, i) => {
        const row = document.createElement('label');
        row.className = 'col-row';
        row.innerHTML =
            `<input type="checkbox" data-col="${c.name}" checked>` +
            `<code>${c.name}</code>` +
            `<span class="ccount" title="${c.note}">…</span>`;
        box.appendChild(row);
    });
}

// ── Auth helpers ──────────────────────────────────────────────
let APPS = null;     // { PRI, SEC, authMod, fsMod }
async function ensureApps() {
    if (APPS) return APPS;
    APPS = await initBothApps();
    APPS.authMod.onAuthStateChanged(APPS.PRI.auth, u => updateAuthDisplay('PRI', u));
    APPS.authMod.onAuthStateChanged(APPS.SEC.auth, u => updateAuthDisplay('SEC', u));
    return APPS;
}
function updateAuthDisplay(side, user) {
    if (user && user.email) setStatus(side, true,  '✓ ' + user.email);
    else                    setStatus(side, false, 'not signed in');
    refreshActionAvailability();
}
async function signIn(side, email, pwd) {
    const { authMod, PRI, SEC } = await ensureApps();
    const auth = side === 'PRI' ? PRI.auth : SEC.auth;
    setStatus(side, null, 'signing in…');
    try {
        await authMod.signInWithEmailAndPassword(auth, email, pwd);
        logLine('ok', `[${side}] signed in as ${email}`);
    } catch (err) {
        logLine('err', `[${side}] sign-in failed: ${err.code || err.message}`);
        setStatus(side, false, err.code || 'failed');
    }
}

function bothSignedIn() {
    return !!(APPS && APPS.PRI.auth.currentUser && APPS.SEC.auth.currentUser);
}
function refreshActionAvailability() {
    const ok = bothSignedIn();
    $('mirrorBtn').disabled = !ok;
    $('purgeBtn').disabled  = !ok;
    // Hide/show the sign-in card depending on auth state
    const card = $('authCard');
    const priOk = !!(APPS && APPS.PRI.auth.currentUser);
    const secOk = !!(APPS && APPS.SEC.auth.currentUser);
    if (card) {
        // Collapse cleanly when both are already signed-in (persisted session)
        card.style.display = (priOk && secOk) ? 'none' : '';
        // Hide individual sides that are already authenticated, leave the
        // unsigned side visible so the user can complete the missing one.
        const priSide = card.querySelector('.auth-side:nth-child(1)');
        const secSide = card.querySelector('.auth-side:nth-child(2)');
        if (priSide) priSide.style.opacity = priOk ? '.55' : '1';
        if (secSide) secSide.style.opacity = secOk ? '.55' : '1';
    }
    if (!ok) return;
    // Once both signed in, auto-scan if we haven't yet
    if (!window.__scanned) doScan();
}

// ── Scan: count docs in each collection on each side ──────────
async function doScan() {
    if (!APPS) await ensureApps();
    if (!bothSignedIn()) {
        logLine('warn', 'Sign in to both projects before scanning.');
        return;
    }
    window.__scanned = true;
    logLine('info', '— Scanning collections —');
    let priTotal = 0, secTotal = 0;
    for (const c of KNOWN_COLLECTIONS) {
        try {
            const [priCount, secCount] = await Promise.all([
                countCol(APPS.PRI.db, c.name).catch(e => { logLine('warn', `[PRI/${c.name}] ${e.message}`); return null; }),
                countCol(APPS.SEC.db, c.name).catch(e => { logLine('warn', `[SEC/${c.name}] ${e.message}`); return null; })
            ]);
            const row = document.querySelector(`[data-col="${c.name}"]`).closest('.col-row');
            const meta = row.querySelector('.ccount');
            const pStr = priCount == null ? '—' : priCount;
            const sStr = secCount == null ? '—' : secCount;
            meta.textContent = `${pStr} → ${sStr}`;
            if (priCount != null) priTotal += priCount;
            if (secCount != null) secTotal += secCount;
            logLine('dim', `${c.name.padEnd(10)}  PRI=${pStr}  SEC=${sStr}`);
        } catch (err) {
            logLine('err', `Scan error on ${c.name}: ${err.message}`);
        }
    }
    $('docsPri').textContent = priTotal;
    $('docsSec').textContent = secTotal;
    logLine('info', `— Done. Total docs: PRI=${priTotal}  SEC=${secTotal} —`);
}
async function countCol(db, name) {
    const { collection, getDocs } = APPS.fsMod;
    const snap = await getDocs(collection(db, name));
    return snap.size;
}

// ── Mirror: copy every doc from src→dst for selected collections ──
async function mirror({ purgeFirst = false } = {}) {
    if (!APPS) await ensureApps();
    if (!bothSignedIn()) { logLine('err', 'Sign in to both projects first.'); return; }

    const { fsMod, PRI, SEC } = APPS;
    const dir = $('directionSel').value; // 'p2s' | 's2p'
    const SRC = dir === 'p2s' ? PRI : SEC;
    const DST = dir === 'p2s' ? SEC : PRI;
    const srcLabel = dir === 'p2s' ? 'PRI' : 'SEC';
    const dstLabel = dir === 'p2s' ? 'SEC' : 'PRI';

    const selected = Array.from(document.querySelectorAll('[data-col]'))
        .filter(cb => cb.checked).map(cb => cb.dataset.col);
    if (!selected.length) { logLine('warn', 'No collections selected.'); return; }

    const action = purgeFirst ? 'PURGE & MIRROR' : 'mirror';
    if (!confirm(
        `${action} ${selected.length} collection(s) from\n` +
        `  ${SRC.cfg.projectId}\n→ ${DST.cfg.projectId}\n\n` +
        (purgeFirst
            ? '⚠️ ALL existing docs in those collections at the destination will be DELETED first.\n\n'
            : 'Existing docs at the destination with the same ID will be OVERWRITTEN.\n\n') +
        'Continue?'
    )) return;

    setProgress(0);
    $('mirrorBtn').disabled = true;
    $('purgeBtn').disabled  = true;
    clearLog();
    logLine('info', '=== ' + srcLabel + ' \u2192 ' + dstLabel + ' (' + action + ') ===');
    logLine('dim',  '    source : ' + SRC.cfg.projectId);
    logLine('dim',  '    target : ' + DST.cfg.projectId);

    let totalCopied = 0, totalDeleted = 0, totalErrors = 0;

    // Estimate total work to drive the progress bar
    const totals = {};
    for (const name of selected) {
        try {
            totals[name] = await countCol(SRC.db, name);
        } catch (e) { totals[name] = 0; }
    }
    const totalWork = selected.reduce((s, n) => s + (totals[n] || 0), 0) || 1;
    let workDone = 0;

    for (const name of selected) {
        logLine('info', '\u2192 ' + name + ' (' + totals[name] + ' docs)');

        // Optional purge step
        if (purgeFirst) {
            try {
                const dstSnap = await fsMod.getDocs(fsMod.collection(DST.db, name));
                const batches = chunk(dstSnap.docs, 400);
                for (const batchDocs of batches) {
                    const batch = fsMod.writeBatch(DST.db);
                    batchDocs.forEach(d => batch.delete(fsMod.doc(DST.db, name, d.id)));
                    await batch.commit();
                    totalDeleted += batchDocs.length;
                }
                logLine('warn', '   purged ' + dstSnap.size + ' existing docs from destination');
            } catch (err) {
                totalErrors++;
                logLine('err', '   purge failed: ' + err.message);
            }
        }

        // Read source then bulk write to destination in chunks of 400 (Firestore limit is 500/batch)
        try {
            const srcSnap = await fsMod.getDocs(fsMod.collection(SRC.db, name));
            const docs = srcSnap.docs;
            const batches = chunk(docs, 400);
            for (const batchDocs of batches) {
                const batch = fsMod.writeBatch(DST.db);
                batchDocs.forEach(d => {
                    const data = d.data() || {};
                    batch.set(fsMod.doc(DST.db, name, d.id), data, { merge: false });
                });
                await batch.commit();
                totalCopied += batchDocs.length;
                workDone   += batchDocs.length;
                setProgress((workDone / totalWork) * 100);
            }
            logLine('ok',  '   \u2713 copied ' + docs.length + ' docs');
        } catch (err) {
            totalErrors++;
            logLine('err', '   copy failed: ' + (err.code ? err.code + ' — ' : '') + err.message);
        }
    }

    setProgress(100);
    logLine('info', '=== Done ===');
    logLine('ok',   'copied:  ' + totalCopied);
    if (totalDeleted) logLine('warn', 'deleted: ' + totalDeleted);
    if (totalErrors)  logLine('err',  'errors:  ' + totalErrors);

    $('mirrorBtn').disabled = false;
    $('purgeBtn').disabled  = false;

    // Refresh counts
    setTimeout(doScan, 500);
}

function chunk(arr, n) {
    const out = [];
    for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
    return out;
}

// ── Wire up DOM ───────────────────────────────────────────────
function wire() {
    renderStaticUI();

    // Sign-in buttons
    $('authBtnPri').addEventListener('click', () => {
        const e = $('authEmailPri').value.trim();
        const p = $('authPwdPri').value;
        if (!e || !p) { logLine('warn', 'Enter email + password for primary'); return; }
        signIn('PRI', e, p);
    });
    $('authBtnSec').addEventListener('click', () => {
        const e = $('authEmailSec').value.trim();
        const p = $('authPwdSec').value;
        if (!e || !p) { logLine('warn', 'Enter email + password for secondary'); return; }
        signIn('SEC', e, p);
    });

    // Direction toggle flips arrow icon
    const dirSel = $('directionSel');
    const arrow  = $('arrowEl');
    dirSel.addEventListener('change', () => {
        if (dirSel.value === 's2p') arrow.classList.add('flipped');
        else                        arrow.classList.remove('flipped');
        // Also relabel the active card hint
        const pri = $('labelPri'), sec = $('labelSec');
        if (dirSel.value === 'p2s') {
            pri.textContent = 'Primary (source)';
            sec.textContent = 'Secondary (destination)';
        } else {
            pri.textContent = 'Primary (destination)';
            sec.textContent = 'Secondary (source)';
        }
    });

    // Scan & mirror buttons
    $('scanBtn').addEventListener('click', doScan);
    $('mirrorBtn').addEventListener('click', () => mirror({ purgeFirst: false }));
    $('purgeBtn').addEventListener('click',  () => mirror({ purgeFirst: true }));

    // Initialise both Firebase apps. browserLocalPersistence (set in
    // initBothApps) means a session signed in once on this browser is
    // restored automatically — no password retyping. We just wait for
    // both onAuthStateChanged callbacks to fire at least once so we
    // know the persisted state.
    ensureApps().then(() => {
        logLine('info', 'Both Firebase apps initialised.');
        logLine('dim', 'PRI = ' + APPS.PRI.cfg.projectId + '  SEC = ' + APPS.SEC.cfg.projectId);
        // Wait briefly for persisted-auth to resolve, then attempt to scan.
        // If both are already signed in (typical 2nd+ visit), the user
        // never sees the sign-in form.
        setTimeout(() => {
            if (bothSignedIn()) {
                logLine('ok', 'Persisted sessions detected — no password needed.');
                refreshActionAvailability();
            } else {
                logLine('warn', 'One or both projects need a one-time sign-in below. ' +
                    'After this first time, the session is remembered on this browser forever.');
            }
        }, 800);
    }).catch(err => {
        logLine('err', 'Init failed: ' + err.message);
    });
}

// Light access guard — only admin emails listed in firebase-config.js
(function accessGuard() {
    let raw;
    try { raw = JSON.parse(localStorage.getItem('currentUser') || 'null'); } catch (e) {}
    const adminEmails = (Array.isArray(window.ADMIN_EMAILS) ? window.ADMIN_EMAILS : [])
        .map(e => String(e).toLowerCase());
    const email = raw && raw.email ? String(raw.email).toLowerCase() : '';
    const isAdmin = raw && (
        adminEmails.includes(email) ||
        raw.role === 'admin' ||
        (raw.username || '').toLowerCase() === 'deb'
    );
    if (!isAdmin) {
        // Soft warning but still let admin through if they haven't logged into the
        // main site in this browser session. The actual privileged calls are
        // guarded by Firestore rules in the destination project anyway.
        const wrap = document.querySelector('.wrap');
        const note = document.createElement('div');
        note.className = 'alert alert-err';
        note.innerHTML = '<i class="fas fa-lock"></i><div>You do not appear to be logged in to the main site as an admin. ' +
            'You can still try to use this tool, but writes will be rejected by the destination project unless you sign in with an admin account below.</div>';
        wrap.insertBefore(note, wrap.children[1]);
    }
})();

document.addEventListener('DOMContentLoaded', wire);
