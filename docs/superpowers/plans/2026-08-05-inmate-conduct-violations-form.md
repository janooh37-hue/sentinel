# Inmate Conduct Violations Form (تقرير المخالفات المسلكية) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new Arabic admin-category form — a supervisor files a conduct-violation report naming one or more inmates, and the branch manager's signature is embedded at creation.

**Architecture:** No new pipeline. The form rides the existing `POST /documents/generate` path: a tokenized `.docx` in `backend/templates/`, one entry each in `TEMPLATE_FILES` / `_FORM_REGISTRY` / `_FORM_CATEGORY` / `_fields.json`, and the generic `docx_render.render()` fills it. The inmate rows repeat via docxtpl's `{%tr for %}` row loop (proven working against this repo's renderer — see Prior Art). Two new frontend field types (`inmates_table`, `time`) are the only new UI code; everything else — Services tile, Records rail entry, EN/AR names, ref allocation, PDF conversion — comes free from the data-driven registration.

**Tech Stack:** Python 3.12 / FastAPI / docxtpl+python-docx / SQLite; React 19 / react-hook-form + Zod / vitest.

**Source document:** `C:\Users\Admin\Desktop\book template\Inmate Conduct Violations – Inmate Affairs.docx`
**Approved UI mockup:** `docs/inmate-violations-form-mockup.html` (open it — it is the visual contract for this plan)

## Global Constraints

- **Every Python command runs through the repo venv:** `venv\Scripts\python.exe`, `venv\Scripts\ruff.exe`, `venv\Scripts\mypy.exe`. Never bare `python`.
- **mypy is `strict`** and **pytest runs with `filterwarnings=error`** — both gates are real and must stay green.
- **Bilingual parity is mandatory.** Every user-visible string ships EN + AR. i18n tests must assert the **Arabic** string under `lng=ar`, never only the English (an EN-only assertion cannot catch an AR leak when the EN label equals the key).
- **RTL:** use logical CSS (`ms-`/`me-`, `text-start`/`text-end`), never hard `left`/`right`.
- **template_id is the literal string `Inmate Conduct Violations`** everywhere (backend map keys, `_fields.json` key, frontend lookups). It is also the Records-rail service id.
- **Template filename:** `GSSG-NAT_300-005_Inmate_Conduct_Violations.docx`. Form number `300-005` is a placeholder — see Open Questions.
- **Signing path: `auto`** (the framework default). Do **not** add an entry to `form_policy.SIGNING_PATHS` — absence *is* the decision. `embed_signature["manager"]` then defaults to `True`, and the `hand_sign_manager` checkbox lets the operator turn it off.
- **Inmate rows: docxtpl `{%tr for i in inmates %}` loop**, no fixed row cap, no blank filler rows.
- **`backend/templates/*.docx` churn:** the live service re-saves templates during operation. Before every commit run `git status backend/templates/` and revert any `.docx` you did not intentionally change.
- **This checkout is the live production build.** Work on a branch; merge to `main` and **push to `origin/main`** when done, or the next `mng update` overwrites it.

## Prior Art (verified during planning — do not re-derive)

| Question | Answer (verified) |
|---|---|
| Does `{%tr for %}` survive `app.core.docx_render.render`? | **Yes.** Spiked against this exact docx: 3 inmates → 3 rows, `{{ loop.index }}` numbered them 1/2/3, merged cells + `gridSpan` survived. `patch_xml` rewrote `{%tr for i in inmates %}` → `{% for i in inmates %}`. |
| Why did the first spike raise `TemplateSyntaxError`? | The source docx's own malformed tokens: `{{Personas name}}`, `{{ holding num }}`, `{{ EMPLOYEE NAME }}`, `{{ G-NUMBER}}` (spaces/hyphens are illegal Jinja identifiers) and `{( personal ID for persionar ))` (not a tag at all). Task 1 replaces all of them. |
| Are the tokens single-run? | **No.** They are split across `w:r` runs, so a `w:t`-level string replace silently misses them. The build script must rewrite each cell's runs wholesale (`set_cell_text`). |
| Do arbitrary `fields` keys reach the template? | **Yes** — `_build_template_data` merges the request `fields` dict into `data` (step 4; see the "Fields already merged in step 4 above" comment at `document_service.py:824`). |
| Date / weekday tokens? | Already global: `docx_render.py:215-216` sets `today` (`%d/%m/%Y`) and derives `weekday_ar` from it. Overwriting `data["today"]` makes **both** follow the operator's picked date — no new weekday code. |
| Time token? | **Does not exist.** Task 2 adds `now_time`. |
| Footer G-number? | `{{ submitter_g }}` exists and is stamped from the authenticated caller — but it is **gated to General Book only** (`document_service.py:764`). Task 3 opens the gate for this template. |
| Arabic manager name? | `manager_override.apply(..., prefer_arabic=...)` is gated to a 3-template tuple (`document_service.py:747`). This is an Arabic paper — Task 3 adds it, or the English name leaks onto an Arabic form. |
| Does the Services tile / Records rail need locale edits? | **No.** `serviceLabels.ts` reads names from `/templates` (i.e. `_fields.json`). Only `formEmoji.ts` needs a glyph. |
| Does adding a field type change the API contract? | **Yes.** `template_service.TemplateField.type` is a Pydantic `Literal[...]` union — adding `inmates_table` / `time` changes `openapi.json`, so `api.types.ts` MUST be resynced (Task 7). |

---

### Task 1: Tokenized template + registration

Produces the real `.docx` the whole feature renders from, and registers it so `/templates` lists it.

**Files:**
- Create: `backend/scripts/build_inmate_violations_template.py`
- Create (generated, committed): `backend/templates/GSSG-NAT_300-005_Inmate_Conduct_Violations.docx`
- Modify: `backend/app/core/constants.py` (`TEMPLATE_FILES`)
- Modify: `backend/app/core/docx_engine.py` (`_FORM_REGISTRY`)
- Modify: `backend/app/services/document_service.py` (`_FORM_CATEGORY`, `_FORM_SHORT_NAME`)
- Modify: `backend/app/services/template_service.py` (`TemplateField.type` Literal union)
- Modify: `backend/templates/_fields.json`
- Test: `backend/tests/test_inmate_violations_template.py`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: template id `"Inmate Conduct Violations"`; template tokens `{{ today }}`, `{{ weekday_ar }}`, `{{ now_time }}`, `{%tr for i in inmates %}` over `{{ i.name }}`/`{{ i.nationality }}`/`{{ i.wing }}`/`{{ i.uid }}`/`{{ i.holding_no }}`, `{{ violation_details }}`, `{%p for a in actions %}{{ a }}{%p endfor %}`, `{{ reporter_name }}`, `{{ reporter_g }}`, `{{ manager_name }}`, `{{ manager_sig }}`, `{{ submitter_g }}`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_inmate_violations_template.py`:

```python
"""The Inmate Conduct Violations template renders: row loop, bullets, tokens."""

