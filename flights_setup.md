# Flight Affiliate Setup Guide

You've got a brand-new **Flights** section on your homepage and a dedicated `/flights.html` page. Right now visitors can compare prices across MakeMyTrip, EaseMyTrip, Cleartrip and Skyscanner — but **without an affiliate ID you don't earn commission**. This guide walks you through joining each program (free) and plugging your IDs into the site.

---

## What you have now (already live, zero approval needed)

- Beautiful flight search UI on `/` and `/flights.html`
- 4 partner cards: **MakeMyTrip · EaseMyTrip · Cleartrip · Skyscanner**
- Smart deep-links that pre-fill from/to/date/passengers/cabin on the partner site
- IATA code mapping for 30+ Indian cities (Bangalore → BLR, Mumbai → BOM, etc.)
- Port Blair (IXZ) hard-coded as the default destination
- Trip-type toggle (one-way / round-trip)
- GA4 tracking: every redirect fires a `flight_search_redirect` event with partner, route, dates, pax
- Local tally in `localStorage.flightRedirectStats` so you can spot-check clicks per partner

Even without affiliate approval, this is **already useful** — visitors can compare 4 sites in one click. Once IDs are in, every confirmed booking earns you commission.

---

## 💰 Expected commission rates (India, 2026)

| Partner | Typical commission | Per-ticket earning (₹5,000 fare) |
|---|---|---|
| **MakeMyTrip** | 1–2% of fare, capped at ₹500 | ₹50–₹100 |
| **EaseMyTrip** | 2–4% of fare | ₹100–₹200 |
| **Cleartrip** | 0.5–1% of fare, capped at ₹250 | ₹25–₹50 |
| **Skyscanner** | 50% revenue share of their commission | ₹30–₹100 |
| **Travelpayouts** (aggregator) | 1.5–5% of fare across many airlines | ₹75–₹250 |

100 flights/month = **₹3,000–₹15,000 passive income** with zero overhead.

---

## 🚀 Step 1 — Sign up for Travelpayouts (FASTEST, do this first)

Travelpayouts is an affiliate aggregator. One signup = access to MakeMyTrip flights, Aviasales, WeGo, Cleartrip flights, Booking.com hotels, Hotellook, RentalCars, and 60+ other travel programs. **Approval is usually within 24 hours.**

1. Go to **https://www.travelpayouts.com/**
2. Click **Become a Partner** → Sign up with your email
3. Add your website: `https://andamanvoyages.in`
4. Pick category: **Travel/Flights**
5. Verify your email
6. Once approved, find your **Marker** (your affiliate ID) at:
   - Dashboard → Tools → click your account icon → **API Token + Marker**
7. Plug it into `js/firebase-config.js`:
   ```js
   travelpayouts: { tag: "", marker: "12345" }   // ← your real marker
   ```

> Travelpayouts also gives you ready-made flight-search **widgets** with live prices that you can embed on your site. Tell me when you want to add the widget version and I'll wire it up.

---

## 🚀 Step 2 — Apply for direct affiliate programs

These take 5–10 days each but pay higher commissions than aggregators.

### 2a. MakeMyTrip Affiliate
1. Go to **https://affiliate.makemytrip.com**
2. Click **Sign Up** → fill business details
3. Provide: PAN card, bank account, your website URL
4. Wait 3–7 days for approval email
5. Once approved, copy your **Affiliate ID** from the dashboard
6. In `js/firebase-config.js`:
   ```js
   makemytrip: { tag: "YOUR_MMT_AFFILIATE_ID", subId: "andamanvoyages" }
   ```

### 2b. EaseMyTrip Affiliate (highest commission!)
1. Go to **https://www.easemytrip.com/affiliate.html**
2. Email **affiliates@easemytrip.com** with: business name, GST, website, expected monthly volume
3. Approval in 5–7 days; they'll send you a unique tracking link or affiliate ID
4. Plug into `firebase-config.js`:
   ```js
   easemytrip: { tag: "YOUR_EMT_ID", subId: "andamanvoyages" }
   ```

### 2c. Cleartrip Affiliate
1. Go to **https://www.cleartrip.com/affiliate**
2. Sign up — they've a self-serve dashboard
3. Get your Affiliate ID instantly
4. Plug in:
   ```js
   cleartrip: { tag: "YOUR_CT_ID", subId: "andamanvoyages" }
   ```

### 2d. Skyscanner Distribution Partner
1. Go to **https://skyscanner.business**
2. **Distribution Partners → Apply**
3. They want to verify quality, so include your real traffic numbers (Google Analytics screenshots help)
4. Approval can take 2–4 weeks
5. Once approved, you'll get an **Associate ID**
6. Plug in:
   ```js
   skyscanner: { tag: "YOUR_SKY_ID", subId: "andamanvoyages" }
   ```

