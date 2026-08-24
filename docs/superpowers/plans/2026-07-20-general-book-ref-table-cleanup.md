# General Book — ref cleanup, table templates, footer & HugeRTE Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clean up the General Book ref line (drop GSSG, font matches date, RTL serial), add subject+ISO download filenames, guarantee the author footer, ship two base templates (text + table) with an add-row grid + custom template CRUD, and hide the HugeRTE editor for General Books.

**Architecture:** Backend is FastAPI + python-docx/docxtpl over SQLite; the General Book renders from a tokenized `.docx` via `core/book_template_retokenize.py` + `core/docx_render.py`. A new `core/book_table.py` detects/normalizes a single clean data table into a `{%tr%}` loop row. Frontend is React 19 + react-hook-form + React Query; a new `TableGridField` (useFieldArray + Input, RTL) seeds `table_rows` into the Word-create flow. The frontend↔backend contract is generated (`openapi.json → api.types.ts`) and must be resynced after schema changes.

**Tech Stack:** Python 3.12, FastAPI, python-docx, docxtpl (Jinja SandboxedEnvironment), SQLAlchemy/SQLite, pytest; React 19, TypeScript, Vite, react-hook-form, React Query, Radix, Tailwind 4, vitest.

## Global Constraints

- Design doc / source of truth: `docs/superpowers/specs/2026-07-20-general-book-ref-table-cleanup-design.md`. Every task's requirements implicitly include it.
- `venv\Scripts\python.exe -m pytest` runs with `filterwarnings=error` — no new warnings.
- `venv\Scripts\mypy.exe` is **strict**; `venv\Scripts\ruff.exe check .` and `ruff format --check .` must pass.
- Frontend: `pnpm -C frontend exec tsc -b --noEmit`, `pnpm -C frontend run lint`, vitest all green.
- **Bilingual is mandatory:** every new UI string has en + ar parity in `frontend/src/locales/{en,ar}.json`; AR value ≠ EN value (unless a pure `{{token}}`). Use logical CSS (`ms-`/`me-`, `text-start/end`, `dir`).
- **RTL ref rule:** the stored ref string is passed to Word **verbatim**; `<w:rtl/>` (via `font.rtl=True`) makes the Unicode bidi algorithm reverse the segments visually (`1/15/141` → `الرقم : 141/15/1`). NEVER reverse the string in Python.
- **SSTI posture unchanged:** table loop tokens are injected AFTER the ZWSP neutralize pass; `table_rows` cell values are coerced to `str`; sandboxed render stays `sandboxed=True` end to end; `validate_book_template` stays fail-closed.
- **Do NOT touch `core/qr.py` `_PREFIX = "GSSG:"`** — it is the Aztec payload prefix, unrelated to the ref format.
- After any backend Pydantic schema / route change, resync types (`openapi.json` + `api.types.ts`) and commit them together (Task M4-11).
- Ref format going forward is `1/{tab}/{serial}` (new books only); existing books keep stored `…/GSSG/…`; the scan-back parser accepts both.
- Commit after every task (frequent commits). Do NOT push to origin/main unless the user asks.

## Execution order & PR boundaries

Execute in this order (each task is TDD: failing test → run-fail → implement → run-pass → commit):

**PR 1 (backend + trivial frontend, no API contract change):**
M1a-1 → M1a-2 → M1a-3 → M1a-4 → M1b-1 → M1c-1 → M2-1 → M2-2 → M3-1 → M5-1

**PR 2 (tables — changes the API contract):**
M4-1 → M4-2 → M4-3 → M4-4 → M4-5 → M4-6 → M4-7 → M4-8 → M4-9 → M4-10 → **M4-11 (api-types resync)** → then the frontend: M4d-1 → M4d-2 → M4d-3 → M4d-4 → M4d-5 → M4d-6

### Seam notes (read before executing PR 2 frontend)
1. **api-types ordering:** M4-11 regenerates `frontend/src/lib/api.types.ts` from the backend. Run M4-11 BEFORE the M4d-* frontend tasks. In **M4d-2**, the `api.types.ts` hand-edits (step 3a) are then unnecessary — verify the regenerated file already has `WordTemplateTableRead`, `kind`, and `table_rows`; only add the hand-written wrappers to `api.ts` (step 3b). If for some reason you do frontend before the resync, apply the M4d-2 hand-edits as a bridge.
2. **`kind` assignment:** the two base templates are the files `base_text.docx` and `base_table.docx` (built in M4-9). The template LIST code must tag those two names `kind="base"` and everything else `kind="custom"`. This is folded into M4-6 (schema) + M4-9 (build + list tagging) — see the `_BASE_TEMPLATE_NAMES` note in M4-9.
3. **Consolidated i18n keys:** M4d-1 adds ALL new keys, including the two picker group labels `books.word.baseTemplate.group` (EN "Start from" / AR "ابدأ من") and `books.word.customTemplate.group` (EN "My templates" / AR "قوالبي") used by M4d-4.

---

# PR 1 — Backend ref/filename/footer + HugeRTE hide

### Task M1a-1: Drop GSSG from `classified_ref` + update `_DUMMY`

**Files:**
- Modify `backend/app/core/classifications.py` line 74–75
- Modify `backend/app/core/book_template_retokenize.py` line 37
- Modify `backend/tests/test_classifications.py`

**Interfaces:** Produces: `classified_ref(tab, serial) -> str` returns `f"1/{tab}/{serial}"`; `_DUMMY["ref"] == "9/9/9999"`

