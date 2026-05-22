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
    cloudName:    "REPLACE_WITH_YOUR_CLOUD_NAME",
    uploadPreset: "andaman_gallery"
};
