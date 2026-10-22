# Department scoping, department services and the department inbox

Status: **plan for user approval** (2026-10-22). No code until approved.
Decision record: `docs/adr/0007-department-scope-and-department-inbox.md`.
Worktree: `.worktrees/department-scoping` (branch `feat/department-scoping`, cut
from `origin/main` f19e034). Dev channel only. The user approves every merge
and deployment.

## Goal (user's words, 2026-10-22)

Each department sees a general view of **its own** department, not all users
or all departments. New users are easy to sort into a department. Department
users get their own services and their own work, kept apart from
administration work. A book can be sent directed to a department.

## Decisions (user, 2026-10-22)

| # | Question | Decision |
|---|---|---|
| D1 | What a department is | A new admin-managed list (Arabic and English names) |
| D2 | How a user belongs | Membership on the user account, defaulting from the linked employee |
| D3 | How many | Normally one. Admins may give managers, admins and chosen people more |
| D4 | Scoped areas | Employees and profiles, leaves and absences, violations, Records, dashboard, services list |
| D5 | Who sees what | Heads see the whole department. Members also see each other's work in the department |
| D6 | Book sent to a department | It lands with the head, who lets everyone, chosen members or nobody see it |
| D7 | Chains and levels | Sub-departments with their own heads; a head can pass a book down to a sub-department |
| D8 | Deputies | The head plus optional deputies, with the same inbox and distribution rights |
| D9 | Administration view | Admins plus users granted the `departments.all` (Organization-wide view) capability. Managers are not automatically included |
| D10 | Services when unconfigured | No services until the department's list is configured |
| D11 | Rollout | An admin switch, after departments are assigned. Deploying changes nothing |
| D12 | Sequencing | Plan now. Build after PR #247 merges |

**Assumptions to confirm at approval.** These are not yet decided by the user.
- **A1.** Plain members of a parent department do **not** see its
  sub-departments' work. Only heads and deputies see down the tree.
- **A2.** After the switch, a user with no department sees only their own work
  and no services. The pre-flight report lists these users before the switch.
- **A3.** Permits, item permits, vehicles, ledger email, timesheet and
  Workforce keep today's rules. Workforce keeps its own scope; only its
  department legs move to `department_id` in P5.
- **A4.** Personal, Secret and Directed Levels (ADR 0006) apply as they do now.
  A department send cannot carry a Personal record, and a Secret record reaches
  only cleared heads, deputies and members.

## Prerequisite

PR #247 (`feat/ledger-book-polish`) must be merged first. It brings ADR 0006,
migrations `0104`–`0109`, `BookRecipient` direct send with read, done, archive
and recall, and team-folder department shares.

Before P1, re-cut or rebase this branch on a freshly fetched `origin/main`.
Then confirm the next migration number with `scripts/check_numbering.py` (it
is expected to be `0110`). If #247's ADR number changed, renumber ADR 0007.

## Data model (new)

| Table / column | Fields | Notes |
|---|---|---|
| `departments` | `id`, `name_en`, `name_ar`, `parent_id` (self FK, nullable), `active`, `created_at` | Unique name per parent. A parent cannot be its own descendant |
| `department_members` | `id`, `department_id`, `user_id`, `role` (`head`\|`deputy`\|`member`), `is_primary`, `created_at` | Unique (`department_id`, `user_id`). Partial unique index: one primary per user |
| `department_services` | `department_id`, `service_id` | Empty means no services (D10) |
| `employees.department_id` | FK, nullable | The free-text `department` stays read-only as a backfill hint until P5 |
| `books.department_id` | FK, nullable | Stamped from the creator's primary department at creation |
| `book_department_sends` | `id`, `book_id`, `department_id`, `parent_send_id`, `sent_by_user_id`, `purpose`, `note`, `created_at`, `revoked_at`, `revoked_by_user_id` | One active row per (book, department) |
| `book_recipients.department_send_id` | FK, nullable | Links a hand-down to its department send |
| App setting `department_scoping_enabled` | bool, default false | D11 |

