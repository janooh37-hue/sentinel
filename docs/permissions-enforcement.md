# Permissions — how enforcement actually works

**Date:** 2026-08-12 · updated 2026-10-23 for department scope and the latest gate audit
**Scope:** how a capability check reaches a request, and which routes are gated by what.
**Audit tool:** `backend/scripts/audit_capability_gates.py` (re-run any time; it reads the
tree, so it can't go stale).

This is an enforcement map, not a feature design. For the request/approval feature
built on top of this model see
`docs/superpowers/specs/2026-06-25-permissions-overhaul-design.md`.

---

## 1. Where capabilities are defined

`backend/app/core/permissions.py`

- `CAPABILITIES` — the catalog: 60 `Capability(id, group, label, description)` tuples.
  The `description` is user-facing (it drives the admin permission editor and the
  request UI). Since the 2026-08-23 granular split (§7) every id is atomic — the six
  old bundled ids (`employees.edit` in its old wide sense, `leaves.edit`,
  `violations.manage`, `books.manage`, `permits.manage`, `ledger.edit`) are gone from
  the catalog with no aliasing layer. Three of those ids survive *narrowed*
  (`employees.edit` = profile edits only, `leaves.edit`, `ledger.edit`).
- `CAPABILITY_IDS` / `ALL_CAPABILITIES` — the id set; `ALL_CAPABILITIES` is what the
  admin preset resolves to.
- `ROLE_DEFAULTS` — three presets keyed by role:

| Role | Resolves to | Contents |
| --- | --- | --- |
| `operator` | 17 caps | read-only across the app (`app.access`, `employees.view`, `leaves.view`, `timesheet.view`, `violations.view`, `books.view`, `permits.view`, `ledger.view`, `settings.view`) plus the daily-work writes: `documents.generate`, `documents.scan`, `ledger.create`/`ledger.edit`/`ledger.send`/`ledger.delete` (deletion restored post-split review — operators held it pre-split), and `email.manage` for the user's own mailbox, plus `workforce.self.view` for their own record |
| `manager` | 39 caps | operator preset minus `workforce.self.view`, plus the atomic management writes: `employees.create`/`employees.edit`/`employees.vault.manage`/`employees.notify`, `leaves.create`/`leaves.edit`/`leaves.delete`, `violations.create`/`violations.edit`/`violations.delete`, `books.create`/`books.edit`/`books.submit`/`books.templates`/`books.approve`/`books.delete`, `permits.create`/`permits.edit`/`permits.revoke`/`permits.delete`, `ledger.delete`, `timesheet.edit`, `submitters.manage`, `editor_templates.manage`. The literal `frozenset` of additions lists 24 ids; unioned with operator's 17 minus the dropped self-view that resolves to 39. Workforce administration still needs an explicit grant + scope |
| `admin` | all 60 | `ALL_CAPABILITIES` |

**Admin-only by default, but delegable.** `books.override_state` (added 2026-08-14) is
in no preset except `admin`'s `ALL_CAPABILITIES`, so only an admin holds it out of the
box — yet it is deliberately *not* in `_SENSITIVE_CAPS`, so an admin can grant it to a
specific manager. Contrast `users.manage` / `system.admin`, which no override can hand
out. See §6.

**Secret clearance.** `books.secret` (added 2026-10-12) is likewise in no preset except
admin's. It is not sensitive, but `requestable=False`: users cannot ask for it through
permission requests. Admins and managers grant or remove it with
`PUT /api/v1/auth/users/{id}/secret-clearance` (guarded by `require_admin_or_manager`,
audited as `set_permission`). Holders can open, create, and receive Secret records; see
`book_service.user_visibility_clause` for the full record-level access rule.

`default_caps_for_role()` falls back to the **operator** preset for an unknown role —
fail-soft, not fail-closed. Worth remembering if a new role is ever added.

Roles themselves come from `backend/app/core/roles.py`: `derive_role()` maps an
employee's `position` text to `manager`, with the configured admin employee id
short-circuiting to `admin`.

## 2. How a user's effective set is resolved

`backend/app/services/perm_service.py::effective_caps` (line 55)

```
admin            -> ALL_CAPABILITIES            (lockout protection, short-circuit)
everyone else    -> role_defaults + grants - denies
```

- **Role defaults come from the DB**, not the code: `role_default_caps()` reads the
  `role_permissions` table (created + seeded by migration `0018_permissions.py`), so an
  operator can retune a preset without a code change. If the table has no rows for the
  role — a fresh test DB built via `metadata.create_all` — it falls back to the in-code
  preset so the gate still works.
- **Startup reconcile:** `main.py:124-127` calls `perm_service.seed_role_defaults()` in
  the lifespan hook. It only *adds* missing `(role, capability)` rows, never deletes, so
  capabilities added to a preset after the initial seed reach deployed DBs without a
  manual migration, and an operator's own edits survive a restart.
- **Per-user overrides** live in `user_permissions` as `grant` / `deny`. A `grant` may
  carry `expires_at` (the time-limited "grant once" path); expired grants are skipped at
  resolve time rather than cleaned up.
- **Non-overridable:** `_SENSITIVE_CAPS = {"users.manage", "system.admin"}` — admin-grade
  access comes from the role only, so no override can hand out a self-escalation path.
- **Memoized per request:** the resolved set is cached on the `User` instance
  (`_effective_caps_cache`). One `User` instance per request via `get_current_user`, so
  repeated `has_capability` calls in one request cost two queries total, not two per
  check. `_invalidate_caps_cache()` clears it through the session identity map when
  permissions change mid-request.

## 3. The five enforcement tiers on a request

Measured over all 323 `/api/v1` routes (2026-08-24 audit, §5):

```
dependency-gated (require_capability / require_admin): 281
in-handler gated (perm_service.has_capability):        6
authenticated-only (login, but no capability):         32
anonymous (no session required at all):                 4
```

**Tier 0 — anonymous (4).** `system` and `auth` are the only routers mounted without the
baseline gate (`main.py:175-176`). Genuinely open: `POST /register`, `POST /login`,
`POST /logout`, `GET /health`. Every *other* handler in those two modules carries its own
`Depends(get_current_user)`, so the anonymous surface really is just those four.

The WebDAV router (`dav.py`, mounted at `main.py:173`) is also gate-free by necessity —
Word's HTTP stack sends no cookies, so it authenticates on a token in the URL.

The token does not freeze its owner's permissions. Book-backed DAV `PUT` and
write `LOCK` requests recheck current `books.edit` as well as full record write
access. Inmate reporters instead use the same narrow own-Report authoring rule
as the Word-session routes; they do not gain generic `books.edit`. Template-backed
sessions require current `books.templates`. Denied DAV requests return 404 and
leave the working file and save timestamp untouched.

Alternate record entrances enforce the same resource policy as explicit book-ID
routes: scan-back authorizes the barcode-selected record for writing before it
reveals the record's approval state or files a signed copy. Item-permit update,
deletion, regeneration and submission authorize the existing linked letter
before changing permit or approval state, so the outcome is all-or-nothing.
Personal, read-only Directed and uncleared Secret letters stay protected even
when the caller holds the permit capability; confidential denials use the
canonical record guard's 404 response. The permit capabilities delegate the
letter's edits themselves, so `books.edit` is not also required. A letter
already deleted from Records no longer gates its permit: the permit can still
be edited (the deleted letter is left as is) or deleted.

**Tier 1 — baseline session.** `auth_gate = [Depends(get_current_user)]` (`main.py:167`)
is passed as `dependencies=` on every other `include_router` call. This means "logged in",
never "authorized". Note two independent status checks behind it: `login` rejects
`status == "pending"` with 403 `ACCOUNT_PENDING` (`auth_service.py:390`), and
`resolve_session` returns `None` unless `status == "active"` (`auth_service.py:468`). A
self-registered account is `pending` until an admin approves it, so registration alone
buys nothing.

**Tier 2 — declarative capability.** The bulk of the 281 dependency-gated routes.
`Depends(require_capability("x.y"))` in the route signature; `require_admin` for the
role-only routes in `auth.py` and `identity.py`.
`require_capability` (`api/deps.py:54`) 401s an anonymous caller and 403s a caller missing
the capability. This is the normal path and where new endpoints belong.

**Tier 3 — imperative capability (6).** `documents.py::get_document` (line 461) and
`::download_document` (lines 537, 599) call `perm_service.has_capability()` inside the
handler because the *required* capability depends on runtime state: a signature-locked
document needs `books.view`, an unlocked one needs `documents.generate`. Deliberate, and
the check runs **before** the 404 so a denied caller can't probe document ids by watching
status codes. The `workforce.py` module contributes four more in the same spirit —
dashboard snapshot, both employee-attendance reads, and configuration patch — where what
a caller may see depends on their assigned scope (`workforce.self.view` for their own
record vs a scope capability otherwise), not on a static route-level id. Any review that
only reads route signatures will misread these as ungated — hence the audit reports them
as their own class.

Interactive publication uses `document_service.authorize_interactive_generation`:
`POST /documents/generate`, leave-return filing, and all four fleet publication
workflows require `documents.generate`, `books.view`, and the template's category
and effective service capabilities before rendering, reference allocation, or
persistence. General Book publication also checks its classification capability
(maintenance requests use `11/1`). Leave and fleet edit gates and nested-resource
validation remain in force; permission denial leaves publication state unchanged.

**Tier 4 — department row scope (ADR 0007).** Capabilities answer what the user may
do; `department_scope_service.resolve_department_scope` answers whose data they
may see. It is memoized per request and applied to people data, dashboard counts,
Records (alongside Levels) and service lists. Request department filters intersect
the resolved scope and never widen it. Object guards answer 404 for out-of-scope
objects, just as for missing ones; possessing an edit/view capability is not a
department-scope bypass.

- Departments follow the org tree (rework R). A Department is a head employee
  plus everyone below them through `supervisor_id`; a head inside another
  department's branch makes a sub-department, and `parent_id` is derived.
  `department_tree_service.recompute` is the only writer of
  `employees.department_id` and `departments.parent_id`, run after supervisor,
  employee, department and exception writes. Exceptions place an employee (and
  their branch) in another department or outside all departments.
- `department_scoping_enabled` defaults to false: while off, everyone resolves to
  organization scope and existing action/Level gates still apply. The preflight
  lists users without a department, departments without a receiver (no active
  head account and no deputies) and departments without services. Switching is
  reversible and audited, and enabling backfills unstamped Records from their
  creators' derived departments.
- When on, admins and holders of `departments.all` retain organization scope.
  Managers do not automatically receive it. Heads and deputies see their
  department and every derived sub-department; viewers see that department only.
  Everyone also sees their own supervisor-tree branch (scope kind `branch` when
  they have reports), including Records created by users in it. A user outside
  every department with no reports has only self scope and no services.
  Deputy and viewer grants to an inactive department confer nothing, like its
  head and derived members.
- The employee link confers head/branch scope and department-send delivery; it
  is set only by an administrator (`PATCH /auth/users/{user_id}/link` or at
  approval).
- `departments.manage` gates department create/edit/delete, deputy and viewer
  grants (`PUT /departments/{id}/people`), services, exceptions, unassigned
  groups, the picker list `GET /departments/candidate-users` (active,
  non-inmate-reporter accounts), preflight and the switch. It is admin-only by
  default, delegable and not requestable. Supervisor links stay on
  `employees.edit`. The department list `GET /departments` needs a session and
  refuses inmate reporters (403); without `departments.manage`, deputy and
  viewer names never fall back to the account email.
  `departments.all` is the separately grantable, non-sensitive Organization-wide
  view capability, also not requestable; setup permission does not imply it.
- The department editor lives on `/permissions?tab=org`. Supervisor links stay
  editable from the Employees org tree for `employees.edit` holders, as before.
- `GET /departments/account-access` returns employee profile `position` /
  `position_ar` (the titles displayed in the org tree) separately from
  `designation_en` / `designation_ar` (the latest roster designation effective
  on or before this month's start, using the org tree's shared query).
  Both accounts and unattached units expose both title sources; unit `team_size`
  counts working reports, while `team_with_manager` adds the root person.
- Active direct sends and assigned/revision-retained approval access keep their
  cross-department Record access, without bypassing Record Levels or capabilities.
  A user's services come from every department they belong to (derived, headed,
  deputy or viewer), intersected with per-service denials; an unconfigured
  department supplies no services. Inmate reporters keep their two fixed
  services: the department service filter does not apply to them.