---

## 🛠️ Step 3 — Plug your IDs into the code

Open `js/firebase-config.js` and update the `window.FLIGHT_AFFILIATES` block:

```js
window.FLIGHT_AFFILIATES = {
    skyscanner:    { tag: "YOUR_SKY_ID",   subId: "andamanvoyages" },
    makemytrip:    { tag: "YOUR_MMT_ID",   subId: "andamanvoyages" },
    easemytrip:    { tag: "YOUR_EMT_ID",   subId: "andamanvoyages" },
    cleartrip:     { tag: "YOUR_CT_ID",    subId: "andamanvoyages" },
    travelpayouts: { tag: "",              marker: "YOUR_TP_MARKER" }
};
```

Commit + push. From the next page load, every flight redirect carries your tracking ID.

> Tip: leave any unapproved partner's `tag` empty — the redirect still works (you just won't earn commission until approved).

---

## 📊 How to track earnings

### Inside each partner's dashboard
- **MakeMyTrip**: dashboard.affiliate.makemytrip.com → Reports → Bookings
- **EaseMyTrip**: monthly statement emailed to you
- **Cleartrip**: cleartrip.com/affiliate → Reports
- **Skyscanner**: partners.skyscanner.com → Performance Dashboard
- **Travelpayouts**: travelpayouts.com/dashboard → Statistics (most detailed, shows clicks → bookings → commission)

### Inside YOUR Google Analytics
We're already tracking the click event. To see them:

1. https://analytics.google.com → your property → **Reports → Engagement → Events**
2. Look for **`flight_search_redirect`**
3. Click it → see breakdown by partner / route / date / cabin / passengers
4. Build a custom report: filter by partner = "easemytrip" to see EMT-specific clicks

### Inside YOUR admin dashboard (planned)
A future "Affiliate Revenue" tile in your dashboard could show:
- Last 7-day click count per partner
- Estimated commission (based on average fare × commission rate)
- Top routes (Bangalore → Port Blair, Chennai → Port Blair, etc.)

Tell me when you want me to build this.

---

## 🎯 Tips to maximize commission

1. **Promote the flights page in your booking confirmation emails** — every customer needs flights, send them to your `/flights.html` first
2. **Add cross-promotion banners** on package pages: "Already booked your tour? Find cheap flights here →"
3. **Run small Google Ads campaigns** targeting "cheap flights to Andaman" and send traffic to `/flights.html` (CPC + commission usually nets positive)
4. **Submit `/flights.html` to Google Search Console** so it gets indexed faster (already in your sitemap, but request indexing manually for a quicker start)
5. **Add the JSON-LD `Service` or `Product` schema** to flights.html (we can do this later if you want richer SERP listing)
6. **Email past customers**: "Going back to Andaman? Here's our flight-search tool. Use code ANDAMAN10 for ₹100 off." (Travelpayouts often has discount coupons you can pass through)

---

## ⚠️ Legal & compliance

- The disclaimer is **already on the page** ("we don't sell flights directly, we redirect, may earn commission, no extra cost to you") — Indian law and Google AdSense both require this disclosure
- Don't claim guaranteed prices — partner prices are dynamic and may differ from what you display in the UI
- Don't store or process credit-card data — all of that happens on the partner's side, not yours
- Respect each partner's brand guidelines (logo usage, link styling) — most don't allow you to claim partnership-of-priority

---

## 📁 Files involved

| File | What it does |
|---|---|
| `js/flights.js` | **NEW** — IATA mapping, partner deep-link URL builder, GA4 + localStorage tracking |
| `css/flights.css` | **NEW** — Search form + partner card styling |
| `flights.html` | **NEW** — Dedicated flight-search page (priority `0.9` in sitemap) |
| `index.html` | New `<section id="flights">` between Packages and Customize, plus nav link, `<script>` include, and inline wiring |
| `js/firebase-config.js` | Added `window.FLIGHT_AFFILIATES` block (placeholders) |
| `scripts/seo-build.js` | sitemap now includes `/flights.html` |

---

## ⏱️ Realistic timeline

- **Today**: Pages live, search works, but no commission yet
- **Day 1**: Sign up Travelpayouts → approved within 24 hours
- **Day 2**: Plug in Travelpayouts marker → start earning on Travelpayouts redirects
- **Week 1**: Apply to MakeMyTrip + EaseMyTrip + Cleartrip
- **Week 2**: Plug in those IDs as approvals arrive
- **Month 2**: Apply to Skyscanner (more selective)
- **Month 3+**: Steady commission flow as your traffic grows

The whole stack is **production-ready right now** — affiliate IDs only affect attribution, not functionality.