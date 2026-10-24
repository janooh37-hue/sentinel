# Department scoping, rework R: departments follow the org tree

Status: approved by the user on 2026-10-23, after testing PR #258 on the dev URL. This
supersedes the membership-based department model in `department-scoping.md` (P1–P5)
wherever the two conflict. Branch: `feat/department-scoping` (PR #258). Nothing is merged
or deployed, so **migrations 0110–0112 are rewritten in place**. Do not add a 0113.

## User decisions (verbatim intent)

1. **A department is a manager in the org tree plus everyone under them.** An admin marks
   an employee in the org tree as a department head. Membership follows the supervisor
   links, so moving someone in the tree moves their department automatically. A department
   whose head sits inside another department's branch is that department's
   sub-department. This splits the admin office (الدوام الرسمي) into sections under its
   managers.
2. **A supervisor who is not a department head sees their own branch**: everyone below
   them in the tree, all levels down, plus themselves.
   - Heads and deputies see the whole department, including nested departments.
   - Plain staff see only their own work, unless an admin grants them department view.
3. **Admin controls kept on top of the tree:**
   - deputies;
   - manual exceptions: place someone in a department outside the tree, or exclude them
     from all departments;
   - services per department (unchanged, including D10: no services configured means no
     services).

   **Not** chosen:
   - Restricting tree edits to `departments.manage`. Supervisor links stay on
     `employees.edit`.
   - A new org-wide grant. The existing `departments.all` capability stays as it is.
4. **The org tree under Employees (`/employees/org-tree`) becomes read-only for everyone.**
   The tree **editor** moves to the Permissions area. It holds supervisor links plus all
   department controls. Settings → Departments goes away, so there is one place.

## Data model (rewrite 0110 / 0111 / 0112 in place)

- `departments`:
  - `id`, `name_en`, `name_ar`. Names are globally unique; there is no per-parent
    uniqueness any more, because the parent is derived.
  - `head_employee_id` (FK `employees.id` ON DELETE RESTRICT, NOT NULL, UNIQUE).
  - `parent_id`: derived and materialized, written only by recompute. FK `departments.id`
    ON DELETE SET NULL, nullable.
  - `active`, `created_at`, `updated_at`.
- `department_members`: user-level grants only. `id`, `department_id` (CASCADE), `user_id`
  (CASCADE), `role` CHECK IN (`'deputy'`, `'viewer'`), `created_at`,
  UNIQUE(`department_id`, `user_id`). **No `is_primary`, no `head`.** The head comes from
  `head_employee_id`.
- `department_exceptions`: `employee_id` PK (FK employees CASCADE), `department_id`
  nullable (FK departments CASCADE; NULL = outside all departments), `created_by`
  (str, nullable), `created_at`.
- `department_services`: unchanged.
- `employees.department_id`: derived and materialized, written **only** by
  `department_tree_service.recompute`.
- `books.department_id` (0111): stamped at insert from the creator user's
  `employees.department_id`, through `users.employee_id`. Remove the `is_primary`
  lookup, and fix the 0111 backfill the same way.
- 0112 (department sends, `book_recipients.department_send_id`,
  `book_folder_shares.department_id`): keep. Its downgrade snapshot of department audiences
  into user shares must use the new audience definition below.
- SQLite-safe: `batch_alter_table`, reversible, one head `0112_department_sends`.

## Derivation: `backend/app/services/department_tree_service.py` (new)

`recompute(db) -> int` loads all employees (`id`, `supervisor_id`), active departments and
exceptions, then:

- `passdown(e)`:
  - D if e heads an **active** department D;
  - else the exception's department if e has an exception (NULL means None);
  - else `passdown(supervisor(e))`;
  - else None.
- `department(e) = passdown(e)`. An exception therefore moves that person **and everyone
  below them**, unless someone below them heads a department or has their own exception.
- `parent(D) = passdown(supervisor(head(D)))`, or None if the head has no supervisor.
- Cycle guard: dirty data must never loop. A node on a cycle resolves to None.
- Writes changed `employees.department_id` and `departments.parent_id`.
- Label sync (P5 kept):
  - when the department is set, `employees.department = name_ar`;
  - when it becomes None, clear the label only if it equals the old department's
    `name_ar`.
- Invalidates all cached department scopes. Returns the changed count.
- Validation: an exception on an employee who heads an active department is rejected with
  422 `DEPARTMENT_HEAD_EXCEPTION`.

Call `recompute` after **every** write that can change the result:

- `org_tree_service.set_supervisor`;
- employee create, update and import paths that set `supervisor_id` or insert employees
  (grep every writer of `supervisor_id`);
- department create, update (head, active) and delete;
- exception put and delete.

Records are not re-stamped when the tree changes: a Record belongs to the department it
was created in.

## Scope: `department_scope_service`

`DepartmentScope` = `organization`, `department_ids: frozenset[int]`,
`employee_ids: frozenset[str]` (replaces `own_employee_id`; always includes self),
`kind: "organization" | "department" | "branch" | "self"`.

- **organization**: scoping off, admin role, or `departments.all`.
- With E = `user.employee_id`:
  - `department_ids` =
    - (active departments whose `head_employee_id` = E) ∪ (departments where the user is
      `deputy`), expanded with all derived descendants through `parent_id`;
    - ∪ departments where the user is `viewer` (no descendants).
  - `employee_ids` = {E} ∪ every supervisor-tree descendant of E, via a recursive CTE on
    `employees.supervisor_id`. This ignores departments and exceptions: you always see the
    people below you.
- `kind`:
  - `department` if `department_ids` is non-empty;
  - else `branch` if E has reports;
  - else `self`.
- `employee_visibility_clause` = `department_id IN department_ids OR id IN employee_ids`;
  `employee_in_scope` mirrors it.
- Book clause: keep the existing terms and add `created_by_user_id IN (users whose
  employee_id IN employee_ids)`. Mirror this in `book_in_scope`.
- `narrow_department_scope(D)`:
  - requested = D plus its descendants;
  - `department_ids ∩ requested` (all of requested for organization scope);
  - `employee_ids` filtered to those whose `department_id` is in requested.
- New helper `user_department_ids(db, user) -> frozenset[int]`: the departments a user
  *belongs to* = {E's `department_id`} ∪ departments E heads ∪ the user's deputy and
  viewer rows. Use it for:
  - service caps (`perm_service`);
  - the folder share audience;
  - the Access page grouping.

  Provide a SQL form too, for query clauses.
- The session `department_scope_kind` gains `"branch"`.

## Department send (`book_department_send_service`)

- **Receivers**: the active, non-inmate-reporter user linked to the head employee, plus
  the active deputies. Secret clearance rules are unchanged.
  - Nobody reachable: 422 `DEPARTMENT_HAS_NO_HEAD`.
  - Secret send with no cleared receiver: 422 `DEPARTMENT_NO_CLEARED_HEAD`.
- **Distribution options**:
  - members = active users whose employee's `department_id` = D, plus the viewers of D.
    The role field becomes `head | deputy | viewer | member`;
  - sub-departments = active departments with `parent_id` = D that have a reachable
    receiver.
- Everything else (409 `PERSONAL_DEPARTMENT_SEND`, hand-downs as `BookRecipient` rows,
  cascading recall) is unchanged.

## Folder shares by department

The audience of a department share is the active users whose `user_department_ids`
contains D. Unmapped legacy text shares keep the old employee-text matching, as before.

## API contract (`/api/v1/departments`, gated by `departments.manage` unless noted)

| Method | Path | Body | Response / errors |
|---|---|---|---|
| GET | `/departments` (any signed-in user) | | `DepartmentRead[]` |
| POST | `/departments` | `{name_en, name_ar, head_employee_id}` | 201 `DepartmentRead`. 409 `DEPARTMENT_NAME_TAKEN`; 409 `DEPARTMENT_HEAD_TAKEN`; 404 `EMPLOYEE_NOT_FOUND`; 422 `DEPARTMENT_HEAD_EXCEPTION` |
| PATCH | `/departments/{id}` | `{name_en?, name_ar?, head_employee_id?, active?}` | `DepartmentRead` |
| DELETE | `/departments/{id}` | | 204. 409 `DEPARTMENT_IN_USE` while Records, department sends or folder shares reference it. Otherwise delete (members, services and exceptions cascade) and recompute |
| PUT | `/departments/{id}/people` | `{deputy_user_ids: int[], viewer_user_ids: int[]}` | `DepartmentRead`. 422 if a user is in both lists |
| PUT | `/departments/{id}/services` | `{service_ids}` | unchanged |
| GET | `/departments/service-options` | | unchanged |
| GET | `/departments/exceptions` | | `DepartmentExceptionRead[]` |
| PUT | `/departments/exceptions/{employee_id}` | `{department_id: int \| null}` | `DepartmentExceptionRead` |
| DELETE | `/departments/exceptions/{employee_id}` | | 204 |
| GET | `/departments/unassigned-employees` | | `UnassignedEmployeeGroup[]` |
| GET/PUT | `/departments/scoping` | `{enabled}` | `DepartmentScopingRead` |

**Removed:**

- `PUT /departments/memberships/{user_id}`;
- `GET /departments/{id}/members`;
- `POST /departments/assign-employees`;
- the `department_id` *input* on the employee create/update schemas and on account
  create/approve. Reads still return `department_id`.

**Schemas:**

- `DepartmentRead`: `id`, `name_en`, `name_ar`, `head_employee_id`, `head_name_en`,
  `head_name_ar`, `head_user_id: int | null` (the active account linked to the head),
  `parent_id`, `active`, `employee_count`, `deputies: DepartmentPersonRead[]`,
  `viewers: DepartmentPersonRead[]`, `service_ids`, `exception_count`.
- `DepartmentPersonRead`: `{user_id, display_name, role}`, with
  `role: "head" | "deputy" | "viewer" | "member"`.
- `DepartmentExceptionRead`: `employee_id`, `name_en`, `name_ar`, `department_id` (null =
  outside all departments), `tree_department_id` (what the tree alone would give),
  `created_by`, `created_at`.
- `UnassignedEmployeeGroup`: `top_employee_id` (the highest ancestor),
  `top_name_en`, `top_name_ar`, `duty_unit`, `count`, `employee_ids`. It lists people
  whose derived department is None, grouped by tree root.
- `DepartmentScopingRead`: `enabled`, `records_backfilled`, `users_without_department`,
  `departments_without_receiver` (no reachable head account and no deputies),
  `departments_without_services`.
- `UserDepartmentRead` (on `AdminUserRead.departments`): `department_id`, `name_en`,
  `name_ar`, `role: head | deputy | viewer | member`. Drop `is_primary`.
- Org tree `OrgNode` gains `department_id` and `head_of_department_id: int | null`.
  `PATCH /org-tree/{id}/supervisor` is unchanged, plus recompute.

## Frontend

- **Employees → Organization (`/employees/org-tree`)**:
  - always read-only: remove edit mode and the `SupervisorPicker` from this page;
  - show a department badge on nodes that head a department.
- **Permissions page (`/permissions`)**: new section/tab "Organization & departments"
  (الهيكل التنظيمي والأقسام). Follow the page's existing tab pattern. It contains:
  - The tree editor, which reuses `OrgTreeView` and `SupervisorPicker`:
    - Relinking supervisors needs `employees.edit`.
    - Department actions need `departments.manage`. On a node:
      - Make department head (names dialog);
      - Edit department (names, active, delete);
      - Deputies & department viewers (user picker over active users);
      - Services;
      - Exception: place in department / outside all departments / clear.
  - A side list: departments with their derived nesting and head, unassigned groups (each
    with a "go to this person in the tree" action), the exceptions list, and the scoping
    switch with its preflight confirmation (moved from Settings).
- **Remove**:
  - Settings → Departments (`DepartmentsSection`);
  - the Access page `DepartmentMembershipEditor` and `departmentMemberships.ts`, plus its
    test (keep the grouping by department; derive it from `AdminUserRead.departments`);
  - the department pickers in the employee form and in account create/approve. Show the
    derived department read-only where it was ("From the org tree").
- `DistributeDialog`: role labels `head`, `deputy`, `viewer`, `member`.
- Arabic and English are peers; use logical CSS properties; desktop and mobile.

## Tests (TDD where the rule is new)

- **Backend** (replace the P1–P4 department tests that encode the old model; never re-pin
  old wording):
  - derivation:
    - anchor;
    - nested parent;
    - an exception moves a branch;
    - an exception to None;
    - an inactive department falls through to the department above;
    - a head exception is rejected;
    - the cycle guard;
    - moving a person in the tree moves their department;
  - scope: head and deputy see the department plus nested departments; viewer sees only
    that department; supervisor sees the branch; plain staff see only themselves; admin
    and `departments.all` see everything;
  - book clause for the branch;
  - services through `user_department_ids`;
  - send:
    - reaches the head account plus deputies;
    - `DEPARTMENT_HAS_NO_HEAD` when the head has no account and there are no deputies;
  - distribution options; folder share audience;
  - migrations up and down on a seeded DB.
- **Frontend**: update tests that break. Add new ones only for real behaviour, such as the
  read-only org tree and the gating of department actions.

## Work split (dtop worktree `/home/amh/Projects/sentinel/.worktrees/dept-orgtree`)

- **Agent `dept-be`**:
  - owns `backend/**`, `docs/**`, `CONTEXT.md`, `README.md` and the generated
    `frontend/src/lib/api.types.ts` / `backend/openapi.json`;
  - phase 1 = contract: models, migrations, schemas, routers. Regenerate openapi and api
    types (the `sync-api-types` skill). Commit;
  - phase 2 = services and tests.
- **Agent `dept-fe`**: owns `frontend/**` except `api.types.ts`. It starts after the phase 1
  commit.
- Commit only your own paths. Run `ruff format` only on files you changed. Never run
  repo-wide formatters.
- Push to `origin feat/department-scoping` after `git pull --rebase`.
- dtop commands:
  - backend: `~/.venvs/sentinel/bin/python -m pytest -n 6 <paths>`;
  - frontend: `pnpm -C frontend test <file>`, `pnpm -C frontend exec tsc -b --noEmit`,
    `pnpm -C frontend run lint`.

## Later user decisions (2026-10-23)

- The Employees org tree is read-only. The editor lives on `/permissions?tab=org`. The tab
  needs `employees.view` plus `employees.edit` or `departments.manage`.
- The deputies & viewers picker reads
  `GET /departments/candidate-users` (`departments.manage`), because `GET /auth/users`
  is admin-only.
- While scoping is on, the employee link is an authority, so `POST /auth/me/link` by a
  non-admin returns 403 `LINK_REQUIRES_ADMIN`; only admins set links.

## Evidence (rework R)

Commits:

- `34a26f65`: contract.
- `29cc82f3`, `e52cafe6`: api types.
- `330e012b`: services and tests.
- `f2f66b01`: review fixes. These cover the admin-only link, the 0112 downgrade skipping
  inactive heads, and clearing labels on rename and delete.
- `5d8a8d14`: candidate users.
- `7fc949b3`: frontend.
- `d23ab837`: frontend review fixes. These cover the editor gating on `employees.view`,
  actions on orphan roots, keeping inactive grants removable, and refreshing the session.
- `a7636550`: docs.

Checks, run on dtop at `d23ab837`:

- **Backend full suite**: 3888 passed, 4 failed, 20 skipped, 1 error. The 4 failures are
  the known `main` failures: `test_inmate_reporter` worklist, `test_0099`,
  `test_schema_utc_serialization` (book schemas only), and `test_vehicle_reminders`. The
  error is the flaky unraisable-warning teardown in `test_vehicle_import`.
- **Frontend full Vitest**: 3438 passed, 2 failed (the known `PermitDocumentVersions`
  failures). `tsc` is clean, `build` passes, and lint shows only the known
  `e2e/signature-placement.spec.ts` error.

Reviews:

- **Alembic**: one must-fix, applied.
- **Scope/security**: one must-fix (self-link escalation) and one should-fix, both applied.
- **Frontend**: two must-fix and two should-fix, all applied.
- **i18n-rtl**: run by dept-fe, fixes applied.

Smoke test on a copy of the dev data (port 8799, deleted afterwards). Every check passed:

- **Visible employees per role**, matching ID sets:
  - admin: 304;
  - head of A: 74;
  - deputy of A: 73;
  - head of nested B: 5;
  - non-head manager: 16 (branch);
  - viewer of B: 5;
  - plain operator: 1.
- **Exceptions**: placing someone and excluding someone both took effect.
- **Supervisor move**: moving a person under a supervisor in another department changed
  their department.
- **Department send**: reached the head and the deputy; distributing to the
  sub-department reached its head; the cascading recall worked.
- **Errors**: 422 `DEPARTMENT_HAS_NO_HEAD` and 403 `LINK_REQUIRES_ADMIN` returned as
  expected.
- **Services**: department services follow D10.
- **UI**: the editor works in English and Arabic at 1366px and 390px; the Employees tree
  is read-only with a department badge; a user with only `employees.view` is denied.

Preview (2026-10-24):

- The shared dev URL (`https://gssglt.tail0c00ff.ts.net/`, port 8765) is used by another
  session that publishes the `dev` branch. Its restarts replaced the swapped server
  twice.
- So the departments branch now has its own preview, which the user approved after a
  safety check:
  - `https://gssglt.tail0c00ff.ts.net:8443/`, tailnet only, no Funnel;
  - port 8766;
  - data copy `C:\Users\GSSG\gssg-dev-data-departments`, on migration 0112.
- Safety check for the copy:
  - the scheduler is off;
  - there are no SMS, WhatsApp or BioTime settings and no `.email_key`;
  - `.vapid_key` was not copied, so the copy generates its own key and pushes are
    rejected;
  - the permission-denied folders (30 MB) were skipped.
- The shared dev data was downgraded back to `0109_book_folder_shares` with its data
  kept, so the `dev` branch's next publish can migrate. The dev channel was then
  restarted with its own `dev-channel.ps1 restart`.
- `.tmp/switch-back.ps1` removes the preview: it turns off the `:8443` serve, stops 8766,
  deletes the copy and the old `.bak`, and cleans `.env` and the static build.
- The preview's sign-in cookie shares the host with the dev URL, so signing into one
  signs you out of the other.

## Redesign S: task-first department setup (user approved 2026-10-24, "build all of it")

The user found the tree-canvas editor overwhelming. Research and critique:
`research-org-department-setup.md` and `org-editor-critique.md`, both in this folder. The
critique's "Proposed screen flow" and "Rough low-fidelity layouts" are the design
contract.

**Frontend only. The data model, API and capability gates stay the same.**

- **Permissions → Organization & departments lands on a department register**, a
  table on desktop and a list on phone. It shows:
  - department, head, number of people, and one plain-language "needs attention" item:
    "Choose services" or "No one can receive Records" (meaning no head account and no
    deputy). Rows are indented by derived parent and can be expanded;
  - search across departments and people, and a unit filter;
  - a coverage line: "X of N employees are in a department · Y outside [Review]";
  - an access-limits state line with a single action;
  - primary actions "+ Add department" and "Set up departments" (the guided flow);
  - secondary links "Fix reporting lines" and "People placed by hand".

  The register replaces the units rail, the canvas, the side columns and the per-card
  building menus.
- **Guided setup, 4 resumable steps.** Persisted departments are the resume state;
  there are no drafts.
  1. **Choose heads:**
     - the 8 unit roots are suggestions, shown with "Manager + team: N";
     - "Split this unit into departments" expands a unit to its direct-report managers
       with branch sizes;
     - "Find another manager" searches the whole tree;
     - nothing is auto-selected, and you never see all 174 supervisors at once.
  2. **Names and people:**
     - Arabic and English names are required;
     - preview the derived parent and the resulting membership, calculated with
       exceptions and existing heads;
     - "Create selected departments" calls the existing POST once per department and
       reports each success or failure.
  3. **Deputies and services**, only for departments that need attention. Batch
     "apply services to selected departments" with a replace-vs-add choice. No default
     services (D10).
  4. **Review and turn on:**
     - refetch the real preflight, with fix links in context;
     - state what changes and what doesn't;
     - the action is "Turn on department access limits".
- **Department page**, with three tabs:
  - **People**: "This department" vs "Including sub-departments", search, and a "Why
    included" column (reporting structure vs placed by hand);
  - **Access & services**: deputies, "Extra department access" (the viewer grant) and
    services;
  - **Settings**: names, head, active, delete.

  "Show reporting chart" opens a read-only branch preview built on `OrgTreeView`.
- **Two separate correction tools:**
  - **Fix reporting lines** (`employees.edit`): search an employee, then Change
    supervisor, with a preview of old/new supervisor and the department impact. The
    drag chart may stay as an optional advanced view, but is never required.
  - **People placed by hand** (the exceptions API): "Use reporting structure", "Place in
    another department" or "Outside all departments", each with a before/after summary.
- **Plain wording in both languages:**
  - scoping → "Department access limits";
  - viewer → "Extra department access";
  - exception → "Placed by hand".

  Explain each term once, in context. Arabic and English are peers; use logical CSS;
  on phone, a list opens a full-page task.
- **Delete** the replaced canvas-editor parts of `pages/access/orgDepartments/**` that no
  longer have a caller. Keep `OrgTreeView` (it serves the read-only Employees tree and
  the preview) and `SupervisorPicker` (used by Fix reporting lines).
- **Tests:** register attention states; guided-setup suggestions and derived preview;
  why-included; gating stays as it is (`employees.view` plus `employees.edit` or
  `departments.manage`; reporting-line editing only with `employees.edit`, department
  actions only with `departments.manage`); the Employees tree stays read-only.

### Evidence (redesign S)

Commits:

- `5a6a84f2`: the register, guided setup, department pages, the two correction tools,
  and removal of the canvas editor.
- `26ecc77f`: review fixes:
  - the editor requires organization-wide scope (admins, `departments.all`, or access
    limits off); anyone else sees a notice instead of numbers;
  - exact sub-department and "placed elsewhere" counts;
  - previews wait for the org tree, departments and exceptions to load, with
    loading/error/retry states;
  - a single working-status population for counts;
  - step navigation is locked during batches;
  - the client-side department-parent cycle guard.
- `021eb273` and `957c3721`: every count, including the server's `employee_count`, uses
  working employees (Active, Loaned).

Checks:

- **Frontend full Vitest** at `26ecc77f`: 3456 passed. The only failures are the 2 known
  `PermitDocumentVersions` tests.
- **Type check, lint and build**: `tsc` is clean, the build passes, and lint shows only
  the known e2e error.
- **i18n-rtl review**: 0 must-fix, 7 should-fix, all applied.
- **Independent review**: 4 must-fix and 2 should-fix, all applied.

Visual check on the real preview data (304 employees), read-only with a temporary admin:

- The register, setup step 1 (admin office split into its managers), step 2 preview,
  Fix reporting lines and the placed-by-hand/outside review all render in EN and AR at
  1366px and 390px, with no phone overflow.
- The nested preview was correct.
- Data was unchanged: the SHA-256 of `employees(id, supervisor_id)` was identical before
  and after, the department tables were unchanged, and the temporary account was removed.

Known, not from this branch: the global top bar's text-size slider overlaps "Permits" at
1366px.
