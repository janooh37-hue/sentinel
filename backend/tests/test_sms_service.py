from datetime import date

import pytest

from app.db.models import Employee, Leave
from app.services import sms_client
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


def _leave(db, **kw):
    db.add(
        Employee(
            id="G1",
            name_en="John",
            name_ar="جون",
            contact=kw.pop("contact", "0501234567"),
            msg_language=kw.pop("lang", "ar"),
        )
    )
    row = Leave(
        id=7,
        employee_id="G1",
        leave_type="Annual - سنوية",
        start_date=date(2026, 7, 5),
        end_date=date(2026, 7, 9),
        days=5,
        status="Approved",
    )
    db.add(row)
    db.commit()
    return row


def test_send_success_logs_sent(db_session, monkeypatch):
    _leave(db_session)
    monkeypatch.setattr(
        sms_client,
        "send",
        lambda *a, **k: sms_client.SendResult(ok=True, message_id="sms-1"),
    )
    row = ss.send_for_event(db_session, "leave_approved", 7, sent_by=99)
    assert row.status == "sent"
    assert row.provider_msg_id == "sms-1"
    assert row.phone == "+971501234567"
    assert row.sent_by == 99
    assert ss.last_status(db_session, "leave_approved", 7).id == row.id


def test_send_passes_rendered_text_to_client(db_session, monkeypatch):
    _leave(db_session, lang="en")
    captured = {}

    def fake_send(phone, text):
        captured["phone"] = phone
        captured["text"] = text
        return sms_client.SendResult(ok=True, message_id="sms-2")

    monkeypatch.setattr(sms_client, "send", fake_send)
    ss.send_for_event(db_session, "leave_approved", 7, sent_by=1)
    assert captured["phone"] == "+971501234567"
    assert captured["text"].startswith("Dear John,")
    assert captured["text"].endswith("Al Wathba Rehabilitation Centre")


def test_missing_phone_logs_failed_without_calling_client(db_session, monkeypatch):
    _leave(db_session, contact="n/a")
    called = {"n": 0}

    def boom(*a, **k):
        called["n"] += 1
        raise AssertionError("client must not be called")

    monkeypatch.setattr(sms_client, "send", boom)
    row = ss.send_for_event(db_session, "leave_approved", 7, sent_by=1)
    assert row.status == "failed"
    assert "phone" in row.error.lower()
    assert called["n"] == 0


def test_api_failure_logs_failed_with_error(db_session, monkeypatch):
    _leave(db_session)
    monkeypatch.setattr(
        sms_client,
        "send",
        lambda *a, **k: sms_client.SendResult(ok=False, error="HTTP 401: Unauthorized"),
    )
    row = ss.send_for_event(db_session, "leave_approved", 7, sent_by=1)
    assert row.status == "failed"
    assert row.error == "HTTP 401: Unauthorized"


def test_resend_writes_new_row(db_session, monkeypatch):
    _leave(db_session)
    monkeypatch.setattr(
        sms_client,
        "send",
        lambda *a, **k: sms_client.SendResult(ok=True, message_id="sms-x"),
    )
    r1 = ss.send_for_event(db_session, "leave_approved", 7, sent_by=1)
    r2 = ss.send_for_event(db_session, "leave_approved", 7, sent_by=1)
    assert r1.id != r2.id
    assert ss.last_status(db_session, "leave_approved", 7).id == r2.id


def test_disabled_raises(db_session, monkeypatch):
    monkeypatch.setenv("GSSG_SMS_ENABLED", "0")
    from app.config import get_settings

    get_settings.cache_clear()
    _leave(db_session)
    with pytest.raises(ss.SmsDisabledError):
        ss.send_for_event(db_session, "leave_approved", 7, sent_by=1)


def test_unknown_record_raises(db_session):
    with pytest.raises(ss.RecordNotFoundError):
        ss.send_for_event(db_session, "leave_approved", 9999, sent_by=1)


