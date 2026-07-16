# General Book — Solid Word Paste + A4 Page-View Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pasted Word content renders in the General Book PDF exactly like the Word original (compact tables, merged cells, row heights, widths), and the editor becomes an A4 page-view canvas with page-end guides and a working, visible page break.

**Architecture:** All render fixes live in the shared HTML→DOCX walker `backend/app/core/arabic_rtl.py` (used by `_pp_general_book`). The editor changes are content-CSS + toolbar constants in `frontend/src/components/ui/rich-editor-config.ts`, threaded through `rich-editor.tsx` and enabled only for the General Book (`arabic_rich_full` in `TemplateForm.tsx`). No new dependencies.

**Tech Stack:** Python 3.12, python-docx, lxml, pytest (repo venv); React 19 + HugeRTE, vitest, TypeScript strict.

**Spec:** `docs/superpowers/specs/2026-07-16-general-book-pageview-design.md`

## Global Constraints

- **This checkout is live production.** Work on branch `general-book-pageview`; merge to `main` only at the end (Task 10). Never leave `main` checked out mid-change.
- All Python via `venv\Scripts\python.exe` (repo root); frontend via `pnpm -C frontend`.
- Gates are strict: `mypy` strict, pytest `filterwarnings=error`, ruff, eslint, `tsc -b --noEmit`. Note: `main` has a small pre-existing mypy/eslint baseline drift (documented 2026-07-15) — compare failures against the baseline BEFORE your change; you own only new failures.
- `backend/templates/*.docx` churn in place when Word/the service touches them — `git status backend/templates` before every commit; revert churn (`git checkout -- backend/templates`) unless you intentionally edited a template (this plan never does).
- Don't regenerate `api.types.ts` — no API schema changes in this plan.
- Bilingual surfaces: any user-visible string must exist in Arabic and English (guide labels are CSS `content` literals carrying both).

## Verified facts (planning-time evidence — trust these, don't re-derive)

- **Tall-table root cause (proven with the operator's real template):** Word wraps cell text in `<p>`. `_render_table`'s cell sub-state uses `first_used: True`, so `_state_new_paragraph` never reuses the cell's built-in paragraph; `_walk_inline`'s block branch then appends a speculative paragraph after the block. Inter-tag whitespace (`'\n  '`) is emitted as literal run text. Result: 3 paragraphs per cell (whitespace, text, whitespace).
- **Page break is broken end-to-end today:** HugeRTE's `pagebreak` plugin serializes to the HTML comment `<!-- pagebreak -->` (default `pagebreak_separator`, verified in `backend/app/static/hugerte/plugins/pagebreak/plugin.js`). The backend only detects `<div class="mce-pagebreak">` / CSS page-break styles. Worse: lxml comment nodes fall into the walker's inline path, which emits the comment text — the button inserts literal " pagebreak " text into the document.
- **General Book template geometry** (`backend/templates/GSSG-GS_300-003_General_Book.docx`, section 0): A4 595.3×841.9pt; margins L 35.45 / R 36 / T 36 / B 36pt; header/footer distance 35.4pt; `titlePg` true. Content width = 523.85pt ≈ **698px** @96dpi (px = pt × 4/3). Pages-2+ raw body height = 769.9pt ≈ 1027px (before footer intrusion — Task 8 measures the real values).
- Body sentinel: `app.services.document_service.GENERAL_BOOK_BODY_SENTINEL == "⁣GSSG_BODY_ANCHOR⁣"`.
- Existing tests: `backend/tests/test_arabic_rtl_table_spacing.py` (2 tests, bare `<td>text</td>` only — must keep passing).
- `pageHeightPx` (RichEditor prop + `buildContentStyle` option) is dead code — defined, never passed by any consumer. Task 9 deletes it.
- Word-paste fixture HTML derived from the operator's template lives inline in Task 7 (the source file `التصاريح الأمنية.docx` sits on the operator's Desktop; the filtered-HTML export matches clipboard markup).

---

### Task 1: Branch + comment nodes (make the page-break button real)

**Files:**
- Modify: `backend/app/core/arabic_rtl.py` (`_walk_inline` child loop ~line 712; `html_to_docx` top loop ~line 1109)
- Test: `backend/tests/test_arabic_rtl_comments.py` (create)

**Interfaces:**
- Consumes: existing `_emit_page_break(state)`, `_state_new_paragraph(state)`, `_apply_block_fmt`.
- Produces: comment nodes never render text; comments containing `pagebreak` (case-insensitive) emit a real `w:br type="page"`. Later tasks rely on comments being inert.

- [ ] **Step 1: Create the branch**

```bash
git checkout -b general-book-pageview
```

- [ ] **Step 2: Write the failing tests**

Create `backend/tests/test_arabic_rtl_comments.py`:

```python
# backend/tests/test_arabic_rtl_comments.py
from docx import Document
from docx.oxml.ns import qn

from app.core.arabic_rtl import html_to_docx


def _all_text(doc):
    return "\n".join(p.text for p in doc.paragraphs)


def _page_break_count(doc):
    brs = doc.element.body.findall(".//" + qn("w:br"))
    return sum(1 for b in brs if b.get(qn("w:type")) == "page")


def test_comment_text_never_rendered():
    doc = Document()
    p = doc.add_paragraph()
    html_to_docx("<p>a</p><!--[if !supportLists]-->junk<!--[endif]--><p>b</p>", p)
    assert "supportLists" not in _all_text(doc)
    assert "endif" not in _all_text(doc)


def test_pagebreak_comment_at_top_level_emits_page_break():
    doc = Document()
    p = doc.add_paragraph()
    html_to_docx("<p>one</p><!-- pagebreak --><p>two</p>", p)
    assert _page_break_count(doc) == 1
    assert "pagebreak" not in _all_text(doc)


def test_pagebreak_comment_inside_block_emits_page_break():
    doc = Document()
    p = doc.add_paragraph()
    html_to_docx("<p>one<!-- pagebreak -->two</p>", p)
    assert _page_break_count(doc) == 1


def test_mce_pagebreak_div_still_works():
    doc = Document()
    p = doc.add_paragraph()
    html_to_docx('<p>one</p><div class="mce-pagebreak"></div><p>two</p>', p)
    assert _page_break_count(doc) == 1
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_arabic_rtl_comments.py -v`
Expected: `test_comment_text_never_rendered`, `test_pagebreak_comment_at_top_level_emits_page_break`, `test_pagebreak_comment_inside_block_emits_page_break` FAIL (comment text rendered / no page break). `test_mce_pagebreak_div_still_works` PASSES (pins existing behavior).

- [ ] **Step 4: Implement comment handling**

In `_walk_inline` (arabic_rtl.py), at the TOP of the `for child in node:` loop body (before `tag = ...`), insert:

```python
        if not isinstance(child.tag, str):
            # Comment / processing-instruction node — never narrative text.
            # HugeRTE's pagebreak plugin serializes breaks as the literal
            # comment `<!-- pagebreak -->` (its default pagebreak_separator).
            if "pagebreak" in ((child.text or "").lower()):
                _emit_page_break(state)
                paragraph = _state_new_paragraph(state)
                _apply_block_fmt(paragraph, blk)
            if child.tail:
                _emit_text_into_paragraph(
                    paragraph, child.tail, fmt, default_family, default_size
                )
            continue
```

In `html_to_docx`, restructure the top-level loop's dispatch so comments are handled first — replace:

```python
    for child in root:
        ctag = (child.tag or "").lower() if isinstance(child.tag, str) else ""
        if ctag in (_BLOCK_TAGS | {"ul", "ol", "table"}):
```

with:

```python
    for child in root:
        if not isinstance(child.tag, str):
            # Comment / PI at body level: pagebreak comments become real
            # page breaks; anything else is skipped (tail still handled).
            if "pagebreak" in ((child.text or "").lower()):
                _emit_page_break(state)
            if child.tail and child.tail.strip():
                cur = state["current"]
                if not hasattr(cur, "add_run"):
                    p = _state_new_paragraph(state)
                    _apply_block_fmt(p, blk)
                else:
                    p = cur
                _emit_text_into_paragraph(p, child.tail, _Fmt(), default_family, default_size)
            continue
        ctag = child.tag.lower()
        if ctag in (_BLOCK_TAGS | {"ul", "ol", "table"}):
```

