# Admin Inbox — Setup Guide (Phase 1: outbound email)

## What you get
A new **"Inbox"** tab in `/dashboard` (admin-only). For now it lets you:

- Click **Compose** → write an email → it's sent **as `booking@andamanvoyages.in`** through Brevo's transactional API.
- See a "Sent" history table of everything the dashboard has sent (last 50 by `createdAt`).

Inbound replies + Brevo Conversations chats land here in Phase 2.

## Architecture

```
Admin in /dashboard "Inbox" tab
   │ click "Compose", fill form, click Send
   ▼
js/inbox.js  ──── POST /send  ────►  workers/inbox-mail/  (Cloudflare Worker)
                  + Authorization: Bearer <Firebase ID token>
                                                │ verifies the JWT against
                                                │ Google's JWKs and checks
                                                │ the email is in ADMIN_EMAILS
                                                ▼
                                       Brevo /v3/smtp/email
                                       (api-key from Worker secret)
                                                │
                                                ▼
                                     Customer's inbox
```

Why a Worker?
- Brevo's API key is too privileged to expose in browser JS — anyone opening DevTools could send emails through your account.
- Brevo's API doesn't allow CORS from arbitrary origins.

## One-time setup (10 min)

### 1. Create the Brevo sender + API key
1. Go to <https://app.brevo.com/senders/list> → **Add a sender** → email = `booking@andamanvoyages.in`. Brevo will email you a verification link — click it.
2. Go to <https://app.brevo.com/security/api-keys> → **Generate a new API key** → name it `inbox-mail-prod` → tick the **Send transactional emails** scope → **Generate**. Copy the key (starts with `xkeysib-…`).

### 2. Deploy the Worker
```bash
cd workers/inbox-mail
npm install                       # installs wrangler
npx wrangler login                # browser pops up, authorise once
npx wrangler secret put BREVO_API_KEY   # paste the xkeysib-… key
npx wrangler deploy
```

The deploy output prints the URL, e.g.:
```
Published inbox-mail (1.23 sec)
  https://inbox-mail.<your-account>.workers.dev
```

Copy that URL.

### 3. Wire it into the dashboard
Open `dashboard.html` and find the line:
```html
<script>
    window.INBOX_WORKER_URL = 'https://inbox-mail.pittu-das2.workers.dev';
</script>
```
Replace it with the URL from step 2. Commit + push.

### 4. Update Firestore rules
The repo's `firestore.rules` already has the new `/sentEmails` block. Open Firebase Console → Firestore → Rules → paste the contents of `firestore.rules` → **Publish**.

### 5. (Optional) Tweak ALLOWED_ORIGIN / FROM_NAME
Edit `workers/inbox-mail/wrangler.jsonc` — these are plain-text vars (no secrets):
- `ALLOWED_ORIGIN` — comma-separated list. Add `http://localhost:8000` for local dev.
- `ADMIN_EMAILS` — every admin who's allowed to send.
- `FROM_EMAIL` / `FROM_NAME` — visible sender (must match a verified Brevo sender).

After editing, redeploy: `npx wrangler deploy`.

## How to use

1. Sign in to `/dashboard` as admin.
2. Click **Inbox** in the top nav.
3. Click **Compose**:
   - **To** — customer's email
   - **Subject**
   - **Reply-To** (optional) — defaults to `booking@andamanvoyages.in`
   - **Message** — plain text; line-breaks become `<br>`, blank lines start a new paragraph
4. Click **Send**. You'll see a green Toast on success and the email appears in the **Sent** table.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| "INBOX_WORKER_URL not configured" | Step 3 missing | Paste the Worker URL into `dashboard.html` |
| 401 "Auth failed" | ID token didn't verify | Check Firebase Console → Project ID matches `wrangler.jsonc → FIREBASE_PROJECT_ID` |
| 403 "Not an admin" | Your email isn't in the allowlist | Add it to `ADMIN_EMAILS` in `wrangler.jsonc`, redeploy |
| 500 "BREVO_API_KEY secret not configured" | Step 2 — secret put missed | `npx wrangler secret put BREVO_API_KEY` |
| 502 "Brevo rejected: 401" | API key wrong or revoked | Generate a new key, re-run `wrangler secret put` |
| 502 "Brevo rejected: 400 sender_not_valid" | `booking@andamanvoyages.in` not verified | Verify in Brevo → Senders & IP |
| Nothing happens, console shows CORS error | Origin not in allow-list | Add to `ALLOWED_ORIGIN`, redeploy |

`npx wrangler tail` (run from `workers/inbox-mail`) streams real-time Worker logs.

## What's next (Phase 2)

- **Inbound email** — Brevo Inbound Parse webhook → Worker writes to Firestore `/inboundEmails/{threadId}/messages/{msgId}` → Inbox UI shows threads with reply.
- **Brevo Conversations chats** — webhook → same threaded UI.
- **Per-thread reply** — pre-fills To/Subject from the inbound message.

When you're ready for Phase 2, we'll add a `/webhook/incoming` route to the same Worker.