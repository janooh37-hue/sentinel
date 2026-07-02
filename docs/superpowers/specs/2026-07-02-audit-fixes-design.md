# GSSG Manager — Audit Fixes Design

**Date:** 2026-07-02
**Status:** Design (awaiting spec review → writing-plans)
**Source:** `docs/app-audit-2026-07-02.html` (agentic audit) + 4-agent adversarial verification pass.

## Goal

Fix the findings from the 2026-07-02 agentic audit that **survived adversarial verification**, across four
independently-shippable batches: data integrity, performance, dead-code/duplication, and polish.

## Decisions (from the user)

- **Scope:** everything confirmed (~24 surviving findings).
- **Live data (D1 cleanup of 398 duplicate rows):** author the migration + **dry-run against a backup**, report what
  it would delete, then **STOP for explicit approval** before mutating the live DB.
- **Execution:** write this design + the implementation plan, then **begin executing** on a branch (TDD), pausing at
  the live-data gate.

## Live-production constraints (non-negotiable)

This checkout is the live server (`https://gssg.lan`, served by GSSGManager service).

- All work on a feature branch; TDD (write failing test first) per repo convention.
- Each batch merges to `main` **and pushes to `origin/main`** when green — unpushed fixes are overwritten on the next
  pull. Deploy via `scripts\mng.ps1 update`.
- The templates-churn gotcha applies: revert any incidental re-saves of `backend/templates/*.docx` before committing.
- No destructive DB operation runs without a fresh backup + dry-run + explicit go-ahead.

## Verification provenance

Confirmed and carried into this design: **D1, D2, D3, P1–P8, C1–C7, U1, U5, N1(scoped), N3a, N3c, N4, N5**.

Dropped / downgraded during verification (NOT in scope):

- **D4 (370 book drafts)** — FALSE POSITIVE. `approval_state='none'` is the normal resting state, not a backlog.
- **N2 (nested buttons on Intake)** — FALSE POSITIVE. It's a `role="button"` div wrapping a hidden file input.
- **N3b ("#703ID")** — overstated; an `ms-2` separator exists. Dropped as trivial.
- **U2 (Migrate-from-v3)** — downgraded to cosmetic; the endpoint already has admin gate + concurrency lock +
  `force=False` populated-DB guard. Only a dev-gate/visibility tweak remains (Batch D, optional).

Corrections folded in:

- **P1** — the full-table leaves scan is in the SSE `relevant_counts` path (polls every `POLL_SECONDS=2.5` per
  connected client via `notifications.py`), **not** the 60s scheduler (which deliberately excludes leaves). The
  `submitter_name` `db.get(User)`-per-book cost *is* on the scheduler path. The `precomputed_leaves` helper is genuinely unused.
- **D2** — reworded: "does not currently show" (data-population gap), not "can never" (the endpoint is correct).
- **D3** — extra real bug: dash-less bilingual `leave_type` (e.g. `"Duty Resumption مباشرة عمل"`) slips past
  `_english_part` (splits only on `" - "`) and is misclassified by `classify_group` as `request` instead of `record`.
- **N1** — most surfaces already gate on `has_photo`; only Ledger/message-list rows don't. Scope narrows to those.
- **C4** — exact idiom count is 54 occurrences / 31 files (broad match 61/36). **C5** — 8 backend base64 blocks, not 9.

---

## Batch A — Data integrity (correctness-critical; executed first)

### A1 · D1 — widen the leave dedup guard + DB backstop
- **Where:** `backend/app/services/document_service.py:1469-1512` (the WF-03 guard).
- **Change:** replace the 2-minute `created_at >= now-2min` window with an **overlap-based** check: skip insert when a
  non-deleted `Leave` exists for the same `employee_id` + canonical `leave_type` with an **overlapping date range**
  (a genuinely new leave differs in dates). Reuse the existing row's id for the document link, as today.
- **Backstop:** Alembic migration adding a **partial unique index** on
  `(employee_id, leave_type, start_date, end_date) WHERE deleted_at IS NULL`.
- **Tests (first):** double-submit >2 min apart reuses the row (currently fails); distinct dates insert; overlapping
  dates dedupe; the index rejects a raw duplicate insert.

### A2 · D1 — cleanup migration for the 398 existing duplicates (DRY-RUN + GATE)
- **What:** soft-delete duplicates (set `deleted_at`), keeping the **lowest id** per
  `(employee_id, leave_type, start_date, end_date)` group; before deleting, **re-point any `Document.leave_id`** that
  references a to-be-deleted row to the surviving row.
- **Safety:** runs first as a **dry-run** (`--dry-run`) that writes a report (group count, rows to delete, ref
  re-points) against a **copy of the live DB / fresh backup**. Then STOP and surface the report for approval.
- **Tests (first):** on a seeded fixture DB, dry-run reports the exact groups; apply keeps one row per group,
  re-points documents, and leaves non-duplicate leaves untouched.

