# Employee Activity Lookup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the Employee search focus stroke and add a full-width, same-page, bilingual activity feed that can be filtered by type or employee name/G-number and whose rows open the exact source records.

**Architecture:** A new read-only FastAPI endpoint merges employee-linked Documents, Leaves, Violations, and visible Ledger entries into one stable paginated contract. React Query drives an infinite same-page feed; a focused employee lookup reuses the existing roster search, while Books, Leaves, and Ledger reuse their existing exact URL handoffs and Employee Detail gains exact violation-row hydration. The hero focus fix stays local to `EmployeeSearchHero` and preserves the global accessibility outline everywhere else.

**Tech Stack:** Python 3.12, FastAPI, Pydantic v2, SQLAlchemy/SQLite, pytest, React 19, TypeScript, React Query, React Router, react-i18next, Tailwind CSS, Vitest/Testing Library, Chromium browser verification.

**Approved design:** `docs/superpowers/specs/2026-08-10-employee-activity-lookup-design.md`

## Global Constraints

- Work only in `C:\Users\Admin\sentinel-worktrees\employee-activity` on `feature/employee-activity`; never modify or switch branches in the live production checkout.
- Use `C:\Users\Admin\sentinel\venv\Scripts\` for Python, pytest, Ruff, and mypy commands because the isolated worktree intentionally has no second venv.
- No new dependency and no database/Alembic migration.
- Exclude profile/status/photo/deletion audit events, record edits, SMS/WhatsApp, activity-body search, date ranges, saved filters, export, realtime/polling, Dashboard refactors, and replacement of the existing per-employee Activity tab.
- The page remains `/employees`; the activity section is reached by scrolling and uses the full page container width.
- Keep Recently opened, Documents expiring soon, and Files with missing data as the three existing navy hero windows.
- Default to all supported activity newest first; one type selector offers Documents, Leave, Violations, and Correspondence.
- Quick lookup accepts English name, Arabic name, or G-number. **Show activity** filters; **Open profile** navigates separately.
- Activity rows never fall back to the general employee profile. Each row opens its exact source record.
- Recency is `created_at`, not leave start date or violation effective date.
- Initial page and each Load more request contain 25 rows.
- Private email activity is scoped to the signed-in user's mailbox before rows and totals are computed.
- English and Arabic ship together. Use logical CSS properties, `dir="auto"` for stored user text, tabular numbers, semantic controls, and visible focus.
- The focused hero input loses only its local dark outline; the complete white pill gains a visible focus-within ring. Never weaken the global `:focus-visible` rule.
- After backend route/schema changes, invoke the project `sync-api-types` skill and commit generated `backend/openapi.json` with `frontend/src/lib/api.types.ts`.
- After UI strings/layouts change, run the required `i18n-rtl-reviewer` and verify desktop/mobile, LTR/RTL, and light/dark themes.
- Render source titles/details as plain React text; never use HTML injection. Exact destination pages retain their existing capability and not-found handling.
- Source queries are one request contract: any source failure fails the complete API request instead of returning a plausible partial feed or total.
- No notification-template change and no generated static assets committed.
- Never use production PII for development browser fixtures. Any browser seed data lives under ignored `.tmp/` and uses fictional employees.
- Do not deploy from this feature branch. Deployment occurs only after reviewed changes are merged, committed, and pushed to `origin/main` through the repository `deploy` workflow.

## File and Interface Map

### Backend activity contract

- Create `backend/app/schemas/employee_activity.py` — `EmployeeActivityKind`, `EmployeeActivityItemRead`, and `EmployeeActivityListRead`.
- Create `backend/app/services/employee_activity_service.py` — fixed-query-count source filtering, merge ordering, privacy, totals, and pagination.
- Modify `backend/app/api/v1/employees.py` — static `GET /employees/activity` before `/{employee_id}`.
- Create `backend/tests/test_employee_activity_service.py` — source rules, ordering, filters, pagination, and mailbox privacy.
- Create `backend/tests/test_employee_activity_api.py` — route precedence, response shape, validation, and capability gate.

### Generated/frontend API contract

- Regenerate `backend/openapi.json` and `frontend/src/lib/api.types.ts`.
- Modify `frontend/src/lib/api.ts` — generated type aliases, `ListEmployeeActivityParams`, and `api.listEmployeeActivity()`.
- Create `frontend/src/lib/api.employeeActivity.test.ts` — query-string and response forwarding contract.

### Exact violation destination

- Modify `frontend/src/pages/employees/EmployeeDetailPage.tsx` — hydrate `tab`/`open` query state and consume exact violation targeting.
- Modify `frontend/src/pages/employees/tabs/ViolationsTab.tsx` — target exact rows in both manage and read-only modes.
- Modify `frontend/src/components/employees/ViolationsTable.tsx` — stable row IDs and highlight class.
- Modify `frontend/src/pages/employees/EmployeeDetailPage.test.tsx`.
- Create `frontend/src/pages/employees/tabs/ViolationsTab.test.tsx`.

### Employee activity UI

- Create `frontend/src/components/employees/EmployeeActivityLookup.tsx` — debounced name/G-number results with sibling Show activity/Open profile controls.
- Create `frontend/src/components/employees/EmployeeActivityLookup.test.tsx`.
- Create `frontend/src/components/employees/EmployeeActivitySection.tsx` — infinite query, type filter, responsive feed, exact links, loading/empty/error states.
- Create `frontend/src/components/employees/EmployeeActivitySection.test.tsx`.
- Modify `frontend/src/pages/employees/EmployeeLookupPage.tsx` — render the section below the hero.
- Modify `frontend/src/pages/employees/EmployeeLookupPage.test.tsx` — integration marker and profile navigation callback.
- Modify `frontend/src/locales/en.json` and `frontend/src/locales/ar.json` — complete peer copy under `employees.activity`.

### Search focus fix

- Modify `frontend/src/components/employees/EmployeeSearchHero.tsx` — stable input hook and pill focus-within ring.
- Modify `frontend/src/index.css` — one more-specific unlayered selector for this input only.
- Re-run `frontend/src/components/employees/EmployeeSearchHero.test.tsx` and verify computed styles in Chromium.

---

### Task 1: Build the Backend Employee Activity Contract

**Files:**
- Create: `backend/app/schemas/employee_activity.py`
- Create: `backend/app/services/employee_activity_service.py`
- Modify: `backend/app/api/v1/employees.py:20-61,77-156`
- Create: `backend/tests/test_employee_activity_service.py`
- Create: `backend/tests/test_employee_activity_api.py`

**Interfaces:**
- Produces: `EmployeeActivityKind = Literal["document", "leave", "violation", "ledger"]`.
- Produces: `EmployeeActivityItemRead` with `kind`, `source_id`, `target_id`, `occurred_at`, bilingual employee identity, `title`, optional source metadata, and `reference`.
- Produces: `employee_activity_service.list_employee_activity(db, *, owner_user_id, employee_id=None, kind=None, limit=25, offset=0) -> EmployeeActivityListRead`.
- Produces: `GET /api/v1/employees/activity?employee_id=&kind=&limit=&offset=` for Task 2.

- [ ] **Step 1: Write failing service tests for ordering, source shape, and exact targets**

Create `backend/tests/test_employee_activity_service.py`. Seed two fictional employees and one record of each kind with explicit `created_at` values. A live document must have a live Book with the same `ref_number`; use a `BookCategory(id="HR", prefix="HR")` before the Book.

The primary contract test must assert exact merged order and target identity:

```python
from datetime import date, datetime, timedelta

from app.db.models import (
    Book,
    BookCategory,
    Document,
    Employee,
    Leave,
    LedgerEntry,
    Violation,
)
from app.services import employee_activity_service

BASE = datetime(2026, 8, 10, 9, 0)


