# Scan Inbox — Actionable Triage (preview, match, verify)

**Date:** 2026-07-06
**Status:** Design — awaiting review
**Route affected:** `/scan-inbox` (capability `documents.scan`)

## Problem

The OCR Scan Inbox surfaces incoming documents but doesn't let the operator *act*
with confidence:

- **"Couldn't match" / unrouted cards are dead ends.** The manual-match pickers
  were deferred, so the only real action is *Dismiss*. There is no clear next
  step and no way to send the document where it belongs.
- **No document preview anywhere.** You decide about a scan you cannot see.
- **Auto-filed cards can't be verified.** *Open email* dumps you at `/ledger`
  (generic), not where the document actually landed. You can't confirm the
  auto-fill was correct, and if it was wrong the only escape is *Undo*, after
  which the item is stranded.

**Goal:** make the inbox a place to *take action* — see the document, verify
what the OCR read, and file/re-file it in one place — instead of vaguely
pointing at uncertain destinations.

## Non-goals / scope boundaries

- Not changing the drain/OCR pipeline, tiering thresholds, or extraction logic.
- Not adding new document *types* or new auto-file routes.
- **Book near-miss chips are out of scope.** Fuzzy book-ref hits already surface
  as `confirm`-tier items (with `proposed_ref`), so a book that "almost matched"
  is never `unrouted`. Candidate chips (below) are therefore **employee-only**;
  book routing on unrouted items goes through the search dialog.
- No change to the four inbox sections or the 30 s auto-refresh.

## Current state (verified)

- `ScanInboxCard.tsx` renders headline + a small button set; unrouted items get
  only *Dismiss*. `ScanInboxPage.tsx` groups items into confirm / unrouted /
  auto-filed / error.
- Backend already has `POST /scan-inbox/{id}/route` (employee_id | book_id),
  `/confirm`, `/dismiss`, `/undo`; `api.routeScanItem` already exists in
  `api.ts` but is unused by the UI.
- `ScanInbox` row stores `file_path`, `filename`, `raw_text`, `fields`,
  `qr_refs`, `document_type`, `proposed_*`, `match_score`, `undo_token`. For an
  `auto_filed` item the destination **is** `proposed_employee_id` /
  `proposed_book_id`.
- Matcher `extraction_service.match_employee` keeps only the single best fuzzy
  match. `run_pipeline` → `PipelineResult(matched_employee_id, match_score)` →
  `scan_triage_service.route` → `TriageDecision`.
- Reuse available: `ReferencePicker` (books+employees search + preview pane
  pattern), `api.listEmployees({q})`, `api.listBooks({q})`, `pickEmployeeName`,
  deep-link routes `/employees/:id` and `/books/:id`.
- Latest migration: `0046`. Next: **`0047`**.

## Design overview

One shared card that **expands in place** to reveal the document preview and the
fields the OCR read, with actions scaled to the item's state. A single
`ScanMatchDialog` (document on one side, employee/record search on the other)
handles all manual matching. Suggestion **chips** offer one-tap filing whenever
the matcher has candidates. Auto-filed cards state exactly where the document
landed, link to it, and offer a "wrong → re-match" escape.

## Backend changes

### 1. Ranked employee candidates (matcher)

`extraction_service.py`:

- Add `match_employee_candidates(fields, employees, *, limit=3, floor=0.55) ->
  list[tuple[_Emp, float]]`: same `fuzz.token_sort_ratio` scoring as
  `match_employee`, but returns the top `limit` distinct employees with
  `score/100 >= floor`, sorted by score desc. `match_employee` stays as-is
  (refactor its scan loop to share a private `_scored_employees` helper so the
  two never diverge).
- `run_pipeline`: add `candidates: list[EmployeeCandidate]` to `PipelineResult`,
  where `EmployeeCandidate = {employee_id, name_en, name_ar, score}`
  (denormalized names — see §4).

### 2. Thread candidates through triage

`scan_triage_service.py`:

- `TriageDecision` gains `candidates: list[dict] = field(default_factory=list)`.
- The **manual / unrouted** branches (doctype unknown, or `emp_id is None` for a
  known employee-doctype) attach `pr`-derived `candidates` so an unrouted item
  carries its near-misses. `auto`/`confirm` branches leave `candidates` empty
  (the single proposal already carries them via `proposed_*`).

### 3. `ScanInbox.candidates` column + migration 0047