### A3 · D3 — normalize leave `status`/`leave_type` at rest + fix classifier
- **Code:** fix `backend/app/core/leave_lifecycle.py` `_english_part`/`classify_group` to strip dash-less bilingual
  forms (map by known Arabic suffixes, or match the canonical English prefix token-wise) so
  `"Duty Resumption مباشرة عمل"` classifies as `record`. Enforce canonical values on write (single writer in
  `document_service._make_leave_row` + `leave_service.create_leave`).
- **Data:** migration to rewrite stored `leave_type`/`status` to canonical codes; the bilingual label is rendered at
  the UI layer from a lookup, not stored.
- **Tests (first):** classifier table covering dash, dash-less, and canonical forms; migration collapses known
  variants; a lifecycle transition that currently misfires on a dash-less type now passes.

### A4 · C3 — employee Leaves tab through canonStatus + i18n
- **Where:** `frontend/src/pages/employees/tabs/LeavesTab.tsx:15-20,64,72-78`.
- **Change:** import and route `l.status`/`l.leave_type` through `canonStatus()` + `t()`/`splitBilingual` like the
  other leave surfaces, so the status pill colors correctly and text is translated. (Largely mooted once A3 lands,
  but the code must not depend on normalized data to render correctly.)
- **Tests (first):** rendering a leave with a legacy bilingual status shows the correct pill class + translated label.

