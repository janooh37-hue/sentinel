# Audit Fixes — Batch A (Data Integrity) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop new duplicate leave rows, clean up the 398 existing duplicates (gated), fix the dash-less bilingual leave-type misclassification, make the employee Leaves tab robust to legacy statuses, and stop advertising the empty Expiry surface.

**Architecture:** Backend fixes are localized to `document_service` (dedup guard), `leave_lifecycle` (classifier), a new Alembic migration (partial unique index), and a standalone gated cleanup script. Frontend fixes touch the employee Leaves tab and the Expiry route/widget gating. TDD throughout; the one production-data mutation (duplicate cleanup) runs dry-run-first behind an explicit approval gate.

**Tech Stack:** FastAPI, SQLAlchemy, Alembic, pytest (backend); React 19 + TypeScript + Vite + TanStack Query, vitest (frontend).

## Global Constraints

- This checkout is the LIVE server. Work on branch `audit-fixes-2026-07-02`; merge to `main` + push `origin/main` when green; deploy via `scripts\mng.ps1 update`.
- No production-data mutation without a fresh backup + dry-run report + explicit user approval (Task A2).
- Backend tests: `cd backend && ../venv/Scripts/python.exe -m pytest`. Frontend: `cd frontend && npm run test` / `npm run build`.
- Revert incidental `backend/templates/*.docx` churn before committing.
- Stored leave `status` is canonical for app-written rows; `leave_type` intentionally stays bilingual (it is the display label) and is stripped via `leave_lifecycle._english_part` for logic. Do NOT normalize `leave_type` at rest.
- Bilingual historical statuses come from the post-0035 v3 import; backend readers already normalize via `canonical_status()`. Status data re-canonicalization is OPTIONAL (Task A6) and lower priority.

---

### Task A1: Overlap-based leave dedup guard

Replace the 2-minute window in the WF-03 guard with an overlap check so a re-generated leave >2 min apart still dedupes.

**Files:**
- Modify: `backend/app/services/document_service.py:1469-1512`
- Test: `backend/tests/test_document_service_leave_dedup.py` (create)

**Interfaces:**
- Consumes: `generate_document(...)` (existing) which internally builds `leave_row` via `_make_leave_row` and runs the guard.
- Produces: unchanged public signature; new behavior — dedupe keyed on `(employee_id, canonical leave_type, overlapping [start,end])` regardless of `created_at`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_document_service_leave_dedup.py
from datetime import date
from app.services import document_service, leave_service
from app.db.models import Leave

def test_regenerating_same_leave_more_than_2min_apart_does_not_duplicate(db_session, seed_employee):
    emp = seed_employee(employee_id="G9001")
    fields = {"leave_type": "Sick Leave", "start_date": "01/07/2026",
              "end_date": "03/07/2026", "total_days": "3"}
    d1 = document_service.generate_document(db_session, "Leave Application Form", emp.employee_id, dict(fields))
    # simulate a later, separate generation of the SAME leave (would previously insert a 2nd row)
    d2 = document_service.generate_document(db_session, "Leave Application Form", emp.employee_id, dict(fields))
    rows = db_session.query(Leave).filter(Leave.employee_id == emp.employee_id,
                                          Leave.deleted_at.is_(None)).all()
    assert len(rows) == 1
    assert d1.leave_id == d2.leave_id == rows[0].id

def test_distinct_dates_insert_separate_rows(db_session, seed_employee):
    emp = seed_employee(employee_id="G9002")
    base = {"leave_type": "Annual Leave", "total_days": "3"}
    document_service.generate_document(db_session, "Leave Application Form", emp.employee_id,
                                       {**base, "start_date": "01/07/2026", "end_date": "03/07/2026"})
    document_service.generate_document(db_session, "Leave Application Form", emp.employee_id,
                                       {**base, "start_date": "10/07/2026", "end_date": "12/07/2026"})
    rows = db_session.query(Leave).filter(Leave.employee_id == emp.employee_id,
                                          Leave.deleted_at.is_(None)).all()
    assert len(rows) == 2
