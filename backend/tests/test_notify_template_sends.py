from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.api.deps import get_current_user
from app.config import get_settings
from app.db.models import Employee, Leave, OutboundMessage, User
from app.db.session import get_db
from app.main import create_app
from app.services import notify_dispatch, perm_service, sms_client, sms_templates


@pytest.fixture()
def send_client(api_db, monkeypatch):
    monkeypatch.setenv("GSSG_OPENWA_ENABLED", "0")
    monkeypatch.setenv("GSSG_SMS_ENABLED", "1")
    get_settings.cache_clear()
    monkeypatch.setattr(
        sms_client, "send", lambda phone, body: sms_client.SendResult(ok=True, message_id="sent")
    )
    user = User(email="send-template@test.ae", password_hash="x", role="operator", status="active")
    api_db.add(user)
    api_db.commit()
    for capability in ("messages.templates", "employees.notify"):
        perm_service.set_user_override(api_db, user.id, capability, "grant")
    app = create_app()
    app.dependency_overrides[get_db] = lambda: api_db
    app.dependency_overrides[get_current_user] = lambda: user
    try:
        yield TestClient(app)
    finally:
        get_settings.cache_clear()


@pytest.mark.parametrize(
    "path,event",
    [
        ("amended", "leave_amended"),
        ("scheduled", "leave_ending"),
        ("manual", "leave_approved"),
    ],
)
@pytest.mark.parametrize("language", ["ar", "en"])
def test_override_reaches_real_send_then_reset_restores_default(
    api_db, send_client, path, event, language
):
    employee = Employee(
        id="S1",
        name_en="Template Recipient",
        name_ar="مستلم القالب",
        contact="0501234567",
        msg_language=language,
    )
    api_db.add(employee)
    api_db.commit()
    url = f"/api/v1/notify/templates/{event}"
    draft = {"ar": "إشعار مخصص {name}", "en": "Custom notification {name}"}
    assert send_client.put(url, json=draft).status_code == 200

    for overridden in (True, False):
        if not overridden:
            reset = send_client.delete(url)
            assert reset.status_code == 200
            assert reset.json()["override"] is None
        # A fresh leave represents the next send; reminder dedup must remain real.
        leave = Leave(
            employee_id=employee.id,
            leave_type="Annual Leave",
            status="Approved",
            start_date=date(2026, 6, 1 if overridden else 2),
            end_date=date(2026, 6, 30),
            days=30 if overridden else 29,
        )
        api_db.add(leave)
        api_db.commit()
        if path == "amended":
            default = sms_templates.render_leave_amended(
                leave, employee, language, old_days=35, reason="Changed travel dates"
            )
            notify_dispatch.auto_send_leave_amended(
                api_db, leave.id, old_days=35, reason="Changed travel dates"
            )
        else:
            default = sms_templates.render_text(event, language, leave, employee)
            if path == "scheduled":
                assert notify_dispatch.send_ending_reminders(api_db, today=date(2026, 6, 28)) == 1
            else:
                response = send_client.post(
                    "/api/v1/notify/send", json={"event_type": event, "record_id": leave.id}
                )
                assert response.status_code == 200
                assert response.json()["status"] == "sent"
        rows = api_db.scalars(
            select(OutboundMessage).where(OutboundMessage.event_ref == f"{event}:{leave.id}")
        ).all()
        assert len(rows) == 1
        assert rows[0].status == "sent"
        assert rows[0].channel == "sms"
        expected_override = (
            "إشعار مخصص مستلم القالب"
            if language == "ar"
            else "Custom notification Template Recipient"
        )
        assert rows[0].body == (expected_override if overridden else default)
        assert default != expected_override
