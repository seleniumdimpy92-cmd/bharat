# AI Assistant — Setup Guide

A Cloudflare Worker that adds **Google Gemini 1.5 Flash** to the admin dashboard:

1. **Email summarisation** — every opened email in the admin Inbox shows a one-line AI summary, intent (enquiry / booking / cancellation / complaint / payment_query / itinerary_change / other), urgency (low / normal / high) and tags.
2. **Suggest reply** — a "✨ Suggest reply" button on every opened email asks Gemini to draft a polite, on-brand response. Drops it straight into the existing Compose modal so you review → edit → send.
3. **Daily executive report** — a cron-triggered email at **08:00 IST** every day (and an on-demand "Generate now" button on Overview) that pulls the last-24-h bookings + emails from Firestore and asks Gemini for a 5-bullet summary + 3 action items.

## Cost

**₹0/month** for any reasonable volume:
- Gemini 1.5 Flash free tier — **1,500 requests/day, 15 RPM**, no credit card.
- Cloudflare Workers free plan — 100,000 requests/day + 1,000 cron invocations/day.
- Brevo (email sending) — already wired up for the existing inbox-mail Worker.

At 50–200 emails/day, you'll use about **5 % of the Gemini free quota**.

---

## What you'll need

| Item | Where to get it | How long |
|---|---|---|
| Google AI Studio API key | https://aistudio.google.com/apikey (sign in with any Google account) | 30 sec |
| Cloudflare account + Wrangler CLI | Already set up — same one used for `inbox-mail`, `refund`, `email-router` | already done |
| Brevo API key | Already set up — reuse the same `BREVO_API_KEY` from `inbox-mail` | already done |
| Firebase service-account JSON | Already used by `email-router` — reuse | already done |

---

## Step 1 — Get a Gemini API key (30 seconds, free)

1. Open https://aistudio.google.com/apikey in any browser.
2. Sign in with any Google account.
3. Click **"Create API key"** → **"Create API key in new project"** (or pick an existing GCP project).
4. Copy the key (starts with `AIza…`). **You'll paste this into the Worker as a secret in Step 3.**

> ⚠️ **Never commit this key to git** — Worker secrets are the only place it should live. The CORS allow-list + admin-email gate also keep it from leaking out of the Worker, but the secret-vs-source-code separation is your hard guarantee.

---

## Step 2 — Install + configure the Worker

```bash
cd workers/ai-assistant
npm install
```

Open `wrangler.jsonc` and review the `vars` block. The defaults match your existing Workers:

```jsonc
"vars": {
    "ALLOWED_ORIGIN":      "https://andamanvoyages.in,http://localhost:8000",
    "ADMIN_EMAILS":        "deb@andamanvoyages.in,admin@admin.com,...",
    "FIREBASE_PROJECT_ID": "andaman-b886d",
    "REPORT_TO_EMAIL":     "deb@andamanvoyages.in",
    "REPORT_FROM_EMAIL":   "info@andamanvoyages.in",
    "REPORT_FROM_NAME":    "Andaman Voyages — Daily AI Report",
    "GEMINI_MODEL":        "gemini-1.5-flash"
}
```

Adjust `REPORT_TO_EMAIL` if you want the daily report to go somewhere other than `deb@andamanvoyages.in`.

The cron schedule is at the top of `wrangler.jsonc`:

```jsonc
"triggers": { "crons": ["30 2 * * *"] }
```

That's **02:30 UTC = 08:00 IST**. Tweak if you'd rather receive the report at a different local time. Standard 5-field cron syntax: `minute hour day-of-month month day-of-week`.

---

## Step 3 — Set the three secrets

```bash
cd workers/ai-assistant

# Gemini key from Step 1
npx wrangler secret put GEMINI_API_KEY
# → paste the AIza… key

# Brevo key — reuse the same one already used by inbox-mail
# Get it from Cloudflare → Workers → inbox-mail → Settings → Variables → BREVO_API_KEY
# OR generate a fresh one at https://app.brevo.com/security/api
npx wrangler secret put BREVO_API_KEY
# → paste the xkeysib-… key

# Firebase service-account JSON — reuse the same JSON used by email-router
# (Firebase Console → Project settings → Service accounts → Generate new private key)
printf %s '<paste full JSON one line>' | npx wrangler secret put FIREBASE_SERVICE_ACCOUNT_KEY
```

> 💡 **Tip**: if you don't have the service-account JSON handy, generate a fresh one — it doesn't break the existing `email-router` Worker. Each Worker has its own copy of the secret.

---

## Step 4 — Deploy

```bash
cd workers/ai-assistant
npx wrangler login    # only if you haven't already
npx wrangler deploy
```

