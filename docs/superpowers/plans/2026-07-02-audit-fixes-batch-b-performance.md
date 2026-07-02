# Audit Fixes — Batch B (Performance) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Remove the confirmed performance issues (P1–P8) from the 2026-07-02 audit — N+1 query fans, full-table scans, an SSE poll that re-scans all leaves, uncapped growth/uploads, and unvirtualized front-end lists — each change **proven** by a query-count assertion or a gate/virtualization test.

**Architecture:** Backend fixes are localized to service/query layers (batch `IN`-queries, push SQL filters down, memoize per-request caps, prune the job registry) and verified with a new query-counter test fixture. Frontend fixes gate duplicate fetches on the viewport and virtualize the desktop register / records list / PDF pages. Every task is behavior-preserving; the only observable change is fewer queries / less DOM / less work.

**Tech Stack:** FastAPI + SQLAlchemy + pytest (backend); React 19 + TanStack Query + `@tanstack/react-virtual` + vitest (frontend).

## Global Constraints

- Work on a branch (e.g. `audit-fixes-batch-b`); **do NOT push to `main`** — the user integrates via cherry-pick/merge. (Same workflow as Batch C.)
- Backend tests: `cd backend && ../venv/Scripts/python.exe -m pytest`. Frontend: `cd frontend && npm run test` / `npm run build` / `npx tsc -b`.
- Behavior-preserving ONLY: identical responses/UX, fewer queries / less work. Any response-shape change is out of scope.
- The 2 pre-existing failures (`test_sms_config`, `test_whatsapp_config`) read the live `.env` and are unrelated — ignore them; do not "fix" by touching config.
- The ruff-on-edit hook strips a just-added import if it isn't used yet in the same file — add the import in the SAME edit that introduces its first use, or re-add after (seen repeatedly in Batch A/C).
- P1 is REFRAMED from the audit: the full-table leaves scan runs in the SSE `relevant_counts` path (`notifications.py`, polls every `POLL_SECONDS = 2.5` per connected client), **not** the 60s scheduler (which excludes leaves). Target the SSE path.

---

### Task B0: Query-counter test fixture (foundation for P1/P3/P4/P7)

No query-count infrastructure exists. Add a fixture that counts SQL statements on the test engine so N+1 fixes are provable and regression-proof.

**Files:**
- Modify: `backend/tests/conftest.py`
- Test: `backend/tests/test_query_counter.py` (create — self-test of the fixture)

**Interfaces:**
- Produces: `count_queries` fixture yielding a context manager `with count_queries() as q: ...; assert q.count <= N` (counts `before_cursor_execute` events on the `db_session` engine).

- [ ] **Step 1: Write the failing self-test**

```python
# backend/tests/test_query_counter.py
from sqlalchemy import text

def test_query_counter_counts_statements(db_session, count_queries):
    with count_queries() as q:
        db_session.execute(text("SELECT 1"))
        db_session.execute(text("SELECT 2"))
    assert q.count == 2
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && ../venv/Scripts/python.exe -m pytest tests/test_query_counter.py -v`
Expected: FAIL (`count_queries` fixture missing).

- [ ] **Step 3: Implement the fixture in conftest.py**

```python
from contextlib import contextmanager
from sqlalchemy import event

@pytest.fixture()
def count_queries(db_session):
    engine = db_session.get_bind()

    @contextmanager
    def _counter():
        counter = type("Q", (), {"count": 0})()
        def _on_exec(conn, cursor, statement, params, context, executemany):
            counter.count += 1
        event.listen(engine, "before_cursor_execute", _on_exec)
        try:
            yield counter
        finally:
            event.remove(engine, "before_cursor_execute", _on_exec)

    return _counter
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && ../venv/Scripts/python.exe -m pytest tests/test_query_counter.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/tests/conftest.py backend/tests/test_query_counter.py
git commit -m "test: add count_queries fixture for N+1 assertions (Batch B foundation)"
```

---

### Task B1: P4 — batch N+1 user/entity lookups

**Files:**
- Modify: `backend/app/api/v1/scan_inbox.py:19-38` (`_to_item` → batch), `backend/app/services/book_service.py:751,765,868,911` (submitter/reviewer name resolution), `backend/app/api/v1/books.py:171-234`
- Test: `backend/tests/test_scan_inbox_nplus1.py`, extend book awaiting/versions tests

**Interfaces:**
- Produces: `list_scan_inbox` serializes rows with a bounded number of queries (fetch all referenced `LedgerEntry`/`Employee` ids in one `select(...).where(X.id.in_(ids))` each, map by id) instead of `db.get` per row. Same for book submitter/reviewer names (`resolve_names_by_ids(db, ids) -> dict[int,str]`).

