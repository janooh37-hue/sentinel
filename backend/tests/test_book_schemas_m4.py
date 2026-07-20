from datetime import datetime

from app.schemas.book import WordBookCreate, WordTemplateRead, WordTemplateTableRead


def test_word_template_table_read():
    s = WordTemplateTableRead(has_table=True, columns=["الاسم", "الرقم"])
    assert s.has_table is True and s.columns == ["الاسم", "الرقم"]


def test_word_template_table_read_empty():
    s = WordTemplateTableRead(has_table=False, columns=[])
    assert s.has_table is False and s.columns == []


def test_word_template_read_default_kind_custom():
    t = WordTemplateRead(name="x.docx", modified_at=datetime.now())
    assert t.kind == "custom"


def test_word_template_read_base_kind():
    t = WordTemplateRead(name="base_text.docx", modified_at=datetime.now(), kind="base")
    assert t.kind == "base"


def test_word_book_create_table_rows_defaults_none():
    w = WordBookCreate(subject="اختبار")
    assert w.table_rows is None


def test_word_book_create_accepts_table_rows():
    w = WordBookCreate(subject="اختبار", table_rows=[{"c0": "أحمد", "c1": "الأمن"}])
    assert w.table_rows == [{"c0": "أحمد", "c1": "الأمن"}]
