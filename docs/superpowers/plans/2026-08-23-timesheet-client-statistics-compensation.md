# Time Sheet Client Statistics Compensation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Widen the expanded Time Sheet side glance to 400px and make live Main Client Statistics transfer only real daily leave/absence codes into available lower-ranked P cells.

**Architecture:** Keep the backend service as the single derivation point. Build the live Main rows from truthful attendance codes, then run one pure per-day compensation function across the already-ranked rows; Drivers continues through the existing filler transform and sealed rows continue through snapshots. The frontend change is one grid-track value plus its existing assertions.

**Tech Stack:** Python 3.12, FastAPI service layer, pytest, React 19, TypeScript, Vitest, Tailwind CSS.

## Global Constraints

- Expanded side glance is exactly 400px; collapsed is 36px; an open bottom panel is 0px.
- Main live months use daily rank-first compensation and code placement order `AL`, `SL `, `AB`, `TR`.
- Only lower `P` cells are targets. `-`, `NG`, `X`, and existing non-`P` lower cells remain unchanged.
- A source becomes `P` only when its code is transferred; no leave code is invented or discarded.
- Drivers and sealed snapshots retain their current behavior.
- No schema, migration, API-contract, or dependency change.

---

### Task 1: Correct Main Client Statistics Compensation

**Files:**
- Modify: `backend/app/services/timesheet_service.py:73-90,182-191,661-712,784-833`
- Test: `backend/tests/test_timesheet_service.py:164-214`

**Interfaces:**
- Produces: `_compensated_day(codes: Sequence[str | None], post_count: int) -> list[str | None]`.
- Produces: `_apply_main_statistics(rows: Sequence[GridRow], post_count: int) -> None`.
- Existing `build_month` call signature remains unchanged.

- [ ] **Step 1: Replace obsolete statistics tests and add RED cases**

Replace the current tests that assert every block-2 cell becomes a filler. Add these pure rule cases:

```python
def test_main_statistics_compensates_by_rank_then_groups_codes():
    assert svc._compensated_day(
        [CODE_SICK, CODE_ANNUAL, CODE_PRESENT, CODE_PRESENT, CODE_PRESENT], 3
    ) == [CODE_PRESENT, CODE_PRESENT, CODE_PRESENT, CODE_ANNUAL, CODE_SICK]


def test_main_statistics_does_not_invent_leave_when_targets_outnumber_sources():
    assert svc._compensated_day(
        [CODE_ANNUAL, CODE_PRESENT, CODE_PRESENT, CODE_PRESENT, CODE_PRESENT], 3
    ) == [CODE_PRESENT, CODE_PRESENT, CODE_PRESENT, CODE_ANNUAL, CODE_PRESENT]


def test_main_statistics_keeps_unmatched_and_fixed_codes():
    assert svc._compensated_day(
        [CODE_SICK, CODE_ANNUAL, CODE_PRESENT, CODE_PRESENT, CODE_ABSENT, CODE_OFF_ROSTER],
        3,
    ) == [
        CODE_PRESENT,
        CODE_ANNUAL,
        CODE_PRESENT,
        CODE_SICK,
        CODE_ABSENT,
        CODE_OFF_ROSTER,
    ]
```

Update `test_block_one_hides_leave_from_the_client` so it creates a lower `P` target before expecting the source to become `P`. Replace the Main filler tests with this Drivers regression:

```python
def test_drivers_keep_existing_filler_derivation(db_session, guards):
    svc.set_post_count(db_session, 2026, 7, 0)
    svc.set_filler(db_session, 2026, 7, "G2000", CODE_SICK)
    row = _row(db_session, 2026, 7, "G2000", sheet="drivers")
    assert row.stat_codes[:31] == [CODE_SICK] * 31
```

Add a sealed regression: close the clean month, then add an approved AL day for `G0999`; the sealed `stat_codes[0]` remains the snapshotted `P`.

```python
def test_sealed_main_statistics_remain_frozen(db_session, guards):
    svc.close_month(db_session, 2026, 7)
    db_session.add(
        Leave(
            employee_id="G0999",
            leave_type="Annual Leave",
            start_date=date(2026, 7, 1),
            end_date=date(2026, 7, 1),
            days=1,
            status="Approved",
        )
    )
    db_session.commit()
    assert _row(db_session, 2026, 7, "G0999").stat_codes[0] == CODE_PRESENT
```

- [ ] **Step 2: Run the new tests and verify RED**

Run:

```powershell
C:\Users\Admin\sentinel\venv\Scripts\python.exe -m pytest backend/tests/test_timesheet_service.py -k "main_statistics or drivers_keep_existing_filler or sealed_main_statistics" -q
```

Expected: new Main compensation assertions fail because every block-2 P currently becomes the row filler.

- [ ] **Step 3: Implement the pure daily transfer**

In `timesheet_service.py`, define the fixed placement order and pure transformation:

```python
_STAT_TRANSFER_ORDER: Final[dict[str, int]] = {
    CODE_ANNUAL: 0,
    CODE_SICK: 1,
    CODE_ABSENT: 2,
    CODE_NATIONAL: 3,
}


def _compensated_day(
    codes: Sequence[str | None], post_count: int
) -> list[str | None]:
    result = list(codes)
    boundary = min(post_count, len(codes))
    sources = [
        (index, code)
        for index, code in enumerate(codes[:boundary])
        if code in _STAT_TRANSFER_ORDER
    ]
    targets = [
        index
        for index, code in enumerate(codes[boundary:], start=boundary)
        if code == CODE_PRESENT
    ]
    moved = sources[: len(targets)]
    for index, _code in moved:
        result[index] = CODE_PRESENT
    moved_codes = sorted((code for _index, code in moved), key=_STAT_TRANSFER_ORDER.__getitem__)
    for index, code in zip(targets, moved_codes, strict=False):
        result[index] = code
    return result
```

Add `_apply_main_statistics` to run this once for each of the 31 wire columns and mutate only the already-owned `stat_codes` lists.

- [ ] **Step 4: Route only live Main rows through compensation**

Pass `sheet` into `_live_rows`. Initialize Main `stat_codes` from `list(codes)` and Drivers `stat_codes` through the existing `_statistics_codes`. After all Main rows exist, call `_apply_main_statistics(rows, post_count)`. Do not alter `_sealed_rows`.

- [ ] **Step 5: Run focused and service regression tests**

Run:

```powershell
C:\Users\Admin\sentinel\venv\Scripts\python.exe -m pytest backend/tests/test_timesheet_service.py -q
C:\Users\Admin\sentinel\venv\Scripts\ruff.exe check backend/app/services/timesheet_service.py backend/tests/test_timesheet_service.py
```

Expected: all pass.

- [ ] **Step 6: Commit**

```powershell
git add backend/app/services/timesheet_service.py backend/tests/test_timesheet_service.py
git commit -m "fix(timesheet): compensate client statistics leave"
```

---

### Task 2: Widen the Side Glance

**Files:**
- Modify: `frontend/src/pages/timesheet/TimesheetPage.tsx:914-919,1084-1086`
- Modify: `frontend/src/pages/timesheet/TimesheetPage.test.tsx:542-850`
- Modify: `frontend/src/pages/timesheet/TimesheetGlance.test.tsx:1-3,228-230`

**Interfaces:**
- No component API changes.
- The expanded grid track changes from `210px` to `400px`; `36px` and `0px` states do not change.

- [ ] **Step 1: Change width assertions to RED**

Replace expanded-state expectations in `TimesheetPage.test.tsx` with:

```typescript
expect(body.className).toContain('grid-cols-[minmax(0,1fr)_400px]')
```

Keep every collapsed `36px` and panel-open `0px` assertion unchanged. Update width comments in the two test files.

- [ ] **Step 2: Run the side-glance tests and verify RED**

Run:

```powershell
pnpm -C frontend exec vitest run src/pages/timesheet/TimesheetPage.test.tsx src/pages/timesheet/TimesheetGlance.test.tsx --maxWorkers=1
```

Expected: expanded track assertions fail with the current `210px` class.

- [ ] **Step 3: Change the expanded track**

In `TimesheetPage.tsx`, replace only the expanded class and its comment:

```typescript
: 'grid-cols-[minmax(0,1fr)_400px]'
```

- [ ] **Step 4: Verify frontend behavior**

Run:

```powershell
pnpm -C frontend exec vitest run src/pages/timesheet/TimesheetPage.test.tsx src/pages/timesheet/TimesheetGlance.test.tsx --maxWorkers=1
pnpm -C frontend exec tsc -b --noEmit
pnpm -C frontend exec eslint src/pages/timesheet/TimesheetPage.tsx src/pages/timesheet/TimesheetPage.test.tsx src/pages/timesheet/TimesheetGlance.test.tsx
```

Expected: all pass.

- [ ] **Step 5: Commit**

```powershell
git add frontend/src/pages/timesheet/TimesheetPage.tsx frontend/src/pages/timesheet/TimesheetPage.test.tsx frontend/src/pages/timesheet/TimesheetGlance.test.tsx
git commit -m "fix(timesheet): widen side glance"
```

---

### Task 3: Final Verification

**Files:**
- No planned source changes.

**Interfaces:**
- Confirms the two independent edits coexist without widening scope.

- [ ] **Step 1: Run focused backend and frontend checks**

```powershell
C:\Users\Admin\sentinel\venv\Scripts\python.exe -m pytest backend/tests/test_timesheet_service.py backend/tests/test_timesheet_api.py -q
pnpm -C frontend exec vitest run src/pages/timesheet/TimesheetPage.test.tsx src/pages/timesheet/TimesheetGlance.test.tsx --maxWorkers=1
pnpm -C frontend run build
```

- [ ] **Step 2: Confirm branch cleanliness and changed-file scope**

```powershell
git status --short --branch
git diff --stat main...HEAD
```

Expected: clean branch; only the approved spec/plan, backend calculation/tests, and frontend width/tests changed.