/* dashboard-locks.js — admin-side Price Locks list.
 *
 * Renders /priceLocks (Firestore) for admin/staff inside #section-locks.
 * Firestore rules already grant admin full read; this script reads the
 * whole collection on demand (lazy load when the user opens the tab).
 *
 * UI:
 *   • Status pills (All / Active / Used / Expired / Cancelled) with counts.
 *   • Table (lock ref, customer, package, heads, fee, locked, expires, status).
 *   • Live search.
 *   • Side preview pane with full lock details + Cancel button (admin only).
 */
(function () {
    'use strict';
    var R = '₹';
    var _all = [];          // every lock from Firestore
    var _filter = 'all';
    var _search = '';
    var _selected = null;   // currently-selected lock (for preview pane)

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
        });
    }
    function fmtINR(n) { return R + (Number(n) || 0).toLocaleString('en-IN'); }
    function fmtDate(s) {
        if (!s) return '—';
        try {
            var d = (s && s.toDate) ? s.toDate() : new Date(s);
            if (isNaN(d.getTime())) return String(s);
            return d.toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });
        } catch (_) { return String(s); }
    }
    function fmtDateTime(s) {
        if (!s) return '—';
        try {
            var d = (s && s.toDate) ? s.toDate() : new Date(s);
            if (isNaN(d.getTime())) return String(s);
            return d.toLocaleString('en-IN', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
        } catch (_) { return String(s); }
    }
    function showToast(kind, msg) {
        try { if (window.Toast && window.Toast[kind]) { window.Toast[kind](msg); return; } } catch (_) {}
        console.log('[dashboard-locks]', kind, msg);
    }

    function statusOf(L) {
        var s = String(L.status || 'active').toLowerCase();
        if (s === 'active') {
            var expMs = L.expiresAtMs || (L.expiresAt && L.expiresAt.toMillis && L.expiresAt.toMillis()) || 0;
            if (expMs && expMs <= Date.now()) return 'expired';
        }
        return s;
    }

    async function loadAll() {
        if (!window.__firebaseReady) { _all = []; return; }
        try {
            var fb = await window.__firebaseReady;
            var snap = await fb.firestore.getDocs(fb.firestore.collection(fb.db, 'priceLocks'));
            var list = [];
            snap.forEach(function (d) {
                var data = d.data() || {};
                data.id = d.id;
                data._fsId = d.id;
                list.push(data);
            });
            // Sort: active first (earliest expiry first), then everything else by paidAt desc.
            list.sort(function (a, b) {
                var sa = statusOf(a), sb = statusOf(b);
                var rankA = (sa === 'active') ? 0 : 1;
                var rankB = (sb === 'active') ? 0 : 1;
                if (rankA !== rankB) return rankA - rankB;
                if (sa === 'active' && sb === 'active') {
                    return (a.expiresAtMs || 0) - (b.expiresAtMs || 0);
                }
                var ta = a.paidAt && a.paidAt.toMillis ? a.paidAt.toMillis() : (a.paidAt ? +new Date(a.paidAt) : 0);
                var tb = b.paidAt && b.paidAt.toMillis ? b.paidAt.toMillis() : (b.paidAt ? +new Date(b.paidAt) : 0);
                return tb - ta;
            });
            _all = list;
        } catch (err) {
            console.warn('[dashboard-locks] load failed:', err);
            _all = [];
            showToast('error', 'Failed to load locks: ' + (err && err.message || err));
        }
    }

    function applyFilters() {
        var s = (_search || '').trim().toLowerCase();
        return _all.filter(function (L) {
            var st = statusOf(L);
            if (_filter !== 'all' && st !== _filter) return false;
            if (!s) return true;
            var hay = [
                L.lockRef, L.id, L.email, L.travelerName, L.travelerEmail, L.travelerPhone,
                L.packageName, L.packageId, L.paymentId, L.usedBookingRef
            ].map(function (x) { return String(x || '').toLowerCase(); }).join(' ');
            return hay.indexOf(s) >= 0;
        });
    }

    function updateCounts() {
        var counts = { all: _all.length, active: 0, used: 0, expired: 0, cancelled: 0 };
        _all.forEach(function (L) {
            var st = statusOf(L);
            if (counts[st] != null) counts[st]++;
        });
        var ids = { all:'lkCountAll', active:'lkCountActive', used:'lkCountUsed', expired:'lkCountExpired', cancelled:'lkCountCancelled' };
        Object.keys(ids).forEach(function (k) {
            var el = document.getElementById(ids[k]);
            if (el) el.textContent = counts[k];
        });
    }

    function statusBadgeHtml(st) {
        var label = st === 'active' ? 'Active' : st === 'used' ? 'Used' : st === 'expired' ? 'Expired' : st === 'cancelled' ? 'Cancelled' : st;
        var color = st === 'active' ? '#0d7a8a' : st === 'used' ? '#27ae60' : st === 'expired' ? '#7f8c8d' : st === 'cancelled' ? '#c0392b' : '#5a6877';
        return '<span style="display:inline-block;padding:.15rem .55rem;border-radius:999px;font-size:.72rem;font-weight:700;color:#fff;background:' + color + ';">' + esc(label) + '</span>';
    }

    function renderTable() {
        var tbody = document.getElementById('allLocksBody');
        if (!tbody) return;
        var rows = applyFilters();
        if (!rows.length) {
            tbody.innerHTML = '<tr><td colspan="8" class="table-empty">No price locks ' + (_filter === 'all' ? 'yet.' : 'in this status.') + '</td></tr>';
            return;
        }
        tbody.innerHTML = rows.map(function (L) {
            var st = statusOf(L);
            var ref = L.lockRef || L.id || '—';
            var who = L.travelerEmail || L.email || L.travelerName || L.uid || '—';
            var pkg = L.packageName || L.packageId || '—';
            var heads = Number(L.people || 1);
            var fee = Number(L.totalPaid || 0);
            var paid = L.paidAt;
            var expMs = L.expiresAtMs || (L.expiresAt && L.expiresAt.toMillis && L.expiresAt.toMillis()) || 0;
            var isSelected = _selected && (_selected.lockRef === L.lockRef || _selected.id === L.id);
            return '<tr data-lock-id="' + esc(L.id) + '"' + (isSelected ? ' class="selected"' : '') + '>' +
                '<td>' + esc(ref) + '</td>' +
                '<td>' + esc(who) + '</td>' +
                '<td>' + esc(pkg) + '</td>' +
                '<td>' + heads + '</td>' +
                '<td>' + fmtINR(fee) + '</td>' +
                '<td>' + (paid ? esc(fmtDate(paid)) : '—') + '</td>' +
                '<td>' + (expMs ? esc(fmtDate(new Date(expMs))) : '—') + '</td>' +
                '<td>' + statusBadgeHtml(st) + '</td>' +
            '</tr>';
        }).join('');
    }

    function renderPreview() {
        var host = document.getElementById('lockPreview');
        if (!host) return;
        var L = _selected;
        if (!L) {
            host.innerHTML = '<div class="inbox-preview-empty"><i class="fas fa-lock"></i><p>Select a lock row to view details, customer and payment id.</p></div>';
            return;
        }
        var st = statusOf(L);
        var expMs = L.expiresAtMs || (L.expiresAt && L.expiresAt.toMillis && L.expiresAt.toMillis()) || 0;
        function row(label, val) {
            if (val === '' || val == null) return '';
            return '<div class="ipv-row"><strong>' + esc(label) + ':</strong> ' + val + '</div>';
        }
        var rows = '';
        rows += row('Lock Ref', '<code>' + esc(L.lockRef || L.id) + '</code>');
        rows += row('Status', statusBadgeHtml(st));
        rows += row('Package', esc(L.packageName || '') + (L.packageId ? ' <code style="font-size:.75rem;color:#7f8c8d;">' + esc(L.packageId) + '</code>' : ''));
        if (L.packagePrice) rows += row('Frozen Price', '<strong>' + fmtINR(L.packagePrice) + '</strong> / head');
        rows += row('Travellers', Number(L.people || 1) + ' head' + (Number(L.people) === 1 ? '' : 's'));
        rows += row('Lock Fee Paid', '<strong>' + fmtINR(L.totalPaid || 0) + '</strong> (' + fmtINR(L.pricePerHead || 0) + '/head)');
        rows += '<hr class="bk-sep" style="margin:.6rem 0;border:0;border-top:1px solid #e3e8ef;">';
        rows += row('Customer Name', esc(L.travelerName || '—'));
        rows += row('Email', esc(L.travelerEmail || L.email || '—'));
        rows += row('Phone', esc(L.travelerPhone || '—'));
        rows += row('UID', '<code style="font-size:.75rem;">' + esc(L.uid || '—') + '</code>');
        rows += '<hr class="bk-sep" style="margin:.6rem 0;border:0;border-top:1px solid #e3e8ef;">';
        if (L.paidAt)         rows += row('Paid At',  esc(fmtDateTime(L.paidAt)));
        if (expMs)            rows += row('Expires',  esc(fmtDateTime(new Date(expMs))));
        if (L.usedAt)         rows += row('Used At',  esc(fmtDateTime(L.usedAt)));
        if (L.usedBookingRef) rows += row('Used By Booking', '<code>' + esc(L.usedBookingRef) + '</code>');
        if (L.cancelledAt)    rows += row('Cancelled At', esc(fmtDateTime(L.cancelledAt)));
        if (L.paymentId)      rows += row('Razorpay Payment ID', '<code>' + esc(L.paymentId) + '</code>');

        var foot = '';
        if (st === 'active') {
            foot = '<div class="ipv-actions"><button type="button" class="ipv-reply" id="lkAdminCancelBtn" data-lock-ref="' + esc(L.lockRef || L.id) + '"><i class="fas fa-times-circle"></i> Cancel This Lock</button></div>';
        }

        host.innerHTML =
            '<div class="ipv-head">' +
                '<h3 class="ipv-subject"><i class="fas fa-lock" style="color:#a04000;"></i> ' + esc(L.packageName || L.packageId || 'Andaman Package') + '</h3>' +
                '<div class="ipv-meta">Lock <code>' + esc(L.lockRef || L.id) + '</code> &middot; ' + esc(L.travelerEmail || L.email || '—') + '</div>' +
            '</div>' +
            foot +
            '<div class="ipv-body">' + rows + '</div>';

        var btn = host.querySelector('#lkAdminCancelBtn');
        if (btn) {
            btn.addEventListener('click', async function () {
                if (!confirm('Cancel this lock for the customer?\n\nLock fee (' + fmtINR(L.totalPaid || 0) + ') is non-refundable. The customer will see the lock as Cancelled on their /bookings page.')) return;
                btn.disabled = true;
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Cancelling…';
                try {
                    if (!window.LocksStore || !window.LocksStore.cancelLock) throw new Error('LocksStore not available');
                    await window.LocksStore.cancelLock(L.lockRef || L.id);
                    L.status = 'cancelled';
                    L.cancelledAt = new Date().toISOString();
                    showToast('success', 'Lock cancelled.');
                    updateCounts();
                    renderTable();
                    renderPreview();
                } catch (err) {
                    btn.disabled = false;
                    btn.innerHTML = '<i class="fas fa-times-circle"></i> Cancel This Lock';
                    showToast('error', 'Failed: ' + (err && err.message || err));
                }
            });
        }
    }

    function wire() {
        var section = document.getElementById('section-locks');
        if (!section) return;

        var tabs = document.getElementById('lockStatusTabs');
        if (tabs && !tabs.__wired) {
            tabs.__wired = true;
            tabs.addEventListener('click', function (e) {
                var btn = e.target.closest('.bk-status-tab');
                if (!btn) return;
                tabs.querySelectorAll('.bk-status-tab').forEach(function (b) {
                    b.classList.remove('active');
                    b.setAttribute('aria-selected', 'false');
                });
                btn.classList.add('active');
                btn.setAttribute('aria-selected', 'true');
                _filter = btn.getAttribute('data-lock-status') || 'all';
                renderTable();
            });
        }

        var search = document.getElementById('lockSearch');
        if (search && !search.__wired) {
            search.__wired = true;
            var t;
            search.addEventListener('input', function () {
                clearTimeout(t);
                t = setTimeout(function () {
                    _search = search.value || '';
                    renderTable();
                }, 120);
            });
        }

        var refresh = document.getElementById('locksRefreshBtn');
        if (refresh && !refresh.__wired) {
            refresh.__wired = true;
            refresh.addEventListener('click', async function () {
                refresh.disabled = true;
                var orig = refresh.innerHTML;
                refresh.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading…';
                await loadAll();
                refresh.disabled = false;
                refresh.innerHTML = orig;
                _selected = null;
                updateCounts();
                renderTable();
                renderPreview();
                showToast('success', 'Reloaded ' + _all.length + ' lock(s).');
            });
        }

        var tbody = document.getElementById('allLocksBody');
        if (tbody && !tbody.__wired) {
            tbody.__wired = true;
            tbody.addEventListener('click', function (e) {
                var tr = e.target.closest('tr[data-lock-id]');
                if (!tr) return;
                var id = tr.getAttribute('data-lock-id');
                _selected = _all.find(function (L) { return String(L.id) === String(id); }) || null;
                tbody.querySelectorAll('tr.selected').forEach(function (r) { r.classList.remove('selected'); });
                tr.classList.add('selected');
                renderPreview();
            });
        }
    }

    var _loaded = false;
    async function activate() {
        wire();
        if (!_loaded) {
            _loaded = true;
            await loadAll();
        }
        updateCounts();
        renderTable();
        renderPreview();
    }

    document.addEventListener('DOMContentLoaded', function () {
        document.querySelectorAll('.sidebar-link[data-section="locks"]').forEach(function (link) {
            link.addEventListener('click', function () {
                var t = document.getElementById('pageTitle');
                if (t) t.textContent = 'Price Locks';
                setTimeout(activate, 50);
            });
        });
    });

    window.DashboardLocks = {
        load: loadAll,
        activate: activate
    };
})();
