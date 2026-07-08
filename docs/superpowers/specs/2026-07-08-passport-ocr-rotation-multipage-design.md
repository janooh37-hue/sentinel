# Passport OCR — offline rotation + multi-page MRZ selection

**Date:** 2026-07-08
**Branch:** `feat/passport-ocr-rotation-multipage`
**Status:** Design approved, pending implementation plan

## Problem

Extracting the passport number from a stored passport scan fails on the real-world
inputs the office receives:

- **Mixed media/quality** — clean PDFs, flatbed scans, and phone photos, in varying quality.
- **Orientation** — pages are not all upright (sideways/upside-down). The current OCR pass
  (`--psm 4`, no rotation handling) reads a rotated MRZ as garbage, so the TD3 checksum
  fails and the number is lost.
- **Cover pages / wrong page** — the passport bio-data page is often on page 2+ of a PDF or
  a multi-page scan, behind a cover page. The current pipeline OCRs every page and
  concatenates the text, so the printed-number regex can match a *reference* or partial
  number on the cover before ever reaching the real MRZ page.

## Constraint (decided)

**Fully offline.** Passport images must never leave the LAN. No external vision API
(Claude/OCR-as-a-service) is permitted. This rules out cloud vision; the fix improves the
local Tesseract pipeline only.

## Scope

Both entry points:

- **Live upload** — passport uploaded/scanned in the app must extract the number promptly.
- **Bulk backfill** — one-time pass over already-stored passport scans; may run slowly in
  the background.

Both funnel through the single function
`passport_ocr_service.extract_passport_for_employee(db, g_number)`, called from:

1. `employees.py:~271` — passport upload hook (best-effort auto-fill, never fails the upload).
2. `employees.py:~492` — `POST /{employee_id}/passport/extract` on-demand suggest (never writes).
3. `scripts/backfill_passport_no.py` — bulk dry-run/apply.

Target output is the **passport number**. Name/DOB/expiry come free from a valid MRZ but are
not the goal.

## Approach (chosen: "A" — MRZ-first escalating pipeline, no new heavy dependencies)

Stop treating the document as one flat blob of concatenated text. Instead, work at the
**image level** and use the **TD3 MRZ checksum as the page-and-rotation selector**: the page
and orientation that produce a checksum-valid MRZ is, by construction, the real bio-data
page seen the right way up. This resolves orientation and cover-page selection with one
mechanism.

Uses only already-installed dependencies (PIL, pytesseract, the `mrz` checker, PyMuPDF) →
**zero venv change on the live server**, low regression risk. OpenCV preprocessing (deskew,
adaptive binarization, morphological MRZ-band localization) is explicitly deferred to a
possible later phase, only if phone-photo accuracy is still insufficient after this work.

## Architecture

- **New module `app/core/extraction/passport_scan.py`** — image-level MRZ orchestration
  (rotation + per-page checksum scoring). Pure logic with an injectable OCR function, so it
  is unit-testable without Tesseract.
- **`passport_ocr_service.extract_passport_for_employee` becomes an escalation controller** —
  a cheap text pass first, image-level escalation only on failure. Everything downstream
  (the endpoint, the upload hook, the backfill script, and the write policy) is unchanged.
- **No new dependencies.**

## Data flow (escalation)

```
raw bytes
  │
  ├─ Step 1  CHEAP (fast, unchanged): ocr_bytes_to_text → extract_passport
  │            └─ checksum-valid MRZ (conf ≥ 0.9)? → RETURN  (covers clean/upright PDFs)
  │
  ├─ Step 2  ESCALATE (only if Step 1 yields no valid MRZ):
  │            rasterize @ 300 DPI (image input → single page), then per page (cap 8):
  │              for each orientation (OSD-guided; else brute-force 0/90/180/270):
  │                MRZ-focused OCR pass  (lang="eng", --psm 6,
  │                                       tessedit_char_whitelist = A–Z 0–9 <)
  │                → find_mrz_lines → TD3CodeChecker
  │              SHORT-CIRCUIT on the first checksum-valid MRZ
  │            └─ pick best candidate across pages (valid 0.95 > structural 0.55)
  │
  └─ Step 3  PRINTED FALLBACK (no valid MRZ anywhere):
             labelled-number regex per page (ara+eng), NOT cross-page concatenated;
             low confidence, review-only — never auto-written
```

**Printed-fallback page selection (explicit):** run the labelled-number regex on each
page's ara+eng text independently. Among pages with a digit-bearing match, prefer a page
whose text also contains MRZ-like content (a line with several `<` fill characters — the
bio-data page); if none qualifies, take the last matching page (the data page typically
follows a cover). This avoids latching onto a reference/partial number on a cover page.
Because this path is review-only, a wrong guess is never written.

## Components (`passport_scan.py`)

- `MrzCandidate` dataclass — `{ number, confidence, valid: bool, page_index, rotation }`.
  page/rotation recorded for audit/debug.
- `best_mrz(pages: list[Image]) -> MrzCandidate | None` — the scorer above. Iterates pages
  (capped) × orientations, short-circuits on the first checksum-valid MRZ, otherwise returns
  the best structural candidate.
