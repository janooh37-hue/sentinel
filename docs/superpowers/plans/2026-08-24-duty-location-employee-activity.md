# Duty Location Employee Activity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add every recorded Duty Location initial placement and transfer to the paginated Employee Activity feed and employee Recent Activity timeline.

**Architecture:** Query immutable `DutyAssignmentEvent` rows inside the existing employee activity/detail services, not through the Workforce route. Publish structured placement fields under a new `duty_location` activity kind, then render one shared bilingual movement presentation in both frontend activity surfaces.

**Tech Stack:** FastAPI, SQLAlchemy 2, Pydantic 2, React 19, TypeScript, TanStack Query, react-i18next, Vitest.

## Global Constraints

- Duty Location is the product owner; no Workforce wording, route, or capability gates appear in this feature.
- Read authorization remains `employees.view` through the existing employee endpoints.
- Include `initial_placement` and `transfer`; exclude synthetic `baseline` events.
- Do not infer movements before recorded history.
- English and Arabic/RTL ship together.
- Backend schema changes require OpenAPI and TypeScript API regeneration.
- Run Python through `venv\Scripts\` and frontend commands through `pnpm -C frontend`.

---

### Task 1: Add Duty Location events to the paginated activity contract

**Files:**
- Modify: `backend/app/schemas/employee_activity.py`
- Modify: `backend/app/services/employee_activity_service.py`
- Test: `backend/tests/test_employee_activity_service.py`
- Test: `backend/tests/test_employee_activity_api.py`

**Interfaces:**
- Consumes: `DutyAssignmentEvent` and `Employee` ORM rows.
- Produces: `EmployeeActivityKind` including `duty_location`; structured optional placement fields on `EmployeeActivityItemRead`; `_duty_locations(db, employee_id, requested)`.

- [ ] **Step 1: Write failing service tests for merged history, filtering, totals, and baseline exclusion**

Add fixtures for one `initial_placement`, two `transfer` rows, and one synthetic `baseline`. Assert the service returns the three user-facing rows newest-first and that `kind="duty_location"` returns only those rows.

```python
from datetime import UTC, datetime
from app.db.workforce_models import DutyAssignmentEvent


def test_activity_merges_recorded_duty_location_events(db_session, admin_user):
    db_session.add_all([
        DutyAssignmentEvent(
            employee_id="G1001", event_type="initial_placement",
            from_department=None, from_unit=None, from_post=None,
            to_department="Security", to_unit="Main Gate", to_post="Gate 1",
            effective_at=datetime(2026, 8, 1, 8, tzinfo=UTC).replace(tzinfo=None),
            actor_user_id=admin_user.id, reason="Initial placement",
        ),
        DutyAssignmentEvent(
            employee_id="G1001", event_type="transfer",
            from_department="Security", from_unit="Main Gate", from_post="Gate 1",
            to_department="Security", to_unit="Administration", to_post="Reception",
            effective_at=datetime(2026, 8, 20, 8, tzinfo=UTC).replace(tzinfo=None),
            actor_user_id=admin_user.id, reason="Duty transfer",
        ),
        DutyAssignmentEvent(
            employee_id="G1001", event_type="baseline",
            from_department=None, from_unit=None, from_post=None,
            to_department="Security", to_unit="Legacy", to_post=None,
            effective_at=datetime(2026, 7, 1, 8, tzinfo=UTC).replace(tzinfo=None),
            actor_user_id=admin_user.id, reason="Seed baseline",
        ),
    ])
    db_session.commit()

    result = list_employee_activity(
        db_session, owner_user_id=admin_user.id,
        employee_id="G1001", kind="duty_location", limit=25, offset=0,
    )

    assert result.total == 2
    assert [row.event_type for row in result.items] == ["transfer", "initial_placement"]
    assert result.items[0].from_unit == "Main Gate"
    assert result.items[0].to_unit == "Administration"
