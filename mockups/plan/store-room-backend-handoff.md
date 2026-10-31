# Handoff: room-be (store-room backend + delivery-note scan backend)

Branch `feat/store-room-be`, worktree `/home/amh/Projects/sentinel/.worktrees/room-be`.
All paths below are under `/api/v1`. Reads need `store.view`, mutations `store.edit`
(picker keeps `store.view OR documents.generate`).

## Commits (on top of `5a1d471d`)

| Hash | Slice |
| --- | --- |
| `b7bef444` | docs(store): Handover term and ADR 0010, usage stays derived from counts |
| `563af52f` | feat(store): migration 0111_store_room and models |
| `32760f81` | feat(store): handovers with FEFO split, excluded from usage |
| `6898e891` | feat(store): In & out movements feed and month-strip dashboard fields |
| `5ef7bd56` | feat(store): item drawings and opening-data art |
| `17d0e2ea` | feat(store): delivery-note scan, item aliases, noted vs received |
| `c31d0f05` | chore(api): sync store contract (api.types.ts + api.ts methods; amended, was `b39018fc`) |

## Domain

- `CONTEXT.md` § Assets and store: new **Handover** term; Monthly usage gains
  "A Handover reduces what is on the shelf but is not added to Monthly usage; the
  next Stock count already reflects it."
- ADR `0010-store-records-handovers-usage-stays-derived.md` (next free number;
  0007/0008 reserved by open PRs). ADR 0009 status `superseded in part by 0010`.

## Endpoints: handovers, movements, dashboard

Shared `StoreLineRead`: `{item_id:int,item_code:str,item_name_en:str,item_name_ar:str|null,counting_unit_en:str,counting_unit_ar:str,contains_qty:int|null,contains_unit_en:str|null,contains_unit_ar:str|null,id:int,batch_id:int,expiry_date:date|null,expiry_month_only:bool,quantity:int}`. Quantity stays positive for handovers/disposals; movement kind conveys direction.

`StoreHandoverRead`: `{id:int,handed_on:date,taken_by:str,note:str|null,lines:StoreLineRead[],created_by_user_id:int|null,created_at:datetime,recorded_by_name:str|null,recorded_by_name_ar:str|null}`.

- `GET /store/handovers` (`store.view`): no body; returns `StoreHandoverRead[]`, descending handed_on, created_at, id.
- `POST /store/handovers` (`store.edit`): `{handed_on?:date (default organization today),taken_by:str (1..128),note?:str|null,lines:[{item_id:int,quantity:int>=1},...]}`; returns 201 `StoreHandoverRead` with server-resolved batch lines.
- `GET /store/handovers/takers` (`store.view`): no body; returns distinct exact `string[]`, ordered by the newest handover's handed_on, created_at, id. Registered before the parameterized detail route.
- `GET /store/handovers/{id}` (`store.view`): returns `StoreHandoverRead`; missing gives 404 `STORE_HANDOVER_NOT_FOUND`.
- `DELETE /store/handovers/{id}` (`store.edit`): no body; returns 204, restores derived stock, audits deletion; missing gives 404 `STORE_HANDOVER_NOT_FOUND`.
- `GET /store/movements?kind=in|out|disposed&q=...` (`store.view`): no body; returns `[{kind:'in'|'out'|'disposed',id:int,on:date,created_at:datetime,recorded_by_name:str|null,recorded_by_name_ar:str|null,taken_by:str|null,note:str|null,reason:'expired'|'damaged'|null,note_file:{name:str,media_type:str,size:int,url:str}|null,lines:StoreLineRead[]}]`. All nullable keys are present. Descending business date, created_at, id, kind (last is deterministic tie-break only). Search is trimmed/case-insensitive substring over taken_by, note, English/Arabic recorder name, item code and English/Arabic item names. Kind and q compose. Delivery files retain existing download URLs; no storage paths are exposed.
- `GET /store/dashboard` (`store.view`): existing response is preserved, adding `{counts_recorded:int,usage_ready:bool,suggestion_count:int}`. Counts recorded is the total stock-count count; usage_ready means there are >=2 counts/a usage window; suggestion_count is the suggestions array length. Existing `expiring_soon_days` is already 60 and remains unchanged. Other existing fields: today, expired, expiring_soon, low_stock, usage, suggestions, last_count_on, last_delivery_on.