- `ocr_mrz_pass(image) -> str` — the MRZ-optimized Tesseract pass: `lang="eng"`,
  `config="--psm 6 -c tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<"`.
  Arabic and the default charset both degrade the OCR-B MRZ font badly; this restricted pass
  is the single biggest accuracy lever. Reuses `ocr._resolve_tesseract_cmd`.
- `_orientations(image)` — Tesseract OSD (`image_to_osd`) to pick one rotation when
  confident; on failure or low confidence, yields all four rotations. Rotations via
  `image.rotate(-deg, expand=True)`.

## Controller changes (`passport_ocr_service.py`)

- `extract_passport_for_employee` reads the newest passport scan's raw bytes (as today), then:
  1. **Cheap pass** — `ocr_bytes_to_text` → `extract_passport`; return immediately if a
     checksum-valid MRZ (keeps the live path fast for clean docs; preserves current tests).
  2. **Escalate** — `best_mrz(pages_from_bytes(raw))`; if valid, return an `mrz` result.
     A structural-only candidate (0.55) is kept as best-so-far.
  3. **Printed fallback** — `extract_printed_passport_no` run per page on ara+eng text
     (not cross-page concatenation), with the page-selection rule above; returned at 0.5,
     review-only.
- Result ordering: valid MRZ (0.95) > structural MRZ (0.55) > printed (0.5) > none.
- `PassportExtractResult` may carry the winning `page_index`/`rotation` in `source_snippet`
  for audit; the existing fields and `method` strings (`"mrz"`/`"printed"`/`"none"`) are
  preserved for compatibility.

## Performance guardrails

- Escalation fires **only when the cheap pass already failed** — clean docs never pay for it.
- **Short-circuit** on the first checksum-valid MRZ.
- **OSD-first** so most pages get one OCR pass, not four.
- **Page cap** (`MAX_PAGES = 8`) so a pathological large PDF can't run away.
- **`OCR_GATE` acquired per Tesseract call** (not held across the whole document) so a
  background backfill can't starve a live upload. The shared cap of 2 is respected.
- Rasterization DPI for the escalated pass is **300** (vs the general 200) — better MRZ read.

## Error handling (upload never fails)

Every failure degrades to "no confident number → review", as today:

- `OcrUnavailableError` (Tesseract/lang-pack missing) → `none` result, logged.
- Corrupt/unreadable file (`InvalidImageError`) → `none`.
- A per-page Tesseract error skips that page/orientation and continues — never fails the doc.
- `mrz` package missing → structural parsing disabled (upstream already returns `None`);
  flow falls to the printed fallback; logged once.
- OSD failure/low confidence → 4-way brute-force for that page.
- The upload hook stays best-effort and never raises.

## Write safety (unchanged — do not weaken)

`apply_passport_extraction` continues to auto-write **only** a checksum-valid MRZ number
(confidence ≥ `MRZ_AUTOWRITE_CONFIDENCE` = 0.9) into an **empty** field. Structural-but-invalid
MRZ (0.55) and printed matches (0.5) are returned for human confirmation, never written.
Writing a *wrong* passport number stays impossible.

## Testing

- **Unit (no Tesseract; inject a fake `ocr_mrz_pass` keyed by page/rotation):**
  - Cover page — page 0 yields junk/invalid, page 1 yields a valid MRZ → `best_mrz` picks
    page 1, upright rotation.
  - Rotation — only the 180° render yields a valid MRZ → picks that rotation.
  - Short-circuit — returns on the first valid MRZ without exhausting later pages.
  - Structural-but-invalid MRZ → returned at 0.55, not auto-written.
  - No MRZ anywhere → printed fallback runs per-page (not cross-page concatenation).
- **Service-level (`test_passport_ocr_service.py`):** existing cheap-pass tests keep passing;
  new tests prove escalation fires when the cheap pass fails.
- **Optional integration (`skipif(not tesseract_available())`):** a synthetically rendered,
  checksum-valid TD3 MRZ image, rotated all four ways, must extract correctly. No real
  passport PII in fixtures.
- Must satisfy the repo's strict gates: `mypy --strict`, `ruff`, and `pytest` with
  `filterwarnings=error`.

## Rollout

- Live production checkout: land on the feature branch, then merge to `main` and push to
  `origin/main` (or `mng update` will overwrite it). No new dependencies → no server venv
  change; Tesseract is already installed.
- Behavior change is **additive** — escalation only fires where the current pipeline already
  fails — so the clean-document path is unchanged and regression risk is low.

## Out of scope

- OpenCV-based preprocessing (deskew, adaptive threshold, MRZ-band localization) — deferred
  to a follow-up phase (**Approach B**). Escalate to it not only if accuracy is zero, but
  whenever Approach A's output is **weak, unreliable, review-heavy, or too slow** — see the
  "Decision gate" and "Approach B requirements" sections in the implementation plan. B must
  be designed to avoid those failure modes: reliable/correct auto-writes (validated check
  digits), a negligible manual-review queue, and MRZ-band-only OCR for speed — still fully
  offline, write-safety unchanged.
- Extracting/writing name, DOB, expiry (available from a valid MRZ but not the goal here).
- Any cloud/external OCR.
