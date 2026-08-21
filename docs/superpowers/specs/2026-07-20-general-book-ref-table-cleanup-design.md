# General Book — ref cleanup, table templates, footer & HugeRTE soft-remove

**Date:** 2026-07-20
**Status:** Draft, revised after TWO 3-agent review rounds (codebase-accuracy,
security, i18n/scope) + a user design session (ref layout `الرقم : {serial}/{tab}/1`;
two base templates + custom CRUD; add-row-only grid, everything else in Word;
page-2 overflow). Round-2 fixes folded: split scan-regex, real
`documents.py:540-548` header-injection fix, `delete_template` is new work,
remove+re-inject idempotency, validation excludes `w:tbl` + column-count dummy,
EN parity for grid/base-template names. Awaiting user review.

## Context

General Books render from a single canonical `.docx` template plus a library of
imported Word templates (`data_dir/book_templates/`, 8 in prod). A book's Arabic
ref line (`الرقم: {{ ref }}`) and date line (`التاريخ: {{ date }}`) are injected
by `core/book_template_retokenize.py`; the ref is a stored identifier
`1/{tab}/GSSG/{serial}` from the classified register (`core/classifications.py:74`).
Two authoring surfaces exist: the HugeRTE rich editor ("Write here") and
Word-over-WebDAV ("Write in Word"). Word is becoming the primary surface.

This spec bundles six operator-reported cleanups into five milestones. They are
independent; land incrementally.

## Decisions locked with the user

1. **GSSG removal:** new books only. Existing books keep their stored
   `…/GSSG/…`; scan-back parser accepts **both**. No data migration.
2. **Filename:** add subject + ISO date to the **user-facing download** name only.
3. **Templates = two base templates + custom CRUD.** Ship two base General Book
   templates — **text** (no table) and **table** (a standard single data table:
   header row that repeats onto page 2 for long tables + one tokenized data row).
   The operator can **save / load / rename / delete** custom templates on top of
   these. The **UI grid does add-row + type only**; renaming headers,
   adding/removing columns, merged cells, extra/form tables, and trailing
   notes/totals are **finished in Word**. The grid appears only when a template
   has a clean single data table; anything non-standard is Word-only. The 8
   supplied `.docx` are **reference cases** (page overflow, forms, notes, merges)
   to validate coverage — not fixtures to preserve.
4. **HugeRTE soft-remove:** **General Book only** — hide the editor body mode;
   leave RichEditor and its minimal-variant use on other forms intact.

*Design note — grounded in the 8 real templates:* 2 are plain text
(الصيانة، تعطل الكانتين); 3–4 are clean data lists (fit the grid);
التصاريح الأمنية has a **second form-style table**, طلبات السوبر ماركت has a
**trailing merged note row**, جرد المواد has **vertically merged data** — those
three oddities are handled in Word, not in code. The templates currently ship
with **real employee PII as sample rows** (names, passport numbers); tokenizing
the data row strips it.

## PR sequencing (reviewer B3)

- **PR 1:** M1 + M2 + M3 + M5 — backend + trivial frontend, no API contract
  change. **Includes the `documents.py:540-548` Content-Disposition fix** (M2).
- **PR 2:** M4 (tables) — new `GET …/table` endpoint, `table_rows` on
  `WordBookCreate`, and the new `DELETE /word-templates/{name}` route all change
  the contract → commit `openapi.json` + `api.types.ts` resync atomically
  (`/sync-api-types`).

---

## Milestone 1 — Ref line cleanup

