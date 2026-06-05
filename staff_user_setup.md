# Staff user — setup guide

This site supports two privileged roles, hard-coded by email allowlist in
`js/firebase-config.js` and mirrored in `firestore.rules`:

| Role     | Email allowlist (in `firebase-config.js`) | What they can do                                                                 |
|----------|-------------------------------------------|----------------------------------------------------------------------------------|
| `admin`  | `window.ADMIN_EMAILS`                     | Everything (current behaviour, unchanged)                                        |
| `staff`  | `window.STAFF_EMAILS`                     | Open `/dashboard`, **only Packages + Gallery sections**.<br>• Edit existing packages. Cannot **add** or **delete** packages.<br>• Upload new gallery photos with all metadata fields **required**.<br>• Edit existing photos. Cannot delete photos. |
| everyone else | – | Browse + book; no dashboard access.                                          |

The current staff allowlist contains exactly one address:

```js
// js/firebase-config.js
window.STAFF_EMAILS = [
    "pittu.das2@gmail.com"
];
```

…which **must** match the staff allowlist inside `firestore.rules`:

```
function isStaff() {
  return request.auth != null
    && request.auth.token.email in [
      "pittu.das2@gmail.com"
    ];
}
```

If you change the staff email, change it in BOTH files and re-publish the rules.

---

## How to create the staff account (one-time)

Because Firebase Auth doesn't allow client-side admin SDK calls, the staff user is created the
exact same way a customer is — by signing up via the website's "Register" form.

### Step 1 — Make sure mail can reach `pittu.das2@gmail.com`

Firebase will send an **email-verification link** to the staff address as soon as you register
the account. So you need that mailbox to actually deliver mail to a real inbox first:

1. Cloudflare → andamanvoyages.in → **Email** → **Email Routing** → **Routes** tab.
2. Under **Custom addresses**, click **Create address**:
   - **Custom address:** `staff`
   - **Action:** *Send to an email address*
   - **Destination address:** any inbox you control (e.g. your existing Gmail). It must be a
     **Verified** destination — if it isn't, click **Destination addresses** first and verify it.
3. Save. Test by sending yourself an email to `pittu.das2@gmail.com` and confirming it lands.

### Step 2 — Register the account on the website

1. Open `https://andamanvoyages.in/` in an **incognito** window (so you don't disturb your
   admin session).
2. Click **Sign Up**.
3. Fill in the form:
   - **Full name:** `Andaman Voyages Staff` (or whatever you like)
   - **Username:** `staff` (3+ characters; this is what they'll log in with)
   - **Email:** `pittu.das2@gmail.com`
   - **Phone:** any valid number
   - **Password:** set a strong password and store it in a password manager
4. Submit. You'll see *"Registration successful — verification email sent."*
5. Open the inbox (the Gmail you forwarded `staff@…` to) → click the **Verify your email**
   link from Firebase. Done.

### Step 3 — Test

1. Log out of admin.
2. Log in with `staff` / your-staff-password.
3. The top nav now shows a **Dashboard** link. Click it. You should see:
   - **Sidebar:** only Packages and Gallery (everything else hidden).
   - **Top-right corner:** username with a small **STAFF** badge.
   - **Packages section:** the *Add Package*, *Seed Sample Packages*, *Save & Publish*, and per-card
     *Delete* buttons are gone. Per-card *Edit* / *Save* still works.
   - **Gallery section:** all upload fields (Title, Category, Date, Place, Package) are red-tinted
     and the **Upload** button stays disabled until they're all filled. Per-photo *Delete* button
     is hidden; *Edit* / *View* still work.

If anything is wrong (e.g. the staff user can still see Bookings or delete a package), the most
likely cause is that the email allowlist drift between `js/firebase-config.js` and
`firestore.rules` — re-publish the rules in the Firebase console.

---

## Day-to-day: rotating / removing the staff user

- **Forgot password** — use the public *Forgot username or password?* link at login. The reset
  link goes to `pittu.das2@gmail.com`.
- **Disable the staff account** — log in as admin → **Customers** tab → find the staff row →
  click the **Disable** button. Their next login is rejected with *"This account has been
  disabled. Please contact support."*
- **Permanently remove staff privileges** — remove the email from BOTH:
  1. `window.STAFF_EMAILS` in `js/firebase-config.js` (commit + push)
  2. The `isStaff()` allowlist in `firestore.rules` (publish in Firebase console)
  
  After both are deployed, the staff user is just a regular customer.

---

## Where the rules are enforced

| Layer | File | Purpose |
|---|---|---|
| Server-side (authoritative) | `firestore.rules` | The only thing that **actually** stops a malicious staff user from deleting a package via DevTools. |
| Client-side helpers | `js/dataStore.js` | `UsersStore.isAdmin()`, `UsersStore.isStaff()`, `UsersStore.canAccessDashboard()`. |
| Client-side UI | `js/auth.js` | Hides the *Dashboard* nav link for non-admin/non-staff users. |
| Page UI gates | `dashboard.html` | Hides admin-only sections and per-package / per-photo delete buttons; makes upload fields required. |

If you ever need a 3rd role (e.g. `manager`, `agent`), just clone the staff plumbing — there's
nothing magical about the name.
---

## Changelog — May 2026 (package save + upload-dialog refactor)

Two UX issues were fixed for staff users:

### 1. Staff can now use **Save & Publish** on the Packages tab

Previously, clicking **Save & Publish** as a staff user threw
*"Only an admin user can publish packages."* `js/dataStore.js → publishPackages()`
now branches on role:

- **Admin path** (unchanged) — full write: every package is `set()` and
  any package missing from the in-memory list is `delete()`-d.
- **Staff path** (new) — `update()`-only on packages whose id already
  exists in Firestore. Anything brand-new in the staff's working copy
  is silently skipped (Firestore rules would reject the create anyway).
  No deletes are ever issued.

A successful staff save shows a banner like:
*"✅ Saved! 3 package(s) updated and live globally."*

If staff somehow accumulate brand-new package objects (e.g. via a
restored cache from the public site), the banner adds:
*"… N new package(s) were skipped — ask an admin to add them."*

### 2. Image upload — modal dialog instead of a silently-disabled button

Previously, the Upload button stayed locked while any of the five
mandatory fields (Title, Category, Date, Place, Package) was empty,
and there was no in-page guidance about *which* field was missing.

Now:

- The Upload button **enables as soon as files are picked** (regardless
  of whether tags are filled). It tints amber while tags are still empty
  to signal "you'll be asked for more info on click".
- Clicking it without all required fields opens a **modal dialog** that
  lists the missing fields by name and offers a **"Fill them now"**
  button that scrolls + focuses + flashes the first empty field.
- The validation runs for **both admin and staff** — admins get the
  same dialog, so the public gallery never receives photos missing
  the trip-grouping tags.

Frontend wiring lives in `dashboard.html` (inline gallery script) plus
two CSS hooks in `css/gallery.css`:

- `.admin-gallery-upload-btn.upload-needs-fields` — amber gradient
- `@keyframes agf-field-flash-anim` + `.agf-field-flash` — 1.4s pulse
  on the field that the dialog jumped focus to.

Cache versions bumped: `js/dataStore.js?v=27`, `js/dashboard.js?v=25`,
`css/gallery.css?v=5`.
