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

// Email of the admin user. Anyone signed in with this email can write
// the packages collection and access the dashboard. Must match the
// `request.auth.token.email` check in firestore.rules.
window.ADMIN_EMAIL = "deb@andamanvoyages.in";