- A department send never gives the sender their own copy: a head or deputy
  sending to their own department is skipped with reason `self`. A receiving
  head may keep a delivery (`mode: "keep"`), recorded once as `kept_at` /
  `kept_by_user_id` for the sender's progress.
- Team-folder shares already on a folder are not re-validated: a department
  deactivated later can be retained, while newly added departments must be
  active. While no active department exists, free-text department audiences
  can still be added, matched trimmed and case-insensitively as before.
- Workforce retains its independent text-based scopes. `employees.department`
  is synchronized from the derived Department's Arabic name only while scoping
  is on; turning the switch on syncs every label in the same commit, and while
  it is off labels stay free text. Leaving a department (including
  rename-and-deactivate or delete) clears the label only when it still equals
  that department's name. Historical attendance snapshots and duty events are
  not rewritten.

## 4. Fixed: `books.view` was not enforced on the register listing

**Status: fixed 2026-08-12.** Recorded because the failure mode is instructive — a
capability that every role holds by default looks enforced until someone actually uses the
deny override.

Four `books` read routes had no capability at any tier:

| Route | Handler |
| --- | --- |
| `GET /books` | `books.py::list_books` |
| `GET /books/facets` | `books.py::book_facets` |
| `GET /books/classifications` | `books.py::list_classifications` |
| `GET /book-categories` | `books.py::list_book_categories` |

