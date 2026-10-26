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

- A Department is a manager in the org tree plus everyone under them. An
  administrator marks an employee as its head (`head_employee_id`). Membership
  follows supervisor links, so moving someone in the tree moves their
  department. A department whose head sits inside another department's branch
  is its sub-department; `parent_id` is derived, never edited.
- `employees.department_id` and `departments.parent_id` are materialized only by
  `department_tree_service.recompute`, after every supervisor, employee insert,
  department and exception write. A nearest active head wins; a manual
  exception places an employee (and their branch) in another department or
  outside all departments. Supervisor cycles resolve to no department.
- Users relate through their linked employee. Admins also grant deputies and
  department viewers per department (`department_members`, roles `deputy` and
  `viewer`). The employee link confers head/branch scope and department sends;
  only an administrator sets it (account linking is admin-only since #255).
  Grant pickers list active, non-inmate-reporter accounts from
  `GET /departments/candidate-users` (`departments.manage`).
- The editor lives on `/permissions?tab=org`; the Employees org tree is
  read-only. Supervisor links stay on `employees.edit`.
- Heads and deputies see their department and every derived sub-department.
  Viewers see that department only. Every user also sees their own
  supervisor-tree branch: themselves and everyone below them.
- Admins and holders of the new `departments.all` capability (Organization-wide
  view) see every department. The manager role does not imply it.
- Each department has an explicit services list. A department with no list
  configured offers no services; organization-wide users see all services.
  A user's services come from every department they belong to (derived,
  headed, deputy or viewer).
- A user outside every department with no reports sees only their own work.
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
- A Record is stamped with its creator's derived department when it is created
  and is not re-stamped when the tree changes. Turning the switch on backfills
  unstamped Records the same way, so older work stays visible inside its
  department.
- Team-folder shares from PR #247 move from the free-text department to
  `department_id`. Keep `employees.department` as a label synchronized from the
  derived Department's Arabic name; leaving a department clears the label only
  when it still equals that department's name. Workforce continues matching
  department text in attendance snapshots, duty events, staffing requirements
  and its own scopes without a rewrite. The rollout data has Arabic labels on
  only 36 of 304 employees, zero `user_workforce_scopes` rows and zero
  `work_staffing_requirements` rows; no existing scope/requirement values need
  remapping. Historical attendance snapshots and duty events remain unchanged.
- A department whose head has no active account and which has no deputies
  cannot receive a department send (`422 DEPARTMENT_HAS_NO_HEAD`); the sender
  sees why.

Implemented migrations, in order:
- `0110_departments`: head-anchored departments, deputy/viewer grants,
  exceptions, service lists and the derived employee department.
- `0111_book_department`: Record department FK.
- `0112_department_sends`: department sends, recipient links and ID-based
  team-folder shares, retaining restricted unmatched legacy audiences.
P5 label synchronization requires no schema migration.

## Department inbox API (P4)

Migration `0112_department_sends` follows `0111_book_department`. A send accepts
up to 20 `department_ids` alongside up to 50 `user_ids`, with at least one
target required. Personal Records refuse department delivery, even when
`make_directed` is requested (`409 PERSONAL_DEPARTMENT_SEND`). Other Levels
deliver ordinary recipients to the head's active account and active deputies
only. A department with neither refuses the whole request
(`422 DEPARTMENT_HAS_NO_HEAD`); Secret skips uncleared recipients and refuses a
department with no cleared receiver (`422 DEPARTMENT_NO_CLEARED_HEAD`). Existing active department sends are
reported as `already_sent`, without replacing recipient grants.

Current heads/deputies and admins use
`GET /books/{book_id}/department-sends/{send_id}/distribution-options` and
`POST /books/{book_id}/department-sends/{send_id}/distribute`. Distribution
targets all members (derived members, head, deputies and viewers), selected
members, or a direct active sub-department.
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

Team-folder shares use department IDs, independent of the scoping switch. A
department share reaches the active users who belong to it (derived, headed,
deputy or viewer). Share options return active departments (`id`, `name_en`,
`name_ar`) and each user's derived `department_id`. Updates accept `department_ids` and
`legacy_departments` to retain; they never create new free-text shares.
Migration maps unambiguous trimmed, case-insensitive English or Arabic names.
Unmapped or ambiguous text remains restricted by the old employee-department
match and is exposed as `legacy_departments`; removing all audiences requires
an explicit `everyone=true`. Departments referenced by Records (including
deleted Records), department sends or folder shares cannot be deleted
(`409 DEPARTMENT_IN_USE`); deactivate them instead.
Downgrading `0112` snapshots each department audience as explicit shares for its
current active audience, preserving existing user and legacy-text shares. A folder
that would otherwise lose every audience becomes creator-only, never public.
Re-upgrading retains these explicit shares instead of reconstructing membership
from department names or employee labels.

The AR/EN send picker lists active departments in tree order beside people.
Heads and deputies distribute to everyone, chosen members or a subdepartment,
or keep delivery at their desk. Incoming badges name the department; the sender
sees department-level read/reached/done progress and can recall the full chain.
Folder share editing uses department IDs and separately retained legacy labels.
The employee form shows the derived department read-only.
