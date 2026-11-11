# Assets → Store

Status: design agreed with the user on 2026-10-29 (grilling session). Glossary:
`CONTEXT.md` § "Assets and store". Decision: `docs/adr/0009-store-usage-derived-from-stock-counts.md`.

## Scope

A new top-bar section **Assets / الأصول** (after Vehicles). Its first and only tab
is **Store / المخزن**; a later, separate worktree adds a site-assets tab next to it.
Store tracks quantity and expiry of HQ-supplied consumables. No money anywhere.

Out of scope: site assets, handout logging, notifications (push/SMS/WhatsApp),
multiple stores, Client material requests (Arabic MRF) in stock numbers.

## Rules (from the glossary, made operational)

- **Store item**: `code` `ST-0001` running number (never reused, never encodes the
  category), `name_en`, optional `name_ar`, one category, Counting unit (en/ar,
  default Carton/كرتون), optional "contains" (`contains_qty` + unit en/ar), optional
  Minimum level, archive instead of delete.
- **Categories**: small table, seeded Pantry/ضيافة and Protective/وقاية; store
  editors can add/rename.
- **Quantities** are integers in **base units**: loose units when the item has
  `contains_qty`, otherwise Counting units. `contains_qty` cannot change once the
  item has any delivery, count, or disposal line (`STORE_ITEM_CONTAINS_LOCKED`).
  The UI enters "N cartons + M loose" and converts.
  Delivery-note scan numeric quantities are interpreted in the selected item's
  Counting unit (not stored base units); confirming or rematching converts both
  received and noted quantities with that item's contains rule. For example,
  8 cartons containing 24 jars save as 192 base units, with no difference reason
  unless the received quantity actually differs. The scan route requires both
  `store.view` (including its item picker) and `store.edit`, like Stock count entry.
- **Batch** = (item, expiry). Expiry is a date or null (undated batch, one per
  item). Month-only expiry is stored as the month's last day with
  `expiry_month_only = true`. Batches are created on first use by a delivery or a
  count line; never edited by hand.
- **Monthly delivery**: `received_on`, note, lines (item, expiry, quantity),
  optional delivery-note file (pdf/png/jpg/webp, 10 MiB). Not linked to an MRF.
  Several deliveries per month are allowed (rare corrections).
- **Stock count**: `counted_on`, note, lines per batch. At most one count per
  calendar month (`month` String(7) unique); editing replaces its lines. A count
  must include every batch whose expected on-hand at `counted_on` is > 0
  (`STORE_COUNT_MISSING_BATCHES`, details list them); it may add new batches.
  The count screen is entered blank (ADR 0009).
- **Disposal**: `disposed_on`, batch, quantity, reason `expired|damaged`, note.
- **Same-day ordering**: a delivery or disposal dated on a count's day happens
  after that count.
- **On-hand per batch** = latest count line on or before today (0 if the batch was
  absent from that count) + deliveries on/after that count date − disposals
  on/after that count date. With no count yet: deliveries − disposals.
- **Monthly usage** (per item, per window between consecutive counts c₁ < c₂):
  Σ c₁ lines + deliveries in [c₁, c₂) − disposals in [c₁, c₂) − Σ c₂ lines.
  Labelled with c₂'s month. Negative values are shown, flagged, not clamped.
- **Suggested request quantity** = max(0, ceil(mean of the last ≤3 usage windows)
  − on-hand), in base units, plus the same rounded up to whole Counting units.
  No usage window yet → no suggestion.
- **Expiring soon**: on-hand > 0 and 0 ≤ days to expiry ≤ 60. **Expired**:
  on-hand > 0 and expiry < today. **Low stock**: Minimum level set and item
  on-hand < Minimum level.

## Capabilities