```

(If `db_session`/`seed_employee` fixtures don't exist with these names, first check `backend/tests/conftest.py` and adapt the fixture names — do not invent new fixtures if equivalents exist.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && ../venv/Scripts/python.exe -m pytest tests/test_document_service_leave_dedup.py -v`
Expected: `test_regenerating_...` FAILS (2 rows, guard's 2-min window missed the retry).

- [ ] **Step 3: Implement the overlap-based guard**

In `document_service.py`, replace the `_dup_cutoff` time filter (lines ~1480-1496) with an overlap query (no `created_at` bound). Compare on canonical leave_type so a bilingual stored duplicate still matches:

```python
from app.core.leave_lifecycle import canonical_status  # noqa (if not already imported)
# ... inside the `elif template_id in _LEAVE_FORM_IDS ...` branch:
existing_leave = (
    db.execute(
        select(Leave)
        .where(
            Leave.employee_id == employee_id,
            Leave.leave_type == leave_row.leave_type,   # canonical for app-written rows
            Leave.start_date == leave_row.start_date,
            Leave.end_date == leave_row.end_date,
            Leave.deleted_at.is_(None),
        )
        .order_by(Leave.id.desc())
    )
    .scalars()
    .first()
)
```

Keep the existing "reuse id / else insert" block below it unchanged. Update the comment to describe the overlap/exact-match dedup (drop the "2-minute" wording).

- [ ] **Step 4: Run tests to verify pass**

Run: `cd backend && ../venv/Scripts/python.exe -m pytest tests/test_document_service_leave_dedup.py -v`
Expected: PASS (both tests).

- [ ] **Step 5: Run the full leave/document suite for regressions**

Run: `cd backend && ../venv/Scripts/python.exe -m pytest tests/ -k "leave or document" -q`
Expected: no new failures.

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/document_service.py backend/tests/test_document_service_leave_dedup.py
git commit -m "fix(leaves): dedupe leave rows on exact (emp,type,dates) match, not a 2-min window"
```

---

### Task A2: Duplicate-leave cleanup script (DRY-RUN + APPROVAL GATE)

Author a reversible cleanup that soft-deletes duplicate leaves keeping the lowest id, re-pointing `Document.leave_id` first. Ship it dry-run-first; **do not run against the live DB without approval.**

**Files:**
- Create: `backend/scripts/dedupe_leaves.py`
- Test: `backend/tests/test_dedupe_leaves.py`

**Interfaces:**
- Produces: `plan_dedupe(db) -> list[DupeGroup]` (pure, read-only) and `apply_dedupe(db, groups) -> None` (mutating). CLI: `python -m app... dedupe_leaves --dry-run` (default) / `--apply`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_dedupe_leaves.py
from app.scripts.dedupe_leaves import plan_dedupe, apply_dedupe
from app.db.models import Leave, Document

def test_plan_identifies_dupes_and_keeps_lowest_id(db_session, seed_employee):
    emp = seed_employee(employee_id="G9100")
    ids = []
    for _ in range(3):
        r = Leave(employee_id=emp.employee_id, leave_type="Sick Leave",
                  start_date=__import__("datetime").date(2026,3,25),
                  end_date=__import__("datetime").date(2026,3,26), days=2, status="Approved")
        db_session.add(r); db_session.flush(); ids.append(r.id)
    keep, drop = plan_dedupe(db_session)[0].keep_id, plan_dedupe(db_session)[0].drop_ids
    assert keep == min(ids)
    assert set(drop) == set(ids) - {min(ids)}

def test_apply_soft_deletes_dupes_and_repoints_documents(db_session, seed_employee):
    emp = seed_employee(employee_id="G9101")
    a = Leave(employee_id=emp.employee_id, leave_type="Sick Leave",
              start_date=__import__("datetime").date(2026,3,25),
              end_date=__import__("datetime").date(2026,3,26), days=2, status="Approved")
    b = Leave(employee_id=emp.employee_id, leave_type="Sick Leave",
              start_date=__import__("datetime").date(2026,3,25),
              end_date=__import__("datetime").date(2026,3,26), days=2, status="Approved")
    db_session.add_all([a,b]); db_session.flush()
    doc = Document(employee_id=emp.employee_id, template_id="Leave Application Form", leave_id=b.id)
    db_session.add(doc); db_session.flush()
    apply_dedupe(db_session, plan_dedupe(db_session))
    db_session.refresh(a); db_session.refresh(b); db_session.refresh(doc)
    assert a.deleted_at is None and b.deleted_at is not None   # kept lowest id
    assert doc.leave_id == a.id                                # re-pointed
```

(Adapt `Document(...)` kwargs to the real model constructor if required fields differ — check `models.py:500-530`.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && ../venv/Scripts/python.exe -m pytest tests/test_dedupe_leaves.py -v`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `backend/scripts/dedupe_leaves.py`**

```python
"""Soft-delete duplicate leave rows, keeping the lowest id per
(employee_id, leave_type, start_date, end_date) group. Re-points any
Document.leave_id from a dropped row to the kept row first.

DRY-RUN by default. Use --apply to mutate. Requires a fresh backup first.
"""
from __future__ import annotations
import argparse
from dataclasses import dataclass
from datetime import datetime, timezone
from sqlalchemy import select, func
from app.db.session import SessionLocal
from app.db.models import Leave, Document

@dataclass
class DupeGroup:
    key: tuple
    keep_id: int
    drop_ids: list[int]

def plan_dedupe(db) -> list[DupeGroup]:
    rows = db.execute(
        select(Leave.id, Leave.employee_id, Leave.leave_type, Leave.start_date, Leave.end_date)
        .where(Leave.deleted_at.is_(None))
        .order_by(Leave.id)
    ).all()
    groups: dict[tuple, list[int]] = {}
    for r in rows:
        groups.setdefault((r.employee_id, r.leave_type, r.start_date, r.end_date), []).append(r.id)
    return [DupeGroup(k, ids[0], ids[1:]) for k, ids in groups.items() if len(ids) > 1]

def apply_dedupe(db, groups: list[DupeGroup]) -> None:
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    for g in groups:
        for drop in g.drop_ids:
            db.execute(Document.__table__.update()
                       .where(Document.leave_id == drop).values(leave_id=g.keep_id))
            row = db.get(Leave, drop)
            if row is not None:
                row.deleted_at = now
    db.commit()

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="mutate (default is dry-run)")
    args = ap.parse_args()
    with SessionLocal() as db:
        groups = plan_dedupe(db)
        total_drop = sum(len(g.drop_ids) for g in groups)
        print(f"[dedupe] {len(groups)} duplicate groups, {total_drop} rows to soft-delete")
        for g in groups[:20]:
            print(f"  keep {g.keep_id}  drop {g.drop_ids}  {g.key}")
        if not args.apply:
            print("[dedupe] DRY-RUN only. Re-run with --apply after backup + approval.")
            return
        apply_dedupe(db, groups)
        print(f"[dedupe] applied: soft-deleted {total_drop} rows.")

if __name__ == "__main__":
    main()
```

Place under `backend/app/scripts/` if that package exists (check), else `backend/scripts/` with a `sys.path` shim consistent with sibling scripts.

- [ ] **Step 4: Run tests to verify pass**

Run: `cd backend && ../venv/Scripts/python.exe -m pytest tests/test_dedupe_leaves.py -v`
Expected: PASS.

- [ ] **Step 5: Commit (code only — NOT a live run)**

```bash
git add backend/app/scripts/dedupe_leaves.py backend/tests/test_dedupe_leaves.py
git commit -m "feat(scripts): gated duplicate-leave cleanup (dry-run default)"
```

- [ ] **Step 6: GATE — dry-run against a backup copy, then STOP**

```bash
# copy the live DB, point the script at the copy, dry-run
cp data/gssg.db data/gssg.db.dedupe-preview
GSSG_DB_PATH=data/gssg.db.dedupe-preview cd backend && ../venv/Scripts/python.exe -m app.scripts.dedupe_leaves
```
Report the printed group/row counts to the user. **Do NOT run `--apply` on `data/gssg.db` until the user approves.**

---

### Task A3: Fix dash-less bilingual leave-type classification

`_english_part` only splits on `" - "`, so `"Duty Resumption مباشرة عمل"` misclassifies as `request` instead of `record`.

**Files:**
- Modify: `backend/app/core/leave_lifecycle.py:41-43`
- Test: `backend/tests/test_leave_lifecycle_classify.py` (create or extend existing lifecycle test)

**Interfaces:**
- Produces: `_english_part` additionally strips a trailing Arabic segment; `classify_group`/`canonical_status` unchanged in signature.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_leave_lifecycle_classify.py
import pytest
from app.core import leave_lifecycle as L

@pytest.mark.parametrize("value,expected", [
    ("Duty Resumption", "record"),
    ("Duty Resumption مباشرة عمل", "record"),      # dash-less bilingual — currently wrong
    ("Passport Release تسليم جواز", "record"),
    ("Sick Leave - الإجازة المرضية", "sick"),
    ("Annual Leave", "request"),
    ("National Service", "national_service"),
])
def test_classify_group_handles_dashless_bilingual(value, expected):
    assert L.classify_group(value) == expected
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && ../venv/Scripts/python.exe -m pytest tests/test_leave_lifecycle_classify.py -v`
Expected: the two dash-less cases FAIL (classified `request`).

- [ ] **Step 3: Implement robust `_english_part`**

```python
import re
_ARABIC = re.compile(r"[؀-ۿ]")

def _english_part(value: str) -> str:
    """Collapse bilingual labels to the English half. Handles both the
    ' - ' delimiter ('Pending - انتظار') and dash-less forms where an
    Arabic run simply follows the English ('Duty Resumption مباشرة عمل')."""
    head = value.partition(" - ")[0]
    m = _ARABIC.search(head)
    if m:
        head = head[: m.start()]
    return head.strip()
```

- [ ] **Step 4: Run to verify pass + full lifecycle regressions**

Run: `cd backend && ../venv/Scripts/python.exe -m pytest tests/test_leave_lifecycle_classify.py tests/ -k lifecycle -v`
Expected: PASS, no regressions.

- [ ] **Step 5: Commit**

```bash
git add backend/app/core/leave_lifecycle.py backend/tests/test_leave_lifecycle_classify.py
git commit -m "fix(leaves): classify dash-less bilingual leave types (record vs request)"
```

---

### Task A4: Partial unique index backstop (Alembic migration)

Prevent exact-duplicate leave rows at the DB level.

**Files:**
- Create: `backend/app/db/migrations/versions/0045_leave_dedupe_index.py`
- Test: `backend/tests/test_leave_unique_index.py`

**Interfaces:**
- Produces: partial unique index `ux_leaves_natural_key` on `(employee_id, leave_type, start_date, end_date) WHERE deleted_at IS NULL`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_leave_unique_index.py
import pytest
from datetime import date
from sqlalchemy.exc import IntegrityError
from app.db.models import Leave

def test_partial_unique_index_blocks_exact_duplicate(db_session, seed_employee):
    emp = seed_employee(employee_id="G9200")
    mk = lambda: Leave(employee_id=emp.employee_id, leave_type="Sick Leave",
                       start_date=date(2026,3,25), end_date=date(2026,3,26), days=2, status="Approved")
    db_session.add(mk()); db_session.commit()
    db_session.add(mk())
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()
```

(Requires the test DB to run migrations. If the test harness builds schema from `Base.metadata` rather than Alembic, also add the index to the `Leave` model's `__table_args__` so it exists in both paths — check how `conftest.py` builds the schema, and mirror the index there.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && ../venv/Scripts/python.exe -m pytest tests/test_leave_unique_index.py -v`
Expected: FAIL (second commit succeeds — no index).

- [ ] **Step 3: Write the migration**

```python
# backend/app/db/migrations/versions/0045_leave_dedupe_index.py
"""Partial unique index to block exact-duplicate leave rows.
Revision ID: 0045_leave_dedupe_index
Revises: 0044_sms_messages
"""
from __future__ import annotations
from collections.abc import Sequence
from alembic import op

revision: str = "0045_leave_dedupe_index"
down_revision: str | Sequence[str] | None = "0044_sms_messages"
branch_labels = None
depends_on = None

def upgrade() -> None:
    op.create_index(
        "ux_leaves_natural_key", "leaves",
        ["employee_id", "leave_type", "start_date", "end_date"],
        unique=True, sqlite_where=None,
        postgresql_where=None,
    )
    # SQLite partial index via raw SQL (op.create_index `sqlite_where` support varies):
    op.execute("DROP INDEX IF EXISTS ux_leaves_natural_key")
    op.execute(
        "CREATE UNIQUE INDEX ux_leaves_natural_key ON leaves "
        "(employee_id, leave_type, start_date, end_date) WHERE deleted_at IS NULL"
    )

def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ux_leaves_natural_key")
```

Also add to `Leave.__table_args__` in `models.py` (mirror for the metadata-built test schema):
```python
Index("ux_leaves_natural_key", "employee_id", "leave_type", "start_date", "end_date",
      unique=True, sqlite_where=text("deleted_at IS NULL")),
```

- [ ] **Step 4: IMPORTANT — the index requires dedupe to have run first**

The index creation will FAIL on the live DB while the 398 duplicates exist. Order of operations on live: Task A2 `--apply` (after approval) MUST precede running this migration. In tests (fresh schema) there are no pre-existing dupes, so ordering is moot. Note this dependency in the execution log.

- [ ] **Step 5: Run tests to verify pass**

Run: `cd backend && ../venv/Scripts/python.exe -m pytest tests/test_leave_unique_index.py -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app/db/migrations/versions/0045_leave_dedupe_index.py backend/app/db/models.py backend/tests/test_leave_unique_index.py
git commit -m "feat(db): partial unique index blocking duplicate leave rows"
```

---

### Task A5: Employee Leaves tab — robust status pill + i18n (C3)

**Files:**
- Modify: `frontend/src/pages/employees/tabs/LeavesTab.tsx:15-20,64,72-78`
- Test: `frontend/src/pages/employees/tabs/LeavesTab.test.tsx` (create) or extend existing.

**Interfaces:**
- Consumes: `canonStatus` from the leaves lib (find its module — likely `frontend/src/pages/leaves/lifecycle.ts` or `lib`), and the existing `splitBilingual`/`t` used by `TabRecords`.

- [ ] **Step 1: Write the failing test**

```tsx
// LeavesTab.test.tsx
import { render, screen } from "@testing-library/react";
import { LeavesTab } from "./LeavesTab";
// render with a leave whose status is the legacy bilingual form
it("shows the Approved pill for a legacy bilingual status", () => {
  renderWithProviders(<LeavesTab leaves={[{ id: 1, leave_type: "Sick Leave - الإجازة المرضية",
    status: "Approved - موافق", start_date: "2026-03-25", end_date: "2026-03-26", days: 2 }]} />);
  const pill = screen.getByText(/approved/i);
  expect(pill.className).toMatch(/emerald|green|success/); // the Approved pill class, not the neutral one
});
```

(Match the actual Approved pill class token used in `STATUS_CLS`; adapt the render helper to the repo's test utils.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npm run test -- LeavesTab`
Expected: FAIL (neutral pill, raw text).

- [ ] **Step 3: Implement**

Import `canonStatus` and key `STATUS_CLS` on `canonStatus(l.status)`; render the label via `t()` on the canonical status and `splitBilingual(l.leave_type)` for the type — mirroring `TabRecords`/`RecordExpansion`.

- [ ] **Step 4: Run to verify pass + typecheck/build**

Run: `cd frontend && npm run test -- LeavesTab && npm run build`
Expected: PASS, build clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/employees/tabs/LeavesTab.tsx frontend/src/pages/employees/tabs/LeavesTab.test.tsx
git commit -m "fix(employees): normalize leave status/type on the Leaves tab (canonStatus + i18n)"
```

---

### Task A6 (OPTIONAL, low priority): Re-canonicalize historical statuses

Only if we want the stored data clean (backend already normalizes on read; A5 makes the frontend robust). A data-only migration `0046_recanonicalize_leave_statuses` repeating `0035`'s UPDATEs (they are idempotent). Defer unless requested — it touches production rows and buys little once A5 lands.

---

### Task A7: Gate the Expiry surface on data presence (D2)

**Files:**
- Modify: `backend/app/api/v1/expiry.py` (add `has_any_expiry` to the summary response) + `expiry_service.py`
- Modify: `frontend/src/pages/dashboard/widgets/ExpiringSoonWidget.tsx`, `frontend/src/App.tsx` (route), nav link component
- Test: `backend/tests/test_expiry_summary.py`, widget test

**Interfaces:**
- Produces: expiry summary includes `has_any_expiry: bool`; frontend hides the widget + route + nav link when false.

- [ ] **Step 1: Write the failing backend test**

```python
def test_expiry_summary_reports_has_any_expiry_false_when_empty(client_admin, db_session):
    r = client_admin.get("/api/v1/expiry/summary")
    assert r.status_code == 200
    assert r.json()["has_any_expiry"] is False  # no employee has expiry dates
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && ../venv/Scripts/python.exe -m pytest tests/test_expiry_summary.py -v`
Expected: FAIL (key missing).

- [ ] **Step 3: Implement backend flag**

Add `has_any_expiry = db.execute(select(func.count()).select_from(Employee).where(or_(Employee.uae_id_expiry.isnot(None), Employee.passport_expiry.isnot(None)))).scalar() > 0` to the summary payload.

- [ ] **Step 4: Implement frontend gating**

In `ExpiringSoonWidget`, return `null` when `!summary.has_any_expiry`. In `App.tsx`/nav, hide the `/expiry` route link when the same flag (from a shared query) is false. Keep the route registered (deep links still resolve) but drop it from nav.

- [ ] **Step 5: Run tests + build**

Run: `cd backend && ../venv/Scripts/python.exe -m pytest tests/test_expiry_summary.py -v && cd ../frontend && npm run build`
Expected: PASS, build clean.

- [ ] **Step 6: Commit**

```bash
git add backend/app/api/v1/expiry.py backend/app/services/expiry_service.py frontend/src/pages/dashboard/widgets/ExpiringSoonWidget.tsx frontend/src/App.tsx backend/tests/test_expiry_summary.py
git commit -m "feat(expiry): hide expiry surface until any expiry data exists"
```

---

## Batch A completion

- [ ] Full backend suite green: `cd backend && ../venv/Scripts/python.exe -m pytest -q`
- [ ] Frontend test + build green: `cd frontend && npm run test && npm run build`
- [ ] i18n/RTL reviewer agent run over the LeavesTab change.
- [ ] **Live-data gate (A2 apply + A4 migration on live) held for explicit user approval.**
- [ ] Merge `audit-fixes-2026-07-02` → `main`, push `origin/main`, `mng update` (code-only changes; the live dedupe apply is a separate, gated step).

## Self-review notes

- Spec coverage: D1 → A1 (guard) + A2 (cleanup) + A4 (index); D3 → A3 (classifier) + A5 (frontend) with A6 optional data pass; D2 → A7; C3 → A5. All Batch-A spec items covered.
- Ordering dependency called out: A2 `--apply` must precede the A4 index on live data (dupes violate the unique index).
- Fixture names (`db_session`, `seed_employee`, `client_admin`) are assumptions — the executor verifies against `backend/tests/conftest.py` before writing tests and adapts names rather than inventing fixtures.
