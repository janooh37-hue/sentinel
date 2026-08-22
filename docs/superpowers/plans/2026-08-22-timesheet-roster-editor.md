# Time Sheet Roster Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Time Sheet into the Employee tabs and add an independent, effective-dated Time Sheet roster editor with side-glance checks, color-code filtering, and cyclic match navigation while preserving the existing grid and bottom dock.

**Architecture:** Replace `employees.designation_id` with effective-dated `timesheet_roster_assignments`, then resolve the designation for the selected month in the Time Sheet service. Keep `TimesheetPage` as the state owner; add focused roster, code-index/filter, and side-glance components around the existing grid and dock rather than redesigning them.

**Tech Stack:** FastAPI, SQLAlchemy 2, Alembic/SQLite, Pydantic, React 19, TypeScript, TanStack Query, React Router, i18next, Vitest/Testing Library, Tailwind CSS.

## Global Constraints

- Work only in an isolated Git worktree; the production checkout is live.
- Use migration revision `0077_timesheet_roster_assignments` on the single head `0076_timesheet_start_acks`.
- SQLite employee-column removal MUST use `batch_alter_table`; migration upgrade and downgrade must preserve assignment data.
- Run `sync-api-types` after FastAPI route or schema changes and commit generated `frontend/src/lib/api.types.ts`.
- Run `alembic-migration-reviewer` and confirm exactly one Alembic head.
- Run `i18n-rtl-reviewer` after tab, layout, or string changes; verify English/LTR and Arabic/RTL.
- Employee tabs render one language only. English order is exactly Directory → Attendance → Organization → Duty Locations → Time Sheet. Arabic mode uses Arabic translations only.
- `Time Sheet` is gated by `timesheet.view` and is not added to top navigation.
- Keep `lastCompletedMonth()` for employee-card extracts; only `TimesheetPage` starts on the current month.
- No organization-tree changes.
- No new drag-and-drop dependency; use native pointer/drag events plus a keyboard picker.
- Preserve sealed snapshots, the only-grid-scrolls invariant, existing bottom-panel geometry, attendance editing, statistics, exports, and close/reopen behavior.
- Use existing `[data-code]` semantic color tokens; do not duplicate code colors.
- Honor `prefers-reduced-motion` and logical RTL properties.

---

### Task 1: Decouple Time Sheet assignments in the database

**Files:**
- Create: `backend/app/db/migrations/versions/0077_timesheet_roster_assignments.py`
- Create: `backend/tests/test_migration_timesheet_roster_assignments.py`
- Modify: `backend/app/db/models.py:57-84,1529-1552,1790-1802`

**Interfaces:**
- Produces: `TimesheetRosterAssignment` with `(employee_id, effective_from)` uniqueness.
- Produces: nullable unique `TimesheetDesignation.system_key`.
- Removes: `Employee.designation_id`.
- Migration contract: existing non-null employee assignments become effective `2026-01-01` rows.

- [ ] **Step 1: Confirm the migration base**

Run:

```powershell
venv\Scripts\alembic.exe heads
```

Expected: exactly `0076_timesheet_start_acks (head)`. Stop if another head exists; set the new revision's `down_revision` to the single reported head.

- [ ] **Step 2: Write the failing migration test**

Create a temporary SQLite database upgraded through `0076`, insert one catalog row and two employees (one assigned, one null), upgrade through `0077`, and assert:

```python
columns = {row[1] for row in conn.execute("PRAGMA table_info(employees)")}
assert "designation_id" not in columns

assignment = conn.execute(
    "SELECT employee_id, designation_id, effective_from "
    "FROM timesheet_roster_assignments"
).fetchall()
assert assignment == [("G1001", designation_id, "2026-01-01")]

keys = conn.execute(
    "SELECT system_key FROM timesheet_designations ORDER BY rank_order"
).fetchall()
assert keys[0] == ("prisons_director",)
assert keys[-1] == ("driver",)
```

Downgrade one revision and assert `employees.designation_id` is restored and populated from each employee's latest assignment.

- [ ] **Step 3: Run the migration test to verify RED**

Run:

```powershell
venv\Scripts\python.exe -m pytest backend/tests/test_migration_timesheet_roster_assignments.py -q
```

Expected: FAIL because revision `0077_timesheet_roster_assignments` and the assignment table do not exist.

- [ ] **Step 4: Add the model types**

Remove `Employee.designation_id`, add `system_key`, and add:

```python
class TimesheetRosterAssignment(Base):
    __tablename__ = "timesheet_roster_assignments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    employee_id: Mapped[str] = mapped_column(ForeignKey("employees.id"), nullable=False)
    designation_id: Mapped[int | None] = mapped_column(
        ForeignKey("timesheet_designations.id"), nullable=True
    )
    effective_from: Mapped[date] = mapped_column(Date, nullable=False)
    assigned_at: Mapped[datetime] = mapped_column(
        DateTime, default=_utcnow, server_default=func.current_timestamp()
    )
    assigned_by: Mapped[int | None] = mapped_column(Integer, nullable=True)

    __table_args__ = (
        UniqueConstraint(
            "employee_id", "effective_from", name="uq_timesheet_roster_assignment_effective"
        ),
        Index("ix_timesheet_roster_assignment_effective", "effective_from"),
    )
```

Export the model in `__all__`.

- [ ] **Step 5: Implement the reversible SQLite migration**

Use the project `new-migration` skill. The upgrade must:

```python
revision = "0077_timesheet_roster_assignments"
down_revision = "0076_timesheet_start_acks"

BUILTIN_KEYS = (
    "prisons_director",
    "assistant_director",
    "project_manager",
    "branch_manager",
    "duty_in_charge",
    "security_supervisor",
    "armory_officer",
    "assistant_security_supervisor",
    "armory_keeper",
    "control_room_security_guard",
    "clinic_security_guard",
    "habilitation_security_guard",
    "escort_security_guard",
    "messengers",
    "security_guard",
    "driver",
)
```

1. add nullable `timesheet_designations.system_key` and a unique index;
2. backfill built-in keys by the current seeded `rank_order` 1–16;
3. create `timesheet_roster_assignments` with the model's constraints;
4. copy non-null `employees.designation_id` using `2026-01-01` and `CURRENT_TIMESTAMP`;
5. drop `employees.designation_id` with `batch_alter_table`.

Downgrade must add nullable `employees.designation_id`, backfill each employee from the latest assignment ordered by `effective_from DESC`, then drop the assignment table, key index, and key column.

- [ ] **Step 6: Verify the migration and models**

Run:

```powershell
venv\Scripts\python.exe -m pytest backend/tests/test_migration_timesheet_roster_assignments.py -q
venv\Scripts\alembic.exe heads
```

Expected: test PASS; exactly `0077_timesheet_roster_assignments (head)`.

- [ ] **Step 7: Run the migration review**

Run `alembic-migration-reviewer` against `0077_timesheet_roster_assignments.py`. Fix every SQLite reversibility, data backfill, default, and head finding before continuing.

- [ ] **Step 8: Commit**

```powershell
git add backend/app/db/models.py backend/app/db/migrations/versions/0077_timesheet_roster_assignments.py backend/tests/test_migration_timesheet_roster_assignments.py
git commit -m "feat(timesheet): separate roster assignments from employees"
```

---

### Task 2: Resolve effective assignments and preserve sealed months

**Files:**
- Modify: `backend/app/services/timesheet_service.py:90-105,200-285,410-690,840-910`
- Modify: `backend/app/core/constants.py:316-338`
- Modify: `backend/tests/test_timesheet_service.py`
- Modify: `backend/scripts/import_timesheet_history_2026.py:190-212,342-452,630-645`

**Interfaces:**
- Produces: `roster_assignments_on(db, month_start) -> dict[str, TimesheetRosterAssignment]`.
- Produces: `set_roster_assignments(db, year, month, assignments, actor_id) -> None` in Task 3.
- Changes: live `Row` gains `designation_id: int | None`; sealed rows return null unless a future snapshot migration supplies it.
- Consumes: `TimesheetRosterAssignment` and stable catalog `system_key` from Task 1.

- [ ] **Step 1: Write failing effective-date tests**

Add service tests proving:

```python
jan = date(2026, 1, 1)
aug = date(2026, 8, 1)

_add_assignment(db_session, "G1001", guard.id, jan)
_add_assignment(db_session, "G1001", supervisor.id, aug)

july = svc.build_month(db_session, 2026, 7)
august = svc.build_month(db_session, 2026, 8)
september = svc.build_month(db_session, 2026, 9)

assert next(r for r in july.rows if r.employee_id == "G1001").designation_en == "Security Guard"
assert next(r for r in august.rows if r.employee_id == "G1001").designation_en == "Security Supervisor"
assert next(r for r in september.rows if r.employee_id == "G1001").designation_en == "Security Supervisor"
```

Add a null assignment in September and assert the employee is unassigned and raises `no_designation`. Close July before the later assignment and assert the sealed July row never changes.

- [ ] **Step 2: Run the focused service tests to verify RED**

Run:

```powershell
venv\Scripts\python.exe -m pytest backend/tests/test_timesheet_service.py -k "roster_assignment or sealed" -q
```

Expected: FAIL because the service still reads `Employee.designation_id`.

- [ ] **Step 3: Implement one effective-assignment query**

Use one subquery, not one query per employee:

```python
def _roster_assignments_on(
    db: Session, month_start: date
) -> dict[str, TimesheetRosterAssignment]:
    latest = (
        select(
            TimesheetRosterAssignment.employee_id,
            func.max(TimesheetRosterAssignment.effective_from).label("effective_from"),
        )
        .where(TimesheetRosterAssignment.effective_from <= month_start)
        .group_by(TimesheetRosterAssignment.employee_id)
        .subquery()
    )
    rows = db.execute(
        select(TimesheetRosterAssignment).join(
            latest,
            and_(
                TimesheetRosterAssignment.employee_id == latest.c.employee_id,
                TimesheetRosterAssignment.effective_from == latest.c.effective_from,
            ),
        )
    ).scalars()
    return {row.employee_id: row for row in rows}
```

Resolve the designation from the assignment map and catalog map. Remove `_designation_of(employee)` and every read of `employee.designation_id`.

- [ ] **Step 4: Carry the catalog id through live rows**

Add `designation_id: int | None` to the service `Row` dataclass and populate it for open rows. When adapting `TimesheetSnapshotRow`, return `designation_id=None`; continue using frozen names/rank/codes.

Keep row sorting by resolved designation rank then numeric employee id. `_lists_on` and `_routes_to` continue to receive a resolved designation object.

- [ ] **Step 5: Make built-in seeding non-destructive**

Change `DESIGNATION_SEED` entries to include stable keys:

```python
("security_guard", 15, "Security Guard", "حارس امن", "main")
```