Wrangler prints the deployed URL at the end — looks like:

```
Published ai-assistant (1.23 sec)
   https://ai-assistant.<your-subdomain>.workers.dev
```

**Copy that URL.**

---

## Step 5 — Wire it into the dashboard

Open `dashboard.html` and find this line near the bottom of the `<head>` block:

```js
window.AI_ASSISTANT_WORKER_URL = '';
```

Paste your deployed URL between the quotes:

```js
window.AI_ASSISTANT_WORKER_URL = 'https://ai-assistant.<your-subdomain>.workers.dev';
```

Commit + push. GitHub Pages will redeploy automatically.

That's it — **the admin dashboard now has AI features**.

---

## Step 6 — Test it

1. **Health check** (no auth needed):
   ```
   curl https://ai-assistant.<your-subdomain>.workers.dev/
   # → {"ok":true,"service":"ai-assistant","model":"gemini-1.5-flash"}
   ```

2. **Inbox AI**:
   - Sign in to `/dashboard` as an admin email listed in `ADMIN_EMAILS`.
   - Open the **Inbox** tab. Click any email row.
   - Within ~2 seconds you should see a coloured **AI summary panel** above the email body (intent + urgency + tags + 1-line summary).
   - Click **✨ Suggest reply** in the action toolbar — the Compose modal opens pre-filled with a polite draft. Edit and send.

3. **Daily report** (on-demand):
   - Open the **Overview** tab.
   - The new **AI Daily Report** card sits just below the stat cards.
   - Click **Generate now** — Gemini returns a 5-bullet executive summary in ~3-5 seconds.

4. **Daily report (cron)** — wait until 08:00 IST tomorrow morning. The email will land in `REPORT_TO_EMAIL` from `REPORT_FROM_EMAIL`.

   Want to test the cron immediately without waiting? Trigger it via the Cloudflare dashboard:
   - Cloudflare → Workers & Pages → `ai-assistant` → **Triggers** → **Cron Triggers** → click your `30 2 * * *` row → **Trigger now**.
   - Or run `npx wrangler tail` in `workers/ai-assistant/` and watch live logs.

---

## How it works (architecture)

```
┌─────────────────────────────┐
│  dashboard.html (admin UI)  │
│  + js/ai-assistant.js       │
└──────────────┬──────────────┘
               │ Authorization: Bearer <Firebase ID token>
               ▼
┌──────────────────────────────────────────┐
│      ai-assistant Cloudflare Worker      │
│  ┌────────────────────────────────────┐  │
│  │  /summarize    /draft-reply        │  │
│  │  /daily-report (HTTP + cron)       │  │
│  └─────────┬───────────┬──────────────┘  │
└────────────┼───────────┼─────────────────┘
             ▼           ▼
   ┌────────────────┐  ┌─────────────────┐
   │  Gemini 1.5    │  │  Firestore REST │ (bookings + receivedEmails)
   │  Flash (free)  │  │  + service acct │
   └────────────────┘  └─────────────────┘
                              │
                              ▼  (daily report only)
                       ┌──────────────┐
                       │  Brevo SMTP  │
                       └──────────────┘
                              │
                              ▼
                    📧 deb@andamanvoyages.in
```

- **Auth.** Every admin call is gated by Firebase ID-token verification — same JWT/JWKS verification pattern used by `workers/refund/`. Anonymous calls return 401.
- **CORS.** Browser-origin check (`ALLOWED_ORIGIN`) prevents random websites from burning your Gemini quota.
- **Caching.** The frontend (`js/ai-assistant.js`) caches summaries per email-id in `sessionStorage`, so re-opening the same email doesn't re-call Gemini.

---

## Customising the AI

### 1. Change the assistant's tone

Edit the prompts in `workers/ai-assistant/worker.js`. Look for `handleDraftReply()` — the system prompt is in there. Tweak phrases like "Indian English", "never salesy", and the sign-off. Redeploy with `npx wrangler deploy`.

### 2. Add booking context to draft replies

`js/ai-assistant.js` → `suggestReply()` already supports a `bookingContext` field. Right now we don't pass one, but you can wire it up in the inbox preview by stashing the matched booking record on `email.bookingContext` (e.g. when the customer's email matches a known booking). The Worker auto-includes it in the Gemini prompt.

### 3. Switch to a smarter (paid) model

In `wrangler.jsonc`:

```jsonc
"vars": { "GEMINI_MODEL": "gemini-1.5-pro" }
```

Run `npx wrangler deploy`. Gemini Pro is ~10× more expensive than Flash but has a free tier of 50 req/day too — fine for the daily report alone, but you'll burn through it fast on per-email summaries.