def test_activity_merges_all_sources_by_creation_time(db_session):
    emp = Employee(id="G100", name_en="ALPHA EMPLOYEE", name_ar="موظف ألف")
    category = BookCategory(id="HR", name_en="HR", prefix="HR")
    book = Book(id=71, category_id="HR", ref_number="HR-0071", employee_id="G100")
    document = Document(
        id=11,
        employee_id="G100",
        template_id="Employment Certificate",
        ref_number="HR-0071",
        docx_path="output/fake.docx",
        submission_id="00000000-0000-0000-0000-000000000011",
        created_at=BASE + timedelta(minutes=4),
    )
    leave = Leave(
        id=22,
        employee_id="G100",
        leave_type="Annual",
        start_date=date(2026, 8, 11),
        end_date=date(2026, 8, 12),
        days=2,
        status="Approved",
        created_at=BASE + timedelta(minutes=3),
    )
    violation = Violation(
        id=33,
        employee_id="G100",
        violation_type="Late arrival",
        date=date(2026, 8, 10),
        description="Recorded for test",
        created_at=BASE + timedelta(minutes=2),
    )
    ledger = LedgerEntry(
        id=44,
        entry_date=date(2026, 8, 10),
        direction="incoming",
        channel="letter",
        counterparty="Test authority",
        subject="Test correspondence",
        related_employee_id="G100",
        created_at=BASE + timedelta(minutes=1),
    )
    db_session.add_all([emp, category, book, document, leave, violation, ledger])
    db_session.commit()

    result = employee_activity_service.list_employee_activity(
        db_session, owner_user_id=7, limit=25, offset=0
    )

    assert [item.kind for item in result.items] == [
        "document", "leave", "violation", "ledger"
    ]
    assert result.total == 4
    assert result.items[0].source_id == 11
    assert result.items[0].target_id == 71
    assert result.items[1].target_id == 22
    assert result.items[1].days == 2
    assert result.items[2].detail == "Recorded for test"
    assert result.items[3].direction == "incoming"
    assert all(item.employee_id == "G100" for item in result.items)
    assert all(item.employee_name_en == "ALPHA EMPLOYEE" for item in result.items)
    assert [item.target_id for item in result.items] == [71, 22, 33, 44]
    assert [item.title for item in result.items] == [
        "Employment Certificate", "Annual", "Late arrival", "Test correspondence"
    ]
    assert [item.reference for item in result.items] == ["HR-0071", "#22", "#33", "#44"]
```

Add independent tests with explicit fixtures and assertions. Do not share rows between tests:

- `test_equal_timestamps_use_kind_then_source_id_tiebreak`: persist Documents 11 and 12, Leave 22, Violation 33, and LedgerEntry 44 for G100. Give every row `created_at=BASE` and give both Documents distinct live Books. Assert:

```python
assert [(x.kind, x.source_id) for x in result.items] == [
    ("document", 12),
    ("document", 11),
    ("leave", 22),
    ("ledger", 44),
    ("violation", 33),
]
```

- `test_employee_and_kind_filters_apply_to_rows_and_total`: seed G100 and G200 with at least one row from two source types each. Call once with `employee_id="G200"` and once with `kind="document"`. Assert:

```python
assert {item.employee_id for item in by_employee.items} == {"G200"}
assert by_employee.total == len(by_employee.items)
assert documents.items
assert {item.kind for item in documents.items} == {"document"}
assert documents.total == len(documents.items)
```

- `test_global_offset_is_correct_when_one_source_dominates`: seed five Documents at minutes 10–6 and one older row from each other source. Request `(limit=2, offset=0)`, `(limit=2, offset=2)`, and `(limit=2, offset=4)`. Assert no `(kind, source_id)` overlaps and concatenating the three pages equals the first six rows from a single `(limit=100, offset=0)` request.

- `test_excludes_deleted_drafts_orphans_and_unrelated_rows`: seed live Employee G100 plus Leave 80 with `deleted_at=BASE`, Document 81 with `ref_number="DRAFT"`, Document 82 with a non-draft ref that has no Book, LedgerEntry 83 with `deleted_at=BASE`, LedgerEntry 84 whose `tags` contain the project's draft tag, and LedgerEntry 85 with no `related_employee_id`. Assert:

```python
assert {(x.kind, x.source_id) for x in result.items}.isdisjoint({
    ("leave", 80),
    ("document", 81),
    ("document", 82),
    ("ledger", 83),
    ("ledger", 84),
    ("ledger", 85),
})
assert result.total == 0
```

- `test_private_email_rows_and_total_are_owner_scoped`: seed related email LedgerEntry 90 owned by user 7, related email LedgerEntry 91 owned by user 8, and related non-email LedgerEntry 92 owned by user 8. Give them descending timestamps in the order 92, 91, 90. Assert:

```python
assert [x.source_id for x in result.items] == [92, 90]
assert result.total == 2
```

Every fixture row must supply all non-null ORM fields using the model definitions in `backend/app/db/models.py`; use the local `db_session` only and commit before calling the service.

- [ ] **Step 2: Run service tests and confirm RED**

Run:

```powershell
C:\Users\Admin\sentinel\venv\Scripts\python.exe -m pytest backend/tests/test_employee_activity_service.py -q
```

Expected: collection failure because `employee_activity_service` and its schemas do not exist.

- [ ] **Step 3: Add the Pydantic response contract**

Create `backend/app/schemas/employee_activity.py`:

```python
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel

EmployeeActivityKind = Literal["document", "leave", "violation", "ledger"]


class EmployeeActivityItemRead(BaseModel):
    kind: EmployeeActivityKind
    source_id: int
    target_id: int
    occurred_at: datetime
    employee_id: str
    employee_name_en: str
    employee_name_ar: str | None = None
    title: str
    detail: str | None = None
    status: str | None = None
    days: int | None = None
    direction: str | None = None
    channel: str | None = None
    reference: str


class EmployeeActivityListRead(BaseModel):
    items: list[EmployeeActivityItemRead]
    total: int
    limit: int
    offset: int
```

Do not add these names to `schemas/__init__.py`; the employees API imports the focused schema module directly, matching `employee_detail`.

- [ ] **Step 4: Implement the fixed-query-count activity service**

Create `backend/app/services/employee_activity_service.py` with this public interface:

```python
from __future__ import annotations

from datetime import datetime
from itertools import chain

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.db.models import Book, Document, Employee, Leave, LedgerEntry, Violation
from app.schemas.employee_activity import (
    EmployeeActivityItemRead,
    EmployeeActivityKind,
    EmployeeActivityListRead,
)
from app.services import ledger_service

DEFAULT_LIMIT = 25
MAX_LIMIT = 100


def _sort_key(item: EmployeeActivityItemRead) -> tuple[float, str, int]:
    return (-item.occurred_at.timestamp(), item.kind, -item.source_id)


def list_employee_activity(
    db: Session,
    *,
    owner_user_id: int,
    employee_id: str | None = None,
    kind: EmployeeActivityKind | None = None,
    limit: int = DEFAULT_LIMIT,
    offset: int = 0,
) -> EmployeeActivityListRead:
    requested = offset + limit
    sources: list[tuple[list[EmployeeActivityItemRead], int]] = []
    if kind in (None, "document"):
        sources.append(_documents(db, employee_id=employee_id, requested=requested))
    if kind in (None, "leave"):
        sources.append(_leaves(db, employee_id=employee_id, requested=requested))
    if kind in (None, "violation"):
        sources.append(_violations(db, employee_id=employee_id, requested=requested))
    if kind in (None, "ledger"):
        sources.append(
            _ledger(
                db,
                owner_user_id=owner_user_id,
                employee_id=employee_id,
                requested=requested,
            )
        )
    merged = sorted(chain.from_iterable(rows for rows, _ in sources), key=_sort_key)
    return EmployeeActivityListRead(
        items=merged[offset : offset + limit],
        total=sum(total for _, total in sources),
        limit=limit,
        offset=offset,
    )
```

Implement `_documents`, `_leaves`, `_violations`, and `_ledger` as one query per included source—four queries at most. Every query must:

- select the source fields plus `Employee.id/name_en/name_ar` and `func.count().over().label("source_total")`;
- inner-join the source's employee FK to `Employee.id`;
- apply `employee_id` when non-null before the window count;
- order by `created_at DESC, id DESC`;
- limit to `requested`;
- return mapped `EmployeeActivityItemRead` rows plus `int(result_rows[0].source_total)`; return total 0 when no rows;
- map source content directly, without precomposed English action text.

The window count observes all filtered rows before `LIMIT`, so it supplies an exact source total without a separate count query. Do not regress this to N+1 lookups or a duplicated row/count predicate.

Map fields exactly:

| Source | `source_id` | `target_id` | `occurred_at` | `title` | Optional fields | `reference` |
|---|---:|---:|---|---|---|---|
| Document | `Document.id` | correlated live `Book.id` | `Document.created_at` | `Document.template_id` | all null | `Document.ref_number` |
| Leave | `Leave.id` | `Leave.id` | `Leave.created_at` | `Leave.leave_type` | `status`, `days` | `#<leave.id>` |
| Violation | `Violation.id` | `Violation.id` | `Violation.created_at` | `Violation.violation_type` | `detail=description`, `status=Violation.status` | `#<violation.id>` |
| Ledger | `LedgerEntry.id` | `LedgerEntry.id` | `LedgerEntry.created_at` | `LedgerEntry.subject` | `detail=counterparty`, `direction`, `channel` | `#<ledger_entry.id>` |

