/* ── Phase 4 back-fill: infer pkg.category for legacy packages ───────
 *
 * Walks every doc in the Firestore /packages collection (loaded via the
 * shared PackagesStore) and stamps a `category` field where it's missing.
 * The rules below mirror pkgCategory() in js/script.js so the inferred
 * value matches what the public homepage already groups packages as —
 * just promoted from "best-effort heuristic" to a persisted field that
 * the dashboard editor's Category dropdown can display correctly.
 *
 * USAGE
 *   1. Open https://andamanvoyages.in/dashboard while signed in as admin.
 *   2. Open DevTools Console (F12 → Console tab).
 *   3. Paste this entire IIFE, Enter.
 *   4. Review the dry-run table; type `await window.__migrateCommit()` to
 *      persist, or just close the tab to abort.
 *
 * Safety
 *   - Two-phase: dry-run prints what WOULD change; you approve with a
 *     second call that writes via PackagesStore.publish() (Firestore
 *     rules still apply — admin-only).
 *   - NEVER overwrites an existing pkg.category; only fills blanks.
 *   - All other fields are passed through verbatim.
 * ─────────────────────────────────────────────────────────────────── */

(async function () {
    if (!window.PackagesStore ||
        typeof window.PackagesStore.load    !== 'function' ||
        typeof window.PackagesStore.publish !== 'function') {
        alert('PackagesStore not available. Open /dashboard and sign in as admin first.');
        return;
    }

    // ── Categorisation rules (match js/script.js → pkgCategory) ──
    function inferCategory(pkg) {
        var name = String(pkg.name || '').toLowerCase();
        var id   = String(pkg.id   || '').toLowerCase();
        if (/honeymoon/.test(name)               || id === 'honeymoon')          return 'Honeymoon';
        if (/royal/.test(name))                                                  return 'Royal';
        if (/luxury|premium|5[\s-]?star/.test(name) || id === 'luxury')          return 'Luxury';
        if (/deluxe/.test(name))                                                 return 'Deluxe';
        if (/budget|backpack|saver|economy/.test(name) || id === 'budget')       return 'Budget';
        if (id === 'standard')                                                   return 'Standard';
        return 'Standard';   // safe default
    }

    // ── Day-plan back-fill (best-effort, only for free-text legacy itineraries) ──
    // If pkg.dayPlan is missing AND pkg.itinerary is a non-empty string,
    // synthesise a single Day 1 with the legacy text as a description.
    // The new MMT timeline renderer in package.html falls back to
    // pkg.days[].activities[] when dayPlan is empty, so this is purely a
    // nice-to-have for old jsonbin docs that never had pkg.days at all.
    function inferDayPlan(pkg) {
        if (Array.isArray(pkg.dayPlan) && pkg.dayPlan.length) return null;     // already typed
        if (Array.isArray(pkg.days)    && pkg.days.length)    return null;     // already structured
        var t = String(pkg.itinerary || '').trim();
        if (!t) return null;
        return [{
            dayNumber: 1,
            title: 'Itinerary',
            summary: t.slice(0, 160) + (t.length > 160 ? '…' : ''),
            blocks: []
        }];
    }

    // ── 1) Load + plan changes (dry-run) ──────────────────────
    const result = await window.PackagesStore.load();
    const pkgs   = (result && Array.isArray(result.data)) ? result.data.slice() : [];
    if (!pkgs.length) {
        alert('No packages found in Firestore — nothing to migrate.');
        return;
    }

    const planned = [];
    pkgs.forEach(function (p, i) {
        const wantCat  = !p.category;
        const newCat   = wantCat ? inferCategory(p) : null;
        const newDays  = inferDayPlan(p);
        if (!wantCat && !newDays) return;
        planned.push({ index: i, id: p.id, name: p.name,
            currentCategory: p.category || '(empty)',
            inferredCategory: newCat || p.category,
            wouldAddDayPlan: !!newDays,
            ref: p
        });
    });

    if (!planned.length) {
        alert('✓ Nothing to migrate — every package already has a category and a dayPlan/days array.');
        return;
    }

    console.log('────────────────────────────────────────────────────────');
    console.log('PHASE-4 MIGRATION DRY-RUN — ' + planned.length + ' / ' + pkgs.length + ' packages would change:');
    console.log('────────────────────────────────────────────────────────');
    console.table(planned.map(function (r) {
        return {
            id:                r.id,
            name:              r.name,
            currentCategory:   r.currentCategory,
            inferredCategory:  r.inferredCategory,
            wouldAddDayPlan:   r.wouldAddDayPlan
        };
    }));
    console.log('────────────────────────────────────────────────────────');
    console.log('To COMMIT these changes, run:');
    console.log('  await window.__migrateCommit()');
    console.log('To ABORT, just close this tab. Nothing has been written yet.');
    console.log('────────────────────────────────────────────────────────');

    // ── 2) Stage commit (run on demand from the console) ──────
    window.__migrateCommit = async function commit() {
        if (!confirm('Commit ' + planned.length + ' package category back-fills to Firestore?')) {
            console.log('Aborted.');
            return;
        }
        // Apply mutations in-memory
        planned.forEach(function (r) {
            const p = r.ref;
            if (!p.category) {
                p.category = r.inferredCategory;
                p._categoryBackfilledAt = new Date().toISOString();
            }
            if (r.wouldAddDayPlan) {
                p.dayPlan = inferDayPlan(p);
                p._dayPlanBackfilledAt = new Date().toISOString();
            }
        });
        try {
            const out = await window.PackagesStore.publish(pkgs);
            console.log('✓ Migration published successfully.', out);
            if (window.Toast && window.Toast.success) {
                window.Toast.success('Migration complete — ' + planned.length + ' package(s) updated.');
            } else {
                alert('✓ Migration complete — ' + planned.length + ' package(s) updated.');
            }
            // Strip the helper so a second click can't double-commit
            delete window.__migrateCommit;
        } catch (err) {
            console.error('Migration FAILED:', err);
            alert('❌ Migration failed: ' + (err && err.message || err));
        }
    };
})();