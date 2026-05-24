// ── Firebase project configuration ──────────────────────────────
// This config is **safe to ship to browsers** — it identifies the
// project but does not grant write access. Real security is enforced
// by Firestore security rules (see firestore.rules in the repo).
//
// ── TWO-PROJECT SETUP ──────────────────────────────────────────
// We have two Firebase projects available:
//   • PRIMARY  : andaman-b886d  (current production — all live data)
//   • SECONDARY: andaman-c85f0  (new — empty, awaiting migration)
//
// To switch the live site to the new project, set window.FIREBASE_USE
// below to "secondary" and re-deploy.  To go back, change it to
// "primary" again — no other file edits needed.
//
// IMPORTANT: each project is a completely separate database, so users,
// bookings, packages, gallery items etc. are NOT automatically copied
// between them. Migrate data manually via the Firebase Console
// (export → import) or with a one-off script BEFORE switching.

const FIREBASE_PROJECTS = {
    primary: {
        // andaman-b886d — original / production
        apiKey:            "AIzaSyCRezAvtDfPv9vHxOXF7zhv5WZhCLRFBho",
        authDomain:        "andaman-b886d.firebaseapp.com",
        projectId:         "andaman-b886d",
        storageBucket:     "andaman-b886d.firebasestorage.app",
        messagingSenderId: "1090773870572",
        appId:             "1:1090773870572:web:f1d772ecf4937b205942c9",
        measurementId:     "G-B2EH7QRMGE"
    },
    secondary: {
        // andaman-c85f0 — newly created, ready to migrate to
        apiKey:            "AIzaSyB13askn_x12iTHsWbgvYmUz6MVDfXEAco",
        authDomain:        "andaman-c85f0.firebaseapp.com",
        projectId:         "andaman-c85f0",
        storageBucket:     "andaman-c85f0.firebasestorage.app",
        messagingSenderId: "914557305468",
        appId:             "1:914557305468:web:7c2df6a76ddfeea4a17ff9",
        measurementId:     "G-98PFHRYCSR"
    }
};

// Per-host override:
//   • Anyone visiting localhost / 127.0.0.1 → uses the SECONDARY project
//     (handy for local dev so you don't write test data to production).
//   • Everyone else (incl. andamanvoyages.in) → uses PRIMARY.
// To change the production project, just flip the default below.
const _hostIsLocal = (typeof location !== 'undefined') &&
    /^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/.test(location.hostname);

window.FIREBASE_USE = window.FIREBASE_USE || (_hostIsLocal ? 'secondary' : 'primary');
window.FIREBASE_CONFIG = FIREBASE_PROJECTS[window.FIREBASE_USE] || FIREBASE_PROJECTS.primary;

// Expose both maps so other scripts (e.g. an admin migration tool) can
// reach into the secondary project without a hard refresh.
window.FIREBASE_PROJECTS = FIREBASE_PROJECTS;

console.info('[firebase] using project →', window.FIREBASE_CONFIG.projectId,
    '(' + window.FIREBASE_USE + ')');

// List of admin emails. Anyone signed in with one of these emails can
// write the packages collection and access the dashboard. Must match
// the `request.auth.token.email in [...]` check in firestore.rules.
window.ADMIN_EMAILS = [
    "deb@andamanvoyages.in",
    "admin@admin.com"
];

// Back-compat: keep a single ADMIN_EMAIL pointing at the first admin.
window.ADMIN_EMAIL = window.ADMIN_EMAILS[0];

// ── Cloudinary configuration (for the photo gallery uploads) ──
// Sign up free at https://cloudinary.com (no credit card needed) and
// create an Unsigned upload preset. Then fill in these two values:
//   1. cloudName    — top-left of your Cloudinary dashboard
//   2. uploadPreset — Settings → Upload → Add upload preset
//                     with Signing Mode = "Unsigned"
//
// This config is safe to ship to browsers: an unsigned preset can only
// upload, not delete or read other assets. Real protection: in your
// preset, restrict allowed formats and set a folder.
window.CLOUDINARY_CONFIG = {
    cloudName:    "dwy7k3uhv",
    uploadPreset: "andaman_gallery"
};