`list_books` took no `user` parameter at all, and `book_service.list_books` performed no
check either — so a caller could enumerate the whole register, full-text search it via
`q`, and pass `include_deleted=true`. Every other books route already required
`books.view` (`books.py:462`, `734`, `1019`, `1112`), and both document artifact routes
required `books.view` or `documents.generate`.

**Why it was low severity, and what the real defect was.** `books.view` is in
`_OPERATOR_CAPS`, so every role holds it by default and no role gained anything from the
gap. Registration doesn't help an attacker either (tier 1 above: `pending` accounts can't
get a session). The actual defect was narrower: **a per-user `deny` override on
`books.view` was bypassable for listing and search.** `books.view` is not in
`_SENSITIVE_CAPS`, so that deny is a supported configuration — it correctly blocked every
detail and download route while silently failing to cover the register listing.

**Fix:** `Depends(require_capability("books.view"))` on all four handlers. No role loses
access, since the capability is an operator default; only an explicitly-denied user
changes behavior, which is the intended semantics.

**Regression test:** `backend/tests/test_books_view_gate.py` — parametrized over all four
routes, asserting 403 for a `books.view`-denied operator and 200 for a plain one, plus a
dedicated case for the `q` + `include_deleted=true` search path. Verified to fail (6 of
11) against the pre-fix handlers.