New capabilities (update the counts in `test_permissions_catalog.py`):
- `departments.manage` lets a user create and edit departments, memberships and
  service lists. It is admin by default and not requestable.
- `departments.all` is the Organization-wide view. It is granted per user by
  admins, and it is not sensitive, so admins can grant it.

Every migration follows the new-migration skill: `batch_alter_table`, a
reversible downgrade, and a single head. Run the `alembic-migration-reviewer`
on each one.

## Scope resolution (one rule, SQL clause plus Python mirror)

`backend/app/services/department_scope_service.py` provides
`resolve_department_scope(db, user)`, memoized per request like effective
capabilities. It returns:
- `organization`: true for admins, for holders of `departments.all`, and for
  everyone while the switch is off.
- `member_department_ids`.
- `head_subtree_ids`: the departments where the user is head or deputy, plus
  every descendant.
- `own_user_id` and `own_employee_id`.

Clause helpers:
- `employee_visibility_clause(scope)` covers employees, leaves, absences,
  violations, expiry and dashboard counts.
- `book_department_clause(scope)` is ANDed with ADR 0006's visibility clause.
  Through the scope, a scoped user may see a Record they created, a Record in
  their member departments or head subtree, a Record where they hold an active
  direct send, or a Record where they have an approval assignment (ADR 0002).
- `allowed_service_ids(scope)`.

Object routes use `forbid_outside_department(...)`, which raises 404 and lines
up with campaign issue #204 (Q01). Request filters such as `?department=` may
only narrow the scope, never widen it, the same algebra as `WorkforceScope`.

## Phases

Each phase is one PR, with test-first service code and dev-channel
verification in AR and EN, on desktop and mobile.

### P1: Departments and membership (no visibility change)
- Models, migration, and a `departments.manage` API: CRUD, tree, members (with
  role and primary), and services list.
- **Settings → People & access → Departments**: a tree with sub-departments,
  heads, deputies, member and employee counts, and per-department services.
- **Sorting new users**:
  - The Access page users list groups and filters by department, with a
    highlighted **No department** bucket.
  - `CreateAccountPanel` and the approve flow get a department picker. It is
    preselected from the linked employee's `department_id` and becomes the
    primary member department.
  - A user's row edits memberships (add a department, set the role, set the
    primary).
- **Employees**:
  - `EmployeeForm` replaces the free-text department input with a department
    picker. The old text is shown read-only as a hint.
  - A bulk "assign employees to a department" action filters by duty unit or
    by the old department text, which makes the backfill fast.
- `sync-api-types` after the routes are added.
- Tests:
  - The tree refuses cycles.
  - One primary per user.
  - The default department follows the linked employee.
  - The head and deputy roles hold.
  - The routes are gated by `departments.manage`.

### P2: Department scope on people data plus the switch
- The resolver and clause helpers, with tests for the union, the head
  subtree, member-only visibility (A1), and org-wide plus admin.
- Scope these routes, each with a list test and a 404 test:
  - `GET /employees`, `/lookup`, `/{id}` and its sub-resources (leaves,
    violations, absences, vault, photo, signature), `/completeness`,
    `/activity` and `/org-tree/`.
  - `GET /leaves`, `/leaves/{id}`, `/leaves/awaiting-return/count` and
    `/absences/episodes`.
  - `GET /violations*`.
  - `GET /expiry` and `/expiry/summary`.
  - The dashboard summary and widgets, and the leave count in the nav bell
    (`notification_service._leaves_needing_action`).
- **Dashboard**:
  - The header names the user's department, which is the department's general
    view.
  - Org-wide users get a department filter (All, or one department) that only
    narrows.
