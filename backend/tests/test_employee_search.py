from datetime import date

from app.db.models import Employee, Vehicle, VehicleSite
from app.services import employee_service, vehicle_service


def _make(
    db,
    id_,
    name_en,
    *,
    name_ar=None,
    uae_id_no=None,
    passport_no=None,
    status="Active",
    pending_status=None,
    end_date=None,
):
    emp = Employee(
        id=id_,
        name_en=name_en,
        name_ar=name_ar,
        uae_id_no=uae_id_no,
        passport_no=passport_no,
        status=status,
        pending_status=pending_status,
        end_date=end_date,
    )
    db.add(emp)
    return emp


def test_typo_falls_back_to_fuzzy_name_match(db_session):
    _make(db_session, "G1001", "Mohammed Al Farsi")
    db_session.commit()

    rows, total = employee_service.list_employees(db_session, q="Muhamad Al Farsi")

    assert total == 1
    assert [r.id for r in rows] == ["G1001"]


def test_uae_id_query_matches_employee(db_session):
    _make(db_session, "G1002", "First Employee", uae_id_no="784-1990-1234567-1")
    _make(db_session, "G1003", "Second Employee", passport_no="A1234567")
    db_session.commit()

    rows, total = employee_service.list_employees(db_session, q="784-1990-1234567-1")

    assert total == 1
    assert [r.id for r in rows] == ["G1002"]


def test_passport_query_matches_employee(db_session):
    _make(db_session, "G1004", "First Employee", uae_id_no="784-1990-1234567-1")
    _make(db_session, "G1005", "Second Employee", passport_no="A1234567")
    db_session.commit()

    rows, total = employee_service.list_employees(db_session, q="A1234567")

    assert total == 1
    assert [r.id for r in rows] == ["G1005"]


def test_nonsense_query_returns_empty_not_everyone(db_session):
    _make(db_session, "G1006", "Mohammed Al Farsi")
    _make(db_session, "G1007", "Second Employee", passport_no="A1234567")
    db_session.commit()

    rows, total = employee_service.list_employees(db_session, q="zzqxxnonsense")

    assert rows == []
    assert total == 0


def test_fuzzy_fallback_preserves_pagination(db_session):
    _make(db_session, "G1008", "Ahmed Al Somesun")
    _make(db_session, "G1009", "Ahmed Al Somesan")
    _make(db_session, "G1010", "Ahmed Al Somesin")
    db_session.commit()

    rows, total = employee_service.list_employees(
        db_session, q="Ahmed Al Somesen", limit=1, offset=1
    )

    assert total == 3
    assert len(rows) == 1


def test_fuzzy_fallback_pending_orders_by_departure_date(db_session):
    """The exact-match path orders pending=True results by end_date (soonest
    first); the fuzzy fallback must match that ordering, not its own score
    order."""
    _make(
        db_session,
        "G1012",
        "Ahmed Al Somesun",
        status="Active",
        pending_status="Resigned",
        end_date=date(2026, 6, 1),
    )
    _make(
        db_session,
        "G1013",
        "Ahmed Al Zomeson",
        status="Active",
        pending_status="Resigned",
        end_date=date(2026, 1, 1),
    )
    db_session.commit()

    rows, total = employee_service.list_employees(db_session, q="Ahmed Al Somesen", pending=True)

    assert total == 2
    assert [r.id for r in rows] == ["G1013", "G1012"]


def test_vehicle_search_never_returns_an_employee(db_session):
    """Regression pin: no cross-domain leak — an employee's name must never
    surface a vehicle result. Nothing about vehicle search changes here."""
    _make(db_session, "G1011", "Mohammed Al Farsi")
    site = VehicleSite(name_ar="موقع", name_en="Site", active=True)
    db_session.add(site)
    db_session.flush()
    db_session.add(
        Vehicle(
            plate_code="14",
            plate_number="58216",
            traffic_code="1180021637",
            type_ar="تويوتا هايس",
            type_en="Toyota Hiace",
            class_ar="باص خفيف",
            class_en="Light bus",
            site_id=site.id,
            license_start=date(2026, 1, 1),
            license_expiry=date(2099, 12, 31),
        )
    )
    db_session.commit()

    vehicles = vehicle_service.list_vehicles(db_session, q="Mohammed Al Farsi")

    assert vehicles == []