**Frontend impact: none.** The only callers are `BooksPage.tsx` (facets + categories),
`BookStatusChips.tsx` (rendered inside the books page), and `ClassificationField.tsx` —
which is General-Book-form-only, and creating a General Book needs `books.create`, so a
`books.view`-denied user reaching that form is already an incoherent configuration.

## 5. Re-running the audit

```bash
python backend/scripts/audit_capability_gates.py
```

Walks every route decorator in `backend/app/api/v1/*.py`, resolves gates from three
places (the router's `dependencies=`, the decorator's `dependencies=`, the handler
signature), separately detects in-handler `has_capability` calls, and cross-references
`main.py`'s `include_router` calls to tell "anonymous" apart from "authenticated but
uncapability-gated". Report only — always exits 0.

**2026-08-24 run (post-split):**

```
/api/v1 routes: 323
  dependency-gated (require_capability / require_admin): 281
  in-handler gated (perm_service.has_capability):        6
  authenticated-only (login, but no capability):         32
  anonymous (no session required at all):                4
```

Removed-id verification from the same tree: `require_capability("books.manage")`,
`("violations.manage")`, and `("permits.manage")` occur at **zero** route gates — the
only remaining mentions of those ids are historical (migration `0018_permissions.py`)
and the expansion map itself (migration `0078`). The three narrowed survivors gate only
their profile-scope routes: `employees.edit` ×7, `leaves.edit` ×4, `ledger.edit` ×10.
All other gates reference atomic ids (`books.edit` ×21, `books.templates` ×3,
`books.create`/`books.submit`/`books.delete` ×1 each, `permits.edit` ×15,
`permits.create`/`permits.revoke`/`permits.delete` ×1 each, `violations.create`/
`violations.edit`/`violations.delete` ×1 each, etc.).

