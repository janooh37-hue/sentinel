"""Per-event default send: the decision table for automatic employee notifications.

``msgdefault.<event>`` (absent = on) is each event's default. True/False on a
record is the operator's explicit choice; None follows the default. A send the
default or the operator suppresses logs one terminal ``skipped`` row.
"""

from datetime import date, datetime, timedelta
from pathlib import Path
from unittest.mock import Mock

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect, select

from app.api.deps import get_current_user
from app.config import get_settings
from app.db.models import (
    AppSetting,
    AuditLog,
    Book,
    BookCategory,
    BookVersion,
    Employee,
    Leave,
    OutboundMessage,
    User,
)
from app.db.session import get_db
from app.main import create_app
from app.schemas.leave import LeaveUpdate
from app.services import (
    book_service,
    leave_service,
    message_template_service,
    notify_dispatch,
    perm_service,
    sms_client,
    sms_templates,
)
from tests.test_leave_sign_gate import (
    _clearance,
    _log_sends,
    _make_gate_env,
    _sign,
    decide,
    generate,
    submit,
)

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture()
def gate_env(db_session, tmp_path, monkeypatch):
    return _make_gate_env(db_session, tmp_path, monkeypatch)


def _default_off(db, event: str) -> None:
    message_template_service.save_default(db, event, False, actor="test")


def _rows(db, event_ref: str | None = None) -> list[OutboundMessage]:
    stmt = select(OutboundMessage).order_by(OutboundMessage.id)
    if event_ref is not None:
        stmt = stmt.where(OutboundMessage.event_ref == event_ref)
    return list(db.scalars(stmt))


@pytest.fixture()
def dispatch_env(db_session, monkeypatch):
    """Auto-send on; real sends recorded, never reaching a gateway."""
    monkeypatch.setattr(notify_dispatch, "_autosend_enabled", lambda _: True)
    send = Mock()
    monkeypatch.setattr(notify_dispatch, "send_for_event", send)
    direct = Mock()
    monkeypatch.setattr(notify_dispatch, "send_direct", direct)
    db_session.add(
        Employee(id="ND1", name_en="Default Send", name_ar="افتراضي", contact="0501234567")
    )
    db_session.commit()
    return send, direct


def _leave(db, status: str = "Pending", **kw) -> Leave:
    leave = Leave(
        employee_id="ND1",
        leave_type=kw.pop("leave_type", "Annual Leave"),
        start_date=kw.pop("start_date", date(2026, 11, 10)),
        end_date=kw.pop("end_date", date(2026, 11, 14)),
        days=5,
        status=status,
        **kw,
    )
    db.add(leave)
    db.commit()
    return leave


def _assert_skip(row: OutboundMessage, *, event: str, record_id: int, reason: str) -> None:
    assert row.status == "skipped"
    assert row.skip_reason == reason
    assert row.event_type == event
    assert row.event_ref == f"{event}:{record_id}"
    assert row.employee_id == "ND1"
    assert row.channel is None and row.body is None
    assert row.language in {"ar", "en"}


# ── Prefill events: None follows the default; explicit choice wins ───────────


def test_prefill_none_with_default_on_sends(db_session, dispatch_env):
    send, _ = dispatch_env
    leave = _leave(db_session)
    leave_service.update_leave(db_session, leave.id, LeaveUpdate(status="Approved"))
    assert [c.args[1:3] for c in send.call_args_list] == [("leave_approved", leave.id)]
    assert _rows(db_session) == []


def test_prefill_none_with_default_off_logs_default_off(db_session, dispatch_env):
    send, _ = dispatch_env
    _default_off(db_session, "leave_approved")
    leave = _leave(db_session)
    leave_service.update_leave(db_session, leave.id, LeaveUpdate(status="Approved"))
    send.assert_not_called()
    [row] = _rows(db_session)
    _assert_skip(row, event="leave_approved", record_id=leave.id, reason="default_off")
    assert row.phone  # same normalized phone a real send would have used


def test_prefill_explicit_true_sends_even_when_default_off(db_session, dispatch_env):
    send, _ = dispatch_env
    _default_off(db_session, "leave_approved")
    leave = _leave(db_session)
    leave_service.update_leave(
        db_session, leave.id, LeaveUpdate(status="Approved", notify_employee=True)
    )
    assert [c.args[1:3] for c in send.call_args_list] == [("leave_approved", leave.id)]
    assert _rows(db_session) == []