- [ ] **Step 1: Write the failing test**
```python
# backend/tests/test_classifications.py — replace test_classified_ref_format
def test_classified_ref_format():
    assert classified_ref(5, 141) == "1/5/141"
```
- [ ] **Step 2: Run it, expect FAIL** — Run: `venv\Scripts\python.exe -m pytest backend/tests/test_classifications.py::test_classified_ref_format -v` — Expected: `AssertionError: '1/5/GSSG/141' == '1/5/141'`
- [ ] **Step 3: Implement**
```python
# backend/app/core/classifications.py line 74–75
def classified_ref(tab: int, serial: int) -> str:
    return f"1/{tab}/{serial}"
```
```python
# backend/app/core/book_template_retokenize.py line 37
_DUMMY = {"ref": "9/9/9999", "date": "31-12-2099", "submitter_g": "G-9999"}
```
- [ ] **Step 4: Run, expect PASS** — Run: `venv\Scripts\python.exe -m pytest backend/tests/test_classifications.py::test_classified_ref_format -v`
- [ ] **Step 5: Commit** — `git add backend/app/core/classifications.py backend/app/core/book_template_retokenize.py backend/tests/test_classifications.py && git commit -m "feat(M1a): drop GSSG from classified_ref; update _DUMMY sentinel"`

---

### Task M1a-2: Split `form_ref.py` regex into `_CLASSIFIED_STAMPED` / `_CLASSIFIED_BARE`

**Files:**
- Modify `backend/app/core/extraction/form_ref.py` lines 17–25
- Modify `backend/tests/test_form_ref_patterns.py`

**Interfaces:** Produces: `candidate_refs(text)` — new `1/{tab}/{serial}` matches only via stamped anchor; legacy GSSG matches both; slash-dates produce no bare false match

- [ ] **Step 1: Write the failing tests**
```python
# ADD to backend/tests/test_form_ref_patterns.py
def test_new_ref_stamped_anchor_matches():
    assert "1/5/141" in candidate_refs("الرقم: 1/5/141")

def test_new_ref_bare_does_not_match():
    assert "1/5/141" not in candidate_refs("التاريخ 1/5/141 شيء ما")

def test_slash_date_ocr_no_match():
    assert candidate_refs("التاريخ 18/07/2026") == []
    assert candidate_refs("تاريخ الميلاد 1/5/2026") == []

def test_legacy_gssg_bare_still_matches():
    assert "1/12/GSSG/7" in candidate_refs("الرقم: 1/12/GSSG/7 التاريخ 18-07-2026")

def test_legacy_gssg_stamped_still_matches():
    assert candidate_refs("some letterhead\nRef: 1/5/GSSG/141\nsubject line")[0] == "1/5/GSSG/141"
```
- [ ] **Step 2: Run it, expect FAIL** — Run: `venv\Scripts\python.exe -m pytest backend/tests/test_form_ref_patterns.py -v`
- [ ] **Step 3: Implement** — replace lines 17–25 of `backend/app/core/extraction/form_ref.py`:
```python
# Two distinct patterns for the classified General Book ref shape.
# _CLASSIFIED_STAMPED: GSSG optional — used ONLY inside _STAMPED_RE where the
#   Ref:/الرقم: anchor disambiguates from OCR slash-dates.
# _CLASSIFIED_BARE: GSSG required — used in the anchor-less _BARE_RE so only
#   legacy refs match without an anchor; new refs need the anchor.
_CLASSIFIED_STAMPED = r"1/\d{1,2}/(?:GSSG/)?\d{1,6}(?!\d)"
_CLASSIFIED_BARE = r"1/\d{1,2}/GSSG/\d{1,6}"

_STAMPED_RE = re.compile(
    rf"(?:Ref:|الرقم\s*[:：]?)\s*([A-Z0-9]{{1,5}}-\d{{3,5}}|{_CLASSIFIED_STAMPED})",  # noqa: RUF001
    re.IGNORECASE,
)

# Bare fallback — wider; GSSG stays required to prevent slash-date false matches.
_BARE_RE = re.compile(rf"\b([A-Z0-9]{{1,5}}-\d{{3,5}}|{_CLASSIFIED_BARE})\b", re.IGNORECASE)
```
- [ ] **Step 4: Run, expect PASS** — Run: `venv\Scripts\python.exe -m pytest backend/tests/test_form_ref_patterns.py -v`
- [ ] **Step 5: Commit** — `git add backend/app/core/extraction/form_ref.py backend/tests/test_form_ref_patterns.py && git commit -m "feat(M1a): split _CLASSIFIED into _STAMPED/_BARE"`

---

### Task M1a-3: Update GSSG assertions in `test_book_template_retokenize.py` + `test_general_book_ref_line.py`

**Files:** Modify `backend/tests/test_book_template_retokenize.py`, `backend/tests/test_general_book_ref_line.py`

**Interfaces:** Consumes `_DUMMY["ref"]=="9/9/9999"` and GSSG-less `classified_ref`.

- [ ] **Step 1 & 2: Run, expect FAIL** — Run: `venv\Scripts\python.exe -m pytest backend/tests/test_book_template_retokenize.py backend/tests/test_general_book_ref_line.py -v` — Expected: multiple FAIL on "GSSG" assertions
- [ ] **Step 3: Implement**
  - `test_book_template_retokenize.py` line 22 → `doc.add_paragraph(f"الرقم:{spacing}1/{spacing}5{spacing}/{spacing}140")`; all `ref="9/9/GSSG/999"` → `ref="9/9/999"` (lines 40, 49, 56, 63, 74, 100); all `"الرقم: 9/9/GSSG/999"` → `"الرقم: 9/9/999"` (lines 41, 50, 57). (`test_ref_run_marked_rtl` here finds the `{{ ref }}` token run — no change needed.)
  - `test_general_book_ref_line.py` `test_ref_line_renders_above_date` (lines 23–29):
