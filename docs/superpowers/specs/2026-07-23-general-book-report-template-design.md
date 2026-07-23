# Report Template (No-Classification, No-Ref) — Design

**Date:** 2026-07-23
**Status:** Draft for review
**Author:** GSSG Manager session

## 1. Goal

Add a new document type — a **Report** (تقرير) — that reuses the **General Book
paper** (letterhead + footer) but is a distinct style:

- **No outbound reference number** — the `الرقم:` line never prints.
- **No government classification** (التبويب) — it is a plain report, not a
  classified book.
- **Signed by its submitter** (a supervisor reporting an incident and the like),
  not routed through a manager approval chain.
- Authored through an **in-app fill-in form** with a rich-text (HTML) body that
  is converted to the DOCX (`html_to_docx`).
- Lives in the existing **General Book list**, tagged as a Report.

The reference example is the operator-supplied `تقارير شاملة.docx` (a report to a
correctional-center director about an inmate). Its letterhead images are
byte-identical to the General Book template; the only real differences are the
absence of a ref line and the **labeled submitter signature block** plus a
closing formula.

## 2. Non-goals (deliberate scope cuts)

- No approval / routing chain — the report is self-signed at creation.
- No `ref_number` schema migration — reports get a unique **internal** filing id
  that never prints on the paper.
- No new recipient/contacts source — reuse `GeneralBookRecipient`.
- No fix for the pre-existing `html_to_docx` nested-list bug (see §9); reports
  don't need nested bullets. Flagged, not fixed.
- No changes to the live General Book template file.

## 3. Key decisions (locked with the operator)

1. **Storage:** in the General Book list, tagged as a Report; internal filing id,
   no `الرقم` line; **no DB migration**.