Note: `StoreLineRead` and `StoreItemRef` were then extended by the art/scan slice
(see below): every line now also carries `art_kind`, `art_color`,
`noted_quantity`, `difference_reason`.

## Endpoints: item drawings, scan, deliveries

### Item drawings

- `POST /store/items` (`store.edit`), existing request now accepts `art_kind?: string|null` and `art_color?: string|null`, both default null. Full request: `{name_en:string(1..255),name_ar?:string|null,category_id:int,counting_unit_en?:string="Carton",counting_unit_ar?:string="كرتون",contains_qty?:int>=2|null,contains_unit_en?:string|null,contains_unit_ar?:string|null,minimum_level?:int>=0|null,art_kind?:string|null,art_color?:string|null}`. Returns 201 `StoreItemRead`.
- `PATCH /store/items/{item_id}` (`store.edit`, existing `If-Match` version required): partial request with the same fields; explicit art null clears that field, omitted art is preserved. Returns 200 `StoreItemRead`.
- `StoreItemRead` (also returned by list, archive and restore): `{id:int,code:string,name_en:string,name_ar:string|null,category_id:int,category:{id:int,name_en:string,name_ar:string},counting_unit_en:string,counting_unit_ar:string,contains_qty:int|null,contains_unit_en:string|null,contains_unit_ar:string|null,minimum_level:int|null,art_kind:string|null,art_color:string|null,archived_at:datetime|null,created_at:datetime,updated_at:datetime|null,on_hand:int,version:string}`.
- `GET /store/items/picker` (existing `store.view OR documents.generate`): returns `[{id:int,code:string,name_en:string,name_ar:string|null,counting_unit_en:string,counting_unit_ar:string,contains_qty:int|null,contains_unit_en:string|null,contains_unit_ar:string|null,art_kind:string|null,art_color:string|null}]`.
- `StoreItemRef`, shared by batches, expected-count batches, dashboard batch/low-stock/usage/suggestion rows, disposal reads and all line reads, now includes `art_kind:string|null, art_color:string|null`. Full shared ref: `{item_id:int,item_code:string,item_name_en:string,item_name_ar:string|null,counting_unit_en:string,counting_unit_ar:string,contains_qty:int|null,contains_unit_en:string|null,contains_unit_ar:string|null,art_kind:string|null,art_color:string|null}`. Existing enclosing response fields remain unchanged except the delivery-note fields below.

Art kinds: `jar, canister, box, tins, water, cups, bigcups, tissue, gloves, mask, carton`. Unknown kind: 422 `STORE_ITEM_ART_KIND`. Colour must match `^#[0-9a-fA-F]{6}$`; invalid colour: 422 `STORE_ITEM_ART_COLOR`. Accepted colours are stored lowercase. Validation uses the existing service-domain ValidationFailedError convention rather than generic schema-only errors.

### Delivery-note scan

`POST /store/deliveries/scan` (`store.edit`), multipart `file` only. Returns 200:

```json
{
  "pages": [{"width": 1000, "height": 800}],
  "lines": [{
    "raw_text": "Coffee-mate 15×400g 8 125.00 1000.00",
    "item_id": 2,
    "match_score": 100.0,
    "quantity": 8,
    "confidence": 90.0,
    "page": 0,
    "bbox": {"x": 10, "y": 50, "w": 480, "h": 20}
  }],
  "ocr_available": true
}
```

Exact types: `pages:{width:int,height:int}[]`, `lines:{raw_text:string,item_id:int|null,match_score:number[0..100],quantity:int|null,confidence:number[0..100],page:int>=0,bbox:{x:int,y:int,w:int,h:int}}[]`, `ocr_available:boolean`. `page` is zero-based; dimensions and boxes refer to the OCR raster, including shared OCR upscaling. `raw_text` retains the original joined OCR row; matching uses the parsed item description and full row (the latter supports exact remembered source-text aliases). Rows group by OCR block/paragraph/line. Confidence is the clamped mean word confidence. Missing Tesseract (`OcrUnavailableError` or `pytesseract.TesseractNotFoundError`) returns exactly `{pages:[],lines:[],ocr_available:false}`. A readable empty note returns empty lines with `ocr_available:true`.

