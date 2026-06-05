/* ── gallery-page.js ─────────────────────────────────────────────
   Public gallery page logic:
   - Loads items via window.GalleryStore.loadGalleryItems()
   - Category chip filter
   - Group by (none | year | month | place | package | category)
   - Sort by (date / title / place / order)
   - Lightbox with prev/next
   ─────────────────────────────────────────────────────────────── */

(function () {
    'use strict';

    const grid       = document.getElementById('galleryGrid');
    const filtersEl  = document.getElementById('galleryFilters');
    const statusEl   = document.getElementById('galleryStatus');
    const groupByEl  = document.getElementById('groupBy');
    const sortByEl   = document.getElementById('sortBy');
    const lightbox   = document.getElementById('galleryLightbox');
    const lbImage    = document.getElementById('lbImage');
    const lbCaption  = document.getElementById('lbCaption');
    const lbClose    = document.getElementById('lbClose');
    const lbPrev     = document.getElementById('lbPrev');
    const lbNext     = document.getElementById('lbNext');

    if (!grid) return; // not on the gallery page

    const MONTHS = ['January','February','March','April','May','June',
                    'July','August','September','October','November','December'];

    let allItems = [];          // raw items from the store
    let filteredItems = [];     // after the category chip filter
    let lbList = [];            // flat list reflecting current display order
    let lbIndex = 0;
    let activeCat = 'all';

    // Restore user preferences
    try {
        const savedGroup = localStorage.getItem('galleryGroupBy');
        const savedSort  = localStorage.getItem('gallerySortBy');
        if (savedGroup && groupByEl) groupByEl.value = savedGroup;
        if (savedSort  && sortByEl)  sortByEl.value  = savedSort;
    } catch (e) {}

    // ── helpers ────────────────────────────────────────────────
    function escapeHtml(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
            '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
        }[c]));
    }

    function getItemDate(item) {
        if (item.date) {
            const d = new Date(item.date);
            if (!isNaN(d.getTime())) return d;
        }
        if (item.createdAt && typeof item.createdAt.toDate === 'function') {
            try { return item.createdAt.toDate(); } catch (_) {}
        }
        if (item.createdAt && typeof item.createdAt.toMillis === 'function') {
            return new Date(item.createdAt.toMillis());
        }
        return null;
    }

    function compareItems(a, b, sortKey) {
        const da = getItemDate(a);
        const db = getItemDate(b);
        const ta = da ? da.getTime() : 0;
        const tb = db ? db.getTime() : 0;
        switch (sortKey) {
            case 'date_asc':   return ta - tb;
            case 'date_desc':  return tb - ta;
            case 'title_asc':  return (a.title || '').localeCompare(b.title || '');
            case 'title_desc': return (b.title || '').localeCompare(a.title || '');
            case 'place_asc':  return (a.place || '').localeCompare(b.place || '');
            case 'order_asc':  return (a.order || 0) - (b.order || 0);
            default:           return tb - ta;
        }
    }

    function getGroupKey(item, groupBy) {
        const d = getItemDate(item);
        switch (groupBy) {
            case 'year':
                return d ? String(d.getFullYear()) : 'Undated';
            case 'month':
                if (!d) return 'Undated';
                return MONTHS[d.getMonth()] + ' ' + d.getFullYear();
            case 'place':
                return (item.place || '').trim() || 'Other';
            case 'package':
                return (item.packageRef || '').trim() || 'Other';
            case 'category':
                return (item.category || '').trim() || 'Other';
            default:
                return '';
        }
    }

    // Sort group headings sensibly
    function compareGroupKeys(a, b, groupBy) {
        // Move "Undated" / "Other" to the end
        const tail = ['Undated', 'Other'];
        const aTail = tail.indexOf(a) >= 0;
        const bTail = tail.indexOf(b) >= 0;
        if (aTail && !bTail) return  1;
        if (bTail && !aTail) return -1;
        if (aTail && bTail)  return a.localeCompare(b);

        if (groupBy === 'year') {
            return parseInt(b, 10) - parseInt(a, 10); // newest year first
        }
        if (groupBy === 'month') {
            // Parse "Month YYYY" → newest first
            const parse = (s) => {
                const parts = s.split(' ');
                const m = MONTHS.indexOf(parts[0]);
                const y = parseInt(parts[1], 10);
                return (isNaN(y) ? 0 : y) * 100 + (m < 0 ? 0 : m);
            };
            return parse(b) - parse(a);
        }
        return a.localeCompare(b);
    }

    // ── filter chips ───────────────────────────────────────────
    function renderFilters(cats) {
        filtersEl.innerHTML = '';
        const allChip = document.createElement('button');
        allChip.className = 'gallery-chip active';
        allChip.dataset.cat = 'all';
        allChip.textContent = 'All';
        filtersEl.appendChild(allChip);
        cats.forEach(cat => {
            const chip = document.createElement('button');
            chip.className = 'gallery-chip';
            chip.dataset.cat = cat;
            chip.textContent = cat;
            filtersEl.appendChild(chip);
        });
    }

    if (filtersEl) {
        filtersEl.addEventListener('click', (e) => {
            const chip = e.target.closest('.gallery-chip');
            if (!chip) return;
            filtersEl.querySelectorAll('.gallery-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            activeCat = chip.dataset.cat;
            applyFiltersAndRender();
        });
    }

    // ── tile builder ───────────────────────────────────────────
    function buildTile(item, lbIdx) {
        const tile = document.createElement('div');
        tile.className = 'gallery-tile';
        const altText = (item.title || 'Andaman photo').replace(/"/g, '&quot;');
        tile.innerHTML =
            '<img loading="lazy" src="' + escapeHtml(item.thumbUrl || item.url) + '" alt="' + escapeHtml(altText) + '">' +
            (item.title ? '<div class="gallery-tile-caption">' + escapeHtml(item.title) + '</div>' : '');
        tile.addEventListener('click', () => openLightbox(lbIdx));
        return tile;
    }

    // ── main render ────────────────────────────────────────────
    function renderGrid() {
        grid.innerHTML = '';
        lbList = [];

        if (!filteredItems.length) {
            grid.innerHTML =
                '<div class="gallery-empty" style="grid-column:1/-1;">' +
                '<i class="fas fa-image"></i>' +
                '<h3>No photos yet</h3>' +
                '<p>Check back soon — we’re adding new shots from recent tours.</p>' +
                '</div>';
            return;
        }

        const sortKey = sortByEl ? sortByEl.value : 'date_desc';
        const groupBy = groupByEl ? groupByEl.value : 'none';

        // Sort first (within groups too)
        const sorted = filteredItems.slice().sort((a, b) => compareItems(a, b, sortKey));

        if (groupBy === 'none') {
            sorted.forEach((item) => {
                const idx = lbList.length;
                lbList.push(item);
                grid.appendChild(buildTile(item, idx));
            });
            return;
        }

        // Group items
        const groups = {};
        sorted.forEach(item => {
            const key = getGroupKey(item, groupBy);
            if (!groups[key]) groups[key] = [];
            groups[key].push(item);
        });

        const keys = Object.keys(groups).sort((a, b) => compareGroupKeys(a, b, groupBy));

        keys.forEach(key => {
            const items = groups[key];

            // Group heading row
            const header = document.createElement('div');
            header.className = 'gallery-group-header';
            header.innerHTML =
                '<h2><span class="ggh-key">' + escapeHtml(key) + '</span> ' +
                '<span class="ggh-count">' + items.length + ' photo' + (items.length === 1 ? '' : 's') + '</span></h2>';
            grid.appendChild(header);

            // Group tile container
            const groupGrid = document.createElement('div');
            groupGrid.className = 'gallery-group-grid';
            items.forEach(item => {
                const idx = lbList.length;
                lbList.push(item);
                groupGrid.appendChild(buildTile(item, idx));
            });
            grid.appendChild(groupGrid);
        });
    }

    function applyFiltersAndRender() {
        filteredItems = (activeCat === 'all')
            ? allItems.slice()
            : allItems.filter(it => (it.category || '').toLowerCase() === activeCat.toLowerCase());
        renderGrid();
    }

    // ── group / sort change ────────────────────────────────────
    if (groupByEl) {
        groupByEl.addEventListener('change', () => {
            try { localStorage.setItem('galleryGroupBy', groupByEl.value); } catch (e) {}
            renderGrid();
        });
    }
    if (sortByEl) {
        sortByEl.addEventListener('change', () => {
            try { localStorage.setItem('gallerySortBy', sortByEl.value); } catch (e) {}
            renderGrid();
        });
    }

    // ── lightbox ───────────────────────────────────────────────
    function openLightbox(idx) {
        if (!lbList.length) return;
        lbIndex = idx;
        showLightboxImage();
        lightbox.classList.add('open');
        document.body.style.overflow = 'hidden';
    }
    function closeLightbox() {
        lightbox.classList.remove('open');
        document.body.style.overflow = '';
    }
    function showLightboxImage() {
        const item = lbList[lbIndex];
        if (!item) return;
        lbImage.src = item.url;
        lbImage.alt = item.title || 'Andaman photo';

        // Build a rich caption that includes any tagged metadata
        const captionBits = [];
        if (item.title)      captionBits.push('<strong>' + escapeHtml(item.title) + '</strong>');
        if (item.caption)    captionBits.push(escapeHtml(item.caption));
        const meta = [];
        if (item.place)      meta.push('📍 ' + escapeHtml(item.place));
        if (item.date)       meta.push('📅 ' + escapeHtml(item.date));
        if (item.packageRef) meta.push('🎫 ' + escapeHtml(item.packageRef));
        if (meta.length)     captionBits.push('<span class="lb-meta">' + meta.join(' &nbsp;·&nbsp; ') + '</span>');

        if (captionBits.length) {
            lbCaption.innerHTML = captionBits.join(' — ');
            lbCaption.style.display = '';
        } else {
            lbCaption.innerHTML = '';
            lbCaption.style.display = 'none';
        }
    }
    function nextImg() { if (!lbList.length) return; lbIndex = (lbIndex + 1) % lbList.length; showLightboxImage(); }
    function prevImg() { if (!lbList.length) return; lbIndex = (lbIndex - 1 + lbList.length) % lbList.length; showLightboxImage(); }

    if (lbClose) lbClose.addEventListener('click', closeLightbox);
    if (lbNext)  lbNext.addEventListener('click', nextImg);
    if (lbPrev)  lbPrev.addEventListener('click', prevImg);
    if (lightbox) lightbox.addEventListener('click', (e) => { if (e.target === lightbox) closeLightbox(); });
    document.addEventListener('keydown', (e) => {
        if (!lightbox || !lightbox.classList.contains('open')) return;
        if (e.key === 'Escape')      closeLightbox();
        if (e.key === 'ArrowRight')  nextImg();
        if (e.key === 'ArrowLeft')   prevImg();
    });

    // ── init ───────────────────────────────────────────────────
    async function init() {
        if (statusEl) statusEl.style.display = '';
        try {
            allItems = await window.GalleryStore.loadGalleryItems();
            const cats = Array.from(new Set(
                allItems.map(i => (i.category || '').trim()).filter(Boolean)
            )).sort();
            renderFilters(cats);
            applyFiltersAndRender();
        } catch (err) {
            console.error('Gallery load failed:', err);
            grid.innerHTML =
                '<div class="gallery-empty" style="grid-column:1/-1;">' +
                '<i class="fas fa-exclamation-triangle"></i>' +
                '<h3>Couldn’t load gallery</h3>' +
                '<p>' + escapeHtml(err.message || 'Please try again later.') + '</p>' +
                '</div>';
        } finally {
            if (statusEl) statusEl.style.display = 'none';
        }
    }
    init();
})();
