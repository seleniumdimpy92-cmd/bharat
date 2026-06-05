# Password-reset email setup (fix the "spam folder" problem)

## The problem

Out-of-the-box, Firebase Authentication's `sendPasswordResetEmail()` ships
the email **from**

    noreply@<your-project>.firebaseapp.com

(in our case `noreply@andaman-b886d.firebaseapp.com`). Gmail almost always
classifies that domain as suspicious because:

1. The visible sender domain (`firebaseapp.com`) doesn't match the brand
   the recipient expects (`andamanvoyages.in`).
2. SPF / DKIM / DMARC records align to `firebaseapp.com`, not to our
   custom domain.
3. The reset link inside the email also points back to `firebaseapp.com`.

Result: nearly every reset email lands in **Spam**. (See the original bug
report screenshot — Gmail even adds the warning banner *"This message was
marked as spam because previous messages from andaman-b886d.firebaseapp.com
were marked as spam."*)

## The fix

Send the reset email through our **own verified domain**
(`noreply@andamanvoyages.in`, with SPF + DKIM + DMARC already set up in
Brevo) instead of Firebase's default sender.

The flow:

1. Browser (`js/dataStore.js → sendPasswordReset()`) POSTs the user's
   email to the **ai-assistant Cloudflare Worker** at
   `POST /password-reset`.
2. The Worker (`workers/ai-assistant/password-reset.js`):
    a. Rate-limits by IP (5 / minute).
    b. Confirms the email exists in Firestore `/usernames`
       (anti-enumeration: still returns `{ ok:true }` if it doesn't).
    c. Calls Google Identity Toolkit
       (`accounts:sendOobCode` with `returnOobLink=true`) using a
       service-account access token to **generate a real Firebase reset
       link** *without* asking Firebase to send its own email.
    d. Sends a branded HTML email through **Brevo** (the same Brevo
       account that already powers booking-confirmation emails) FROM
       `noreply@andamanvoyages.in`.
3. The link inside the email is still a real Firebase action URL
   (`https://andaman-b886d.firebaseapp.com/__/auth/action?…oobCode=…`),
   so password updates continue to flow through Firebase Auth securely.
4. After resetting, Firebase redirects the user back to
   `PASSWORD_RESET_CONTINUE_URL` (default `https://andamanvoyages.in/?reset=1`).

## Files

| File | Role |
|---|---|
| `workers/ai-assistant/password-reset.js` | Worker handler: generates the link + sends the email. |
| `workers/ai-assistant/worker.js` | Routes `POST /password-reset` to the handler. |
| `workers/ai-assistant/firestore.js` | OAuth + Firestore helper (already existed). |
| `workers/ai-assistant/brevo.js` | Brevo send helper (already existed). |
| `js/dataStore.js` | `UsersStore.sendPasswordReset()` calls the Worker first; falls back to Firebase's built-in if the Worker is down. |
| `js/firebase-config.js` | `window.AI_ASSISTANT_WORKER_URL` config. |

## Cloudflare Worker — required env / secrets

The endpoint reuses every secret/var the **ai-assistant** Worker already
has, so usually **no new configuration is needed** — just redeploy.

Existing (already set):

| Name | Type | Source |
|---|---|---|
| `FIREBASE_PROJECT_ID` | var | `wrangler.jsonc` |
| `FIREBASE_SERVICE_ACCOUNT_KEY` | secret | `wrangler secret put` |
| `BREVO_API_KEY` | secret | `wrangler secret put` |
| `ALLOWED_ORIGIN` | var | `wrangler.jsonc` |

Optional (defaults shown):

| Name | Default | Purpose |
|---|---|---|
| `PASSWORD_RESET_CONTINUE_URL` | `https://andamanvoyages.in/?reset=1` | Where Firebase redirects the user after a successful reset. URL must be on the project's **Authorized Domains** list. |

## Service-account permissions (one-time check)

The endpoint calls Identity Toolkit's `accounts:sendOobCode` API. Your
service-account already has the right access if it was generated from the
**Firebase Console → Project settings → Service accounts → Generate new
private key** flow — the default role is *Firebase Admin SDK Admin
Service Agent* which includes `iam.serviceAccountTokenCreator` plus
`identitytoolkit.tenants.createUser` and friends.

If you see this error in the Worker logs:

    sendOobCode failed: 403 PERMISSION_DENIED

go to **GCP IAM** ([https://console.cloud.google.com/iam-admin/iam](https://console.cloud.google.com/iam-admin/iam))
for the same project, find the service-account email, and add the
**"Firebase Authentication Admin"** role.

## Deploy

```sh
cd workers/ai-assistant
npx wrangler deploy
```

Then verify on the live site:

```sh
curl -i -X POST https://ai-assistant.<sub>.workers.dev/password-reset \
    -H 'Content-Type: application/json' \
    -d '{"email":"someone-with-an-account@example.com"}'
# → HTTP/2 200
# → {"ok":true}
```

Open the inbox of that account — the email should arrive within a few
seconds, FROM `noreply@andamanvoyages.in`, **in the Inbox** (not Spam).

## Roll-back

To temporarily revert to Firebase's built-in (spam-bound) sender, blank
the worker URL in `js/firebase-config.js`:

```js
window.AI_ASSISTANT_WORKER_URL = '';
```

`js/dataStore.js → sendPasswordReset()` will then fall through to
`firebaseAuth.sendPasswordResetEmail(auth, email)` and the original
behaviour returns. Restore the URL to re-enable the branded send.

## Why we picked the ai-assistant Worker (and not email-router)

The ai-assistant Worker:

* Already imports `brevo.js` (so it can send through Brevo without an
  extra hop).
* Already holds `FIREBASE_SERVICE_ACCOUNT_KEY` as a secret (needed for
  the OAuth → Identity Toolkit token).
* Already exposes a public-facing fetch handler with CORS.

email-router *also* has the service-account secret, but it would have
needed a second Brevo dependency, and its primary job (handling inbound
mail) shouldn't be entangled with outbound transactional sends.

## How to test that the fix worked

1. Sign in to `https://andamanvoyages.in`, open `Forgot password?`,
   enter your email.
2. Open Gmail — the email should arrive **in the Inbox** within ~10
   seconds.
3. Sender shows as `noreply@andamanvoyages.in` (Brevo handles DKIM/SPF
   alignment so Gmail no longer flags it as spam).
4. Click *Reset password* → land on Firebase's standard reset page →
   pick a new password → redirect back to the homepage.

If you still see the email in Spam, check:

* Brevo dashboard → **Senders & domains** — `andamanvoyages.in` shows
  green ticks for SPF, DKIM, and DMARC.
* Recipient gmail user has marked previous mails from
  `<project>.firebaseapp.com` as Spam in the past — Gmail keeps a
  per-user reputation map. Ask them to mark one of the new emails
  *"Not spam"* and the next ones will land normally.