```python
def test_ref_line_renders_above_date(tmp_path):
    out = tmp_path / "out.docx"
    DocxEngine(TEMPLATES_DIR).fill("General Book", {**_BASE_DATA, "ref": "1/5/141"}, out)
    text = docx_to_text(out)
    assert "الرقم: 1/5/141" in text
    assert text.index("الرقم:") < text.index("التاريخ:")
```
  - `test_general_book_ref_line.py` `test_ref_run_marked_rtl` (lines 39–54): fix run-finder `"GSSG" in r.text` → `r.text.startswith("1/")`:
```python
def test_ref_run_marked_rtl(tmp_path):
    from docx import Document
    out = tmp_path / "out.docx"
    DocxEngine(TEMPLATES_DIR).fill("General Book", {**_BASE_DATA, "ref": "1/5/141"}, out)
    doc = Document(str(out))
    ref_para = next(p for p in doc.paragraphs if "1/5/141" in p.text)
    ref_runs = [r for r in ref_para.runs if r.text.startswith("1/")]
    assert ref_runs, "ref value must be in its own run"
    assert all(r.font.rtl is True for r in ref_runs)
```
- [ ] **Step 4: Run, expect PASS** — Run: `venv\Scripts\python.exe -m pytest backend/tests/test_book_template_retokenize.py backend/tests/test_general_book_ref_line.py -v`
- [ ] **Step 5: Commit** — `git add backend/tests/test_book_template_retokenize.py backend/tests/test_general_book_ref_line.py && git commit -m "test(M1a): GSSG-less ref assertions + RTL run finder"`

---

### Task M1a-4: Update remaining test files with GSSG ref assertions

**Files:** Modify `backend/tests/test_general_book_classified_ref.py`, `test_docx_render_sandbox.py`, `test_word_book_service.py`, `test_word_book_finish.py`, `test_word_book_preview.py`, `test_word_book_sign.py`, `test_arabic_rtl_word_paste.py`, `test_word_books_models.py`, `test_books_search.py`

**Interfaces:** Consumes GSSG-less `classified_ref`.

- [ ] **Step 1 & 2: Run, expect FAIL** — Run: `venv\Scripts\python.exe -m pytest backend/tests/test_general_book_classified_ref.py backend/tests/test_docx_render_sandbox.py backend/tests/test_word_book_service.py backend/tests/test_word_book_finish.py backend/tests/test_word_book_preview.py backend/tests/test_word_book_sign.py backend/tests/test_word_books_models.py backend/tests/test_books_search.py -v`
- [ ] **Step 3: Implement** — apply GSSG-less substitutions (line numbers approximate — grep each file for `GSSG` and the old ref strings; the value/tab/serial choices below keep serials consistent):
  - `test_general_book_classified_ref.py`: `result.ref_number == "1/5/1"`, `filter_by(ref_number="1/5/1")` (45–46); `r1.ref_number == "1/3/1"`, `info.ref_number == "1/5/2"` (133–134).
  - `test_docx_render_sandbox.py` 33–34: `render(tpl, {"ref": "1/5/9"}, ...)`; assert `"الرقم: 1/5/9"`.
  - `test_word_book_service.py`: `info.ref_number == "1/5/1"` (67), `info.filename == "1-5-1.docx"` (70), `book.ref_number == "1/5/1"` (77), `info1.ref_number == "1/3/1"` (158), `info2.ref_number == "1/5/2"` (159).
  - `test_word_book_finish.py`: `slashed_ref = "1/5/1"` (387); remove `"GSSG"` from the `output_parent.name not in (...)` tuple (430); `assert "1/5/1" not in doc.docx_path.replace("\\", "/")` (434).
  - `test_word_book_preview.py`: refs `1/11/7`,`1/11/8`,`1/11/21`,`1/11/22` and filenames `1-11-7.docx`,`1-11-8.docx` at the matching lines (20,23,139,142,218,219,264,265).
  - `test_word_book_sign.py`: `docx_path = tmp_path / "1-11-9.docx"` (20); `ref_number="1/11/9"` (30).
  - `test_arabic_rtl_word_paste.py` line 14: change the HTML fixture `الرقم:1/ 5 /GSSG/ 140` → `الرقم:1/ 5 / 140`.
  - `test_word_books_models.py` line 9: `def _book(db, ref="1/5/900"):`.
  - `test_books_search.py`: `ref_number="1/5/141"` (123), `list_books(db_session, q="1/5/141")` (133), and the docstring (116).
- [ ] **Step 4: Run FULL suite, expect PASS** — Run: `venv\Scripts\python.exe -m pytest backend/tests/ -v`
- [ ] **Step 5: Commit** — `git add backend/tests/ && git commit -m "test(M1a): update remaining tests to GSSG-less ref format"`

---

### Task M1b-1: Extend `_write_ref_block` with `style_src`; pass `date_para` on Case 1

**Files:** Modify `backend/app/core/book_template_retokenize.py` (signature ~80–86, call site ~204–207); Modify `backend/tests/test_book_template_retokenize.py`

**Interfaces:** Produces `_write_ref_block(anchor, *, replace, style_src=None)` — run style sourced from `style_src` when given (default = anchor).

