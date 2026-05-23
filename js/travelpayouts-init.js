/* travelpayouts-init.js — Loads the Travelpayouts site-tracking pixel.
 * This registers andamanvoyages.in clicks against your Travelpayouts
 * partner ID so flight-booking commissions flow back to you.
 *
 * Travelpayouts ToS-compliant: this is the official tracker snippet.
 */
(function () {
    'use strict';
    try {
        var s = document.createElement('script');
        s.async = 1;
        s.src = 'https://emrldtp.com/NTMyMDE2.js?t=532016';
        s.setAttribute('data-noptimize', '1');
        s.setAttribute('data-cfasync', 'false');
        s.setAttribute('data-no-defer', '1');
        document.head.appendChild(s);
    } catch (e) {
        // Fail silently — tracker isn't critical for page function
    }
})();