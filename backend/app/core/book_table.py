"""Utilities for classifying and normalising General Book docx tables."""

from __future__ import annotations

from docx.document import Document
from docx.oxml.ns import qn
from docx.oxml.xmlchemy import BaseOxmlElement


def _gridspan(tc: BaseOxmlElement) -> int:
    """Return the gridSpan value for a <w:tc> element (default 1)."""
    gs = tc.find(f".//{qn('w:gridSpan')}")
    if gs is None:
        return 1
    try:
        return int(gs.get(qn("w:val"), "1"))
    except (TypeError, ValueError):
        return 1


def _has_vmerge(tc: BaseOxmlElement) -> bool:
    """Return True if a <w:tc> element carries a w:vMerge child."""
    return tc.find(f".//{qn('w:vMerge')}") is not None


def _row_logical_cols(tr: BaseOxmlElement) -> int:
    """Sum gridSpan values across all cells in a <w:tr> element."""
    return sum(_gridspan(tc) for tc in tr.findall(qn("w:tc")))


def _cell_text(tc: BaseOxmlElement) -> str:
    """Concatenate all w:t text nodes within a <w:tc> element."""
    return "".join(t.text or "" for t in tc.findall(f".//{qn('w:t')}"))


def detect_table_schema(doc: Document) -> list[str] | None:
    """Classify a General Book docx and return its header column texts.

    Returns the ordered header cell texts when *doc* contains exactly ONE
    clean data table in the document body, or ``None`` otherwise.

    A table is "clean" iff:
    1. It is the ONLY ``w:tbl`` in the document body (headers/footers/
       textboxes are excluded by searching ``doc.element.body`` directly).
    2. It has a header row (row 0).
    3. Every non-header row has the same logical column count as the header
       row (logical = sum of each cell's gridSpan).
    4. No data cell (rows 1..N) carries ``w:vMerge`` or ``gridSpan`` > 1.
    """
    body: BaseOxmlElement = doc.element.body
    tbls = body.findall(qn("w:tbl"))
    if len(tbls) != 1:
        return None

    tbl = tbls[0]
    rows = tbl.findall(qn("w:tr"))
    if not rows:
        return None

    header_row = rows[0]
    header_cells = header_row.findall(qn("w:tc"))
    if not header_cells:
        return None

    header_col_count = _row_logical_cols(header_row)

    for tr in rows[1:]:
        if _row_logical_cols(tr) != header_col_count:
            return None
        for tc in tr.findall(qn("w:tc")):
            if _has_vmerge(tc) or _gridspan(tc) > 1:
                return None

    return [_cell_text(tc) for tc in header_cells]


_ZWSP = "​"  # zero-width space inserted by the neutralize pass


def _strip_zwsp(text: str) -> str:
    return text.replace(_ZWSP, "")


def normalize_data_table(doc: Document) -> None:
    """Convert the single clean data table to a docxtpl row-loop template.

    Idempotent: running twice (even after ZWSP-neutralization of the injected
    tokens) produces identical XML.  No-op when the body has no table, two or
    more tables, or a table with merged cells.

    After the call the table has exactly four rows:
      row 0 - header (unchanged, with tblHeader flag)
      row 1 - {%tr for row in table_rows %}  (for-row)
      row 2 - n cells: {{ row.c0 }}, {{ row.c1 }}, ... (data-row)
      row 3 - {%tr endfor %}                           (endfor-row)
    """
    import copy

    from lxml import etree

    body: BaseOxmlElement = doc.element.body
    tbls = body.findall(qn("w:tbl"))
    if len(tbls) != 1:
        return

    tbl = tbls[0]
    rows = tbl.findall(qn("w:tr"))
    if not rows:
        return

    # If the table was previously normalized (possibly with ZWSP-broken tokens
    # after a neutralize pass), strip the directive rows so detect_table_schema
    # can classify the header row correctly on the second call.
    if len(rows) > 1:
        first_data_cells = rows[1].findall(qn("w:tc"))
        if first_data_cells and _strip_zwsp(_cell_text(first_data_cells[0])).startswith("{%tr"):
            for tr in rows[1:]:
                tbl.remove(tr)

    schema = detect_table_schema(doc)
    if schema is None:
        return

    n = len(schema)
    rows = tbl.findall(qn("w:tr"))
    header_row = rows[0]

    # --- capture run properties from header row (data rows were stripped above) ---
    style_source = header_row

    style_cells = style_source.findall(qn("w:tc"))
    rpr_copies: list[etree._Element | None] = []
    for i in range(n):
        tc = style_cells[i] if i < len(style_cells) else None
        rpr = tc.find(f".//{qn('w:rPr')}") if tc is not None else None
        rpr_copies.append(copy.deepcopy(rpr) if rpr is not None else None)

    # --- remove all data rows (everything after the header) ---
    for tr in rows[1:]:
        tbl.remove(tr)

    # --- build for-row: single cell with {%tr for row in table_rows %} ---
    def _single_cell_row(text: str) -> etree._Element:
        tr = etree.SubElement(tbl, qn("w:tr"))
        tc = etree.SubElement(tr, qn("w:tc"))
        p = etree.SubElement(tc, qn("w:p"))
        r = etree.SubElement(p, qn("w:r"))
        t = etree.SubElement(r, qn("w:t"))
        t.text = text
        return tr

    _single_cell_row("{%tr for row in table_rows %}")

    # --- build data-row: copy header row structure, replace cell contents ---
    data_row = copy.deepcopy(header_row)
    data_cells = data_row.findall(qn("w:tc"))
    for i, tc in enumerate(data_cells):
        # strip all paragraphs in this cell and replace with a single one
        for p in tc.findall(qn("w:p")):
            tc.remove(p)
        p = etree.SubElement(tc, qn("w:p"))
        r = etree.SubElement(p, qn("w:r"))
        if rpr_copies[i] is not None:
            r.insert(0, copy.deepcopy(rpr_copies[i]))
        t = etree.SubElement(r, qn("w:t"))
        t.text = f"{{{{ row.c{i} }}}}"
        t.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
    tbl.append(data_row)

    _single_cell_row("{%tr endfor %}")

    # --- set tblHeader on header row ---
    trPr = header_row.find(qn("w:trPr"))
    if trPr is None:
        trPr = etree.Element(qn("w:trPr"))
        header_row.insert(0, trPr)
    if trPr.find(qn("w:tblHeader")) is None:
        etree.SubElement(trPr, qn("w:tblHeader"))
