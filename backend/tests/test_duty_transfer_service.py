# backend/tests/test_duty_transfer_service.py
import types

import pytest

from app.api.errors import ValidationFailedError
from app.db.models import Employee
from app.schemas.duty import DutyTransferMove
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


def test_transfer_forwards_letter_metadata_and_moves(db_session, admin_user, monkeypatch):
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
        moves=[DutyTransferMove(employee_id="G3309", to_unit="السرية الثانية", to_post="ليوان")],
        recipient_id=3,
        manager_id=5,
        cc=["مدراء الأفرع"],
        current_user=admin_user,
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


def test_transfer_all_unassigned_skips_book(db_session, admin_user, monkeypatch):
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
        moves=[
            DutyTransferMove(employee_id="G100", to_unit="السرية الأولى", to_post="ليوان"),
            DutyTransferMove(employee_id="G200", to_unit="السرية الثانية", to_post=None),
        ],
        current_user=admin_user,
    )

    assert called["n"] == 0
    assert result.book_id is None and result.ref is None and result.document_id is None
    assert result.moved == ["G100", "G200"]
    # Each unassigned employee lands on ITS OWN destination.
    a = db_session.get(Employee, "G100")
    assert a.duty_unit == "السرية الأولى" and a.duty_post == "ليوان"
    b = db_session.get(Employee, "G200")
    assert b.duty_unit == "السرية الثانية" and b.duty_post is None


def test_transfer_mixed_assignment_mints_book(db_session, admin_user, monkeypatch):
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
        moves=[
            DutyTransferMove(employee_id="G100", to_unit="السرية الأولى", to_post=None),
            DutyTransferMove(employee_id="G300", to_unit="السرية الرابعة", to_post="ليوان"),
        ],
        current_user=admin_user,
    )

    assert "fields" in captured  # book path taken (≥1 already placed)
    assert result.book_id == 11
    assert result.ref == "R-11"
    assert result.document_id == 22


def test_transfer_moves_each_employee_to_its_own_destination(db_session, admin_user, monkeypatch):
    """A swap in one letter: two employees exchange units."""
    db_session.add(
        Employee(id="G500", name_en="a", name_ar="أ", duty_unit="السرية الأولى", duty_post="ليوان")
    )
    db_session.add(
        Employee(id="G600", name_en="b", name_ar="ب", duty_unit="السرية الثانية", duty_post="تفتيش")
    )
    db_session.commit()

    captured = {}

    def fake_generate(
        db, *, employee_id, template_id, fields, current_user, commit, classification_code
    ):
        captured["fields"] = fields
        return types.SimpleNamespace(book_id=1, ref_number="R-1", document_id=2)

    monkeypatch.setattr(duty_service.document_service, "generate_document", fake_generate)

    duty_service.transfer(
        db_session,
        moves=[
            DutyTransferMove(employee_id="G500", to_unit="السرية الثانية", to_post="تفتيش"),
            DutyTransferMove(employee_id="G600", to_unit="السرية الأولى", to_post="ليوان"),
        ],
        current_user=admin_user,
    )

    # Both destinations appear in the single letter body.
    body = captured["fields"]["body"]
    assert "السرية الأولى - ليوان" in body
    assert "السرية الثانية - تفتيش" in body
    # And each employee actually landed on its own destination.
    assert db_session.get(Employee, "G500").duty_unit == "السرية الثانية"
    assert db_session.get(Employee, "G500").duty_post == "تفتيش"
    assert db_session.get(Employee, "G600").duty_unit == "السرية الأولى"
    assert db_session.get(Employee, "G600").duty_post == "ليوان"


def test_transfer_rejects_a_duplicate_employee(db_session, admin_user, monkeypatch):
    """Two destinations for one person is ambiguous — refuse, don't guess."""
    _seed(db_session, id="G700")

    def fake_generate(*a, **k):
        raise AssertionError("generate_document must NOT be called for an invalid request")

    monkeypatch.setattr(duty_service.document_service, "generate_document", fake_generate)

    with pytest.raises(ValidationFailedError) as err:
        duty_service.transfer(
            db_session,
            moves=[
                DutyTransferMove(employee_id="G700", to_unit="السرية الأولى", to_post=None),
                DutyTransferMove(employee_id="G700", to_unit="السرية الثانية", to_post=None),
            ],
            current_user=admin_user,
        )

    assert err.value.code == "DUTY_DUPLICATE_EMPLOYEE"
    # Nothing moved.
    assert db_session.get(Employee, "G700").duty_unit == "السرية الخامسة"
