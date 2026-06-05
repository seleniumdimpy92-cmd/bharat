/* ── Admin Inbox — Received pane ──────────────────────────────────
 * Renders the table of received emails (mailbox sub-tabs + preview).
 * Subscribes via onSnapshot to Firestore /receivedEmails so new mail
 * arrives in real time.
 *
 * FIX 2026-05: "reading panel does not come back"
 *   Added state.previewClosed. The × close button sets it to true.
 *   renderRows() skips auto-select while previewClosed is true.
 *   Clicking a row resets previewClosed to false and re-shows the panel.
 * ──────────────────────────────────────────────────────────────── */

(function () {
    'use strict';

    const MAILBOXES = [
        { id: 'booking@andamanvoyages.in',      label: 'Bookings'      },
        { id: 'info@andamanvoyages.in',         label: 'Info'          },
        { id: 'cancellation@andamanvoyages.in', label: 'Cancellations' },
        { id: 'enquiries@andamanvoyages.in',    label: 'Enquiries'     }
    ];
    const ALL = '__all__';

    function $(id) { return document.getElementById(id); }
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
        });
    }
    function fmtDate(v) {
        const d = new Date(v || '');
        return isNaN(d.getTime()) ? '\u2014' : d.toLocaleString();
    }
    function mailboxLabel(id) {
        const found = MAILBOXES.find(function (m) { return m.id === id; });
        return found ? found.label : 'All';
    }
    function emailOnly(s) {
        const m = String(s || '').match(/<([^>]+)>/);
        return m ? m[1].trim() : String(s || '').trim();
    }
    function stripOwnMailboxes(addrList) {
        const ours = MAILBOXES.map(function (m) { return m.id.toLowerCase(); });
        return String(addrList || '')
            .split(',').map(function (a) { return a.trim(); }).filter(Boolean)
            .filter(function (a) { return ours.indexOf(emailOnly(a).toLowerCase()) === -1; })
            .join(', ');
    }
    function isAdminUser() {
        const email = (((window.currentUser || {}).email) || '').toLowerCase();
        const admins = Array.isArray(window.ADMIN_EMAILS)
            ? window.ADMIN_EMAILS.map(function (v) { return String(v).toLowerCase(); }) : [];
        return !!email && admins.indexOf(email) !== -1;
    }
    function beep() {
        try {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            if (!Ctx) return;
            const ctx = new Ctx();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine'; osc.frequency.value = 880; gain.gain.value = 0.03;
            osc.connect(gain); gain.connect(ctx.destination);
            osc.start();
            setTimeout(function () {
                try { osc.stop(); } catch (_) {}
                try { ctx.close(); } catch (_) {}
            }, 140);
        } catch (_) {}
    }
    function notifyNative(title, body) {
        if (!('Notification' in window)) return;
        if (Notification.permission === 'granted') {
            try { new Notification(title, { body: body || '', icon: 'images/logo.png' }); } catch (_) {}
            return;
        }
        if (Notification.permission !== 'denied') {
            Notification.requestPermission().then(function (perm) {
                if (perm === 'granted') {
                    try { new Notification(title, { body: body || '', icon: 'images/logo.png' }); } catch (_) {}
                }
            }).catch(function () {});
        }
    }
    function flashTitle(count) {
        clearInterval(state.titleTimer);
        let on = false;
        state.titleTimer = setInterval(function () {
            document.title = on ? '(' + count + ') New mail \u2022 ' + state.baseTitle : state.baseTitle;
            on = !on;
        }, 900);
        setTimeout(function () {
            clearInterval(state.titleTimer);
            state.titleTimer = null;
            document.title = state.baseTitle;
        }, 8000);
    }

    const state = {
        mailbox: 'booking@andamanvoyages.in',
        pane: 'received',
        rows: [],
        selectedId: '',
        // FIX: set true when user closes panel with ×
        // renderRows() will not auto-reopen the panel while this is true.
        // Clicking any row resets this to false.
        previewClosed: false,
        seenIds: new Set(),
        unsub: null,
        titleTimer: null,
        baseTitle: document.title || 'Dashboard',
        checked: new Set()
    };

    /* ── show / hide the preview panel consistently ─────── */
    function showSplitPanel() {
        const box     = $('inboxPreview');
        const split   = $('inboxSplit');
        const divider = $('inboxDivider');
        if (box)     box.style.display     = '';
        if (divider) divider.style.display = '';
        if (split)   split.style.removeProperty('--inbox-list-w');
    }
    function hideSplitPanel() {
        const box     = $('inboxPreview');
        const split   = $('inboxSplit');
        const divider = $('inboxDivider');
        if (split)   split.style.setProperty('--inbox-list-w', '100%');
        if (divider) divider.style.display = 'none';
        if (box)     box.style.display     = 'none';
    }

    /* ── unread counters ────────────────────────────────── */
    function unreadCount(rows, mailbox) {
        return rows.filter(function (r) {
            const mbxOk = mailbox === ALL || r.mailbox === mailbox;
            return mbxOk && r.unread;
        }).length;
    }
    function setCounts() {
        const totalUnread = unreadCount(state.rows, ALL);
        const rc = $('inboxReceivedCount');
        if (rc) rc.textContent = totalUnread ? String(totalUnread) : '';
        [ALL].concat(MAILBOXES.map(function (m) { return m.id; })).forEach(function (mbx) {
            const el = document.querySelector('[data-mbx-count="' + mbx + '"]');
            if (el) el.textContent = String(unreadCount(state.rows, mbx));
        });
        const navInbox = document.querySelector('.sidebar-link[data-section="inbox"]');
        if (navInbox) {
            let badge = navInbox.querySelector('.topnav-badge');
            if (totalUnread > 0) {
                if (!badge) {
                    badge = document.createElement('span');
                    badge.className = 'topnav-badge';
                    badge.style.cssText = 'display:inline-block;margin-left:.35rem;padding:.05rem .45rem;font-size:.7rem;font-weight:800;color:#fff;background:#e74c3c;border-radius:999px;line-height:1.4;vertical-align:middle;';
                    navInbox.appendChild(badge);
                }
                badge.textContent = String(totalUnread);
            } else if (badge) {
                badge.remove();
            }
        }
    }

    /* ── mark-as-read ───────────────────────────────────── */
    async function markRead(row) {
        if (!row || !row.unread) return;
        row.unread = false;
        const rec = state.rows.find(function (r) { return r.id === row.id; });
        if (rec) rec.unread = false;
        setCounts();
        try {
            const fb = await window.__firebaseReady;
            const email = (fb.auth && fb.auth.currentUser && fb.auth.currentUser.email) || '';
            await fb.firestore.updateDoc(
                fb.firestore.doc(fb.db, 'receivedEmails', row.id),
                { unread: false, readAt: new Date().toISOString(), readBy: email }
            );
        } catch (err) {
            console.error('[inbox-receiver] markRead failed:', err);
            row.unread = true;
            if (rec) rec.unread = true;
            setCounts();
            renderRows();
            if (window.Toast && typeof window.Toast.error === 'function') {
                window.Toast.error('Could not mark mail as read: ' + (err.message || err) +
                    ' (deploy updated firestore.rules \u2014 see firebase console).');
            }
        }
    }

    /* ── confirm dialog ─────────────────────────────────── */
    function ensureConfirmDialog() {
        let modal = $('inboxConfirmModal');
        if (modal) return modal;
        modal = document.createElement('div');
        modal.id = 'inboxConfirmModal';
        modal.style.cssText =
            'position:fixed;inset:0;z-index:1100;display:none;align-items:center;justify-content:center;' +
            'background:rgba(15,32,39,.55);backdrop-filter:blur(2px);padding:1rem;';
        modal.innerHTML =
            '<div style="background:#fff;border-radius:14px;max-width:440px;width:100%;box-shadow:0 24px 60px rgba(0,0,0,.32);overflow:hidden;">' +
                '<div style="padding:1rem 1.25rem;border-bottom:1px solid #e3e8ef;display:flex;align-items:center;gap:.65rem;">' +
                    '<i class="fas fa-exclamation-triangle" style="color:#e74c3c;font-size:1.25rem;"></i>' +
                    '<h3 id="inboxConfirmTitle" style="margin:0;font-size:1.05rem;font-weight:700;color:#0d2c3a;">Confirm</h3>' +
                '</div>' +
                '<div id="inboxConfirmBody" style="padding:1.1rem 1.25rem;font-size:.95rem;color:#3a4a55;line-height:1.55;"></div>' +
                '<div style="padding:.85rem 1.25rem;border-top:1px solid #e3e8ef;display:flex;justify-content:flex-end;gap:.5rem;background:#f9fbfc;">' +
                    '<button type="button" id="inboxConfirmCancel" style="padding:.55rem 1.1rem;border-radius:8px;border:1px solid #cfd9df;background:#fff;color:#5a6877;font-weight:600;font-family:inherit;font-size:.9rem;cursor:pointer;">Cancel</button>' +
                    '<button type="button" id="inboxConfirmOk" style="padding:.55rem 1.1rem;border-radius:8px;border:0;background:linear-gradient(135deg,#e74c3c,#c0392b);color:#fff;font-weight:600;font-family:inherit;font-size:.9rem;cursor:pointer;display:inline-flex;align-items:center;gap:.4rem;"><i class="fas fa-trash"></i> <span>Delete</span></button>' +
                '</div>' +
            '</div>';
        document.body.appendChild(modal);
        modal.addEventListener('click', function (ev) {
            if (ev.target === modal) modal.style.display = 'none';
        });
        return modal;
    }
    function uiConfirm(opts) {
        return new Promise(function (resolve) {
            const modal = ensureConfirmDialog();
            $('inboxConfirmTitle').textContent = opts.title || 'Confirm';
            $('inboxConfirmBody').innerHTML = opts.bodyHtml || esc(opts.body || '');
            const okBtn = $('inboxConfirmOk');
            const cancelBtn = $('inboxConfirmCancel');
            const okLabel = okBtn.querySelector('span');
            if (okLabel) okLabel.textContent = opts.okLabel || 'Delete';
            modal.style.display = 'flex';
            setTimeout(function () { try { cancelBtn.focus(); } catch (_) {} }, 30);
            function cleanup(result) {
                modal.style.display = 'none';
                okBtn.onclick = null;
                cancelBtn.onclick = null;
                document.removeEventListener('keydown', onKey);
                resolve(result);
            }
            function onKey(ev) {
                if (ev.key === 'Escape') { ev.preventDefault(); cleanup(false); }
                else if (ev.key === 'Enter') { ev.preventDefault(); cleanup(true); }
            }
            okBtn.onclick     = function () { cleanup(true); };
            cancelBtn.onclick = function () { cleanup(false); };
            document.addEventListener('keydown', onKey);
        });
    }

    /* ── delete (single + mass) ─────────────────────────── */
    async function deleteRow(row, opts) {
        if (!row) return;
        opts = opts || {};
        if (!opts.skipConfirm) {
            const ok = await uiConfirm({
                title: 'Delete email',
                bodyHtml:
                    '<div style="margin-bottom:.6rem;color:#0d2c3a;font-weight:600;">' + esc(row.subject || '(no subject)') + '</div>' +
                    '<div style="color:#7a8b96;font-size:.88rem;">From: ' + esc(row.from || '') + '</div>' +
                    '<div style="margin-top:.7rem;color:#c0392b;font-size:.88rem;"><i class="fas fa-exclamation-triangle"></i> This cannot be undone.</div>',
                okLabel: 'Delete'
            });
            if (!ok) return;
        }
        try {
            const fb = await window.__firebaseReady;
            await fb.firestore.deleteDoc(fb.firestore.doc(fb.db, 'receivedEmails', row.id));
            state.rows = state.rows.filter(function (r) { return r.id !== row.id; });
            state.checked.delete(row.id);
            if (state.selectedId === row.id) {
                state.selectedId = '';
                state.previewClosed = true;
            }
            setCounts();
            renderRows();
            if (!opts.silent && window.Toast) window.Toast.success('Deleted "' + (row.subject || 'email') + '"');
        } catch (err) {
            console.error('[inbox-receiver] deleteRow failed:', err);
            if (window.Toast) window.Toast.error('Delete failed: ' + (err.message || err));
        }
    }
    async function massDelete() {
        const ids = Array.from(state.checked);
        if (!ids.length) return;
        const ok = await uiConfirm({
            title: 'Delete ' + ids.length + ' email' + (ids.length === 1 ? '' : 's'),
            bodyHtml:
                '<div style="color:#0d2c3a;">You are about to delete <strong>' + ids.length + '</strong> selected email' + (ids.length === 1 ? '' : 's') + '.</div>' +
                '<div style="margin-top:.7rem;color:#c0392b;font-size:.88rem;"><i class="fas fa-exclamation-triangle"></i> This cannot be undone.</div>',
            okLabel: 'Delete ' + ids.length
        });
        if (!ok) return;
        const fb = await window.__firebaseReady;
        let okCount = 0, failCount = 0;
        for (const id of ids) {
            try {
                await fb.firestore.deleteDoc(fb.firestore.doc(fb.db, 'receivedEmails', id));
                state.rows = state.rows.filter(function (r) { return r.id !== id; });
                okCount++;
            } catch (err) {
                console.error('[inbox-receiver] mass-delete failed for', id, err);
                failCount++;
            }
        }
        state.checked.clear();
        if (state.selectedId && !state.rows.find(function (r) { return r.id === state.selectedId; })) {
            state.selectedId = '';
            state.previewClosed = true;
        }
        setCounts();
        renderRows();
        if (window.Toast) {
            if (failCount === 0) window.Toast.success('Deleted ' + okCount + ' email(s)');
            else window.Toast.error('Deleted ' + okCount + ', ' + failCount + ' failed');
        }
    }

    /* ── compose-modal prefill (Reply / Reply-All / Forward) */
    function prefillCompose(opts) {
        const composeBtn = $('inboxComposeBtn');
        if (composeBtn) composeBtn.click();
        setTimeout(function () {
            const toEl    = $('icTo');
            const subEl   = $('icSubject');
            const replyEl = $('icReplyTo');
            const bodyEl  = $('icBody');
            const fromEl  = $('icFrom');
            if (toEl    && opts.to       != null) toEl.value    = opts.to;
            if (subEl   && opts.subject  != null) subEl.value   = opts.subject;
            if (replyEl && opts.replyTo  != null) replyEl.value = opts.replyTo;
            if (bodyEl  && opts.body     != null) bodyEl.value  = opts.body;
            if (fromEl  && opts.from) {
                const want = String(opts.from).toLowerCase();
                Array.prototype.some.call(fromEl.options, function (o) {
                    if (String(o.value || '').toLowerCase() === want) {
                        fromEl.value = o.value; return true;
                    }
                    return false;
                });
            }
            const focusEl = (opts.to == null || opts.to === '') ? toEl : bodyEl;
            if (focusEl) try { focusEl.focus(); } catch (_) {}
        }, 50);
    }

    function quoteBody(row) {
        const orig = String(row.textPlain || row.subject || '').trim();
        const quoted = orig.split('\n').map(function (l) { return '> ' + l; }).join('\n');
        const when = fmtDate(row.receivedAt || row.date);
        return '\n\n\nOn ' + when + ', ' + (row.from || '') + ' wrote:\n' + quoted;
    }
    function forwardBody(row) {
        const headers =
            '---------- Forwarded message ----------\n' +
            'From: '    + (row.from || '') + '\n' +
            'Date: '    + fmtDate(row.receivedAt || row.date) + '\n' +
            'Subject: ' + (row.subject || '') + '\n' +
            'To: '      + (row.to || row.mailbox || '') + '\n\n';
        return '\n\n' + headers + (row.textPlain || '');
    }
    function doReply(row) {
        prefillCompose({
            to:      emailOnly(row.from || ''),
            subject: /^re:/i.test(row.subject || '') ? (row.subject || '') : ('Re: ' + (row.subject || '')),
            replyTo: row.mailbox || '',
            from:    row.mailbox || '',
            body:    quoteBody(row)
        });
    }
    function doReplyAll(row) {
        const toAddrs = [emailOnly(row.from || '')].filter(Boolean).join(', ');
        const ccRaw = [row.to, row.cc].filter(Boolean).join(', ');
        const ccAddrs = stripOwnMailboxes(ccRaw);
        const subject = /^re:/i.test(row.subject || '') ? (row.subject || '') : ('Re: ' + (row.subject || ''));
        let body = quoteBody(row);
        if (ccAddrs) body = '(Cc: ' + ccAddrs + ')\n' + body;
        prefillCompose({
            to: toAddrs, subject: subject,
            replyTo: row.mailbox || '', from: row.mailbox || '', body: body
        });
        if (ccAddrs && window.Toast) {
            window.Toast.info('Reply-All: please add these to To: manually \u2014 ' + ccAddrs);
        }
    }
    function doForward(row) {
        prefillCompose({
            to: '',
            subject: /^fwd?:/i.test(row.subject || '') ? (row.subject || '') : ('Fwd: ' + (row.subject || '')),
            replyTo: row.mailbox || '',
            from: row.mailbox || '',
            body: forwardBody(row)
        });
    }

    /* ── preview pane ───────────────────────────────────── */
    function setPreview(row) {
        const box = $('inboxPreview');
        if (!box) return;
        if (!row) {
            box.innerHTML =
                '<div class="inbox-preview-empty">' +
                    '<i class="fas fa-envelope-open"></i>' +
                    '<p>Select an email to preview.</p>' +
                '</div>';
            return;
        }
        // Ensure the panel is visible when showing a real row
        showSplitPanel();
        const bodyHtml = row.textHtml
            ? row.textHtml
            : '<div style="white-space:pre-wrap;line-height:1.6;">' + esc(row.textPlain || '(no body)') + '</div>';
        box.innerHTML =
            '<div class="ipv-head">' +
                '<button type="button" id="ipvCloseBtn" title="Close" style="position:absolute;top:.6rem;right:.6rem;background:none;border:none;font-size:1.1rem;color:#888;cursor:pointer;padding:.2rem .4rem;line-height:1;z-index:2;" aria-label="Close preview">&times;</button>' +
                '<h3 class="ipv-subject">' + esc(row.subject || '(no subject)') + '</h3>' +
                '<div class="ipv-meta">' +
                    '<div class="ipv-row"><strong>From:</strong> ' + esc(row.from || '') + '</div>' +
                    '<div class="ipv-row"><strong>To:</strong> ' + esc(row.to || row.mailbox || '') + '</div>' +
                    (row.cc ? '<div class="ipv-row"><strong>Cc:</strong> ' + esc(row.cc) + '</div>' : '') +
                    '<div class="ipv-row"><strong>Mailbox:</strong> ' + esc(mailboxLabel(row.mailbox)) + '</div>' +
                    '<div class="ipv-row"><strong>Received:</strong> ' + esc(fmtDate(row.receivedAt || row.date)) + '</div>' +
                '</div>' +
            '</div>' +
            '<div class="ipv-actions">' +
                '<button type="button" class="ipv-reply" id="ipvReplyBtn"><i class="fas fa-reply"></i> Reply</button>' +
                '<button type="button" id="ipvReplyAllBtn"><i class="fas fa-reply-all"></i> Reply All</button>' +
                '<button type="button" id="ipvForwardBtn"><i class="fas fa-share"></i> Forward</button>' +
                '<button type="button" id="ipvDeleteBtn" style="color:#c0392b;border-color:#f1c2bd;"><i class="fas fa-trash"></i> Delete</button>' +
            '</div>' +
            '<div class="ipv-body">' + bodyHtml + '</div>';

        const replyBtn    = $('ipvReplyBtn');
        const replyAllBtn = $('ipvReplyAllBtn');
        const forwardBtn  = $('ipvForwardBtn');
        const deleteBtn   = $('ipvDeleteBtn');
        if (replyBtn)    replyBtn.addEventListener('click',    function () { doReply(row); });
        if (replyAllBtn) replyAllBtn.addEventListener('click', function () { doReplyAll(row); });
        if (forwardBtn)  forwardBtn.addEventListener('click',  function () { doForward(row); });
        if (deleteBtn)   deleteBtn.addEventListener('click',   function () { deleteRow(row); });

        // × close button — hides panel, sets previewClosed so renderRows()
        // won't auto-reopen it on the next Firestore snapshot.
        const closeBtn = $('ipvCloseBtn');
        if (closeBtn) {
            closeBtn.addEventListener('click', function () {
                state.selectedId   = '';
                state.previewClosed = true;
                // Deselect highlighted row
                Array.prototype.forEach.call(
                    document.querySelectorAll('#inboxReceivedBody tr.selected'),
                    function (tr) { tr.classList.remove('selected'); }
                );
                hideSplitPanel();
            });
        }
    }

    /* ── list rendering with checkboxes + bulk toolbar ──── */
    function filteredRows() {
        return state.rows.filter(function (r) {
            return state.mailbox === ALL || r.mailbox === state.mailbox;
        });
    }
    function ensureToolbar() {
        // Scope to the inbox split — the bookings panel now also uses
        // .inbox-list-wrap (so its CSS/responsive behaviour matches the
        // inbox), so an unscoped querySelector would inject the inbox
        // bulk-delete toolbar into the bookings panel by mistake.
        const inboxSplit = document.getElementById('inboxSplit');
        const wrap = inboxSplit ? inboxSplit.querySelector('.inbox-list-wrap') : null;
        if (!wrap) return null;
        let bar = wrap.querySelector('.inbox-bulk-toolbar');
        if (bar) return bar;
        bar = document.createElement('div');
        bar.className = 'inbox-bulk-toolbar';
        bar.style.cssText = 'display:flex;align-items:center;gap:.6rem;padding:.5rem .85rem;border-bottom:1px solid #e3e8ef;background:#f8fafb;font-size:.85rem;';
        bar.innerHTML =
            '<label style="display:inline-flex;align-items:center;gap:.4rem;cursor:pointer;font-weight:600;color:#5a6877;">' +
                '<input type="checkbox" id="inboxSelectAll" style="cursor:pointer;"> Select all</label>' +
            '<span id="inboxSelectedCount" style="color:#5a6877;font-size:.78rem;"></span>' +
            '<span style="flex:1;"></span>' +
            '<button type="button" id="inboxMassDeleteBtn" disabled style="padding:.35rem .8rem;border-radius:6px;border:1px solid #e74c3c;background:#fff;color:#c0392b;font-weight:600;font-size:.82rem;cursor:pointer;display:inline-flex;align-items:center;gap:.35rem;">' +
                '<i class="fas fa-trash"></i> Delete selected</button>';
        const header = wrap.querySelector('.table-header');
        if (header && header.nextSibling) wrap.insertBefore(bar, header.nextSibling);
        else wrap.appendChild(bar);
        bar.querySelector('#inboxSelectAll').addEventListener('change', function (ev) {
            const want = ev.target.checked;
            const visible = filteredRows();
            if (want) visible.forEach(function (r) { state.checked.add(r.id); });
            else      visible.forEach(function (r) { state.checked.delete(r.id); });
            renderRows();
        });
        bar.querySelector('#inboxMassDeleteBtn').addEventListener('click', massDelete);
        return bar;
    }
    function refreshToolbar() {
        const bar = document.querySelector('.inbox-bulk-toolbar');
        if (!bar) return;
        const visible = filteredRows();
        const allTicked = visible.length > 0 && visible.every(function (r) { return state.checked.has(r.id); });
        const anyTicked = state.checked.size > 0;
        const selAll = bar.querySelector('#inboxSelectAll');
        if (selAll) {
            selAll.checked = allTicked;
            selAll.indeterminate = anyTicked && !allTicked;
        }
        const cnt = bar.querySelector('#inboxSelectedCount');
        if (cnt) cnt.textContent = anyTicked ? (state.checked.size + ' selected') : '';
        const massBtn = bar.querySelector('#inboxMassDeleteBtn');
        if (massBtn) massBtn.disabled = !anyTicked;
    }

    function renderRows() {
        const body = $('inboxReceivedBody');
        const label = $('inboxMbxLabel');
        if (label) label.textContent = mailboxLabel(state.mailbox);
        ensureToolbar();
        if (!body) return;
        const rows = filteredRows().sort(function (a, b) {
            return new Date(b.receivedAt || 0) - new Date(a.receivedAt || 0);
        });
        if (!rows.length) {
            body.innerHTML = '<tr><td colspan="5" class="table-empty">No emails found for this mailbox.</td></tr>';
            setPreview(null);
            refreshToolbar();
            return;
        }
        body.innerHTML = rows.map(function (r) {
            const checked = state.checked.has(r.id) ? 'checked' : '';
            return '<tr class="' + (r.unread ? 'unread ' : '') + (state.selectedId === r.id ? 'selected' : '') + '" data-mail-id="' + esc(r.id) + '">' +
                '<td class="inbox-cb-cell" style="width:32px;text-align:center;">' +
                    '<input type="checkbox" class="inbox-row-cb" data-mail-id="' + esc(r.id) + '" ' + checked + '></td>' +
                '<td>' + esc(fmtDate(r.receivedAt || r.date)) + '</td>' +
                '<td>' + esc(r.from || '') + '</td>' +
                '<td>' + esc(r.subject || '(no subject)') + '</td>' +
                '<td>' + esc(mailboxLabel(r.mailbox)) + '</td>' +
            '</tr>';
        }).join('');

        // Wire row clicks — clicking a row ALWAYS clears previewClosed and
        // opens the panel, regardless of its current visibility state.
        Array.prototype.forEach.call(body.querySelectorAll('tr[data-mail-id]'), function (tr) {
            tr.addEventListener('click', function (ev) {
                if (ev.target.closest('.inbox-cb-cell')) return;
                const id = tr.getAttribute('data-mail-id');
                state.selectedId    = id;
                state.previewClosed = false;   // FIX: user explicitly clicked → show panel
                const row = state.rows.find(function (r) { return r.id === id; });
                if (row) markRead(row);
                showSplitPanel();
                renderRows();
                setPreview(row || null);
            });
        });

        // Wire checkbox clicks
        Array.prototype.forEach.call(body.querySelectorAll('input.inbox-row-cb'), function (cb) {
            cb.addEventListener('click', function (ev) { ev.stopPropagation(); });
            cb.addEventListener('change', function () {
                const id = cb.getAttribute('data-mail-id');
                if (cb.checked) state.checked.add(id); else state.checked.delete(id);
                refreshToolbar();
            });
        });

        // Apply selected highlight; if previewClosed do NOT auto-open any row.
        Array.prototype.forEach.call(body.querySelectorAll('tr[data-mail-id]'), function (tr) {
            tr.classList.toggle('selected', tr.getAttribute('data-mail-id') === state.selectedId);
        });

        // FIX: only show the preview if the panel is not in the user-closed state
        if (!state.previewClosed) {
            // Keep currently selected row, or auto-select first row on initial load
            if (!state.selectedId && rows.length) {
                state.selectedId = rows[0].id;
                Array.prototype.forEach.call(body.querySelectorAll('tr[data-mail-id]'), function (tr) {
                    tr.classList.toggle('selected', tr.getAttribute('data-mail-id') === state.selectedId);
                });
            }
            const selected = state.rows.find(function (r) { return r.id === state.selectedId; }) || null;
            if (selected) setPreview(selected);
        }

        refreshToolbar();
    }

    function bindTabs() {
        Array.prototype.forEach.call(document.querySelectorAll('.inbox-mbx-tab'), function (btn) {
            btn.addEventListener('click', function () {
                state.mailbox = btn.getAttribute('data-mailbox') || ALL;
                Array.prototype.forEach.call(document.querySelectorAll('.inbox-mbx-tab'), function (b) {
                    b.classList.toggle('active', b === btn);
                    b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
                });
                state.checked.clear();
                renderRows();
            });
        });
        Array.prototype.forEach.call(document.querySelectorAll('.inbox-tab'), function (btn) {
            btn.addEventListener('click', function () {
                const pane = btn.getAttribute('data-inbox-tab') || 'received';
                state.pane = pane;
                Array.prototype.forEach.call(document.querySelectorAll('.inbox-tab'), function (b) {
                    b.classList.toggle('active', b === btn);
                    b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
                });
                const receivedPane = $('inboxReceivedPane');
                const sentPane = $('inboxSentPane');
                if (receivedPane) receivedPane.style.display = pane === 'received' ? '' : 'none';
                if (sentPane) sentPane.style.display = pane === 'sent' ? '' : 'none';
                if (pane === 'sent' && typeof window.loadInboxSent === 'function') window.loadInboxSent();
            });
        });
    }

    async function subscribe() {
        if (!window.__firebaseReady) return;
        const fb = await window.__firebaseReady;
        if (state.unsub) { try { state.unsub(); } catch (_) {} state.unsub = null; }
        const q = fb.firestore.query(
            fb.firestore.collection(fb.db, 'receivedEmails'),
            fb.firestore.orderBy('receivedAt', 'desc'),
            fb.firestore.limit(100)
        );
        state.unsub = fb.firestore.onSnapshot(q, function (snap) {
            const incoming = [];
            const fresh = [];
            snap.forEach(function (doc) {
                const data = doc.data() || {};
                const row = {
                    id: doc.id,
                    from: data.from || '',
                    to: data.to || '',
                    cc: data.cc || '',
                    subject: data.subject || '',
                    mailbox: String(data.mailbox || '').toLowerCase(),
                    unread: !!data.unread,
                    receivedAt: data.receivedAt || '',
                    date: data.date || '',
                    textPlain: data.textPlain || '',
                    textHtml: data.textHtml || ''
                };
                incoming.push(row);
                if (!state.seenIds.has(doc.id)) fresh.push(row);
                state.seenIds.add(doc.id);
            });
            state.rows = incoming;
            const liveIds = new Set(incoming.map(function (r) { return r.id; }));
            Array.from(state.checked).forEach(function (id) {
                if (!liveIds.has(id)) state.checked.delete(id);
            });
            // If the currently selected mail was deleted externally, clear it
            if (state.selectedId && !liveIds.has(state.selectedId)) {
                state.selectedId = '';
                state.previewClosed = true;
            }
            setCounts();
            renderRows();
            if (fresh.length && isAdminUser()) {
                const visibleFresh = fresh.filter(function (r) {
                    return MAILBOXES.some(function (m) { return m.id === r.mailbox; });
                });
                if (visibleFresh.length) {
                    const latest = visibleFresh[0];
                    if (window.Toast && typeof window.Toast.info === 'function') {
                        window.Toast.info('New mail in ' + mailboxLabel(latest.mailbox) + ': ' + (latest.subject || '(no subject)'));
                    }
                    notifyNative('New mail in ' + mailboxLabel(latest.mailbox), (latest.from || '') + ' \u2014 ' + (latest.subject || '(no subject)'));
                    beep();
                    flashTitle(visibleFresh.length);
                }
            }
        }, function (err) {
            console.error('[inbox-receiver] snapshot failed:', err);
            const body = $('inboxReceivedBody');
            if (body) body.innerHTML = '<tr><td colspan="5" class="table-empty" style="color:#c0392b;">Failed to load inbox: ' + esc(err.message || err) + '</td></tr>';
        });
    }

    function initRefresh() {
        const btn = $('inboxRefreshBtn');
        if (!btn) return;
        btn.addEventListener('click', function () {
            subscribe().catch(function (err) { console.error('[inbox-receiver] refresh failed:', err); });
            if (typeof window.loadInboxSent === 'function') window.loadInboxSent();
        });
    }

    function initResizableSplit() {
        const split = $('inboxSplit');
        const divider = $('inboxDivider');
        if (!split || !divider) return;
        const STORAGE_KEY = 'inboxSplitRatio';
        const MIN_PCT = 18, MAX_PCT = 75;
        function applyPct(pct) {
            const clamped = Math.max(MIN_PCT, Math.min(MAX_PCT, pct));
            split.style.setProperty('--inbox-list-w', clamped.toFixed(2) + '%');
        }
        let saved = parseFloat(localStorage.getItem(STORAGE_KEY) || '');
        if (!isFinite(saved) || saved < MIN_PCT || saved > MAX_PCT) saved = 40;
        applyPct(saved);
        let dragging = false;
        function onDown(ev) {
            ev.preventDefault(); dragging = true;
            divider.classList.add('active');
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
        }
        function onMove(ev) {
            if (!dragging) return;
            const rect = split.getBoundingClientRect();
            if (!rect.width) return;
            const x = (ev.touches ? ev.touches[0].clientX : ev.clientX) - rect.left;
            applyPct((x / rect.width) * 100);
        }
        function onUp() {
            if (!dragging) return;
            dragging = false;
            divider.classList.remove('active');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            const num = parseFloat(split.style.getPropertyValue('--inbox-list-w'));
            if (isFinite(num)) try { localStorage.setItem(STORAGE_KEY, String(num)); } catch (_) {}
        }
        divider.addEventListener('mousedown', onDown);
        divider.addEventListener('touchstart', onDown, { passive: false });
        document.addEventListener('mousemove', onMove);
        document.addEventListener('touchmove', onMove, { passive: false });
        document.addEventListener('mouseup', onUp);
        document.addEventListener('touchend', onUp);
        divider.addEventListener('dblclick', function () {
            applyPct(40);
            try { localStorage.setItem(STORAGE_KEY, '40'); } catch (_) {}
        });
        divider.addEventListener('keydown', function (ev) {
            if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
            ev.preventDefault();
            const cur = parseFloat(split.style.getPropertyValue('--inbox-list-w')) || 40;
            const next = ev.key === 'ArrowLeft' ? cur - 2 : cur + 2;
            applyPct(next);
            try { localStorage.setItem(STORAGE_KEY, String(Math.max(MIN_PCT, Math.min(MAX_PCT, next)))); } catch (_) {}
        });
    }

    function init() {
        bindTabs();
        initRefresh();
        initResizableSplit();
        subscribe().catch(function (err) { console.error('[inbox-receiver] init failed:', err); });
    }

    window.AdminInboxReceiver = { init: init, refresh: subscribe };
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
