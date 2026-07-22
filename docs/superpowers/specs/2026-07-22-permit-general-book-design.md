# Permit → auto 1/5 General Book, with mulkiya + Emirates-ID OCR

**Date:** 2026-07-22
**Status:** Approved design — ready for implementation plan
**Mockup:** `docs/permit-general-book-mockup.html`

## Goal

Turn a security-permit record into an official, numbered Arabic General Book
(classification `5/1` "التصاريح الأمنية", ref `1/5/GSSG/{serial}`) that is the
printed permit paper. Capture the full vehicle-licence (mulkiya) details and the
visitor identity details, assisted by OCR of the uploaded licence and Emirates ID.

## Scope

In scope:
- New vehicle fields captured, OCR-assisted, and printed.
- Emirates-ID OCR to pre-fill a person (name / UAE ID / nationality).
- Auto-generate (and re-generate) the 1/5 Arabic letter from the permit roster.
- Manager (from the Managers records) signs the letter with their stored signature.

Out of scope (unchanged): permit lifecycle (renew/revoke/soft-delete), zones model,
gate visits, CSV register export, permission gating.

## Decisions (locked with the operator)

1. **Auto-generate on every permit create.** Creating a permit allocates a 1/5 ref
   and generates the book immediately. The book re-generates (new version, same ref)
   whenever the roster or header changes. Accepted trade-off: every permit consumes
   one official sequential ref (shared counter across all classifications).
2. **OCR pre-fills, operator confirms.** Every OCR'd field stays editable; manual
   entry works with no scan. Nothing is written hands-off onto the official document.
3. **New vehicle fields:** Colour, Vehicle type, Plate category, Traffic (T.C.) No.,
   Registration expiry. Existing `plate_no / plate_emirate / make_model / driver_name`
   stay; `plate_emirate` doubles as the authority / place of issue.
4. **Arabic official letter** (RTL). Body is the operator-supplied wording, made
   **count-aware (1 vs ≥2)** with generic «الفرد/الأفراد» terminology (not «الموظف»,
   so it suits any visitor/contractor). The **vehicle clause and الجدول الثاني table
   are omitted entirely when there are no vehicles**, and the zone phrase is **built
   from the actual selected zones**.
5. **Manager signs.** A signing-manager picker on the form; the letter shows the
   manager's name/title and embeds their stored signature image.
6. **Zones are colour-coded consistently everywhere** — form chips, register
   `ZoneBadge`, and the letter's zone badges: **green → green, red → red,
   work_residence → blue**. (green/red already correct; work_residence changes to
   blue, and the letter badges must match the register.)

## Data model

### `PermitVehicle` — add (all nullable)
| Column | Type | Notes |
|---|---|---|
| `colour` | String(32) | vehicle colour |
| `vehicle_type` | String(64) | e.g. Sedan / SUV / Pickup |
| `plate_category` | String(32) | plate class, e.g. Private |
| `traffic_no` | String(32) | Traffic Code (T.C.) No. — distinct from `plate_no` |
| `reg_expiry` | Date | licence expiry |

### `Permit` — add
| Column | Type | Notes |
|---|---|---|
| `book_id` | Integer, nullable | the generated Book (for print / re-version) |
| `manager_id` | Integer, nullable | signing manager (from Managers records) |

**Migration** (Alembic, hand-numbered `NNNN_permit_mulkiya_fields`): `batch_alter_table`
for both tables (SQLite). Columns nullable → no `server_default` needed. No named FKs
to `books`/`managers` (integrity enforced app-side, per repo convention).

## OCR

### Vehicle licence (new parser)
`core/extraction/vehicle_licence.py` → `extract_vehicle_licence(data: bytes) -> dict`.
Label-anchored regex over the existing Tesseract `ara+eng` text
(`core/extraction/ocr.py`). Targets: plate no., place of issue → emirate, plate
category, T.C. no., make/model, vehicle type, colour, registration expiry,
owner name → driver default. Conservative confidences; the module docstring states
the reliability ceiling (offline Tesseract on real UAE licences is low-yield —
this is *assist*, not hands-off).

### Emirates ID (reuse)
Reuse `core/extraction/emirates_id.py` (`extract_emirates_id`) → name / UAE ID /
nationality. No new parser.

### Endpoints (`api/v1/permits.py`)
- `POST /permits/scan-vehicle-licence` (multipart) → `VehicleLicenceScan` (the vehicle
  field dict). No employee matching.
- `POST /permits/scan-emirates-id` (multipart) → `PersonIdScan` (`name / uae_id /
  nationality`).
Both gated by `permits.manage`. The existing `attach_vehicle_document` is extended to
also fill empty new fields from `extract_vehicle_licence`.

## The 1/5 letter

### Generation
`permit_service.regenerate_permit_book(db, permit, user)`:
1. Build the Arabic RTL HTML body via a pure helper
   `core/permit_letter.py::build_permit_letter_html(permit, people, vehicles)`.
2. Call `document_service.generate_document(template_id="General Book",
   classification_code="5/1", fields={subject, body, company, window, manager_id},
   commit=True, revise_of_book_id=permit.book_id)`. Reuses the whole pipeline: ref
   allocation, docx render, Aztec stamp, PDF conversion, Book + Document rows.
