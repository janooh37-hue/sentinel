# Task 11 — main integration

## Status

Merged `main` into `feature/monthly-timesheet` as normal merge commit:

`57ad8f77ad20841fc2242a3fceefb7cfb621c98a`

The commit message records that `main` supplies revisions `0071`–`0073`, that timesheet revisions `0074`/`0075` remain chained onto `0073` because production is stamped `0073`, and names all five additive conflict unions:

- `backend/app/core/permissions.py`
- `backend/app/db/models.py`
- `frontend/src/App.tsx`
- `frontend/src/locales/ar.json`
- `frontend/src/locales/en.json`

The merged tree keeps both workforce and timesheet models, capabilities/preset membership, routes, and locale keys. `backend/app/static/` is exactly the tracked content from `main`.

## Conflict and locale checks

No unresolved merge markers remain in `backend/` or `frontend/src/`. The remaining `=======` matches are legitimate separators in the existing mockup CSS/HTML and fixture prose, not merge markers.

The requested locale-key script produced exactly:

```text
ONLY IN EN: ['nav.bell.awaitingApproval', 'nav.bell.awaitingReturn']
only-in-ar count: 276
timesheet perms in both: True
```

Both locale files parse as JSON. The only English-only keys are the two pre-existing notification keys; all three timesheet permission keys exist in both locales.

## Alembic proof

`PYTHONPATH=backend python -m alembic heads`:

```text
0075_timesheet_start_acks (head)
```

The first 20 history lines showed the linear tail:

```text
0074_timesheet_stat_fillers -> 0075_timesheet_start_acks (head), timesheet starting-point acknowledgements
0073_absence_after_twice_grace -> 0074_timesheet_stat_fillers, timesheet stat fillers
0072_punch_profiles -> 0073_absence_after_twice_grace, absence boundary becomes twice the grace on every collapsed policy.
0071_workforce_attendance -> 0072_punch_profiles, learned punch habits per employee and shift.
0070_timesheet -> 0071_workforce_attendance, workforce attendance persistence foundation.
0069_merge -> 0070_timesheet, monthly time sheet
```

On a brand-new SQLite database in the system temp directory, `alembic upgrade head` completed through `0075_timesheet_start_acks`, and `alembic current` printed:

```text
0075_timesheet_start_acks (head)
```

Then `alembic downgrade 0073_absence_after_twice_grace` printed:

```text
INFO  [alembic.runtime.migration] Running downgrade 0075_timesheet_start_acks -> 0074_timesheet_stat_fillers, timesheet starting-point acknowledgements
INFO  [alembic.runtime.migration] Running downgrade 0074_timesheet_stat_fillers -> 0073_absence_after_twice_grace, timesheet stat fillers
tables after downgrade: ['timesheet_designations', 'timesheet_overrides', 'timesheet_periods', 'timesheet_snapshot_rows']
alembic_version: 0073_absence_after_twice_grace
new timesheet tables after downgrade: []
throwaway database deleted
```

The new `timesheet_stat_fillers` and `timesheet_start_acks` tables were both absent after downgrade, while the pre-existing `0070` timesheet tables remained.

## Verification results

### Backend

- Golden gate: `9 passed in 2.13s` (`backend/tests/test_timesheet_golden.py`). The test's July baseline is 0 differing cells of 8,525; the July comparison passed.
- Full backend suite (run once): `1591 passed, 3 failed`.
- The exact three failures are the known pre-existing, unrelated baseline failures:
  - `backend/tests/test_config_openwa.py::test_openwa_settings_default_dormant`
  - `backend/tests/test_dav.py::test_dav_diagnostic_event_is_structured_and_redacted`
  - `backend/tests/test_migration_record_included_papers.py::test_record_included_papers_migration_upgrades_and_downgrades`
- The two previously failing migration checks for document DOCX nullability and permit validity passed after the chain was completed. The remaining migration failure is the same pre-existing `docx_path` fixture mismatch, not a timesheet regression.
- `ruff check .`: 22 errors, the same pre-existing count; `ruff check` over the 21 Python files unique to the timesheet branch passed with `All checks passed!`.
- `ruff format --check` over all 71 staged Python files reports 51 main-side files that would be reformatted; the 21 Python files unique to the timesheet branch report `21 files already formatted`. No timesheet-branch file needs formatting.
- `mypy`: 32 errors in 12 files (post-merge baseline; the pre-merge baseline was 30). The additional errors are in main-side attendance/scheduler code. No mypy error is in a production Python file unique to the timesheet branch.

### Frontend

Each requested Vitest file was run independently with one fork and no file parallelism:

- `TimesheetPage.test.tsx`: 12 passed
- `TimesheetGrid.test.tsx`: 42 passed (existing React `act(...)` stderr warnings only)
- `TimesheetFill.test.tsx`: 5 passed
- `TimesheetDock.test.tsx`: 25 passed
- `TimesheetEntry.test.tsx`: 2 passed
- `panels/ChecksPanel.test.tsx`: 12 passed
- `panels/EmployeePanel.test.tsx`: 18 passed
- `src/locales/timesheet.i18n.test.ts`: 361 passed
- `employees/attendance/AttendancePage.test.tsx`: 8 passed
- `employees/attendance/attendanceModel.test.ts`: 20 passed

Additional frontend checks:

- `pnpm exec tsc --noEmit -p tsconfig.app.json`: passed with no output.
- `pnpm exec eslint src/pages/timesheet src/locales src/components/access`: passed with no output.
- `pnpm run build`: succeeded (`3318 modules transformed`, `built in 8.27s`).

## Concerns

Only the three documented pre-existing backend failures remain. Full-repository Ruff formatting and mypy include main-side baseline issues, but no error was introduced in the timesheet branch's own production files. Working tree was clean after the merge commit.
