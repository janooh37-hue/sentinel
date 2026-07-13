from app.db.models import Employee, OutboundMessage
from app.services import employee_detail_service as eds


def test_detail_includes_recent_sms(db_session):
    emp = Employee(id="E9", name_en="Test Employee", name_ar="موظف اختبار")
    db_session.add(emp)
    db_session.flush()
    db_session.add(
        OutboundMessage(
            employee_id="E9",
            event_type="warning",
            event_ref="warning:1",
            language="ar",
            phone="+971500000000",
            status="sent",
            body="عزيزي...",
        )
    )
    db_session.commit()
    detail = eds.get_employee_detail(db_session, "E9")
    assert detail is not None
    assert len(detail.recent_sms) == 1
    assert detail.recent_sms[0].status == "sent"
    assert detail.recent_sms[0].body is not None
    assert detail.recent_sms[0].body.startswith("عزيزي")