### 1a. Drop GSSG (new-only + dual-parse)
- `core/classifications.py:74` — `classified_ref` → `f"1/{tab}/{serial}"`.
- `core/extraction/form_ref.py` — the shared `_CLASSIFIED` is inlined into both
  `_STAMPED_RE` (anchored by `Ref:`/`الرقم:`) and the loose `_BARE_RE`. Making
  GSSG optional in the BARE path lets `1/5/2026` (a slash-date year) match as a
  ref — a real scan-misroute risk (security-SF1, i18n-A2, codebase-N1 all
  flagged). **Split into two named patterns:**
  - `_CLASSIFIED_STAMPED = r"1/\d{1,2}/(?:GSSG/)?\d{1,6}(?!\d)"` — GSSG optional,
    used **only** inside `_STAMPED_RE` where the `Ref:`/`الرقم:` anchor
    disambiguates.
  - `_CLASSIFIED_BARE = r"1/\d{1,2}/GSSG/\d{1,6}"` — **GSSG stays required**
    (unchanged from today) for the anchor-less `_BARE_RE`.
  - Net: new refs scan-match only via the stamped anchor; legacy GSSG refs match
    both ways; bare non-anchored text can't false-match a slash-date.
  - **Tests (must add):** `18/07/2026` and `1/5/2026` (slash-date OCR) yield NO
    ref from `candidate_refs`; a legacy `1/5/GSSG/141` still scan-matches (bare +
    stamped); a new `1/5/141` matches only under an anchor.
- `core/book_template_retokenize.py:37` — `_DUMMY["ref"]` → GSSG-less value.
- **`core/qr.py:35` `_PREFIX = "GSSG:"` is the Aztec/QR payload prefix, NOT the
  ref format — MUST NOT be changed** (codebase-NOTE). Leave QR untouched.
- **Full test-update list** (codebase reviewer, verified sites — do not miss any):
  `test_classifications.py:14`, `test_general_book_classified_ref.py:45,46,133,134`,
  `test_word_book_service.py:67,70,77,158,159`, `test_word_book_finish.py:387,430`,
  `test_word_book_preview.py` + `test_word_book_sign.py` filename asserts,
  `test_docx_render_sandbox.py:33-34`, `test_general_book_ref_line.py:25,27,49,51,52`,
  `test_form_ref_patterns.py`, `test_arabic_rtl_word_paste.py`. **The
  `test_ref_run_marked_rtl` run-finder `"GSSG" in r.text` exists in TWO files** —
  `test_book_template_retokenize.py` AND `test_general_book_ref_line.py:52` — and
  after the drop it fails **loudly** (`assert ref_runs` on the empty list), not
  silently. Fix both: finder → `r.text.startswith("1/")`, guarded by the
  paragraph text starting with `الرقم` (i18n-A1, codebase-MF4).
- Doc comments referencing the format (`document_service.py:1118`,
  `word_book_service.py:75`, repo docstrings) updated.

### 1b. Ref font matches the date font (library-template path)
- Defect: `_write_ref_block` (retokenize.py:86) sources its run style from the
  ref paragraph's own first run. This only bites **Case 1** — when a ref
  paragraph already exists (`replace=True`, retokenize.py:205). **Case 2**
  (`replace=False`, anchor already = `date_para`, line 207) already sources the
  date run correctly (codebase-MUST).
- Fix cleanly: extend the signature to
  `_write_ref_block(anchor, *, replace, style_src=None)`, default
  `style_src = anchor`; in Case 1 pass `style_src=date_para`. Case 2 unchanged.

### 1c. Ref renders `الرقم : {reversed}` — value continues after the label
- **Target visual (user-confirmed):** stored `1/{tab}/{serial}` renders on the
  Arabic line as `الرقم : {serial}/{tab}/1` — the value continues **immediately
  after** the label and the RTL-marked run **reverses the segments** (serial
  leads). Example: stored `1/15/141` → `الرقم : 141/15/1`. This is exactly what
  `ref_run.font.rtl = True` already produces (the legacy hand-typed-book
  encoding); **keep it**. Dropping GSSG shortens the value but does not change
  the ordering. It must NOT be pushed to the end of the line.
- **Implementation caution (i18n-B1a):** the stored string is passed to Word
  **verbatim** (`"1/15/141"`); it is the **Unicode bidi algorithm**, triggered by
  the `<w:rtl/>` flag, that visually reverses the segments. Do **not** reverse the
  string in Python — that would double-reverse.
