# Permissions — how enforcement actually works

**Date:** 2026-08-12 · updated 2026-08-24 for the granular capability split (§7) · 2026-11-09 for the single record-category axis (§8) · 2026-11-16 for scoped roles (§9)
**Scope:** how a capability check reaches a request, and which routes are gated by what.
**Audit tool:** `backend/scripts/audit_capability_gates.py` (re-run any time; it reads the
tree, so it can't go stale).

This is an enforcement map, not a feature design. The rules for adding a gated feature,
capability, or role preset — and the UI visibility rule — live in
`.agents/skills/permissions/SKILL.md`. For the request/approval feature built on top of
this model see `docs/superpowers/specs/2026-06-25-permissions-overhaul-design.md`.

---

## 1. Where capabilities are defined

`backend/app/core/permissions.py`

- `CAPABILITIES` — the catalog: 63 `Capability(id, group, label, description)` tuples.
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
| `operator` | 19 caps | read-only across the app (`app.access`, `employees.view`, `expiry.view`, `leaves.view`, `timesheet.view`, `violations.view`, `books.view`, `permits.view`, `ledger.view`, `settings.view`) plus the daily-work writes: `documents.generate`, `documents.duty_transfer`, `documents.scan`, `ledger.create`/`ledger.edit`/`ledger.send`/`ledger.delete` (deletion restored post-split review — operators held it pre-split), and `email.manage` for the user's own mailbox, plus `workforce.self.view` for their own record |
| `manager` | 44 caps | operator preset minus `workforce.self.view`, plus the atomic management writes: `inmate_statistics.review`/`inmate_statistics.approve`, `employees.create`/`employees.edit`/`employees.vault.manage`/`employees.notify`, `leaves.create`/`leaves.edit`/`leaves.delete`, `violations.create`/`violations.edit`/`violations.delete`, `books.create`/`books.edit`/`books.submit`/`books.templates`/`books.approve`/`books.delete`, `permits.create`/`permits.edit`/`permits.revoke`/`permits.delete`, `ledger.delete`, `timesheet.edit`, `submitters.manage`, `editor_templates.manage`, and the read-only `store.view`. The literal `frozenset` of additions lists 27 ids; unioned with operator's 19 (sharing `ledger.delete`) minus the dropped self-view that resolves to 44. Workforce administration still needs an explicit grant + scope |
| `admin` | all 63 | `ALL_CAPABILITIES` |

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

Two further presets, `inmate_reporter` and `fleet_reporter`, are **scoped roles**: their
preset is a fixed ceiling that no override can widen, and their routes fail closed. See §9.

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

## 3. The four enforcement tiers on a request

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
never "authorized" — except for a scoped role, whose route policy `get_current_user`
applies before any handler runs (§9). Note two independent status checks behind it: `login` rejects
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

## 8. One record-category axis (2026-11-09)

The permission page used to show two category lists: the 15 record categories
(`books.category.1/1`…`15/1`, General Book classifications) and "legacy categories"
(`books.category.GS`, `HR`, `NAT`, `SC`, `INV`, `VF`, `VA`, old-only `1`/`2`/`12`,
imported ids). Most "legacy" ids were still live filing categories. Now the 15 record
categories are the only category capabilities.

- **Resolution.** `backend/app/core/record_categories.py::record_category` maps every
  record to one category: its `classification_code` if set (General Books, Security
  Permit `5/1`, Mileage Log `11/1`, annual/sick leave `3/1`/`4/1`, resignation `12/1`),
  else its service through `SERVICE_RECORD_CATEGORY` (total over `SERVICE_IDS`, enforced by
  `test_record_categories.py`), else — for the Other bucket — its persisted
  `category_id` through `LEGACY_CATEGORY_RECORD_CATEGORY` (unknown ids → `15/1`).
  `book_service.record_category_in_clause` is the SQL mirror used by the register's
  category filter.
- **Stray records answer to extra gates.** A record stored in a legacy category its
  service never files into (a form revised into a General Book keeps its HR or INV
  category; hand-filed and imported records) must also pass the `other` records gate
  (`record_categories.record_services`). A record stored in a retired category (old-only
  `1`/`2`/`12`, imported ids) must also pass the category that one maps to, whatever its
  service or classification (`record_gate_categories`). SQL mirrors:
  `book_service.record_service_clause` / `record_gate_category_in_clause`. The register,
  documents, detail checks, and creation all use these gates. Everything else answers
  only to its own service and its one record category.
- **Unchanged:** reference numbers and prefixes, `Book.category_id`,
  `Book.classification_code`, `BookCategory` rows, ledger/correspondence rules. Per-service
  visibility (`books.servicerecords.*`) stays beside per-category visibility; both must
  allow a record.
- **Migration `0117_merge_legacy_record_categories` — nobody sees more.** A deny on a live
  legacy category becomes a deny on both `books.service.<service>` (create) and
  `books.servicerecords.<service>` (see) for every service that files there, plus `other`,
  so the user can neither create nor see those records, exactly as before; a deny on an
  old-only category becomes a deny on its mapped record category. Records already filed
  in the denied legacy category outside those services are stray records, which the
  `other` deny or the mapped category deny still hides. 0117 originally also added a
  deny on a stray record's whole classification or service (an HR-filed `5/1` General
  Book denied every `5/1` record, so HR-denied users lost every entry-permit letter);
  `0118_drop_record_category_overreach` removes those denies and restores any row they
  tightened. A deny wins over an existing grant; a deny meeting an existing deny keeps the
  later expiry, a permanent one winning. A legacy grant
  never opens an opt-in service, and a temporary legacy grant narrows an existing target
  grant to its expiry. Legacy rows are then deleted; the inmate reporter's ceiling is
  `books.category.13/1`. Pending requests for legacy ids are refused with a note. A
  journal table makes `downgrade()` restore the prior rows.