`store.view` (label "View store" / "عرض المخزن"): Assets nav, all reads. Added to
the manager preset (`_MANAGER_EXTRA`). `store.edit` ("Manage store" / "إدارة
المخزن"): all writes. Admin-only by default, granted per user to the storekeeper.
Domain heading `access.permissions.domains.store`. The MRF item picker endpoint
accepts `store.view` OR `documents.generate`.

## API (`/api/v1/store`, router `backend/app/api/v1/store.py`)

| Method | Path | Cap | Notes |
| --- | --- | --- | --- |
| GET | `/categories` | view | `[{id,name_en,name_ar}]` |
| POST / PATCH | `/categories`, `/categories/{id}` | edit | |
| GET | `/items?include_archived=` | view | `StoreItemRead` incl. `on_hand`, `category`, `version` |
| GET | `/items/picker` | view or documents.generate | active items: code, names, units |
| POST | `/items` | edit | code allocated server-side |
| PATCH | `/items/{id}` | edit | If-Match `version` |
| POST | `/items/{id}/archive`, `/items/{id}/restore` | edit | |
| GET | `/batches?item_id=` | view | batches with `on_hand`, `days_to_expiry` |
| GET / POST | `/deliveries` | view / edit | lines `{item_id, expiry_date, expiry_month_only, quantity}` |
| GET / DELETE | `/deliveries/{id}` | view / edit | |
| PUT / GET / DELETE | `/deliveries/{id}/note-file` | edit / view / edit | `?encoding=base64` on GET |
| GET / POST | `/counts` | view / edit | lines as deliveries; `expected` endpoint below |
| GET / PUT | `/counts/{id}` | view / edit | PUT replaces lines |
| GET | `/counts/expected?counted_on=` | view | batches that must be counted (item, expiry); never their expected quantities (ADR 0009) |
| GET / POST | `/disposals` | view / edit | |
| DELETE | `/disposals/{id}` | edit | |
| GET | `/dashboard` | view | expiring_soon, expired, low_stock, usage (last 6 windows), suggestions, last_count_on, last_delivery_on |

Errors use `STORE_*` codes. Every mutation writes an `AuditLog` row
(`entity_type="store_*"`).

## Frontend

- Nav `{ to: '/holdings', key: 'nav.assets', Icon: Boxes, cap: 'store.view' }` after
  `/vehicles`. `/holdings` redirects to `/holdings/store`. The URL is not `/assets`:
  that prefix is the backend's mount for Vite's hashed build files and the service
  worker caches it cache-first, so a page there 404s on reload and can be pinned
  stale by installed apps (found in the merged smoke test, 2026-10-30).
- Section tabs (NavLink sub-routes, EmployeesSectionTabs style): Assets → Store.
  Store sub-tabs: Dashboard `/holdings/store`, Items `/items`, Deliveries
  `/deliveries`, Counts `/counts` (+ `/counts/new`, `/counts/:id`), Disposals
  `/disposals`. Desktop tables and mobile cards for every list; count screen is
  mobile-first.
- MRF item picker fills the English HQ paper in English whatever the UI language.
- Dashboard: expired, expiring soon (60 days), low stock, usage table (last 6
  months), suggestions with **Create HQ request** → `saveDraft('Material Request
  Form', {items})` then `/services/material_request?paper=en`; ApplicationPage
  honours `paper=en` by skipping the Arabic-UI redirect. Hidden unless the user
  can open the MRF service.
- Home widgets `store_expiring` and `store_low_stock` (source `store`, gated by
  `store.view`), registered in both `lib/dashboardLayout.ts` and
  `backend/app/schemas/dashboard.py`.
- MRF item picker: `_fields.json` English MRF `items` gets
  `"item_catalog": "store"`; `TemplateField.item_catalog` passes through to
  `ItemsTableField`, whose Code cell becomes a combobox over `/store/items/picker`
  (fills code, description, unit); free text stays allowed. Arabic MRF unchanged.

## Opening stock

`scripts/store_import_opening.py` + `scripts/store_opening_2026-10-29.json`
create the 13 items and the October Stock count from the WhatsApp count (Red
Label expiry 2029-01, Green tea packets, water/gloves/masks undated). Idempotent:
refuses if any Store item exists.

## Build slices

1. Backend (one writer): models, migration `0111_store`, service, schemas, API,
   capabilities, dashboard widget ids, `item_catalog`, import script, tests,
   `openapi.json` + `api.types.ts` + `lib/api.ts` store methods/types.
2. Frontend A: Assets section, Store pages, nav/routes/permissions page,
   `nav.assets` / `assets.*` / domain locales, tests.
3. Frontend B: home widgets, MRF picker, `?paper=en`, Create-HQ-request helper,
   `dashboard.widgets.store_*` / picker locales, tests.

## Progress

- 2026-10-29: design, glossary, ADR committed (`ba4deae7`).
- 2026-10-29/30: three dtop writers (store-backend, store-fe-pages,
  store-fe-links) merged into `feat/assets-store`. Backend review (6 should-fix:
  backdated disposals, RFC 5987 filenames, serialized stock writes, atomic import,
  upload cleanup) fixed by the backend writer. Both frontend writers ran the
  i18n-rtl reviewer; integrator fixed its open must-fix (the picker fills the English
  HQ paper in English regardless of UI language).
- Deliberately not done: `contains_locked` on `StoreItemRead` (the dialog locks after
  the server refuses, which is correct; up-front locking is polish).
- 2026-10-30 verification (dtop, merged branch): backend full suite 4045 passed;
  the 4 failures + 1 error also fail on `origin/main` (pre-existing). Frontend:
  full vitest, `tsc`, lint (0 errors) green; ruff, format check, numbering green.
- 2026-10-30 smoke (laptop, fresh scratch DB, built bundle): opening import created
  13 items / 23 count lines; dashboard flagged Coffee-mate Nov/Dec batches and
  low-stock gloves; suggestion math checked by hand; Create HQ request opened the
  English MRF prefilled in both UI languages; picker filled English in the Arabic
  UI; mobile count screen showed 23 blank inputs. Found and fixed the `/assets`
  route collision (reload 404) by moving the section to `/holdings`.
- 2026-10-30 dev channel: the 22 store commits were cherry-picked onto `dev`, plus
  dev-only `9acb3d15` renumbering the migration to `0117_store` after `dev`'s
  `0116` (never promote it). Conflicts resolved toward `dev`: capability-count test
  (removed on dev), PermissionsPage (rewritten as the access studio, catalog-driven),
  `api.types.ts` regenerated. 66 store/migration tests pass and `tsc` is clean on
  `dev`. Published; opening stock imported into dev data (13 items, 23 lines).
- Next: user tests on the dev URL, then PR from `feat/assets-store` after
  renumbering the migration onto main's head.

## Approved Store-count Phase 2 (2026-11-02)

- Built on `feat/store-count` after approval of `mockups/plan/store-count/`
  (`d0510039`). The approval supersedes the prototype's per-line receipt
  confirmation: receiving has one final review of all lines.
- Migration `0114_store_count` (recovered after `0113_store_room`) adds optional brand, bilingual generic labels,
  short shelf names and separate pack descriptions, plus optional per-delivery
  carton-contents metadata. The 13 exact-name backfills preserve official item
  names, stock quantities and recorded pack conversions. Unknown contents remain
  unknown; receipt metadata never invents a conversion.
- Drawings and short-name/pack-line presentation now cover Store records,
  shelves, drawers, pickers, movements, handovers, home widgets and the HQ MRF
  picker. Original English names still fill the HQ paper. New items use drawing
  kind/colour and labels only; there is no custom-picture upload.
- Blind counts show one item with all its expiry batches, explicit blank versus
  zero, progress and illustrated missing-batch review. Only operator-entered
  values resume locally, scoped by signed-in user, date and new/edit target.
  Save and confirmed discard clear only that draft. ADR 0009's ledger, usage,
  suggestion and same-day ordering rules are unchanged.
- Real scratch-browser checks covered scan correction and all-lines review,
  unavailable OCR with the file retained, retry after a genuine file-write
  failure, finish without file, drawing-first disposal, handovers, count resume,
  blind edit and a real missing-batch race. Optional contents of 24 with 3
  received cartons increased an unknown-pack item's stock by 3, not 72.
- Source-branch checks (historical, not recovery-integration results): backend
  123 passed; frontend 925 passed across 98 files; TypeScript, build and Ruff
  passed; lint 0 errors (27 existing warnings). Required source i18n/RTL and
  migration reviews closed, as did the behavior review. Its local Alembic head
  was `0112_store_count`; the recovered head is `0114_store_count`.
- Local evidence: `.tmp/store-count-phase2/final-matrix.json` indexes 528
  Playwright captures, 66 states × EN/AR × light/dark × 390/1440, including the
  home Dashboard. Latest captures have zero axe violations and zero horizontal
  page overflow; axe's incomplete checks remain recorded, not claimed as passes.
  Details and check history are in `.tmp/handoff-store-count.md`.
- No push, PR, merge, deployment or dev publication in this phase. Parent
  integration/renumbering and the deferred `think-aloud.md` session remain outside
  this build; no laptop data or `.env` was copied.
- Recovery integration (2026-11-03): exact research `d0510039` and all approved
  implementation paths from `7fca5e04` are integrated on main `77c3ff1e`, retaining
  PR #276 historical migration recovery, localized quantity input and historical
  disposal handling. Both API contracts are required committed artifacts.
  Expanded all-13 backfill/ledger-preservation and historical-upgrade regressions
  are authored but **not run**; integrated browser/review/check evidence remains
  pending the coordinator's final pass. No source/dev/production data mutation,
  push, PR, merge or deployment is part of this integration.

## Open notes

- Code treats English/Arabic MRF as language variants of one service (Arabic UI
  auto-switches to the Arabic paper), while the domain says they are different
  requests (HQ vs client). Raised with the user; not changed here beyond
  `?paper=en`.
- Migration and ADR numbers collide with open PRs #258/#268/#271/#272 (0110,
  ADR 0007/0008). ADR took 0009; renumber the migration at merge time.