- **Stored vs rendered:** the canonical ref (DB, `ref.replace('/','-')` filename,
  reserved-ref chip in the UI) stays LTR `1/{tab}/{serial}`; only the Arabic
  document line shows the reversed `{serial}/{tab}/1` form. Both denote one ref.
- Render test: the rendered الرقم line carries the value with reversed segment
  order **directly after** the label (assert `w:rtl` present + segment order),
  not at the line end.

---

## Milestone 2 — Download filename: subject + ISO date

**Design decision (risk-driven):** do **not** rename the on-disk working file or
the WebDAV filename (`word_book_service.py:137`, and `:388` reopen — both stay
ASCII/ref-based). They are embedded in the `ms-word:ofe|u|…/dav/{token}/{filename}`
URL; an Arabic subject there risks breaking Word/WebDAV. Apply the nice name only
at the **serve/download** layer.

- The real composition function is `core/export_naming.py::export_filename` (via
  `document_service.download_filename_for`, `document_service.py:2008`). It has
  **no** `subject`/`when` params today — extend the signature, and have
  `download_filename_for` detect `template_id == "General Book"` and reach the
  **Book** row for subject + timestamp (`Document → row.book_version →
  BookVersion.book.subject`; trace this join before implementing — codebase-SF2).
  General Book download name:
  `f"{ref.replace('/','-')} — {subject_slug} — {when:%Y-%m-%d}.docx"` (ISO date).
- **FIX THE ACTUAL VULN (security-MUST3, codebase-SF1):** `documents.py:540-548`
  (the companion-merge branch) builds `Content-Disposition` as a **raw f-string**
  `f'inline; filename="{download_filename_for(row, ".pdf")}"'` — no `filename*=`,
  no sanitized ASCII fallback → a subject with `"`/CRLF injects the header
  **today**. Replace that raw `Response` with a call to the existing
  `_inline_pdf_response(merged, download_filename_for(row, ".pdf"))` (which already
  emits RFC 5987 + ASCII fallback). This is a pre-existing hole; land it in PR 1.
- **`subject_slug` sanitization is a trust boundary** (security-MUST). Good news:
  `export_naming.py::_sanitize` **already** strips `" \\ / : * ? < > |`, the C0
  control range `\x00-\x1f` (covers CR/LF), and bidi/zero-width marks, and
  preserves Arabic (no Latin-only `\w` filter). **Make `_sanitize` the SOLE
  sanitizer** for the subject slug — no second pass. Then cap ~80 chars. (Minor:
  it also strips ZWJ/ZWNJ U+200C/D — a display nit for some Arabic joins, not a
  security issue.)
- **`Content-Disposition` safety:** emit `filename*=UTF-8''<percent-encoded>`
  (RFC 5987) as the source of truth; the ASCII `filename="…"` fallback must be
  built from the sanitized (quote-free, CRLF-free) slug, or omitted entirely
  (modern browsers accept `filename*=` alone). This closes the header-injection
  path the existing `_inline_pdf_response` shares.
- **Out of scope:** `books.py:804-829` (attachments) and `:898-924`
  (imported-document) serve raw disk names — untouched (codebase-NOTE).
- Test: download response carries the ISO-dated, sanitized name; a subject with
  `"`/CRLF cannot break the header.

---

## Milestone 3 — Author G-number in the footer (templates)

Both paths already inject `{{ submitter_g }}` (`_retokenize_footers`,
retokenize.py:157). The library-template defect: hand-made Desktop templates
carry their own footer with no G-number, so the token is **appended as a bare
paragraph** at the end of `sections[0].footer` — which can land in the wrong
footer part or miss the page-2+ footer that `_postprocess_general_book_footer`
syncs.

- Normalize the inserted footer token to the canonical footer's **position and
  9pt size**, on the part the footer-sync copies from (footer3/page-1), so every
  page shows it.
- Applies to both base templates and any custom template the operator saves —
  the footer author is injected the same way for all. Building/normalizing must
  go through the idempotent path (M4b) so re-running never corrupts already-
  injected tokens.
