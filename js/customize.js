/* customize.js - powers /customize page (login-gated builder + email enquiry)
   Send order:
     1. Cloudflare Worker (default — POST to window.CZ_WORKER_URL)
     2. EmailJS              (alternative — uses window.EMAILJS_CONFIG)
     3. Firestore "mail/{ref}" (alternative — Trigger Email extension)
     4. mailto:              (last-resort fallback)
   Configure the Worker by setting window.CZ_WORKER_URL in customize.html:
     <script>
       window.CZ_WORKER_URL = "https://customize-email.YOURNAME.workers.dev";
       // Optional: matches SHARED_TOKEN secret you set on the Worker
       window.CZ_WORKER_TOKEN = "";
     </script>
   The page also writes an audit copy to customEnquiries/{ref} in Firestore
   (best-effort, ignored if rules/permissions block it).
*/
(function () {
    'use strict';

    var TARGET_EMAIL = 'booking@andamanvoyages.in';
    var $   = function (s, r) { return (r || document).querySelector(s); };
    var $all= function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

    function readUser() {
        try {
            var raw = localStorage.getItem('currentUser');
            var tok = localStorage.getItem('token');
            if (!raw || !tok) return null;
            var u = JSON.parse(raw);
            return (u && (u.uid || u.id)) ? u : null;
        } catch (e) { return null; }
    }
    function escHtml(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
        });
    }

    /* Login gate */
    function refreshGate() {
        var user = readUser(), gate = $('#czGate'), builder = $('#czBuilder'), success = $('#czSuccess');
        if (!gate || !builder) return;
        if (success && success.style.display && success.style.display !== 'none') return;
        if (user) {
            gate.style.display = 'none';
            builder.style.display = '';
            prefillContact(user);
            updateSummary();
        } else {
            gate.style.display = '';
            builder.style.display = 'none';
        }
    }
    function prefillContact(u) {
        if (!u) return;
        var n = $('#czName');  if (n && !n.value) n.value = u.fullName || u.username || '';
        var e = $('#czEmail'); if (e && !e.value) e.value = u.email || '';
        var p = $('#czPhone'); if (p && !p.value && u.phone) p.value = u.phone;
    }

    /* Chip toggling */
    function wireChips() {
        $all('.cz-chips').forEach(function (group) {
            var single = group.dataset.czSingle === '1';
            group.addEventListener('click', function (e) {
                var chip = e.target.closest('.cz-chip');
                if (!chip) return;
                if (single) {
                    $all('.cz-chip', group).forEach(function (c) { if (c !== chip) c.classList.remove('checked'); });
                    chip.classList.add('checked');
                } else {
                    chip.classList.toggle('checked');
                }
                updateSummary();
            });
        });
    }
    function getChips(g) {
        var grp = document.querySelector('[data-cz-group="' + g + '"]');
        if (!grp) return [];
        return $all('.cz-chip.checked', grp).map(function (c) { return c.dataset.value; });
    }

    /* Activity rows */
    function wireActs() {
        $all('.cz-act input[type="checkbox"]').forEach(function (cb) {
            cb.addEventListener('change', function () {
                cb.closest('.cz-act').classList.toggle('checked', cb.checked);
                updateSummary();
            });
        });
    }
    function getActs() {
        return $all('.cz-act input[type="checkbox"]:checked').map(function (cb) { return cb.dataset.name; });
    }

    /* Live summary */
    function pillify(arr) {
        if (!arr || !arr.length) return null;
        return arr.map(function (v) { return '<span class="cz-pill">' + escHtml(v) + '</span>'; }).join('');
    }
    function updateSummary() {
        var adults    = parseInt(($('#czAdults') || {}).value || '2', 10);
        var children  = parseInt(($('#czChildren') || {}).value || '0', 10);
        var start     = ($('#czStart') || {}).value || '';
        var end       = ($('#czEnd') || {}).value || '';
        var islands   = getChips('islands');
        var hotels    = getChips('hotel');
        var vibes     = getChips('vibe');
        var inclusions= getChips('inclusions');
        var acts      = getActs();
        var budget    = ($('#czBudget') || {}).value || '';

        var trav = adults + ' Adult' + (adults !== 1 ? 's' : '');
        if (children > 0) trav += ' + ' + children + ' Child' + (children !== 1 ? 'ren' : '');
        var sumT = $('#sumTravellers'); if (sumT) sumT.textContent = trav;

        var sumDates = $('#sumDates');
        if (sumDates) {
            if (start && end)   { sumDates.textContent = start + ' \u2192 ' + end; sumDates.classList.remove('cz-summary-empty'); }
            else if (start)     { sumDates.textContent = 'From ' + start; sumDates.classList.remove('cz-summary-empty'); }
            else                { sumDates.textContent = '\u2014 pick dates \u2014'; sumDates.classList.add('cz-summary-empty'); }
        }

        function setRow(id, v, empty) {
            var el = document.getElementById(id); if (!el) return;
            if (Array.isArray(v) && v.length)            { el.innerHTML = pillify(v); el.classList.remove('cz-summary-empty'); }
            else if (typeof v === 'string' && v)         { el.textContent = v; el.classList.remove('cz-summary-empty'); }
            else                                          { el.textContent = empty; el.classList.add('cz-summary-empty'); }
        }
        setRow('sumIslands', islands,    '\u2014 none yet \u2014');
        setRow('sumHotel',   hotels,     '\u2014 not chosen \u2014');
        setRow('sumVibe',    vibes,      '\u2014 any \u2014');
        setRow('sumActs',    acts,       '\u2014 none \u2014');
        setRow('sumIncl',    inclusions, '\u2014 defaults \u2014');
        setRow('sumBudget',  budget,     '\u2014 flexible \u2014');
    }
    function wireLiveUpdates() {
        ['czAdults','czChildren','czStart','czEnd','czBudget','czCity','czNotes','czName','czEmail','czPhone','czPreferred'].forEach(function (id) {
            var el = document.getElementById(id); if (!el) return;
            el.addEventListener('change', updateSummary);
            el.addEventListener('input',  updateSummary);
        });
    }

    /* Build payload + email body */
    function buildEnquiry() {
        var u = readUser() || {};
        var ref = 'CUST-' + Date.now().toString().slice(-7) + '-' + Math.random().toString(36).slice(2, 5).toUpperCase();
        return {
            ref: ref, createdAt: new Date().toISOString(),
            user: { uid: u.uid || u.id || '', email: u.email || '', username: u.username || '' },
            traveller: {
                name:  ($('#czName')  || {}).value || '',
                email: ($('#czEmail') || {}).value || '',
                phone: ($('#czPhone') || {}).value || '',
                preferred: ($('#czPreferred') || {}).value || ''
            },
            trip: {
                start:    ($('#czStart')    || {}).value || '',
                end:      ($('#czEnd')      || {}).value || '',
                adults:   parseInt(($('#czAdults')   || {}).value || '0', 10),
                children: parseInt(($('#czChildren') || {}).value || '0', 10),
                islands: getChips('islands'), hotel: getChips('hotel'),
                vibe: getChips('vibe'), inclusions: getChips('inclusions'),
                activities: getActs(),
                budget: ($('#czBudget') || {}).value || '',
                city:   ($('#czCity')   || {}).value || '',
                notes:  ($('#czNotes')  || {}).value || ''
            }
        };
    }
    function buildEmailBody(d) {
        var L = [];
        L.push('NEW CUSTOM-TRIP ENQUIRY  (' + d.ref + ')');
        L.push('Submitted: ' + d.createdAt);
        L.push('');
        L.push('-- TRAVELLER --');
        L.push('Name:        ' + d.traveller.name);
        L.push('Email:       ' + d.traveller.email);
        L.push('Phone:       ' + d.traveller.phone);
        L.push('Preferred:   ' + d.traveller.preferred);
        L.push('Account:     ' + (d.user.username || '(none)') + ' / ' + (d.user.email || '') + ' (uid ' + (d.user.uid || '?') + ')');
        L.push('');
        L.push('-- TRIP --');
        L.push('Dates:       ' + (d.trip.start || '?') + ' to ' + (d.trip.end || '?'));
        L.push('Travellers:  ' + d.trip.adults + ' adult(s) + ' + d.trip.children + ' child(ren)');
        L.push('Departure:   ' + (d.trip.city || '(not specified)'));
        L.push('Budget:      ' + (d.trip.budget || '(flexible)'));
        L.push('');
        L.push('Islands:     ' + (d.trip.islands.join(', ')    || '(any)'));
        L.push('Hotel:       ' + (d.trip.hotel.join(', ')      || '(not chosen)'));
        L.push('Vibe:        ' + (d.trip.vibe.join(', ')       || '(any)'));
        L.push('Inclusions:  ' + (d.trip.inclusions.join(', ') || '(defaults)'));
        L.push('Activities:  ' + (d.trip.activities.join(', ') || '(none)'));
        L.push('');
        if (d.trip.notes) { L.push('-- NOTES --'); L.push(d.trip.notes); L.push(''); }
        L.push('-- REPLY --');
        L.push('Please send a personalised quote within 2 working hours to:');
        L.push('  Email:    ' + d.traveller.email);
        L.push('  WhatsApp: ' + d.traveller.phone);
        L.push('');
        L.push('Reference: ' + d.ref);
        return L.join('\n');
    }
    function validateForm(d) {
        var errs = [];
        if (!d.traveller.name)  errs.push('Please enter your full name.');
        if (!d.traveller.email) errs.push('Please enter your email.');
        if (!d.traveller.phone) errs.push('Please enter your phone / WhatsApp number.');
        if (!d.trip.start)      errs.push('Please pick a start date.');
        if (!d.trip.islands.length) errs.push('Please pick at least one island.');
        return errs;
    }
    /* Build a friendlier HTML version of the email body for richer
       rendering in the recipient's inbox. The plain-text fallback is
       kept as well so any client can read it. */
    function buildEmailHtml(d) {
        function row(k, v) {
            return '<tr><td style="padding:4px 12px;color:#777;white-space:nowrap;">' + escHtml(k) +
                   '</td><td style="padding:4px 12px;color:#0d2b3a;font-weight:600;">' + escHtml(v || '—') + '</td></tr>';
        }
        function list(k, arr, fallback) {
            return row(k, (arr && arr.length) ? arr.join(', ') : (fallback || '—'));
        }
        var notes = d.trip.notes
            ? '<h3 style="margin:1.5rem 0 .5rem;color:#0d2b3a;">Notes from customer</h3>' +
              '<p style="background:#f8fafb;padding:.8rem 1rem;border-left:3px solid #0d7a8a;color:#3d4f5a;">' +
              escHtml(d.trip.notes).replace(/\n/g, '<br>') + '</p>'
            : '';
        return '' +
        '<div style="font-family:Arial,Helvetica,sans-serif;background:#f0f4f7;padding:24px;">' +
            '<div style="max-width:640px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 6px 20px rgba(8,30,42,.08);">' +
                '<div style="background:linear-gradient(135deg,#0d7a8a,#16a085);color:#fff;padding:22px 28px;">' +
                    '<div style="font-size:13px;letter-spacing:.14em;text-transform:uppercase;opacity:.85;">New custom-trip enquiry</div>' +
                    '<h1 style="margin:.3rem 0 0;font-size:24px;">' + escHtml(d.traveller.name || 'New traveller') + '</h1>' +
                    '<div style="opacity:.9;font-size:13px;margin-top:6px;">Reference: <strong>' + escHtml(d.ref) + '</strong> · ' + escHtml(d.createdAt) + '</div>' +
                '</div>' +
                '<div style="padding:24px 28px;">' +
                    '<h3 style="margin:0 0 .5rem;color:#0d2b3a;font-size:16px;">Traveller</h3>' +
                    '<table style="width:100%;border-collapse:collapse;font-size:14px;">' +
                        row('Name',      d.traveller.name) +
                        row('Email',     d.traveller.email) +
                        row('Phone',     d.traveller.phone) +
                        row('Preferred', d.traveller.preferred) +
                        row('Account',   (d.user.username || '(none)') + ' · ' + (d.user.email || '') + ' · uid ' + (d.user.uid || '?')) +
                    '</table>' +
                    '<h3 style="margin:1.4rem 0 .5rem;color:#0d2b3a;font-size:16px;">Trip</h3>' +
                    '<table style="width:100%;border-collapse:collapse;font-size:14px;">' +
                        row('Dates',      (d.trip.start || '?') + ' to ' + (d.trip.end || '?')) +
                        row('Travellers', d.trip.adults + ' adult(s) + ' + d.trip.children + ' child(ren)') +
                        row('Departure',  d.trip.city || '(not specified)') +
                        row('Budget',     d.trip.budget || '(flexible)') +
                        list('Islands',    d.trip.islands,    '(any)') +
                        list('Hotel',      d.trip.hotel,      '(not chosen)') +
                        list('Vibe',       d.trip.vibe,       '(any)') +
                        list('Inclusions', d.trip.inclusions, '(defaults)') +
                        list('Activities', d.trip.activities, '(none)') +
                    '</table>' +
                    notes +
                    '<div style="margin-top:1.6rem;padding:14px 16px;background:#fff8e1;border-radius:10px;color:#7a5400;font-size:13px;">' +
                        '<strong>Reply target:</strong> ' + escHtml(d.traveller.email) +
                        ' · WhatsApp ' + escHtml(d.traveller.phone) +
                        ' · within 2 working hours please.' +
                    '</div>' +
                '</div>' +
                '<div style="padding:14px 28px;background:#0d2b3a;color:#cdd9e0;font-size:12px;text-align:center;">' +
                    'Sent automatically from andamanvoyages.in /customize' +
                '</div>' +
            '</div>' +
        '</div>';
    }

    /* Persist the audit copy of the enquiry. Best-effort; never blocks. */
    function persistEnquiry(d) {
        try {
            if (window.firebase && firebase.firestore) {
                firebase.firestore().collection('customEnquiries').doc(d.ref).set(d).catch(function () {});
            }
        } catch (e) {}
        try {
            var key = 'customEnquiries';
            var arr = JSON.parse(localStorage.getItem(key) || '[]');
            arr.push(d); localStorage.setItem(key, JSON.stringify(arr.slice(-20)));
        } catch (e) {}
    }

    /* ─── Cloudflare Worker sender (preferred path) ────────────
       POSTs the enquiry JSON to window.CZ_WORKER_URL — which is a
       Cloudflare Email Worker that dispatches the email via the
       SEND_EMAIL binding. See workers/customize-email/. */
    function sendViaWorker(d) {
        return new Promise(function (resolve) {
            var url = window.CZ_WORKER_URL;
            if (!url) return resolve(false);
            try {
                var headers = { 'Content-Type': 'application/json' };
                if (window.CZ_WORKER_TOKEN) headers['x-cz-token'] = window.CZ_WORKER_TOKEN;
                fetch(url, {
                    method: 'POST',
                    mode: 'cors',
                    headers: headers,
                    body: JSON.stringify(d)
                }).then(function (r) {
                    if (r.ok) return resolve(true);
                    r.text().then(function (t) {
                        console.warn('[customize] Worker error:', r.status, t);
                        resolve(false);
                    });
                }).catch(function (err) {
                    console.warn('[customize] Worker network:', err && err.message);
                    resolve(false);
                });
            } catch (e) {
                console.warn('[customize] Worker threw:', e && e.message);
                resolve(false);
            }
        });
    }

    /* ─── EmailJS sender (preferred path) ──────────────────────
       Uses the public EmailJS REST API — no SDK download needed.
       Configure by setting window.EMAILJS_CONFIG with publicKey,
       serviceId and templateId. The template should reference the
       same parameter names we send below (to_email, reply_to, subject,
       message_html, message_text + the 14 enquiry fields). */
    function emailjsConfig() {
        var c = window.EMAILJS_CONFIG;
        if (!c || !c.publicKey || !c.serviceId || !c.templateId) return null;
        return c;
    }
    function sendViaEmailJS(d) {
        return new Promise(function (resolve) {
            var c = emailjsConfig();
            if (!c) return resolve(false);
            var payload = {
                service_id:  c.serviceId,
                template_id: c.templateId,
                user_id:     c.publicKey,
                template_params: {
                    to_email:     TARGET_EMAIL,
                    reply_to:     d.traveller.email || '',
                    cc:           d.traveller.email || '',
                    subject:      'Custom Andaman Trip Enquiry - ' + (d.traveller.name || 'Guest') + ' (' + d.ref + ')',
                    message_html: buildEmailHtml(d),
                    message_text: buildEmailBody(d),
                    // Individual fields — handy if the user prefers to
                    // template the email themselves in the EmailJS UI.
                    ref:          d.ref,
                    name:         d.traveller.name,
                    email:        d.traveller.email,
                    phone:        d.traveller.phone,
                    preferred:    d.traveller.preferred,
                    start:        d.trip.start,
                    end:          d.trip.end,
                    adults:       d.trip.adults,
                    children:     d.trip.children,
                    city:         d.trip.city,
                    budget:       d.trip.budget,
                    islands:      d.trip.islands.join(', '),
                    hotel:        d.trip.hotel.join(', '),
                    vibe:         d.trip.vibe.join(', '),
                    inclusions:   d.trip.inclusions.join(', '),
                    activities:   d.trip.activities.join(', '),
                    notes:        d.trip.notes,
                    user_uid:     d.user.uid || '',
                    user_email:   d.user.email || '',
                    user_username:d.user.username || ''
                }
            };
            try {
                fetch('https://api.emailjs.com/api/v1.0/email/send', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                }).then(function (r) {
                    if (r.ok) return resolve(true);
                    r.text().then(function (t) {
                        console.warn('[customize] EmailJS error:', r.status, t);
                        resolve(false);
                    });
                }).catch(function (err) {
                    console.warn('[customize] EmailJS network:', err && err.message);
                    resolve(false);
                });
            } catch (e) {
                console.warn('[customize] EmailJS threw:', e && e.message);
                resolve(false);
            }
        });
    }

    /* Send the email by writing to the Firestore "mail" collection that
       the Firebase Trigger Email extension watches. Returns a Promise
       that resolves true on success, false on failure. */
    function sendViaFirestoreMail(d) {
        return new Promise(function (resolve) {
            try {
                if (!window.firebase || !firebase.firestore) return resolve(false);
                var db = firebase.firestore();
                var doc = {
                    to:  [TARGET_EMAIL],
                    cc:  d.traveller.email ? [d.traveller.email] : [],
                    replyTo: d.traveller.email || undefined,
                    message: {
                        subject: 'Custom Andaman Trip Enquiry - ' + (d.traveller.name || 'Guest') + ' (' + d.ref + ')',
                        text:    buildEmailBody(d),
                        html:    buildEmailHtml(d)
                    },
                    // Free-form metadata for our admin dashboard.
                    meta: {
                        ref: d.ref,
                        type: 'customEnquiry',
                        userUid: d.user.uid || '',
                        createdAt: d.createdAt
                    }
                };
                db.collection('mail').doc(d.ref).set(doc).then(function () {
                    resolve(true);
                }).catch(function (err) {
                    console.warn('[customize] mail write failed:', err && err.message);
                    resolve(false);
                });
            } catch (e) {
                console.warn('[customize] mail send threw:', e && e.message);
                resolve(false);
            }
        });
    }

    /* Last-resort fallback: open the user's mail client with a pre-filled
       message. Only used if Firestore write fails. */
    function fallbackMailto(d) {
        var subject = 'Custom Andaman Trip Enquiry - ' + (d.traveller.name || 'Guest') + ' (' + d.ref + ')';
        var body    = buildEmailBody(d);
        var url = 'mailto:' + TARGET_EMAIL +
                  '?subject=' + encodeURIComponent(subject) +
                  '&body='    + encodeURIComponent(body);
        try {
            var a = document.createElement('a');
            a.href = url; a.style.display = 'none';
            document.body.appendChild(a); a.click();
            setTimeout(function () { document.body.removeChild(a); }, 500);
        } catch (e) {
            window.location.href = url;
        }
    }

    function toast(msg, type) {
        if (window.Toast && typeof Toast.show === 'function') Toast.show(msg, type || 'success');
        else if (typeof window.alert === 'function') alert(msg);
    }

    function showSuccess(d) {
        var success = document.getElementById('czSuccess');
        var builder = document.getElementById('czBuilder');
        var nameEl  = document.getElementById('czSuccessName');
        var refEl   = document.getElementById('czSuccessRef');
        if (nameEl) nameEl.textContent = (d.traveller.name || '').split(' ')[0] || 'there';
        if (refEl)  refEl.textContent  = d.ref;
        if (builder) builder.style.display = 'none';
        if (success) {
            success.style.display = '';
            try { success.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) {}
        }
    }

    function setSubmitting(submitting) {
        var btn = document.getElementById('czSubmitBtn');
        if (!btn) return;
        if (submitting) {
            btn.disabled = true;
            btn.dataset.origHtml = btn.innerHTML;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';
        } else {
            btn.disabled = false;
            if (btn.dataset.origHtml) btn.innerHTML = btn.dataset.origHtml;
        }
    }

    function sendEnquiry() {
        if (!readUser()) {
            toast('Please log in to send an enquiry.', 'warning');
            refreshGate();
            return;
        }
        var d = buildEnquiry();
        var errs = validateForm(d);
        if (errs.length) { toast(errs[0], 'warning'); return; }

        persistEnquiry(d);
        setSubmitting(true);

        // Try senders in order:
        //   Cloudflare Worker → EmailJS → Firestore mail → mailto fallback.
        // The first one that's configured AND succeeds wins. No mail-client
        // window opens unless every server-side option fails.
        sendViaWorker(d).then(function (ok) {
            if (ok) return finish('worker', d);
            return sendViaEmailJS(d).then(function (ok2) {
                if (ok2) return finish('emailjs', d);
                return sendViaFirestoreMail(d).then(function (ok3) {
                    if (ok3) return finish('firestore', d);
                    return finish('mailto', d);
                });
            });
        });
    }

    function finish(via, d) {
        setSubmitting(false);
        if (via === 'mailto') {
            toast('Network issue — opening your email client as a backup.', 'warning');
            fallbackMailto(d);
        } else {
            toast('Enquiry sent! We will reply within 2 hours.', 'success');
        }
        showSuccess(d);
    }

    /* Login button on the gate */
    function wireGateLogin() {
        var btn = document.getElementById('czGateLoginBtn');
        if (!btn) return;
        btn.addEventListener('click', function () {
            if (typeof window.openLogin === 'function') {
                window.openLogin();
            } else {
                window.location.href = '/#login';
            }
        });
    }

    /* Submit button */
    function wireSubmit() {
        var btn = document.getElementById('czSubmitBtn');
        if (btn) btn.addEventListener('click', sendEnquiry);
    }

    /* Re-check auth state when other tabs/auth events fire */
    function wireAuthEvents() {
        window.addEventListener('storage', function (e) {
            if (e.key === 'currentUser' || e.key === 'token') refreshGate();
        });
        window.addEventListener('auth:login',  refreshGate);
        window.addEventListener('auth:logout', refreshGate);
    }

    /* ── Init ───────────────────────────────────────────────── */
    function init() {
        // Today's date as a sensible minimum
        var today = new Date().toISOString().slice(0, 10);
        var s = document.getElementById('czStart'); if (s && !s.min) s.min = today;
        var e = document.getElementById('czEnd');   if (e && !e.min) e.min = today;

        wireChips();
        wireActs();
        wireLiveUpdates();
        wireGateLogin();
        wireSubmit();
        wireAuthEvents();
        refreshGate();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
