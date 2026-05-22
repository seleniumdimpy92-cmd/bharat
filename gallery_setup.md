# Gallery Setup Guide

A photo gallery feature has been added with admin upload via Firebase Storage and a public viewer page.

## What was added

### New files
- `gallery.html` — Public photo gallery page (with category filters & lightbox)
- `js/gallery.js` — Reusable gallery module (Storage upload + Firestore CRUD)
- `css/gallery.css` — Styles for both public and admin gallery
- `storage.rules` — Firebase Storage security rules

### Modified files
- `dashboard.html` — Added Gallery nav item + Gallery section with uploader & manager
- `js/dashboard.js` — Added "Photo Gallery" to section title map
- `index.html` — Added Gallery link in top navigation
- `firestore.rules` — Allow public read / admin write for `gallery` collection

---

## Architecture

| Layer | Used For |
|---|---|
| **Firebase Storage** (`/gallery/{timestamp}_{name}`) | The actual image binary files |
| **Firestore** (`gallery` collection) | Image metadata: URL, title, caption, category, order, createdAt |
| **Firebase Auth** | Verifies admin email before any write |

This is the recommended pattern. Images are NOT stored in Firestore documents (1 MB limit + cost).

---

## One-time setup (REQUIRED before uploads work)

### 1. Enable Firebase Storage
1. Open https://console.firebase.google.com/project/andaman-b886d/storage
2. Click **Get Started**
3. Choose **Production mode**
4. Pick a location close to your users (e.g. `asia-south1`)

### 2. Publish Storage rules
1. Open https://console.firebase.google.com/project/andaman-b886d/storage/rules
2. Open `storage.rules` from this repo and copy its contents
3. Paste into the Firebase rules editor → **Publish**

### 3. Publish Firestore rules
1. Open https://console.firebase.google.com/project/andaman-b886d/firestore/rules
2. Open `firestore.rules` from this repo and copy its contents
3. Paste → **Publish**

### 4. (Optional) Configure CORS for direct uploads
The Firebase SDK handles this automatically on `firebasestorage.googleapis.com`, so usually no extra step is needed. If you ever serve images from a custom CDN, you may need to set CORS rules using `gsutil`.

---

## How to use

### Admin: Upload an image
1. Sign in to the admin dashboard at `/dashboard.html` with an admin email (`deb@andamanvoyages.in` or `admin@admin.com`)
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
- Each uploaded card has **Edit** (prompts to update metadata) and **Delete** (removes Storage file + Firestore doc)
- Click **View** to open the original image URL in a new tab

### Public: Browse the gallery
- Visit `/gallery.html`
- Click any category chip to filter
- Click any thumbnail to open the lightbox (← → arrow keys + Esc work)

---

## Limits & costs

### Firebase free (Spark) tier
- **Storage**: 5 GB total (≈ 5,000 high-quality JPEGs)
- **Bandwidth**: 1 GB/day download (≈ 5,000 image views/day at 200 KB avg)
- **Firestore reads**: 50,000/day (the gallery loads in 1 read per page view)

### Per-image limits (enforced in `storage.rules`)
- Max file size: **10 MB**
- Allowed types: any `image/*`

If you outgrow the free tier:
1. Enable the **Blaze (pay-as-you-go)** plan — typical small-site cost is < ₹100/month
2. OR migrate images to Cloudinary / ImgKit / Bunny CDN and store only their URLs in Firestore

---

## Firestore document schema

Collection: `gallery`

```jsonc
{
  "url":         "https://firebasestorage.googleapis.com/.../beach1.jpg",
  "thumbUrl":    "https://firebasestorage.googleapis.com/.../beach1.jpg",
  "storagePath": "gallery/1716368400000_beach1.jpg",
  "title":       "Radhanagar Beach",
  "caption":     "Asia's best beach at sunset",
  "category":    "Beaches",
  "order":       1,
  "createdAt":   <Firestore Timestamp>,
  "uploadedBy":  "deb@andamanvoyages.in"
}
```

---

## Troubleshooting

**"You must be signed in as admin to upload"**
→ Log out and log back in with one of the admin emails (`window.ADMIN_EMAILS` in `js/firebase-config.js`).

**Uploads fail with `storage/unauthorized`**
→ `storage.rules` not published yet (see Step 2 above).

**Public page shows "Couldn't load gallery"**
→ Either the `gallery` collection doesn't exist yet (no images uploaded — that's fine, will show "No photos yet" instead) or the Firestore rules update hasn't been published yet.

**Image not showing after upload**
→ Click **Refresh** on the admin grid. Storage URLs are CDN-cached and should be near-instant.

---

## Future enhancements (ideas)
- Auto-generate optimized thumbnails using a Cloud Function
- Drag-to-reorder in admin grid
- Bulk select + delete
- Album/folder hierarchy
- EXIF data extraction (location, date taken)