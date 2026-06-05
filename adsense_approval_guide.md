# Google AdSense — Approval Guide for andamanvoyages.in

You've added the loader script (`pagead2.googlesyndication.com/pagead/js/adsbygoogle.js`) on every public page and your `ads.txt` is live. **The remaining work is content + UX, not code.**

Google's reviewers manually visit your site and check ~12 boxes. Below is each one mapped to your current site, with action items where something is missing.

---

## Current state at a glance

| Requirement | Status | Notes |
|---|---|---|
| Custom domain (not a free subdomain) | ✅ | `andamanvoyages.in` |
| HTTPS / valid SSL | ✅ | GitHub Pages auto-issues Let's Encrypt |
| `ads.txt` at root | ✅ | `pub-8154901590978667` line is live |
| AdSense loader on every page | ✅ | Just added (commit `3c323b1`) |
| `<meta name="google-adsense-account">` ownership tag | ✅ | On dashboard.html + via seo-build.js |
| `robots.txt` allowing Googlebot | ✅ | Public pages are indexable |
| Working navigation, header, footer | ✅ | Already in place |
| Privacy Policy page | ✅ | `/privacy` (235 lines) |
| Terms & Conditions page | ✅ | `/terms` (283 lines) |
| About Us page | ✅ | `/about` (293 lines) |
| Contact info / contact page | ⚠️ | E-mail visible but no dedicated `/contact` page |
| Cookie / GDPR consent banner | ❌ | **Not present** — required for EU traffic |
| Original, substantial content | ⚠️ | Mostly package descriptions; needs blog posts |
| Site age ≥ 6 months (some regions) | ⚠️ | Depends on when the domain was registered |
| No copyrighted images / video | ⚠️ | Audit Cloudinary uploads to confirm |
| No prohibited content | ✅ | Travel niche is safe |

The **❌ and ⚠️ items are why your application is likely stuck on "Getting ready" / "Requires review"**. Fix them in the order below.

---

## ❌ Critical: Cookie / GDPR consent banner (REQUIRED)

Google **denies AdSense applications** from sites that serve EU/UK visitors without a consent banner. Even if your traffic is mostly Indian, the reviewer's IP usually is EU/US, and they'll see a violation.

**Two ways to fix:**

### Option A — Use AdSense → Privacy & messaging (recommended)

Google retired the standalone `fundingchoices.google.com` site in 2023. The same tool is now built into AdSense itself, free and IAB-TCF-v2.2 certified.