### A5 · D2 — gate the Expiry surface on data presence
- **Where:** `frontend/src/pages/dashboard/widgets/ExpiringSoonWidget.tsx`, the `/expiry` route in `App.tsx`, nav link.
- **Change:** hide the Expiry route + dashboard widget when no employee has any expiry data (a cheap
  `has_any_expiry` signal from the summary endpoint), so the app doesn't advertise a surface that can only ever say
  "nothing expiring." Re-appears automatically once data is populated. (Pairs with P3's expiry-summary endpoint.)
- **Tests (first):** widget/route hidden when the summary reports zero expiry data; shown when non-zero.

---

## Batch B — Performance

- **B1 · P1** — route `relevant_counts` through the existing-but-unused `leaves_needing_action`/`precomputed_leaves`
  path so the leaves set is computed once per tick instead of re-paged per SSE poll; batch `submitter_name` via one
  `select(User).where(User.id.in_(ids))`. Consider expressing `needs_action` as a SQL filter.
  Files: `notification_service.py:93-200`, `notifications.py:108,135`, `book_service.py:751`.
- **B2 · P4** — batch the N+1 point lookups (`db.get` per row/version) into `IN` queries mapped by id:
  `book_service.py:751,765,868,911`, `scan_inbox.py:28-38`, `books.py:211-234`.
- **B3 · P3** — push the expiry date filter into SQL (`expiry_service`); select only name/G-number columns for OCR
  matching (`extractions.py:57`, `intake.py:83`); add a lightweight expiry **summary/count** endpoint + server-side
  `limit` for the dashboard widget. Files: `expiry.py:20`, `ExpiringSoonWidget.tsx:85-97`.
- **B4 · P2** — gate the two leaves `useQuery`s on a `matchMedia` breakpoint (`enabled`) or lazy-mount the hidden pane
  so only the visible list fetches. Files: `TabRecords.tsx:662-666,696-698`, `useLeaveReport.ts:51-54`.
- **B5 · P6** — scoped `useWatch({control,name:['to','cc']})` in the composer (`LedgerEmailCompose.tsx:945`);
  virtualize the desktop Leaves register (`RegisterTable.tsx`) and books `RecordsList.tsx` with the already-present
  `@tanstack/react-virtual`; lazy-render PDF pages via IntersectionObserver (`PdfViewer.tsx:61-79`).
- **B6 · P5** — route OCR/PDF extraction through the existing BackgroundTasks + `/jobs/{id}` poll pattern instead of
  running inline behind the size-2 semaphore. Files: `extractions.py:49-58`, `intake.py:70-85`.
- **B7 · P7** — memoize `effective_caps(user)` per request (cache on `request.state`); module-level `Map` of
  `Intl.RelativeTimeFormat` by locale; wrap the pending/active/suspended arrays in one `useMemo`.
  Files: `perm_service.py:55-84`, `AccessRequestsPage.tsx:87-102,804-806`.
- **B8 · P8** — TTL-sweep or LRU-bound the `_jobs` registry (`job_registry.py`); cap the extraction upload at
  `MAX_UPLOAD_BYTES+1` and 422 on overflow, mirroring intake (`extractions.py:48` vs `intake.py:63-69`).

Each B item ships with a focused test (query-count assertion, `enabled`-gate test, virtualization smoke, job-prune
unit, size-cap 422). B items are independent and can land in any order.

---

## Batch C — Dead code & duplication

- **C2** — delete the six unreachable ledger files (`LedgerEntryDrawer, LedgerEntryForm, CounterpartyPicker,
  LedgerTimeline, LedgerRow, LedgerFilterBar` under `pages/ledger/`) + fix the stale `LedgerPage.tsx` docstring. Keep
  `ledgerFilters.ts`. Verify build + typecheck after.
- **C7 (dead)** — delete `components/employees/KpiStrip.tsx`, `LeaveHistory.tsx`; remove dead config
  `whatsapp_phone_number_id` (`config.py:75`); remove the ignored `hand_sign` request field
  (`documents.py:104-106`); drop the write-only `pushRecentRecipient`/`getRecentRecipients` store and
  `mailboxQuerySource`.
- **U5** — remove `/mockups/login` + `mountain-accent.tsx` (or dev-gate). Confirm no nav links.
- **C4** — add `apiErrorMessage(err)` next to `ApiError` in `lib/api.ts`; replace the 54 inline idiom sites.
- **C5** — extract `frontend/src/lib/pdf.ts` (`base64ToBytes` + `renderPdfToCanvases`) used by the three PDF
  components; extract `backend/app/api/_responses.py::maybe_base64(...)` for the 8 base64 download handlers.
- **C1** — extract `useLeaveDecisionActions(leave)` hook + a shared action-button/delete component used by both the
  mobile drawer (`TabRecords.tsx`) and desktop `RecordExpansion.tsx`; align invalidations (add `leave-balance` where
  missing). This also enables **U3** (per-row actions on the employee Leaves tab).
- **C6** — extract `useBookApprovalActions(book)` consumed by `BookRecordPage.tsx` and `BookDetailDrawer.tsx`.
- **C7 (dup, lower priority)** — one `<SearchableCombobox>` for the three picker fields; a generic `<CrudListDialog>`
  for Submitter/Recipient dialogs; move `OUTLINE_PILL`/`PRIMARY_PILL` to `button-variants.ts`; single `slugify`;
  `_assert_draft_owner` helper (`ledger.py:515-572`); `_require_document_access` helper (`documents.py:304-370`);
  shared `_ocr_file` in `core/extraction/ocr.py`.
- **U1** — wire the employee ref into the "Email this person" compose prefill (add the missing `initialRef`), or
  hide/disable the action until prefill lands. Files: `LedgerOutlookShell.tsx:335-339`, `ContextPersonCard.tsx:206`.

C items are refactors — each guarded by existing tests + typecheck; behavior-preserving. Deletions land first
(cheapest, highest signal), then the shared-helper extractions.

---

## Batch D — Polish

- **N1** — gate the photo `<img>` on `has_photo` for the Ledger/message-list rows (`LedgerRow.tsx`,
  `MessageListRow.tsx`); gate the signature preview request on `has_signature`
  (`SigningSignatureSection.tsx:128-129`). Removes console 404 noise + wasted requests.
- **N3a** — pluralize the Employees count (`en.json` `pageMeta` → `_one`/`_other`, like the leaves page already has).
- **N3c** — reconcile the Services header count with rendered tiles (count the two nav cells, or label them).
- **N4a** — add `<meta name="mobile-web-app-capable" content="yes">` alongside the Apple one (`index.html:11`).
- **N4b** — prune the login known-accounts cache against the server (drop entries whose login returns unknown
  account) (`LoginPage.tsx:45-64`).
- **N5a** — open a fresh `SessionLocal()` inside `_run_generation` instead of passing the request session to the
  background task (`documents.py:240`).
- **N5b** — add `from e` to the `HTTPException` raises in `sms.py:43,45` and `whatsapp.py:43,45`.
- **N5c** — either surface an admin audit view for `AuditLog` or stop writing the leave/document rows nothing reads.
- **U2 (optional)** — dev-gate/hide the Migrate-from-v3 button (cosmetic; the endpoint is already safe).

---

## Sequencing & shipping

1. **Batch A** first (correctness). A1 + A2-code land together; **A2 live cleanup pauses at the dry-run gate**.
2. **Batch B** (performance) — independent items, land incrementally.
3. **Batch C** (cleanup) — deletions, then extractions.
4. **Batch D** (polish).

Each batch: branch → TDD → full test suite + typecheck + build → merge to `main` → push `origin/main` → `mng update`.
The i18n/RTL reviewer + notification-template reviewer agents run on any batch touching bilingual strings.

## Testing strategy

- Backend: pytest, TDD per change; add query-count assertions for the perf items; migration tests on seeded fixtures.
- Frontend: component tests for the status-pill and gating changes; typecheck + `vite build` as the refactor
  safety net; Playwright spot-check of the previously-broken surfaces (duplicate-leave dashboard, employee Leaves
  tab, ledger avatars) after Batch A + relevant B/D items.
- Verification-before-completion: no "done" claim without the command output.

## Risks

- **Live data (A2, A3):** duplicate cleanup + status rewrite touch production rows. Mitigate with backup + dry-run +
  gate; A3's rewrite is reversible via the same backup.
- **Refactor regressions (C1, C5, C6):** shared-hook extraction across two surfaces — covered by keeping behavior
  identical and leaning on typecheck + existing tests; land behind the review agents.
- **Virtualization (B5):** desktop register/RecordsList markup changes — smoke-test scroll + print paths (books have
  an A4 print layout).