- [ ] **Step 1: Write the failing test**
```python
# ADD to backend/tests/test_book_template_retokenize.py
def test_ref_font_matches_date_font_on_existing_ref_line(tmp_path):
    from docx import Document
    from docx.shared import Pt
    p = tmp_path / "font_book.docx"
    doc = Document()
    ref_p = doc.add_paragraph(); rr = ref_p.add_run("الرقم: 1/5/140"); rr.font.size = Pt(16)
    date_p = doc.add_paragraph(); rd = date_p.add_run("التاريخ: 13/07/2026"); rd.font.size = Pt(12)
    doc.add_paragraph("نص الكتاب هنا")
    doc.save(str(p))
    retokenize_general_book(p)
    doc2 = Document(str(p))
    ref_para = next(pp for pp in doc2.paragraphs if "{{ ref }}" in pp.text)
    ref_run = next(r for r in ref_para.runs if "{{ ref }}" in r.text)
    assert ref_run.font.size == Pt(12)
```
- [ ] **Step 2: Run it, expect FAIL** — Run: `venv\Scripts\python.exe -m pytest backend/tests/test_book_template_retokenize.py::test_ref_font_matches_date_font_on_existing_ref_line -v` — Expected: ref run is Pt(16)
- [ ] **Step 3: Implement**
```python
# signature + src line
def _write_ref_block(anchor: Paragraph, *, replace: bool, style_src: Any | None = None) -> None:
    """... replace=True: anchor IS the old الرقم paragraph; style_src overrides
    the run-style source (default = anchor). replace=False: insert before anchor."""
    src = _first_run_style(style_src if style_src is not None else anchor)
```
```python
# call site in retokenize_general_book (~204–207)
    if ref_para is not None:
        _write_ref_block(ref_para, replace=True, style_src=date_para)
    else:
        _write_ref_block(date_para, replace=False)
```
- [ ] **Step 4: Run, expect PASS** — Run: `venv\Scripts\python.exe -m pytest backend/tests/test_book_template_retokenize.py -v`
- [ ] **Step 5: Commit** — `git add backend/app/core/book_template_retokenize.py backend/tests/test_book_template_retokenize.py && git commit -m "fix(M1b): ref font sources from date paragraph when replace=True"`

---

### Task M1c-1: Render test — RTL segment reversal directly after label, verbatim stored string

**Files:** Modify `backend/tests/test_general_book_ref_line.py`

**Interfaces:** Consumes canonical General Book template; asserts ref value run verbatim + `font.rtl=True` + directly after label.

- [ ] **Step 1: Write the failing test**
```python
# ADD to backend/tests/test_general_book_ref_line.py
def test_ref_renders_rtl_segment_order_directly_after_label(tmp_path):
    from docx import Document
    out = tmp_path / "out.docx"
    DocxEngine(TEMPLATES_DIR).fill("General Book", {**_BASE_DATA, "ref": "1/15/141"}, out)
    doc = Document(str(out))
    ref_para = next(p for p in doc.paragraphs if "1/15/141" in p.text)
    non_empty = [r for r in ref_para.runs if r.text.strip()]
    label_idx = next(i for i, r in enumerate(non_empty) if "الرقم" in r.text)
    value_idx = next(i for i, r in enumerate(non_empty) if "1/15/141" in r.text)
    assert value_idx == label_idx + 1
    value_run = non_empty[value_idx]
    assert value_run.text == "1/15/141"   # verbatim — bidi reverses in Word, not Python
    assert value_run.font.rtl is True
```
- [ ] **Step 2: Run, expect PASS or FAIL** — Run: `venv\Scripts\python.exe -m pytest backend/tests/test_general_book_ref_line.py::test_ref_renders_rtl_segment_order_directly_after_label -v` — PASS if label+value are consecutive runs; if a trailing-space label run breaks ordering, change the filter to `r.text` (not `.strip()`).
- [ ] **Step 3: Implement** — no change if Step 2 passes; else ensure `_write_ref_block` inserts no blank run between label and value.
- [ ] **Step 4: Run, expect PASS** — Run: `venv\Scripts\python.exe -m pytest backend/tests/test_general_book_ref_line.py -v`
- [ ] **Step 5: Commit** — `git add backend/tests/test_general_book_ref_line.py && git commit -m "test(M1c): ref value run verbatim + RTL-marked directly after label"`

---

### Task M2-1: Add `book_download_filename` to `export_naming.py`

**Files:** Modify `backend/app/core/export_naming.py` (add after line 44); Create `backend/tests/test_export_naming.py`

**Interfaces:** Produces `book_download_filename(*, ref: str, subject: str, when: datetime, ext: str) -> str` = `"{ref-dashes} — {subject_slug} — {YYYY-MM-DD}{ext}"`, `_sanitize` as sole sanitizer, stem capped ~80 chars.