from __future__ import annotations

from pathlib import Path

import pytest
from docx import Document

from app.core.constants import TEMPLATE_FILES
from app.core.docx_render import render

TEMPLATE_ID = "Inmate Conduct Violations"
TEMPLATES_DIR = Path(__file__).resolve().parents[1] / "templates"


def _table_texts(doc: Document) -> list[list[str]]:
    out: list[list[str]] = []
    for row in doc.tables[1].rows:
        seen: set[int] = set()
        cells: list[str] = []
        for c in row.cells:
            if id(c._tc) in seen:
                continue
            seen.add(id(c._tc))
            cells.append(c.text.strip())
        out.append(cells)
    return out


@pytest.fixture
def rendered(tmp_path: Path) -> Document:
    src = TEMPLATES_DIR / TEMPLATE_FILES[TEMPLATE_ID]
    out = tmp_path / "out.docx"
    render(
        src,
        {
            "today": "05/08/2026",
            "now_time": "12:43 م",
            "inmates": [
                {
                    "name": "محمد سالم ياسر",
                    "nationality": "الامارات",
                    "wing": "1A",
                    "uid": "159809450",
                    "holding_no": "1565118",
                },
                {
                    "name": "خالد عبدالله",
                    "nationality": "مصر",
                    "wing": "3B",
                    "uid": "778112",
                    "holding_no": "990211",
                },
            ],
            "violation_details": "قام النزيل بالاعتداء داخل الليوان",
            "actions": ["تم ابلاغ مدير فرع شؤون النزلاء", "تم نقل النزيل الى قسم B وتقييده"],
            "reporter_name": "عبدالله سيف المنصوري",
            "reporter_g": "G-2001",
            "manager_name": "ناصر فاضل الساعدي",
        },
        out,
    )
    return Document(str(out))


def test_registered_in_template_files() -> None:
    assert TEMPLATE_ID in TEMPLATE_FILES
    assert (TEMPLATES_DIR / TEMPLATE_FILES[TEMPLATE_ID]).exists()


def test_one_row_per_inmate(rendered: Document) -> None:
    rows = _table_texts(rendered)
    # R0 = date/day/time, R1 = column headers, then one row per inmate.
    assert rows[2][0] == "1"
    assert rows[2][1] == "محمد سالم ياسر"
    assert rows[2][3] == "1A"
    assert rows[3][0] == "2"
    assert rows[3][1] == "خالد عبدالله"
    assert rows[3][5] == "990211"


def test_date_day_time_filled(rendered: Document) -> None:
    header = rendered.tables[1].rows[0].cells
    joined = " ".join(c.text for c in header)
    assert "05/08/2026" in joined
    assert "الأربعاء" in joined          # weekday_ar derived from `today`
    assert "12:43 م" in joined
    assert "Auto_edit" not in joined      # placeholder text is gone


def test_actions_render_one_bullet_each(rendered: Document) -> None:
    body = "\n".join(p.text for p in rendered.tables[1].rows[8].cells[0].paragraphs)
    assert "تم ابلاغ مدير فرع شؤون النزلاء" in body
    assert "تم نقل النزيل الى قسم B وتقييده" in body
    # The unchosen action must NOT print.
    assert "تم كتابة مخالفة مسلكية" not in body


def test_reporter_and_manager_tokens(rendered: Document) -> None:
    whole = "\n".join(p.text for p in rendered.paragraphs)
    whole += "\n".join(c.text for r in rendered.tables[1].rows for c in r.cells)
    assert "عبدالله سيف المنصوري" in whole
    assert "G-2001" in whole
    assert "ناصر فاضل الساعدي" in whole


def test_no_malformed_tokens_survive(rendered: Document) -> None:
    whole = "\n".join(p.text for p in rendered.paragraphs)
    whole += "\n".join(c.text for r in rendered.tables[1].rows for c in r.cells)
    for bad in ("{{", "}}", "{%", "MANAGER-SIGN", "persionar"):
        assert bad not in whole
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_inmate_violations_template.py -v`
Expected: FAIL — `KeyError: 'Inmate Conduct Violations'` in `test_registered_in_template_files` (the template is not registered yet).

- [ ] **Step 3: Write the template build script**

Create `backend/scripts/build_inmate_violations_template.py`. This mirrors `build_report_template.py` / `fix_passport_release_list_template.py` — a one-shot generator, re-runnable, that turns the operator's hand-made docx into the tokenized template. Run it once and commit the output.

```python
"""Build backend/templates/GSSG-NAT_300-005_Inmate_Conduct_Violations.docx.

Takes the hand-made source docx and replaces its malformed placeholder tokens
with valid Jinja ones:

  * The two sample inmate rows collapse into ONE row wrapped in a
    ``{%tr for i in inmates %}`` / ``{%tr endfor %}`` pair, so the paper grows a
    row per inmate and prints no blank filler rows.
  * The three hard-coded supervisor-action bullets collapse into ONE bullet
    wrapped in ``{%p for a in actions %}`` / ``{%p endfor %}``.
  * ``{{Personas name}}`` / ``{( personal ID for persionar ))`` /
    ``{{ EMPLOYEE NAME }}`` / ``{{ G-NUMBER}}`` / ``{{MANAGER-SIGN}}`` are not
    legal Jinja (spaces, hyphens, wrong braces) — each is rewritten.

Tokens are split across ``w:r`` runs in the source, so a ``w:t`` string replace
misses them: every cell is rewritten run-and-all via ``set_cell_text``.

Run:  venv\\Scripts\\python.exe backend/scripts/build_inmate_violations_template.py "<source.docx>"
"""

from __future__ import annotations

import copy
import shutil
import sys
from pathlib import Path

from docx import Document
from docx.oxml.ns import qn
from docx.text.paragraph import Paragraph

DEST = (
    Path(__file__).resolve().parents[1]
    / "templates"
    / "GSSG-NAT_300-005_Inmate_Conduct_Violations.docx"
)

#: Column order of the inmate row, right-to-left as Word lays it out.
ROW_TOKENS = (
    "{{ loop.index }}",
    "{{ i.name }}",
    "{{ i.nationality }}",
    "{{ i.wing }}",
    "{{ i.uid }}",
    "{{ i.holding_no }}",
)


def set_cell_text(tc, text: str) -> None:
    """Replace a cell's whole text with `text`, keeping the first paragraph's
    formatting (font, size, RTL) and dropping every other run/paragraph."""
    paras = tc.findall(qn("w:p"))
    for extra in paras[1:]:
        tc.remove(extra)
    p = paras[0]
    for r in p.findall(qn("w:r")):
        p.remove(r)
    Paragraph(p, None).add_run(text)


