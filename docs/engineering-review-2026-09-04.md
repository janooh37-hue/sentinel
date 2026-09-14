# GSSG Manager — Engineering Usability Review

Date: 2026-09-04
Scope: code structure, session/token behaviour, maintainability, concurrent-user capacity, database access patterns, frontend networking.
Method: static reading of the checked-out repository (every claim below carries a `path:line` citation) plus a measured load test run on this Linux workstation (Intel i7-7820HQ, 8 threads, `nproc`=8) against a synthetic SQLite database seeded to the plan's fixed sizes (25 users, 304 employees, 3,000 leaves, 400 books/100 pending, 5,000 ledger entries). The load harness (`/tmp/gssg-load/`) is throwaway and not part of this commit; every number in §6 traces to a `results-*.json` file produced by it. This is **not** a security audit.

---

## 1. Summary

- **Architecture**: one FastAPI/SQLAlchemy process (uvicorn, no workers) in front of a single SQLite file, serving both the JSON API and the built React SPA, backed by an in-process APScheduler and a `ProcessPoolExecutor(max_workers=1)` for Word→PDF conversion.
- **Access model**: there is no access-token/refresh-token pair anywhere in this codebase. Auth is a single opaque, server-side-validated session cookie (`gssg_session`) with a 7-day absolute TTL, no sliding renewal, and no idle timeout — a signed-in tab is valid until exactly 7 days after login, then fails with no client-side warning.
- **Measured capacity on this box**: the app serves 5-15 concurrent tabs comfortably (all requests <300 ms, zero errors) but **collapses between 15 and 20 concurrent tabs** — at 20 tabs, 74% of requests fail and the survivors take 15+ seconds. The root cause is a hard-coded 15-connection SQLAlchemy pool (`pool_size=5, max_overflow=10`) that every request — including the SSE notification tick every 2.5 s per open tab — competes for; this is a **configuration ceiling on commodity hardware**, not a hardware limit (CPU/RAM headroom is ample even at 100 tabs).
- **The two hardest structural ceilings**: (1) a SQLite `BEGIN IMMEDIATE` write lock is held for the entire span of a committed document generation — Word/PDF conversion included — so on the real Windows host, one person generating a document blocks every other writer in the building; (2) the SSE notification stream recomputes full-table state for every open tab every 2.5 seconds on the same fixed connection pool, which is what actually exhausts the pool first.
- **Maintainability verdict**: a large, conventionally organized, well-tested (239 backend + 224 frontend test files) codebase with real but bounded rot — two 2,000+-line service god-modules, 44 services importing from the API-error layer (inverted dependency), several import cycles hidden by deferred imports, and a frontend still on non-strict TypeScript. None of this blocks day-to-day work; all of it will slow down the next six months of feature work if untouched.

---

## 2. Structure

### Request flow and module inventory

`backend/app/main.py` is the FastAPI app factory (`backend/app/main.py:170-289`). It installs three exception handlers (`backend/app/api/errors.py:99-144`: `AppError`, `RequestValidationError`, and a catch-all `Exception` handler that logs the full traceback and returns a generic `INTERNAL_ERROR` 500), a request-body-size cap (`MAX_BODY_BYTES = 30 * 1024 * 1024`, `backend/app/main.py:66`), gzip, and then mounts 40 versioned routers under `/api/v1` (`backend/app/main.py:206-252`, confirmed by `grep -c 'include_router.*prefix="/api/v1"' backend/app/main.py`; three source files register two router objects each — `employees_v1.router`+`.violations_router`, `documents_v1.documents_router`+`.jobs_router`, `books_v1.router`+`.categories_router` — so the 40 mounted routers come from 37 distinct router-module files, not 40 files), each gated by `Depends(get_current_user)` at the router level (`main.py:198`) plus per-endpoint `Depends(require_capability(...))`. Routers are thin: they call into `app/services/*_service.py` (89 top-level service modules), which in turn call `app/core/*` pure logic and `app/db/repos/*` (3 repo modules) or raw `select(...)` directly.

Counted directly in this checkout:
- Backend: **71,838** Python lines under `backend/app` (`find backend/app -name '*.py' | xargs wc -l`).
- Frontend: **157,004** ts/tsx lines under `frontend/src`, of which the generated `frontend/src/lib/api.types.ts` is **25,054** (131,950 excluding it).
- 37 `api/v1` router modules (`find backend/app/api/v1 -maxdepth 1 -name '*.py' ! -name '__init__.py' | wc -l`; mounted as 40 router objects — see above), 89 service modules, 47 schema modules, 3 repo modules, 31 `<Route>` entries in `frontend/src/App.tsx`.
- 88 Alembic migration files under `backend/app/db/migrations/versions`, one linear head `0084_merge_0083_heads` (`backend/app/db/migrations/versions/0084_merge_0083_heads_merge_outlook_and_vehicle_heads.py:1-14`).
- 334 sync `def` route handlers vs 21 `async def` (grep across `backend/app/api/v1/*.py`).