**2026-10-23 run (department phases P1–P5):**

```
/api/v1 routes: 494
  dependency-gated (require_capability / require_admin): 359
  in-handler gated (perm_service.has_capability):        7
  authenticated-only (login, but no capability):         121
  anonymous (no session required at all):                7
```

This is the audit script's syntactic summary, not a security classification:
it does not resolve `Annotated` dependencies or aliases such as `DepartmentAdmin`,
nor gates such as `require_admin_or_manager`. Consequently it labels all 12
department routes "authenticated-only", although 11 require
`departments.manage`, and mislabels the two secret-clearance routes "anonymous"
despite their role/session gates. The script is report-only and writes no files.
Use Tier 4 above and `test_departments.py` / `test_department_scope*.py` for the
actual department enforcement contract; the audit does not measure row scope.

## 6. `books.override_state` — the record-state escape hatch

**Added 2026-08-14.** `PUT /api/v1/books/{book_id}/state` sets a record to any state the
register can show, bypassing the approval chain. It exists because the normal flow can
strand a record with no legitimate way out: the assigned signer left the organisation, a
paper scan will never arrive, a form was approved against the wrong record, a draft was
discarded by mistake.

**Why its own capability, not `books.approve`.** Approving is "I decide this document";
overriding is "I rewrite what the register says was decided, and by whom". A manager who
can sign should not silently also be able to mark someone else's rejection approved. Hence
admin-only by default, granted per-user when a specific manager genuinely needs it.

**Seven states, two columns.** The picker covers the six `Book.approval_state` values plus
`voided` — `Book.voided_at`, a discarded draft whose reference stays reserved in the
register. Voided lives on a separate column but reads as a state on every records surface,
so leaving it out would have made "un-discard this draft" unreachable. The pseudo-state is
stored as `approval_state="none"` + `voided_at`; `book_service.displayed_state()` and the
frontend's `recordStateOf()` are the two mirrored definitions of "which state is this".

**Chain alignment is the non-obvious part.** `BookApprovalStep` rows *are* the audit trail,
and different readers derive from either them or the aggregate — so a raw column write
would leave the record telling two stories. `_align_chain_to()` re-points the current
version's chain at the target: draft / awaiting-scan / voided drop it (neither state has a
chain in the normal flow), `pending` reopens it (building one for the doc's linked manager,
else the acting admin, when none exists), `approved` settles it, and the negative verdicts
settle the step that was in play with the reason.

**Three things it deliberately does not do:** fabricate a signature (forcing `approved`
never writes `signed_pdf_path` or embeds a signature image); delete artifacts (a filed
signed PDF survives the flip and merely stops being served, since serving keys on
`status == "approved"` — `unfile_signed_copy` is still the way to remove it); notify or
re-file in the Correspondence Log.

**Audit:** every call writes an `audit_log` row, `action="book_state_override"`,
`entity_type="book"`, with `{ref_number, from, to, reason, actor_user_id}`. `reason` is
required for `returned` / `rejected`, mirroring `decide_step`.