`seed_designations` must match built-ins by `system_key`, insert missing rows, and never overwrite an existing row's editable names, sheet, active flag, or rank. Replace the old “repairs a drifted label” test with tests that edited labels survive startup and a missing built-in key is inserted once.

- [ ] **Step 6: Update fixtures and the history importer**

Replace every test employee `designation_id=...` with an explicit assignment helper. Update `import_timesheet_history_2026.py` to read/write `timesheet_roster_assignments` rather than selecting/updating the removed employee column. Upsert by `(employee_id, effective_from)` and use the imported workbook month as `effective_from` when available.

- [ ] **Step 7: Run service regression tests**

```powershell
venv\Scripts\python.exe -m pytest backend/tests/test_timesheet_service.py backend/tests/test_timesheet_golden.py backend/tests/test_timesheet_xlsx.py -q
```

Expected: PASS. Golden workbook cells, grouping, statistics, and sealed output remain unchanged.

- [ ] **Step 8: Commit**

```powershell
git add backend/app/core/constants.py backend/app/services/timesheet_service.py backend/scripts/import_timesheet_history_2026.py backend/tests/test_timesheet_service.py backend/tests/test_timesheet_golden.py backend/tests/test_timesheet_xlsx.py
git commit -m "feat(timesheet): resolve effective roster assignments"
```

---

### Task 3: Add catalog and atomic roster APIs

**Files:**
- Modify: `backend/app/schemas/timesheet.py:35-119,140-150`
- Modify: `backend/app/api/v1/timesheet.py:48-185`
- Modify: `backend/app/services/timesheet_service.py:840-910`
- Modify: `backend/tests/test_timesheet_api.py`

**Interfaces:**
- Produces: `TimesheetDesignationCreate`, `TimesheetDesignationUpdate`, `TimesheetRosterAssignmentWrite`, `TimesheetRosterBatch`.
- Produces routes: `POST /timesheet/designations`, `PATCH /timesheet/designations/{id}`, `PUT /timesheet/{year}/{month}/roster`.
- Produces live `TimesheetRow.designation_id` in OpenAPI.

- [ ] **Step 1: Write failing API tests**

Add tests for:

```python
created = client.post(
    "/api/v1/timesheet/designations",
    json={"name_en": "Relief Supervisor", "name_ar": "مشرف بديل", "sheet": "main"},
)
assert created.status_code == 200

designation_id = created.json()["id"]
renamed = client.patch(
    f"/api/v1/timesheet/designations/{designation_id}",
    json={"name_en": "Relief Duty Supervisor", "name_ar": "مشرف مناوب بديل"},
)
assert renamed.json()["name_en"] == "Relief Duty Supervisor"

saved = client.put(
    "/api/v1/timesheet/2026/8/roster",
    json={"assignments": [{"employee_id": "G1001", "designation_id": designation_id}]},
)
assert saved.status_code == 204
```

Also assert a duplicate employee in one batch, unknown employee, inactive designation, and sealed month each return a structured 4xx and leave every assignment unchanged. Add viewer-client 403 cases for all three writes.

- [ ] **Step 2: Run API tests to verify RED**

```powershell
venv\Scripts\python.exe -m pytest backend/tests/test_timesheet_api.py -k "designation or roster" -q
```

Expected: new route tests FAIL with 404 or missing schema fields.

- [ ] **Step 3: Add exact Pydantic contracts**

```python
class TimesheetDesignationCreate(BaseModel):
    name_en: str = Field(min_length=1, max_length=128)
    name_ar: str = Field(min_length=1, max_length=128)
    sheet: Sheet

class TimesheetDesignationUpdate(BaseModel):
    name_en: str = Field(min_length=1, max_length=128)
    name_ar: str = Field(min_length=1, max_length=128)

class TimesheetRosterAssignmentWrite(BaseModel):
    employee_id: str = Field(min_length=1, max_length=16)
    designation_id: int | None

class TimesheetRosterBatch(BaseModel):
    assignments: list[TimesheetRosterAssignmentWrite] = Field(min_length=1)
```

Add `system_key: str | None` to `TimesheetDesignationRead` and `designation_id: int | None = None` to `TimesheetRow`.

- [ ] **Step 4: Implement catalog writes**

Normalize surrounding whitespace, reject case-insensitive duplicate English or Arabic names, choose `rank_order = max(rank_order) + 1`, and create user rows with `system_key=None`. Rename changes only `name_en` and `name_ar`.

Use existing `ValidationFailedError`/`NotFoundError` conventions and return `TimesheetDesignationRead`.

- [ ] **Step 5: Implement the atomic month roster write**

```python
def set_roster_assignments(
    db: Session,
    year: int,
    month: int,
    assignments: Sequence[TimesheetRosterAssignmentWrite],
    *,
    actor_id: int | None,
) -> None:
    effective_from = date(year, month, 1)
    # Validate the whole batch before adding/updating any row.
    # Upsert one row per (employee_id, effective_from), including explicit nulls.
    db.commit()
```

Reject closed periods using the same frozen-month rule as cell writes. Validate duplicate ids with `len(ids) != len(set(ids))`. Validate all employee/designation rows in set-based queries before mutation.

- [ ] **Step 6: Update employee extract sheet resolution**

Change `_sheet_for_employee` in `api/v1/timesheet.py` to accept the export year/month and resolve the effective assignment for that month. Do not read `Employee.designation_id`.

- [ ] **Step 7: Run API and service tests**

```powershell
venv\Scripts\python.exe -m pytest backend/tests/test_timesheet_api.py backend/tests/test_timesheet_service.py -q
```

