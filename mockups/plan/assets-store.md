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

1. Backend (one writer): models, migration `0110_store`, service, schemas, API,
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
- Next: publish to the dev channel (blocked: the dev worktree has staged changes
  from another session; on `dev` the migration must sit on `0116`), user tests,
  then PR from `feat/assets-store` after renumbering the migration onto main's head.

## Open notes

- Code treats English/Arabic MRF as language variants of one service (Arabic UI
  auto-switches to the Arabic paper), while the domain says they are different
  requests (HQ vs client). Raised with the user; not changed here beyond
  `?paper=en`.
- Migration and ADR numbers collide with open PRs #258/#268/#271/#272 (0110,
  ADR 0007/0008). ADR took 0009; renumber the migration at merge time.
