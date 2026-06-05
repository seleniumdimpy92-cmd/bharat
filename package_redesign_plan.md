# Package Redesign — Plan & Continuation Notes

> **Status**: Plan only. No code changes yet — the actual build runs in the next session.
> **Owner**: Continue from here in a fresh chat by saying *"continue from package_redesign_plan.md"*.

---

## What the user asked for (verbatim)

1. *"the upper text are not visible"* — the **`#2 / Visible / Sold Out`** row at the top of every package editor card in the admin dashboard renders with bad contrast (white-on-white in light theme; possibly invisible in other themes too).
2. *"category field drop down (Budget, Standard, Deluxe, Luxury, Royal, Honeymoon)"* — add a per-package **Category** picker to the dashboard editor, mirror it onto the public packages list as a filter row.
3. *"design more elaborated package details — take MMT as example"* — replace the current free-text itinerary box with a structured day-by-day editor that mirrors MakeMyTrip's `holidays` page:
   * Day header (Day 1 / 2 / …)
   * Title (e.g. *"Port Blair to Havelock"*)
   * Per-day blocks: **Transfers** · **Hotel** · **Sightseeing** · **Activity (with image)** · **Meal**
   * Each activity / sightseeing item is its own row with an optional Cloudinary photo.
4. *"give similar option in dashboard page too for admin and staff"* — the new structured editor must be reachable from `/dashboard` for both `admin` and `staff` roles.
5. *"add the search button with these options in package details"* — add an MMT-style search bar (Starting From / Travelling On / Rooms & Guests / Category / **SEARCH**) somewhere on the public package flow. Decision below.