Expected: PASS, including atomic rollback and viewer 403 cases.

- [ ] **Step 8: Commit**

```powershell
git add backend/app/schemas/timesheet.py backend/app/api/v1/timesheet.py backend/app/services/timesheet_service.py backend/tests/test_timesheet_api.py backend/tests/test_timesheet_service.py
git commit -m "feat(timesheet): add roster assignment API"
```

---

### Task 4: Synchronize the API contract and frontend mutations

**Files:**
- Modify generated: `backend/openapi.json`
- Modify generated: `frontend/src/lib/api.types.ts`
- Modify: `frontend/src/lib/api.ts:850-865,2088-2110`
- Modify: `frontend/src/pages/timesheet/useTimesheet.ts`
- Modify: `frontend/src/pages/settings/DesignationCatalog.tsx:40-82`
- Create test: `frontend/src/pages/timesheet/useTimesheetRoster.test.tsx`

**Interfaces:**
- Produces API methods:
  - `createTimesheetDesignation(input)`;
  - `updateTimesheetDesignation(id, input)`;
  - `setTimesheetRoster({ year, month, assignments })`.
- Produces shared `TIMESHEET_DESIGNATIONS_KEY` and Query hooks/mutations.

- [ ] **Step 1: Regenerate the OpenAPI types**

Run the project `sync-api-types` skill after Tasks 1–3. Confirm generated types include `designation_id`, `system_key`, the catalog write schemas, and the roster batch route.

- [ ] **Step 2: Write failing hook tests**

Test that a successful roster mutation:

```typescript
await result.current.saveRoster.mutateAsync({
  year: 2026,
  month: 8,
  assignments: [{ employee_id: 'G7160', designation_id: 5 }],
})

expect(api.setTimesheetRoster).toHaveBeenCalledWith({
  year: 2026,
  month: 8,
  assignments: [{ employee_id: 'G7160', designation_id: 5 }],
})
expect(invalidateQueries).toHaveBeenCalledWith({
  queryKey: ['timesheet', 2026, 8, 'main'],
})
```

Catalog create/update tests must invalidate `TIMESHEET_DESIGNATIONS_KEY` and preserve structured errors for dialogs.

- [ ] **Step 3: Run hook tests to verify RED**

```powershell
pnpm -C frontend test -- useTimesheetRoster.test.tsx
```

Expected: FAIL because the client methods and hooks do not exist.

- [ ] **Step 4: Add typed API methods**

Use generated aliases rather than handwritten duplicate interfaces:

```typescript
export type TimesheetRosterBatch = components['schemas']['TimesheetRosterBatch']
export type TimesheetDesignationCreate = components['schemas']['TimesheetDesignationCreate']
export type TimesheetDesignationUpdate = components['schemas']['TimesheetDesignationUpdate']
```

Build paths with `encodeURIComponent` for ids and send the roster batch to the selected year/month route.

- [ ] **Step 5: Add Query hooks and shared keys**

Export:

```typescript
export const TIMESHEET_DESIGNATIONS_KEY = ['timesheet-designations'] as const
export const timesheetMonthKey = (p: TimesheetMonth) =>
  ['timesheet', p.year, p.month, p.sheet] as const
```

Add `useTimesheetDesignations`, `useCreateTimesheetDesignation`, `useUpdateTimesheetDesignation`, and `useSetTimesheetRoster`. Update Settings `DesignationCatalog` to import the shared key rather than its private duplicate.

- [ ] **Step 6: Run hook/client tests and TypeScript**

```powershell
pnpm -C frontend test -- useTimesheetRoster.test.tsx DesignationCatalog.test.tsx
pnpm -C frontend exec tsc -b --noEmit
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add backend/openapi.json frontend/src/lib/api.types.ts frontend/src/lib/api.ts frontend/src/pages/timesheet/useTimesheet.ts frontend/src/pages/timesheet/useTimesheetRoster.test.tsx frontend/src/pages/settings/DesignationCatalog.tsx
git commit -m "feat(timesheet): expose roster client contract"
```

---

### Task 5: Move Time Sheet into language-pure Employee tabs and use current month

**Files:**
- Modify: `frontend/src/components/employees/EmployeesSectionTabs.tsx:37-88`
- Modify: `frontend/src/components/employees/EmployeesSectionTabs.test.tsx:1-111`
- Modify: `frontend/src/locales/en.json:394-402`
- Modify: `frontend/src/locales/ar.json:415-423`
- Modify: `frontend/src/pages/employees/EmployeeLookupPage.tsx:21-33,140-168`
- Delete: `frontend/src/pages/timesheet/TimesheetEntry.tsx`
- Delete: `frontend/src/pages/timesheet/TimesheetEntry.test.tsx`
- Modify: `frontend/src/pages/timesheet/TimesheetPage.tsx:27-58,103-120,391-410`
- Modify: `frontend/src/pages/timesheet/useTimesheet.ts:451-455`
- Modify: `frontend/src/pages/timesheet/monthSpan.test.ts`
- Modify: `frontend/src/pages/timesheet/TimesheetPage.test.tsx`

**Interfaces:**
- Produces: `currentMonth(now: Date = new Date()) -> { year: number; month: number }`.
- Changes tab order and adds capability-gated `/employees/timesheet` after `/duty-locations`.
- Removes the directory-page `TimesheetEntry` strip.

- [ ] **Step 1: Write failing tab tests**

Replace the old bilingual-span assertion with:

```typescript
it('orders Time Sheet last and renders one language per tab', () => {
  renderTabs({}, '/employees/timesheet')
  expect(screen.getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([
    '/employees',
    '/employees/attendance',
    '/employees/org-tree',
    '/duty-locations',
    '/employees/timesheet',
  ])
  expect(linkTo('/employees/timesheet')).toHaveAttribute('aria-current', 'page')
  expect(document.querySelector('[dir="rtl"]')).toBeNull()
})
```

Add a test hiding Time Sheet when `timesheet.view` is absent. In an Arabic-i18n render, assert the Time Sheet label is `كشف الحضور الشهري` and no English companion label is present.

- [ ] **Step 2: Write the failing current-month test**

```typescript
expect(currentMonth(new Date(2026, 7, 22))).toEqual({ year: 2026, month: 8 })
expect(currentMonth(new Date(2026, 0, 5))).toEqual({ year: 2026, month: 1 })
expect(lastCompletedMonth(new Date(2026, 7, 22))).toEqual({ year: 2026, month: 7 })
```

Use fake system time in `TimesheetPage.test.tsx` and assert `api.getTimesheet` is called for the current month.

- [ ] **Step 3: Run tests to verify RED**

```powershell
pnpm -C frontend test -- EmployeesSectionTabs.test.tsx monthSpan.test.ts TimesheetPage.test.tsx
```

Expected: FAIL because Time Sheet is not a tab and the page still calls `lastCompletedMonth()`.

- [ ] **Step 4: Implement tab cleanup and ordering**

Delete the `attendanceAr`/`orgTreeAr` spans and locale keys. Add:

```tsx
<NavLink to="/duty-locations" className={tabClass}>
  {t('employees.sectionTabs.dutyLocations')}
</NavLink>
{has('timesheet.view') && (
  <NavLink to="/employees/timesheet" className={tabClass}>
    {t('employees.sectionTabs.timesheet')}
  </NavLink>
)}
```

Use `"timesheet": "Time Sheet"` in English and `"timesheet": "كشف الحضور الشهري"` in Arabic. Remove `TimesheetEntry` from `EmployeeLookupPage` and delete the dead component/tests.

- [ ] **Step 5: Render Employee tabs in Time Sheet without breaking the shell**

Add a compact navy band as the first fixed child of `TimesheetPage`, containing `EmployeesSectionTabs` and the attendance attention badge. Keep `data-testid="timesheet-shell"` as a column flex shell; the grid remains the only overflow region and the dock remains outside it.

- [ ] **Step 6: Implement current-month initialization**

```typescript
export const currentMonth = (now: Date = new Date()) => ({
  year: now.getFullYear(),
  month: now.getMonth() + 1,
})
```

Use it only in `TimesheetPage` initialization. Keep `EmployeeIdCard` on `lastCompletedMonth()`.

- [ ] **Step 7: Run tab/month tests**

```powershell
pnpm -C frontend test -- EmployeesSectionTabs.test.tsx EmployeeLookupPage.test.tsx monthSpan.test.ts TimesheetPage.test.tsx
```

Expected: PASS; shell scroll assertions remain green.

- [ ] **Step 8: Commit**

```powershell
git add frontend/src/components/employees/EmployeesSectionTabs.tsx frontend/src/components/employees/EmployeesSectionTabs.test.tsx frontend/src/locales/en.json frontend/src/locales/ar.json frontend/src/pages/employees/EmployeeLookupPage.tsx frontend/src/pages/employees/EmployeeLookupPage.test.tsx frontend/src/pages/timesheet
git commit -m "feat(timesheet): move page into employee tabs"
```

---

### Task 6: Build staged roster editing and designation dialogs

**Files:**
- Create: `frontend/src/pages/timesheet/TimesheetRosterEditor.tsx`
- Create: `frontend/src/pages/timesheet/TimesheetRosterEditor.test.tsx`
- Create: `frontend/src/pages/timesheet/DesignationDialog.tsx`
- Create: `frontend/src/pages/timesheet/DesignationDialog.test.tsx`
- Create: `frontend/src/pages/timesheet/rosterDraft.ts`
- Create: `frontend/src/pages/timesheet/rosterDraft.test.ts`
- Modify: `frontend/src/pages/timesheet/TimesheetPage.tsx`
- Modify: `frontend/src/pages/timesheet/TimesheetGrid.tsx:130-328,330-1141`
- Modify: `frontend/src/pages/timesheet/TimesheetGrid.test.tsx`
- Modify: `frontend/src/locales/en.json`
- Modify: `frontend/src/locales/ar.json`

**Interfaces:**
- Produces: `RosterDraft = Map<string, number | null>`.
- Produces: `applyRosterDraft(rows, designations, sheet, draft) -> TimesheetRow[]` with recomputed row numbers.
- Produces: `TimesheetRosterEditor` callbacks `onAssign`, `onSave`, `onCancel`, `onCreateDesignation`, `onEditDesignation`.
- Consumes: Task 4 roster/catalog hooks.

- [ ] **Step 1: Write pure draft tests**

```typescript
const draft = new Map([['G7160', dutyInCharge.id]])
const moved = applyRosterDraft(ROWS, DESIGNATIONS, 'main', draft)

expect(moved.find((row) => row.employee_id === 'G7160')).toMatchObject({
  designation_id: dutyInCharge.id,
  designation_en: dutyInCharge.name_en,
  rank_order: dutyInCharge.rank_order,
})
expect(moved.map((row) => row.row_no)).toEqual(moved.map((_, index) => index + 1))
```

