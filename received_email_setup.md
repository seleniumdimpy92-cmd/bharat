# Received-email feature — design & implementation plan

> **Status:** Spec only. No code yet — see "Why this is a separate session" below.
>
> When you're ready, start a fresh Cline task and paste **just this file's contents**
> as the prompt with one line at the top: *"Implement the plan in
> `received_email_setup.md`. Build everything in Phase 2 first; do nothing in
> Phase 1 until I've finished the Google Cloud Console setup."*

---

## Goal

Mirror inbound emails from three Google Workspace mailboxes into Firestore so the
dashboard's **Inbox → Received** tab can show, search and reply to them — without
disrupting the existing Gmail web/IMAP flow.

| Mailbox | Domain |
|---|---|
| `booking@andamanvoyages.in` | Google Workspace |
| `info@andamanvoyages.in` | Google Workspace |
| `cancellation@andamanvoyages.in` | Google Workspace |

## Decisions taken (from the planning chat)

| # | Decision | Why |
|---|---|---|
| 1 | **Gmail API polling**, not IMAP, not Brevo Inbound Parse | API works from a Worker (HTTPS only); Inbound Parse needs an MX swap that breaks existing Gmail. |
| 2 | **Cron every 1 min** (`* * * * *`) | Cloudflare's smallest cron unit; quota cost is trivial (3 mailboxes × 1 list call/min). |
| 3 | **Keep mail forever** | Owner explicitly chose no auto-prune. Add a manual "Delete" button per row instead. |
| 4 | **Separate Worker** (`workers/gmail-poll/`) | Keeps `inbox-mail` (outbound) and the new poller decoupled. Different OAuth scopes, different secrets. |
| 5 | **Firestore REST**, not the modular SDK | The SDK pulls in WebChannel transport which is clunky in Workers. REST + service-account JWT is rock-solid. |
| 6 | **Doc ID = Gmail message.id** | Natural dedupe across runs — `exists()`-check before fetching the full body. |
| 7 | **Google Cloud setup is owner's responsibility** | OAuth consent screen + creating the OAuth client + running a one-time consent flow per mailbox to obtain refresh tokens. The Worker can't do this for you. |

## Why this is a separate session

The previous session ran into write_to_file size limits while trying to author the
~13 KB worker.js in one go (truncated at ~9 KB, twice). Splitting into smaller modules
is fine — but the *whole* feature is 6+ file writes plus shell-script auth
helpers, and the chat context was already heavy with the JWKS bug fix and the
Compose-modal "From" picker. A fresh task with this spec as the seed is the cleanest path.

---

## Phase 1 — Google Cloud setup (15-30 min, owner only)

This is one-time per project. Skip if `andaman-b886d` (or whichever Firebase project
the dashboard uses) already has Gmail API enabled and an OAuth client; just reuse them.

### 1.1 Enable Gmail API

1. https://console.cloud.google.com → pick the project tied to `andaman-b886d`.
2. **APIs & Services → Library** → search "Gmail API" → **Enable**.

### 1.2 Configure OAuth consent screen

1. **APIs & Services → OAuth consent screen**.
2. **User Type:** Internal (since these are Workspace mailboxes within the same
   org). If "Internal" is greyed out, you don't have a Workspace-tier project —
   pick "External" and add the three mailbox addresses as test users (max 100).
3. App name: `andamanvoyages-inbox`. User-support email: any owned address.
4. **Scopes:** Add `https://www.googleapis.com/auth/gmail.readonly` only.
   (Less is more — read-only means a leaked refresh token can't send mail or
   modify the inbox.)
5. Save & Continue.

### 1.3 Create OAuth Client ID

1. **APIs & Services → Credentials → + Create Credentials → OAuth client ID**.
2. Application type: **Desktop app**. Name: `gmail-poll-cli`.
3. Click Create. Copy the `client_id` and `client_secret` from the dialog (you'll
   paste these into the Worker config).

### 1.4 Mint a refresh token per mailbox

A tiny one-time Node helper script (to be built in Phase 2 as
`workers/gmail-poll/get-refresh-token.js`):

```bash
cd workers/gmail-poll
npm install                                                         # installs nothing — uses zero deps
GOOGLE_CLIENT_ID="<from step 1.3>" \
GOOGLE_CLIENT_SECRET="<from step 1.3>" \
node get-refresh-token.js booking@andamanvoyages.in
# Prints a URL → open in browser → sign in as booking@ → grant Gmail read access
# → Google redirects to http://127.0.0.1:9999/oauth-callback?code=…
# → script captures it on a local server, exchanges → prints refresh_token
```

