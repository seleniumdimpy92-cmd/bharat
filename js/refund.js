/* ── refund.js ─────────────────────────────────────────────────
 * Client-side helper for processing Razorpay refunds via the
 * `refund` Cloudflare Worker (workers/refund/).
 *
 * Public surface (window.Refund):
 *   • computeRefundAmount(booking)     → returns the INR amount the
 *     customer is owed back per the sliding-scale policy:
 *         30+ days before travel  → ₹4,000 (B/S) or ₹6,500 (Lux) per head
 *         8 – 29 days             → 50 % of advance
 *         0 – 7 days / no-show    → ₹0
 *     Capped at booking.advance_paid so we never refund more than was
 *     actually collected.
 *
 *   • processRefund(booking, opts)     → admin-only. POSTs to the
 *     Worker, which calls Razorpay's refunds API and returns the
 *     refund object. opts.amount overrides computeRefundAmount() if
 *     the admin wants to set a custom amount in the dashboard UI.
 *     Resolves to:
 *         { ok: true,  refundId, amount, status, … }   on success
 *         { ok: false, error, skipped? }               on failure
 *         { ok: true,  skipped: true, reason }         when no refund
 *                                                     applies (FREE
 *                                                     booking, 0-7d slab,
 *                                                     non-Razorpay payment,
 *                                                     already refunded).
 *
 *   • saveRefundToBooking(booking, refund)  → mirrors the refund
 *     object back into the Firestore bookings/{id} doc so the
 *     dashboard + customer view stay in sync.
 *
 * Worker URL: window.REFUND_WORKER_URL — set in bookings.html /
 *             dashboard.html. If not set, processRefund() resolves
 *             with { ok:false, error:'REFUND_WORKER_URL not set' }
 *             so callers can degrade gracefully.
 * ──────────────────────────────────────────────────────────── */
