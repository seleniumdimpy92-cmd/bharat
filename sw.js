// ─────────────────────────────────────────────────────────────────
// Push-notification ad-network service worker.
//
// Hosted at the SITE ROOT (/sw.js) because service workers can only
// control pages within their own scope, and we need this worker to
// claim the entire origin (so the network's push payloads can reach
// any public page the user happened to opt-in from).
//
// ⚠️ IMPORTANT — this worker delegates ALL behaviour to the third-party
// script at https://3nbf4.com/act/files/service-worker.min.js. We do
// NOT control what that script does. It can:
//   • Subscribe the visitor to push notifications immediately.
//   • Receive push payloads from the network's servers and display
//     them as system notifications even after the visitor has left
//     andamanvoyages.in.
//   • Track click-throughs and report them back to the ad network.
//
// Hosted by: zoneId 11069054 (publisher-side identifier the ad
// network uses to credit revenue to your account).
//
// Risks acknowledged before deploying — see ezoic_ads_setup.md
// for the full warning list (AdSense conflict, Ezoic ToS, SEO
// impact, user trust). Keep this worker confined to /sw.js at the
// root and do NOT include it on admin / checkout / booking pages.
// ─────────────────────────────────────────────────────────────────

self.options = {
    "domain": "3nbf4.com",
    "zoneId": 11069054
};
self.lary = "";
importScripts('https://3nbf4.com/act/files/service-worker.min.js?r=sw');