Repeat for `info@` and `cancellation@`. Save each refresh token; you'll set them
as Cloudflare secrets in Phase 2.4.

---

## Phase 2 — Implementation (Cline can do all of this)

### 2.1 New Worker — `workers/gmail-poll/`

**Files to create:**

| Path | Purpose | Approx size |
|---|---|---|
| `wrangler.jsonc` | Cron `* * * * *`, env vars, secret list | 60 lines |
| `package.json` | wrangler dev-dep, npm scripts | 15 lines |
| `worker.js` | Endpoints + scheduled() handler | 200 lines |
| `lib.js` | Pure helpers (parse, JWT verify, base64url) | 150 lines |
| `firestore.js` | REST helpers (`exists`, `create`, `list`) | 100 lines |
| `gmail.js` | Refresh→access exchange, message fetch | 60 lines |
| `firebase-auth.js` | Service-account JWT → bearer token | 60 lines |
| `get-refresh-token.js` | Standalone Node CLI for Phase 1.4 | 80 lines |
| `.gitignore` | `node_modules`, `.dev.vars` | 5 lines |

**Hard rule for the next session:** keep each file **under 7 KB** so write_to_file
won't truncate. If a file grows past that, split it (e.g. `firestore.js` → `firestore-read.js` + `firestore-write.js`). Test after every file with
`wc -c <file>` and `node --check <file>` (for plain Node files).

**Endpoints exposed by the Worker:**

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/` | none | Health JSON `{ ok: true, mailboxes: [...] }` |
| `POST` | `/poll` | Firebase ID token (admin) | Manual force-refresh button on dashboard |
| `GET` | `/list?limit=50&cursor=xxx` | Firebase ID token (admin) | Paged read of `/receivedEmails` (avoids browser-side Firestore reads, saves quota) |
| `POST` | `/markRead` | Firebase ID token (admin) | Body `{ id, read: true/false }` — flips a `read` field on the doc (Phase 3, optional) |
| (cron) | (n/a) | (cron-only) | `scheduled()` — runs `pollAllMailboxes(env)` every minute |

**`pollOneMailbox(env, mailbox)` algorithm:**

```
1. refresh = env[emailToSecretKey(mailbox)]
   (e.g. for "booking@andamanvoyages.in" → "GMAIL_REFRESH_TOKEN__booking__AT__andamanvoyages__DOT__in")
2. access = POST oauth2.googleapis.com/token (refresh_token grant)
3. ids = GET gmail/v1/users/me/messages?maxResults=20&q=newer_than:7d -in:chats
4. fbToken = service-account JWT → bearer token (Firestore datastore scope)
5. for each id:
     if Firestore /receivedEmails/{id} already exists  → skip
     msg = GET gmail/v1/users/me/messages/{id}?format=full
     parsed = parseGmailMessage(msg, mailbox)   // headers + decoded body
     POST Firestore /receivedEmails/{id} with parsed
