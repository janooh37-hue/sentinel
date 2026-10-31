# Store room: dashboard redesign, handovers, In & out

Status: design agreed with the user on 2026-10-31. Builds on `feat/assets-store`
(read `mockups/plan/assets-store.md` first; everything there still holds unless
this file says otherwise).

Worktree: `/home/amh/Projects/sentinel-wt/store-room`, branch `feat/store-room`,
cut from `feat/assets-store` at `691635e1`.

Visual reference: `mockups/store-room.html`. Open it in a browser. It is a single
file with sample data and runs on its own. Use the **Sample data** switch for the
two states ("Today (1 count)" is the real situation; "After 3 months" shows usage,
deliveries and a disposal) and the **English / العربية** switch for RTL. The
mockup is the spec for layout, wording and behaviour. Its colours already use
the app tokens from `frontend/src/index.css`. Copy its Arabic strings into
`ar.json`; they were written for this feature.

## What the user asked for

1. **A dashboard that does not feel empty or confusing.** The current
   `StoreDashboardPage` is a list of mostly empty tables. Replace it with the
   **store room**: every Store item drawn on its shelf, so people find things by
   picture instead of by reading rows.
2. **Drawn item pictures, not photos.** The user chose simple flat drawings over
   photos: lighter, faster, clearer. Do not add photo upload.
3. **Handovers.** Tapping an item lets the storekeeper record stock handed out:
   quantity, **taken by** (free-text name), optional note. The signed-in user is
   recorded as **recorded by**. One handover can cover **several items**: a
   picking mode where each tap on a shelf adds one, a bottom tray to adjust
   quantities, then one name and one Record button for all of them.
4. **In & out tab.** A new Store sub-tab listing everything received (Monthly
   deliveries) and everything that left (Handovers, Disposals). One row per
   record: date and time, item pictures, item names with quantities, who took
   it, who recorded it. Selecting a row shows the full detail.
5. **Everything else stays the same.** Items, Deliveries, Stock counts and
   Disposals pages, the home widgets, the MRF picker, `?paper=en`, the Create HQ
   request flow, the usage and suggestion maths: unchanged.

## Domain changes

### New term: Handover (صرف)

Add to `CONTEXT.md` § "Assets and store":

> **Handover**:
> Stock handed out of the store to a named person (صرف), recorded with who took
> it, who recorded it and when. One Handover can cover several Store items. It
> takes from each item's earliest-expiring Batch first.
> _Avoid_: Issue, withdrawal, handout, consumption log

Also edit the **Monthly usage** entry: its _Avoid_ line lists "handouts". Keep
the definition (usage is still derived from counts) and add one sentence: "A
Handover reduces what is on the shelf but is not added to Monthly usage; the
next Stock count already reflects it."

### ADR

ADR 0009 says nobody records handouts. Write a new ADR (next free number:
run `venv/Scripts/python.exe scripts/check_numbering.py`; 0007/0008 are taken by
open PRs) titled roughly "Store records Handovers; Monthly usage stays derived
from Stock counts". Set ADR 0009's status to `superseded in part by 00NN` in its
front matter. Content:

- The user wants to know who took what. Handovers are recorded.
- **Monthly usage is still derived from Stock counts**, unchanged. Handovers are
  not summed into usage, so stock taken without a Handover is still counted, and
  the usage history stays comparable (the risk ADR 0009 raised).
- Handovers reduce on-hand between counts, so the dashboard is current between
  monthly counts.
