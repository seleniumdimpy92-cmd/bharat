# WhatsApp Cloud API Bridge — Setup Guide

This is a step-by-step walkthrough for connecting your **custom live-chat** widget on `andamanvoyages.in` to your **WhatsApp Business** account, so:

1. Every customer chat message lands in your WhatsApp.
2. When you reply on WhatsApp, your reply pops back into the customer's open chat session in real-time.

It uses **Meta's free WhatsApp Cloud API** (1,000 service conversations/month free, then ~₹0.30/msg).

---

## 0 · What you'll need

| Thing | Why |
|---|---|
| A Facebook account | Meta Developer console + Business Manager are tied to FB |
| A **dedicated phone number** that is NOT currently registered with WhatsApp on a phone | Meta will register this number to the Cloud API; your normal WhatsApp keeps working |
| Cloudflare account with `wrangler` CLI installed | We'll deploy the bridge worker |
| 30 minutes | One-time clicking through Meta consoles |

> **Important on the dedicated number**: it must NOT be in use by either WhatsApp Personal or WhatsApp Business apps. Buy a fresh SIM if needed (any Jio/Airtel ₹100 plan works) — once it's connected to the Cloud API, you'll receive customer messages on **business.facebook.com** or via **WhatsApp Business app** (after explicit re-registration).

---

## 1 · Create a Meta App + WhatsApp Business Account

1. Go to <https://developers.facebook.com/apps> → **Create app**.
2. Pick **Business** as the type → name it e.g. "Andaman Voyages Bridge".
3. In the new app's left sidebar → **Add product** → **WhatsApp**.
4. Meta auto-creates a **Test phone number** for you. Take note of:
   - **Phone number ID** (numeric, ~15 digits)
   - **WhatsApp Business Account ID**
   - **Test recipient number** (your own phone — Meta requires you to verify it before you can DM yourself)
5. From the WhatsApp → **Getting Started** page, click **Generate token** → copy the **Permanent access token** (or System User Token if you want it to never expire).
6. From **App settings → Basic**, copy the **App Secret** (32-char hex).

Save these 3 values somewhere safe:

```
META_PHONE_NUMBER_ID = 100000000000000
META_ACCESS_TOKEN    = EAAxxxxxxxxxxxxx…
META_APP_SECRET      = a1b2c3d4e5f6…
```

---

## 2 · Verify YOUR own number as a recipient

(Required only while the app is in "Test" mode — you can DM unlimited people once the app is upgraded to "Production".)

1. WhatsApp → **API Setup** → **From** = your test number, **To** = your personal phone.
2. Click **Send message**. You should receive `Hello, World!` on WhatsApp within 5 seconds.

If this works, the API is wired correctly.

---

## 3 · Deploy the bridge Worker (this repo)

The worker lives at `workers/whatsapp-bridge/`. Deploy it once:

```bash
cd workers/whatsapp-bridge
npm install
npx wrangler login
npx wrangler secret put META_ACCESS_TOKEN     # paste from Step 1
npx wrangler secret put META_APP_SECRET       # paste from Step 1
printf %s '<service-account JSON>' | npx wrangler secret put FIREBASE_SERVICE_ACCOUNT_KEY
npx wrangler deploy
```

Note the deployed URL — it'll be something like
`https://whatsapp-bridge.<your-account>.workers.dev`.

**Service-account JSON** is the same file you used for `email-router` — get it from
Firebase Console → Project Settings → Service accounts → Generate new private key.

---

## 4 · Wire the webhook in Meta

So Meta can send your replies back to the worker:

1. Meta App → **WhatsApp → Configuration** → Webhook → **Edit**.
2. **Callback URL** = `https://whatsapp-bridge.<your-account>.workers.dev/webhook`
3. **Verify token** = pick any random string (e.g. `abc123def456`) and remember it.
4. Add it as a Cloudflare secret: `npx wrangler secret put META_WEBHOOK_VERIFY_TOKEN`
5. Click **Verify and save** in Meta. Cloudflare will receive a GET — the worker will respond with the challenge → Meta marks webhook as ✓.
6. Subscribe to the **`messages`** field (the only one we need).

---

## 5 · Tell the dashboard about the worker

Open `/dashboard` → **Settings → Chat Widget**:

1. **Provider** = `Custom live-chat`
2. **Forward chats to WhatsApp** = ON
3. **Worker URL** = `https://whatsapp-bridge.<your-account>.workers.dev`
4. **Your WhatsApp number** = your personal number in E.164 format without `+` (e.g. `918880195191`)
5. **Meta Phone Number ID** = the numeric ID from Step 1
6. Click **Save Chat Widget**.

---

## 6 · Test end-to-end

1. Open the public site in **incognito** (so you're treated as a customer, not the admin).
2. Open the chat bubble → send "test message" → submit.
3. ~5 seconds later your WhatsApp pings with:
   > `[chat] test message — reply to this WhatsApp message and it'll go back to the customer's chat.`
4. Reply on WhatsApp.
5. The reply appears as `👤 Andaman Voyages Team: <your text>` in the incognito browser's chat — instantly.

Working? 🎉

---

## 7 · Going live (optional)

While the Meta App is in **Test mode**, you can only DM phone numbers you've explicitly added to the test recipient list. To DM ANY visitor on WhatsApp, the app needs to be **Approved for Production** by Meta:

1. Meta App → **App Review → Permissions and Features** → request `whatsapp_business_messaging` + `whatsapp_business_management`.
2. Submit the **App Verification** form (business address, website, demo screencast).
3. Wait 1–3 business days for Meta to approve.

Until production approval, the **website chat → admin's WhatsApp** path works perfectly (because the admin number is on the test list). Only the reverse direction — admin DMing arbitrary customers — is gated.

For our use-case (customer reaches out, admin replies), this is fine: the customer's reply *to the admin's reply* counts as a "user-initiated conversation" so it's free + unlimited even in Test mode.

---

## 8 · Costs

- Free tier: 1,000 service conversations / month (a "conversation" = 24-hour rolling window per customer).
- Beyond free tier: ~₹0.30 / conversation (current Indian rate, May 2026).
- Meta charges in USD; you pay through the FB Business Manager → Billing.

For most small travel businesses this means the entire bill stays at ₹0.

---

## 9 · Troubleshooting

| Problem | Fix |
|---|---|
| Webhook verification failed | Make sure `META_WEBHOOK_VERIFY_TOKEN` matches what you typed in Meta's UI |
| "Recipient not in allowed list" | While in Test mode, add the recipient at WhatsApp → API Setup → To |
| Worker logs `META_ACCESS_TOKEN missing` | Run `npx wrangler secret put META_ACCESS_TOKEN` again, then re-deploy |
| Worker returns 200 but no msg in WA | Check the access token hasn't expired — generate a System User Token instead of the 24-hour temporary one |
| "Invalid signature" in worker logs | The `META_APP_SECRET` env var is wrong — fetch it again from App settings → Basic |

---

## 10 · Disabling the bridge

In `/dashboard → Settings → Chat Widget`:

- Toggle **Forward chats to WhatsApp** = OFF — chats keep flowing into Firestore (visible in dashboard) but no longer DM your phone.
- Or change **Provider** = `Brevo Conversations` to roll back to the Brevo widget.

The change applies to all NEW visitors immediately.