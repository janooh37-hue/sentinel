# Permissions — how enforcement actually works

**Date:** 2026-08-12 · updated 2026-08-24 for the granular capability split (§7)
**Scope:** how a capability check reaches a request, and which routes are gated by what.
**Audit tool:** `backend/scripts/audit_capability_gates.py` (re-run any time; it reads the
tree, so it can't go stale).

This is an enforcement map, not a feature design. For the request/approval feature
built on top of this model see
`docs/superpowers/specs/2026-06-25-permissions-overhaul-design.md`.

---

## 1. Where capabilities are defined

`backend/app/core/permissions.py`

- `CAPABILITIES` — the catalog: 52 `Capability(id, group, label, description)` tuples.
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
| `admin` | all 52 | `ALL_CAPABILITIES` |

**Admin-only by default, but delegable.** `books.override_state` (added 2026-08-14) is
in no preset except `admin`'s `ALL_CAPABILITIES`, so only an admin holds it out of the
box — yet it is deliberately *not* in `_SENSITIVE_CAPS`, so an admin can grant it to a
specific manager. Contrast `users.manage` / `system.admin`, which no override can hand
out. See §6.

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
their profile-scope routes: `employees.edit` ×8, `leaves.edit` ×4, `ledger.edit` ×10.
All other gates reference atomic ids (`books.edit` ×20, `books.templates` ×5,
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