Every item receives `employee_id`, `employee_name_en`, and `employee_name_ar` from the joined Employee.

For document target identity, use one live Book per reference without duplicating Document rows:

```python
book_id = (
    select(Book.id)
    .where(Book.ref_number == Document.ref_number, Book.deleted_at.is_(None))
    .order_by(Book.id.desc())
    .limit(1)
    .correlate(Document)
    .scalar_subquery()
)
```

Select `book_id.label("target_id")` and require `book_id.is_not(None)`. Exclude `Document.ref_number == "DRAFT"` and null employee IDs before the window count.

Apply `Leave.deleted_at.is_(None)` before the leave window count. Violations have no deletion column and need no synthetic deletion rule.

For ledger visibility, apply these predicates before the window count and pagination:

```python
LedgerEntry.related_employee_id.is_not(None),
LedgerEntry.deleted_at.is_(None),
ledger_service._tags_contain(ledger_service.DRAFT_TAG, negate=True),
or_(
    LedgerEntry.channel != "email",
    LedgerEntry.owner_user_id == owner_user_id,
),
```

Reuse `ledger_service._tags_contain` deliberately: it emits the project's exact SQLite `json_each` membership predicate and avoids a second, substring-based draft convention. Keep the import at module level and do not duplicate the helper.

- [ ] **Step 5: Run service tests and confirm GREEN**

Run:

```powershell
C:\Users\Admin\sentinel\venv\Scripts\python.exe -m pytest backend/tests/test_employee_activity_service.py -q
```

Expected: all new service tests pass.

- [ ] **Step 6: Write failing API tests for route precedence, validation, and capability**

Create `backend/tests/test_employee_activity_api.py` using the same temp-file SQLite/TestClient pattern as `test_employees_completeness_api.py`. Add a manager client with `employees.view`, an operator client without it, and one seeded navigable document.

```python
def test_activity_static_route_wins_over_employee_id_route(manager_client):
    response = manager_client.get("/api/v1/employees/activity")
    assert response.status_code == 200
    assert set(response.json()) == {"items", "total", "limit", "offset"}


def test_activity_route_forwards_filters_and_page(manager_client):
    response = manager_client.get(
        "/api/v1/employees/activity",
        params={"employee_id": "G100", "kind": "document", "limit": 1, "offset": 0},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["limit"] == 1
    assert body["offset"] == 0
    assert body["items"][0]["employee_id"] == "G100"
    assert body["items"][0]["kind"] == "document"


def test_activity_route_validates_kind_and_limit(manager_client):
    assert manager_client.get("/api/v1/employees/activity?kind=profile").status_code == 422
    assert manager_client.get("/api/v1/employees/activity?limit=101").status_code == 422


def test_activity_route_requires_employees_view(operator_client):
    assert operator_client.get("/api/v1/employees/activity").status_code == 403
```

- [ ] **Step 7: Run API tests and confirm RED**

Run:

```powershell
C:\Users\Admin\sentinel\venv\Scripts\python.exe -m pytest backend/tests/test_employee_activity_api.py -q
```

Expected: 404/route-shape failures because the static route is absent.

- [ ] **Step 8: Add the static FastAPI route before `/{employee_id}`**

In `backend/app/api/v1/employees.py`:

```python
from app.schemas import employee_activity as activity_schemas
from app.services import employee_activity_service
```

Insert this route after `/completeness` and before `@router.get("/{employee_id}")`:

```python
@router.get("/activity", response_model=activity_schemas.EmployeeActivityListRead)
def list_employee_activity(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_capability("employees.view"))],
    employee_id: str | None = None,
    kind: activity_schemas.EmployeeActivityKind | None = None,
    limit: int = Query(employee_activity_service.DEFAULT_LIMIT, ge=1, le=employee_activity_service.MAX_LIMIT),
    offset: int = Query(0, ge=0),
) -> activity_schemas.EmployeeActivityListRead:
    return employee_activity_service.list_employee_activity(
        db,
        owner_user_id=current_user.id,
        employee_id=employee_id,
        kind=kind,
        limit=limit,
        offset=offset,
    )
```

- [ ] **Step 9: Run backend activity tests and static checks**

Run:

```powershell
C:\Users\Admin\sentinel\venv\Scripts\python.exe -m pytest backend/tests/test_employee_activity_service.py backend/tests/test_employee_activity_api.py -q
C:\Users\Admin\sentinel\venv\Scripts\ruff.exe check backend/app/schemas/employee_activity.py backend/app/services/employee_activity_service.py backend/app/api/v1/employees.py backend/tests/test_employee_activity_service.py backend/tests/test_employee_activity_api.py
```

Expected: all tests pass; Ruff reports no errors.

- [ ] **Step 10: Commit the backend contract**

```powershell
git add backend/app/schemas/employee_activity.py backend/app/services/employee_activity_service.py backend/app/api/v1/employees.py backend/tests/test_employee_activity_service.py backend/tests/test_employee_activity_api.py
git commit -m "feat(employees): add recent activity API"
```

---

### Task 2: Synchronize the API Contract and Add the Typed Client

**Files:**
- Regenerate: `backend/openapi.json`
- Regenerate: `frontend/src/lib/api.types.ts`
- Modify: `frontend/src/lib/api.ts:120-150,896-930`
- Create: `frontend/src/lib/api.employeeActivity.test.ts`

**Interfaces:**
- Consumes: `GET /api/v1/employees/activity` and Pydantic types from Task 1.
- Produces: `EmployeeActivityKind`, `EmployeeActivityItemRead`, `EmployeeActivityListRead` aliases.
- Produces: `ListEmployeeActivityParams` and `api.listEmployeeActivity(params)` for Tasks 4 and 5.

- [ ] **Step 1: Write the failing API client test**

Create `frontend/src/lib/api.employeeActivity.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

import { api } from '@/lib/api'

describe('api.listEmployeeActivity', () => {
  it('forwards employee, kind, limit, and offset filters', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ items: [], total: 0, limit: 25, offset: 25 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const result = await api.listEmployeeActivity({
      employee_id: 'G 100',
      kind: 'leave',
      limit: 25,
      offset: 25,
    })

    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toContain('/employees/activity?')
    expect(url).toContain('employee_id=G+100')
    expect(url).toContain('kind=leave')
    expect(url).toContain('limit=25')
    expect(url).toContain('offset=25')
    expect(result.total).toBe(0)
  })
})
```

- [ ] **Step 2: Run the client test and confirm RED**

Run:

```powershell
pnpm -C frontend exec vitest run src/lib/api.employeeActivity.test.ts
```

Expected: TypeScript/runtime failure because `api.listEmployeeActivity` does not exist.

- [ ] **Step 3: Invoke `sync-api-types` and regenerate both artifacts**

Read and follow `skill://sync-api-types`. From the worktree root run:

```powershell
C:\Users\Admin\sentinel\venv\Scripts\python.exe -X utf8 scripts\dump_openapi.py
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "cd frontend; pnpm run gen:api"
```

Expected: `/api/v1/employees/activity`, `EmployeeActivityItemRead`, and `EmployeeActivityListRead` appear in generated output. Do not hand-edit `api.types.ts`.

- [ ] **Step 4: Export generated aliases and add the API method**

Near the existing employee detail aliases in `frontend/src/lib/api.ts` add:

```typescript
export type EmployeeActivityItemRead = components['schemas']['EmployeeActivityItemRead']
export type EmployeeActivityListRead = components['schemas']['EmployeeActivityListRead']
export type EmployeeActivityKind = EmployeeActivityItemRead['kind']
```

Near `ListEmployeesParams` add:

```typescript
export interface ListEmployeeActivityParams {
  employee_id?: string
  kind?: EmployeeActivityKind
  limit?: number
  offset?: number
}
```