def set_para_text(para, text: str) -> None:
    """Same, for a body paragraph — keep run 0's formatting, drop the rest."""
    for r in para.runs[1:]:
        r._r.getparent().remove(r._r)
    if para.runs:
        para.runs[0].text = text
    else:
        para.add_run(text)


def build(src: Path) -> None:
    shutil.copy(src, DEST)
    doc = Document(str(DEST))
    tbl = doc.tables[1]
    trs = tbl._tbl.findall(qn("w:tr"))

    # --- 1. date / day / time: replace the three "Auto_edit" placeholders ---
    hdr = trs[0].findall(qn("w:tc"))
    set_cell_text(hdr[1], "{{ today }}")
    set_cell_text(hdr[3], "{{ weekday_ar }}")
    set_cell_text(hdr[5], "{{ now_time }}")

    # --- 2. inmate rows: token row becomes the loop body, sample row is cut ---
    data_row, sample_row = trs[2], trs[3]
    for tc, token in zip(data_row.findall(qn("w:tc")), ROW_TOKENS):
        set_cell_text(tc, token)

    for_row = copy.deepcopy(sample_row)
    end_row = copy.deepcopy(sample_row)
    for marker_row, tag in ((for_row, "{%tr for i in inmates %}"), (end_row, "{%tr endfor %}")):
        cells = marker_row.findall(qn("w:tc"))
        set_cell_text(cells[0], tag)
        for c in cells[1:]:
            set_cell_text(c, "")
    data_row.addprevious(for_row)
    data_row.addnext(end_row)
    tbl._tbl.remove(sample_row)

    # --- 3. violation details ---
    detail_cell = tbl._tbl.findall(qn("w:tr"))[7].findall(qn("w:tc"))[0]
    set_cell_text(detail_cell, "{{ violation_details }}")

    # --- 4. supervisor actions: 3 fixed bullets -> one looped bullet ---
    acts_cell = tbl._tbl.findall(qn("w:tr"))[9].findall(qn("w:tc"))[0]
    bullets = acts_cell.findall(qn("w:p"))
    keep = bullets[0]                      # keeps the ListParagraph + numPr
    for extra in bullets[1:]:
        acts_cell.remove(extra)
    set_para_text(Paragraph(keep, None), "{{ a }}")
    for_p, end_p = copy.deepcopy(keep), copy.deepcopy(keep)
    set_para_text(Paragraph(for_p, None), "{%p for a in actions %}")
    set_para_text(Paragraph(end_p, None), "{%p endfor %}")
    keep.addprevious(for_p)
    keep.addnext(end_p)

    # --- 5. reporter row + manager signature block ---
    last = tbl._tbl.findall(qn("w:tr"))[-1].findall(qn("w:tc"))
    set_cell_text(last[1], "{{ reporter_name }}")
    set_cell_text(last[3], "{{ reporter_g }}")
    for para in doc.paragraphs:
        if "الإســـــــــم" in para.text:
            set_para_text(para, "الإســـــــــم: {{ manager_name }}")
        elif "MANAGER-SIGN" in para.text:
            set_para_text(para, "التوقيع: {{ manager_sig }}")

    doc.save(str(DEST))
    print(f"wrote {DEST}")


if __name__ == "__main__":
    build(Path(sys.argv[1]))
```

Run it:

```bash
venv\Scripts\python.exe backend/scripts/build_inmate_violations_template.py "C:\Users\Admin\Desktop\book template\Inmate Conduct Violations – Inmate Affairs.docx"
```

Then confirm no token survived, and that the row/bullet markers are in place:

```bash
venv\Scripts\python.exe -c "from docxtpl import DocxTemplate; import re; d=DocxTemplate(r'backend/templates/GSSG-NAT_300-005_Inmate_Conduct_Violations.docx'); d.init_docx(); print(sorted(set(re.findall(r'{{.*?}}|{%.*?%}', d.patch_xml(d.get_xml())))))"
```

Expected output contains `{% for i in inmates %}`, `{% endfor %}`, `{{ i.name }}`, `{{ today }}`, `{{ weekday_ar }}`, `{{ now_time }}`, `{{ violation_details }}`, `{% for a in actions %}`, `{{ a }}`, `{{ reporter_name }}`, `{{ reporter_g }}`, `{{ manager_name }}`, `{{ manager_sig }}` — and **no** `EMPLOYEE NAME`, `G-NUMBER`, `MANAGER-SIGN`, `persionar`.

- [ ] **Step 4: Register the template (four maps + one Literal)**

In `backend/app/core/constants.py`, add to `TEMPLATE_FILES` (after the `"Report"` line):

```python
        "Inmate Conduct Violations": "GSSG-NAT_300-005_Inmate_Conduct_Violations.docx",
```

In `backend/app/core/docx_engine.py`, add to `_FORM_REGISTRY`:

```python
    "Inmate Conduct Violations": {"adapter": _adapt_common, "post_process": None},
```

In `backend/app/services/document_service.py`, add to `_FORM_CATEGORY`:

```python
    "Inmate Conduct Violations": "NAT",
```

…and to `_FORM_SHORT_NAME`:

```python
    "Inmate Conduct Violations": "InmateViolations",
```

In `backend/app/services/template_service.py`, extend the `TemplateField.type` Literal with the two new types (they are consumed in Tasks 5–6):

```python
        "inmates_table",
        "time",