def test_prefill_explicit_false_logs_user_off(db_session, dispatch_env):
    send, _ = dispatch_env
    leave = _leave(db_session)
    leave_service.update_leave(
        db_session, leave.id, LeaveUpdate(status="Approved", notify_employee=False)
    )
    send.assert_not_called()
    [row] = _rows(db_session)
    _assert_skip(row, event="leave_approved", record_id=leave.id, reason="user_off")


def test_on_save_form_choice_reaches_the_generated_book(db_session, dispatch_env):
    """The generate route's on-save send: None follows the default, False skips."""
    send, _ = dispatch_env
    db_session.add(BookCategory(id="HR", prefix="HR"))
    books = []
    for ref in ("HR-9001", "HR-9002", "HR-9003"):
        book = Book(category_id="HR", ref_number=ref, employee_id="ND1")
        book.versions.append(
            BookVersion(version_no=1, template_id="Salary Deduction Form", fields={})
        )
        db_session.add(book)
        books.append(book)
    db_session.commit()
    notify_dispatch.auto_send_for_book(db_session, books[0].id, sent_by=7, choice=None)
    notify_dispatch.auto_send_for_book(db_session, books[1].id, sent_by=7, choice=False)
    _default_off(db_session, "salary_deduction")
    notify_dispatch.auto_send_for_book(db_session, books[2].id, sent_by=7, choice=None)
    assert [c.args[1:3] for c in send.call_args_list] == [("salary_deduction", books[0].id)]
    user_off, default_off = _rows(db_session)
    _assert_skip(user_off, event="salary_deduction", record_id=books[1].id, reason="user_off")
    _assert_skip(default_off, event="salary_deduction", record_id=books[2].id, reason="default_off")
    assert user_off.sent_by == 7 and user_off.employee_id == "ND1"


def test_resave_reusing_a_record_keeps_the_earlier_result_final(
    db_session, dispatch_env, monkeypatch
):
    """A second save that maps to the same record (e.g. a re-saved Leave
    Application reusing its leave) neither re-skips nor sends after a skip;
    only a failed attempt is retried."""
    send, _ = dispatch_env
    db_session.add(BookCategory(id="HR", prefix="HR"))
    books = []
    for ref in ("HR-9101", "HR-9102", "HR-9103"):
        book = Book(category_id="HR", ref_number=ref, employee_id="ND1")
        book.versions.append(
            BookVersion(version_no=1, template_id="Salary Deduction Form", fields={})
        )
        db_session.add(book)
        books.append(book)
    db_session.commit()
    record_id = books[0].id
    monkeypatch.setattr(
        notify_dispatch, "book_event", lambda _db, _book: ("salary_deduction", record_id)
    )
    _default_off(db_session, "salary_deduction")
    notify_dispatch.auto_send_for_book(db_session, books[0].id, choice=None)
    message_template_service.save_default(db_session, "salary_deduction", True, actor="test")
    notify_dispatch.auto_send_for_book(db_session, books[1].id, choice=None)
    assert send.call_count == 0
    [skip] = _rows(db_session)
    _assert_skip(skip, event="salary_deduction", record_id=record_id, reason="default_off")

    skip.status, skip.skip_reason = "failed", None
    db_session.commit()
    notify_dispatch.auto_send_for_book(db_session, books[2].id, choice=None)
    assert [c.args[1:3] for c in send.call_args_list] == [("salary_deduction", record_id)]


# ── Auto-only events: plain default on/off; explicit PATCH choice honoured ───


@pytest.mark.parametrize(
    ("start", "target", "event"),
    [("Pending", "Rejected", "leave_rejected"), ("Approved", "Cancelled", "leave_cancelled")],
)
def test_auto_event_follows_its_default(db_session, dispatch_env, start, target, event):
    send, _ = dispatch_env
    on = _leave(db_session, start)
    leave_service.update_leave(db_session, on.id, LeaveUpdate(status=target))
    assert [c.args[1:3] for c in send.call_args_list] == [(event, on.id)]
    _default_off(db_session, event)
    off = _leave(db_session, start, start_date=date(2026, 12, 1), end_date=date(2026, 12, 5))
    leave_service.update_leave(db_session, off.id, LeaveUpdate(status=target))
    assert send.call_count == 1
    [row] = _rows(db_session)
    _assert_skip(row, event=event, record_id=off.id, reason="default_off")