2. **Signer (signature block):** chosen from an **employee picker** (the "name
   picker" — it stays). The picked employee provides the
   `الاسم` / `المسمى الوظيفي` / `التوقيع` block: **name**, **designation**, and
   **signature**.
3. **Signing toggle:** a **"sign" checkbox** (default on). Checked + the signer
   has a signature on file → their signature image embeds in the `التوقيع`
   block. Unchecked, or no signature on file → the `التوقيع` line is left blank
   for a wet signature.
4. **Footer submitter:** the footer G-number (`{{ submitter_g }}`) is the
   **signed-in user** — the account the report was created on (audit trail).
   Automatic, and **distinct from the signer** in the body.
5. **Recipient (addressee):** the existing `GeneralBookRecipient` picker
   (`/general-book/recipients`) — suited to external addressees like a court or
   center director, with inline add.

## 4. Why this shape (and what was rejected)

The render core (`_adapt_general_book` → `_pp_general_book` → `html_to_docx` →
`pdf_chain`) was verified end-to-end against adversarial mixed AR/EN content
(bold, colors, ordered list, a 3-row table, a forced page break, page-2
spillover) and renders faithfully onto the general-book paper. So the report is
**that same path** with (a) no `ref`, (b) the submitter's signature embedded
instead of a manager's, and (c) a separate `report.docx` whose body carries the
labeled author block + closing formula.

Rejected:
- **Extend `word_book_service` with a report branch** — its mandatory
  `classification_code` and atomic classified-ref allocation directly fight the
  report's requirements, forcing scattered `if report:` bypasses.
- **A new Report model + separate list** — the operator wants it in the General
  Book list; a new table/list is far more code for no benefit.

## 5. The template — `report.docx`

Built from a **copy of the repo's General Book template**
(`GSSG-GS_300-003_General_Book.docx`) so the paper (headers/footers/settings) is
guaranteed correct. Edit **only the body**:

- Keep tokens: `{{ date }}`, `{{ recipient_name }}`, `{{ subject }}`,
  `{{ body }}` (the body sentinel anchor), `{{ manager_name }}`,
  `{{ manager_title }}`, `{{ manager_sig }}`.
- **Remove** the `{%p if ref %} الرقم: {{ ref }} {%p endif %}` line entirely.
- Replace the plain manager block with the labeled submitter block grafted from
  `تقارير شاملة.docx`, preceded by the closing formula:
  - `وتفضلوا بقبول فائق الاحترام والتقدير ,,,`
  - `الاسم: {{ manager_name }}`
  - `المسمى الوظيفي: {{ manager_title }}`
  - `التوقيع: {{ manager_sig }}`

Because it keeps the **same token names**, it renders through the **existing**
General Book adapter + post-process with **zero engine changes**, via
`DocxEngine.fill_general_book_path(report_template, data, out)`. Keeping it a
separate file contains the blast radius (the live General Book template churns in
place per CLAUDE.md).

The template file is registered in `core/constants.py` (`TEMPLATE_FILES`) and
`docx_engine._FORM_REGISTRY` under a `"Report"` key that maps to the same
`_adapt_general_book` / `_pp_general_book` pair. (Alternatively rendered directly
via `fill_general_book_path` without a registry entry; the registry entry is
preferred so the services gallery can list it as a template.)

## 6. Backend

### 6.1 `report_service.create_report(...)`

```
create_report(
    db, *, operator: User,          # the authenticated caller → footer submitter
    signer_employee_id: str,        # the signature-block signer (name picker)
    recipient_id: int | None,
    subject: str,
    date: str | None,               # default: today, dd-mm-yyyy
    body_html: str,
    sign: bool = True,
) -> Book
```

Steps:
1. Resolve the **signer** from `signer_employee_id` → `name_ar`, `designation`
   (job title) from the Employee record, and signature path from the `Submitter`
   registry (`stored_sig_path` keyed by employee_id).
2. Build the data dict as `word_book_service` does **minus `ref`**:
   `{ date, subject, recipient_name (from GeneralBookRecipient),
      body: GENERAL_BOOK_BODY_SENTINEL, body_html,
      submitter_g: operator.employee_id, cc: "" }` — the footer G-number is the
   **signed-in account**, not the signer.
3. `manager_override.apply(data, {name_ar, name_en, title: designation,
   sig_path}, embed=(sign and sig_exists), prefer_arabic=True)` — sets
   `manager_name` / `manager_title` (the **signer**), and embeds `sig1_path` →
   `{{ manager_sig }}` only when signing.
4. Render `report.docx` → `pdf_chain` → signed PDF. **Skip** the Aztec/ref stamp
   (`stamp_aztec_code`) and the ref header stamp — no ref mark. Run the existing
   footer post-process (`_postprocess_general_book_footer`) so the letterhead
   footer repeats on page 2.
5. Persist atomically:
   - `Book`: `category_id` = General Book category, `classification_code = None`,
     `employee_id = None` (admin-category, like general books — the submitter is
     recorded on the version, not as the book's subject),
     `ref_number` = unique internal filing id (`REPORT-{id}` set after flush, or
     an equivalent unique non-printing token), `subject`, `direction = "outgoing"`,
     `submitted_by_user_id = operator.id`, `approval_state = "approved"`.
   - `BookVersion`: `template_id = "Report"` (the report discriminator),
     `fields = {"signer_employee_id": signer_employee_id, "signed": sign}`,
     `document_id` → the generated file, `signed_pdf_path` = the signed PDF,
     `status = "approved"`, `signed_at`, `manager_sig_embedded = sign`.
   - `Document` row for the rendered file.

`ref_number` stays NOT NULL + UNIQUE — reports satisfy it with the internal id.
No migration.

### 6.2 Endpoint

`POST /books/reports` → `ReportCreate` → returns `BookRead` (with the rendered
signed PDF available through the standard book document endpoints).

```
ReportCreate {
  signer_employee_id: str
  recipient_id: int | None
  subject: str
  date: str | None
  body_html: str
  sign: bool = true
}
```
The footer submitter is the authenticated caller (from the auth dependency),
never sent in the body — only the **signer** (name picker) is.

One-shot: the report is created already-signed (or blank-signature if unchecked)
and appears in the list. A mistake is corrected with the existing **void**
action. (Preview-before-commit is an optional later enhancement; not built now.)

After the schema change, resync `openapi.json` + `api.types.ts`
(`/sync-api-types`) and commit them together.

## 7. Frontend

- **Service tile:** register the `"Report"` template so it auto-appears in the
  ApplicationPage services gallery; assign an emoji (`📊`) via the existing
  override map (`formEmoji.ts` `EXTRA_TEMPLATE_EMOJI` or `QUICK_ACTION_META`).
- **Form** (reusing `TemplateForm` field-dispatch + existing field components):
  - **Signer:** an **employee picker** (the name picker) → emits
    `signer_employee_id`; a read-only preview shows the resolved name +
    designation + signature status, and drives the sign-toggle availability.
  - **Footer submitter:** nothing to pick — the footer G-number is the signed-in
    user (shown read-only for clarity).
  - **Recipient:** `RecipientPickerField` (`/general-book/recipients`).
  - **Subject:** text.
  - **Date:** date input, defaults to today, editable.
  - **Body:** `arabic_rich_full` → the existing `RichEditor` (HugeRTE) with the
    A4 page guides (`GENERAL_BOOK_PAGE_VIEW`) — the in-app HTML editor feeding
    `body_html`.
  - **Sign checkbox:** default checked; auto-disables (and unchecks) with a hint
    when the picked submitter has no signature on file.
- **Submit:** new `api.createReport()` (mirrors `createWordBook`) → show the
  returned signed PDF (final look) → the report is in the books list.
- **List badge:** add a `report` kind (`📊`, `books.formKind.report`) to
  `pages/books/formKind.ts` so report rows are visually distinct from general
  books. The list payload must expose the report signal (derive from the current
  version's `template_id = "Report"` in `BookRead`).

## 8. Bilingual / RTL

- All new UI strings added to `frontend/src/locales/{en,ar}.json` with parity;
  the new `books.formKind.report` label in both.
- The template body is Arabic; static labels (`الاسم` / `المسمى الوظيفي` /
  `التوقيع`, closing formula, greeting) are baked into `report.docx`.
- Run the `i18n-rtl-reviewer` after touching the bilingual surfaces.

## 9. Mockup + end-to-end conversion test (operator-requested bug-catch)

The operator explicitly asked to mock it up and catch html→docs conversion bugs
before shipping.

- **Static HTML mockup** of the report form (in `docs/`, like the existing
  `docs/*-mockup.html`) for sign-off of the fill-in screen before building it.
- **End-to-end render test** (pytest): render `report.docx` with an adversarial
  AR/EN body (bold, colored heading, ordered list, a table, a forced page break,
  page-2 spillover) → assert: body landed, sentinel replaced, table present, **no
  `الرقم`**, signature embedded when `sign=True` / blank when `sign=False`, PDF
  converts. This is the standing html→docs regression guard.
- **Known pre-existing bug (out of scope):** a nested `<ul>` inside an ordered
  `<li>` is detached and floats to the end of the document. Reports don't need
  nested bullets; flagged only.

## 10. Testing

- Backend: `report_service` unit tests (data dict has no `ref`; submitter
  name/title/sig resolution; `sign` toggles embed; persisted `Book`/`BookVersion`
  shape with `template_id="Report"`, `classification_code=None`, unique internal
  ref). Endpoint test for `POST /books/reports`. The §9 render/PDF e2e test.
- Frontend: form renders the reused fields; submit posts `ReportCreate`; list row
  shows the Report badge.
- Gates: `ruff`, `mypy --strict`, `pytest` (filterwarnings=error), `pnpm lint`,
  `tsc -b`, `vitest`.

## 11. Files touched (estimate)

- **New:** `backend/templates/<report>.docx`; `backend/app/services/report_service.py`;
  report request/response schema; `report_service` + endpoint tests; report render
  e2e test; `docs/<report-form>-mockup.html`.
- **Edited:** `core/constants.py` (`TEMPLATE_FILES`), `docx_engine._FORM_REGISTRY`
  (`"Report"` entry), `api/v1/books.py` (endpoint), `schemas/book.py`
  (`ReportCreate`), `frontend` (service tile/emoji, report form fields, list
  badge, `api.ts`, locales), `openapi.json` + `api.types.ts` (resync).

## 12. Deploy notes

- The new `report.docx` must ship in `backend/templates/` (committed) and be
  present on the live server after `mng update`.
- Per CLAUDE.md: commit + push to `origin/main` or the next pull overwrites it;
  build uses the committed `api.types.ts`, so resync after the schema change.