### 4. Move the cron to a different time

`wrangler.jsonc` → `triggers.crons`. Use [crontab.guru](https://crontab.guru) to compute. Remember the cron is in **UTC**, so subtract 5 h 30 min from the IST time you want.

### 5. Stop the daily emails (keep the in-dashboard "Generate now")

Remove the `triggers` block from `wrangler.jsonc` and redeploy. The HTTP `/daily-report` endpoint still works for the on-demand button.

---

## Troubleshooting

### "AI_ASSISTANT_WORKER_URL not configured"
You forgot Step 5. Paste the deployed Worker URL into `dashboard.html`.

### "GEMINI_API_KEY secret not set"
You forgot the secret in Step 3. Re-run:
```bash
cd workers/ai-assistant
npx wrangler secret put GEMINI_API_KEY
```

### "Auth failed: Token expired"
Your dashboard tab has been open more than an hour. Hit Cmd-Shift-R to refresh — Firebase Auth will mint a fresh token automatically.

### "Not an admin: …"
The email signed in to the dashboard isn't in `ADMIN_EMAILS` (in `wrangler.jsonc`). Add it and redeploy:
```bash
cd workers/ai-assistant
# edit wrangler.jsonc → vars.ADMIN_EMAILS
npx wrangler deploy
```

### Daily report email never arrives
1. Check Cloudflare → `ai-assistant` → **Logs** for cron-trigger errors.
2. Verify `BREVO_API_KEY` is set as a Worker secret (not just in `.env`).
3. Verify `REPORT_FROM_EMAIL` is a **verified sender** in your Brevo account (Brevo → Senders & IP → Senders). Brevo silently drops mails from unverified senders.
4. Manually trigger via the dashboard's "Generate now" button — that uses HTTP, not cron, so any error surfaces immediately in the toast.

### Gemini returns "RESOURCE_EXHAUSTED" / 429
You hit the 15 req/min rate limit (or 1,500/day). The free tier resets every minute / day. If you genuinely need more, enable billing on your Google AI Studio project — pricing then drops to $0.075 input / $0.30 output per 1K tokens, which is still <$2/month at our volume.

### "AI summary panel" never appears in the inbox
1. Open the browser console — look for `[AI] summarize failed:` warnings.
2. Verify the Worker URL is set correctly in `dashboard.html` → `window.AI_ASSISTANT_WORKER_URL`.
3. Verify you're signed in as an admin (the `ADMIN_EMAILS` gate also applies to the front-end fetches).

### "Suggest reply" button never appears
The button is injected by a `MutationObserver` on `#inboxPreview`. If your build of `js/inbox.js` mutates the preview wrap differently from what we expect, the observer may not fire. Open the console and run:
```js
document.querySelector('#inboxPreview .ipv-actions')   // should be non-null after opening any email
window.AIAssistant.isConfigured()                       // → true
```

---

## Files in this feature

| File | Purpose |
|---|---|
| `workers/ai-assistant/wrangler.jsonc` | Worker config + cron + env vars |
| `workers/ai-assistant/worker.js` | HTTP entry + cron entry + business logic |
| `workers/ai-assistant/auth.js` | Firebase ID-token verification + admin gate |
| `workers/ai-assistant/gemini.js` | Google Gemini REST helper |
| `workers/ai-assistant/firestore.js` | Service-account OAuth + Firestore REST query |
| `workers/ai-assistant/brevo.js` | Transactional email send |
| `workers/ai-assistant/package.json` | Wrangler dependency |
| `workers/ai-assistant/.gitignore` | Hide `node_modules` + `.dev.vars` |
| `js/ai-assistant.js` | Front-end client (Inbox UI hooks + Overview report panel) |
| `dashboard.html` | Adds `<script src="js/ai-assistant.js">` + `window.AI_ASSISTANT_WORKER_URL` |

---

## Privacy

- **Email content is sent to Google Gemini** for summarisation and reply drafting. Google's API ToS state that **AI Studio free-tier requests CAN be used to improve their products**. If you process highly sensitive customer data, consider:
  - Enabling Vertex AI billing (paid tier) — Google guarantees data isn't used for training.
  - Or switching to **Cloudflare Workers AI** (Llama 3.1 — also free, runs inside Cloudflare's edge, never leaves CF).
- **No customer data is stored anywhere new** — the AI Worker is stateless. It reads from Firestore (already your data store) and writes nothing back. Daily-report emails go via Brevo (already your email provider).
- **Admin-only.** Even if a customer somehow knew the Worker URL, every endpoint requires an admin Firebase ID token. Anonymous fetches return 401.
