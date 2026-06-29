# backend/tests/test_duty_transfer_service.py
import types
from app.db.models import Employee
from app.services import duty_service
from app.schemas.duty import DutyTransferRequest


def _seed(db, **kw):
    base = dict(id="G3309", name_en="Majid", name_ar="ماجد", position_ar="حارس أمن",
                duty_unit="السرية الخامسة", duty_post="تفتيش")
    base.update(kw)
    emp = Employee(**base)
    db.add(emp)
    db.commit()
    return emp


def test_transfer_forwards_letter_metadata_and_moves(db_session, monkeypatch):
    _seed(db_session)
    captured = {}

    def fake_generate(db, *, employee_id, template_id, fields, current_user, commit):
        captured["template_id"] = template_id
        captured["fields"] = fields
        return types.SimpleNamespace(book_id=7, ref_number="1/12/GSSG/106", document_id=9)

    monkeypatch.setattr(duty_service.document_service, "generate_document", fake_generate)

    result = duty_service.transfer(
        db_session,
        employee_ids=["G3309"],
        to_unit="السرية الثانية",
        to_post="ليوان",
        recipient_id=3,
        manager_id=5,
        cc=["مدراء الأفرع"],
    )

    assert captured["template_id"] == "General Book"
    assert captured["fields"]["subject"] == "النقل"
    assert captured["fields"]["recipient_id"] == 3
    assert captured["fields"]["manager_id"] == 5
    assert captured["fields"]["cc"] == ["مدراء الأفرع"]
    # من column captured the PRE-move location
    assert "السرية الخامسة - تفتيش" in captured["fields"]["body"]
    # Employee actually moved
    moved = db_session.get(Employee, "G3309")
    assert moved.duty_unit == "السرية الثانية" and moved.duty_post == "ليوان"
    assert result.book_id == 7 and result.moved == ["G3309"]
