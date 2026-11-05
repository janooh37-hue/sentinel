# Uniform / الملابس: build spec

Status: approved for build. UI spec: the mockup in this folder (`index.html`, `data.js`, `art.js`, `README.md`). This file is the behaviour, data and contract spec. Where this file and the mockup disagree, this file wins; each such case is listed under "Deviations from the mockup".

Research and sources for every decision: `/home/amh/.cache/uniform-build/research.md`. Code anchors (paths and lines): `/home/amh/.cache/uniform-build/codebase.md`.

## 1. Goal and scope

Store keepers track guard and formal uniforms: what is on the shelf per size, who received what, who still holds what, and what came back. The feature adds a **Uniform / الملابس** tab under Assets, beside Store, with three sub-tabs: **Stock / الرصيد**, **Received / المستلمون**, **Returns / المرتجعات**, plus a read-only Uniform tab in the employee file.

In scope:
- Catalogue of items (bilingual names and descriptions, group, drawing, tracking mode, default hand-out quantity) with editable size lists.
- Dated stock receipts from HQ, hand-outs to employees, returns with condition, reasoned stock adjustments, and voids. Every stock change is an immutable row with an audit entry.
- Net holdings per employee, holder chips for tailored suits, low-stock per size.
- Desktop and phone surfaces, Arabic and English as peers.

## 2. Decisions

| # | Question | Decision |
|---|---|---|
| 1 | Sizes | Sizes are rows in `uniform_sizes`, editable per item. Presets when adding an item: letter `S M L XL XXL XXXL`, waist `28 30 32 34 36 38 40 42 44`, shoe EU `38 39 40 41 42 43 44 45 46 47`, one size. Free-text sizes allowed (trimmed, max 16 chars, unique per item case-insensitively). No business whitelist. |
| 2 | Damaged returns | Every return line has a required `condition`: `reusable` or `damaged`. Both reduce the employee's holdings; only `reusable` restocks the shelf. Default in the form is `reusable`. |
| 3 | Stock from HQ | Dated receipt records (header + lines), not quantity edits. Count corrections use a separate adjustment row with a required reason. The mockup "Update" quantity fields post adjustments. |
| 4 | Permissions | New `uniform.view` and `uniform.edit`. Manager default gets `uniform.view`; `uniform.edit` is by explicit grant (same posture as `store.edit`); operator gets neither; admin gets all. |
| 5 | Low stock | Optional `min_qty` per shelf size (null = no alert). A size is low when `on_hand <= min_qty`; out of stock when `on_hand = 0`. |
| 6 | Suit default | Holder-tracked items keep an editable `default_qty`; suit seeds at 2, minimum 1, no shelf cap. |
| 7 | Employee file | Yes: a read-only **Uniform** tab in the employee file showing net holdings and history, gated by `uniform.view`. |
| 8 | New item tracking | `tracking` is `shelf` or `holder`. Add item creates `shelf` items only (matches the mockup, no tracking choice). Tracking is never editable after creation. |
| 9 | Winter jacket | Seeded as a catalogue item (drawing `parka`, letter sizes, default 1) with zero stock. No invented quantities or employee history are seeded. |
| 10 | Corrections | Items: rename, descriptions, group, drawing, default qty, size order editable with audit (If-Match versioned). Items with history are archived, never deleted; items with no rows at all may be deleted. A size can be removed only when `on_hand = 0` and nobody holds it; if it has history it is archived (hidden from forms), else deleted. Receipts, hand-outs, returns and adjustments are never edited or hard-deleted: they are voided with a required reason, which reverses their effect. |
| 11 | Drawings | User instruction, kept from the mockup: each of the 12 fixed drawings belongs to at most one non-archived item. Add item hides drawings used by non-archived items; Update shows the item's own drawing plus unused ones; when all 12 are used, Add item shows the bilingual "every drawing is in use" state and Save is disabled with a reason. Archiving (or deleting) an item frees its drawing. Enforced server-side by a partial unique index and a 409. This caps active items at 12. |
| 12 | Person panel | Received person detail has **Hand out** and **Record return** actions preselecting that employee. The Received list and detail lead with net currently held quantities; history follows below. |
| 13 | Concurrency | Writes run in `BEGIN IMMEDIATE` (`begin_immediate_if_idle`), decrements use a guarded `UPDATE uniform_sizes SET on_hand = on_hand - :n WHERE id = :id AND on_hand >= :n` and fail the whole request with 409 if any row count is 0; `CHECK (on_hand >= 0)` backs it up. |

