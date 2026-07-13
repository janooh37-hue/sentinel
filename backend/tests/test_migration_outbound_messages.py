from sqlalchemy import inspect

from app.db.models import Employee, OutboundMessage


def test_outbound_messages_table_exists(db_session) -> None:
    eng = db_session.get_bind()
    cols = {c["name"] for c in inspect(eng).get_columns("outbound_messages")}
    expected = {
        "id",
        "employee_id",
        "event_type",
        "event_ref",
        "language",
        "phone",
        "channel",
        "status",
        "delivery_state",
        "delivery_checked_at",
        "fell_back",
        "fallback_reason",
        "attempts",
        "next_retry_at",
        "provider_msg_id",
        "error",
        "body",
        "sent_by",
        "created_at",
    }
    assert expected <= cols


def test_model_maps_to_table() -> None:
    assert OutboundMessage.__tablename__ == "outbound_messages"


def test_outbound_message_row_roundtrip(db_session) -> None:
    db_session.add(Employee(id="G0001", name_en="Test", name_ar="اختبار"))
    db_session.commit()
    msg = OutboundMessage(
        employee_id="G0001",
        event_type="leave_approved",
        event_ref="leave_approved:1",
        language="ar",
        phone="+971501234567",
        status="queued",
    )
    db_session.add(msg)
    db_session.commit()
    db_session.refresh(msg)
    assert msg.id is not None
    assert msg.fell_back is False
    assert msg.attempts == 0
    assert msg.channel is None
    assert msg.created_at is not None