```

- [ ] **Step 5: Add the `_fields.json` entry**

In `backend/templates/_fields.json`, add this key (JSON, so no trailing comma on the last entry):

```json
  "Inmate Conduct Violations": {
    "category": "admin",
    "name_en": "Inmate Conduct Violations",
    "name_ar": "تقرير المخالفات المسلكية",
    "form_number": "300-005",
    "fields": [
      {"key": "report_date", "type": "date", "label_en": "Date", "label_ar": "التاريخ", "required": true},
      {"key": "report_time", "type": "time", "label_en": "Time", "label_ar": "الوقت", "required": true},
      {"key": "inmates", "type": "inmates_table", "label_en": "Inmates", "label_ar": "النزلاء", "required": true},
      {"key": "violation_details", "type": "arabic_rich", "label_en": "Violation details", "label_ar": "تفاصيل المخالفة", "required": true},
      {"key": "action_notified", "type": "checkbox", "label_en": "Branch manager of Inmate Affairs was notified", "label_ar": "تم ابلاغ مدير فرع شؤون النزلاء", "required": false},
      {"key": "action_written", "type": "checkbox", "label_en": "A conduct violation was written against the inmate", "label_ar": "تم كتابة مخالفة مسلكية في حق النزلاء", "required": false},
      {"key": "action_transferred", "type": "checkbox", "label_en": "Inmate moved to section B and restrained", "label_ar": "تم نقل النزيل الى قسم B وتقييده", "required": false},
      {"key": "action_other", "type": "text", "label_en": "Other action", "label_ar": "إجراء آخر", "required": false},
      {"key": "reporter_id", "type": "employee_picker", "label_en": "Reported by", "label_ar": "مقدم التقرير", "required": true},
      {"key": "manager_id", "type": "manager_picker", "label_en": "Signing manager", "label_ar": "المُوقِّع", "required": false},
      {"key": "hand_sign_manager", "type": "hand_sign_checkbox", "label_en": "Embed manager's saved signature", "label_ar": "تضمين توقيع المدير المحفوظ", "required": false}
    ]
  }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_inmate_violations_template.py -v`
Expected: PASS (6 tests). `test_date_day_time_filled` requires `now_time` — it is passed explicitly in the fixture, so it passes here; Task 2 makes the app supply it.

Also run the catalog test, which walks every registered template:

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_templates_catalog.py -v`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git status backend/templates/          # revert any .docx churn you did not intend
git add backend/scripts/build_inmate_violations_template.py \
        backend/templates/GSSG-NAT_300-005_Inmate_Conduct_Violations.docx \
        backend/templates/_fields.json \
        backend/app/core/constants.py backend/app/core/docx_engine.py \
        backend/app/services/document_service.py backend/app/services/template_service.py \
        backend/tests/test_inmate_violations_template.py
git commit -m "feat(forms): tokenized Inmate Conduct Violations template + registration"
```

---

### Task 2: `now_time` render global

The paper's third header cell is a clock time. `today` and `weekday_ar` already exist; time does not.

**Files:**
- Modify: `backend/app/core/docx_render.py:215-216` (context defaults) + module docstring
- Test: `backend/tests/test_docx_render.py` (existing file — add one test; create it if absent)

**Interfaces:**
- Consumes: Task 1's template (uses `{{ now_time }}`).
- Produces: `data["now_time"]` — Arabic 12-hour clock, e.g. `"12:43 م"`. A caller-supplied value always wins.

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_docx_render.py`:

```python
def test_now_time_defaults_to_arabic_12_hour(monkeypatch) -> None:
    from datetime import datetime

    from app.core import docx_render

    class _Fixed(datetime):
        @classmethod
        def now(cls, tz=None):  # noqa: ANN001, ANN206
            return cls(2026, 8, 5, 13, 5)

    monkeypatch.setattr(docx_render, "datetime", _Fixed)
    ctx: dict[str, object] = {}
    docx_render._apply_context_defaults(ctx)
    assert ctx["now_time"] == "1:05 م"


def test_now_time_caller_value_wins() -> None:
    from app.core import docx_render

    ctx: dict[str, object] = {"now_time": "9:30 ص"}
    docx_render._apply_context_defaults(ctx)
    assert ctx["now_time"] == "9:30 ص"
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_docx_render.py -k now_time -v`
Expected: FAIL — `AttributeError: module 'app.core.docx_render' has no attribute '_apply_context_defaults'`.

- [ ] **Step 3: Implement**

In `backend/app/core/docx_render.py`, extract the two existing `setdefault` lines (currently at 215-216) into a named helper and add the time default:

```python
def _arabic_clock(now: datetime) -> str:
    """12-hour clock with the Arabic meridiem, e.g. "1:05 م" (ص before noon)."""
    hour = now.hour % 12 or 12
    meridiem = "ص" if now.hour < 12 else "م"
    return f"{hour}:{now.minute:02d} {meridiem}"


def _apply_context_defaults(context: dict[str, Any]) -> None:
    """Date/weekday/time tokens every template may use. Caller values win."""
    context.setdefault("today", datetime.now().strftime("%d/%m/%Y"))
    context.setdefault("weekday_ar", _arabic_weekday(context["today"]))
    context.setdefault("now_time", _arabic_clock(datetime.now()))
```

Replace the two original `context.setdefault(...)` lines with:

```python
    _apply_context_defaults(context)
```

Add to the module docstring's "Jinja globals" list:

```
* ``now_time`` (variable) — Arabic 12-hour clock for now, e.g. "1:05 م".
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_docx_render.py -v`
Expected: PASS (including the pre-existing tests — `today`/`weekday_ar` behaviour is unchanged).

- [ ] **Step 5: Commit**

```bash
git add backend/app/core/docx_render.py backend/tests/test_docx_render.py
git commit -m "feat(render): add now_time Arabic clock token"
```

---

### Task 3: Reporter, Arabic manager name, footer G-number

Three small gates in `_build_template_data`, all in the same function, all Arabic-correctness critical.

**Files:**
- Modify: `backend/app/services/document_service.py` (`_build_template_data`: `prefer_arabic` tuple ~line 747, `submitter_g` gate ~line 764, new reporter block)
- Test: `backend/tests/test_inmate_violations_service.py` (create)

**Interfaces:**
- Consumes: `fields["reporter_id"]` (an `Employee.id`, i.e. the G-number string) from the request.
- Produces: `data["reporter_name"]` (Arabic name preferred), `data["reporter_g"]`, `data["submitter_g"]`, and an Arabic `data["manager_name"]`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_inmate_violations_service.py`:

```python
"""Inmate Conduct Violations — reporter/manager/footer token assembly."""

from __future__ import annotations

from app.db.models import Employee, Manager
from app.services.document_service import _build_template_data
from tests.conftest import make_user

TEMPLATE_ID = "Inmate Conduct Violations"


def _employee(db, **kw) -> Employee:
    emp = Employee(
        id=kw.pop("id", "G-2001"),
        name_en=kw.pop("name_en", "Abdullah Saif"),
        name_ar=kw.pop("name_ar", "عبدالله سيف المنصوري"),
        **kw,
    )
    db.add(emp)
    db.commit()
    return emp


def test_reporter_resolves_to_arabic_name_and_g_number(db_session) -> None:
    _employee(db_session)
    data = _build_template_data(
        db_session,
        template_id=TEMPLATE_ID,
        employee=None,
        employee_id=None,
        fields={"reporter_id": "G-2001"},
        manager_id=None,
        submitter_id=None,
        embed_signature=None,
        current_user=None,
    )
    assert data["reporter_name"] == "عبدالله سيف المنصوري"
    assert data["reporter_g"] == "G-2001"


def test_reporter_falls_back_to_english_when_no_arabic_name(db_session) -> None:
    _employee(db_session, id="G-1190", name_ar=None, name_en="Ahmed Al Hammadi")
    data = _build_template_data(
        db_session,
        template_id=TEMPLATE_ID,
        employee=None,
        employee_id=None,
        fields={"reporter_id": "G-1190"},
        manager_id=None,
        submitter_id=None,
        embed_signature=None,
        current_user=None,
    )
    assert data["reporter_name"] == "Ahmed Al Hammadi"