3. On first call, set `permit.book_id`; later calls re-version under the same ref.

Called from `create_permit` and from every roster/header mutation
(`add_person`, `remove_person`, `add_vehicle`, `remove_vehicle`, `update_permit`,
`renew_permit`, `revoke_permit`) — one shared function at every mutation point.

**Resilience:** if PDF conversion fails, the permit + book + ref still commit
(`pdf_path` NULL), matching existing app behaviour.

**Cost ceiling:** re-render runs docx→PDF (Word COM) on each mutation — acceptable
for infrequent admin edits. `ponytail:` if edit throughput ever matters, switch to
regenerate-on-print. Noted, not built.

### Body (`build_permit_letter_html`, pure + tested)
Generic wording — «الفرد / الأفراد» (individuals), NOT «الموظف» — so the template
suits visitors, contractors, anyone, not only employees. Count is **1 vs ≥2**
(no dual).
- **Fixed opening:** «يطيب لنا أن نتقدم لسيادتكم بخالص التحية والتقدير، ويرجى من
  سيادتكم السماح …».
- **Person count (1 vs ≥2):**
  1 → «للفرد المبيّن بالكشف أدناه … حتى يتسنّى له القيام بعمله في الوقت المحدد»;
  ≥2 → «للأفراد المبيّنين بالكشف أدناه … حتى يتسنّى لهم القيام بعملهم في الوقت المحدد».
- **Vehicle clause — conditional on vehicle count:**
  0 → **omit the clause entirely** (no «المركبة/المركبات»);
  1 → «وبحوزته/وبحوزتهم المركبة المنوّه عنها بالجدول الثاني»;
  ≥2 → «وبحوزته/وبحوزتهم المركبات المنوّه عنها بالجدول الثاني».
  The possessive «ـه/ـهم» follows the **person** count; «المركبة/المركبات» follows the
  **vehicle** count.
- **Zone phrase** built from selected zones, joined with «و»:
  `green → المنطقة الخضراء`, `red → المنطقة الحمراء`, `work_residence → سكن الموظفين`.
- **Table 1 — الجدول الأول (بيانات الأفراد):** م / الاسم / رقم الهوية / الجنسية.
- **Table 2 — الجدول الثاني (بيانات المركبات):** اللوحة / الإمارة / الفئة / رقم المرور /
  النوع / الموديل / اللون / انتهاء الرخصة. **Omitted entirely when there are no vehicles.**
- **Header:** الرقم `1/5/GSSG/{serial}` + التاريخ; Aztec ref stamp.
- **Signature:** manager name/title + stored signature image via the existing
  `signature_render` / `*_sig` token path.

Nationality shows Arabic where a canonical EN→AR map exists (reuse
`notify_format` label maps if present), else as captured.

## Frontend

- **api.ts:** new vehicle fields, `manager_id`, `book_id`/`book_ref` on permit types;
  `VehicleLicenceScan` / `PersonIdScan` response types.
- **PermitFormDialog:** signing-manager `<select>` (managers list from the existing
  Managers API); per-person "Scan ID" and per-vehicle "Scan licence" buttons that call
  the scan endpoints and pre-fill (editable) fields; new vehicle inputs. On submit:
  create permit, then upload any held scan files to the created person/vehicle attach
  endpoints (mirrors current permit-paper attach-on-create).
- **PermitDetailDialog:** show new vehicle fields; add-person/add-vehicle inline forms
  get the scan buttons + new fields; show book ref + "Print permit (1/5)" → opens the
  book PDF.
- **PermitsPage:** per-permit "Print" opens the generated book PDF (via `book_id`).
  Register CSV/bulk-print unchanged.
- **Zone colour (all three):** green/red/blue coded consistently in `ZoneBadge` /
  `permitUtils.zoneTone` and matched by the letter's zone badges — `green→green`,
  `red→red`, `work_residence→blue`.
- **i18n:** en/ar strings for new fields, scan buttons, manager label. Bilingual
  surface — run `i18n-rtl-reviewer` + `notification-template-reviewer`.

## Testing (TDD)

- `test_permit_letter.py` — `build_permit_letter_html`: الفرد vs الأفراد (1 vs ≥2);
  0 vehicles omits the vehicle clause **and** الجدول الثاني; 1 → المركبة, ≥2 → المركبات;
  possessive ـه/ـهم follows person count; zone phrase for each zone combo; all vehicle
  fields rendered; asserts the Arabic strings.
- `test_vehicle_licence_ocr.py` — `extract_vehicle_licence` over sample OCR text.
- `test_permit_book_generation.py` — create_permit allocates `1/5` ref, creates Book,
  sets `permit.book_id`; a roster change re-versions the same ref.
- Model/migration round-trip for the new columns.
- Frontend: scan pre-fill (mocked endpoint), manager select, work-residence blue.
- i18n parity asserting the Arabic strings under `lng=ar` (per the recurring-leak rule).

## Open follow-ups (not blocking)
- Dual (exactly-2) Arabic grammar, if desired.
- EN→AR nationality coverage completeness.
- Regenerate-on-print instead of on-mutation, if edit throughput becomes a concern.