- [ ] **Step 1: Write the failing test**
```python
# backend/tests/test_export_naming.py
from datetime import datetime
from app.core.export_naming import book_download_filename

def test_book_download_filename_basic():
    name = book_download_filename(ref="1/5/141", subject="التصاريح الأمنية", when=datetime(2026,7,20), ext=".pdf")
    assert name.startswith("1-5-141") and "2026-07-20" in name and "التصاريح الأمنية" in name and name.endswith(".pdf")

def test_book_download_filename_blank_subject():
    name = book_download_filename(ref="1/3/7", subject="", when=datetime(2026,7,20), ext=".docx")
    assert name.startswith("1-3-7") and "2026-07-20" in name and name.endswith(".docx")

def test_book_download_filename_injection_chars_stripped():
    name = book_download_filename(ref="1/5/1", subject='subject"with\r\nnewline', when=datetime(2026,7,20), ext=".pdf")
    assert '"' not in name and '\r' not in name and '\n' not in name

def test_book_download_filename_long_subject_capped():
    name = book_download_filename(ref="1/1/1", subject="أ"*200, when=datetime(2026,7,20), ext=".pdf")
    assert len(name) <= 100
```
- [ ] **Step 2: Run it, expect FAIL** — Run: `venv\Scripts\python.exe -m pytest backend/tests/test_export_naming.py -v`
- [ ] **Step 3: Implement** — add to `backend/app/core/export_naming.py` after line 44:
```python
from datetime import datetime as _Datetime

def book_download_filename(*, ref: str, subject: str, when: _Datetime, ext: str) -> str:
    """User-facing download name for a General Book (serve layer only).
    Format: {ref-dashes} — {subject_slug} — {YYYY-MM-DD}{ext}. _sanitize is the
    sole sanitizer (strips quotes/CRLF/bidi marks, keeps Arabic). Stem capped 80."""
    ref_slug = ref.replace("/", "-")
    subject_slug = _sanitize(subject)
    date_part = f" — {when:%Y-%m-%d}"
    prefix = f"{ref_slug} — "
    max_subject = max(0, 80 - len(prefix) - len(date_part))
    stem = f"{prefix}{subject_slug[:max_subject]}{date_part}"
    return f"{stem}{ext}"
```
- [ ] **Step 4: Run, expect PASS** — Run: `venv\Scripts\python.exe -m pytest backend/tests/test_export_naming.py -v`
- [ ] **Step 5: Commit** — `git add backend/app/core/export_naming.py backend/tests/test_export_naming.py && git commit -m "feat(M2): add book_download_filename to export_naming"`

---

### Task M2-2: Wire `download_filename_for` for General Books + fix the raw Content-Disposition vuln

**Files:** Modify `backend/app/services/document_service.py` (`download_filename_for`, ~2008–2022); Modify `backend/app/api/v1/documents.py` (`_inline_pdf_response` ~359–372, call sites 447/453/555, companion-merge 536–548); Create `backend/tests/test_document_download_filename.py`

**Interfaces:** Consumes `book_download_filename` (M2-1); Produces `download_filename_for(row, ext, *, db=None)`; companion-merge branch routed through `_inline_pdf_response`; CR/LF stripped from ASCII fallback.

- [ ] **Step 1: Write the failing test**
```python
# backend/tests/test_document_download_filename.py
import inspect
from app.api.v1 import documents as docs_module

def test_companion_merge_uses_inline_pdf_response():
    src = inspect.getsource(docs_module.download_document)
    assert 'inline; filename="' not in src, "raw Content-Disposition f-string must be gone"

def test_inline_pdf_response_strips_crlf():
    from app.api.v1.documents import _inline_pdf_response
    resp = _inline_pdf_response(b"%PDF-1.4", "name\r\nX-Injected: value.pdf")
    d = resp.headers["Content-Disposition"]
    assert '\r' not in d and '\n' not in d and "filename*=UTF-8''" in d
```
- [ ] **Step 2: Run it, expect FAIL** — Run: `venv\Scripts\python.exe -m pytest backend/tests/test_document_download_filename.py -v`
- [ ] **Step 3: Implement**
  - `_inline_pdf_response` (documents.py ~359) — strip CR/LF from the ASCII fallback:
```python
def _inline_pdf_response(content: bytes, filename: str) -> Response:
    ascii_name = (
        filename.encode("ascii", "ignore").decode()
        .translate({0x0D: None, 0x0A: None}).strip() or "document.pdf"
    )
    disposition = f"inline; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(filename)}"
    return Response(content=content, media_type="application/pdf",
                    headers={"Content-Disposition": disposition})
```
  - Companion-merge branch (documents.py 536–548) → replace the raw `Response` with:
```python
    if comp_paths:
        merged = merge_pdfs_to_bytes(file_path, comp_paths)
        if (b64 := maybe_base64(merged, encoding)) is not None:
            return b64
        return _inline_pdf_response(merged, document_service.download_filename_for(row, ".pdf", db=db))
```
  - Other call sites: add `db=db` at documents.py lines 447, 453, 555.
  - `download_filename_for` (document_service.py):
```python
def download_filename_for(row: Document, ext: str, *, db: Session | None = None) -> str:
    from app.core.export_naming import export_filename, book_download_filename
    if row.template_id == "General Book" and db is not None:
        from app.db.models import Book as _Book, BookVersion as _BookVersion
        book = (
            db.execute(
                select(_Book).join(_BookVersion, _BookVersion.book_id == _Book.id)
                .where(_BookVersion.document_id == row.id)
            ).scalars().first()
        )
        if book is not None:
            return book_download_filename(ref=book.ref_number, subject=book.subject or "",
                                          when=book.created_at, ext=ext)
    meta = load_fields_meta().get(row.template_id) or {}
    is_sick = row.leave is not None and row.leave.leave_type == "Sick Leave"
    return export_filename(
        employee_id=row.employee_id, ref_number=row.ref_number, template_id=row.template_id,
        arabic_name=meta.get("name_ar", ""), is_sick_leave=is_sick, ext=ext,
    )
```
- [ ] **Step 4: Run, expect PASS** — Run: `venv\Scripts\python.exe -m pytest backend/tests/test_document_download_filename.py backend/tests/test_export_naming.py -v`
- [ ] **Step 5: Run full suite** — Run: `venv\Scripts\python.exe -m pytest backend/tests/ -v`
- [ ] **Step 6: Commit** — `git add backend/app/services/document_service.py backend/app/api/v1/documents.py backend/tests/test_document_download_filename.py && git commit -m "fix(M2): General Book download name + close Content-Disposition header-injection"`