- **Drift, fail-closed only.** Where exactness was impossible the migration hides more:
  the Other-service deny covers unclaimed and stray records from every category, and an
  old-only deny covers its whole merged category.

## 9. Scoped roles (2026-11-16)

A **scoped role** is a built-in, admin-assigned role with a fixed capability ceiling. The
registry is `backend/app/core/scoped_roles.py::SCOPED_ROLES`; each `ScopedRole` holds its
`ceiling`, an error-code prefix, a route policy, and the `routes_to_line_manager` flag.
Today there are two: `inmate_reporter` (`core.permissions.INMATE_REPORTER_CAPS`) and
`fleet_reporter` (`core.permissions.FLEET_REPORTER_CAPS`).

**Ceiling.** `perm_service` gives a scoped role only the dynamic service ids its ceiling
names, intersects role defaults and the override-adjusted set with the ceiling (a stale
`role_permissions` row cannot widen it), and refuses a grant override outside it with
403 `<prefix>_SCOPE_FIXED` (`INMATE_REPORTER_SCOPE_FIXED`, `SCOPED_ROLE_SCOPE_FIXED`). A
deny override still narrows it.

**Route policy** (`api/deps.get_current_user`, fail closed; missing route metadata is a
denial):

- `inmate_reporter` keeps its exact explicit allowlist,
  `scoped_roles.INMATE_REPORTER_ALLOWED_ROUTES` (403 `INMATE_REPORTER_ROUTE_FORBIDDEN`).
- `fleet_reporter` is capability-derived: a route is allowed when it carries at least one
  `require_capability` dependency (router- or route-level, read from the matched route's
  dependency tree; `require_capability` tags its dependency with `required_capability`)
  and the user holds every one of them. A route with no capability dependency is allowed
  only when it is in `scoped_roles.SCOPED_SHARED_ROUTES`. Everything else is 403
  `SCOPED_ROLE_ROUTE_FORBIDDEN`. `require_admin` routes carry no capability, so they are
  closed.

`SCOPED_SHARED_ROUTES` — the authenticated-only routes a capability-derived scoped role
may call, each self-service or gated inside its handler:

| Routes | Reason |
| --- | --- |
| `GET /auth/me`, `POST /auth/verify-password`, `PATCH /auth/me/lock-timer`, `PATCH /auth/me/lock-layout`, `GET /auth/me/capabilities`, `GET /identity/me`, `GET /employees/{employee_id}/photo` | Session, lock screen, UI capability gates and own identity; the photo route checks ownership in the handler. |
| `GET /signatures/me`, `POST /auth/me/signature` | Own signature: a Report is signed by its author. |
| `GET /templates`, `GET /templates/{template_id}/fields`, `GET /general-book/recipients` | Rich-editor form metadata and the General Book addressee picker. |
| `POST /documents/generate` | Publication; `authorize_interactive_generation` checks `documents.generate`, `books.view` and the service and category capabilities. |
| `GET /documents/{document_id}/download` | Record-owned document download; in-handler record access, PDF only for a scoped role. |
| `POST /books/word-sessions`, `GET /books/{book_id}/word-sessions`, `.../status`, `.../preview`, `POST .../finish`, `DELETE /books/{book_id}/word-sessions`, `POST /books/{book_id}/word-sessions` | Word authoring of the reporter's own General Books and Reports (`book_service.require_scoped_word_access`). |
| `GET /books/by-ref/{ref}`, `GET /books/{book_id}`, `GET .../versions/{version_id}/fields`, `.../annotations`, `.../signed-document`, `GET /books/{book_id}/imported-document` | Record reads; `resolve_book_read_access` and the role's visibility matrix decide in the handler. |
| `GET /notifications/decisions`, `POST /notifications/decisions/seen`, `GET /push/vapid-public-key`, `POST /push/subscribe`, `DELETE /push/subscribe` | The author is told when a paper is returned, rejected or finished. |

**Shared restrictions** (`scoped_roles.is_scoped_role`): no Direct send or forward via
`/send`; never a send recipient, in the user directory or in folder sharing; no Level
change; no derive; PDF-only downloads and own generation jobs only; current revision
only; confidentiality limited to General plus own Personal/Directed. Rules about Inmate
Conduct Violations forms, the global inmate manager and inmate Report-only writes stay
behind the inmate role.

**Record visibility.** Each scoped role has its own SQL matrix and Python mirror in
`book_service` (`_inmate_reporter_visibility_clause` / `_inmate_reporter_book_visible`,
`_fleet_reporter_visibility_clause` / `_fleet_reporter_book_visible`), dispatched by
`_scoped_visibility_clause` / `_scoped_book_visible`; change each pair together. A fleet
reporter sees their own papers in every state, and filed, final vehicle papers (Vehicle
Fines, Vehicle Accident Report, Vehicle Mileage Log) by anyone: pending or approved, or an
unsubmitted `auto` letter by an author outside the line-manager chain. Never another
user's General Book or Report.

**Category-exempt services.** A `ScopedRole` may name services authorised by their
service capabilities alone (`category_exempt_services`). For `fleet_reporter` that is
`Report`: a Report's record category (13/1) stays out of the ceiling, so creating, opening,
listing, revising and submitting it answer only to `books.service.Report` /
`books.servicerecords.Report`. The SQL side is `book_service._category_gate_hidden_clause`
(also used by `document_visibility_clause`); the Python side is `assert_record_type_visible`
and `require_record_type_access`. A General Book under 13/1 is still refused.

**Writes without `books.create`/`books.edit`.** A fleet reporter authors through
`book_service.require_fleet_write_access` (own General Book, Report or vehicle paper in
`none`/`returned`; a Report must stay signed by the linked employee) and
`require_fleet_word_access` (Word and DAV). Papers it creates start `approval_state="none"`
with no signing manager. It cannot choose an approver, reviewers, priority or manager (403
`SCOPED_ROLE_INPUT_FORBIDDEN`).

**Line manager.** `users.line_manager_user_id` (migration `0120_user_line_manager`) is set
by an admin with `PATCH /api/v1/auth/users/{user_id}/line-manager` (`require_admin`,
audited as `set_line_manager`). Line and branch managers must be active, hold
`books.approve` and be linked to exactly one active `Manager` (signer) row
(`manager_service.sole_active_manager_id`); that row becomes the paper's
`doc_manager_id`, so the signer printed is always the account that finishes the chain. Submitting builds one `line_manager` step; the line
manager either signs to finish, or forwards with `POST /books/{book_id}/forward-to-branch`
(gate `books.approve` plus the pending-assignee check) to an optional `branch_manager`
stage. Both stages are keyed on the step's `stage_label`, separate from
`form_policy.BRANCH_MANAGER_STAGE_FORMS`. `GET /books/{book_id}/branch-candidates` uses the
same gate.

**Tests:** `backend/tests/test_fleet_reporter_scope.py` (route policy, allowlist parity,
shared routes exist, ceiling, line-manager admin route, migration),
`test_fleet_reporter_authoring.py` (authoring and visibility) and
`test_fleet_reporter_chain.py` (the approval chain).