(The rest of the loop body is unchanged; `ctag` no longer needs the `isinstance` guard.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_arabic_rtl_comments.py backend/tests/test_arabic_rtl_table_spacing.py -v`
Expected: all PASS.

- [ ] **Step 6: Lint + typecheck + commit**

```bash
venv\Scripts\ruff.exe check backend/app/core/arabic_rtl.py backend/tests/test_arabic_rtl_comments.py && venv\Scripts\ruff.exe format backend/app/core/arabic_rtl.py backend/tests/test_arabic_rtl_comments.py && venv\Scripts\mypy.exe
git status backend/templates   # revert any churn before committing
git add backend/app/core/arabic_rtl.py backend/tests/test_arabic_rtl_comments.py
git commit -m "fix(general-book): render <!-- pagebreak --> comments as real page breaks; never render comment text"
```

---

### Task 2: HTML whitespace collapse

**Files:**
- Modify: `backend/app/core/arabic_rtl.py` (new `_collapse_html_whitespace` + call in `html_to_docx`; guard in `_emit_text_into_paragraph` ~line 687)
- Test: `backend/tests/test_arabic_rtl_whitespace.py` (create)

**Interfaces:**
- Consumes: lxml tree from `fragment_fromstring`.
- Produces: `_collapse_html_whitespace(root) -> None` (module-private); `_emit_text_into_paragraph` drops space-only text into empty paragraphs. Tasks 3 and 7 rely on both.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_arabic_rtl_whitespace.py`:

```python
# backend/tests/test_arabic_rtl_whitespace.py
from docx import Document

from app.core.arabic_rtl import html_to_docx


def _render(html):
    doc = Document()
    p = doc.add_paragraph()
    html_to_docx(html, p)
    return doc


def test_newlines_inside_text_collapse_to_single_space():
    doc = _render("<p>محمد\n  مشرف حسين</p>")
    assert doc.paragraphs[0].text == "محمد مشرف حسين"


def test_intertag_whitespace_not_rendered_in_cells():
    doc = _render("<table><tr>\n  <td>\n  <p>A</p>\n  </td>\n</tr></table>")
    cell = doc.tables[0].rows[0].cells[0]
    for q in cell.paragraphs:
        assert "\n" not in q.text
        assert q.text.strip(" ") in ("A", "")


def test_nbsp_is_preserved():
    doc = _render("<p> </p>")
    assert doc.paragraphs[0].text == " "


def test_pre_whitespace_preserved():
    doc = _render("<pre>a\n  b</pre>")
    assert "a\n  b" in doc.paragraphs[0].text


def test_single_spaces_between_inline_tags_kept():
    doc = _render("<p><b>A</b> <i>B</i></p>")
    assert doc.paragraphs[0].text == "A B"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_arabic_rtl_whitespace.py -v`
Expected: `test_newlines_inside_text_collapse_to_single_space` and `test_intertag_whitespace_not_rendered_in_cells` FAIL; the other three may already pass (they pin behavior that must survive).

- [ ] **Step 3: Implement the collapse pre-pass + emit guard**

In `arabic_rtl.py`, add near `_emit_text_into_paragraph`:

```python
_HTML_WS_RE = re.compile(r"[ \t\r\n\f]+")


def _collapse_html_whitespace(root: Any) -> None:
    """Collapse runs of ASCII whitespace in text/tail nodes to a single space
    (HTML rendering semantics). NBSP (\\u00a0) is intentionally preserved —
    the editor uses it for deliberate spacing. ``<pre>`` subtrees keep their
    whitespace verbatim (the editor's "Preformatted" block format).
    """
    for el in root.iter():
        if not isinstance(el.tag, str):
            if el.tail:
                el.tail = _HTML_WS_RE.sub(" ", el.tail)
            continue
        tag = el.tag.lower()
        in_pre = tag == "pre" or any(
            isinstance(a.tag, str) and a.tag.lower() == "pre"
            for a in el.iterancestors()
        )
        if not in_pre and el.text:
            el.text = _HTML_WS_RE.sub(" ", el.text)
        # The tail sits OUTSIDE the element: only an enclosing <pre> protects it.
        tail_in_pre = any(
            isinstance(a.tag, str) and a.tag.lower() == "pre"
            for a in el.iterancestors()
        )
        if not tail_in_pre and el.tail:
            el.tail = _HTML_WS_RE.sub(" ", el.tail)
```

In `_emit_text_into_paragraph`, after `if not text: return`, add:

```python
    if not text.strip(" ") and not paragraph.runs:
        # Space-only text at paragraph start renders as nothing in HTML.
        return
```

In `html_to_docx`, right after `root = lhtml.fragment_fromstring(html.strip(), create_parent="div")`, add:

```python
    _collapse_html_whitespace(root)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_arabic_rtl_whitespace.py backend/tests/test_arabic_rtl_comments.py backend/tests/test_arabic_rtl_table_spacing.py -v`
Expected: all PASS.

- [ ] **Step 5: Run the full backend suite (walker is shared)**

Run: `venv\Scripts\python.exe -m pytest`
Expected: all pass (same count as `main` baseline + the new tests).

- [ ] **Step 6: Lint + typecheck + commit**

```bash
venv\Scripts\ruff.exe check backend/ && venv\Scripts\ruff.exe format backend/app/core/arabic_rtl.py backend/tests/test_arabic_rtl_whitespace.py && venv\Scripts\mypy.exe
git status backend/templates
git add backend/app/core/arabic_rtl.py backend/tests/test_arabic_rtl_whitespace.py
git commit -m "fix(general-book): collapse HTML whitespace per rendering semantics (nbsp + <pre> preserved)"
```

---

### Task 3: Cell paragraph structure — the tall-table fix

**Files:**
- Modify: `backend/app/core/arabic_rtl.py` (`_render_table` cell loop ~lines 948-969; new `_paragraph_is_visually_empty`)
- Test: `backend/tests/test_arabic_rtl_cell_structure.py` (create)

**Interfaces:**
- Consumes: Task 2's collapse (space-only leading text already dropped).
- Produces: `<td><p>text</p></td>` renders exactly one hugged paragraph. `_paragraph_is_visually_empty(p) -> bool` (module-private). Task 7's fixture assertions rely on this.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_arabic_rtl_cell_structure.py`:

```python
# backend/tests/test_arabic_rtl_cell_structure.py
from docx import Document
from docx.shared import Pt

from app.core.arabic_rtl import html_to_docx


def _cell(html, r=0, c=0):
    doc = Document()
    p = doc.add_paragraph()
    html_to_docx(html, p)
    return doc.tables[0].rows[r].cells[c]


def test_word_paste_cell_renders_single_paragraph():
    cell = _cell("<table><tr><td><p>محمد مشرف</p></td></tr></table>")
    assert len(cell.paragraphs) == 1
    assert cell.paragraphs[0].text == "محمد مشرف"


def test_word_paste_cell_with_intertag_whitespace_single_paragraph():
    cell = _cell("<table><tr>\n <td>\n  <p>A</p>\n </td>\n</tr></table>")
    assert len(cell.paragraphs) == 1
    assert cell.paragraphs[0].text == "A"


def test_cell_with_two_paragraphs_keeps_both():
    cell = _cell("<table><tr><td><p>A</p><p>B</p></td></tr></table>")
    assert [q.text for q in cell.paragraphs] == ["A", "B"]


def test_every_cell_paragraph_is_hugged():
    cell = _cell("<table><tr><td><p>A</p><p>B</p></td></tr></table>")
    for q in cell.paragraphs:
        assert q.paragraph_format.space_before == Pt(0)
        assert q.paragraph_format.space_after == Pt(0)
        assert q.paragraph_format.line_spacing == 1.0


def test_cell_explicit_line_height_wins_over_hug():
    cell = _cell('<table><tr><td><p style="line-height: 2">A</p></td></tr></table>')
    assert cell.paragraphs[0].paragraph_format.line_spacing == 2.0


def test_bare_text_cell_unchanged():
    cell = _cell("<table><tr><td>A</td></tr></table>")
    assert len(cell.paragraphs) == 1
    assert cell.paragraphs[0].text == "A"


def test_nbsp_only_cell_keeps_one_paragraph():
    # The GSSG insert-table button fills body cells with &nbsp;.
    cell = _cell("<table><tr><td> </td></tr></table>")
    assert len(cell.paragraphs) == 1
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_arabic_rtl_cell_structure.py -v`
Expected: the first four FAIL (3 paragraphs per cell today; only paragraph[0] hugged). `test_bare_text_cell_unchanged`, `test_nbsp_only_cell_keeps_one_paragraph`, `test_cell_explicit_line_height_wins_over_hug` may pass — they pin invariants.

- [ ] **Step 3: Implement**

Add module-private helper near `_render_table`:

```python
def _paragraph_is_visually_empty(p: Any) -> bool:
    """True when the paragraph would render as blank: no visible text
    (NBSP counts as visible — str.strip() removes it, so check explicitly),
    no images, no breaks."""
    text = "".join(r.text or "" for r in p.runs)
    if text.strip() or " " in text:
        return False
    return not p._p.xpath(".//w:drawing | .//w:br | .//w:pict")
```

In `_render_table`, change the cell sub-state and replace the pre-walk hug with a post-walk pass. The current block:

```python
            para = cell.paragraphs[0]
            for rr in para.runs:
                rr.text = ""
            _apply_block_fmt(para, cblk)
            # Hug the text: zero the inherited paragraph spacing so rows don't
            # render taller than their content. An explicit cascaded line-height
            # (cblk.line_height) still wins; otherwise force single spacing.
            para.paragraph_format.space_before = Pt(0)
            para.paragraph_format.space_after = Pt(0)
            if not cblk.line_height:
                para.paragraph_format.line_spacing = 1.0

            if cell_node is not None:
                sub: _WalkState = {
                    "anchor": para,
                    "current": para,
                    "first_used": True,
                    "parent_obj": para._parent,
                }
                _walk_inline(
                    cell_node, para, fmt, cblk, sub, default_family, default_size
                )
```

becomes:

```python
            para = cell.paragraphs[0]
            for rr in para.runs:
                rr.text = ""
            _apply_block_fmt(para, cblk)

            if cell_node is not None:
                # first_used=False so the first block child (<p> — Word wraps
                # every cell's text in one) REUSES this paragraph instead of
                # leaving it empty. This was the 3-paragraphs-per-cell bug.
                sub: _WalkState = {
                    "anchor": para,
                    "current": para,
                    "first_used": False,
                    "parent_obj": para._parent,
                }
                _walk_inline(
                    cell_node, para, fmt, cblk, sub, default_family, default_size
                )
                # Drop blank paragraphs the walker left behind (the speculative
                # paragraph allocated after each block child). Keep >= 1.
                paras = list(cell.paragraphs)
                removable = [q for q in paras if _paragraph_is_visually_empty(q)]
                if len(removable) == len(paras):
                    removable = removable[1:]
                for q in removable:
                    q._p.getparent().remove(q._p)

            # Hug EVERY remaining paragraph: zero spacing so rows don't render
            # taller than their content. An explicit line-height (set by
            # _apply_block_fmt from cascaded CSS) still wins.
            for q in cell.paragraphs:
                q.paragraph_format.space_before = Pt(0)
                q.paragraph_format.space_after = Pt(0)
                if q.paragraph_format.line_spacing is None:
                    q.paragraph_format.line_spacing = 1.0
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_arabic_rtl_cell_structure.py backend/tests/test_arabic_rtl_table_spacing.py backend/tests/test_arabic_rtl_whitespace.py backend/tests/test_arabic_rtl_comments.py -v`
Expected: all PASS.

- [ ] **Step 5: Full backend suite**

Run: `venv\Scripts\python.exe -m pytest`
Expected: all pass.

- [ ] **Step 6: Lint + typecheck + commit**

```bash
venv\Scripts\ruff.exe check backend/ && venv\Scripts\ruff.exe format backend/app/core/arabic_rtl.py backend/tests/test_arabic_rtl_cell_structure.py && venv\Scripts\mypy.exe
git status backend/templates
git add backend/app/core/arabic_rtl.py backend/tests/test_arabic_rtl_cell_structure.py
git commit -m "fix(general-book): pasted Word cells render one hugged paragraph, not three (tall-table root cause)"
```

---

### Task 4: Row heights honored + cantSplit + thead repeats

**Files:**
- Modify: `backend/app/core/arabic_rtl.py` (`_collect_table_rows` ~line 764; `_render_table` row loop; new `_parse_len_twips`)
- Test: `backend/tests/test_arabic_rtl_row_props.py` (create)

**Interfaces:**
- Consumes: nothing new.
- Produces: `_collect_table_rows(node) -> list[tuple[Any, list[Any]]]` — now returns `(tr_element, cells)` pairs (**signature change**; `_render_table` and `_col_fractions` call sites updated here). `_parse_len_twips(value: str) -> int | None` (pt×20, px×15, cm×567, mm×56.7, in×1440; bare number = px). Task 6 keeps this row-pair shape.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_arabic_rtl_row_props.py`:

```python
# backend/tests/test_arabic_rtl_row_props.py
from docx import Document
from docx.oxml.ns import qn

from app.core.arabic_rtl import html_to_docx


def _table(html):
    doc = Document()
    p = doc.add_paragraph()
    html_to_docx(html, p)
    return doc.tables[0]


def _trPr(table, r):
    return table.rows[r]._tr.find(qn("w:trPr"))


def test_explicit_pt_row_height_becomes_atleast_trheight():
    t = _table('<table><tr style="height:15.75pt"><td>A</td></tr></table>')
    trPr = _trPr(t, 0)
    h = trPr.find(qn("w:trHeight"))
    assert h is not None
    assert h.get(qn("w:val")) == "315"  # 15.75pt * 20
    assert h.get(qn("w:hRule")) == "atLeast"


def test_px_height_attr_supported():
    t = _table('<table><tr height="21"><td>A</td></tr></table>')
    h = _trPr(t, 0).find(qn("w:trHeight"))
    assert h is not None
    assert h.get(qn("w:val")) == "315"  # 21px * 15


def test_no_height_no_trheight():
    t = _table("<table><tr><td>A</td></tr></table>")
    trPr = _trPr(t, 0)
    assert trPr is None or trPr.find(qn("w:trHeight")) is None


def test_every_row_gets_cantsplit():
    t = _table("<table><tr><td>A</td></tr><tr><td>B</td></tr></table>")
    for r in range(2):
        assert _trPr(t, r).find(qn("w:cantSplit")) is not None


def test_thead_row_repeats_as_header():
    t = _table(
        "<table><thead><tr><th>H</th></tr></thead>"
        "<tbody><tr><td>B</td></tr></tbody></table>"
    )
    assert _trPr(t, 0).find(qn("w:tblHeader")) is not None
    trPr1 = _trPr(t, 1)
    assert trPr1 is None or trPr1.find(qn("w:tblHeader")) is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_arabic_rtl_row_props.py -v`
Expected: all FAIL except `test_no_height_no_trheight` (pins a default).

- [ ] **Step 3: Implement**

Add helper near `_parse_line_height`:

```python
_LEN_TWIPS_PER_UNIT = {"pt": 20.0, "px": 15.0, "cm": 567.0, "mm": 56.7, "in": 1440.0}


def _parse_len_twips(value: str) -> int | None:
    """Parse a CSS/HTML length to twips. Bare numbers are treated as px
    (HTML width/height attribute convention). Returns None when unparseable
    or non-positive."""
    m = re.match(r"\s*([\d.]+)\s*(pt|px|cm|mm|in)?\s*$", str(value).lower())
    if not m:
        return None
    try:
        n = float(m.group(1))
    except ValueError:
        return None
    tw = int(n * _LEN_TWIPS_PER_UNIT[m.group(2) or "px"])
    return tw if tw > 0 else None
```

Change `_collect_table_rows` to keep the `<tr>` element with its cells:

```python
def _collect_table_rows(node: Any) -> list[tuple[Any, list[Any]]]:
    """Return ``(tr_element, cells)`` pairs from direct children and any
    ``<thead>/<tbody>/<tfoot>`` section wrappers, in document order."""
    rows: list[tuple[Any, list[Any]]] = []
    for child in node:
        ctag = (child.tag or "").lower() if isinstance(child.tag, str) else ""
        if ctag == "tr":
            rows.append((child, [c for c in child if _is_cell(c)]))
        elif ctag in ("thead", "tbody", "tfoot"):
            for tr in child:
                tr_tag = (tr.tag or "").lower() if isinstance(tr.tag, str) else ""
                if tr_tag == "tr":
                    rows.append((tr, [c for c in tr if _is_cell(c)]))
    return rows
```

Update the two call sites:

1. `_col_fractions(node, rows, n)` — its first-row fallback reads `rows[0]`; change:

```python
        first = rows[0][1] if rows else []
```

2. `_render_table` — adjust for the pair shape and stamp row properties. Replace:

```python
    rows = _collect_table_rows(node)
    n_rows = len(rows)
    n_cols = max((len(r) for r in rows), default=0)
```

with:

```python
    rows = _collect_table_rows(node)
    n_rows = len(rows)
    n_cols = max((len(cells) for _tr, cells in rows), default=0)
```

and the row loop header from:

```python
    for r_idx, row_cells in enumerate(rows):
        row_attrs = dict(row_cells[0].getparent().attrib) if row_cells else {}
        row_style = row_attrs.get("style", "")
```

to:

```python
    for r_idx, (tr_el, row_cells) in enumerate(rows):
        row_attrs = dict(tr_el.attrib)
        row_style = row_attrs.get("style", "")

        trPr = tbl.rows[r_idx]._tr.get_or_add_trPr()
        # A row never splits across two pages — half-rows read terribly.
        if trPr.find(qn("w:cantSplit")) is None:
            trPr.append(OxmlElement("w:cantSplit"))
        # Explicit source row height -> minimum ("atLeast") height, so
        # Word-compact rows keep their sizing but content can still grow.
        raw_h = _parse_inline_style(row_style).get("height") or row_attrs.get("height", "")
        tw = _parse_len_twips(raw_h) if raw_h else None
        if tw:
            h_el = OxmlElement("w:trHeight")
            h_el.set(qn("w:val"), str(tw))
            h_el.set(qn("w:hRule"), "atLeast")
            trPr.append(h_el)
        # <thead> rows repeat at the top of every page the table spans.
        parent_tag = tr_el.getparent().tag if tr_el.getparent() is not None else ""
        if (
            isinstance(parent_tag, str)
            and parent_tag.lower() == "thead"
            and trPr.find(qn("w:tblHeader")) is None
        ):
            trPr.append(OxmlElement("w:tblHeader"))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_arabic_rtl_row_props.py backend/tests/test_arabic_rtl_cell_structure.py backend/tests/test_arabic_rtl_table_spacing.py -v`
Expected: all PASS.

- [ ] **Step 5: Full backend suite, lint, typecheck, commit**

```bash
venv\Scripts\python.exe -m pytest
venv\Scripts\ruff.exe check backend/ && venv\Scripts\ruff.exe format backend/app/core/arabic_rtl.py backend/tests/test_arabic_rtl_row_props.py && venv\Scripts\mypy.exe
git status backend/templates
git add backend/app/core/arabic_rtl.py backend/tests/test_arabic_rtl_row_props.py
git commit -m "feat(general-book): honor Word row heights (atLeast), cantSplit rows, repeat thead rows"
```

---

### Task 5: Table width honored

**Files:**
- Modify: `backend/app/core/arabic_rtl.py` (`_render_table` ~line 897; new `_table_width_twips`)
- Test: `backend/tests/test_arabic_rtl_table_width.py` (create)

**Interfaces:**
- Consumes: `_parse_len_twips` from Task 4, `_table_content_twips`.
- Produces: `_table_width_twips(attrs, content_twips) -> int`. Task 6 sizes columns from its result.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_arabic_rtl_table_width.py`:

```python
# backend/tests/test_arabic_rtl_table_width.py
from docx import Document
from docx.oxml.ns import qn

from app.core.arabic_rtl import html_to_docx


def _tblW(html):
    doc = Document()
    p = doc.add_paragraph()
    html_to_docx(html, p)
    tblPr = doc.tables[0]._tbl.find(qn("w:tblPr"))
    return int(tblPr.find(qn("w:tblW")).get(qn("w:w")))


def _content_twips():
    # Default python-docx Letter section: 8.5in - 2in margins = 6.5in = 9360.
    return 9360


def test_px_width_attr_honored():
    # Word paste: <table width=614 ...> -> 614px = 9210 twips < content 9360.
    assert _tblW('<table width="614"><tr><td>A</td></tr></table>') == 9210


def test_pt_style_width_honored():
    # 460.7pt * 20 = 9214.
    assert _tblW('<table style="width:460.7pt"><tr><td>A</td></tr></table>') == 9214


def test_percent_width_of_content():
    assert _tblW('<table style="width:50%"><tr><td>A</td></tr></table>') == _content_twips() // 2


def test_width_capped_at_content():
    assert _tblW('<table width="2000"><tr><td>A</td></tr></table>') == _content_twips()


def test_no_width_stays_full_content():
    assert _tblW("<table><tr><td>A</td></tr></table>") == _content_twips()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_arabic_rtl_table_width.py -v`
Expected: first four FAIL (always full width today); `test_no_width_stays_full_content` PASSES (pins the fallback).

- [ ] **Step 3: Implement**

Add helper near `_table_content_twips`:

```python
def _table_width_twips(attrs: dict[str, str], content_twips: int) -> int:
    """The table's own width in twips: style width (pt/px/%/cm) first, then
    the HTML ``width`` attribute (px), capped at the section content width.
    No width -> full content width (the pre-existing behavior)."""
    style = _parse_inline_style(attrs.get("style", ""))
    raw = (style.get("width") or attrs.get("width", "") or "").strip().lower()
    if raw.endswith("%"):
        try:
            frac = float(raw[:-1]) / 100.0
        except ValueError:
            return content_twips
        if 0 < frac < 1:
            return int(content_twips * frac)
        return content_twips
    if raw:
        tw = _parse_len_twips(raw)
        if tw:
            return min(tw, content_twips)
    return content_twips
```

In `_render_table`, replace:

```python
    content_twips = _table_content_twips(state)
    fracs = _col_fractions(node, rows, n_cols)
    col_twips = [max(1, int(content_twips * f)) for f in fracs]
```

with:

```python
    content_twips = _table_content_twips(state)
    table_twips = _table_width_twips(attrs, content_twips)
    fracs = _col_fractions(node, rows, n_cols)
    col_twips = [max(1, int(table_twips * f)) for f in fracs]
```

and the `_set_table_rtl_and_width(tbl, content_twips, col_twips, rtl)` call with `_set_table_rtl_and_width(tbl, table_twips, col_twips, rtl)`.

- [ ] **Step 4: Run tests to verify they pass; full suite; commit**

```bash
venv\Scripts\python.exe -m pytest backend/tests/test_arabic_rtl_table_width.py -v
venv\Scripts\python.exe -m pytest
venv\Scripts\ruff.exe check backend/ && venv\Scripts\ruff.exe format backend/app/core/arabic_rtl.py backend/tests/test_arabic_rtl_table_width.py && venv\Scripts\mypy.exe
git status backend/templates
git add backend/app/core/arabic_rtl.py backend/tests/test_arabic_rtl_table_width.py
git commit -m "feat(general-book): honor the source table's width (px/pt/%), capped at content width"
```

---

### Task 6: Merged cells — colspan/rowspan

**Files:**
- Modify: `backend/app/core/arabic_rtl.py` (`_render_table` cell loop restructure; `_col_fractions` span-aware fallback; new `_cell_span`, `_place_table_cells`)
- Test: `backend/tests/test_arabic_rtl_merged_cells.py` (create)

**Interfaces:**
- Consumes: Task 4's `(tr_el, cells)` row shape; Task 5's `table_twips`.
- Produces: `_place_table_cells(rows) -> tuple[int, list[tuple[Any, int, int, int, int]]]` returning `(n_grid_cols, placements)` where each placement is `(cell_node, row, col, rowspan, colspan)` with spans clamped to the grid. Word merged cells render as real Word merges.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_arabic_rtl_merged_cells.py`:

```python
# backend/tests/test_arabic_rtl_merged_cells.py
from docx import Document
from docx.oxml.ns import qn

from app.core.arabic_rtl import html_to_docx


def _table(html):
    doc = Document()
    p = doc.add_paragraph()
    html_to_docx(html, p)
    return doc.tables[0]


def _tcPr(table, r, c):
    return table.rows[r].cells[c]._tc.find(qn("w:tcPr"))


def test_colspan_produces_gridspan():
    t = _table(
        '<table><tr><td colspan="2">H</td></tr>'
        "<tr><td>A</td><td>B</td></tr></table>"
    )
    gs = _tcPr(t, 0, 0).find(qn("w:gridSpan"))
    assert gs is not None and gs.get(qn("w:val")) == "2"
    assert t.rows[0].cells[0].text.strip() == "H"
    assert t.rows[1].cells[0].text.strip() == "A"
    assert t.rows[1].cells[1].text.strip() == "B"


def test_rowspan_produces_vmerge():
    t = _table(
        '<table><tr><td rowspan="2">S</td><td>A</td></tr>'
        "<tr><td>B</td></tr></table>"
    )
    vm0 = _tcPr(t, 0, 0).find(qn("w:vMerge"))
    vm1 = _tcPr(t, 1, 0).find(qn("w:vMerge"))
    assert vm0 is not None and vm0.get(qn("w:val")) == "restart"
    assert vm1 is not None and vm1.get(qn("w:val")) in (None, "continue")
    # The cell displaced by the rowspan lands in grid column 1.
    assert t.rows[1].cells[1].text.strip() == "B"


def test_colspan_cell_width_spans_columns():
    t = _table(
        '<table><tr><td colspan="2">H</td><td>X</td></tr>'
        "<tr><td>A</td><td>B</td><td>C</td></tr></table>"
    )
    w_h = int(_tcPr(t, 0, 0).find(qn("w:tcW")).get(qn("w:w")))
    w_a = int(_tcPr(t, 1, 0).find(qn("w:tcW")).get(qn("w:w")))
    w_b = int(_tcPr(t, 1, 1).find(qn("w:tcW")).get(qn("w:w")))
    assert abs(w_h - (w_a + w_b)) <= 2  # rounding tolerance


def test_span_free_tables_unchanged():
    t = _table("<table><tr><td>A</td><td>B</td></tr></table>")
    assert len(t.columns) == 2
    assert _tcPr(t, 0, 0).find(qn("w:gridSpan")) is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_arabic_rtl_merged_cells.py -v`
Expected: the first three FAIL (spans ignored today — cells land in the wrong columns). `test_span_free_tables_unchanged` PASSES.

- [ ] **Step 3: Implement**

Add helpers near `_collect_table_rows`:

```python
def _cell_span(attrs: dict[str, str], key: str) -> int:
    try:
        v = int(attrs.get(key, "1") or 1)
    except (TypeError, ValueError):
        v = 1
    return max(1, min(v, 63))  # Word's grid maximum


def _place_table_cells(
    rows: list[tuple[Any, list[Any]]],
) -> tuple[int, list[tuple[Any, int, int, int, int]]]:
    """Grid-place every source cell accounting for col/rowspans.

    Returns ``(n_grid_cols, placements)`` where each placement is
    ``(cell_node, row, col, rowspan, colspan)``. Rowspans are clamped to the
    table's row count. Overlaps claimed by earlier spans are skipped over,
    matching the HTML table layout algorithm.
    """
    occupied: set[tuple[int, int]] = set()
    placements: list[tuple[Any, int, int, int, int]] = []
    n_grid_cols = 0
    n_rows = len(rows)
    for r, (_tr, cells) in enumerate(rows):
        c = 0
        for cell in cells:
            while (r, c) in occupied:
                c += 1
            attrs = dict(cell.attrib)
            cs = _cell_span(attrs, "colspan")
            rs = min(_cell_span(attrs, "rowspan"), n_rows - r)
            placements.append((cell, r, c, rs, cs))
            for rr in range(r, r + rs):
                for cc in range(c, c + cs):
                    occupied.add((rr, cc))
            c += cs
            n_grid_cols = max(n_grid_cols, c)
    return n_grid_cols, placements
```

Make `_col_fractions`' fallback span-aware — replace its first-row fallback block:

```python
    if len([w for w in raw if w]) != n:
        first = rows[0][1] if rows else []
```

with:

```python
    if len([w for w in raw if w]) != n:
        # Fall back to the first SPAN-FREE full row's cell widths — a row
        # with colspans can't describe per-column widths.
        first: list[Any] = []
        for _tr, cells in rows:
            if len(cells) == n and all(
                _cell_span(dict(c.attrib), "colspan") == 1 for c in cells
            ):
                first = cells
                break
```

Restructure `_render_table`'s creation + fill. Replace:

```python
    rows = _collect_table_rows(node)
    n_rows = len(rows)
    n_cols = max((len(cells) for _tr, cells in rows), default=0)
    if n_rows == 0 or n_cols == 0:
        return
```

with:

```python
    rows = _collect_table_rows(node)
    n_rows = len(rows)
    n_cols, placements = _place_table_cells(rows)
    if n_rows == 0 or n_cols == 0:
        return
```

Then replace the per-row `for c_idx in range(n_cols):` cell loop with a placement loop. The row-properties stamping from Task 4 stays in the outer `for r_idx, (tr_el, row_cells) in enumerate(rows):` loop; the cell body moves into a placements loop AFTER it (same indentation level as the row loop):

```python
    # Row properties (cantSplit / trHeight / tblHeader) — Task 4's loop stays
    # here unchanged, minus the inner cell loop.
    for r_idx, (tr_el, row_cells) in enumerate(rows):
        ...  # (existing trPr stamping from Task 4 — unchanged)

    # Cells fill by grid placement so col/rowspans land where HTML puts them.
    for cell_node, r_idx, c_idx, rs, cs in placements:
        tr_el, _cells = rows[r_idx]
        row_attrs = dict(tr_el.attrib)
        row_style = row_attrs.get("style", "")

        cell = tbl.rows[r_idx].cells[c_idx]
        if rs > 1 or cs > 1:
            cell = cell.merge(tbl.rows[r_idx + rs - 1].cells[c_idx + cs - 1])

        cell_attrs = dict(cell_node.attrib)
        cell_tag = (
            (cell_node.tag or "").lower() if isinstance(cell_node.tag, str) else "td"
        )
        cell_style = cell_attrs.get("style", "")

        # Effective cascaded style (cell wins) for block/run/background.
        eff_style = "; ".join(s for s in (table_style, row_style, cell_style) if s)
        eff_attrs = {**attrs, **row_attrs, **cell_attrs, "style": eff_style}

        # Block format: RTL/right default unless the table opts out.
        cblk = _BlockFmt()
        cblk.rtl = rtl
        cblk.align = "right" if rtl else "left"
        cblk = _merge_block_fmt_from_attrs(cblk, cell_tag, eff_attrs)

        # Run format: Calibri/12pt cell default, <th> bold, then cascade.
        fmt = _Fmt()
        fmt.family = "Calibri"
        fmt.size_pt = 12.0
        if cell_tag == "th":
            fmt.bold = True
        fmt = _merge_fmt_from_attrs(fmt, cell_tag, eff_attrs)

        # Cell width under fixed layout: the sum of its spanned columns.
        tcPr = cell._tc.get_or_add_tcPr()
        for existing in tcPr.findall(qn("w:tcW")):
            tcPr.remove(existing)
        tcW = OxmlElement("w:tcW")
        tcW.set(qn("w:type"), "dxa")
        tcW.set(qn("w:w"), str(sum(col_twips[c_idx : c_idx + cs])))
        tcPr.append(tcW)

        para = cell.paragraphs[0]
        for rr in para.runs:
            rr.text = ""
        _apply_block_fmt(para, cblk)

        # first_used=False so the first block child (<p> — Word wraps every
        # cell's text in one) REUSES this paragraph instead of leaving it
        # empty. This was the 3-paragraphs-per-cell bug.
        sub: _WalkState = {
            "anchor": para,
            "current": para,
            "first_used": False,
            "parent_obj": para._parent,
        }
        _walk_inline(cell_node, para, fmt, cblk, sub, default_family, default_size)
        # Drop blank paragraphs the walker left behind (the speculative
        # paragraph allocated after each block child). Keep >= 1.
        paras = list(cell.paragraphs)
        removable = [q for q in paras if _paragraph_is_visually_empty(q)]
        if len(removable) == len(paras):
            removable = removable[1:]
        for q in removable:
            q._p.getparent().remove(q._p)

        # Hug EVERY remaining paragraph (explicit line-height still wins).
        for q in cell.paragraphs:
            q.paragraph_format.space_before = Pt(0)
            q.paragraph_format.space_after = Pt(0)
            if q.paragraph_format.line_spacing is None:
                q.paragraph_format.line_spacing = 1.0

        # Cell background shading from cascaded background / background-color.
        style = _parse_inline_style(eff_style)
        bg_raw = style.get("background-color") or style.get("background", "")
        bg_hex = _hparse_color(bg_raw) if bg_raw else None
        if bg_hex:
            for existing in tcPr.findall(qn("w:shd")):
                tcPr.remove(existing)
            shd = OxmlElement("w:shd")
            shd.set(qn("w:fill"), bg_hex.upper())
            shd.set(qn("w:val"), "clear")
            shd.set(qn("w:color"), "auto")
            tcPr.append(shd)
```

Notes for the implementer:
- The old `cell_node = row_cells[c_idx] if c_idx < len(row_cells) else None` / `if cell_node is not None:` guards disappear — placements only contain real cells. Grid slots covered by merges are consumed by `cell.merge(...)`; genuinely absent cells (ragged rows) simply keep their empty defaults.
- `cs`/`rs` slicing of `col_twips` is safe: `_place_table_cells` computed `n_cols` from the same placements, so `c_idx + cs <= n_cols`.
- After a merge, `tcPr` must be fetched from the MERGED cell (the code above does — `cell` is rebound before `get_or_add_tcPr`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_arabic_rtl_merged_cells.py backend/tests/test_arabic_rtl_cell_structure.py backend/tests/test_arabic_rtl_row_props.py backend/tests/test_arabic_rtl_table_width.py backend/tests/test_arabic_rtl_table_spacing.py -v`
Expected: all PASS.

- [ ] **Step 5: Full backend suite, lint, typecheck, commit**

```bash
venv\Scripts\python.exe -m pytest
venv\Scripts\ruff.exe check backend/ && venv\Scripts\ruff.exe format backend/app/core/arabic_rtl.py backend/tests/test_arabic_rtl_merged_cells.py && venv\Scripts\mypy.exe
git status backend/templates
git add backend/app/core/arabic_rtl.py backend/tests/test_arabic_rtl_merged_cells.py
git commit -m "feat(general-book): render Word merged cells (colspan->gridSpan, rowspan->vMerge)"
```

---

### Task 7: End-to-end Word-paste regression fixture

**Files:**
- Test: `backend/tests/test_arabic_rtl_word_paste.py` (create)

**Interfaces:**
- Consumes: everything from Tasks 1-6.
- Produces: a pinned regression test with real Word-clipboard-shaped markup (trimmed from the operator's التصاريح الأمنية template export).

- [ ] **Step 1: Write the test (it should pass immediately — it's the integration pin)**

Create `backend/tests/test_arabic_rtl_word_paste.py`:

```python
# backend/tests/test_arabic_rtl_word_paste.py
"""Word-paste integration pin: markup shape taken from a real Word filtered-
HTML export of the operator's security-permits letter (mso classes, per-cell
<p class=MsoNormal>, pt heights/widths, inter-tag newlines). If this breaks,
pasted Word tables regressed."""
from docx import Document
from docx.oxml.ns import qn

from app.core.arabic_rtl import html_to_docx

WORD_PASTE = """
<p class=MsoNormal dir=RTL style='text-align:right;direction:rtl'><b><i>
<span lang=AR-SA style='font-size:13.0pt'>الرقم:1/ 5 /GSSG/ 140</span></i></b></p>

<div align=right>
<table class=MsoNormalTable dir=rtl border=0 cellspacing=0 cellpadding=0
 width=614 style='width:460.7pt;border-collapse:collapse'>
 <tr style='height:7.55pt'>
  <td width=76 nowrap style='width:56.7pt;border:solid windowtext 1.0pt;
  background:#004F88;padding:0in 5.4pt 0in 5.4pt;height:7.55pt'>
  <p class=MsoNormal align=center dir=RTL style='text-align:center;direction:
  rtl'><b><span lang=AR-SA style='color:white'>م</span></b></p>
  </td>
  <td width=228 nowrap style='width:171.05pt;border:solid windowtext 1.0pt;
  background:#004F88;padding:0in 5.4pt 0in 5.4pt;height:7.55pt'>
  <p class=MsoNormal align=center dir=RTL style='text-align:center;direction:
  rtl'><b><span lang=AR-SA style='color:white'>الاســــــم
  </span></b></p>
  </td>
 </tr>
 <tr style='height:15.75pt'>
  <td width=76 nowrap style='width:56.7pt;padding:0in 5.4pt 0in 5.4pt;
  height:15.75pt'>
  <p class=MsoNormal align=center dir=RTL style='text-align:center;direction:
  rtl'><span lang=AR-SA style='color:black'>1</span></p>
  </td>
  <td width=228 nowrap style='width:171.05pt;padding:0in 5.4pt 0in 5.4pt;
  height:15.75pt'>
  <p class=MsoNormal align=center dir=RTL style='text-align:center;direction:
  rtl'><span lang=AR-SA style='color:black'>محمد
  مشرف حسين محمد حسن </span></p>
  </td>
 </tr>
</table>
</div>

<p class=MsoNormal dir=RTL style='text-align:justify;direction:rtl'>
<span lang=AR-SA style='font-size:15.0pt'>للتفضل بالعلم وإجراءاتكم لطفاً،،،</span></p>
"""


def _render():
    doc = Document()
    p = doc.add_paragraph()
    html_to_docx(WORD_PASTE, p)
    return doc


def test_every_cell_is_exactly_one_clean_paragraph():
    doc = _render()
    t = doc.tables[0]
    for row in t.rows:
        for cell in row.cells:
            assert len(cell.paragraphs) == 1
            assert "\n" not in cell.paragraphs[0].text


def test_arabic_name_collapsed_to_single_spaced_text():
    doc = _render()
    assert doc.tables[0].rows[1].cells[1].text == "محمد مشرف حسين محمد حسن"


def test_row_heights_and_cantsplit_stamped():
    doc = _render()
    t = doc.tables[0]
    for r, expected in enumerate(("151", "315")):  # 7.55pt*20, 15.75pt*20
        trPr = t.rows[r]._tr.find(qn("w:trPr"))
        assert trPr.find(qn("w:cantSplit")) is not None
        assert trPr.find(qn("w:trHeight")).get(qn("w:val")) == expected


def test_table_width_matches_word_pt_width():
    doc = _render()
    tblPr = doc.tables[0]._tbl.find(qn("w:tblPr"))
    assert int(tblPr.find(qn("w:tblW")).get(qn("w:w"))) == 9214  # 460.7pt


def test_narrative_order_preserved_around_table():
    doc = _render()
    body = doc.element.body
    kinds = [e.tag.split("}")[1] for e in body if e.tag.split("}")[1] in ("p", "tbl")]
    first_tbl = kinds.index("tbl")
    assert "p" in kinds[:first_tbl]      # الرقم line before the table
    assert "p" in kinds[first_tbl + 1:]  # closing line after the table


def test_header_cell_shading_survives():
    doc = _render()
    tcPr = doc.tables[0].rows[0].cells[0]._tc.find(qn("w:tcPr"))
    shd = tcPr.find(qn("w:shd"))
    assert shd is not None and shd.get(qn("w:fill")) == "004F88"
```

- [ ] **Step 2: Run it**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_arabic_rtl_word_paste.py -v`
Expected: all PASS. If any fail, a Task 1-6 change is incomplete — fix THERE (this file pins integration; it gets no workarounds).

- [ ] **Step 3: Commit**

```bash
git add backend/tests/test_arabic_rtl_word_paste.py
git commit -m "test(general-book): pin real Word-paste rendering end to end"
```

---

### Task 8: Page-guide calibration script

**Files:**
- Create: `backend/scripts/measure_general_book_pages.py`

**Interfaces:**
- Consumes: `DocxEngine`, `GENERAL_BOOK_BODY_SENTINEL`, Word COM (this machine), PyMuPDF (`fitz`, already a dependency).
- Produces: printed `page1BodyPx` / `pageNBodyPx` / `pageWidthPx` values. **Record them — Task 9 pastes them into `GENERAL_BOOK_PAGE_VIEW`.**

- [ ] **Step 1: Write the script**

Create `backend/scripts/measure_general_book_pages.py`:

```python
"""Measure the General Book's usable body region for the editor page guides.

Renders the real template with marker paragraphs via DocxEngine, converts to
PDF (Word COM — run on the office machine), and measures where body content
starts on page 1 and where the footer begins. Prints the px@96dpi constants
for GENERAL_BOOK_PAGE_VIEW in frontend/src/components/ui/rich-editor-config.ts.

Usage:  venv\\Scripts\\python.exe backend\\scripts\\measure_general_book_pages.py
"""
from __future__ import annotations

import sys
import tempfile
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

MARKER = "XCALIBRATEX"
PX_PER_PT = 4.0 / 3.0  # 96dpi


def main() -> None:
    import fitz  # PyMuPDF
    from docx2pdf import convert

    from app.core.docx_engine import DocxEngine
    from app.services.document_service import GENERAL_BOOK_BODY_SENTINEL

    # Enough filler to spill onto page 2 so both page shapes are measurable.
    body_html = f"<p>{MARKER}1</p>" + "<p>سطر التعبئة للمعايرة</p>" * 60 + f"<p>{MARKER}2</p>"
    data = {
        "subject": "معايرة",
        "body": GENERAL_BOOK_BODY_SENTINEL,
        "body_html": body_html,
        "recipient_name": "معايرة",
        "cc": "",
    }

    with tempfile.TemporaryDirectory() as td:
        docx_path = Path(td) / "calibrate.docx"
        pdf_path = Path(td) / "calibrate.pdf"
        DocxEngine(BACKEND / "templates").fill("General Book", data, docx_path)
        convert(str(docx_path), str(pdf_path))

        pdf = fitz.open(str(pdf_path))
        page1 = pdf[0]
        ph = page1.rect.height  # pt
        pw = page1.rect.width

        hits = page1.search_for(MARKER + "1")
        if not hits:
            raise SystemExit("marker not found on page 1 — check the sentinel path")
        body_top = hits[0].y0

        # Footer top = highest object that starts in the bottom fifth of page 1.
        candidates = [b for b in page1.get_text("blocks") if b[1] > ph * 0.8]
        candidates += [page1.get_image_bbox(i) for i in page1.get_images(full=True)]
        footer_top = min(
            (b[1] if isinstance(b, tuple) else b.y0)
            for b in candidates
            if (b[1] if isinstance(b, tuple) else b.y0) > ph * 0.8
        )

        # Pages 2+: measure where content starts and where the footer begins.
        page2 = pdf[1]
        blocks2 = [b for b in page2.get_text("blocks") if MARKER not in (b[4] or "")]
        body2_top = min(b[1] for b in blocks2) if blocks2 else 36.0
        cand2 = [b for b in page2.get_text("blocks") if b[1] > ph * 0.8]
        cand2 += [page2.get_image_bbox(i) for i in page2.get_images(full=True)]
        footer2_tops = [
            (b[1] if isinstance(b, tuple) else b.y0)
            for b in cand2
            if (b[1] if isinstance(b, tuple) else b.y0) > ph * 0.8
        ]
        footer2_top = min(footer2_tops) if footer2_tops else ph - 36.0

        page1_body_pt = footer_top - body_top
        pagen_body_pt = footer2_top - body2_top
        content_w_pt = pw - 35.45 - 36.0  # section margins (verified)

        print(f"pageWidthPx: {round(content_w_pt * PX_PER_PT)}")
        print(f"page1BodyPx: {round(page1_body_pt * PX_PER_PT)}")
        print(f"pageNBodyPx: {round(pagen_body_pt * PX_PER_PT)}")


if __name__ == "__main__":  # REQUIRED — docx2pdf spawns; no guard = runs twice
    main()
```

- [ ] **Step 2: Run it and record the three numbers**

Run: `venv\Scripts\python.exe backend\scripts\measure_general_book_pages.py`
Expected output shape (values will differ — RECORD the real ones for Task 9):

```
pageWidthPx: 698
page1BodyPx: <measured — expect roughly 500-700>
pageNBodyPx: <measured — expect roughly 900-1000>
```

If Word COM fails ("pdf conversion" errors), the service user context is wrong — run from an interactive Admin shell (see memory: PDF conversion runs as Admin). Sanity-check: `page1BodyPx < pageNBodyPx` (page 1 carries the letterhead + subject block).

- [ ] **Step 3: Check ruff/mypy on the script, verify no template churn, commit**

```bash
venv\Scripts\ruff.exe check backend/scripts/measure_general_book_pages.py && venv\Scripts\ruff.exe format backend/scripts/measure_general_book_pages.py && venv\Scripts\mypy.exe
git status backend/templates   # Word ran — REVERT any template churn now
git add backend/scripts/measure_general_book_pages.py
git commit -m "chore(general-book): page-guide calibration script (prints px constants for the editor)"
```

---

### Task 9: Frontend — A4 page view, guides, page-break bar, toolbar

**Files:**
- Modify: `frontend/src/components/ui/rich-editor-config.ts` (toolbar rows, `buildContentStyle`, new `RichEditorPageView` + `GENERAL_BOOK_PAGE_VIEW`)
- Modify: `frontend/src/components/ui/rich-editor.tsx` (replace dead `pageHeightPx` prop with `pageView`)
- Modify: `frontend/src/components/application/TemplateForm.tsx` (`arabic_rich_full` case, ~line 211)
- Test: `frontend/src/components/ui/rich-editor-config.test.ts` (create)

**Interfaces:**
- Consumes: Task 8's three measured numbers.
- Produces: `RichEditorPageView { pageWidthPx; page1BodyPx; pageNBodyPx }`, `GENERAL_BOOK_PAGE_VIEW` constant, `buildContentStyle({variant, pageView?, dark?})` (the `pageHeightPx` option is REMOVED), `RichEditor` prop `pageView?: RichEditorPageView` (the `pageHeightPx` prop is REMOVED).

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/components/ui/rich-editor-config.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import {
  FULL_TOOLBAR_ROWS,
  GENERAL_BOOK_PAGE_VIEW,
  buildContentStyle,
} from './rich-editor-config'

describe('FULL_TOOLBAR_ROWS', () => {
  it('puts pagebreak in row 1 beside the GSSG buttons', () => {
    expect(FULL_TOOLBAR_ROWS[0]).toContain('gssg-table pagebreak')
    expect(FULL_TOOLBAR_ROWS[1]).not.toContain('pagebreak')
  })
})

describe('buildContentStyle page view', () => {
  const css = buildContentStyle({ variant: 'full', pageView: GENERAL_BOOK_PAGE_VIEW })

  it('shapes the body as the printed page', () => {
    expect(css).toContain(`width: ${GENERAL_BOOK_PAGE_VIEW.pageWidthPx}px`)
    expect(css).toContain('margin: 18px auto')
    expect(css).toContain('box-shadow')
  })

  it('draws a labeled page-1 guide and repeated page-end guides', () => {
    expect(css).toContain(`${GENERAL_BOOK_PAGE_VIEW.page1BodyPx}px`)
    expect(css).toContain('نهاية الصفحة')
    expect(css).toContain('page end')
    // guide for page 2 = page1 + pageN
    expect(css).toContain(
      `${GENERAL_BOOK_PAGE_VIEW.page1BodyPx + GENERAL_BOOK_PAGE_VIEW.pageNBodyPx}px`,
    )
  })

  it('styles the page-break placeholder as a visible bar', () => {
    expect(css).toContain('img.mce-pagebreak')
    expect(css).toContain('double')
  })

  it('keeps the paper white in dark mode', () => {
    const dark = buildContentStyle({
      variant: 'full',
      pageView: GENERAL_BOOK_PAGE_VIEW,
      dark: true,
    })
    expect(dark).toContain('background: #fff')
  })
})

describe('buildContentStyle without page view', () => {
  it('full variant without pageView has no page canvas', () => {
    const css = buildContentStyle({ variant: 'full' })
    expect(css).not.toContain('box-shadow')
    expect(css).not.toContain('نهاية الصفحة')
  })

  it('minimal variant unchanged and hugs table paragraphs', () => {
    const css = buildContentStyle({ variant: 'minimal' })
    expect(css).toContain('table p { margin: 0; }')
    expect(css).not.toContain('box-shadow')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm -C frontend exec vitest run src/components/ui/rich-editor-config.test.ts`
Expected: FAIL — `GENERAL_BOOK_PAGE_VIEW` not exported; toolbar row 1 lacks pagebreak.

- [ ] **Step 3: Implement `rich-editor-config.ts`**

1. Toolbar rows — replace `FULL_TOOLBAR_ROWS` with:

```ts
// Two independent rows, both always visible — nothing hides into a "..." overflow.
// Row 1 = formatting + custom GSSG buttons (+ pagebreak: the General Book's
// page control, promoted from row 2 where nobody found it).
// Row 2 = layout & tools.
export const FULL_TOOLBAR_ROWS: string[] = [
  'undo redo | gssg-template-save gssg-template-load gssg-table pagebreak | ' +
    'fontfamily fontsize lineheight | ' +
    'bold italic underline strikethrough | ' +
    'forecolor backcolor removeformat',
  'alignleft aligncenter alignright alignjustify | ltr rtl | ' +
    'bullist numlist outdent indent | ' +
    'link image table charmap | ' +
    'searchreplace fullscreen preview help',
]
```

2. Add the page-view types + constant (paste Task 8's measured numbers — the values below are the planning-time estimates; REPLACE `page1BodyPx`/`pageNBodyPx` with the script's output):

```ts
export interface RichEditorPageView {
  /** CSS px width of the printable page content (A4 width − template side margins). */
  pageWidthPx: number
  /** Usable body height on page 1 (letterhead + subject block already deducted). */
  page1BodyPx: number
  /** Usable body height on pages 2+. */
  pageNBodyPx: number
}

// Measured from GSSG-GS_300-003_General_Book.docx via
// backend/scripts/measure_general_book_pages.py (A4 595.3x841.9pt, margins
// L35.45/R36/T36/B36pt, px = pt * 4/3 @96dpi). Re-run the script if the
// template layout changes in Word.
export const GENERAL_BOOK_PAGE_VIEW: RichEditorPageView = {
  pageWidthPx: 698, // <- script output
  page1BodyPx: 620, // <- script output
  pageNBodyPx: 940, // <- script output
}
```

3. Replace `buildContentStyle` (drops `pageHeightPx`, adds `pageView`):

```ts
const GUIDE_COLOR = '#c0392b'
const GUIDE_PAGES = 12 // static guide lines cover any realistic book length

export function buildContentStyle(opts: {
  variant: 'minimal' | 'full'
  pageView?: RichEditorPageView
  /** When true, render the editor body with a dark surface + light text so it
   * doesn't stay white in the app's dark theme. (Page view keeps white paper —
   * it previews the printed page.) */
  dark?: boolean
}): string {
  // The editor body lives in an iframe and doesn't inherit the app's CSS vars,
  // so dark-mode colours are baked in here as literals.
  const paper = opts.pageView ? '#fff' : opts.dark ? '#1c2026' : '#fff'
  const fg = opts.pageView ? '#1a2433' : opts.dark ? '#e6e6e6' : 'inherit'
  const baseFont =
    "body { font-family: 'Noto Sans Arabic', Calibri, 'Segoe UI', Tahoma, sans-serif; " +
    'font-size: 12pt; line-height: 1.5; direction: rtl; padding: 0.5in; ' +
    'background: ' + paper + '; color: ' + fg + '; position: relative; min-height: 100%; } ' +
    'table { border-collapse: collapse; line-height: 1.15; } ' +
    'table td, table th { border: 1px solid #888; padding: 4px 6px; } ' +
    'table p { margin: 0; } ' + // cells hug their text — matches the DOCX render
    'p { margin: 0 0 0.5em 0; }'

  if (!opts.pageView || opts.variant === 'minimal') {
    return baseFont
  }

  const { pageWidthPx, page1BodyPx, pageNBodyPx } = opts.pageView
  // Page k (1-based) ends at page1BodyPx + (k-1) * pageNBodyPx in content
  // coordinates. Discrete gradient layers beat a repeating gradient here —
  // a repeating layer would also paint lines above the first page end.
  const ends = Array.from(
    { length: GUIDE_PAGES },
    (_, i) => page1BodyPx + i * pageNBodyPx,
  )
  const guides = ends
    .map(
      (y) =>
        `linear-gradient(to bottom, transparent ${y - 2}px, ${GUIDE_COLOR} ${y - 2}px ${y}px, transparent ${y}px)`,
    )
    .join(', ')

  const desk = opts.dark ? '#262a31' : '#9aa3ad'
  return (
    baseFont +
    ' html { background: ' + desk + '; } ' +
    'body { width: ' + String(pageWidthPx) + 'px; max-width: ' + String(pageWidthPx) + 'px; ' +
    'margin: 18px auto; box-sizing: border-box; ' +
    'box-shadow: 0 2px 6px rgba(0,0,0,.25), 0 12px 30px rgba(0,0,0,.28); ' +
    'background-image: ' + guides + '; ' +
    'background-origin: content-box; background-repeat: no-repeat; ' +
    'min-height: ' + String(page1BodyPx + 60) + 'px; } ' +
    // Label on the first page end only (the rest are plain lines).
    "body::after { content: '≈ نهاية الصفحة 1 · page 1 end'; " +
    'position: absolute; left: 0; right: 0; top: ' + String(page1BodyPx) + 'px; ' +
    'color: ' + GUIDE_COLOR + '; ' +
    "font-size: 9pt; font-family: 'Segoe UI', Tahoma, sans-serif; " +
    'direction: ltr; text-align: center; padding-top: 2px; ' +
    'pointer-events: none; opacity: 0.85; } ' +
    // The inserted page break: an obvious double-ruled bar, not faint dashes.
    'img.mce-pagebreak { display: block; width: 100%; height: 12px; margin: 12px 0; ' +
    'border: 0; border-top: 3px double #1d3a5e; border-bottom: 3px double #1d3a5e; ' +
    'cursor: default; }'
  )
}
```

Note: `body::after` positions against the body's padding box while the guides use `content-box` origin — both offset the same `page1BodyPx` from different origins differing by the body's `0.5in` top padding. Align them: add `background-position: 0 0;` and change `body::after`'s `top` to `calc(0.5in + ${page1BodyPx}px)`. Concretely, use `'top: calc(0.5in + ' + String(page1BodyPx) + 'px); '` in the `::after` rule.

- [ ] **Step 4: Implement `rich-editor.tsx` prop swap**

- Remove `pageHeightPx?: number` from `RichEditorProps` (and its JSDoc); add:

```ts
  /**
   * A4 page-view canvas for the "full" variant: white page on a gray desk,
   * page-end guides at the measured print heights, visible page-break bar.
   * Omit for the plain full-height editor (Ledger compose).
   */
  pageView?: RichEditorPageView
```

- Import the type: `import { ..., type RichEditorPageView } from './rich-editor-config'`.
- Function signature: replace `pageHeightPx,` with `pageView,`.
- Content style memo becomes:

```ts
  const contentStyle = useMemo(
    () => buildContentStyle({ variant, pageView, dark: isDark }),
    [variant, pageView, isDark],
  )
```

- [ ] **Step 5: Wire the General Book in `TemplateForm.tsx`**

In the `arabic_rich_full` case, add the prop (import `GENERAL_BOOK_PAGE_VIEW` from `@/components/ui/rich-editor-config`):

```tsx
    case 'arabic_rich_full':
      // 600 px body editor for General Book — the A4 page-view canvas
      // (guides + page-break bar) previews the printed layout; the editor
      // frame itself stays 600px and scrolls.
      return (
        <RichEditor
          key={field.id}
          {...common}
          variant="full"
          defaultValue={field.default}
          height={600}
          pageView={GENERAL_BOOK_PAGE_VIEW}
        />
      )
```

- [ ] **Step 6: Run tests + gates**

```bash
pnpm -C frontend exec vitest run src/components/ui/rich-editor-config.test.ts
pnpm -C frontend test
pnpm -C frontend exec tsc -b --noEmit
pnpm -C frontend run lint
```

Expected: new tests PASS; full vitest/tsc/eslint match the `main` baseline (no new failures).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/ui/rich-editor-config.ts frontend/src/components/ui/rich-editor-config.test.ts frontend/src/components/ui/rich-editor.tsx frontend/src/components/application/TemplateForm.tsx
git commit -m "feat(general-book): A4 page-view editor — page-end guides, visible page-break bar, promoted pagebreak button"
```

---

### Task 10: Final verification + reviewers + merge

**Files:** none new (verification + merge).

- [ ] **Step 1: Full gates, both sides**

```bash
venv\Scripts\python.exe -m pytest
venv\Scripts\ruff.exe check . && venv\Scripts\ruff.exe format --check .
venv\Scripts\mypy.exe
pnpm -C frontend test
pnpm -C frontend exec tsc -b --noEmit
pnpm -C frontend run lint
```

Expected: everything passes / matches the documented `main` baseline drift.

- [ ] **Step 2: Visual smoke test in the real app**

Build + run the dev flow (or `scripts\mng.ps1 deploy` on approval — deploy is the operator's call). Minimum: `pnpm -C frontend run build` succeeds. In the app: open Application → General Book → the body editor shows the white page on the gray desk; page-break button visible in row 1; inserting a break shows the double-ruled bar; paste the operator's التصاريح الأمنية letter → tables compact in the editor; generate → preview PDF shows compact tables matching Word.

- [ ] **Step 3: Reviewer agents (read-only)**

Dispatch `i18n-rtl-reviewer` on the diff (`git diff main...general-book-pageview`) — the guide label and content CSS touch a bilingual surface. Address findings.

- [ ] **Step 4: Finish the branch**

Use superpowers:finishing-a-development-branch — merge `general-book-pageview` into `main`, push to `origin/main` (live-server rule: unpushed fixes get overwritten by `mng update`). Deployment (`mng deploy`) is the operator's decision.

---

## Self-Review (done at planning time)

- **Spec coverage:** 1a→Tasks 2+3; 1b/1c→Task 4; 1d→Task 5; 1e→Task 6; page-break backend→Task 1 (spec said "no backend change" — planning-time verification proved the separator is a comment, so Task 1 IS the page-break fix; spec's intent "the button produces a real break" holds); Part 2 (canvas/guides/button/bar/table CSS)→Task 9 (+ Task 8 calibration); Part 3 testing→Tasks 1-7 tests, Task 9 vitest, Task 10 e2e + reviewer.
- **Placeholder scan:** Task 9's `GENERAL_BOOK_PAGE_VIEW` numbers are explicitly sourced from Task 8's output (estimates provided as fallback); no TBDs remain.
- **Type consistency:** `_collect_table_rows` pair shape introduced in Task 4 and consumed identically in Task 6; `_parse_len_twips` defined Task 4, used Tasks 4-5; `RichEditorPageView` field names identical across config/editor/TemplateForm/tests.