Uses the existing delivery-note upload policy: PDF/PNG/JPEG/WebP, magic-byte sniffing and 10 MiB cap; existing `STORE_NOTE_FILE_*` policy errors remain. Unreadable image/PDF processing yields 422 `STORE_NOTE_FILE_INVALID`. Calls public `ocr.word_boxes_from_bytes(...,lang="eng")` under exactly one `OCR_GATE` acquire; that function does not acquire the gate. No files, delivery rows, aliases or audit rows are written by scan.

Pure parser: `core/extraction/delivery_note.py::parse_row(text)` returns item text plus integer quantity or null, dropping clear headers/totals. Decimal and currency prices are ignored, Arabic-Indic and extended Arabic-Indic digits and decimal separators normalized, leading row numbers ignored, pack sizes such as `15×400g` retained. First defensible integer after the item is quantity; unknown descriptions remain for human confirmation. With `Water 12 AED 50`, AED prefixes the following price (50), leaving quantity 12; a trailing currency marker excludes its preceding integer. This is heuristic, to be calibrated later with real notes as the plan states.

Matching normalizes NFKC, case, punctuation, whitespace and Arabic-Indic digits, then uses rapidfuzz ratio against active item code, English name, Arabic name and stored aliases. Best score >=85 sets item_id, otherwise item_id is null; score is always exposed. Archived items are not suggested.

### Delivery creation and line reads

`POST /store/deliveries` (`store.edit`) request:

```text
{
  received_on: date,
  note?: string|null,
  lines: [{
    item_id: int,
    expiry?: "YYYY-MM-DD"|"YYYY-MM"|null,
    quantity: int>=0,
    source_text?: string|null,
    noted_quantity?: int>=0|null,
    difference_reason?: string(<=200)|null
  }, ...]
}
```

At least one line is required. Response 201 `StoreDeliveryRead`:
`{id:int,received_on:date,note:string|null,note_file:{name:string,media_type:string,size:int,url:string}|null,lines:StoreLineRead[],created_by_user_id:int|null,created_at:datetime,updated_at:datetime|null}`.

Full `StoreLineRead`: `{...StoreItemRef,id:int,batch_id:int,expiry_date:date|null,expiry_month_only:boolean,quantity:int,noted_quantity:int|null,difference_reason:string|null}`. `source_text` is input-only, never a line/read property. Delivery list/detail and movement feed use these fields. Count/handover/disposal lines emitted through StoreLineRead have noted_quantity and difference_reason null.

Rules:
- When noted_quantity differs from received quantity, a nonblank reason is required: 422 `STORE_DELIVERY_DIFFERENCE_REASON` (details `{line:index}`). Whitespace-only reasons normalize to null; maximum length 200 is schema-enforced.
- Receiving zero requires noted_quantity >0: 422 `STORE_DELIVERY_ZERO_QUANTITY` (details `{line:index}`). Valid zero lines are stored and audited but contribute zero to on-hand and usage arithmetic.
- Manual deliveries default both noted fields to null. Quantity remains the received quantity used by the ledger.
- Nonblank source_text is normalized and upserted to its chosen item in store_item_aliases during the existing locked delivery-create transaction. New aliases record actor user ID; assigning the same normalized alias to a different item updates its target. Unchanged aliases produce no extra mutation. Alias insert/reassignment uses shared non-committing append_audit (`action="item_alias.upserted"`, `entity_type="store_item_alias"`, payload alias_norm/item_id/previous_item_id). Failed deliveries roll back aliases too.
- Existing delivery create/date/archive/duplicate-line rules remain unchanged.

There is **no delivery update endpoint/service** in the pre-existing API. The only delivery PUT is note-file upload; it does not replace lines. Therefore no second line-update path needed rule changes and no new edit endpoint was introduced. Stock-count PUT still uses StoreCountLineInput, not delivery input.

