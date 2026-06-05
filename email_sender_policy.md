# Outgoing Email — Sender Policy

This site sends mail from **exactly five official mailboxes**. Every Worker
that calls Brevo or Cloudflare Email Routing's `send_email` binding is
locked down so it can never use any other From address — even if env
vars or admin-editable Firestore settings are misconfigured.

## The 5 official mailboxes

| Mailbox | Used for |
|---|---|
| `info@andamanvoyages.in` | General mail · daily AI report from `ai-assistant` Worker |
| `booking@andamanvoyages.in` | New booking confirmations · default for the dashboard "Compose" modal |
| `cancellation@andamanvoyages.in` | Cancellation + refund correspondence |
| `enquiries@andamanvoyages.in` | `/customize` enquiry submissions · receives raw enquiry mail |
| `noreply@andamanvoyages.in` | Auto-replies fired by `email-router` Worker (so customers reply to the *correct* mailbox via Reply-To) |

These are also listed in:
- `workers/inbox-mail/wrangler.jsonc` → `vars.ALLOWED_SENDERS`
- `workers/email-router/wrangler.jsonc` → `vars.ALLOWED_INBOXES`
- `workers/customize-email/wrangler.jsonc` → `vars.ALLOWED_SENDERS`

## Defence-in-depth

Each Worker that emits mail has a **hard-coded `OFFICIAL_SENDERS`
constant** at the top of its file. The chain works like this:

```
caller (browser / cron / inbound mail)
        │
        ▼
worker code resolves a candidate "From" (env / Firestore / request body)
        │
        ▼
worker INTERSECTS that candidate against OFFICIAL_SENDERS
   │ in whitelist?     yes → use it
   │                   no  → fall back to the safest official mailbox
        │
        ▼
downstream inbox-mail/worker.js does the SAME check again
        │
        ▼
Brevo / Email Routing receives the call with a guaranteed-safe From
```

Even an attacker who somehow writes `defaultFrom: "evil@hacker.com"` into
the Firestore `/settings/inboxAutoReply` doc cannot get the system to
send from `evil@hacker.com` — both the `email-router` Worker and the
`inbox-mail` Worker would reject it.

## Files where the whitelist lives

| File | What it enforces |
|---|---|
| `workers/inbox-mail/worker.js` → `OFFICIAL_SENDERS`, `resolveAllowedSenders()`, `pickDefaultFrom()` | Master enforcement. `/send` (admin Compose) and `/internal/send` (server-to-server) both intersect the env list with this hard-coded list, then validate every request against the result. |
| `workers/email-router/worker.js` → `OFFICIAL_SENDERS` | Auto-reply From is forced to `noreply@` if the candidate (env or Firestore) isn't in the list. |
| `workers/customize-email/worker.js` → `OFFICIAL_SENDERS`, `pickSender()` | `/customize` enquiry email FROM falls back to `enquiries@` if FROM_EMAIL env is misconfigured. |
| `workers/ai-assistant/brevo.js` → `OFFICIAL_SENDERS`, `ensureOfficial()` | Daily AI report falls back to `info@` if REPORT_FROM_EMAIL env is misconfigured. |

## Adding a new mailbox

If you ever add a 6th official mailbox (say, `support@andamanvoyages.in`),
do **all** of these in one PR:

1. Cloudflare → Email → Email Routing → add the address as a destination
   and verify it.
2. Brevo → Senders & IP → add the address as a verified sender (DKIM
   record will auto-resolve via your domain's existing DKIM keys).
3. Update the `OFFICIAL_SENDERS` constant **in all four files**:
   - `workers/inbox-mail/worker.js`
   - `workers/email-router/worker.js`
   - `workers/customize-email/worker.js`
   - `workers/ai-assistant/brevo.js`
4. Update the `ALLOWED_SENDERS` / `ALLOWED_INBOXES` env var in the
   matching `wrangler.jsonc` files (3 of them).
5. Update the table at the top of this document.
6. Redeploy each Worker:
   ```bash
   cd workers/inbox-mail && npx wrangler deploy
   cd workers/email-router && npx wrangler deploy
   cd workers/customize-email && npx wrangler deploy
   cd workers/ai-assistant && npx wrangler deploy
   ```

## Why the redundancy?

- **`ALLOWED_SENDERS` env var** is convenient for narrowing the list per
  environment (e.g. only `noreply@` in staging) without code changes.
- **`OFFICIAL_SENDERS` const** is the immutable backstop — env vars can
  be misconfigured, Firestore settings can be tampered with, but the
  hard-coded list ships with the deploy and is always authoritative.

The intersection of these two means env can only **narrow** the list,
never **widen** it.

## Verifying the policy is active

After any deploy, hit the health endpoints:

```bash
curl https://email-router.<your-account>.workers.dev/health
curl https://inbox-mail.<your-account>.workers.dev/
```

Then exercise each path:

| Path | Test |
|---|---|
| `/customize` form | submit a test enquiry from the website → check Gmail inbox for `From: enquiries@andamanvoyages.in` |
| Dashboard Compose | log in as admin → Compose → send to your personal email → confirm `From: booking@andamanvoyages.in` (or whichever you picked) |
| Inbound auto-reply | from a personal Gmail, send to `info@andamanvoyages.in` → reply lands within 30s `From: noreply@andamanvoyages.in` with `Reply-To: info@andamanvoyages.in` |
| Daily AI report | trigger manually with `curl -X POST https://ai-assistant.<acct>.workers.dev/generate-report` → email arrives `From: info@andamanvoyages.in` |

If any of those show a different From, the whitelist intersection
caught the misconfig and fell back. Check `wrangler tail <worker>` for
the `[worker-name]: From "X" not in OFFICIAL_SENDERS — falling back…`
warning to see what was attempted.