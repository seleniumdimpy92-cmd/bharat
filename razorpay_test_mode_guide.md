# 🧪 Razorpay Test Mode — End-to-End Booking, Cancel & Refund

Complete walk-through to test the full money flow (booking → cancel → auto-refund)
without spending a single rupee. Your codebase already has all the plumbing —
this guide just tells you which switches to flip.

---

## What you'll test

1. **Book** a package via Razorpay test gateway (fake card)
2. **Cancel** it from `/bookings` (customer) or `/dashboard` (admin)
3. **Auto-refund** is triggered via the Cloudflare Worker → Razorpay test API
4. **Verify** booking status, refund row in Firestore, and refund visible in Razorpay test dashboard

---

## ✅ Pre-flight checklist

- [ ] Razorpay account with **test mode** keys (`rzp_test_…`)
- [ ] Admin login on your site (email present in `ADMIN_EMAILS`)
- [ ] `wrangler` CLI installed (`npm i -g wrangler` if not)
- [ ] Cloudflare account access for the `refund` Worker

---

## STEP 1 — Get Razorpay test keys

1. Sign in: <https://dashboard.razorpay.com>
2. **Top-right toggle** → flip from **Live Mode** to **Test Mode** (orange banner appears)
3. Go to **Settings → API Keys → Generate Test Key**
4. Copy both:
   - **Key ID** → `rzp_test_XXXXXXXXXXXXXX`
   - **Key Secret** → shown **only once** — save it immediately

> ⚠️ Test mode is fully isolated from live. Test refunds appear under
> **Test Mode → Transactions → Refunds**. No real money ever moves.

---

## STEP 2 — Switch the frontend to TEST mode

Your `js/checkout.js` (lines 23-47) reads a Firestore-controlled toggle. **No code edits needed.**

1. Log in as admin → go to `/dashboard.html`
2. Open the **Settings** tab
3. Find **Razorpay Test Mode** section
4. **Enable** the toggle
5. Paste your **Test Key ID** (`rzp_test_…`) into the field
6. Click **Save**

**Verify it's working:**
Open `/checkout.html` and watch DevTools console — you'll see an orange banner:

```
[Razorpay TEST MODE] using key rzp_test_… — no real money will move.
```

---

## STEP 3 — Switch the refund Worker to TEST secrets

The Cloudflare Worker holds the Razorpay **secret** (which is what actually authorises a refund). Until you swap it, the Worker still talks to LIVE Razorpay — and a refund attempt from a test booking will fail because the test `pay_…` id doesn't exist in live.

```bash
cd workers/refund

# Replace LIVE secrets with TEST credentials
npx wrangler secret put RAZORPAY_KEY_ID
# Paste: rzp_test_XXXXXXXXXXXXXX  → Enter

npx wrangler secret put RAZORPAY_KEY_SECRET
# Paste: <your test key secret>  → Enter

# Redeploy
npx wrangler deploy
```

**Verify Worker is healthy:**
```bash
curl https://refund.pittu-das2.workers.dev
# → {"ok":true,"service":"refund"}
```

> 💡 Tip: keep a note of which key set is currently in the Worker. Easiest
> way is to look at the `KEY ID` from Razorpay's API Keys page in test mode
> and compare to what `npx wrangler secret list` shows (you'll see names but
> not values — names only).

---

## STEP 4 — Make a test booking

1. Open `/checkout.html` (or browse to a package and click **Book Now**)
2. Fill traveller details (name, phone, email, date)
3. **Tick** the Terms & Conditions checkbox
4. Click **Pay ₹X,XXX Advance & Confirm**
5. Razorpay modal opens — pick **Card** as the method

### Razorpay test card details

| Field | Value |
|------|-------|
| **Card number** | `4111 1111 1111 1111` |
| **Expiry** | any future date (e.g. `12/30`) |
| **CVV** | any 3 digits (e.g. `123`) |
| **Name** | anything |
| **OTP** (if asked) | `1111` or `123456` |

Other test methods that work:
- **UPI**: enter `success@razorpay` (success) or `failure@razorpay` (decline)
- **Netbanking**: pick any bank → click **Success** on the Razorpay simulator screen
- **Wallet**: pick any wallet → click **Success**

**Failure tests** (verify error path works):
- Card: `5104 0600 0000 0008` → declined
- UPI: `failure@razorpay`

After success → you'll be redirected with a `BTT…` booking reference.

---

## STEP 5 — Verify the booking saved

### A. In your `/bookings.html` page (customer view)
The new booking should show with status `confirmed`.

### B. In Firestore (`bookings/{bookingId}`)
Open Firebase console → Firestore → `bookings` collection. The newest doc should have:
- `payment_id`: `pay_XXXXXXXXXXXXXX` (test mode payments still get a real-looking id)
- `payment_status`: `partial_advance`
- `advance_paid`: e.g. `12000`
- `total_trip_cost`: e.g. `45000`
- `balance_due`: e.g. `33000`
- `status`: `confirmed`

### C. In Razorpay test dashboard
Test Mode → **Transactions → Payments** → newest row → status `Captured`.

---

## STEP 6 — Cancel the booking & trigger refund

You can cancel from **two** places — both end up calling `Refund.processRefund`:

### Option A — Customer cancels from `/bookings`
1. Open `/bookings.html` while logged in as the customer
2. Find the booking → click **Cancel**
3. Confirm the dialog