The user attached four screenshots: the current dashboard package card (problem #1), and three MMT.com pages showing the target itinerary + search bar.

---

## Decisions taken in chat

* **Search-bar placement**: **Option A** — homepage hero → filters package list → also a compact "tweak this trip" widget at the top of `/package/<slug>`. (User picked "next session" so we'll confirm if needed; A is the recommendation.)
* **Build order**: this session shipped Telegram-bridge work, Locks gating, and live-chat auto-reply. Package redesign continues in the next session per the user's direction.
* **No data migration scripts yet** — existing packages keep working with empty `category` (treated as "Standard") and the old free-text `itinerary` field stays as a fallback when the new `dayPlan` array is empty. This guarantees no live-site regression while we build the editor.

---

## Phase plan (next session)

### Phase 1 · Quick wins ✅ SHIPPED

| # | Task | Files touched | Status |
|---|------|---------------|--------|
| 1 | Fix invisible **Visible / Sold Out** label row | `css/dashboard.css` (lines ~750–810) | ✅ Done — `.pkg-edit-header` now locks `color: #1c2b48`, descendants use `color: inherit`, `.pkg-visible-toggle` got an explicit teal-on-light pill styling, and a new `.pkg-visible-toggle.is-soldout` modifier for the sold-out variant. Belt-and-braces `!important` on the inner `<span>` so themes can't bleed through. |
| 2 | Add **Category** dropdown | `js/dashboard.js → renderPackageEditorCards()` | ✅ Done — values `Budget · Standard · Deluxe · Luxury · Royal · Honeymoon`, saves to `pkg.category`. Lives next to the Image picker in a new 2-col row. Empty `''` is the default ("— Choose —"). |
| 3 | Surface category on public cards | `js/script.js` (`pkgCategory()` rewritten to read `pkg.category` first, then name heuristic, then legacy id), `pkgCategoryLabel()` + `pkgCategoryColor()` helpers, render template adds `<span class="mmt-cat-pill">` and `data-category` attr; `css/mmt.css` (`.mmt-cat-pill` rule) | ✅ Done — pill colour comes from `pkgCategoryColor(slug)`; bottom-left of card image. |
| 4 | Filter pills row | `index.html` `#mmtTabs` updated to **All / Budget / Standard / Deluxe / Luxury / Royal / Honeymoon**; `js/script.js → updateTabCounts()` gets six new buckets (plus a legacy `premium = luxury+royal` alias for any cached HTML); `applyFilters()` already drives off `mmtState.cat` so this is a one-line change. | ✅ Done — counts auto-update on every render. |

Cache-busters bumped: `js/script.js?v=31`, `css/mmt.css?v=29`, `js/dashboard.js?v=46`, `css/dashboard.css?v=10`. JS smoke-test (`node --check`) passes on both touched files.

**Open issue (carried into Phase 2):** existing packages in Firestore have no `category` field. They still group correctly because of the name-based heuristic in `pkgCategory()` (`/honeymoon/i → 'honeymoon'` etc.), but the dashboard editor's Category dropdown will show "— Choose —" until an admin saves each card. The Phase 4 backfill script will fix this in one shot.

### Phase 2 · MMT-style itinerary editor (~3–4 hours) — DEFERRED

> **Status (after this session):** Architecture finalised, code-attempt aborted mid-write. Reverted cleanly; nothing in Firestore changed. Resume in a fresh session — instructions below.

**Why deferred:** the diff size needed to land the typed-block editor exceeded the safe replace_in_file window twice in a row (the tool truncated mid-template-literal, leaving unterminated strings). Two reverts were necessary to get back to a working state. The code is **understood**; what's needed is a tighter, multi-file approach next session.

**Architecture decided this session (sticky for next session):**

* **Additive schema, not replacement.** Each `day` gets an optional `blocks[]` array alongside the existing `activities[]`. When `blocks[]` is non-empty, the public renderer shows the MMT-style typed timeline. When empty, it falls back to the legacy `activities[]` plain list. **This is critical** — it means existing packages keep working with zero migration risk, and admins can opt-in per-day.
* **Block types (final list):** `activity · transfer · hotel · sightseeing · meal · flight · hotel-checkout`.
* **Field schema (final, per type):** see attempted `js/itinerary-blocks.js` in the aborted commit. Schema lives in one constant (`BLOCK_FIELDS`) so the public renderer in `package.html` can read the same definitions.
* **Editor module strategy:** ship as a **separate file** `js/itinerary-blocks.js` (~250 lines, self-contained module), loaded from `dashboard.html`. Exposes `window.IteBlocks.wire(rootEl, dayObj, onChange)`. `js/dashboard.js → buildDayCard()` only needs a 5-line edit (insert `<div data-day-blocks>` markup + call `IteBlocks.wire`). This keeps the giant template literal in dashboard.js untouched and avoids the truncation bug entirely.

This is the big one. The existing `#itineraryEditor` overlay (admin-only, opened via the green pencil button) currently writes `pkg.itinerary` as a free-text string. We replace it with a structured editor.

#### New Firestore schema (per package doc)

```jsonc
{
  // existing fields (unchanged)
  "id": "honeymoon-2026",
  "name": "Honeymoon Package (4A) — 2026",
  "description": "4N/5D | Port Blair + Havelock | …",
  "price": 29999,
  "rating": 4.8,
  "inclusions": "Accommodation (Star Category), …",
  "image": "beach4.jpg",
  "visible": true,
  "soldOut": false,

  // NEW fields
  "category": "Honeymoon",                 // Budget|Standard|Deluxe|Luxury|Royal|Honeymoon
  "totalNights": 4,
  "totalDays": 5,
  "totalTransfers": 7,                     // header-bar counts (matches MMT)
  "totalHotels": 4,
  "totalActivities": 15,
  "totalMeals": 5,
  "destinationGuide": "Experience the beauty of the Andaman Islands…",  // bottom blurb
  "dayPlan": [
    {
      "dayNumber": 1,
      "dateLabel": "19 Jun, Fri",                  // optional
      "title": "Port Blair",
      "summary": "INCLUDED: 1 Hotel · 1 Transfer · 4 Activities",
      "blocks": [
        {
          "type": "activity",                       // activity|transfer|hotel|sightseeing|meal|flight|hotel-checkout
          "title": "Bella Bay Luxury Dinner Cruise",
          "duration": "2 Hours",
          "timeOfDay": "Evening",                   // Morning / Afternoon / Evening / Anytime
          "place": "Port Blair",
          "description": "Experience India's only true luxury cruise…",
          "imageUrl": "https://res.cloudinary.com/.../cruise.jpg",
          "imagePublicId": "live-chat/abcd",        // optional, for delete
          "rating": 4.6,                             // optional
          "ratingsCount": 775
        },
        {
          "type": "hotel",
          "title": "TSG Blue Resort and Spa",
          "starRating": 3,
          "address": "Radhanagar Beach | 10 minutes walk to Radhanagar Beach",
          "checkIn":  "20th Jun, 12 PM",
          "checkOut": "22nd Jun, 8 AM",
          "nights": 2,
          "roomType": "Aqua pool-View Room",
          "roomMeta": "340 sq.ft | King Bed | pv",
          "mealsIncluded": ["Breakfast"],
          "imageUrl": "https://…hotel.jpg"
        },
        {
          "type": "transfer",
          "title": "Ferry Tickets from Port Blair to Havelock - Nautika",
          "vehicle": "Shared Ferry",
          "duration": "1 Hour",
          "timeOfDay": "Anytime",
          "description": "Sail from Port Blair to Havelock Island…",
          "imageUrl": "https://…ferry.jpg"
        },
        { "type": "meal", "label": "Breakfast", "place": "In Port Blair" },
        { "type": "hotel-checkout", "place": "In Port Blair" }
      ]
    }
    // … one entry per day
  ]
}
```

The old `pkg.itinerary` string stays in the doc untouched — public `package.html` falls back to it when `pkg.dayPlan` is missing or empty.

#### New editor UI (`#itineraryEditor` overlay, replaces current body)

* Left rail: **Day Plan** sidebar — each day as a clickable button; "+ Add Day" at bottom; reorder via drag handles.
* Right pane: blocks list for the selected day.
  * Top inputs: **Day title**, **Date label** (optional), **Day summary**.
  * Block list: each block in its own card with type-specific fields.
  * Toolbar at top of blocks list: **+ Activity · + Transfer · + Hotel · + Sightseeing · + Meal · + Hotel-checkout · + Flight**.
  * Each card: drag handle, delete button, collapse toggle, **Upload image** button (Cloudinary unsigned preset already used by gallery → folder `package-itinerary/`).
* Top of overlay: a "Counts" strip — the four MMT badges (`7 TRANSFERS · 4 HOTELS · 15 ACTIVITIES · 5 MEALS`). These are auto-computed from `dayPlan` and **also** persisted to top-level fields so the public card can show them without parsing the whole array.
* Bottom of overlay: **Destination Guide** textarea (free text, becomes the bottom blurb on the public detail page).

#### Public renderer (`package.html`)

The existing free-text itinerary section gets replaced with an MMT-style timeline (mirrors the user's screenshots):

* Sticky left rail: dotted day list (Day 1 / Day 2 / …) with current-day highlighted.
* Main column: each day as a card with the orange "Day N" pill, summary line, then a stack of `block` rows.
* Row icons match the type (`fa-utensils` meal, `fa-bus` transfer, `fa-hotel` hotel, `fa-person-walking` activity, `fa-image` sightseeing, `fa-plane-departure` flight).
* Image lazy-loads with `loading="lazy"` and `decoding="async"`.
* Two CSS files reused: `css/mmt.css` (already in repo — was added earlier!) and a new section in `css/package.css`.
* If `pkg.dayPlan` is empty/missing → render the legacy free-text `pkg.itinerary` as before (no breakage for old packages).

### Phase 3 · MMT-style search bar (~1 hour)

Decision: **Option A** (per chat).

* Add a hero search row to **`index.html`** below the main hero:
  ```
  STARTING FROM            | TRAVELLING ON       | ROOMS & GUESTS | CATEGORY      | [ SEARCH ]
  Bangalore (typeahead)    | date picker          | adults+kids    | dropdown      |
  ```
* `Starting from` autocompletes from `js/cities.js` (already exists).
* `Travelling on` is a date picker, defaults to **today + 30 days**.
* `Rooms & Guests` is the same MMT-style mini-popup we use on the booking flow (adults / children / rooms).
* `Category` mirrors the new dropdown.
* SEARCH button → `location.href = '/packages?from=…&date=…&adults=…&children=…&category=…'`.
* `package.html` (the list) reads those query-string params and pre-applies the filters. The filter pills from Phase 1 stay synchronised.
* **Light "Tweak this trip" widget at top of every package detail page** (Option B from the chat) is *deferred* until after Option A ships — flagged as a P3 below.

### Phase 4 · Polish & ship

* Add a **`tools/migrate-package-categories.js`** one-shot script that infers `category` from package name keywords (`/honeymoon/i → 'Honeymoon'` etc.) and back-fills `dayPlan` with a single auto-generated day from the legacy free-text itinerary, so old packages don't look empty.
* Bump `?v=` cache-busters on the touched JS / CSS so stale browsers don't render the old version.
* Update `data/packages.json` (the static seed file) with the new schema so a fresh deploy + seed produces a fully populated MMT-style site out of the box.
* Smoke-test on all six dashboard themes — invisible-text bug should be gone everywhere.
* Verify staff role: editor opens, can save, but cannot **delete** packages (existing CSS rule keeps `.btn-del-pkg` hidden — confirm it still works after the rebuild).

---

## Files we'll touch

| File | What changes | Phase |
|---|---|---|
| `css/dashboard.css` | Fix package-editor header text colour | 1 |
| `js/dashboard.js` | Add Category `<select>` + new `_pkgEdit*` field bindings; rebuild `#itineraryEditor` overlay; new `renderDayPlan()` / `renderBlockCard()` helpers; per-block image upload helper | 1, 2 |
| `js/dataStore.js` | Default doc shape gets `category: ''`, `dayPlan: []`, etc.; `savePackage()` no schema change but normalises empty arrays | 1, 2 |
| `dashboard.html` | New itinerary overlay markup, "+ Add Block" toolbar, drag-handle CSS, day sidebar | 2 |
| `package.html` | New MMT-style timeline renderer; reads `pkg.dayPlan`, falls back to `pkg.itinerary`. Adds top "Tweak this trip" widget (Phase 3 deferred). Adds category pill on the hero. | 2, (3) |
| `index.html` | Hero search bar, category pills, related-package category surface | 1, 3 |
| `css/package.css` | New itinerary timeline styles; reuse `css/mmt.css` for the day-rail | 2 |
| `tools/migrate-package-categories.js` | One-shot back-fill for existing /packages docs | 4 |
| `data/packages.json` | Update seed with new schema | 4 |

---

## Open questions to confirm at start of next session

1. **Currency / pricing per day?** MMT shows one total price; your packages already do too. Stick with that — no per-day pricing. ✅ assumed.
2. **Image hosting for activity blocks** — confirm we can re-use the existing Cloudinary `andaman_unsigned` preset (folder `package-itinerary/`). The unsigned upload already works for the LIVE chat photo upload, so this should be a copy-paste. ✅ assumed.
3. **Drag-and-drop reordering** for days + blocks — nice to have. If we skip, just provide ↑/↓ buttons. (Plan: do drag for v1; ↑/↓ as fallback if mobile gives trouble.)
4. **Search bar — Option B widget on package detail page** — confirm we're skipping for v1, or include it.
5. **Should the public `/packages` list page be split out from `index.html`?** Currently the homepage is the de-facto package list. If you want a dedicated `/packages` page (matches the search-bar redirect), we'll create one. Otherwise we route `?from=…&category=…` into the homepage's existing package grid.

---

## Quick-resume checklist for next session

When opening the next chat, say:

> *"Continue from `package_redesign_plan.md`. Start with Phase 1 (fix invisible header text + add Category dropdown to dashboard editor + filter pills on public list). Confirm the open questions in the plan as you go."*

The model should:

1. `read_file package_redesign_plan.md` to load the full plan.
2. Review existing `js/dashboard.js → renderPackagesEditor()` to find the invisible-text DOM and the editor template.
3. Read `package.html` to understand the current public detail layout.
4. Read `index.html` to see where featured packages render today.
5. Open `css/dashboard.css` to find `.pkg-edit-head` rules (the invisible-text bug).
6. Start Phase 1 implementation and only proceed to Phase 2 after each phase 1 task is committed + smoke-tested.

---

## Already shipped this session (context)

Just so the next session has full context — these are **already live** on `upstream/main`:

| Commit | What |
|---|---|
| `93815d5` | Wired LIVE chat → Telegram bridge end-to-end |
| `929f0b5` | Per-customer threading in Telegram digest messages |
| `2c6deb7` | Hide Locks section from staff dashboard |
| `478d3b6` | Auto-reply on customer's first message + admin-editable text |

The Cloudflare `telegram-bridge` Worker is deployed to `https://telegram-bridge.pittu-das2.workers.dev`, all secrets installed, webhook registered, chat-id `8777900971` saved in `/settings/site`. Smoke-tested end-to-end; threading confirmed working.

Hand-off compl
