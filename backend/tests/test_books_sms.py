"""TDD: book-detail API exposes per-book notification history (unified outbound log).

Tests for:
  - messages_for_book() helper returns OutboundMessage rows for a mapped-template book
  - messages_for_book() returns [] for an unmapped-template book
  - NotifyMessageRead.model_validate round-trips correctly from OutboundMessage
  - sms_for_book alias still works (backward compat)
"""

from __future__ import annotations

from app.db.models import Book, BookCategory, BookVersion, Employee, OutboundMessage
from app.schemas.notify import NotifyMessageRead
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


def test_messages_for_book_returns_outbound_for_mapped_template(db_session):
    """A book with a salary-transfer template + a matching OutboundMessage row is returned."""
    book = _make_book(db_session, "Salary Transfer Request")
    event = nf.TEMPLATE_EVENTS["Salary Transfer Request"]  # "salary_transfer"
    db_session.add(
        OutboundMessage(
            employee_id="G10",
            event_type=event,
            event_ref=f"{event}:{book.id}",
            language="ar",
            phone="+971501234567",
            channel="sms",
            status="sent",
            body="تم تحويل راتبك",
        )
    )
    db_session.commit()

    result = book_service.messages_for_book(db_session, book)

    assert len(result) == 1
    assert result[0].status == "sent"
    assert result[0].body == "تم تحويل راتبك"


def test_sms_for_book_alias_works(db_session):
    """sms_for_book is a backward-compat alias for messages_for_book."""
    book = _make_book(db_session, "Salary Transfer Request")
    event = nf.TEMPLATE_EVENTS["Salary Transfer Request"]
    db_session.add(
        OutboundMessage(
            employee_id="G10",
            event_type=event,
            event_ref=f"{event}:{book.id}",
            language="ar",
            phone="+971501234567",
            channel="whatsapp",
            status="sent",
            body="WhatsApp message",
        )
    )
    db_session.commit()

    result = book_service.sms_for_book(db_session, book)

    assert len(result) == 1
    assert result[0].channel == "whatsapp"


def test_messages_for_book_returns_empty_for_unmapped_template(db_session):
    """A book whose template_id is not in TEMPLATE_EVENTS returns an empty list."""
    book = _make_book(db_session, "General Book")

    result = book_service.messages_for_book(db_session, book)

    assert result == []


def test_notify_message_read_validates_from_outbound_message(db_session):
    """NotifyMessageRead.model_validate works on a real OutboundMessage row."""
    book = _make_book(db_session, "Salary Transfer Request")
    event = nf.TEMPLATE_EVENTS["Salary Transfer Request"]
    msg = OutboundMessage(
        employee_id="G10",
        event_type=event,
        event_ref=f"{event}:{book.id}",
        language="ar",
        phone="+971501234567",
        channel="sms",
        status="failed",
        error="HTTP 500",
        body=None,
    )
    db_session.add(msg)
    db_session.commit()
    db_session.refresh(msg)

    read = NotifyMessageRead.model_validate(msg)
    assert read.status == "failed"
    assert read.error == "HTTP 500"
    assert read.body is None
    assert read.phone == "+971501234567"


def test_bookread_builds_with_sms_field():
    """BookRead.model_validate must succeed — regression for missing NotifyMessageRead import."""
    from app.schemas.book import BookRead

    m = BookRead.model_validate(
        {
            "id": 1,
            "ref_number": "R-1",
            "category_id": "c",
            "subject": None,
            "direction": None,
            "stamp_style": None,
            "created_at": "2026-07-06T00:00:00",
            "deleted_at": None,
            "priority": "Normal",
            "approval_state": "none",
        }
    )
    assert m.sms == []


def test_messages_for_book_empty_when_no_versions(db_session):
    """A book with no versions (no template) returns an empty list."""
    if db_session.get(BookCategory, "HR") is None:
        db_session.add(BookCategory(id="HR", prefix="HR"))
    db_session.flush()
    book = Book(category_id="HR", ref_number="HR-0000")
    db_session.add(book)
    db_session.commit()
    db_session.refresh(book)

    result = book_service.messages_for_book(db_session, book)

    assert result == []