def test_auto_event_explicit_patch_choice_is_honoured(db_session, dispatch_env):
    send, _ = dispatch_env
    _default_off(db_session, "leave_rejected")
    forced = _leave(db_session)
    leave_service.update_leave(
        db_session, forced.id, LeaveUpdate(status="Rejected", notify_employee=True)
    )
    assert [c.args[1:3] for c in send.call_args_list] == [("leave_rejected", forced.id)]
    muted = _leave(db_session, start_date=date(2026, 12, 1), end_date=date(2026, 12, 5))
    leave_service.update_leave(
        db_session, muted.id, LeaveUpdate(status="Rejected", notify_employee=False)
    )
    assert send.call_count == 1
    [row] = _rows(db_session)
    _assert_skip(row, event="leave_rejected", record_id=muted.id, reason="user_off")


def test_amended_follows_its_default(db_session, dispatch_env):
    _, direct = dispatch_env
    leave = _leave(db_session, "Approved", start_date=date(2026, 11, 1))
    leave_service.amend_approved_leave(
        db_session, leave.id, end_date=date(2026, 11, 12), reason="a"
    )
    assert direct.call_count == 1
    _default_off(db_session, "leave_amended")
    leave_service.amend_approved_leave(
        db_session, leave.id, end_date=date(2026, 11, 13), reason="b"
    )
    assert direct.call_count == 1
    [row] = _rows(db_session)
    _assert_skip(row, event="leave_amended", record_id=leave.id, reason="default_off")


def test_leave_ending_default_off_logs_one_skip_across_runs(db_session, dispatch_env):
    send, _ = dispatch_env
    _default_off(db_session, "leave_ending")
    leave = _leave(db_session, "Approved", end_date=date(2026, 6, 30), start_date=date(2026, 6, 1))
    for _run in range(2):
        assert notify_dispatch.send_ending_reminders(db_session, today=date(2026, 6, 28)) == 0
    send.assert_not_called()
    [row] = _rows(db_session)
    _assert_skip(row, event="leave_ending", record_id=leave.id, reason="default_off")
    # The skip is terminal: switching the default back on does not send it later.
    message_template_service.save_default(db_session, "leave_ending", True, actor="test")
    assert notify_dispatch.send_ending_reminders(db_session, today=date(2026, 6, 29)) == 0
    send.assert_not_called()


# ── Global gates: nothing sent and nothing logged ────────────────────────────


@pytest.mark.parametrize("gate", ["autosend_off", "no_channel"])
def test_global_gates_write_no_skip_row(db_session, monkeypatch, gate):
    from app.services import settings_service

    monkeypatch.setenv("GSSG_SMS_ENABLED", "1" if gate == "autosend_off" else "0")
    monkeypatch.setenv("GSSG_OPENWA_ENABLED", "0")
    get_settings.cache_clear()
    try:
        if gate == "autosend_off":
            settings_service._set(db_session, "settings.sms_autosend_enabled", False)
            db_session.commit()
        db_session.add(Employee(id="ND1", name_en="Gate", name_ar="بوابة", contact="0501234567"))
        db_session.commit()
        _default_off(db_session, "leave_approved")
        _default_off(db_session, "leave_ending")
        approved = _leave(db_session)
        leave_service.update_leave(
            db_session, approved.id, LeaveUpdate(status="Approved", notify_employee=False)
        )
        _leave(db_session, "Approved", start_date=date(2026, 6, 1), end_date=date(2026, 6, 30))
        assert notify_dispatch.send_ending_reminders(db_session, today=date(2026, 6, 28)) == 0
        assert _rows(db_session) == []
    finally:
        get_settings.cache_clear()


def test_every_default_starts_on(db_session):
    for event in sms_templates.EVENTS:
        assert sms_templates.default_send_enabled(db_session, event) is True
        template = message_template_service.read_template(db_session, event)
        assert template["default_enabled"] is True
        assert template["default_mode"] == (
            "auto" if event in message_template_service.AUTO_ONLY_EVENTS else "prefill"
        )


# ── Chain forms: the choice is recorded at save and applied at approval ──────


