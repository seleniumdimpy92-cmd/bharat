/* ── Itinerary list editors — line-by-line inclusions / exclusions /
 *    activities for the dashboard's day-card editor ─────────────────
 * Two editors:
 *   1. wireStringList(rootEl, getArr, setArr, opts)
 *      Plain string list — Inclusions, Exclusions, Highlights.
 *   2. wireActivityList(rootEl, day, opts)
 *      Per-day activity rows; each row has a chevron toggle that
 *      reveals Description + Image (URL or Cloudinary upload).
 *
 * Activities are stored back as plain strings when no extras are set
 * (legacy back-compat) and as { title, desc, imageUrl } objects when
 * the user fills any extra field. Rendering side accepts both shapes.
 *
 * Loaded by dashboard.html before js/dashboard.js. Self-contained;
 * exposes window.IteListEditors. ─────────────────────────────────── */
(function () {
    'use strict';

    function actionBtn(iconClass, title, fn, disabled) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn-il-act';
        b.title = title;
        b.innerHTML = '<i class="fas ' + iconClass + '"></i>';
        if (disabled) b.disabled = true;
        b.addEventListener('click', fn);
        return b;
    }

    function wireStringList(rootEl, getArr, setArr, opts) {
        if (!rootEl) return;
        opts = opts || {};
        rootEl.classList.add('il-list');
        function read() { var v = getArr(); return Array.isArray(v) ? v.slice() : []; }
        function write(arr) { setArr(arr); }
        function refresh() {
            rootEl.innerHTML = '';
            var arr = read();
            if (!arr.length) {
                var empty = document.createElement('p');
                empty.className = 'il-empty';
                empty.textContent = 'No items yet — click ' +
                    (opts.addLabel || 'Add') + ' below to start.';
                rootEl.appendChild(empty);
            } else {
                arr.forEach(function (val, idx) {
                    var row = document.createElement('div');
                    row.className = 'il-row';
                    var input = document.createElement('input');
                    input.type = 'text';
                    input.className = 'il-row-input';
                    input.value = val == null ? '' : String(val);
                    if (opts.placeholder) input.placeholder = opts.placeholder;
                    input.addEventListener('input', function () {
                        var a = read(); a[idx] = input.value; write(a);
                    });
                    row.appendChild(input);
                    row.appendChild(actionBtn('fa-chevron-up', 'Move up', function () {
                        if (idx === 0) return;
                        var a = read(); var t = a[idx - 1];
                        a[idx - 1] = a[idx]; a[idx] = t;
                        write(a); refresh();
                    }, idx === 0));
                    row.appendChild(actionBtn('fa-chevron-down', 'Move down', function () {
                        var a = read();
                        if (idx >= a.length - 1) return;
                        var t = a[idx + 1]; a[idx + 1] = a[idx]; a[idx] = t;
                        write(a); refresh();
                    }, idx >= arr.length - 1));
                    row.appendChild(actionBtn('fa-trash', 'Remove', function () {
                        var a = read(); a.splice(idx, 1); write(a); refresh();
                    }));
                    rootEl.appendChild(row);
                });
            }
            var add = document.createElement('button');
            add.type = 'button';
            add.className = 'btn-il-add';
            add.innerHTML = '<i class="fas fa-plus"></i> ' + (opts.addLabel || 'Add Item');
            add.addEventListener('click', function () {
                var a = read(); a.push(''); write(a); refresh();
                var inputs = rootEl.querySelectorAll('.il-row-input');
                if (inputs.length) inputs[inputs.length - 1].focus();
            });
            rootEl.appendChild(add);
        }
        refresh();
    }

    function actToObj(a) {
        if (a == null) return { title: '' };
        if (typeof a === 'string') return { title: a };
        return {
            title: String(a.title || ''),
            desc: a.desc || '',
            imageUrl: a.imageUrl || '',
            imagePublicId: a.imagePublicId || ''
        };
    }
    function objToAct(o) {
        if (!o) return '';
        var hasExtra = !!(o.desc || o.imageUrl);
        if (!hasExtra) return o.title || '';
        var out = { title: o.title || '' };
        if (o.desc) out.desc = o.desc;
        if (o.imageUrl) out.imageUrl = o.imageUrl;
        if (o.imagePublicId) out.imagePublicId = o.imagePublicId;
        return out;
    }

    function wireActivityList(rootEl, day, opts) {
        if (!rootEl) return;
        opts = opts || {};
        rootEl.classList.add('il-act-list');

        function readAsObjs() {
            var src = Array.isArray(day.activities) ? day.activities : [];
            return src.map(actToObj);
        }
        function writeFromObjs(arr) {
            day.activities = arr.map(objToAct);
        }

        function refresh() {
            rootEl.innerHTML = '';
            var arr = readAsObjs();
            if (!arr.length) {
                var empty = document.createElement('p');
                empty.className = 'il-empty';
                empty.textContent = 'No activities yet — click + Add Activity below.';
                rootEl.appendChild(empty);
            } else {
                arr.forEach(function (_act, idx) {
                    rootEl.appendChild(buildRow(arr, idx));
                });
            }
            var add = document.createElement('button');
            add.type = 'button';
            add.className = 'btn-il-add';
            add.innerHTML = '<i class="fas fa-plus"></i> Add Activity';
            add.addEventListener('click', function () {
                var arr2 = readAsObjs();
                arr2.push({ title: '' });
                writeFromObjs(arr2);
                refresh();
                var inputs = rootEl.querySelectorAll('.il-act-title-input');
                if (inputs.length) inputs[inputs.length - 1].focus();
            });
            rootEl.appendChild(add);
        }

        function buildRow(arr, idx) {
            var act = arr[idx];

            var row = document.createElement('div');
            row.className = 'il-act-row';

            // Header
            var head = document.createElement('div');
            head.className = 'il-act-head';

            var toggleBtn = document.createElement('button');
            toggleBtn.type = 'button';
            toggleBtn.className = 'btn-il-toggle';
            toggleBtn.title = 'Show description / image fields';
            toggleBtn.innerHTML = '<i class="fas fa-chevron-right"></i>';

            var titleInput = document.createElement('input');
            titleInput.type = 'text';
            titleInput.className = 'il-act-title-input';
            titleInput.placeholder = 'e.g. Visit Cellular Jail';
            titleInput.value = act.title || '';
            titleInput.addEventListener('input', function () {
                act.title = titleInput.value;
                writeFromObjs(arr);
            });

            var actions = document.createElement('div');
            actions.className = 'il-act-actions';
            actions.appendChild(actionBtn('fa-chevron-up', 'Move up', function () {
                if (idx === 0) return;
                var t = arr[idx - 1]; arr[idx - 1] = arr[idx]; arr[idx] = t;
                writeFromObjs(arr); refresh();
            }, idx === 0));
            actions.appendChild(actionBtn('fa-chevron-down', 'Move down', function () {
                if (idx >= arr.length - 1) return;
                var t = arr[idx + 1]; arr[idx + 1] = arr[idx]; arr[idx] = t;
                writeFromObjs(arr); refresh();
            }, idx >= arr.length - 1));
            actions.appendChild(actionBtn('fa-trash', 'Remove', function () {
                arr.splice(idx, 1);
                writeFromObjs(arr); refresh();
            }));

            head.appendChild(toggleBtn);
            head.appendChild(titleInput);
            head.appendChild(actions);
            row.appendChild(head);

            // Body
            var body = document.createElement('div');
            body.className = 'il-act-body';
            var startOpen = !!(act.desc || act.imageUrl);
            if (!startOpen) body.classList.add('is-collapsed');
            else toggleBtn.classList.add('is-open');

            // Description
            var descLbl = document.createElement('label');
            descLbl.className = 'il-act-field';
            var descSpan = document.createElement('span');
            descSpan.textContent = 'Description';
            var descInput = document.createElement('textarea');
            descInput.rows = 2;
            descInput.placeholder = 'Optional short description shown on the public page';
            descInput.value = act.desc || '';
            descInput.addEventListener('input', function () {
                act.desc = descInput.value;
                writeFromObjs(arr);
            });
            descLbl.appendChild(descSpan);
            descLbl.appendChild(descInput);
            body.appendChild(descLbl);

            // Image preview + controls
            var imgPreview = document.createElement('div');
            imgPreview.className = 'il-act-image-preview';

            var urlLbl = document.createElement('label');
            urlLbl.className = 'il-act-field';
            var urlSpan = document.createElement('span');
            urlSpan.textContent = 'Image URL';
            var urlInput = document.createElement('input');
            urlInput.type = 'text';
            urlInput.placeholder = 'https://... (or click Upload)';
            urlInput.value = act.imageUrl || '';
            urlInput.addEventListener('input', function () {
                act.imageUrl = urlInput.value;
                if (!urlInput.value) act.imagePublicId = '';
                writeFromObjs(arr);
                paintPreview();
            });
            urlLbl.appendChild(urlSpan);
            urlLbl.appendChild(urlInput);

            var ctlRow = document.createElement('div');
            ctlRow.className = 'il-act-image-controls';

            var uploadBtn = document.createElement('button');
            uploadBtn.type = 'button';
            uploadBtn.className = 'btn-il-upload';
            uploadBtn.innerHTML = '<i class="fas fa-cloud-upload-alt"></i> Upload';
            uploadBtn.title = 'Upload an image (Cloudinary)';

            var fileInput = document.createElement('input');
            fileInput.type = 'file';
            fileInput.accept = 'image/*';
            fileInput.style.display = 'none';

            var statusEl = document.createElement('span');
            statusEl.className = 'il-act-image-status';

            uploadBtn.addEventListener('click', function () { fileInput.click(); });
            fileInput.addEventListener('change', function () {
                var file = fileInput.files && fileInput.files[0];
                if (!file) return;
                if (!window.GalleryStore || typeof window.GalleryStore.uploadGalleryImage !== 'function') {
                    statusEl.textContent = 'Uploader not loaded — paste an image URL instead.';
                    statusEl.style.color = '#c0392b';
                    fileInput.value = '';
                    return;
                }
                statusEl.textContent = 'Uploading…';
                statusEl.style.color = '#0d7a8a';
                uploadBtn.disabled = true;

                var defaults = (typeof opts.uploadDefaults === 'function')
                    ? (opts.uploadDefaults(day) || {}) : {};
                var meta = {
                    title: defaults.title || (act.title || 'Activity image'),
                    category: defaults.category || '',
                    date: defaults.date || new Date().toISOString().slice(0, 10),
                    place: defaults.place || '',
                    packageRef: defaults.packageRef || '',
                    order: 9999
                };

                window.GalleryStore.uploadGalleryImage(file, meta).then(function (item) {
                    act.imageUrl = item.url || item.thumbUrl || '';
                    act.imagePublicId = item.publicId || item.id || '';
                    urlInput.value = act.imageUrl;
                    writeFromObjs(arr);
                    statusEl.textContent = '\u2713 Uploaded.';
                    statusEl.style.color = '#0d7a8a';
                    paintPreview();
                }).catch(function (err) {
                    console.error('activity upload failed:', err);
                    statusEl.textContent = 'Upload failed: ' + (err && err.message || err);
                    statusEl.style.color = '#c0392b';
                }).then(function () {
                    uploadBtn.disabled = false;
                    fileInput.value = '';
                });
            });

            ctlRow.appendChild(uploadBtn);
            ctlRow.appendChild(fileInput);
            ctlRow.appendChild(statusEl);

            body.appendChild(imgPreview);
            body.appendChild(urlLbl);
            body.appendChild(ctlRow);

            function paintPreview() {
                if (act.imageUrl) {
                    imgPreview.innerHTML =
                        '<img src="' + encodeURI(act.imageUrl) + '" alt="" loading="lazy">' +
                        '<button type="button" class="il-act-image-clear" title="Remove image">' +
                            '<i class="fas fa-times"></i></button>';
                    var clearBtn = imgPreview.querySelector('.il-act-image-clear');
                    if (clearBtn) {
                        clearBtn.addEventListener('click', function () {
                            act.imageUrl = '';
                            act.imagePublicId = '';
                            urlInput.value = '';
                            writeFromObjs(arr);
                            paintPreview();
                        });
                    }
                } else {
                    imgPreview.innerHTML = '<div class="il-act-image-placeholder">' +
                        '<i class="fas fa-image"></i><span>No image yet</span></div>';
                }
            }
            paintPreview();

            row.appendChild(body);

            // Toggle handler
            toggleBtn.addEventListener('click', function () {
                if (body.classList.contains('is-collapsed')) {
                    body.classList.remove('is-collapsed');
                    toggleBtn.classList.add('is-open');
                } else {
                    body.classList.add('is-collapsed');
                    toggleBtn.classList.remove('is-open');
                }
            });

            // Click on the title also expands when collapsed (nicer UX)
            titleInput.addEventListener('focus', function () {
                if (body.classList.contains('is-collapsed')) {
                    body.classList.remove('is-collapsed');
                    toggleBtn.classList.add('is-open');
                }
            });

            return row;
        }

        refresh();
    }

    window.IteListEditors = {
        wireStringList: wireStringList,
        wireActivityList: wireActivityList
    };
})();
