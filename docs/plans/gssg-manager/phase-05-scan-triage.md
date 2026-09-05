# Phase 5 — Scan triage and filing

Status: implementation, local integrated checks, cross-reviews and smoke complete; Windows gates and release pending. Branch: `refactor/p5-scan-triage`. Release dependency: Phase 4.

Follow [WORKFLOW.md](WORKFLOW.md): tests and code verification precede each implementation slice; complete required verification before every build.

## Outcome and amended interface

Manual intake and scan-inbox drain use shared classification while retaining their distinct response and filing responsibilities. Keep full extraction evidence: document-type confidence, alternatives, field value/confidence/source snippet, employee match, candidate references and ambiguity. A `mode` added to the old `dict[str, str]` result does not recover this information.

Accepted amendment to the original boundaries: a lossless classification result with two projections, one for the inbox decision and one for the existing intake HTTP response. The contract was reviewed before implementation; its accepted scope is recorded below. Keep reader and classify/classify_text boundaries, and public inbox filing operations. Reader behavior must allow QR-only classification after OCR unavailability; extraction-only routes may still require OCR.

## Verify current code first

- [x] Read `api/v1/intake.py`, `api/v1/extractions.py`, `intake_service.py`, `scan_triage_service.py`, `scan_inbox_service.py`, OCR and extraction schemas/pipeline.
- [x] Trace QR-first handling under `_OCR_GATE`: current intake falls back to decoded QR when OCR is unavailable, but returns 503 when neither is available.
- [x] Inventory exact/fuzzy/stamped reference precedence, archived/deleted record handling, awaiting-scan rules, ambiguous candidates and employee matching.
- [x] Capture current returned-form/external response fixtures, including alternatives and field confidence/snippets. Use synthetic documents only.
- [x] Run intake, triage, inbox, scanback and parser baseline tests; identify which tests depend on actual OCR installation.

## Test-first slices

| Slice | Tests before code | Verified implementation task |
| --- | --- | --- |
| 5.1 Lossless outputs | Existing intake HTTP tests: known returned form; external extraction with multiple alternatives, confidence and source snippets round-trips unchanged | Define rich result and projections before replacing `IntakeResult`; retain discriminated HTTP response shapes |
| 5.2 Reader failure contract | QR present + OCR unavailable still matches; no QR + unavailable gives existing 503; invalid image gives existing 422; upload limit unchanged | Centralize raw reading without losing QR evidence on OCR failure; preserve the OCR concurrency gate |
| 5.3 Classification | Exact QR precedence, exact OCR ref, live/awaiting-scan record, fuzzy typo requiring confirmation, ambiguous matches never auto-file, unmatched external/manual route | Consolidate classification in `scan_triage_service`; inject reader only for byte-to-evidence work |
| 5.4 Filing lifecycle | Public inbox drain/confirm/undo: eligible scan files once, confirmation required where appropriate, undo detaches and restores correct state, OCR retries 1/2 then terminal error at current limit | Thread reader into drain while keeping durable filing and transaction behavior with inbox service |
| 5.5 Adapter integration | Real deterministic PDF/image/QR fixtures verify decoded evidence; include Arabic and mixed Arabic/Latin reference fixtures with literal expected reference, field values and source snippets; malformed input and text PDF behavior; only OCR-dependent cases require Tesseract | Implement raw-byte reader and remove duplicated route OCR wrappers after parity passes; preserve Arabic text and mixed-script reference matching |

## Detailed tasks

- [x] Add focused coverage in `test_ocr_read_document.py`, `test_scan_triage_service.py`, `test_scan_inbox_service.py` and the existing intake API tests.
- [x] Verify rich output equality at the HTTP boundary before migrating callers; assert actual values, not only response keys.
- [x] Preserve candidate/parser tests unless equivalent behavior assertions survive. Do not delete a parser regression because it is below the new orchestration boundary.
- [x] Keep confirmation and automatic filing distinct; do not promote fuzzy or ambiguous results during consolidation.
- [x] Remove `intake_service.py` and `_ocr_file` copies only when both callers and all imports are migrated. Keep extraction route behavior appropriate to its own OCR requirement.
- [x] Avoid skipping QR-only checks just because Tesseract is absent; isolate dependency requirements per test. Check in synthetic fixtures or use installed libraries, without adding an unreviewed runtime dependency for fixture generation.

## Verification before build and release

- [ ] Run exact resolved OCR, triage, intake, inbox document/N+1 and scanback test files, then backend checks. Verify response schemas/OpenAPI unchanged or use `sync-api-types` if an intentional contract change remains.
- [ ] Run required OCR adapter checks on a suitable isolated host with both Arabic (`ara`) and English (`eng`) language packs available; record missing packs/skips as pending evidence, not a passed bilingual check.
- [ ] Smoke synthetic QR-only, scanned returned-form and external-document uploads in English, Arabic and mixed script, plus inbox confirmation and undo; inspect actual field values, reference matching and source snippets.
- [ ] Rollback: retain compatibility with pending/auto-filed inbox rows; never replay completed items blindly or detach operator-approved documents automatically.

