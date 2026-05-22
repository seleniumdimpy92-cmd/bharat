# Google Analytics 4 (GA4) Setup Guide

GA4 tracking is wired into every public page on the site. There's also an **Analytics tab inside the admin dashboard** with deep-links, optional embed widgets, and an event-tracking summary. This guide walks you through the one-time GA4 setup.

---

## What's already done in code

- `js/analytics.js` — A tiny gtag.js helper that loads asynchronously, reads `window.GA4_CONFIG.measurementId` from `firebase-config.js`, and exposes `window.Analytics` with shortcuts for travel/booking events.
- **Tracking added to all public pages**: `index.html`, `package.html`, `gallery.html`, `bookings.html`, `checkout.html`, `about.html`, `privacy.html`, `terms.html`.
- **Admin dashboard does NOT load gtag.js** — your own clicks won't pollute visitor stats.
- **E-commerce events** wired in:

  | Event | Where it fires |
  |---|---|
  | `page_view` | Every public page (default GA4 behaviour) |
  | `view_item` | When a visitor opens `package.html?id=…` |
  | `search` | When the homepage search bar is clicked |
  | `begin_checkout` | When the visitor clicks "Pay" in checkout (before Razorpay opens) |
  | `purchase` | After a Razorpay success — includes the booking value in INR |
  | `payment_failed` | A Razorpay failure callback |

---

## Step 1 — Create your GA4 property (60 sec)

1. Open https://analytics.google.com and sign in
2. **Admin** (gear icon, bottom-left) → **Create** → **Account**
   - **Account name**: `Bharat Tours and Travels`
   - Continue with default data-sharing checkboxes → **Next**
3. **Create a property**
   - **Property name**: `andamanvoyages.in`
   - **Reporting time zone**: `(GMT+05:30) India Standard Time`
   - **Currency**: `Indian Rupee (INR ₹)`
4. **Business details**
   - **Industry**: `Travel`
   - Pick a business size → **Next**
5. **Business objectives**
   - Tick **Generate leads**, **Drive online sales**, **Examine user behaviour**
   - Click **Create** → accept the GDPR/Terms popup
6. **Data stream**
   - Pick **Web**
   - **Website URL**: `https://andamanvoyages.in`
   - **Stream name**: `Andaman Voyages Web`
   - Toggle **Enhanced measurement** ON (gives you scrolls/outbound clicks/file downloads/video for free)
   - Click **Create stream**

You're now looking at "Web stream details". Two values matter:

- **Measurement ID** → looks like `G-XXXXXXXXXX`
- **Stream ID** → a long number like `1234567890`

---

## Step 2 — Plug them into the code (30 sec)

Open `js/firebase-config.js` and update the GA4 block:

```js
window.GA4_CONFIG = {
    measurementId: "G-XXXXXXXXXX",   // ← from "Measurement ID"
    streamId:      "1234567890"      // ← optional but recommended
};
```

Commit + push. Tracking starts immediately on every public page.

> **Alternative**: You can also paste these values into the **Analytics tab** of your admin dashboard. They'll be saved in `localStorage` on that device only. To roll out site-wide, the `firebase-config.js` change is the canonical fix.

---

## Step 3 — Verify it's working (DebugView)

1. Open `https://andamanvoyages.in` in a normal (non-admin) browser tab
2. Open another tab → go to GA4 → **Admin → DebugView** (left side)
3. You should see your session, page_view events, and any custom events flowing in real time
4. Click around — open a package, click search — and watch `view_item`, `search`, etc. appear

If nothing appears within ~30 seconds:
- Hard-refresh the public site (Cmd+Shift+R / Ctrl+F5) to bust the cache
- Check the browser console for errors loading `gtag.js` (often a blocked domain or AdBlock)
- Confirm your Measurement ID is correct (`G-…`, not `UA-…`)

---

## Step 4 — Mark conversion events (recommended)

In GA4, mark these events as **conversions** so they show up in the Monetization reports:

1. **Admin → Events → All events** (left sidebar)
2. For each of these, toggle the "Mark as conversion" switch:
   - `purchase` ✅ (most important — already auto-marked)
   - `begin_checkout`
   - `view_item`
   - `search`

GA4 may take 24 hours to start populating conversion reports.

---

## Step 5 (optional) — Embed full reports inside your dashboard

The **Analytics tab** in the dashboard has a slot to embed a full Looker Studio report inside the admin panel:

1. Open the **Looker Studio GA4 template** (link is on the Analytics tab, "Open template" button)
2. Click **Use template**
3. Pick your GA4 property as the data source → **Create report**
4. Once the report loads, click **Share → Manage Access**
   - Set **General access** to "Anyone with the link can view"
5. Click **File → Embed report → Get a link**
6. Copy the embed URL (starts with `https://lookerstudio.google.com/embed/reporting/...`)
7. Paste into the **"Embedded full report"** box in the dashboard's Analytics tab → **Embed**

Now you have a full 30-day analytics dashboard right inside your admin panel.

---

## Privacy notes

- The tracking script uses `anonymize_ip: true`
- No personally identifiable data is sent — visitor email/name/phone never leave the site as analytics events
- Admin dashboard browsing is fully **excluded** (the script is conditionally skipped on `/dashboard.html`)
- All e-commerce events use only the package ID, name, price, and booking ref — never the customer's personal details

---

## Files modified by this feature

| File | What changed |
|---|---|
| `js/analytics.js` | **NEW** — gtag.js loader + Analytics API |
| `js/firebase-config.js` | Added `window.GA4_CONFIG` block |
| `index.html`, `package.html`, `gallery.html`, `bookings.html`, `checkout.html`, `about.html`, `privacy.html`, `terms.html` | Added `<script src="js/analytics.js?v=1">` |
| `js/script.js` | Wires `Analytics.search()` on the homepage search button |
| `js/checkout.js` | Wires `Analytics.beginCheckout()` and `Analytics.purchase()` around Razorpay |
| `package.html` | Wires `Analytics.viewItem()` when a package details page loads |
| `dashboard.html` | New **Analytics** nav item + tab with deep-links, setup card, realtime + Looker Studio embed slots, event legend |
| `js/dashboard.js` | Section title map updated to include `analytics: 'Analytics — Google Analytics 4'` |

---

## Troubleshooting

**No events show up in DebugView**
→ Either Measurement ID isn't set, an ad-blocker is blocking `gtag.js`, or you're testing on the dashboard page (which is exempt by design).

**`window.gtag is not a function` in console**
→ The page loaded `analytics.js` before `firebase-config.js`. Make sure the script order on every page is `firebase-config.js` first, then `analytics.js`.

**Realtime widget shows "refused to connect"**
→ Google blocks iframe-embedding of the live GA4 dashboard from third-party origins. Use the deep-link cards instead (one click → opens GA4 in a new tab). The Looker Studio embed always works for full reports.

**Bookings show in dashboard but not in GA4 Monetization**
→ Wait 24 hours after first `purchase` event for the Monetization reports to populate. DebugView should still show the events instantly.