```

Add an API test for `GET /api/v1/employees/activity?employee_id=G1001&kind=duty_location`, including rejection of an invalid kind and confirmation that the response contains no `baseline` row.

- [ ] **Step 2: Run the new tests and verify the red state**

Run:

```powershell
venv\Scripts\python.exe -m pytest backend/tests/test_employee_activity_service.py backend/tests/test_employee_activity_api.py -p no:cacheprovider -q
```

Expected: failure because `duty_location` is not accepted and structured fields are absent.

- [ ] **Step 3: Extend the Pydantic activity contract**

Implement this exact shape in `backend/app/schemas/employee_activity.py`:

```python
DutyLocationEventType = Literal["initial_placement", "transfer"]
EmployeeActivityKind = Literal["document", "leave", "violation", "ledger", "duty_location"]

class EmployeeActivityItemRead(ORMBase):
    # existing fields remain unchanged
    event_type: DutyLocationEventType | None = None
    from_department: str | None = None
    from_unit: str | None = None
    from_post: str | None = None
    to_department: str | None = None
    to_unit: str | None = None
    to_post: str | None = None
    reason: str | None = None
```

Use `occurred_at` as the event's `effective_at`; do not add a second timestamp field.

- [ ] **Step 4: Add the Duty Location source query and merge branch**

Import `DutyAssignmentEvent` from `app.db.workforce_models`. Add `_duty_locations` beside the four existing source helpers:

```python
def _duty_locations(
    db: Session, *, employee_id: str | None, requested: int,
) -> tuple[list[EmployeeActivityItemRead], int]:
    stmt = (
        select(
            DutyAssignmentEvent.id.label("source_id"),
            DutyAssignmentEvent.effective_at.label("occurred_at"),
            DutyAssignmentEvent.event_type,
            DutyAssignmentEvent.from_department,
            DutyAssignmentEvent.from_unit,
            DutyAssignmentEvent.from_post,
            DutyAssignmentEvent.to_department,
            DutyAssignmentEvent.to_unit,
            DutyAssignmentEvent.to_post,
            DutyAssignmentEvent.reason,
            Employee.id.label("employee_id"),
            Employee.name_en.label("employee_name_en"),
            Employee.name_ar.label("employee_name_ar"),
            func.count().over().label("source_total"),
        )
        .join(Employee, DutyAssignmentEvent.employee_id == Employee.id)
        .where(DutyAssignmentEvent.event_type.in_(("initial_placement", "transfer")))
    )
    if employee_id is not None:
        stmt = stmt.where(DutyAssignmentEvent.employee_id == employee_id)
    rows = db.execute(
        stmt.order_by(DutyAssignmentEvent.effective_at.desc(), DutyAssignmentEvent.id.desc())
        .limit(requested)
    ).all()
    total = int(rows[0].source_total) if rows else 0
    return [
        EmployeeActivityItemRead(
            kind="duty_location", source_id=row.source_id, target_id=row.source_id,
            occurred_at=row.occurred_at, employee_id=row.employee_id,
            employee_name_en=row.employee_name_en, employee_name_ar=row.employee_name_ar,
            title=row.event_type, detail=row.reason, reference=f"#{row.source_id}",
            event_type=row.event_type, from_department=row.from_department,
            from_unit=row.from_unit, from_post=row.from_post,
            to_department=row.to_department, to_unit=row.to_unit,
            to_post=row.to_post, reason=row.reason,
        )
        for row in rows
    ], total
```

Add:

```python
if kind in (None, "duty_location"):
    sources.append(_duty_locations(db, employee_id=employee_id, requested=requested))
```

- [ ] **Step 5: Run backend tests**

Run the Step 2 command. Expected: all selected tests pass.

- [ ] **Step 6: Commit the paginated backend slice**

```powershell
git add backend/app/schemas/employee_activity.py backend/app/services/employee_activity_service.py backend/tests/test_employee_activity_service.py backend/tests/test_employee_activity_api.py
git commit -m "feat(employees): add duty location activity history"
```

---

### Task 2: Add Duty Location events to employee Recent Activity

**Files:**
- Modify: `backend/app/schemas/employee_detail.py`
- Modify: `backend/app/services/employee_detail_service.py`
- Create: `backend/tests/test_employee_detail_activity.py`

**Interfaces:**
- Consumes: the same `DutyAssignmentEvent` semantics from Task 1.
- Produces: structured `ActivityItemRead(kind="duty_location")` rows in `EmployeeDetailRead.recent_activity`.

- [ ] **Step 1: Write a failing employee-detail test**

Seed a transfer newer than a document and assert it is first, structured, and that a baseline is excluded:

```python
def test_employee_detail_recent_activity_includes_duty_location(db_session, employee, admin_user):
    db_session.add(DutyAssignmentEvent(
        employee_id=employee.id, event_type="transfer",
        from_department="Security", from_unit="Main Gate", from_post="Gate 1",
        to_department="Security", to_unit="Administration", to_post="Reception",
        effective_at=datetime(2026, 8, 24, 8), actor_user_id=admin_user.id,
        reason="Duty transfer",
    ))
    db_session.commit()

    detail = get_employee_detail(db_session, employee.id)

    movement = next(row for row in detail.recent_activity if row.kind == "duty_location")
    assert movement.event_type == "transfer"
    assert movement.from_unit == "Main Gate"
    assert movement.to_unit == "Administration"