## Execution evidence

Starting commit: `f4619ed97e8e05ddd9b6314f7699294bd87e1da4`, the verified
Phase 4 production merge. Fresh worktree `/tmp/sentinel-gssg-p5`, branch
`refactor/p5-scan-triage`, initially clean. Runtime OpenAPI baseline: 275 paths.
Repository instructions, workflow, domain context and current caller inventory
are checked again at this execution commit.

The accepted contract keeps rich evidence in memory through classification and
two pure projections. It adds no durable evidence column, migration, HTTP schema
or frontend change. `DocumentRead` retains raw text/source, ordered QR refs,
per-page OCR text/confidence/language and the original unavailability reason.
A single existing OCR gate protects acquisition. Searchable PDF text is retained
exactly, including its trailing newline; successful blank OCR remains distinct
from an unavailable adapter. Intake keeps its complete returned-form/external
response, while inbox keeps its established coarse decision and fields map.

The initial audited policy changes require observed behavior RED then GREEN: distinct live
books within the same active reference tier become manual ambiguity; duplicate
exact employee identifiers and equal top fuzzy scores become manual ambiguity.
A unique exact QR still wins over OCR evidence. Unique canonical/edit-one refs
remain confirmation-only; fuzzy thresholds/ranking/rounding/candidate limits,
voided non-deleted book eligibility and non-automatic sick-leave routing remain.
There is no new Leave-row filing side effect.

The initial Builder A owned reader/classification, intake/extraction callers and synthetic
fixtures. Builder B owned inbox filing/confirmation/undo and their tests. Both
start with real HTTP or public service characterizations against the old owner.
An early typed-contract checkpoint stays within this phase's single PR; inbox
imports it only after review, and migrates a consumer only after the corresponding
producer behavior is green. Existing parser and lifecycle coverage remains until
an equal or stronger replacement passes.

Before application edits, the seven classification/intake/parser files passed
47 tests in 5.97 seconds; the six inbox/scanback/signed-copy files passed 32 tests
in 11.26 seconds. Both runs used fresh synthetic data, bytecode/cache writes
disabled, and the local Python 3.12 environment. These 79 tests contain no skips;
they do not claim a real Arabic OCR pass. The host has English and orientation
packs, while the required bilingual adapter proof remains a Windows gate.

The initial Sol workers subsequently exhausted their account quota. Their
completed edits and evidence were retained. The continuing phase agents own
classification/intake/extraction, reader/OCR/fixtures, and inbox/lifecycle/docs
respectively. Root now coordinates only, following the user's instruction to
delegate implementation, testing and release. Each following phase will begin
after verified deployment, in a fresh worktree with new agents receiving an
explicit handoff and no inherited conversation context.

### Classification and projection findings

The typed checkpoint is `51469315d710f476be560313b7f78c14ec1c185e`.
Old exact returned-form HTTP and external multi-signal HTTP characterizations
passed before caller movement. The new result retains extraction confidence,
alternatives, all field values/confidence/snippets, selected employee and ranked
candidates, literal/normalized reference observations and ambiguity evidence.

The new literal reference test initially upper-cased `gs-0042`; it passed after
retaining the literal observation while preserving the existing parser's
upper-case public output (13 parser/reference tests passed). Actual regression
failures also demonstrated first-book selection for two live stamped refs,
first-employee selection for duplicate exact IDs, and first-employee selection
for equal top name scores. The new classification records ambiguity and keeps
filing manual. Legacy candidate ranking remains unchanged; only ambiguity IDs
use deterministic sorting.

Two compatibility clarifications were verified against concrete callers. A
name-only match must not be labelled exact because two absent identifiers
compare equal; nonempty identifier guards fix that defect. A perfect fuzzy name
still requires confirmation under the accepted policy, whereas the old inbox
used score alone. Unmatched/manual inbox rows preserve legacy `match_score=0.0`
and candidate score `0.609`; canonical classification and intake retain the
unrounded best score `0.6086956521739131`. This is a deliberate coarse projection,
not evidence loss in the canonical result.

### Inbox migration and audited lifecycle fixes

Seven original public lifecycle characterizations passed individually against
the old consumer: exact auto filing, awaiting-scan confirmation, operator
confirmation, reversible undo, foreign-owner rejection, read-path containment,
and at-most-once drain. Additional old-owner checks passed for OCR retries
1/2 then terminal attempt 3, malformed input's immediate terminal error,
unmatched external candidate/fields/score, and real vault filing/undo.

One existing expiry limitation is preserved: extraction emits ISO dates while
the inbox's expiry capture accepts day-first dates. The synthetic external
document stores extracted `2030-12-31`, but an existing employee expiry
`2029-01-01` remains unchanged during filing and undo. This phase does not claim
to repair that date-conversion behavior.

The inbox now calls public `classify` and `project_inbox`, with optional
`DocumentReader` injection resolved at call time. The reader owns the single
shared OCR gate; the inbox no longer acquires it. Typed candidates become fresh
legacy JSON objects. Scheduler callers, persisted columns and HTTP schemas
remain unchanged. Retry/error handling, per-item commits and filing still
belong to the inbox service.

