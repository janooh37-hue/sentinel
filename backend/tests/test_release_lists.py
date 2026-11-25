"""Release lists (Passport, Work ID, UAE ID): styled item rows + unfilled slots trimmed.

Both are page-geometry regressions — the passport form used to render 2 pages
even with zero employees, and only the first 3 of its 15 item rows carried the
table styling (the rest were raw Excel-paste leftovers: no borders, no centring,
Times New Roman 10pt). The Work ID and UAE ID papers are clones of it and share
the trim. Page count itself needs Word COM, so it is checked by hand via the
render script; these assertions cover the causes.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from docx import Document
from docx.oxml.ns import qn

from app.core.constants import TEMPLATE_FILES
from app.core.docx_engine import DocxEngine

TEMPLATES = Path(__file__).resolve().parents[1] / "templates"
FIRST_ITEM_ROW = 7
ITEM_SLOTS = 15

# template id -> (document-specific item keys, signature-block label)
LISTS: dict[str, tuple[tuple[str, ...], str]] = {
    "Passport Release List": (("nationality", "passport_no"), "تم إستلام جوازات السفر"),
    "Work ID Release List": (("nationality", "position"), "تم إستلام بطاقات العمل"),
    "UAE ID Release List": (
        ("nationality", "uae_id_no", "uae_id_expiry"),
        "تم إستلام بطاقات الهوية",
    ),
}
SAMPLE = {
    "nationality": "الهند",
    "passport_no": "P1234567",
    "position": "حارس أمن",
    "uae_id_no": "784-1990-1234567-1",
    "uae_id_expiry": "14/03/2028",
}

pytestmark = pytest.mark.parametrize("template_id", list(LISTS))


def _items(template_id: str, n: int) -> list[dict[str, str]]:
    keys, _ = LISTS[template_id]
    return [
        {"employee_id": f"G{3000 + i}", "name": "محمد عبدالله الهاشمي"}
        | {key: SAMPLE[key] for key in keys}
        for i in range(n)
    ]


def _render(tmp_path: Path, template_id: str, n: int) -> Any:
    out = tmp_path / f"list_{n}.docx"
    DocxEngine(TEMPLATES).fill(template_id, {"items": _items(template_id, n)}, out)
    return Document(str(out)).tables[0]


def _border(cell: Any, edge: str) -> str | None:
    borders = cell._tc.tcPr.find(qn("w:tcBorders"))
    if borders is None:
        return None
    side = borders.find(qn(f"w:{edge}"))
    return None if side is None else str(side.get(qn("w:val")))


def test_every_item_slot_is_styled_like_the_first(template_id: str) -> None:
    """Slots 3-14 used to be borderless, left-aligned and a different font, so
    the 4th employee onward rendered as naked text under the table."""
    table = Document(str(TEMPLATES / TEMPLATE_FILES[template_id])).tables[0]
    first = table.rows[FIRST_ITEM_ROW]
    for slot in range(ITEM_SLOTS):
        row = table.rows[FIRST_ITEM_ROW + slot]
        assert row.cells[0].text.strip() == f"{{{{ item({slot}, 'employee_id') }}}}"
        for col, reference in enumerate(first.cells):
            cell = row.cells[col]
            assert _border(cell, "left") == _border(reference, "left") != "nil"
            assert _border(cell, "bottom") == _border(reference, "bottom") != "nil"
            jc = cell.paragraphs[0]._p.get_or_add_pPr().find(qn("w:jc"))
            assert jc is not None and jc.get(qn("w:val")) == "center"


def test_each_document_field_lands_in_its_row(tmp_path: Path, template_id: str) -> None:
    """A placeholder the template forgot (e.g. the UAE expiry) renders as nothing."""
    table = _render(tmp_path, template_id, 2)
    keys, _ = LISTS[template_id]
    for i in range(2):
        texts = [c.text.strip() for c in table.rows[FIRST_ITEM_ROW + i].cells]
        assert f"G{3000 + i}" in texts
        for key in keys:
            assert SAMPLE[key] in texts, key


def test_unfilled_slots_are_removed(tmp_path: Path, template_id: str) -> None:
    """The blank tail rows are what pushed the signature block onto page 2."""
    for n in (0, 1, 8):
        table = _render(tmp_path, template_id, n)
        filled = [r for r in table.rows if r.cells[0].text.strip().startswith("G3")]
        assert len(filled) == n
        blank_after_header = [
            r
            for r in table.rows[FIRST_ITEM_ROW : FIRST_ITEM_ROW + ITEM_SLOTS]
            if not any(c.text.strip() for c in r.cells)
        ]
        assert blank_after_header == []


def test_full_list_keeps_all_fifteen_rows(tmp_path: Path, template_id: str) -> None:
    table = _render(tmp_path, template_id, ITEM_SLOTS)
    filled = [r for r in table.rows if r.cells[0].text.strip().startswith("G3")]
    assert len(filled) == ITEM_SLOTS


def test_signature_block_survives_the_trim(tmp_path: Path, template_id: str) -> None:
    """Deleting rows must not touch the block below them (same table)."""
    _, label = LISTS[template_id]
    for n in (0, 8, ITEM_SLOTS):
        table = _render(tmp_path, template_id, n)
        assert any(label in r.cells[0].text for r in table.rows)
