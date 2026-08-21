# Report Template Restyle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Regenerate the Report (تقرير) Word template so the doc that opens in Word matches the reference letter `C:\Users\Admin\Desktop\book template\تقارير شاملة.docx`, and render the date as DD/MM/YYYY.

**Architecture:** The template `backend/templates/GSSG-GS_300-004_Report.docx` is a build artifact of `backend/scripts/build_report_template.py`. We rewrite that script to take the General Book template (source of the GSSG paper: headers, footers incl. the `{{ submitter_g }}` token, styles) and replace its entire `document.xml` body with reference-derived paragraph XML carrying the same Jinja tokens. One service-layer change formats the date for display. Spec: `docs/superpowers/specs/2026-07-24-report-template-restyle-design.md`.

**Tech Stack:** Python 3.12, zipfile (template build), python-docx (tests), docxtpl (render path, unchanged), pytest.

## Global Constraints

- **This checkout is the live production build.** Do all work in a git worktree (`superpowers:using-git-worktrees`), branch `feature/report-template-restyle`. Never branch-switch `C:\Users\Admin\sentinel` itself.
- Python runs via the main checkout's venv by absolute path: `C:\Users\Admin\sentinel\venv\Scripts\python.exe` (worktrees have no venv). Run all commands from the **worktree root**.
- Gates are strict: `mypy` is strict, pytest runs with `filterwarnings=error`, ruff check + format must pass.
- Every Jinja tag in template XML must live entirely inside ONE `<w:t>` element (docxtpl breaks on split tags).
- Do NOT touch headers/footers/styles of the paper — only `document.xml` body content between `<w:body>` and the body-level `<w:sectPr>` changes.
- Do NOT commit churn in other `backend/templates/*.docx` files (the live service re-saves them; `git status` in the worktree should only show the Report template + code).
- The body anchor paragraph must keep a `{{ body }}` token in a single paragraph — `_find_general_book_body_anchor` locates it by sentinel substring and clears run text only, so the paragraph's formatting is what the author types in.

---

### Task 1: Rewrite `build_report_template.py` and regenerate the template

**Files:**
- Modify: `backend/scripts/build_report_template.py` (full rewrite)
- Regenerate: `backend/templates/GSSG-GS_300-004_Report.docx` (build artifact — commit it)
- Test: `backend/tests/test_report_template_layout.py` (new)

**Interfaces:**
- Consumes: `backend/templates/GSSG-GS_300-003_General_Book.docx` (the paper source; must contain `<w:body>` and a body-level `<w:sectPr>` in `word/document.xml`).
- Produces: the regenerated template with tokens `{{ date }}`, `{{ recipient_name }}`, `{{ subject }}` (inside a Jinja conditional), `{{ body }}`, `{{ manager_name }}`, `{{ manager_title }}`, `{{ manager_sig }}`. Task 2's date change and the unchanged `create_report_word_book` data dict rely on exactly these token names. No `cc` token remains.

- [ ] **Step 1: Write the failing layout test**

Create `backend/tests/test_report_template_layout.py`:

```python
"""Layout contract for the generated Report template.

The template is a build artifact of backend/scripts/build_report_template.py;
its body must mirror the operator's reference letter (تقارير شاملة.docx,
2026-07-24): letter top block, bold 16pt justified body anchor, centered
closing, 18pt kashida signature block, no CC block.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Pt

TEMPLATE = Path(__file__).resolve().parents[1] / "templates" / "GSSG-GS_300-004_Report.docx"

NAME_LABEL = "الإس" + "ـ" * 75 + "م : "
SIGN_LABEL = "التوقي" + "ـ" * 69 + "ع:"


@pytest.fixture(scope="module")
def paras():
    return list(Document(str(TEMPLATE)).paragraphs)


def _index(paras, needle: str) -> int:
    for i, p in enumerate(paras):
        if needle in p.text:
            return i
    raise AssertionError(f"paragraph containing {needle!r} not found")


def test_top_block(paras):
    i_date = _index(paras, "التاريخ: {{ date }}")
    i_addr = _index(paras, "المحترم")
    i_greet = _index(paras, "تحية طيبة وبعد ,,")
    i_subj = _index(paras, "الموضوع : ")
    assert i_date < i_addr < i_greet < i_subj
    # المحترم reaches the line end via a tab, not literal spaces
    assert "السيد {{ recipient_name }}\tالمحترم" in paras[i_addr].text
    assert paras[i_subj].alignment == WD_ALIGN_PARAGRAPH.CENTER


def test_body_anchor_bold_16pt_justified(paras):
    p = paras[_index(paras, "{{ body }}")]
    assert p.alignment == WD_ALIGN_PARAGRAPH.JUSTIFY
    (run,) = [r for r in p.runs if "{{ body }}" in r.text]
    assert run.bold is True
    assert run.font.size == Pt(16)


def test_closing_block(paras):
    i_action = _index(paras, "للتفضل بالعلم وإجراءاتكم لطفاً،،،")
    i_close = _index(paras, "وتفضلوا بقبول فائق الإحترام والتقدير ,,,")
    i_name = _index(paras, "{{ manager_name }}")
    assert paras[i_action].alignment == WD_ALIGN_PARAGRAPH.JUSTIFY
    assert paras[i_close].alignment == WD_ALIGN_PARAGRAPH.CENTER
    assert all(not paras[j].text.strip() for j in range(i_action + 1, i_close))
    assert i_close - i_action - 1 == 7  # blanks pushing the closing down
    assert i_name - i_close - 1 == 9  # blanks above the signature block


def test_signature_block(paras):
    i_name = _index(paras, "{{ manager_name }}")
    i_title = _index(paras, "{{ manager_title }}")
    i_sig = _index(paras, "{{ manager_sig }}")
    assert i_name + 1 == i_title
    assert i_title + 1 == i_sig
    assert NAME_LABEL + "{{ manager_name }}" in paras[i_name].text
    assert "المسمى الوظيفي : {{ manager_title }}" in paras[i_title].text
    assert SIGN_LABEL in paras[i_sig].text
    assert paras[i_sig].paragraph_format.left_indent.twips == 4680
    label_run = next(r for r in paras[i_name].runs if "الإس" in r.text)
    assert label_run.font.size == Pt(18)


def test_no_cc_block(paras):
    text = "\n".join(p.text for p in paras)
    assert "نسخة إلى" not in text
    assert "{%p" not in text
    assert "cc" not in text
```

- [ ] **Step 2: Run the test to verify it fails against the current template**

Run (from worktree root):
```
C:\Users\Admin\sentinel\venv\Scripts\python.exe -m pytest backend/tests/test_report_template_layout.py -v
```
Expected: FAIL — `test_top_block` (no `التاريخ: {{ date }}` + tab line), `test_closing_block` (no blank runs), `test_signature_block` (no kashida labels), `test_no_cc_block` (cc block present).

- [ ] **Step 3: Rewrite the build script**

Replace the entire contents of `backend/scripts/build_report_template.py` with:

```python
# backend/scripts/build_report_template.py
"""One-shot: build the Report template on the General Book paper.

The body mirrors the operator's reference letter (تقارير شاملة.docx,
2026-07-24): letter top block (date / addressee / greeting / centered
subject), a bold 16pt justified Word-authored body anchor, centered
closing, and an 18pt kashida signature block. Headers, footers (footer3
carries {{ submitter_g }}) and styles come from the General Book template
untouched.

Run once, then commit backend/templates/GSSG-GS_300-004_Report.docx:
    venv\\Scripts\\python.exe backend/scripts/build_report_template.py
"""

from __future__ import annotations

import zipfile
from pathlib import Path

SRC = Path("backend/templates/GSSG-GS_300-003_General_Book.docx")
DST = Path("backend/templates/GSSG-GS_300-004_Report.docx")

# --- run/paragraph properties (copied from the reference letter) ----------
# Plain 16pt (sz 32 half-points), Calibri for the Arabic (cs) script.
RPR32 = (
    '<w:rPr><w:rFonts w:eastAsia="Times New Roman" w:cs="Calibri"/>'
    '<w:sz w:val="32"/><w:szCs w:val="32"/><w:rtl/></w:rPr>'
)
RPR32CS = (
    '<w:rPr><w:rFonts w:eastAsia="Times New Roman" w:cs="Calibri" w:hint="cs"/>'
    '<w:sz w:val="32"/><w:szCs w:val="32"/><w:rtl/></w:rPr>'
)
# Bold 16pt — the body/closing weight in the reference.
RPR32B = (
    '<w:rPr><w:rFonts w:cstheme="minorHAnsi" w:hint="cs"/><w:b/><w:bCs/>'
    '<w:sz w:val="32"/><w:szCs w:val="32"/><w:rtl/></w:rPr>'
)
# 18pt — the signature block size in the reference.
RPR36 = (
    '<w:rPr><w:rFonts w:eastAsia="Times New Roman" w:cs="Calibri" w:hint="cs"/>'
    '<w:sz w:val="36"/><w:szCs w:val="36"/><w:rtl/></w:rPr>'
)
# The reference positions the signature block with a literal bold-italic
# 16pt run of spaces before the name label — copied verbatim.
RPR32BI = (
    '<w:rPr><w:rFonts w:cstheme="minorHAnsi" w:hint="cs"/><w:b/><w:bCs/>'
    '<w:i/><w:iCs/><w:sz w:val="32"/><w:szCs w:val="32"/><w:rtl/>'
    '<w:lang w:bidi="ar-AE"/></w:rPr>'
)

BLANK = "<w:p><w:pPr><w:bidi/>" + RPR32 + "</w:pPr></w:p>"
PPR_BODY = (
    '<w:pPr><w:bidi/><w:jc w:val="both"/>'
    '<w:rPr><w:rFonts w:cstheme="minorHAnsi"/><w:b/><w:bCs/>'
    '<w:sz w:val="32"/><w:szCs w:val="32"/><w:rtl/></w:rPr></w:pPr>'
)

NAME_LABEL = "الإس" + "ـ" * 75 + "م : "
SIGN_LABEL = "التوقي" + "ـ" * 69 + "ع:"

BODY = "".join(
    [
        # التاريخ: {{ date }}
        "<w:p><w:pPr><w:bidi/>" + RPR32 + "</w:pPr><w:r>" + RPR32CS
        + '<w:t xml:space="preserve">التاريخ: {{ date }}</w:t></w:r></w:p>',
        BLANK,
        # السيد {{ recipient_name }} <tab> المحترم — tab stop pushes المحترم
        # to the line's end whatever the recipient name length. NB: OOXML
        # pPr child order is fixed — tabs MUST precede bidi.
        '<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="8789"/></w:tabs><w:bidi/>'
        + RPR32 + "</w:pPr><w:r>" + RPR32CS
        + '<w:t xml:space="preserve">السيد {{ recipient_name }}</w:t></w:r>'
        + "<w:r>" + RPR32CS + '<w:tab/><w:t xml:space="preserve">المحترم </w:t></w:r></w:p>',
        BLANK,
        # تحية طيبة وبعد ,,  (reference punctuation kept verbatim)
        "<w:p><w:pPr><w:bidi/>" + RPR32 + "</w:pPr><w:r>" + RPR32CS
        + '<w:t xml:space="preserve">تحية طيبة وبعد ,,</w:t></w:r></w:p>',
        BLANK,
        # الموضوع — centered, hidden entirely when there is no subject.
        '<w:p><w:pPr><w:bidi/><w:jc w:val="center"/>' + RPR32 + "</w:pPr><w:r>"
        + RPR32CS
        + "<w:t xml:space=\"preserve\">{{ '' if not subject else 'الموضوع : ' ~ subject }}</w:t>"
        + "</w:r></w:p>",
        BLANK,
        BLANK,
        # {{ body }} anchor — bold 16pt justified; the paragraph-mark rPr
        # matches so typing at the cleared anchor inherits this format.
        "<w:p>" + PPR_BODY + "<w:r>" + RPR32B + "<w:t>{{ body }}</w:t></w:r></w:p>",
        BLANK,
        # للتفضل بالعلم وإجراءاتكم لطفاً،،،
        "<w:p>" + PPR_BODY + "<w:r>" + RPR32B
        + "<w:t>للتفضل بالعلم وإجراءاتكم لطفاً،،،</w:t></w:r></w:p>",
        BLANK * 7,
        # وتفضلوا بقبول فائق الإحترام والتقدير ,,, — centered bold
        '<w:p><w:pPr><w:bidi/><w:jc w:val="center"/>'
        '<w:rPr><w:rFonts w:cstheme="minorHAnsi"/><w:b/><w:bCs/>'
        '<w:sz w:val="32"/><w:szCs w:val="32"/><w:rtl/></w:rPr></w:pPr>'
        "<w:r>" + RPR32B
        + "<w:t>وتفضلوا بقبول فائق الإحترام والتقدير ,,,</w:t></w:r></w:p>",
        BLANK * 9,
        # Signature block — 18pt, positioned like the reference (literal
        # space runs + left indent copied verbatim).
        "<w:p><w:pPr><w:bidi/>" + RPR36 + "</w:pPr>"
        + "<w:r>" + RPR32BI + '<w:t xml:space="preserve">' + " " * 73 + "</w:t></w:r>"
        + "<w:r>" + RPR36 + '<w:t xml:space="preserve">'
        + NAME_LABEL + "{{ manager_name }}  </w:t></w:r></w:p>",
        '<w:p><w:pPr><w:bidi/><w:jc w:val="both"/>' + RPR36 + "</w:pPr>"
        + "<w:r>" + RPR36 + '<w:t xml:space="preserve">' + " " * 66 + "</w:t></w:r>"
        + "<w:r>" + RPR36 + '<w:t xml:space="preserve">'
        + "المسمى الوظيفي : {{ manager_title }} </w:t></w:r></w:p>",
        '<w:p><w:pPr><w:bidi/><w:ind w:left="4680"/>' + RPR36 + "</w:pPr>"
        + "<w:r>" + RPR36 + '<w:t xml:space="preserve">       '
        + SIGN_LABEL + " {{ manager_sig }}</w:t></w:r></w:p>",
        BLANK,
    ]
)


def main() -> None:
    with zipfile.ZipFile(SRC) as zin:
        entries = {name: zin.read(name) for name in zin.namelist()}
    xml = entries["word/document.xml"].decode("utf-8")
    head = xml[: xml.find("<w:body>") + len("<w:body>")]
    tail = xml[xml.rfind("<w:sectPr") :]  # body-level sectPr is the last one
    entries["word/document.xml"] = (head + BODY + tail).encode("utf-8")
    with zipfile.ZipFile(DST, "w", zipfile.ZIP_DEFLATED) as zout:
        for name, data in entries.items():
            zout.writestr(name, data)
    print(f"wrote {DST}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Regenerate the template**

Run (from worktree root):
```
C:\Users\Admin\sentinel\venv\Scripts\python.exe backend/scripts/build_report_template.py
```
Expected output: `wrote backend\templates\GSSG-GS_300-004_Report.docx`

- [ ] **Step 5: Run the layout test + the existing Report session tests**

Run:
```
C:\Users\Admin\sentinel\venv\Scripts\python.exe -m pytest backend/tests/test_report_template_layout.py backend/tests/test_word_report_session.py -v
```
Expected: ALL PASS. `test_word_report_session.py` exercises `create_report_word_book` → docxtpl render of the new template, so it catches malformed XML or split Jinja tags. If docxtpl raises a template syntax error, a Jinja tag got split or an XML attribute is malformed — inspect `word/document.xml` of the generated template.

- [ ] **Step 6: Lint + commit**

Run:
```
C:\Users\Admin\sentinel\venv\Scripts\ruff.exe check backend/scripts/build_report_template.py backend/tests/test_report_template_layout.py
C:\Users\Admin\sentinel\venv\Scripts\ruff.exe format backend/scripts/build_report_template.py backend/tests/test_report_template_layout.py
```
Then:
```bash
git add backend/scripts/build_report_template.py backend/templates/GSSG-GS_300-004_Report.docx backend/tests/test_report_template_layout.py
git commit -m "feat(report): restyle Word template to match the reference letter"
```

---

### Task 2: Render the Report date as DD/MM/YYYY

**Files:**
- Modify: `backend/app/services/word_book_service.py:275` (the `"date":` entry in `create_report_word_book`, plus a new module-level helper)
- Test: `backend/tests/test_word_report_session.py` (append two tests)

**Interfaces:**
- Consumes: `create_report_word_book(..., date: str | None, ...)` — the frontend sends ISO `YYYY-MM-DD` (from the form's `report_date`) or null.
- Produces: `_report_display_date(raw: str | None, now: datetime) -> str` in `word_book_service.py` — ISO in → `DD/MM/YYYY` out; `None` → `now` formatted `DD/MM/YYYY`; anything else passes through unchanged.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_word_report_session.py`:

```python
def test_report_display_date():
    from datetime import datetime

    from app.services.word_book_service import _report_display_date

    now = datetime(2026, 7, 24, 10, 0, 0)
    assert _report_display_date("2026-07-23", now) == "23/07/2026"
    assert _report_display_date(None, now) == "24/07/2026"
    # Already display-formatted → pass through untouched.
    assert _report_display_date("23/07/2026", now) == "23/07/2026"


def test_create_report_word_book_renders_display_date(db_session):
    from docx import Document as Docx

    from app.services import word_book_service

    _seed_gs(db_session)
    db_session.add(Employee(id="G1042", name_en="Muhannad", name_ar="مهند", position="Head"))
    op = _user(db_session, employee_id="G3082")
    db_session.commit()

    info = word_book_service.create_report_word_book(
        db_session,
        user=op,
        signer_employee_id="G1042",
        recipient_id=None,
        subject="تقرير",
        date="2026-07-23",
        sign=False,
    )
    sess = db_session.query(BookEditSession).filter_by(book_id=info.book_id).one()
    text = "\n".join(p.text for p in Docx(sess.working_path).paragraphs)
    assert "التاريخ: 23/07/2026" in text
    assert "2026-07-23" not in text
```

- [ ] **Step 2: Run them to verify the right failure**

Run:
```
C:\Users\Admin\sentinel\venv\Scripts\python.exe -m pytest backend/tests/test_word_report_session.py -v -k display_date
```
Expected: `test_report_display_date` FAILS with `ImportError: cannot import name '_report_display_date'`; the render test FAILS on the `التاريخ: 23/07/2026` assert (docx shows the raw ISO string).

