# Adding `enquiries@andamanvoyages.in` to the dashboard inbox

The code is done — but for new mail to land in the dashboard's
**Enquiries** tab (instead of just being forwarded to Gmail), you have
to do **two manual steps** in Cloudflare + redeploy the Worker.

This is identical to the original setup we did for booking@ / info@ /
cancellation@; it's just one more rule.

---

## Step 1 — Redeploy the email-router Worker

`workers/email-router/wrangler.jsonc` was just updated to include
`enquiries@andamanvoyages.in` in `ALLOWED_INBOXES`. The Worker won't
accept the new address until it's redeployed.

```bash
cd workers/email-router
npx wrangler deploy
```

You should see something like:

```
Total Upload: 1234.56 KiB / gzip: 234.56 KiB
Uploaded email-router (X.XX sec)
Deployed email-router triggers (Y.YY sec)
  https://email-router.<your-account>.workers.dev
Current Version ID: abcd1234-...
```

Same for the outbound Worker so admins can also send AS enquiries@:

```bash
cd ../inbox-mail
npx wrangler deploy
```

---

## Step 2 — Add the Cloudflare routing rule

This is the step that's currently missing — your existing `enquiries@`
rule forwards to Gmail only. We need to **also** fire the Worker so the
mail is mirrored into Firestore.

1. Cloudflare dashboard → select **andamanvoyages.in**.
2. Left sidebar → **Email** → **Email Routing**.
3. Open the **Routes** tab.
4. Find the rule for `enquiries@andamanvoyages.in` (or click **Create
   rule** if it doesn't exist yet).
5. Edit it so the actions look like this:

   | # | Action | Value |
   |---|---|---|
   | 1 | **Send to a Worker** | `email-router` |
   | 2 | (optional) **Send to an email** | `debjyoti.office@gmail.com` |

   The order doesn't matter; both actions fire. Action 1 is what makes
   the mail appear in the dashboard. Action 2 keeps your Gmail copy.

6. Save.

That's it — the next email sent to `enquiries@andamanvoyages.in` should
land in the dashboard's **Enquiries** tab within a second or two, AND
still arrive in Gmail.

---

## Step 3 — (Optional) Verify enquiries@ as a Brevo sender

Only needed if you want to **send replies AS** `enquiries@` from the
dashboard's Compose modal.

1. Open https://app.brevo.com/senders/list
2. Click **Add a Sender**.
3. From-name: `Bharat Tours & Travels`, From-email: `enquiries@andamanvoyages.in`.
4. Click the verification link Brevo emails to that address. (The
   Cloudflare rule from Step 2 will route the verification email
   straight to your Gmail, so you can click the link from there.)
5. Once Brevo shows it as **Verified ✓**, the Compose dropdown's
   "Enquiries" option will work the same as the other three.

---

## Quick smoke-test after Steps 1 + 2

```bash
# Send a test email from anywhere (your own Gmail is fine)
to:      enquiries@andamanvoyages.in
subject: test from Gmail
body:    hello
```

Within 2-3 seconds:

* Dashboard's **Enquiries** count tab badge should jump to **1**
* The Inbox topnav icon should show a red **1** badge
* You should hear the new-mail beep and see a toast "New mail in Enquiries: test from Gmail"
* Clicking the row sets `unread:false` (counter drops to 0)

If it doesn't work:

* `npx wrangler tail email-router` while you send the test — you'll see
  the request log, including any "recipient not in ALLOWED_INBOXES" errors
  (means Step 1 wasn't deployed) or "Send to a Worker" not configured
  (means Step 2 wasn't saved).
* Confirm `cd workers/email-router && cat wrangler.jsonc | grep ALLOWED_INBOXES`
  contains `enquiries@andamanvoyages.in`.