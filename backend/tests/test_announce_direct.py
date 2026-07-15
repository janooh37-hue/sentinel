"""send_direct_announcement — text routing, unknown ids, attachment path."""

from types import SimpleNamespace

from app.db.models import Employee
from app.services import announce_service, notify_dispatch, openwa_client


def _emp(db, emp_id="GD1", contact="0501234567"):
    emp = Employee(
        id=emp_id, name_en=f"Direct {emp_id}", name_ar="مباشر", msg_language="en", contact=contact
    )
    db.add(emp)
    db.commit()
    return emp


def test_direct_text_routes_through_send_direct(db_session, monkeypatch):
    emp = _emp(db_session)
    calls: list[dict] = []

    def fake_send_direct(db, *, employee, body, language, event_type, event_ref, sent_by):
        calls.append({"emp": employee.id, "body": body, "event": event_type})
        return SimpleNamespace(status="sent", fell_back=False, error=None)

    monkeypatch.setattr(notify_dispatch, "send_direct", fake_send_direct)
    out = announce_service.send_direct_announcement(
        db_session, employee_ids=[emp.id], text="hello", attachment=None, sent_by=1
    )
    assert calls == [{"emp": "GD1", "body": "hello", "event": "announcement_direct"}]
    assert out[0].ok is True and out[0].employee_id == "GD1"


def test_direct_unknown_employee_is_failed_row(db_session):
    out = announce_service.send_direct_announcement(
        db_session, employee_ids=["NOPE"], text="hello", attachment=None, sent_by=1
    )
    assert out[0].ok is False
    assert out[0].error == "employee not found"


def test_direct_attachment_uses_whatsapp_file_send(db_session, monkeypatch):
    emp = _emp(db_session, emp_id="GD2")
    sent: list[dict] = []

    def fake_send_file(chat_id, *, data, filename, caption, mentions=None):
        sent.append({"chat": chat_id, "filename": filename, "caption": caption})
        return SimpleNamespace(ok=True, message_id="m1", error=None)

    monkeypatch.setattr(openwa_client, "send_file", fake_send_file)
    att = announce_service.Attachment(filename="roster.pdf", data=b"%PDF")
    out = announce_service.send_direct_announcement(
        db_session, employee_ids=[emp.id], text="see attached", attachment=att, sent_by=1
    )
    assert out[0].ok is True
    assert sent[0]["filename"] == "roster.pdf"
    assert sent[0]["chat"].endswith("@c.us")
