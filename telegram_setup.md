# Telegram Bridge — Setup Guide

This bridges the website's **custom live-chat** (the orange-red "LIVE" bubble
on every public page) with **your Telegram**, via a Cloudflare Worker that
talks to the Telegram Bot API.

When a customer types a message in the chat:
1. The text is written to Firestore (`/chats/{sessionId}/messages`) — same
   as before, so your **Dashboard → Live Chats** panel keeps working.
2. `js/chat.js` and `js/live-chat.js` *also* POST a small notification to
   the **`telegram-bridge`** Worker's `/notify` endpoint.
3. The Worker reads `/settings/site` to find your `telegramBridgeChatId`,
   then sends a digest message to your Telegram via `sendMessage`.
4. You reply in your Telegram chat with the bot.
5. Telegram delivers the reply to the Worker's `/webhook` endpoint.
6. The Worker writes the reply into `/chats/{sessionId}/messages` with
   `role: 'admin'`.
7. The customer's open browser tab is subscribed to that path via Firestore
   `onSnapshot`, so your reply appears in their bubble within ~1 second —
   exactly like a dashboard reply.

The bridge is a **notification add-on**, not a replacement: the Firestore
write (step 1) is what powers the dashboard, so even if the bridge is off
or broken, the dashboard side keeps working.

---

## 1. Create a Telegram bot

1. Open Telegram, search for **@BotFather**, hit `/start`.
2. Send `/newbot`, follow the prompts:
   - **Name** — e.g. *Bharat Tourism Support*
   - **Username** — must end in `bot`, e.g. `BharatTourismBot`
3. BotFather replies with a **token** that looks like
   `1234567890:ABCdef-GhijKlMnoPqrStuvWxyz`. **Save it** — that's your
   `TELEGRAM_BOT_TOKEN`.
4. (Optional) `/setdescription`, `/setuserpic`, `/setcommands`:
   ```
   chatid - Show your chat-id
   help - Show available commands
   ```

## 2. Pick a webhook secret

Pick any random string (≥ 16 chars, alphanumeric + `_-`). The Worker
will check it on every incoming webhook to make sure the request really
came from Telegram. Example:

```
sk_telegram_a1b2c3d4e5f6g7h8
```

You'll save this as both:
- A Cloudflare Worker secret (so the Worker can verify it).
- The `secret_token` parameter when registering the webhook with Telegram.

## 3. Deploy the Worker

```bash
cd workers/telegram-bridge
npm install
npx wrangler login           # one-time
npx wrangler secret put TELEGRAM_BOT_TOKEN
# paste: 1234567890:ABCdef-GhijKlMnoPqrStuvWxyz
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
# paste: sk_telegram_a1b2c3d4e5f6g7h8
printf %s "$(cat ~/Downloads/andaman-b886d-firebase-adminsdk-*.json)" \
    | npx wrangler secret put FIREBASE_SERVICE_ACCOUNT_KEY
npx wrangler deploy
```

Wrangler will print the deployed URL — something like
`https://telegram-bridge.<your-account>.workers.dev`. Copy it.

> The `FIREBASE_SERVICE_ACCOUNT_KEY` secret is the **same** JSON used by the
> other backend Workers (`ai-assistant`, `whatsapp-bridge`, `email-router`).
> If you've already set it up for one Worker, just re-paste the same JSON.

### Verify the deploy

Visit `https://telegram-bridge.<account>.workers.dev/health` — you should
see:
```json
{
    "ok": true,
    "service": "telegram-bridge",
    "hasBotToken": true,
    "hasWebhookSecret": true,
    "hasServiceAccount": true,
    "projectId": "andaman-b886d"
}
```

If any of `hasBotToken` / `hasWebhookSecret` / `hasServiceAccount` is
`false`, re-run the corresponding `wrangler secret put`.

## 4. Register the webhook with Telegram

The Worker has a convenience helper for this — just visit (in any browser):

```
https://telegram-bridge.<account>.workers.dev/set-webhook
```

You should see:
```json
{
  "ok": true,
  "registeredUrl": "https://telegram-bridge.<account>.workers.dev/webhook",
  "usedSecretHeader": true,
  "telegram": { "ok": true, "result": true, "description": "Webhook was set" }
}
```

If `usedSecretHeader` is `false`, the `TELEGRAM_WEBHOOK_SECRET` env wasn't
set — fix step 3 and re-visit `/set-webhook`.

## 5. Get your Telegram chat-id

The bot can't message you until you message it first (Telegram rule).