Largest backend modules (`wc -l`, verified directly — a few of these differ from the plan's draft numbers, which had two pairs transposed; the figures below are freshly measured):
| Module | Lines |
|---|---|
| `backend/app/services/book_service.py` | 2,507 |
| `backend/app/services/document_service.py` | 2,304 |
| `backend/app/db/models.py` | 2,065 |
| `backend/app/services/timesheet_service.py` | 1,717 |
| `backend/app/api/v1/workforce.py` | 1,435 |
| `backend/app/core/arabic_rtl.py` | 1,488 |
| `backend/app/core/docx_engine.py` | 1,109 |
| `backend/app/services/scheduler_service.py` | 1,022 |

Largest frontend modules:
| Module | Lines |
|---|---|
| `frontend/src/lib/api.ts` | 2,494 |
| `frontend/src/index.css` | 2,113 |
| `frontend/src/pages/timesheet/TimesheetGrid.tsx` | 1,640 |
| `frontend/src/pages/application/ApplicationPage.tsx` | 1,557 |
| `frontend/src/pages/access/PermissionsPage.tsx` | 1,358 |
| `frontend/src/pages/dashboard/DashboardPage.tsx` | 1,322 |

### Layering violations and import cycles

36 of the 37 routers import `app.db` directly — the sole exception is `templates.py`, which only calls into `template_service` — and 24 `select(` calls appear across 11 of those routers instead of going through a service (e.g. `backend/app/api/v1/documents.py:82-100`, `backend/app/api/v1/workforce.py:1093-1202` — every `list_overrides`/`list_requirements`/`list_attendance_policies` handler in `workforce.py` builds its `select(...)` inline).

44 service modules import from `app.api.errors` — the API layer's own error type — which is a backwards dependency for a would-be layered architecture (services should not know about the API layer). Confirmed directly: `backend/app/services/auth_service.py:25` (`from app.api.errors import AppError, ValidationFailedError`); the same import appears in 43 other service modules.

Real (if narrow) import cycles are hidden by deferring the import to inside the function body rather than the module header:
- `book_service.sign_book` imports `document_service` and `included_papers_service` at call time, not at module load (`backend/app/services/book_service.py:1093`: `from app.services import document_service, included_papers_service`), because `document_service` imports back into `book_service`-adjacent code for the reverse direction.
- `notification_service` similarly composes across `book_service`, `scan_inbox_service`, `ledger_service`, and `leave_service` (`backend/app/services/notification_service.py:185-219`).

### Duplication

`_utcnow`/`_as_utc`/similar naive-UTC helpers are independently reimplemented in at least `backend/app/services/auth_service.py:46-47`, `backend/app/db/models.py:53-55`, and other service modules rather than shared from one place — confirmed by direct reads of both files (identical one-line bodies: `datetime.now(UTC).replace(tzinfo=None)`).

Pagination style is inconsistent: `employee_service.list_employees` (`backend/app/services/employee_service.py:38-95`) and `ledger_service.list_entries` (`backend/app/services/ledger_service.py:186-420`) both do SQL `LIMIT`/`OFFSET`, but `workforce.py`'s cursor endpoints materialise the *entire* result set with `db.scalars(select(...))` (no `LIMIT` in SQL) and slice it in Python inside `_cursor_page` (`backend/app/api/v1/workforce.py:111-130`, sliced at `rows[offset:offset+limit]`, line 126) — confirmed directly for `/workforce/roster` (`:449-454`), `/workforce/overrides` (`:1090-1107`), and `/workforce/requirements` (`:1155-1159`).

`CLAUDE.md` (110 lines) and `AGENTS.md` (61 lines) independently describe the same facts — the same pytest/ruff/mypy/pnpm commands, the same request-flow architecture, the same i18n-rtl-reviewer requirement, the same Alembic single-head rule, the same skill list — in different wording (verified by reading both in full; they are not byte-identical, but they duplicate the same *content* and will drift if one is updated without the other). `backend/app/core/README.md` is stale: it still frames the codebase as "v3.5.4" and references "Phase 09" migration work (`backend/app/core/README.md:1-20`) that is long complete.

### Gates and tests

`pyproject.toml` configures ruff (`E,W,F,I,B,UP,SIM,RUF`, `pyproject.toml:37-47`) and `mypy --strict` (`pyproject.toml:52-57`) for the backend. `frontend/tsconfig.app.json` has **no** `"strict"` key at all (confirmed by reading the file in full — it sets `noUnusedLocals`/`noUnusedParameters`/`noFallthroughCasesInSwitch` but never `strict: true`). There is no `.github/` directory (confirmed: `find .github -type f` returns nothing) — no CI workflow runs any of these gates on push; they run only via local editor hooks (`.codex/hooks/post-edit.ps1:20-55`, `.claude/hooks/alembic-heads-guard.ps1`).

Test coverage is real: 239 backend `test_*.py` files, 224 frontend `*.test.ts(x)` files, 4 Playwright e2e specs (`find` counts against this checkout). `backend/tests/conftest.py` uses an in-memory SQLite engine for service-level tests and a per-test file-backed DB for API tests (`backend/tests/conftest.py:35-125`) — WAL mode is off in both, so **the test suite never exercises the WAL/lock-contention behaviour this review measures in §6**; the collapse documented below is invisible to `pytest`.

---

## 3. Access & sessions

**There is no access-token/refresh-token pair in this system, and no refresh endpoint.** Authentication is a single opaque, `token_urlsafe(32)` session token, delivered as the `gssg_session` httpOnly cookie (`backend/app/api/deps.py:24`; issued in `backend/app/services/auth_service.py:441-453`). Only the SHA-256 hash of the token is stored server-side, in `auth_sessions.token_hash` under a unique index (`backend/app/db/models.py:1418-1443`, unique index at `:1441`). Cookie attributes: `Max-Age=604800` (7 days), `HttpOnly`, `SameSite=Lax`, `Path=/`, and `Secure` only when `GSSG_SECURE_COOKIES=1` (`backend/app/api/v1/auth.py:72-84`, gated by `backend/app/config.py:69`).

### Lifecycle and UX consequences

- **Absolute 7-day TTL, no renewal.** `SESSION_TTL = timedelta(days=7)` (`backend/app/services/auth_service.py:40`). `resolve_session` never extends `expires_at` (`auth_service.py:456-475`) — it only checks `row.expires_at < _utcnow()` and returns `None` past that point. **Every user is forced to re-authenticate exactly 7 days after login, mid-session, with zero client-side warning** — there is no countdown, no "session expiring soon" toast, nothing.
- **No idle expiry.** Because there is no sliding window, a browser tab left open and unused for weeks stays authenticated for the full 7 days from the original login, not from last activity. (The separate lock-screen feature, `idle_lock_seconds` default 1800 s, re-verifies the *password* against the same still-valid session — `frontend/src/lib/useLockState.ts:17` — it does not touch, renew, or reissue the session token.)
- **Write-on-GET touch.** `last_seen_at` is updated (and committed) at most once per 60 seconds per session (`SESSION_TOUCH_INTERVAL`, `auth_service.py:42`, throttle logic at `:470-474`). This is a write on an otherwise read-only `GET` path, and — as measured directly in §6/4a — is the exact commit that fails with `sqlite3.OperationalError: database is locked` while another writer holds the database.
- **No 401 interceptor on the frontend.** The generic fetch wrapper (`frontend/src/lib/api.ts:1008-1017`, `unwrap` at `:990-1006`) throws a typed `ApiError` for any non-2xx response with no special case for 401 — confirmed by reading the full function body. Only `AuthProvider`'s own `GET /auth/me` query treats a 401 specially, mapping it to `null`/logged-out (`frontend/src/lib/AuthProvider.tsx:19-33`, `staleTime: 5*60_000` = 300 s, `retry: false`). Consequence: when a session expires mid-page, every *other* in-flight or subsequent query surfaces as a raw per-call `ApiError` (silent console noise, broken widgets) until the next `/auth/me` refetch — triggered only by the 60 s heartbeat, window focus, or reconnect — finally flips the app to the login screen. There can be up to ~60 seconds (or longer if the tab is backgrounded, since `useRefreshHeartbeat` skips ticks while `document.hidden`) of a half-broken UI with no login prompt.
- **Revocation is real but narrow.** Logout revokes exactly one session row (`auth_service.py:496-506`); password reset and account lock/status changes revoke *all* of a user's sessions (`revoke_user_sessions`, `:478-493`). The DAV (Word WebDAV) editing-session tokens are a **separate** mechanism (`BookEditSession.token`, `backend/app/db/models.py:158-183`) with **no `expires_at` column at all** (confirmed: the model has only `created_at`/`last_put_at`) and no expiry cleanup job — a DAV session is only ever closed by an explicit finish (`backend/app/services/word_book_service.py:516-524`, `session.state = "finished"` at line 519) or discard; an abandoned one (browser crash mid-edit) stays "active" indefinitely, permanently locking that book's `book_edit_sessions` unique-active-per-book index (`models.py:176-183`).

### Per-request cost

Every protected request costs 2 `SELECT`s at minimum: one for the session row by hash, one `db.get(User, ...)` (`auth_service.py:456-469`). A capability-gated endpoint for a non-admin user adds up to 2 more (`perm_service._role_and_dynamic_caps` — role defaults UNION category defaults in one query, `backend/app/services/perm_service.py:44-65` — plus a per-user `UserPermission` override query, `perm_service.py:130-134`, inside `effective_caps` at `:111-147`). This is memoised only on the request-scoped `User` ORM instance (`user._effective_caps_cache`, `perm_service.py:121-146`) — there is no cross-request cache, so every request re-derives capabilities from scratch. Admins short-circuit to the full capability set and skip the override query (`perm_service.py:126-127`) but still pay the role-defaults query.

### Rate limiting

Login is limited to 10 attempts/60 s, registration to 5/60 s, both keyed on `request.client.host` (`backend/app/core/ratelimit.py:24-29,60-62,76-80`), using an in-process `dict` + `threading.Lock` (`:32-52`) — correctly process-local for the single-process deployment model. `serve.py` trusts `X-Forwarded-For`/`X-Forwarded-Proto` only from `127.0.0.1` (`backend/serve.py:58-64`), which is exactly Caddy and cloudflared on the same host (`deploy/Caddyfile:29-31`), so the limiter keys on the real client IP for both LAN and public (`gssg.app`) traffic — this is correct as-is and needs no change. Account lockout is separate: 5 failed password attempts locks the account for 15 minutes (`auth_service.py:35-36`).

---

## 4. Database access patterns

### Process and pool model

One uvicorn process, no `--workers` (`backend/serve.py:51-72`; the Windows NSSM service launches it the same way). uvicorn 0.32.1, FastAPI 0.115.5, SQLAlchemy `>=2.0,<3.0` (`requirements.txt:2-6`). SQLite is opened via `create_engine` with no explicit `poolclass`, so SQLAlchemy 2.x defaults to `QueuePool(pool_size=5, max_overflow=10)` — **15 connections total**, `pool_timeout=30` s (SQLAlchemy default, not overridden) (`backend/app/db/session.py:59-76`). WAL mode, `busy_timeout=5000` ms, `synchronous=NORMAL`, 64 MB page cache, 256 MB mmap are set via a `connect` event listener (`session.py:29-56`). `get_db()` only closes the session on teardown — there is no commit/rollback wrapper (`session.py:99-105`); every write path must call `db.commit()` itself.

**Measured, not theoretical: this 15-connection pool is the system's dominant capacity ceiling on this box.** See §6 for the full measurement; the mechanism is that both the SSE notification tick (every 2.5 s per open tab, each opening its own short-lived session — `backend/app/api/v1/notifications.py:100-113`) and every ordinary request's own session compete for the same 15 slots, and once concurrent demand exceeds that, new requests queue for up to `pool_timeout=30` s before SQLAlchemy raises `sqlalchemy.exc.TimeoutError: QueuePool limit of size 5 overflow 10 reached, connection timed out, timeout 30.00` — reproduced verbatim in this run's server log (§6/Appendix).

### Write lock held across Word COM (Windows-only, cannot be measured on this box)

Committed document generation calls `allocate_ref_with_retry` (`backend/app/services/document_service.py:1358-1362`), which opens a `BEGIN IMMEDIATE` transaction (`backend/app/db/repos/refs_repo.py:74-107`, via `begin_immediate_if_idle`) that is **not committed until line 1983** of `document_service.py` — after docxtpl fill, ref/QR stamping, `convert_docx_to_pdf` for the primary document and any companion document (`:1904-1929`), and `included_papers_service.publish_generated_package` (`:1960-1973`). On the real Windows host, `convert_docx_to_pdf` submits to a `ProcessPoolExecutor(max_workers=1)` and blocks on `Future.result(timeout=120)` (`backend/app/services/_pdf_executor.py:23-27,53-54`) — Word COM conversion is single-worker and can take several seconds per document. **One committed document generation therefore holds the sole SQLite write lock for its full render+convert time**; every other writer in the building — including the `last_seen_at` touch on any GET request — waits up to `busy_timeout=5000` ms and then fails with `database is locked`. `backend/app/core/docx_engine.py:352-354` explicitly acknowledges this ("We must NOT open a second SessionLocal() here: the generation path holds a BEGIN IMMEDIATE write lock"). Announcement fan-out has the same shape at smaller scale: it flushes the parent row, then loops synchronous OpenWA HTTP sends for every target group *inside* the same transaction before the final `db.commit()` (`backend/app/services/announce_service.py:256-302`).

Measured proof of the mechanism (fault experiment 4a, §6): holding a `BEGIN IMMEDIATE` transaction on the exact row `allocate_ref_with_retry` touches (`book_ref_sequence`) for 20 seconds, three times 60 s apart, produced three confirmed `sqlite3.OperationalError: database is locked` failures on `resolve_session`'s `last_seen_at` commit (`auth_service.py:474`), with full recovery to 200 immediately after each `COMMIT`.

### Scheduler writer cadence

In-process APScheduler `BackgroundScheduler` (`backend/app/services/scheduler_service.py:786-802`), each job opening its own `SessionLocal()` and committing — one more competitor for the same 15-connection pool. Confirmed cadence directly from the job registration code (`scheduler_service.py:803-912`): scan-inbox drain, push notifier, grant sweep, notify retry every **1 minute**; delivery poll and OpenWA health every **5 minutes**; workforce occurrence generation every **15 minutes**; workforce retention daily at 03:00, punch profiles at 03:20, leave-ending reminder at 09:00, pending-departure flip at 09:05, vehicle reminders at 09:10 (all Asia/Dubai); monthly digest on the 1st at 08:00. Measured (§6/4c): running the scheduler alongside a 25-tab load (external gateways disabled, so jobs no-op quickly) produced an error/latency profile statistically indistinguishable from the scheduler-off baseline — **the pool is already saturated by SSE + request traffic alone before the scheduler adds anything measurable**.

### Hot endpoint query counts

- `GET /dashboard/summary`: 12 independent statements (`backend/app/services/dashboard_service.py:107-134` composes 6 in `_compute_totals` — employees_active, on_leave_count, forms_this_month, open_violations_count, draft_count, book_draft_count, at `:142-215` — plus 1 each for `_on_leave_today` (`:227-259`), `_upcoming_leave_ends` (`:262-296`), `_recent_documents`, `_recent_ledger` (`:347-387`), and 2 inside `_email_sync` — `get_account` plus the incoming-count query, `:395-425`). **Both leave widgets (`_on_leave_today`, `_upcoming_leave_ends`) build their `select()` with no `.limit()` at all** — confirmed by reading both statements in full; a very large "on leave today" or "leave ending soon" set is returned unbounded.
- `GET /employees`: `employee_service.list_employees` is itself paginated (`backend/app/services/employee_service.py:38-95`, `LIMIT`/`OFFSET`), but the route handler adds one further **unbounded** query — `SELECT DISTINCT employee_id FROM vault_files WHERE kind='photo'` over the *entire* table, every call, to build the `has_photo` flag (`backend/app/api/v1/employees.py:114-119`). `GET /employees/completeness` loads every `status='Active'` employee unfiltered with `.all()` and computes gaps in Python (`employees.py:141-165`, `db.query(Employee).filter(...).all()` at line 147).
- `GET /ledger`: `list_entries` builds a filtered `select` plus a parallel `count_stmt` (`backend/app/services/ledger_service.py:186-420`) — 2 base statements, growing by 1 each for `smart_folder_id` resolution and per-user flag joins when those filters are active.
- Timesheet grid: 10 named per-month query helpers in `timesheet_service.py` alone (`_designations_by_id`, `_roster_assignments_on`, `_roster`, `_leaves_by_employee`, `_absences_by_employee`, `_overrides_by_employee`, `_fillers_by_employee`, `_start_acks`, `_employees_by_id`, `_display_names`, `:354-519`), plus 2-3 more in `_leave_change_issues` (`:594-670`) for change-detection audit lookups — consistent with the plan's "13-19 queries" estimate for a full grid render. `_roster` (`:397-420`) reads **every** employee row (`select(Employee)`, no filter) and applies the roster-membership predicate in Python.
- Workforce cursor endpoints (`/workforce/roster`, `/workforce/attendance/exceptions`, `/workforce/overrides`, `/workforce/requirements`, `/workforce/policies`) all materialise their full row set server-side and slice it in Python inside the shared `_cursor_page` helper (`backend/app/api/v1/workforce.py:111-130`) rather than pushing `LIMIT`/`OFFSET` into SQL.

### Missing indexes

`grep -c 'index=True' backend/app/db/models.py` returns **0** — every index in the schema is an explicit `Index(...)` in `__table_args__` (69 in `models.py`, 19 in `workforce_models.py`; confirmed by direct count, not the plan's draft figure of 20). Hot predicates with no supporting index, confirmed by reading the relevant `__table_args__` blocks:
- `leaves`: indexed on `(employee_id, start_date)` and a natural-key uniqueness constraint (`models.py:410-423`), but **not** on bare `status`, `end_date`, or `(status, deleted_at, start_date, end_date)` — exactly the predicate `dashboard_service._compute_totals`'s `on_leave_count` and both leave widgets filter on.
- `ledger_entries`: 9 indexes exist (`entry_date`, `counterparty`, `(direction, channel)`, `related_employee_id`, `related_book_id`, `owner_user_id`, `message_id`, `source_kind`, `category_id` — `models.py:1166-1176`), but none combine `(owner_user_id, channel, direction, read_at, deleted_at)` — the exact predicate `unread_email_count`/`_leaves_needing_action`-adjacent unread queries filter on.
- `employees`: indexed on `status` and `supervisor_id` only (`models.py:111-113`); `name_en` (used for `ORDER BY` in `list_employees`) and `end_date` (used by the pending-departure filter) have no index.

---

## 5. Frontend networking

### Steady-state cadence (per open, authenticated tab)

| Interval | Endpoint | Where mounted | Citation |
|---|---|---|---|
| once, on mount | `EventSource('/notifications/stream')` held open | shell, always | `frontend/src/hooks/useNotificationStream.ts:60-67,128-144` |
| 120 s fallback | `GET /notifications/counts`-equivalent safety poll | shell, always | `useNotificationStream.ts:24,60-67` |
| 60 s, paused if `document.hidden` or a form is dirty (dirty-tracking is currently wired to nothing — see below) | invalidates **every** active query | shell, always | `frontend/src/hooks/useRefreshHeartbeat.ts:5-17` |
| 60 s | `GET /announcements/status` | shell, always | `frontend/src/lib/useGatewayStatus.ts:8-11,18-28` |
| 60 s | `GET /auth/users`, `GET /expiry/summary` (admin only) | nav bell | `frontend/src/components/shell/NavBellPopover.tsx:93-110` |
| 120 s | `GET /ledger/unread-recent?limit=5`, `GET /books/awaiting` | nav bell | `NavBellPopover.tsx:83-90,120-126` |
| 60 s | `GET /books/awaiting`, `GET /books/awaiting-scan?scope=mine`, `GET /ledger/unread-recent` | mobile dock | `frontend/src/components/shell/useWaitingSignals.ts:16-17,37-57` |
| 30 s | scan inbox list | Scan Inbox page | `frontend/src/pages/scanInbox/ScanInboxPage.tsx:35-39` |
| 30 s idle / 2 s while syncing | email sync status | Outlook sync widget | `frontend/src/pages/ledger/outlook/useSyncStatus.ts:17-29` |
| 5 s | book status while a Word handoff dialog is open | Word handoff dialog | `frontend/src/pages/books/WordHandoffDialog.tsx:83-91` |
| 3 s (status) / 20 s (QR) | WhatsApp gateway connect dialog | Gateway connect dialog | `frontend/src/pages/announcements/GatewayConnectDialog.tsx:35-47` |
| 500 ms ×~10, then 2 s | document generation job status | `/documents/generate` job poll | `frontend/src/pages/application/JobStatus.tsx:52-56` |

QueryClient defaults: `staleTime: 15_000`, `gcTime: 5*60_000`, `retry: 1`, `refetchOnWindowFocus: true`, `refetchOnReconnect: 'always'` (`frontend/src/App.tsx:104-114`).

**The 60 s heartbeat's "pause while editing" guard is dead code.** `editingRegistry.isAnyEditing()` only returns `true` if something calls `setEditing`, and nothing in the codebase does — confirmed by reading `globalRefresh.ts` in full: the comment at `frontend/src/lib/globalRefresh.ts:18-22` states this explicitly ("scaffolding only — nothing calls `setEditing` yet"). So every open tab refetches **every currently-active query** every 60 seconds unconditionally (except when the tab is backgrounded).

### SSE fan-out cost

Server: `POLL_SECONDS = 2.5` (`backend/app/api/v1/notifications.py:42`); every open tab's stream recomputes `notification_service.relevant_counts` on the shared threadpool via `anyio.to_thread.run_sync` every tick regardless of whether anything changed (`notifications.py:144-166`), and only *emits* a frame when the result differs from the last one (`:157-163`) — the docstring at `notifications.py:84-93` records that this exact mechanism previously exhausted the connection pool in production at the 16th concurrent SSE viewer (login itself started 500ing). `relevant_counts` (`backend/app/services/notification_service.py:185-219`) costs, per tick per tab: 1 capability check, `list_awaiting` (a **full scan** of every pending book with `selectinload` of versions and approval_steps, filtered in Python by `your_step_kind`, `book_service.py:1324-1337`), 1 scan-inbox count, 1 unread-email count, and `_leaves_needing_action` (`notification_service.py:159-172`) — a **full page-through of every leave row** in 500-row pages, evaluating `needs_action` per row in Python. A scheduler-computed `precomputed_leaves` shortcut exists precisely to avoid this per-tick full scan (`notification_service.py:175-182`) but the SSE path never passes it (`:214-217`) — so the expensive path always runs, once per tab, every 2.5 seconds.

Client: on each changed frame, `useNotificationStream` fires **9** separate `invalidateQueries` calls (`frontend/src/hooks/useNotificationStream.ts:79-89`): `['books','awaiting']`, `['books','awaiting-scan']`, `['leaves-list','report-all']`, `['scan-inbox','count']`, `['ledger','unread-recent']`, a bare `['ledger']` prefix (which invalidates *every* active ledger query, not just one), `['ledger-unread-count']`, `['ledger-log']`, `['notifications','counts']`. One approval decision anywhere in the org therefore causes every other open tab to refetch its entire visible ledger view and book-approval queues.

### Cold first paint, bundle, service worker

Dashboard: 2 route-owned requests (`summaryQuery` + `layoutQuery`, `frontend/src/pages/dashboard/DashboardPage.tsx:173-187`), plus shell-level `/auth/me`, capabilities, and the SSE connection. Employees lookup reuses the dashboard's cached `['dashboard']` query for on-leave tinting (`frontend/src/pages/employees/EmployeeLookupPage.tsx:91-95`, dedup'd against Dashboard if already cached) and adds its own `['expiry',90]` and `['employees-completeness']` queries from `LookupHeroCards` (`frontend/src/components/employees/LookupHeroCards.tsx:196-213`).

Vite splits 4 manual vendor chunks — `vendor-react`, `vendor-query`, `vendor-i18n`, `vendor-radix` (`frontend/vite.config.ts:48-59`) — on top of 29 `React.lazy` route chunks (`frontend/src/App.tsx:69-101`). The service worker caches **only** `/assets/*` (content-addressed, cache-first) and lets every navigation and `/api/` call pass straight through untouched (`backend/app/static/sw.js:7-9,27-35`) — confirmed by reading the fetch handler in full: any request whose path doesn't start with `/assets/` returns without `respondWith`, so it is never intercepted.

### Error handling gaps

No 401 interceptor (§3). `JobStatus.tsx` gives up after 5 consecutive poll failures (`frontend/src/pages/application/JobStatus.tsx:45,72-80`) but every *other* poller above has no such circuit breaker — a downed backend leaves every poll silently retrying at its fixed interval forever, each one throwing an uncaught `ApiError` into the React Query error state with no user-visible distinction from a one-off blip.

---

## 6. Capacity

### Method

Environment: `/tmp/gssg-load/venv` (Python 3.12.14), backend dependencies installed from `requirements.txt` plus `aztec-code-generator`/`zxing-cpp` (present in `pyproject.toml:13-14` but **absent from `requirements.txt`** — a real drift bug: a clean `pip install -r requirements.txt` cannot boot `app.main`, since `backend/app/core/qr.py:19` imports `aztec_code_generator` unconditionally; noted here as a maintainability finding, not fixed, since it is out of this issue's scope). Server launched via `backend/serve.py` with `GSSG_DATA_DIR=/tmp/gssg-load/data GSSG_PORT=8765 GSSG_HOST=127.0.0.1 GSSG_SMS_ENABLED=0 GSSG_OPENWA_ENABLED=0` (scheduler disabled for the main capacity sweep, enabled only for experiment 4c). Database seeded via Alembic (`alembic current` → `0084_merge_0083_heads (head)`) then a custom ORM seed script to the plan's fixed sizes, verified via `sqlite3`: `25|304|3000|100|5000` (users|employees|leaves|pending books|ledger entries) — exact match.

Load driver: asyncio + httpx, one simulated "tab" per task, tokens round-robin over the 25 seeded users (so N>25 means multiple tabs sharing one user's session cookie, matching real multi-tab browser use). Each tab: on connect, `GET /auth/me`, `/dashboard/summary`, `/employees?limit=30`, then holds `GET /notifications/stream` open for the run; every ~60 s (jittered) re-fetches those three plus `/announcements/status`, `/ledger/unread-recent?limit=5`, `/books/awaiting`, `/scan-inbox/count`, `/ledger/flag-count`; every ~15 s (jittered) one navigation GET alternating `/ledger?limit=50` / `/leaves?limit=50`. 403s from capability gates on operator accounts are expected and excluded from the error count. Each level ran for a 30 s ramp (staggered tab starts) + 180 s steady window; the server process was restarted cold between every level. Server RSS/CPU% sampled every 5 s via `ps -o rss=,pcpu= -p <pid>`.

Levels run: the required **5, 10, 25, 50, 100**, plus two supplementary levels (**15, 20**) added after the 10→25 jump turned out to span the entire failure cliff, to locate it precisely — all under `/tmp/gssg-load/results-<N>.json`.

### Results

| N tabs | Total requests | Errors | Error % | `/dashboard/summary` p50 / p95 / p99 (ms) | SSE held full window | Server CPU avg/max % | Server RSS max (MB) |
|---:|---:|---:|---:|---|---:|---|---:|
| 5 | 181 | 0 | 0.0% | 65 / 79 / 91 | 5/5 | 27 / 96 | 234 |
| 10 | 362 | 0 | 0.0% | 61 / 125 / 149 | 10/10 | 41 / 51 | 238 |
| 15 | 496 | 0 | 0.0% | 85 / 149 / 276 | 15/15 | **193** / 263 | 304 |
| **20** | 516 | **380** | **73.6%** | **15,009** / 15,014 / 15,016 | 1/20 | 132 / 227 | 307 |
| 25 | 633 | 508 | 80.3% | 15,009 / 15,014 / 15,017 | 4/25 | 138 / 235 | 321 |
| 50 | 1,230 | 1,100 | 89.4% | 15,009 / 15,013 / 15,023 | 4/50 | 109 / 225 | 376 |
| 100 | 2,443 | 2,311 | 94.6% | 15,009 / 15,013 / 15,015 | 64/100 | 88 / 234 | 496 |

("p50/p95/p99" past the collapse point cluster at ~15,000 ms because that is the load driver's own client-side read timeout — the server itself had not yet responded when the client gave up; see below for what the server actually did.)

### What actually happens at the collapse

Server logs at N=20 and above show a single, consistent failure signature, not a lock or a crash:

```
sqlalchemy.exc.TimeoutError: QueuePool limit of size 5 overflow 10 reached, connection timed out, timeout 30.00
```

raised from `perm_service.has_capability` → `_role_and_dynamic_caps` → `db.execute(...)` (e.g. on `GET /books/awaiting`) and equally from the very first thing every request does — `auth_service.resolve_session` (`deps.py:37`) — meaning **the app fails closed for every authenticated request once the pool is exhausted, not just the expensive ones**. FastAPI's catch-all handler (`errors.py:133-144`) does convert this into a clean `500 INTERNAL_ERROR` JSON envelope when it has the chance, but the *default* SQLAlchemy `pool_timeout` is 30 seconds — nearly double this load driver's own 15 s client timeout — so a real browser's `fetch()` (no explicit timeout) would sit for up to 30 seconds per request before getting that 500. Every failure recorded as `ERR` in the table above is a client-side giveup at 15 s; the true server-side failure latency is longer.

This is a **connection-pool ceiling, not a hardware ceiling**: CPU usage tops out at 263% (of 800% available on this 8-thread box — under a third of capacity) and RSS at 496 MB on a machine with headroom to spare; the single fixed `pool_size=5, max_overflow=10` is what runs out, at a load level (~15-20 concurrent tabs, each holding one SSE connection plus firing periodic requests) that is well within a 25-person office's normal usage.

### Fault experiments (all at N=25, same harness)

**4a — write-lock hold** (reproduces the committed-document-generation lock on the real Windows host): while a 25-tab load was steady, `hold_lock.py` opened its own `sqlite3` connection, ran `BEGIN IMMEDIATE; UPDATE book_ref_sequence SET next_value=next_value WHERE id=1` (the exact row `allocate_ref_with_retry` touches), held it 20 seconds, committed, three times 60 s apart. **Three confirmed occurrences** of `sqlite3.OperationalError: database is locked` (16:06:19, 16:07:36, 16:07:40 local), all originating from `auth_service.py:474` (`resolve_session`'s `last_seen_at` `db.commit()`) on `GET /ledger`, `GET /dashboard/summary`, and `GET /ledger/unread-recent` — one in the first hold burst, two in the second; the third burst produced none. The 70 s-extension fallback was not needed. All three requests returned to 200 immediately after the corresponding `COMMIT`. Full traceback in Appendix.

**4b — approval reject fan-out**: `POST /books/{id}/reject` was issued against pending books via `fanout_trigger.py`, in **two separate invocations against two separate server processes — not one continuous steady run**. The server log records a full restart between them (`FastAPI app ready` at 16:09:33+0400, then again at 16:13:58+0400); the first session's own log shows near-simultaneous failing GETs across `/auth/me`, `/dashboard/summary`, `/ledger`, `/employees`, `/leaves`, `/announcements/status`, `/books/awaiting`, `/scan-inbox/count`, `/ledger/flag-count`, and `/notifications/stream`, confirming a 25-tab load was genuinely active during it — but that `load.py` process's own results were never persisted, so **no `results-*.json` file exists for this first session** (unlike every other figure in this section). The first invocation targeted book 1, then book 2, whose request failed with the same `sqlalchemy.exc.TimeoutError: QueuePool limit of size 5 overflow 10 reached` seen throughout §6 (`/tmp/gssg-load/data/logs/gssg.log:1491`, 16:12:14+0400); the script, not yet resilient to per-book failures, aborted there. It was then rewritten to tolerate per-book failures and re-run against 5 fresh books (6-10) against the freshly restarted server, this time inside a documented `load.py --tabs 25` run (`results-25-4b.json`: 506/632 = 80.1% aggregate error rate, already deep in the same collapse as the N=25 baseline's 80.3%). Of the **7 total attempts** across both sessions (books 1, 2, 6, 7, 8, 9, 10), the database's current `approval_state` — the only artifact common to both sessions — independently confirms exactly **2 succeeded**: books 1 and 6 are now `rejected`; books 2, 7, 8, 9, 10 remain `pending`. **No raw artifact records book 1's response time or status code**; the earlier framing of it as "200, issued during ramp, before pool saturated" is dropped here as unverifiable, and it is cited only as "succeeded" per the DB state. `results-25-4b.json`'s `sse` field records **zero** `counts` frames delivered to any of the 25 concurrently-open tabs during the second invocation (`total_frames: 0`, all 25 streams disconnected); no equivalent SSE artifact exists for the first invocation. Full per-book table with citations in the Appendix. This remains the sharpest finding in the whole review: under realistic peak load, an approval decision may not even complete, and when it does, the actor's own other tabs do not learn about it via SSE.

**4c — scheduler enabled**: re-ran the N=25 level with the in-process scheduler active (external gateways disabled so jobs no-op quickly). Result: aggregate error rate 504/629 = **80.1%**, statistically indistinguishable from the 508/633 = **80.3%** scheduler-off baseline at the same level (both effectively "the system has already collapsed" and adding scheduler writers on top does not measurably worsen an already-saturated pool). The two runs are not meaningfully distinguishable; the scheduler is not the binding constraint here, the SSE+HTTP request volume already is.

### Derived thresholds

- **p95 of `/dashboard/summary` > 1 s**: crosses between N=15 (149 ms) and N=20 (15,014 ms) — no intermediate data point between 15 and 20 was collected; the transition is a cliff, not a slope.
- **Any 5xx without the fault experiment**: none of the plain capacity-sweep failures returned an actual `5xx` status within the 15 s client window (they are all client-side `ERR` from a still-pending server request); the fault experiments (4a) did produce a genuine `500` from the server. Read together with the pool-timeout mechanism above, every one of the N≥20 failures would eventually surface as a `500 INTERNAL_ERROR` if a client waited the full 30 s.
- **Server CPU% > 80%**: crosses already at N=15 (193% average, 263% peak) — **before** any request fails. This means the box is visibly working hard at 15 tabs while still serving every request correctly; the failure cliff at 20 is caused by the fixed pool size, not by running out of CPU.
- **Combined verdict**: **comfortable up to ~10-15 concurrent tabs** (fast, zero errors, but CPU already elevated by 15); **starts to fail between 15 and 20**; **unusable at 20 and above** (majority of requests never complete within a normal browser's patience).

### What a user experiences, per tier

- **5-10 tabs** (a small team actively using the app): every request under 150 ms, indistinguishable from a local dev server.
- **15 tabs**: still fast and error-free, but the single server process is now using the equivalent of ~2.6 CPU cores continuously — on this box that is headroom; on a lower-spec machine it would already be the limiting factor.
- **20-25 tabs** (a mid-size department, or one team plus a few extra tabs per person): the app becomes unusable. Roughly three-quarters of requests either hang for 15-30 seconds before failing, or never resolve within the observation window. Login, the dashboard, the notification bell — everything degrades simultaneously and indiscriminately, because the failure mode is a shared resource (the connection pool), not a slow individual endpoint.
- **50-100 tabs**: no worse in kind, only in degree (89-95% error rate) — the system does not fall over harder, it is already fully saturated by 20.

### Windows-production ceiling this box cannot measure

The Linux measurement above is optimistic relative to the real deployment target in three ways that only compound the numbers above: (1) it has no Word installed, so it never exercises the `ProcessPoolExecutor(max_workers=1)` PDF conversion path or the multi-second `BEGIN IMMEDIATE` hold across it (§4) — on Windows, **at most one document generation can be in flight for the entire organization at any moment**, and every other writer (including the `last_seen_at` touch every request makes) queues behind it for up to `busy_timeout=5000` ms before failing; (2) the production host is specified at 8 GB RAM (`SERVER-MIGRATION.md:110-111`) versus this measurement box's headroom; (3) this run used `127.0.0.1` directly — no Caddy TLS termination or cloudflared tunnel hop in the path, both of which add latency and their own connection-handling behaviour in production. The historical incident recorded in the code itself (`notifications.py:84-93`: "the 16th concurrent viewer exhausted the pool" in production) predates this review and independently corroborates the same root cause at a similar order of magnitude.

---

## 7. Prioritised fixes

Ranked by usability impact per unit of effort — highest-impact, lowest-risk first.

1. **Release the write lock before Word/PDF conversion.** In `document_service.py` (~`:1358-1364` through `:1983`), split the transaction: allocate the ref and commit in its own short `BEGIN IMMEDIATE` transaction, then render/convert *outside* any open transaction, then insert the `Document`/`Book`/version rows in a second, separate transaction (safe because refs are already unique and reserved). Apply the same split to `announce_service.py:256-302` (commit the parent row, then loop the OpenWA sends outside any held write transaction, then record results in a final short commit). This directly removes the Windows-production ceiling in §6 and is the single highest-impact fix in this review.
2. **Stop recomputing full-table notification state per tab, per tick.** In `notification_service.relevant_counts` (`:185-219`), pass the scheduler's existing `precomputed_leaves` value through the SSE path (it is computed once already, at `notification_service.py:175-182`, but the stream never uses it, `:214-217`) and replace `list_awaiting`'s full-scan-plus-Python-filter (`book_service.py:1324-1337`) with a direct SQL `COUNT` over `BookApprovalStep WHERE assignee_user_id = :uid AND state = 'pending'`. Consider raising `POLL_SECONDS` (`notifications.py:42`) from 2.5 s to 5 s once the per-tick cost is cheap. This is what directly caused the §6 collapse and the 4b finding (approvals never reaching the actor's own tab).
3. **Move the `last_seen_at` touch off the request path.** It is the exact write that failed under lock contention in experiment 4a (`auth_service.py:470-474`). Write it from the SSE tick (which already runs every 2.5 s per session) or a periodic batch job instead, so a plain `GET` never takes the SQLite write lock.
4. **Sliding session renewal + a 401 interceptor.** Extend `expires_at` on touch in `resolve_session` (`auth_service.py:456-475`) instead of only checking it, so active users are never force-logged-out mid-session; add a 401 handler in `frontend/src/lib/api.ts`'s `unwrap` (`:990-1006`) that resets the `['auth']` query and routes to login immediately instead of waiting for the next heartbeat/focus/reconnect. Add an `expires_at` column and a cleanup job to `BookEditSession` (`models.py:158-183`) so abandoned Word sessions stop permanently locking a book.
5. **Stop invalidating every active query every 60 seconds.** `useRefreshHeartbeat` (`useRefreshHeartbeat.ts:5-17`) should scope its invalidation to the current route's keys, not `refetchType: 'active'` globally. Narrow the SSE handler's 9-key invalidation (`useNotificationStream.ts:79-89`) — in particular the bare `['ledger']` prefix — to the specific keys that actually changed. Either wire `editingRegistry.setEditing` into the dirty-form surfaces it already has a comment promising (`globalRefresh.ts:18-22`), or remove the dead pause-while-editing branch entirely.
6. **Only after 1-3 are done**, widen the pool: `create_engine(..., pool_size=20, max_overflow=20)` in `session.py:67-74`, and raise anyio's default worker-thread limiter (`anyio.to_thread.current_default_thread_limiter().total_tokens = 64`) at startup. Doing this *before* fixing the per-tab SSE cost and the write-lock hold would only let more requests queue behind the same slow operations — it widens the queue, not the throughput.
7. **Indexes and pagination.** Add indexes for the predicates identified in §4 (leave `status`/`end_date`, ledger `(owner_user_id, channel, direction, read_at, deleted_at)`, employee `end_date`); add `.limit()` to `dashboard_service._on_leave_today`/`_upcoming_leave_ends` (`dashboard_service.py:227-296`); convert the workforce cursor endpoints (`workforce.py:111-130` and its 5+ call sites) from Python-side slicing to SQL `LIMIT`/`OFFSET`.
8. **Maintainability.** Move `AppError` out of `app.api.errors` into `app.core` (or a new `app.errors`) to remove the 44 inverted service→API imports; split `document_service.py`/`book_service.py` along their existing deferred-import seams (`book_service.py:1093`); turn on `strict: true` in `frontend/tsconfig.app.json`; add a CI workflow (currently none) running ruff, mypy, the alembic-heads check, and at minimum the backend test suite on every push; fix the `requirements.txt` drift (`aztec-code-generator`/`zxing-cpp` are in `pyproject.toml` but missing from `requirements.txt` — a fresh `pip install -r requirements.txt` cannot boot the app).

---

## 8. Appendix

### Harness description

`/tmp/gssg-load/` (not committed): `venv/` (Python 3.12.14 + `requirements.txt` + 2 packages missing from it), `seed.py` (deterministic ORM seed to the fixed sizes above, writes `tokens.json`), `load.py` (asyncio/httpx load driver, writes `results-<N>.json`), `hold_lock.py` (fault experiment 4a), `fanout_trigger.py` (fault experiment 4b), `data/gssg.db` (the seeded SQLite file). Server run via `hub start`/`restart` (`backend/serve.py`, cold-restarted between every level).

### Environment differences vs production

Linux (this box) vs Windows (production); no Microsoft Word (PDF conversion path never exercised); synthetic 25-user/304-employee dataset vs the real ~304-person org referenced in `docs/workforce-unit-rooted-hierarchy-2026-08-20.md:36`; direct `127.0.0.1:8765` vs Caddy TLS + cloudflared in front. **Absolute latencies measured here are optimistic**; the relative shape of the curve (fast → cliff between 15 and 20 tabs → flat saturation) and the exact failure mechanism (`QueuePool` exhaustion, confirmed by server-log stack traces, not inferred) are what transfer to production, and if anything the Windows host's extra hop (Word COM lock hold, TLS termination, lower CPU headroom under service overhead) makes the real ceiling *lower*, not higher.

### Full traceback — experiment 4a (write-lock hold → `database is locked`)

```
{"ts": "2026-09-04T16:07:36+0400", "level": "ERROR", "logger": "app.api.errors",
 "msg": "Unhandled exception on GET /api/v1/dashboard/summary\n...
  File \"backend/app/services/auth_service.py\", line 474, in resolve_session
    db.commit()
  ...
sqlalchemy.exc.OperationalError: (sqlite3.OperationalError) database is locked
[SQL: UPDATE auth_sessions SET last_seen_at=? WHERE auth_sessions.id = ?]
[parameters: ('2026-09-04 12:07:31.496538', 3)]"}
```
Two further occurrences: one earlier, at 16:06:19 (on `GET /ledger`, inside the *first* 20-second hold burst), and one 4 seconds after the traceback above, at 16:07:40 on `GET /ledger/unread-recent` (inside the *second* burst, alongside the `/dashboard/summary` occurrence shown). The third burst produced no lock error. All three requests returned 200 immediately after the corresponding `COMMIT`. hold_lock.py's own log: `BEGIN IMMEDIATE acquired ... holding 20.0s` / `COMMIT at ...` for all 3 scheduled bursts — the first burst alone produced a failure, so the 70 s-extension fallback in the plan's contingency was not exercised.

### Full traceback — QueuePool exhaustion (N≥20 baseline)

```
sqlalchemy.exc.TimeoutError: QueuePool limit of size 5 overflow 10 reached,
connection timed out, timeout 30.00
  File "backend/app/api/deps.py", line 37, in get_optional_user
    return auth_service.resolve_session(db, gssg_session)
  File "backend/app/services/auth_service.py", line 460, in resolve_session
    row = db.execute(...)
```
and, equivalently, from `backend/app/api/deps.py:65` inside `require_capability`'s `_dep` → `perm_service.has_capability` → `_role_and_dynamic_caps`. Both are the very first database access any protected request makes.

### Fault experiment 4b — raw fan-out data

Two separate script invocations against two separate server processes — the server log shows a full restart between them (`FastAPI app ready` at 16:09:33+0400, then again at 16:13:58+0400), so this is not one continuous run.

First invocation (books 1, 2). No `results-*.json` survives this server session; outcomes below are corroborated only by the server log and the database's current state:
| Book | Assignee | Outcome | Evidence |
|---|---|---|---|
| 1 | user1 (admin) | succeeded (no raw timing/status artifact survives) | `approval_state = 'rejected'` (`sqlite3 /tmp/gssg-load/data/gssg.db`, queried directly) |
| 2 | user2 | `sqlalchemy.exc.TimeoutError: QueuePool ... timeout 30.00` on the server; script (not yet resilient to per-book failures) aborted here | `/tmp/gssg-load/data/logs/gssg.log:1491`, 16:12:14+0400; `approval_state` still `pending` |

Second invocation, after `fanout_trigger.py` was made resilient to per-book failures (books 6-10, 15 s client timeout), against the freshly restarted server, correlated with its own `results-25-4b.json` (started_at 12:13:59 UTC, finished_at 12:17:36 UTC; 506/632 = 80.1% aggregate error rate — already deep in the pool-collapse regime, matching the N=25 baseline's 80.3%):
| Book | Assignee | Result | Sent at (UTC) | Evidence |
|---|---|---|---|---|
| 6 | user1 (admin) | 200 | 12:14:47.499 | `fanout-events.json`; `approval_state = 'rejected'` |
| 7 | user2 | `ReadTimeout` (client) | 12:15:11.410 | `fanout-events.json`; server-side `QueuePool` timeout at `gssg.log:1695` (16:16:35+0400); `approval_state` still `pending` |
| 8 | user3 | `ReadTimeout` (client) | 12:15:46.453 | `fanout-events.json`; no server-side log entry at all (request still queued for a pool connection when the harness moved on); `approval_state` still `pending` |
| 9 | user4 | `ReadTimeout` (client) | 12:16:21.496 | `fanout-events.json`; no server-side log entry; `approval_state` still `pending` |
| 10 | user5 | `ReadTimeout` (client) | 12:16:56.539 | `fanout-events.json`; no server-side log entry; `approval_state` still `pending` |

Across all 7 attempts, the database's current state is the only artifact common to both sessions: books 1 and 6 are `rejected`, books 2, 7, 8, 9, 10 remain `pending` (`sqlite3 /tmp/gssg-load/data/gssg.db "select id, approval_state from books where id in (1,2,6,7,8,9,10)"` → `1|rejected`, `2|pending`, `6|rejected`, `7|pending`, `8|pending`, `9|pending`, `10|pending`). `results-25-4b.json`'s `sse` field records zero delivered `counts` frames to any of the 25 concurrently-open tabs during the second invocation (`total_frames: 0`, `streams_held_full_window: 0`, all 25 disconnected); no equivalent SSE artifact exists for the first invocation.

### Capacity sweep — endpoint-level detail (selected)

`/dashboard/summary` p50/p95/p99 (ms) and error count, all 7 levels:

| N | p50 | p95 | p99 | errors / count |
|---:|---:|---:|---:|---|
| 5 | 65 | 79 | 91 | 0/18 |
| 10 | 61 | 125 | 149 | 0/37 |
| 15 | 85 | 149 | 276 | 0/50 |
| 20 | 15,009 | 15,014 | 15,016 | 38/60 |
| 25 | 15,009 | 15,014 | 15,017 | 50/75 |
| 50 | 15,009 | 15,013 | 15,023 | 111/150 |
| 100 | 15,009 | 15,013 | 15,015 | 256/300 |

Full per-endpoint tables (`/auth/me`, `/employees`, `/ledger`, `/leaves`, `/announcements/status`, `/ledger/unread-recent`, `/books/awaiting`, `/scan-inbox/count`, `/ledger/flag-count`), status-code breakdowns, and 5-second RSS/CPU samples for every level are in the corresponding `results-<N>.json` files produced by the (uncommitted) load harness.