- [ ] **Step 1: Write the failing query-count test (scan-inbox)**

```python
# backend/tests/test_scan_inbox_nplus1.py — seed N inbox rows referencing distinct employees/entries
def test_list_scan_inbox_is_not_n_plus_1(db_session, count_queries, seed_scan_inbox_rows):
    seed_scan_inbox_rows(10)  # 10 rows, each with a proposed_employee_id + ledger_entry_id
    from app.services.scan_inbox_service import list_items
    with count_queries() as q:
        items = list_items(db_session)
    assert len(items) == 10
    # 1 list + 1 batched employees + 1 batched ledger-entries (allow a small constant)
    assert q.count <= 4
```

(Verify the real entry point — `list_items` in `scan_inbox_service` or the router's `list_scan_inbox`; seed via the ScanInbox model. Adapt the seed helper to the model's required columns.)

- [ ] **Step 2: Run to verify it fails** — Expected: `q.count` ≈ 1 + 2×10 = 21, assertion fails.

- [ ] **Step 3: Implement batching**

In `_to_item`'s caller, collect `{r.ledger_entry_id}` and `{r.proposed_employee_id}` across all rows, run one `select(LedgerEntry).where(LedgerEntry.id.in_(entry_ids))` and one `select(Employee).where(Employee.id.in_(emp_ids))`, build id→row maps, and pass the looked-up objects into `_to_item` instead of it calling `db.get`.

- [ ] **Step 4: Run to verify it passes** — Expected: `q.count <= 4`.

- [ ] **Step 5: Repeat for book submitter/reviewer names**

Add `book_service.resolve_names_by_ids(db, user_ids: set[int]) -> dict[int, str]`; use it in `GET /books/awaiting` (`books.py:171-175`) and `_build_versions` (`books.py:211-234`) so `submitter_name`/`resolve_user_name_by_id` aren't called per-row. Add a query-count test seeding K awaiting books with distinct submitters asserting `q.count` is bounded (not `1 + K`).

- [ ] **Step 6: Full suite + commit**

Run: `cd backend && ../venv/Scripts/python.exe -m pytest -q` (expect only the 2 pre-existing env failures).
```bash
git commit -am "perf(api): batch N+1 lookups in scan-inbox list + book submitter/reviewer names"
```

---

### Task B2: P1 — precompute the org-wide leave count once per SSE tick + batch submitter on the notifier path

**Files:**
- Modify: `backend/app/api/v1/notifications.py` (SSE `gen()` loop + counts endpoint), `backend/app/services/notification_service.py:168-199` (`relevant_counts` already accepts `precomputed_leaves`), `:77-135` (`actionable_items` uses `submitter_name` per book)
- Test: `backend/tests/test_notifications_counts_queries.py`

**Interfaces:**
- Produces: the SSE loop computes `leaves_needing_action(db)` ONCE per tick and passes it as `precomputed_leaves` to every `relevant_counts` call in that tick; `actionable_items` resolves submitter names via the B1 batch helper.

- [ ] **Step 1: Write the failing test** — assert that calling `relevant_counts(db, user, precomputed_leaves=N)` issues **zero** leave-table scans (the precompute path), and that the SSE tick helper computes leaves once regardless of user count.

```python
def test_relevant_counts_with_precompute_skips_leaf_scan(db_session, count_queries, make_user):
    from app.services.notification_service import relevant_counts
    u = make_user(db_session)
    with count_queries() as q:
        relevant_counts(db_session, u, precomputed_leaves=0)
    # no re-paging of the leaves table when the count is supplied
    assert q.count <= 3   # tighten after inspecting the non-leaf queries
```

- [ ] **Step 2: Run — verify current behavior** (baseline count without precompute is higher; document the delta).

- [ ] **Step 3: Implement** — in `notifications.py`, hoist `leaves = leaves_needing_action(db)` above the per-connection/per-user work in the tick and thread it as `precomputed_leaves=leaves`; route `actionable_items`' submitter lookups through `resolve_names_by_ids`.

- [ ] **Step 4: Run to verify pass + no behavior change** (counts endpoint returns identical numbers).

- [ ] **Step 5: (Optional, if low-risk) express `needs_action` as SQL** — only if a clean `WHERE` is achievable; otherwise leave the Python filter but keep the once-per-tick precompute. Note the decision in the commit.

- [ ] **Step 6: Commit** — `perf(notify): compute org-wide leave count once per SSE tick; batch submitter names`

---

### Task B3: P3 — push expiry filter into SQL; minimal columns for OCR match; expiry summary/count endpoint

