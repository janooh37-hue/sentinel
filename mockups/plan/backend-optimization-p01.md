# P01 — safe event-loop execution boundaries for traced blocking `async` handlers

Part of [backend-optimization.md](backend-optimization.md) (master plan, phase table, receipts).
Base `origin/main` @ `f19e034c524090cc847ce9b82d7401babb334b83`, branch `perf/backend-opt-01-isolation`.
Issue: refs Q06 [#209](https://github.com/janooh37-hue/sentinel/issues/209) (**not** “Closes” — P01 is one slice of Q06's “saturated work preserves unrelated request responsiveness”).
Written **before** any P01 implementation (2026-10-20). Status: **in-progress**.

## 1. Root cause (static + synthetic evidence)

FastAPI runs a plain `def` handler in the AnyIO worker-thread pool but an `async def` handler **on the event loop**. 29 route handlers are `async def`; 24 of them call synchronous service/DB/IMAP/HTTP/OCR code with no `await` and no offload (re-verified on this checkout, `raw/ast-scan-before.json`). While such a call runs, the single uvicorn loop serves nothing: every request, the SSE stream heartbeat and `/api/v1/system/health` wait for it. Stall length = duration of the blocking call (research synthetic probe: 2 s blocking stand-in → ~2,000 ms loop stall vs ~1 ms offloaded; contended SQLite write ~2,102 ms vs ~46 ms). This is a mechanism proof, not Sentinel latency.

The AST scan only yields *candidates*. Each handler below was read, its service chain traced to the native/external call, and classified.

## 2. Trace of all 29 `async def` route handlers

“Lane” = new exclusive lane (§3). “Pool” = `run_in_threadpool` (existing pattern in `vehicles.py`).
Consumers: every frontend caller goes through `frontend/src/lib/api.ts` `multipart(...)`/`request(...)`; no route, parameter, permission, error envelope, response model or OpenAPI operation changes (guarded by the existing `test_handoff_openapi_operation_contract_is_unchanged`; no regenerated types).

| # | Route (handler) | Blocking work reached on the loop today | Native / hazard | Decision |
|---|---|---|---|---|
| 1 | `POST /books/scan-back` (`books.scan_back_book`) | `scan_triage_service.classify` → `read_document` (zxing, PyMuPDF raster/text-layer, Tesseract under `OCR_GATE`), `select(Book)` matching, `book_service.add_attachment` (zxing again, `fitz` image→PDF, `included_papers_service.publish_signed_package`), `scan_inbox_service.park_scan_back` (DB + file write) | PyMuPDF/zxing/Tesseract; read-modify-write of approval state | **Lane** |
| 2 | `POST /books/{id}/attachments` (`add_book_attachment`) | `_require_full_book`, `book_service.add_attachment` (as #1), `_build_book_response` | PyMuPDF/zxing; state flip | **Lane** |
| 3 | `PUT /books/{id}/attachments/{i}` (`replace_book_attachment`) | `_require_full_book`, `replace_attachment` (file write/unlink, JSON list RMW), `_build_book_response` | `attachment_paths` lost-update | **Lane** |
| 4 | `PUT /books/{id}/signed-copy` (`replace_signed_copy`) | `book_service.replace_signed_copy` (`fitz` convert, `publish_signed_package`, placement invalidate) | PyMuPDF | **Lane** |
| 5 | `POST /documents/attachments/stage` (`stage_attachment`) | `staging_service.stage` (directory purge scan + file write) | file I/O only | **Lane** |
| 6 | `POST /documents/inmate-violations/approved-imports/inspect` | already `anyio.to_thread.run_sync` | PyMuPDF (pre-existing, unconfined) | unchanged (P05 owns) |
| 7 | `POST /email/handoff` (`create_handoff`) | `email_service.draft_outgoing`: DB flush + file save + **IMAP APPEND (30 s timeout)** inside an open write transaction | network; writer held (P02) | **Lane** |
| 8 | `POST /announcements/send` (`send_announcement`) | `resolve_book_pdf` (`merge_pdfs_to_bytes` → PyMuPDF), `groups_available` (HTTP), `send_announcement`/`send_direct_announcement` (HTTP per recipient, 10 s timeouts; group path commits after fan-out) | PyMuPDF; network; writer held (P02/P07) | **Lane** |
| 9 | `POST /auth/me/signature` (`upload_my_signature`) | `user_signature_service.save_signature` (Pillow + file + DB) | Pillow | **Lane** |
| 10 | `POST /employees/{id}/vault/upload` (`upload_to_vault`) | `vault_service.save_upload`; for `kind=passport` **passport OCR** (`passport_ocr_service`: Tesseract + PyMuPDF rasterise + MRZ brute force) and DB apply | PyMuPDF/Tesseract | **Lane** |
| 11 | `POST /employees/{id}/signature` (`upload_signature`) | `employee_service.get_employee`, Pillow normalise, vault write | Pillow | **Lane** |
| 12 | `POST /employees/{id}/photo` (`upload_employee_photo`) | `photo_service.save_photo` (purge + write + DB row) | file/DB RMW | **Lane** |
| 13 | `POST /leaves/{id}/certificate` (`upload_leave_certificate`) | `leave_service.add_certificate` (file + DB + audit + cache invalidate) | RMW | **Lane** |
| 14 | `POST /ledger/{id}/attachments` (`add_attachment`) | `ledger_service.add_attachment` (file write, `attachment_paths` JSON list RMW) | lost-update on concurrent same-entry uploads | **Lane** |
| 15 | `POST /managers/{id}/signature` (`upload_manager_signature`) | Pillow normalise + file + DB | Pillow | **Lane** |
| 16 | `POST /permits/scan-vehicle-licence` (`permits.scan_vehicle_licence`) | `permit_service.scan_vehicle_licence` → `_ocr_text` (`OCR_GATE`, Tesseract, PyMuPDF text layer) | Tesseract/PyMuPDF; **`OCR_GATE` is a blocking `threading.Semaphore(2)` acquired on the loop** | **Lane** |
| 17 | `POST /permits/scan-emirates-id` (`scan_emirates_id`) | `permit_service.scan_emirates_id` → `_ocr_text` | as #16 | **Lane** |
| 18 | `POST /permits/{id}/people/{pid}/document` (`upload_person_document`) | `attach_person_document` (store + OCR fill) + `to_read` | OCR | **Lane** |
| 19 | `POST /permits/{id}/vehicles/{vid}/document` (`upload_vehicle_document`) | `attach_vehicle_document` (store + OCR fill + book regenerate) + `to_read` | OCR | **Lane** |
| 20 | `POST /permits/{id}/document` (`upload_permit_document`) | `attach_document` + `to_read` | file/DB | **Lane** |
| 21 | `ANY /dav/{token}/{path}` (`dav_handler`) | token lookup (DB join), `os.path.exists`, **write+`os.replace` of the Word working file**, `record_put` → `db.commit()` with up to 5 s busy wait, `os.stat` | file atomicity; SQLite writer wait | **Pool** + per-request temp name (§3.3) |
| 22 | `POST /vehicles/photo-library` (`upload_vehicle_photo_library_item`) | create already `run_in_threadpool`; **`photo_read` (two queries) still on the loop** | DB read | **Pool** (fold `photo_read` in) |
| 23 | `POST /vehicles/scan-licence` | already `run_in_threadpool` | — | unchanged |
| 24 | `POST /vehicles/imports/inspect` | already `run_in_threadpool` | — | unchanged |
| 25 | `POST /vehicles/imports/{t}/images/{i}/scan` | already `run_in_threadpool` | — | unchanged |
| 26 | `POST /vehicles/{id}/files` (`upload_vehicle_file`) | already `run_in_threadpool` (response built from the loaded row, no I/O) | — | unchanged |
| 27 | `POST /vehicles/{id}/fines/{fid}/payment` (`record_vehicle_fine_payment`) | `vehicle_service.record_payment`: **`BEGIN IMMEDIATE` write lock (up to 5 s busy wait on the loop)**, file store, audit, `fine_read` lazy relationship loads | SQLite writer; designed for concurrency (`acquire_schedule_write_lock` + `If-Match`) | **Pool** |
| 28 | `PUT /vehicles/{id}/fines/{fid}/receipt` (`attach_vehicle_fine_receipt`) | `attach_receipt`: as #27 | as #27 | **Pool** |
| 29 | `GET /notifications/stream` (`stream`) | only `db.get_bind()` + `db.close()` on the loop; counts already `anyio.to_thread.run_sync` per tick | trivial, no I/O besides releasing a connection | **benign — unchanged** (named in the AST guard allowlist) |

Non-route `async` code (`errors.py` handlers, `main.py` pure-ASGI middleware, `debug.record_request`, lifespan) does no blocking I/O/DB/native work and is out of scope.

Not changed (distinguishing benign from defect): `POST /documents/inmate-violations/approved-imports/inspect` and the vehicle `run_in_threadpool` handlers already offload their main work; their PyMuPDF use is unconfined today and is P05's remainder (§7).

## 3. Design — smallest safe boundary

### 3.1 What offloading changes, and what must not change

Moving a handler off the loop changes *where* it runs, but today it also has an **implicit exclusion property**: all 19 “Lane” handlers run one at a time on the single loop thread, so they never overlap each other. A plain thread offload (or `async def`→`def`) silently gives that up, exposing:

1. **Unsupported concurrent PyMuPDF use** (PyMuPDF documents multithreading as unsupported) between scan-back, attachment, passport and permit OCR requests.
2. **State/RMW races that the loop was hiding**: two scan-backs for the same awaiting-scan Record can both read `awaiting_scan` and both flip/sign it; concurrent same-entry ledger/book/permit uploads can lose an `attachment_paths` JSON update or collide on collision-safe file names; concurrent same-employee photo/signature saves race purge/write.
3. For the Word DAV `PUT`: the shared `path + ".tmp"` write/`os.replace` (two overlapping `PUT`s truncate each other's temp file — e.g. a client retry while the first is still in flight).
4. SQLAlchemy `Session` sharing: each request gets its own `Session` from `get_db`; the offload must keep it single-owner at a time.

### 3.2 `run_exclusive` — one-at-a-time lane, off the loop

New private helper `backend/app/api/_offload.py`:

```text
async def run_exclusive(func, /, *args, **kwargs):
    # worker thread via anyio.to_thread.run_sync(..., limiter=<per-event-loop CapacityLimiter(1)>)
```

- **Preserves exactly the old exclusion** among the 19 lane handlers (P01 changes *where* they run, not *how many run at once*) while the loop and the other ~416 sync handlers are no longer blocked.
- **Waiting happens on the loop, not on a pool thread.** The limiter queues waiters as coroutines, so a hung or slow lane member cannot consume the shared 40-thread worker pool; a `threading.Lock` would park one pool thread per queued request and could freeze every sync route (including health) behind one stuck OCR call. (Test: §5 T2.)
- Per-event-loop limiter via `anyio.lowlevel.RunVar` (the mechanism AnyIO itself uses for its default thread limiter): safe at import time, correct under tests that start many loops, works across the AnyIO versions FastAPI/Starlette here allow (`anyio>=3.4,<5`).
- Cancellation: `to_thread.run_sync` defaults to `abandon_on_cancel=False` — a cancelled request does not abandon the worker thread, so `get_db`'s teardown cannot close a `Session` the thread is still using.
- **Session ownership**: the lane handler awaits the upload read on the loop, then hands `db` (+ `user`, bytes, filename) to exactly one worker thread that runs the *whole* synchronous body — permission-adjacent lookups (`_require_full_book`), service work, response building — and returns the result. `get_db` setup/teardown run in other pool threads strictly before/after, never concurrently. This is the sequential-handoff pattern already used by `vehicles.py` and `documents.py:502`.
- Behaviour-preserving moves: each handler's synchronous body is moved verbatim into a plain function (or passed directly), keeping every `raise`, error code, Arabic/English string and statement order. `await upload.read()` stays on the loop (Starlette spools large bodies on a thread).

### 3.3 DAV and vehicle fines — thread pool, not the lane

- **DAV** must not queue behind OCR (a Word save would stall), so it uses `run_in_threadpool`. To keep the `PUT` atomic when two arrive together it writes to a **per-request temp name** (`<working>.<uuid>.tmp`) before `os.replace`, and removes it on failure. The route body is read on the loop (`await request.body()`, unchanged); method/headers are read on the loop and passed by value.
- **Vehicle fine payment/receipt** were written for concurrency (`acquire_schedule_write_lock` = `BEGIN IMMEDIATE`, `If-Match`), so they follow the sibling pattern in the same file (`run_in_threadpool`), with `fine_read` (lazy relationship loads) inside the offloaded call. `upload_vehicle_photo_library_item` moves its `photo_read` (two queries) into the offloaded call.

### 3.4 What is explicitly **not** done (P05/P02/P03/P04 remainders)

- **PyMuPDF remains unconfined across handler families.** The lane keeps lane handlers mutually exclusive, which preserves — does not improve — the previous overlap profile versus the already-offloaded `approved-imports/inspect`, the `vehicles.py` offloads, and the ~416 sync handlers that already use PyMuPDF from pool threads. Process confinement is **P05**.
- Lane members now queue behind each other off-loop instead of freezing the whole app: head-of-line blocking *within* the lane is retained (a 30 s IMAP handoff still delays a queued scan). Relaxing it per family is a later point's job (P03/P04/P05/P07).
- **SQLite writer hold**: `email_service.draft_outgoing` (flush before IMAP append) and `announce_service.send_announcement` (parent row flushed before network fan-out) already hold the write lock across network I/O. P01 does not shorten that (P02). Before P01 the loop block made every other request wait; after P01 other *writers* wait on SQLite's 5 s busy timeout instead and may see `database is locked` if the network call outlasts it. This is a **known, documented trade-off**, not a regression introduced silently.
- No `OCR_GATE`, timeout, OCR-dedup, queue or schema change; no frontend change; no new dependency.

## 4. Frozen benchmark fixtures and procedure (matched baseline)

Single source of truth: `backend/tests/test_event_loop_isolation.py` (checked in; also the regression suite). Fixtures are synthetic: file-backed SQLite in a temp dir under `/home/amh/.hermes/cache/scratch`, real `create_app()`, real `get_db` sessions, real cookie auth (`auth_service.start_session`), scheduler off, providers absent (`openwa` transport refuses; IMAP via the in-repo `FakeImapServer`), a generated barcode PDF (zxing + PyMuPDF), no Word, no network.

Controlled blocking adapters (deterministic, bounded): each adapter blocks on a `threading.Event` with a hard cap (`BLOCK_CAP_S = 2.0`) so a loop-blocking implementation cannot hang the suite; the test releases it as soon as the probe has gathered enough samples.

Per route the harness records, **before** asserting: health-probe completions *during* the block, per-probe latency (p50/p95/max), loop heartbeat max gap (10 ms ticks), SQL statements executed on the loop thread, adapter thread identity, request wall time, process CPU seconds and peak RSS. Set `SENTINEL_LOOP_BENCH_OUT=<file.jsonl>` to append one JSON object per route/run.

Procedure (run twice, **same checkout / interpreter / hardware**, only the source differs). The benchmark is the headline test function only (7 routes, one blocking source each); the other tests are correctness guards, not measurements:

```bash
export TMPDIR=/home/amh/.hermes/cache/scratch GSSG_DISABLE_SCHEDULER=1 PYTHONHASHSEED=0
for i in 1 2 3 4 5; do
  SENTINEL_LOOP_BENCH_OUT=<evidence>/loop-bench-<label>.jsonl SENTINEL_LOOP_BENCH_LABEL=<label>-$i \
    venv/bin/python -m pytest backend/tests/test_event_loop_isolation.py \
      -k test_event_loop_stays_responsive_during_slow_route -p no:cacheprovider -q
done
```

`<label>` is `base` (production source identical to `f19e034c`, test file copied in — the file does not exist on `main`) and `head` (the P01 commit). Host noise (other processes) is recorded (`loadavg`), not hidden. Later points (P08) re-run exactly this against the integration worktree.

## 5. Test plan — vertical slices (TDD), seams and assertions

Seam (approved by the owner brief): the **real ASGI application** (`create_app()` via `httpx.ASGITransport` on a live asyncio loop) with synthetic authenticated users; adapters only at the external/native boundary. Tests assert behaviour, not helper internals. All in `backend/tests/test_event_loop_isolation.py`.

| Slice | Test | Expected at base `f19e034c` (RED) | Expected after fix |
|---|---|---|---|
| S1 | `test_event_loop_stays_responsive_during_slow_route[<route>]` for scan-back, book attachment, permit Emirates-ID scan, permit vehicle-licence scan, email handoff (slow IMAP APPEND), announcement group send (slow gateway), DAV `PUT` (real contended SQLite writer lock): ≥3 health completions *while the adapter is blocked*; adapter ran off the loop thread; **0 SQL statements on the loop thread**; heartbeat gap bounded; status/body unchanged; 0 connections left checked out | fails: adapter ran on the loop thread, 0 health completions during the block, loop SQL > 0 | passes |
| S1 | `test_sibling_handlers_run_blocking_work_off_the_loop[<15 siblings>]` — same verdicts with the controlled adapter wrapping the service call (stage, ledger, leave certificate, my/manager/employee signature, employee photo, vault upload, permit person/vehicle/permit document, book replace attachment / signed copy, vehicle fine payment / receipt); response must be 2xx/4xx, never 5xx | fails (same reason) | passes |
| S1 | `test_unprivileged_user_is_refused_before_any_offloaded_work`, `test_denied_capability_override_refuses_handoff_without_mailbox_work`, `test_unknown_dav_token_is_refused_without_touching_the_working_file`: capability / token gate still answers first with the unchanged envelope; adapter **never entered** (PII/permission boundary) | passes (guards the move) | passes |
| S2 | `test_exclusive_lane_does_not_exhaust_the_worker_pool`: 1 blocked lane request + 47 queued; health (plain `def`, pool-served) still answers; all 48 complete after release | fails (loop-blocked) | passes (a lock-based design fails) |
| S2 | `test_exclusive_lane_never_overlaps_native_section`: 6 overlapping OCR scans never run inside the native adapter concurrently (`max_concurrent == 1`) | passes by accident (loop serialises) — **RED on a plain thread offload** (observed `max_concurrent == 2`) | passes |
| S2 | `test_overlapping_scan_backs_file_the_record_exactly_once`: two simultaneous scan-backs for one awaiting-scan Record → one `200 filed`, one `422 BOOK_NOT_AWAITING_SCAN`; one signed copy on disk | passes by accident — **RED on a plain thread offload** (observed `[200, 200]`) | passes |
| S3 | `test_concurrent_dav_puts_do_not_corrupt_the_working_file`: two overlapping `PUT`s both 204; final bytes equal one full body; no temp files left | passes by accident — **RED on a plain thread offload** (observed `[204, 500]`) | passes |
| S4 | `test_no_async_route_handler_runs_blocking_calls_inline` (AST sweep, explicit benign allowlist: SSE `stream`) + `test_ast_guard_sees_the_known_blocking_shapes` (the guard flags inline, module-helper and nested-called-inline shapes; not vacuous) | fails listing every offender | passes (0 violations) |

Slice order actually executed (raw outputs in `p01/raw/`): S1 RED at base → slice-1 plain thread offload (`run_in_threadpool`, no lane, no DAV temp name): S1/S4 green, S2/S3 guards RED → slice-2 exclusive lane + DAV per-request temp name: all green. Existing route suites (`test_book_scan_back.py`, `test_scanback_api.py`, `test_book_attachment_manage.py`, `test_signed_copy_manage.py`, `test_dav.py`, `test_email_routes.py`, `test_announcements_*.py`, `test_permit_scan_endpoints.py`, `test_granular_permits_ledger_gates.py`, `test_vehicles_api.py`, `test_passport_upload_hook.py`, … list in `p01/raw/targeted-files.txt`) are the behaviour-preservation net; the full backend suite is run once at the end and compared against the base-SHA characterization.

Harness note: with `filterwarnings = error`, `httpx.ASGITransport` + the debug `BaseHTTPMiddleware` leave an unclosed anyio `MemoryObjectReceiveStream` when the app answers (early 401/403/404) before reading the request body; the module's autouse fixture collects with `ResourceWarning` silenced so the leak is not blamed on a neighbouring test. Pre-existing, test-harness only; no application change.

## 6. Acceptance

1. Saved master + P01 plans precede code (this file, committed first).
2. RED on base fails for the expected blocking reason (not import errors); GREEN at head; raw outputs, environment, seeds, SHAs, repetition counts saved under the evidence root.
3. No loop-thread SQL/adapter on any covered route; lane exclusivity and no worker-pool exhaustion; DAV `PUT` atomic under overlap; AST guard clean.
4. Existing behavior, routes, permissions, error envelopes and OpenAPI unchanged; no frontend/type regeneration; no new dependency.
5. Targeted regression suites + full backend suite no worse than the base-SHA characterization; `ruff check .`, `ruff format --check` on changed files, `mypy` (strict), `scripts/check_numbering.py` clean. Frontend untouched → no frontend build.
6. Independent Opus review of the exact head (not performed by the builder), then draft PR → ready only after review; parent accepts.

## 7. Risks and recorded remainders

- **P05 remainder:** PyMuPDF is still used unconfined by non-lane routes (see §3.4). P01 does not worsen the overlap profile; it does not solve it.
- **P02 remainder:** write transactions around IMAP append / WhatsApp fan-out remain; lock-wait failure mode moves from “everything frozen” to “other writers wait up to 5 s” (documented trade-off).
- **PR #243 integration risk:** P01 touches `api/v1/books.py` only in the attachment/scan-back handlers (≈L1834–1990); #243's hunks in that file are at ≈L1513/L1623, so a textual merge is expected to be clean. #243 also edits `document_service`/`book_service`/`notify_dispatch`; P01 does not edit those. Rechecked at PR creation.
- **Throughput:** lane handlers keep their previous one-at-a-time throughput. Gains are loop/health/SSE responsiveness and non-lane request latency, not faster OCR.
- **Windows/Word/Arabic Tesseract unavailable here:** every figure is a Linux, Python 3.12, fake-engine measurement of loop responsiveness.
- **Rollback:** revert the single commit; no data, schema or API change.

## 8. Evidence receipts

Evidence root (outside the repo): `/home/amh/Projects/astra-orchestration/task-receipts/sentinel-backend-optimization/p01/raw/`. Environment: Linux x86_64, i7-7820HQ 8 threads, Python 3.12.14 owned venv (pinned `requirements.txt`; `ruff==0.16.6` to match CI), FastAPI 0.115.5, Starlette 0.41.3, anyio 4.15.1, SQLAlchemy 2.1.5, PyMuPDF 1.28.2, Tesseract 5.5.3 (`eng` only), `PYTHONHASHSEED=0`, scheduler off, `TMPDIR=/home/amh/.hermes/cache/scratch`. The host was shared with other processes (loadavg 1.1–4.5 recorded per run).

- Commits on `perf/backend-opt-01-isolation` (base `f19e034c`): plans `cdc39f1a` → RED tests `b9a1d98b` → implementation `8a1aa349` → this evidence update.
- **RED** on the pristine base source + test file (`red-base-run2.log`): **24 failed, 7 passed** — 7 headline routes, 15 siblings, pool-exhaustion and the AST sweep all fail for the expected reason (`adapter executed ON the event-loop thread`, 0 health completions during the block, loop SQL > 0). The 7 that pass at base are the denial/guard tests and the shape check (guards that only break under a naive offload).
- **Slice 1** (plain `run_in_threadpool`, `slice1-naive-offload.log`): **3 failed, 28 passed** — exclusivity (`max_concurrent == 2`), double scan-back filing (`[200, 200]`) and DAV overlap (`[204, 500]`) fail, justifying the lane and the DAV temp name.
- **GREEN** with the lane (`slice2-green-dev.log`): **31 passed**.
- **Matched benchmark** (3 alternating reps, headline test, `loop-bench-summary.txt`): health max latency ≈ 2.0–3.4 s with 0 health responses during the block and loop SQL 2–15 on base, versus 3.4–19.7 ms with 3–6 health responses during the block and 0 loop SQL at head, on all 7 routes. These are fake-engine, Linux, Python 3.12 measurements of loop responsiveness (block capped at 2.0 s by design), not production latency.
- **Static**: `ruff check .` clean; `ruff format --check` clean on every changed file (`ledger.py`/`email.py` were off-format on `main` and are formatted per the CI changed-files rule); `scripts/check_numbering.py` ok; `mypy` strict: 22 errors in 8 files, **identical at base** (SQLAlchemy 2.1.5 typing drift in this venv), 0 in `app/api`.
- **Base full backend suite** (`full-suite-base.log`): 4 failed, 3075 passed, 18 skipped, 1 error in 89 min — pre-existing: `test_inmate_reporter::test_signed_report_submit_routes_to_manager_pending_worklist`, `test_migration_inmate_violations_category::test_0099_...`, `test_schema_utc_serialization::test_every_schema_with_a_timestamp_inherits_the_tagging`, `test_vehicle_reminders::test_scheduler_registers_vehicle_reminders_at_0910_dubai`, and a `MemoryObjectReceiveStream` ResourceWarning error in `test_vehicle_import`.
- **Existing-test adaptation (no assertion changed):** `test_word_book_preview.py` calls `dav_handler` directly with conftest's in-memory `db_session`, which is bound to its creating thread; the DAV body now runs in the worker pool, so the module overrides `db_session` with a one-connection `StaticPool`, `check_same_thread=False` engine (what `api_db` and the production engine already are).
- Full backend suite at the P01 head and targeted-suite results: see `p01/build-handoff.md`.
