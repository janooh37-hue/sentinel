# backend/tests/test_permit_letter.py
from datetime import date

from app.core.permit_letter import build_permit_letter_html, zones_phrase

P1 = [{"name": "Ali", "uae_id": "784-1", "nationality": "مصر"}]
P2 = [*P1, {"name": "Rakesh", "uae_id": "784-2", "nationality": "الهند"}]
V1 = [
    {
        "plate_no": "A 1",
        "plate_emirate": "دبي",
        "plate_category": "خصوصي",
        "traffic_no": "123",
        "make_model": "Toyota",
        "colour": "أبيض",
        "reg_expiry": "2027-03-14",
    }
]


def test_zone_phrase_join():
    assert zones_phrase(["green"]) == "المنطقة الخضراء"
    assert zones_phrase(["green", "work_residence"]) == "المنطقة الخضراء وسكن الموظفين"


def test_single_person_single_vehicle():
    html = build_permit_letter_html(
        company="ACME",
        zones=["green"],
        start_date=date(2026, 7, 1),
        end_date=date(2026, 7, 2),
        people=P1,
        vehicles=V1,
    )
    assert "للفرد المبيّن" in html and "بحوزته المركبة" in html and "يتسنّى له القيام بعمله" in html
    assert "الجدول الثاني" in html and "A 1" in html


def test_many_persons_many_vehicles():
    html = build_permit_letter_html(
        company="ACME",
        zones=["green"],
        start_date=date(2026, 7, 1),
        end_date=date(2026, 7, 2),
        people=P2,
        vehicles=[*V1, *V1],
    )
    assert (
        "للأفراد المبيّنين" in html
        and "بحوزتهم المركبات" in html
        and "يتسنّى لهم القيام بعملهم" in html
    )


def test_no_vehicles_drops_clause_and_table():
    html = build_permit_letter_html(
        company="ACME",
        zones=["green"],
        start_date=date(2026, 7, 1),
        end_date=date(2026, 7, 2),
        people=P2,
        vehicles=[],
    )
    assert "المركبة" not in html and "المركبات" not in html
    assert "الجدول الثاني" not in html
    assert "للأفراد المبيّنين" in html


def test_uses_individual_not_employee_term():
    html = build_permit_letter_html(
        company="ACME",
        zones=["green"],
        start_date=date(2026, 7, 1),
        end_date=date(2026, 7, 2),
        people=P1,
        vehicles=[],
    )
    assert "الموظف" not in html  # generic template: individuals, not employees
    assert "الجدول الثاني" not in html  # no vehicle table when 0 vehicles
    assert "للفرد المبيّن" in html


def test_work_residence_zone_phrase_and_person_term():
    html = build_permit_letter_html(
        company="X",
        zones=["work_residence"],
        start_date=date(2026, 7, 1),
        end_date=date(2026, 7, 2),
        people=P1,
        vehicles=[],
    )
    assert "سكن الموظفين" in html  # allowed zone phrase renders
    assert "للفرد المبيّن" in html  # person term stays الفرد, not الموظف
