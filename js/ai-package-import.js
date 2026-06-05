/* ── ai-package-import.js — admin uploads a brochure → AI creates a package
 *
 * Adds a "📄 Upload Brochure (AI)" button to the dashboard's Packages tab
 * (admin-only). Click → file picker → upload to Cloudinary → call the
 * ai-assistant Worker's POST /extract-package → preview modal lets the
 * admin review/edit the extracted fields → click "Create Package" →
 * appends a new package doc to Firestore (does NOT modify existing ones).
 *
 * Requires:
 *   - window.AI_ASSISTANT_WORKER_URL (set in dashboard.html)
 *   - window.PackagesStore (for the publish call)
 *   - window.__firebaseReady   (for fresh ID token on the worker call)
 *   - Cloudinary unsigned preset 'andaman_unsigned' (re-used from gallery)
 */
(function () {
    'use strict';

    if (window.__dashRole !== 'admin') return; // hard-gate to admins

    /* Pulls credentials from the SAME window.CLOUDINARY_CONFIG that
     * js/gallery.js uses (set in js/firebase-config.js). Falls back to
     * empty so the upload step surfaces a clear error if it's missing
     * instead of POST-ing to a wrong cloud. */
    function cloudinaryCfg() {
        var c = window.CLOUDINARY_CONFIG || {};
        return {
            cloud:  String(c.cloudName || c.cloud || '').trim(),
            preset: String(c.uploadPreset || c.preset || '').trim(),
            folder: 'package-brochures'
        };
    }

    function workerUrl() {
        var u = String(window.AI_ASSISTANT_WORKER_URL || '').trim();
        return u ? u.replace(/\/+$/, '') : '';
    }

    function escHtml(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
        });
    }
    function toast(msg, kind) {
        if (window.Toast && window.Toast[kind || 'info']) { window.Toast[kind || 'info'](msg); return; }
        if (window.showToast) { window.showToast(msg, kind || 'info'); return; }
        console.log('[ai-pkg]', msg);
    }
    async function getIdToken() {
        try {
            if (window.__firebaseReady) {
                var fb = await window.__firebaseReady;
                if (fb && fb.auth && fb.auth.currentUser) return await fb.auth.currentUser.getIdToken();
            }
        } catch (_) {}
        return null;
    }

    /* ── Inject the trigger button in the Packages section header ── */
    function injectButton() {
        var hdr = document.querySelector('#section-packages .section-header .section-actions');
        if (!hdr || document.getElementById('aiPkgImportBtn')) return;
        var btn = document.createElement('button');
        btn.id = 'aiPkgImportBtn';
        btn.className = 'btn-add-package';
        btn.style.background = 'linear-gradient(135deg,#8e44ad,#3498db)';
        btn.title = 'Upload a PDF brochure or image — AI extracts the package';
        btn.innerHTML = '<i class="fas fa-wand-magic-sparkles"></i> AI Import (PDF/Image)';
        btn.addEventListener('click', openFilePicker);
        // Insert before the publish button so it sits next to "Add Package"
        var publishBtn = document.getElementById('publishBtn');
        if (publishBtn && publishBtn.parentNode === hdr) hdr.insertBefore(btn, publishBtn);
        else hdr.appendChild(btn);
    }

    /* ── File picker (one-shot input) ──
     * Accepts images AND PDFs. PDFs are auto-converted client-side
     * to an image of page 1 via PDF.js (loaded on demand from CDN),
     * so the rest of the pipeline (LLaVA + image-only Cloudinary
     * preset) doesn't need to change. */
    function openFilePicker() {
        var inp = document.createElement('input');
        inp.type = 'file';
        inp.accept = 'image/png,image/jpeg,image/webp,image/gif,image/heic,image/heif,application/pdf';
        inp.style.display = 'none';
        document.body.appendChild(inp);
        inp.addEventListener('change', function () {
            var f = inp.files && inp.files[0];
            if (f) handleFile(f);
            try { document.body.removeChild(inp); } catch (_) {}
        });
        inp.click();
    }

    async function handleFile(file) {
        if (!workerUrl()) {
            toast('AI worker URL not configured (window.AI_ASSISTANT_WORKER_URL).', 'error');
            return;
        }
        if (file.size > 16 * 1024 * 1024) {
            toast('File too large (max 16 MB).', 'error');
            return;
        }
        var isPdf = (file.type === 'application/pdf') || /\.pdf$/i.test(file.name || '');
        var isImage = /^image\//.test(file.type);
        if (!isPdf && !isImage) {
            toast('Please upload a PDF or an image (JPG / PNG / WebP).', 'error');
            return;
        }

        // ── PDF: render every page, upload each, run AI on each, merge ──
        if (isPdf) {
            showProgressModal('Loading PDF reader…');
            var pageBlobs;
            try {
                pageBlobs = await pdfAllPagesToBlobs(file);
            } catch (err) {
                closeProgressModal();
                toast('PDF rendering failed: ' + (err && err.message || err), 'error');
                return;
            }
            var n = pageBlobs.length;
            if (!n) { closeProgressModal(); toast('PDF had no pages.', 'error'); return; }

            // Upload all pages in parallel (Cloudinary is fast)
            updateProgress('Uploading ' + n + ' page(s) to Cloudinary…');
            var urls;
            try {
                urls = await Promise.all(pageBlobs.map(function (b, i) {
                    var nm = (file.name.replace(/\.pdf$/i, '') || 'brochure') + '-p' + (i + 1) + '.png';
                    var f  = new File([b], nm, { type: 'image/png' });
                    return uploadToCloudinary(f);
                }));
            } catch (err) {
                closeProgressModal();
                toast('Upload failed: ' + (err && err.message || err), 'error');
                return;
            }

            // Run AI extraction on each page sequentially (the worker rate-limits at ~1/s)
            var pageFields = [];
            for (var i = 0; i < urls.length; i++) {
                updateProgress('Asking AI to read page ' + (i + 1) + ' of ' + n + '…');
                try {
                    var f = await callExtract(urls[i]);
                    pageFields.push(f);
                } catch (err) {
                    console.warn('[ai-pkg] page ' + (i + 1) + ' extract failed:', err);
                    // keep going — partial extraction is still useful
                }
            }
            closeProgressModal();
            if (!pageFields.length) { toast('AI could not read any page of this PDF.', 'error'); return; }

            var merged = mergeFields(pageFields);
            // Use page-1 image as the cover; tag the source file nicely
            var displayFile = new File([pageBlobs[0]], (file.name.replace(/\.pdf$/i, '') || 'brochure') + ' (' + n + ' pg).png', { type: 'image/png' });
            showPreviewModal(merged, urls[0], displayFile);
            return;
        }

        // ── Single image path ──
        showProgressModal('Uploading brochure to Cloudinary…');
        var url;
        try {
            url = await uploadToCloudinary(file);
        } catch (err) {
            closeProgressModal();
            toast('Upload failed: ' + (err && err.message || err), 'error');
            return;
        }
        updateProgress('Asking AI to read the brochure…');
        var fields;
        try {
            fields = await callExtract(url);
        } catch (err) {
            closeProgressModal();
            toast('AI extraction failed: ' + (err && err.message || err), 'error');
            return;
        }
        closeProgressModal();
        showPreviewModal(fields, url, file);
    }

    /* ── PDF → PNG (client-side via PDF.js, loaded on demand) ──
     * Renders page 1 of the PDF at 1.6× scale and returns a PNG Blob.
     * PDF.js is fetched from cdnjs the first time only; subsequent
     * uploads in the same session reuse the cached library.        */
    var pdfjsLoaded = null;
    function loadPdfJs() {
        if (pdfjsLoaded) return pdfjsLoaded;
        pdfjsLoaded = new Promise(function (resolve, reject) {
            if (window.pdfjsLib) { resolve(window.pdfjsLib); return; }
            var s = document.createElement('script');
            s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
            s.onload = function () {
                if (!window.pdfjsLib) { reject(new Error('PDF.js failed to expose pdfjsLib')); return; }
                window.pdfjsLib.GlobalWorkerOptions.workerSrc =
                    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
                resolve(window.pdfjsLib);
            };
            s.onerror = function () { reject(new Error('Could not load PDF.js from CDN.')); };
            document.head.appendChild(s);
        });
        return pdfjsLoaded;
    }

    /* Renders EVERY page of the PDF to a PNG blob and returns the array.
     * Caps at 10 pages to protect quota / runtime. */
    async function pdfAllPagesToBlobs(pdfFile) {
        var pdfjsLib = await loadPdfJs();
        updateProgress('Reading PDF…');
        var buf = await pdfFile.arrayBuffer();
        var pdf = await pdfjsLib.getDocument({ data: buf }).promise;
        if (!pdf || !pdf.numPages) throw new Error('PDF has no pages.');
        var MAX_PAGES = 10;
        var totalPages = Math.min(pdf.numPages, MAX_PAGES);
        if (pdf.numPages > MAX_PAGES) {
            console.warn('[ai-pkg] PDF has ' + pdf.numPages + ' pages; only first ' + MAX_PAGES + ' will be processed.');
        }
        var blobs = [];
        for (var i = 1; i <= totalPages; i++) {
            updateProgress('Rendering page ' + i + ' of ' + totalPages + '…');
            var page = await pdf.getPage(i);
            var viewport = page.getViewport({ scale: 1.6 });
            var canvas = document.createElement('canvas');
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            var ctx = canvas.getContext('2d');
            await page.render({ canvasContext: ctx, viewport: viewport }).promise;
            var blob = await new Promise(function (res) { canvas.toBlob(res, 'image/png', 0.92); });
            if (!blob) throw new Error('Could not convert page ' + i + ' to PNG.');
            blobs.push(blob);
        }
        return blobs;
    }

    /* Merges N page-extractions into one package object.
     * Strategy:
     *   - name: longest non-empty across pages (most descriptive)
     *   - desc: first non-empty
     *   - price: max of all (brochures often quote category-wise prices; we pick highest visible)
     *   - duration: first non-empty
     *   - category: first non-empty
     *   - rating: max
     *   - inclusions / exclusions / places: union (de-duped, case-insensitive)
     *   - itinerary: concatenated (re-numbered 1..N) — duplicates by title removed   */
    function mergeFields(arr) {
        var merged = {
            name: '', desc: '', price: 0, duration: '', category: '',
            rating: 0, inclusions: [], exclusions: [], places: [], itinerary: []
        };
        var seenInc = {}, seenExc = {}, seenPlace = {}, seenItin = {};
        arr.forEach(function (f) {
            if (!f) return;
            // name: longest
            var n = String(f.name || '').trim();
            if (n && n.length > merged.name.length) merged.name = n;
            // desc: first non-empty
            if (!merged.desc && f.desc) merged.desc = String(f.desc).trim();
            // price: max
            var p = Number(f.price) || 0;
            if (p > merged.price) merged.price = p;
            // duration: first non-empty
            if (!merged.duration && f.duration) merged.duration = String(f.duration).trim();
            // category: first non-empty
            if (!merged.category && f.category) merged.category = String(f.category).trim();
            // rating: max
            var r = Number(f.rating) || 0;
            if (r > merged.rating) merged.rating = r;
            // arrays — dedupe case-insensitively
            (f.inclusions || []).forEach(function (x) {
                var k = String(x || '').trim().toLowerCase();
                if (k && !seenInc[k]) { seenInc[k] = 1; merged.inclusions.push(String(x).trim()); }
            });
            (f.exclusions || []).forEach(function (x) {
                var k = String(x || '').trim().toLowerCase();
                if (k && !seenExc[k]) { seenExc[k] = 1; merged.exclusions.push(String(x).trim()); }
            });
            (f.places || []).forEach(function (x) {
                var k = String(x || '').trim().toLowerCase();
                if (k && !seenPlace[k]) { seenPlace[k] = 1; merged.places.push(String(x).trim()); }
            });
            (f.itinerary || []).forEach(function (d) {
                var key = String((d && d.title) || '').trim().toLowerCase();
                if (!key || seenItin[key]) return;
                seenItin[key] = 1;
                merged.itinerary.push({
                    day: 0, // re-numbered below
                    title: String((d && d.title) || '').trim(),
                    details: String((d && d.details) || '').trim()
                });
            });
        });
        if (!merged.rating) merged.rating = 4.5;
        // Re-number days 1..N
        merged.itinerary.forEach(function (d, i) { d.day = i + 1; });
        return merged;
    }

    function uploadToCloudinary(file) {
        return new Promise(function (resolve, reject) {
            var cfg = cloudinaryCfg();
            if (!cfg.cloud)  return reject(new Error('Cloudinary cloud name not configured (window.CLOUDINARY_CONFIG.cloudName)'));
            if (!cfg.preset) return reject(new Error('Cloudinary upload preset not configured (window.CLOUDINARY_CONFIG.uploadPreset)'));
            var fd = new FormData();
            fd.append('file', file);
            fd.append('upload_preset', cfg.preset);
            fd.append('folder', cfg.folder);
            var xhr = new XMLHttpRequest();
            xhr.open('POST', 'https://api.cloudinary.com/v1_1/' + cfg.cloud + '/auto/upload');
            xhr.upload.onprogress = function (e) {
                if (e.lengthComputable) updateProgress('Uploading… ' + Math.round(e.loaded / e.total * 100) + '%');
            };
            xhr.onload = function () {
                try {
                    var r = JSON.parse(xhr.responseText || '{}');
                    if (xhr.status >= 200 && xhr.status < 300 && r.secure_url) resolve(r.secure_url);
                    else reject(new Error(r.error ? r.error.message : ('HTTP ' + xhr.status)));
                } catch (e) { reject(e); }
            };
            xhr.onerror = function () { reject(new Error('Network error')); };
            xhr.send(fd);
        });
    }

    async function callExtract(imageUrl) {
        var token = await getIdToken();
        if (!token) throw new Error('Not signed in.');
        var res = await fetch(workerUrl() + '/extract-package', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ imageUrl: imageUrl })
        });
        var body = await res.json().catch(function () { return {}; });
        if (!res.ok || !body.ok) throw new Error(body.error || ('HTTP ' + res.status));
        return body.fields;
    }

    /* ── Progress modal (uploading / thinking) ── */
    var progEl = null;
    function showProgressModal(msg) {
        closeProgressModal();
        progEl = document.createElement('div');
        progEl.className = 'aipkg-overlay';
        progEl.innerHTML = '<div class="aipkg-progress"><i class="fas fa-spinner fa-spin"></i><span id="aipkgProgText">' + escHtml(msg) + '</span></div>';
        document.body.appendChild(progEl);
        injectStyles();
    }
    function updateProgress(msg) {
        var el = document.getElementById('aipkgProgText');
        if (el) el.textContent = msg;
    }
    function closeProgressModal() {
        if (progEl && progEl.parentNode) progEl.parentNode.removeChild(progEl);
        progEl = null;
    }

    /* ── Preview / edit modal ── */
    function showPreviewModal(fields, imageUrl, file) {
        injectStyles();
        var modal = document.createElement('div');
        modal.className = 'aipkg-overlay';
        modal.innerHTML =
            '<div class="aipkg-card">' +
                '<div class="aipkg-head">' +
                    '<h3><i class="fas fa-wand-magic-sparkles"></i> AI extracted package</h3>' +
                    '<button type="button" class="aipkg-close" aria-label="Close"><i class="fas fa-times"></i></button>' +
                '</div>' +
                '<div class="aipkg-body">' +
                    '<div class="aipkg-source">' +
                        '<img src="' + escHtml(imageUrl) + '" alt="brochure preview" loading="lazy">' +
                        '<small>Source: ' + escHtml(file.name) + ' · ' + Math.round(file.size/1024) + ' KB</small>' +
                    '</div>' +
                    '<div class="aipkg-fields">' +
                        row('Name *', '<input type="text" data-f="name" value="' + escHtml(fields.name || '') + '">') +
                        row('Tagline / desc', '<input type="text" data-f="desc" value="' + escHtml(fields.desc || '') + '">') +
                        row('Price (₹/person) *', '<input type="number" min="0" data-f="price" value="' + escHtml(fields.price || 0) + '">') +
                        row('Duration', '<input type="text" data-f="duration" value="' + escHtml(fields.duration || '') + '">') +
                        row('Category',
                            '<select data-f="category">' +
                                ['','Budget','Standard','Luxury','Premium','Honeymoon','Family','Adventure'].map(function (c) {
                                    return '<option value="' + escHtml(c) + '"' + (c === (fields.category || '') ? ' selected' : '') + '>' + (c || '— select —') + '</option>';
                                }).join('') +
                            '</select>'
                        ) +
                        row('Rating (0-5)', '<input type="number" min="0" max="5" step="0.1" data-f="rating" value="' + escHtml(fields.rating || 4.5) + '">') +
                        // Inclusions / Exclusions / Places — line-by-line editors so the
                        // admin can add/remove each item with a + / trash button instead
                        // of editing comma-separated blob text. Wired below via
                        // window.IteListEditors.wireStringList. Plain DIVs here; the
                        // editor injects the row inputs and Add buttons.
                        row('Inclusions', '<div class="ite-list-host" data-f-list="inclusions"></div>') +
                        row('Exclusions', '<div class="ite-list-host" data-f-list="exclusions"></div>') +
                        row('Places visited', '<div class="ite-list-host" data-f-list="places"></div>') +
                        '<div class="aipkg-itin"><h4>Day-by-Day Itinerary</h4><div id="aipkgItinList"></div></div>' +
                    '</div>' +
                '</div>' +
                '<div class="aipkg-foot">' +
                    '<button type="button" class="aipkg-cancel">Cancel</button>' +
                    '<button type="button" class="aipkg-save"><i class="fas fa-plus"></i> Create Package</button>' +
                '</div>' +
            '</div>';
        document.body.appendChild(modal);

        // Render itinerary editor
        renderItinerary(modal, fields.itinerary || []);

        // ── Wire line-by-line editors for Inclusions / Exclusions / Places ──
        // Each editor manages its own draft array; savePackage() reads
        // back from these via modal.__listState below. Falls back to a
        // simple textarea if window.IteListEditors isn't loaded (it
        // ships in dashboard.html alongside this file, so this is just
        // belt-and-braces in case of a load-order regression).
        var listState = {
            inclusions: (fields.inclusions || []).slice(),
            exclusions: (fields.exclusions || []).slice(),
            places:     (fields.places     || []).slice()
        };
        modal.__listState = listState;

        if (window.IteListEditors && typeof window.IteListEditors.wireStringList === 'function') {
            var wire = window.IteListEditors.wireStringList;
            wire(
                modal.querySelector('[data-f-list="inclusions"]'),
                function () { return listState.inclusions; },
                function (a) { listState.inclusions = a; },
                { placeholder: 'e.g. Daily breakfast', addLabel: 'Add Inclusion' }
            );
            wire(
                modal.querySelector('[data-f-list="exclusions"]'),
                function () { return listState.exclusions; },
                function (a) { listState.exclusions = a; },
                { placeholder: 'e.g. Airfare', addLabel: 'Add Exclusion' }
            );
            wire(
                modal.querySelector('[data-f-list="places"]'),
                function () { return listState.places; },
                function (a) { listState.places = a; },
                { placeholder: 'e.g. Port Blair', addLabel: 'Add Place' }
            );
        } else {
            // Fallback: replace each host with a comma-separated <textarea>
            // so the admin can still edit something even if the editor lib
            // is missing. savePackage() handles both shapes via __listState.
            ['inclusions', 'exclusions', 'places'].forEach(function (key) {
                var host = modal.querySelector('[data-f-list="' + key + '"]');
                if (!host) return;
                var ta = document.createElement('textarea');
                ta.rows = 3;
                ta.value = (listState[key] || []).join('\n');
                ta.style.width = '100%';
                ta.addEventListener('input', function () {
                    listState[key] = String(ta.value || '').split(/\r?\n|,/).map(function (s) { return s.trim(); }).filter(Boolean);
                });
                host.innerHTML = '';
                host.appendChild(ta);
            });
        }

        modal.querySelector('.aipkg-close').addEventListener('click', function () { modal.remove(); });
        modal.querySelector('.aipkg-cancel').addEventListener('click', function () { modal.remove(); });
        modal.addEventListener('click', function (e) { if (e.target === modal) modal.remove(); });
                modal.querySelector('.aipkg-save').addEventListener('click', function () { savePackage(modal, fields, imageUrl); });
    }

    function row(label, html) {
        return '<label class="aipkg-row"><span>' + escHtml(label) + '</span>' + html + '</label>';
    }

    function renderItinerary(modal, days) {
        var list = modal.querySelector('#aipkgItinList');
        if (!list) return;
        list.innerHTML = '';
        days.forEach(function (d, i) { list.appendChild(itinRow(d, i + 1)); });
        var addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'aipkg-itin-add';
        addBtn.innerHTML = '<i class="fas fa-plus"></i> Add day';
        addBtn.addEventListener('click', function () {
            list.appendChild(itinRow({ day: list.children.length + 1, title: '', details: '' }, list.children.length + 1));
        });
        list.parentNode.appendChild(addBtn);
    }
    function itinRow(d, n) {
        var w = document.createElement('div');
        w.className = 'aipkg-day';
        w.innerHTML =
            '<div class="aipkg-day-num">Day ' + n + '</div>' +
            '<input type="text" class="aipkg-day-title" placeholder="Title (e.g. Arrival in Port Blair)" value="' + escHtml(d.title || '') + '">' +
            '<textarea class="aipkg-day-details" rows="2" placeholder="Details">' + escHtml(d.details || '') + '</textarea>' +
            '<button type="button" class="aipkg-day-del" title="Remove this day"><i class="fas fa-trash"></i></button>';
        w.querySelector('.aipkg-day-del').addEventListener('click', function () { w.remove(); });
        return w;
    }

    async function savePackage(modal, originalFields, imageUrl) {
        var saveBtn = modal.querySelector('.aipkg-save');
        var orig = saveBtn.innerHTML;
        saveBtn.disabled = true;
        saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating…';
        function val(f){var el=modal.querySelector('[data-f="'+f+'"]');return el?el.value:'';}
        // Pull list-editor state (inclusions / exclusions / places)
        // from the modal's __listState bag — populated by the wire
        // helpers in showPreviewModal(). Empty arrays are fine.
        var ls = modal.__listState || {};
        function listOf(key) {
            var arr = ls[key];
            if (!Array.isArray(arr)) return [];
            return arr.map(function (s) { return String(s == null ? '' : s).trim(); }).filter(Boolean);
        }
        var itinerary=[];
        modal.querySelectorAll('.aipkg-day').forEach(function(row,i){
            var t=(row.querySelector('.aipkg-day-title')||{}).value||'';
            var d=(row.querySelector('.aipkg-day-details')||{}).value||'';
            if(t||d)itinerary.push({day:i+1,title:t,details:d});
        });
        var name=String(val('name')||'').trim();
        var price=Number(val('price')||0);
        if(!name){toast('Name is required','error');saveBtn.disabled=false;saveBtn.innerHTML=orig;return;}
        if(!price||price<=0){toast('Price must be > 0','error');saveBtn.disabled=false;saveBtn.innerHTML=orig;return;}
        var newPkg={
            id: slugify(name)+'-'+Date.now().toString(36).slice(-4),
            name:name,
            desc:String(val('desc')||'').trim(),
            price:price,
            duration:String(val('duration')||'').trim(),
            category:String(val('category')||'').trim(),
            rating:Math.max(0,Math.min(5,Number(val('rating')||4.5))),
            inclusions:listOf('inclusions'),
            exclusions:listOf('exclusions'),
            places:listOf('places'),
            itinerary:itinerary,
            image:imageUrl,
            visible:true,
            order:9999,
            createdAt:new Date().toISOString(),
            createdVia:'ai-import'
        };
        try{
            var current=await window.PackagesStore.load();
            var list=(current&&Array.isArray(current.data))?current.data.slice():[];
            list.push(newPkg);
            await window.PackagesStore.publish(list);
            toast('\u2713 Package created \u2014 review it in the grid below','success');
            modal.remove();
            if(typeof window._renderPackages==='function'){try{window._renderPackages(list);}catch(_){}}
            else{location.reload();}
        }catch(err){
            console.error('savePackage failed:',err);
            toast('Save failed: '+(err&&err.message||err),'error');
            saveBtn.disabled=false;
            saveBtn.innerHTML=orig;
        }
    }

    function slugify(s){return String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,40)||'package';}

    function injectStyles(){
        if(document.getElementById('aipkg-styles'))return;
        var css=document.createElement('style');
        css.id='aipkg-styles';
        css.textContent=[
            '.aipkg-overlay{position:fixed;inset:0;background:rgba(15,32,39,.65);backdrop-filter:blur(3px);z-index:10000;display:flex;align-items:center;justify-content:center;padding:1rem;font-size:14px;line-height:1.45;}',
            '.aipkg-progress{background:#fff;border-radius:12px;padding:1.4rem 1.8rem;display:inline-flex;gap:.7rem;align-items:center;color:#1c2b48;font-weight:600;box-shadow:0 12px 36px rgba(0,0,0,.35);}',
            '.aipkg-progress i{color:#8e44ad;font-size:1.3rem;}',
            '.aipkg-card{background:#fff;border-radius:14px;width:880px;max-width:calc(100vw - 32px);height:92vh;max-height:calc(100vh - 32px);display:flex;flex-direction:column;overflow:hidden;box-shadow:0 22px 64px rgba(0,0,0,.4);position:relative;}',
            '.aipkg-head{padding:.95rem 1.2rem;background:linear-gradient(135deg,#8e44ad,#3498db);color:#fff;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;width:100%;box-sizing:border-box;}',
            '.aipkg-head h3{margin:0;font-size:1.05rem;font-weight:700;display:flex;align-items:center;gap:.5rem;color:#fff;}',
            '.aipkg-close{background:rgba(255,255,255,.18);border:0;color:#fff;width:32px;height:32px;border-radius:8px;cursor:pointer;flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;}',
            '.aipkg-close:hover{background:rgba(255,255,255,.32);}',
            '.aipkg-body{flex:1 1 auto;min-height:0;overflow-y:auto;padding:1.1rem 1.25rem;display:grid;grid-template-columns:200px 1fr;gap:1.2rem;width:100%;box-sizing:border-box;}',
            '.aipkg-source img{max-width:100%;border-radius:10px;border:1px solid #e3e8ef;}',
            '.aipkg-source small{display:block;margin-top:.4rem;color:#7a8b96;font-size:.78rem;}',
            '.aipkg-fields{display:flex;flex-direction:column;gap:.6rem;}',
            '.aipkg-row{display:flex;flex-direction:column;gap:.3rem;font-size:.82rem;font-weight:600;color:#5a6877;}',
            '.aipkg-row input,.aipkg-row textarea,.aipkg-row select{padding:.5rem .7rem;border:1px solid #cfd9df;border-radius:7px;font-family:inherit;font-size:.9rem;color:#2c3e50;background:#fff;}',
            '.aipkg-row input:focus,.aipkg-row textarea:focus,.aipkg-row select:focus{outline:none;border-color:#8e44ad;box-shadow:0 0 0 3px rgba(142,68,173,.18);}',
            '.aipkg-row textarea{resize:vertical;font-family:inherit;}',
            '.aipkg-itin{margin-top:.5rem;}',
            '.aipkg-itin h4{margin:0 0 .4rem;font-size:.86rem;color:#1c2b48;}',
            '.aipkg-day{display:grid;grid-template-columns:60px 1fr 32px;grid-template-rows:auto auto;gap:.35rem .55rem;align-items:start;padding:.55rem;background:#f8fafc;border:1px solid #eef1f4;border-radius:8px;margin-bottom:.4rem;}',
            '.aipkg-day-num{font-weight:700;color:#8e44ad;font-size:.78rem;align-self:center;}',
            '.aipkg-day-title{padding:.35rem .55rem;border:1px solid #cfd9df;border-radius:6px;font:inherit;font-size:.86rem;}',
            '.aipkg-day-details{grid-column:2/3;padding:.35rem .55rem;border:1px solid #cfd9df;border-radius:6px;font:inherit;font-size:.84rem;resize:vertical;}',
            '.aipkg-day-del{grid-row:1/3;background:#fdedec;border:0;border-radius:6px;color:#c0392b;cursor:pointer;font-size:.78rem;align-self:center;height:32px;}',
            '.aipkg-day-del:hover{background:#fadbd8;}',
            '.aipkg-itin-add{margin-top:.4rem;background:#fff;border:1px dashed #cfd9df;color:#5a6877;padding:.45rem .9rem;border-radius:8px;cursor:pointer;font-weight:600;font-size:.82rem;}',
            '.aipkg-itin-add:hover{background:#f6f9fa;color:#8e44ad;border-color:#8e44ad;}',
            '.aipkg-foot{padding:.85rem 1.25rem;border-top:1px solid #e3e8ef;display:flex;justify-content:flex-end;gap:.5rem;background:#f9fbfc;flex-shrink:0;width:100%;box-sizing:border-box;}',
            '.aipkg-cancel{padding:.55rem 1.1rem;border-radius:8px;font:inherit;font-size:.9rem;font-weight:600;cursor:pointer;border:1px solid #cfd9df;background:#fff;color:#5a6877;}',
            '.aipkg-cancel:hover{background:#f0f3f5;}',
            '.aipkg-save{padding:.55rem 1.2rem;border-radius:8px;font:inherit;font-size:.9rem;font-weight:700;cursor:pointer;border:0;background:linear-gradient(135deg,#8e44ad,#3498db);color:#fff;display:inline-flex;align-items:center;gap:.4rem;box-shadow:0 2px 8px rgba(142,68,173,.32);}',
            '.aipkg-save:hover:not(:disabled){filter:brightness(1.05);}',
            '.aipkg-save:disabled{opacity:.65;cursor:not-allowed;}',
            '@media (max-width:720px){.aipkg-body{grid-template-columns:1fr;}}'
        ].join('');
        document.head.appendChild(css);
    }

    if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',injectButton);}else{injectButton();}
    document.querySelectorAll('.sidebar-link[data-section="packages"]').forEach(function(link){link.addEventListener('click',function(){setTimeout(injectButton,50);});});
})();