- **Switch**: Settings → People & access → Departments → "Turn on department
  scoping".
  - The pre-flight report lists active non-admin users with no department,
    departments with no head, and departments with no services, then asks for
    confirmation.
  - The switch can be turned off again, and every change is audited.
- Run the `i18n-rtl-reviewer`.

### P3: Records and services
- `books.department_id`:
  - It is stamped at creation from the creator's primary department.
  - Turning the switch on backfills `NULL` rows from the creator's primary
    department. The backfill is idempotent and its result is reported.
- `book_department_clause` applies to Record lists, facets, counts, search,
  documents, Word and DAV sessions, notifications and folder contents, which
  is the same surface list as ADR 0006.
- The services list (`/services`, `GET /books` services, the service pickers)
  is filtered by `allowed_service_ids`, intersected with today's
  `books.service.<id>` per-user denies.
- Tests:
  - A member sees a peer's General Record and not another department's.
  - A head sees the subtree.
  - A Personal record stays creator-only.
  - Secret still needs clearance.
  - An assignee and a recipient keep access across departments.
  - An unconfigured department sees no services (D10).

### P4: Department inbox
- **Send**: PR #247's direct-send dialog lists departments beside people.
  - Sending creates a `book_department_sends` row and gives each head and
    deputy a `BookRecipient` with the chosen purpose and note.
  - With no head or deputy the send is refused with
    `422 DEPARTMENT_HAS_NO_HEAD`.
- **Head and deputy desk**, in the Ledger Books desk Incoming view:
  - Department sends are marked with the department's name.
  - The **Distribute** action offers: everyone in the department, chosen
    members, a sub-department (which creates a child department send to its
    heads), or keep it.
  - Each hand-down is a `BookRecipient` linked by `department_send_id`. The
    head can change the purpose and add a note.
- **Sender view**: the department shows as one recipient, with progress for
  head read, members reached, and done.
- **Recall**:
  - The sender's recall revokes the department send and every hand-down
    beneath it.
  - A head can recall their own hand-downs.
- **Levels**:
  - A Personal record cannot be sent to a department (skip reason `personal`).
  - For a Secret record, uncleared heads, deputies and members are skipped and
    reported (`not_cleared`).
- **Push and notifications**:
  - Heads get "new book for <department>". Members get the existing
    direct-send push.
  - A non-General record's subject is never shown.
  - Run the `notification-template-reviewer`.
- PR #247's team-folder shares move from the free-text department to
  `department_id`, with a migration that maps the existing text values.
- Tests:
  - A member sees nothing before distribution.
  - Chosen members see the book and others do not.
  - A sub-department chain works.
  - Recall cascades.
  - A deputy can distribute.
  - Secret and Personal sends are skipped.

### P5: Cleanup
- The department legs of `UserWorkforceScope` move from text to
  `department_id`.
- The free-text `employees.department` is dropped, along with its form hint
  and filter.
- `CONTEXT.md` implementation mappings are updated, along with
  `docs/permissions-enforcement.md` (rerun
  `backend/scripts/audit_capability_gates.py`) and the README access section.

## Verify (every phase)
- Narrowest `pytest` for the changed services and routes, plus
  `test_permissions_catalog.py` when capabilities change. Run the full backend
  suite once per PR in the background.
- `ruff check`, `ruff format` on the changed files, `mypy` on the changed
  modules, and `scripts/check_numbering.py`.
- Frontend: `tsc -b --noEmit`, eslint on the changed files, and `vitest` on the
  touched folders, run one at a time because of memory.
- On the dev channel, with real accounts:
  - an admin
  - an org-wide user
  - a department head
  - a deputy
  - two members of one department
  - a member of another department
  - a user with no department

  For each account, check what is visible and what answers 404, in AR and EN,
  on desktop and mobile.
- Reviews: `i18n-rtl-reviewer` (every phase), `alembic-migration-reviewer`
  (each migration), and `notification-template-reviewer` (P4).

## Evidence

(append per phase)