1. Sign in to [adsense.google.com](https://adsense.google.com/) with the publisher account that owns `pub-8154901590978667`.
2. In the left sidebar, click **Privacy & messaging**. (If you don't see it, your account is too new — wait until it appears, usually within 24 h of submitting your site for review.)
3. Click **Manage** under **GDPR** → **Create message** → **Continue**.
4. Pick the regions: at minimum **EEA + UK + Switzerland** (you can also add **California (CCPA)** under the CCPA tab — same flow).
5. Customise the banner text, language(s), and brand colour. The default is fine for most sites.
6. Click **Publish**. AdSense automatically wires the message into the loader script you already have on the site — **no extra code is needed**. The banner will appear for any visitor whose IP is from a covered region, the next time they load a page.

To verify it's live: open your site in a private window using a VPN set to a UK/Germany IP. The consent banner should slide up within 1–2 seconds.

If **Privacy & messaging** is not yet visible in your AdSense menu (common for accounts still under initial review):
- AdSense usually adds it once the site moves to "Ready" / "Approved".
- Until then, fall back to **Option B** below so reviewers see *some* banner during their site visit (this can actually accelerate approval).

### Option B — Drop in a lightweight self-hosted banner

If you don't want Google's banner, I can ship a 60-line `js/cookie-consent.js` that:
- Shows a slide-up footer bar on first visit
- Has Accept / Reject / Customize buttons
- Stores choice in localStorage for 6 months
- Blocks AdSense + GA4 from loading until the user accepts

Tell me which you prefer and I'll wire it.

---

## ⚠️ Important: Add a real `/contact` page

Reviewers want a clear contact route. You have an e-mail in the footer, but a dedicated **/contact** page with multiple channels signals legitimacy. Mine should include:

- Business name, full postal address (registered office)
- Email address (`info@andamanvoyages.in`)
- Phone (`+91 88801 95191`)
- WhatsApp link (`wa.me/918880195191`)
- Embedded Google Maps pin
- Business hours
- A simple contact form (you already have email infra via inbox-mail Worker — could reuse it)

I can ship `contact.html` + a `/contact` route in 5 minutes if you want.

---

## ⚠️ Important: Add original blog / guide content

Google's #1 reason for rejecting travel sites is **"insufficient unique content"**. Package landing pages alone are usually not enough — they look like e-commerce listings to the reviewer.

**Add 4–6 long-form articles** (1,500+ words each). For a travel site, the easiest wins are:

| Article | Why it helps approval | Why it helps SEO |
|---|---|---|
| "Complete Andaman packing checklist for 2025" | Demonstrates expertise | Long-tail keyword |
| "Best time to visit Havelock vs Neil vs Port Blair" | Original analysis | Captures comparison searches |
| "Honeymoon vs family trip: Andaman itinerary differences" | Decision-stage content | High commercial intent |
| "Scuba diving in Andaman: PADI vs SSI, costs, which spots" | Niche expertise | High CPC keywords |
| "How to reach Andaman from Bengaluru/Delhi/Mumbai (flight + ferry)" | Practical guide | Captures location queries |
| "Cellular Jail: full visitor guide + history" | Cultural content | Adds 'authoritative travel writer' signal |

**Storage idea:** I can scaffold a `/blog/` directory with a Markdown-based publishing setup (works with GitHub Pages, no DB). Each post = one `.md` file → auto-rendered to `/blog/post-slug.html`. Want me to build it?

---

## ⚠️ Important: AdSense application metadata

In the AdSense console:

1. **Account → Account information**: ensure your name, postal address, and phone are accurate. The address must match the one on your `/about` and `/contact` pages.
2. **Sites → andamanvoyages.in → Status**: should be "Ready" (not "Requires review" or "Getting ready"). If you see "Requires review" with a link, click and follow the on-page instructions — usually re-submitting is enough.
3. **Payments → Verify your address**: Google sends a PIN by post to your registered address (~3 weeks). You can't be paid until this is verified, but you *can* be approved without it.

---

## ⚠️ Nice to have: Site speed & mobile UX

Reviewers run Lighthouse. Aim for:

| Metric | Target | Current (estimated) |
|---|---|---|
| Mobile Performance | ≥ 70 | Likely 60–75 |
| Mobile Accessibility | ≥ 90 | Likely 85+ |
| Mobile Best Practices | ≥ 90 | Likely 85+ |
| Mobile SEO | ≥ 90 | Likely 90+ |

If you score < 60 on mobile performance, fix:
- Hero images: serve as WebP (already done via Cloudinary `/f_auto/`)
- Font Awesome 6.4 from CDN: defer or `font-display: swap`
- Travelpayouts widget: load on user interaction (it's heavy)
- Live-chat widget: lazy-load after first paint

I can audit and fix any of these in 30 minutes — just ask.

---

## What to do RIGHT NOW (priority order)

1. **Open AdSense → Sites → andamanvoyages.in** and screenshot the exact status / message. Send it to me and I'll tell you what specifically Google wants next.
2. **Set up Funding Choices** (the cookie consent thing) — without it your application has a ~70% chance of being rejected outright.
3. **Add 3–4 blog posts** (you can use ChatGPT/Gemini to draft, then edit for accuracy). 1,500+ words each. Original photos from Cloudinary, not stock.
4. **Build a `/contact` page** with all channels (or ask me to ship one).
5. **Wait 1–14 days** after submitting. Don't keep re-submitting; that delays the review.

---

## After approval — quickest wins for revenue

Once you're approved:

1. **Turn on Auto-Ads** in AdSense → Ads → By site → andamanvoyages.in → ⚙ → toggle "Auto ads"
2. **Block low-CPC categories** — Ads → Brand safety → block "Get-rich-quick", "Sensational" etc.
3. **Add ONE manual unit on the homepage** below the package grid — gives 2–3× the CPM of auto-placed ads. Tell me where you want it and I'll inject the `<ins>` block.
4. **Enable Anchor Ads on mobile** — these alone often double mobile revenue.
5. **Set up GA4 → AdSense link** (Admin → Product links → AdSense links) to see ad revenue per page in GA4.

---

## TL;DR

You've done the **technical** AdSense setup right. What's missing is **content depth + a cookie banner**. Fix those two and the approval should come through within 2 weeks.

Tell me which of the action items you want me to do for you (build `/contact`, add cookie consent, scaffold blog, run Lighthouse audit) and I'll ship them next.