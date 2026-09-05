# Phase 6 — Document artifacts

Status: merged. Branch: `refactor/p6-document-artifact`. Release dependency: Phase 5 (released at `ee1d9f41925efe59baea3b64217c254967ce35e2`).

Follow [WORKFLOW.md](WORKFLOW.md). Write/retain behavior tests first and inspect the current code before every implementation slice. Finish tests, source review and required checks before every build.

## Outcome and amended interface

Share naming, rendering/copying, stamps, conversion and output placement while keeping filing rows and caller-specific PDF failure policy with callers. **A Word-authored session must finalize from its saved DOCX, never rerender from template data.**

Replace the original template-only `produce` proposal with distinct operations for template rendering and processing an existing DOCX, sharing a narrow internal pipeline where behavior is actually equivalent. Proposed names: `produce_from_template(...)` and `produce_from_docx(source_path=..., ...)`, returning artifact paths and conversion outcome. Agree the amended public contract before new boundary tests. Existing `finish_word_session`, preview and signed-render interfaces remain behavior-test boundaries.

Word preview owns its fixed cache destination, lock, snapshot timestamp and invalidation. It may reuse a conversion operation, but must not adopt final-artifact naming/collision policy. Keep core/services dependency direction honest; use `services/artifact_service.py` if orchestration depends on service adapters, rather than hiding a cycle behind lazy imports.

## Verify current code first

- [ ] Read `document_service.py` generation, companion and signed rendering; `word_book_service.py` initial render, finish, preview and reopen; included-papers conversion; DOCX engine stamp/signature helpers.
- [ ] Trace `shutil.copy2(session.working_path, dest)` and cleanup in finish. Capture a synthetic saved document with text/formatting absent from its template.
- [ ] Trace preview lock, `preview-src.docx/pdf`, copy-time mtime and save-during-conversion handling. Verify Windows file sharing behavior assumptions.
- [ ] Map each caller's naming, stamps, signature insertion, merged-paper policy, conversion exception/None handling, file cleanup and database transaction ownership.
- [ ] Run existing Word finish/preview/sign/reopen and generation tests. Read `test_word_book_sign.py` content/signature assertions before changing converter injection.

## Test-first slices

| Slice | Tests before code | Verified implementation task |
| --- | --- | --- |
| 6.1 Template artifact | `test_artifact.py`: real synthetic DOCX result, literal name pattern/collision outcome, reference/Aztec/footer where required, converter success/None/exception | Introduce template operation and converter boundary; inject the external PDF converter |
| 6.2 Existing DOCX | Saved source contains unique authored text, formatting and embedded content; finalized output preserves those values and source policy; signature stays at expected anchor | Add existing-DOCX operation. Inspect produced DOCX ZIP/XML or document model; returned paths alone are insufficient |
| 6.3 Failure policy | Each public caller: lenient DOCX-only behavior where supported; `GENERATION_PDF_FAILED`/`INCLUDED_PAPERS_PDF_REQUIRED` where required; failed finish retains recoverable session/source; partial output cleanup | Preserve each caller's policy instead of globally swallowing/raising conversion failures |
| 6.4 Preview races | Existing preview public API: unchanged saved file reuses cache; new save refreshes; save during conversion makes next poll refresh; concurrent previews retain lock behavior; missing save/source keeps existing errors | Keep snapshot/cache orchestration in Word session; reuse only compatible artifact work |
| 6.5 Caller migration | Generation, companion documents, rich signing, Word initial render/finish/preview/reopen, permits and vehicle letters keep actual output content and response behavior | Migrate one caller per verified slice, retaining transaction ownership and output conventions |

## Detailed tasks