In the employee API section add:

```typescript
listEmployeeActivity: (params: ListEmployeeActivityParams = {}) =>
  request<EmployeeActivityListRead>('GET', `/employees/activity${qs({ ...params })}`),
```

- [ ] **Step 5: Run the API client test and typecheck**

Run sequentially:

```powershell
pnpm -C frontend exec vitest run src/lib/api.employeeActivity.test.ts
pnpm -C frontend exec tsc -b --noEmit
```

Expected: test passes and TypeScript reports no errors.

- [ ] **Step 6: Commit generated artifacts and wrapper together**

```powershell
git add backend/openapi.json frontend/src/lib/api.types.ts frontend/src/lib/api.ts frontend/src/lib/api.employeeActivity.test.ts
git commit -m "feat(frontend): add typed employee activity client"
```

---

### Task 3: Add Exact Violation Deep-Link Hydration

**Files:**
- Modify: `frontend/src/pages/employees/EmployeeDetailPage.tsx:38-50,238-278`
- Modify: `frontend/src/pages/employees/tabs/ViolationsTab.tsx`
- Modify: `frontend/src/components/employees/ViolationsTable.tsx:37-55,98-160`
- Modify: `frontend/src/pages/employees/EmployeeDetailPage.test.tsx`
- Create: `frontend/src/pages/employees/tabs/ViolationsTab.test.tsx`

**Interfaces:**
- Produces: `/employees/:employeeId?tab=violations&open=:violationId` exact targeting for Task 5.
- Produces: `ViolationsTab` props `openId?: number | null` and `onOpenConsumed?: () => void`.
- Produces: `ViolationsTable` prop `highlightedId?: number | null` and `data-violation-row-id` on real rows.

- [ ] **Step 1: Add failing Employee Detail URL hydration test**

Change the `ViolationsTab` mock in `EmployeeDetailPage.test.tsx` to expose props:

```typescript
vi.mock('./tabs/ViolationsTab', () => ({
  ViolationsTab: ({ openId, onOpenConsumed }: { openId?: number | null; onOpenConsumed?: () => void }) => (
    <button data-testid="violations-tab" data-open-id={openId ?? ''} onClick={onOpenConsumed}>
      violation-target
    </button>
  ),
}))
```

Allow `renderPage(initialEntry = '/employees/G100')`, then add:

```typescript
test('violation deep link activates the tab and forwards the exact row id', async () => {
  vi.mocked(api.getEmployeeDetail).mockResolvedValue(detail as never)
  renderPage('/employees/G100?tab=violations&open=42')
  expect(await screen.findByTestId('tab-chips')).toHaveAttribute('data-active', 'violations')
  expect(screen.getByTestId('violations-tab')).toHaveAttribute('data-open-id', '42')
})
```

- [ ] **Step 2: Add failing tab tests for manage and read-only targeting**

Create `ViolationsTab.test.tsx`. Mock `useCapabilities` once with `has` configurable, make `api.listViolations` resolve the full fictional rows with IDs 41 and 42 by default, and spy on `Element.prototype.scrollIntoView`.

Required contracts:

```typescript
it.each([false, true])('scrolls to and consumes exact violation in manage=%s mode', async (canManage) => {
  capability = canManage
  wrap(
    <ViolationsTab
      employeeId="G100"
      violations={snapshotRows}
      openId={42}
      onOpenConsumed={onConsumed}
    />,
  )
  const row = await screen.findByTestId('violation-row-42')
  await waitFor(() => expect(row.scrollIntoView).toHaveBeenCalled())
  expect(row).toHaveAttribute('data-highlighted', 'true')
  expect(onConsumed).toHaveBeenCalledOnce()
})

it('fetches the full list when a read-only target is absent from the detail snapshot', async () => {
  capability = false
  const onConsumed = vi.fn()
  wrap(
    <ViolationsTab
      employeeId="G100"
      violations={[snapshotRows[0]]}
      openId={42}
      onOpenConsumed={onConsumed}
    />,
  )
  expect(await screen.findByTestId('violation-row-42')).toHaveAttribute('data-highlighted', 'true')
  expect(api.listViolations).toHaveBeenCalledWith('G100')
  expect(onConsumed).toHaveBeenCalledOnce()
})

it('consumes a missing id only after rows are ready without targeting another row', async () => {
  const onConsumed = vi.fn()
  wrap(
    <ViolationsTab
      employeeId="G100"
      violations={snapshotRows}
      openId={999}
      onOpenConsumed={onConsumed}
    />,
  )
  await screen.findByTestId('violation-row-42')
  await waitFor(() => expect(onConsumed).toHaveBeenCalledOnce())
  expect(screen.getByTestId('violation-row-41')).toHaveAttribute('data-highlighted', 'false')
  expect(screen.getByTestId('violation-row-42')).toHaveAttribute('data-highlighted', 'false')
})
```

Use a local immediate `requestAnimationFrame` stub so the test is deterministic, and restore it after each test.

- [ ] **Step 3: Run deep-link tests and confirm RED**

```powershell
pnpm -C frontend exec vitest run src/pages/employees/EmployeeDetailPage.test.tsx src/pages/employees/tabs/ViolationsTab.test.tsx
```

Expected: the detail page stays on Profile and violation components do not accept targeting props.

- [ ] **Step 4: Hydrate and consume query state in Employee Detail**

Import `useSearchParams`. Add a tab parser that rejects unknown values:

```typescript
const VALID_TABS = new Set<Tab>([
  'profile', 'documents', 'leaves', 'messages', 'activity', 'violations',
])

function tabFromSearch(params: URLSearchParams): Tab {
  const value = params.get('tab')
  return value && VALID_TABS.has(value as Tab) ? (value as Tab) : 'profile'
}
```

Inside `EmployeeDetailPage`, make the URL—not a second state variable—the tab source of truth:

```typescript
const [searchParams, setSearchParams] = useSearchParams()
const tab = tabFromSearch(searchParams)
const rawOpenId = searchParams.get('open')
const parsedOpenId = rawOpenId && /^\d+$/.test(rawOpenId) ? Number(rawOpenId) : null
const violationOpenId =
  tab === 'violations' && Number.isSafeInteger(parsedOpenId) && (parsedOpenId ?? 0) > 0
    ? parsedOpenId
    : null

const handleTabChange = useCallback((nextTab: Tab) => {
  setSearchParams((previous) => {
    const next = new URLSearchParams(previous)
    if (nextTab === 'profile') next.delete('tab')
    else next.set('tab', nextTab)
    next.delete('open')
    return next
  })
}, [setSearchParams])

const consumeViolationOpen = useCallback(() => {
  setSearchParams((previous) => {
    const next = new URLSearchParams(previous)
    next.set('tab', 'violations')
    next.delete('open')
    return next
  }, { replace: true })
}, [setSearchParams])
```

Wire `handleTabChange` to the existing `EmployeeTabChips` callback. Pass `openId={violationOpenId}` and `onOpenConsumed={consumeViolationOpen}` to `ViolationsTab`. URL-backed tab state makes direct entry, refresh, Back, and Forward resolve identically.

- [ ] **Step 5: Implement exact row targeting inside ViolationsTab**


Extend `Props` and add one internal hook. Keep highlight expiry separate from URL consumption so clearing `open` cannot cancel the visual timeout:

```typescript
function useViolationTarget({
  openId,
  rowIds,
  ready,
  onConsumed,
}: {
  openId?: number | null
  rowIds: readonly number[]
  ready: boolean
  onConsumed?: () => void
}): number | null {
  const [highlightedId, setHighlightedId] = useState<number | null>(null)
  const lastHandled = useRef<number | null>(null)

  useEffect(() => {
    if (openId == null) {
      lastHandled.current = null
      return
    }
    if (!ready || lastHandled.current === openId) return
    lastHandled.current = openId
    const found = rowIds.includes(openId)
    const frame = requestAnimationFrame(() => {
      if (found) {
        setHighlightedId(openId)
        document
          .querySelector<HTMLElement>(`[data-violation-row-id="${openId}"]`)
          ?.scrollIntoView({ block: 'center' })
      }
      onConsumed?.()
    })
    return () => cancelAnimationFrame(frame)
  }, [openId, onConsumed, ready, rowIds])

  useEffect(() => {
    if (highlightedId == null) return
    const timer = window.setTimeout(() => setHighlightedId(null), 1800)
    return () => window.clearTimeout(timer)
  }, [highlightedId])

  return highlightedId
}
```

