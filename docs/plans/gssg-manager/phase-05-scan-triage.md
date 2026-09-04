# Phase 5 — Scan triage and filing

Status: not started. Branch: `refactor/p5-scan-triage`. Release dependency: Phase 4.

Follow [WORKFLOW.md](WORKFLOW.md): tests and code verification precede each implementation slice; complete required verification before every build.

## Outcome and amended interface

Manual intake and scan-inbox drain use shared classification while retaining their distinct response and filing responsibilities. Keep full extraction evidence: document-type confidence, alternatives, field value/confidence/source snippet, employee match, candidate references and ambiguity. A `mode` added to the old `dict[str, str]` result does not recover this information.

Proposed amendment to the original boundaries: a lossless classification result with two projections, one for the inbox decision and one for the existing intake HTTP response. Resolve this contract before writing new boundary tests. Keep reader and classify/classify_text boundaries, and public inbox filing operations. Reader behavior must allow QR-only classification after OCR unavailability; extraction-only routes may still require OCR.

## Verify current code first

- [ ] Read `api/v1/intake.py`, `api/v1/extractions.py`, `intake_service.py`, `scan_triage_service.py`, `scan_inbox_service.py`, OCR and extraction schemas/pipeline.
- [ ] Trace QR-first handling under `_OCR_GATE`: current intake falls back to decoded QR when OCR is unavailable, but returns 503 when neither is available.
- [ ] Inventory exact/fuzzy/stamped reference precedence, archived/deleted record handling, awaiting-scan rules, ambiguous candidates and employee matching.
- [ ] Capture current returned-form/external response fixtures, including alternatives and field confidence/snippets. Use synthetic documents only.
- [ ] Run intake, triage, inbox, scanback and parser baseline tests; identify which tests depend on actual OCR installation.

## Test-first slices

| Slice | Tests before code | Verified implementation task |
| --- | --- | --- |
| 5.1 Lossless outputs | Existing intake HTTP tests: known returned form; external extraction with multiple alternatives, confidence and source snippets round-trips unchanged | Define rich result and projections before replacing `IntakeResult`; retain discriminated HTTP response shapes |
| 5.2 Reader failure contract | QR present + OCR unavailable still matches; no QR + unavailable gives existing 503; invalid image gives existing 422; upload limit unchanged | Centralize raw reading without losing QR evidence on OCR failure; preserve the OCR concurrency gate |
| 5.3 Classification | Exact QR precedence, exact OCR ref, live/awaiting-scan record, fuzzy typo requiring confirmation, ambiguous matches never auto-file, unmatched external/manual route | Consolidate classification in `scan_triage_service`; inject reader only for byte-to-evidence work |
| 5.4 Filing lifecycle | Public inbox drain/confirm/undo: eligible scan files once, confirmation required where appropriate, undo detaches and restores correct state, OCR retries 1/2 then terminal error at current limit | Thread reader into drain while keeping durable filing and transaction behavior with inbox service |
| 5.5 Adapter integration | Real deterministic PDF/image/QR fixtures verify decoded evidence; include Arabic and mixed Arabic/Latin reference fixtures with literal expected reference, field values and source snippets; malformed input and text PDF behavior; only OCR-dependent cases require Tesseract | Implement raw-byte reader and remove duplicated route OCR wrappers after parity passes; preserve Arabic text and mixed-script reference matching |

## Detailed tasks

- [ ] Add focused coverage in `test_ocr_read_document.py`, `test_scan_triage_service.py`, `test_scan_inbox_service.py` and the existing intake API tests.
- [ ] Verify rich output equality at the HTTP boundary before migrating callers; assert actual values, not only response keys.
- [ ] Preserve candidate/parser tests unless equivalent behavior assertions survive. Do not delete a parser regression because it is below the new orchestration boundary.
- [ ] Keep confirmation and automatic filing distinct; do not promote fuzzy or ambiguous results during consolidation.
- [ ] Remove `intake_service.py` and `_ocr_file` copies only when both callers and all imports are migrated. Keep extraction route behavior appropriate to its own OCR requirement.
- [ ] Avoid skipping QR-only checks just because Tesseract is absent; isolate dependency requirements per test. Check in synthetic fixtures or use installed libraries, without adding an unreviewed runtime dependency for fixture generation.

## Verification before build and release

- [ ] Run exact resolved OCR, triage, intake, inbox document/N+1 and scanback test files, then backend checks. Verify response schemas/OpenAPI unchanged or use `sync-api-types` if an intentional contract change remains.
- [ ] Run required OCR adapter checks on a suitable isolated host with both Arabic (`ara`) and English (`eng`) language packs available; record missing packs/skips as pending evidence, not a passed bilingual check.
- [ ] Smoke synthetic QR-only, scanned returned-form and external-document uploads in English, Arabic and mixed script, plus inbox confirmation and undo; inspect actual field values, reference matching and source snippets.
- [ ] Rollback: retain compatibility with pending/auto-filed inbox rows; never replay completed items blindly or detach operator-approved documents automatically.

## Execution evidence

Pending: rich-result contract, current response fixtures, QR/OCR failure evidence, baseline/RED/GREEN commands, filing lifecycle and release checks.