Review identified two concrete existing lifecycle defects. The approved fixes
have actual behavior RED/GREEN evidence:

| Public behavior | Observed old failure | Final check |
| --- | --- | --- |
| Drain source outside the configured root | Copied a synthetic sibling file and marked it auto-filed | Terminal per-item error, bounded existing detail; 1 passed in 0.65s |
| Confirm or override an outside-root source | Both operations filed without rejecting | Existing `SCAN_FILE_OUTSIDE_ROOT` 404 before staged changes; 2 passed in 0.67s |
| Missing, unknown or malformed undo target | Silent reopen without detach or raw `ValueError` | Existing `SCAN_BAD_STATE` 422 before changes; 8 malformed cases plus retained valid book undo passed in 1.13s |

The undo detail is `Scan item has no valid undo target.` Valid book/vault undo
behavior remains. A later public batch test verifies the committed containment
error does not prevent the next valid item from being filed. QR-only acquisition
with OCR unavailable consumes one normal attempt and files once. Multiple exact
live references remain manual with no artifact for either book.

Final owned inbox/scan-back/signed-copy matrix:

```bash
PYTHONDONTWRITEBYTECODE=1 GSSG_DATA_DIR=/tmp/gssg-p5-b-final \
  /tmp/gssg-load/venv/bin/python -m pytest -p no:cacheprovider \
  backend/tests/test_scan_inbox_service.py \
  backend/tests/test_scan_inbox_document.py \
  backend/tests/test_scan_inbox_nplus1.py \
  backend/tests/test_scanback_api.py backend/tests/test_scanback_query.py \
  backend/tests/test_scanback_push.py backend/tests/test_signed_copy_manage.py -q
```

Result: **57 passed in 13.61 seconds**, no skips. Ruff check and format check
pass for both owned changed Python files. No executable inbox caller retains
the old triage route, intake owner, OCR wrapper or enclosing OCR gate. Tests use
real temporary SQLite and files; only external acquisition is replaced in
explicit reader cases. Ordinary tests fail closed before Tesseract execution.

Initial fixture/assertion corrections are not counted as product RED: Settings
creates empty logs/vault directories; candidate scoring uses token-sort rather
than plain ratio; the existing expiry behavior is described above. The test
expectations were corrected before moving those behaviors, without modifying
production to fit an invented expectation.

### Final local candidate checks

Both upload callers migrated after their complete old responses passed. Loose
stamped and prefix-edit reference behavior passed old-owner characterizations,
failed at the incomplete new boundary, then passed after transfer. Numeric
suffix restrictions, Arabic exact anchors, unique QR precedence, liveness and
confirmation rules remain covered. The two old candidate tests retain their
names/outcomes at the pure projection boundary; all unique parser, matcher,
passport, scan-back and signed-copy cases remain. Executable searches are empty
for the removed intake owner, old triage route/value and duplicate OCR wrappers.

The frozen 18-file integrated matrix passed **155 tests, with five explicit
missing-Arabic-OCR skips, in 33.78 seconds**. It combines the ten classification,
intake, extraction and parser files, the seven inbox/scan-back files listed
above, and `test_ocr_read_document.py`. The five adapter checks remain pending
on the supported Windows host; real QR, PDF text, malformed input, concurrency
and resource-closure cases passed locally.

Full same-host diagnostic comparison retains exact messages and duplicate
counts while ignoring source line movement. Ruff has the same 22 existing
diagnostics. Mypy improves from 27 errors in 10 files to 22 in seven files,
removing five errors in the changed extraction/triage/inbox modules. Concise
format checking improves from 199 to 198 existing files, with no new file.
All three comparisons contain zero new diagnostic signatures. Runtime OpenAPI
matches the starting object exactly, including all 275 paths. No HTTP schema,
generated API type, migration or executable frontend change is needed.

A fresh whole-phase reviewer could not be spawned because the session reported
its agent thread limit. Review is assigned across file ownership: the reader
builder reviews classifier/upload/inbox and runs synthetic HTTP smoke; the
classification builder reviews reader/OCR/fixtures, the ten-node Windows OCR
gate and i18n. Neither approves their own implementation.

Both cross-reviews passed with no material findings. Reader/OCR resource
handling, synthetic Arabic shaping and visible values, and the ten-node gate
were reviewed independently of their author. Classifier/upload/inbox review
also confirms the final scope and unchanged contract.

Independent synthetic HTTP smoke passed at
`/tmp/gssg-p5-smoke-phase5.9Md1fK`. Real cookie authorization, SQLite, files,
PDF text and QR decoding cover English, Arabic and mixed-script intake,
external PDF/raster full response equality, extraction persistence,
QR-only/unavailable and malformed-input behavior, denials, confirmation and
undo. Only the executable OCR adapter is substituted. Final persistence and
source hashes passed; the owned server stopped and its port closed. This does
not replace the required real Windows OCR evidence.

Pending: supported Windows backend suite, ten-node real Arabic/English OCR
gate, one phase PR, merge, deployment and exact production HEAD/health
verification.
