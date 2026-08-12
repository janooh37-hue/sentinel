# Permissions — how enforcement actually works

**Date:** 2026-08-12
**Scope:** how a capability check reaches a request, and which routes are gated by what.
**Audit tool:** `backend/scripts/audit_capability_gates.py` (re-run any time; it reads the
tree, so it can't go stale).

This is an enforcement map, not a feature design. For the request/approval feature
built on top of this model see
`docs/superpowers/specs/2026-06-25-permissions-overhaul-design.md`.

---

## 1. Where capabilities are defined

`backend/app/core/permissions.py`

- `CAPABILITIES` — the catalog: 26 `Capability(id, group, label, description)` tuples.
  The `description` is user-facing (it drives the admin permission editor and the
  request UI).
- `CAPABILITY_IDS` / `ALL_CAPABILITIES` — the id set; `ALL_CAPABILITIES` is what the
  admin preset resolves to.
- `ROLE_DEFAULTS` — three presets keyed by role:

| Role | Resolves to | Contents |
| --- | --- | --- |
| `operator` | 13 caps | read-only across the app + the two daily-work write surfaces: `documents.generate`, `ledger.edit`/`ledger.send`, plus `email.manage` for the user's own mailbox |
| `manager` | 22 caps | operator preset plus the management writes: `employees.edit`, `employees.notify`, `leaves.edit`, `violations.manage`, `books.manage`, `books.approve`, `permits.manage`, `submitters.manage`, `editor_templates.manage`. The literal `frozenset` lists 10 additions, but `ledger.send` is already an operator default, so the union is 22 not 23 |
| `admin` | all 26 | `ALL_CAPABILITIES` |

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

Measured over all 256 `/api/v1` routes:

```
dependency-gated (require_capability / require_admin): 220
in-handler gated (perm_service.has_capability):          2
authenticated-only (login, but no capability):          30
anonymous (no session required at all):                  4
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

**Tier 2 — declarative capability (220).** `Depends(require_capability("x.y"))` in the
route signature; `require_admin` for the role-only routes in `auth.py` and `identity.py`.
`require_capability` (`api/deps.py:54`) 401s an anonymous caller and 403s a caller missing
the capability. This is the normal path and where new endpoints belong.

**Tier 3 — imperative capability (2).** `documents.py::get_document` (line 461) and
`::download_document` (lines 537, 599) call `perm_service.has_capability()` inside the
handler because the *required* capability depends on runtime state: a signature-locked
document needs `books.view`, an unlocked one needs `documents.generate`. Deliberate, and
the check runs **before** the 404 so a denied caller can't probe document ids by watching
status codes. Any review that only reads route signatures will misread these two as
ungated — hence the audit reports them as their own class.

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
which is General-Book-form-only, and creating a General Book needs `books.manage`, so a
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
