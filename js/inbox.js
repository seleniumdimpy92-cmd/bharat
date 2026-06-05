/* ── Admin Inbox ──────────────────────────────────────────────────
 * Wires the dashboard's "Inbox" tab.
 *
 * Three mailbox sub-tabs (each is its own "mailbox"):
 *   • Bookings       → booking@andamanvoyages.in
 *   • Info           → info@andamanvoyages.in
 *   • Cancellations  → cancellation@andamanvoyages.in
 *   + an "All" view  → combined
 *
 * Live updates: a single onSnapshot listener on /receivedEmails keeps
 * every tab fresh in real time. When NEW unread email lands while the
 * dashboard is open and the user is admin, we trigger:
 *   – Toast banner (window.Toast)
 *   – Native browser Notification (if permission granted)
 *   – Short beep (WebAudio)
 *   – Tab-title flash: "(N) New mail • …"
 *   – Topnav Inbox badge
 *
 * Compose: POST /send to the inbox-mail Worker → Brevo → SMTP.
 *   On success, a record is written to /sentEmails so admins have a
 *   sent log.
 * ─────────────────────────────────────────────────────────────── */

(function () {
    'use strict';

    /* ── Mailbox config ─────────────────────────────────────── */
    const MAILBOXES = [
        { id: 'booking@andamanvoyages.in',      label: 'Bookings',      icon: 'fa-suitcase'      },
        { id: 'info@andamanvoyages.in',         label: 'Info',          icon: 'fa-info-circle'   },
        { id: 'cancellation@andamanvoyages.in', label: 'Cancellations', icon: 'fa-ban'           },
        { id: 'enquiries@andamanvoyages.in',    label: 'Enquiries',     icon: 'fa-question-circle' }
    ];
    const ALL = '__all__';

    function workerUrl() { return window.INBOX_WORKER_URL || ''; }
    function $(id) { return document.getElementById(id); }

    function escapeHtml(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
        });
    }
    function plainToHtml(text) {
        const lines = String(text || '').split(/\n{2,}/);
        return lines
            .map(p => '<p style="margin:0 0 12px;">' + escapeHtml(p).replace(/\n/g, '<br>') + '</p>')
            .join('\n');
    }
    function setStatus(el, msg, isError) {
        if (!el) return;
        el.textContent = msg || '';
        el.style.color = isError ? '#c0392b' : '#0a5a68';
    }
    function fmtDate(iso) {
        if (!iso) return '—';
        const d = new Date(iso);
        if (isNaN(d.getTime())) return iso;
        return d.toLocaleString();
    }
    function shortAddr(s) {
        const m = String(s || '').match(/^([^<]+?)\s*<.+>$/);
        return (m ? m[1] : (s || '')).trim();
    }
    function emailOnly(s) {
        const m = String(s || '').match(/<([^>]+)>/);
        return m ? m[1].trim() : String(s || '').trim();
    }
    function safeMailbox(envTo) {
        return emailOnly(envTo).toLowerCase();
    }
    function cssEscape(s) {
        return String(s).replace(/(["\\])/g, '\\$1');
    }

    /* ── Compose / send (outbound via Brevo) ───────────────── */

    async function sendEmail(args) {
        const url = workerUrl();
        if (!url) throw new Error('INBOX_WORKER_URL not configured (dashboard.html).');
        if (!window.__firebaseReady) throw new Error('Firebase not initialised.');

        const fb = await window.__firebaseReady;
        const user = fb.auth.currentUser;
        if (!user) throw new Error('You must be signed in.');
        const idToken = await user.getIdToken(false);

        const body = { to: args.to, subject: args.subject };
        if (args.html)    body.html = args.html;
        if (args.text)    body.text = args.text;
        if (args.replyTo) body.replyTo = args.replyTo;
        if (args.cc)      body.cc = args.cc;
        if (args.from)    body.from = args.from;

        let res, json;
        try {
            res = await fetch(url.replace(/\/$/, '') + '/send', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + idToken
                },
                body: JSON.stringify(body)
            });
            json = await res.json().catch(() => ({}));
        } catch (err) {
            throw new Error('Network error: ' + (err.message || 'unknown'));
        }
        if (!res.ok) throw new Error((json && json.error) || ('HTTP ' + res.status));
        return json;
    }

    async function logSent(record) {
        try {
            const fb = await window.__firebaseReady;
            const colRef = fb.firestore.collection(fb.db, 'sentEmails');
            await fb.firestore.addDoc(colRef, Object.assign({}, record, {
                createdAt: fb.firestore.serverTimestamp()
            }));
        } catch (err) {
            console.warn('[inbox] Could not log sent email:', err);
        }
    }

    async function loadSent() {
        const tbody = $('inboxSentBody');
        if (!tbody) return;
        tbody.innerHTML = '<tr><td colspan="5" class="table-empty">Loading…</td></tr>';
        try {
            const fb = await window.__firebaseReady;
            const q = fb.firestore.query(
                fb.firestore.collection(fb.db, 'sentEmails'),
                fb.firestore.orderBy('createdAt', 'desc'),
                fb.firestore.limit(50)
            );
            const snap = await fb.firestore.getDocs(q);
            if (snap.empty) {
                tbody.innerHTML = '<tr><td colspan="5" class="table-empty">No emails sent yet. Click Compose to start.</td></tr>';
                return;
            }
            const rows = [];
            snap.forEach(d => {
                const r = d.data() || {};
                const when = r.createdAt && r.createdAt.toDate
                    ? r.createdAt.toDate().toLocaleString()
                    : (r.sentAt || '—');
                // "From" should reflect the mailbox the email was sent from
                // (e.g. booking@andamanvoyages.in) — NOT the admin who clicked
                // Send. Fall back to sentBy only if the from field is missing
                // on legacy records.
                const fromAddr = r.from || r.sentBy || '—';
                rows.push(
                    '<tr>' +
                        '<td>' + escapeHtml(when) + '</td>' +
                        '<td>' + escapeHtml(r.to || '') + '</td>' +
                        '<td>' + escapeHtml(r.subject || '') + '</td>' +
                        '<td>' + escapeHtml(fromAddr) + '</td>' +
                        '<td><span class="badge badge-confirmed">SENT</span></td>' +
                    '</tr>'
                );
            });
            tbody.innerHTML = rows.join('');
        } catch (err) {
            console.error('[inbox] loadSent failed:', err);
            tbody.innerHTML = '<tr><td colspan="5" class="table-empty" style="color:#c0392b;">Failed to load: ' + escapeHtml(err.message || err) + '</td></tr>';
        }
    }

    function ensureComposeModal() {
        let modal = $('inboxComposeModal');
        if (modal) return modal;
        modal = document.createElement('div');
        modal.id = 'inboxComposeModal';
        modal.className = 'inbox-compose-modal';
        const fromOptions = (Array.isArray(window.INBOX_FROM_OPTIONS) && window.INBOX_FROM_OPTIONS.length)
            ? window.INBOX_FROM_OPTIONS
            : [{ email: 'booking@andamanvoyages.in', label: 'Bookings' }];
        const fromOptionsHtml = fromOptions.map(function (opt, i) {
            const safeEmail = escapeHtml(opt.email);
            const safeLabel = escapeHtml(opt.label || opt.email);
            return '<option value="' + safeEmail + '"' + (i === 0 ? ' selected' : '') + '>' +
                       safeLabel + ' &lt;' + safeEmail + '&gt;' +
                   '</option>';
        }).join('');

        modal.innerHTML =
            '<div class="ic-card">' +
                '<div class="ic-head">' +
                    '<h3><i class="fas fa-envelope-open-text"></i> Compose Email</h3>' +
                    '<button type="button" class="ic-close" aria-label="Close"><i class="fas fa-times"></i></button>' +
                '</div>' +
                '<div class="ic-body">' +
                    '<label>From <span class="ic-req">*</span>' +
                        '<select id="icFrom" required>' + fromOptionsHtml + '</select>' +
                    '</label>' +
                    '<label>To <span class="ic-req">*</span><input type="email" id="icTo" placeholder="customer@example.com" required></label>' +
                    '<label>Subject <span class="ic-req">*</span><input type="text" id="icSubject" placeholder="Re: Your Andaman trip enquiry" required maxlength="300"></label>' +
                    '<label>Reply-To (optional)<input type="email" id="icReplyTo" placeholder="info@andamanvoyages.in"></label>' +
                    '<label>Message <span class="ic-req">*</span><textarea id="icBody" rows="10" placeholder="Hi …" required></textarea></label>' +
                    '<div class="ic-status" id="icStatus"></div>' +
                '</div>' +
                '<div class="ic-foot">' +
                    '<button type="button" class="ic-cancel">Cancel</button>' +
                    '<button type="button" class="ic-send"><i class="fas fa-paper-plane"></i> Send</button>' +
                '</div>' +
            '</div>';
        document.body.appendChild(modal);

        function close() { modal.classList.remove('open'); }

        modal.addEventListener('click', e => { if (e.target === modal) close(); });
        modal.querySelector('.ic-close').addEventListener('click', close);
        modal.querySelector('.ic-cancel').addEventListener('click', close);
        modal.querySelector('.ic-send').addEventListener('click', onSend);
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape' && modal.classList.contains('open')) close();
        });

        async function onSend() {
            const fromSel  = $('icFrom');
            const from     = fromSel ? fromSel.value.trim() : '';
            const to       = $('icTo').value.trim();
            const subject  = $('icSubject').value.trim();
            const replyTo  = $('icReplyTo').value.trim();
            const bodyText = $('icBody').value.trim();
            const sendBtn  = modal.querySelector('.ic-send');
            const statusEl = $('icStatus');

            if (!to || !subject || !bodyText) {
                setStatus(statusEl, 'Please fill To, Subject and Message.', true);
                return;
            }
            sendBtn.disabled = true;
            sendBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending…';
            setStatus(statusEl, 'Sending via Brevo as ' + (from || 'default') + '…', false);

            try {
                const result = await sendEmail({
                    to, subject,
                    html: plainToHtml(bodyText),
                    text: bodyText,
                    replyTo: replyTo || undefined,
                    from: from || undefined
                });
                await logSent({
                    from: from || '',
                    to, subject,
                    bodyText,
                    sentBy: result.sentBy || '',
                    messageId: result.messageId || '',
                    sentAt: result.sentAt || new Date().toISOString()
                });
                if (window.Toast) window.Toast.success('Email sent to ' + to);
                close();
                loadSent();
            } catch (err) {
                console.error('[inbox] send failed:', err);
                setStatus(statusEl, '❌ ' + (err.message || 'Send failed'), true
);
            } finally {
                sendBtn.disabled = false;
                sendBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Send';
            }
        }
        return modal;
    }

    /* Open the Compose modal, optionally pre-filled.
       prefill = { to, subject, body, replyTo, from } — every field optional.
       External callers (e.g. js/ai-assistant.js) drop the AI-generated reply
       straight in by calling openCompose({ to, subject, body }). */
    function openCompose(prefill) {
        const modal = ensureComposeModal();
        prefill = prefill || {};
        const tEl  = $('icTo');      if (tEl)  tEl.value  = prefill.to      || '';
        const sEl  = $('icSubject'); if (sEl)  sEl.value  = prefill.subject || '';
        const rEl  = $('icReplyTo'); if (rEl)  rEl.value  = prefill.replyTo || '';
        const bEl  = $('icBody');    if (bEl)  bEl.value  = prefill.body    || '';
        const stEl = $('icStatus');  if (stEl) { stEl.textContent = ''; stEl.style.color = ''; }
        // If a "from" was suggested and the option exists in the dropdown, select it.
        if (prefill.from) {
            const fromSel = $('icFrom');
            if (fromSel) {
                for (let i = 0; i < fromSel.options.length; i++) {
                    if (fromSel.options[i].value === prefill.from) { fromSel.selectedIndex = i; break; }
                }
            }
        }
        modal.classList.add('open');
        // Focus the first empty field so the admin can start typing immediately.
        setTimeout(function () {
            if (!prefill.to && $('icTo'))           $('icTo').focus();
            else if (!prefill.subject && $('icSubject')) $('icSubject').focus();
            else if (!prefill.body && $('icBody'))  $('icBody').focus();
            else if ($('icBody'))                   $('icBody').focus();
        }, 60);
    }

    /* ── Public hooks ─────────────────────────────────────── */
    window.loadInboxSent    = loadSent;
    // Exposed for external callers (notably js/ai-assistant.js's
    // "Suggest reply" button — it calls openComposeModal({ to, subject, body })
    // to drop the AI-generated draft straight into the modal).
    window.openComposeModal = openCompose;

    function init() {
        const composeBtn = $('inboxComposeBtn');
        if (composeBtn && !composeBtn.__bound) {
            composeBtn.__bound = true;
            composeBtn.addEventListener('click', openCompose);
        }
        // Pre-load sent list lazily once Firebase is ready
        if (window.__firebaseReady) {
            window.__firebaseReady.then(function () {
                /* defer until Sent tab actually opened */
            }).catch(function () {});
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
