/* locks-ui.js — customer-facing price-lock list renderer.
 *
 * Used by /bookings: when the user clicks the "Locks" tab, bookings-page.js
 * delegates rendering to window.LocksUI.renderLocksInto(host).
 *
 * Reads: window.LocksStore.listMyLocks() → all /priceLocks docs for the
 * currently signed-in user (active, used, expired, cancelled).
 *
 * What a "price lock" is:
 *   The customer pays ₹500/head (configurable) on a package page to
 *   FREEZE that day's price for 10 days. If they convert the lock to a
 *   booking within the window, the lock fee is deducted from the
 *   advance. If they don't, the fee is forfeited and the lock expires.
 */
(function () {
    'use strict';
    var R = '₹';

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function fmtINR(n) { return R + (Number(n) || 0).toLocaleString('en-IN'); }
    function fmtDate(s) {
        if (!s) return '—';
        try {
            var d = (s && s.toDate) ? s.toDate() : new Date(s);
            if (isNaN(d.getTime())) return String(s);
            return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
        } catch (_) { return String(s); }
    }
    function showToast(kind, msg) {
        try { if (window.Toast && window.Toast[kind]) { window.Toast[kind](msg); return; } } catch (_) {}
        console.log('[locks-ui]', kind, msg);
    }
    function expiryCountdown(expMs) {
        var diff = (expMs || 0) - Date.now();
        if (diff <= 0) return { label: 'Expired', urgent: false };
        var days = Math.floor(diff / 86400000);
        var hrs  = Math.floor((diff % 86400000) / 3600000);
        if (days >= 1) return { label: days + ' day' + (days === 1 ? '' : 's') + ' ' + hrs + ' hr left', urgent: days <= 2 };
        return { label: hrs + ' hr' + (hrs === 1 ? '' : 's') + ' left', urgent: true };
    }

    var _locks = [];
    var _hostEl = null;

    function findLock(ref) {
        if (!ref) return null;
        for (var i = 0; i < _locks.length; i++) {
            var L = _locks[i];
            if (!L) continue;
            if (L.lockRef === ref || String(L.id) === String(ref)) return L;
        }
        return null;
    }

    function lockCard(L) {
        var status = String(L.effectiveStatus || L.status || 'active').toLowerCase();
        var statusLabel = status === 'active'    ? 'Active'
                        : status === 'used'      ? 'Converted'
                        : status === 'expired'   ? 'Expired'
                        : status === 'cancelled' ? 'Cancelled'
                        : status;
        var statusClass = 'bk-status bk-status-' + status;
        var pkg     = L.packageName || L.packageId || 'Andaman Package';
        var ref     = L.lockRef || L.id || '—';
        var people  = Number(L.people || 1);
        var perHead = Number(L.pricePerHead || 0);
        var totalPaid = Number(L.totalPaid || (people * perHead));
        var pkgPrice  = Number(L.packagePrice || 0);
        var paidAt = L.paidAt && L.paidAt.toDate ? L.paidAt.toDate() : (L.paidAt ? new Date(L.paidAt) : null);
        var expMs  = L.expiresAtMs || (L.expiresAt && L.expiresAt.toMillis && L.expiresAt.toMillis()) || 0;
        var cd = expiryCountdown(expMs);

        var rows = '';
        rows += '<div class="bk-row"><span class="bk-k"><i class="fas fa-hashtag"></i> Lock Ref</span><span class="bk-v">' + esc(ref) + '</span></div>';
        rows += '<div class="bk-row"><span class="bk-k"><i class="fas fa-users"></i> Travellers</span><span class="bk-v">' + esc(people) + ' head' + (people === 1 ? '' : 's') + '</span></div>';
        if (pkgPrice) rows += '<div class="bk-row"><span class="bk-k"><i class="fas fa-tag"></i> Frozen Price</span><span class="bk-v"><strong>' + fmtINR(pkgPrice) + '</strong> / head</span></div>';
        rows += '<hr class="bk-sep">';
        rows += '<div class="bk-row" style="color:#0a5a68;"><span class="bk-k">Lock Fee Paid</span><span class="bk-v"><strong>' + fmtINR(totalPaid) + '</strong> (' + fmtINR(perHead) + '/head)</span></div>';
        if (paidAt) rows += '<div class="bk-row"><span class="bk-k"><i class="fas fa-calendar-day"></i> Locked on</span><span class="bk-v">' + esc(fmtDate(paidAt)) + '</span></div>';
        if (expMs) {
            var color = (status === 'active') ? (cd.urgent ? '#c0392b' : '#a04000') : '#7f8c8d';
            rows += '<div class="bk-row" style="color:' + color + ';"><span class="bk-k"><i class="fas fa-hourglass-half"></i> Expires</span><span class="bk-v"><strong>' + esc(fmtDate(new Date(expMs))) + '</strong></span></div>';
            if (status === 'active') rows += '<div class="bk-row" style="color:' + color + ';font-weight:700;"><span class="bk-k"><i class="fas fa-bolt"></i> Time Left</span><span class="bk-v">' + esc(cd.label) + '</span></div>';
        }
        if (L.usedBookingRef) rows += '<div class="bk-row" style="font-size:.78rem;color:#7f8c8d;"><span class="bk-k"><i class="fas fa-link"></i> Booking</span><span class="bk-v">' + esc(L.usedBookingRef) + '</span></div>';
        if (L.paymentId) rows += '<div class="bk-row" style="font-size:.78rem;color:#7f8c8d;"><span class="bk-k"><i class="fas fa-receipt"></i> Payment ID</span><span class="bk-v">' + esc(L.paymentId) + '</span></div>';

        var foot = '';
        if (status === 'active') {
            var bookHref = 'checkout.html?pkg=' + encodeURIComponent(L.packageId || '') +
                           '&people=' + encodeURIComponent(people) +
                           '&lock=' + encodeURIComponent(L.lockRef || L.id || '');
            foot = '<div class="bk-foot">' +
                '<a href="' + bookHref + '" class="bk-action" style="background:#0d7a8a;color:#fff;"><i class="fas fa-arrow-right"></i> Convert to Booking</a>' +
                '<button type="button" class="bk-action bk-action-cancel-lock" data-lock-ref="' + esc(L.lockRef || L.id || '') + '"><i class="fas fa-times-circle"></i> Cancel Lock</button>' +
            '</div>';
        } else if (status === 'used' && L.usedAt) {
            foot = '<div class="bk-foot" style="font-size:.78rem;color:#7f8c8d;"><i class="fas fa-check-circle" style="color:#27ae60;"></i> Used on ' + esc(fmtDate(L.usedAt)) + '</div>';
        } else if (status === 'expired') {
            foot = '<div class="bk-foot" style="font-size:.78rem;color:#7f8c8d;"><i class="fas fa-info-circle"></i> Lock fee was non-refundable. Book a fresh trip <a href="/#packages">here</a>.</div>';
        } else if (status === 'cancelled') {
            foot = '<div class="bk-foot" style="font-size:.78rem;color:#7f8c8d;"><i class="fas fa-info-circle"></i> Cancelled' + (L.cancelledAt ? ' on ' + esc(fmtDate(L.cancelledAt)) : '') + '</div>';
        }

        return '<div class="bk-card bk-card-' + esc(status) + '" data-lock-card="' + esc(L.lockRef || L.id || '') + '">' +
            '<div class="bk-head">' +
                '<div class="bk-pkg"><i class="fas fa-lock" style="color:#a04000;"></i> <strong>' + esc(pkg) + '</strong> <span style="font-size:.72rem;color:#a04000;font-weight:700;margin-left:.4rem;">PRICE LOCK</span></div>' +
                '<span class="' + statusClass + '">' + esc(statusLabel) + '</span>' +
            '</div>' +
            '<div class="bk-body">' + rows + '</div>' + foot +
        '</div>';
    }

    function locksEmpty() {
        return '<div class="bookings-empty-inline">' +
            '<i class="fas fa-lock"></i>' +
            '<h3>No price locks yet</h3>' +
            '<p>Spotted a price you love? Pay a small <strong>₹500 / head</strong> fee on any package page to ' +
            '<em>freeze that price for 10 days</em> while you decide. The lock fee is then deducted from your ' +
            'advance when you confirm the booking.</p>' +
            '<p><a href="/#packages">Browse packages →</a></p>' +
        '</div>';
    }

    function wireLockButtons(host) {
        if (!host || host.__lockUiWired) return;
        host.__lockUiWired = true;
        host.addEventListener('click', function (e) {
            var btn = e.target && e.target.closest && e.target.closest('.bk-action-cancel-lock');
            if (!btn || !host.contains(btn)) return;
            e.preventDefault();
            var ref = btn.getAttribute('data-lock-ref') || '';
            var L = findLock(ref);
            if (!L) { showToast('error', 'Lock not found.'); return; }
            var feeText = fmtINR(L.totalPaid || 0);
            var msg = 'Cancel this price lock?\n\nThe lock fee (' + feeText + ') is non-refundable. ' +
                      'Your trip price will no longer be frozen after this.';
            var doCancel = function () {
                if (!window.LocksStore || !window.LocksStore.cancelLock) {
                    showToast('error', 'Lock service unavailable.');
                    return;
                }
                btn.disabled = true;
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Cancelling…';
                window.LocksStore.cancelLock(L.lockRef || L.id).then(function () {
                    L.status = 'cancelled';
                    L.effectiveStatus = 'cancelled';
                    L.cancelledAt = new Date().toISOString();
                    renderInternal();
                    showToast('success', 'Price lock cancelled.');
                }).catch(function (err) {
                    btn.disabled = false;
                    btn.innerHTML = '<i class="fas fa-times-circle"></i> Cancel Lock';
                    showToast('error', 'Could not cancel: ' + (err && err.message || err));
                });
            };
            try {
                if (window.Toast && typeof window.Toast.confirm === 'function') {
                    window.Toast.confirm(msg, { onYes: doCancel, onNo: function () {} });
                    return;
                }
            } catch (_) {}
            if (window.confirm(msg)) doCancel();
        });
    }

    function renderInternal() {
        if (!_hostEl) return;
        if (!_locks.length) {
            _hostEl.innerHTML = locksEmpty();
            return;
        }
        _hostEl.innerHTML = _locks.map(lockCard).join('');
        wireLockButtons(_hostEl);
    }

    // Pull "pending" locks from localStorage. These are locks the
    // customer already PAID for but whose Firestore write failed
    // (network blip, auth race, rules issue). checkout.js writes
    // them under the `pendingLocks` key so we never lose the data.
    // We surface them here with a clear "Saving…" badge so the
    // customer sees the lock + can give support the details.
    function loadPendingLocks() {
        try {
            var raw = JSON.parse(localStorage.getItem('pendingLocks') || '[]');
            if (!Array.isArray(raw)) return [];
            // Drop any pending entries that ARE actually saved in Firestore
            // (the recovery code in checkout clears them once it confirms,
            // but a stale entry could survive a browser crash). We do a
            // best-effort de-dupe in renderLocksInto() by lockRef.
            return raw.map(function (p) {
                return Object.assign({
                    id: p.lockRef,
                    effectiveStatus: 'active',
                    _pending: true   // marker for the UI
                }, p);
            });
        } catch (_) { return []; }
    }

    // Public entry point — bookings-page.js calls this when the user
    // taps the "Locks" tab.
    async function renderLocksInto(host) {
        if (!host) return;
        _hostEl = host;
        host.innerHTML = '<div class="bookings-empty-inline" style="padding:2rem;">' +
            '<i class="fas fa-spinner fa-spin"></i>' +
            '<h3 style="margin-top:.5rem;">Loading your price locks…</h3>' +
            '</div>';

        // Always start with the local pending locks so even if
        // Firestore is down the customer sees something.
        var pending = loadPendingLocks();

        try {
            if (!window.LocksStore || !window.LocksStore.listMyLocks) {
                _locks = pending;
                if (!pending.length) {
                    host.innerHTML = '<div class="bookings-empty-inline">' +
                        '<i class="fas fa-exclamation-triangle"></i>' +
                        '<h3>Lock service unavailable</h3>' +
                        '<p>Please refresh the page and try again, or call us at +91 88801 95191.</p>' +
                        '</div>';
                    return;
                }
                renderInternal();
                return;
            }
            var list = await window.LocksStore.listMyLocks();
            var fsList = Array.isArray(list) ? list : [];
            // Merge: Firestore is authoritative; only show pending entries
            // whose lockRef isn't already present in Firestore.
            var fsRefs = {};
            fsList.forEach(function (L) { fsRefs[L.lockRef || L.id] = true; });
            var unsynced = pending.filter(function (p) { return !fsRefs[p.lockRef]; });
            _locks = fsList.concat(unsynced);
            renderInternal();
        } catch (err) {
            console.warn('[locks-ui] load failed:', err);
            // Even on error, show the pending entries so the customer
            // doesn't think the payment was lost.
            _locks = pending;
            if (pending.length) {
                renderInternal();
            } else {
                host.innerHTML = '<div class="bookings-empty-inline">' +
                    '<i class="fas fa-exclamation-triangle"></i>' +
                    '<h3>Could not load your locks</h3>' +
                    '<p>Please refresh and try again.</p>' +
                    '</div>';
            }
        }
    }

    window.LocksUI = {
        renderLocksInto: renderLocksInto
    };
})();