- [ ] **Step 3: Implement**

In `backend/app/services/word_book_service.py`, add near the other private helpers (after `_resolve_recipient` is fine):

```python
def _report_display_date(raw: str | None, now: datetime) -> str:
    """Human date for the Report paper — DD/MM/YYYY like the reference letter."""
    if not raw:
        return now.strftime("%d/%m/%Y")
    try:
        return datetime.strptime(raw, "%Y-%m-%d").strftime("%d/%m/%Y")
    except ValueError:
        return raw  # already display-formatted — trust the caller
```

And in `create_report_word_book`, change the data dict entry:

```python
        "date": _report_display_date(date, now),
```

(replacing `"date": date or now.strftime("%d-%m-%Y"),`).

- [ ] **Step 4: Run the tests**

Run:
```
C:\Users\Admin\sentinel\venv\Scripts\python.exe -m pytest backend/tests/test_word_report_session.py -v
```
Expected: ALL PASS.

- [ ] **Step 5: Typecheck, lint, commit**

Run:
```
C:\Users\Admin\sentinel\venv\Scripts\mypy.exe
C:\Users\Admin\sentinel\venv\Scripts\ruff.exe check .
```
Expected: clean (baseline drift on `main`, if any, is pre-existing — only new errors block).
Then:
```bash
git add backend/app/services/word_book_service.py backend/tests/test_word_report_session.py
git commit -m "fix(report): render the paper date as DD/MM/YYYY"
```

---

### Task 3: Full gates + visual sample for user approval

**Files:**
- Create: `C:\Users\Admin\AppData\Local\Temp\claude\C--Users-Admin-sentinel\f422411b-2b09-43fe-b907-63d1785c4881\scratchpad\render_report_sample.py` (throwaway — NOT committed)

**Interfaces:**
- Consumes: the regenerated template (Task 1) and `_report_display_date` behavior (Task 2). Sample data keys mirror what `create_report_word_book` builds: `date`, `subject`, `body` (sentinel), `body_html`, `recipient_name`, `cc`, `submitter_g`, `manager_name`, `manager_title`, `manager_sig`.
- Produces: `report-sample.docx` for the user to open next to the reference. No code artifacts.

- [ ] **Step 1: Run the full backend suite**

Run:
```
C:\Users\Admin\sentinel\venv\Scripts\python.exe -m pytest
```
Expected: all pass (no regressions outside Report).

- [ ] **Step 2: Render a sample working docx (what Word opens)**

Write to the session scratchpad (not the repo) `render_report_sample.py`:

```python
"""Visual QA: render the Report working docx exactly as Word opens it."""

from pathlib import Path

WORKTREE = Path(".")  # run from the worktree root


def main() -> None:
    import sys

    sys.path.insert(0, str(WORKTREE / "backend"))
    from app.core.docx_engine import DocxEngine
    from app.services.document_service import GENERAL_BOOK_BODY_SENTINEL
    from app.services.word_book_service import _postprocess_general_book_footer

    out = Path("report-sample.docx").resolve()
    data = {
        "date": "22/07/2026",
        "subject": "النزيل محمد سعيد أحمد الجنسية الإمارات رقم الهوية (497110)",
        "body": GENERAL_BOOK_BODY_SENTINEL,
        "body_html": "",  # empty → anchor cleared, like a fresh Report
        "recipient_name": "مدير مركز الإصلاح والتأهيل الوثبة -2",
        "cc": "",
        "submitter_g": "G3082",
        "manager_name": "مهند عبدالرحمن أل علي",
        "manager_title": "مسؤول وحدة الإرساليات",
        "manager_sig": "",
    }
    DocxEngine(WORKTREE / "backend" / "templates").fill("Report", data, out)
    _postprocess_general_book_footer(out)
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
```

Run it from the worktree root:
```
C:\Users\Admin\sentinel\venv\Scripts\python.exe C:\Users\Admin\AppData\Local\Temp\claude\C--Users-Admin-sentinel\f422411b-2b09-43fe-b907-63d1785c4881\scratchpad\render_report_sample.py
```
Expected: `wrote ...report-sample.docx`. If `DocxEngine.fill` needs settings it can't find, fall back to generating via the test path: run `test_create_report_word_book` with `--pdb`-free tmp dir and copy `sess.working_path` out — but the direct fill should work (it only needs the templates dir argument).

- [ ] **Step 3: Send the sample to the user for side-by-side approval**