```

- [ ] **Step 2: Run the test and verify failure**

```powershell
venv\Scripts\python.exe -m pytest backend/tests/test_employee_detail_activity.py -p no:cacheprovider -q
```

Expected: failure because `ActivityItemRead` does not accept `duty_location`.

- [ ] **Step 3: Extend the detail activity schema and builder**

In `backend/app/schemas/employee_detail.py`, mirror Task 1's structured optional fields:

```python
class ActivityItemRead(ORMBase):
    when: datetime
    kind: Literal["document", "leave", "violation", "ledger", "duty_location"]
    summary: str
    ref_id: int
    event_type: Literal["initial_placement", "transfer"] | None = None
    from_department: str | None = None
    from_unit: str | None = None
    from_post: str | None = None
    to_department: str | None = None
    to_unit: str | None = None
    to_post: str | None = None
    reason: str | None = None
```

Query the employee's latest `ACTIVITY_LIMIT` user-facing duty events in `get_employee_detail`, then pass them into `_build_activity`. Append each event without English presentation text:

```python
sx.ActivityItemRead(
    when=event.effective_at,
    kind="duty_location",
    summary=event.event_type,
    ref_id=event.id,
    event_type=event.event_type,
    from_department=event.from_department,
    from_unit=event.from_unit,
    from_post=event.from_post,
    to_department=event.to_department,
    to_unit=event.to_unit,
    to_post=event.to_post,
    reason=event.reason,
)
```

Keep the existing mixed newest-first sort and `ACTIVITY_LIMIT` cap.

- [ ] **Step 4: Run employee-detail tests**

Run the Step 2 command. Expected: pass.

- [ ] **Step 5: Commit the recent-activity backend slice**

```powershell
git add backend/app/schemas/employee_detail.py backend/app/services/employee_detail_service.py backend/tests/test_employee_detail_activity.py
git commit -m "feat(employees): include duty moves in recent activity"
```

---

### Task 3: Regenerate the API contract and render bilingual movement rows

**Files:**
- Modify (generated): `backend/openapi.json`
- Modify (generated): `frontend/src/lib/api.types.ts`
- Modify: `frontend/src/lib/api.ts`
- Create: `frontend/src/components/employees/DutyLocationActivity.tsx`
- Create: `frontend/src/components/employees/DutyLocationActivity.test.tsx`
- Modify: `frontend/src/components/employees/EmployeeActivitySection.tsx`
- Modify: `frontend/src/components/employees/EmployeeActivitySection.test.tsx`
- Modify: `frontend/src/pages/employees/tabs/ActivityTab.tsx`
- Create: `frontend/src/pages/employees/tabs/ActivityTab.test.tsx`
- Modify: `frontend/src/locales/en.json`
- Modify: `frontend/src/locales/ar.json`

**Interfaces:**
- Consumes: generated `EmployeeActivityItemRead` and `ActivityItemRead` with Task 1/2 fields.
- Produces: shared `DutyLocationActivity` presentation used by both activity surfaces.

- [ ] **Step 1: Regenerate backend OpenAPI and frontend types**

Use the `sync-api-types` skill. The underlying commands are:

```powershell
venv\Scripts\python.exe scripts\dump_openapi.py
pnpm -C frontend run gen:api
```

Expected: both generated files contain `duty_location` and structured placement fields.

- [ ] **Step 2: Write failing shared-presentation and integration tests**

The shared component test must cover transfer, initial placement, missing historical origin, Arabic labels, and logical from/to ordering:

```tsx
render(<DutyLocationActivity item={transferItem} />)
expect(screen.getByText('Transferred')).toBeInTheDocument()
expect(screen.getByText(/Main Gate/)).toBeInTheDocument()
expect(screen.getByText(/Administration/)).toBeInTheDocument()
```

In the section test, return a `duty_location` row from `api.listEmployeeActivity`, click the Duty location filter, and assert the client calls:

```ts
expect(api.listEmployeeActivity).toHaveBeenCalledWith(
  expect.objectContaining({ kind: 'duty_location' }),
)
```

In the detail tab test, pass a `duty_location` `ActivityItemRead` and assert the same localized movement content renders.

- [ ] **Step 3: Run frontend tests and verify failure**

```powershell
pnpm -C frontend exec vitest run src/components/employees/DutyLocationActivity.test.tsx src/components/employees/EmployeeActivitySection.test.tsx src/pages/employees/tabs/ActivityTab.test.tsx
```

Expected: failure because the kind, component, and locale keys do not exist.

- [ ] **Step 4: Implement the shared Duty Location presentation**

Create `DutyLocationActivity.tsx` with a structural input accepted from either generated activity type:

```tsx
export interface DutyLocationActivityValue {
  event_type?: 'initial_placement' | 'transfer' | null
  from_department?: string | null
  from_unit?: string | null
  from_post?: string | null
  to_department?: string | null
  to_unit?: string | null
  to_post?: string | null
  reason?: string | null
}