Lift the existing full-list query from `ViolationsManage` into `ViolationsTab` so both presentation modes can resolve a deep link:

```typescript
const canManage = has('violations.manage')
const shouldLoadFull = canManage || openId != null
const fullQuery = useQuery({
  queryKey: ['violations', employeeId],
  queryFn: () => api.listViolations(employeeId),
  enabled: shouldLoadFull,
})
const rows = fullQuery.data ?? violations
const targetReady =
  !shouldLoadFull ||
  fullQuery.data !== undefined ||
  (!fullQuery.isPending && !fullQuery.isError)
const rowIds = useMemo(() => rows.map((row) => row.id), [rows])
const highlightedId = useViolationTarget({
  openId,
  rowIds,
  ready: targetReady,
  onConsumed: onOpenConsumed,
})
```

Refactor `ViolationsManage` to receive `rows` and `highlightedId` instead of owning the query; its mutations still invalidate `['violations', employeeId]`. Pass the same resolved `rows` and `highlightedId` to `ViolationsReadOnly`. If `shouldLoadFull` fails with no cached data, render the existing API error/retry treatment, retain the `open` URL, and do not call `onOpenConsumed`. This preserves destination capability failures instead of silently targeting a different snapshot row.

In read-only rows and `ViolationsTable` rows add:

```tsx
data-testid={`violation-row-${row.id}`}
data-violation-row-id={row.id}
data-highlighted={highlightedId === row.id ? 'true' : 'false'}
className={cn(
  existingClasses,
  highlightedId === row.id && 'bg-primary-soft ring-1 ring-inset ring-primary/30',
)}
```

Import and reuse the existing `cn` helper. Highlighting must not enter edit mode.

- [ ] **Step 6: Run violation tests and relevant TypeScript checks**

```powershell
pnpm -C frontend exec vitest run src/pages/employees/EmployeeDetailPage.test.tsx src/pages/employees/tabs/ViolationsTab.test.tsx
pnpm -C frontend exec tsc -b --noEmit
```

Expected: tests pass and TypeScript reports no errors.

- [ ] **Step 7: Commit exact violation navigation**

```powershell
git add frontend/src/pages/employees/EmployeeDetailPage.tsx frontend/src/pages/employees/tabs/ViolationsTab.tsx frontend/src/components/employees/ViolationsTable.tsx frontend/src/pages/employees/EmployeeDetailPage.test.tsx frontend/src/pages/employees/tabs/ViolationsTab.test.tsx
git commit -m "feat(employees): deep-link exact violations"
```

---

### Task 4: Build the Name/G-Number Activity Lookup

**Files:**
- Create: `frontend/src/components/employees/EmployeeActivityLookup.tsx`
- Create: `frontend/src/components/employees/EmployeeActivityLookup.test.tsx`

**Interfaces:**
- Consumes: `api.listEmployees({ q, limit: 8 })`, `pickEmployeeName`, and `pickPosition`.
- Produces: `EmployeeActivityLookup({ selected, onSelect, onClear, onOpenProfile })` for Task 5.
- Produces: an accessible popup where Show activity and Open profile are sibling controls.

- [ ] **Step 1: Write failing lookup interaction tests**

Create `EmployeeActivityLookup.test.tsx` with a QueryClient wrapper and mocked `api.listEmployees`. Cover both languages through returned data, not source-text assertions.

```typescript
const abdulla = {
  id: 'G3190',
  name_en: 'ABDULLA ALABRI',
  name_ar: 'عبدالله العبري',
  status: 'Active',
  position: 'Officer',
  position_ar: 'ضابط',
  has_photo: false,
}

it.each(['Abdulla', 'G3190'])('finds an employee by %s and filters activity', async (query) => {
  const onSelect = vi.fn()
  wrap(<EmployeeActivityLookup selected={null} onSelect={onSelect} onClear={() => {}} onOpenProfile={() => {}} />)
  await userEvent.type(screen.getByRole('searchbox'), query)
  const show = await screen.findByRole('button', { name: /show activity/i })
  await userEvent.click(show)
  expect(api.listEmployees).toHaveBeenCalledWith({ q: query, limit: 8 })
  expect(onSelect).toHaveBeenCalledWith(abdulla)
})

it('keeps profile navigation separate from feed selection', async () => {
  const onSelect = vi.fn()
  const onOpenProfile = vi.fn()
  wrap(
    <EmployeeActivityLookup
      selected={null}
      onSelect={onSelect}
      onClear={() => {}}
      onOpenProfile={onOpenProfile}
    />,
  )
  await userEvent.type(screen.getByRole('searchbox'), 'Abdulla')
  await userEvent.click(await screen.findByRole('button', { name: /open profile/i }))
  expect(onOpenProfile).toHaveBeenCalledWith('G3190')
  expect(onSelect).not.toHaveBeenCalled()
})

it('clears a selected employee back to all activity', async () => {
  const onClear = vi.fn()
  wrap(<EmployeeActivityLookup selected={abdulla} onSelect={() => {}} onClear={onClear} onOpenProfile={() => {}} />)
  await userEvent.click(screen.getByRole('button', { name: /clear employee filter/i }))
  expect(onClear).toHaveBeenCalledOnce()
})

it('supports keyboard entry and Escape without nested interactive options', async () => {
  wrap(
    <EmployeeActivityLookup
      selected={null}
      onSelect={() => {}}
      onClear={() => {}}
      onOpenProfile={() => {}}
    />,
  )
  const input = screen.getByRole('searchbox')
  await userEvent.type(input, 'Abdulla')
  const show = await screen.findByRole('button', { name: /show activity/i })
  await userEvent.keyboard('{ArrowDown}')
  expect(show).toHaveFocus()
  await userEvent.keyboard('{Escape}')
  expect(screen.queryByRole('list')).not.toBeInTheDocument()
  expect(input).toHaveFocus()
})
```

- [ ] **Step 2: Run lookup tests and confirm RED**

```powershell
pnpm -C frontend exec vitest run src/components/employees/EmployeeActivityLookup.test.tsx
```

Expected: module-not-found failure.

- [ ] **Step 3: Implement the minimal lookup component**

Use the existing `useDebouncedValue(query, 250)` and this prop contract:

```typescript
interface Props {
  selected: EmployeeListItem | null
  onSelect: (employee: EmployeeListItem) => void
  onClear: () => void
  onOpenProfile: (employeeId: string) => void
}
```

Required query behavior:

```typescript
const [query, setQuery] = useState('')
const debounced = useDebouncedValue(query, 250).trim()
const results = useQuery({
  queryKey: ['employee-activity-lookup', debounced],
  queryFn: () => api.listEmployees({ q: debounced, limit: 8 }),
  enabled: selected == null && debounced.length > 0,
  staleTime: 30_000,
})
```

Markup rules:

- input `type="search"`, translated label/placeholder, and `aria-expanded`;
- popup `role="list"`, each employee `<li>` with two sibling buttons;
- Show activity calls `onSelect(employee)`, clears query, closes popup;
- Open profile calls `onOpenProfile(employee.id)` only;
- ArrowDown from input focuses the first Show activity button;
- ArrowUp/ArrowDown move among Show activity buttons;
- Escape closes results and returns focus to the input;
- selected state shows localized name/G-number plus Open profile and Clear controls;
- all stored names/positions use `dir="auto"` where appropriate;
- no new autocomplete abstraction or dependency.

- [ ] **Step 4: Run lookup tests and confirm GREEN**

```powershell
pnpm -C frontend exec vitest run src/components/employees/EmployeeActivityLookup.test.tsx
```

Expected: all lookup tests pass.

- [ ] **Step 5: Commit the activity lookup**

```powershell
git add frontend/src/components/employees/EmployeeActivityLookup.tsx frontend/src/components/employees/EmployeeActivityLookup.test.tsx
git commit -m "feat(employees): add activity employee lookup"
```

---

### Task 5: Build and Integrate the Full-Width Activity Feed

