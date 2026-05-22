# SEO Setup &amp; Guide

This document captures the SEO improvements applied to `andamanvoyages.in` and gives you the next-step playbook for higher Google rankings.

---

## ✅ What's already in place

### Sitemap & robots
- `sitemap.xml` — auto-regenerated from `data/packages.json` so every package + every static page (gallery, about, privacy, terms) is included with today's `<lastmod>`. 13 URLs as of last build.
- `robots.txt` — explicitly allows Googlebot, Bingbot, AdSense bots, and disallows admin / dashboard / private user areas.

To regenerate the sitemap any time you add a package, run:
```bash
npm run seo
```
or it will run automatically on `npm run build`.

### Structured data (JSON-LD) on every page
- `index.html` — TravelAgency + LocalBusiness, WebSite + SiteSearchAction, FAQPage, BreadcrumbList
- `package.html` — TouristTrip + Offer + AggregateRating + Provider (per package, dynamically generated)
- `gallery.html` — ImageGallery + BreadcrumbList
- `terms.html`, `privacy.html`, `about.html` — proper meta tags + canonical

### Meta tags
- `<title>`, `<meta name="description">`, `<meta name="keywords">`
- Open Graph (Facebook/LinkedIn) — `og:type`, `og:title`, `og:description`, `og:image`, `og:url`, `og:locale`
- Twitter Cards — `summary_large_image` with proper image
- `<link rel="canonical">` on every page (no duplicate-content issues)
- `theme-color: #0d7a8a` for mobile browser chrome
- Mobile-friendly viewport on every page

### Visible FAQ section
- 8 carefully chosen questions matching the `FAQPage` JSON-LD on `index.html`
- Lets Google render FAQ rich-result snippets in SERP (huge SERP win — accordion of Q&As right on the search results page)

### Image SEO
- All `<img>` tags now have descriptive `alt` text
- Hero carousel and package images keep their context-rich captions
- WebP-friendly via Cloudinary `f_auto` for gallery images

### Analytics
- Google Analytics 4 wired (Measurement ID `G-B2EH7QRMGE`)
- Tracks `page_view`, `view_item`, `search`, `begin_checkout`, `purchase`, `payment_failed`
- Admin dashboard browsing is excluded so you don't pollute visitor stats

---

## 🚀 Next-step action items (you do these — high impact)

### 1. Submit your sitemap to Google &amp; Bing (1 min, do this NOW)
After deploying, tell Google and Bing the sitemap exists:

**Google Search Console**
1. Open https://search.google.com/search-console
2. Add `andamanvoyages.in` as a property if not already
3. Verify domain ownership (DNS TXT record or HTML file — you already have `googlea56f1cf68bec5877.html`)
4. **Sitemaps → Add a new sitemap → enter `sitemap.xml` → Submit**
5. Wait 24–48 hours for Google to start crawling

**Bing Webmaster Tools** *(optional but free)*
1. https://www.bing.com/webmasters
2. Sign in with the same Google account → "Import from Google Search Console"
3. Sitemap is auto-imported

### 2. Verify domain in Search Console gets you these tools
After verification you can:
- See exactly which queries bring traffic (e.g., "andaman package from chennai")
- Submit URLs for instant indexing
- Get alerts when Google de-indexes a page
- See which pages have schema rich snippet eligibility

### 3. Fill in `sameAs` on your TravelAgency schema
The `sameAs` array in `index.html` is empty. **Add your business profiles** here so Google knows they all belong to you:

```js
"sameAs": [
    "https://www.facebook.com/andamanvoyages",
    "https://www.instagram.com/andamanvoyages",
    "https://twitter.com/andamanvoyages",
    "https://www.linkedin.com/company/andamanvoyages",
    "https://www.youtube.com/@andamanvoyages",
    "https://g.co/kgs/your-business-id"   // your Google Business Profile
]
```

### 4. Set up a Google Business Profile (free, huge for "near me" searches)
1. https://business.google.com → Add business
2. Pick **Travel Agency** as the category
3. Verify by postcard (free, takes 5–7 days)
4. Add: photos (use the gallery!), opening hours, phone, services
5. Once verified, paste the profile URL into `sameAs` (Step 3)

This single thing **doubles or triples local search visibility** for India-based travel queries.

### 5. Get backlinks from credible sources
SEO impact ≈ 50% backlinks. Quick wins:
- **Tripadvisor** — claim your listing
- **MakeMyTrip / Yatra / Goibibo affiliate program** — get listed
- **Local newspapers** (Telegraph, Times of India) — reach out for travel features
- **Travel blogs** — pitch a guest post about Andaman tips

