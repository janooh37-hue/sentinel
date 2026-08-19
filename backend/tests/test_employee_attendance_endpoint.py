"""GET /workforce/employees/{id}/attendance — the per-employee month.

Contract under test:
  * every scheduled day in the window appears once, with its shift code,
    presence state, late minutes and its own punch list;
  * each punch carries its device but never a direction, because this provider
    reports none;
  * a user holding only workforce.self.view may read their OWN linked employee
    and nobody else's;
  * an over-wide or inverted window is refused as a 422, never a 500.
"""

from __future__ import annotations

from datetime import date, time

import pytest

from app.api.errors import ValidationFailedError
from app.services import perm_service, workforce_read_service
from app.services.workforce_scope_service import resolve_workforce_scope
from tests.conftest import make_user
from tests.factories.attendance import build_attendance_day

# `api_db` is a file-backed SQLite session with check_same_thread=False and a
# monkeypatched SessionLocal, which is what lets TestClient's worker thread
# share the test's database. A conftest `db_session` cannot: SQLite objects are
# thread-affine, so API calls would raise ProgrammingError.
from tests.test_workforce_api_permissions import _client, api_db  # noqa: F401

DAY = date(2026, 8, 19)


def test_range_returns_one_entry_per_scheduled_day_with_its_punches(db_session) -> None:
    fixture = build_attendance_day(
        db_session,
        operational_date=DAY,
        posts=[("البوابة الرئيسية", 1)],
        punches={None: [time(4, 52), time(12, 40)]},
    )
    employee_id = fixture.employees[0].id
    scope = resolve_workforce_scope(db_session, fixture.admin)

    payload = workforce_read_service.employee_attendance_range(
        db_session,
        scope=scope,
        employee_id=employee_id,
        from_date=date(2026, 8, 1),
        to_date=date(2026, 8, 31),
    )

    assert payload["employee_id"] == employee_id
    assert payload["days"], "a rostered employee has scheduled days in August"
    keys = [(day["operational_date"], day["shift_code"]) for day in payload["days"]]
    assert len(keys) == len(set(keys)), "one entry per day per shift, never duplicated"
    for day in payload["days"]:
        assert day["shift_code"] in {"morning", "noon", "night", "office_day"}
        assert isinstance(day["punches"], list)

    punched = [day for day in payload["days"] if day["punch_count"] > 0]
    assert punched, "the punches the factory attached must appear"
    assert punched[0]["punches"][0]["device_name"] == "Main Gate Turnstile"
    assert "direction" not in punched[0]["punches"][0], (
        "this provider reports no direction, so the payload must not imply one"
    )


def test_self_view_reads_own_record_only(api_db) -> None:
    """workforce.self.view is a self-scoped grant, not a roster grant."""
    fixture = build_attendance_day(
        api_db, operational_date=DAY, posts=[("البوابة الرئيسية", 2)]
    )
    mine, theirs = fixture.employees[0], fixture.employees[1]

    viewer = make_user(api_db, role="operator", email="self-view@test.ae")
    viewer.employee_id = mine.id
    perm_service.set_user_override(api_db, viewer.id, "workforce.self.view", "grant")
    api_db.commit()

    client = _client(api_db, viewer)
    params = {"from_date": "2026-08-01", "to_date": "2026-08-31"}

    ok = client.get(f"/api/v1/workforce/employees/{mine.id}/attendance", params=params)
    assert ok.status_code == 200, ok.text
    assert ok.json()["employee_id"] == mine.id

    denied = client.get(f"/api/v1/workforce/employees/{theirs.id}/attendance", params=params)
    assert denied.status_code == 403, denied.text


def test_roster_reader_needs_both_review_and_people_view(api_db) -> None:
    fixture = build_attendance_day(
        api_db, operational_date=DAY, posts=[("التفتيش", 1)]
    )
    target = fixture.employees[0]

    half = make_user(api_db, role="operator", email="half-capability@test.ae")
    perm_service.set_user_override(api_db, half.id, "workforce.people.view", "grant")
    api_db.commit()

    response = _client(api_db, half).get(
        f"/api/v1/workforce/employees/{target.id}/attendance",
        params={"from_date": "2026-08-01", "to_date": "2026-08-31"},
    )
    assert response.status_code == 403, response.text

    perm_service.set_user_override(
        api_db, half.id, "workforce.attendance.review", "grant"
    )
    api_db.commit()

    allowed = _client(api_db, half).get(
        f"/api/v1/workforce/employees/{target.id}/attendance",
        params={"from_date": "2026-08-01", "to_date": "2026-08-31"},
    )
    assert allowed.status_code == 200, allowed.text


@pytest.mark.parametrize(
    ("from_date", "to_date"),
    [
        (date(2026, 1, 1), date(2026, 12, 31)),  # wider than 92 days
        (date(2026, 8, 31), date(2026, 8, 1)),  # inverted
    ],
)
def test_invalid_windows_are_rejected(db_session, from_date: date, to_date: date) -> None:
    fixture = build_attendance_day(
        db_session, operational_date=DAY, posts=[("التفتيش", 1)]
    )
    scope = resolve_workforce_scope(db_session, fixture.admin)

    with pytest.raises(ValidationFailedError):
        workforce_read_service.employee_attendance_range(
            db_session,
            scope=scope,
            employee_id=fixture.employees[0].id,
            from_date=from_date,
            to_date=to_date,
        )


def test_over_wide_window_is_a_422_through_the_api(api_db) -> None:
    """The bound must surface as 422, not as a 500 from the catch-all handler."""
    fixture = build_attendance_day(
        api_db, operational_date=DAY, posts=[("التفتيش", 1)]
    )

    response = _client(api_db, fixture.admin).get(
        f"/api/v1/workforce/employees/{fixture.employees[0].id}/attendance",
        params={"from_date": "2026-01-01", "to_date": "2026-12-31"},
    )

    assert response.status_code == 422, response.text
    assert response.json()["error"]["code"] == "ATTENDANCE_RANGE_TOO_WIDE"
