# Ezoic Ads — Setup Guide

This site uses **Ezoic** as the display-ad layer (auto-rotating AdSense / Media.net / 9 other networks per visitor for max RPM). This doc tracks what's already wired up and what you still need to do in the Ezoic dashboard.

---

## ✅ Step 1 — Header scripts (DONE — committed)

Privacy + Ezoic header scripts are loaded at the very top of `<head>` on **every public page**:

| Page | Status |
|------|--------|
| `index.html` | ✅ |
| `about.html` | ✅ |
| `cabs.html` | ✅ |
| `flights.html` | ✅ |
| `gallery.html` | ✅ |
| `package.html` | ✅ |
| `terms.html` | ✅ |
| `privacy.html` | ✅ |

**Skipped on purpose** (admin / private — Ezoic should NOT fire here):
- `dashboard.html`, `bookings.html`, `checkout.html`, `profile.html`, `settings.html`
- `customize.html`, `migrate.html`
- `AgodaPartnerVerification.htm`, `googlea56f1cf68bec5877.html` (verification stubs)

The exact block in each public page:

```html
<!-- ── EzoicAds: privacy + header (must load BEFORE any other ad/analytics) ── -->
<script data-cfasync="false" src="https://cmp.gatekeeperconsent.com/min.js"></script>
<script data-cfasync="false" src="https://the.gatekeeperconsent.com/cmp.min.js"></script>
<script async src="//www.ezojs.com/ezoic/sa.min.js"></script>
<script>
    window.ezstandalone = window.ezstandalone || {};
    ezstandalone.cmd = ezstandalone.cmd || [];
</script>
<script src="//ezoicanalytics.com/analytics.js"></script>
```

`data-cfasync="false"` is essential — the site is on Cloudflare and without that attribute Rocket Loader would re-order the privacy scripts and break GDPR/CCPA consent.

---

## 🛠 Step 2 — `ads.txt` auto-refresh (workflow ready, ONE thing to configure)

The site is on **GitHub Pages** (static), so the `.htaccess` / nginx / PHP redirect approaches Ezoic suggests are not available. We use a different — actually better — approach:

> A scheduled **GitHub Action** (`.github/workflows/refresh-ads-txt.yml`) fetches the latest manifest from Ezoic's `srv.adstxtmanager.com` URL **every day** and commits the updated `/ads.txt` to `main`. Always live, always fresh, zero infra cost.

### One-time configuration (do this once, takes 2 minutes)

1. **Get your Ezoic ads.txt URL**
   - Open the Ezoic dashboard → **Monetization → Ads.txt Manager**.
   - Copy the URL Ezoic shows you. It looks like:
     ```
     https://srv.adstxtmanager.com/<YOUR_NUMERIC_ID>/andamanvoyages.in
     ```
   - **Important:** the docs use `19390` as a placeholder — your real ID will be different.

