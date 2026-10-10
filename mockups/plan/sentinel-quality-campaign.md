# Sentinel Quality Campaign — Durable Instructions

**Canonical doc.** This file is the single source of truth for the campaign. It
lives in the campaign worktree until this branch merges to `origin/main`, at
which point `origin/main`'s copy becomes canonical — always prefer the copy on
`origin/main` when one exists there. Authoritative *progress* is this doc **plus**
the epic/task issue and PR comments; a fresh agent reads both before acting.

**Repo under audit:** `janooh37-hue/sentinel` ("GSSG Manager"). **Never** touch
`/home/amh/Projects/sentinel` (main checkout) directly — all work happens in
per-week worktrees cut fresh from `origin/main`. **Never** merge, deploy, or
change branch protection / Windows ACL / service / tunnel config; those are
user-only. This campaign files issues and opens PRs — it does not land them.

**Baseline commit:** `3b5adcd5` ("fix(migrations): merge 0098/0099 Alembic
heads"), audited read-only 2026-10-09/10 by `anthropic/claude-opus-5`
lead with 12 same-model subagents (log: full report retained at
`~/.hermes/cache/scratch/sentinel-evaluation-opus55.log`; subagent model
separation from the lead was requested but not deliverable with that
session's `task` tool, which has no model parameter — noted so this
campaign's own model-identity claims are held to a higher bar, see
"Model policy & delegation" below).

**Epic:** https://github.com/janooh37-hue/sentinel/issues/203
**Manifest (durable, authoritative mapping):** `/home/amh/.hermes/cron/sentinel-quality/issues.json`

| ID  | Issue | Priority | Area |
|-----|-------|----------|------|
| Q01 | https://github.com/janooh37-hue/sentinel/issues/204 | P0 | Authorization — all filing/attach callers must check the *target* object, not just a route gate |
| Q02 | https://github.com/janooh37-hue/sentinel/issues/205 | P0 | Email ingestion — undefined `_THREAD_MSG_ID_RE`, silently swallowed parse failures |
| Q03 | https://github.com/janooh37-hue/sentinel/issues/206 | P0 | Backup/restore — blob trees + protected key files, atomic snapshot consistency |
| Q04 | https://github.com/janooh37-hue/sentinel/issues/207 | P1 | CI — run tests & types; fix the real red failures without weakening assertions |
| Q05 | https://github.com/janooh37-hue/sentinel/issues/208 | P1 | Deploy exit code / readiness gate; bounded service logs |
| Q06 | https://github.com/janooh37-hue/sentinel/issues/209 | P1 | Timeouts / executor saturation (Word COM, OCR, webpush) |
| Q07 | https://github.com/janooh37-hue/sentinel/issues/210 | P2 | Cookies / CSRF / rate-limit gaps / PII cache headers / security headers — user authorizes RED/GREEN fixes against the approved public seams (not research-only) |
| Q08 | https://github.com/janooh37-hue/sentinel/issues/211 | P2 | Frontend RTL / accessibility / usability — real browser-level tests |
| Q09 | https://github.com/janooh37-hue/sentinel/issues/212 | P2 | SQL pagination / missing indexes — measured, not assumed |
| Q10 | https://github.com/janooh37-hue/sentinel/issues/213 | P2 | Error correlation / log privacy & retention |
| W8  | (tracked under the epic, no standalone issue) | — | Full 12-category re-audit + Windows operator checklist handoff |

Status for each task lives on its GitHub issue (labels/comments), not duplicated
here beyond the table above — this doc does not re-score "done"; the weekly
run's receipts (`~/.hermes/cron/sentinel-quality/receipts/w*.json`) plus PR
links on the issue are the record.

---

## 1. Scoring rubric — fixed, binary, non-inflatable

Twelve categories, unchanged from the baseline audit's structure. **Exactly
these twelve** — do not substitute, merge, or drop one. Each category has
**5 fixed binary evidence gates worth 2 points each = 10 points max**. A gate
is either demonstrated by a runnable check (test, CI log, static analysis
output) or it is not — no partial credit, no self-report. **"Cannot inflate"**
means: a gate must be satisfiable by code/config in *this* repo for *this*
deployment shape (one Windows box, LAN + one Cloudflare tunnel hostname, SQLite,
a few dozen users). Caching & CDN and Load Balancing & Scaling gates below
**must not** require adding a CDN or a load balancer — that would be scoring
infrastructure the product doesn't need, not quality. Where the baseline
report explicitly recommended against something (load balancer, Redis,
horizontal scaling, automated migration rollback, DB auto-restore, restart
watchdogs), the gates for that category assume that recommendation stands.

### Legacy baseline scores (reference only — do not reuse as the new rubric)

| # | Category | Legacy score /10 |
|---|----------|------------------|
| 1 | Frontend | 8 |
| 2 | APIs & Backend Logic | 6 |
| 3 | Database & Storage | 6 |
| 4 | Auth & Permissions | 7 |
| 5 | Hosting & Deployment | 5 |
| 6 | Cloud & Compute | 7 |
| 7 | CI/CD & Version Control | 3 |
| 8 | Security & RLS | 6 |
| 9 | Rate Limiting | 7 |
| 10 | Caching & CDN | 8 |
| 11 | Load Balancing & Scaling | 7 |
| 12 | Error Tracking & Logs | 6 |
| | **Average** | **6.33 ("baseline 6.3")** |

These were qualitative judgement calls by the audit, not gate-counted
(average verified: 76/12 = 6.33). **The new rubric below starts every
category UNMEASURED — not 0/10 — until its own gates are mechanically run
against `origin/main`** — a legacy "8/10" does not carry forward as a head
start, and "unmeasured" is not the same claim as "measured and scored 0."
Only a gate that actually ran and failed scores 0 for that gate; a category
with no gate run yet this week is reported as unmeasured, and any
week-over-week delta is computed only between two actually-measured values
— never against an assumed 0 baseline. Target: **10/10 on all 12 by W8**,
via gates only, never by narrative.

### The 12 categories × 5 gates

**1. Frontend** (ties to Q08)
- G1 CI runs a frontend job (`tsc -b --noEmit` + `vitest run`) on every PR.
- G2 Lazy-route chunk-load failure has an automated recovery/retry test (no blank white screen on a stale deployed chunk).
- G3 Zero physical-direction utility classes (`ml-`,`mr-`,`pl-`,`pr-`,`left-`,`right-`) outside test files — grep count 0, enforced by a check script.
- G4 Route Suspense/loading fallback has `role="status"`/`aria-live`, asserted by an automated test (not code review).
- G5 Production `sourcemap` setting makes crash stacks symbolicatable, asserted by a config test.

**2. APIs & Backend Logic** (ties to Q02, Q04)
- G1 `ruff check` exits 0 and runs in CI (no undefined-name class errors reach `main`).
- G2 The documented 413 payload-too-large contract holds for both `Content-Length` and chunked bodies — one test per path.
- G3 Zero inline-on-event-loop blocking calls (OCR/Word) in sync-but-should-offload handlers — AST/grep sweep, 0 violations.
- G4 Full backend suite is green (0 failed, 0 error) **in CI**, not just locally.
- G5 `mypy --strict` runs in CI against the configured paths with 0 errors.

**3. Database & Storage** (ties to Q03)
- G1 `scripts/check_numbering.py` (single Alembic head, no duplicate revision id) passes in CI.
- G2 A test asserts every `data_dir / "<name>"` literal referenced by app code is listed in `_FILE_SUBDIRS` or an explicit `_EXCLUDED` tuple — fails on any new undocumented blob tree.
- G3 A restore-and-verify test: create a backup, restore it, assert `PRAGMA integrity_check == 'ok'` **and** every blob path the restored DB references exists under the restored tree (atomic snapshot consistency, not DB-file-only).
- G4 The backup/restore test covers `.email_key`/`.vapid_key` using **dummy keys only** — no real key material in any test or fixture.
- G5 Duplicate-revision-id detection uses a real duplicate check (not a `set()` that silently drops the duplicate), with a test that plants a collision and expects a failure.

**4. Auth & Permissions** (ties to Q01, Q07)
- G1 Object-level authorization: a regression test proves `scan_inbox.py::route_item` requires `books.edit`+full-book access for a `book_id` target and `employees.vault.manage` for an `employee_id` target.
- G2 An automated sweep asserts every mutating `api/v1` route rejects a session lacking its required capability (not a manual sample).
- G3 A test asserts `HttpOnly`/`SameSite`/`Secure` on the login response cookie under the secure-cookie config.
- G4 A test asserts no role preset's default grants include a capability flagged `sensitive=True` (closes the `inmate_statistics.approve` contradiction).
- G5 `derive_role` is either removed or covered by a test proving it is unreachable from any live authorization path (and `docs/permissions-enforcement.md` no longer claims otherwise).

**5. Hosting & Deployment** (ties to Q05)
- G1 `Wait-Healthy` throws (non-zero deploy exit) on a simulated unhealthy post-deploy state — tested against a **fake health responder**, not a real production run.
- G2 The readiness probe used by deploy is a real dependency check (DB ping at minimum), distinct from pure liveness, and a test proves it fails when the dependency is down.
- G3 Service stdout/stderr log rotation is configured on the **existing NSSM wrapper** (no new service/tooling) — verified by a static check against the install script.
- G4 `scripts/build.ps1` references no file that is absent from the repo (static check: both `GSSG_Manager.spec` and `scripts/post_build.py` either exist or the references are removed).
- G5 `.env.example` ships `GSSG_DEV_MODE=0` — verified by a test reading the file.

**6. Cloud & Compute** (ties to Q06) — this is local-executor/resource fitness
(Word COM pool, OCR semaphore, webpush, APScheduler), **not** cloud
infrastructure and **not** N/A.
- G1 Every external-process call site (Word COM executor, `pytesseract`, `pywebpush`) has an explicit `timeout=` — static sweep, 0 violations.
- G2 Executor timeout accounting measures from start-of-execution, not from submit — a test reproduces the "queued op's wait charged against budget" defect and asserts it no longer occurs.
- G3 On a timed-out future, only the worker that owns it is reaped — a test proves a sibling in-flight job is not killed.
- G4 `mkdtemp` created by signature/COM rendering is cleaned up by its caller — a test counts temp entries before/after.
- G5 `requirements.txt` and `pyproject.toml` agree on every shared dependency version (automated diff, 0 mismatches) — no new dependency added to satisfy this.

**7. CI/CD & Version Control** (ties to Q04)
- G1 A `backend-tests` (pytest) job exists in `.github/workflows/checks.yml` and runs on every PR.
- G2 A `frontend` job (`tsc -b --noEmit` + `vitest run`) exists and runs on every PR.
- G3 `mypy --strict` runs as a step in CI against the paths already configured in `pyproject.toml`.
- G4 `ruff` is pinned to the same version in `pyproject.toml` and the CI workflow (no venv/CI drift).
- G5 The workflow triggers on `pull_request` against `main` for every one of the above (not `push`-only), so a broken PR is visibly red before merge — **this campaign does not claim or change branch-protection/required-status-check settings**, which are GitHub server-side state outside read-only repo inspection.

**8. Security & RLS** (ties to Q01, Q07)
- G1 Every `{id}`-taking write handler across `api/v1` resolves authorization against the *target* object (sweep test, not the single `scan_inbox` case alone — that is Auth G1; this gate is the repo-wide version).
- G2 A test hitting the running ASGI app asserts CSP, `X-Frame-Options`, `Referrer-Policy` (and HSTS where the deployment is HTTPS) on responses.
- G3 `scripts/secure_key_acls.ps1` is invoked by an install/deploy script path — static grep for the call site; reuses the **existing** script, no new ACL tooling.
- G4 The Cloudflare tunnel ingress config denies `/api/v1/debug/*` and `/dav/*` by a rule in the committed config (not "the app's login is the only barrier").
- G5 A sweep of `sa.text()`/raw SQL call sites finds 0 that interpolate untrusted input (static or bound only).

**9. Rate Limiting** (ties to Q07) — reuse the existing in-process limiter;
no `slowapi` or other new dependency by default.
- G1 A test proves the 11th login attempt in a window returns 429 (not a manual curl).
- G2 A time-mocked test proves the window resets and a blocked key becomes allowed again.
- G3 The unbounded key dict has eviction of emptied buckets + a cap, proven by a bounded-memory test (mirrors the existing pattern in `job_registry.py`).
- G4 429 responses carry a `Retry-After` header, asserted at the wire level.
- G5 `/auth/verify-password` (lock-screen re-auth) has a limiter applied, asserted by a test.

**10. Caching & CDN** — **no CDN requirement.** LAN clients behind `tls
internal` do not get a CDN added; a CDN here would be a new PII egress path
and a wrong requirement. Gates are about correctness of existing caching.
- G1 Vendored static assets (e.g. `hugerte/`) get the same `Cache-Control` + 304 treatment as `/assets` — wire-level test.
- G2 PII file routes that today set no `Cache-Control` explicitly set an appropriate directive (`no-store` or equivalent) — sweep test over the known route list.
- G3 The service worker drops **all** non-current-version caches on activate (not just differently-named ones) — unit test.
- G4 The preview/PDF mtime-based cache-invalidation key test passes end-to-end (staleness correctly triggers regeneration).
- G5 The `main.py` comment claiming ETag/304 support for `FileResponse` paths is corrected or made true — doc/code consistency check, zero false claims remain.

**11. Load Balancing & Scaling** (ties to Q09) — **no load balancer, no
Redis, no horizontal scaling.** Single box, LAN, a few dozen users; gates are
about bounding concurrency and query cost in place.
- G1 A bounded concurrency gate caps simultaneous Word-COM-bound sync handlers; a test proves the N+1th concurrent call queues instead of consuming an unrelated thread-pool slot.
- G2 Each of the identified unbounded full-table reads (`expiry.py`, workforce, permits, vehicles) is replaced by a SQL-bounded query (`LIMIT`/date filter at the DB layer) — per-route test.
- G3 Composite indexes exist for the measured hot paths (`book_approval_steps`, `ledger_entries` unread, `books.approval_state`/`deleted_at`) — migration + `EXPLAIN QUERY PLAN` test showing index use.
- G4 SSE/streaming endpoints close their DB session per tick — a concurrency test simulating >15 viewers proves the pool is not exhausted (regression test for the already-fixed incident).
- G5 The largest unvirtualized desktop list gets virtualization, **or** is explicitly justified out of scope with a measured row-count ceiling recorded in the PR — frontend test either way.

**12. Error Tracking & Logs** (ties to Q05, Q10)
- G1 Service stdout/stderr rotation is configured via the existing NSSM wrapper (same gate family as Hosting G3, verified independently here against the log-tracking requirement).
- G2 A request id is generated per request, attached to log records, and returned in the 500 error envelope — test asserts all three.
- G3 The three worst silent-swallow sites (`word_book_service`, `attendance_queue_service`, `signature_placement_service`) log the exception — tests assert a log record is emitted on the failure path.
- G4 `data/crash-reports/*.zip` is pruned/bounded — test asserts a cap is enforced.
- G5 The dead "Sentry Phase 10+" settings toggle no longer logs on every settings read, and its behavior matches what it claims to the user (or is clearly disabled) — test asserts no per-read log line.

### Weekly audit cadence

**All 12 categories get a shallow source/delta check every week** — re-run the
category's existing gates against the current `origin/main` HEAD and record
pass/fail + the commit SHA, cheap and mechanical. **One category additionally
gets a deep re-check each week, rotating 1→12 over the 8-week campaign** (two
full passes over 8 weeks is not possible with only 8 slots; use the task
priority order — P0 categories first — rather than a rigid calendar). The
rotation itself is not a calendar promise: a blocked task stays prioritized
and gets its deep check deferred to the next available week, it does not fall
off the plan.

---

## 2. Priority tasks — stable IDs, dependencies, phases

Every task (Q01–Q10, plus W8) runs the same five phases, in order, and a task
does not advance to the next phase without the previous one's evidence
committed to its PR:

1. **Research** — read the primary source(s) for this task's category (table
   below), confirm version/date applicability against what's actually
   installed in this repo, and record the citation + one line on
   applicability in the PR description. A GitHub "shortcut" (existing library
   someone suggests adopting) is a *candidate*, not a recommendation, until
   its license, maintenance status (commits/releases in the last ~12
   months), and security advisories are actually checked against this repo's
   constraints — record the adopt/reject rationale either way. No new
   dependency is installed by default.