**Files:**
- Modify: `backend/app/api/v1/expiry.py:19-21`, `backend/app/services/expiry_service.py`, `backend/app/api/v1/extractions.py:57`, `backend/app/api/v1/intake.py:83`, `backend/src` widget (`frontend/src/pages/dashboard/widgets/ExpiringSoonWidget.tsx:85-97`)
- Test: `backend/tests/test_expiry_query.py`

- [ ] **Step 1: Write the failing test** — seed employees (most with NULL expiry, a few within the window); assert the expiry list query does NOT load all employees: `with count_queries()` + assert the result only contains the in-window rows and (via a row-count probe or a spy) that the SQL carries a `WHERE ... expiry <= :cutoff` rather than materializing the whole table.

- [ ] **Step 2: Run — fails** (current `list(db.execute(select(Employee)).scalars())` loads all).

- [ ] **Step 3: Implement** — move the expiry date/window filter into the `select` (`WHERE (uae_id_expiry BETWEEN today AND cutoff) OR (passport_expiry ...)`), returning only matching rows; for OCR matching (`extractions`/`intake`) select only `Employee.id, name_en, name_ar, uae_id_no` columns. Add `GET /expiry/count` (or extend `/summary`) returning totals so the dashboard widget stops fetching 90-day rows to `.slice(0,5)`; add a server-side `limit`.

- [ ] **Step 4: Run — passes.** Update the widget to use the count/limited endpoint.

- [ ] **Step 5: Frontend tsc + build; backend suite; commit** — `perf(expiry): filter in SQL, minimal OCR columns, summary endpoint for the widget`

---

### Task B4: P7 — memoize effective_caps per request; module-level Intl formatters; memoized arrays

**Files:**
- Modify: `backend/app/services/perm_service.py:55-84`, the capability dependency in `backend/app/api/deps.py`; `frontend/src/pages/access/AccessRequestsPage.tsx:87-102,804-806`
- Test: `backend/tests/test_perm_cache_queries.py`

- [ ] **Step 1: Failing test** — within one request scope, calling `has_capability` twice for the same non-admin user issues the role/user-permission queries **once** (memoized), not twice.

```python
def test_effective_caps_memoized_per_request(db_session, count_queries, make_user):
    from app.services import perm_service
    u = make_user(db_session, role="operator")
    with count_queries() as q:
        perm_service.has_capability(db_session, u, "books.view")
        perm_service.has_capability(db_session, u, "leaves.view")
    assert q.count <= 2   # one role-caps + one user-overrides, reused for the 2nd check
```

- [ ] **Step 2: Run — fails** (≈4 queries: 2 per call).

- [ ] **Step 3: Implement** — cache `effective_caps(user)` on `request.state` (via the dependency) or an lru keyed by `(user.id, session token)`; resolve once in `require_capability` and pass the set down. Frontend: module-level `Map<string, Intl.RelativeTimeFormat>` keyed by locale; wrap the pending/active/suspended `filter()`s in one `useMemo`.

- [ ] **Step 4: Run — passes; frontend tsc + build.**

- [ ] **Step 5: Commit** — `perf(perms): memoize effective caps per request; cache Intl formatters; memoize AccessRequests arrays`

---

### Task B5: P8 — bound the job registry; cap the extraction upload

**Files:**
- Modify: `backend/app/services/job_registry.py:23,55-60`, `backend/app/api/v1/extractions.py:48`
- Test: `backend/tests/test_job_registry_prune.py`, `backend/tests/test_extraction_upload_cap.py`

- [ ] **Step 1: Failing tests** — (a) after submitting > N jobs (or advancing a TTL), the registry holds ≤ cap entries; (b) an over-`MAX_UPLOAD_BYTES` extraction upload returns 422 (currently unbounded).

- [ ] **Step 2: Run — fail.**

- [ ] **Step 3: Implement** — TTL-sweep completed/failed jobs on `submit_job`/`get_job` (drop entries older than N minutes) or cap with an OrderedDict LRU; in `extractions.py` read `MAX_UPLOAD_BYTES + 1` and raise `ValidationFailedError` on overflow, mirroring `intake.py:63-69`.

- [ ] **Step 4: Run — pass; full suite; commit** — `perf(jobs): prune the in-memory job registry; cap the extraction upload`

---

### Task B6: P5 — offload OCR/PDF extraction to the background-job pattern

**Files:**
- Modify: `backend/app/api/v1/extractions.py:30-58`, `backend/app/api/v1/intake.py:42-84`; reuse `job_registry` + `/jobs/{id}` (as `documents.generate` does)
- Test: `backend/tests/test_extraction_async.py`

**RISK NOTE:** This changes the extraction/intake API from sync-result to job-poll — the LARGEST-surface change in Batch B (the frontend intake/extraction callers must poll). Do this LAST and consider whether the size-2 semaphore is a sufficient interim mitigation; if the frontend can't be updated safely in the same pass, keep OCR sync and just document the trade-off. Confirm scope before implementing.