def test_chain_default_off_skips_at_approval_once(gate_env):
    env = gate_env
    _log_sends(env)
    _default_off(env.db, "employee_clearance")
    book = _clearance(env)
    assert book.versions[-1].fields["_signing"]["notify_employee"] is None
    _sign(env, book)
    env.send.assert_not_called()
    [row] = _rows(env.db, f"employee_clearance:{book.id}")
    assert (row.status, row.skip_reason, row.sent_by) == ("skipped", "default_off", env.signer.id)
    for state in ("rejected", "approved"):
        book_service.override_state(
            env.db, book.id, target_state=state, actor=env.signer, reason="Repair"
        )
    assert len(_rows(env.db, f"employee_clearance:{book.id}")) == 1
    env.send.assert_not_called()


def test_chain_explicit_true_sends_even_when_default_off(gate_env):
    env = gate_env
    _log_sends(env)
    _default_off(env.db, "employee_clearance")
    book = _clearance(env, notify_employee=True)
    _sign(env, book)
    assert [c.args[1:3] for c in env.send.call_args_list] == [("employee_clearance", book.id)]


def test_chain_user_off_skips_and_revision_keeps_it(gate_env):
    env = gate_env
    _log_sends(env)
    book, leave = generate(env, notify_employee=False)
    submit(env, book)
    decide(env, book, "returned")
    # The revise screen hides the switch; the original's explicit "off" holds.
    revised, _ = generate(env, revise_of_book_id=book.id, notify_employee=None)
    assert revised.versions[-1].fields["_signing"]["notify_employee"] is False
    submit(env, revised)
    book_service.sign_book(
        env.db, revised.id, user_id=env.signer.id, version_id=revised.versions[-1].id
    )
    env.send.assert_not_called()
    [row] = _rows(env.db)
    assert row.event_ref == f"leave_permit:{leave.id}"
    assert (row.status, row.skip_reason) == ("skipped", "user_off")


def test_system_silence_writes_no_row_at_approval(gate_env):
    env = gate_env
    _log_sends(env)
    book = _clearance(env, notify_employee="silent")
    _sign(env, book)
    env.send.assert_not_called()
    assert _rows(env.db) == []


# ── Skipped rows are terminal and never worked on ────────────────────────────


def _skipped_row(db, **kw) -> OutboundMessage:
    db.add(Employee(id="SK1", name_en="Skip", name_ar="تخطي", contact="0501234567"))
    row = OutboundMessage(
        employee_id="SK1",
        event_type="leave_approved",
        event_ref="leave_approved:1",
        language="ar",
        phone="+971501234567",
        channel=None,
        status="skipped",
        skip_reason="default_off",
        created_at=datetime(2026, 11, 6, 8, 0) - timedelta(hours=1),
        **kw,
    )
    db.add(row)
    db.commit()
    return row


def test_skipped_rows_are_not_retried_or_polled(db_session, monkeypatch):
    sms_send = Mock()
    monkeypatch.setattr(sms_client, "send", sms_send)
    monkeypatch.setattr(sms_client, "get_delivery", Mock())
    row = _skipped_row(db_session)
    now = datetime(2026, 11, 6, 8, 0)
    assert notify_dispatch.retry_queued(db_session, now=now) == 0
    assert notify_dispatch.poll_deliveries(db_session, now=now) == 0
    assert notify_dispatch.refresh_delivery(db_session, row.id) is row
    sms_send.assert_not_called()
    db_session.refresh(row)
    assert (row.status, row.skip_reason, row.channel, row.delivery_state) == (
        "skipped",
        "default_off",
        None,
        None,
    )


# ── API: the default endpoint, catalog, preview, status and manual send ──────


@pytest.fixture()
def api_client(api_db, monkeypatch):
    monkeypatch.setenv("GSSG_OPENWA_ENABLED", "0")
    monkeypatch.setenv("GSSG_SMS_ENABLED", "1")
    get_settings.cache_clear()
    sms_send = Mock(return_value=sms_client.SendResult(ok=True, message_id="m1"))
    monkeypatch.setattr(sms_client, "send", sms_send)
    user = User(email="default@test.ae", password_hash="x", role="operator", status="active")
    api_db.add_all([user, Employee(id="ND1", name_en="Api", name_ar="واجهة", contact="0501234567")])
    api_db.commit()
    app = create_app()
    app.dependency_overrides[get_db] = lambda: api_db
    app.dependency_overrides[get_current_user] = lambda: user
    try:
        yield TestClient(app), user, sms_send
    finally:
        get_settings.cache_clear()


