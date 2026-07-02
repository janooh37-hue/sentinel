# Passport-Number OCR — Design Spec

**Date:** 2026-07-02
**Status:** Approved (brainstorming) — ready for implementation plan
**Author:** pairing session (janooh37 + Claude)

## Problem

`Employee.passport_no` is empty for all 300 employees (0/300 populated). As a
result the **Passport Release** list form (`employees_table`, key
`Passport Release List`) auto-fills ID / name / nationality on G-number lookup
but leaves the **passport number** blank — the operator must type it every time.
Employees already have passport scans uploaded to their vault, but nothing reads
the number out of them.

## Goal

Populate `Employee.passport_no` by OCR'ing each employee's stored passport scan,
writing **only high-confidence results automatically**, and giving a clear
**manual-entry** path for everything else. Once populated, the Passport Release
list fills the passport column with no change to the form itself.

## Non-goals (YAGNI)

- No dedicated "passport review queue" page. The backfill report + per-profile
  status badges cover discovery (user decision 2026-07-02).
- No employee-list passport filter/column (user decision 2026-07-02).
- No change to the Passport Release form / `employees_table` — it already reads
  `passport_no`; it simply starts filling.
- No extraction of passport **expiry**/**name** into records here (the pipeline
  can read them, but scope is the number only). `passport_expiry` already exists
  on the model and is out of scope for this change.
- No overwrite of an existing non-empty `passport_no` without explicit operator
  confirmation.

## What already exists (reuse)

| Piece | Location |
|-------|----------|
| OCR engine (Tesseract ara+eng, PDF rasterise, embedded-text preference) | `backend/app/core/extraction/ocr.py` (`ocr_bytes_to_text`, `text_from_pdf`) |
| Passport MRZ parser (TD3, checksum-validated, `mrz>=0.6.2`) | `backend/app/core/extraction/passport_mrz.py` |
| `DocType.PASSPORT` + classifier | `backend/app/core/extraction/types.py`, `classifier.py` |
| Extraction pipeline + `needs_review` status | `backend/app/services/extraction_service.py` |
| Vault file access (`list_files(g, "passport")`, `resolve_file`, preview) | `backend/app/core/vault_manager.py`, `app/services/vault_service.py` |
| Employee `passport_no` column + `PATCH /employees/{id}` (`employees.edit`) | `backend/app/db/models.py`, `app/api/v1/employees.py`, `app/schemas/employee.py` |
| Batch-script pattern (dry-run/apply, DB backup, report) | `backend/scripts/update_employees_2026_07.py` |

## New pieces

### A. Printed-field fallback parser

When a scan has no clean MRZ (mixed scan quality is expected), fall back to
reading a **labeled** passport number from the OCR text.

- Add to `passport_mrz.py` (or a sibling `passport_printed.py`) a helper
  `extract_printed_passport_no(text: str) -> tuple[str, str] | None` returning
  `(number, source_snippet)`.
- Match labels: `Passport No`, `Passport Number`, `Passport #`, `رقم الجواز`,
  `رقم جواز السفر` (case-insensitive, tolerant of `:`/spacing), capturing a
  plausible passport token (e.g. `[A-Z0-9]{6,12}`, at least one digit).
- Confidence: **low** (~0.5) — never auto-written (see write policy).

### B. Employee passport-extraction service

`backend/app/services/passport_ocr_service.py`:

```
extract_passport_for_employee(db, g_number) -> PassportExtractResult | None
```

- Resolves the employee's passport scans via `Vault.list_files(g, "passport")`.
  If none → return `None` (status "missing").
- Picks the best candidate (most recently modified file). OCR via
  `ocr_bytes_to_text(path.read_bytes())`.
- Runs MRZ parser first; if a checksum-valid number → method `mrz`, high
  confidence. Else printed-field fallback → method `printed`, low confidence.
  Else → method `none`.
- Returns `PassportExtractResult{number: str|None, confidence: float,
  method: 'mrz'|'printed'|'none', source_snippet: str|None, scan_filename: str}`.
- **Does not write.** Callers apply the write policy.
- Respects the existing `OCR_GATE` semaphore; raises/propagates
  `OcrUnavailableError` for callers to handle.

### C. Data model — provenance column

Add `Employee.passport_no_source: Mapped[str | None]` (`String(16)`, nullable):
values `mrz` | `manual` | `NULL`. Alembic/SQL migration + backfill leaves
existing rows `NULL`.

Badge derivation (frontend, from `passport_no`, `passport_no_source`, and
whether a passport scan exists):

| passport_no | source | scan exists | Badge |
|-------------|--------|-------------|-------|
| set | `mrz` or `manual` | — | **Verified** |
| empty | — | yes | **Needs review** |
| empty | — | no | **Missing** |

"Scan exists" is derived live from the vault (a boolean added to the employee
detail response, e.g. `has_passport_scan`), not stored.

### D. Write-policy layer

Single helper used by all trigger paths:

```
apply_passport_extraction(db, employee, result, *, allow_overwrite=False)
```

- Auto-write **only** when `result.method == 'mrz'` (checksum-validated) **and**
  (`employee.passport_no` is empty **or** `allow_overwrite`). Sets
  `passport_no = result.number`, `passport_no_source = 'mrz'`.
- `printed` / `none` / low confidence → no write; report "needs review".
- Never overwrites a non-empty value unless `allow_overwrite` (only the explicit
  on-demand confirm path passes it).

## Trigger paths

### 1. Backfill script — `backend/scripts/backfill_passport_no.py`

- Follows `update_employees_2026_07.py`: `--dry-run` (default) / `--apply`,
  timestamped DB backup before writes, sequential iteration (OCR is
  semaphore-capped anyway), `if __name__ == "__main__": raise SystemExit(main())`.
- For each employee with a passport scan: extract → apply write policy.
- Prints a **report**: counts + explicit lists of `filled` (auto-written),
  `needs_review` (scan present, no confident number), `no_scan`. The
  `needs_review` list is the operator's manual worklist.

### 2. Auto-on-upload

- Hook the vault upload path (`vault_service.save_upload` or the
  `POST /employees/{id}/vault/upload` handler) so that when `kind == 'passport'`
  it runs `extract_passport_for_employee` + `apply_passport_extraction`
  (synchronous; a single file, a few seconds, OCR-gated).
- Failure (`OcrUnavailableError`, parse miss) is non-fatal: the upload still
  succeeds; passport just stays "needs review".

### 3. On-demand — profile "Read from scan"

- New endpoint `POST /employees/{id}/passport/extract`
  (capability `employees.edit`): runs extraction, returns the suggestion
  `{number, confidence, method, source_snippet, scan_filename}` **without
  writing**.
- Operator confirms → normal `PATCH /employees/{id}` with `passport_no`. **Any
  `PATCH`-originated write records `source='manual'`** (a human vouched for it),
  whether typed or confirmed from a suggestion. Only automatic (batch /
  auto-on-upload) writes record `source='mrz'`. This keeps the provenance model
  to exactly two values and removes any ambiguity about confirmed suggestions.

## UI (employee profile only)

- Passport No. field: editable under existing `employees.edit` gate.
- Status badge next to it: Verified / Needs review / Missing (per table above).
- "Read from scan" button: visible when a passport scan exists; calls the
  extract endpoint, shows the suggested number + confidence + which method, with
  Confirm / Dismiss. Confirm saves; Dismiss lets the operator type manually.
- i18n: EN + AR strings for the badge states, button, and confirm dialog
  (project has an i18n reviewer; keep Arabic/English separated).

## Error handling

- `OcrUnavailableError` (Tesseract missing / lang packs): endpoint returns a
  clear error the button surfaces ("OCR unavailable on server"); batch logs and
  continues; upload hook swallows and leaves status unchanged.
- Missing `mrz` package: `passport_mrz.py` already depends on it — verify it is
  installed in the service venv as a pre-req; if absent, MRZ path degrades to
  printed-field only (still safe, just fewer auto-writes). Note in the plan as a
  dependency check.
- No passport scan → "Missing"; extract endpoint returns 409/empty suggestion.
- Non-passport-looking OCR (wrong doc filed under passport) → MRZ checksum fails
  and printed-field match is absent → `none`, no write.

## Testing

- Printed-field parser: EN (`Passport No: A1234567`) + AR (`رقم الجواز`) samples,
  and negative (no label) → `None`.
- Write policy: `mrz` writes + sets source; `printed`/`none` do not; existing
  non-empty value not overwritten unless `allow_overwrite`.
- `extract_passport_for_employee`: fixture image/PDF with a synthetic MRZ →
  `mrz`; a printed-only fixture → `printed`; no-scan employee → `None`.
- Extract endpoint: returns suggestion without writing; capability-gated.
- Upload hook: uploading a passport auto-fills when high-confidence + empty.
- Backfill: `--dry-run` writes nothing and reports correct buckets.
- Badge/`has_passport_scan` serialization on the employee detail response.

## Rollout

1. Ship code (migration + backend + UI) via branch → main → `mng deploy`
   (frontend build needed for the profile UI).
2. Run `backfill_passport_no.py --dry-run`, review the report, then `--apply`.
3. Work the `needs_review` list manually from employee profiles.
4. Auto-on-upload keeps records filled going forward.

## Touch points (for the plan)

- New: `backend/app/services/passport_ocr_service.py`,
  `backend/scripts/backfill_passport_no.py`, printed-field parser,
  `POST /employees/{id}/passport/extract` route, migration for
  `passport_no_source`, frontend profile passport field/badge/button + i18n.
- Modified: `employee` schema (`passport_no_source`, `has_passport_scan`),
  employee update service (record `source`), vault upload path (auto-extract
  hook), employee detail serialization.