def test_unknown_reporter_renders_blank_not_crash(db_session) -> None:
    data = _build_template_data(
        db_session,
        template_id=TEMPLATE_ID,
        employee=None,
        employee_id=None,
        fields={"reporter_id": "G-9999"},
        manager_id=None,
        submitter_id=None,
        embed_signature=None,
        current_user=None,
    )
    assert data["reporter_name"] == ""
    assert data["reporter_g"] == ""


def test_footer_carries_the_signed_in_account_not_the_reporter(db_session) -> None:
    _employee(db_session)
    account = make_user(db_session, email="ops@test.ae")
    account.employee_id = "G-0312"
    db_session.commit()
    data = _build_template_data(
        db_session,
        template_id=TEMPLATE_ID,
        employee=None,
        employee_id=None,
        fields={"reporter_id": "G-2001"},
        manager_id=None,
        submitter_id=None,
        embed_signature=None,
        current_user=account,
    )
    # Footer = the account that generated the document; the reporter is separate.
    assert data["submitter_g"] == "G-0312"
    assert data["reporter_g"] == "G-2001"


def test_manager_name_renders_in_arabic(db_session) -> None:
    mgr = Manager(
        name_en="Nasser Fadhel Al Saedi",
        name_ar="ناصر فاضل الساعدي",
        title="مدير فرع شؤون النزلاء",
        active=True,
    )
    db_session.add(mgr)
    db_session.commit()
    data = _build_template_data(
        db_session,
        template_id=TEMPLATE_ID,
        employee=None,
        employee_id=None,
        fields={},
        manager_id=mgr.id,
        submitter_id=None,
        embed_signature={"manager": True},
        current_user=None,
    )
    # An English name on an Arabic paper is the #1 recurring defect here.
    assert data["manager_name"] == "ناصر فاضل الساعدي"
```

> `db_session` and `make_user` both come from `backend/tests/conftest.py` (verified). `Employee` needs only `id` + `name_en`; `Manager`'s activity column is `active`, not `is_active`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_inmate_violations_service.py -v`
Expected: FAIL — `KeyError: 'reporter_name'`.

- [ ] **Step 3: Implement**

In `backend/app/services/document_service.py`, extend the `prefer_arabic` tuple (currently at ~line 747):

```python
            prefer_arabic=(
                template_id
                in (
                    "General Book",
                    "Leave Permit Form",
                    "Administrative Leave Form",
                    "Inmate Conduct Violations",
                )
            ),
```

Open the `submitter_g` gate (currently at ~line 764):

```python
    if template_id in ("General Book", "Inmate Conduct Violations"):
        data["submitter_g"] = (current_user.employee_id or "") if current_user is not None else ""
```

Add the reporter block immediately after the `submitter_g` block (same shape as the Administrative Leave block that follows it — DB-dependent, so it belongs here and not in the pure docx adapter):

```python
    # ------------------------------------------------------------------
    # 4b-2. Inmate Conduct Violations — the "بيانات مقدم التقرير" row names the
    # employee who filed the report, picked from the roster. It is deliberately
    # NOT the request's employee_id: the paper is about the inmates, so the book
    # stays unattached to any employee file. The footer's {{ submitter_g }}
    # remains the signed-in account and is a different person.
    # ------------------------------------------------------------------
    if template_id == "Inmate Conduct Violations":
        reporter_id = str(fields.get("reporter_id", "") or "").strip()
        reporter = db.get(Employee, reporter_id) if reporter_id else None
        # Arabic paper: prefer the Arabic name, fall back to English only when
        # the record has none.
        data["reporter_name"] = (
            (reporter.name_ar or reporter.name_en or "") if reporter is not None else ""
        )
        data["reporter_g"] = reporter.id if reporter is not None else ""
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_inmate_violations_service.py -v`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/document_service.py backend/tests/test_inmate_violations_service.py
git commit -m "feat(forms): resolve reporter, Arabic manager name and footer G for inmate violations"
```

---

### Task 4: Supervisor actions → `actions` list

The three checkboxes plus the free-text line become the bullet list the template loops over. Arabic copy lives in one Python constant so the paper and any future notification can never drift.

**Files:**
- Modify: `backend/app/services/document_service.py` (`_build_template_data`, extend the Task 3 block)
- Test: `backend/tests/test_inmate_violations_service.py` (extend)

**Interfaces:**
- Consumes: `fields["action_notified"] | ["action_written"] | ["action_transferred"]` (bools) and `fields["action_other"]` (str).
- Produces: `data["actions"]: list[str]` in fixed paper order, custom entry last.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_inmate_violations_service.py`:

```python
def _actions(db, **fields) -> list[str]:
    data = _build_template_data(
        db,
        template_id=TEMPLATE_ID,
        employee=None,
        employee_id=None,
        fields=fields,
        manager_id=None,
        submitter_id=None,
        embed_signature=None,
        current_user=None,
    )
    return data["actions"]


def test_only_ticked_actions_render(db_session) -> None:
    assert _actions(db_session, action_notified=True, action_transferred=True) == [
        "تم ابلاغ مدير فرع شؤون النزلاء",
        "تم نقل النزيل الى قسم B وتقييده",
    ]


def test_actions_keep_paper_order_regardless_of_input_order(db_session) -> None:
    assert _actions(db_session, action_transferred=True, action_written=True) == [
        "تم كتابة مخالفة مسلكية في حق النزلاء",
        "تم نقل النزيل الى قسم B وتقييده",
    ]


def test_custom_action_appends_last(db_session) -> None:
    assert _actions(
        db_session, action_notified=True, action_other="تم إبلاغ الطبيب المناوب"
    ) == ["تم ابلاغ مدير فرع شؤون النزلاء", "تم إبلاغ الطبيب المناوب"]


def test_blank_custom_action_is_dropped(db_session) -> None:
    assert _actions(db_session, action_notified=True, action_other="   ") == [
        "تم ابلاغ مدير فرع شؤون النزلاء"
    ]


def test_no_actions_ticked_yields_empty_list(db_session) -> None:
    assert _actions(db_session) == []
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_inmate_violations_service.py -k action -v`
Expected: FAIL — `KeyError: 'actions'`.

- [ ] **Step 3: Implement**

Near the other module-level maps in `backend/app/services/document_service.py` (beside `_FORM_CATEGORY`):