---

### Task M3-1: Footer author — insert `{{ submitter_g }}` on `sections[0].footer` at 9pt

**Files:** Modify `backend/app/core/book_template_retokenize.py` (`_retokenize_footers` ~174–180); Modify `backend/tests/test_book_template_retokenize.py`

**Interfaces:** Produces: when no G found, `{{ submitter_g }}` on `sections[0].footer` (the page-sync source), 9pt, reusing a trailing empty paragraph.

- [ ] **Step 1: Write the failing tests**
```python
# ADD to backend/tests/test_book_template_retokenize.py
def test_footer_g_token_on_sections0_footer(tmp_path):
    from docx import Document
    p = _finished_book(tmp_path)
    retokenize_general_book(p)
    footer = Document(str(p)).sections[0].footer
    assert "{{ submitter_g }}" in "\n".join(pp.text for pp in [footer] for pp in footer.paragraphs)

def test_footer_g_token_is_9pt(tmp_path):
    from docx import Document
    from docx.shared import Pt
    p = _finished_book(tmp_path); retokenize_general_book(p)
    footer = Document(str(p)).sections[0].footer
    run = next((r for para in footer.paragraphs for r in para.runs if "{{ submitter_g }}" in r.text), None)
    assert run is not None and run.font.size == Pt(9)

def test_footer_g_reuses_trailing_empty_paragraph(tmp_path):
    from docx import Document
    p = _finished_book(tmp_path)
    doc = Document(str(p)); doc.sections[0].footer.add_paragraph(); doc.save(str(p))
    retokenize_general_book(p)
    paras = Document(str(p)).sections[0].footer.paragraphs
    assert "{{ submitter_g }}" in paras[-1].text
```
- [ ] **Step 2: Run it, expect FAIL** — Run: `venv\Scripts\python.exe -m pytest backend/tests/test_book_template_retokenize.py -k footer_g -v`
- [ ] **Step 3: Implement** — replace the `if not replaced:` branch (~174–180):
```python
    if not replaced:
        from docx.shared import Pt
        footer = doc.sections[0].footer
        if footer.paragraphs and not footer.paragraphs[-1].text.strip():
            para = footer.paragraphs[-1]
        else:
            para = footer.add_paragraph()
        run = para.add_run("{{ submitter_g }}")
        run.font.size = Pt(9)
```
- [ ] **Step 4: Run, expect PASS** — Run: `venv\Scripts\python.exe -m pytest backend/tests/test_book_template_retokenize.py -v`
- [ ] **Step 5: Commit** — `git add backend/app/core/book_template_retokenize.py backend/tests/test_book_template_retokenize.py && git commit -m "fix(M3): submitter_g in sections[0].footer at 9pt, reuse empty trailing para"`

---

### Task M5-1: Hide the HugeRTE editor body-mode for General Books

**Files:** Modify `frontend/src/components/application/TemplateForm.tsx` (default ~282, toggle ~455–475); Modify `frontend/src/pages/application/ApplicationPage.tsx` (~169); Modify `frontend/src/components/application/TemplateForm.bodyMode.test.tsx`

**Interfaces:** Produces: no editor pill for General Books; `bodyMode` defaults to `'word'`; RichEditor + minimal-variant on other forms untouched.

- [ ] **Step 1: Write the failing tests** (add an M5 describe block)
```tsx
describe('TemplateForm M5 — editor pill hidden for General Book', () => {
  beforeAll(async () => { i18n.addResourceBundle('ar','translation',ar,true,true); await i18n.changeLanguage('ar') })
  afterAll(async () => { await i18n.changeLanguage('en') })
  it('does NOT render the editor pill', () => {
    render(<Host bodyMode="word" onBodyModeChange={vi.fn()} />)
    expect(screen.queryByText('اكتب هنا')).not.toBeInTheDocument()
  })
  it('does NOT render the body-mode toggle group', () => {
    render(<Host bodyMode="word" onBodyModeChange={vi.fn()} />)
    expect(screen.queryByRole('group', { name: 'وضع الكتابة' })).not.toBeInTheDocument()
  })
})
```
- [ ] **Step 2: Run, expect FAIL** — Run: `pnpm -C frontend exec vitest run src/components/application/TemplateForm.bodyMode.test.tsx`
- [ ] **Step 3: Implement**
  - `ApplicationPage.tsx:169` → `const [bodyMode, setBodyMode] = useState<'editor' | 'word'>('word')`
  - `TemplateForm.tsx:282` prop default → `bodyMode = 'word',`
  - Remove/disable the `{showBodyModeToggle && (…pill toggle…)}` render block (comment it out for a one-line revert). `wordMode = isGeneralBook && bodyMode === 'word'` stays.
  - Update the previously-existing pill tests that asserted the pill renders / `onBodyModeChange` fires — replace with the "toggle is gone" assertion; keep the orthogonality test.
- [ ] **Step 4: Run + typecheck, expect PASS** — Run: `pnpm -C frontend exec vitest run src/components/application/TemplateForm.bodyMode.test.tsx && pnpm -C frontend exec tsc -b --noEmit`
- [ ] **Step 5: Commit** — `git add frontend/src/components/application/TemplateForm.tsx frontend/src/pages/application/ApplicationPage.tsx frontend/src/components/application/TemplateForm.bodyMode.test.tsx && git commit -m "feat(M5): hide editor body-mode for General Books, default to word"`

**PR 1 gate before moving on:** `venv\Scripts\python.exe -m pytest backend/tests/ && venv\Scripts\ruff.exe check . && venv\Scripts\mypy.exe && pnpm -C frontend exec vitest run && pnpm -C frontend exec tsc -b --noEmit`