Assert a Drivers designation is excluded while `sheet='main'`, ids break rank ties numerically, and the source rows are not mutated.

- [ ] **Step 2: Write failing interaction tests**

Cover:

- Edit roster is absent for viewers and sealed months.
- Entering mode forces attendance, clears brush/filter, and locks attendance cells.
- Pointer drop stages a move without calling the API.
- Enter/Space on a grip opens the designation picker; selection stages the same move.
- Save sends only changed assignments in one batch.
- Failed save leaves the draft and edit mode visible.
- Cancel restores server order without a request.
- Reduced motion skips the FLIP animation.

- [ ] **Step 3: Run focused tests to verify RED**

```powershell
pnpm -C frontend test -- rosterDraft.test.ts TimesheetRosterEditor.test.tsx DesignationDialog.test.tsx TimesheetGrid.test.tsx
```

Expected: FAIL because the editor and draft helpers do not exist.

- [ ] **Step 4: Implement draft ordering first**

Use designation id/rank as the stable group key. Keep unassigned rows last. Clone only rows whose display fields or row number change; reuse unchanged code arrays and notes.

- [ ] **Step 5: Implement edit mode and keyboard parity**

Use native drag events on a grip button and designation heading drop targets. The same grip button opens a designation picker on Enter/Space. Valid targets are active designations for the selected sheet only.

Store the pre-move rectangle, update the draft, and animate the moved row from old to new rectangle for 220–460ms using the existing calm easing. Skip `Element.animate` when `matchMedia('(prefers-reduced-motion: reduce)').matches`.

- [ ] **Step 6: Implement catalog dialogs**

Create dialog fields for English name, Arabic name, and sheet on create; omit sheet on rename. Associate labels, return focus to the originating control, show structured API errors inside the dialog, and invalidate the shared designation key after success.

- [ ] **Step 7: Wire atomic save/cancel**

Convert changed draft entries to:

```typescript
const assignments = [...draft].map(([employee_id, designation_id]) => ({
  employee_id,
  designation_id,
}))
```

On success clear the draft and close mode. On error retain both. Disable duplicate Save clicks while pending.

- [ ] **Step 8: Run roster tests and typecheck**

```powershell
pnpm -C frontend test -- rosterDraft.test.ts TimesheetRosterEditor.test.tsx DesignationDialog.test.tsx TimesheetGrid.test.tsx TimesheetPage.test.tsx
pnpm -C frontend exec tsc -b --noEmit
```

Expected: PASS.

- [ ] **Step 9: Commit**

```powershell
git add frontend/src/pages/timesheet frontend/src/locales/en.json frontend/src/locales/ar.json
git commit -m "feat(timesheet): add staged roster editing"
```

---

### Task 7: Add one-pass code indexing and cyclic filtering

**Files:**
- Create: `frontend/src/pages/timesheet/timesheetCodeIndex.ts`
- Create: `frontend/src/pages/timesheet/timesheetCodeIndex.test.ts`
- Create: `frontend/src/pages/timesheet/TimesheetCodeFilterBar.tsx`
- Create: `frontend/src/pages/timesheet/TimesheetCodeFilterBar.test.tsx`
- Modify: `frontend/src/pages/timesheet/TimesheetPage.tsx`
- Modify: `frontend/src/pages/timesheet/TimesheetGrid.tsx`
- Modify: `frontend/src/pages/timesheet/TimesheetGrid.test.tsx`

**Interfaces:**
- Produces:

```typescript
export interface TimesheetCodeIndex {
  cellCounts: Record<CodeSlug, number>
  employeeIds: Record<CodeSlug, string[]>
}

export function buildTimesheetCodeIndex(
  rows: readonly TimesheetRow[],
  variant: TimesheetVariant,
  daysInMonth: number,
): TimesheetCodeIndex
```

- `TimesheetGrid` consumes `filteredEmployeeIds: ReadonlySet<string> | null` and `currentFilterEmployeeId: string | null` while retaining all rows for footer calculations.

- [ ] **Step 1: Write failing index tests**

Assert repeated AL cells count individually but include an employee once, employee ids preserve roster order, statistics uses `stat_codes`, and days past `daysInMonth` are ignored.

```typescript
expect(index.cellCounts.AL).toBe(5)
expect(index.employeeIds.AL).toEqual(['G7014', 'G7068'])
```

- [ ] **Step 2: Write failing filter-navigation tests**

For four AL employees assert:

```typescript
expect(screen.getByText('1 of 4')).toBeInTheDocument()
await user.click(screen.getByRole('button', { name: /previous employee/i }))
expect(screen.getByText('4 of 4')).toBeInTheDocument()
await user.click(screen.getByRole('button', { name: /next employee/i }))
expect(screen.getByText('1 of 4')).toBeInTheDocument()
```

Assert four matching rows/groups render while daily footer totals still reflect all rows. Clear restores every row and group.

- [ ] **Step 3: Run tests to verify RED**

```powershell
pnpm -C frontend test -- timesheetCodeIndex.test.ts TimesheetCodeFilterBar.test.tsx TimesheetGrid.test.tsx
```

Expected: FAIL because the index/filter interfaces do not exist.

- [ ] **Step 4: Implement the one-pass index**

Allocate one `Set<CodeSlug>` per row, scan only `daysInMonth`, increment cell counts, then append each employee once per seen code. Memoize in `TimesheetPage` on `rows`, `variant`, and `daysInMonth`; pass the result to both side and dock surfaces.