```python
#: Inmate Conduct Violations — the fixed "إجراءات المشرف" bullets, in the order
#: they print. Key = the _fields.json checkbox key. The Arabic copy lives here
#: (not in the docx) so the template stays a layout and the wording has one home.
_INMATE_ACTION_LABELS: tuple[tuple[str, str], ...] = (
    ("action_notified", "تم ابلاغ مدير فرع شؤون النزلاء"),
    ("action_written", "تم كتابة مخالفة مسلكية في حق النزلاء"),
    ("action_transferred", "تم نقل النزيل الى قسم B وتقييده"),
)
```

Extend the `if template_id == "Inmate Conduct Violations":` block from Task 3:

```python
        actions = [label for key, label in _INMATE_ACTION_LABELS if fields.get(key)]
        other = str(fields.get("action_other", "") or "").strip()
        if other:
            actions.append(other)
        data["actions"] = actions
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_inmate_violations_service.py -v`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/document_service.py backend/tests/test_inmate_violations_service.py
git commit -m "feat(forms): assemble supervisor actions list for inmate violations"
```

---

### Task 5: `InmatesTableField` + `TimeField` (frontend fields)

Two new field components and their validation. Modelled on `EmployeesTableField` / `DateField`, which already live beside them.

**Files:**
- Create: `frontend/src/components/application/fields/InmatesTableField.tsx`
- Create: `frontend/src/components/application/fields/TimeField.tsx`
- Modify: `frontend/src/components/application/TemplateForm.tsx` (two `switch` cases + imports)
- Modify: `frontend/src/components/application/types.ts` (`FieldType` union)
- Modify: `frontend/src/lib/applicationFormSchema.ts` (two `case` branches)
- Modify: `frontend/src/locales/en.json`, `frontend/src/locales/ar.json`
- Test: `frontend/src/components/application/fields/InmatesTableField.test.tsx`

**Interfaces:**
- Consumes: `_fields.json` types `inmates_table` (key `inmates`) and `time` (key `report_time`) from Task 1.
- Produces: form value `inmates: {name, nationality, wing, uid, holding_no}[]` — the exact key names Task 1's template loop reads — and `report_time: string` (`"HH:MM"`).

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/application/fields/InmatesTableField.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FormProvider, useForm } from 'react-hook-form'
import { describe, expect, it } from 'vitest'

import i18n from '@/lib/i18n'
import { InmatesTableField } from './InmatesTableField'

function Harness(): React.JSX.Element {
  const form = useForm({ defaultValues: { inmates: [] } })
  return (
    <FormProvider {...form}>
      <InmatesTableField name="inmates" label_en="Inmates" label_ar="النزلاء" required />
    </FormProvider>
  )
}

describe('InmatesTableField', () => {
  it('starts empty and adds a row on demand', async () => {
    render(<Harness />)
    expect(screen.getByText(/no rows yet/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /add inmate/i }))
    expect(screen.getAllByRole('textbox').length).toBeGreaterThan(0)
  })

  it('offers the 12 wings 1A…6B and nothing else', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: /add inmate/i }))
    const wing = screen.getByRole('combobox', { name: /wing/i })
    const values = Array.from(wing.querySelectorAll('option'))
      .map((o) => o.value)
      .filter(Boolean)
    expect(values).toEqual([
      '1A', '1B', '2A', '2B', '3A', '3B', '4A', '4B', '5A', '5B', '6A', '6B',
    ])
  })

  it('renumbers the ت column after a row is removed', async () => {
    render(<Harness />)
    const add = screen.getByRole('button', { name: /add inmate/i })
    await userEvent.click(add)
    await userEvent.click(add)
    await userEvent.click(screen.getAllByRole('button', { name: /remove/i })[0])
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.queryByText('2')).not.toBeInTheDocument()
  })

  it('renders Arabic column headers under lng=ar', async () => {
    await i18n.changeLanguage('ar')
    render(<Harness />)
    // Assert the Arabic string itself — an English-only assertion cannot catch
    // an AR leak when the EN label happens to equal the key.
    expect(screen.getByText('إسم النزيل')).toBeInTheDocument()
    expect(screen.getByText('الرقم الموحد')).toBeInTheDocument()
    await i18n.changeLanguage('en')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -C frontend exec vitest run src/components/application/fields/InmatesTableField.test.tsx`
Expected: FAIL — cannot resolve `./InmatesTableField`.

- [ ] **Step 3: Write the two components**

Create `frontend/src/components/application/fields/InmatesTableField.tsx`:

```tsx
/**
 * InmatesTableField — add/remove row grid for the Inmate Conduct Violations
 * paper. One row per inmate; the docx repeats its template row via
 * `{%tr for i in inmates %}`, so there is no row cap and no blank filler rows.
 *
 * Output shape: `[{name, nationality, wing, uid, holding_no}]` — the key names
 * are the template's loop variables and must not be renamed on one side only.
 *
 * `wing` (الليوان) is a closed list: wings 1–6, sections A and B.
 */

import { useFieldArray, useFormContext } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { FieldProps } from '../types'

/** الليوان — 6 wings × sections A/B. */
export const WINGS: readonly string[] = [1, 2, 3, 4, 5, 6].flatMap((n) => [`${n}A`, `${n}B`])

interface Row {
  name: string
  nationality: string
  wing: string
  uid: string
  holding_no: string
}

const blankRow = (): Row => ({ name: '', nationality: '', wing: '', uid: '', holding_no: '' })

export function InmatesTableField({
  name,
  label_en,
  label_ar,
  required,
}: FieldProps): React.JSX.Element {
  const { i18n, t } = useTranslation()
  const isAr = i18n.language.startsWith('ar')
  const label = isAr ? label_ar : label_en

  const {
    control,
    register,
    formState: { errors },
  } = useFormContext()
  const { fields, append, remove } = useFieldArray({ control, name })
  const error = (errors[name] as { message?: string } | undefined)?.message

  return (
    <div className="col-span-1 sm:col-span-2 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <Label>
          {label}
          {required && <span className="ms-0.5 text-destructive">*</span>}
        </Label>
        <Button type="button" size="xs" variant="secondary" onClick={() => append(blankRow())}>
          {t('application.inmatesTable.addRow')}
        </Button>
      </div>
      <div className="overflow-x-auto rounded-md border border-hairline bg-surface-tinted">
        <table className="w-full border-collapse text-sm [&_td]:px-2 [&_td]:py-1.5 [&_th]:px-2 [&_th]:py-2 [&_tbody_tr]:border-t [&_tbody_tr]:border-hairline">
          <thead>
            <tr className="border-b border-hairline text-xs font-semibold tracking-[0.04em] text-muted-foreground [&_th]:text-start">
              <th scope="col" className="w-10">#</th>
              <th scope="col">{t('application.inmatesTable.name')}</th>
              <th scope="col" className="w-28">{t('application.inmatesTable.nationality')}</th>
              <th scope="col" className="w-24">{t('application.inmatesTable.wing')}</th>
              <th scope="col" className="w-32">{t('application.inmatesTable.uid')}</th>
              <th scope="col" className="w-32">{t('application.inmatesTable.holdingNo')}</th>
              <th scope="col" className="w-10" />
            </tr>
          </thead>
          <tbody>
            {fields.length === 0 && (
              <tr>
                <td colSpan={7} className="py-4 text-center text-muted-foreground">
                  {t('application.inmatesTable.empty')}
                </td>
              </tr>
            )}
            {fields.map((row, idx) => (
              <tr key={row.id}>
                <td className="text-center text-muted-foreground">{idx + 1}</td>
                <td>
                  <Input
                    {...register(`${name}.${idx}.name`)}
                    className="h-8 px-2"
                    aria-label={t('application.inmatesTable.name')}
                    dir="auto"
                  />
                </td>
                <td>
                  <Input
                    {...register(`${name}.${idx}.nationality`)}
                    className="h-8 px-2"
                    aria-label={t('application.inmatesTable.nationality')}
                    dir="auto"
                  />
                </td>
                <td>
                  <select
                    {...register(`${name}.${idx}.wing`)}
                    aria-label={t('application.inmatesTable.wing')}
                    className="h-8 w-full rounded-md border border-hairline bg-surface px-2 text-sm"
                  >
                    <option value="" />
                    {WINGS.map((w) => (
                      <option key={w} value={w}>
                        {w}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <Input
                    {...register(`${name}.${idx}.uid`)}
                    className="h-8 px-2"
                    inputMode="numeric"
                    aria-label={t('application.inmatesTable.uid')}
                  />
                </td>
                <td>
                  <Input
                    {...register(`${name}.${idx}.holding_no`)}
                    className="h-8 px-2"
                    inputMode="numeric"
                    aria-label={t('application.inmatesTable.holdingNo')}
                  />
                </td>
                <td>
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    aria-label={t('application.inmatesTable.removeRow')}
                    onClick={() => remove(idx)}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
    </div>
  )
}
```