### Deviations from the mockup
- None for drawings: the mockup's unique-drawing rule is kept as is (hidden used drawings, own drawing plus unused on Update, exhausted state with disabled Save). The only addition is that archiving an item frees its drawing.
- Return form gets a per-line condition control (Reusable / Damaged, `قابل لإعادة الاستخدام` / `تالف`).
- Stock gets a **Receive stock / استلام مخزون** secondary action (dated receipt dialog: date, reference, per-size quantities).
- Update quantity edits post an adjustment and require a reason when any quantity changes.
- Size cells show a low-stock state when at or below `min_qty`; Update has an optional "Alert at" field per size.
- Hand-out, receipt, return and adjustment rows have a manager-only **Void** action with a reason dialog.
- Sample data from `data.js` is never seeded.

## 3. Data model

Migration `backend/app/db/migrations/versions/0115_uniform.py`, `revision = "0115_uniform"`, `down_revision = "0114_store_count"`. Re-check the head after `git fetch` before writing it; if main moved, take the next free number. New tables only, so plain `op.create_table`; any later change to an existing table uses `op.batch_alter_table` (with `recreate="always"` for constraint changes). Downgrade drops all tables in reverse order. Models live in `backend/app/db/models.py` after the Store block.

All tables: `id INTEGER PK`, `created_at`, `updated_at` (server default now) unless noted. Void columns on posting tables: `voided_at DATETIME NULL`, `voided_by_id FK users.id NULL`, `void_reason VARCHAR(500) NULL`, `CHECK ((voided_at IS NULL AND void_reason IS NULL) OR (voided_at IS NOT NULL AND length(trim(void_reason)) > 0))`.

| Table | Columns | Constraints |
|---|---|---|
| `uniform_items` | `name_en`, `name_ar` (VARCHAR 120, NOT NULL), `description_en`, `description_ar` (VARCHAR 500 NULL), `group_key` (`formal`/`guard`/`winter`), `drawing` (one of the 12 kinds), `tracking` (`shelf`/`holder`), `default_qty INT`, `sort_order INT`, `archived_at NULL`, `created_by_id FK users`, `version INT DEFAULT 1` | CHECKs on enums, `default_qty >= 1`; unique `lower(name_en)` among non-archived (partial index); partial unique index `uq_uniform_items_drawing_active` on `(drawing) WHERE archived_at IS NULL` |
| `uniform_sizes` | `item_id FK CASCADE`, `label VARCHAR(16)`, `sort_order INT`, `on_hand INT DEFAULT 0`, `min_qty INT NULL`, `archived_at NULL` | `CHECK on_hand >= 0`, `CHECK min_qty IS NULL OR min_qty >= 0`; partial unique `(item_id, lower(label)) WHERE archived_at IS NULL` |
| `uniform_receipts` | `received_on DATE`, `reference VARCHAR(120) NULL`, `note NULL`, `created_by_id`, void columns | void CHECK |
| `uniform_receipt_lines` | `receipt_id FK CASCADE`, `size_id FK`, `qty INT` | `qty > 0`, unique `(receipt_id, size_id)` |
| `uniform_issues` | `employee_id FK employees.id (String 16)`, `issued_on DATE`, `note NULL`, `created_by_id`, void columns | void CHECK, index `(employee_id)` |
| `uniform_issue_lines` | `issue_id FK CASCADE`, `item_id FK`, `size_id FK NULL`, `qty INT` | `qty > 0`; unique `(issue_id, item_id, size_id)` |
| `uniform_returns` | `employee_id FK`, `returned_on DATE`, `note NULL`, `created_by_id`, void columns | void CHECK |
| `uniform_return_lines` | `return_id FK CASCADE`, `item_id FK`, `size_id FK NULL`, `qty INT`, `condition` (`reusable`/`damaged`) | `qty > 0`, condition CHECK |
| `uniform_adjustments` | `size_id FK`, `delta INT`, `reason VARCHAR(500)`, `adjusted_on DATE`, `created_by_id`, void columns | `delta <> 0`, `length(trim(reason)) > 0` |