// ── Google Analytics 4 configuration ──────────────────────────
// 1. Sign up at https://analytics.google.com
// 2. Create a property → Web stream → copy the Measurement ID
//    (looks like "G-XXXXXXXXXX")
// 3. (Optional) From the same Web stream details page, copy the
//    Stream ID — a long number like "1234567890" — used by the
//    Realtime widget embedded in the admin dashboard.
//
// While these stay as placeholders, no tracking code is loaded
// and the dashboard tab shows a setup-needed banner. Both values
// are safe to ship to browsers — that's how GA4 works.
//
// ── GA4 identifiers — three numbers, three different roles ────
// Google Analytics 4 hands you THREE different IDs for the same
// "andaman-b886d" data stream. Don't confuse them:
//
//   • Measurement ID  → "G-XXXXXXXXXX" string
//                       Used by gtag.js to send events. This is the
//                       only one the public site (analytics.js) needs.
//
//   • Stream ID       → ~11-digit number ("14922182432")
//                       Identifies the *web data stream* inside the
//                       property. We don't currently use it (kept for
//                       backwards-compat).
//
//   • Property ID     → 9-digit number ("538554925")
//                       Identifies the GA4 property itself. The
//                       analytics.google.com URL you see in the address
//                       bar uses this format:
//                          /a<accountId>p<propertyId>/...
//                       The admin dashboard uses this to deep-link
//                       directly to YOUR property's reports (Realtime,
//                       Acquisition, Engagement, Monetization) instead
//                       of dumping the user on the GA4 home page.
//
// Where to find them: GA4 → Admin → (left col) Account details →
// noted under "Account ID"; (middle col) Property details → "Property ID";
// (right col) Data streams → click your stream → "Measurement ID" and
// "Stream ID".
//
// Heads-up on legacy IDs: "UA-XXXXXXXX-Y" / web-property numbers were
// the Universal Analytics format; UA was shut down 1-Jul-2024. Don't
// paste a UA ID into measurementId — gtag.js will silently no-op.
window.GA4_CONFIG = {
    // Same Measurement ID as window.FIREBASE_CONFIG.measurementId — your
    // Firebase project's auto-linked GA4 property. Open
    // https://analytics.google.com to manage the property.
    measurementId: "G-B2EH7QRMGE",
    // Web Stream ID from GA4 → Admin → Data streams.
    streamId:      "14922182432",
    // GA4 Property ID — used by dashboard.html to deep-link directly
    // into THIS property's reports and to drive the Looker Studio
    // embed's `dp56` data-source parameter. Account ID is the leading
    // half of the analytics.google.com URL prefix `a<accountId>p<id>`.
    propertyId:    "538554925",
    accountId:     "141318394"
};

// ── Flight affiliate program IDs ──────────────────────────────
// These plug into the partner search URLs in js/flights.js. Until you
// have an approved affiliate ID, leave the placeholder — the partner
// links still work, you just won't earn commission.
//
// How to apply (free, ~1 week to approval per partner):
//   • Skyscanner   → https://skyscanner.business
//   • MakeMyTrip   → https://affiliate.makemytrip.com
//   • EaseMyTrip   → https://www.easemytrip.com/affiliate.html
//   • Cleartrip    → https://www.cleartrip.com/affiliate
//   • Travelpayouts→ https://www.travelpayouts.com (aggregator — fastest,
//                    1-day approval, single dashboard for many airlines)
//
// See flights_setup.md in the repo for step-by-step instructions.
window.FLIGHT_AFFILIATES = {
    skyscanner:    { tag: "AFFID-SKYSCANNER",   subId: "andamanvoyages" },
    makemytrip:    { tag: "AFFID-MMT",          subId: "andamanvoyages" },
    easemytrip:    { tag: "AFFID-EMT",          subId: "andamanvoyages" },
    cleartrip:     { tag: "AFFID-CLEARTRIP",    subId: "andamanvoyages" },
    travelpayouts: { tag: "",                   marker: "" }   // optional widget
};
