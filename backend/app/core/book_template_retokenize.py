"""Turn a finished General Book docx into a library boilerplate template.

Exactly three tokens are (re)injected -- ``{{ ref }}``, ``{{ date }}``,
``{{ submitter_g }}`` -- and ALL pre-existing Jinja delimiters in the document
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

# w:t namespace for walking raw XML runs
_W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
_W_T = f"{{{_W_NS}}}t"


def _neutralize_wt(text: str) -> str:
    """Insert ZWSP inside every Jinja delimiter found in *text*."""
    return _JINJA_DELIM.sub(lambda m: m.group(0)[0] + _ZWSP + m.group(0)[1], text)


def _neutralize_part_runs(container: Any) -> None:
    """Walk all paragraphs (and table cells recursively) in *container*,
    neutralizing Jinja delimiters at the w:t element level so cross-run
    delimiters are also caught.

    python-docx `para.runs` groups consecutive w:r elements but may miss
    delimiters split across run boundaries. Walking w:t directly covers both
    cases: each w:t text node is replaced atomically.
    """
    for para in container.paragraphs:
        # Fast path: skip paragraphs without any delimiter characters
        if "{{" not in para.text and "{%" not in para.text and "{#" not in para.text:
            continue
        for wt in para._p.iter(_W_T):
            if wt.text and _JINJA_DELIM.search(wt.text):
                wt.text = _neutralize_wt(wt.text)
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
            section.even_page_header,
            section.footer,
            section.first_page_footer,
            section.even_page_footer,
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
    # submitter_g is deliberately NOT asserted — it is optional-inject (books
    # without a footer G-number are valid templates).
    if text.count(_DUMMY["ref"]) != 1 or text.count(_DUMMY["date"]) != 1:
        raise ValueError("سطر الرقم أو التاريخ لم يُستبدل بشكل صحيح")
    # Body preserved: every substantial source line (minus token lines)
    # must survive the render.
    for line in source_text.splitlines():
        line = line.strip()
        if len(line) >= 15 and "{{" not in line and "{%" not in line:
            if line.replace(_ZWSP, "") not in text.replace(_ZWSP, ""):
                raise ValueError("نص القالب تغيّر أثناء العرض التجريبي")
