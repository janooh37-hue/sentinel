from app.db.models import Employee, WhatsAppMessage


def test_employee_msg_language_defaults_to_ar(db_session):
    emp = Employee(id="G9001", name_en="Test", contact="0501234567")
    db_session.add(emp)
    db_session.commit()
    db_session.refresh(emp)
    assert emp.msg_language == "ar"


def test_whatsapp_message_row_roundtrips(db_session):
    db_session.add(Employee(id="G9002", name_en="Test2"))
    db_session.commit()
    msg = WhatsAppMessage(
        employee_id="G9002",
        event_type="leave_approved",
        event_ref="leave_approved:7",
        language="ar",
        phone="+971501234567",
        template="leave_approved_ar",
        status="sent",
        provider_msg_id="wamid.X",
        sent_by=1,
    )
    db_session.add(msg)
    db_session.commit()
    db_session.refresh(msg)
    assert msg.id is not None
    assert msg.error is None
    assert msg.created_at is not None
