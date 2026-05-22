# Gallery Setup Guide (Cloudinary + Firestore)

A photo gallery feature has been added with admin upload via **Cloudinary** (free 25 GB) and a public viewer page backed by Firebase Firestore for metadata.

> **Why Cloudinary instead of Firebase Storage?** Firebase Storage now requires the paid Blaze plan with a credit card. Cloudinary's free tier is **5× bigger (25 GB)**, requires no card, and includes a CDN + on-the-fly image optimization (auto WebP, auto-resize). Firebase Spark plan stays untouched.

---

## Architecture

| Layer | Used For |
|---|---|
| **Cloudinary** (`gallery/...` folder, optional) | The actual image binary files + CDN delivery + auto-optimization |
| **Firebase Firestore** (`gallery` collection) | Image metadata: URL, public_id, title, caption, category, order, createdAt |
| **Firebase Auth** | Verifies admin email before any Firestore write |

The browser uploads directly to Cloudinary using an **Unsigned Upload Preset** — no server, no API secret in the browser.

---

## One-time setup (REQUIRED — ~2 minutes)

### Step 1 — Create a free Cloudinary account
1. Go to https://cloudinary.com/users/register_free
2. Sign up with email — **no credit card required**
3. Skip the "personalize" questions to land on the dashboard

### Step 2 — Note your Cloud Name
- Top-left of the dashboard: **`Cloud name: xxxxxx`** (e.g. `dxyz12abc`)
- Copy this value

### Step 3 — Create an Unsigned Upload Preset
1. Click the **gear icon** (Settings) → **Upload** tab
2. Scroll to **Upload presets** → click **Add upload preset**
3. Configure:
   - **Preset name**: `andaman_gallery` (must match the value below)
   - **Signing Mode**: change from "Signed" to **Unsigned** ✅
   - **Folder** *(optional but recommended)*: `gallery`
   - **Allowed formats** *(optional)*: `jpg, jpeg, png, webp, gif`
4. Click **Save**

### Step 4 — Plug values into the site
Open `js/firebase-config.js` and update:

```js
window.CLOUDINARY_CONFIG = {
    cloudName:    "REPLACE_WITH_YOUR_CLOUD_NAME",   // ← from Step 2
    uploadPreset: "andaman_gallery"                  // ← from Step 3 (only change if different)
};
```

Commit + push, and uploads will start working. **No Firebase Storage activation needed.**

### Step 5 — Publish updated Firestore rules (one-time)
The `gallery` Firestore collection needs public-read / admin-write rules. Already in `firestore.rules`:

1. Open https://console.firebase.google.com/project/andaman-b886d/firestore/rules
2. Copy contents of `firestore.rules` from this repo
3. Paste → **Publish**

> The `storage.rules` file in the repo is **no longer used** (kept only as a backup option in case you ever switch back to Firebase Storage). You can ignore it.

---

## How to use

### Admin: Upload an image
1. Sign in to `/dashboard.html` with an admin email (`deb@andamanvoyages.in` or `admin@admin.com`)
2. Click **Gallery** in the top nav
3. Either:
   - Click the dropzone to choose files, **OR**
   - Drag & drop one or more images
4. Fill in optional metadata:
   - **Title** — shown as the caption tile and lightbox label
   - **Caption** — extra description in lightbox
   - **Category** — used for filter chips on the public page (e.g. Beaches, Islands, Activities)
   - **Order** — lower numbers appear first; same-order items sort by upload time (newest first)
5. Click **Upload** — progress bar shows realtime upload state

### Admin: Edit / Delete
- Each uploaded card has **Edit** (prompts to update metadata) and **Delete** (removes from Firestore)
- **Note**: Delete only removes the entry from your site. The actual image stays in your Cloudinary library (orphan cleanup below).
- Click **View** to open the original Cloudinary URL in a new tab

### Public: Browse the gallery
- Visit `/gallery.html`
- Click any category chip to filter
- Click any thumbnail to open the lightbox (← → arrow keys + Esc work)