export function DutyLocationActivity({ item }: { item: DutyLocationActivityValue }): React.JSX.Element {
  const { t } = useTranslation()
  const from = [item.from_unit, item.from_post].filter(Boolean).join(' / ')
  const to = [item.to_unit, item.to_post].filter(Boolean).join(' / ')
  return (
    <span className="block min-w-0">
      <span className="block font-semibold text-foreground">
        {t(`employees.activity.dutyLocation.${item.event_type ?? 'transfer'}`)}
      </span>
      <span dir="auto" className="block text-muted-foreground">
        {from ? `${from} → ${to || t('employees.activity.dutyLocation.unassigned')}` : to}
      </span>
      {item.reason ? <span dir="auto" className="block text-faint">{item.reason}</span> : null}
    </span>
  )
}
```

Use a semantic directional icon or mirrored CSS in the final implementation rather than relying on a literal arrow if the RTL test proves the glyph order misleading.

- [ ] **Step 5: Integrate the new kind into both activity surfaces**

In `EmployeeActivitySection.tsx`:

- add a Duty Location icon/style;
- add `duty_location` to the filter list;
- route the row to `/employees/{employee_id}?tab=activity`;
- render `DutyLocationActivity` instead of the generic title/detail pair for this kind; and
- add the destination screen-reader label.

In `ActivityTab.tsx`, add a location/transfer icon and render the shared component for `duty_location`; keep existing kinds unchanged.

Add exact EN/AR keys under `employees.activity.dutyLocation` for `label`, `initial_placement`, `transfer`, `unassigned`, `openEmployeeActivity`, and `historyBegins`.

- [ ] **Step 6: Run frontend tests and type checking**

```powershell
pnpm -C frontend exec vitest run src/components/employees/DutyLocationActivity.test.tsx src/components/employees/EmployeeActivitySection.test.tsx src/pages/employees/tabs/ActivityTab.test.tsx
pnpm -C frontend exec tsc -b --noEmit
```

Expected: all selected tests pass and TypeScript exits 0.

- [ ] **Step 7: Run the project i18n/RTL review and smoke the real flow**

Run the required `i18n-rtl-reviewer`. Against a seeded backend, complete a Duty Location transfer, then open both the selected employee's global activity and profile Activity tab in EN and AR. Verify the recorded move appears once, shows the historical origin/destination, and no Workforce label appears.

- [ ] **Step 8: Commit the frontend and generated-contract slice**

```powershell
git add backend/openapi.json frontend/src/lib/api.types.ts frontend/src/lib/api.ts frontend/src/components/employees frontend/src/pages/employees/tabs/ActivityTab.tsx frontend/src/pages/employees/tabs/ActivityTab.test.tsx frontend/src/locales/en.json frontend/src/locales/ar.json
git commit -m "feat(employees): show duty location transformation history"
```