Create `frontend/src/components/application/fields/TimeField.tsx`:

```tsx
/**
 * TimeField — native `<input type="time">`. Mirrors DateField; the browser
 * gives us the locale-correct clock UI for free.
 */

import { useFormContext } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { FieldProps } from '../types'

export function TimeField({ name, label_en, label_ar, required }: FieldProps): React.JSX.Element {
  const { i18n } = useTranslation()
  const isAr = i18n.language.startsWith('ar')
  const {
    register,
    formState: { errors },
  } = useFormContext()
  const error = (errors[name] as { message?: string } | undefined)?.message

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={name}>
        {isAr ? label_ar : label_en}
        {required && <span className="ms-0.5 text-destructive">*</span>}
      </Label>
      <Input id={name} type="time" {...register(name, { required })} />
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Wire the types, schema and locales**

In `frontend/src/components/application/types.ts`, add `'inmates_table'` and `'time'` to the `FieldType` union.

In `frontend/src/components/application/TemplateForm.tsx`, add the imports and two cases beside `employees_table`:

```tsx
    case 'inmates_table':
      return <InmatesTableField key={field.id} {...common} />

    case 'time':
      return <TimeField key={field.id} {...common} />
```

In `frontend/src/lib/applicationFormSchema.ts`, add two cases:

```ts
      case 'time':
        shape[id] = required
          ? z.string().min(1, { message: t('application.validation.required') })
          : emptyToUndefined(z.string())
        break

      case 'inmates_table': {
        const inmate = z.object({
          name: z.string().min(1, { message: t('application.validation.required') }),
          nationality: z.string().optional(),
          wing: z.string().optional(),
          uid: z.string().optional(),
          holding_no: z.string().optional(),
        })
        shape[id] = required
          ? z.array(inmate).min(1, { message: t('application.validation.required') })
          : z.array(inmate).optional()
        break
      }
```

In `frontend/src/locales/en.json`, under `application`:

```json
    "inmatesTable": {
      "addRow": "+ Add inmate",
      "removeRow": "Remove inmate",
      "empty": "No rows yet — add an inmate to begin.",
      "name": "Inmate name",
      "nationality": "Nationality",
      "wing": "Wing",
      "uid": "Unified number",
      "holdingNo": "Property number"
    }
```

In `frontend/src/locales/ar.json`, the same keys with the paper's own wording:

```json
    "inmatesTable": {
      "addRow": "+ إضافة نزيل",
      "removeRow": "حذف النزيل",
      "empty": "لا توجد صفوف — أضف نزيلاً للبدء.",
      "name": "إسم النزيل",
      "nationality": "الجنسية",
      "wing": "الليوان",
      "uid": "الرقم الموحد",
      "holdingNo": "رقم الامانات"
    }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm -C frontend exec vitest run src/components/application/fields/InmatesTableField.test.tsx`
Expected: PASS (4 tests).

Run: `pnpm -C frontend exec tsc -b --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/application/fields/InmatesTableField.tsx \
        frontend/src/components/application/fields/TimeField.tsx \
        frontend/src/components/application/fields/InmatesTableField.test.tsx \
        frontend/src/components/application/TemplateForm.tsx \
        frontend/src/components/application/types.ts \
        frontend/src/lib/applicationFormSchema.ts \
        frontend/src/locales/en.json frontend/src/locales/ar.json