---

# PR 2 — Tables (backend then frontend)

> Full task code for M4-1 … M4-11 is in the PR2-backend draft and M4d-1 … M4d-6 in the frontend draft. Each follows the same TDD 5-step shape. Key interface contract (do not drift):
> - `core/book_table.py::detect_table_schema(doc) -> list[str] | None` (clean = one body `w:tbl`, header row, uniform data-row col count, no `vMerge`/`gridSpan`>1)
> - `core/book_table.py::normalize_data_table(doc) -> None` (REMOVE+RE-INJECT the `{%tr for row in table_rows %}` loop row, capture cell styles first, set `tblHeader`; idempotent; runs AFTER neutralize)
> - `retokenize_general_book` calls `normalize_data_table` after `_neutralize_part_runs` when `detect_table_schema` is truthy
> - `validate_book_template`: dummy `table_rows` sized to columns; body-preservation excludes `w:tbl`; assert ≥1 rendered row; assert `"{{ ref }}"` cell renders literally
> - `book_template_service.table_schema_for(name) -> tuple[bool, list[str]]`; `delete_template(name)` (safe_template_name gated)
> - `schemas/book.py`: `WordTemplateTableRead{has_table, columns}`; `WordTemplateRead.kind: Literal["base","custom"]="custom"`; `WordBookCreate.table_rows: list[dict[str,str]] | None = None`
> - routes: `GET /books/word-templates/{name}/table`; `DELETE /books/word-templates/{name}` (204)
> - `word_book_service.create_word_book(..., table_rows=None)` — coerce cells to `str`, thread into render `data` before footer post-process, keep `sandboxed=True`
> - frontend: `api.getWordTemplateTable(name)`, `api.deleteWordTemplate(name)`; `TableGridField.tsx` (useFieldArray + Input, `dir="rtl"` wrapper, rows `{c0…cN}`); i18n `books.word.baseTemplate.{text,table,group}`, `books.word.customTemplate.group`, `books.word.tableGrid.{loading,error,empty,columnLabel}`, `books.word.{deleteTemplate,deleteTemplateConfirm,deleted}`

### Task M4-1: `detect_table_schema` (create `backend/app/core/book_table.py`)
As drafted — clean-table classifier returning header texts or None. Tests: clean→headers, no-table→None, two-tables→None, vMerge→None, gridSpan→None, ragged→None, header-only→headers. Test file `backend/tests/test_book_table_detect.py`. Commit `feat(book_table): detect_table_schema`.

### Task M4-2: `normalize_data_table` (idempotent loop-row injection)
As drafted — capture first-data-row cell styles, remove data rows, inject `{%tr for row in table_rows %}` / `{{ row.cN }}` cells / `{%tr endfor %}`, set `tblHeader`. Tests: tokens injected + PII stripped, idempotent (xml equal on 2nd run), no-op on no-table / two-tables, tblHeader set, renders with `table_rows`. Test file `backend/tests/test_book_table_normalize.py`. Commit `test(book_table): normalize idempotency + render`.

### Task M4-3: Integrate into `retokenize_general_book`
Add `from app.core.book_table import detect_table_schema, normalize_data_table`; after `_neutralize_part_runs` (~line 198) add `if detect_table_schema(doc) is not None: normalize_data_table(doc)`. Tests `backend/tests/test_book_table_retokenize_integration.py`: normalizes clean table, idempotent, plain book untouched, two-table book untouched. Commit `feat(retokenize): normalize table after neutralize`.

### Task M4-4: `validate_book_template` table-aware
Detect table + inject dummy `table_rows` sized to columns (probe last cell with `"{{ ref }}"`); add `_body_text_no_tables(docx_path)` (uses `doc.paragraphs`, which excludes table cells) for body-preservation; assert ≥1 rendered row (`DUMMY_CELL_0` present); assert `"{{ ref }}"` literal in output. Tests appended to `test_book_template_retokenize.py`. Commit `feat(validate): table-aware fail-closed + SSTI probe`.

### Task M4-5: `book_template_service.table_schema_for` + `delete_template`
As drafted — `table_schema_for(name)->(has_table, columns)` via `detect_table_schema`; `delete_template(name)` gated by `safe_template_name`, 404 if absent. Tests `backend/tests/test_book_template_table_schema.py` incl. traversal + reserved-name rejection. Commit `feat(book_template_service): table_schema_for + delete_template`.

### Task M4-6: Schemas — `WordTemplateTableRead`, `kind`, `table_rows`
Add `WordTemplateTableRead{has_table:bool, columns:list[str]}`; add `kind: Literal["base","custom"]="custom"` to `WordTemplateRead`; add `table_rows: list[dict[str,str]] | None = None` to `WordBookCreate`; import `WordTemplateTableRead` in `books.py`. Tests `backend/tests/test_book_schemas_m4.py`. Commit `feat(schemas): WordTemplateTableRead + kind + table_rows`.

### Task M4-7: Routes — `GET …/{name}/table` + `DELETE …/{name}`
Add both routes (require_capability("books.manage")); GET returns `WordTemplateTableRead`, DELETE 204. Tests `backend/tests/test_book_template_routes_m4.py`. Commit `feat(routes): table schema + delete word-template`.

### Task M4-8: `create_word_book` threads `table_rows`
Add `table_rows: list[dict[str,str]] | None = None` param; coerce every cell to `str`; set `data["table_rows"]` before render; pass `payload.table_rows` from the create route. Tests `backend/tests/test_word_book_table_rows.py`. Commit `feat(word_book_service): thread table_rows with str coercion`.