2. **Add it as a GitHub repo variable**
   - Open https://github.com/debzody/bharat/settings/variables/actions
   - Click **"New repository variable"**.
   - Name: `EZOIC_ADSTXT_URL`
   - Value: paste the URL from step 1.
   - Click **Add variable**. Done.
   - (Use **Variables**, not **Secrets** — it's a public URL.)

3. **Trigger the first refresh manually**
   - Open https://github.com/debzody/bharat/actions
   - Click **"Refresh ads.txt"** in the left sidebar.
   - Click **"Run workflow"** → branch `main` → **Run workflow**.
   - Wait ~30 seconds. The action will fetch the manifest, prepend your AdSense line, and commit to `main`.

4. **Verify**
   - Open https://andamanvoyages.in/ads.txt — you should now see ~50+ lines starting with the Andaman Voyages header comment, then the AdSense line, then the Ezoic-managed sellers.

After that, the workflow runs **daily at 03:30 UTC (≈ 09:00 IST)** automatically. If Ezoic adds or removes a seller, your `/ads.txt` is updated within 24 hours.

### Manual refresh

Anytime you want a fresh fetch:
- Go to **Actions → Refresh ads.txt → Run workflow**.

### What if the variable isn't set yet?

The workflow gracefully no-ops with a warning — it won't fail or break anything until you set `EZOIC_ADSTXT_URL`.

---

## ✅ Step 3 — Ad placements (DONE — committed)

Manual placeholders are already wired into the markup, plus a tiny helper that fires `ezstandalone.showAds(...)` once per page with all placement IDs at once (Ezoic's recommended pattern for performance).

### What's deployed

| Page | Placement ID(s) | Position |
|------|-----------------|----------|
| `index.html` | **101**, **102** | Between testimonials & FAQ; between FAQ & contact |
| `package.html` | **105** | End of page content |
| `gallery.html` | **107** | End of grid |
| `flights.html` | **108** | Below results |
| `cabs.html` | **109** | End of content |
| `about.html` | **110** | End of content |
| `terms.html` | **111** | End of content |
| `privacy.html` | **112** | End of content |

### How it works

Each page contains one or more bare placeholder divs:
```html
<div id="ezoic-pub-ad-placeholder-101"></div>
```

A small helper at the bottom of `<body>`:
```html
<script src="js/ezoic-placements.js?v=1" defer></script>
```
auto-discovers every `#ezoic-pub-ad-placeholder-NNN` div on the page and makes a single `ezstandalone.showAds(101, 102, ...)` call — exactly what Ezoic's docs recommend for minimum server requests.

This means:
- Reordering placements = drag-drop the `<div>` in the HTML; no JS edits.
- Adding a new placement = paste another `<div id="ezoic-pub-ad-placeholder-NNN"></div>` (where `NNN` is a fresh ID from your Ezoic dashboard); the helper picks it up automatically.
- Removing a placement = delete the `<div>`.

### Configure these IDs in your Ezoic dashboard

In **Ezoic dashboard → EzoicAds → Placeholder IDs** (or the equivalent menu — UI varies), create matching placements with the same numeric IDs (`101, 102, 105, 107, 108, 109, 110, 111, 112`). Or, if Ezoic generates different numbers for your account:

1. Note down the IDs Ezoic gives you.
2. Open the relevant HTML file and rename the placeholder div, e.g. change `ezoic-pub-ad-placeholder-101` → `ezoic-pub-ad-placeholder-237` if Ezoic gave you 237.
3. Push. The helper script picks up the new ID without any other change.

The IDs we used (101-112) follow Ezoic's documentation example numbering, so most setups will work out of the box.

### Pages intentionally WITHOUT ads

These pages have header scripts loaded (so Ezoic can collect analytics) but **no placement divs** because ads here would hurt UX or violate AdSense policies:

- All admin pages (`dashboard.html`, `bookings.html`, `checkout.html`, `profile.html`, `settings.html`, `customize.html`, `migrate.html`) — these don't even include the header scripts.
- Modals (login, register, profile, payment) — no placeholders inside.
- Above-the-fold hero on `index.html` — kills LCP / Core Web Vitals.

### Auto-Ads vs Manual placeholders

We're using **manual placeholders** — you control exactly where ads appear. If you'd rather hand the layout decision off to Ezoic's ML, you can ALSO turn on **Auto-Insert Ads** in **Ezoic dashboard → EzoicAds → Ad Settings**; the manual placements still get filled, and Auto-Ads fills any extra spots Ezoic's ML thinks are profitable. (Recommend trying both for a week, A/B comparing RPM in Big Data Analytics.)

---

## 🌀 Dynamic content (modals, infinite scroll, SPA navigation)

Per Ezoic's Dynamic Content guide, ads need to be told when content changes inside a single pageview. The placement helper exposes a small public API on `window.EzoicPlacements` that wraps every `ezstandalone` call you'd otherwise have to write inline.

### `window.EzoicPlacements.refresh()`
Re-scan the DOM. Any `<div id="ezoic-pub-ad-placeholder-NNN">` that we haven't shown yet gets passed to `ezstandalone.showAds(...)`. Safe to call as often as you like — already-shown IDs are skipped (no double impressions).

**Use when:** A modal opens with new placeholder divs inside, a tab switch reveals a new section with placeholders, an "AJAX load more" appends new content to the page.

```js
// Example: after opening a modal that contains <div id="ezoic-pub-ad-placeholder-201">
modal.classList.add('open');
window.EzoicPlacements && window.EzoicPlacements.refresh();
```

### `window.EzoicPlacements.show(...ids)`
Explicitly show specific IDs you just added. Same as Ezoic's example block — this version wraps it so you don't need an inline `<script>`.

```js
window.EzoicPlacements.show(104, 105);
```

### `window.EzoicPlacements.destroy(...ids)`
Tear down placements before removing their `<div>`s from the DOM (e.g. closing a modal whose contents had ads).

```js
window.EzoicPlacements.destroy(201, 202);
modalNode.remove();
```

### `window.EzoicPlacements.destroyAll()`
Wraps `ezstandalone.destroyAll()`. Useful when ripping out a whole section and rebuilding from scratch.

### `window.EzoicPlacements.refreshAllForNewPage()`
For SPA-style URL changes (we don't currently use this — our routes are full HTML pages — but reserved for the future). Calls `ezstandalone.showAds()` with no arguments, which Ezoic interprets as "I'm on a new pageview, refresh every existing placeholder + anchor + video ad". Then re-scans the DOM so any newly-rendered placeholders specific to the new route also light up.

### Doesn't this site already use SPA-style nav?

Not really — `index.html`'s `#packages`, `#destinations`, `#how-it-works` etc. are **anchor scrolls within a single document**. Ezoic doesn't count those as new pageviews and the placements stay live the whole time. The actual page transitions (clicking through to `/package`, `/gallery`, `/flights`) are full HTML loads, which means each page gets its own clean Ezoic init from the header scripts — no dynamic API needed.

The dynamic API is there for future features (lazy-rendered modal ads, blog "load more articles", etc.) without scattering inline `<script>` tags through the codebase.

---

## 🚦 Verification checklist

After Step 1 + Step 2:

- [ ] View source on `https://andamanvoyages.in/` — confirm Ezoic block is at the top of `<head>`.
- [ ] Open https://andamanvoyages.in/ads.txt — confirm full Ezoic manifest is served (50+ lines).
- [ ] DevTools → Network → filter "ezoic" or "gatekeeper" — all 5 scripts return 200.
- [ ] DevTools Console → no errors mentioning `ezstandalone`.
- [ ] Ezoic dashboard → site status shows "Integrated" / green check.

---

## 💰 Realistic revenue expectations

For a site with 5 K visits/mo:
- **Auto-Ads only** ≈ ₹1,500-4,000/mo (low CPM until traffic grows).
- **+ Strategic affiliate widgets** (Booking.com, Travelpayouts hotels, GetYourGuide) ≈ ₹3,000-15,000/mo. *Most travel-site revenue comes from affiliates, not display ads.*
- **+ Newsletter sponsorships** (once you have 1K+ subscribers) ≈ ₹2,000-10,000/mo.

Tip: Ezoic itself usually pays **2-3× what AdSense alone would** because it auto-tests multiple networks per visitor and picks the highest bidder.

---

## 🆘 Troubleshooting

### "Empty manifest fetched" workflow error
- The `EZOIC_ADSTXT_URL` value is wrong. Double-check the publisher ID in the Ezoic dashboard.

### Ezoic dashboard shows "site not detected"
- Ezoic crawls your site to verify the header scripts are present. After the first deploy, wait ~6-24 h; their crawler has a backlog.
- If still red after 48 h: check that you're not blocking `*.ezojs.com` or `*.gatekeeperconsent.com` in Cloudflare WAF / firewall rules.

### Ads not appearing despite green status
- Auto-Ads needs ~24-72 h after enabling to start serving.
- Try in incognito (your AdSense / ad-blocker may be filtering Ezoic).
- Some India-specific advertisers fill slowly; wait a few days for inventory to ramp.

### Refunds / cancel-booking flow broken after Ezoic ads enabled
- Should never happen — `dashboard.html` and `bookings.html` are excluded from Ezoic. If somehow Ezoic auto-detects them, blacklist them in **Ezoic Site Settings → Page exclusions**.

---

## Files of interest

| File | Purpose |
|------|---------|
| `index.html` + 7 other public pages | Header scripts at top of `<head>` + placeholder divs |
| `js/ezoic-placements.js` | Auto-discovers all `#ezoic-pub-ad-placeholder-NNN` divs and fires one `ezstandalone.showAds(...)` |
| `ads.txt` | Auto-refreshed daily by the workflow |
| `.github/workflows/refresh-ads-txt.yml` | The daily fetch + commit workflow |
| `ezoic_ads_setup.md` | This file — keeps the setup story in one place |
