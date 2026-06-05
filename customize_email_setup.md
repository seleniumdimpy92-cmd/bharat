# /customize Page — Email Send Setup

The `/customize` page sends enquiries directly from the browser. It tries 4 senders in order, using the first one that's configured AND succeeds:

1. **Cloudflare Email Worker** ⭐ recommended — uses Cloudflare Email Routing's `send_email` binding. Free, no SMTP creds, no monthly limit.
2. **EmailJS** — browser-only, free 200 emails/month.
3. **Firestore `mail/{ref}`** — needs Firebase Trigger Email extension (Blaze plan).
4. **`mailto:`** — last-resort fallback that opens the user's email client.

**Pick ONE of the first three.** If you don't, the page still works (via mailto) but pops up the user's email client — which is what you wanted to avoid.

---

## Option 1 — Cloudflare Email Worker (recommended)

This is what the user pasted earlier:

```js
export default {
  async email(message, env, ctx) { ... }
};
```

You're already on Cloudflare. Setup is ~10 minutes.

### Prereqs

- Domain (`andamanvoyages.in`) on Cloudflare with Email Routing already enabled.
- A verified sending address e.g. `enquiries@andamanvoyages.in` (Email Routing → **Routes** → add destination address and verify).

### Deploy steps

```bash
cd workers/customize-email
npm install
npx wrangler login
npx wrangler deploy
```

After the first deploy, open the worker in the Cloudflare dashboard:

1. **Workers & Pages → customize-email → Settings → Variables → Bindings**
2. Click **Add binding → Send email**
   - Variable name: `SEND_EMAIL`
   - Destination address: `booking@andamanvoyages.in`
3. (Optional) **Settings → Variables and Secrets → Add secret**
   - Name: `SHARED_TOKEN`, Value: any long random string. Then put the same value in `customize.html` → `window.CZ_WORKER_TOKEN`. This stops random bots from POSTing to your worker URL.
4. Copy the worker's URL (something like `https://customize-email.YOURACCOUNT.workers.dev`).
5. Open `customize.html`, paste the URL into:

   ```html
   window.CZ_WORKER_URL = "https://customize-email.YOURACCOUNT.workers.dev";
   ```

6. Commit + push.

### Test

1. Open https://andamanvoyages.in/customize while signed in.
2. Fill the form, click **Send Enquiry**.
3. Check `booking@andamanvoyages.in` — beautifully-formatted HTML email arrives.
4. The user (CC) gets a copy too.

### How the worker is wired

Files live in `workers/customize-email/`:

| File | Purpose |
|---|---|
| `worker.js` | Validates origin + token + payload, builds RFC-822 MIME via `mimetext`, sends via `env.SEND_EMAIL.send()`. |
| `wrangler.toml` | Bindings + ALLOWED_ORIGIN var. |
| `package.json` | `mimetext` dep + wrangler dev deps. |

Key features:
- **CORS allow-list** — only `https://andamanvoyages.in` can POST. Random sites can't abuse it.
- **Optional shared token** — extra abuse defence via `x-cz-token` header.
- **Validates payload shape** — rejects malformed enquiries.
- **HTML + plain-text alternative** — every mail client renders correctly.
- **Reply-To = user's email** — replying just works.
- **CC = user's email** — they get an automatic copy.

---

## Option 2 — EmailJS (no Cloudflare needed)

Use this if you don't want to deal with Cloudflare Workers.

1. Sign up at **https://www.emailjs.com/** (free).
2. **Email Services** → Add Gmail → connect `booking@andamanvoyages.in` → copy **Service ID**.
3. **Email Templates** → New:
   - Subject: `{{subject}}`
   - To Email: `{{to_email}}`
   - Reply-To: `{{reply_to}}`
   - CC: `{{cc}}`
   - Body (Code mode): `{{{message_html}}}` ← **triple braces** so HTML renders.
   - Save → copy **Template ID**.
4. **Account → API Keys** → copy **Public Key**.
5. Open `customize.html`, paste them into the `EMAILJS_CONFIG` block.
6. Commit + push.

Free tier: 200 emails/month.

---

## Option 3 — Firebase Trigger Email extension

Requires Firebase **Blaze** (pay-as-you-go) plan.

1. Firebase Console → **Firestore → Rules → Publish** (rules in this repo are already updated for `mail/{ref}`).
2. **Extensions** → Install **"Trigger Email from Firestore"**.
3. Configure:
   - SMTP connection URI (e.g. Gmail App Password or SendGrid)
   - Email documents collection: `mail`
   - Default `from`: `Andaman Voyages <booking@andamanvoyages.in>`

The page will write a doc to `mail/{ref}`; the extension reads it and dispatches the email via the configured SMTP.

---

## Common gotchas

| Symptom | Cause | Fix |
|---|---|---|
| Toast "Network issue — opening your email client as a backup" | None of the 3 senders are configured | Pick Option 1, 2, or 3 above. |
| Worker returns 403 "origin not allowed" | Wrong `ALLOWED_ORIGIN` in `wrangler.toml` | Should match exactly the page origin (e.g. `https://andamanvoyages.in`). |
| Worker returns 401 "unauthorized" | `SHARED_TOKEN` set on worker but `CZ_WORKER_TOKEN` empty/wrong on page | Either set both to the same value, or remove the secret. |
| Worker `SEND_EMAIL.send()` throws "destination address not verified" | The destination address (`booking@…`) must be a verified Email Routing destination | Cloudflare → Email Routing → Routes → add and verify. |
| EmailJS returns 412 Precondition Failed | Domain not whitelisted | EmailJS → Account → Security → enable "Allow EmailJS API" or whitelist `andamanvoyages.in`. |
| Email lands in spam | Sender domain not authenticated | Add SPF + DKIM for `andamanvoyages.in` in DNS (Cloudflare auto-suggests these for Email Routing). |
| Want to remove the user CC | Privacy/volume | In `js/customize.js` `sendViaWorker`, the worker handles CC — edit `worker.js` to remove the `setCc()` line; for EmailJS, blank the `cc` field. |