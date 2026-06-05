# Razorpay Refund Setup

End-to-end automatic refunds for cancelled bookings — same architecture as the
existing `inbox-mail` Worker so it slots neatly into the Cloudflare + Firebase
stack you already run.

---

## What this gets you

When a booking is cancelled (from `/bookings` by the customer, or from
`/dashboard → Bookings → Cancel` by an admin), the system:

1. Marks the Firestore booking doc `status: 'cancelled'`.
2. Sends the cancellation email (existing `inbox-mail` flow).
3. **Computes the refund amount** from the published sliding scale:
   - **30+ days** before travel → ₹4,000 / head (Budget &amp; Standard) or
     ₹6,500 / head (Luxury), capped at the advance paid.
   - **8 – 29 days** → 50 % of advance.
   - **0 – 7 days / no-show** → ₹0 (no refund — full advance forfeited).
4. **Calls the new `refund` Cloudflare Worker**, which authenticates the
   admin via Firebase ID token and POSTs to Razorpay's
   `POST /v1/payments/{id}/refund` endpoint with the Razorpay key SECRET
   that lives only in Worker secrets (never in the browser).
5. **Persists** `refundId`, `refundAmount`, `refundStatus`, `refundedAt`
   onto the booking doc, plus an append-only audit row in
   `refunds/{refundId}` for accounting / GST.
6. The customer is shown a Toast: *"₹X,XXX refund initiated to your original
   payment method (3–5 working days)."* — and admins see the same on
   `/dashboard`.

The Worker is **admin-only**: when a non-admin customer cancels, Razorpay isn't
called at all. The cancellation goes through, the email is sent, and an admin
manually approves the refund from `/dashboard` later. This is the safer
default — random visitors can't drain your Razorpay balance even if they
forge requests.

---

## File map

| File | What it does |
|------|--------------|
| `workers/refund/worker.js` | Cloudflare Worker — auths, calls Razorpay, returns refund object. |
| `workers/refund/wrangler.jsonc` | Worker config (vars + secrets layout). |
| `workers/refund/package.json` | Wrangler dev dep. |
| `js/refund.js` | Browser helper — `Refund.computeRefundAmount`, `Refund.processRefund`, `Refund.saveRefundToBooking`, `Refund.logRefund`. |
| `js/bookings-page.js` | Customer-side cancel flow — calls `Refund.processRefund` after status update. |
| `js/dashboard.js` | Admin-side cancel flow — confirms, processes refund, mirrors back to local DB. |
| `bookings.html` | Adds `window.REFUND_WORKER_URL` + `<script src="js/refund.js">`. |
| `dashboard.html` | Same. |
| `firestore.rules` | Adds `refunds/{refundId}` collection (append-only audit). |

---

## Razorpay account prep (one-time)

1. Sign in at <https://dashboard.razorpay.com>.
2. Go to **Settings → API Keys**. Note the existing **Key ID** + **Key Secret**
   (you may already have them — reuse the same pair you use in
   `js/firebase-config.js` for the Razorpay checkout integration).
3. Confirm **Refunds → Auto refund** is on (Settings → Configuration →
   Refunds). It usually is by default for new accounts.
4. Default refund speed is `normal` (T+5–7 working days, free).
   `optimum` (instant, ~₹6 per refund) is also supported — pass
   `speed: 'optimum'` from the client if you want to flip it.

---

## Deploy the Cloudflare Worker

```bash
cd workers/refund
npm install
npx wrangler login

# Set Razorpay credentials as secrets (NEVER commit them)
npx wrangler secret put RAZORPAY_KEY_ID       # rzp_live_… or rzp_test_…
npx wrangler secret put RAZORPAY_KEY_SECRET   # the matching secret

npx wrangler deploy
```

After deploy, Wrangler prints the Worker URL — something like:

```
https://refund.<your-cloudflare-subdomain>.workers.dev
```

Open it in a browser; you should see `{"ok":true,"service":"refund"}`.

---

## Wire the Worker URL into the front-end

In **`bookings.html`** and **`dashboard.html`**, the bootstrap `<script>`
already sets:

```html
<script>window.REFUND_WORKER_URL = 'https://refund.pittu-das2.workers.dev';</script>
```

If your Cloudflare account is different, edit both lines to point at your
Worker's URL. The browser-side `js/refund.js` uses this to know where to send
refund requests.

---

## Update the wrangler.jsonc vars