1. In Telegram, open your bot — search for `@BharatTourismBot` (or whatever
   username you picked).
2. Hit **Start** (sends `/start` to the bot).
3. The bot replies with something like:
   ```
   🟢 Bharat Transport & Tourism — Telegram bridge is connected.
   Your Telegram chat-id is: 123456789
   ```
4. Copy that number — that's your `telegramBridgeChatId`.

(If you ever forget, send `/chatid` to the bot — it echoes the id back.)

## 6. Wire it up in the Dashboard

1. Sign in to the admin dashboard.
2. Go to **Settings → Chat Widget**.
3. Make sure **Provider** is set to **Custom live-chat**. The Brevo and
   "None" providers don't fire the bridge.
4. Scroll to **Forward chats to Telegram** and toggle it **ON**.
5. Fill in:
   - **Telegram bridge Worker URL**: `https://telegram-bridge.<account>.workers.dev`
   - **Your Telegram chat-id**: the number from step 5 (e.g. `123456789`)
   - **Bot username** *(optional)*: e.g. `BharatTourismBot` — used for the
     "Open bot in Telegram" shortcut on this same page
6. Click **Save Chat Widget**.

The save-handler validates that the URL + chat-id are filled when the toggle
is on and surfaces a friendly error if either is missing.

## 7. Smoke-test it

1. Open the public site in an **incognito** window (so you're acting as a
   visitor, not the admin).
2. Click the orange-red **LIVE** chat bubble (or the legacy AI Guide bubble
   on Brevo-disabled pages — both fire the bridge).
3. Type a message and hit Send.
4. Within ~2 seconds you should see a digest message in your Telegram bot
   chat:
   ```
   💬 New chat from a website visitor

   "Hi, do you have a Honeymoon package for December?"

   ↩ Reply to this message and it will go straight to the customer.
   session: kk1qm9z3-ab2c34d5
   ```
5. Reply to that message in Telegram (just type — no command needed).
6. Switch back to the incognito window. The reply should appear inside the
   chat bubble within ~1 second, prefixed with **Andaman Voyages Team**.

If steps 4–6 work, you're done. 🎉

---

## Bot commands (quick reference)

Type these in the bot chat any time:

| Command | What it does |
|---------|--------------|
| `/start` | Shows the welcome message + your chat-id. |
| `/chatid` | Echoes your chat-id (in case you've forgotten it). |
| `/help` | Shows the command list. |
| `/reply <sessionId> <text>` | Send a reply targeting a specific session. Useful when you have several active customers and want to make sure your reply goes to the right one. |
| *anything else* | Routes to the **most-recent active session** (last customer who messaged you). |

The Worker also auto-detects session-id from the **quoted/reply-to**
message — so just hit "Reply" on any digest message in Telegram and your
text goes back to that exact customer, even if a newer message came in
from someone else in the meantime.

---

## Troubleshooting

### `bridge disabled in /settings/site`
You toggled the bridge off in **Dashboard → Settings → Chat Widget**, or
you haven't saved settings yet. Toggle it on, click **Save**, retry.

### `telegramBridgeChatId not configured in /settings/site`
You enabled the toggle but didn't fill in the chat-id. Send `/chatid` to
your bot and paste the number into Settings.

### `bad secret` (401 from `/webhook`)
Telegram is forwarding the wrong secret token. Run the Worker's
`/set-webhook` helper again — it re-registers the webhook with the secret
currently stored as a Worker secret, so the two stay in sync.

### Customer message arrives but no Telegram digest
1. Check `/health` — `hasBotToken` and `hasServiceAccount` must both be `true`.
2. Check `/settings/site` in Firestore — `telegramBridgeEnabled` must be
   `true` and `telegramBridgeChatId` must be a non-empty number.
3. Tail the Worker logs:
   ```bash
   cd workers/telegram-bridge
   npx wrangler tail
   ```
   Then send a chat message from the site and look for `[telegram-bridge]`
   lines. Common issues are wrong chat-id (Telegram returns
   `chat not found`) or the bot was deleted.

### Admin reply arrives in Telegram but not in the customer's browser
1. Check the Worker `wrangler tail` output — you should see a
   `[telegram-bridge] routed admin reply to session …` line for every reply.
2. Check Firestore `/chats/{sessionId}/messages` — there should be a
   document with `role: "admin"` and your reply text. If yes, the issue is
   client-side (the customer closed their tab — replies still arrive when
   they reopen, since `onSnapshot` replays history).
3. If the document **isn't** in Firestore, either the service account JSON
   is stale (rotate it in IAM and re-`wrangler secret put`) or the
   webhook secret mismatches (re-run `/set-webhook`).

### `/reply <sessionId>` doesn't work
The session-id format is the URL-safe one we use in `/chats/{sessionId}/...`
— typically `<base36-timestamp>-<10-char-random>`, e.g.
`kk1qm9z3-ab2c34d5`. You can copy it directly from any digest message (the
Worker prints it as `session: <id>` in the digest body).

---

## Architecture notes

- **`workers/telegram-bridge/worker.js`** — request router (`/notify`,
  `/webhook`, `/set-webhook`, `/health`).
- **`workers/telegram-bridge/firestore.js`** — minimal Firestore REST
  client (OAuth2 via service-account JWT). Mirrors the helper used by the
  WhatsApp bridge.
- **`js/chat.js`** + **`js/live-chat.js`** — call `notifyTelegramBridge()`
  in parallel with `notifyWhatsAppBridge()`. Both run side-by-side, both
  fire-and-forget.
- **`/settings/site.telegramBridge*`** — admin-toggleable config, read by
  both the JS clients (to decide whether to fire `/notify`) and by the
  Worker itself (to look up the admin chat-id when sending the digest).

### Data flow at a glance

```
Customer browser              Cloudflare Worker             Firestore               Telegram (you)
─────────────────             ─────────────────             ─────────               ─────────────
chat.js / live-chat.js
  ├─ writeMessage() ─────────────────────────────────► /chats/.../messages
  │                                                       │
  │                                                       └─► onSnapshot ◄── dashboard-chats.js
  │
  └─ POST /notify ────────► handleNotify()
                              ├─ getDoc(/settings/site)
                              ├─ getDoc(/chats/{sid})  ◄── (customer name/email)
                              └─ tgSendMessage() ────────────────────────────────────► 💬 digest

                                                                                       ↓ admin types reply
                            POST /webhook ◄────────────────────────────────────────────┘
                              ├─ verify secret
                              ├─ extract sessionId (or /reply <sid>)
                              ├─ addDoc(/chats/.../messages, role: 'admin') ──► Firestore
                              │                                                    │
                              │                                                    └─► onSnapshot
                              └─ tgSendMessage('✅ Sent to customer.')                    ↓
                                                                                customer sees reply
```

### Why two bridges (WhatsApp **and** Telegram)?

Different admins have different preferences. WhatsApp is the dominant
chat app in India but requires a Meta Business account, app review and
phone-number verification — a one-day setup at minimum. Telegram is
free, instant (BotFather → bot in 30 seconds), and works globally. By
shipping both bridges side-by-side and toggling them independently in
Settings, you can:

- Run **only WhatsApp** when you want the customer's reply to land in
  the same app they already chat with friends in.
- Run **only Telegram** when you don't have / don't want a Meta dev
  account, or while WhatsApp's review queue is processing your number.
- Run **both** for redundancy — if one bridge breaks, the other keeps
  forwarding messages.
- Run **neither** — the dashboard's Live Chats panel still works fine,
  the bridges are a *push* notification layer on top of the same
  Firestore data.

The Firestore write is the source of truth; the bridges are just
real-time push notifications.

---

## Updating the bot token / rotating secrets

If your bot token leaks (e.g. accidentally committed to git), revoke it
immediately:

1. In Telegram, `/start` BotFather, send `/revoke`, pick the bot.
   BotFather issues a new token.
2. ```bash
   cd workers/telegram-bridge
   npx wrangler secret put TELEGRAM_BOT_TOKEN   # paste the new token
   npx wrangler deploy                          # picks up the new secret
   ```
3. Re-register the webhook so the new token's bot starts receiving updates:
   visit `https://telegram-bridge.<account>.workers.dev/set-webhook`.

The old token is dead the moment BotFather issues the new one — no
manual cleanup needed.

For the webhook secret, just regenerate (`openssl rand -hex 16`),
`wrangler secret put TELEGRAM_WEBHOOK_SECRET`, then re-visit `/set-webhook`.

---

## Cost

Telegram Bot API is **free**, no quota, no rate cards. The Cloudflare
Worker is on the free tier (100 K requests / day shared across all your
Workers). A typical chat session uses 2–4 Worker requests so you'd need
~25 K active chat sessions per day to hit the limit — at which point
you'd want a paid plan anyway.

The only ongoing cost is the Firestore reads/writes for `/chats/...`,
which the dashboard's Live Chats panel already pays for whether the
bridge is on or not.