**Files:**
- Create: `frontend/src/components/employees/EmployeeActivitySection.tsx`
- Create: `frontend/src/components/employees/EmployeeActivitySection.test.tsx`
- Modify: `frontend/src/pages/employees/EmployeeLookupPage.tsx:21-24,122-159`
- Modify: `frontend/src/pages/employees/EmployeeLookupPage.test.tsx`
- Modify: `frontend/src/locales/en.json:308-332`
- Modify: `frontend/src/locales/ar.json:329-353`

**Interfaces:**
- Consumes: typed activity client from Task 2.
- Consumes: exact violation route from Task 3.
- Consumes: `EmployeeActivityLookup` from Task 4.
- Produces: `EmployeeActivitySection({ onOpenProfile })` and exact route helper `activityHref(item)`.
- Produces: complete `employees.activity.*` English/Arabic copy.

- [ ] **Step 1: Write failing feed tests for initial data, filters, pagination, and exact links**

Create `EmployeeActivitySection.test.tsx`. Mock `EmployeeActivityLookup` as three buttons named `mock-select-G3190`, `mock-clear-employee`, and `mock-open-profile-G3190`; the first passes the `abdulla` fixture to `onSelect`, the second calls `onClear`, and the third calls `onOpenProfile('G3190')`. Mock `api.listEmployeeActivity` by offset.

Use these four representative items:

```typescript
import type { EmployeeActivityItemRead } from '@/lib/api'

const items: EmployeeActivityItemRead[] = [
  { kind: 'document', source_id: 11, target_id: 71, employee_id: 'G100', title: 'Employment Certificate' },
  { kind: 'leave', source_id: 22, target_id: 22, employee_id: 'G200', title: 'Annual' },
  { kind: 'violation', source_id: 33, target_id: 33, employee_id: 'G300', title: 'Late arrival' },
  { kind: 'ledger', source_id: 44, target_id: 44, employee_id: 'G400', title: 'Incoming letter' },
].map((item, index) => ({
  ...item,
  occurred_at: `2026-08-10T09:0${4 - index}:00`,
  employee_name_en: `EMPLOYEE ${index}`,
  employee_name_ar: null,
  detail: null,
  status: null,
  days: null,
  direction: null,
  channel: null,
  reference: `#${item.source_id}`,
}))
```

Required assertions:

```typescript
it('loads all activity by default and renders exact source links', async () => {
  wrap(<EmployeeActivitySection onOpenProfile={() => {}} />)
  await screen.findByText('Employment Certificate')
  expect(api.listEmployeeActivity).toHaveBeenCalledWith({ limit: 25, offset: 0 })
  expect(screen.getByRole('link', { name: /open document/i })).toHaveAttribute('href', '/books?open=71')
  expect(screen.getByRole('link', { name: /open leave/i })).toHaveAttribute('href', '/leaves?open=22')
  expect(screen.getByRole('link', { name: /open violation/i })).toHaveAttribute('href', '/employees/G300?tab=violations&open=33')
  expect(screen.getByRole('link', { name: /open correspondence/i })).toHaveAttribute('href', '/ledger?open=44')
})

it('resets to the first page when employee or type changes', async () => {
  vi.mocked(api.listEmployeeActivity).mockResolvedValue({
    items,
    total: items.length,
    limit: 25,
    offset: 0,
  })
  wrap(<EmployeeActivitySection onOpenProfile={() => {}} />)
  await screen.findByText('Employment Certificate')
  await userEvent.click(screen.getByRole('button', { name: 'mock-select-G3190' }))
  await userEvent.selectOptions(screen.getByRole('combobox', { name: /activity type/i }), 'leave')
  await waitFor(() => {
    expect(api.listEmployeeActivity).toHaveBeenLastCalledWith({
      employee_id: 'G3190',
      kind: 'leave',
      limit: 25,
      offset: 0,
    })
  })
})

it('clearing the employee restores all-employee activity', async () => {
  vi.mocked(api.listEmployeeActivity).mockResolvedValue({
    items,
    total: items.length,
    limit: 25,
    offset: 0,
  })
  wrap(<EmployeeActivitySection onOpenProfile={() => {}} />)
  await screen.findByText('Employment Certificate')
  await userEvent.click(screen.getByRole('button', { name: 'mock-select-G3190' }))
  await waitFor(() =>
    expect(api.listEmployeeActivity).toHaveBeenLastCalledWith({
      employee_id: 'G3190',
      limit: 25,
      offset: 0,
    }),
  )
  await userEvent.click(screen.getByRole('button', { name: 'mock-clear-employee' }))
  await waitFor(() =>
    expect(api.listEmployeeActivity).toHaveBeenLastCalledWith({ limit: 25, offset: 0 }),
  )
})

it('appends the next 25 and hides Load more at total', async () => {
  const pageOne = Array.from({ length: 25 }, (_, index) => ({
    ...items[0],
    source_id: index + 1,
    target_id: index + 1,
    title: `Document ${index + 1}`,
  }))
  const finalItem = { ...items[0], source_id: 26, target_id: 26, title: 'Document 26' }
  vi.mocked(api.listEmployeeActivity).mockImplementation(({ offset = 0 }) =>
    Promise.resolve({
      items: offset === 0 ? pageOne : [finalItem],
      total: 26,
      limit: 25,
      offset,
    }),
  )
  wrap(<EmployeeActivitySection onOpenProfile={() => {}} />)
  await screen.findByText('Document 1')
  await userEvent.click(screen.getByRole('button', { name: /load more activity/i }))
  expect(await screen.findByText('Document 26')).toBeInTheDocument()
  expect(screen.getByText('Document 1')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /load more activity/i })).not.toBeInTheDocument()
})

it('renders a pending state without removing the section', () => {
  vi.mocked(api.listEmployeeActivity).mockReturnValue(new Promise(() => {}))
  wrap(<EmployeeActivitySection onOpenProfile={() => {}} />)
  expect(screen.getByRole('status', { name: /loading recent activity/i })).toBeInTheDocument()
})

it('distinguishes all-empty from filtered-empty', async () => {
  vi.mocked(api.listEmployeeActivity).mockResolvedValue({ items: [], total: 0, limit: 25, offset: 0 })
  wrap(<EmployeeActivitySection onOpenProfile={() => {}} />)
  expect(await screen.findByText(/no recent employee activity/i)).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'mock-select-G3190' }))
  expect(await screen.findByText(/no activity matches this employee/i)).toBeInTheDocument()
})

it('renders an error with a working retry action', async () => {
  vi.mocked(api.listEmployeeActivity)
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce({ items: [], total: 0, limit: 25, offset: 0 })
  wrap(<EmployeeActivitySection onOpenProfile={() => {}} />)
  await userEvent.click(await screen.findByRole('button', { name: /retry/i }))
  expect(await screen.findByText(/no recent employee activity/i)).toBeInTheDocument()
  expect(api.listEmployeeActivity).toHaveBeenCalledTimes(2)
})

