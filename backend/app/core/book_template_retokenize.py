"""Turn a finished General Book docx into a library boilerplate template.

The per-book fields are (re)injected as tokens -- ``{{ ref }}``, ``{{ date }}``,
``{{ barcode }}``, ``{{ recipient_name }}``, ``{{ subject }}``, and ``{{ cc }}``
-- so a template is a reusable shell, not a snapshot frozen to the addressee and
subject of the book it was saved from. ALL pre-existing Jinja delimiters in the document
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
from docx.oxml.ns import qn
from docx.text.paragraph import Paragraph

from app.core.book_table import normalize_data_table
from app.core.book_text import docx_to_text
from app.core.docx_render import render

_ZWSP = "​"  # zero-width space — invisible, breaks Jinja delimiters
_JINJA_DELIM = re.compile(r"\{\{|\}\}|\{%|%\}|\{#|#\}")

_REF_LABEL = re.compile(r"^\s*الرقم\s*[:：]")  # noqa: RUF001 — full-width colon is a legitimate Arabic-text variant
_DATE_LABEL = re.compile(r"^\s*التاريخ\s*[:：]")  # noqa: RUF001 — full-width colon is a legitimate Arabic-text variant
_BARCODE_VALUE = re.compile(r"^[A-Z0-9/-]+\+\d{8}$")
_SUBJECT_LABEL = re.compile(r"^\s*الموضوع\s*[:：]")  # noqa: RUF001 — full-width colon is a legitimate Arabic-text variant
# The paper's addressee line: «السيد \ {name} المحترم» (the separator is a
# backslash on the current template, a slash on the older hand-typed books).
_ADDRESSEE = re.compile(r"^\s*السيد\s*([\\/])")

_DUMMY = {
    "ref": "9/9/9999",
    "date": "31-12-2099",
    "barcode": "9/9/9999+20991231",
    "recipient_name": "DUMMY_RECIPIENT",
    "subject": "DUMMY_SUBJECT",
    "cc": "DUMMY_CC",
}

# w:t namespace for walking raw XML runs
_W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
_W_T = f"{{{_W_NS}}}t"


def _neutralize_wt(text: str) -> str:
    """Insert ZWSP inside every Jinja delimiter found in *text*."""
    return _JINJA_DELIM.sub(lambda m: m.group(0)[0] + _ZWSP + m.group(0)[1], text)


def _neutralize_part_runs(container: Any) -> None:
    """Neutralize Jinja delimiters in all XML text, including textbox paragraphs."""
    for wt in container._element.iter(_W_T):
        if wt.text and _JINJA_DELIM.search(wt.text):
            wt.text = _neutralize_wt(wt.text)


def _clear_runs(para: Paragraph) -> None:
    for r in list(para.runs):
        r._element.getparent().remove(r._element)


def _first_run_style(para: Paragraph) -> Any | None:
    return para.runs[0] if para.runs else None


def _guard_body(para: Paragraph) -> str:
    """Paragraph text with ZWSP and Jinja delimiters stripped — "p if ref" for a
    (possibly neutralized) ``{%p if ref %}`` guard."""
    return _JINJA_DELIM.sub("", (para.text or "").replace(_ZWSP, "")).strip()


def _guard_para(para: Paragraph, directive: str, *, after: bool) -> None:
    """Ensure a guard paragraph carrying *directive* sits immediately before
    (or after) *para*. Reuses a guard that is already there — possibly with
    ZWSP-broken delimiters from the neutralize pass — so a second retokenize
    call doesn't accumulate duplicates."""
    body = _JINJA_DELIM.sub("", directive).strip()
    sibling = para._p.getnext() if after else para._p.getprevious()
    if sibling is not None and _guard_body(Paragraph(sibling, para._parent)) == body:
        guard = Paragraph(sibling, para._parent)
    else:
        clone = copy.deepcopy(para._p)
        (para._p.addnext if after else para._p.addprevious)(clone)
        guard = Paragraph(clone, para._parent)
    _clear_runs(guard)
    guard.add_run(directive)


def _header_copies(doc: Any) -> list[list[Paragraph]]:
    """Own-text paragraphs grouped by DrawingML/VML copy in first-page headers."""
    copies: list[list[Paragraph]] = []
    seen_parts: set[int] = set()
    for section in doc.sections:
        header = section.first_page_header
        if id(header.part) in seen_parts:
            continue
        seen_parts.add(id(header.part))
        grouped: dict[tuple[int, str], list[Paragraph]] = {}
        for element in header.part.element.findall(".//" + qn("w:p")):
            if not any(text.text for text in element.findall("./" + qn("w:r") + "/" + qn("w:t"))):
                continue
            ancestor = element.getparent()
            branch = "Header"
            while ancestor is not None:
                local_name = ancestor.tag.rsplit("}", 1)[-1]
                if local_name in ("Choice", "Fallback"):
                    branch = local_name
                    break
                ancestor = ancestor.getparent()
            grouped.setdefault((id(header.part), branch), []).append(Paragraph(element, header))
        copies.extend(grouped.values())
    return copies