`size_id` is NULL exactly when the item is `tracking = holder`; the service enforces this (SQLite cannot check across tables).

`on_hand` is a cached balance kept in the same transaction as every posting. Invariant (tested): for each size, `on_hand = sum(receipts) - sum(issues) + sum(reusable returns) + sum(adjustments)` over non-voided rows. Holdings are derived: per (employee, item, size), `sum(issue lines) - sum(return lines)` over non-voided headers.

Seed (in the migration, idempotent insert): items `suit` (formal, holder, default 2, no sizes), `polo` (guard, letter), `cargo` (guard, waist), `belt` (guard, One size, default 1), `boots` (guard, EU 38-47), `cap` (guard, One size, default 1), `socks` (guard, One size, default 2), `parka` winter jacket (winter, letter, default 1). Names and descriptions from `art.js`/`index.html`. All `on_hand = 0`. The one-size label is stored as `one` and displayed as One size / مقاس موحد.

Repo: `backend/app/db/repos/uniform_repo.py` holds the queries (balances, holdings, lists, guarded decrement/increment). The Store feature puts SQL in its service; uniform splits it to keep the service testable.

## 4. Business rules (service `backend/app/services/uniform_service.py`)

Every mutating function: one write transaction via `begin_immediate_if_idle`, posting rows + `on_hand` update + `append_audit` (`entity_type="uniform_*"`) committed together; any failure rolls back everything.

1. **Receipt:** lines on non-archived shelf sizes only, qty > 0, `received_on` not in the future (org-local date). Adds to `on_hand`.
2. **Hand-out:** employee must exist. Shelf lines need an active size and the guarded decrement; any shortage → 409 `uniform_insufficient_stock` with `{size_id, available}` and nothing is written. Holder lines have no size, qty ≥ 1, no stock check. Duplicate lines for the same item/size merge. Date defaults to today, not future.
3. **Return:** per line, qty ≤ the employee's current net holding of that item/size (else 422 `uniform_over_return`). `reusable` increments `on_hand`; `damaged` does not. Holder lines have no size and no shelf effect; an employee stops being a holder when net reaches 0.
4. **Adjustment:** non-zero delta, reason required, one immutable adjustment row per input line (including repeated sizes); a negative delta uses the guarded decrement. Every line includes `expected_on_hand` from the count editor's opening snapshot. Validate all expectations against the balances at the start of the write transaction, before applying any line. A mismatch rejects the entire request with 409 `uniform_stale_count`; close and reopen the editor to review a fresh count.
5. **Void** (receipt, issue, return, adjustment): reason required, row must not already be voided (409). Reverses the effect: voiding a receipt or positive adjustment decrements (guarded, 409 if stock was already used), voiding an issue increments stock and fails 409 if it would make the employee's net holding negative (a later return depends on it; void that first), voiding a reusable return decrements (guarded).
6. **Items:** create (shelf only, ≥1 size, group required, both names required); update with If-Match version (412 on mismatch, same ETag pattern as `store_service`); tracking immutable; archive allowed only when every size has `on_hand = 0` and no one holds the item; hard delete only when no posting references it.
7. **Drawings:** a drawing may be used by at most one non-archived item. Create or update with a drawing held by another non-archived item fails 409 `uniform_drawing_in_use` (checked in the service, and the `IntegrityError` from the partial unique index is mapped to the same 409 for races). Updating an item to its own current drawing is always allowed. Archiving or deleting an item frees its drawing.
8. **Sizes:** add (not for one-size items or holder items; unique case-insensitive), reorder, set `min_qty`, remove only at `on_hand = 0` with no holders (archive if referenced, delete otherwise). Creation and size renaming must also reject combining the reserved case-insensitive label `one` with other active sizes.
9. **Dates:** all posting dates org-local, not future; backdating allowed.
10. **Listing:** postings newest first by date then id; voided rows are returned with their void info and excluded from all totals.

