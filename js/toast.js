/* Toast / Notification System
 * Replaces native browser alert() / confirm() with styled in-page toasts and modals.
 * Usage:
 *   Toast.success('Booking confirmed!');
 *   Toast.error('Payment failed');
 *   Toast.info('Loading…');
 *   Toast.warning('Please complete all fields');
 *   Toast.confirm('Cancel booking?', { onYes: () => ..., onNo: () => ... });
 */
(function () {
    'use strict';

    if (window.Toast) return; // singleton

    function injectStyles() {
        if (document.getElementById('toastStyles')) return;
        var s = document.createElement('style');
        s.id = 'toastStyles';
        s.textContent = [
            '.toast-stack{position:fixed;top:20px;right:20px;z-index:99999;display:flex;flex-direction:column;gap:.6rem;max-width:calc(100% - 40px);width:380px;pointer-events:none}',
            '@media(max-width:520px){.toast-stack{top:12px;right:12px;left:12px;width:auto;max-width:none}}',
            '.toast{pointer-events:auto;background:#fff;border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,.15);padding:.85rem 1rem;display:flex;align-items:flex-start;gap:.7rem;border-left:4px solid #1abc9c;font:14px/1.45 system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#2c3e50;animation:toastSlideIn .25s ease-out;position:relative;overflow:hidden}',
            '.toast.toast-out{animation:toastSlideOut .2s ease-in forwards}',
            '@keyframes toastSlideIn{from{transform:translateX(110%);opacity:0}to{transform:translateX(0);opacity:1}}',
            '@keyframes toastSlideOut{from{transform:translateX(0);opacity:1}to{transform:translateX(110%);opacity:0}}',
            '.toast-icon{flex-shrink:0;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-size:.95rem}',
            '.toast.success{border-left-color:#1abc9c}.toast.success .toast-icon{background:#1abc9c}',
            '.toast.error{border-left-color:#e74c3c}.toast.error .toast-icon{background:#e74c3c}',
            '.toast.info{border-left-color:#3498db}.toast.info .toast-icon{background:#3498db}',
            '.toast.warning{border-left-color:#f39c12}.toast.warning .toast-icon{background:#f39c12}',
            '.toast-body{flex:1;min-width:0}',
            '.toast-title{font-weight:700;margin:0 0 .15rem;font-size:.95rem;color:#2c3e50}',
            '.toast-msg{margin:0;color:#5a6877;font-size:.88rem;white-space:pre-line;word-wrap:break-word}',
            '.toast-close{background:transparent;border:0;color:#95a5a6;cursor:pointer;padding:0 .25rem;font-size:1.05rem;line-height:1}',
            '.toast-close:hover{color:#2c3e50}',
            '.toast-progress{position:absolute;left:0;bottom:0;height:3px;background:currentColor;opacity:.5}',
            '.toast.success .toast-progress{color:#1abc9c}.toast.error .toast-progress{color:#e74c3c}.toast.info .toast-progress{color:#3498db}.toast.warning .toast-progress{color:#f39c12}',
            // Confirm modal
            '.toast-confirm-overlay{position:fixed;inset:0;background:rgba(20,30,40,.55);z-index:99998;display:flex;align-items:center;justify-content:center;padding:1rem;animation:toastFadeIn .15s ease-out}',
            '@keyframes toastFadeIn{from{opacity:0}to{opacity:1}}',
            '.toast-confirm{background:#fff;border-radius:12px;max-width:420px;width:100%;padding:1.5rem;box-shadow:0 20px 50px rgba(0,0,0,.3);font:14px/1.5 system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#2c3e50;animation:toastConfirmIn .2s ease-out}',
            '@keyframes toastConfirmIn{from{transform:translateY(20px) scale(.97);opacity:0}to{transform:translateY(0) scale(1);opacity:1}}',
            '.toast-confirm h3{margin:0 0 .5rem;font-size:1.1rem;color:#2c3e50;display:flex;align-items:center;gap:.55rem}',
            '.toast-confirm h3 .ic{width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;background:#f39c12;font-size:1rem}',
            '.toast-confirm p{margin:0 0 1.1rem;color:#5a6877;font-size:.95rem;white-space:pre-line}',
            '.toast-confirm-actions{display:flex;gap:.6rem;justify-content:flex-end}',
            '.toast-btn{padding:.55rem 1.1rem;border-radius:6px;border:0;font:inherit;font-weight:600;cursor:pointer;font-size:.92rem}',
            '.toast-btn.primary{background:#1abc9c;color:#fff}.toast-btn.primary:hover{background:#16a085}',
            '.toast-btn.danger{background:#e74c3c;color:#fff}.toast-btn.danger:hover{background:#c0392b}',
            '.toast-btn.secondary{background:#ecf0f1;color:#2c3e50}.toast-btn.secondary:hover{background:#d5dbdb}'
        ].join('');
        document.head.appendChild(s);
    }

    function getStack() {
        var st = document.getElementById('toastStack');
        if (!st) {
            st = document.createElement('div');
            st.id = 'toastStack';
            st.className = 'toast-stack';
            document.body.appendChild(st);
        }
        return st;
    }

    var ICONS = {
        success: 'fa-check',
        error: 'fa-times',
        info: 'fa-info',
        warning: 'fa-exclamation'
    };

    function show(type, message, opts) {
        injectStyles();
        opts = opts || {};
        var stack = getStack();
        var t = document.createElement('div');
        t.className = 'toast ' + type;
        var title = opts.title || ({
            success: 'Success', error: 'Error', info: 'Info', warning: 'Warning'
        }[type] || '');
        t.innerHTML =
            '<span class="toast-icon"><i class="fas ' + (ICONS[type] || 'fa-info') + '"></i></span>' +
            '<div class="toast-body">' +
                (title ? '<div class="toast-title">' + escapeHtml(title) + '</div>' : '') +
                '<p class="toast-msg">' + escapeHtml(message || '') + '</p>' +
            '</div>' +
            '<button class="toast-close" aria-label="Close">&times;</button>' +
            '<div class="toast-progress" style="width:100%"></div>';

        var dismiss = function () {
            t.classList.add('toast-out');
            setTimeout(function () { t.remove(); }, 220);
        };
        t.querySelector('.toast-close').addEventListener('click', dismiss);

        var duration = opts.duration != null ? opts.duration : (type === 'error' ? 6000 : 4000);
        if (duration > 0) {
            var prog = t.querySelector('.toast-progress');
            prog.style.transition = 'width ' + duration + 'ms linear';
            // trigger transition after insert
            requestAnimationFrame(function () {
                requestAnimationFrame(function () { prog.style.width = '0%'; });
            });
            setTimeout(dismiss, duration);
        } else {
            // No auto-dismiss
            t.querySelector('.toast-progress').remove();
        }

        stack.appendChild(t);
        return { dismiss: dismiss };
    }

    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function confirm(message, opts) {
        injectStyles();
        opts = opts || {};
        return new Promise(function (resolve) {
            var ov = document.createElement('div');
            ov.className = 'toast-confirm-overlay';
            var iconBg = opts.danger ? '#e74c3c' : '#f39c12';
            var iconClass = opts.danger ? 'fa-trash' : 'fa-question';
            ov.innerHTML =
                '<div class="toast-confirm" role="dialog" aria-modal="true">' +
                    '<h3><span class="ic" style="background:' + iconBg + '"><i class="fas ' + iconClass + '"></i></span>' +
                        escapeHtml(opts.title || 'Confirm') + '</h3>' +
                    '<p>' + escapeHtml(message || '') + '</p>' +
                    '<div class="toast-confirm-actions">' +
                        '<button class="toast-btn secondary" data-act="no">' + escapeHtml(opts.noLabel || 'Cancel') + '</button>' +
                        '<button class="toast-btn ' + (opts.danger ? 'danger' : 'primary') + '" data-act="yes">' + escapeHtml(opts.yesLabel || 'OK') + '</button>' +
                    '</div>' +
                '</div>';

            function done(answer) {
                ov.remove();
                if (answer && opts.onYes) opts.onYes();
                if (!answer && opts.onNo) opts.onNo();
                resolve(answer);
            }

            ov.addEventListener('click', function (e) {
                if (e.target === ov) done(false);
            });
            ov.querySelectorAll('[data-act]').forEach(function (b) {
                b.addEventListener('click', function () {
                    done(b.dataset.act === 'yes');
                });
            });

            document.body.appendChild(ov);
            // Focus the primary button for keyboard users
            setTimeout(function () { ov.querySelector('[data-act="yes"]').focus(); }, 50);
        });
    }

    window.Toast = {
        success: function (m, o) { return show('success', m, o); },
        error:   function (m, o) { return show('error',   m, o); },
        info:    function (m, o) { return show('info',    m, o); },
        warning: function (m, o) { return show('warning', m, o); },
        confirm: confirm
    };

    // Optional: make alert() and confirm() forward to Toast (lighter, no popup).
    // Opt-in via setting window.__toastAutoOverride = true BEFORE this file loads,
    // OR call Toast.installAlertOverride() explicitly. We do NOT auto-override
    // window.alert/confirm because some flows (e.g    // payments) intentionally use blocking confirms. Authors who want full
    // override can call Toast.installAlertOverride() once after page load.
    window.Toast.installAlertOverride = function () {
        if (window.__nativeAlert) return; // already installed
        window.__nativeAlert = window.alert;
        window.__nativeConfirm = window.confirm;
        window.alert = function (msg) {
            // Heuristic: pick severity from message prefix emoji
            var m = String(msg || '');
            var type = 'info';
            if (/^(\u274c|\u26a0|error|failed)/i.test(m)) type = 'error';
            else if (/^(\u2705|\ud83c\udf89|success|confirmed|saved)/i.test(m)) type = 'success';
            else if (/^(\u26a0|\ud83d\udd12|warning|please)/i.test(m)) type = 'warning';
            // Strip the leading emoji+space for a cleaner toast
            var clean = m.replace(/^(\W{1,3})\s*/, '');
            window.Toast[type](clean || m, { duration: 5000 });
        };
        window.confirm = function (msg) {
            // Note: window.confirm is synchronous in spec, but we cannot replicate
            // that without freezing the page. Return false synchronously and
            // open a real Toast confirm — callers should migrate to Toast.confirm.
            window.Toast.confirm(msg).then(function () {});
            return false;
        };
    };

    // Auto-install if requested before this script ran
    if (window.__toastAutoOverride === true) {
        window.Toast.installAlertOverride();
    }
})();