⚠️ Customer cancellation does **NOT** auto-refund (by design — only admins can hit Razorpay's refund API). The booking is marked `cancelled` and an admin must approve the refund from `/dashboard`.

### Option B — Admin cancels from `/dashboard` (recommended for full test)
1. Open `/dashboard.html` as admin
2. Go to **Bookings** tab → find the booking → click **Cancel**
3. The confirm dialog will show:
   ```
   Cancel booking BTT12345678?
   • Auto-refund ₹4,000 to the original payment method (Razorpay)
   ```
   (Refund amount depends on the sliding scale — see `refund_setup.md`)
4. Click **OK**

You should see a toast:
```
Booking cancelled. Email sent. ₹4,000 refund initiated.
```

---

## STEP 7 — Verify the refund

### A. In Razorpay test dashboard
Test Mode → **Transactions → Refunds** → new row with:
- `Refund ID`: `rfnd_XXXXXXXXXXXXXX`
- `Status`: `processed` (instant in test mode) or `pending`
- `Amount`: matches what the toast said

### B. In Firestore `bookings/{id}` — should now have:
- `status`: `cancelled`
- `refundId`: `rfnd_XXXXXXXXXXXXXX`
- `refundAmount`: e.g. `4000`
- `refundStatus`: `processed` or `pending`
- `refundedAt`: ISO timestamp

### C. In Firestore `refunds/{refundId}` — append-only audit row:
- Mirror of refund details for accounting/GST trail

### D. Email
Check the customer email inbox — cancellation + refund-initiated email should arrive (via your `inbox-mail` worker).

---

## STEP 8 — Test the sliding-scale logic

Your refund amount depends on **days before travel**. To exercise each branch, create test bookings with different `travel_date` values:

| Travel date | Tier | Expected refund (per head) |
|------|-----|------|
| 35 days from now | Standard (₹6K advance) | ₹4,000 / head |
| 35 days from now | Luxury (₹11K advance) | ₹6,500 / head |
| 15 days from now | any | 50% of advance |
| 5 days from now | any | ₹0 (no refund) |

> 🛠 Quick tip: in dev you can edit the booking's `travel_date` field directly
> in the Firestore console to simulate "how would this refund work if cancelled today".

---

## STEP 9 — Test the FREE / TEST package shortcut

Your code has a **bypass** for the smoke-test package (`js/checkout.js` line 87 — `isTestPackage()`).

1. On `/checkout.html`, switch to a package whose id or name contains the word **"test"** (e.g. the seeded `Payment Test Package`)
2. Click **Confirm Test Booking — No Payment** (label changes automatically)
3. Booking is confirmed instantly with `payment_id: TEST-BTT…` — Razorpay never opened
4. Cancelling this booking → `Refund.processRefund` returns `{ skipped: true }` (no Razorpay call) but still marks `cancelled` and emails the customer

This is great for staff to validate the email/booking-record path without needing the gateway up.

---

## 🧯 Troubleshooting

### "Payment gateway not loaded"
Refresh — `https://checkout.razorpay.com/v1/checkout.js` blocked or slow to load.

### Razorpay popup shows "International cards are not allowed" or similar
You're on test mode but used a card the test simulator doesn't recognise. Stick to the documented test cards: <https://razorpay.com/docs/payments/payments/test-card-details/>

### Refund call returns `401 Unauthorized` from the Worker
Your Firebase ID token is missing/expired. Hard-refresh the page (`Cmd+Shift+R`) so a fresh token is grabbed by `auth.js`.

### Refund returns `BAD_REQUEST_ERROR — The id provided does not exist`
The Worker is still using **LIVE** secrets but you're cancelling a **TEST** booking (or vice-versa). Repeat **STEP 3** to align them.

### Refund returns `BAD_REQUEST_ERROR — payment is fully refunded`
You already refunded this booking. Razorpay only refunds once per payment.

### "Booking cancelled. Email sent." toast appears but no `refundId` on the doc
Check DevTools → Network → request to `refund.pittu-das2.workers.dev`.
- HTTP 200 → look at the response body — `skipped: true` means the booking has no `pay_…` id (was a FREE/TEST booking — that's fine).
- HTTP 4xx/5xx → check Cloudflare Worker logs: `npx wrangler tail` from `workers/refund/`.

### "ADMIN_EMAILS" doesn't include my login
Edit `workers/refund/wrangler.jsonc` → bump the comma-separated list → `npx wrangler deploy`.

---

## 🔒 Going back to LIVE

When you're done testing:

1. **Dashboard → Settings**: turn **Razorpay Test Mode** OFF.
2. **Worker secrets**: swap back to live keys.
   ```bash
   cd workers/refund
   npx wrangler secret put RAZORPAY_KEY_ID       # rzp_live_…
   npx wrangler secret put RAZORPAY_KEY_SECRET   # matching live secret
   npx wrangler deploy
   ```
3. Make **one** small live booking (₹1 test package works) → cancel it → verify the refund flow uses live keys correctly. Then you're production-ready.

---

## 📚 Related docs in this repo

| File | What's in it |
|------|--------------|
| `refund_setup.md` | Worker architecture, deployment, Firestore rules |
| `razorpay_integration.md` | Original checkout integration overview |
| `razorpay_troubleshooting.md` | Payment-flow gotchas |
| `live_payment_setup.md` | LIVE-mode go-live checklist |

---

## TL;DR — fastest possible test

```
1. Razorpay → Test Mode → copy rzp_test_… key id + secret
2. Dashboard → Settings → Razorpay Test Mode ON → paste key id → Save
3. cd workers/refund
   npx wrangler secret put RAZORPAY_KEY_ID       # paste test key id
   npx wrangler secret put RAZORPAY_KEY_SECRET   # paste test secret
   npx wrangler deploy
4. /checkout → book → card 4111 1111 1111 1111, exp 12/30, CVV 123, OTP 1111
5. /dashboard → Bookings → Cancel → confirm → see toast "₹X refund initiated"
6. Razorpay test dashboard → Refunds → verify rfnd_… row created
```

✅ Done.