- Counts stay blank (ADR 0009's rule stands).

### Rules

- **Handover**: `handed_on` (date, not in the future, default today), `taken_by`
  (free text, 1-128 chars, stored as typed), optional `note`, lines (item,
  quantity ≥ 1). `created_by_user_id` and `created_at` are the "recorded by" and
  the time shown in the UI.
- **Batch choice is server-side, earliest expiry first (FEFO).** The client
  sends item + quantity. The service splits each line across Batches: dated
  Batches by ascending expiry, then the undated Batch. Batches already expired
  on `handed_on` are skipped (expired stock is disposed of, not handed out).
  Store the resolved per-batch lines (`store_handover_lines`: handover_id,
  batch_id, quantity).
- A line asking for more than the item's non-expired on-hand at `handed_on` is
  refused with `STORE_HANDOVER_SHORT` (details: item, available). Reuse the
  existing never-below-zero check (`_Ledger` balance over later points), as
  disposals do.
- **Ledger**: in `_load_ledger`, add handover lines as `_Event(batch_id,
  handed_on, -quantity)` so `on_hand` includes them. **Exclude them from
  `usage_windows`.** Today that method sums every event in the window; give
  `_Event` a kind (or keep handovers in a separate list) so usage stays
  `Σc₁ + deliveries − disposals − Σc₂`. Add a test that proves a Handover inside
  a window leaves that window's usage unchanged.
- **Same-day ordering**: like deliveries and disposals, a Handover dated on a
  count's day happens after that count.
- **Delete**: `DELETE /handovers/{id}` (store.edit) for mistakes, with an
  AuditLog row, like disposals. No edit; delete and record again.
- Audit every mutation (`entity_type="store_handover"`).

## Backend

| Method | Path | Cap | Notes |
| --- | --- | --- | --- |
| GET | `/store/handovers` | view | newest first |
| POST | `/store/handovers` | edit | `{handed_on, taken_by, note, lines: [{item_id, quantity}]}` → `StoreHandoverRead` with resolved per-batch lines |
| GET / DELETE | `/store/handovers/{id}` | view / edit | |
| GET | `/store/movements` | view | the In & out feed, see below |
| GET | `/store/handovers/takers` | view | distinct `taken_by` values, most recent first, for the name suggestions |

`/store/movements` returns one row per record, newest first, merging
deliveries, handovers and disposals: `{kind: "in"|"out"|"disposed", id, on,
created_at, recorded_by_name, recorded_by_name_ar, taken_by?, note?, reason?,
note_file?, lines: StoreLineRead[]}`. Optional `?kind=` and `?q=` (matches
taken_by, recorded-by name, note, item code, item names). Show the recorded-by
name, not the user id. Resolve names with the existing helper pattern
(`timesheet_service._display_names` or `book_service.user_display_name`; book
schemas already expose `created_by_name` / `created_by_name_ar`).
Optional `?from=YYYY-MM-DD&to=YYYY-MM-DD` filter on the event date `on`,
both bounds inclusive; an invalid date or `from` after `to` returns 422. The
In & out page exposes them as labelled "From date" / "To date" inputs with
"Clear dates" (not persisted in the URL).

Migration: one new revision after `0110_store` on this branch
(`store_handovers`, `store_handover_lines`, plus the two item drawing columns
below). Follow the SQLite migration rules, which this branch predates: read them
with `git show main:backend/app/db/migrations/CLAUDE.md` (single head, batch
mode for ALTERs).
The `dev` branch carries this store migration as `0117_store`; renumbering for
`dev`/`main` happens at merge time, as `assets-store.md` already notes.

Then resync the contract: `/sync-api-types` skill (openapi.json + api.types.ts
committed together), and add the `api.ts` methods.

## Item drawings

The shelves and every list show a small flat drawing per item, built from simple
SVG shapes: see `draw()` in the mockup. Do not use photos.

- Add to `StoreItem`: `art_kind` (nullable String(24)) and `art_color`
  (nullable String(7), `#rrggbb`). Expose both in `StoreItemRead`,
  `StoreItemRef` and the picker. Accept them in create/update.
- Frontend `components/StoreItemArt.tsx` renders the SVG from `(art_kind,
  art_color)`. Kinds from the mockup: `jar, canister, box, tins, water, cups,
  bigcups, tissue, gloves, mask`. Also add a plain `carton` default for items
  with no kind, coloured from the category. The second colour and the short
  label in the mockup (`art[2]`, `art[3]`) can be derived (a shade of the main
  colour; label from the counting unit or left out). Keep it one
  `aria-hidden` SVG: the item name is always printed next to it.
- `StoreItemDialog`: a "Picture" field, a row of the kinds drawn small plus a
  few colour swatches, with a live preview. Optional.
- Set the 13 real items' kinds in the opening data or a one-off data migration
  only if the user agrees. The mockup's `ITEMS` list has a sensible kind and
  colour for each.

## Frontend

### Dashboard (replace `StoreDashboardPage` body; keep `StoreShell`)

In order, matching the mockup:

1. Page header: title, description, actions: **Create HQ request** (existing
   `openHqMaterialRequest`, same visibility rule) and **Hand out items**
   (primary, `store.edit` only).
2. **Month strip**, four steps: Monthly delivery (last date or "None yet"),
   Stock count (last date, "1 of 2 counts recorded" until there are two),
   Monthly usage (calculated or "Needs a second count"), HQ material request
   (n items suggested or "No suggestions yet"). It replaces the "Last stock
   count / Last monthly delivery" pair. All values come from `/store/dashboard`.
3. **Status chips**: All items, Expired, Expiring soon, Below minimum, with
   counts. A zero still shows (greyed). Selecting one dims the other items on
   the shelves. Plus the "Expiring soon = within 60 days" note
   (`expiring_soon_days`).
4. **Shelves**: one panel per Store category (categories are the shelves; the
   user can add or rename categories as today). Items stand on a plank (a thick
   bottom border in a `--shelf` token, light `#c9c3b4` / dark `#4a5370`). Each
   item: drawing, name (2 lines max), on-hand with unit, and a small status
   badge above it (expired / "30d" / "Low"). Status is never colour alone.
5. **Recent handovers**: the last 4 Handovers as In & out rows, with "See all
   in In & out". Show each item's quantity with its own counting/loose units;
   do not sum unlike units into one mixed "units" total.
6. **Monthly usage and suggested request**: keep the existing usage table (last
   6 months) and suggestions table and their notes as they are, moved here.

**Item drawer** (tap an item, when not picking): drawing, name, code, category,
big on-hand, meter with minimum tick, status badges; **Hand out** form
(quantity stepper capped at non-expired on-hand, Taken by with suggestions,
note, "Taken from the batch expiring … first", "Recorded by <you>", Record
handover, "Add to a multi-item handover"); batches with an expiry timeline
(the 60-day zone shaded, pins merged when close) and the batch list; usage and
suggestion for this item; the item's last 3 handovers (each opens its
record); buttons to the existing count and disposal dialogs. Viewers without
`store.edit` see the drawer without the form.