def test_default_endpoint_gate_audit_and_reflection(api_db, api_client):
    client, user, _ = api_client
    url = "/api/v1/notify/templates/violation/default"
    assert client.put(url, json={"enabled": False}).status_code == 403
    perm_service.set_user_override(api_db, user.id, "messages.templates", "grant")
    off = client.put(url, json={"enabled": False})
    assert off.status_code == 200
    assert off.json()["default_enabled"] is False and off.json()["default_mode"] == "prefill"
    assert api_db.get(AppSetting, "msgdefault.violation") is not None
    [catalog] = [
        r for r in client.get("/api/v1/notify/templates").json() if r["event"] == "violation"
    ]
    assert catalog["default_enabled"] is False
    preview = client.post("/api/v1/notify/preview", json={"template_id": "Violation Form"}).json()
    assert preview["event"] == "violation" and preview["default_enabled"] is False
    audits = list(
        api_db.scalars(
            select(AuditLog).where(AuditLog.action == "message_template.default_changed")
        )
    )
    assert [(a.entity_type, a.entity_id) for a in audits] == [("message_template", "violation")]
    on = client.put(url, json={"enabled": True})
    assert on.json()["default_enabled"] is True
    api_db.expire_all()
    assert api_db.get(AppSetting, "msgdefault.violation") is None
    changes = select(AuditLog).where(AuditLog.action == "message_template.default_changed")
    assert len(list(api_db.scalars(changes))) == 2
    preview = client.post("/api/v1/notify/preview", json={"template_id": "Violation Form"}).json()
    assert preview["default_enabled"] is True
    auto = client.put("/api/v1/notify/templates/leave_rejected/default", json={"enabled": False})
    assert auto.json()["default_mode"] == "auto"


def test_manual_send_ignores_default_and_status_reports_skip(api_db, api_client, monkeypatch):
    client, user, sms_send = api_client
    perm_service.set_user_override(api_db, user.id, "employees.notify", "grant")
    monkeypatch.setattr(notify_dispatch, "_autosend_enabled", lambda _: True)
    _default_off(api_db, "leave_approved")
    leave = _leave(api_db)
    leave_service.update_leave(api_db, leave.id, LeaveUpdate(status="Approved"))
    sms_send.assert_not_called()
    status = client.get(
        "/api/v1/notify/status", params={"event_type": "leave_approved", "record_id": leave.id}
    ).json()
    assert status["last"]["status"] == "skipped"
    assert status["last"]["skip_reason"] == "default_off"
    sent = client.post(
        "/api/v1/notify/send", json={"event_type": "leave_approved", "record_id": leave.id}
    )
    assert sent.status_code == 200 and sent.json()["status"] == "sent"
    assert sms_send.call_count == 1
    status = client.get(
        "/api/v1/notify/status", params={"event_type": "leave_approved", "record_id": leave.id}
    ).json()
    assert status["last"]["status"] == "sent" and status["last"]["skip_reason"] is None


# ── Migration ────────────────────────────────────────────────────────────────


def test_migration_adds_and_drops_skip_reason(tmp_path: Path) -> None:
    database = tmp_path / "skip-reason.db"
    engine = create_engine(f"sqlite:///{database}")
    with engine.begin() as connection:
        connection.exec_driver_sql(
            "CREATE TABLE outbound_messages (id INTEGER PRIMARY KEY, status VARCHAR(16))"
        )
        connection.exec_driver_sql("INSERT INTO outbound_messages VALUES (1, 'sent')")
        connection.exec_driver_sql("CREATE TABLE alembic_version (version_num VARCHAR(255))")
        connection.exec_driver_sql("INSERT INTO alembic_version VALUES ('0115_uniform')")
    config = Config(str(ROOT / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", f"sqlite:///{database}")

    def columns() -> set[str]:
        return {c["name"] for c in inspect(engine).get_columns("outbound_messages")}

    command.upgrade(config, "0116_outbound_skip_reason")
    assert "skip_reason" in columns()
    with engine.connect() as connection:
        assert connection.exec_driver_sql(
            "SELECT status, skip_reason FROM outbound_messages"
        ).all() == [("sent", None)]
    command.downgrade(config, "0115_uniform")
    assert "skip_reason" not in columns()
    engine.dispose()
