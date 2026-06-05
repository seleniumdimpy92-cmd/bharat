# Admin Inbox — Auto-Reply Template

This adds a **template-based auto-reply** to the existing Admin Inbox in the dashboard. There are two modes that can run together:

1. **Draft on demand** — when you open any received email, a new purple **"🤖 Reply with template"** button appears next to *Reply / Reply All / Forward*. Clicking it opens the existing Compose modal pre-filled with the saved template, addressed to the sender.

2. **Auto-send on new mail** — when a brand-new email lands in `/receivedEmails`, the dashboard automatically sends the templated reply through the same `inbox-mail` Cloudflare Worker that powers Compose. Each customer is throttled (per-message + per-sender cooldown) so you can't accidentally spam them.

No backend / worker / Firestore-rules changes are required — everything reuses existing infrastructure.

## Files added

| File | Purpose |
|---|---|
| `js/inbox-autoreply.js` | Self-contained module — UI + send pipeline |
| `inbox_autoreply_setup.md` | This file |

## Files modified

| File | Change |
|---|---|
| `dashboard.html` | One extra `<script src="js/inbox-autoreply.js">` after `inbox-receiver.js` |

## How it works

### 1. Settings storage

The template lives at `/settings/inboxAutoReply` (single Firestore doc). The existing `firestore.rules` already allow public-read / admin-write on `/settings/{key}`, so **no rule changes are needed**.

```
/settings/inboxAutoReply
{
  enabled:         true | false,
  sendImmediately: true | false,           // false = draft only
  cooldownHours:   24,                     // per-sender throttle
  defaultFrom:     'mailbox' | 'booking@…' // 'mailbox' = same mbx
                                            //   the mail came in
  subject:         'We received your email — Bharat Voyages',
  body:            'Hi {{firstName}},\n\nThanks for reaching out…',
  updatedAt:       <serverTimestamp>,
  updatedBy:       'admin@email'
}
```

### 2. Placeholders

Both subject and body support these tokens:

| Token | Value |
|---|---|
| `{{firstName}}` | First word of sender name |
| `{{senderName}}` | Display name (or email user-part if missing) |
| `{{senderEmail}}` | Sender's plain email |
| `{{subject}}` | Original subject (no Re: added) |
| `{{originalSubject}}` | Same as `{{subject}}` |
| `{{mailbox}}` | Mailbox the mail landed in |
| `{{date}}` | Localized received date/time |

### 3. Throttling (auto-send mode)

To prevent spam loops & repeat-replies:

- **Per-message** — each `receivedEmails` doc id is auto-replied to AT MOST ONCE. Tracked in `localStorage` under `inboxAutoReplyDoneIds`.
- **Per-sender** — one auto-reply per sender per `cooldownHours`. Tracked in `localStorage` under `inboxAutoReplySenders`.
- **Loop guard** — auto-reply is skipped for:
  - Mail from one of *our own* mailboxes (booking@/info@/cancellation@/enquiries@andamanvoyages.in)
  - Bounce / no-reply addresses (mailer-daemon, postmaster, no-reply, do-not-reply, bounces, abuse, …)
- **Tab lock** — `sessionStorage` prevents two tabs in the same browser from double-firing.
- **History first** — the FIRST Firestore snapshot when the dashboard loads is treated as "history" and ignored. Only mail that arrives AFTER you've opened the dashboard triggers an auto-send.

### 4. Trigger model

Auto-send is **client-side**: any logged-in admin who has the dashboard tab open will trigger the send. This is intentional:

- Reuses the existing `/send` endpoint of the `inbox-mail` Worker (already authenticated via Firebase ID token — no new credentials).
- No new server cron or scheduled Worker needed.
- Multiple admins → still safe: localStorage idempotency + sessionStorage lock + the `inbox-mail` Worker's own per-call rate limiting prevent duplicates.

If you want strictly-server-side auto-replies (e.g. for nights when no admin is online), see "Optional: server-side auto-reply" below.