Use SendUserFile with `report-sample.docx`, asking the user to open it in Word next to `C:\Users\Admin\Desktop\book template\تقارير شاملة.docx` and confirm:
1. Overall letter layout matches (spacing, sizes, bold body).
2. "المحترم" lands at the line's end — if it sits short of / past the margin, nudge the tab stop `w:pos="8789"` in the build script (bigger = further left), re-run Steps 4–5 of Task 1.
3. The signature block sits where the reference puts it.

STOP and wait for user approval before Task 4. Apply any nudges as amendments to the Task 1 commit flow (edit script → rebuild → tests → `git add` → `git commit -m "fix(report): nudge template layout after visual QA"`).

---

### Task 4: Merge

- [ ] **Step 1: Finish the branch**

Use the `superpowers:finishing-a-development-branch` skill: merge `feature/report-template-restyle` into local `main` (the user decides push/deploy — per repo memory, main must be pushed to origin before any `mng update`, but pushing is the user's call to make explicitly).

---

## Round 2 (operator visual QA, 2026-07-27)

Execution order becomes: Task 5 → Task 6 → Task 7 → Task 8 (visual gate) → Task 4 (final review + merge) last. Spec section "Round 2" in the design doc governs.

### Task 5: Template round 2 — Sakkal Majalla + operator's punctuation/bold edits

**Files:**
- Modify: `backend/scripts/build_report_template.py`
- Regenerate: `backend/templates/GSSG-GS_300-004_Report.docx`
- Modify: `backend/tests/test_report_template_layout.py`
- Modify: `backend/tests/test_report_render.py` (one assert: closing spelling)

**Interfaces:**
- Produces: same Jinja tokens as before; only run fonts/text change. Task 6/8 rely on the التوقيـــع label line and the blank paragraph after it remaining in place (unchanged here).

- [ ] **Step 1: Update the failing tests first**

In `backend/tests/test_report_template_layout.py`:
- `test_top_block`: greeting needle becomes `"تحية طيبة وبعد ،،"` (Arabic commas).
- `test_closing_block`: needles become `"للتفضل بالعلم وإجراءاتكم لطفاً،،"` and `"وتفضلوا بقبول فائق الاحترام والتقدير"` (no trailing marks, الاحترام spelling).
- `test_body_anchor_bold_16pt_justified`: add `assert run.font.name == "Sakkal Majalla"` after the size assert.
- Add to `test_closing_block` (after the alignment asserts):
```python
    (action_run,) = [r for r in paras[i_action].runs if r.text.strip()]
    assert action_run.bold is not True  # user-unbolded in round 2
    (close_run,) = [r for r in paras[i_close].runs if r.text.strip()]
    assert close_run.bold is not True
```
In `backend/tests/test_report_render.py`: the closing assert becomes `assert "وتفضلوا بقبول فائق الاحترام والتقدير" in text`.

- [ ] **Step 2: Run to verify failures**

Run: `C:\Users\Admin\sentinel\venv\Scripts\python.exe -m pytest backend/tests/test_report_template_layout.py backend/tests/test_report_render.py -v --basetemp=<scratch>`
Expected: top_block, closing_block, body_anchor, and render tokens tests FAIL against the current template.

- [ ] **Step 3: Update the build script**

In `backend/scripts/build_report_template.py`:

Replace the five rPr constants (RPR32, RPR32CS, RPR32B, RPR36, RPR32BI) and PPR_BODY so every `<w:rFonts .../>` reads exactly `<w:rFonts w:ascii="Sakkal Majalla" w:hAnsi="Sakkal Majalla" w:cs="Sakkal Majalla"/>` (keep `w:hint="cs"` where it exists today; keep all size/b/bCs/i/iCs/rtl/lang elements as they are). Update the constants' comments to say Sakkal Majalla.

Text/bold edits in the BODY list:
1. Greeting paragraph text: `تحية طيبة وبعد ,,` → `تحية طيبة وبعد ،،`
2. للتفضل paragraph — un-bold: replace its `"<w:p>" + PPR_BODY + "<w:r>" + RPR32B + "<w:t>للتفضل بالعلم وإجراءاتكم لطفاً،،،</w:t></w:r></w:p>"` entry with:
```python
        # للتفضل … — plain (operator un-bolded in round 2), Arabic commas
        '<w:p><w:pPr><w:bidi/><w:jc w:val="both"/>' + RPR32 + "</w:pPr><w:r>"
        + RPR32CS + "<w:t>للتفضل بالعلم وإجراءاتكم لطفاً،،</w:t></w:r></w:p>",
```
3. وتفضلوا paragraph — un-bold, drop trailing marks, الاحترام spelling: replace its entry with:
```python
        # وتفضلوا … — centered, plain (operator un-bolded in round 2)
        '<w:p><w:pPr><w:bidi/><w:jc w:val="center"/>' + RPR32 + "</w:pPr><w:r>"
        + RPR32CS + "<w:t>وتفضلوا بقبول فائق الاحترام والتقدير</w:t></w:r></w:p>",
```
4. The `{{ body }}` anchor keeps PPR_BODY + RPR32B (bold 16pt stays — user confirmed).

- [ ] **Step 4: Regenerate + run tests**

Run the build script, then: `... -m pytest backend/tests/test_report_template_layout.py backend/tests/test_report_render.py backend/tests/test_word_report_session.py -v --basetemp=<scratch>` → ALL PASS. Ruff both changed .py files.

- [ ] **Step 5: Commit**

```bash
git add backend/scripts/build_report_template.py backend/templates/GSSG-GS_300-004_Report.docx backend/tests/test_report_template_layout.py backend/tests/test_report_render.py
git commit -m "feat(report): Sakkal Majalla + operator punctuation/bold edits (round 2)"
```

### Task 6: Stamp signature under التوقيع + signing date (Report only)

**Files:**
- Modify: `backend/app/core/docx_engine.py` (`stamp_signature_above_name` + a module constant)
- Modify: `backend/app/services/document_service.py` (`_sign_authored_docx` call site, ~line 1835)
- Test: `backend/tests/test_stamp_signature.py` (extend — follow its existing docx-fixture patterns)

**Interfaces:**
- Consumes: `_norm_name` (strips tatweel/whitespace: "التوقيـــع:" → "التوقيع:"), `fill_image_behind_text_in_paragraph` (float rests on the anchor's line and rises UP).
- Produces: `stamp_signature_above_name(..., date_below: str | None = None)` — new keyword-only param, default None (all existing callers unchanged).

- [ ] **Step 1: Failing tests** (in `test_stamp_signature.py`, using its existing helpers for building/stamping a docx and locating drawings):

1. `test_sig_label_anchors_below`: docx paragraphs `["الاسم : فلان", "المسمى الوظيفي : كذا", "التوقيـــــع:", ""]` → stamp with names=["فلان"] → the drawing lands in paragraph index 3 (below the label), NOT above the name.
2. `test_sig_label_beats_name_anchor`: same docx — even though the name matches paragraph 0, the التوقيع rule wins.
3. `test_date_below_written`: stamp with `date_below="27/07/2026"` → "27/07/2026" appears in the doc text (the anchor paragraph); run is RTL.
4. `test_date_below_none_writes_nothing`: default call → no date text anywhere.
5. `test_date_never_clobbers_text`: anchor paragraph already has text → date NOT written (text preserved), image still placed.
6. Existing name-anchor tests all still pass (General Book regression guard).

- [ ] **Step 2: Implement**

In `docx_engine.py` near `_CC_LABEL_NORM` add `_SIG_LABEL_NORM = "التوقيع"`. In `stamp_signature_above_name`, add the keyword-only param `date_below: str | None = None` and a priority-0 anchor pass BEFORE the name search (body paragraphs, last-to-first):

```python
    # Priority 0: an explicit signature-label line (the Report paper writes
    # التوقيـــع: with tatweel) — the float rests on the line BELOW the label
    # and rises up into it: the wet-signature look the operators asked for.
    for i in range(len(paras) - 1, -1, -1):
        if _norm_name(paras[i].text).startswith(_SIG_LABEL_NORM):
            anchor = paras[i + 1] if i + 1 < len(paras) else paras[i]
            break
```
(only fall through to the existing exact/containment/name searches when no label matched). After a successful `placed`, if `date_below` and the anchor paragraph has no text, write the date:

```python
    if placed and date_below and not anchor.text.strip():
        run = anchor.add_run(date_below)
        run.font.name = "Sakkal Majalla"
        run.font.size = Pt(12)
        stamp_run(run, "Sakkal Majalla")  # rtl + cs font, same helper other code uses
```
(match the module's existing import/usage of `stamp_run` / arabic_rtl helpers — check how `_format_general_book_ref_line` does it). Update the function docstring: label rule first, then name rules; `date_below` semantics (Report seal).

In `document_service._sign_authored_docx` (~1835): pass `date_below=ts.strftime("%d/%m/%Y") if book.ref_number.startswith("REPORT-") else None`.

- [ ] **Step 3: Run** `backend/tests/test_stamp_signature.py backend/tests/test_word_book_sign.py backend/tests/test_word_report_session.py` → ALL PASS. mypy (both touched files are in strict scope) + ruff.

- [ ] **Step 4: Commit** `feat(report): stamp signature under التوقيع with signing date`

### Task 7: Report form — signer signature preview

**Files:**
- Create: `frontend/src/components/application/fields/SignerSignaturePreview.tsx`
- Modify: `frontend/src/components/application/TemplateForm.tsx` (case 'checkbox', ~line 159)
- Modify: `frontend/src/locales/en.json` + `frontend/src/locales/ar.json`
- Test: `frontend/src/components/application/fields/SignerSignaturePreview.test.tsx`

**Interfaces:**
- Consumes: `api.getEmployeeSignature(employeeId)` (existing; returns `{dataUrl, updatedAt} | null` — see EmployeeSignatureCard.tsx:59-64 for the exact query pattern), RHF `useWatch` for the `signer_id` field.
- Produces: `<SignerSignaturePreview />` (no props; reads `signer_id` from form context itself).

- [ ] **Step 1: Failing tests** — render inside a react-hook-form provider + QueryClientProvider (copy the harness style of an existing fields test):
1. signer picked + signature on file → an `img` with the dataUrl is shown.
2. signer picked + no signature (api returns null / 404) → amber warning text (assert the ARABIC string under lng=ar — the repo's i18n rule: EN-only asserts can't catch AR leaks).
3. no signer picked → renders nothing.

- [ ] **Step 2: Implement**

`SignerSignaturePreview.tsx` — compact, no card chrome:

```tsx
/** Signer signature preview for the Report form — shows what "توقيع الآن"
 *  will stamp, or warns when the picked signer has no saved signature. */
import { useFormContext, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'

import { api } from '@/lib/api'

export function SignerSignaturePreview(): React.JSX.Element | null {
  const { t } = useTranslation()
  const { control } = useFormContext()
  const signerId = useWatch({ control, name: 'signer_id' }) as string | undefined

  const query = useQuery({
    queryKey: ['employee-signature', signerId],
    queryFn: () => api.getEmployeeSignature(signerId as string),
    enabled: !!signerId,
    staleTime: 5 * 60 * 1000,
    retry: false,
  })

  if (!signerId || query.isLoading) return null
  const sig = query.data?.dataUrl ?? null
  return sig ? (
    <span className="inline-flex items-center gap-2 rounded-sm border border-border-strong bg-white px-2 py-1">
      <img src={sig} alt={t('reportSign.previewAlt')} className="max-h-8 max-w-[150px]" dir="ltr" />
    </span>
  ) : (
    <p className="text-xs text-warning">{t('reportSign.noSig')}</p>
  )
}
```

Wire-up in `TemplateForm.tsx` case 'checkbox': when `field.key === 'sign'`, render the CheckboxField followed by `<SignerSignaturePreview />` (wrap both in a fragment/div; only the Report declares a `sign` checkbox).

i18n keys (exact strings):
- en: `"reportSign": { "previewAlt": "Signer signature", "noSig": "No saved signature for this signer — the report will be created unsigned" }`
- ar: `"reportSign": { "previewAlt": "توقيع الموقّع", "noSig": "لا يوجد توقيع محفوظ لهذا الموقّع — سيُنشأ التقرير دون توقيع" }`

- [ ] **Step 3: Run** the new vitest file + `pnpm -C frontend exec tsc -b --noEmit` + eslint on touched files → clean.
- [ ] **Step 4: Commit** `feat(report): show signer signature preview beside the sign toggle`
- [ ] **Step 5:** After commit, the controller runs the `i18n-rtl-reviewer` agent on the diff (bilingual surface).

### Task 8: Visual QA round 2 (user gate)

- Re-render `report-sample.docx` (same scratch script) AND a SIGNED sample: copy the rendered sample, then in a scratch Python snippet call `docx_engine.stamp_signature_above_name(copy, <any test PNG signature>, ["مهند عبدالرحمن أل علي"], date_below="27/07/2026")` and send BOTH files to the user (refresh the Desktop copy of the unsigned one). STOP for user approval; apply nudges as amendment commits.

## Self-Review Notes

- Spec coverage: top block (T1), body bold-16pt-justified (T1), 7/9 blank runs (T1 + tested), signature block incl. kashida + `ind left=4680` (T1 + tested), cc removal (T1 + tested), date DD/MM/YYYY incl. ISO input from the frontend (T2 — spec said "one line", but the frontend sends ISO so a parse is required; deviation noted), verification + visual QA (T3).
- The `{%p if cc %}` removal also drops the `cc` key's only consumer in the template; `create_report_word_book` still passes `"cc": ""` — harmless extra context, left untouched (smallest diff).
- Signature safety re-checked: finish-path signing anchors on the signer NAME via `stamp_signature_above_name`, and `{{ manager_name }}` renders the picked employee's name into the doc — anchor survives the restyle.
