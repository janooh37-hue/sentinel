# backend/tests/test_duty_transfer_service.py
import types

from app.db.models import Employee
from app.services import duty_service


def _seed(db, **kw):
    base = dict(
        id="G3309",
        name_en="Majid",
        name_ar="ماجد",
        position_ar="حارس أمن",
        duty_unit="السرية الخامسة",
        duty_post="تفتيش",
    )
    base.update(kw)
    emp = Employee(**base)
    db.add(emp)
    db.commit()
    return emp


def test_transfer_forwards_letter_metadata_and_moves(db_session, monkeypatch):
    _seed(db_session)
    captured = {}

    def fake_generate(
        db, *, employee_id, template_id, fields, current_user, commit, classification_code
    ):
        captured["template_id"] = template_id
        captured["fields"] = fields
        captured["classification_code"] = classification_code
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
    # Transfer letters file under شؤون القوة (Force affairs) — tab 12.
    assert captured["classification_code"] == "12/1"
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


def test_transfer_all_unassigned_skips_book(db_session, monkeypatch):
    # Two employees with NO current duty place.
    for eid in ("G100", "G200"):
        db_session.add(Employee(id=eid, name_en=eid, name_ar=eid, duty_unit=None, duty_post=None))
    db_session.commit()

    called = {"n": 0}

    def fake_generate(*a, **k):
        called["n"] += 1
        raise AssertionError("generate_document must NOT be called for an all-unassigned move")

    monkeypatch.setattr(duty_service.document_service, "generate_document", fake_generate)

    result = duty_service.transfer(
        db_session,
        employee_ids=["G100", "G200"],
        to_unit="السرية الأولى",
        to_post="ليوان",
    )

    assert called["n"] == 0
    assert result.book_id is None and result.ref is None and result.document_id is None
    assert result.moved == ["G100", "G200"]
    moved = db_session.get(Employee, "G100")
    assert moved.duty_unit == "السرية الأولى" and moved.duty_post == "ليوان"


def test_transfer_mixed_assignment_mints_book(db_session, monkeypatch):
    db_session.add(Employee(id="G100", name_en="a", name_ar="a", duty_unit=None, duty_post=None))
    db_session.add(
        Employee(id="G300", name_en="b", name_ar="b", duty_unit="السرية الثالثة", duty_post="تفتيش")
    )
    db_session.commit()

    captured = {}

    def fake_generate(
        db, *, employee_id, template_id, fields, current_user, commit, classification_code
    ):
        captured["fields"] = fields
        return types.SimpleNamespace(book_id=11, ref_number="R-11", document_id=22)

    monkeypatch.setattr(duty_service.document_service, "generate_document", fake_generate)

    result = duty_service.transfer(
        db_session,
        employee_ids=["G100", "G300"],
        to_unit="السرية الأولى",
        to_post=None,
    )

    assert "fields" in captured  # book path taken (≥1 already placed)
    assert result.book_id == 11
    assert result.ref == "R-11"
    assert result.document_id == 22