def _write_header_block(ref_para: Paragraph, date_para: Paragraph, barcode_para: Paragraph) -> None:
    """Restore the guarded ref/date/barcode token block in one header copy."""
    src = _first_run_style(date_para)
    _clear_runs(ref_para)
    label = ref_para.add_run("الرقم: ")
    ref_run = ref_para.add_run("{{ ref }}")
    for run in (label, ref_run):
        if src is not None:
            run.font.name = src.font.name
            run.font.size = src.font.size
            run.font.bold = src.font.bold
    ref_run.font.rtl = True
    _retokenize_labeled_line(date_para, "التاريخ: ", "{{ date }}")
    _retokenize_labeled_line(barcode_para, "{{ barcode }}")
    _guard_para(ref_para, "{%p if ref %}", after=False)
    _guard_para(barcode_para, "{%p endif %}", after=True)


def _retokenize_labeled_line(para: Paragraph, *parts: str) -> None:
    """Replace *para*'s runs with *parts*, all carrying the original first
    run's font. Token runs inherit the paragraph's RTL context (same rationale
    as the ref run — match the legacy books' natural bidi flow)."""
    src = _first_run_style(para)
    _clear_runs(para)
    for part in parts:
        run = para.add_run(part)
        if src is not None:
            run.font.name = src.font.name
            run.font.size = src.font.size
            run.font.bold = src.font.bold


def _strip_header_artifacts(doc: Any) -> None:
    """Remove legacy English reference text from General Book headers."""
    for section in doc.sections:
        for hdr in (section.header, section.first_page_header):
            for para in hdr.paragraphs:
                if para.text.strip().startswith("Ref:"):
                    _clear_runs(para)


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

    # 1b. Normalize a clean data table (if present) — AFTER neutralize so the
    # injected {%tr%}/{{ row.cN }} tokens are inserted fresh and never ZWSP-broken.
    # normalize_data_table handles all cases internally (no-op when no single
    # clean table; strips ZWSP-broken directive rows on re-run for idempotency).
    normalize_data_table(doc)

    # 2/3. Restore the ref/date/barcode token block in every header copy.
    copies = _header_copies(doc)
    blocks = 0
    for paragraphs in copies:
        date_para = next((p for p in paragraphs if _DATE_LABEL.match(p.text)), None)
        ref_para = next((p for p in paragraphs if _REF_LABEL.match(p.text)), None)
        barcode_para = next(
            (
                p
                for p in paragraphs
                if _BARCODE_VALUE.fullmatch(p.text.strip())
                or p.text.replace(_ZWSP, "").strip() == "{{ barcode }}"
            ),
            None,
        )
        if date_para is None or ref_para is None or barcode_para is None:
            continue
        _write_header_block(ref_para, date_para, barcode_para)
        blocks += 1
    if blocks == 0:
        raise ValueError("لا يحتوي المستند على كتلة الرقم والتاريخ والباركود — لا يمكن حفظه كقالب")

    # 3b. Addressee / subject / CC — the source book's literal values would
    # otherwise be frozen into every book made from this template (the form's
    # pickers had nothing to fill). Subject and CC keep the base paper's
    # {%p if %} guard so an empty value hides the whole line, label and all.
    addressee = next((p for p in doc.paragraphs if _ADDRESSEE.match(p.text)), None)
    if addressee is not None:
        sep = _ADDRESSEE.match(addressee.text).group(1)  # type: ignore[union-attr]
        # The recipient picker is optional, so guard the line too — an unpicked
        # recipient would otherwise print a bare «السيد \ المحترم» with a hole
        # in the middle (the base paper's own behaviour, unguarded there).
        _guard_para(addressee, "{%p if recipient_name %}", after=False)
        _retokenize_labeled_line(addressee, f"السيد {sep} ", "{{ recipient_name }}", " المحترم ")
        _guard_para(addressee, "{%p endif %}", after=True)
    subject_para = next((p for p in doc.paragraphs if _SUBJECT_LABEL.match(p.text)), None)
    if subject_para is not None:
        _guard_para(subject_para, "{%p if subject %}", after=False)
        _retokenize_labeled_line(subject_para, "الموضوع: ", "{{ subject }}")
        _guard_para(subject_para, "{%p endif %}", after=True)
    # The CC line is post-processed into "• نسخة إلى: X" bullets, so match on
    # the label alone rather than anchoring to the paragraph start.
    cc_para = next((p for p in doc.paragraphs if "نسخة إلى" in (p.text or "")), None)
    if cc_para is not None:
        _guard_para(cc_para, "{%p if cc %}", after=False)
        _retokenize_labeled_line(cc_para, "نسخة إلى: ", "{{ cc }}")
        _guard_para(cc_para, "{%p endif %}", after=True)

    # 5. Legacy English header stamp out.
    _strip_header_artifacts(doc)

    doc.save(str(docx_path))