### Task M4-9: Base templates build script + `kind` tagging
- Create `backend/scripts/build_base_templates.py` producing `base_text.docx` + `base_table.docx` (retokenized + validated), with `--check` self-check. Run it against `data_dir/book_templates`.
- **`kind` tagging (seam-note 2):** in `book_template_service` add `_BASE_TEMPLATE_NAMES = {"base_text.docx", "base_table.docx"}`; where the template list is built, set each item's `kind = "base" if name in _BASE_TEMPLATE_NAMES else "custom"`. Add a test asserting `base_text.docx`→`kind=="base"` and a custom name→`kind=="custom"`.
- Commit `feat(scripts): base templates + kind tagging`.

### Task M4-10: Full backend gate (pytest + ruff + mypy)
Run `venv\Scripts\python.exe -m pytest backend/tests/`, `venv\Scripts\ruff.exe check .`, `venv\Scripts\ruff.exe format --check .`, `venv\Scripts\mypy.exe`. Fix findings (TYPE_CHECKING import guards, `from __future__ import annotations`, unused imports). Commit `fix(m4-gate): ruff/mypy clean, all backend green`.

### Task M4-11: API types resync (`/sync-api-types`)
Dump `backend/openapi.json` from the app, run `pnpm -C frontend run gen:api`, `pnpm -C frontend exec tsc -b --noEmit`. Verify `api.types.ts` has `WordTemplateTableRead`, `kind`, `table_rows`, and the two new operations. Commit `openapi.json` + `api.types.ts` together: `chore(api-types): resync for M4`.

### Task M4d-1: i18n strings (base names, table grid, delete, group labels)
Add to `en.json` + `ar.json` under `books.word`: `baseTemplate.{text,table,group}`, `customTemplate.group`, `tableGrid.{loading,error,empty,columnLabel}`, `{deleteTemplate,deleteTemplateConfirm,deleted}`. (EN "Start from"/"My templates"; AR "ابدأ من"/"قوالبي"; `columnLabel` EN "Column {{n}}"/AR "عمود {{n}}"; `empty` book-appropriate, NOT the itemsTable "بنود" wording.) Test `TableGridField.i18n.test.ts` asserts parity + AR≠EN. Commit `feat(M4d): i18n keys`.

### Task M4d-2: `api.getWordTemplateTable` + `api.deleteWordTemplate`
Add both wrappers to `frontend/src/lib/api.ts` (types come from the M4-11 resync — do NOT hand-edit `api.types.ts` if M4-11 already ran; otherwise apply the bridge edits). Test `api.wordTemplateTable.test.ts` stubs `fetch` and asserts the GET `…/table` and DELETE calls. Commit `feat(M4d): api wrappers`.

### Task M4d-3: `TableGridField` component
Create `frontend/src/components/application/TableGridField.tsx` — `useFieldArray` + `<Input>`, `dir="rtl"` on the table wrapper (c0 rightmost), headers from `columns` with `columnLabel` fallback, add-row (reuse `itemsTable.addRow`), empty state (`books.word.tableGrid.empty`), rows `{c0…cN}` by logical index. Test `TableGridField.test.tsx`. Commit `feat(M4d): TableGridField RTL add-row grid`.

### Task M4d-4: Wire grid into `TemplateForm` + group picker by `kind`
Add a `getWordTemplateTable` query (enabled when `wordMode && templateName`); render `TableGridField name="table_rows" columns={columns}` when `has_table`; group the picker with `<optgroup>` base vs custom (using the group i18n keys); show loading/error states. Tests added to `TemplateForm.bodyMode.test.tsx` (mock `api.getWordTemplateTable`). Commit `feat(M4d): wire grid + kind grouping`.

### Task M4d-5: Thread `table_rows` into the create payload
In `ApplicationPage.tsx`, read `form.getValues('table_rows')`, include it in `wordSessionMutation.mutate({... table_rows})` when non-empty (else `undefined`). Test `ApplicationPage.tableRows.test.tsx`. Commit `feat(M4d): thread table_rows into createWordBook`.

### Task M4d-6: Delete button in `WordTemplateManager`
Add `deleteMutation` (invalidate `['word-templates']`, deselect if the deleted template was selected), a `window.confirm` guard, and a delete button per row shown only when `kind !== 'base'`. Tests added to `WordTemplateManager.test.tsx` (confirm accept/cancel, base has no delete). Commit `feat(M4d): delete template UI`.

**PR 2 gate:** full backend pytest + ruff + mypy green; `pnpm -C frontend exec vitest run`, `tsc -b --noEmit`, `run lint` green; run `i18n-rtl-reviewer` + `notification-template-reviewer` agents on the diff; run `build_base_templates.py` on the server data dir at deploy.

---

## Self-review (completed during assembly)

- **Spec coverage:** M1a–c (ref), M2 (filename+vuln), M3 (footer), M4-1…M4-11 + M4d-1…M4d-6 (two base templates, detection, normalization, validation, schema/routes, render, delete, grid, i18n), M5 (HugeRTE). All spec sections mapped.
- **Type consistency:** `detect_table_schema`/`normalize_data_table`/`table_schema_for`/`delete_template`/`book_download_filename`/`create_word_book(table_rows=)`/`WordTemplateTableRead`/`kind`/`table_rows{c0…cN}` names are identical across producing and consuming tasks.
- **Seams resolved:** api-types resync (M4-11) runs before frontend M4d; `kind` assignment specified in M4-9; group i18n keys consolidated into M4d-1.
