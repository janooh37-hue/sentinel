# General Book Arabic Ref Line + Word Template Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every General Book carries an Arabic `الرقم: 1/{tab}/GSSG/{serial}` line above the date (replacing the English header stamp), and the Word authoring path gains a tokenized boilerplate-template library (pick at create, save-as-template, one-time import of 8 Desktop files).

**Architecture:** Stored library templates are `.docx` files in `{data_dir}/book_templates/` with exactly three Jinja tokens (`{{ ref }}`, `{{ date }}`, `{{ submitter_g }}`) re-injected at save time by a shared "retokenize" helper that also neutralizes operator-typed Jinja (SSTI defense) and validates by test-render. Create-from-template reuses the existing General Book fill pipeline with only the template path changed, rendering library files under a sandboxed Jinja environment.

**Tech Stack:** FastAPI + SQLAlchemy (SQLite), python-docx + docxtpl + jinja2 (already installed — `jinja2.sandbox` needs no new dep), React 19 + React Query + i18next, pytest + vitest.

**Spec:** `docs/superpowers/specs/2026-07-19-general-book-templates-ref-line-design.md`

## Global Constraints

- All Python via `venv\Scripts\python.exe`; pytest runs with `filterwarnings=error`; mypy is `strict`; ruff + mypy hooks fire on edit.
- Work in a worktree (`.claude/worktrees/general-book-templates`), branch off `main`; this checkout is live production — merge to `main` + push `origin/main` only at the end.
- Every UI string lands in BOTH `frontend/src/locales/en.json` and `ar.json`; new keys under `books.word.*` (must NOT collide with the rich editor's `editor.template.*`). Tests that guard Arabic output assert the **Arabic** string.
- `backend/templates/GSSG-GS_300-003_General_Book.docx` is edited **programmatically once** (Task 1) and committed intentionally; revert any other template churn before committing (`git checkout -- backend/templates/` for files you didn't mean to touch).
- Backend schema/route changes require the `/sync-api-types` skill (dump openapi → `pnpm gen:api` → typecheck) before frontend tasks; commit `api.types.ts` (note: `openapi.json` is gitignored in this repo — commit whatever the skill's convention produces).
- The ref value rendered into RTL paragraphs must sit in an explicitly LTR run (`<w:rtl w:val="0"/>`); frontend ref/name interpolations use `bidi()` from `@/lib/bidi` or `<bdi dir="ltr">`.
- Library template names: NFC-normalized, passed through `vault_service._safe_filename`, Windows reserved device names rejected, `.docx` forced. Stored templates are untrusted input.
- One-off docx scripts need an `if __name__ == "__main__":` guard (multiprocessing spawn gotcha).

---

### Task 1: Add the Arabic ref line to the canonical General Book template

**Files:**
- Create: `backend/scripts/add_ref_line_to_general_book_template.py`
- Modify: `backend/templates/GSSG-GS_300-003_General_Book.docx` (via the script)
- Test: `backend/tests/test_general_book_ref_line.py` (new file)

**Interfaces:**
- Consumes: `DocxEngine.fill("General Book", data, out)` (existing), `app.core.book_text.docx_to_text(path)` (existing).
- Produces: the canonical template now contains three consecutive body paragraphs above the date line: `{%p if ref %}` / `الرقم: {{ ref }}` (ref run LTR) / `{%p endif %}`. Every later task relies on `{{ ref }}` rendering when `data["ref"]` is set and the line vanishing when it is absent.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_general_book_ref_line.py`:

```python
"""The canonical General Book template renders an Arabic ref line above the
date when ``ref`` is provided, and omits it (three guard paragraphs collapse)
when it is not. Asserts the ARABIC string per the i18n lesson."""

from pathlib import Path

from app.core.book_text import docx_to_text
from app.core.docx_engine import DocxEngine
from app.services.document_service import GENERAL_BOOK_BODY_SENTINEL

TEMPLATES_DIR = Path(__file__).resolve().parents[1] / "templates"

_BASE_DATA = {
    "subject": "اختبار",
    "body": GENERAL_BOOK_BODY_SENTINEL,
    "body_html": "<p>نص تجريبي</p>",
    "recipient_name": "السيد المدير",
    "cc": [],
    "submitter_g": "G-1234",
}


def test_ref_line_renders_above_date(tmp_path):
    out = tmp_path / "out.docx"
    DocxEngine(TEMPLATES_DIR).fill("General Book", {**_BASE_DATA, "ref": "1/5/GSSG/141"}, out)
    text = docx_to_text(out)
    assert "الرقم: 1/5/GSSG/141" in text
    # above the date: الرقم line appears before التاريخ in document order
    assert text.index("الرقم:") < text.index("التاريخ:")


def test_ref_line_absent_without_ref(tmp_path):
    out = tmp_path / "out.docx"
    DocxEngine(TEMPLATES_DIR).fill("General Book", dict(_BASE_DATA), out)
    text = docx_to_text(out)
    assert "الرقم" not in text  # preview/serial-free renders show no ref line


def test_ref_run_is_explicit_ltr(tmp_path):
    """The {{ ref }} value run must carry <w:rtl w:val="0"/> or Word's bidi
    algorithm reorders 1/5/GSSG/141 inside the RTL paragraph."""
    from docx import Document

    out = tmp_path / "out.docx"
    DocxEngine(TEMPLATES_DIR).fill("General Book", {**_BASE_DATA, "ref": "1/5/GSSG/141"}, out)
    doc = Document(str(out))
    ref_para = next(p for p in doc.paragraphs if "1/5/GSSG/141" in p.text)
    ref_runs = [r for r in ref_para.runs if "GSSG" in r.text]
    assert ref_runs, "ref value must be in its own run"
    assert all(r.font.rtl is False for r in ref_runs)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_general_book_ref_line.py -v`
Expected: FAIL — `"الرقم: 1/5/GSSG/141" in text` is False (template has no ref token yet).

- [ ] **Step 3: Write the template-edit script**

Create `backend/scripts/add_ref_line_to_general_book_template.py`:

```python
"""One-time, idempotent: insert the guarded Arabic ref line above the date
line in the canonical General Book template. The modified .docx is committed
intentionally (template-churn rule: only THIS file changes)."""

import copy
import sys
from pathlib import Path

from docx import Document
from docx.text.paragraph import Paragraph

TEMPLATE = Path(__file__).resolve().parents[1] / "templates" / "GSSG-GS_300-003_General_Book.docx"


def main() -> None:
    doc = Document(str(TEMPLATE))
    if any("{{ ref }}" in p.text for p in doc.paragraphs):
        print("already has ref line; nothing to do")
        return
    date_p = next(p for p in doc.paragraphs if "التاريخ" in p.text and "{{ date }}" in p.text)

    def clone_empty_before() -> Paragraph:
        """Deep-copy the date paragraph (keeps RTL pPr/alignment), strip its
        runs, insert before date_p. Successive calls stack in call order."""
        new_p = copy.deepcopy(date_p._p)
        date_p._p.addprevious(new_p)
        para = Paragraph(new_p, date_p._parent)
        for r in list(para.runs):
            r._element.getparent().remove(r._element)
        return para

    src_run = date_p.runs[0]

    def style_like_date(run) -> None:
        run.font.name = src_run.font.name
        run.font.size = src_run.font.size
        run.font.bold = src_run.font.bold

    p_if = clone_empty_before()
    p_if.add_run("{%p if ref %}")

    p_ref = clone_empty_before()
    label = p_ref.add_run("الرقم: ")
    style_like_date(label)
    ref_run = p_ref.add_run("{{ ref }}")
    style_like_date(ref_run)
    ref_run.font.rtl = False  # LTR isolate — 1/5/GSSG/141 must not reorder

    p_endif = clone_empty_before()
    p_endif.add_run("{%p endif %}")

    doc.save(str(TEMPLATE))
    print("ref line added")


if __name__ == "__main__":
    sys.exit(main())
```

Note: if `run.font.rtl` is unavailable in the installed python-docx, set it via XML instead:
`rPr = run._element.get_or_add_rPr(); el = OxmlElement("w:rtl"); el.set(qn("w:val"), "0"); rPr.append(el)`.

- [ ] **Step 4: Run the script, then the tests**

Run: `venv\Scripts\python.exe backend/scripts/add_ref_line_to_general_book_template.py`
Expected: `ref line added`
Run: `venv\Scripts\python.exe -m pytest backend/tests/test_general_book_ref_line.py -v`
Expected: 3 PASS

- [ ] **Step 5: Check no other template churned, then commit**

```bash
git status --short backend/templates/   # ONLY GSSG-GS_300-003_General_Book.docx may appear
git add backend/scripts/add_ref_line_to_general_book_template.py backend/templates/GSSG-GS_300-003_General_Book.docx backend/tests/test_general_book_ref_line.py
git commit -m "feat(general-book): Arabic ref line above date in canonical template"
```

---

### Task 2: Pass `ref` on every render path; drop the English header stamp for General Books

**Files:**
- Modify: `backend/app/services/document_service.py` (~1157 after `_build_template_data`; ~1235 step 9; ~1795 sign path; ~1830 sign stamps)
- Modify: `backend/app/services/word_book_service.py:174` (remove stamp call)
- Modify: `backend/tests/test_word_book_service.py` (~87–122 — rewrite header-stamp assertions)
- Test: extend `backend/tests/test_general_book_ref_line.py`

**Interfaces:**
- Consumes: Task 1's template tokens.
- Produces: committed General Books (rich, Word, signed, duty-transfer) contain the body `الرقم:` line and NO `Ref:` text in any header. Other form types keep the header stamp unchanged.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_general_book_ref_line.py`:

```python
def _header_text(docx_path) -> str:
    from docx import Document

    doc = Document(str(docx_path))
    parts = []
    for section in doc.sections:
        for hdr in (section.header, section.first_page_header):
            parts.extend(p.text for p in hdr.paragraphs)
    return "\n".join(parts)


def test_word_book_has_ref_line_and_no_header_stamp(db_session, admin_user):
    """Word-path create: body الرقم line present, English Ref: stamp gone."""
    from app.services import word_book_service

    info = word_book_service.create_word_book(
        db_session,
        user=admin_user,
        classification_code="1/5",
        recipient_id=None,
        subject="اختبار القالب",
        cc=[],
        manager_id=None,
    )
    from app.db.models import BookEditSession

    session = db_session.query(BookEditSession).filter_by(book_id=info.book_id).one()
    text = docx_to_text(Path(session.working_path))
    assert f"الرقم: {info.ref_number}" in text
    assert "Ref:" not in _header_text(session.working_path)
```

(Reuse the existing fixtures from `backend/tests/test_word_book_service.py` — copy its `db_session`/user fixture pattern or move shared fixtures to `conftest.py` if they aren't already. The classification code `"1/5"` must be a real code from `app/core/classifications.py` — check `get_classification` usage in existing tests and use the same code they use.)

- [ ] **Step 2: Run to verify the new test fails**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_general_book_ref_line.py -v`
Expected: the new test FAILS on `"Ref:" not in _header_text(...)` (stamp still written).

- [ ] **Step 3: Implement the four backend changes**

In `backend/app/services/document_service.py`, right after the `_build_template_data(...)` call (~line 1167), add:

```python
    # General Book: the classified ref renders as the Arabic body line
    # (الرقم: …) — commit-only, so previews stay serial-free. Replaces the
    # English header stamp for this form.
    if commit and template_id == "General Book":
        data["ref"] = raw_ref
```

Step 9 (~1235) — gate the header stamp, keep the Aztec:

```python
    if commit:
        if template_id != "General Book":
            DocxEngine.stamp_ref_number(docx_path, raw_ref, STAMP_STYLE_HEADER)
        DocxEngine.stamp_aztec_code(docx_path, raw_ref, corner=aztec_corner_for(template_id))
```

Sign path — before `engine.fill(template_id, data, docx_path)` (~1821), add:

```python
    if template_id == "General Book":
        data["ref"] = book.ref_number
```

and gate the stamp (~1830):

```python
    if template_id != "General Book":
        DocxEngine.stamp_ref_number(docx_path, book.ref_number, STAMP_STYLE_HEADER)
    DocxEngine.stamp_aztec_code(docx_path, book.ref_number, corner=aztec_corner_for(template_id))
```

In `backend/app/services/word_book_service.py` delete line 174 (`DocxEngine.stamp_ref_number(...)`) and drop `STAMP_STYLE_HEADER` from the import at line 29.

- [ ] **Step 4: Rewrite the stale assertions**

In `backend/tests/test_word_book_service.py` (~87–122): the tests asserting `"Ref: 1/5/GSSG/1" in header_text` (and docstrings claiming "the General Book template has no {{ ref }} token") flip to assert the body line instead:

```python
    text = docx_to_text(Path(session.working_path))
    assert f"الرقم: {info.ref_number}" in text
```

and any header assertion becomes `assert "Ref:" not in header_text`.

- [ ] **Step 5: Run the affected suites**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_general_book_ref_line.py backend/tests/test_word_book_service.py backend/tests/test_general_book_classified_ref.py backend/tests/test_duty_transfer_service.py -v`
Expected: all PASS (duty transfer letters inherit the ref line via `generate_document`).

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/document_service.py backend/app/services/word_book_service.py backend/tests/
git commit -m "feat(general-book): render Arabic ref line on all paths; drop English header stamp"
```

---

### Task 3: `الرقم:`-anchored stamped-tier OCR pattern

**Files:**
- Modify: `backend/app/core/extraction/form_ref.py:18`
- Test: `backend/tests/test_form_ref_patterns.py`

**Interfaces:**
- Consumes: nothing new.
- Produces: `candidate_refs()` returns `الرقم:`-anchored classified refs in the trusted stamped tier (before bare fallbacks).

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_form_ref_patterns.py`:

```python
def test_arabic_stamped_anchor_beats_bare_fallback():
    """Scan-back of a book with no English header stamp: the الرقم:-anchored
    ref must rank in the stamped tier, ahead of earlier bare-shaped noise."""
    text = "GS-0048 noise ... الرقم: 1/5/GSSG/141 التاريخ: 01-01-2026"
    refs = candidate_refs(text)
    assert refs[0] == "1/5/GSSG/141"
```

- [ ] **Step 2: Run to verify it fails**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_form_ref_patterns.py -v`
Expected: new test FAILS (`GS-0048` ranks first — الرقم is not a stamped anchor yet).

- [ ] **Step 3: Extend the stamped pattern**

In `backend/app/core/extraction/form_ref.py` replace line 18:

```python
_STAMPED_RE = re.compile(
    rf"(?:Ref:|الرقم\s*[:：]?)\s*([A-Z0-9]{{1,5}}-\d{{3,5}}|{_CLASSIFIED})", re.IGNORECASE
)
```

- [ ] **Step 4: Run to verify all pattern tests pass**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_form_ref_patterns.py -v`
Expected: all PASS (including the pre-existing `test_classified_bare_ref_matches_as_fallback`).

- [ ] **Step 5: Commit**

```bash
git add backend/app/core/extraction/form_ref.py backend/tests/test_form_ref_patterns.py
git commit -m "feat(scan-back): الرقم-anchored refs match in the stamped confidence tier"
```

---

### Task 4: Sandboxed render + fill-by-path for the General Book adapter

**Files:**
- Modify: `backend/app/core/docx_render.py` (render signature ~184, env construction ~225)
- Modify: `backend/app/core/docx_engine.py` (new method after `fill`, ~733)
- Test: `backend/tests/test_docx_render_sandbox.py` (new file)

**Interfaces:**
- Consumes: existing `render()` / `_REGISTRY["General Book"]`.
- Produces:
  - `render(template_path, data, output_path, *, post_process=None, strict=False, sandboxed=False) -> Path` — `sandboxed=True` uses `jinja2.sandbox.SandboxedEnvironment`.
  - `DocxEngine.fill_general_book_path(self, template_path: Path, data: Mapping[str, Any], output_path: Path | str, *, sandboxed: bool = False, strict: bool = False) -> Path` — General Book adapter + post_process against an arbitrary template file. Tasks 5, 8 call these.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_docx_render_sandbox.py`:

```python
"""Sandboxed Jinja for untrusted library templates: attribute-walk payloads
must raise SecurityError instead of executing."""

from pathlib import Path

import pytest
from docx import Document
from jinja2.exceptions import SecurityError

from app.core.book_text import docx_to_text
from app.core.docx_engine import DocxEngine
from app.core.docx_render import render

TEMPLATES_DIR = Path(__file__).resolve().parents[1] / "templates"


def _make_docx(tmp_path: Path, text: str) -> Path:
    p = tmp_path / "tpl.docx"
    doc = Document()
    doc.add_paragraph(text)
    doc.save(str(p))
    return p


def test_sandbox_blocks_attribute_walk(tmp_path):
    tpl = _make_docx(tmp_path, "{{ ''.__class__.__mro__ }}")
    with pytest.raises(SecurityError):
        render(tpl, {}, tmp_path / "out.docx", sandboxed=True, strict=False)


def test_sandbox_renders_normal_tokens(tmp_path):
    tpl = _make_docx(tmp_path, "الرقم: {{ ref }}")
    out = render(tpl, {"ref": "1/5/GSSG/9"}, tmp_path / "out.docx", sandboxed=True)
    assert "الرقم: 1/5/GSSG/9" in docx_to_text(out)


def test_fill_general_book_path_uses_adapter(tmp_path):
    """fill_general_book_path routes through _adapt_general_book — the date
    token resolves even when data has no 'date' key."""
    tpl = _make_docx(tmp_path, "التاريخ: {{ date }}")
    out = tmp_path / "out.docx"
    DocxEngine(TEMPLATES_DIR).fill_general_book_path(tpl, {"body_html": ""}, out, sandboxed=True)
    text = docx_to_text(out)
    assert "التاريخ: " in text
    assert "{{ date }}" not in text
```

- [ ] **Step 2: Run to verify they fail**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_docx_render_sandbox.py -v`
Expected: FAIL — `render() got an unexpected keyword argument 'sandboxed'`.

- [ ] **Step 3: Implement**

In `backend/app/core/docx_render.py`: add `sandboxed: bool = False` to `render()`'s signature (after `strict`), add the import, and replace the `Environment(...)` construction (~225):

```python
from jinja2.sandbox import SandboxedEnvironment
```

```python
    env_cls = SandboxedEnvironment if sandboxed else Environment
    jinja_env = env_cls(
        undefined=StrictUndefined if strict else _SilentUndefined,
        autoescape=False,
    )
```

In `backend/app/core/docx_engine.py`, after `fill` (~733):

```python
    def fill_general_book_path(
        self,
        template_path: Path,
        data: Mapping[str, Any],
        output_path: Path | str,
        *,
        sandboxed: bool = False,
        strict: bool = False,
    ) -> Path:
        """Render an arbitrary docx through the General Book adapter +
        post-process — for library boilerplate templates (untrusted; render
        sandboxed). Raises FileNotFoundError if the file is gone."""
        if not Path(template_path).exists():
            raise FileNotFoundError(template_path)
        spec = self._REGISTRY["General Book"]
        adapter: Callable[[dict[str, Any]], dict[str, Any]] = spec["adapter"]
        prepared = adapter(dict(data))
        return render(
            Path(template_path),
            prepared,
            Path(output_path),
            post_process=spec.get("post_process"),
            strict=strict,
            sandboxed=sandboxed,
        )
```

- [ ] **Step 4: Run to verify they pass**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_docx_render_sandbox.py -v`
Expected: 3 PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/core/docx_render.py backend/app/core/docx_engine.py backend/tests/test_docx_render_sandbox.py
git commit -m "feat(docx): sandboxed Jinja render + General Book fill-by-path for library templates"
```

---

### Task 5: The retokenize + validate helper (core)

**Files:**
- Create: `backend/app/core/book_template_retokenize.py`
- Test: `backend/tests/test_book_template_retokenize.py` (new file)

**Interfaces:**
- Consumes: Task 4's `render(..., strict=True, sandboxed=True)`; `docx_to_text`.
- Produces (Task 6 and the import script call these):
  - `retokenize_general_book(docx_path: Path, *, submitter_g: str | None = None) -> None` — in-place surgery.
  - `validate_book_template(docx_path: Path) -> None` — raises `ValueError` (message is operator-safe; the service layer wraps it in AppError).

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_book_template_retokenize.py`:

```python
"""Retokenize surgery: a finished General Book docx becomes a library
template with exactly three live tokens; all foreign Jinja is inert."""

from pathlib import Path

import pytest
from docx import Document

from app.core.book_template_retokenize import (
    retokenize_general_book,
    validate_book_template,
)
from app.core.book_text import docx_to_text
from app.core.docx_render import render


def _finished_book(tmp_path: Path, *, ref_line: bool = True, spacing: str = "") -> Path:
    """Minimal stand-in for a finished book: date + optional ref + body."""
    p = tmp_path / "book.docx"
    doc = Document()
    if ref_line:
        doc.add_paragraph(f"الرقم:{spacing}1/{spacing}5{spacing}/GSSG/{spacing}140")
    doc.add_paragraph("التاريخ: 13/07/2026")
    doc.add_paragraph("السيد / مدير الإدارة المحترم")
    doc.add_paragraph("الموضوع: التصاريح الأمنية بتاريخ 01/07/2026")
    doc.add_paragraph("نص الكتاب هنا")
    doc.save(str(p))
    return p


def _rendered_text(tpl: Path, tmp_path: Path, **data) -> str:
    out = tmp_path / "rendered.docx"
    render(tpl, data, out, sandboxed=True)
    return docx_to_text(out)


def test_ref_and_date_retokenized(tmp_path):
    p = _finished_book(tmp_path)
    retokenize_general_book(p)
    text = _rendered_text(p, tmp_path, ref="9/9/GSSG/999", date="31-12-2099")
    assert "الرقم: 9/9/GSSG/999" in text
    assert "التاريخ: 31-12-2099" in text
    assert "140" not in text  # old baked ref gone


def test_legacy_spacing_handled(tmp_path):
    p = _finished_book(tmp_path, spacing=" ")
    retokenize_general_book(p)
    text = _rendered_text(p, tmp_path, ref="9/9/GSSG/999", date="31-12-2099")
    assert "الرقم: 9/9/GSSG/999" in text


def test_missing_ref_line_inserted_above_date(tmp_path):
    p = _finished_book(tmp_path, ref_line=False)
    retokenize_general_book(p)
    text = _rendered_text(p, tmp_path, ref="9/9/GSSG/999", date="31-12-2099")
    assert text.index("الرقم: 9/9/GSSG/999") < text.index("التاريخ:")


def test_prose_date_untouched(tmp_path):
    p = _finished_book(tmp_path)
    retokenize_general_book(p)
    text = _rendered_text(p, tmp_path, ref="9/9/GSSG/999", date="31-12-2099")
    assert "بتاريخ 01/07/2026" in text  # date inside الموضوع prose survives


def test_foreign_jinja_neutralized(tmp_path):
    p = tmp_path / "book.docx"
    doc = Document()
    doc.add_paragraph("التاريخ: 13/07/2026")
    doc.add_paragraph("خصم {{ 7*7 }} بالمئة {% if x %}شرط{% endif %}")
    doc.save(str(p))
    retokenize_general_book(p)
    text = _rendered_text(p, tmp_path, ref="9/9/GSSG/999", date="31-12-2099")
    assert "49" not in text          # never executed
    assert "7*7" in text             # visible text preserved
    assert "شرط" in text             # {% if %} inert, content kept literal


def test_ref_run_marked_ltr(tmp_path):
    p = _finished_book(tmp_path)
    retokenize_general_book(p)
    doc = Document(str(p))
    ref_para = next(pp for pp in doc.paragraphs if "{{ ref }}" in pp.text)
    run = next(r for r in ref_para.runs if "{{ ref }}" in r.text)
    assert run.font.rtl is False


def test_validate_accepts_good_template(tmp_path):
    p = _finished_book(tmp_path)
    retokenize_general_book(p)
    validate_book_template(p)  # no raise


def test_validate_rejects_unretokenized_doc(tmp_path):
    p = _finished_book(tmp_path)
    with pytest.raises(ValueError):
        validate_book_template(p)  # no tokens → dummy values never render
```

- [ ] **Step 2: Run to verify they fail**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_book_template_retokenize.py -v`
Expected: FAIL — `ModuleNotFoundError: app.core.book_template_retokenize`.

- [ ] **Step 3: Implement the module**

Create `backend/app/core/book_template_retokenize.py`:

```python
"""Turn a finished General Book docx into a library boilerplate template.

Exactly three tokens are (re)injected — ``{{ ref }}``, ``{{ date }}``,
``{{ submitter_g }}`` — and ALL pre-existing Jinja delimiters in the document
are neutralized (a zero-width space inside each delimiter) so operator-typed
text can never execute server-side (SSTI defense; stored templates are
untrusted). Validation test-renders under StrictUndefined + sandbox and
fails closed.
"""

from __future__ import annotations

import copy
import re
import tempfile
from pathlib import Path
from typing import Any

from docx import Document
from docx.text.paragraph import Paragraph

from app.core.book_text import docx_to_text
from app.core.docx_render import render

_ZWSP = "​"  # zero-width space — invisible, breaks Jinja delimiters
_JINJA_DELIM = re.compile(r"\{\{|\}\}|\{%|%\}|\{#|#\}")
# The Aztec stamp's anchor carries this fixed relativeHeight (see
# _docx_helpers.insert_floating_image_in_header) — the letterhead images do
# not, so this selector can never remove the letterhead.
_AZTEC_RELATIVE_HEIGHT = "251670000"
_WP_NS = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"

_REF_LABEL = re.compile(r"^\s*الرقم\s*[:：]")
_DATE_LABEL = re.compile(r"^\s*التاريخ\s*[:：]")
_G_NUMBER = re.compile(r"\bG[-\s]?\d{1,6}\b")

_DUMMY = {"ref": "9/9/GSSG/9999", "date": "31-12-2099", "submitter_g": "G-9999"}


def _neutralize_part_runs(container: Any) -> None:
    for para in container.paragraphs:
        for run in para.runs:
            if run.text and _JINJA_DELIM.search(run.text):
                run.text = _JINJA_DELIM.sub(lambda m: m.group(0)[0] + _ZWSP + m.group(0)[1], run.text)
    for table in getattr(container, "tables", []):
        for row in table.rows:
            for cell in row.cells:
                _neutralize_part_runs(cell)


def _clear_runs(para: Paragraph) -> None:
    for r in list(para.runs):
        r._element.getparent().remove(r._element)


def _first_run_style(para: Paragraph) -> Any | None:
    return para.runs[0] if para.runs else None


def _write_ref_block(anchor: Paragraph, *, replace: bool) -> None:
    """Write {%p if ref %} / الرقم: {{ ref }} / {%p endif %} at *anchor*.

    replace=True: anchor IS the old الرقم paragraph (reuse it for the label
    line, keeping its formatting). replace=False: insert all three before
    anchor (the التاريخ paragraph)."""
    src = _first_run_style(anchor)

    def styled(run: Any) -> Any:
        if src is not None:
            run.font.name = src.font.name
            run.font.size = src.font.size
            run.font.bold = src.font.bold
        return run

    if replace:
        label_para = anchor
    else:
        new_p = copy.deepcopy(anchor._p)
        anchor._p.addprevious(new_p)
        label_para = Paragraph(new_p, anchor._parent)

    guard_open = copy.deepcopy(label_para._p)
    label_para._p.addprevious(guard_open)
    p_if = Paragraph(guard_open, label_para._parent)
    _clear_runs(p_if)
    p_if.add_run("{%p if ref %}")

    _clear_runs(label_para)
    styled(label_para.add_run("الرقم: "))
    ref_run = styled(label_para.add_run("{{ ref }}"))
    ref_run.font.rtl = False  # LTR isolate for 1/5/GSSG/141 in the RTL line

    guard_close = copy.deepcopy(label_para._p)
    label_para._p.addnext(guard_close)
    p_endif = Paragraph(guard_close, label_para._parent)
    _clear_runs(p_endif)
    p_endif.add_run("{%p endif %}")


def _retokenize_labeled_line(para: Paragraph, prefix: str, token: str) -> None:
    src = _first_run_style(para)
    _clear_runs(para)
    run = para.add_run(prefix + token)
    if src is not None:
        run.font.name = src.font.name
        run.font.size = src.font.size
        run.font.bold = src.font.bold


def _strip_header_artifacts(doc: Any) -> None:
    """Remove the old Aztec anchor (by its unique relativeHeight) and any
    legacy English 'Ref:' stamp text from both header parts."""
    for section in doc.sections:
        for hdr in (section.header, section.first_page_header):
            for para in hdr.paragraphs:
                for anchor in para._p.findall(f".//{{{_WP_NS}}}anchor"):
                    if anchor.get("relativeHeight") == _AZTEC_RELATIVE_HEIGHT:
                        drawing = anchor.getparent()
                        drawing.getparent().remove(drawing)
                if para.text.strip().startswith("Ref:"):
                    _clear_runs(para)


def _retokenize_footers(doc: Any, submitter_g: str | None) -> None:
    """Both footers (footer2 is a synced copy of footer3): the baked G-number
    becomes {{ submitter_g }} so a new author's G renders at create."""
    for section in doc.sections:
        for footer in (section.footer, section.first_page_footer, section.even_page_footer):
            for para in footer.paragraphs:
                for run in para.runs:
                    if submitter_g and submitter_g in run.text:
                        run.text = run.text.replace(submitter_g, "{{ submitter_g }}")
                    elif _G_NUMBER.search(run.text):
                        run.text = _G_NUMBER.sub("{{ submitter_g }}", run.text, count=1)


def retokenize_general_book(docx_path: Path, *, submitter_g: str | None = None) -> None:
    doc = Document(str(docx_path))

    # 1. Neutralize FIRST — everything currently in the doc is untrusted.
    _neutralize_part_runs(doc)
    for section in doc.sections:
        for part in (
            section.header,
            section.first_page_header,
            section.footer,
            section.first_page_footer,
        ):
            _neutralize_part_runs(part)

    # 2/3. Ref + date lines (first labeled body paragraph each; prose ignored).
    date_para = next((p for p in doc.paragraphs if _DATE_LABEL.match(p.text)), None)
    if date_para is None:
        raise ValueError("لا يحتوي المستند على سطر التاريخ — لا يمكن حفظه كقالب")
    ref_para = next((p for p in doc.paragraphs if _REF_LABEL.match(p.text)), None)
    if ref_para is not None:
        _write_ref_block(ref_para, replace=True)
    else:
        _write_ref_block(date_para, replace=False)
    _retokenize_labeled_line(date_para, "التاريخ: ", "{{ date }}")

    # 4. Footer G-number → token (both footers).
    _retokenize_footers(doc, submitter_g)

    # 5. Old Aztec + English header stamp out.
    _strip_header_artifacts(doc)

    doc.save(str(docx_path))


def validate_book_template(docx_path: Path) -> None:
    """Fail-closed check: dummy render must succeed under sandbox+strict and
    place each dummy value exactly once. Raises ValueError (operator-safe
    message, no paths/tracebacks)."""
    source_text = docx_to_text(docx_path)
    with tempfile.TemporaryDirectory() as td:
        out = Path(td) / "check.docx"
        try:
            render(docx_path, dict(_DUMMY), out, strict=True, sandboxed=True)
        except Exception as exc:  # sandbox/strict/syntax — reason stays generic
            raise ValueError("تعذر التحقق من القالب — فشل عرض تجريبي") from exc
        text = docx_to_text(out)
    if text.count(_DUMMY["ref"]) != 1 or text.count(_DUMMY["date"]) != 1:
        raise ValueError("سطر الرقم أو التاريخ لم يُستبدل بشكل صحيح")
    # Body preserved: every substantial source line (minus token lines)
    # must survive the render.
    for line in source_text.splitlines():
        line = line.strip()
        if len(line) >= 15 and "{{" not in line and "{%" not in line:
            if line.replace(_ZWSP, "") not in text.replace(_ZWSP, ""):
                raise ValueError("نص القالب تغيّر أثناء العرض التجريبي")
```

- [ ] **Step 4: Run to verify they pass**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_book_template_retokenize.py -v`
Expected: 9 PASS. If `test_foreign_jinja_neutralized` fails because docxtpl merges runs, check that neutralization runs per-`w:t` — extend `_neutralize_part_runs` to walk `para._p.iter()` for `w:t` elements instead of `para.runs` if needed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/core/book_template_retokenize.py backend/tests/test_book_template_retokenize.py
git commit -m "feat(book-templates): retokenize + fail-closed validation for library templates"
```

---

### Task 6: Template library service (naming, listing, save-as-template)

**Files:**
- Create: `backend/app/services/book_template_service.py`
- Test: `backend/tests/test_book_template_service.py` (new file)

**Interfaces:**
- Consumes: Task 5's `retokenize_general_book` / `validate_book_template`; `vault_service._safe_filename`; models `Book`, `BookVersion`, `Document`, `User`.
- Produces (Tasks 7–9 call these):
  - `templates_dir() -> Path` (creates `{data_dir}/book_templates/` on first use)
  - `safe_template_name(raw: str) -> str` — NFC + `_safe_filename` + reserved-name reject + forced `.docx`; raises `AppError("TEMPLATE_BAD_NAME", …, 422)`
  - `list_templates() -> list[TemplateInfo]` where `TemplateInfo` is a dataclass `{name: str, modified_at: datetime}`, `.docx` only, mtime-desc
  - `resolve_template_path(name: str) -> Path`
  - `save_book_as_template(db: Session, *, book_id: int, name: str) -> TemplateInfo`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_book_template_service.py`:

```python
"""Library naming rules, listing, and the save-as-template flow."""

import unicodedata
from pathlib import Path

import pytest

from app.api.errors import AppError
from app.services import book_template_service as svc


@pytest.mark.parametrize(
    "bad",
    ["", "..", "../evil", "a/b", "a\\b", "CON", "con.docx", "NUL", "COM3", "name."],
)
def test_bad_names_rejected(bad):
    with pytest.raises(AppError) as ei:
        svc.safe_template_name(bad)
    assert ei.value.code == "TEMPLATE_BAD_NAME"


def test_name_gets_docx_extension_and_nfc():
    decomposed = unicodedata.normalize("NFD", "قالب")
    assert svc.safe_template_name(decomposed) == "قالب.docx"
    assert svc.safe_template_name("التصاريح الأمنية") == "التصاريح الأمنية.docx"
    assert svc.safe_template_name("جاهز.docx") == "جاهز.docx"


def test_list_filters_to_docx(tmp_path, monkeypatch):
    monkeypatch.setattr(svc, "templates_dir", lambda: tmp_path)
    (tmp_path / "صيانة.docx").write_bytes(b"x")
    (tmp_path / "stray.tmp").write_bytes(b"x")
    names = [t.name for t in svc.list_templates()]
    assert names == ["صيانة.docx"]


def test_save_book_as_template_roundtrip(db_session, finished_word_book):
    """finished_word_book: fixture creating a finished General Book via
    word_book_service (reuse/extract the pattern from test_word_book_service).
    Returns the Book row."""
    info = svc.save_book_as_template(
        db_session, book_id=finished_word_book.id, name="قالب التجربة"
    )
    stored = svc.resolve_template_path(info.name)
    assert stored.exists()
    # stored file is tokenized and valid
    from app.core.book_template_retokenize import validate_book_template

    validate_book_template(stored)


def test_save_collision_409(db_session, finished_word_book):
    svc.save_book_as_template(db_session, book_id=finished_word_book.id, name="مكرر")
    with pytest.raises(AppError) as ei:
        svc.save_book_as_template(db_session, book_id=finished_word_book.id, name="مكرر")
    assert ei.value.http_status == 409
```

(Build the `finished_word_book` fixture by extracting the create→PUT→finish sequence already used in `backend/tests/test_word_book_service.py` — put it in that test file's shared fixture location or `conftest.py`. Point `templates_dir` at `tmp_path` via `monkeypatch` in the fixtures so tests never touch the real data dir.)

- [ ] **Step 2: Run to verify they fail**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_book_template_service.py -v`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the service**

Create `backend/app/services/book_template_service.py`:

```python
"""Shared General Book boilerplate-template library — a flat folder of
tokenized .docx files. Stored templates are UNTRUSTED (see
book_template_retokenize); names are sanitized hard because they become
filenames on a Windows host."""

from __future__ import annotations

import os
import shutil
import unicodedata
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy.orm import Session

from app.api.errors import AppError
from app.config import get_settings
from app.core.book_template_retokenize import (
    retokenize_general_book,
    validate_book_template,
)
from app.db.models import Book, BookVersion, Document, User
from app.services.vault_service import _safe_filename

_RESERVED = {"CON", "PRN", "AUX", "NUL"} | {f"COM{i}" for i in range(1, 10)} | {
    f"LPT{i}" for i in range(1, 10)
}


@dataclass
class TemplateInfo:
    name: str
    modified_at: datetime


def templates_dir() -> Path:
    d = get_settings().data_dir / "book_templates"
    d.mkdir(parents=True, exist_ok=True)
    return d


def safe_template_name(raw: str) -> str:
    try:
        cleaned = _safe_filename(unicodedata.normalize("NFC", raw))
    except Exception as exc:
        raise AppError("TEMPLATE_BAD_NAME", "اسم القالب غير صالح", http_status=422) from exc
    stem = cleaned.rsplit(".", 1)[0] if "." in cleaned else cleaned
    if not stem or stem.upper() in _RESERVED:
        raise AppError("TEMPLATE_BAD_NAME", "اسم القالب غير صالح", http_status=422)
    if not cleaned.lower().endswith(".docx"):
        cleaned = f"{stem}.docx"
    return cleaned


def list_templates() -> list[TemplateInfo]:
    items = [
        TemplateInfo(
            name=p.name,
            modified_at=datetime.fromtimestamp(p.stat().st_mtime, tz=UTC).replace(tzinfo=None),
        )
        for p in templates_dir().iterdir()
        if p.is_file() and p.suffix.lower() == ".docx"
    ]
    items.sort(key=lambda t: t.modified_at, reverse=True)
    return items


def resolve_template_path(name: str) -> Path:
    return templates_dir() / safe_template_name(name)


def _source_docx_of(db: Session, book: Book) -> Path:
    latest = (
        db.query(BookVersion)
        .filter_by(book_id=book.id)
        .order_by(BookVersion.version_no.desc())
        .first()
    )
    if latest is None or latest.document_id is None:
        raise AppError("NO_SOURCE_DOCX", "الكتاب لا يحتوي نسخة منتهية", http_status=409)
    doc = db.get(Document, latest.document_id)
    if doc is None or not doc.docx_path:
        raise AppError("NO_SOURCE_DOCX", "ملف الكتاب غير موجود", http_status=409)
    p = Path(doc.docx_path)
    if not p.is_absolute():  # rich path stores data_dir-relative
        p = get_settings().data_dir / p
    if not p.exists():
        raise AppError("NO_SOURCE_DOCX", "ملف الكتاب غير موجود", http_status=409)
    return p


def save_book_as_template(db: Session, *, book_id: int, name: str) -> TemplateInfo:
    book = db.get(Book, book_id)
    if book is None:
        raise AppError("BOOK_NOT_FOUND", f"Book {book_id} not found", http_status=404)
    src = _source_docx_of(db, book)

    submitter_g: str | None = None
    if book.submitted_by_user_id is not None:
        submitter = db.get(User, book.submitted_by_user_id)
        submitter_g = submitter.employee_id if submitter else None

    dest = templates_dir() / safe_template_name(name)
    tmp = templates_dir() / f".tmp-{uuid.uuid4().hex}.docx"
    try:
        shutil.copy2(src, tmp)
        retokenize_general_book(tmp, submitter_g=submitter_g)
        try:
            validate_book_template(tmp)
        except ValueError as exc:
            raise AppError("TEMPLATE_INVALID", str(exc), http_status=422) from exc
        # Exclusive create — atomic 409 on collision (NTFS handles case folding).
        try:
            fd = os.open(dest, os.O_CREAT | os.O_EXCL | os.O_WRONLY | getattr(os, "O_BINARY", 0))
        except FileExistsError:
            raise AppError("TEMPLATE_EXISTS", "يوجد قالب بهذا الاسم", http_status=409) from None
        with os.fdopen(fd, "wb") as f:
            f.write(tmp.read_bytes())
    finally:
        tmp.unlink(missing_ok=True)
    return TemplateInfo(
        name=dest.name,
        modified_at=datetime.fromtimestamp(dest.stat().st_mtime, tz=UTC).replace(tzinfo=None),
    )
```

- [ ] **Step 4: Run to verify they pass**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_book_template_service.py -v`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/book_template_service.py backend/tests/test_book_template_service.py
git commit -m "feat(book-templates): library service — naming, listing, save-as-template"
```

---

### Task 7: API routes + schemas

**Files:**
- Modify: `backend/app/schemas/book.py` (~183 `WordBookCreate`; new schemas after `WordSessionRead` ~198)
- Modify: `backend/app/api/v1/books.py` (list route BEFORE `GET /{book_id}` — put it next to `/classifications` ~113; save route with the other book actions)
- Test: `backend/tests/test_word_book_routes.py`

**Interfaces:**
- Consumes: Task 6's service functions.
- Produces:
  - `WordBookCreate.template_name: str | None = None`
  - `class WordTemplateRead(BaseModel): name: str; modified_at: datetime`
  - `class SaveAsTemplateRequest(BaseModel): name: str`
  - `GET /api/v1/books/word-templates` → `list[WordTemplateRead]` (`books.manage`)
  - `POST /api/v1/books/{book_id}/save-as-template` → `WordTemplateRead`, 201 (`books.manage`)

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_word_book_routes.py` (follow its existing client/auth fixtures):

```python
def test_list_word_templates_empty(client_admin):
    r = client_admin.get("/api/v1/books/word-templates")
    assert r.status_code == 200
    assert r.json() == []


def test_list_word_templates_requires_books_manage(client_plain_user):
    r = client_plain_user.get("/api/v1/books/word-templates")
    assert r.status_code == 403


def test_save_as_template_bad_name_422(client_admin, finished_word_book):
    r = client_admin.post(
        f"/api/v1/books/{finished_word_book.id}/save-as-template",
        json={"name": "../evil"},
    )
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == "TEMPLATE_BAD_NAME"


def test_save_as_template_and_list(client_admin, finished_word_book):
    r = client_admin.post(
        f"/api/v1/books/{finished_word_book.id}/save-as-template",
        json={"name": "قالب المسار"},
    )
    assert r.status_code == 201
    assert r.json()["name"] == "قالب المسار.docx"
    listed = client_admin.get("/api/v1/books/word-templates").json()
    assert [t["name"] for t in listed] == ["قالب المسار.docx"]
```

(Match the error-body shape (`detail.code` vs top-level `code`) to what the existing AppError handler produces — copy the assertion style from a neighboring 4xx test in this file.)

- [ ] **Step 2: Run to verify they fail**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_word_book_routes.py -v -k template`
Expected: 404s / FAILs — routes don't exist.

- [ ] **Step 3: Implement schemas + routes**

`backend/app/schemas/book.py` — extend and add:

```python
class WordBookCreate(BaseModel):
    classification_code: str | None = None
    recipient_id: int | None = None
    subject: str
    cc: list[str] = Field(default_factory=list)
    manager_id: int | None = None
    template_name: str | None = None


class WordTemplateRead(BaseModel):
    name: str
    modified_at: datetime


class SaveAsTemplateRequest(BaseModel):
    name: str
```

`backend/app/api/v1/books.py` — import `book_template_service` and the two schemas; add after `/classifications` (~113):

```python
@router.get("/word-templates", response_model=list[WordTemplateRead])
def list_word_templates(
    _user: Annotated[User, Depends(require_capability("books.manage"))],
) -> list[WordTemplateRead]:
    """Shared General Book boilerplate library (Word path)."""
    return [
        WordTemplateRead(name=t.name, modified_at=t.modified_at)
        for t in book_template_service.list_templates()
    ]


@router.post(
    "/{book_id}/save-as-template",
    response_model=WordTemplateRead,
    status_code=status.HTTP_201_CREATED,
)
def save_book_as_template(
    book_id: int,
    payload: SaveAsTemplateRequest,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("books.manage"))],
) -> WordTemplateRead:
    """Copy a finished General Book into the shared template library
    (retokenized + validated; content becomes visible to all books.manage users)."""
    info = book_template_service.save_book_as_template(db, book_id=book_id, name=payload.name)
    return WordTemplateRead(name=info.name, modified_at=info.modified_at)
```

Also pass the new field through `create_word_session` (~123): add `template_name=payload.template_name,` to the `create_word_book(...)` call — the service accepts it in Task 8; to keep this task independently green, add the parameter to `create_word_book` now as `template_name: str | None = None` (unused), and implement its behavior in Task 8.

- [ ] **Step 4: Run to verify they pass**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_word_book_routes.py -v`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/schemas/book.py backend/app/api/v1/books.py backend/app/services/word_book_service.py backend/tests/test_word_book_routes.py
git commit -m "feat(book-templates): list + save-as-template routes"
```

---

### Task 8: Create-from-template in `create_word_book`

**Files:**
- Modify: `backend/app/services/word_book_service.py` (template resolution ~95–103; fill ~172)
- Test: `backend/tests/test_word_book_service.py`

**Interfaces:**
- Consumes: Task 4's `fill_general_book_path`, Task 6's `resolve_template_path`.
- Produces: `create_word_book(..., template_name: str | None = None)` — when set, the working docx is the library template rendered with fresh ref/date/G; 409 `TEMPLATE_MISSING` when the file is gone.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_word_book_service.py`:

```python
def test_create_from_template_seeds_boilerplate(db_session, admin_user, tmp_path, monkeypatch):
    from app.services import book_template_service as tpl_svc

    monkeypatch.setattr(tpl_svc, "templates_dir", lambda: tmp_path)
    # Build a tokenized library template directly (retokenize is Task 5-tested)
    from docx import Document as Docx

    src = tmp_path / "src.docx"
    d = Docx()
    d.add_paragraph("التاريخ: 01/01/2026")
    d.add_paragraph("نص جاهز من القالب")
    d.save(str(src))
    from app.core.book_template_retokenize import retokenize_general_book

    retokenize_general_book(src)
    src.rename(tmp_path / "قالب.docx")

    info = word_book_service.create_word_book(
        db_session,
        user=admin_user,
        classification_code="1/5",
        recipient_id=None,
        subject="من قالب",
        cc=[],
        manager_id=None,
        template_name="قالب.docx",
    )
    from app.db.models import BookEditSession

    session = db_session.query(BookEditSession).filter_by(book_id=info.book_id).one()
    text = docx_to_text(Path(session.working_path))
    assert "نص جاهز من القالب" in text            # boilerplate preserved
    assert f"الرقم: {info.ref_number}" in text     # fresh ref rendered


def test_create_from_missing_template_409(db_session, admin_user, tmp_path, monkeypatch):
    from app.services import book_template_service as tpl_svc

    monkeypatch.setattr(tpl_svc, "templates_dir", lambda: tmp_path)
    with pytest.raises(AppError) as ei:
        word_book_service.create_word_book(
            db_session,
            user=admin_user,
            classification_code="1/5",
            recipient_id=None,
            subject="x",
            cc=[],
            manager_id=None,
            template_name="غير موجود.docx",
        )
    assert ei.value.code == "TEMPLATE_MISSING"
    assert ei.value.http_status == 409
```

- [ ] **Step 2: Run to verify they fail**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_word_book_service.py -v -k template`
Expected: FAIL — `template_name` accepted (Task 7 stub) but ignored, so the boilerplate text is missing / no 409.

- [ ] **Step 3: Implement**

In `create_word_book`, after the classification validation (~94) resolve the template:

```python
    library_template: Path | None = None
    if template_name is not None:
        from app.services import book_template_service

        library_template = book_template_service.resolve_template_path(template_name)
```

Replace the fill call (~172):

```python
    engine = DocxEngine(settings.templates_dir)
    if library_template is not None:
        try:
            engine.fill_general_book_path(library_template, data, output_path, sandboxed=True)
        except FileNotFoundError:
            raise AppError(
                "TEMPLATE_MISSING",
                f"Template {template_name!r} is not in the library",
                http_status=409,
            ) from None
    else:
        engine.fill(_TEMPLATE_ID, data, output_path)
```

(The existing `TEMPLATE_MISSING` check for the canonical file at ~97–103 stays as-is; note the ref allocation at ~104 happens after resolution, so a missing library file must be detected by the *fill* — the `FileNotFoundError` catch above — not a pre-check, to avoid TOCTOU. `_postprocess_general_book_footer` + Aztec stamp lines below stay untouched.)

- [ ] **Step 4: Run the word-book suites**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_word_book_service.py backend/tests/test_word_book_routes.py -v`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/word_book_service.py backend/tests/test_word_book_service.py
git commit -m "feat(book-templates): create Word book from a library template"
```

---

### Task 9: One-time import script for the 8 Desktop files

**Files:**
- Create: `backend/scripts/import_book_templates.py`

**Interfaces:**
- Consumes: Task 5 helper, Task 6 `templates_dir`/`safe_template_name`.
- Produces: library populated from `%USERPROFILE%\Desktop\book template`; per-file OK/SKIP/FAIL report. No test file — the script IS a validation harness (every import runs `validate_book_template`), and it's run-once tooling.

- [ ] **Step 1: Write the script**

```python
"""One-time import: Desktop 'book template' docx files → the shared library.

Each file goes through the SAME retokenize + fail-closed validation as
save-as-template (so the hand-made legacy files can't land broken). Existing
library names are skipped, never overwritten. Run manually:

    venv\\Scripts\\python.exe backend/scripts/import_book_templates.py
"""

import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.book_template_retokenize import (  # noqa: E402
    retokenize_general_book,
    validate_book_template,
)
from app.services.book_template_service import (  # noqa: E402
    safe_template_name,
    templates_dir,
)

SOURCE = Path.home() / "Desktop" / "book template"


def main() -> int:
    failures = 0
    for src in sorted(SOURCE.glob("*.docx")):
        name = safe_template_name(src.stem)
        dest = templates_dir() / name
        if dest.exists():
            print(f"SKIP  {name} (already in library)")
            continue
        tmp = dest.with_suffix(".tmp")
        try:
            shutil.copy2(src, tmp)
            retokenize_general_book(tmp, submitter_g=None)
            validate_book_template(tmp)
            tmp.rename(dest)
            print(f"OK    {name}")
        except Exception as exc:
            failures += 1
            print(f"FAIL  {name}: {exc}")
        finally:
            tmp.unlink(missing_ok=True)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 2: Run it against the real Desktop folder**

Run: `venv\Scripts\python.exe backend/scripts/import_book_templates.py`
Expected: 8 lines, ideally all `OK`. For any `FAIL`, inspect that file's structure (its ref/date lines may deviate) and report it in the task summary — do NOT weaken validation to force it through; a failed legacy file is imported by hand later or its label lines fixed in Word first.

- [ ] **Step 3: Spot-check one imported template renders correctly**

Run:

```bash
venv\Scripts\python.exe -c "
from pathlib import Path
from app.services.book_template_service import templates_dir
from app.core.docx_render import render
from app.core.book_text import docx_to_text
import tempfile, sys
sys.path.insert(0, 'backend')
t = next(templates_dir().glob('*.docx'))
out = Path(tempfile.mkdtemp()) / 'x.docx'
render(t, {'ref': '1/5/GSSG/900', 'date': '19-07-2026', 'submitter_g': 'G-1'}, out, sandboxed=True)
print(docx_to_text(out)[:400])
"
```

Expected: output starts with `الرقم: 1/5/GSSG/900` then `التاريخ: 19-07-2026` then the boilerplate body. (Run from `backend/` or adjust `sys.path` accordingly.)

- [ ] **Step 4: Commit**

```bash
git add backend/scripts/import_book_templates.py
git commit -m "feat(book-templates): one-time Desktop library import script"
```

---

### Task 10: Resync generated API types

**Files:**
- Modify: `frontend/src/lib/api.types.ts` (generated)

- [ ] **Step 1: Invoke the `/sync-api-types` skill** (dump openapi → `pnpm gen:api` → typecheck). If unavailable in this session, the equivalent manual chain is documented in the skill — do not hand-edit `api.types.ts`.

- [ ] **Step 2: Verify the new schemas exist**

Run: `venv\Scripts\python.exe - <<check>` (or grep): `WordTemplateRead`, `SaveAsTemplateRequest`, and `template_name` must appear in `frontend/src/lib/api.types.ts`.
Run: `pnpm -C frontend exec tsc -b --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/api.types.ts
git commit -m "chore(api-types): resync for word-template endpoints"
```

---

### Task 11: Frontend — template picker in the create flow

**Files:**
- Modify: `frontend/src/lib/api.ts` (~1220, word-session block)
- Modify: `frontend/src/components/application/TemplateForm.tsx` (picker under the body-mode toggle ~434–454; hide recipient/CC/manager when a template is chosen)
- Modify: `frontend/src/pages/application/ApplicationPage.tsx` (state + submit payload ~469–481)
- Modify: `frontend/src/locales/en.json`, `frontend/src/locales/ar.json`
- Test: `frontend/src/components/application/TemplateForm.bodyMode.test.tsx`

**Interfaces:**
- Consumes: Task 10 types.
- Produces:
  - `api.listWordTemplates(): Promise<WordTemplateRead[]>`
  - TemplateForm props: `templateName?: string | null`, `onTemplateNameChange?: (v: string | null) => void`
  - `WordBookCreate` payloads include `template_name`.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/components/application/TemplateForm.bodyMode.test.tsx` (follow its existing render/props harness; mock `api.listWordTemplates`):

```tsx
it('shows the template picker in word mode with a none default', async () => {
  vi.mocked(api.listWordTemplates).mockResolvedValue([
    { name: 'الصيانة.docx', modified_at: '2026-07-19T00:00:00' },
  ])
  renderForm({ bodyMode: 'word' })
  expect(await screen.findByLabelText('بدون قالب', { exact: false })).toBeInTheDocument()
})

it('hides recipient/cc/manager fields when a template is selected', async () => {
  vi.mocked(api.listWordTemplates).mockResolvedValue([
    { name: 'الصيانة.docx', modified_at: '2026-07-19T00:00:00' },
  ])
  renderForm({ bodyMode: 'word', templateName: 'الصيانة.docx' })
  expect(screen.queryByText(/المرسل إليه|recipient/i)).not.toBeInTheDocument()
})
```

(Adapt `renderForm` + label queries to the file's existing helpers and i18n setup — the test file already renders TemplateForm with General Book props; assert with the ARABIC strings under `lng=ar` per the i18n lesson.)

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm -C frontend exec vitest run src/components/application/TemplateForm.bodyMode.test.tsx`
Expected: FAIL — no picker rendered / no `templateName` prop.

- [ ] **Step 3: Implement**

`frontend/src/lib/api.ts` — in the word-session block (~1220):

```ts
  /** GET /books/word-templates — shared General Book boilerplate library. */
  listWordTemplates: () =>
    request<components['schemas']['WordTemplateRead'][]>('GET', '/books/word-templates'),
```

`TemplateForm.tsx` — add the two props; directly under the body-mode toggle block (~454) render, only when `wordMode`:

```tsx
      {wordMode && onTemplateNameChange && (
        <div className="mb-3">
          <label className="mb-1 block text-[0.78em] font-medium text-muted-foreground">
            {t('books.word.templatePicker')}
          </label>
          <select
            value={templateName ?? ''}
            onChange={(e) => onTemplateNameChange(e.target.value || null)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[0.85em]"
            aria-label={t('books.word.templatePicker')}
          >
            <option value="">{t('books.word.templateNone')}</option>
            {(wordTemplatesQuery.data ?? []).map((tpl) => (
              <option key={tpl.name} value={tpl.name}>
                {tpl.name.replace(/\.docx$/i, '')}
              </option>
            ))}
          </select>
        </div>
      )}
```

with the query near the component's other hooks:

```tsx
  const wordTemplatesQuery = useQuery({
    queryKey: ['word-templates'],
    queryFn: api.listWordTemplates,
    enabled: !!wordMode,
  })
```

Hide the baked fields: find where TemplateForm renders the General Book recipient / CC / manager inputs and gate each with `!(wordMode && templateName) &&` (they are baked into the boilerplate and would silently do nothing).

`ApplicationPage.tsx` — add `const [templateName, setTemplateName] = useState<string | null>(null)`, pass both props to TemplateForm, reset it when leaving word mode, and include `template_name: templateName ?? undefined` in the `createWordBook` payload (~469–481).

Locale keys — `en.json`:

```json
"templatePicker": "Template",
"templateNone": "No template"
```

`ar.json`:

```json
"templatePicker": "القالب",
"templateNone": "بدون قالب"
```

(inside the existing `books.word` object in both files.)

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm -C frontend exec vitest run src/components/application/TemplateForm.bodyMode.test.tsx`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/components/application/TemplateForm.tsx frontend/src/pages/application/ApplicationPage.tsx frontend/src/locales/en.json frontend/src/locales/ar.json frontend/src/components/application/TemplateForm.bodyMode.test.tsx
git commit -m "feat(book-templates): word-mode template picker in the create flow"
```

---

### Task 12: Frontend — "حفظ كقالب" on finished books

**Files:**
- Modify: `frontend/src/lib/api.ts` (next to `listWordTemplates`)
- Modify: `frontend/src/components/books/BookWordActions.tsx`
- Modify: `frontend/src/locales/en.json`, `frontend/src/locales/ar.json`
- Test: `frontend/src/components/books/BookWordActions.test.tsx` (create if absent, following a sibling component test's harness)

**Interfaces:**
- Consumes: Task 10 types.
- Produces: `api.saveBookAsTemplate(bookId: number, name: string)`; a save-as-template button + name dialog on finished General Books (desktop `RecordPane` and mobile `BookRecordPage` both mount `BookWordActions`, so ONE edit covers both surfaces).

- [ ] **Step 1: Write the failing test**

```tsx
it('saves a finished book as a template with the subject as default name', async () => {
  vi.mocked(api.saveBookAsTemplate).mockResolvedValue({
    name: 'قالب.docx',
    modified_at: '2026-07-19T00:00:00',
  })
  render(<BookWordActions book={finishedBook} />)   // finishedBook: versions.length > 0, no active session
  await user.click(screen.getByRole('button', { name: 'حفظ كقالب' }))
  const input = await screen.findByRole('textbox')
  expect(input).toHaveValue(finishedBook.subject)
  await user.click(screen.getByRole('button', { name: /حفظ|save/i }))
  expect(api.saveBookAsTemplate).toHaveBeenCalledWith(finishedBook.id, finishedBook.subject)
})
```

(Assert Arabic labels under `lng=ar` per the i18n setup of sibling tests.)

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -C frontend exec vitest run src/components/books/BookWordActions.test.tsx`
Expected: FAIL — button not found.

- [ ] **Step 3: Implement**

`api.ts`:

```ts
  /** POST /books/{id}/save-as-template — copy a finished book into the shared template library. */
  saveBookAsTemplate: (bookId: number, name: string) =>
    request<components['schemas']['WordTemplateRead']>(
      'POST', `/books/${bookId}/save-as-template`, { name },
    ),
```

`BookWordActions.tsx` — add state + mutation + button in the `isFinished` block (after the re-open button), plus a small name dialog. Reuse the project's dialog primitives (`ConfirmDialog` has no input — use the underlying `Dialog` components the way `ConfirmDialog` itself does):

```tsx
  const [saveTplOpen, setSaveTplOpen] = useState(false)
  const [tplName, setTplName] = useState('')

  const saveTemplateMutation = useMutation({
    mutationFn: () => api.saveBookAsTemplate(book.id, tplName.trim()),
    onSuccess: (tpl) => {
      setSaveTplOpen(false)
      toast.success(t('books.word.savedAsTemplate', { name: tpl.name.replace(/\.docx$/i, '') }))
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  })
```

Button (inside `{isFinished && (...)}`, sibling of the re-open button — NOT disabled on mobile; saving needs no Word):

```tsx
          <button
            type="button"
            disabled={saveTemplateMutation.isPending}
            onClick={() => { setTplName(book.subject ?? ''); setSaveTplOpen(true) }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-hairline px-3 py-2 text-[0.82em] font-semibold text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            {t('books.word.saveAsTemplate')}
          </button>
```

Dialog (next to the existing `ConfirmDialog`): title `t('books.word.saveAsTemplate')`, body text `t('books.word.saveAsTemplateHint')` (states the shared-library semantics), a text input bound to `tplName`, confirm calls `saveTemplateMutation.mutate()` (disabled while pending or `!tplName.trim()`).

Locale keys — `en.json` `books.word`:

```json
"saveAsTemplate": "Save as template",
"saveAsTemplateHint": "The book's content becomes a shared template every book manager can use.",
"savedAsTemplate": "Saved to the template library: {{name}}"
```

`ar.json` `books.word`:

```json
"saveAsTemplate": "حفظ كقالب",
"saveAsTemplateHint": "سيصبح محتوى الكتاب قالباً مشتركاً متاحاً لجميع مديري الكتب.",
"savedAsTemplate": "تم الحفظ في مكتبة القوالب: {{name}}"
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm -C frontend exec vitest run src/components/books/BookWordActions.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/components/books/BookWordActions.tsx frontend/src/locales/en.json frontend/src/locales/ar.json frontend/src/components/books/BookWordActions.test.tsx
git commit -m "feat(book-templates): save-as-template action on finished books (both surfaces)"
```

---

### Task 13: Frontend — targeted bidi cleanup

**Files:**
- Modify: `frontend/src/pages/books/RecordsList.tsx:134`, `frontend/src/pages/books/BooksPage.tsx:832`, `frontend/src/pages/books/RecordPane.tsx:145` and `:328`, `frontend/src/pages/books/WordHandoffDialog.tsx:193`

**Interfaces:**
- Consumes: `bidi()` from `@/lib/bidi` (existing).
- Produces: no functional change — classified refs and Latin names render direction-isolated in RTL layouts.

- [ ] **Step 1: Apply the five edits**

At each ref render (`RecordsList.tsx:134`, `BooksPage.tsx:832`, `RecordPane.tsx:145`) wrap the raw value:

```tsx
<bdi dir="ltr">{row.ref_number}</bdi>
```

(keep surrounding classNames — move them to the parent span if the raw text node was bare; `book.ref_number` at `RecordPane.tsx:145` likewise).

`RecordPane.tsx:328` — isolate the interpolation:

```tsx
{t('books.pane.signedCopyBody', { ref: bidi(book.ref_number) })}
```

`WordHandoffDialog.tsx:193` — isolate the name:

```tsx
<> · {t('books.word.preparedBy')}: <bdi dir="ltr">{bookQuery.data.submitted_by_name}</bdi></>
```

Add the `bidi` import where missing.

- [ ] **Step 2: Verify nothing broke**

Run: `pnpm -C frontend exec vitest run src/pages/books/ && pnpm -C frontend exec tsc -b --noEmit`
Expected: existing books tests + typecheck PASS. (Pure markup isolation — no new test; the existing snapshot/text assertions catch regressions since `<bdi>` doesn't change text content.)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/books/
git commit -m "fix(books): bidi-isolate classified refs and Latin names in RTL surfaces"
```

---

### Task 14: Full verification + reviewer agents

**Files:** none (verification only)

- [ ] **Step 1: Full gates**

```bash
venv\Scripts\python.exe -m pytest
venv\Scripts\ruff.exe check . && venv\Scripts\ruff.exe format --check .
venv\Scripts\mypy.exe
pnpm -C frontend test
pnpm -C frontend run lint
pnpm -C frontend exec tsc -b --noEmit
```

Expected: all clean (note the known mypy/eslint baseline drift on main — new errors only are blockers).

- [ ] **Step 2: Template-churn check**

Run: `git status --short backend/templates/`
Expected: empty (Task 1's file was already committed; any NEW churn from the live service gets reverted: `git checkout -- backend/templates/<file>`).

- [ ] **Step 3: Dispatch the `i18n-rtl-reviewer` agent** over the branch diff (locales, TemplateForm, BookWordActions, bidi cleanup, the Arabic strings in backend errors). Address must-fix findings before merge.

- [ ] **Step 4: Finish the branch** — use the superpowers:finishing-a-development-branch skill (merge to `main`, push `origin/main` — this checkout is live production; unpushed fixes get overwritten by `mng update`). Deployment (`mng deploy`) + running the import script on the server stay with the operator unless instructed.