## Typed `api.ts` methods

`frontend/src/lib/api.ts` exports StoreDeliveryScan, StoreScanLine, StoreHandoverCreate, StoreHandoverRead, StoreMovementRead and StoreMovementKind, and adds:

- `scanStoreDelivery(file)` → POST `/store/deliveries/scan`, multipart `file`, Promise<StoreDeliveryScan>.
- `listStoreHandovers()` → GET `/store/handovers`, StoreHandoverRead[].
- `createStoreHandover(body)` → POST `/store/handovers`, StoreHandoverRead; request `{handed_on?:date,taken_by:string(1..128),note?:string|null,lines:[{item_id:int,quantity:int>=1},...]}`.
- `getStoreHandover(id)` → GET `/store/handovers/{id}`, StoreHandoverRead.
- `deleteStoreHandover(id)` → DELETE `/store/handovers/{id}`, void/204.
- `listStoreHandoverTakers()` → GET `/store/handovers/takers`, string[].
- `listStoreMovements({kind?,q?}={})` → GET `/store/movements?kind=in|out|disposed&q=...`, StoreMovementRead[].

## Migration `0111_store_room` (down `0110_store`)

One linear revision `0111_store_room` after `0110_store`. Creates `store_handovers`, `store_handover_lines`, `store_item_aliases`; adds nullable item `art_kind`/`art_color` and delivery-line `noted_quantity`/`difference_reason`. Delivery quantity check becomes >= 0; noted quantity must be null or >= 0. All ALTERs use batch mode, with explicit table recreation for delivery checks. Downgrade drops new tables/columns and deletes quantity-0 delivery lines before restoring > 0; those lines are stock-neutral and cannot exist under the old schema. Existing nonzero delivery rows survive the round trip. Model parity checks include all store models.

Alembic reviewer (read-only, per AGENTS.md): no must-fix. Should-fix notes, all
downgrade data loss: downgrade deletes quantity-0 delivery lines (recorded
"nothing arrived" discrepancies) and drops handovers/aliases/art/noted columns;
dropping handovers raises derived on-hand. Back up before any production
downgrade. Merge order: 0110 must land before 0111; `dev` renumbers at merge
time (plan: `dev` carries store as `0117_store`).

## Rules implemented

- Duplicate input item lines are merged before FEFO allocation. Expiry today remains eligible; expiry before handed_on is skipped. Dated batches are consumed ascending expiry before undated batches.
- Allocation capacity is `_Ledger.disposable` per batch, protecting all later stock balances until the next resetting count; negative capacity contributes zero. Short stock gives 422 `STORE_HANDOVER_SHORT` with exact details `{item_id,available}` and atomically rolls back the whole handover. Archived items give `STORE_ITEM_ARCHIVED`; future dates give `STORE_DATE_IN_FUTURE`.
- taken_by is stored exactly as typed, including surrounding whitespace; strip is used only for blank-name refusal (`STORE_HANDOVER_TAKER_REQUIRED`). Distinct taker suggestions use exact stored strings.
- Ledger events have kinds: handovers reduce on-hand/expected stock/disposable capacity but are excluded from usage windows. Same-day events occur after counts. Handover references participate in contains-quantity locking and orphan-batch preservation.
- Create/delete append non-committing shared AuditLog rows with `entity_type='store_handover'` in the same write transaction. Book's existing English/Arabic batched resolvers supply names, with no per-row user resolver. The movements feed resolves each language once across its records.
- Art: kinds `jar, canister, box, tins, water, cups, bigcups, tissue, gloves, mask,
  carton` (`STORE_ITEM_ART_KIND`); colour `#rrggbb`, stored lowercase
  (`STORE_ITEM_ART_COLOR`); explicit null clears on PATCH.
- Opening data: 13 items in `scripts/store_opening_2026-10-29.json` carry art from
  the mockup `ITEMS`; the import sets them; `scripts/store_set_art.py --json ...
  --actor EMAIL` fills nulls only, by exact `name_en`, audited, idempotent.