- `models.py`: `candidates: Mapped[list] = mapped_column(JSON, default=list)`.
- `0047_scan_inbox_candidates.py`: add nullable `candidates` JSON column
  (batched/`server_default` per the repo's SQLite pattern), no backfill.

### 4. Store candidates at drain time (denormalized)

`scan_inbox_service._process_one`: it already loads the full `employees` list;
write `item.candidates = decision.candidates` (each entry carries `name_en` /
`name_ar` captured then). Denormalizing avoids an N+1 name lookup on the list
endpoint and is safe because inbox items are short-lived triage rows.

### 5. Expose data in the API schema

`schemas/scan_inbox.py` → `ScanInboxItem` gains:

- `fields: dict[str, str] = {}` — what the OCR read (for the verify panel).
- `candidates: list[EmployeeCandidate] = []` — ranked near-misses for chips.

`_to_item` in `api/v1/scan_inbox.py` maps both straight off the row (no extra
queries — names are denormalized).

### 6. Document-serve endpoint

`GET /scan-inbox/{item_id}/document` (gate `documents.scan`):

- Load row via `scan_inbox_service` + `_check_owner` (returns 404 on foreign
  item, matching existing owner semantics).
- Resolve `_abs(item.file_path)`; 404 if missing on disk.
- Return `FileResponse` with content-type inferred from suffix and
  `Content-Disposition: inline` so it previews in-browser. Mirror the existing
  ledger-attachment / vault file-serve handler.

## Frontend changes

### 1. `api.ts`

- Extend the `ScanInboxItem` TS interface with `fields: Record<string,string>`
  and `candidates: EmployeeCandidate[]`.
- Add `scanDocumentUrl(id: number): string` → `/scan-inbox/${id}/document`
  (absolute, same base as other download URLs).
- `routeScanItem` already exists — reuse.

### 2. `ScanInboxCard.tsx` (rework)

- Local `expanded` state + a chevron toggle. Collapsed shows sender/subject,
  headline, a confidence hint, and the primary actions; expanded reveals:
  - **Preview:** small inline `<object>`/`<img>` of `scanDocumentUrl(id)`
    (PDF vs image by filename), click → full viewer (reuse
    `document-viewer-dialog` / `AttachmentPreviewDialog`).
  - **"OCR read" panel:** labelled list from `item.fields` + `document_type`
    (known-key label map: name, id_number, expiry, iban…). Hidden for `error`
    items (no fields).
- Actions dispatched by state — see the matrix below. `Match…` opens
  `ScanMatchDialog`. Chips call `routeScanItem` directly.

### 3. `ScanMatchDialog.tsx` (new)

Centered modal (reuse `ui/dialog`), two panes:

- **Left:** the scan document preview (`scanDocumentUrl(item.id)`).
- **Right:** debounced search box → grouped `api.listEmployees({q})` +
  `api.listBooks({q})` results (mirrors `ReferencePicker`'s query + row
  rendering). Selecting a row calls
  `routeScanItem(item.id, {employee_id|book_id})`; on success invalidate
  `['scan-inbox']`, toast, close.

Reuses `pickEmployeeName`, `currentBookDocId` label patterns; does **not** reuse
`ReferencePicker` directly (that previews the *record's* doc and emits a compose
token — different contract).

### 4. Suggestion chips

Rendered on the card above the action row when data exists:

- `awaiting_confirmation`: the proposal as a one-tap chip
  (`✓ File to {name}` / `✓ File to {ref}`) — same effect as `Confirm`.
- `unrouted`: `item.candidates` as up-to-3 chips
  (`{name} · {score}`), each one-tap `routeScanItem({employee_id})`.
- Always followed by `Match… (search)` + `Dismiss`.

### 5. Auto-filed verification

Expanded `auto_filed` card shows:

- **Destination line:** `Filed to {name} › Documents` / `Filed to {ref}` with an
  `Open in file ↗` link → `/employees/:id` or `/books/:id`
  (from `proposed_employee_id` / `proposed_book_id`).
- **OCR-read panel** (same as above) for at-a-glance verification.
- Actions: `Undo` (existing) + **`Wrong? Re-match`** = run `undoScanItem` then
  open `ScanMatchDialog` for the now-`awaiting_confirmation` item (compose the
  two; single button for the operator). Replaces `Open email`.

## Action matrix

| State | Chips / primary | Expanded body | Secondary |
|---|---|---|---|
| `awaiting_confirmation` | `✓ File to {dest}` (= Confirm) | preview + OCR fields | `Match…`, `Dismiss` |
| `unrouted` | up-to-3 candidate chips (if any) | preview + OCR fields (may be sparse) | `Match… (search)`, `Dismiss` |
| `error` | — | preview only (no fields) | `Match… (search)`, `Dismiss` |
| `auto_filed` | `Open in file ↗` | preview + OCR fields + destination line | `Undo`, `Wrong? Re-match` |

## i18n (en + ar, keep parity)

Under `scanInbox`: add `expand`/`collapse`, `ocrRead`, `ocrField.*` labels,
`filedTo`, `openInFile`, `reMatch`, `match.*` (dialog title, search placeholder,
employees/records group headers, `fileHere`, `noResults`), `chip.fileTo`,
`chip.candidate`, `confidenceLabel`. Remove `actions.openEmail`,
`actions.pickEmployee`, `actions.pickRecord`, `actions.notForm` if now unused.
Run the i18n-rtl-reviewer over the diff (English-leak / RTL is the #1 recurring
bug here).

## Security / permissions

- Document-serve endpoint gated on `documents.scan` **and** `_check_owner`
  (404, not 403, on foreign items — no existence leak).
- Deep-links reuse existing `/employees/:id` and `/books/:id` route guards.

## Testing

**Backend (pytest):**
- `match_employee_candidates`: ordering, `limit`, `floor`, distinctness; parity
  with `match_employee` on the top result.
- Triage: unrouted external doc attaches `candidates`; auto/confirm leave it
  empty.
- `_process_one` persists `candidates` with denormalized names; migration 0047
  round-trips.
- Serve endpoint: 200 + inline content-type for owner; 404 for foreign item and
  for missing-on-disk file.
- Schema: `fields` + `candidates` present; list endpoint issues no extra
  per-row query (extend `test_scan_inbox_nplus1.py`).

**Frontend (vitest / RTL):**
- Card renders correct actions per state (matrix); expand toggles preview +
  OCR panel; `error` hides the OCR panel.
- Chip click routes and invalidates; `Match…` opens dialog; dialog search →
  select → routes.
- Auto-filed: destination link targets the right route; `Wrong? Re-match`
  undoes then opens the dialog.

## Risks / open questions

- **Candidate name staleness:** denormalized names can drift if an employee is
  renamed before triage. Acceptable for a short-lived queue; the chip routes by
  `employee_id`, so a stale label never mis-files.
- **`floor` tuning:** `0.55` is a starting point; may need adjustment against
  real OCR output. Isolated to `match_employee_candidates`.
- **Preview rendering:** in-browser `<object>` PDF preview can vary; the full
  viewer dialog is the reliable fallback (same pattern already shipped
  elsewhere).