(function () {
    'use strict';

    // Sliding-scale slabs (per head). Mirror checkout.js exactly so
    // the displayed refund matches what the customer was promised at
    // booking time.
    function isLuxuryTier(booking) {
        var label = String(
            (booking && (booking.package_label || booking.package_name)) || ''
        ).toLowerCase();
        return /lux|premium|deluxe/.test(label);
    }

    function dayDiff(travelDate) {
        if (!travelDate) return null;
        var dt = (travelDate.toDate ? travelDate.toDate() : new Date(travelDate));
        if (isNaN(dt.getTime())) return null;
        var today = new Date();
        today.setHours(0, 0, 0, 0);
        dt.setHours(0, 0, 0, 0);
        return Math.floor((dt - today) / 86400000);
    }

    function computeRefundAmount(booking) {
        if (!booking) return 0;
        var advance = Number(booking.advance_paid) || 0;
        if (advance <= 0) return 0;

        var days = dayDiff(booking.travel_date || booking.travelDate);
        if (days == null) {
            // No travel date — treat as 30+ to avoid forfeiting a refund.
            days = 30;
        }
        if (days < 8) return 0;                          // 0–7 days → no refund

        var heads = (Number(booking.adults) || 0) + (Number(booking.children) || 0);
        if (heads <= 0) heads = 1;

        if (days >= 30) {
            var perHead = isLuxuryTier(booking) ? 6500 : 4000;
            return Math.min(perHead * heads, advance);   // cap at advance
        }
        // 8–29 days
        return Math.round(advance * 0.5);
    }

    function isRazorpayPayment(booking) {
        if (!booking) return false;
        var pid = String(booking.payment_id || '');
        if (!pid) return false;
        if (/^FREE-/i.test(pid)) return false;           // FREE booking
        if (!/^pay_/.test(pid)) return false;            // not a Razorpay id
        return true;
    }

    function alreadyRefunded(booking) {
        return !!(booking && (
            booking.refundId ||
            String(booking.refundStatus || '').toLowerCase() === 'refunded' ||
            booking.refundedAt
        ));
    }

    async function getIdToken() {
        try {
            if (window.__firebaseReady) {
                var fb = await window.__firebaseReady;
                if (fb && fb.auth && fb.auth.currentUser) {
                    return await fb.auth.currentUser.getIdToken();
                }
            } else if (window.firebase && window.firebase.auth) {
                var u = window.firebase.auth().currentUser;
                if (u) return await u.getIdToken();
            }
        } catch (_) {}
        return '';
    }

    // Detect "id does not exist" / "not found" Razorpay errors. These
    // indicate the worker's RAZORPAY_KEY_ID is from the wrong environment
    // (LIVE secrets can't refund TEST payments and vice-versa). When we
    // see this on one worker, the caller will retry against the other.
    function isUnknownIdError(json, status) {
        if (status === 404) return true;
        var s = JSON.stringify(json || {}).toLowerCase();
        return /\bdoes not exist\b|\bid not found\b|\bno such payment\b|\bunauthorized\b|\bauthentication\b/.test(s);
    }

    async function callRefundWorker(workerUrl, body, idToken) {
        var endpoint = String(workerUrl).replace(/\/+$/, '') + '/refund';
        var res = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type':  'application/json',
                'Authorization': 'Bearer ' + idToken
            },
            body: JSON.stringify(body)
        });
        var json = null;
        try { json = await res.json(); } catch (_) {}
        return { res: res, json: json, status: res.status, ok: res.ok };
    }

    async function processRefund(booking, opts) {
        opts = opts || {};

        // Auto-select / fall back across LIVE and TEST refund workers.
        // The customer's payment was created in either Razorpay's LIVE
        // or TEST environment. Each refund worker is authenticated with
        // ONLY one key pair (LIVE secrets can't refund TEST payments and
        // vice-versa — Razorpay returns "The id provided does not exist").
        // We can't tell which environment a `pay_…` ID belongs to from
        // the ID itself, so we try the most likely worker first and
        // automatically retry on the other one if Razorpay says the ID
        // is unknown / unauthorized.
        var liveUrl = (window.REFUND_WORKER_URL || '').trim();
        var testUrl = (window.REFUND_TEST_WORKER_URL || '').trim();
        if (!liveUrl && !testUrl) {
            return { ok: false, error: 'REFUND_WORKER_URL (and REFUND_TEST_WORKER_URL) not set' };
        }

        if (alreadyRefunded(booking)) {
            return { ok: true, skipped: true, reason: 'Already refunded (refundId on record)' };
        }
        if (!isRazorpayPayment(booking)) {
            return { ok: true, skipped: true, reason: 'Not a Razorpay payment (FREE / cash / bank)' };
        }

        var amount = (opts.amount != null) ? Number(opts.amount) : computeRefundAmount(booking);
        if (!Number.isFinite(amount) || amount <= 0) {
            return { ok: true, skipped: true, reason: '0-7 day no-refund slab — nothing to refund' };
        }

        var idToken = await getIdToken();
        if (!idToken) {
            return { ok: false, error: 'Not signed in (no Firebase ID token)' };
        }

        var body = {
            paymentId:  booking.payment_id,
            amount:     amount,
            bookingRef: booking.booking_ref || booking.id || '',
            reason:     opts.reason || 'Customer cancellation',
            speed:      opts.speed || 'normal'        // 'normal' | 'optimum'
        };

        // Decide order: prefer the env hinted by booking metadata, else LIVE first.
        var paymentMode = String(
            (booking && (booking.payment_mode || booking.razorpayMode || '')) || ''
        ).toLowerCase();
        var preferTest = paymentMode === 'test';
        var primary   = preferTest ? testUrl : liveUrl;
        var secondary = preferTest ? liveUrl : testUrl;
        if (!primary)   primary   = secondary;        // only one configured
        if (primary === secondary) secondary = '';   // avoid double-call

        try {
            var first = await callRefundWorker(primary, body, idToken);
            if (first.ok) {
                return Object.assign({ ok: true, _via: primary }, first.json || {});
            }
            // Retry on the other worker only when Razorpay says the ID is
            // unknown / unauthorized (cross-environment mismatch). For real
            // failures (insufficient balance, business validation) don't
            // retry — the second worker would just fail the same way.
            if (secondary && isUnknownIdError(first.json, first.status)) {
                var second = await callRefundWorker(secondary, body, idToken);
                if (second.ok) {
                    return Object.assign({ ok: true, _via: secondary, _crossEnv: true }, second.json || {});
                }
                return {
                    ok: false,
                    error: (second.json && second.json.error) || ('HTTP ' + second.status),
                    razorpay: second.json && second.json.razorpay,
                    _firstError:  (first.json && first.json.error) || ('HTTP ' + first.status),
                    _triedBoth:   true
                };
            }
            return {
                ok: false,
                error: (first.json && first.json.error) || ('HTTP ' + first.status),
                razorpay: first.json && first.json.razorpay
            };
        } catch (err) {
            return { ok: false, error: 'Network error: ' + (err && err.message) };
        }
    }

    async function saveRefundToBooking(booking, refund) {
        if (!booking || !refund || !refund.ok || refund.skipped) return false;
        if (!window.__firebaseReady) return false;
        try {
            var fb = await window.__firebaseReady;
            var docId = booking._fsId || booking.id;
            if (!docId) return false;
            var ref = fb.firestore.doc(fb.db, 'bookings', String(docId));
            await fb.firestore.updateDoc(ref, {
                refundId:        refund.refundId,
                refundAmount:    refund.amount,
                refundStatus:    refund.status || 'pending',
                refundCurrency:  refund.currency || 'INR',
                refundedAt:      new Date().toISOString(),
                refundInitiator: refund.initiatedBy || ''
            });

            // Mirror in-memory + localStorage so UI updates without a reload.
            booking.refundId       = refund.refundId;
            booking.refundAmount   = refund.amount;
            booking.refundStatus   = refund.status || 'pending';
            booking.refundedAt     = new Date().toISOString();

            try {
                var arr = JSON.parse(localStorage.getItem('bookings') || '[]');
                if (Array.isArray(arr)) {
                    var key = booking.booking_ref || booking.id;
                    var changed = false;
                    for (var i = 0; i < arr.length; i++) {
                        var b = arr[i];
                        if (!b) continue;
                        if ((b.booking_ref && key && b.booking_ref === key) ||
                            (b.id && key && String(b.id) === String(key))) {
                            b.refundId       = refund.refundId;
                            b.refundAmount   = refund.amount;
                            b.refundStatus   = refund.status || 'pending';
                            b.refundedAt     = booking.refundedAt;
                            changed = true;
                        }
                    }
                    if (changed) localStorage.setItem('bookings', JSON.stringify(arr));
                }
            } catch (_) {}

            return true;
        } catch (err) {
            console.warn('[refund] saveRefundToBooking failed:', err);
            return false;
        }
    }

    // Optionally write an audit log entry. Best-effort; depends on
    // a `refunds` Firestore collection rule. Safe to call without a
    // collection — it'll just warn.
    async function logRefund(booking, refund, by) {
        if (!window.__firebaseReady) return;
        try {
            var fb = await window.__firebaseReady;
            var docId = (refund && refund.refundId) || ('rfnd-' + Date.now());
            var ref = fb.firestore.doc(fb.db, 'refunds', String(docId));
            await fb.firestore.setDoc(ref, {
                refundId:    (refund && refund.refundId) || null,
                paymentId:   booking.payment_id || null,
                bookingRef:  booking.booking_ref || booking.id || null,
                bookingId:   booking.id || null,
                amount:      (refund && refund.amount) || 0,
                status:      (refund && refund.status) || 'pending',
                currency:    (refund && refund.currency) || 'INR',
                initiatedBy: by || (refund && refund.initiatedBy) || '',
                createdAt:   new Date().toISOString(),
                ok:          !!(refund && refund.ok),
                error:       (refund && refund.error) || null
            });
        } catch (err) {
            console.warn('[refund] audit log failed (firestore rules?):', err && err.message);
        }
    }

    window.Refund = {
        computeRefundAmount:  computeRefundAmount,
        processRefund:        processRefund,
        saveRefundToBooking:  saveRefundToBooking,
        logRefund:            logRefund,
        isRazorpayPayment:    isRazorpayPayment,
        alreadyRefunded:      alreadyRefunded
    };
})();