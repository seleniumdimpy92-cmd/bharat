# Brevo Conversations chat — admin setup

Your site already has the Brevo Conversations chat bubble on every public page (commit `64f12b6` — `js/brevo.js` + the `<script src="js/brevo.js">` include on 13 pages). This guide explains **how to actually receive and reply to those chats**.

---

## TL;DR

The chat widget is already injected. **You reply to incoming chats from <https://app.brevo.com/conversations>**. The widget ID is `6a15404f94b63fe74c038079`.

To make sure no chat ever goes unanswered:

1. Configure your Brevo Conversations agent profile (your name, photo).
2. Set business hours + an "offline" auto-reply.
3. Install the **Brevo mobile app** so you get push notifications when a customer messages you while you're away from the laptop.
4. (Optional) Enable email + WhatsApp routing inside Conversations so the same inbox handles all three channels.

---

## 1. Configure your agent profile (5 min)

1. Go to <https://app.brevo.com/conversations>.
2. Top-right → **Settings** (the cog icon) → **Operators / Agents**.
3. Edit your profile:
   - **Display name** (e.g. "Deb @ Andaman Voyages")
   - **Profile photo** (this shows in the chat header)
   - **Title** (e.g. "Travel specialist")
4. Save.

---

## 2. Welcome message + business hours

In Brevo Conversations:

- **Settings → Welcome Message** — show "Hi 👋 Tell us your dream Andaman dates and we'll send you 3 quotes within 1 hour" the moment a visitor opens the bubble.
- **Settings → Business Hours** — set your active hours (e.g. Mon–Sat 9 AM – 9 PM IST).
- **Settings → Offline Form** — when you're outside business hours the bubble shows a contact form (name + email + message). The form arrives in your Conversations inbox **and** a copy is sent to your email.

---

## 3. Get push notifications (must-do)

The web dashboard at app.brevo.com/conversations only notifies you while it's open in a browser tab. Two better channels:

### 3a. Mobile app
- iOS: <https://apps.apple.com/us/app/brevo-conversations/id1634062960>
- Android: <https://play.google.com/store/apps/details?id=com.brevoconversations.app>

Sign in with your Brevo email — every new chat triggers an iOS/Android push within ~5 seconds.

### 3b. Email-on-new-chat
**Settings → Notifications → Email me when a new conversation arrives** — for the rare moment you have neither the app nor the laptop.

---

## 4. Connect email and WhatsApp to the same inbox (optional but powerful)

Brevo Conversations is a **multi-channel inbox** — set this up once and incoming `booking@andamanvoyages.in` emails AND WhatsApp messages all show up in the same UI as the chat bubbles, so you reply to everything from one place.

### 4a. Email channel
1. **Conversations → Settings → Channels → Email**.
2. Click **Connect**.
3. Pick **IMAP** (works with any provider).
4. Enter your `booking@andamanvoyages.in` mailbox credentials. If the mailbox is the Cloudflare-Routing forward we set up earlier, you'll need to first move it onto a real IMAP host (Zoho Mail's free plan is the easiest — see `chat_setup.md → Appendix`). Once IMAP is connected, **every email to `booking@…` becomes a conversation thread in Brevo**, and your replies are sent through Brevo's SMTP relay (so they appear to come from `booking@andamanvoyages.in`).

### 4b. WhatsApp channel
1. **Conversations → Settings → Channels → WhatsApp**.
2. Click **Connect → WhatsApp Business API**.
3. Brevo walks you through Meta Business verification: you'll need a phone number that's **not yet registered** with the regular WhatsApp app, your business name, and ~10 minutes for Meta to approve.
4. Once approved, all wa.me/918880195191 conversations land in the same Brevo inbox alongside chat + email.

> Note: WhatsApp Business API has Meta-imposed limits on the first message: you can only proactively message a customer with a *pre-approved template*. Replies to incoming messages are unrestricted within a 24-hour window.

---

## 5. Customise the chat bubble (looks)

`Conversations → Settings → Chat widget`:

- **Brand colour** — change from default purple to the site's teal `#0d7a8a`.
- **Welcome message**, avatar, position (left/right), greeting prompts.
- **Pre-chat form** — collect name + email before chat starts (recommended; lets you follow up if they leave).
- **Office hours indicator** — "We're online" / "We'll reply within 4 h" toggle.

Changes apply instantly on the live site (no redeploy — the widget script is loaded async).

---

## 6. Test end-to-end

1. Open <https://andamanvoyages.in> in an **incognito** window.
2. Click the chat bubble bottom-right → type "hello, testing" → send.
3. Check:
   - Brevo dashboard at <https://app.brevo.com/conversations> shows the new conversation immediately.
   - Mobile app pings.
   - You can reply from either, and the reply appears in the visitor's bubble within ~2 s.

---

## 7. What about the floating WhatsApp button & AI chat bubble?

You have **three** chat entry points stacked on the right rail:

| Bubble | What it does | Lands where |
|---|---|---|
| Brevo bubble (bottom-right, Brevo brand colour) | Live chat with a Brevo agent | app.brevo.com/conversations + mobile app |
| Teal chat bubble (above WhatsApp) | Built-in AI chatbot answering FAQs | Stays on-page (no inbox) |
| Green WhatsApp FAB (lowest) | Opens wa.me/918880195191 with prefilled message | WhatsApp web/app on the visitor's device |

If the duplication feels noisy, you can disable the legacy AI chat:
- Edit `js/chat.js` → wrap the whole IIFE so it `return`s early when `window.BrevoConversationsID` is set, **OR**
- Just remove `<script src="js/chat.js">` references (search the codebase — it's currently loaded on most pages).

Tell me which you'd prefer and I'll ship it.

---

## Appendix — getting `booking@andamanvoyages.in` onto IMAP

Since the address is currently a Cloudflare Email Routing forward (no real mailbox), you have two options before connecting it to Brevo Conversations:

**Easiest — Zoho Mail (free for ≤5 users):**
1. Sign up at <https://www.zoho.com/mail/zohomail-pricing.html> → Forever Free Plan.
2. Verify the domain `andamanvoyages.in` (Zoho gives you a TXT record).
3. Update DNS — drop Cloudflare Email Routing's MX records and add Zoho's MX.
4. Create a mailbox `booking@andamanvoyages.in`, generate an **IMAP App Password**.
5. Use those credentials in Brevo Conversations → Channels → Email → IMAP.

**Or skip mailbox altogether — Brevo's "Inbox" plan ($15/mo):**
Brevo can host the address itself + auto-thread incoming emails. Same final result, but paid.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Chat bubble doesn't appear | Adblocker; JS error | DevTools → Network — does `brevo-conversations.js` load? |
| New chats not arriving in dashboard | Wrong widget ID | Check `js/brevo.js` line 33 — ID must match Conversations → Settings → Widget |
| No mobile push | App not signed in / OS notif perms revoked | Reinstall the app, allow notifications |
| Replies arrive late from email channel | IMAP polling interval | Brevo polls every ~3 min — for instant, you can switch to Gmail OAuth or set up a forwarding rule that hits Brevo's inbound webhook (advanced) |

Need help? <https://help.brevo.com/hc/en-us/categories/360001143019-Conversations>