- [ ] **Step 5: Implement page-owned cyclic state**

Store `{ code: CodeSlug; index: number } | null`. Derive the current index with modulo against the current match list. Activating a code starts at zero; Previous and Next use:

```typescript
(next + matches.length) % matches.length
```

Month, sheet, variant, roster-edit entry, and Clear set the filter to null. When refetch removes all matches, clear it; otherwise clamp by modulo.

- [ ] **Step 6: Implement grid filtering without changing totals**

Filter only the `lines` used for `<tbody>` employee/group rendering. Keep footer/headcount calculations on the complete `rows` prop. Add `data-code-filter-current` and code-cell outlines using existing tokens, not new colors.

- [ ] **Step 7: Scroll matches inside the real grid viewport**

Add a `scrollRef` to the existing `timesheet-scroll` element. On activation/navigation, find the row inside that ref using `CSS.escape(employeeId)`, call `scrollIntoView({ block: 'center', inline: 'nearest' })`, and skip the pulse animation under reduced motion.

- [ ] **Step 8: Run filter tests and typecheck**

```powershell
pnpm -C frontend test -- timesheetCodeIndex.test.ts TimesheetCodeFilterBar.test.tsx TimesheetGrid.test.tsx TimesheetPage.test.tsx
pnpm -C frontend exec tsc -b --noEmit
```

Expected: PASS.

- [ ] **Step 9: Commit**

```powershell
git add frontend/src/pages/timesheet
git commit -m "feat(timesheet): add cyclic code filtering"
```

---

### Task 8: Integrate the side glance, checks, and unchanged bottom dock

**Files:**
- Create: `frontend/src/pages/timesheet/TimesheetGlance.tsx`
- Create: `frontend/src/pages/timesheet/TimesheetGlance.test.tsx`
- Modify: `frontend/src/pages/timesheet/panels/ChecksPanel.tsx:31-253`
- Modify: `frontend/src/pages/timesheet/panels/ChecksPanel.test.tsx`
- Modify: `frontend/src/pages/timesheet/panels/CodesPanel.tsx`
- Create or modify: `frontend/src/pages/timesheet/panels/CodesPanel.test.tsx`
- Modify: `frontend/src/pages/timesheet/TimesheetDock.tsx:40-512`
- Modify: `frontend/src/pages/timesheet/TimesheetDock.test.tsx`
- Modify: `frontend/src/pages/timesheet/TimesheetNotice.tsx`
- Modify: `frontend/src/pages/timesheet/TimesheetPage.tsx:60-642`
- Modify: `frontend/src/index.css:193-198,368-376` only if a layout selector cannot be expressed with existing utilities
- Modify: `frontend/src/locales/en.json`
- Modify: `frontend/src/locales/ar.json`

**Interfaces:**
- `TimesheetGlance` consumes `TimesheetCodeIndex`, issues/movement, active tab/collapse state, dock-open state, and callbacks.
- `CodesPanel` gains `onFilterCode: (code: CodeSlug) => void` and uses `data-code` badges.
- `ChecksPanel` gains `rosterEmployeeIds`, `onShowRow`, and separate profile links.
- `TimesheetUiState.panel` removes `'checks'`; checks live only in the side glance.

- [ ] **Step 1: Write failing glance tests**

Cover:

- default Cells by code view and exact semantic `data-code` attributes;
- disabled zero-match codes;
- Checks tab badge and internal scrolling container;
- notice click expands side and selects Checks;
- collapse to 36px rail and restore the active tab;
- any non-null dock panel hides the side column and closing restores prior state;
- Arabic layout uses logical inline-end positioning.

- [ ] **Step 2: Write failing check-action tests**

For an issue whose employee is in `rosterEmployeeIds`, assert employee/name and Show row call `onShowRow('G7099')`, while View profile has `/employees/G7099`. For an issue absent from the roster, assert no Show row control and the profile link remains.

- [ ] **Step 3: Write failing bottom-code tests**

```typescript
await user.click(screen.getByRole('button', { name: /annual leave/i }))
expect(onFilterCode).toHaveBeenCalledWith('AL')
expect(onOpenPanel).toHaveBeenCalledWith(null)
expect(screen.getByTestId('code-badge-AL')).toHaveAttribute('data-code', 'AL')
```

- [ ] **Step 4: Run tests to verify RED**

```powershell
pnpm -C frontend test -- TimesheetGlance.test.tsx ChecksPanel.test.tsx CodesPanel.test.tsx TimesheetDock.test.tsx
```

Expected: FAIL because checks still belong to the bottom panel and codes are not filter actions.

- [ ] **Step 5: Implement the 210px/36px side layout**

Wrap the existing grid scroll region and glance in a CSS grid. Wide expanded columns are `minmax(0, 1fr) 210px`; collapsed is `minmax(0, 1fr) 36px`; dock-open is `minmax(0, 1fr) 0`. The side owns its own vertical overflow. Do not add another horizontal grid scroller.

Use logical borders/placement. At the chosen narrow breakpoint start visually collapsed; preserve the user's explicit state after interaction.

- [ ] **Step 6: Move checks into the side panel**

Remove `'checks'` from `TimesheetDock` title/subtitle/render branches and imports. `TimesheetNotice.onOpenChecks` now sets side tab to Checks, expands it, and closes any dock panel.

Refactor issue rows so row navigation and profile navigation are distinct. Reuse existing joined/leaving confirmation behavior and omit row jumps for `removed` or issue ids absent from current rows.