### 6. Speed up first paint (Core Web Vitals)
Google now ranks fast pages higher. To check yours:
- https://pagespeed.web.dev/?url=https://andamanvoyages.in/
- Aim for **green** scores on LCP, INP, CLS

Common fixes if you're slow:
- Compress beach1.jpg…neil6.jpg with [tinypng.com](https://tinypng.com) — usually 60% size reduction with no visible quality loss
- Convert hero JPGs to WebP
- Add `loading="lazy"` to images below the fold

---

## 📈 Bigger wins (medium effort, biggest ranking impact)

### Add a `/blog/` section with starter posts
A travel agency without a blog ranks 5x worse than one with even just 10 posts. Start with these high-search-volume topics:

| Article | Target keyword | Difficulty |
|---|---|---|
| "Best Time to Visit Andaman Islands (2026 Guide)" | best time visit andaman | Easy |
| "How to Reach Andaman Islands from [Mumbai/Delhi/Bangalore]" | how to reach andaman | Easy |
| "Andaman 7-Day Itinerary: A Complete Guide" | andaman 7 day itinerary | Medium |
| "Scuba Diving in Havelock — Costs, Operators, Tips" | scuba diving havelock | Easy |
| "Honeymoon in Andaman — A Couples' Bucket List" | honeymoon in andaman | Medium |
| "Cellular Jail Light & Sound Show — Timings &amp; Tickets" | cellular jail timings | Easy |
| "Andaman Islands Permits — Indian &amp; Foreign Nationals" | andaman permit foreigners | Easy |
| "What to Pack for an Andaman Trip" | andaman packing list | Easy |

Each post should be 1500+ words, have its own `<title>`, `<meta description>`, FAQ schema, and link to relevant package pages.

### Create per-destination landing pages
Long-tail searches convert better than generic ones:
- `/havelock-island-tour-package`
- `/neil-island-honeymoon-package`
- `/port-blair-sightseeing-tour`
- `/scuba-diving-andaman`
- `/ross-island-day-trip`
- `/baratang-limestone-caves-tour`

These can use `package.html` template + a unique `<h1>` and 600+ words of destination content.

### Encourage user reviews (right now `reviewCount` is set to "1247" — make it real)
- Email previous customers asking for a Google review
- Add review submission link inside booking confirmation emails
- Badge real reviews on `index.html` testimonials section
- Once you have 50+ real reviews, update the `aggregateRating` JSON-LD with the truth

---

## 🔍 How to check it's working

### Validate structured data
- https://search.google.com/test/rich-results?url=https://andamanvoyages.in/
- Should show: TravelAgency, LocalBusiness, WebSite, FAQPage, BreadcrumbList all valid
- Run also: `https://andamanvoyages.in/package.html?id=standard` (TouristTrip + Offer)
- Run: `https://andamanvoyages.in/gallery.html` (ImageGallery)

### Validate sitemap
- https://www.xml-sitemaps.com/validate-xml-sitemap.html
- Paste `https://andamanvoyages.in/sitemap.xml` → should validate

### Check Open Graph / Twitter previews
- https://www.opengraph.xyz/url/https%3A%2F%2Fandamanvoyages.in
- https://cards-dev.twitter.com/validator (Twitter Card validator)

### Track ranking
Once Search Console is set up, you'll see (in 1–2 weeks):
- **Impressions** — how often your pages show up in Google
- **Clicks** — how often people click through
- **CTR** — click-through rate (improve titles/descriptions if low)
- **Average position** — where you rank for each query

Aim for: positions 1–10 within 3 months for "andaman tour package", "andaman honeymoon", etc.

---

## 📁 Files involved

| File | Role |
|---|---|
| `scripts/seo-build.js` | **NEW** — auto-regenerates sitemap.xml from data/packages.json |
| `package.json` | Added `npm run seo` and chained into `npm run build` |
| `sitemap.xml` | Auto-generated; 13 URLs (was 5); fresh `lastmod` |
| `robots.txt` | Already good — explicitly allows search bots, blocks admin |
| `index.html` | Added: LocalBusiness, WebSite/SiteSearch, FAQPage (with visible content), BreadcrumbList JSON-LD |
| `gallery.html` | Added: ImageGallery + BreadcrumbList JSON-LD |
| All HTML pages | Logo `<img>` now has descriptive `alt` text |

---

## ⚡ Quick wins you can do in 5 minutes

1. **Submit sitemap** to Google Search Console (link above)
2. **Add a Google Business Profile**
3. **Run [PageSpeed Insights](https://pagespeed.web.dev)** on your homepage and fix the top 3 warnings
4. **Compress your hero images** at [tinypng.com](https://tinypng.com) and re-upload
5. **Fill in `sameAs`** with your real social media URLs

Do these 5 things this week and you'll see ranking improvements within 30 days.