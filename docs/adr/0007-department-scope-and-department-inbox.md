---
status: proposed
---

# Departments scope what users see, and a book sent to a department lands with its head

Capabilities decide *what* a user may do; nothing decided *whose* data they
see, so any holder of `employees.view`, `leaves.view` or `books.view` saw the
whole organization. We add a first-class **Department** and a **Department
scope** that narrows employees, leaves and absences, violations, the
dashboard, Records and the services list to the user's own departments.
Capabilities still gate every action; the scope only narrows rows.

- A Department is an admin-managed list (Arabic and English names) with an
  optional parent, so large departments can hold sub-departments.
- Users belong through Department membership (`head`, `deputy` or `member`),
  usually one department, with exactly one primary. Admins may give a user
  more. A new or approved account defaults to its linked employee's
  department. Employees carry their own `department_id`.
- Members see their own department's work, including each other's. Heads and
  deputies see their department and every sub-department below it.
- Admins and holders of the new `departments.all` capability (Organization-wide
  view) see every department. The manager role does not imply it.
- Each department has an explicit services list. A department with no list
  configured offers no services; organization-wide users see all services.
- A user with no department sees only their own work.
- Out-of-scope rows answer the same 404 as missing ones (as in ADR 0006 and
  campaign issue #204).

The scope narrows, never widens: Record Levels (ADR 0006), record-type denials
and Capabilities still apply inside it. Assigned approvers and reviewers keep
their revision-scoped access (ADR 0002), and active direct-send recipients keep
theirs, across department lines.

A book can be **sent to a department**. The send reaches the department's
head and deputies only, as ordinary direct sends. The head then decides who
else sees it: everyone, chosen members, nobody, or a sub-department, whose own
head decides again. Every hand-down is an ordinary direct send linked to the
department send, so Levels, read/done/archive state, recall and push all
reuse ADR 0006's single access rule. Recalling the department send recalls
every hand-down under it.

Scoping is off until an administrator switches it on. Deploying the schema
changes nothing visible. The switch shows who still has no department and
which departments have no services before it asks for confirmation.

## Considered options

- **Use the duty unit as the department.** Most employees have one, but it is a
  posting, not an organizational owner, and the names repeat under different
  parents (`docs/workforce-unit-rooted-hierarchy-2026-08-20.md`). Rejected.
- **Use the free-text `employees.department`.** 268 of 304 rows are blank and
  spellings vary; accounts without an employee would have no department.
  Rejected.
- **Extend `UserWorkforceScope` to every domain.** It matches on text values and
  models an administrator granting views of populations, not membership with
  heads. We reuse its scope algebra (union, request filters only narrow) but
  not its table.
- **Deliver a department send to every member directly.** That is simpler, but
  heads asked to control who sees what, level by level. Rejected.
- **Switch scoping on at deploy.** That would restrict every unassigned user on
  day one. Rejected in favour of an admin switch with a pre-flight report.

## Consequences

- Every scoped list, count, search, export and object route needs the scope
  clause. Each phase lists its routes and tests the 404 path.
- A Record is stamped with its creator's primary department when it is created.
  Turning the switch on backfills unstamped Records from their creator's
  primary department, so older work stays visible inside its department.
- Team-folder shares from PR #247 move from the free-text department to
  `department_id`. Department Workforce scopes move the same way, and then the
  free-text `employees.department` column is retired.
- A department with no head or deputy cannot receive a department send
  (`422 DEPARTMENT_HAS_NO_HEAD`); the sender sees why.