- [ ] **Step 7: Make side and bottom codes share filtering and colors**

Pass the Task 7 index to both surfaces. Render every badge as:

```tsx
<span data-code={spec.slug} data-testid={`code-badge-${spec.slug}`}>
  {glyphOf(spec.slug)}
</span>
```

Clicking a side code calls `onFilterCode`. Clicking a bottom code first calls `onOpenPanel(null)`, restores the side Cells-by-code tab, then calls the same callback. Do not hard-code fill colors.

- [ ] **Step 8: Wire row jumps**

`TimesheetPage.onShowRow(employeeId)` clears the code filter, sets the existing selected employee id, scrolls inside `timesheet-scroll`, and applies a short structural highlight. View profile remains a React Router `Link` and never calls `onShowRow`.

- [ ] **Step 9: Run component and page tests**

```powershell
pnpm -C frontend test -- TimesheetGlance.test.tsx ChecksPanel.test.tsx CodesPanel.test.tsx TimesheetDock.test.tsx TimesheetPage.test.tsx
pnpm -C frontend exec tsc -b --noEmit
```

Expected: PASS; the existing “dock outside scroll region” and focus-return tests remain green.

- [ ] **Step 10: Commit**

```powershell
git add frontend/src/pages/timesheet frontend/src/index.css frontend/src/locales/en.json frontend/src/locales/ar.json
git commit -m "feat(timesheet): add side glance and shared code filters"
```

---

### Task 9: Review bilingual behavior and verify the real surface

**Files:**
- Modify only if verification finds defects: files changed in Tasks 5–8
- Update if user-facing behavior is documented there: `DESIGN.md`

**Interfaces:**
- Verifies the complete spec; produces no new API.

- [ ] **Step 1: Run focused backend quality gates**

```powershell
venv\Scripts\python.exe -m pytest backend/tests/test_migration_timesheet_roster_assignments.py backend/tests/test_timesheet_service.py backend/tests/test_timesheet_api.py backend/tests/test_timesheet_golden.py backend/tests/test_timesheet_xlsx.py -q
venv\Scripts\ruff.exe check backend/app/db/models.py backend/app/services/timesheet_service.py backend/app/api/v1/timesheet.py backend/app/schemas/timesheet.py backend/app/db/migrations/versions/0077_timesheet_roster_assignments.py backend/scripts/import_timesheet_history_2026.py backend/tests/test_migration_timesheet_roster_assignments.py backend/tests/test_timesheet_service.py backend/tests/test_timesheet_api.py
venv\Scripts\mypy.exe
venv\Scripts\alembic.exe heads
```

Expected: all PASS; exactly one head `0077_timesheet_roster_assignments`.

- [ ] **Step 2: Run focused frontend quality gates one at a time**

```powershell
pnpm -C frontend test -- EmployeesSectionTabs.test.tsx monthSpan.test.ts TimesheetPage.test.tsx TimesheetGrid.test.tsx TimesheetRosterEditor.test.tsx DesignationDialog.test.tsx timesheetCodeIndex.test.ts TimesheetCodeFilterBar.test.tsx TimesheetGlance.test.tsx ChecksPanel.test.tsx CodesPanel.test.tsx TimesheetDock.test.tsx
pnpm -C frontend run lint
pnpm -C frontend exec tsc -b --noEmit
pnpm -C frontend run build
```

Expected: all PASS with no warnings. Run sequentially because combined frontend checks can exhaust this workstation.

- [ ] **Step 3: Confirm generated API drift is zero**

Run `sync-api-types` again. Expected: no diff in `backend/openapi.json` or `frontend/src/lib/api.types.ts`.

- [ ] **Step 4: Run the required RTL review**

Run `i18n-rtl-reviewer` on the Employee tabs, Time Sheet side glance, filters, roster edit banner/dialog, and checks. Fix every mixed-language label, physical-direction class, bidi isolation, focus order, and reduced-motion finding.

Specifically verify English tabs contain only:

```text
Directory | Attendance | Organization | Duty Locations | Time Sheet
```

and Arabic tabs contain only Arabic translations.

- [ ] **Step 5: Browser-drive the actual Time Sheet in English/LTR**

Start the app through the normal project service/dev workflow and use the browser tool on `/employees/timesheet`.

Verify:

1. current month is selected;
2. Time Sheet is the final Employee tab;
3. grid alone scrolls and the bottom dock stays fixed;
4. side Codes colors match cells in light and dark themes;
5. AL filter reports correct employee/cell totals;
6. Next after the last match wraps to first; Previous from first wraps to last;
7. bottom Codes applies the same filter and hides/restores the side;
8. Fix before download selects side Checks;
9. Show row jumps inside the grid; View profile is separate;
10. drag/drop and keyboard assignment both stage, Cancel restores, Save persists after reload.

- [ ] **Step 6: Repeat the browser review in Arabic/RTL**

At the same resolution, verify side panel moves to logical inline-end, arrows/order mirror correctly, G-numbers stay isolated, every string is Arabic, and no English/Arabic tab pair is rendered together.

- [ ] **Step 7: Verify reduced motion and narrow layout**

Emulate `prefers-reduced-motion: reduce`; moves and row jumps must land without animation. At the narrow supported width, the glance starts as a rail and the bottom panel remains reachable without covering release controls.


- [ ] **Step 8: Commit verification fixes**

```powershell
git add frontend backend
git commit -m "test(timesheet): verify roster editor interactions"
```

If verification produces no tracked changes, do not create an empty commit.
