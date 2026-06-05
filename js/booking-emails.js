/* ── booking-emails.js ────────────────────────────────────────────
   Sends booking confirmation + cancellation emails.

   Two public functions on window.BookingEmails:
     • sendBookingConfirmation(booking)
         → On successful payment in checkout. Sends the full booking
           detail + advance-paid amount to BOTH:
             To  → booking@andamanvoyages.in (the team mailbox)
             Cc  → customer email (so they have a paid-receipt)
     • sendBookingCancellation(booking)
         → When admin clicks Cancel in dashboard. Sends the original
           booking detail + refund-policy reminder to BOTH:
             To  → cancellation@andamanvoyages.in (the team mailbox)
             Cc  → customer email
           Admins are authenticated; we POST to the inbox-mail
           Cloudflare Worker (Brevo-backed) so the email lands in real
           inboxes immediately.

   Delivery channels — tried in order, first one that succeeds wins:
     1. POST to window.INBOX_WORKER_URL + '/send'
        (only if a Firebase ID token is available — i.e. caller is
        a logged-in admin; works for cancellation always, and for
        confirmation when the customer is logged-in admin/staff).
     2. Firestore `mail/{docId}` doc — picked up by the Firebase
        "Trigger Email" extension if installed. Works for any
        authenticated user, including a customer paying for their
        own booking.
   Both functions are best-effort — they catch all errors and log
   to console.warn so checkout / cancel flows don't break if the
   email backend is down or not yet configured.
   ──────────────────────────────────────────────────────────────── */