- Scan: shared upload validator (PDF/PNG/JPEG/WebP, sniffed, 10 MiB); public
  `ocr.word_boxes_from_bytes(..., lang="eng")` under exactly one `OCR_GATE`
  acquire; stores nothing; Tesseract missing → `{pages:[],lines:[],ocr_available:false}`.
- Matching: NFKC/case/punctuation/Arabic-Indic normalisation, `rapidfuzz` vs code,
  `name_en`, `name_ar`, aliases; ≥ 85 sets `item_id`; archived items not suggested.
- Aliases upserted on delivery create for lines with non-blank `source_text`,
  in the same transaction, audited (`entity_type="store_item_alias"`).
- Noted vs received: `STORE_DELIVERY_DIFFERENCE_REASON`,
  `STORE_DELIVERY_ZERO_QUANTITY`; zero lines are ledger no-ops.
- Every mutation appends AuditLog via the shared non-committing `append_audit`.

## Deviations from the plan, and why

- No delivery-line update path exists (only the note-file PUT), so the noted/reason
  rules apply to create only; no speculative edit endpoint added.
- `taken_by` stored exactly as typed; whitespace-only refused
  (`STORE_HANDOVER_TAKER_REQUIRED`), an extra code the plan did not name.
- Month-strip fields named `counts_recorded`, `usage_ready`, `suggestion_count`;
  `expiring_soon_days` already existed (60), unchanged.
- Scan `page` is zero-based; `bbox`/page sizes are in OCR-raster pixels (after the
  shared OCR upscale). Scale crops by `pages[i].width` vs the image's real width.