def test_load_book_event_returns_latest_version_fields(db_session):
    from app.db.models import Book, BookCategory, BookVersion

    db_session.add(BookCategory(id="HR", prefix="HR"))
    db_session.add(Employee(id="E1", name_en="Mohammed Ahmed", name_ar="محمد أحمد"))
    db_session.flush()
    book = Book(category_id="HR", ref_number="HR-0001", employee_id="E1")
    db_session.add(book)
    db_session.flush()
    db_session.add(
        BookVersion(
            book_id=book.id,
            version_no=1,
            template_id="Salary Transfer Request",
            fields={"bank_name": "OLD"},
        )
    )
    db_session.add(
        BookVersion(
            book_id=book.id,
            version_no=2,
            template_id="Salary Transfer Request",
            fields={"bank_name": "بنك أبوظبي الأول"},
        )
    )
    db_session.commit()

    ev = ss._load_book_event(db_session, book.id)
    assert ev is not None
    assert ev.employee.id == "E1"
    assert ev.fields["bank_name"] == "بنك أبوظبي الأول"
    assert ev.today == date.today()


def test_load_book_event_missing_book_returns_none(db_session):
    assert ss._load_book_event(db_session, 999999) is None


def test_all_book_events_have_a_loader():
    from app.services import notify_format as nf

    for ev in nf.BOOK_EVENTS:
        assert ss._LOADERS.get(ev) is ss._load_book_event


def test_send_persists_body(db_session, monkeypatch):
    _leave(db_session)  # existing helper: creates employee G1 + leave id 7
    monkeypatch.setattr(
        sms_client, "send", lambda *a, **k: sms_client.SendResult(ok=True, message_id="m1")
    )
    row = ss.send_for_event(db_session, "leave_approved", 7, sent_by=1)
    assert row.body and row.body.startswith("عزيزي")  # ar default employee


def test_failed_send_still_persists_body(db_session, monkeypatch):
    _leave(db_session, contact="n/a")  # unparseable phone -> failed, client not called
    row = ss.send_for_event(db_session, "leave_approved", 7, sent_by=1)
    assert row.status == "failed"
    assert row.body and row.body.startswith("عزيزي")


def _book(db, template_id, *, employee_id="E1"):
    from app.db.models import Book, BookCategory, BookVersion, Employee

    if db.get(Employee, employee_id) is None:
        db.add(
            Employee(
                id=employee_id,
                name_en="Mohammed Ahmed",
                name_ar="محمد أحمد",
                contact="0501234567",
                msg_language="ar",
            )
        )
    if db.get(BookCategory, "HR") is None:
        db.add(BookCategory(id="HR", prefix="HR"))
    db.flush()
    b = Book(category_id="HR", ref_number="HR-0001", employee_id=employee_id)
    db.add(b)
    db.flush()
    db.add(
        BookVersion(
            book_id=b.id,
            version_no=1,
            template_id=template_id,
            fields={"bank_name": "بنك أبوظبي الأول"},
        )
    )
    db.commit()
    return b


def test_auto_send_fires_for_mapped_template(db_session, monkeypatch):
    b = _book(db_session, "Salary Transfer Request")
    monkeypatch.setattr(
        sms_client, "send", lambda *a, **k: sms_client.SendResult(ok=True, message_id="m1")
    )
    row = ss.auto_send_for_book(db_session, b.id)
    assert row is not None and row.status == "sent" and row.sent_by is None


def test_auto_send_skips_unmapped_template(db_session):
    b = _book(db_session, "General Book")
    assert ss.auto_send_for_book(db_session, b.id) is None


def test_auto_send_skips_when_setting_off(db_session, monkeypatch):
    from app.schemas.settings import AppSettingsUpdate
    from app.services import settings_service

    settings_service.update_settings(db_session, AppSettingsUpdate(sms_autosend_enabled=False))
    b = _book(db_session, "Salary Transfer Request")
    assert ss.auto_send_for_book(db_session, b.id) is None


def test_auto_send_skips_book_without_employee(db_session, monkeypatch):
    from app.db.models import Book, BookCategory, BookVersion

    if db_session.get(BookCategory, "HR") is None:
        db_session.add(BookCategory(id="HR", prefix="HR"))
        db_session.flush()
    b = Book(category_id="HR", ref_number="HR-0002", employee_id=None)
    db_session.add(b)
    db_session.flush()
    db_session.add(BookVersion(book_id=b.id, version_no=1, template_id="Warning Form", fields={}))
    db_session.commit()
    assert ss.auto_send_for_book(db_session, b.id) is None
