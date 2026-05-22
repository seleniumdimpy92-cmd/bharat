/* Anti-snoop / security hardening (deterrent layer)
 *
 * IMPORTANT: This is just a UX deterrent. There is no way to truly hide
 * client-side JS from a determined attacker — they can always disable JS,
 * use curl/wget, or open DevTools before this script runs. The REAL
 * security comes from:
 *   • Firestore security rules (server-enforced)
 *   • Razorpay only accepting payments to your registered merchant
 *   • Firebase Auth handling passwords server-side
 *
 * This file simply discourages casual snooping.
 */
(function () {
    'use strict';

    // 1) Console warning (the "self-XSS" warning Facebook/etc. use)
    var bigStyle = 'color:#fff;background:#e74c3c;font-size:24px;font-weight:bold;padding:8px 16px;border-radius:4px;';
    var subStyle = 'color:#e74c3c;font-size:14px;';
    try {
        console.log('%c\u26A0  STOP!', bigStyle);
        console.log('%cThis is a developer console. If someone told you to paste code here to "unlock" something, they are trying to steal your account or payment details.\n\nNever paste code from strangers.\nFor support, call +91 88801 95191 or email booking@andamanvoyages.in', subStyle);
    } catch (e) {}

    // 2) Block right-click context menu on production pages
    //    (still allows form fields so users can paste)
    document.addEventListener('contextmenu', function (e) {
        var t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
        e.preventDefault();
    });

    // 3) Block common "View Source" / "DevTools" keyboard shortcuts.
    //    These are deterrents only — F12 menu in browser still works.
    document.addEventListener('keydown', function (e) {
        var key = (e.key || '').toLowerCase();
        // F12
        if (e.key === 'F12') { e.preventDefault(); return; }
        // Ctrl/Cmd + U  (view source)
        if ((e.ctrlKey || e.metaKey) && key === 'u') { e.preventDefault(); return; }
        // Ctrl/Cmd + Shift + I/J/C  (devtools / console / inspect)
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && (key === 'i' || key === 'j' || key === 'c')) {
            e.preventDefault();
            return;
        }
        // Ctrl/Cmd + S  (save page) — also discourage downloading the HTML
        if ((e.ctrlKey || e.metaKey) && key === 's') {
            // Allow on form fields
            var t = e.target;
            if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
            e.preventDefault();
        }
    });

    // 4) Disable text selection on non-input areas (comment out if you want copy)
    // document.addEventListener('selectstart', function (e) {
    //     var t = e.target;
    //     if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    //     e.preventDefault();
    // });

    // 5) Detect open DevTools and (optionally) freeze the page or warn.
    //    Heuristic: if window.outerWidth - window.innerWidth > 160px, devtools
    //    might be docked. This is unreliable — only used as a soft signal.
    var lastWarn = 0;
    function checkDevTools() {
        var diff = window.outerHeight - window.innerHeight;
        var diffW = window.outerWidth - window.innerWidth;
        if ((diff > 200 || diffW > 200) && Date.now() - lastWarn > 60000) {
            lastWarn = Date.now();
            try {
                console.log('%cDeveloper tools detected. For security, please close them while using this site.', 'color:#e74c3c;font-size:14px;');
            } catch (e) {}
        }
    }
    setInterval(checkDevTools, 1500);
})();