def _body_text_no_tables(docx_path: Path) -> str:
    """Return body paragraph text only — table cells excluded.

    doc.paragraphs already excludes table cells in python-docx, so this
    is the right source for the body-preservation check (table cell text
    is removed during normalize_data_table and would cause false positives).
    """
    return "\n".join(p.text for p in Document(str(docx_path)).paragraphs if p.text)


def _header_text(docx_path: Path) -> str:
    return "\n".join(p.text for copy in _header_copies(Document(str(docx_path))) for p in copy)


def validate_book_template(docx_path: Path) -> None:
    """Fail-closed check: dummy render must succeed under sandbox+strict and
    place each dummy value exactly once. Raises ValueError (operator-safe
    message, no paths/tracebacks)."""
    # Discover column count from the normalized template text: after
    # retokenize, data cells contain {{ row.c0 }}, {{ row.c1 }}, …
    # detect_table_schema cannot be used here because the normalized table
    # (with directive rows) no longer satisfies its "clean table" criteria.
    tpl_text = docx_to_text(docx_path)
    col_indices = [int(m) for m in re.findall(r"row\.c(\d+)", tpl_text)]
    has_table = bool(col_indices)
    dummy: dict[str, object] = dict(_DUMMY)
    if has_table:
        n = max(col_indices) + 1
        row: dict[str, str] = {f"c{i}": f"DUMMY_CELL_{i}" for i in range(n)}
        # SSTI probe: last cell carries a literal Jinja expression; it must
        # appear verbatim in the output (cell values are data, not re-expanded).
        row[f"c{n - 1}"] = "{{ ref }}"
        dummy["table_rows"] = [row]

    source_text = _body_text_no_tables(docx_path)
    expected_header_copies = _header_text(docx_path).count("{{ barcode }}")
    with tempfile.TemporaryDirectory() as td:
        out = Path(td) / "check.docx"
        try:
            render(docx_path, dummy, out, strict=True, sandboxed=True)
        except Exception as exc:  # sandbox/strict/syntax — reason stays generic
            raise ValueError("تعذر التحقق من القالب — فشل عرض تجريبي") from exc
        text = docx_to_text(out)
        header_values = [
            p.text.strip() for copy in _header_copies(Document(str(out))) for p in copy
        ]
    expected_values = {
        "ref": f"الرقم: {_DUMMY['ref']}",
        "date": f"التاريخ: {_DUMMY['date']}",
        "barcode": _DUMMY["barcode"],
    }
    if expected_header_copies == 0 or any(
        header_values.count(value) != expected_header_copies for value in expected_values.values()
    ):
        raise ValueError("كتلة الرقم أو التاريخ أو الباركود لم تُستبدل بشكل صحيح")
    # Body preserved: every substantial source line (minus token lines)
    # must survive the render. Uses paragraph-only text to exclude table cells
    # (which are transformed/removed by normalize_data_table).
    for line in source_text.splitlines():
        line = line.strip()
        if (
            len(line) >= 15
            and "{{" not in line
            and "{%" not in line
            and line.replace(_ZWSP, "") not in text.replace(_ZWSP, "")
        ):
            raise ValueError("نص القالب تغيّر أثناء العرض التجريبي")
    # Table-specific assertions: ≥1 data row rendered + no double-expansion.
    if has_table:
        # When n > 1, c0 carries "DUMMY_CELL_0" (distinct from the SSTI probe
        # in the last cell) — assert it rendered.  With n == 1, c0 IS the SSTI
        # probe cell, so there is no separate DUMMY_CELL_0 to check.
        if n > 1 and "DUMMY_CELL_0" not in text:
            raise ValueError("الجدول لم يُصيَّر بشكل صحيح — لم تظهر صفوف البيانات")
        if "{{ ref }}" not in text:
            raise ValueError("قيمة خلية الجدول تعرّضت لإعادة تفسير غير مسموح بها")
