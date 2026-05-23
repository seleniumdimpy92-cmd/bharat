// ── Firebase project configuration ──────────────────────────────
// This config is **safe to ship to browsers** — it identifies the
// project but does not grant write access. Real security is enforced
// by Firestore security rules (see firestore.rules in the repo).

window.FIREBASE_CONFIG = {
    apiKey: "AIzaSyCRezAvtDfPv9vHxOXF7zhv5WZhCLRFBho",
    authDomain: "andaman-b886d.firebaseapp.com",
    projectId: "andaman-b886d",
    storageBucket: "andaman-b886d.firebasestorage.app",
    messagingSenderId: "1090773870572",
    appId: "1:1090773870572:web:f1d772ecf4937b205942c9",
    measurementId: "G-B2EH7QRMGE"
};

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
window.GA4_CONFIG = {
    // Same Measurement ID as window.FIREBASE_CONFIG.measurementId — your
    // Firebase project's auto-linked GA4 property. Open
    // https://analytics.google.com to manage the property.
    measurementId: "G-B2EH7QRMGE",
    // Web Stream ID from GA4 → Admin → Data streams. Used by the
    // realtime iframe widget in the admin dashboard.
    streamId:      "14922182432"
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
