# Flight Search & Real-Time Prices — Setup Guide

The site has a fully-working flight-search section on the **homepage** (`/#flights`) and a dedicated **flights page** (`/flights.html`). Out of the box it shows realistic **estimated prices** based on average seasonal fares — no API key required.

To switch to **live real-time prices** from real airlines, configure one of the following providers in your Netlify environment variables. The architecture is provider-agnostic: the frontend never changes, only the env vars.

---

## Architecture

```
                                   ┌─────────────────────────────────────┐
  Browser  ─ /flights.html ──────► │  /.netlify/functions/flight-search  │
                                   │  ──────────────────────────────────  │
                                   │   1. trySkyscanner()  (RapidAPI)     │
                                   │   2. tryAmadeus()     (Self-Service) │
                                   │   3. buildEstimates() (always works) │
                                   └─────────────────────────────────────┘
                                                   │
                                                   ▼
                                       Same JSON shape for all
                                       providers → frontend renders.
```

The function tries providers in order and returns the first one that succeeds. If none have keys configured, it falls back to deterministic seasonal estimates clearly labeled **"Estimated"** in the UI.

---

## Option A — Skyscanner via RapidAPI ($10–$50/month)

**The official Skyscanner Flight Search API was retired in 2020.** What you can use today are RapidAPI marketplace endpoints that resell Skyscanner data:

### Steps

1. Go to **https://rapidapi.com** and sign up (free).
2. Search for one of these Skyscanner endpoints:
   - **Sky Scanner v3** by `apidojo` (most popular, ~$10/mo for 5,000 calls)
   - **Skyscanner50** (cheaper, lower quality)
   - **SkyScanner API** by `3b-data-3b-data-default`
3. Click **Subscribe to Test** → pick the free or basic tier.
4. On the API's "Endpoints" tab, copy:
   - The **`X-RapidAPI-Key`** value (long alphanumeric string).
   - The **`X-RapidAPI-Host`** value (e.g. `sky-scanner3.p.rapidapi.com`).
5. In the Netlify dashboard:
   - **Site settings** → **Build & deploy** → **Environment variables**
   - Add:
     - `SKYSCANNER_RAPIDAPI_KEY` = `<your key>`
     - `SKYSCANNER_RAPIDAPI_HOST` = `<host from step 4>`
6. Trigger a redeploy (Deploys → Trigger deploy → Deploy site).

### Limitations of RapidAPI Skyscanner

- Data is **scraped/cached**, not the official Skyscanner feed.
- Pricing accuracy is "best effort" — always verify on the partner site.
- Free tiers usually limit you to 50–500 calls/month.
- The endpoint URL/shape sometimes changes when the seller updates their proxy. If results stop working, check the API's docs page and update the URL in `netlify/functions/flight-search.js` (`trySkyscanner()` function).

### Why we don't use the "official" Skyscanner Travel API

Skyscanner's enterprise B2B Travel API:
- Requires a signed contract.
- Demands a $50k+/year minimum spend or proven booking volume.
- Is not realistic for a single travel agency.

If you grow large enough to qualify, contact `partners@skyscanner.net` and they'll guide you through a proper integration.

---

## Option B — Amadeus Self-Service API (RECOMMENDED — free 2,000 calls/month)

Amadeus is the world's largest GDS — IndiGo, Air India, Vistara, etc. all distribute fares through it. Their self-service API is **genuinely free for the first 2,000 calls/month**, then $0.0025–$0.01/call. No contract required.

### Steps

1. Go to **https://developers.amadeus.com** → **Register** (free, ~2 minutes).
2. Verify your email.
3. From the dashboard, click **My Apps** → **Create New App**.
4. Name it "Bharat Tours Flights" → save.
5. Copy:
   - **API Key**
   - **API Secret**
6. In Netlify env vars (same path as above), add:
   - `AMADEUS_API_KEY` = `<your key>`
   - `AMADEUS_API_SECRET` = `<your secret>`
7. Trigger a redeploy.

### Notes

- The free tier uses the `test.api.amadeus.com` endpoint (used by the function).
- Test environment returns slightly older cached fares (typically 24–48h delayed) — perfect for showing realistic prices but you should still link users to live booking partners for the final purchase.
- Once you outgrow 2,000 calls/month, switch the URL in `tryAmadeus()` to `api.amadeus.com` (production endpoint, paid tier).

---

## Provider priority

The function tries providers in this order:

1. **Skyscanner via RapidAPI** — if `SKYSCANNER_RAPIDAPI_KEY` is set.
2. **Amadeus** — if `AMADEUS_API_KEY` and `AMADEUS_API_SECRET` are set.
3. **Estimates** — always (last-resort fallback so the page never breaks).

You can have all 3 configured simultaneously; whichever responds first with valid data wins.

---

## Frontend behavior

- A **"Live"** green badge is shown above the flight list when prices come from Skyscanner or Amadeus.
- An **"Estimated"** orange badge is shown when prices fall back to the local estimate.
- Each flight card has 4 buttons: **MakeMyTrip / EaseMyTrip / Cleartrip / Skyscanner** — clicking any opens that partner's booking page in a new tab so the customer always sees and pays the live fare on a trusted booking site.

---

## Troubleshooting

### "No flights found" or "Could not load live flights"

1. Open DevTools → Network → look for `flight-search` request.
2. Check the JSON response — it includes `"source": "skyscanner" | "amadeus" | "estimate"`.
3. If `"estimate"`, your API keys aren't being read. In Netlify, check env vars are saved AND that you redeployed after adding them.
4. If `"skyscanner"` returns `"error": "..."` — usually rate limit or invalid host. Switch RapidAPI plan or update host.

### Real-time prices for Port Blair (IXZ) look weird

IXZ is a small airport. Both Skyscanner and Amadeus often return only 2–4 itineraries (sometimes 0 in the test env). The function handles this by falling through to estimates so users always see options.

### CORS / 403

Already handled — the function sends `Access-Control-Allow-Origin: *`. If you see CORS errors in DevTools, you're probably not hitting the Netlify function. Make sure you're loading the site through `https://andamanvoyages.in/` (not `localhost:8000` opened as a static file), or use `netlify dev` locally.

---

## Local development

```bash
npm install -g netlify-cli
netlify dev
```

This runs the static site + serverless functions locally at `http://localhost:8888`.
Set env vars in `.env` at the repo root:

```
SKYSCANNER_RAPIDAPI_KEY=...
SKYSCANNER_RAPIDAPI_HOST=sky-scanner3.p.rapidapi.com
AMADEUS_API_KEY=...
AMADEUS_API_SECRET=...
```

---

## Affiliate revenue

Even when the price displayed is from Skyscanner/Amadeus, the **booking still happens on the partner site** — so you earn affiliate commissions when users click through and book. Affiliate IDs are configured in `js/firebase-config.js` (`window.FLIGHT_AFFILIATES`).