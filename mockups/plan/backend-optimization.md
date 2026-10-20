# Backend optimization — master plan (P01–P08, sequential)

**Canonical plan** for the user-requested backend optimization series. One plan per
point lives beside this file (`backend-optimization-pNN.md`); this file owns scope,
order, gates, baselines and receipts. It is **not** a scheduled weekly quality run:
it does not alter the cron, launchers, historical weekly scores, or the quality
rubric (`mockups/plan/sentinel-quality-campaign.md`), and it does not import that
campaign's two-hour cap. A PR-ready point is **not** an improvement on `main`.

| | |
|---|---|
| Plan created | 2026-10-20 (state at creation: P01 in progress, P02–P08 pending) |
| Owner request | User, Discord thread `1562045350980882442` |
| Parent authority | `hermes-sol` (only the parent accepts a point) |
| Campaign task / lead | `backend-optimization` / `sentinel-backend-opt` |
| Target snapshot (research + P01 base) | `origin/main` @ `f19e034c524090cc847ce9b82d7401babb334b83` |
| Accepted research | `task-receipts/sentinel-stack-audit/research-report.md` (parent acceptance receipt `parent-acceptance.md#074814db8590`) — synthesis only; the raw advisor remedies are evidence inputs, **not** accepted implementation instructions |
| Existing issues reused (do not duplicate, do not close from partial work) | Q06 [#209](https://github.com/janooh37-hue/sentinel/issues/209) (timeouts/executor saturation), Q09 [#212](https://github.com/janooh37-hue/sentinel/issues/212) (SQL/list performance); epic [#203](https://github.com/janooh37-hue/sentinel/issues/203) |
| Authority limits | No merge, auto-merge, deployment, branch-protection/service/tunnel/ACL change, live provider/data/secret/production-backup access. Local synthetic only. |

## Evidence classes and honesty rules

- **static** = present in pinned source; **synthetic** = executed local mechanism test, not app capacity; **potential** = plausible, needs a real workload check.
- The workstation is Linux/Python 3.12.14 with PyMuPDF/Tesseract(eng only)/zxing available and **no Windows, no Word COM, no Arabic Tesseract pack**. Isolated fake-engine measurements are labelled as such and are never presented as production gains.
- Never label an errored/timed-out suite green; characterize pre-existing failures at the same base SHA; never weaken assertions.

## Dependent vs independent strategy

- Each point owns **its plan, RED/GREEN proof, exact-head independent review and its own PR**. A later *independent* point starts from a fresh `origin/main`.
- A *dependent* point uses an explicit reviewed **stacked base** if its predecessor is unmerged; the PR base and merge order are written in this file. Predecessor commits are never copied into a `main`-target PR to pretend the diff is only the new point.
- No point inherits unaccepted work. The parent gates progression and creates the next point's child state/launch allowance. No point starts speculatively.
- Planned dependencies (to be re-confirmed by each point's plan against then-current `main`):
  - P01 → independent (base = `main`).
  - P02 (write transactions) and P07 (durable jobs) both touch `announce_service` / `notify_dispatch` / `document_service`; P07 depends on P02's transaction shape. P02 also overlaps open PR #243 (`document_service`, `notify_dispatch`).
  - P03 (Word/certificate executors), P04 (OCR), P05 (PyMuPDF process confinement) are mutually adjacent through `_pdf_executor` / `_certificate_executor` / `core/extraction/ocr.py`; P05 builds on the P01 serialization boundary and may retire it.
  - P06 (SQL/list/permissions/Arabic FTS) is independent of P01–P05 except for shared `book_service`.
  - P08 uses an owned integration worktree of **accepted PR heads** (never merged to `main`/production).

## Open PR overlap (rechecked per point; do not merge, cherry-pick or edit)

| PR | State at plan creation | Touches | Effect on this series |
|---|---|---|---|
| #243 `promote/signature-chain` @ `e258691b88020df37435d4ad598a0ef10fbf45c8` | OPEN, non-draft | `api/v1/books.py` (hunks near L1513/L1623 only), `api/v1/documents.py` (`_run_generation`), `api/v1/leaves.py` (L230), `document_service`, `book_service`, `notify_dispatch`, templates, API contract | **P01: no overlapping hunks** (P01 edits only the attachment/upload handlers further down those files). **P02/P07: real overlap** on `document_service` and `notify_dispatch` — re-read before starting. |
| #239 `docs/live-host-gssgit` | OPEN | docs | Unrelated; preserved. |
| #223 `work/dev-cycle` | OPEN draft | dev-cycle tooling | Unrelated; preserved. |

## Phase status (this file is the only place all points' status lives)

Legend: `pending` (not started, not authorized), `in-progress`, `ready-for-review` (PR open, independent review pending), `accepted` (parent only).

| Pt | Scope (unchanged from the owner request) | Status |
|---|---|---|
| P01 | Safe event-loop execution boundaries for traced blocking `async` handlers; matched ASGI responsiveness baseline and regression. Native-library and DB-session safety are mandatory. Plan: [backend-optimization-p01.md](backend-optimization-p01.md) | in-progress |
| P02 | Shorten generation/broadcast write transactions and fix allocator retry reachability. Preserve numbering, audit atomicity, caller-staged writes, artifact publication and cleanup. No burned/gapped numbers or new pending/void states without an owner decision; if semantics cannot be preserved, document options and ask at that point. | pending |
| P03 | Word/certificate worker queue vs execution deadlines; ownership-aware idempotent reap; bounded admission; no blind replay of side effects. `Future.running()` is not proof an operation began; completion-only worker timestamps cannot enforce a live timeout — a real started/ownership signal is needed where warranted. | pending |
| P04 | OCR: explicit handled timeouts; reduce duplicate recognition/raster passes while preserving text/barcode priority and bilingual accuracy; benchmark native thread limits (do not hardcode `OMP_THREAD_LIMIT=1` as universally faster). | pending |
| P05 | Process-confine overlapping PyMuPDF operations using existing process-worker patterns; no renderer replacement or engine cutover. | pending |
| P06 | SQL-filter awaiting approvals; remove per-request repeated permission/catalog work; justified indexes; truthful list/pagination limits; Arabic ledger FTS normalization. Preserve authorization/order/search precision; single Alembic head; migration reviewer instructions. | pending |
| P07 | Broadcast/background job durability and idempotency: accepted jobs survive restart where required; explicit partial-failure/duplicate policy; reuse existing queue/outbound records; `sending` alone is not exactly-once; smallest correct schema and claim/lease; no Redis/Celery by default. | pending |
| P08 | Final cumulative audit after P01–P07: same fixtures/hardware/interpreter, per-point and combined before/after, latency distributions, SQL count/plan, health responsiveness, job correctness/restart recovery, wall/CPU/RAM tradeoffs; full regression and independent review; remaining bottlenecks and ranked next opportunities. Final audit document/PR. | pending |

The status of P02–P08 is **pending** in this document at the time P01 is built. P01 completion
does not mark any later point started or done.

## Baseline and acceptance matrix

Every row is measured at the **same base SHA** with the same interpreter/hardware before the fix and re-measured after it; nothing here is a production claim.

| Pt | What is measured (baseline) | How (frozen procedure) | Accepted when |
|---|---|---|---|
| P01 | Health-probe completions and latency, and loop heartbeat gap, while a controlled slow adapter runs inside each traced route; SQL statements executed on the loop thread; adapter thread identity; thread-pool exhaustion under queued gated requests | `backend/tests/test_event_loop_isolation.py` run N× with `SENTINEL_LOOP_BENCH_OUT=<jsonl>` (see P01 plan §Benchmark); matched base-vs-head | RED fails on base for the expected blocking reason; GREEN passes at head; zero loop-thread SQL/adapters on every covered route; full backend suite no worse than base; static checks clean |
| P02 | Writer-lock hold time and concurrent-writer wait during generation / broadcast with stubbed converter / gateway; allocator retry reachability transcript | to be frozen in P02 plan | to be defined in P02 plan |
| P03 | Word/certificate queue wait vs execution time; false timeouts; sibling-kill count | to be frozen in P03 plan | to be defined in P03 plan |
| P04 | OCR wall/CPU/RAM per synthetic bilingual fixture, with thread limits swept | to be frozen in P04 plan | to be defined in P04 plan |
| P05 | Overlapping PyMuPDF operation outcomes in-process vs confined | to be frozen in P05 plan | to be defined in P05 plan |
| P06 | SQL statement count/plan and payload size for approvals/lists; Arabic search recall/precision fixtures | to be frozen in P06 plan | to be defined in P06 plan |
| P07 | Accepted-job survival across a restart; duplicate/partial-failure outcomes under injected crashes | to be frozen in P07 plan | to be defined in P07 plan |
| P08 | All of the above, combined | as defined below | as defined below |

## Per-point receipts (filled as each point proceeds; empty field = not yet exists)

### P01

| Field | Value |
|---|---|
| Branch | `perf/backend-opt-01-isolation` |
| Base | `origin/main` @ `f19e034c524090cc847ce9b82d7401babb334b83` |
| PR | draft PR targeting `main`, linked to #209 with “Refs” (not “Closes”): number recorded in `p01/build-handoff.md` and in the PR itself |
| Tests | `backend/tests/test_event_loop_isolation.py` (headline RED→GREEN, session/serialization/DAV safety, AST guard) |
| RED / GREEN / full-suite counts | see `backend-optimization-p01.md` §Evidence receipts |
| Build route | `anthropic/claude-sonnet-5-5` (native metadata verified, not self-description): `p01/route-receipt-launch1.md` |
| Independent review | pending — Opus `anthropic/claude-opus-5-5`, exact head, launched by the coordinator |
| Parent acceptance | **not accepted** (only the parent accepts) |

### P02 – P08

Branch / base / PR / tests / review / acceptance: **none yet** (points not started). Each fills the same table when the parent starts it.

## Review and PR rules for every point

- Independent reviewer reads the exact absolute worktree, base SHA and reviewed head, the actual diff/tests and the full caller flow; reviews permissions, native/thread safety, session ownership, timeout paths, cancellation, data loss and weakened assertions. Material findings are fixed and re-reviewed within the launch allowance (max four worker launches per point, two concurrent, one writer at a time).
- Project reviewers (`.codex/agents/<name>.toml`) apply when UI/notification/migration is touched: `i18n-rtl-reviewer`, `notification-template-reviewer`, `alembic-migration-reviewer`.
- PR opened with `gh pr create --repo janooh37-hue/sentinel --base main --head <branch>`; accurate plan/tests/baseline/review/limits; references the issue with “Refs”, never “Closes” for partial work; created as **draft** until independent review passes. PR read back (URL/head/base/state/draft/body) and `gh pr checks` inspected; pending CI is recorded as pending, never green.
- Commit explicit file lists; push only the owned branch.

## Final audit definition (P08)

After P01–P07 are individually accepted, build an owned integration worktree of the accepted PR heads (no merge to `main`, no production). On one machine, one interpreter, the frozen fixtures:

1. Per-point before/after and combined before/after for every baseline row above.
2. Latency distributions (p50/p95/p99/max, N and seed stated), health responsiveness under load, SQL count/plan, job correctness and restart recovery, wall/CPU/RAM trade-offs.
3. Full backend regression plus the new regression suites, and an independent review.
4. Remaining bottlenecks and ranked next opportunities (e.g. the PostgreSQL / scale-out reassessment from research §7), each labelled static / synthetic / potential.
5. Clear separation of isolated fake-engine measurements from real app behaviour; Windows/Word/Arabic-OCR figures are **unavailable** here and are reported as such — no fabricated production gains.

## Receipt log (append-only)

- 2026-10-20 — master plan and P01 plan written before any P01 implementation; base `f19e034c`; research linked above.