## Setup

### 1. Pull the changes

```bash
git pull   # the file is already wired up via dashboard.html
```

### 2. Open the dashboard → Inbox tab

You'll see a new **purple Auto-Reply button** in the section header next to *Compose / Refresh*.

### 3. Click Auto-Reply → configure

- ☑️ **Enable auto-reply** — turns on draft-mode (the "Reply with template" button appears in every preview pane).
- ☑️ **Send immediately** — also auto-sends the templated reply when new mail arrives. Leave OFF if you only want to assist drafting.
- **From mailbox** — `Same mailbox the mail came in` is usually right (so an enquiry to `info@` gets a reply from `info@`).
- **Per-sender cooldown** — default 24h. After replying to `someone@example.com` once, no further auto-replies will go to them for this many hours, even if they email you 50 more times.
- **Subject / Body** — edit the template; insert any placeholder tokens you like.

### 4. Hit "Send test to me"

This sends a test email to your own admin email so you can preview exactly how the rendered template looks in real Gmail/Outlook before turning auto-send on for the public.

### 5. Hit "Save"

Changes propagate live — the badge on the Auto-Reply button switches from blank → `ON` (draft mode) → `AUTO` (immediate send mode).

## Verifying it works

### Draft mode

1. Wait for any email to land in /receivedEmails (or send yourself one to `info@andamanvoyages.in`).
2. Click the row → preview pane appears.
3. Hit **"🤖 Reply with template"**.
4. Compose modal opens with the rendered template + the customer's email pre-filled. Edit / hit Send.

### Auto-send mode

1. Make sure `Enable auto-reply` AND `Send immediately` are both ON.
2. Send yourself an email from a different address (NOT one of `*@andamanvoyages.in`) to e.g. `info@andamanvoyages.in`.
3. Within ~10 seconds the dashboard should:
   - Show a toast `Auto-reply sent to <your-address>`.
   - The reply appears in your other inbox.
   - It also shows up in the *Sent* tab of the Admin Inbox (with `autoReply: true` flag in Firestore).

### Resetting throttle (during testing)

Open the browser console on the dashboard and run:
```js
window.AdminInboxAutoReply.resetThrottle();
```
This clears all per-message and per-sender locks so the next email triggers a fresh auto-reply.

## Common gotchas

| Problem | Fix |
|---|---|
| "Auto-reply settings saved" toast but no auto-send | Make sure **both** `Enable auto-reply` and `Send immediately` are ON. |
| Auto-reply did not fire on a real customer email | Check the browser console for `[inbox-autoreply] skip <id> <reason>`. The reason explains exactly why (cooldown, no-reply-addr, self, already-replied). |
| Auto-reply went to one of our own mailboxes | This is by design — the loop-guard skips our own addresses. If a forwarded enquiry hits us via one of our addresses, you'll need to reply manually. |
| Test send works but real mail doesn't | The dashboard browser tab must be open and signed-in for the auto-send to fire. See "Optional: server-side auto-reply" below for an unattended option. |

## Optional: server-side auto-reply

If you want auto-reply to also fire when no admin tab is open, add it to `workers/email-router/worker.js`:

1. After parsing the mail and calling `addDoc(receivedEmails, …)`, also call the inbox-mail Worker's `/send` endpoint directly using a service-account-issued ID token, or simply send via Brevo's REST API (you already have `BREVO_API_KEY` configured for `inbox-mail`).
2. Pull the same `/settings/inboxAutoReply` doc (the worker already has Firestore REST access) and apply the same eligibility checks server-side.
3. Use a small Firestore-backed throttle map (e.g. `/inboxAutoReplyState/<senderHash>`) instead of localStorage.

For now, the client-side version is enough for normal operation — the dashboard is open most of the working day anyway, and the per-message throttle keeps things safe even if both client and server fire (the `localStorage` set just means a duplicate `addDoc` to `/sentEmails` at worst).