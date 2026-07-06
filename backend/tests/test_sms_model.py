from app.db.models import Employee, SmsMessage


def test_sms_message_has_body_column(db_session):
    db_session.add(Employee(id="E1", name_en="x", name_ar="x"))
    row = SmsMessage(
        employee_id="E1",
        event_type="warning",
        event_ref="warning:1",
        language="ar",
        phone="+971500000000",
        status="sent",
        body="عزيزي محمد أحمد،\n...",
    )
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)
    assert row.body.startswith("عزيزي")


def test_sms_message_row_roundtrip(db_session):
    db_session.add(Employee(id="G1", name_en="John", name_ar="جون", contact="0501234567"))
    db_session.add(
        SmsMessage(
            employee_id="G1",
            event_type="leave_approved",
            event_ref="leave_approved:7",
            language="ar",
            phone="+971501234567",
            status="sent",
            provider_msg_id="sms-1",
        )
    )
    db_session.commit()
    row = db_session.query(SmsMessage).one()
    assert row.id is not None
    assert row.status == "sent"
    assert row.provider_msg_id == "sms-1"
    assert row.created_at is not None
