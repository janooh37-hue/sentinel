"""TDD: per-step leave SMS — request (on generation, Pending), approved, rejected,
cancelled — so the employee is notified at every leave state, not only approval.
"""

from datetime import date

import pytest

from app.db.models import Employee, Leave
from app.schemas.leave import LeaveUpdate
from app.services import leave_service, sms_client
from app.services import sms_service as ss


@pytest.fixture(autouse=True)
def _enable(monkeypatch):
    monkeypatch.setenv("GSSG_SMS_ENABLED", "1")
    monkeypatch.setenv("GSSG_SMS_GATEWAY_URL", "http://192.168.1.50:8080")
    monkeypatch.setenv("GSSG_SMS_USERNAME", "user")
    monkeypatch.setenv("GSSG_SMS_PASSWORD", "pass")
    from app.config import get_settings

    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture()
def _sent(monkeypatch):
    calls = []

    def fake_send(phone, text):
        calls.append((phone, text))
        return sms_client.SendResult(ok=True, message_id=f"sms-{len(calls)}")

    monkeypatch.setattr(sms_client, "send", fake_send)
    return calls


def _leave(db, *, status: str, leave_type: str = "Annual Leave", lid: int = 7) -> Leave:
    if db.get(Employee, "G1") is None:
        db.add(
            Employee(
                id="G1", name_en="John", name_ar="جون", contact="0501234567", msg_language="en"
            )
        )
    row = Leave(
        id=lid,
        employee_id="G1",
        leave_type=leave_type,
        start_date=date(2026, 7, 5),
        end_date=date(2026, 7, 9),
        days=5,
        status=status,
    )
    db.add(row)
    db.commit()
    return row


@pytest.mark.parametrize(
    "event",
    ["leave_requested", "leave_rejected", "leave_cancelled"],
)
def test_new_leave_events_render_and_send(db_session, _sent, event):
    _leave(db_session, status="Pending")
    row = ss.send_for_event(db_session, event, 7, sent_by=None)
    assert row.status == "sent"
    assert row.body  # non-empty rendered text
    assert len(_sent) == 1


@pytest.mark.parametrize(
    ("status", "expected_event"),
    [
        ("Pending", "leave_requested"),
        ("Approved", "leave_approved"),
        ("Rejected", "leave_rejected"),
        ("Cancelled", "leave_cancelled"),
    ],
)
def test_auto_send_leave_status_routes_by_status(db_session, _sent, status, expected_event):
    _leave(db_session, status=status)
    row = ss.auto_send_leave_status(db_session, 7)
    assert row is not None
    assert row.event_type == expected_event
    assert row.status == "sent"


def test_completed_status_sends_nothing(db_session, _sent):
    _leave(db_session, status="Completed")
    assert ss.auto_send_leave_status(db_session, 7) is None
    assert _sent == []


def test_new_template_wording_locked():
    """Lock the bilingual wording (and the two AR reviewer fixes) against regression."""
    from app.services import sms_templates as tpl

    emp = Employee(id="G2", name_en="A", name_ar="أ", contact="050", msg_language="en")
    leave = Leave(
        id=8,
        employee_id="G2",
        leave_type="Annual Leave",
        start_date=date(2026, 7, 5),
        end_date=date(2026, 7, 9),
        days=5,
        status="Pending",
    )
    req_en = tpl.render_text("leave_requested", "en", leave, emp)
    req_ar = tpl.render_text("leave_requested", "ar", leave, emp)
    assert "has been received" in req_en and "processed" in req_en
    assert "تم استلام طلب إجازتك" in req_ar and "قيد المعالجة" in req_ar
    assert "سيتم إشعارك بالموافقة" in req_ar

    assert "rejected" in tpl.render_text("leave_rejected", "en", leave, emp)
    assert "رفض" in tpl.render_text("leave_rejected", "ar", leave, emp)

    assert "cancelled" in tpl.render_text("leave_cancelled", "en", leave, emp)
    assert "إلغاء طلب إجازتك" in tpl.render_text("leave_cancelled", "ar", leave, emp)


def _book_with_doc(db, *, template_id, leave_id=None, violation_id=None):
    from app.db.models import Book, BookCategory, BookVersion, Document

    if db.get(BookCategory, "HR") is None:
        db.add(BookCategory(id="HR", prefix="HR"))
        db.flush()
    book = Book(category_id="HR", ref_number="HR-9", employee_id="G1", approval_state="approved")
    db.add(book)
    db.flush()
    doc = Document(
        employee_id="G1",
        template_id=template_id,
        ref_number="HR-9",
        docx_path="d.docx",
        pdf_path="d.pdf",
        submission_id="sub-x",
        role="primary",
        leave_id=leave_id,
        violation_id=violation_id,
    )
    db.add(doc)
    db.flush()
    db.add(
        BookVersion(
            book_id=book.id,
            version_no=1,
            status="approved",
            document_id=doc.id,
            template_id=template_id,
        )
    )
    db.commit()
    return book


def test_generate_leave_form_sends_request_sms(db_session, _sent):
    """The reported bug: generating a leave form now auto-sends (a 'request' SMS)."""
    _leave(db_session, status="Pending", leave_type="Annual Leave")
    book = _book_with_doc(db_session, template_id="Leave Application Form", leave_id=7)
    row = ss.auto_send_for_book(db_session, book.id)
    assert row is not None
    assert row.event_type == "leave_requested"
    assert row.status == "sent"


def test_generate_violation_form_sends_violation_sms(db_session, _sent):
    from datetime import date as _date

    from app.db.models import Violation

    if db_session.get(Employee, "G1") is None:
        db_session.add(
            Employee(
                id="G1", name_en="John", name_ar="جون", contact="0501234567", msg_language="en"
            )
        )
    db_session.add(
        Violation(id=3, employee_id="G1", violation_type="lateness", date=_date(2026, 7, 5))
    )
    db_session.commit()
    book = _book_with_doc(db_session, template_id="Violation Form", violation_id=3)
    row = ss.auto_send_for_book(db_session, book.id)
    assert row is not None
    assert row.event_type == "violation"
    assert row.status == "sent"


def test_update_leave_status_change_triggers_sms(db_session, _sent):
    _leave(db_session, status="Pending", leave_type="Annual Leave")
    leave_service.update_leave(db_session, 7, LeaveUpdate(status="Rejected"))
    # a leave_rejected SMS was logged for this leave
    last = ss.last_status(db_session, "leave_rejected", 7)
    assert last is not None
    assert last.status == "sent"
    assert len(_sent) == 1
