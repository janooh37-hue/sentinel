from pathlib import Path

from docx import Document

from app.core.book_template_retokenize import retokenize_general_book
from app.core.book_text import docx_to_text


def _book_with_table(tmp_path: Path, headers: list[str], data_rows: list[list[str]]) -> Path:
    p = tmp_path / "book_tbl.docx"
    doc = Document()
    doc.add_paragraph("الرقم: 1/5/141")
    doc.add_paragraph("التاريخ: 20-07-2026")
    doc.add_paragraph("الموضوع: قائمة الموظفين في الإدارة المحترمة")
    doc.add_paragraph("تفاصيل القائمة:")
    t = doc.add_table(rows=1 + len(data_rows), cols=len(headers))
    for i, h in enumerate(headers):
        t.cell(0, i).text = h
    for r, row in enumerate(data_rows, start=1):
        for c, v in enumerate(row):
            t.cell(r, c).text = v
    doc.save(str(p))
    return p


def test_retokenize_normalizes_table(tmp_path: Path) -> None:
    p = _book_with_table(tmp_path, ["الاسم", "الرقم"], [["أحمد", "G-001"], ["خالد", "G-002"]])
    retokenize_general_book(p)
    text = docx_to_text(p)
    assert "{%tr for row in table_rows %}" in text
    assert "{{ row.c0 }}" in text
    assert "G-001" not in text  # PII stripped


def test_retokenize_table_idempotent(tmp_path: Path) -> None:
    p = _book_with_table(tmp_path, ["أ", "ب"], [["x", "y"]])
    retokenize_general_book(p)
    t1 = docx_to_text(p)
    retokenize_general_book(p)
    t2 = docx_to_text(p)
    assert t1 == t2


def test_retokenize_plain_book_no_table_tokens(tmp_path: Path) -> None:
    p = tmp_path / "plain.docx"
    doc = Document()
    doc.add_paragraph("الرقم: 1/5/141")
    doc.add_paragraph("التاريخ: 20-07-2026")
    doc.add_paragraph("السيد / مدير الإدارة المحترم")
    doc.add_paragraph("الموضوع: موضوع الكتاب في نص طويل نسبياً هنا")
    doc.add_paragraph("نص الكتاب هنا")
    doc.save(str(p))
    retokenize_general_book(p)
    text = docx_to_text(p)
    assert "{%tr" not in text
    assert "{{ ref }}" in text


def test_retokenize_two_table_book_no_tokens(tmp_path: Path) -> None:
    p = tmp_path / "two.docx"
    doc = Document()
    doc.add_paragraph("الرقم: 1/5/141")
    doc.add_paragraph("التاريخ: 20-07-2026")
    doc.add_paragraph("الموضوع: كتاب عادي بجدولين بيانيين للاختبار")
    doc.add_paragraph("نص الكتاب")
    for _ in range(2):
        t = doc.add_table(rows=2, cols=2)
        t.cell(0, 0).text = "هـ"
    doc.save(str(p))
    retokenize_general_book(p)
    text = docx_to_text(p)
    assert "{%tr" not in text