`workers/refund/wrangler.jsonc` ships with these defaults:

```jsonc
"vars": {
    "ALLOWED_ORIGIN":      "https://andamanvoyages.in,http://localhost:8000",
    "ADMIN_EMAILS":        "deb@andamanvoyages.in,admin@admin.com",
    "FIREBASE_PROJECT_ID": "andaman-b886d",
    "MAX_REFUND_INR":      "1000000"
}
```

- **`ADMIN_EMAILS`** — only Firebase ID tokens issued to one of these emails
  may trigger a refund. Keep it the same as the `inbox-mail` Worker.
- **`MAX_REFUND_INR`** — sanity cap. Refuses any single refund > ₹10 lakh
  unless you bump it.
- Redeploy after editing: `npx wrangler deploy`.

---

## Publish the Firestore rules

The `refunds/{refundId}` audit collection is now in `firestore.rules`. Open
the [Firestore Rules tab in the Firebase Console](https://console.firebase.google.com/project/andaman-b886d/firestore/rules)
and paste the latest `firestore.rules` content, then click **Publish**.

---

## Test it end-to-end (test keys first!)

1. Switch the Worker secrets to your **test** Razorpay keys
   (`rzp_test_…`).
2. Make a real booking on `/checkout` against the test gateway — Razorpay
   gives you back a `pay_…` payment id which gets stored on the booking.
3. Cancel that booking from `/dashboard → Bookings → Cancel`.
4. Confirm dialog should show:
   ```
   • Auto-refund ₹X,XXX to the original payment method (Razorpay)
   ```
5. Click **OK**. The Toast should read:
   ```
   Booking cancelled. Email sent. ₹X,XXX refund initiated.
   ```
6. Verify in **Razorpay Dashboard → Refunds** — a new `rfnd_…` row in
   "Pending" / "Processed" status.
7. Verify in Firestore `bookings/{id}` — fields `refundId`, `refundAmount`,
   `refundStatus`, `refundedAt` are set.
8. Verify in Firestore `refunds/{refundId}` — audit row created.

When you're happy, swap the secrets to the **live** keys and redeploy.

---

## Webhook (optional but recommended)

Normal-speed refunds (`speed: 'normal'`) take 3–7 days to settle, so the
initial response is `status: 'pending'`. To keep the booking doc accurate,
add a Razorpay webhook for `refund.processed` and `refund.failed`:

1. **Razorpay Dashboard → Settings → Webhooks → + Create New Webhook.**
2. **URL:** `https://refund-webhook.<sub>.workers.dev/`
   (a separate Worker — see template below).
3. **Active events:** `refund.processed`, `refund.failed`.
4. **Secret:** generate one and store as `RAZORPAY_WEBHOOK_SECRET` in the
   webhook Worker.

A minimal webhook Worker (drop in `workers/refund-webhook/` if/when you want
it) verifies the `X-Razorpay-Signature` header, looks up the matching
booking by `refund.notes.booking_ref`, and updates `refundStatus`. Same
pattern as `email-router`. Not shipping it today since the customer-facing
flow already works with `pending` — but the hook is the cleanest way to flip
to `processed` automatically.

---

## What this does **not** auto-handle

- **Per-booking advance > sliding-scale slab.** The slab is per-head; if
  the customer paid an extra-large advance for any reason, you'll want to
  override `opts.amount` from the dashboard before approving. A future
  iteration could surface a "custom amount" prompt for the admin.
- **Refunds for non-Razorpay payments.** Cash / bank transfer / FREE
  bookings have no `pay_…` id, so `Refund.processRefund` returns
  `{ skipped: true }` and the admin handles the refund out-of-band
  (UPI / NEFT). The booking is still marked cancelled.
- **Partial refunds within a single refund.** Razorpay supports them
  (just call the API twice), but the current UI assumes a single
  refund per booking. If you need multi-tranche refunds, drop me a
  line and we can add a `Refund.processCustomRefund` variant.

---

## Cost

- Cloudflare Worker: free tier (100K requests/day) — refunds are dozens per
  month at most, so effectively ₹0.
- Razorpay: refunds at `normal` speed are **free**. `optimum` (instant) is
  ₹5–6 per refund — billed by Razorpay separately.
- Firestore: a refund attempt is 1 update on `bookings/{id}` + 1 create on
  `refunds/{id}` = 2 writes. Negligible against the free 20K/day quota.