6. Return { fetched, written }
```

### 2.2 Firestore data model

Path: `/receivedEmails/{gmailMessageId}`

```js
{
    gmailId:      "1929d8…",          // = doc id, redundant for client-side lookups
    threadId:     "1929d8…",          // for grouping replies
    mailbox:      "booking@andamanvoyages.in",
    from:         "Customer <c@x.com>",
    to:           "booking@andamanvoyages.in",
    cc:           "",
    subject:      "Re: Andaman 5-day package",
    date:         "Mon, 26 May 2026 12:34:56 +0530",
    snippet:      "Thanks for the quote, can we confirm…",
    textPlain:    "<full plain body, capped at 100 KB>",
    textHtml:     "<full HTML body, capped at 200 KB>",
    labelIds:     ["INBOX", "UNREAD"],
    unread:       true,
    internalDate: 1748259296000,      // epoch ms — for orderBy
    receivedAt:   "2026-05-26T07:04:56.000Z",
    createdAt:    serverTimestamp()    // Firestore-side
}
```

### 2.3 `firestore.rules` — admin read, service-account write

```
match /receivedEmails/{id} {
    // Admins read full history.
    allow read: if isAdmin();
    // Browser writes are blocked; the gmail-poll Worker writes via the
    // Firestore REST API using a service-account bearer token, which
    // bypasses these rules entirely.
    allow create, update, delete: if false;
}
```

Deploy with:
```
npx firebase-tools deploy --only firestore:rules
```

### 2.4 Cloudflare secrets to set after first deploy

```bash
cd workers/gmail-poll
printf %s "<oauth-client-secret>"            | npx wrangler secret put GMAIL_OAUTH_CLIENT_SECRET
printf %s "<full service-account JSON>"      | npx wrangler secret put FIREBASE_SERVICE_ACCOUNT_KEY
printf %s "<refresh-token-from-1.4-step-1>"  | npx wrangler secret put GMAIL_REFRESH_TOKEN__booking__AT__andamanvoyages__DOT__in
printf %s "<refresh-token-from-1.4-step-2>"  | npx wrangler secret put GMAIL_REFRESH_TOKEN__info__AT__andamanvoyages__DOT__in
printf %s "<refresh-token-from-1.4-step-3>"  | npx wrangler secret put GMAIL_REFRESH_TOKEN__cancellation__AT__andamanvoyages__DOT__in
```

The service-account JSON key must come from a **NEW** service account that only
has `roles/datastore.user` on the project — don't reuse the Firebase Admin SDK
default key. Create it under:
**Firebase Console → Project Settings → Service accounts → Generate new private key.**

### 2.5 Dashboard UI changes

Files affected:

- `dashboard.html` — add **Inbox: Sent / Received** tabs above the table; new "Refresh Inbox" button calls `POST /poll`.
- `js/inbox.js` — add `loadReceived()` mirroring `loadSent()`; preview pane on row click; "Reply" button prefills Compose with `to = from`, `subject = "Re: " + subject`, `body = "" + quoted-original`.
- Add `window.GMAIL_POLL_URL = 'https://gmail-poll.<your-account>.workers.dev'` next to the existing `INBOX_WORKER_URL` in `dashboard.html`.
- Bump `js/inbox.js?v=2` → `?v=3`.

The Received table columns: **Received at · Mailbox · From · Subject · Status (unread/read) · Actions (Reply / Delete)**.

Click a row → side panel slides in with `from`, full subject, decoded body (prefer `textHtml` rendered in a sandboxed `<iframe srcdoc>` for safety; fall back to `textPlain` in a `<pre>`). Reply button calls `window.__inboxOpenCompose({ to, subject, body, replyTo: mailbox })`.

### 2.6 `inbox_setup.md` updates

Add a "Receiving emails" section pointing at this file, plus a checklist:

- [ ] Phase 1 done (Google Cloud Console)
- [ ] Three refresh tokens minted and pasted into Cloudflare secrets
- [ ] Worker deployed (`cd workers/gmail-poll && npx wrangler deploy`)
- [ ] Firestore rules redeployed
- [ ] Dashboard hard-refresh — Received tab shows mail within 1 minute of arrival

---

## Risks & guard-rails

| Risk | Mitigation |
|---|---|
| **Refresh tokens revoked after 7 days** (External OAuth in testing-mode) | Use Internal user type if Workspace allows; otherwise **Publish** the OAuth consent screen to skip the testing-mode 7-day cap. |
| **Quota exhaustion if a mailbox gets a flood of mail** | `messages.list` capped at `maxResults=20` per poll; we never re-fetch already-stored docs. Worst case = 20 new mails/min/mailbox = 60/min/account. Gmail quota is 250 quota-units/user/sec; we use ~5/sec total. |
| **Service-account key leaked** | Lives only in Cloudflare secret store. Rotate via *Service accounts → Disable old key → Generate new → re-upload* anytime. |
| **A poll fails mid-cycle** (network glitch) | Each mailbox runs in its own try/catch in `Promise.all`; one mailbox failing doesn't stop the others. The next cron tick (1 min later) retries. |
| **Mailbox owner removes OAuth grant via myaccount.google.com** | Worker logs surface a `400 invalid_grant` for that mailbox. Rerun `get-refresh-token.js` and replace the secret. |
| **Firestore quota burn on large bodies** | Body fields capped (100 KB plain, 200 KB HTML) at parse time. Doc count grows but reads are paged via `/list?cursor=`. |

---

## Out of scope (parking lot)

- Threading view (group received + sent by `threadId`). Easy after Phase 2.
- Full-text search. Add Firestore composite index + a tiny client-side filter.
- Attachments. Gmail returns `attachmentId`s; downloading them needs a separate `messages.attachments.get` call. Skip until requested.
- Marking-as-read sync back to Gmail. We currently mark in Firestore only — Gmail still shows them as unread. To sync back, change OAuth scope to `gmail.modify` and call `messages.modify`.
- Sending replies through the **Sent** mailbox of Gmail (so they appear in your phone's Gmail too). Currently the Compose modal sends via Brevo's `booking@`/`info@`/`cancellation@` — perfect deliverability but the Sent copy lives only in our dashboard. To put a copy in Gmail's Sent folder we'd need to ALSO `messages.insert` with `INBOX SENT` labels via Gmail API.