- Test: an imported no-G template renders a book whose footer shows the author's
  G-number on page 1 and page 2.

---

## Milestone 4 — Two base templates + table-fill grid

### 4a. Two base templates + custom CRUD
- Ship two base General Book templates the operator starts from. Their **display
  names are i18n keys** (`books.word.baseTemplate.text` / `.table`) with en+ar
  parity so an EN-language operator never sees Arabic-only names in an EN UI
  (i18n-A3d). They appear in the **same `GET /books/word-templates` list** as
  custom templates, flagged (`kind: "base" | "custom"`) so the picker can group
  them ("Start from" vs "My templates"):
  - **text base:** letterhead + ref/date/footer tokens, free body (written in
    Word). No table.
  - **table base:** the above + one standard data table — a header row + a single
    tokenized data row (see 4b). Header row marked **`tblHeader`**
    (repeat-as-header) and rows allowed to break, so a long table **flows onto
    page 2 with the header repeating** (the operator's explicit case).
- **Custom template CRUD — save/load/rename EXIST, DELETE DOES NOT** (codebase-MF1,
  security-SF2, verified): `save_book_as_template`, `list`, `rename_template`,
  `resolve_template_path` exist in `book_template_service`; `WordTemplateManager`
  has rename; routes are `GET` + `PATCH /word-templates/{name}`. **Build DELETE as
  new work** — `delete_template` service fn + `DELETE /word-templates/{name}`
  route (gated by `safe_template_name`, same traversal defense as rename) +
  `api.ts` client + a delete button/mutation in `WordTemplateManager`. Lands in
  PR 2.
- A custom template saved from a book keeps whatever the operator built in Word;
  if it contains a clean single data table (4b), the grid lights up for it (4d),
  else it is text/Word-only. **Migration note (i18n-B2c):** custom templates
  saved *before* M4 have no tokenized loop row → they report `has_table:false`
  until re-saved. Acceptable; no back-fill.

### 4b. Table normalization — clean single data table only (backend)
Applies to the **table base** and any custom template with a clean data table.
**Precise definition of "clean data table"** (i18n-B3a) — a `w:tbl` is clean iff:
(1) it is the **only** `w:tbl` in the document **body** (not in a header/footer/
textbox); (2) it has a header row (row 0); (3) **every** non-header row has the
**same column count** as the header; (4) **no data cell** carries `w:vMerge` or
`w:gridSpan` > 1. If zero or ≥2 body tables, or any of (2)–(4) fails →
`has_table=false`, treat as text. This deterministically routes the 3 real
oddities to Word: التصاريح الأمنية (two tables → fails #1), جرد المواد
(vMerge → fails #4), طلبات السوبر ماركت (trailing merged note row → fails #3/#4).
- Keep the **header row** verbatim; record its cell texts as ordered column
  labels; ensure it carries `tblHeader`.
- Replace the data row(s) with **one tokenized loop row**, wrapped
  `{%tr for row in table_rows %}` … `{%tr endfor %}`, one cell token per column
  (`{{ row.c0 }}`, …), preserving each cell's run style. This also strips the
  **real employee PII** currently baked into the sample rows.
- **Injection order (codebase-MUST):** inject the loop tokens **after**
  `_neutralize_part_runs` (like `{{ ref }}`) so they are not ZWSP-broken. docxtpl
  processes `{%tr%}` at the XML layer regardless of the passed `jinja_env`; the
  `{{ row.cN }}` expressions evaluate under `SandboxedEnvironment` — compatible.
- **Idempotency — use REMOVE + RE-INJECT (reviewers conflicted; reconciled):**
  security-MUST said remove+re-inject, i18n-B3b preferred detect+skip. Resolve to
  **remove+re-inject**, because it matches how the function *already* handles the
  ref/date lines — found structurally (by label), runs cleared, rewritten every
  run (naturally idempotent). Concretely: **before** `_neutralize_part_runs`,
  locate the clean data table, **capture the current first data row's per-cell run
  styles** (so operator style tweaks on an already-normalized custom template
  survive), remove all data/loop rows, run neutralize, then inject one fresh loop
  row cloning the captured styles. Detect+skip is rejected: `_neutralize_part_runs`
  runs on the whole doc first and has no clean skip hook. Test: retokenize twice →
  identical + still validates.
- **Cell values are data (security-MUST):** coerce every `table_rows` cell to
  `str` before render. Jinja does not recursively re-render substituted values and
  lxml escapes text nodes, so OOXML/SSTI is blocked — add a validation render
  where a dummy cell value `"{{ ref }}"` appears **literally** (no double-expand).
- **`has_table` flag** recorded so text templates skip all of the above (absorbs
  old M5 — the guard `if not clean_data_table: return`).

### 4c. Validation must still fail closed (security + codebase MUST)
- **Dummy `table_rows` with the right column count (codebase-MF2):** under
  `strict=True` + sandbox, a `{%tr for row in table_rows %}` template with no
  `table_rows` in `_DUMMY` raises `UndefinedError` → validation crashes for every
  table template. `validate_book_template` must detect the table + its column
  count (reuse the 4b/4d schema detector — the SAME function, not a reimpl) and,
  only when a table exists, inject `table_rows=[{"c0": …, …"cN": …}]` matching the
  column count.
- **Body-preservation check must EXCLUDE `w:tbl` content (security-MUST2,
  codebase-MF3):** the ≥15-char check (retokenize.py:236-245) trips on the header
  cells / removed data rows. Compute the comparison over **non-table** paragraphs
  only (skip text that lives inside any `w:tbl`), so table normalization can't
  false-positive as corruption.
- Assert the dummy render produces **≥1 rendered row** (the loop control line is
  skipped by the `{%`-exclusion, so a corrupted loop would otherwise pass
  silently).
- **Runtime literal-`{{ ref }}` check (security-MUST5):** inside
  `validate_book_template` (not just the test suite), render one dummy cell value
  of `"{{ ref }}"` and assert it appears **literally** — proving cell values are
  data, not re-expanded — on every custom-template save.

### 4d. Table schema API + render (backend)
- New read endpoint `GET /books/word-templates/{name}/table` →
  `{ has_table: bool, columns: [str] }` (column = header cell text). Read-only,
  permission-gated like the template list.
- `create_word_book` gains `table_rows: list[dict] | None` (also add the field to
  the `WordBookCreate` Pydantic schema → drives the `/sync-api-types` resync).
  Pass into the render `data` so the loop expands real rows **before**
  `_postprocess_general_book_footer` + handoff. **Keep `sandboxed=True`
  end-to-end** for this production render (security-NOTE).
- **Row-dict contract (i18n-B2b):** each row is `{"c0": str, "c1": str, …,
  "cN": str}` keyed by **logical** column index (c0 = header's first cell),
  independent of RTL display order. Backend coerces every value to `str` (4b).

### 4e. UI grid (frontend) — add-row + type only, NOT Fortune Sheet (i18n-B1)
- Fortune Sheet is installed only as a **read-only** viewer (`XlsxViewer.tsx`);
  mirror `ItemsTableField`'s **`react-hook-form` `useFieldArray` + `<Input>`**
  pattern: dynamic columns from the schema API, one `<Input>` per cell, an
  **add-row** button. **No column add/remove, no header rename** in the UI — those
  are Word (operator-confirmed).
- **Column order / RTL (i18n-A3):** put **`dir="rtl"` on the grid wrapper**
  (`<table>`/`<div>`) — CSS column-order alone won't flip it. Logical cell order
  `cell[0]…cell[N]` renders in RTL visual order (c0 at the right) to match the
  printed Arabic table; map inputs back to `row.c0…row.cN` by logical index.
- Lives in the Word-create flow (not HugeRTE); shown only when `has_table`. Show a
  loading skeleton while `GET …/table` is in flight.
- **New i18n strings under `books.word.tableGrid.*` with en+ar parity (i18n-A3):**
  `.loading`, `.error`, `.empty` (book-appropriate wording — do **not** reuse
  `itemsTable.empty`, whose Arabic says "بنود"/line-items), `.columnLabel` used as
  `t('books.word.tableGrid.columnLabel', { n })` for the header fallback (EN
  "Column {n}" / AR "عمود {n}" — **not** Arabic-only). `itemsTable.addRow` exists
  in both locales (verified) → reuse. Template header cell texts are Arabic
  display strings from the docx, not keys.
- After handoff the docx holds real rows → the operator adds/edits/deletes rows,
  columns, headers, merges, notes freely **in Word**.

---

## Milestone 5 — HugeRTE soft-remove (General Book only)

- Hide the "Write here (editor)" body-mode option for General Books so the flow
  is Word-only. Touch points (codebase-verified): the toggle render
  `TemplateForm.tsx:455-475`, its default `TemplateForm.tsx:282` (`'editor'`),
  and `ApplicationPage.tsx:169` (`useState<'editor'|'word'>('editor')`) — default
  both to `'word'` and drop/disable the `editor` choice when `isGeneralBook`
  (`TemplateForm.tsx:380`).
- The `arabic_rich_full` full-variant RichEditor mount is only reached in editor
  mode → naturally dormant. Keep `rich-editor.tsx`, its config, and the
  minimal-variant use on other forms untouched. Reversible (one conditional).
- Server-side General Book rich-editor render path stays (harmless; frontend
  won't invoke it).
- Update `TemplateForm.bodyMode.test.tsx` (asserts editor mode visible) for the
  General-Book-hidden case.

---

## Risks & open questions

1. **"Clean data table" detection** — the grid is offered only for a single
   header+uniform-rows table with no merged data cells. Templates with a
   second/form table, merged data, or trailing note/total rows report
   `has_table=false` and are finished in Word — no fragile per-oddity code.
   Verify the detector against the 8 reference `.docx`.
2. **No UI re-edit after seed** — once rows render into the docx and Word opens,
   the grid does not re-read; further table edits are Word-only. Accepted.
3. **Page-2 overflow** — long tables must repeat the header row on page 2
   (`tblHeader` on the header row + breakable data rows). Verify in a rendered
   multi-page book.
4. **Re-normalizing templates** — must go through the idempotent path (4b), not a
   raw re-neutralize.

## Testing / gates

- **Backend:** ref = `1/{tab}/{serial}`; legacy GSSG scan-match (bare+stamped);
  slash-date (`18/07/2026`, `1/5/2026`) yields NO false ref; ref font == date font
  (library path); ref renders `الرقم : {serial}/{tab}/1` (reversed segments,
  directly after the label); download filename shape (incl. **blank-subject** case)
  + header-injection resistance incl. the `documents.py:540-548` path; footer
  author on imported-template book (pages 1+2); table render from `table_rows`;
  **idempotent retokenize (run twice → identical)**; validation fail-closed with
  loop row + ≥1 rendered row + literal `{{ ref }}` cell value + dummy `table_rows`
  column-count match; table-schema endpoint; **`delete_template` + traversal
  guard**; text template `has_table:false` + normalization no-op; **long table
  repeats header on page 2**; templates with merged/second/note tables report
  `has_table:false`.
- **Frontend:** editor mode hidden for General Book; two base templates selectable
  (grouped, i18n-keyed names); custom template save/load/rename/**delete**; grid
  appears only for clean table templates, `dir="rtl"` columns labelled + RTL order,
  add-row works, submit payload carries `{c0…cN}` `table_rows`; new
  `books.word.tableGrid.*` strings (incl. EN `columnLabel`) have en+ar parity.
- **Gates:** `pytest` (filterwarnings=error), `ruff`, `mypy --strict`, vitest,
  tsc, `pnpm gen:api` resync (PR 2), i18n-rtl + notification reviewers on
  bilingual surfaces.