- Delivery-line `quantity > 0` check relaxed to `>= 0` in the migration (needed for
  the quantity-0 rule; not listed in the plan's migration contents).
- `backend/openapi.json` is gitignored on this branch; it was force-added because
  the brief requires committing the contract.

## Known open items for the frontend writers

- `pnpm -C frontend exec tsc -b --noEmit` fails outside the owned files: frontend
  fixtures and `StoreCountPage.tsx`'s locally built batch lack the now-required
  `art_kind`/`art_color`; the `StoreWidgets` fixture lacks `counts_recorded`,
  `usage_ready`, `suggestion_count`. Left for the frontend writers (brief limits
  this slice to `api.ts`/`api.types.ts`); response fields were not made optional
  to hide it.
- No real-OCR smoke run on a delivery note photo; parser calibration on real notes
  is the plan's post-build accuracy check.
- `mockups/plan/store-room.md` has uncommitted progress notes written by the
  slice agents (left uncommitted for the user).

## Tests and checks (final run on `b39018fc`)

- `pytest backend/tests -k "store or migration or extraction" -q`: **189 passed,
  1 failed**, 3948 deselected. The failure,
  `test_migration_inmate_violations_category.py::test_0099_...`, also fails on the
  base commit `5a1d471d` (checked in a scratch worktree); unrelated.
- New tests: handovers (single, multi, FEFO split, skips expired, refuses short,
  future date, delete, audit, takers, usage unchanged by a handover, on-hand
  reduced, same-day-after-count, view vs edit), movements ordering/kind/q,
  dashboard fields, migration 0111 (single head, parity, round trip), parser unit
  tests (price columns, headers/totals, Arabic-Indic digits), scan API (OCR
  monkeypatched, OCR unavailable), aliases upsert + rematch, reason and
  quantity-0 rules, art validation, opening import art, `store_set_art` idempotency.
- `ruff check backend scripts`: pass. `ruff format`: changed files only.
- `mypy`: 59 errors in 14 untouched files (baseline); none in changed files.
- `scripts/check_numbering.py`: `single Alembic head 0111_store_room; 8 unique ADR numbers`.
- Full suite not run (brief: not the full suite).

## Follow-ups

1. `backend/openapi.json` removed from the index (`git rm --cached`) and amended out of
   the contract-sync commit: `b39018fc` → `c31d0f05` (now only `frontend/src/lib/api.ts`
   and `frontend/src/lib/api.types.ts`). The file stays on disk, gitignored as on main.
   The "force-added" deviation above no longer applies.
2. `b6108b47` test(store-fe): fixtures for art and month-strip fields. Added
   `art_kind: null, art_color: null` to the store fixtures (ItemsTableField, StoreCount,
   StoreCounts, StoreDashboard, StoreDeliveries, StoreDisposals, StoreItems,
   DeliveryLines, StoreItemDialog, StoreWidgets tests) and to `StoreCountPage.tsx`'s
   locally built batch; `counts_recorded`/`usage_ready`/`suggestion_count` to the
   StoreWidgets fixture and also the StoreDashboardPage fixture (tsc needed it too).
   No behaviour changes.
   - `pnpm -C frontend exec tsc -b --noEmit`: 0 errors (node_modules already present;
     no install needed).
   - `pnpm -C frontend exec vitest run src/pages/assets src/pages/dashboard
     src/components/application`: 43 files, 482 tests passed.
   - The "Known open items" tsc entry above is resolved.
3. `f3b99240` plan(store-room): backend progress (`mockups/plan/store-room.md`, `git add -f`).

Worktree clean after these commits.

## Review fixes

Each fix has a regression test that failed before its fix (observed red, then green).

1. `3b5d2e2e` fix(store): bound delivery-note scan to 5 PDF pages and a per-page
   Tesseract timeout (MUST-FIX).
   - `POST /store/deliveries/scan`: a PDF over 5 pages is refused before any OCR or
     gate acquire: 422 `STORE_SCAN_TOO_MANY_PAGES`, details `{max_pages: 5}`.
     Unreadable PDFs → existing 422 `STORE_NOTE_FILE_INVALID`.
   - `ocr.word_boxes_from_bytes(raw, *, lang, timeout=0)`: new `timeout` (seconds per
     page, 0 = unbounded, so other callers are unchanged) passed to
     `pytesseract.image_to_data(timeout=)`; a pytesseract timeout becomes new
     `ocr.OcrTimeoutError`. New `ocr.pdf_page_count(raw)`.
   - Scan uses `SCAN_PAGE_TIMEOUT_SECONDS = 30`; a timeout → 422 `STORE_SCAN_TIMEOUT`,
     details `{timeout_seconds: 30}` ("try a clearer or smaller photo"). 422 chosen to
     match the other `STORE_*` user-actionable errors.
   - Worst case under the gate: 5 pages × 30 s.
   - Tests: `test_delivery_scan_refuses_long_pdfs_before_ocr` (6 pages refused, OCR
     not called; 5 pages accepted), `test_delivery_scan_bounds_tesseract_time_per_page`,
     `test_ocr_word_boxes.py::test_timeout_is_passed_to_tesseract_and_a_timeout_is_raised_as_ocr_timeout`,
     `test_default_has_no_tesseract_timeout`. Scan test fixture `_PDF` is now a real
     1-page PDF (the page count opens it).
2. `0475f608` fix(store): zero-received delivery lines are not ledger events
   (SHOULD-FIX). `_load_ledger` filters `StoreDeliveryLine.quantity > 0`; zero lines
   stay in delivery details and the movements feed. Test
   `test_zero_received_line_does_not_create_a_zero_usage_window`: usage `[None, 10]`
   (was `[0, 10]`), average/suggestion 10 (was 5), zero line still in `?kind=in` feed.
3. `6abe4c38` fix(store): handover and movement reads emit UTC offsets via ORMBase
   (SHOULD-FIX). `StoreHandoverRead` and `StoreMovementRead` now derive from `ORMBase`;
   `created_at` serialises as `...Z`. Tests assert the offset in the handover
   response and exact `...Z` timestamps in the movements feed. OpenAPI regenerated:
   `api.types.ts` unchanged, so no re-sync commit.

Checks after the fixes:
- `pytest backend/tests -k "store or migration or extraction" -q`: **192 passed, 1
  failed** (the same pre-existing `test_migration_inmate_violations_category` failure,
  also failing on base `5a1d471d`).
- `pytest backend/tests/test_store_api.py backend/tests/test_ocr_word_boxes.py`: 34
  passed (`test_ocr_word_boxes` is outside the `-k` selection).
- `ruff check backend scripts`: pass; `ruff format` on changed files.
- `scripts/check_numbering.py`: single head `0111_store_room`.