git commit -m "feat(application): inmates table + time field types"
```

---

### Task 6: Services-gallery glyph + form-level UI checks

The tile, the rail entry and the EN/AR names come free from Task 1. Only the glyph is missing, and the assembled form needs one test that proves it renders end-to-end.

**Files:**
- Modify: `frontend/src/pages/application/formEmoji.ts` (`EXTRA_TEMPLATE_EMOJI`)
- Test: `frontend/src/components/application/TemplateForm.inmateViolations.test.tsx` (create)

**Interfaces:**
- Consumes: everything from Tasks 1 and 5.
- Produces: nothing new — this is the assembly gate.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/application/TemplateForm.inmateViolations.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { FormProvider, useForm } from 'react-hook-form'
import { describe, expect, it } from 'vitest'

import i18n from '@/lib/i18n'
import { emojiForTemplate } from '@/pages/application/formEmoji'
import { TemplateForm } from './TemplateForm'
import type { TemplateField } from './types'

const FIELDS: TemplateField[] = [
  { id: 'report_date', label_en: 'Date', label_ar: 'التاريخ', type: 'date', required: true },
  { id: 'report_time', label_en: 'Time', label_ar: 'الوقت', type: 'time', required: true },
  { id: 'inmates', label_en: 'Inmates', label_ar: 'النزلاء', type: 'inmates_table', required: true },
  {
    id: 'violation_details',
    label_en: 'Violation details',
    label_ar: 'تفاصيل المخالفة',
    type: 'arabic_rich',
    required: true,
  },
  {
    id: 'action_notified',
    label_en: 'Branch manager of Inmate Affairs was notified',
    label_ar: 'تم ابلاغ مدير فرع شؤون النزلاء',
    type: 'checkbox',
  },
]

// TemplateForm's `schema` prop is a full TemplateDetailResponse — meta,
// needs_manager, needs_submitter and fields — not a bare { fields }.
const SCHEMA = {
  meta: {
    id: 'Inmate Conduct Violations',
    name_en: 'Inmate Conduct Violations',
    name_ar: 'تقرير المخالفات المسلكية',
    form_number: '300-005',
    category: 'admin' as const,
    signing_path: 'auto' as const,
    has_code: true,
  },
  needs_manager: true,
  needs_submitter: false,
  fields: FIELDS,
}

function Harness(): React.JSX.Element {
  const form = useForm({ defaultValues: { inmates: [] } })
  return (
    <FormProvider {...form}>
      <TemplateForm templateId="Inmate Conduct Violations" schema={SCHEMA} form={form} />
    </FormProvider>
  )
}

describe('Inmate Conduct Violations form', () => {
  it('has its own Services glyph', () => {
    expect(emojiForTemplate('Inmate Conduct Violations')).not.toBe('📄')
  })

  it('renders every field type without an unknown-type warning', () => {
    render(<Harness />)
    expect(screen.getByLabelText(/date/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/time/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add inmate/i })).toBeInTheDocument()
  })

  it('labels the supervisor action in Arabic under lng=ar', async () => {
    await i18n.changeLanguage('ar')
    render(<Harness />)
    expect(screen.getByText('تم ابلاغ مدير فرع شؤون النزلاء')).toBeInTheDocument()
    await i18n.changeLanguage('en')
  })
})
```

> The harness matches `TemplateFormProps` as of this plan (`TemplateForm.tsx:53`). If it has drifted, match the real signature — never change `TemplateForm` to fit the test.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -C frontend exec vitest run src/components/application/TemplateForm.inmateViolations.test.tsx`
Expected: FAIL — `emojiForTemplate` returns the `📄` default.

- [ ] **Step 3: Add the glyph**

In `frontend/src/pages/application/formEmoji.ts`, add to `EXTRA_TEMPLATE_EMOJI`:

```ts
  'Inmate Conduct Violations': '🚨',
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm -C frontend exec vitest run src/components/application/TemplateForm.inmateViolations.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/application/formEmoji.ts \
        frontend/src/components/application/TemplateForm.inmateViolations.test.tsx
git commit -m "feat(application): Services glyph + form assembly test for inmate violations"
```

---

### Task 7: API-type resync, full gates, real-document check

The `TemplateField.type` Literal changed in Task 1, so the generated contract is stale until this runs. `mng build`/`deploy` use the **committed** `api.types.ts` and do NOT regenerate — skipping this makes the frontend drift silently.

**Files:**
- Modify: `backend/openapi.json`, `frontend/src/lib/api.types.ts` (both generated)

- [ ] **Step 1: Resync the generated contract**

Use the `/sync-api-types` skill. It dumps the OpenAPI schema, runs `pnpm gen:api`, and typechecks. Confirm the diff on `api.types.ts` contains `inmates_table` and `time` and nothing unrelated.

- [ ] **Step 2: Run every gate**

```bash
venv\Scripts\python.exe -m pytest
venv\Scripts\ruff.exe check . && venv\Scripts\ruff.exe format --check .
venv\Scripts\mypy.exe
pnpm -C frontend test
pnpm -C frontend run lint
pnpm -C frontend exec tsc -b --noEmit
```

Expected: all green. Do not proceed on a failure — fix it.

- [ ] **Step 3: Generate one real document and look at it**

```bash
scripts\mng.ps1 deploy
```

Then in the app: Services → **تقرير المخالفات المسلكية**. Fill two inmates (different wings), a body, two ticked actions plus a custom one, pick a reporter by G-number, keep "توقيع الآن" on. Save, then open the produced PDF and check, against `docs/inmate-violations-form-mockup.html`:

1. Date, Arabic weekday and time are filled — no `Auto_edit` text anywhere.
2. Exactly two inmate rows, numbered 1 and 2, no blank filler row.
3. Exactly three action bullets; the unticked action is absent.
4. `بيانات مقدم التقرير` shows the picked employee's **Arabic** name and their G-number.
5. The footer band carries the **signed-in account's** G-number — not the reporter's.
6. The manager's name is Arabic and their signature image is embedded above the line.
7. No `{{ … }}` or `{% … %}` text survives anywhere on the page.

- [ ] **Step 4: Run the bilingual reviewers**

Dispatch the `i18n-rtl-reviewer` and `notification-template-reviewer` agents over the branch diff. Fix anything they flag before merging.

- [ ] **Step 5: Commit and merge**

```bash
git add backend/openapi.json frontend/src/lib/api.types.ts
git commit -m "chore: resync api types for inmate violations field types"
git checkout main && git merge --no-ff <branch> && git push origin main
```

**Pushing to `origin/main` is not optional** — `mng update` pulls it onto the office server, and an unpushed fix is overwritten by the next pull.

---

## Open Questions (decide before Task 1 lands; none block starting)

1. **Form number.** The source docx carries no form number. The plan uses `NAT 300-005` (Inmate Affairs sits with the other NAT forms). If Inmate Affairs has its own series, change the two places it appears: the filename and `_fields.json.form_number`.
2. **Ref stamp on the page.** Committed documents get a ref stamped into the header plus an Aztec code in a corner, exactly like the Violation and Warning forms. This paper's header is a full-width org block, so the stamp will land on it. If you want the page bare (like Report), add `"Inmate Conduct Violations"` to `_NO_CODE_FORMS` in `docx_engine.py:102` and skip the ref stamp for this template at `document_service.py:1284`.
3. **Typo in the source.** The docx bullet reads `تم كتابه مخالفة مسلكية`; the plan uses the corrected `تم كتابة`. Say so if you want the original spelling preserved.
4. **Manager rank line.** `الرتبـــــــــــة : مدير فرع شؤون النزلاء` stays literal text in the template (only the name is tokenized), because this form is always signed by that branch manager. If an acting manager with a different title must print, tokenize it to `{{ manager_title }}` — the value already flows from the Managers registry.

## Not in scope

- No employee-facing SMS/WhatsApp notification. This form reports on inmates, not staff, and no existing form notifies on submit.
- No inmate registry. Inmate names are typed per report; there is no inmate table in this database and one report's rows do not need to outlive the paper.
- No mobile detail surface work. This form produces an ordinary book record, which the existing desktop and mobile record surfaces already render.
