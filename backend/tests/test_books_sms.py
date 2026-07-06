"""TDD: book-detail API exposes per-book SMS notification history.

Tests for:
  - sms_for_book() helper returns SMS rows for a mapped-template book
  - sms_for_book() returns [] for an unmapped-template book
  - SmsMessageRead.model_validate round-trips correctly
"""

from __future__ import annotations

from app.db.models import Book, BookCategory, BookVersion, Employee, SmsMessage
from app.schemas.sms import SmsMessageRead
from app.services import book_service
from app.services import notify_format as nf

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_book(db, template_id: str, *, employee_id: str = "G10") -> Book:
    """Create a minimal Book + BookVersion with the given template_id."""
    if db.get(Employee, employee_id) is None:
        db.add(
            Employee(
                id=employee_id,
                name_en="Test Employee",
                name_ar="موظف اختبار",
                contact="0501234567",
                msg_language="ar",
            )
        )
    if db.get(BookCategory, "HR") is None:
        db.add(BookCategory(id="HR", prefix="HR"))
    db.flush()
    book = Book(category_id="HR", ref_number="HR-9999", employee_id=employee_id)
    db.add(book)
    db.flush()
    db.add(
        BookVersion(
            book_id=book.id,
            version_no=1,
            template_id=template_id,
        )
    )
    db.commit()
    db.refresh(book)
    return book


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_sms_for_book_returns_sms_for_mapped_template(db_session):
    """A book with a salary-transfer template + a matching SmsMessage row is returned."""
    book = _make_book(db_session, "Salary Transfer Request")
    event = nf.TEMPLATE_EVENTS["Salary Transfer Request"]  # "salary_transfer"
    db_session.add(
        SmsMessage(
            employee_id="G10",
            event_type=event,
            event_ref=f"{event}:{book.id}",
            language="ar",
            phone="+971501234567",
            status="sent",
            body="تم تحويل راتبك",
        )
    )
    db_session.commit()

    result = book_service.sms_for_book(db_session, book)

    assert len(result) == 1
    assert result[0].status == "sent"
    assert result[0].body == "تم تحويل راتبك"


def test_sms_for_book_returns_empty_for_unmapped_template(db_session):
    """A book whose template_id is not in TEMPLATE_EVENTS returns an empty list."""
    book = _make_book(db_session, "General Book")

    result = book_service.sms_for_book(db_session, book)

    assert result == []


def test_sms_message_read_validates_from_orm(db_session):
    """SmsMessageRead.model_validate works on a real SmsMessage row."""
    book = _make_book(db_session, "Salary Transfer Request")
    event = nf.TEMPLATE_EVENTS["Salary Transfer Request"]
    sms = SmsMessage(
        employee_id="G10",
        event_type=event,
        event_ref=f"{event}:{book.id}",
        language="ar",
        phone="+971501234567",
        status="failed",
        error="HTTP 500",
        body=None,
    )
    db_session.add(sms)
    db_session.commit()
    db_session.refresh(sms)

    read = SmsMessageRead.model_validate(sms)
    assert read.status == "failed"
    assert read.error == "HTTP 500"
    assert read.body is None


def test_sms_for_book_empty_when_no_versions(db_session):
    """A book with no versions (no template) returns an empty list."""
    if db_session.get(BookCategory, "HR") is None:
        db_session.add(BookCategory(id="HR", prefix="HR"))
    db_session.flush()
    book = Book(category_id="HR", ref_number="HR-0000")
    db_session.add(book)
    db_session.commit()
    db_session.refresh(book)

    result = book_service.sms_for_book(db_session, book)

    assert result == []