it('profile navigation is only delegated by employee lookup', async () => {
  const onOpenProfile = vi.fn()
  vi.mocked(api.listEmployeeActivity).mockResolvedValue({
    items,
    total: items.length,
    limit: 25,
    offset: 0,
  })
  wrap(<EmployeeActivitySection onOpenProfile={onOpenProfile} />)
  await userEvent.click(screen.getByRole('button', { name: 'mock-open-profile-G3190' }))
  expect(onOpenProfile).toHaveBeenCalledOnce()
  await userEvent.click(await screen.findByRole('link', { name: /open document/i }))
  expect(onOpenProfile).toHaveBeenCalledOnce()
})
```

- [ ] **Step 2: Run feed tests and confirm RED**

```powershell
pnpm -C frontend exec vitest run src/components/employees/EmployeeActivitySection.test.tsx
```

Expected: module-not-found failure.

- [ ] **Step 3: Add complete peer English/Arabic copy**

Under `employees`, add an `activity` object in both locale files. Use these exact English meanings and reviewed Arabic peers:

```json
{
  "eyebrow": "Employee records",
  "title": "Recent activity",
  "subtitle": "Review recent record activity across all employees or find one employee.",
  "resultCount": "{{count}} recent entries",
  "lookupLabel": "Quick activity lookup",
  "lookupPlaceholder": "Search by employee name or G-number",
  "matches": "Matching employees",
  "showActivity": "Show activity",
  "openProfile": "Open profile",
  "clearEmployee": "Clear employee filter",
  "typeLabel": "Activity type",
  "all": "All activity",
  "document": "Documents",
  "leave": "Leave",
  "violation": "Violations",
  "ledger": "Correspondence",
  "employee": "Employee",
  "activity": "Activity",
  "type": "Type",
  "reference": "Reference",
  "dateTime": "Date and time",
  "destination": "Destination",
  "openDocument": "Open document",
  "openLeave": "Open leave",
  "openViolation": "Open violation",
  "openLedger": "Open correspondence",
  "loadMore": "Load more activity",
  "loading": "Loading recent activity",
  "showing": "Showing {{shown}} of {{total}} recent entries",
  "empty": "No recent employee activity.",
  "emptyFiltered": "No activity matches this employee and activity type.",
  "clearFilters": "Clear filters",
  "loadError": "Recent activity could not be loaded.",
  "lookupError": "Employees could not be searched.",
  "retry": "Retry",
  "actions": {
    "document": "Generated {{title}}",
    "leave": "{{title}} · {{days}} days",
    "violation": "Recorded {{title}}",
    "ledger": "{{title}}"
  }
}
```

Arabic values:

```json
{
  "eyebrow": "سجلات الموظفين",
  "title": "النشاط الأخير",
  "subtitle": "راجع أحدث أنشطة السجلات لجميع الموظفين أو ابحث عن موظف محدد.",
  "resultCount": "{{count}} من الأنشطة الأخيرة",
  "lookupLabel": "بحث سريع في النشاط",
  "lookupPlaceholder": "ابحث باسم الموظف أو الرقم الوظيفي",
  "matches": "الموظفون المطابقون",
  "showActivity": "عرض النشاط",
  "openProfile": "فتح الملف",
  "clearEmployee": "مسح تصفية الموظف",
  "typeLabel": "نوع النشاط",
  "all": "كل الأنشطة",
  "document": "المستندات",
  "leave": "الإجازات",
  "violation": "المخالفات",
  "ledger": "المراسلات",
  "employee": "الموظف",
  "activity": "النشاط",
  "type": "النوع",
  "reference": "المرجع",
  "dateTime": "التاريخ والوقت",
  "destination": "الوجهة",
  "openDocument": "فتح المستند",
  "openLeave": "فتح الإجازة",
  "openViolation": "فتح المخالفة",
  "openLedger": "فتح المراسلة",
  "loadMore": "تحميل المزيد من الأنشطة",
  "loading": "جارٍ تحميل النشاط الأخير",
  "showing": "عرض {{shown}} من أصل {{total}} من الأنشطة الأخيرة",
  "empty": "لا توجد أنشطة حديثة للموظفين.",
  "emptyFiltered": "لا توجد أنشطة مطابقة لهذا الموظف ونوع النشاط.",
  "clearFilters": "مسح عوامل التصفية",
  "loadError": "تعذر تحميل النشاط الأخير.",
  "lookupError": "تعذر البحث عن الموظفين.",
  "retry": "إعادة المحاولة",
  "actions": {
    "document": "تم إنشاء {{title}}",
    "leave": "{{title}} · {{days}} يومًا",
    "violation": "تم تسجيل {{title}}",
    "ledger": "{{title}}"
  }
}
```

Keep JSON valid and place the object beside `employees.lookup`, not in the separate employee-detail namespace.

- [ ] **Step 4: Implement activity URL and formatting helpers**

At the top of `EmployeeActivitySection.tsx` export the pure route helper for tests:

```typescript
export function activityHref(item: EmployeeActivityItemRead): string {
  switch (item.kind) {
    case 'document':
      return `/books?open=${item.target_id}`
    case 'leave':
      return `/leaves?open=${item.source_id}`
    case 'violation':
      return `/employees/${encodeURIComponent(item.employee_id)}?tab=violations&open=${item.source_id}`
    case 'ledger':
      return `/ledger?open=${item.source_id}`
  }
}
```

Create memoized `Intl.DateTimeFormat` instances per language for day grouping and date/time. Do not allocate a formatter per row. Use `dir="auto"` on `title` and `detail`; render references and G-numbers with `font-mono tabular-nums`.

- [ ] **Step 5: Implement the React Query infinite feed**

Use this state/query shape:

```typescript
const PAGE_SIZE = 25
const [employee, setEmployee] = useState<EmployeeListItem | null>(null)
const [kind, setKind] = useState<EmployeeActivityKind | 'all'>('all')

const activityQuery = useInfiniteQuery({
  queryKey: ['employee-activity', employee?.id ?? null, kind],
  initialPageParam: 0,
  queryFn: ({ pageParam }) =>
    api.listEmployeeActivity({
      ...(employee ? { employee_id: employee.id } : {}),
      ...(kind === 'all' ? {} : { kind }),
      limit: PAGE_SIZE,
      offset: pageParam,
    }),
  getNextPageParam: (lastPage, pages) => {
    const loaded = pages.reduce((count, page) => count + page.items.length, 0)
    return loaded < lastPage.total ? loaded : undefined
  },
  staleTime: 30_000,
})

const items = activityQuery.data?.pages.flatMap((page) => page.items) ?? []
const total = activityQuery.data?.pages[0]?.total ?? 0
```

Build the approved full-width section:

- no extra route or fourth hero card;
- header/result count;
- `EmployeeActivityLookup` and one labelled type selector;
- desktop table-like header/rows at `md+`;
- stacked record cards below `md`;
- whole row rendered as a React Router `Link` to `activityHref(item)`;
- explicit localized destination label;
- loading skeleton inside `role="status"` with `aria-label={t('employees.activity.loading')}`, all-empty, filtered-empty, retry, and Load more states;
- clear filters resets employee and kind to `all`;
- use token classes from `DESIGN.md`; no new color token, gradient, or dependency.

- [ ] **Step 6: Run feed tests and confirm GREEN**

```powershell
pnpm -C frontend exec vitest run src/components/employees/EmployeeActivitySection.test.tsx
```

Expected: all feed tests pass.

- [ ] **Step 7: Integrate the section below the hero**

In `EmployeeLookupPage.tsx`, render after `</EmployeeSearchHero>` and before the conditional create form:

```tsx
<EmployeeActivitySection
  onOpenProfile={(employeeId) =>
    navigate(`/employees/${encodeURIComponent(employeeId)}`)
  }
/>
```

This placement keeps the section visible whether or not the create form is open and keeps it in the same route scroll container.

In `EmployeeLookupPage.test.tsx`, mock `EmployeeActivitySection` with a marker and profile button. Add:

```typescript
it('renders full-width activity below the hero and opens profiles explicitly', async () => {
  setup()
  expect(screen.getByTestId('employee-activity')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'activity-open-G3190' }))
  expect(await screen.findByTestId('profile-stub')).toBeInTheDocument()
})
```

- [ ] **Step 8: Run integrated frontend tests and typecheck**

```powershell
pnpm -C frontend exec vitest run src/components/employees/EmployeeActivityLookup.test.tsx src/components/employees/EmployeeActivitySection.test.tsx src/pages/employees/EmployeeLookupPage.test.tsx src/pages/employees/EmployeeDetailPage.test.tsx src/pages/employees/tabs/ViolationsTab.test.tsx
pnpm -C frontend exec tsc -b --noEmit
```

Expected: all tests pass and TypeScript reports no errors.

- [ ] **Step 9: Commit the full activity section**

```powershell
git add frontend/src/components/employees/EmployeeActivitySection.tsx frontend/src/components/employees/EmployeeActivitySection.test.tsx frontend/src/pages/employees/EmployeeLookupPage.tsx frontend/src/pages/employees/EmployeeLookupPage.test.tsx frontend/src/locales/en.json frontend/src/locales/ar.json
git commit -m "feat(employees): add activity feed"
```

---

### Task 6: Fix the Hero Search Focus Stroke at Its Source

**Files:**
- Modify: `frontend/src/components/employees/EmployeeSearchHero.tsx:89-117`
- Modify: `frontend/src/index.css:374-378`
- Verify: `frontend/src/components/employees/EmployeeSearchHero.test.tsx`

**Interfaces:**
- Produces: `data-employee-hero-search-input` as the local CSS hook.
- Preserves: the global `:focus-visible` outline for every other control.
- Preserves: employee typing/results behavior already covered by `EmployeeSearchHero.test.tsx`.

- [ ] **Step 1: Reproduce the focus bug before editing**

Run the feature frontend/backend or the existing Employee page, focus the main white search input, and inspect computed styles in Chromium:

```javascript
const input = document.querySelector('[type="search"]')
const pill = input?.parentElement
({
  inputOutline: input && getComputedStyle(input).outline,
  pillShadow: pill && getComputedStyle(pill).boxShadow,
})
```

Expected before fix: the input reports a non-`none` outline from the global rule and the pill has no dedicated focus-within ring.

- [ ] **Step 2: Add a stable local hook and whole-pill ring**

In `EmployeeSearchHero.tsx` add the data attribute to the main hero input:

```tsx
<input
  data-employee-hero-search-input
  type="search"
  // existing props unchanged