- [ ] Define source ownership and copy-versus-mutate guarantees for both operations. Preview must convert a snapshot rather than Word's actively saved file.
- [ ] Use `tmp_path`, synthetic fixture data and a fake converter that writes deterministic output. A fake PDF is not evidence of Word layout fidelity.
- [ ] Move naming/output-directory helpers only where their caller semantics match; document exceptions rather than forcing every path through one policy.
- [ ] Thread converter injection through public callers; HTTP fixtures should replace the named external conversion adapter, not engine internals.
- [ ] Retain and strengthen DOCX body/signature/formatting assertions while removing private engine patches. Record equivalent coverage before every old-test deletion.
- [ ] Keep included-papers direct conversion out of scope unless the source-DOCX operation provides proven equivalent behavior and test coverage.
- [ ] Never save over tracked `backend/templates/*.docx`; template source must remain byte-identical in this phase.

## Verification before build and release

- [ ] Run artifact, all Word-book, document, General Book, permit and vehicle-letter tests; resolve actual file paths before invocation. Complete backend static/full-test gates.
- [ ] Search old private imports and converter patches; keep only documented external boundary replacements. Compare template hashes and inspect generated test content.
- [ ] On isolated Windows Word environment, generate a synthetic Leave Application and finish a Word-authored General Book; inspect DOCX/PDF stamps, signatures, authored text and known formatting regression. Exercise preview after a new save.
- [ ] Run `i18n-rtl-reviewer` for generated document/layout changes; verify Arabic shaping and English/Arabic content in actual outputs.
- [ ] Rollback: preserve completed artifacts and active session sources; code revert must not delete newly filed documents or invalidate open sessions. Verify compatibility before redeploy.

## Execution evidence

The amended contract is frozen as separate template-rendered and existing-DOCX
operations. The saved DOCX remains authoritative, conversion outcome is returned
to each caller, and callers retain their transaction, packaging and PDF-failure
policies. Preview retains its fixed filenames, global lock and snapshot mtime.

Observed local evidence so far:

- The artifact owner captured 33 affected pre-edit characterization tests before
  source edits, then 40 focused old/new integration tests after migrating primary,
  companion, rich/authored signing and included-paper reconstruction callers.
- The Word-session owner observed two RED recovery failures showing package and
  commit failures deleted the saved source. The completed slice passed all 11
  finish tests, and the source-frozen Word lifecycle gate passed 49 tests plus
  three loopback route tests. No old test was removed.
- The synthetic preview API baseline passed with approved loopback access. The
  earlier sandboxed invocation could not open its local listener and is not
  counted as product evidence.
- Read-only inspection of installed Windows docx2pdf 0.1.8 confirmed it uses
  shared `Dispatch("Word.Application")` and calls `Quit()`. Real injected
  `DispatchEx` artifact/layout proof therefore still requires an exclusive Word
  environment. Default-chain method and process-pool checks are supplemental
  while those unchanged adapters remain outside this phase.

Final frozen local evidence:

- Integrated public-caller gate: 175 passed in 53.79 seconds.
- Full backend gate: 2,113 passed and 15 skipped in 528.18 seconds. The skips
  are one opt-in real Word test, five real-OCR tests unavailable on Linux, and
  nine established live-finance skips; none is counted as external-adapter proof.
- Ruff and mypy each retain exactly the Phase 5 baseline signatures: Ruff 22
  findings, mypy 22 findings in seven files, with zero added or removed normalized
  signatures. All 12 changed Python files pass Ruff formatting.
- Runtime OpenAPI exactly matches the committed contract at 275 paths; both
  normalized hashes are
  `1a0d21a722ad6eff4de52292c49802e46c59ade34f77cfe983502490b84b63e9`.
  OpenAPI, generated frontend types and tracked template DOCX files have no diff
  from the Phase 5 starting commit.
- Independent Standards, Spec and i18n/fidelity source reviews resolved every
  material finding. The corrected opt-in smoke and its bounded maintenance
  wrapper have an accepted evidence binding, but no Word operation has run.

Pending before release: the authorized isolated real Word group with synthetic
artifacts and visual Arabic/English review, the supported Windows backend/static
and OCR gates, PR readiness/merge, deployment, health and exact production HEAD
verification.