## 5. API (`backend/app/api/v1/uniform.py`, prefix `/api/v1/uniform`)

Schemas in `backend/app/schemas/uniform.py`. Read routes require `uniform.view`, writes `uniform.edit`.

| Method | Path | Body / result |
|---|---|---|
| GET | `/items?include_archived=` | `UniformItemRead[]` with sizes (`id, label, on_hand, min_qty, held_qty, is_low`), `holders` for holder items (`employee_id, name_en, name_ar, qty`), `version` |
| POST | `/items` | `UniformItemCreate` (names, descriptions, group, drawing, default_qty, sizes[]); 409 `uniform_drawing_in_use` |
| PATCH | `/items/{id}` | `UniformItemUpdate`, header `If-Match`; 409 `uniform_drawing_in_use` |
| POST | `/items/{id}/archive` | 409 if stock or holders |
| DELETE | `/items/{id}` | 409 if any posting |
| POST | `/items/{id}/sizes` | `{label, min_qty?}` |
| PATCH | `/sizes/{id}` | `{label?, sort_order?, min_qty?}` |
| DELETE | `/sizes/{id}` | archive or delete per rule 7 |
| GET/POST | `/receipts` | `UniformReceiptCreate {received_on, reference?, note?, lines[{size_id, qty}]}` |
| GET/POST | `/issues?employee_id=` | `UniformIssueCreate {employee_id, issued_on?, note?, lines[{item_id, size_id?, qty}]}` |
| GET/POST | `/returns?employee_id=` | `UniformReturnCreate {employee_id, returned_on?, note?, lines[{item_id, size_id?, qty, condition}]}` |
| GET/POST | `/adjustments` | `UniformAdjustmentCreate {lines[{size_id, delta, expected_on_hand}], reason}` (one row per input line, same reason; 409 `uniform_stale_count` if any opening balance changed) |
| POST | `/{receipts,issues,returns,adjustments}/{id}/void` | `{reason}` |
| GET | `/recipients?q=` | employees with any non-voided issue: `employee_id`, names, `held_total`, `issued_total`, `last_issued_on` |
| GET | `/employees/{employee_id}` | `{holdings[], issues[], returns[]}` for the person panel and employee file |
| GET | `/summary` | shelf total, holder counts, suits issued, out-of-stock and low sizes |

Errors use the existing `HTTPException` detail code style from Store. Register the router in `backend/app/main.py` next to Store. Then run the `sync-api-types` skill (`.agents/skills/sync-api-types/SKILL.md`) and commit `backend/openapi.json` and `frontend/src/lib/api.types.ts`.

## 6. Permissions

