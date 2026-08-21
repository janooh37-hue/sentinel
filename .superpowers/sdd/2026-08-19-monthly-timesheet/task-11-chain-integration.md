# Task 11 — chain integration

## Status

Complete and deploy-ready. `origin/main` is merged; the Alembic graph has one head; the worktree is clean; nothing was pushed. The production checkout and production database were not touched.

Ancestry proof:

```text
git merge-base --is-ancestor origin/main HEAD && git merge-base --is-ancestor main HEAD
ancestry-ok
```

## Commits

- `84de48b` — merge `origin/main` (clean automatic merge).
- `1dae18e` — renumber the three post-0073 migrations and update model/spec/plan references:
  `0074_employee_supervisor` -> `0075_timesheet_stat_fillers` -> `0076_timesheet_start_acks`.
  The migration bodies were not changed.
- `c29c195` — order the merged `org_tree` router import; this removed the one new Ruff error in a touched file.
- `15c2aa8` — narrow the org-tree cycle diagnostic; this removed the one new mypy error in a touched file.

The merge review confirmed that `models.py` contains the complete timesheet model set and `Employee.supervisor_id`, `App.tsx` contains both timesheet and org-tree routes/imports, and `main.py`, `index.css`, and `api.ts` retain both feature blocks. The generated OpenAPI and TypeScript files were regenerated from the merged source; the generated content matched the merge result after line-ending normalization, so no artificial generated-file delta was introduced.

## Generated contract

Commands run:

```text
C:/Users/Admin/sentinel/venv/Scripts/python.exe -X utf8 scripts/dump_openapi.py
Wrote .../backend/openapi.json (247 paths)

cmd.exe /c "pnpm.cmd run gen:api"
openapi-typescript .../backend/openapi.json -> .../frontend/src/lib/api.types.ts
```

The schema contains 247 paths, including nine `/api/v1/timesheet` paths and both org-tree paths:

```text
/api/v1/org-tree/
/api/v1/org-tree/{employee_id}/supervisor
```

The generated types contain `OrgNode`, `OrgSupervisorUpdate`, `TimesheetGridResponse`, and `TimesheetStartAckRequest`.

## Alembic proof

`alembic heads`:

```text
0076_timesheet_start_acks (head)
```

There was no warning or traceback. The history tail is linear:

```text
0075_timesheet_stat_fillers -> 0076_timesheet_start_acks (head)
0074_employee_supervisor -> 0075_timesheet_stat_fillers
0073_absence_after_twice_grace -> 0074_employee_supervisor
0072_punch_profiles -> 0073_absence_after_twice_grace
0071_workforce_attendance -> 0072_punch_profiles
```


On an empty SQLite file in the system temp directory, `alembic upgrade head` ran all revisions through `0076_timesheet_start_acks`. `alembic current` printed:

```text
0076_timesheet_start_acks (head)
```

`alembic downgrade 0073_absence_after_twice_grace` printed:

```text
Running downgrade 0076_timesheet_start_acks -> 0075_timesheet_stat_fillers
Running downgrade 0075_timesheet_stat_fillers -> 0074_employee_supervisor
Running downgrade 0074_employee_supervisor -> 0073_absence_after_twice_grace
```

The downgraded database reported:

```text
alembic_version: 0073_absence_after_twice_grace
supervisor_id column: False
supervisor index: False
timesheet_stat_fillers table: False
timesheet_start_acks table: False
```

A second `alembic upgrade head` applied all three tail revisions again and `alembic current` returned `0076_timesheet_start_acks (head)`. The temporary database was deleted.

## Production simulation

The worktree snapshot was migrated to head after the merge. It had an old local tail stamp and zero rows in the two tail tables; those empty old tail tables were removed, the copy was stamped at production's `0073_absence_after_twice_grace`, and the current chain was applied. The real worktree snapshot now reports:

```text
alembic_version: 0076_timesheet_start_acks
supervisor_id column: True
supervisor index: True
timesheet_stat_fillers: True
timesheet_start_acks: True
```

A separate final production-simulation copy was made from that migrated snapshot, its tail schema was reverted in the copy only, and it was stamped `0073_absence_after_twice_grace`:

```text
source_stamp 0076_timesheet_start_acks
stamped 0073_absence_after_twice_grace
tail absent True supervisor absent True
```

Running `alembic upgrade head` against that copy printed exactly:

```text
Running upgrade 0073_absence_after_twice_grace -> 0074_employee_supervisor
Running upgrade 0074_employee_supervisor -> 0075_timesheet_stat_fillers
Running upgrade 0075_timesheet_stat_fillers -> 0076_timesheet_start_acks
```

The landing check printed:

```text
alembic_version: 0076_timesheet_start_acks
supervisor_id/index: True True
tail tables: True True
deleted: True
```

This is the deploy-relevant simulation: a database stamped at production's revision accepts all three unapplied revisions and lands at the sole head.

## Golden gate

After migrating the worktree snapshot itself, the direct command passed:

```text
C:/Users/Admin/sentinel/venv/Scripts/python.exe -m pytest backend/tests/test_timesheet_golden.py -q
.........                                                                [100%]
9 passed in 2.30s
```

The explicit July comparison reported:

```text
July compared cells: 8525
July differing cells: 0
```

## Locale and CSS checks

Locale parity output:

```text
ONLY IN EN: ['nav.bell.awaitingApproval', 'nav.bell.awaitingReturn']
only-in-ar count: 296
timesheet perms in both: True
```

The Arabic-only entries are the existing Arabic plural-form keys; the only base keys present only in English are the two pre-existing `nav.bell.*` keys. All three timesheet permission keys exist in both locales.

The required physical-property search in `frontend/src/pages/timesheet/` returned no matches for:

```text
ml- mr- pl- pr- left- right- text-left text-right
```

## Backend verification

Full backend suite (one run, against the migrated worktree snapshot):

```text
1599 passed, 3 failed
```

The three failures are the known pre-existing failures and are unrelated to this integration:

- `test_config_openwa.py::test_openwa_settings_default_dormant`
- `test_dav.py::test_dav_diagnostic_event_is_structured_and_redacted`
- `test_migration_record_included_papers.py::test_record_included_papers_migration_upgrades_and_downgrades`

No new backend failure attributable to the merge or migration renumbering occurred.

Ruff baseline after the merge:

```text
Found 22 errors.
```

They remain in the pre-existing unrelated files listed by the command; none is in a file changed by this integration. Mypy baseline after the merge:

```text
Found 32 errors in 12 files (checked 318 source files)
```

Those errors remain in pre-existing unrelated files; none is in a file changed by this integration. The two touched-file diagnostics introduced by the merge were fixed in `c29c195` and `15c2aa8`.

## Frontend verification

Each file was run in its own constrained Vitest invocation (`--pool=forks --no-file-parallelism --maxWorkers=1`):

```text
TimesheetPage.test.tsx             12 passed
TimesheetGrid.test.tsx             42 passed (React act warnings on existing keyboard tests)
TimesheetFill.test.tsx              5 passed
TimesheetDock.test.tsx             25 passed
TimesheetEntry.test.tsx             2 passed
panels/ChecksPanel.test.tsx        12 passed
panels/EmployeePanel.test.tsx      18 passed
timesheet.i18n.test.ts             361 passed
EmployeesSectionTabs.test.tsx       7 passed
orgTree.test.ts                     7 passed
dutyUnits.test.ts                   6 passed
```

Additional checks:

```text
pnpm exec tsc --noEmit -p tsconfig.app.json   PASS
pnpm exec eslint src/pages/timesheet src/locales src/components/access   PASS
pnpm run build                               PASS
```

The production build emitted only the existing large-chunk advisory; it completed successfully.

## Concerns and historical references

- The ignored worktree snapshot is now at `0076_timesheet_start_acks`; the production checkout's `data/gssg.db` was never opened or changed.
- The repository's SDD scratch history contains earlier reports and embedded historical plan/diff blocks describing the pre-final numbering. Those are deliberately historical records, not active migration references. Active migration files, model docstrings, current spec, and current plan now use the final chain.
- Nothing was pushed.