Use the existing dialog/sheet primitives (right-side sheet on desktop,
bottom sheet or full-screen on phones), not a hand-rolled drawer.

**Multi-item handover**: "Hand out items" enters picking mode. Each shelf item
gets a "+" bubble; a tap adds one (the bubble shows the count); items with no
non-expired stock are dimmed and cannot be added. A tray fixed to the bottom
lists the picked items (drawing, name, stepper; "−" at 1 removes), one Taken
by, one note, Recorded by, **Cancel** and **Record handover · N items**. One
`POST /store/handovers` with all lines. On success: toast "Recorded: N items
handed to <name>.", leave picking mode, refresh store queries
(`invalidateStoreQueries`).

The empty picking tray is a compact shelf hint and Cancel action; its form
appears after the first item is added. The taker and note draft lives above
the single-item form and tray so transfer between them preserves both fields.
Submission shows localized "Recording…" and marks the form `aria-busy`.
The tray measures its obstruction with `ResizeObserver`, reserves bottom
padding and scroll padding on the dashboard scroller, and restores both on
close. Its scrollable height follows the visual viewport while the keyboard
is open, focused controls scroll into view, and the form actions stay sticky.
Closing picking returns focus to "Hand out items". Expiry dates interpolated
into the Arabic hint are isolated as LTR runs.

### In & out (new sub-tab `/holdings/store/movements`)

Add to `STORE_TABS` in `StoreShell.tsx` after Dashboard (`key: 'movements'`),
the route in `App.tsx` with `store.view`, the loader and prefetch like the
other store routes.

- Header with **Hand out items** (goes to the dashboard in picking mode).
- Filter chips with counts: All, Received, Handed out, Disposed. Search box
  (name or item).
