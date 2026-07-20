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
