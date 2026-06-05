/* ── Admin Inbox — Auto-Reply ─────────────────────────────────────
 * Two features for the Admin → Inbox tab:
 *
 *   1) DRAFT REPLY ON DEMAND — preview pane gets a new "Reply with
 *      template" button that opens Compose pre-filled with the saved
 *      template, addressed to the sender.
 *
 *   2) AUTOMATIC TEMPLATE REPLY ON NEW MAIL — when a brand-new mail
 *      lands in /receivedEmails AND auto-reply is enabled, send the
 *      templated reply through the inbox-mail Worker.
 *
 *      Throttling:
 *        • per-message: each receivedEmail doc-id gets at most one
 *          auto-reply (tracked in localStorage)
 *        • per-sender:  one auto-reply per sender per cooldownHours
 *        • loop guard:  skip our own mailboxes + bounce/no-reply
 *
 * Settings live in /settings/inboxAutoReply (admin-write; covered by
 * existing firestore.rules — no rule changes required).
 *
 * Placeholders in subject/body:
 *   {{senderName}} {{senderEmail}} {{firstName}}
 *   {{subject}} {{originalSubject}} {{mailbox}} {{date}}
 * ────────────────────────────────────────────────────────────── */

(function () {
    'use strict';

    /* ── Constants ───────────────────────────────────────── */
    const SETTINGS_DOC      = 'inboxAutoReply';
    const LS_REPLIED_IDS    = 'inboxAutoReplyDoneIds';
    const LS_REPLIED_SENDER = 'inboxAutoReplySenders';
    const SS_LOCK           = 'inboxAutoReplyLock';
    const MAX_TRACKED_IDS   = 500;

    const DEFAULT_TEMPLATE = {
        enabled: false,
        sendImmediately: false,
        cooldownHours: 24,
        defaultFrom: 'mailbox',
        subject: 'We received your email — Bharat Voyages',
        body:
            'Hi {{firstName}},\n\n' +
            'Thanks for reaching out to Bharat Transport & Tourism. We have received your email regarding "{{subject}}" and our team will get back to you within 24 hours (Mon–Sat, 9 AM – 7 PM IST).\n\n' +
            'For urgent travel queries you can also reach us on WhatsApp at +91 98765 43210.\n\n' +
            'Warm regards,\nTeam Bharat Voyages\nhttps://andamanvoyages.in'
    };

    const NO_REPLY_PATTERNS = [
        /^mailer-daemon@/i, /^postmaster@/i, /^no-?reply@/i,
        /^do-?not-?reply@/i, /^bounce/i, /^abuse@/i, /^auto/i,
        /-bounces?@/i
    ];

    const OUR_MAILBOXES = [
        'booking@andamanvoyages.in',
        'info@andamanvoyages.in',
        'cancellation@andamanvoyages.in',
        'enquiries@andamanvoyages.in'
    ];

    /* ── Helpers ─────────────────────────────────────────── */
    function $(id) { return document.getElementById(id); }
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
        });
    }
    function plainToHtml(text) {
        return String(text || '').split(/\n{2,}/)
            .map(function (p) { return '<p style="margin:0 0 12px;">' + esc(p).replace(/\n/g, '<br>') + '</p>'; })
            .join('\n');
    }
    function emailOnly(s) {
        const m = String(s || '').match(/<([^>]+)>/);
        return m ? m[1].trim() : String(s || '').trim();
    }
    function nameOnly(s) {
        const m = String(s || '').match(/^([^<]+?)\s*<.+>$/);
        const n = (m ? m[1] : '').trim().replace(/^"|"$/g, '');
        if (n) return n;
        const e = emailOnly(s);
        const u = (e.split('@')[0] || '');
        return u.replace(/[._-]+/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); }).trim() || 'there';
    }
    function firstName(s) { return (nameOnly(s).split(/\s+/)[0] || 'there'); }
    function fmtDate(iso) {
        if (!iso) return '';
        const d = new Date(iso);
        return isNaN(d.getTime()) ? iso : d.toLocaleString();
    }
    function isAdminUser() {
        const email = (((window.currentUser || {}).email) || '').toLowerCase();
        const admins = Array.isArray(window.ADMIN_EMAILS)
            ? window.ADMIN_EMAILS.map(function (v) { return String(v).toLowerCase(); }) : [];
        return !!email && admins.indexOf(email) !== -1;
    }
    function isOwnAddress(addr) {
        return OUR_MAILBOXES.indexOf(emailOnly(addr).toLowerCase()) !== -1;
    }
    function isNoReplyAddress(addr) {
        const a = emailOnly(addr).toLowerCase();
        if (!a || a.indexOf('@') === -1) return true;
        return NO_REPLY_PATTERNS.some(function (re) { return re.test(a); });
    }
    function lsGetArr(k) {
        try { return JSON.parse(localStorage.getItem(k) || '[]') || []; } catch (_) { return []; }
    }
    function lsSetArr(k, a) {
        try { localStorage.setItem(k, JSON.stringify(a.slice(-MAX_TRACKED_IDS))); } catch (_) {}
    }
    function lsGetMap(k) {
        try { return JSON.parse(localStorage.getItem(k) || '{}') || {}; } catch (_) { return {}; }
    }
    function lsSetMap(k, o) {
        try { localStorage.setItem(k, JSON.stringify(o)); } catch (_) {}
    }

    /* ── State ──────────────────────────────────────────── */
    const state = {
        config: Object.assign({}, DEFAULT_TEMPLATE),
        configLoaded: false,
        unsubConfig: null,
        unsubMail: null,
        seenIds: null,        // first snapshot is treated as "history"
        sending: false        // in-flight mutex
    };

    /* ── Firestore: load + save settings ─────────────────── */
    async function loadConfig() {
        if (!window.__firebaseReady) return;
        try {
            const fb = await window.__firebaseReady;
            const ref = fb.firestore.doc(fb.db, 'settings', SETTINGS_DOC);
            if (state.unsubConfig) { try { state.unsubConfig(); } catch (_) {} }
            state.unsubConfig = fb.firestore.onSnapshot(ref, function (snap) {
                state.config = snap.exists()
                    ? Object.assign({}, DEFAULT_TEMPLATE, snap.data() || {})
                    : Object.assign({}, DEFAULT_TEMPLATE);
                state.configLoaded = true;
                fillModalFromConfig();
                refreshTopBtnBadge();
            }, function (err) {
                console.warn('[inbox-autoreply] config snapshot failed:', err);
                state.configLoaded = true;
            });
        } catch (err) {
            console.warn('[inbox-autoreply] loadConfig failed:', err);
        }
    }
    async function saveConfig(patch) {
        if (!window.__firebaseReady) throw new Error('Firebase not ready');
        const fb = await window.__firebaseReady;
        const user = fb.auth.currentUser;
        if (!user) throw new Error('Not signed in');
        const ref = fb.firestore.doc(fb.db, 'settings', SETTINGS_DOC);
        const next = Object.assign({}, state.config, patch, {
            updatedAt: fb.firestore.serverTimestamp(),
            updatedBy: user.email || ''
        });
        await fb.firestore.setDoc(ref, next, { merge: true });
        return next;
    }

    /* ── Template rendering ──────────────────────────────── */
    function renderTemplate(tpl, row) {
        const repl = {
            '{{senderName}}':      nameOnly(row.from || ''),
            '{{senderEmail}}':     emailOnly(row.from || ''),
            '{{firstName}}':       firstName(row.from || ''),
            '{{subject}}':         row.subject || '',
            '{{originalSubject}}': row.subject || '',
            '{{mailbox}}':         row.mailbox || '',
            '{{date}}':            fmtDate(row.receivedAt || row.date)
        };
        let out = String(tpl == null ? '' : tpl);
        Object.keys(repl).forEach(function (k) {
            out = out.split(k).join(repl[k]);
        });
        return out;
    }
    function buildReply(row) {
        const cfg = state.config || DEFAULT_TEMPLATE;
        const subject = renderTemplate(cfg.subject || DEFAULT_TEMPLATE.subject, row);
        const body    = renderTemplate(cfg.body    || DEFAULT_TEMPLATE.body,    row);
        const to      = emailOnly(row.from || '');
        const fromBox = (cfg.defaultFrom && cfg.defaultFrom !== 'mailbox')
            ? cfg.defaultFrom
            : (row.mailbox || OUR_MAILBOXES[0]);
        return { to: to, subject: subject, body: body, from: fromBox, replyTo: fromBox };
    }

    /* ── Worker: send email ──────────────────────────────── */
    async function workerSend(args) {
        const url = window.INBOX_WORKER_URL;
        if (!url) throw new Error('INBOX_WORKER_URL not configured');
        const fb = await window.__firebaseReady;
        const user = fb.auth.currentUser;
        if (!user) throw new Error('Not signed in');
        const idToken = await user.getIdToken(false);
        const body = {
            to: args.to,
            subject: args.subject,
            text: args.text,
            html: args.html
        };
        if (args.from)    body.from    = args.from;
        if (args.replyTo) body.replyTo = args.replyTo;
        const res = await fetch(url.replace(/\/$/, '') + '/send', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + idToken
            },
            body: JSON.stringify(body)
        });
        const json = await res.json().catch(function () { return {}; });
        if (!res.ok) throw new Error((json && json.error) || ('HTTP ' + res.status));
        return json;
    }

    async function logSent(rec) {
        try {
            const fb = await window.__firebaseReady;
            const colRef = fb.firestore.collection(fb.db, 'sentEmails');
            await fb.firestore.addDoc(colRef, Object.assign({}, rec, {
                createdAt: fb.firestore.serverTimestamp()
            }));
        } catch (err) {
            console.warn('[inbox-autoreply] logSent failed:', err);
        }
    }

    /* ── Decide if a row is auto-reply-eligible ──────────── */
    function eligibility(row) {
        const cfg = state.config;
        if (!cfg || !cfg.enabled) return { ok: false, reason: 'disabled' };
        if (!row || !row.from) return { ok: false, reason: 'no-from' };
        if (isOwnAddress(row.from))     return { ok: false, reason: 'self' };
        if (isNoReplyAddress(row.from)) return { ok: false, reason: 'no-reply-addr' };

        // per-message-id throttle
        const done = new Set(lsGetArr(LS_REPLIED_IDS));
        if (done.has(row.id)) return { ok: false, reason: 'already-replied' };

        // per-sender cooldown
        const senders = lsGetMap(LS_REPLIED_SENDER);
        const sender  = emailOnly(row.from).toLowerCase();
        const last    = senders[sender] || 0;
        const cooldownMs = (Number(cfg.cooldownHours) || 24) * 3600 * 1000;
        if (last && (Date.now() - last) < cooldownMs) {
            return { ok: false, reason: 'cooldown' };
        }
        return { ok: true };
    }

    function markReplied(row) {
        const ids = lsGetArr(LS_REPLIED_IDS);
        if (ids.indexOf(row.id) === -1) ids.push(row.id);
        lsSetArr(LS_REPLIED_IDS, ids);

        const senders = lsGetMap(LS_REPLIED_SENDER);
        const sender  = emailOnly(row.from).toLowerCase();
        senders[sender] = Date.now();
        lsSetMap(LS_REPLIED_SENDER, senders);
    }

    /* ── Auto-send pipeline ─────────────────────────────── */
    async function autoSend(row) {
        // Tab-lock (sessionStorage) — prevents duplicate sends within
        // the same browser when two tabs are open. localStorage is the
        // cross-tab idempotency layer (see markReplied).
        try {
            const lockKey = SS_LOCK + ':' + row.id;
            if (sessionStorage.getItem(lockKey)) return;
            sessionStorage.setItem(lockKey, String(Date.now()));
        } catch (_) {}

        const reply = buildReply(row);
        if (!reply.to) return;

        try {
            const result = await workerSend({
                to: reply.to,
                subject: reply.subject,
                text: reply.body,
                html: plainToHtml(reply.body),
                from: reply.from,
                replyTo: reply.replyTo
            });
            markReplied(row);
            await logSent({
                from: reply.from || '',
                to: reply.to,
                subject: reply.subject,
                bodyText: reply.body,
                sentBy: (result && result.sentBy) || '',
                messageId: (result && result.messageId) || '',
                sentAt: (result && result.sentAt) || new Date().toISOString(),
                autoReply: true,
                inReplyToMailId: row.id
            });
            if (window.Toast && typeof window.Toast.info === 'function') {
                window.Toast.info('Auto-reply sent to ' + reply.to);
            }
            // Refresh the Sent tab if its loader exists
            if (typeof window.loadInboxSent === 'function') window.loadInboxSent();
        } catch (err) {
            console.error('[inbox-autoreply] auto-send failed:', err);
            if (window.Toast && typeof window.Toast.error === 'function') {
                window.Toast.error('Auto-reply failed: ' + (err.message || err));
            }
        }
    }

    /* ── Subscribe to receivedEmails for new-mail trigger ── */
    async function subscribeReceived() {
        if (!window.__firebaseReady) return;
        try {
            const fb = await window.__firebaseReady;
            if (state.unsubMail) { try { state.unsubMail(); } catch (_) {} }
            const q = fb.firestore.query(
                fb.firestore.collection(fb.db, 'receivedEmails'),
                fb.firestore.orderBy('receivedAt', 'desc'),
                fb.firestore.limit(50)
            );
            state.unsubMail = fb.firestore.onSnapshot(q, function (snap) {
                const ids = new Set();
                const fresh = [];
                snap.forEach(function (doc) {
                    const data = doc.data() || {};
                    const row = {
                        id: doc.id,
                        from: data.from || '',
                        to: data.to || '',
                        subject: data.subject || '',
                        mailbox: String(data.mailbox || '').toLowerCase(),
                        unread: !!data.unread,
                        receivedAt: data.receivedAt || '',
                        date: data.date || '',
                        textPlain: data.textPlain || '',
                        textHtml: data.textHtml || ''
                    };
                    ids.add(doc.id);
                    if (state.seenIds && !state.seenIds.has(doc.id)) {
                        fresh.push(row);
                    }
                });
                // First snapshot = history; arm the listener for next time
                if (state.seenIds === null) {
                    state.seenIds = ids;
                    return;
                }
                state.seenIds = ids;

                if (!fresh.length) return;
                if (!state.config || !state.config.enabled) return;
                if (!state.config.sendImmediately) return;
                if (!isAdminUser()) return;
                // Process in a tiny serial loop to avoid hammering Brevo
                (async function () {
                    if (state.sending) return;
                    state.sending = true;
                    try {
                        for (let i = 0; i < fresh.length; i++) {
                            const row = fresh[i];
                            const verdict = eligibility(row);
                            if (verdict.ok) {
                                await autoSend(row);
                                // small spacing so we don't trip rate limits
                                await new Promise(function (r) { setTimeout(r, 700); });
                            } else {
                                console.debug('[inbox-autoreply] skip', row.id, verdict.reason);
                            }
                        }
                    } finally {
                        state.sending = false;
                    }
                })();
            }, function (err) {
                console.warn('[inbox-autoreply] receivedEmails snapshot failed:', err);
            });
        } catch (err) {
            console.warn('[inbox-autoreply] subscribeReceived failed:', err);
        }
    }

    /* ── Settings modal UI ──────────────────────────────── */
    function ensureModal() {
        let modal = $('iarSettingsModal');
        if (modal) return modal;
        modal = document.createElement('div');
        modal.id = 'iarSettingsModal';
        modal.className = 'iar-modal';
        modal.innerHTML =
            '<div class="iar-card">' +
                '<div class="iar-head">' +
                    '<h3><i class="fas fa-robot"></i> Inbox Auto-Reply</h3>' +
                    '<button type="button" class="iar-close" aria-label="Close"><i class="fas fa-times"></i></button>' +
                '</div>' +
                '<div class="iar-body">' +
                    '<div class="iar-row">' +
                        '<label class="iar-switch">' +
                            '<input type="checkbox" id="iarEnabled"> ' +
                            '<span class="iar-switch-text"><strong>Enable auto-reply</strong> &mdash; create draft replies for incoming mail</span>' +
                        '</label>' +
                    '</div>' +
                    '<div class="iar-row">' +
                        '<label class="iar-switch">' +
                            '<input type="checkbox" id="iarSendImmediately"> ' +
                            '<span class="iar-switch-text"><strong>Send immediately</strong> &mdash; auto-send the templated reply when new mail arrives (otherwise admin must click "Reply with template" manually)</span>' +
                        '</label>' +
                    '</div>' +
                    '<div class="iar-row iar-row-grid">' +
                        '<label>From mailbox' +
                            '<select id="iarDefaultFrom">' +
                                '<option value="mailbox">Same mailbox the mail came in</option>' +
                                '<option value="noreply@andamanvoyages.in">noreply@andamanvoyages.in (recommended for auto-replies)</option>' +
                                '<option value="booking@andamanvoyages.in">booking@andamanvoyages.in</option>' +
                                '<option value="info@andamanvoyages.in">info@andamanvoyages.in</option>' +
                                '<option value="cancellation@andamanvoyages.in">cancellation@andamanvoyages.in</option>' +
                                '<option value="enquiries@andamanvoyages.in">enquiries@andamanvoyages.in</option>' +
                            '</select>' +
                        '</label>' +
                        '<label>Per-sender cooldown (hours)' +
                            '<input type="number" id="iarCooldown" min="0" max="720" step="1">' +
                        '</label>' +
                    '</div>' +
                    '<label>Subject' +
                        '<input type="text" id="iarSubject" maxlength="300">' +
                    '</label>' +
                    '<label>Body' +
                        '<textarea id="iarBody" rows="10"></textarea>' +
                    '</label>' +
                    '<div class="iar-hint">' +
                        '<strong>Placeholders:</strong> ' +
                        '<code>{{firstName}}</code> <code>{{senderName}}</code> <code>{{senderEmail}}</code> ' +
                        '<code>{{subject}}</code> <code>{{mailbox}}</code> <code>{{date}}</code>' +
                    '</div>' +
                    '<div class="iar-status" id="iarStatus"></div>' +
                '</div>' +
                '<div class="iar-foot">' +
                    '<button type="button" class="iar-btn iar-cancel">Cancel</button>' +
                    '<button type="button" class="iar-btn iar-test">Send test to me</button>' +
                    '<button type="button" class="iar-btn iar-primary iar-save"><i class="fas fa-save"></i> Save</button>' +
                '</div>' +
            '</div>';
        document.body.appendChild(modal);

        function close() { modal.classList.remove('open'); }
        modal.addEventListener('click', function (e) { if (e.target === modal) close(); });
        modal.querySelector('.iar-close').addEventListener('click', close);
        modal.querySelector('.iar-cancel').addEventListener('click', close);
        modal.querySelector('.iar-save').addEventListener('click', onSave);
        modal.querySelector('.iar-test').addEventListener('click', onTest);
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && modal.classList.contains('open')) close();
        });
        return modal;
    }

    function fillModalFromConfig() {
        const modal = $('iarSettingsModal');
        if (!modal) return;
        const cfg = state.config || DEFAULT_TEMPLATE;
        const e1 = $('iarEnabled');         if (e1) e1.checked  = !!cfg.enabled;
        const e2 = $('iarSendImmediately'); if (e2) e2.checked  = !!cfg.sendImmediately;
        const e3 = $('iarDefaultFrom');     if (e3) e3.value    = cfg.defaultFrom || 'mailbox';
        const e4 = $('iarCooldown');        if (e4) e4.value    = (cfg.cooldownHours == null ? 24 : cfg.cooldownHours);
        const e5 = $('iarSubject');         if (e5) e5.value    = cfg.subject || '';
        const e6 = $('iarBody');            if (e6) e6.value    = cfg.body    || '';
    }

    function readModalIntoPatch() {
        return {
            enabled:         !!($('iarEnabled')         && $('iarEnabled').checked),
            sendImmediately: !!($('iarSendImmediately') && $('iarSendImmediately').checked),
            defaultFrom:     ($('iarDefaultFrom') && $('iarDefaultFrom').value) || 'mailbox',
            cooldownHours:   Math.max(0, Math.min(720, parseInt(($('iarCooldown') && $('iarCooldown').value) || '24', 10) || 24)),
            subject:         ($('iarSubject') && $('iarSubject').value) || '',
            body:            ($('iarBody')    && $('iarBody').value)    || ''
        };
    }

    async function onSave() {
        const status = $('iarStatus');
        const btn    = document.querySelector('#iarSettingsModal .iar-save');
        if (status) { status.textContent = 'Saving…'; status.style.color = '#0a5a68'; }
        if (btn) { btn.disabled = true; }
        try {
            await saveConfig(readModalIntoPatch());
            if (status) { status.textContent = '✓ Saved.'; status.style.color = '#0a5a68'; }
            if (window.Toast && typeof window.Toast.success === 'function') {
                window.Toast.success('Auto-reply settings saved');
            }
            setTimeout(function () {
                const m = $('iarSettingsModal');
                if (m) m.classList.remove('open');
            }, 600);
        } catch (err) {
            console.error('[inbox-autoreply] save failed:', err);
            if (status) { status.textContent = '❌ ' + (err.message || 'Save failed'); status.style.color = '#c0392b'; }
        } finally {
            if (btn) { btn.disabled = false; }
        }
    }

    async function onTest() {
        const status = $('iarStatus');
        const btn    = document.querySelector('#iarSettingsModal .iar-test');
        if (!window.__firebaseReady) {
            if (status) { status.textContent = 'Firebase not ready.'; status.style.color = '#c0392b'; }
            return;
        }
        const fb = await window.__firebaseReady;
        const me = fb.auth.currentUser && fb.auth.currentUser.email;
        if (!me) {
            if (status) { status.textContent = 'Not signed in.'; status.style.color = '#c0392b'; }
            return;
        }
        const patch = readModalIntoPatch();
        const tplCfg = Object.assign({}, state.config, patch);
        const fakeRow = {
            id: 'test-' + Date.now(),
            from: '"' + (me.split('@')[0]) + '" <' + me + '>',
            subject: 'Test enquiry — ignore',
            mailbox: tplCfg.defaultFrom !== 'mailbox' ? tplCfg.defaultFrom : OUR_MAILBOXES[0],
            receivedAt: new Date().toISOString()
        };
        const subject = renderTemplate(tplCfg.subject || DEFAULT_TEMPLATE.subject, fakeRow);
        const body    = renderTemplate(tplCfg.body    || DEFAULT_TEMPLATE.body,    fakeRow);
        const fromBox = (tplCfg.defaultFrom && tplCfg.defaultFrom !== 'mailbox')
            ? tplCfg.defaultFrom : OUR_MAILBOXES[0];
        if (status) { status.textContent = 'Sending test to ' + me + '…'; status.style.color = '#0a5a68'; }
        if (btn) { btn.disabled = true; }
        try {
            await workerSend({
                to: me,
                subject: '[TEST] ' + subject,
                text: body,
                html: plainToHtml(body),
                from: fromBox,
                replyTo: fromBox
            });
            if (status) { status.textContent = '✓ Test sent to ' + me; status.style.color = '#0a5a68'; }
            if (window.Toast && typeof window.Toast.success === 'function') {
                window.Toast.success('Test auto-reply sent to ' + me);
            }
        } catch (err) {
            console.error('[inbox-autoreply] test send failed:', err);
            if (status) { status.textContent = '❌ ' + (err.message || 'Send failed'); status.style.color = '#c0392b'; }
        } finally {
            if (btn) { btn.disabled = false; }
        }
    }

    function openSettingsModal() {
        const modal = ensureModal();
        fillModalFromConfig();
        const status = $('iarStatus');
        if (status) { status.textContent = ''; status.style.color = ''; }
        modal.classList.add('open');
    }

    /* ── Top-bar button + preview-pane button injection ──── */
    function ensureStyles() {
        if ($('iarStyles')) return;
        const css = document.createElement('style');
        css.id = 'iarStyles';
        css.textContent = ''
            + '.iar-modal{position:fixed;inset:0;z-index:1100;display:none;align-items:center;justify-content:center;background:rgba(15,32,39,.55);backdrop-filter:blur(2px);padding:1rem;}'
            + '.iar-modal.open{display:flex;}'
            + '.iar-card{background:#fff;border-radius:14px;max-width:680px;width:100%;max-height:90vh;display:flex;flex-direction:column;box-shadow:0 24px 60px rgba(0,0,0,.32);overflow:hidden;}'
            + '.iar-head{display:flex;align-items:center;justify-content:space-between;padding:.9rem 1.25rem;border-bottom:1px solid #e3e8ef;background:#f9fbfc;}'
            + '.iar-head h3{margin:0;font-size:1.05rem;font-weight:700;color:#0d2c3a;display:inline-flex;align-items:center;gap:.55rem;}'
            + '.iar-head h3 i{color:#0d7a8a;}'
            + '.iar-close{background:none;border:none;font-size:1rem;color:#7a8b96;cursor:pointer;padding:.3rem .4rem;border-radius:6px;}'
            + '.iar-close:hover{background:#eef3f5;color:#0d2c3a;}'
            + '.iar-body{padding:1rem 1.25rem;overflow-y:auto;display:flex;flex-direction:column;gap:.75rem;}'
            + '.iar-body label{display:flex;flex-direction:column;gap:.3rem;font-size:.86rem;font-weight:600;color:#3a4a55;}'
            + '.iar-body input[type=text],.iar-body input[type=number],.iar-body select,.iar-body textarea{padding:.55rem .7rem;border:1px solid #cfd9df;border-radius:8px;font-family:inherit;font-size:.92rem;font-weight:400;color:#0d2c3a;background:#fff;}'
            + '.iar-body textarea{resize:vertical;font-family:"JetBrains Mono",monospace;font-size:.85rem;line-height:1.55;}'
            + '.iar-body input:focus,.iar-body select:focus,.iar-body textarea:focus{outline:none;border-color:#0d7a8a;box-shadow:0 0 0 3px rgba(13,122,138,.15);}'
            + '.iar-row-grid{display:grid;grid-template-columns:1fr 180px;gap:.75rem;}'
            + '@media (max-width:560px){.iar-row-grid{grid-template-columns:1fr;}}'
            + '.iar-switch{flex-direction:row !important;align-items:flex-start;gap:.55rem;font-weight:500 !important;cursor:pointer;}'
            + '.iar-switch input{margin-top:.2rem;cursor:pointer;}'
            + '.iar-switch-text{flex:1;font-size:.88rem;line-height:1.5;color:#3a4a55;}'
            + '.iar-hint{font-size:.78rem;color:#5a6877;background:#f4f7f9;border:1px dashed #cfd9df;border-radius:8px;padding:.55rem .7rem;line-height:1.6;}'
            + '.iar-hint code{background:#fff;padding:.05rem .35rem;border-radius:4px;font-size:.78rem;border:1px solid #e3e8ef;color:#0d7a8a;}'
            + '.iar-status{font-size:.85rem;min-height:1.2em;}'
            + '.iar-foot{padding:.75rem 1.25rem;border-top:1px solid #e3e8ef;background:#f9fbfc;display:flex;justify-content:flex-end;gap:.5rem;}'
            + '.iar-btn{padding:.55rem 1rem;border-radius:8px;border:1px solid #cfd9df;background:#fff;color:#3a4a55;font-weight:600;font-family:inherit;font-size:.88rem;cursor:pointer;display:inline-flex;align-items:center;gap:.4rem;}'
            + '.iar-btn:hover{background:#f4f7f9;}'
            + '.iar-btn.iar-primary{border-color:#0d7a8a;background:linear-gradient(135deg,#0d7a8a,#0a5a68);color:#fff;}'
            + '.iar-btn.iar-primary:hover{filter:brightness(1.08);}'
            + '.iar-btn:disabled{opacity:.5;cursor:not-allowed;}'
            + '/* Preview-pane "Reply with template" button */'
            + '#ipvAutoReplyBtn{background:linear-gradient(135deg,#8e44ad,#6c3483) !important;color:#fff !important;border-color:#6c3483 !important;}'
            + '#ipvAutoReplyBtn:hover{filter:brightness(1.08);}'
            + '/* Top-bar AR button */'
            + '#inboxAutoReplyBtn{background:#8e44ad !important;}'
            + '#inboxAutoReplyBtn .iar-on-pill{margin-left:.4rem;padding:.05rem .45rem;font-size:.65rem;font-weight:800;background:#27ae60;color:#fff;border-radius:999px;letter-spacing:.06em;}';
        document.head.appendChild(css);
    }

    function ensureTopButton() {
        const composeBtn = $('inboxComposeBtn');
        if (!composeBtn) return;
        if ($('inboxAutoReplyBtn')) return;
        const btn = document.createElement('button');
        btn.id = 'inboxAutoReplyBtn';
        btn.type = 'button';
        btn.className = 'btn-add-package';
        btn.innerHTML = '<i class="fas fa-robot"></i> Auto-Reply <span class="iar-on-pill" style="display:none;">ON</span>';
        btn.addEventListener('click', openSettingsModal);
        // Insert just after Compose
        composeBtn.parentNode.insertBefore(btn, composeBtn.nextSibling);
        refreshTopBtnBadge();
    }

    function refreshTopBtnBadge() {
        const btn = $('inboxAutoReplyBtn');
        if (!btn) return;
        const pill = btn.querySelector('.iar-on-pill');
        if (!pill) return;
        const on = !!(state.config && state.config.enabled);
        pill.style.display = on ? '' : 'none';
        if (on) {
            pill.textContent = state.config.sendImmediately ? 'AUTO' : 'ON';
            pill.style.background = state.config.sendImmediately ? '#c0392b' : '#27ae60';
        }
    }

    /* Inject a "Reply with template" action into the preview pane.
       The preview pane is rebuilt every time a row is selected (see
       inbox-receiver.js → setPreview()), so we observe the pane with a
       MutationObserver and add our button into the .ipv-actions row
       whenever it appears. We also pick up the active row from the
       selected table row so we can build the correct reply. */
    function bindPreviewObserver() {
        const previewWrap = $('inboxPreview');
        if (!previewWrap) return;
        const obs = new MutationObserver(function () {
            injectReplyTemplateBtn();
        });
        obs.observe(previewWrap, { childList: true, subtree: true });
    }

    function injectReplyTemplateBtn() {
        const actions = document.querySelector('#inboxPreview .ipv-actions');
        if (!actions) return;
        if (actions.querySelector('#ipvAutoReplyBtn')) return;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.id = 'ipvAutoReplyBtn';
        btn.innerHTML = '<i class="fas fa-robot"></i> Reply with template';
        btn.title = 'Open Compose pre-filled with the saved auto-reply template';
        btn.addEventListener('click', onReplyWithTemplate);
        // Insert right after Reply
        const replyBtn = actions.querySelector('#ipvReplyBtn');
        if (replyBtn && replyBtn.nextSibling) {
            actions.insertBefore(btn, replyBtn.nextSibling);
        } else {
            actions.appendChild(btn);
        }
    }

    function getCurrentPreviewRowId() {
        const sel = document.querySelector('#inboxReceivedBody tr.selected[data-mail-id]');
        return sel ? sel.getAttribute('data-mail-id') : '';
    }

    async function fetchRowById(id) {
        if (!id || !window.__firebaseReady) return null;
        try {
            const fb = await window.__firebaseReady;
            const ref = fb.firestore.doc(fb.db, 'receivedEmails', id);
            const snap = await fb.firestore.getDoc(ref);
            if (!snap.exists()) return null;
            const data = snap.data() || {};
            return {
                id: snap.id,
                from: data.from || '',
                to: data.to || '',
                subject: data.subject || '',
                mailbox: String(data.mailbox || '').toLowerCase(),
                receivedAt: data.receivedAt || '',
                date: data.date || ''
            };
        } catch (err) {
            console.warn('[inbox-autoreply] fetchRowById failed:', err);
            return null;
        }
    }

    async function onReplyWithTemplate() {
        const id = getCurrentPreviewRowId();
        if (!id) {
            if (window.Toast && typeof window.Toast.error === 'function') {
                window.Toast.error('No email selected');
            }
            return;
        }
        const row = await fetchRowById(id);
        if (!row) {
            if (window.Toast && typeof window.Toast.error === 'function') {
                window.Toast.error('Could not load email');
            }
            return;
        }
        const reply = buildReply(row);
        if (typeof window.openComposeModal === 'function') {
            window.openComposeModal({
                to:      reply.to,
                subject: reply.subject,
                body:    reply.body,
                from:    reply.from,
                replyTo: reply.replyTo
            });
        } else if (window.Toast && typeof window.Toast.error === 'function') {
            window.Toast.error('Compose modal not available');
        }
    }

    /* ── Public API + boot ───────────────────────────────── */
    window.AdminInboxAutoReply = {
        openSettings: openSettingsModal,
        getConfig:    function () { return Object.assign({}, state.config); },
        // For debugging — clear local idempotency state so the next
        // incoming mail will be auto-replied to again.
        resetThrottle: function () {
            try { localStorage.removeItem(LS_REPLIED_IDS); } catch (_) {}
            try { localStorage.removeItem(LS_REPLIED_SENDER); } catch (_) {}
            try {
                Object.keys(sessionStorage).forEach(function (k) {
                    if (k.indexOf(SS_LOCK) === 0) sessionStorage.removeItem(k);
                });
            } catch (_) {}
        }
    };

    function init() {
        ensureStyles();
        ensureTopButton();
        bindPreviewObserver();
        // The first preview pane already exists with the empty state — try
        // injecting once, then the observer takes over.
        setTimeout(injectReplyTemplateBtn, 200);
        // Wait for Firebase + a logged-in user before subscribing
        if (!window.__firebaseReady) return;
        window.__firebaseReady.then(function (fb) {
            // Wait for auth to settle (may already be settled)
            if (fb.auth.currentUser) {
                loadConfig();
                subscribeReceived();
            } else {
                const unsub = fb.auth.onAuthStateChanged(function (u) {
                    if (u) {
                        try { unsub(); } catch (_) {}
                        loadConfig();
                        subscribeReceived();
                    }
                });
            }
        }).catch(function () {});
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
