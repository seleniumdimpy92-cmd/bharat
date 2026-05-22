/* ── gallery.js ──────────────────────────────────────────────────
   Reusable gallery module:
   - Public read of `gallery` Firestore collection (image metadata)
   - Admin upload to **Cloudinary** (free 25 GB tier, no credit card)
   - Admin add / delete / update

   Architecture:
     - Cloudinary stores the actual image binary + serves it via CDN
     - Firestore stores the metadata (URL, title, caption, category, order)
     - We use an UNSIGNED upload preset so the browser can upload directly
       without ever exposing the API secret.

   Depends on:
     - js/firebase-config.js  (window.FIREBASE_CONFIG, window.CLOUDINARY_CONFIG)
     - js/dataStore.js        (provides window.__firebaseReady)
   ──────────────────────────────────────────────────────────────── */

(function () {
    'use strict';

    function getCloudinaryCfg() {
        const cfg = window.CLOUDINARY_CONFIG || {};
        if (!cfg.cloudName || cfg.cloudName === 'REPLACE_WITH_YOUR_CLOUD_NAME') {
            throw new Error('Cloudinary cloudName is not set. Edit js/firebase-config.js → window.CLOUDINARY_CONFIG.');
        }
        if (!cfg.uploadPreset) {
            throw new Error('Cloudinary uploadPreset is not set. Edit js/firebase-config.js → window.CLOUDINARY_CONFIG.');
        }
        return cfg;
    }

    // ── Public: load all gallery items (sorted by `order`, then createdAt desc)
    async function loadGalleryItems() {
        const { db, firestore } = await window.__firebaseReady;
        const colRef = firestore.collection(db, 'gallery');
        const snap = await firestore.getDocs(colRef);
        const items = [];
        snap.forEach(d => {
            const data = d.data() || {};
            items.push({
                id: d.id,
                url: data.url || '',
                thumbUrl: data.thumbUrl || data.url || '',
                title: data.title || '',
                caption: data.caption || '',
                category: data.category || '',
                order: typeof data.order === 'number' ? data.order : 9999,
                publicId: data.publicId || '',          // Cloudinary public_id
                storagePath: data.storagePath || '',    // legacy (Firebase Storage)
                createdAt: data.createdAt || null
            });
        });
        items.sort((a, b) => {
            if (a.order !== b.order) return a.order - b.order;
            const ta = a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0;
            const tb = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0;
            return tb - ta;
        });
        return items;
    }

    // ── Helper: build a Cloudinary URL with transforms (e.g. resize)
    //   transform examples:
    //     'f_auto,q_auto'           → auto format + quality (recommended default)
    //     'w_400,c_fill,f_auto'     → 400px width thumbnail
    //     'w_1600,c_limit,f_auto'   → high-res with cap
    function buildCloudinaryUrl(publicId, transform) {
        const { cloudName } = getCloudinaryCfg();
        const t = transform ? `${transform}/` : '';
        return `https://res.cloudinary.com/${cloudName}/image/upload/${t}${publicId}`;
    }

    // ── Admin: upload a single File to Cloudinary, then create the
    //          Firestore metadata document. Returns the new item.
    async function uploadGalleryImage(file, meta, onProgress) {
        if (!file) throw new Error('No file selected');
        if (!file.type || file.type.indexOf('image/') !== 0) {
            throw new Error('Only image files are allowed');
        }

        const { auth, db, firestore } = await window.__firebaseReady;
        if (!auth.currentUser) {
            throw new Error('You must be signed in as admin to upload');
        }

        const { cloudName, uploadPreset } = getCloudinaryCfg();
        const endpoint = `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`;

        // Use XMLHttpRequest so we can track upload progress (fetch() can't)
        const cloudinaryRes = await new Promise((resolve, reject) => {
            const form = new FormData();
            form.append('file', file);
            form.append('upload_preset', uploadPreset);
            // Optional: tag uploads so they're easy to find/manage in Cloudinary
            form.append('tags', 'andaman_gallery');

            const xhr = new XMLHttpRequest();
            xhr.open('POST', endpoint);

            xhr.upload.onprogress = (e) => {
                if (typeof onProgress === 'function' && e.lengthComputable) {
                    onProgress((e.loaded / e.total) * 100, e);
                }
            };
            xhr.onload = () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    try { resolve(JSON.parse(xhr.responseText)); }
                    catch (err) { reject(new Error('Cloudinary returned invalid JSON')); }
                } else {
                    let msg = 'Cloudinary upload failed (' + xhr.status + ')';
                    try {
                        const j = JSON.parse(xhr.responseText);
                        if (j && j.error && j.error.message) msg = 'Cloudinary: ' + j.error.message;
                    } catch (_) {}
                    reject(new Error(msg));
                }
            };
            xhr.onerror = () => reject(new Error('Network error contacting Cloudinary'));
            xhr.send(form);
        });

        // Cloudinary response keys we use:
        //   secure_url   → CDN HTTPS URL
        //   public_id    → asset id (used to delete or transform later)
        //   format       → e.g. "jpg", "webp"
        //   width/height → original dimensions
        const url = cloudinaryRes.secure_url;
        const publicId = cloudinaryRes.public_id;

        // Build a 600px-wide auto-optimized thumbnail URL
        const thumbUrl = buildCloudinaryUrl(publicId, 'w_600,c_fill,f_auto,q_auto');

        const docData = {
            url,
            thumbUrl,
            publicId,
            title:    (meta && meta.title)    || '',
            caption:  (meta && meta.caption)  || '',
            category: (meta && meta.category) || '',
            order:    (meta && typeof meta.order === 'number') ? meta.order : 9999,
            width:    cloudinaryRes.width  || null,
            height:   cloudinaryRes.height || null,
            format:   cloudinaryRes.format || '',
            bytes:    cloudinaryRes.bytes  || 0,
            createdAt: firestore.serverTimestamp(),
            uploadedBy: auth.currentUser.email || auth.currentUser.uid || ''
        };
        const colRef = firestore.collection(db, 'gallery');
        const docRef = await firestore.addDoc(colRef, docData);
        return { id: docRef.id, ...docData };
    }

    // ── Admin: update metadata only (title/caption/category/order)
    async function updateGalleryItem(id, patch) {
        const { db, firestore } = await window.__firebaseReady;
        const ref = firestore.doc(db, 'gallery', id);
        const allowed = {};
        ['title', 'caption', 'category', 'order'].forEach(k => {
            if (patch && Object.prototype.hasOwnProperty.call(patch, k)) {
                allowed[k] = patch[k];
            }
        });
        allowed.updatedAt = firestore.serverTimestamp();
        await firestore.updateDoc(ref, allowed);
    }

    // ── Admin: delete (Firestore doc only).
    //
    // NOTE: Cloudinary deletes require a signed call with API secret, which
    // we cannot do safely from a browser. The Firestore doc is removed so
    // the asset disappears from the public site immediately. The actual
    // Cloudinary file remains in your media library and can be cleaned up
    // periodically using:
    //   - Cloudinary dashboard → Media Library → search by tag "andaman_gallery"
    //   - OR a server-side cleanup script (not included)
    //
    // For typical use this is fine — orphan assets just consume a tiny bit
    // of your free 25 GB quota.
    async function deleteGalleryItem(item) {
        if (!item || !item.id) throw new Error('Invalid item');
        const { db, firestore } = await window.__firebaseReady;
        await firestore.deleteDoc(firestore.doc(db, 'gallery', item.id));
    }

    // Expose API
    window.GalleryStore = {
        loadGalleryItems,
        uploadGalleryImage,
        updateGalleryItem,
        deleteGalleryItem,
        buildCloudinaryUrl
    };
})();