2. **RED** — write the test against the **public seam** (the route, the
   function signature callers actually use, the config/install script) that
   fails for the documented, expected reason. Capture the failure output in
   the PR. If the seam doesn't already exist as something callers go through,
   stop and ask the user before inventing a new one — approved seams are
   fixed (API auth/errors, email ingestion outcomes, backup/restore,
   deploy exit/readiness, UI interactions, timeout/concurrency); anything
   outside that list needs explicit sign-off before writing against it.
3. **GREEN** — the smallest fix that makes the RED test pass, reusing
   existing helpers/patterns in the repo first (e.g. the existing
   `job_registry.py` eviction pattern for Rate Limiting G3, the existing
   online-backup API for Q03, the existing form validation libraries for
   Q08 — never replace a working pattern with a "native" rewrite the repo
   doesn't already use). No new dependency unless the research phase
   produced and recorded an explicit adopt rationale.
4. **Review/refactor — only if warranted.** If the GREEN diff is already the
   smallest correct version, skip this phase and say so in the PR. Refactor
   only when the fix reveals a second, already-broken caller of the same
   function (root-cause fix, not a local patch) — not for style.
5. **Verification gates** — re-run the specific rubric gate(s) this task
   claims to satisfy (table in §1) and paste the pass output into the PR.
   A task is only "done" once its claimed gates are green **on the PR
   branch**, re-stated against `origin/main`'s current HEAD before merge is
   requested (never scored as if the branch already were `main`).
6. **Handoff** — update the GitHub issue with: gates satisfied, PR link,
   model used (exact `provider/model`, parsed from real session metadata),
   and the next pending step. The canonical doc gets one append-only entry
   per week in a running "Progress log" section (added below the first time
   a week completes) — never an edit to a previous week's entry.

### Dependencies

- Q04 (CI) should land *after* Q02 (email regex), so CI's first green run
  isn't immediately red from a bug already known and fixed — but Q04's own
  RED phase (adding the job) is valid even before Q02 merges; only requiring
  the job's green status should wait.
- Q07 (cookies/CSRF/rate/cache/security-headers) overlaps Auth (Q01) on the
  cookie-flags gate — research and RED can proceed independently, but do not
  open two PRs touching the same `auth.py` login response without checking
  the other's state first.
- Q10 (request-id correlation) depends on Q05's logging work existing first
  (request-id needs a place in the structured log line Q05 touches for
  rotation); sequence Q05 before Q10 where both are active in the same
  window.
- Q09 (SQL/indexes) and Q06 (timeouts) are independent of everything else
  and can run in whichever week has capacity.

### Preferred milestones (not hard calendar commitments — priority order wins)

| Week | Date (Mon 09:00 Asia/Dubai) | Primary focus |
|------|------------------------------|----------------|
| W1 | 2026-10-12 | Q01 — authorization, Research→RED→GREEN |
| W2 | 2026-10-19 | Q02 — email regex, Research→RED→GREEN |
| W3 | 2026-10-26 | Q03 — backup/restore, Research→RED→GREEN |
| W4 | 2026-11-02 | Q04 — CI tests/types baseline |
| W5 | 2026-11-09 | Q05 — deploy exit/readiness + bounded logs |
| W6 | 2026-11-16 | Q06 — timeouts/executor saturation |
| W7 | 2026-11-23 | Q07/Q08/Q09/Q10 — P2 research (+ RED/GREEN for whichever has capacity; a P2 item not reaching GREEN by W7 is **blocked, not failed** — it stays prioritized into any post-campaign continuation) |
| W8 | 2026-11-30 | Full 12-category re-audit against current `origin/main` HEAD + Windows operator checklist (Word COM/NSSM/ACL items this Linux workstation cannot execute, listed for a human operator to run) |

A blocked task is never silently dropped from the priority table to make the
calendar look clean — it is reported as blocked with a reason, every week,
until it either completes or the user re-prioritizes it.

---

## 3. Research sources — primary, dated, version-checked

Research is mandatory before any GREEN fix, not optional background reading.
Record the retrieval date and the installed-version applicability for each
source actually cited in a task's PR.

| Source | URL | What it's used for | Applicability check required |
|---|---|---|---|
| OWASP Authorization Cheat Sheet | https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html | Deny-by-default, check every request against the object, not the route (Q01, Q08 gates) | General guidance, not version-pinned — cite the specific principle used |
| SQLite Backup API docs | https://sqlite.org/backup.html | `sqlite3_backup_*` gives a consistent **DB** snapshot under WAL — it does **not** make blob-tree + DB snapshot atomic together (Q03) | Matches the installed SQLite in this repo's venv; re-confirm via `sqlite3.sqlite_version` before citing |
| FastAPI — Dependencies docs | https://fastapi.tiangolo.com/tutorial/dependencies/ | `Depends()` route-level gates — and their limit: a route dependency alone does not authorize the *target object* of a mutation (Q01/Q08 G1) | Check against the installed `fastapi` version in `pyproject.toml` |
| Starlette — Middleware docs | https://www.starlette.io/middleware/ | Security-header middleware shape (Q08 G2), `FileResponse`/`StaticFiles` 304 behavior (Caching G5) | Check against the installed `starlette` version (0.41.3 at baseline) |
| Python `sqlite3` stdlib docs | https://docs.python.org/3/library/sqlite3.html | `backup()`, `PRAGMA` execution from Python, `iterdump` alternatives (Q03) | Matches the project's Python (3.12 backend target) |
| SQLite PRAGMA docs | https://sqlite.org/pragma.html | `foreign_keys`, `journal_mode`, `integrity_check`/`quick_check` semantics (Database G3/G5) | Version-general; the repo's pragma set is at `session.py:40-55` |
| GitHub Actions — `setup-python` | https://github.com/actions/setup-python | How to add the `backend-tests`/`mypy` CI job correctly (Q04, CI G1-G3) | Check the action version pin used, if any |
| OWASP REST Security Cheat Sheet | https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html | Security headers, rate limiting, cache headers for API responses (Q07, Security G2, Rate Limiting) | General guidance |
| Python `logging` stdlib docs | https://docs.python.org/3/library/logging.html | `RotatingFileHandler`, request-context correlation patterns via `contextvars`/filters (Q10, Error Tracking G2) | Matches installed Python |
| W3C WCAG 2.2 Quick Reference | https://www.w3.org/WAI/WCAG22/quickref/ | `role="status"`/`aria-live`, focus management for route changes (Q08, Frontend G4) | WCAG 2.2 is current; cite the specific success criterion |
| MDN — `Cache-Control` | https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Cache-Control | Correct directive per route class — PII vs immutable vendored assets (Q07, Caching G1/G2) | General reference |
| Microsoft `sc create` docs | https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/sc-create | Windows service identity/`ObjectName` semantics, read-only reference for Hosting G3/Security G3 — **the existing NSSM wrapper is reused, no new service tooling** | Reference only; no script executed on this Linux workstation |
| NSSM official site/docs | https://nssm.cc/ | `AppRotateFiles`/`AppRotateOnline`/`AppRotateBytes`/`AppRotateSeconds` flags for log rotation (Hosting G3, Error Tracking G1) — confirms the existing wrapper already supports rotation without a new dependency | Reference only |
| Uvicorn — Deployment docs | https://www.uvicorn.org/deployment/ | Single-process vs multi-worker tradeoffs — used to **reject** a blanket `--workers` change: SQLite's own multi-writer story (WAL mode) is a *serialized-writer* constraint, not a hard single-process requirement by itself, but Word COM is a genuine process-pinned singleton (one live COM object, one scheduler/APScheduler instance, one in-process rate-limiter state) that a second worker process would duplicate or corrupt, which is the real reason multi-worker is unsafe here, not SQLite alone (Cloud & Compute, Load Balancing) | Confirms the installed `uvicorn` version's defaults before citing |

**Explicitly rejected research conclusions** (recorded so they are not
re-proposed): dropping the 10/10-all-12 target or any of the 7 "extra" (CDN/
load-balancing-class) categories as out of scope — rejected, user's explicit
goal stands. A prior research pass also suggested blanket `--workers>1` for
uvicorn, adding `slowapi` as a new rate-limit dependency, reinstalling/
replacing the NSSM wrapper, and substituting the deploy-exit-code gate for
the Caching & CDN category's gates — **all rejected**. The real constraint
behind the `--workers` rejection is Word COM: it is a process-pinned
singleton (one live COM object, one scheduler/APScheduler instance, one
in-process rate-limiter state) that a second worker process would
duplicate or corrupt — not, by itself, SQLite's writer model, which already
tolerates concurrent readers and serializes writers under WAL without
requiring a single process. Multi-worker stays unsafe until each
Word-COM/scheduler/limiter call site is proven safe under a second process,
not assumed unsafe from SQLite alone. The existing in-process limiter
already does the job (Rate Limiting §9 gates reuse it); NSSM is already the
service wrapper in place; and Hosting/Deployment and Caching/CDN are and
remain two separate categories with their own gates — one category's gate
is never substituted for another's.

**GitHub-sourced "reuse" candidates** (any library someone proposes adopting
instead of hand-rolling a fix) are **not installed by default**. Each must be
logged as a candidate with: repo URL, license, last-commit/last-release date,
open security advisories, and an explicit adopt/reject line — checked against
the actual GitHub repo, not assumed from the package name — before any
`pyproject.toml`/`requirements.txt`/`package.json` change.

---

## 4. Model policy & delegation

**Primary pair:** lead `anthropic/claude-opus-5-5`, workers
`anthropic/claude-sonnet-5-5`. **Fallback pair** (only if primary is
unavailable): lead `openai-codex/gpt-6-astra`, workers
`openai-codex/gpt-6.1-sol`. No other model is authorized for this campaign
without the user's explicit sign-off.

**Verified delegation mechanism.** `omp`'s native `task` tool schema has no
`model` parameter and inherits the lead's model (confirmed against the
baseline audit's own 12-subagent run — every subagent self-reported the
lead's model, not a requested Sonnet). The only verified way to run a worker
on an explicit different model is the lead using `bash` to start a separate
process: `omp --model <provider>/<model> --mode json --no-tools ... -p
<prompt>` (always the full `provider/model` string, never a bare name that
could fuzzy-match something unintended), then parsing the real
`message_end` event's `message.provider` + `message.model` fields —
**never** the model's own self-reported text, and checked on **every**
assistant `message_end` in a session, not only the last (a model can be
swapped mid-session by an upstream failover the harness doesn't otherwise
report). Verified live on this workstation (`omp/18.8.7`) against all four
authorized primary/fallback lead/worker models — a `--no-tools` smoke on
each returned rc 0 with a matching `message_end` identity, and a real
tools-enabled lead run (bash tool call + reply) on the primary worker model
completed with identity verified both before and after:

```
$ omp --model anthropic/claude-sonnet-5-5 --mode json --no-tools --no-skills \
      --no-extensions --no-title --no-lsp --max-time 30s -p "Reply with exactly: OK"
...
{"type":"message_end","message":{... ,"provider":"anthropic","model":"claude-sonnet-5-5", ...}}
```
The `provider`/`model` pair rides on `message_end`, independent of anything
the assistant text says — that's the field this campaign's launcher parses.

**Preflight-before-real-work.** Before any worker does real (tools-enabled)
work, run the identical prompt through `--no-tools --no-skills --no-extensions
--no-lsp` first and re-check the `message_end` identity. Only if that smoke
matches the intended model does the real (tools-on) run proceed — and the
real run's own `message_end` is re-checked too, since a model can be swapped
mid-session by an upstream failover the harness doesn't report.

**Primary/fallback switch rule:** if the primary pair's preflight smoke
passes for both lead and worker, use primary. If the primary smoke fails for
either role, try the fallback pair's smoke for both roles. If **both** pairs
fail smoke, stop and report **blocked** — do not silently run on an
unverified model.

**At most 2 concurrent workers** (hardware constraint). **Never** re-execute a
real implementation step blindly after a mid-run model failure — the next run
must inspect the actual branch/PR state first (what commits exist, what the
last PR comment says) and resume from there; duplicate PRs for the same task
are a bug, not a retry strategy.

**Constraints that apply to every spawned session, lead or worker:**
`--no-tools`-mode smokes only during preflight; real runs never use
`--auto-approve` — if a tool call needs interactive approval and none is
configured, the session stops and reports **blocked**, it does not hang or
silently proceed. External skills loading is disabled (`--no-skills`) for
every spawned session in this campaign; workflow skills (team-flow,
structured-agent-workflows, etc.) are never invoked by this campaign's own
lead or workers. No global OMP/Hermes default config is changed to make a run
succeed.

---

## 5. Operational guardrails (do not relax these)

- **Fresh `git fetch origin`** before computing anything about what's "current."
- **One worktree per campaign week**, based on `origin/main` at fetch time —
  never reuse a worktree across weeks, never `git reset`/delete an existing
  **dirty** worktree (if a week's worktree already has uncommitted work, leave
  it and report the conflict rather than discarding it).
- **No concurrent edits to the canonical doc** by workers — only the lead, in
  the control worktree, commits docs-only changes on a docs branch and opens/
  updates a **docs-only** PR. Fix PRs are separate, one per task, and no PR
  from this campaign is ever merged by this campaign.
- **GitHub issue URLs are populated by the parent/user** after a worker
  finishes a task — this doc and any prompts reference placeholders only
  until a real URL is handed back (now filled in §Epic/table above once
  received).
- **Public repo discipline:** `janooh37-hue/sentinel` is public. Security
  issue bodies are neutral remediation summaries — no exploit recipes, no
  step-by-step reproduction of the privilege-escalation chain, no PII, no
  internal operational detail (hostnames, tunnel config specifics, real
  credentials-adjacent paths). State the defect class and the fix, not the
  attack.
- **No real HR data, secrets, or notification sends** in any test — backup/
  restore tests use dummy keys and synthetic rows only; this is mandatory for
  Q03 and non-negotiable for anything touching `.email_key`/`.vapid_key`.
- **No full production script execution** (no real `mng.ps1 deploy`, no real
  NSSM install/reinstall, no real Windows ACL change) from this campaign —
  those are read-only-researched and PR'd as code/config changes for a human
  operator to apply; Windows-only paths are explicitly flagged blocked, not
  claimed verified, on this Linux workstation.
- **Scores never apply to a feature/docs branch as if it were `main`.** A
  gate's "verified" status is restated against `origin/main`'s current HEAD
  before being reported as campaign progress.

---

## 6. Reporting format (Discord-friendly)

Each week's report follows this shape:

```
Sentinel Quality Campaign — Week N (YYYY-MM-DD)
origin/main HEAD: <sha> (delta vs last week: <sha..sha>, <N> commits)
Scores (gates proven / 10, all 12 — Δ vs last week):
  1 Frontend            X/10 (Δ+/-)
  2 APIs & Backend       X/10 (Δ+/-)
  3 Database & Storage   X/10 (Δ+/-)
  4 Auth & Permissions   X/10 (Δ+/-)
  5 Hosting & Deployment X/10 (Δ+/-)
  6 Cloud & Compute      X/10 (Δ+/-)
  7 CI/CD & VCS          X/10 (Δ+/-)
  8 Security & RLS       X/10 (Δ+/-)
  9 Rate Limiting        X/10 (Δ+/-)
 10 Caching & CDN        X/10 (Δ+/-)
 11 Load Balancing       X/10 (Δ+/-)
 12 Error Tracking       X/10 (Δ+/-)
Tests actually run this week: <command> -> <result>
PRs opened/updated: <links>
Blockers: <list, or "none">
Model actually used: lead=<provider/model>, workers=<provider/model> (verified via message_end, not self-report)
Next step: <single most important next action>
```

---

## 7. Progress log (append-only — add a new dated entry per week, never edit a previous one)

_No weeks run yet as of this document's creation (2026-10-10). The first
entry is added by the first real weekly run._

---

*Durable artifacts this doc depends on:* `/home/amh/.hermes/scripts/sentinel-quality-weekly.py`
(launcher, stdlib-only, `--self-test`/`--check`/`--worker` modes),
`/home/amh/.hermes/cron/sentinel-quality/issues.json` (epic/task URL manifest),
`/home/amh/.hermes/cron/sentinel-quality/receipts/w*.json` (per-week run
state). This doc does not duplicate their contents — it points at them.
