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
  `department_id`. Keep `employees.department` as a label synchronized from its
  Department's Arabic name on employee create/PATCH, bulk assignment and Arabic
  department rename; `department_id` wins over conflicting text. Clearing the
  assignment keeps the last label as a backfill hint. Workforce continues matching
  department text in attendance snapshots, duty events, staffing requirements
  and its own scopes without a rewrite. The rollout data has Arabic labels on
  only 36 of 304 employees, zero `user_workforce_scopes` rows and zero
  `work_staffing_requirements` rows; no existing scope/requirement values need
  remapping. Historical attendance snapshots and duty events remain unchanged.
- A department with no head or deputy cannot receive a department send
  (`422 DEPARTMENT_HAS_NO_HEAD`); the sender sees why.

Implemented migrations, in order:
- `0110_departments`: departments, memberships, service lists and employee FK.
- `0111_book_department`: Record department FK.
- `0112_department_sends`: department sends, recipient links and ID-based
  team-folder shares, retaining restricted unmatched legacy audiences.
P5 label synchronization requires no schema migration.

## Department inbox API (P4)

Migration `0112_department_sends` follows `0111_book_department`. A send accepts
up to 20 `department_ids` alongside up to 50 `user_ids`, with at least one
target required. Personal Records refuse department delivery, even when
`make_directed` is requested (`409 PERSONAL_DEPARTMENT_SEND`). Other Levels
deliver ordinary recipients to active heads and deputies only. A department
without an active head refuses the whole request (`422 DEPARTMENT_HAS_NO_HEAD`);
Secret skips uncleared recipients and refuses a department with no cleared
head (`422 DEPARTMENT_NO_CLEARED_HEAD`). Existing active department sends are
reported as `already_sent`, without replacing recipient grants.

Current heads/deputies and admins use
`GET /books/{book_id}/department-sends/{send_id}/distribution-options` and
`POST /books/{book_id}/department-sends/{send_id}/distribute`. Distribution
targets all members, selected members, or a direct active subdepartment.
Non-head callers receive 404. Hand-downs retain the department-send link and
name the distributing head as sender; subdepartment deliveries create a child
send. A recalled send refuses further distribution with
`409 DEPARTMENT_SEND_REVOKED`.

`DELETE /books/{book_id}/department-sends/{send_id}` recalls that send, all
descendant sends and their linked active recipients. The original sender,
managers/admins and (for a child send) the parent department's heads/deputies
may recall it. Independently existing recipient grants remain unchanged.
Detail and desk responses expose department progress only to the Record's
creator, the send's sender, managers/admins and that department's current
heads/deputies. Members receive their own inbox metadata, not the department
delivery history. Initial heads receive localized department push copy;
member hand-downs retain direct-send copy, with subject and sender names
omitted for every non-General Record.
An active department send also appears in its sender's outgoing desk and sent
count when every head already holds an independent recipient grant.

Team-folder shares use department membership IDs, independent of the scoping
switch. Share options return active departments (`id`, `name_en`, `name_ar`)
and users' primary `department_id`. Updates accept `department_ids` and
`legacy_departments` to retain; they never create new free-text shares.
Migration maps unambiguous trimmed, case-insensitive English or Arabic names.
Unmapped or ambiguous text remains restricted by the old employee-department
match and is exposed as `legacy_departments`; removing all audiences requires
an explicit `everyone=true`. Departments referenced by Records (including
deleted Records), department sends or folder shares cannot be deleted
(`409 DEPARTMENT_IN_USE`); deactivate them instead.
Downgrading `0112` snapshots each department audience as explicit shares for its
current members, preserving existing user and legacy-text shares. A folder
that would otherwise lose every audience becomes creator-only, never public.
Re-upgrading retains these explicit shares instead of reconstructing membership
from department names or employee labels.

The AR/EN send picker lists active departments in tree order beside people.
Heads and deputies distribute to everyone, chosen members or a subdepartment,
or keep delivery at their desk. Incoming badges name the department; the sender
sees department-level read/reached/done progress and can recall the full chain.
Folder share editing uses department IDs and separately retained legacy labels;
the employee form shows the previous label only while no department is assigned.