- [ ] **Step 1:** Decide sync-vs-async with the reviewer; if async, add `POST /extractions` → `202 {job_id}` + `GET /extractions/jobs/{id}`, run OCR in the background task (own session), and update the frontend intake/extraction flow to poll. If deferred, STOP and record the decision.
- [ ] **Steps 2-5:** TDD the job lifecycle + frontend poll; full suite + build; commit.

---

### Task B7: P2 — gate the double leaves fetch on the viewport

**Files:**
- Modify: `frontend/src/pages/leaves/TabRecords.tsx:662-666,696-698`, `frontend/src/pages/leaves/report/useLeaveReport.ts:51-54`
- Test: `frontend/src/pages/leaves/TabRecords.enabled.test.tsx`

- [ ] **Step 1: Failing test** — mock `useIsMobile`/matchMedia; assert that on desktop the mobile `['leaves-list', params]` query is `enabled: false` (not fetched) and on mobile the report `['leaves-list','report-all']` query is disabled.

- [ ] **Step 2: Run — fails** (both fire unconditionally).

- [ ] **Step 3: Implement** — add `enabled: isMobile` / `enabled: !isMobile` to the two `useQuery`s (reuse the existing `useIsMobile` hook), or lazy-mount the hidden pane so its query never registers.

- [ ] **Step 4: Run — pass; tsc + build; commit** — `perf(leaves): only fetch the list for the visible viewport`

---

### Task B8: P6 — scoped composer watch + virtualize register/records/PDF

**Files:**
- Modify: `frontend/src/pages/ledger/LedgerEmailCompose.tsx:945` (scoped `useWatch`), `frontend/src/pages/leaves/report/RegisterTable.tsx` (virtualize rows), `frontend/src/pages/books/RecordsList.tsx:47` (virtualize), `frontend/src/components/ledger/PdfViewer.tsx:61-79` (lazy pages)
- Test: component smoke tests + `tsc`/`build`; a render-count test for the composer if feasible

**RISK NOTE:** Virtualizing the desktop Leaves register and books RecordsList changes list markup — verify scroll AND the books A4 **print** path (books have a print layout; virtualized rows must still print). Do the composer `useWatch` (lowest risk) first; treat each virtualization as its own commit with a manual scroll/print check.

- [ ] **Step 1 (composer):** replace `watch('to')`/`watch('cc')` in render with `useWatch({ control, name: ['to','cc'] })`; verify the To/Cc menu still updates and the editor no longer re-renders on those changes. tsc + build. Commit.
- [ ] **Step 2 (RecordsList):** virtualize with the already-present `@tanstack/react-virtual` (mirror `MobileLeaveList`/`MobileEmployeeList`); manual scroll check. Commit.
- [ ] **Step 3 (RegisterTable):** virtualize the desktop register rows; **verify print layout** still renders all rows (print may need a non-virtualized fallback via a print media query). Commit.
- [ ] **Step 4 (PdfViewer):** render pages lazily via IntersectionObserver instead of eagerly at 2×DPR. Commit.

---

## Batch B completion

- [ ] Backend suite green except the 2 pre-existing env failures: `cd backend && ../venv/Scripts/python.exe -m pytest -q`
- [ ] Frontend tests + build green: `cd frontend && npm run test && npm run build`
- [ ] Each perf task carries a query-count / gate / render assertion that would catch a regression.
- [ ] Branch pushed (NOT to main); hand to the user for cherry-pick/merge.

## Sequencing & risk

1. **B0** (fixture) → **B1, B2, B3, B4, B5** (backend, query-count-provable, low UX risk) → **B7** (leaves fetch gate, low risk).
2. **B8** composer `useWatch` (low), then the three virtualizations (medium — markup/print).
3. **B6** (OCR async) LAST and only if the frontend poll can land safely; otherwise defer with a documented trade-off.

Lowest-risk, highest-certainty wins are B1/B4/B5/B7. The genuinely risky items are B6 (API shape) and B8's virtualizations (print path) — each gated behind an explicit scope check.

## Self-review notes

- Every backend perf task depends on B0 and asserts a query count — no "it's faster, trust me".
- P1's reframe (SSE 2.5s path, not the 60s scheduler) is stated in Global Constraints and B2 so the executor doesn't chase the wrong loop.
- Fixture/entry-point names (`list_items`, `seed_scan_inbox_rows`, `make_user`) are assumptions — the executor verifies against `conftest.py` and the real service entry points before writing tests, and adapts rather than inventing.
- B6 and B8-virtualization are explicitly flagged as scope-check-first because they change API shape / print behavior.