/>
```

Add a focus-within treatment to the white pill without changing size:

```text
transition-shadow focus-within:ring-2 focus-within:ring-white/70 focus-within:ring-offset-2 focus-within:ring-offset-primary
```

Use the existing navy/white tokens; do not introduce a hard-coded black/blue outline.

- [ ] **Step 3: Override only this input in the unlayered stylesheet**

Immediately after the global focus rule in `frontend/src/index.css` add:

```css
/* The Employee hero exposes focus on its complete white search pill. */
[data-employee-hero-search-input]:focus-visible {
  outline: none;
}
```

Do not change the global rule and do not use `!important`.

- [ ] **Step 4: Run the existing behavior regression test**

```powershell
pnpm -C frontend exec vitest run src/components/employees/EmployeeSearchHero.test.tsx
```

Expected: typing, results, selection, and empty-state creation tests still pass.

- [ ] **Step 5: Confirm the visual bug is gone in Chromium**

Focus the same input and re-run the computed-style snippet.

Expected after fix:

- `getComputedStyle(input).outlineStyle === 'none'`;
- the pill's computed box shadow/ring is not `none` while focused;
- Tab focus is visible against navy in light and dark themes;
- typing does not create an inner dark rectangle;
- the pill does not move or resize.

- [ ] **Step 6: Commit the focus fix**

```powershell
git add frontend/src/components/employees/EmployeeSearchHero.tsx frontend/src/index.css
git commit -m "fix(employees): refine search focus ring"
```

---

### Task 7: Run Bilingual Review and End-to-End Verification

**Files:**
- Review/fix if needed: every frontend file changed in Tasks 3–6
- Review/fix if needed: `frontend/src/locales/en.json`, `frontend/src/locales/ar.json`
- No new permanent fixture or report file

**Interfaces:**
- Consumes: completed feature from Tasks 1–6.
- Produces: verified behavior, reviewer fixes, and a clean branch ready for code review/merge.

- [ ] **Step 1: Run all focused backend and frontend contracts**

Run sequentially to respect workstation memory:

```powershell
C:\Users\Admin\sentinel\venv\Scripts\python.exe -m pytest backend/tests/test_employee_activity_service.py backend/tests/test_employee_activity_api.py backend/tests/test_employee_detail_sms.py backend/tests/test_employees_completeness_api.py -q
pnpm -C frontend exec vitest run src/lib/api.employeeActivity.test.ts src/components/employees/EmployeeSearchHero.test.tsx src/components/employees/EmployeeActivityLookup.test.tsx src/components/employees/EmployeeActivitySection.test.tsx src/pages/employees/EmployeeLookupPage.test.tsx src/pages/employees/EmployeeDetailPage.test.tsx src/pages/employees/tabs/ViolationsTab.test.tsx
```

Expected: all focused tests pass.

- [ ] **Step 2: Run static checks one at a time**

```powershell
C:\Users\Admin\sentinel\venv\Scripts\ruff.exe check backend/app/schemas/employee_activity.py backend/app/services/employee_activity_service.py backend/app/api/v1/employees.py backend/tests/test_employee_activity_service.py backend/tests/test_employee_activity_api.py
C:\Users\Admin\sentinel\venv\Scripts\mypy.exe
pnpm -C frontend exec tsc -b --noEmit
pnpm -C frontend run lint
pnpm -C frontend run build
```

Expected: every command exits 0. Do not run combined frontend commands in parallel on this host.

- [ ] **Step 3: Confirm the generated API contract is current**

Invoke `sync-api-types` again. Regenerate, then confirm the generated files do not change. If they change, include both artifacts and re-run TypeScript checks.

```powershell
C:\Users\Admin\sentinel\venv\Scripts\python.exe -X utf8 scripts\dump_openapi.py
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "cd frontend; pnpm run gen:api"
pnpm -C frontend exec tsc -b --noEmit
```

Expected: contract remains consistent with Task 2.

- [ ] **Step 4: Run the required i18n/RTL review**

Invoke the project `i18n-rtl-reviewer` against:

- `EmployeeActivityLookup.tsx`;
- `EmployeeActivitySection.tsx`;
- `EmployeeLookupPage.tsx`;
- `EmployeeSearchHero.tsx`;
- violation deep-link/highlight files;
- English and Arabic locale additions.

Apply every correctness issue it finds. Specifically check logical spacing, inline-start/end alignment, Arabic date grouping, un-reversed G-numbers/references, focus order, popup direction, mobile card reading order, and light/dark contrast. Re-run the focused frontend tests and TypeScript check after fixes.

- [ ] **Step 5: Prepare a PII-free browser smoke environment**

Use an ignored `.tmp/employee-activity-smoke/` data directory. Start the feature backend with `GSSG_DATA_DIR` pointing there and `GSSG_DEV_MODE=true`; start Vite on port 5173 through the existing proxy. Seed only fictional employees and one navigable record of each activity kind using the same model shapes as `test_employee_activity_service.py`. Bootstrap/login a local test admin through the normal auth API/UI. Never point the feature backend at `C:\Users\Admin\sentinel\data`.

Use `hub start` for both long-running processes so readiness and teardown are explicit. Required readiness:

```text
backend: log contains "FastAPI app ready" and port 8765 accepts connections
frontend: log contains the Vite Local URL and port 5173 accepts connections
```

- [ ] **Step 6: Smoke the exact user workflows in a real browser**

At `/employees`, verify with direct observation:

1. Tab into the hero search; no inner dark stroke appears and the full pill ring is visible.
2. Type a name and a G-number in the activity lookup; both return the correct fictional employee.
3. Show activity filters to that employee; Clear restores all employees.
4. Open profile navigates to the employee profile and is visually separate from Show activity.
5. All activity is the default; each type filter returns only its source type.
6. Load more appends without duplicates and disappears at total.
7. Document opens the exact Book; Leave opens the exact leave; Correspondence opens the exact ledger entry; Violation opens the exact employee Violations tab, scrolls to the target row, and highlights it.
8. Clicking an activity never lands on the general employee profile.
9. Loading, filtered-empty, all-empty, and retry states preserve the Employee page.
10. Repeat layout checks at desktop `1440×900` and phone `390×844` in English/LTR and Arabic/RTL, light and dark themes.
11. Use keyboard only for the lookup popup, both sibling result actions, type filter, every activity row, and Load more.

Capture only transient browser evidence; do not commit screenshots or PII.

- [ ] **Step 7: Run full suites sequentially after the smoke passes**

```powershell
C:\Users\Admin\sentinel\venv\Scripts\python.exe -m pytest
pnpm -C frontend test
```

Expected: backend and frontend suites pass. These commands are sequential; do not run them beside lint/build on this workstation.

- [ ] **Step 8: Request final code review and address findings**

Invoke `requesting-code-review`, then run a correctness review covering API pagination/privacy, exact link identities, URL hydration, keyboard behavior, and RTL. Apply accepted findings, rerun the narrowest affected checks, and repeat the browser path if behavior changed.

- [ ] **Step 9: Commit reviewer/verification fixes if files changed**

```powershell
git add backend/app backend/tests backend/openapi.json frontend/src frontend/package.json frontend/pnpm-lock.yaml
git commit -m "fix(employees): address activity review findings"
```

Do not stage `data/`, `.tmp/`, frontend build output, screenshots, or unrelated files. If no files changed, do not create an empty commit.

- [ ] **Step 10: Stop smoke services and report exact evidence**

Stop both `hub` processes. Report:

- focused and full test counts;
- static-check/build results;
- API sync result;
- i18n/RTL review result;
- exact browser scenarios exercised;
- branch/worktree path and commit list;
- any unverified deployment-only behavior.

The feature is implementation-complete only after these checks pass. Do not deploy or claim production verification from the feature worktree.