- Rows grouped by month. Each row: kind icon (in / out / disposed, distinct
  colour and icon), day and time, up to 3 stacked item drawings, item names
  with "×qty" (summed per item; a Handover split over batches still shows the
  item once), a "who" line ("To <taken by> · recorded by <user>", "From HQ ·
  recorded by …", or "<reason> · recorded by …"), the total (one item: "−2
  cartons"; several: "3 items" + "5 units") and a chevron. Phones drop the
  pictures and the chevron and stack the date under the text (see mockup at
  390 px).
- Selecting a row opens the record: kind, item and unit totals, date and time
  (Received on for deliveries), Taken by, Reason, Recorded by (avatar
  initials + name), note, the delivery-note file (existing download route),
  and every line with drawing, name, code, batch ("Batch expiring 30 Nov 2026"
  or "Undated batch") and signed quantity. Handover detail offers Delete for
  `store.edit` (confirm dialog), like the Disposals page.

### Shared

- Quantities use the existing `formatQuantity` (contains/loose units).
- Wrap signed numbers in `<bdi dir="ltr">` so "−2" reads correctly in Arabic.
- New locale keys under `assets.store.dashboard.*`, `assets.store.handovers.*`,
  `assets.store.movements.*`, `assets.store.tabs.movements`, all in both
  `en.json` and `ar.json`. Extend `locales/assets.i18n.test.ts` parity.
- Arabic plurals through i18next `_one/_two/_few/_many/_other` (the mockup's
  `arItems`/`arDays` helpers show the forms wanted).

## Out of scope

Photos; editing a Handover; Handovers counted into usage; per-person usage
reports; notifications; changes to the Items, Deliveries, Stock counts and
Disposals pages beyond the item Picture field; the home widgets.

## Verification

- Backend tests: handover create (single, multi, FEFO split, skips expired,
  refuses short, refuses future date), delete, audit rows, movements feed
  ordering and filters, takers list, **usage unchanged by a handover**, on-hand
  reduced by a handover, same-day-as-count ordering, permissions (view vs edit).
- Frontend tests: dashboard renders shelves per category with badges; picking
  mode adds and caps; tray posts one request; In & out rows and detail; i18n
  parity.
- Gates: `ruff check`, `ruff format` on changed files, `mypy`, pytest for
  `test_store_*` and `test_migration_*` (the full suite takes ~25 min; run it
  once in the background), `pnpm -C frontend test`, `lint`, `tsc -b --noEmit`,
  `scripts/check_numbering.py`.
- Run the `i18n-rtl-reviewer` agent on the frontend diff.
- Smoke on a scratch DB with the opening import: hand out 3 Coffee-mate (takes
  the 30 Nov batch first, then 2 Dec), check the shelf count drops and the
  usage table does not change; record a 3-item handover; find it in In & out;
  open it; check both languages at 390 px and 1440 px.

## Commit and handover back

Commit in slices (backend, contract sync, frontend) on `feat/store-room`. Do not
push to `main` or `dev`; the user decides when this joins `feat/assets-store`
and the dev channel. Report results in a Progress section at the end of this
file.

## Addendum 2026-10-31: delivery-note scan, dedupe, build order

Agreed with the user on 2026-10-31. Everything above still holds.

### Scan a delivery note → confirm what arrived

HQ sends an English delivery note listing item, quantity and price. Price is
ignored (HQ handles finance). The note is often wrong about what actually
arrived, so the scan is an **assist**: it prefills a confirm page; the
storekeeper corrects it. Same policy as the vehicle-licence scan.

- **OCR**: Tesseract, local only (installed on the server and the laptop). Reuse
  `backend/app/core/extraction/ocr.py` (`OCR_GATE`, `load_image`,
  `pdf_to_images`, `_prepare`, `OcrUnavailableError`). Word boxes through
  `pytesseract.image_to_data`, `lang="eng"`. No new OCR path, no cloud.
- **Endpoint**: `POST /store/deliveries/scan` (store.edit), multipart file, same
  type/size rules as the delivery-note file (reuse that validator). Stores
  nothing. Returns `{pages: [{width, height}], lines: [{raw_text, item_id|null,
  match_score 0-100, quantity|null, confidence 0-100, page, bbox{x,y,w,h}}],
  ocr_available}`. Rows that are clearly not items (headers, totals) are
  dropped; doubtful rows are returned with `item_id: null`.
- **Parsing**: per OCR row, take the item text and the quantity; decimals and
  currency-looking numbers are prices and are ignored. Keep the heuristic in one
  pure module (`core/extraction/delivery_note.py`) with unit tests on synthetic
  rows; it is calibrated later on the user's real notes.
- **Item match**: normalise (case, punctuation, Arabic-Indic digits), then
  `rapidfuzz` against item code, `name_en`, `name_ar` and **aliases**. Score ≥ 85
  → `item_id` set; below → null, the user picks.
- **Aliases** (new table `store_item_aliases`: id, item_id, alias_norm unique,
  created_by_user_id, created_at): when a delivery is saved from a scan, every
  line whose `source_text` is set upserts `alias_norm(source_text) → item_id`. So
  a note line the user matched once matches itself next time.
- **Noted vs received** on `store_delivery_lines`: new nullable
  `noted_quantity` (what the note said) and nullable `difference_reason`
  (free text, ≤ 200). `quantity` stays "received" and is what stock uses.
  Rules: when `noted_quantity` is set and differs from `quantity`, a reason is
  required (`STORE_DELIVERY_DIFFERENCE_REASON`). `quantity` may be 0 only when
  `noted_quantity > 0` (listed on the note, nothing arrived); a 0 line is a
  no-op in the ledger. Manual deliveries leave both null. `StoreLineRead`
  exposes both, so Deliveries and In & out show "Note said 10 · received 8 ·
  <reason>".
- **Confirm page** `/holdings/store/deliveries/scan` (store.edit), entered from
  a "Scan delivery note" button on Deliveries (and the mobile card list).
  Mobile-first: file input with `accept="image/*,application/pdf"` and
  `capture="environment"` on phones. Steps: choose/take photo → reading (busy
  state, cancellable) → confirm. Confirm = the shared delivery line editor,
  prefilled, plus per line: a crop of that row from the photo (client-side from
  `bbox`; the file never leaves the browser twice), "On note" (read-only) next
  to "Received" (editable, defaults to the note), a reason field that appears
  when they differ, expiry (required, typed from the packaging; the note has no
  expiry), an item picker when unmatched, and "Not a store item: skip". Low
  confidence or unmatched rows are highlighted and listed first in a summary
  ("2 rows need a look"). Status is never colour alone. Save = existing
  `POST /store/deliveries` with `source_text`/`noted_quantity`/
  `difference_reason` per line, then the existing note-file upload with the same
  photo. OCR unavailable or nothing read → say so and offer the manual delivery
  dialog with the photo already attached.
- **Accuracy check** happens after the build, on the user's real notes
  (field-level accuracy: item match, quantity). Not a build gate.

### Item drawings for the 13 real items

User agreed: set `art_kind`/`art_color` from the mockup's `ITEMS` list. Add them
to `scripts/store_opening_2026-10-29.json` (import sets them) and a one-off
`scripts/store_set_art.py` (idempotent, only fills nulls, matches by `name_en`)
for databases already imported (dev).

### Dedupe (from the 2026-10-31 jscpd + semantic scan, tiers A and B)

Before building, merge the duplicates found in the store code so store-room
and the scan do not copy them a third time. Canonical = the best
implementation per case; callers' behaviour is kept. Baseline: jscpd 23 clones
touching store code (`npx -y jscpd@4 --min-tokens 50 --reporters console
--format "python,typescript,tsx" backend/app frontend/src`). Not in scope:
cross-app combobox hook and generic query-state frame (tier C).

### Build order

1. Wave 1, dedupe: backend writer and frontend writer, disjoint directories.
2. Wave 2, backend: handovers, movements, drawings, scan, noted vs received,
   aliases; one migration `0111_store_room` after `0110_store`; contract sync.
3. Wave 3, frontend: store-room pages writer and scan/confirm writer.
4. Reviews (i18n-rtl, alembic), full suite, dev channel, then a UX/best-practice
   review of the new pages.

## Backend progress (2026-10-31)

- Migration `0111_store_room` supplies the handover/alias tables, item-art columns,
  delivery-note quantity columns and nonnegative delivery-quantity check. Its
  reversible downgrade deletes stock-neutral zero-quantity delivery lines before
  restoring the old positive-quantity constraint.
- Handovers and the In & out feed are implemented with the capability gates above.
  Handover names retain exactly what was typed; whitespace-only names are refused.
  Duplicate input item lines merge before FEFO allocation. The shared ledger's
  disposable capacity protects later balances for backdated handovers. Handovers
  reduce stock but never enter derived usage windows. Recorder names use Book's
  existing English/Arabic batched resolvers.
- Dashboard month-strip metadata is `counts_recorded` (total counts),
  `usage_ready` (a consecutive-count window exists), `suggestion_count`
  (suggestions array length), plus the existing `expiring_soon_days: 60`.
- Backend selection (`store or migration or extraction`): 189 passed, 1 unrelated
  migration test failed, 3948 deselected. The old inmate-violations migration test
  compares pre-head Book columns against the full head's existing
  `confidentiality`/`send_state` columns. Ruff and numbering pass; there is one
  head, `0111_store_room`. Repo-config mypy reports 59 errors in 14 untouched
  files, with none in the changed files.
- Item art is exposed on item, picker and batch-reference responses, validated
  on create/update, and included in all 13 opening items. `store_set_art.py`
  fills only null drawing fields by exact English name.
- Delivery-note scanning is implemented without persistence, using the shared
  upload policy and word-box OCR under exactly one OCR gate. The parser ignores
  prices and document headings, normalizes Arabic-Indic digits, and returns
  doubtful descriptions for confirmation. Page indices are zero-based.
- Delivery creation supports input-only source text, normalized aliases and
  noted-versus-received quantities. Differences require a reason; receiving zero
  requires a positive noted quantity and changes no stock. There is no delivery
  update route in the existing API; count updates remain unchanged.
- OpenAPI and TypeScript contracts include the new endpoints and store fields.
  The API client has typed handover, movement-filter and multipart scan methods.
  Frontend implementation remains a separate slice; typecheck flags existing
  fixtures and the count page's locally constructed batch rows that omit art.