**Tests:** `backend/tests/test_books_state_override.py` (24 cases — the gate incl.
delegation, reachability of every state, chain alignment, artifact survival, the refusals,
the audit row) and `frontend/src/components/books/RecordStateOverrideDialog.test.tsx`.

## 7. The 2026-08-23 granular split

Six bundled capability ids were replaced by atomic per-action children. This was a
pinpoint-administration need: "edit records" and "delete records" are different risk
decisions, and a manager holding all-or-nothing `books.manage` couldn't be granted just
the submit step.

**Expansion map** (single source of truth, mirrored in the catalog and migration `0078`):

```
employees.edit    → employees.create, employees.edit, employees.vault.manage
leaves.edit       → leaves.create, leaves.edit, leaves.delete
violations.manage → violations.create, violations.edit, violations.delete
books.manage      → books.create, books.edit, books.submit, books.templates, books.delete
permits.manage    → permits.create, permits.edit, permits.revoke, permits.delete
ledger.edit       → ledger.create, ledger.edit, ledger.delete
```

Note three ids appear on both sides: `employees.edit`, `leaves.edit`, `ledger.edit`
survive **narrowed** to their profile-scope meaning (profile edits; leave amendments;
entry/list edits) while their former create/delete duties became separate ids.

**Migration contract — access preserved exactly.**
`backend/app/db/migrations/versions/0078_split_bundled_capabilities.py` (revision
`0078`, down_revision `0077_timesheet_roster_assignments`; numbered 0078 rather than the
originally planned 0074 because the upstream timesheet domain consumed 0074–0077):

- `role_permissions`: every role holding a parent gets **all** children (`INSERT OR
  IGNORE`), then parent rows are deleted — except where the parent survives as its own
  child, whose row is kept (deleting it would drop a still-held capability).
- `user_permissions`: a grant or deny on a parent becomes the same effect on every child
  (grants keep their `expires_at`), then parent rows go under the same self-child rule.
  Nobody gains or loses effective access.
- `permission_requests`: pending requests for a parent are re-pointed to its primary
  child so the approval UI keeps resolving a label.
- `downgrade()` is deliberately a no-op: the original parent rows can't be reconstructed
  from expanded children.
- `_SENSITIVE_CAPS` (`users.manage`, `system.admin`) and the admin short-circuit to
  `ALL_CAPABILITIES` are untouched (§2).

**Bulk overrides.** Managing atomic sets by hand would be tedious, so
`PUT /api/v1/auth/users/{user_id}/permissions/bulk` applies a list of grant/deny/clear
overrides in one call (service + route share `set_user_overrides`); the admin permissions
sheet offers per-domain bulk actions on top of it.

**Verification:** the 2026-08-24 audit (§5) shows zero route gates referencing any fully
removed id; backend gate tests for the new atomic gates live in
`backend/tests/test_granular_*_gates.py`, the row-expansion behaviour in
`backend/tests/test_migration_0078_expansion.py`, and the bulk endpoint in
`backend/tests/test_permissions_bulk_api.py`.

**Post-review alignments (2026-08-24, whole-branch review).** Four access-preservation /
verb-object corrections landed after the initial split: (1) `ledger.delete` was restored
to the operator preset — operators could delete entries/drafts before the split and the
expansion must not silently narrow anyone (operator resolves to 17 caps now); (2) the
ledger send-to-vault route moved from `employees.edit` to `employees.vault.manage`,
matching every other vault-write gate; (3) `POST /books/word-sessions` moved from
`books.edit` to `books.create` — it mints a new record — while finish/reopen/preview/
discard keep `books.edit`; (4) the two word-template GETs (`/books/word-templates` and
`/{name}/table`) dropped from `books.templates` to `books.edit` so record composers can
read the library without holding template-admin; rename/delete/save-as-template stay on
`books.templates`. A bulk-endpoint hardening collapses duplicate capability items in one
batch (last occurrence wins) so autoflush=False sessions can't double-insert.
