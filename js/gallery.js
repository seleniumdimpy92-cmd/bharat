/* ── gallery.js ──────────────────────────────────────────────────
   Reusable gallery module:
   - Public read of `gallery` Firestore collection (image metadata)
   - Admin upload to Firebase Storage (path: gallery/{timestamp}_{name})
   - Admin add / delete / reorder

   Depends on:
     - js/firebase-config.js (window.FIREBASE_CONFIG)
     - js/dataStore.js       (provides window.__firebaseReady,
                              which initializes app/auth/db)

   This file additionally lazy-loads firebase-storage.
   ──────────────────────────────────────────────────────────────── */

(function () {
    'use strict';

    const SDK_VERSION  = '10.13.2';
    const STORAGE_URL  = `https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-storage.js`;

    let storageModPromise = null;
    function loadStorageMod() {
        if (!storageModPromise) {
            storageModPromise = import(STORAGE_URL);
        }
        return storageModPromise;
    }

    async function getStorage() {
        const { app } = await window.__firebaseReady;
        const storageMod = await loadStorageMod();
        return { storage: storageMod.getStorage(app), storageMod };
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
                storagePath: data.storagePath || '',
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

    // ── Admin: upload a single File to Firebase Storage and create
    //          its Firestore document. Returns the new item.
    async function uploadGalleryImage(file, meta, onProgress) {
        if (!file) throw new Error('No file selected');
        if (!file.type || file.type.indexOf('image/') !== 0) {
            throw new Error('Only image files are allowed');
        }
        const { auth, db, firestore } = await window.__firebaseReady;
        if (!auth.currentUser) {
            throw new Error('You must be signed in as admin to upload');
        }

        const { storage, storageMod } = await getStorage();
        const safeName = String(file.name).replace(/[^a-zA-Z0-9._-]+/g, '_');
        const path = `gallery/${Date.now()}_${safeName}`;
        const sref = storageMod.ref(storage, path);

        const task = storageMod.uploadBytesResumable(sref, file, {
            contentType: file.type,
            cacheControl: 'public, max-age=31536000'
        });

        await new Promise((resolve, reject) => {
            task.on('state_changed',
                (snap) => {
                    if (typeof onProgress === 'function') {
                        const pct = snap.totalBytes ? (snap.bytesTransferred / snap.totalBytes) * 100 : 0;
                        onProgress(pct, snap);
                    }
                },
                (err) => reject(err),
                () => resolve()
            );
        });

        const url = await storageMod.getDownloadURL(sref);

        const docData = {
            url,
            thumbUrl: url, // could be a generated thumb later
            storagePath: path,
            title:    (meta && meta.title)    || '',
            caption:  (meta && meta.caption)  || '',
            category: (meta && meta.category) || '',
            order:    (meta && typeof meta.order === 'number') ? meta.order : 9999,
            createdAt: firestore.serverTimestamp(),
            uploadedBy: auth.currentUser.email || auth.currentUser.uid || ''
        };
        const colRef = firestore.collection(db, 'gallery');
        const docRef = await firestore.addDoc(colRef, docData);
        return { id: docRef.id, ...docData, url, thumbUrl: url, storagePath: path };
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

    // ── Admin: delete (Storage object + Firestore doc)
    async function deleteGalleryItem(item) {
        if (!item || !item.id) throw new Error('Invalid item');
        const { db, firestore } = await window.__firebaseReady;
        const { storage, storageMod } = await getStorage();

        // Delete Storage file (best-effort — ignore "not-found")
        if (item.storagePath) {
            try {
                await storageMod.deleteObject(storageMod.ref(storage, item.storagePath));
            } catch (err) {
                if (err && err.code !== 'storage/object-not-found') {
                    console.warn('Storage delete failed:', err);
                }
            }
        }
        await firestore.deleteDoc(firestore.doc(db, 'gallery', item.id));
    }

    // Expose API
    window.GalleryStore = {
        loadGalleryItems,
        uploadGalleryImage,
        updateGalleryItem,
        deleteGalleryItem
    };
})();