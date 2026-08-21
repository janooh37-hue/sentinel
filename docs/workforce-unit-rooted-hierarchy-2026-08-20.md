# The workforce hierarchy is rooted at the duty unit, not the department

2026-08-20

## What happened

`mng update` on the production checkout pulled `0071_workforce_attendance` and
the upgrade aborted:

```
sqlite3.IntegrityError: CHECK constraint failed: ck_duty_assignment_events_to_hierarchy_prefix
[SQL: INSERT INTO duty_assignment_events (... to_department, to_unit, to_post ...)
      SELECT id, 'baseline', NULL, NULL, NULL, department, duty_unit, duty_post, ... FROM employees]
```

pysqlite runs DDL outside its implicit transaction, so the 22 `CREATE TABLE`
statements had already committed while the seeding `INSERT`s rolled back:
`alembic_version` stayed at `0070_timesheet` with 22 empty tables left behind.
They were dropped, the checkout was rewound, and the bundle was rebuilt, so the
service never restarted and no user-visible change occurred. A snapshot taken
first is at `data/gssg.db.bak-0071-20260820-010105`.

## Why it failed

The migration snapshots each employee's placement into
`duty_assignment_events`, and its own CHECK required a department-rooted prefix:
a unit was only valid beneath a department. The live roster does not look like
that.

| department | duty_unit | duty_post | employees |
| --- | --- | --- | --- |
| absent | present | present | 241 |
| absent | present | absent | 27 |
| present | present | present | 36 |

268 of 304 employees are placed by duty unit with no department recorded, so
the baseline seed could never satisfy the constraint. The department values
that do exist are also not a clean parent level: `السرية الرابعة` appears under
both `الأمن الداخلي` and `الأمن والحراسة`, and `الدوام الرسمي` appears under
three different departments. The feature had been verified only against a
seeded roster (`workforce_seed_service.seed_workforce_roster`), where every
employee has a full path.

## The decision

`department` is an optional attribute, not the root of the hierarchy. The only
prefix relation is that **a post names the unit that contains it**. The
alternative — backfilling a department for 268 employees — would have invented
an organization chart, and there is no unit-to-department mapping in the data
that could produce one.

Consequences:

- Placement rows (`duty_assignment_events`, `work_shift_overrides`) accept a
  unit and post with no department; a post with no unit is still rejected.
- Scope grants and staffing targets of kind `duty_unit` / `duty_post` no longer
  require a department. A grant constrains exactly the dimensions it names, so
  an unqualified unit grant covers that unit under any department, and a grant
  that names a department still pins both. This is not a widening of any grant
  that was valid before.
- A `department`-kind grant still requires an exact department, so the 268
  employees with none are inside no department grant. Delegating by department
  therefore stays unavailable for them until departments are recorded — which
  is a data decision, not a code one.
- The baseline seed drops a post whose unit is missing rather than aborting the
  whole upgrade for one malformed row.

`duty_service._event_hierarchy` previously discarded the unit and post whenever
the department was absent, so a duty transfer recorded an empty snapshot for
those 268 employees. It now keeps the placement it was given.

## Verification

- `backend/tests/test_workforce_migration.py` seeds all four production shapes,
  plus a post with no unit, and asserts one truthful baseline event per
  employee with no invented department.
- New DB-level tests accept a unit-rooted placement and override, and reject an
  orphan post.
- `backend/tests/test_workforce_scope_algebra.py` and
  `test_workforce_scope_hardening.py` pin the matching rules and the API path
  for a unit-scoped manager with no department.
- All five fail against the previous department-rooted rule with the same
  `CHECK constraint failed` error seen in production.
- `0071_workforce_attendance` was edited in place: it had been pushed but never
  applied to a deployed database, and `alembic heads` still reports the single
  head `0071_workforce_attendance` over `0070_timesheet`.
