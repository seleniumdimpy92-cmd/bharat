# Received-email feature — Cloudflare Email Routing variant

> **Status:** Spec only — implementation in a fresh Cline task.
>
> Sibling document to `received_email_setup.md` (which covers the Gmail
> API polling approach). **Pick one OR the other, not both** — running
> both means inbound mail gets stored twice in Firestore.

---

## Why this approach is the "cheapest + cleanest" of the three

Cloudflare Email Routing is a **free** built-in DNS / SMTP feature on every
Cloudflare-managed domain. It receives mail at any address on your domain,
then either:

1. **Forwards** it to a destination address you've verified (Gmail, Zoho, etc.), AND/OR
2. **Fires a Worker** — passing the parsed email as an `EmailMessage` object — so
   you can store it in Firestore, run rules, auto-reply, whatever.

Compared to Gmail API polling:

| | Gmail API polling | **Cloudflare Email Routing** |
|---|---|---|
| Cost | Free if Workspace already paid | Free, period (Cloudflare doesn't charge for routing) |
| Latency | Up to 1 min (cron tick) | < 1 sec (push, not poll) |
| Quota | Gmail API soft limits | None — push model |
| MX impact | None (we just read existing inbox) | **MX records change** — Cloudflare becomes the receiving server |
| Mobile/desktop client keeps working | ✅ yes (we don't touch the inbox) | ✅ yes — Cloudflare auto-forwards to Gmail/Zoho/etc. so apps still see new mail |
| OAuth setup | 15-30 min one-time | Zero — just DNS + a Worker route |
| Complexity | Token refresh management | None |

The catch in row 4 is critical: switching MX from Google → Cloudflare is a
domain-level change. Existing addresses keep working because we configure
Cloudflare to **forward** to your current Gmail, so your phone, web client and
IMAP all keep delivering as before. The dashboard mirror is added on top.

## Decisions taken

| # | Decision | Why |
|---|---|---|
| 1 | **Email Routing → Worker → Firestore + forward** | Push-based, sub-second latency, free, no token rotation. |
| 2 | **Forward all mail to current Gmail addresses** | Don't break mobile / phone / IMAP. Cloudflare can do this in addition to firing the Worker. |
| 3 | **Single Worker (`workers/email-router/`)** | Distinct from `inbox-mail` (outbound) and from any future Gmail-API code. |
| 4 | **Doc ID = SHA-256(rfc822-message-id)** | RFC-822 `Message-ID` is globally unique. Hash makes it Firestore-safe. Natural dedupe if Cloudflare ever retries. |
| 5 | **Keep mail forever** | Per owner request. Same as the Gmail-API plan. |
| 6 | **Owner does the MX swap** | DNS changes are infrastructure-level — must be done in Cloudflare dashboard, not by Cline. |

---

## Phase 1 — Cloudflare Email Routing setup (10 min, owner only)

### 1.1 Enable Email Routing on `andamanvoyages.in`

1. Cloudflare dashboard → select `andamanvoyages.in`.
2. Left sidebar → **Email** → **Email Routing**.
3. Click **Enable Email Routing**. Cloudflare will offer to add the required
   MX + TXT (SPF) records automatically — accept.
4. Wait ~5 min for DNS propagation (`dig MX andamanvoyages.in` should show
   `route1.mx.cloudflare.net`, `route2.mx.cloudflare.net`, `route3.mx.cloudflare.net`).

### 1.2 Add destination addresses (where forwards go)

For each existing Gmail mailbox you want to keep delivering to:

1. **Email Routing → Destination Addresses → Add destination**.
2. Enter the Gmail address (e.g. `booking.av@gmail.com` if you want to
   keep a Gmail copy, or any personal Gmail you read mail in).
3. Cloudflare emails a one-click verification link to that address.

You can also forward `info@andamanvoyages.in` and `cancellation@andamanvoyages.in`
to the same destination if a single human reads them all.

### 1.3 Create routing rules

For each address (`booking@`, `info@`, `cancellation@`):

1. **Email Routing → Routes → Create rule** (custom address).
2. **Match:** the address (e.g. `booking@andamanvoyages.in`).
3. **Action 1:** "Send to a Worker" → pick `email-router` (the Worker built
   in Phase 2 below; you can come back and add this after deploying).
4. **Action 2 (optional):** "Forward to" → your verified Gmail destination.
   Cloudflare allows multiple actions per rule, so the Worker writes to
   Firestore AND a copy lands in Gmail simultaneously.

### 1.4 Sanity check

From any external account, send a test email to `booking@andamanvoyages.in`.
You should receive it in the destination Gmail within a few seconds; the
Worker's `wrangler tail` should show the email body being parsed.

---

## Phase 2 — Implementation (Cline can do all of this)

### 2.1 New Worker — `workers/email-router/`

**Files:**

| Path | Purpose | ~size |
|---|---|---|
| `wrangler.jsonc` | `[email]` binding, env vars, secret list | 50 lines |
| `package.json` | wrangler dev-dep + scripts | 15 lines |
| `worker.js` | `email()` handler — entry point Cloudflare calls | 120 lines |
| `mime.js` | RFC-822 parser (headers, multipart, base64/quoted-printable) | 200 lines |
| `firestore.js` | Service-account JWT → bearer + REST `create/list/get` | 150 lines |
| `lib.js` | `b64url`, `sha256`, `importPrivateKey`, JWT verify | 120 lines |
| `.gitignore` | `node_modules`, `.dev.vars` | 5 lines |

**Hard rule (same as before):** keep each file < 7 KB to dodge `write_to_file`
truncation. Split if needed.

### 2.2 Worker `wrangler.jsonc` shape

```jsonc
{
    "name": "email-router",
    "main": "worker.js",
    "compatibility_date": "2025-05-01",
    "compatibility_flags": ["nodejs_compat"],
    "observability": { "enabled": true },
    "send_email": [
        { "name": "GMAIL_FORWARD", "destination_address": "booking.av@gmail.com" }
    ],
    "vars": {
        "FIREBASE_PROJECT_ID": "andaman-b886d",
        "ALLOWED_INBOXES":     "booking@andamanvoyages.in,info@andamanvoyages.in,cancellation@andamanvoyages.in",
        "FORWARD_ALL_TO":      "booking.av@gmail.com"
    }
}
```

The `send_email` binding lets the Worker call `await message.forward('GMAIL_FORWARD')`
to forward inside JS instead of using the Routes UI's Forward action.

### 2.3 Worker `email()` handler skeleton

```js
export default {
    async email(message, env, ctx) {
        // 1. Stream the raw RFC-822 message into a string (Cloudflare gives
        //    `message.raw` as a ReadableStream; rawSize tells us how big).
        const raw = await streamToString(message.raw, message.rawSize);

        // 2. Parse — extract Message-ID, From, To, Subject, Date,
        //    text/plain body, text/html body, attachment count.
        const parsed = parseRfc822(raw);

        // 3. Stable doc ID. RFC-822 Message-ID is globally unique;
        //    sha256 it so the doc ID is Firestore-safe.
        const docId = await sha256Hex(parsed.messageId || raw);

        // 4. Firestore service-account bearer token.
        const fbToken = await getFirestoreAccessToken(env);

        // 5. Idempotent write to /receivedEmails/{docId}.
        await firestoreCreateDoc(env, fbToken, 'receivedEmails', docId, {
            messageId: parsed.messageId,
            envelopeFrom: message.from,
            envelopeTo:   message.to,
            from: parsed.from, to: parsed.to, cc: parsed.cc,
            subject: parsed.subject, date: parsed.date,
            textPlain: (parsed.textPlain || '').slice(0, 100000),
            textHtml:  (parsed.textHtml  || '').slice(0, 200000),
            attachments: parsed.attachments || [],
            rawSize: message.rawSize,
            mailbox: message.to,
            unread:  true,
            receivedAt: new Date().toISOString()
        });

        // 6. Forward to Gmail so phones/desktop clients keep working.
        if (env.FORWARD_ALL_TO) {
            try { await message.forward(env.FORWARD_ALL_TO); }
            catch (err) { console.warn('forward failed:', err); }
        }
    }
};
```

### 2.4 RFC-822 parser (mime.js) — what it has to do

| Field | Source |
|---|---|
| `messageId` | header `Message-ID:` (strip `<` `>`) |
| `from / to / cc / subject / date` | corresponding headers, decoded if RFC-2047 (`=?UTF-8?Q?…?=`) |
| `textPlain` | first `text/plain` body part, base64 / quoted-printable decoded |
| `textHtml` | first `text/html` body part, decoded |
| `attachments` | array of `{ filename, mimeType, sizeBytes }` (no contents in Firestore — too expensive; just metadata) |

There's no built-in RFC-822 parser in Workers and `postal-mime` adds ~80 KB
to the bundle. **Recommendation:** write a minimal parser tailored to our
use case (~200 lines). Most travel inquiries are plain `multipart/alternative`
messages — we don't need full robustness.

### 2.5 Firestore data model

Same shape as the Gmail-API plan, **except**:

- `gmailId` becomes `messageId` (the RFC-822 one).
- Add `envelopeFrom`, `envelopeTo` (Cloudflare's `message.from` / `message.to` —
  these are SMTP-level, can differ from header `From:` after forwarding).
- Add `rawSize` for "this email is suspiciously large" filtering.
- `internalDate` (Gmail-only) is dropped; we use `receivedAt` for ordering.

### 2.6 `firestore.rules` — same block as the Gmail-API plan

```
match /receivedEmails/{id} {
    allow read: if isAdmin();
    allow create, update, delete: if false;   // service-account-only via REST
}
```

### 2.7 Cloudflare secrets

Just one secret needed (vs the Gmail-API plan's five):

```bash
cd workers/email-router
printf %s '<full service-account JSON>' | npx wrangler secret put FIREBASE_SERVICE_ACCOUNT_KEY
npx wrangler deploy
```

After deploy, go back to the **Email Routing → Routes** UI and pick
`email-router` as the worker action for each address.

### 2.8 Dashboard UI changes

**Identical** to the Gmail-API plan's section 2.5 — same Sent/Received tabs, same preview pane, same Reply prefills Compose. The only difference is the Worker URL the Refresh button calls (`POST https://email-router.<account>.workers.dev/poll` is **not** needed here — there's no polling — but you can keep a manual `/poll` endpoint that just returns the latest 50 docs from Firestore so the Refresh button still works for browsers that don't have a fresh load).

The dashboard reads from Firestore directly (rules allow admin read), so the `email-router` Worker only needs to expose:

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/` | Health check |
| (email) | (n/a) | The actual `email()` handler — Cloudflare invokes this on inbound mail |

There's no need for `/poll` or `/list` like in the Gmail-API plan; once the Worker writes to Firestore, the dashboard reads directly via the modular SDK with admin-rule-enforced auth.

---

## What you give up vs Gmail-API polling

1. **You change MX records.** This is the biggest commit. Cloudflare becomes the
   authoritative inbound server. To roll back, swap MX back to Google's
   `aspmx.l.google.com` etc. Existing Gmail data isn't affected.
2. **You can't read mail older than the cutover** — Cloudflare only sees mail that
   arrives AFTER MX flips. If you want the existing Gmail history mirrored too,
   run the Gmail-API plan once as a one-shot import, then disable its cron.
3. **No threading via Gmail's `threadId`** — RFC-822 has `In-Reply-To` and
   `References` headers we'd use instead. Slightly less robust but works.
4. **Outbound replies still go through Brevo.** The Compose modal is unchanged.
   Mail you send via Brevo doesn't get a copy in Cloudflare's view (Cloudflare
   only handles inbound). If you want sent mail visible to your phone's Gmail,
   add `bcc: <gmail-address>` to outbound Compose payloads (one-line worker.js
   change in `workers/inbox-mail/worker.js`).

---

## Risks & guard-rails

| Risk | Mitigation |
|---|---|
| **MX flip is irreversible until propagation completes (~24 h max)** | Plan the cutover for a low-traffic time. Existing Gmail still receives forwards from Cloudflare, so users won't see a gap. |
| **Cloudflare rejects mail > 25 MB** | RFC-5321 limits SMTP messages to 10 MB by default; 25 MB is generous. Larger attachments will bounce. Add `rawSize` check + log to dashboard. |
| **Worker bundle exceeds 1 MB after parser** | Keep MIME parser hand-written, no `postal-mime`. If size creeps up, move parser to a Durable Object or trim attachments to metadata-only (which we already do). |
| **Spam / phishing arrives in Firestore too** | Cloudflare runs SPF/DKIM/DMARC verification before invoking the Worker. Add a `spamScore` field from `message.headers.get('X-Cloudflare-Spam-Score')` and filter at UI level. |
| **Service-account key leaked** | Same as the Gmail-API plan — rotate via Firebase Console. Worker reads from Cloudflare secrets (encrypted at rest). |

---

## Out of scope (parking lot)

- **Auto-reply rules.** Easy add inside `email()`: pattern-match subject/body, queue an outbound via the existing `inbox-mail` Worker. Phase 3.
- **Threading.** Group on `In-Reply-To` header chain. Phase 3.
- **Attachment storage.** If you want to view PDFs in the dashboard, write attachments to Cloudflare R2 (free 10 GB) and store the R2 key in the Firestore doc. Phase 4.
- **Bulk archive.** A "Mark all as read" / "Archive older than 30d" UI button. Phase 3.

---

## When you're ready to build

1. **Do Phase 1 yourself** — enable Email Routing, add destinations, leave the
   per-address routing rules pointing only to "Forward to Gmail" until the
   Worker is deployed in Phase 2.
2. **Open a fresh Cline task** with this seed prompt:
   > Implement the plan in `received_email_cloudflare_setup.md`. Build everything
   > in Phase 2 first; do nothing in Phase 1 until I've finished the Cloudflare
   > Email Routing setup. Stick to the file-size limits called out at the start
   > of section 2.1.
3. After deploy, return to the Cloudflare dashboard and add "Send to Worker:
   email-router" as a second action on each routing rule.