`backend/app/core/permissions.py`: add a `uniform` group with bilingual `uniform.view` (عرض الملابس) and `uniform.edit` (إدارة الملابس); add `uniform.view` to manager additions. `seed_role_defaults` at startup inserts the missing role rows; no migration seeding. Frontend gates: Assets tab and routes on `uniform.view`; every mutation control on `uniform.edit` (the mockup's `view=readonly` state).

## 7. Frontend

Route `/holdings/uniform` (sub-tab in the `tab` search param: `stock`, `received`, `returns`, and `person`/`return` detail params as in the mockup) gated by `uniform.view`, in `frontend/src/App.tsx`. Peer tab in `AssetsSectionTabs.tsx`. Files under `frontend/src/pages/assets/uniform/`:

- `UniformShell.tsx`: hero, section tabs, sub-tabs, actions (mirrors `StoreShell`).
- `UniformPage.tsx`: reads the tab param, renders the tab, clears search on tab switch.
- `uniformQueries.ts`: `uniformKeys` factory (`['uniform', ...]`), query and mutation hooks, `invalidateUniformQueries`, 409/412 error mapping to messages.
- `stock/`: ledger table (desktop) and cards (phone), summary line, holder chips, `ItemEditorDialog` (Update), `AddItemDialog`, `ReceiveStockDialog`, `HandOutDialog` (shared, used by Stock, Received and Give suit / + chip).
- `received/`: recipient list + sticky detail on desktop, one region below 1000px with Back and focus restore; person panel with net holdings first, Hand out and Record return actions, history with Void.
- `returns/`: return list + detail, `ReturnDialog` with per-line condition, Void.
- `frontend/src/components/UniformArt.tsx` + `uniformArtCatalog.ts`: port of `art.js` (12 kinds, groups, bilingual labels), `uniformArt(kind)` equivalent as a component.
- `frontend/src/components/EmployeePicker` reuse: adapt `EmployeeActivityLookup.tsx` search (debounce, arrows, Enter on single match) inside the dialogs; Return dialog searches `/recipients` only.
- Employee file: `frontend/src/pages/employees/tabs/UniformTab.tsx`, peer tab in `EmployeeTabChips.tsx` and `EmployeeDetailPage.tsx`, only when the user has `uniform.view`.

Mockup behaviours to keep exactly: default quantities, clamping with "Only N left", disabled Save reasons via `aria-describedby`, staged Add size with Enter, quantity flooring/clamping on commit, focus return to openers, phone pinned dialog chrome, 600ms changed-cell pulse only under `prefers-reduced-motion: no-preference`, zeros print `0` and not-applicable prints grey `-`, G-numbers and sizes in `<bdi dir="ltr">`.

Use `useIsMobile` and the Store card/table split; touch targets `min-h-11`.

## 8. i18n

All strings in `frontend/src/locales/en.json` and `ar.json` under `assets.sectionTabs.uniform` and `assets.uniform.*`, copied from the mockup's `T.en`/`T.ar` (including the reviewed Arabic: Give = تسليم, submit = صرف, المتبقي قطعة واحدة فقط). Plurals via i18next plural keys for both languages (Arabic needs zero/one/two/few/many/other). Logical CSS only (`ms-`, `me-`, `ps-`, `pe-`, `start`, `end`, `text-start`); no `left`/`right`. No em or en dashes in user text.

## 9. Tests

Backend pytest (`~/.venvs/sentinel/bin/python -m pytest <file> -q`), one test per rule at minimum:
- `backend/tests/test_migration_uniform.py`: upgrade from `0114_store_count`, seed rows (8 distinct drawings), CHECKs (`on_hand < 0` rejected, void reason required), second active item with the same drawing rejected while an archived duplicate is allowed, downgrade round trip, single head. Update `backend/tests/test_migration_store_room.py` head assertion.
- `backend/tests/test_uniform_service.py`: receipt, hand-out, shortage 409 atomic, holder lines without size, merge duplicates, over-return, damaged does not restock, reusable restocks, holder removal at zero, void of each kind and its guards, adjustment reason, size removal rules, archive rules, drawing in use 409 on create and update, own drawing kept on update, archive frees drawing for a new item, future date rejected, ledger invariant after a random sequence, concurrency (two sessions, `ThreadPoolExecutor` + `Barrier`, last piece: exactly one succeeds, `on_hand = 0`), audit row per mutation.
- `backend/tests/test_uniform_api.py`: permission matrix (none / view / edit / admin), If-Match 412, drawing in use 409, response shapes, recipients and employee endpoint.

Frontend vitest (`pnpm -C frontend test <file>`): HandOutDialog (defaults, clamp, disabled reason, suit Give), ReturnDialog (bounds, condition), ItemEditorDialog (staged sizes, flooring, adjustment reason, own drawing plus unused only), AddItemDialog (used drawings hidden, all-used state with disabled Save and reason), UniformArt (12 kinds), recipient panel actions, readonly hides mutations.

## 10. Required reviews

- `alembic-migration-reviewer` (`.codex/agents/alembic-migration-reviewer.toml`) on T1; confirm exactly one Alembic head.
- `i18n-rtl-reviewer` (`.codex/agents/i18n-rtl-reviewer.toml`) on every UI ticket and the final pass (T9).
- Outside Codex, give a read-only reviewer the file's `developer_instructions` plus the diff against `origin/main`.
- No notification changes, so no notification review.

## 11. Out of scope

Notifications (SMS, WhatsApp, push), barcode/OCR scanning, cost or valuation, employee self-service views, sign-on-receipt signatures, printing hand-out slips, import of real opening stock (done by store keepers through Receive stock), holder-tracked item creation from the UI, links to Store items, and any sample data seeding.