(function () {
    'use strict';

    var BOOKING_INBOX      = 'booking@andamanvoyages.in';
    var CANCELLATION_INBOX = 'cancellation@andamanvoyages.in';
    var SITE_URL           = 'https://andamanvoyages.in';

    // ── Helpers ─────────────────────────────────────────────────
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
        });
    }
    function fmtINR(n) {
        var v = Number(n) || 0;
        return '₹' + v.toLocaleString('en-IN');
    }
    function fmtDate(s) {
        if (!s) return '—';
        try {
            var d = (s && s.toDate) ? s.toDate() : new Date(s);
            if (isNaN(d.getTime())) return String(s);
            return d.toLocaleDateString('en-IN', {
                day: '2-digit', month: 'short', year: 'numeric'
            });
        } catch (_) { return String(s); }
    }

    function pickName(b) {
        return (b && b.traveler && b.traveler.name) ||
               b.customerName || b.fullName || 'Guest';
    }
    function pickEmail(b) {
        return (b && b.traveler && b.traveler.email) ||
               b.customerEmail || b.email || '';
    }
    function pickPhone(b) {
        return (b && b.traveler && b.traveler.phone) ||
               b.customerPhone || b.phone || '';
    }

    // ── Build booking details block (HTML + text) ─────────────
    function detailsHtml(b) {
        var name  = pickName(b);
        var email = pickEmail(b);
        var phone = pickPhone(b);
        var pkg   = b.package_label || b.package_name || 'Andaman Package';
        var rows  = [
            ['Booking Ref',  b.booking_ref || b.id || '—'],
            ['Package',      pkg],
            ['Duration',     b.duration || '—'],
            ['Travel Date',  fmtDate(b.travel_date)],
            ['Adults',       (b.adults != null ? b.adults : (b.guests || '—'))],
            ['Children',     (b.children != null ? b.children : '—')],
            ['Customer',     name],
            ['Email',        email],
            ['Phone',        phone],
            ['Total Trip Cost',  fmtINR(b.total_trip_cost != null ? b.total_trip_cost : b.price)],
            ['Advance Paid',     fmtINR(b.advance_paid)],
            ['Balance Due',      fmtINR(b.balance_due)],
            ['Payment ID',       b.payment_id || '—'],
            ['Payment Method',   b.payment_method || 'razorpay'],
            ['Coupon',           b.coupon || '—']
        ];
        return '<table style="width:100%;border-collapse:collapse;font-size:14px;">' +
            rows.map(function (r) {
                return '<tr>' +
                    '<td style="padding:6px 10px;border-bottom:1px solid #eef3f5;color:#5a6877;width:38%;">' + esc(r[0]) + '</td>' +
                    '<td style="padding:6px 10px;border-bottom:1px solid #eef3f5;color:#0d2c3a;font-weight:600;">' + esc(r[1]) + '</td>' +
                    '</tr>';
            }).join('') +
        '</table>';
    }
    function detailsText(b) {
        return [
            'Booking Ref:    ' + (b.booking_ref || b.id || '—'),
            'Package:        ' + (b.package_label || b.package_name || '—'),
            'Duration:       ' + (b.duration || '—'),
            'Travel Date:    ' + fmtDate(b.travel_date),
            'Adults:         ' + (b.adults != null ? b.adults : (b.guests || '—')),
            'Children:       ' + (b.children != null ? b.children : '—'),
            'Customer:       ' + pickName(b),
            'Email:          ' + pickEmail(b),
            'Phone:          ' + pickPhone(b),
            'Total Trip Cost: ' + fmtINR(b.total_trip_cost != null ? b.total_trip_cost : b.price),
            'Advance Paid:   ' + fmtINR(b.advance_paid),
            'Balance Due:    ' + fmtINR(b.balance_due),
            'Payment ID:     ' + (b.payment_id || '—'),
            'Payment Method: ' + (b.payment_method || 'razorpay'),
            'Coupon:         ' + (b.coupon || '—')
        ].join('\n');
    }

    // ── Send via inbox-mail Cloudflare Worker (admin-authenticated) ──
    // Returns true on success, false on any failure (including
    // "no admin token available"). The Worker requires the caller to
    // be a logged-in admin with a Firebase ID token in the
    // Authorization: Bearer header — anonymous customers can't use it.
    // For each `to` address in the list, we POST one /send request so
    // both the team mailbox AND the customer (cc) receive their own
    // top-level copy (Brevo's `cc` is fine but separate sends are
    // more reliable + show as separate threads in each inbox).
    async function sendViaWorker(opts) {
        var workerUrl = (window.INBOX_WORKER_URL || '').trim();
        if (!workerUrl) return false;

        // Need a Firebase ID token (admin only)
        var idToken = '';
        try {
            if (window.__firebaseReady) {
                var fb = await window.__firebaseReady;
                if (fb && fb.auth && fb.auth.currentUser) {
                    idToken = await fb.auth.currentUser.getIdToken();
                }
            } else if (window.firebase && window.firebase.auth) {
                var u = window.firebase.auth().currentUser;
                if (u) idToken = await u.getIdToken();
            }
        } catch (e) { /* no token */ }
        if (!idToken) return false;

        var endpoint = workerUrl.replace(/\/+$/, '') + '/send';
        var payload = {
            from:    opts.from,
            to:      opts.to,
            subject: opts.subject,
            html:    opts.html,
            text:    opts.text,
            replyTo: opts.replyTo || ''
        };

        try {
            var res = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type':  'application/json',
                    'Authorization': 'Bearer ' + idToken
                },
                body: JSON.stringify(payload)
            });
            if (!res.ok) {
                var errText = '';
                try { errText = await res.text(); } catch (_) {}
                console.warn('[booking-emails] Worker send rejected', res.status, errText);
                return false;
            }
            return true;
        } catch (err) {
            console.warn('[booking-emails] Worker send failed:', err);
            return false;
        }
    }

    // Send the same email body to multiple recipients via the Worker.
    // Returns count of successful sends. Does NOT throw.
    async function sendToManyViaWorker(recipients, common) {
        var ok = 0;
        for (var i = 0; i < recipients.length; i++) {
            var to = String(recipients[i] || '').trim();
            if (!to) continue;
            var sent = await sendViaWorker({
                from:    common.from,
                to:      to,
                subject: common.subject,
                html:    common.html,
                text:    common.text,
                replyTo: common.replyTo
            });
            if (sent) ok++;
        }
        return ok;
    }

    // ── Get Firestore handle (modular SDK preferred, fallback to compat) ──
    async function getFirestoreHandle() {
        // Modular v9+: dataStore.js exposes window.__firebaseReady
        if (window.__firebaseReady) {
            try {
                var fb = await window.__firebaseReady;
                return {
                    write: function (docId, data) {
                        var ref = fb.firestore.doc(fb.db, 'mail', docId);
                        return fb.firestore.setDoc(ref, data);
                    }
                };
            } catch (e) { /* fall through */ }
        }
        // Legacy compat SDK (firebase.firestore())
        if (window.firebase && window.firebase.firestore) {
            try {
                var db = window.firebase.firestore();
                return {
                    write: function (docId, data) {
                        return db.collection('mail').doc(docId).set(data);
                    }
                };
            } catch (e) { /* nothing */ }
        }
        return null;
    }

    // ── Send: confirmation ──────────────────────────────────────
    async function sendBookingConfirmation(booking) {
        try {
            var ref       = booking.booking_ref || booking.id || ('AV-' + Date.now());
            var name      = pickName(booking);
            var custEmail = pickEmail(booking);
            var advance   = booking.advance_paid || 0;
            var subject   = '✅ Andaman Booking Confirmed — ' + ref + ' — ' + fmtINR(advance) + ' advance received';

            var html =
                '<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:640px;margin:auto;color:#2c3e50;">' +
                    '<div style="background:linear-gradient(135deg,#0d7a8a,#16a085);color:#fff;padding:1.25rem 1.5rem;border-radius:10px 10px 0 0;">' +
                        '<h2 style="margin:0;font-size:1.25rem;">🎉 Booking Confirmed — ' + esc(ref) + '</h2>' +
                        '<p style="margin:.4rem 0 0;opacity:.92;font-size:.92rem;">Advance of <strong>' + fmtINR(advance) + '</strong> received via Razorpay.</p>' +
                    '</div>' +
                    '<div style="background:#fff;border:1px solid #e3e8ef;border-top:none;padding:1.25rem 1.5rem;border-radius:0 0 10px 10px;">' +
                        '<p style="margin:0 0 1rem;font-size:.95rem;line-height:1.55;">Hi <strong>' + esc(name) + '</strong>,</p>' +
                        '<p style="margin:0 0 1rem;font-size:.95rem;line-height:1.55;">Thank you for booking your Andaman trip with us. Your seat is reserved. The booking details and advance receipt are below. Please reply to this email if anything looks off.</p>' +
                        detailsHtml(booking) +
                        '<p style="margin:1.25rem 0 .25rem;font-size:.9rem;color:#5a6877;">The remaining balance of <strong>' + fmtINR(booking.balance_due || 0) + '</strong> is collected during or after your trip — UPI / bank transfer / cash. We will not charge this amount until the trip is in progress.</p>' +
                        '<p style="margin:.85rem 0 0;font-size:.88rem;color:#7f8c8d;">Need help? <a href="tel:+918880195191" style="color:#0d7a8a;">+91 88801 95191</a> &middot; <a href="' + SITE_URL + '/bookings" style="color:#0d7a8a;">My Bookings</a></p>' +
                    '</div>' +
                '</div>';

            var text =
                'Andaman Booking Confirmed — ' + ref + '\n' +
                '\nHi ' + name + ',\n' +
                '\nYour Andaman booking has been confirmed. Advance of ' + fmtINR(advance) + ' received.\n' +
                '\n----- Booking Details -----\n' +
                detailsText(booking) + '\n' +
                '\nBalance of ' + fmtINR(booking.balance_due || 0) + ' will be collected during or after your trip.\n' +
                '\nNeed help? +91 88801 95191 / booking@andamanvoyages.in\n';

            // Recipients — team mailbox first, customer cc'd. We
            // dedupe so a customer who books with booking@... as
            // their own email doesn't get the mail twice.
            var recipients = [BOOKING_INBOX];
            if (custEmail && custEmail.toLowerCase() !== BOOKING_INBOX) {
                recipients.push(custEmail);
            }

            // Channel 1 — Cloudflare Worker (Brevo). Only works when
            // an admin/staff is logged in; the customer-side checkout
            // flow normally falls through to Channel 2.
            var workerOk = await sendToManyViaWorker(recipients, {
                from:    BOOKING_INBOX,
                subject: subject,
                html:    html,
                text:    text,
                replyTo: custEmail || BOOKING_INBOX
            });
            if (workerOk > 0) {
                console.log('[booking-emails] Confirmation sent via Worker to', workerOk, 'recipient(s) for', ref);
                return true;
            }

            // Channel 2 — Firestore mail/{ref} doc (Trigger Email
            // extension picks it up if installed). Works for any
            // authenticated user.
            var fs = await getFirestoreHandle();
            if (!fs) {
                console.warn('[booking-emails] No email channel available, skipping confirmation email for', ref);
                return false;
            }
            var doc = {
                to:  [BOOKING_INBOX],
                cc:  custEmail ? [custEmail] : [],
                replyTo: custEmail || BOOKING_INBOX,
                message: { subject: subject, html: html, text: text },
                meta: {
                    type: 'bookingConfirmation',
                    ref: ref,
                    bookingId: booking.id || ref,
                    createdAt: new Date().toISOString()
                }
            };
            await fs.write(String(ref), doc);
            console.log('[booking-emails] Confirmation queued (Firestore mail) for', ref);
            return true;
        } catch (err) {
            console.warn('[booking-emails] Confirmation send failed:', err);
            return false;
        }
    }

    // ── Send: cancellation ──────────────────────────────────────
    async function sendBookingCancellation(booking, opts) {
        try {
            var ref       = booking.booking_ref || booking.id || ('AV-' + Date.now());
            var name      = pickName(booking);
            var custEmail = pickEmail(booking);
            var advance   = booking.advance_paid || 0;
            var reason    = (opts && opts.reason) || 'Cancelled by admin';
            var cancelledBy = (opts && opts.cancelledBy) || 'admin';
            var subject   = '⚠️ Andaman Booking Cancelled — ' + ref;

            var html =
                '<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:640px;margin:auto;color:#2c3e50;">' +
                    '<div style="background:linear-gradient(135deg,#c0392b,#e74c3c);color:#fff;padding:1.25rem 1.5rem;border-radius:10px 10px 0 0;">' +
                        '<h2 style="margin:0;font-size:1.25rem;">⚠️ Booking Cancelled — ' + esc(ref) + '</h2>' +
                        '<p style="margin:.4rem 0 0;opacity:.92;font-size:.92rem;">Cancelled by ' + esc(cancelledBy) + ' on ' + fmtDate(new Date().toISOString()) + '.</p>' +
                    '</div>' +
                    '<div style="background:#fff;border:1px solid #e3e8ef;border-top:none;padding:1.25rem 1.5rem;border-radius:0 0 10px 10px;">' +
                        '<p style="margin:0 0 1rem;font-size:.95rem;line-height:1.55;">Hi <strong>' + esc(name) + '</strong>,</p>' +
                        '<p style="margin:0 0 1rem;font-size:.95rem;line-height:1.55;">This is to confirm that your Andaman booking has been <strong style="color:#c0392b;">cancelled</strong>. The original booking details are below for your records.</p>' +
                        (reason ? '<div style="background:#fdedec;border-left:3px solid #e74c3c;padding:.7rem 1rem;border-radius:6px;margin:0 0 1rem;font-size:.9rem;color:#7b241c;"><strong>Reason:</strong> ' + esc(reason) + '</div>' : '') +
                        detailsHtml(booking) +
                        '<div style="background:#fff8e7;border-left:3px solid #f39c12;padding:.85rem 1rem;border-radius:6px;margin:1.25rem 0 0;font-size:.9rem;color:#7d5a00;line-height:1.55;">' +
                            '<strong>Refund policy:</strong> Refunds follow our three-tier sliding scale based on how many days are left before your travel start date. The cancellation team will contact you on <strong>' + esc(custEmail || pickPhone(booking) || 'your registered contact') + '</strong> within 1–2 working days with the refund timeline applicable to your booking.' +
                        '</div>' +
                        '<p style="margin:1.25rem 0 0;font-size:.88rem;color:#7f8c8d;">Questions? Reply to this email or call <a href="tel:+918880195191" style="color:#0d7a8a;">+91 88801 95191</a>. Quote ref <strong>' + esc(ref) + '</strong>.</p>' +
                    '</div>' +
                '</div>';

            var text =
                'Andaman Booking Cancelled — ' + ref + '\n' +
                '\nHi ' + name + ',\n' +
                '\nYour Andaman booking has been cancelled by ' + cancelledBy + '.\n' +
                (reason ? '\nReason: ' + reason + '\n' : '') +
                '\n----- Original Booking Details -----\n' +
                detailsText(booking) + '\n' +
                '\nRefund policy: Refunds follow our three-tier sliding scale based on how many days are left before your travel start date. The cancellation team will contact you within 1–2 working days with the refund timeline applicable to your booking.\n' +
                '\nQuestions? Reply to this email or call +91 88801 95191. Quote ref ' + ref + '.\n';

            // Recipients — cancellation team mailbox first, customer
            // cc'd with their own copy. Dedupe so a customer using
            // cancellation@... as their own email isn't mailed twice.
            var recipients = [CANCELLATION_INBOX];
            if (custEmail && custEmail.toLowerCase() !== CANCELLATION_INBOX) {
                recipients.push(custEmail);
            }

            // Channel 1 — Cloudflare Worker (Brevo). Cancellations
            // are admin-driven from the dashboard, so the admin
            // token is always available — this is the primary path.
            var workerOk = await sendToManyViaWorker(recipients, {
                from:    CANCELLATION_INBOX,
                subject: subject,
                html:    html,
                text:    text,
                replyTo: CANCELLATION_INBOX
            });
            if (workerOk > 0) {
                console.log('[booking-emails] Cancellation sent via Worker to', workerOk, 'recipient(s) for', ref);
                return true;
            }

            // Channel 2 — Firestore mail/{ref}-cancel-{ts} doc
            // (Trigger Email extension). Distinct doc id so
            // confirmation + cancellation never collide.
            var fs = await getFirestoreHandle();
            if (!fs) {
                console.warn('[booking-emails] No email channel available, skipping cancellation email for', ref);
                return false;
            }
            var doc = {
                to:  [CANCELLATION_INBOX],
                cc:  custEmail ? [custEmail] : [],
                replyTo: CANCELLATION_INBOX,
                message: { subject: subject, html: html, text: text },
                meta: {
                    type: 'bookingCancellation',
                    ref: ref,
                    bookingId: booking.id || ref,
                    cancelledBy: cancelledBy,
                    reason: reason,
                    createdAt: new Date().toISOString()
                }
            };
            await fs.write(String(ref) + '-cancel-' + Date.now(), doc);
            console.log('[booking-emails] Cancellation queued (Firestore mail) for', ref);
            return true;
        } catch (err) {
            console.warn('[booking-emails] Cancellation send failed:', err);
            return false;
        }
    }

    // Public surface
    window.BookingEmails = {
        sendBookingConfirmation: sendBookingConfirmation,
        sendBookingCancellation: sendBookingCancellation
    };
})();