---

## Cleaning up orphaned Cloudinary assets

When you delete from the admin panel, the Firestore doc goes but the Cloudinary file remains (browsers can't safely delete signed assets).

To clean up orphans:
1. Open https://cloudinary.com/console/media_library
2. In the search bar, type the tag: `tags:andaman_gallery`
3. Delete unwanted assets manually

For a typical small site this rarely matters — even 1,000 orphaned 1 MB files only use 1 GB of your 25 GB free quota.

---

## Limits & costs (Cloudinary free tier)

| Resource | Free Quota |
|---|---|
| Storage | **25 GB** |
| Monthly bandwidth | **25 GB** |
| Transformations (resize, format conversion) | **25,000/month** |
| Max file size per upload | **10 MB** (configurable in your preset) |

Comparison to other options:
- Firebase Storage free tier: **0 GB** (Blaze plan required, card on file)
- ImgBB free: 32 MB/file, no transformations, ads on free tier
- Imgur free: deprecated for app uploads in 2024

---

## Firestore document schema

Collection: `gallery`

```jsonc
{
  "url":        "https://res.cloudinary.com/<cloud>/image/upload/v1716368.../gallery/abc.jpg",
  "thumbUrl":   "https://res.cloudinary.com/<cloud>/image/upload/w_600,c_fill,f_auto,q_auto/gallery/abc",
  "publicId":   "gallery/abc",
  "title":      "Radhanagar Beach",
  "caption":    "Asia's best beach at sunset",
  "category":   "Beaches",
  "order":      1,
  "width":      4000,
  "height":     3000,
  "format":     "jpg",
  "bytes":      1483920,
  "createdAt":  <Firestore Timestamp>,
  "uploadedBy": "deb@andamanvoyages.in"
}
```

---

## Troubleshooting

**"Cloudinary cloudName is not set"**
→ You haven't filled in `window.CLOUDINARY_CONFIG.cloudName` in `js/firebase-config.js`. See Step 4 above.

**"Cloudinary: Upload preset not found"**
→ Either the preset name in `firebase-config.js` doesn't match exactly, or you forgot to set it to **Unsigned** in Cloudinary settings.

**"Cloudinary: Upload preset must be whitelisted for unsigned uploads"**
→ Open the preset in Cloudinary settings and change **Signing Mode** to **Unsigned**.

**"You must be signed in as admin to upload"**
→ Log in via the dashboard with one of the admin emails listed in `js/firebase-config.js → window.ADMIN_EMAILS`.

**Public page shows "Couldn't load gallery"**
→ Either the `gallery` collection doesn't exist yet (no images uploaded — that's fine, will show "No photos yet" instead) or the Firestore rules update from Step 5 hasn't been published.

**Image uploads but doesn't show in the grid**
→ Click **Refresh** on the admin grid. Cloudinary URLs are CDN-cached and should be near-instant.

---

## Why this design is robust

- ✅ **No vendor lock-in** — `publicId` is stored, you can switch CDNs by re-rendering URLs
- ✅ **Auto-optimization** — `f_auto,q_auto` in thumb URLs auto-converts to WebP for modern browsers (~50% smaller files)
- ✅ **Responsive thumbnails** — change `w_600` to `w_400` etc. via `GalleryStore.buildCloudinaryUrl()` for retina/srcset
- ✅ **Public Firestore reads work without auth** — public Gallery page loads instantly
- ✅ **Admin upload doesn't expose secrets** — unsigned preset can only upload, not read or delete other assets

---

## Future enhancements (ideas)
- Generate srcset thumbnails (200/400/800/1200 widths) for retina + responsive
- Drag-to-reorder in admin grid
- Bulk select + delete (Firestore batch + Cloudinary bulk delete via signed Cloud Function)
- Album/folder hierarchy (just add a `album` field to the schema)
- EXIF data extraction (Cloudinary returns this in the upload response)