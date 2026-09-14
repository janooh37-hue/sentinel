"""GET /workforce/employees/{id}/attendance/history — the provider's own record.

Contract under test:
  * punches are grouped by the SITE's calendar day, not by UTC, so a punch after
    local midnight belongs to the day it happened here;
  * the vendor's ``emp_code`` filter is not identity: a second enrollment sharing
    the code must not leak into another person's history;
  * an employee the device never enrolled is answered without asking the provider;
  * a bounded read reports ``truncated`` instead of paging forever;
  * nothing is written to this database;
  * self-view opens only the caller's own record, and an inverted or over-wide
    range is a 422.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import func, select

from app.api.errors import AppError
from app.api.v1.workforce import get_attendance_provider
from app.db.models import Employee
from app.db.workforce_models import AttendancePunch
from app.services import attendance_history_service, perm_service
from app.services.workforce_access_service import organization_scope
from app.services.workforce_scope_service import WorkforceScope, WorkforceScopeEntry
from tests.conftest import make_user
from tests.factories.attendance import build_attendance_day
from tests.fakes.attendance_provider import DeterministicAttendanceProvider, person, punch

# `api_db` is a file-backed session shared with TestClient's worker thread.
from tests.test_workforce_api_permissions import _client, _scope

DUBAI = ZoneInfo("Asia/Dubai")
DAY = date(2026, 8, 19)


def _utc(year: int, month: int, day: int, hour: int, minute: int = 0) -> datetime:
    return datetime(year, month, day, hour, minute, tzinfo=UTC)


def _history(db, employee_id: str, provider, *, from_date=DAY, to_date=DAY) -> dict:
    return attendance_history_service.employee_punch_history(
        db,
        scope=organization_scope(),
        employee_id=employee_id,
        from_date=from_date,
        to_date=to_date,
        provider=provider,
        zone=DUBAI,
    )


def test_history_rejects_a_foreign_employee_before_calling_the_provider(db_session) -> None:
    fixture = build_attendance_day(db_session, operational_date=DAY, posts=[("Gate 1", 1)])
    employee = fixture.employees[0]
    employee.department = "Finance"
    db_session.commit()
    provider = DeterministicAttendanceProvider()
    scope = WorkforceScope(
        entries=(WorkforceScopeEntry(scope_kind="department", department="Operations"),)
    )

    try:
        attendance_history_service.employee_punch_history(
            db_session,
            scope=scope,
            employee_id=employee.id,
            from_date=date(2026, 8, 31),
            to_date=date(2026, 8, 1),
            provider=provider,
            zone=DUBAI,
        )
    except AppError as exc:
        assert exc.code == "FORBIDDEN"
        assert exc.http_status == 403
    else:
        raise AssertionError("foreign employee history was allowed")
    assert provider.person_punch_calls == []


def test_history_groups_punches_by_the_site_day_and_writes_nothing(db_session) -> None:
    fixture = build_attendance_day(db_session, operational_date=DAY, posts=[("Gate 1", 1)])
    employee = fixture.employees[0]
    mapping = fixture.provider_people[employee.id]
    emp = mapping.external_person_id

    # 20:30 UTC on the 18th is 00:30 local on the 19th: the site day is what counts.
    provider = DeterministicAttendanceProvider(
        people=[person(emp, employee_code=mapping.external_employee_code)],
        punches=[
            punch("e1", external_person_id=emp, occurred_at=_utc(2026, 8, 18, 20, 30)),
            punch("e2", external_person_id=emp, occurred_at=_utc(2026, 8, 19, 3, 5)),
            punch(
                "e3",
                external_person_id=emp,
                occurred_at=_utc(2026, 8, 19, 11, 40),
                device_name="Main Gate",
            ),
            punch("e4", external_person_id=emp, occurred_at=_utc(2026, 8, 20, 4, 0)),
        ],
    )
    before = db_session.scalar(select(func.count(AttendancePunch.id)))

    payload = _history(
        db_session,
        employee.id,
        provider,
        from_date=date(2026, 8, 18),
        to_date=date(2026, 8, 20),
    )

    assert payload["linked"] is True
    assert payload["external_employee_code"] == mapping.external_employee_code
    assert payload["truncated"] is False
    # Newest first, and the 20:30Z punch lands on the 19th, never the 18th.
    assert [row["operational_date"] for row in payload["days"]] == [
        date(2026, 8, 20),
        date(2026, 8, 19),
    ]
    nineteenth = payload["days"][1]
    assert nineteenth["punch_count"] == 3
    assert nineteenth["first_seen_at"] == (_utc(2026, 8, 18, 20, 30))
    assert nineteenth["last_seen_at"] == (_utc(2026, 8, 19, 11, 40))
    assert nineteenth["devices"] == ["Main Gate"]
    assert db_session.scalar(select(func.count(AttendancePunch.id))) == before


def test_a_second_enrollment_sharing_the_code_is_not_this_person(db_session) -> None:
    """The vendor filters by employee code; only the mapped ``emp`` is identity."""
    fixture = build_attendance_day(db_session, operational_date=DAY, posts=[("Gate 1", 1)])
    employee = fixture.employees[0]
    mapping = fixture.provider_people[employee.id]
    code = mapping.external_employee_code

    provider = DeterministicAttendanceProvider(
        people=[
            person(mapping.external_person_id, employee_code=code),
            person("duplicate-enrollment", employee_code=code),
        ],
        punches=[
            punch(
                "mine",
                external_person_id=mapping.external_person_id,
                occurred_at=_utc(2026, 8, 19, 4, 0),
            ),
            punch(
                "theirs",
                external_person_id="duplicate-enrollment",
                occurred_at=_utc(2026, 8, 19, 5, 0),
            ),
        ],
    )

    payload = _history(db_session, employee.id, provider)

    assert [row["punch_count"] for row in payload["days"]] == [1]
    assert payload["days"][0]["first_seen_at"] == (_utc(2026, 8, 19, 4, 0))


def test_an_unenrolled_employee_is_answered_without_asking_the_provider(db_session) -> None:
    """On the roster, never enrolled on a device: there is nothing to ask for."""
    build_attendance_day(db_session, operational_date=DAY, posts=[("Gate 1", 1)])
    roster_only = Employee(
        id="G-NO-DEVICE",
        name_en="Unenrolled Officer",
        name_ar="ضابط غير مسجل",
        status="Active",
        duty_unit="Gate 1",
    )
    db_session.add(roster_only)
    db_session.commit()
    provider = DeterministicAttendanceProvider()

    payload = _history(db_session, roster_only.id, provider)

    assert payload["linked"] is False
    assert payload["external_employee_code"] is None
    assert payload["days"] == []
    assert provider.person_punch_calls == []


def test_a_read_that_hits_the_page_cap_reports_itself_truncated(db_session) -> None:
    fixture = build_attendance_day(db_session, operational_date=DAY, posts=[("Gate 1", 1)])
    employee = fixture.employees[0]
    mapping = fixture.provider_people[employee.id]
    emp = mapping.external_person_id
    start = _utc(2026, 8, 19, 1, 0)

    provider = DeterministicAttendanceProvider(
        people=[person(emp, employee_code=mapping.external_employee_code)],
        punches=[
            punch(f"e{index}", external_person_id=emp, occurred_at=start + timedelta(minutes=index))
            for index in range(attendance_history_service.MAX_PAGES + 5)
        ],
        page_size=1,
    )

    payload = _history(db_session, employee.id, provider)

    assert payload["truncated"] is True
    assert len(provider.person_punch_calls) == attendance_history_service.MAX_PAGES
    assert payload["days"][0]["punch_count"] == attendance_history_service.MAX_PAGES


def _api(db, user, provider: object | None = None):
    """A client whose provider is a double, so no test ever reaches the vendor."""
    client = _client(db, user)
    client.app.dependency_overrides[get_attendance_provider] = lambda: (
        provider if provider is not None else DeterministicAttendanceProvider()
    )
    return client


def test_self_view_reads_only_the_callers_own_record(api_db) -> None:
    fixture = build_attendance_day(api_db, operational_date=DAY, posts=[("Gate 1", 2)])
    mine, other = fixture.employees[0], fixture.employees[1]
    mapping = fixture.provider_people[mine.id]
    viewer = make_user(api_db, role="operator", email="own-history@test.ae")
    viewer.employee_id = mine.id
    perm_service.set_user_override(api_db, viewer.id, "workforce.self.view", "grant")
    api_db.commit()

    provider = DeterministicAttendanceProvider(
        people=[person(mapping.external_person_id, employee_code=mapping.external_employee_code)],
        punches=[
            punch(
                "e1",
                external_person_id=mapping.external_person_id,
                occurred_at=_utc(2026, 8, 19, 4, 0),
            )
        ],
    )
    client = _api(api_db, viewer, provider)
    params = {"from_date": "2026-08-01", "to_date": "2026-08-31"}

    own = client.get(f"/api/v1/workforce/employees/{mine.id}/attendance/history", params=params)
    assert own.status_code == 200, own.text
    body = own.json()
    assert body["linked"] is True
    assert [day["operational_date"] for day in body["days"]] == ["2026-08-19"]
    assert body["days"][0]["punch_count"] == 1

    foreign = client.get(
        f"/api/v1/workforce/employees/{other.id}/attendance/history", params=params
    )
    assert foreign.status_code == 403, foreign.text


def test_an_inverted_or_over_wide_range_is_refused(api_db) -> None:
    fixture = build_attendance_day(api_db, operational_date=DAY, posts=[("Gate 1", 1)])
    client = _api(api_db, fixture.admin)
    target = fixture.employees[0].id

    inverted = client.get(
        f"/api/v1/workforce/employees/{target}/attendance/history",
        params={"from_date": "2026-08-31", "to_date": "2026-08-01"},
    )
    assert inverted.status_code == 422, inverted.text
    assert inverted.json()["error"]["code"] == "WORKFORCE_HISTORY_RANGE_INVALID"

    too_wide = client.get(
        f"/api/v1/workforce/employees/{target}/attendance/history",
        params={"from_date": "2024-01-01", "to_date": "2026-08-01"},
    )
    assert too_wide.status_code == 422, too_wide.text
    assert too_wide.json()["error"]["code"] == "WORKFORCE_HISTORY_RANGE_INVALID"


def test_history_authorization_precedes_range_validation_and_provider_calls(api_db) -> None:
    fixture = build_attendance_day(api_db, operational_date=DAY, posts=[("Gate 1", 1)])
    target = fixture.employees[0]
    target.department = "Finance"
    manager = make_user(api_db, role="operator", email="history-scope@test.ae")
    for capability in ("workforce.people.view", "workforce.attendance.review"):
        perm_service.set_user_override(api_db, manager.id, capability, "grant")
    _scope(api_db, manager, kind="department", department="Operations")
    api_db.commit()
    provider = DeterministicAttendanceProvider()
    client = _api(api_db, manager, provider)
    invalid = {"from_date": "2026-08-31", "to_date": "2026-08-01"}

    foreign = client.get(
        f"/api/v1/workforce/employees/{target.id}/attendance/history", params=invalid
    )
    assert foreign.status_code == 403, foreign.text
    assert foreign.json()["error"]["code"] == "FORBIDDEN"

    missing = _api(api_db, fixture.admin, provider).get(
        "/api/v1/workforce/employees/G-MISSING/attendance/history", params=invalid
    )
    assert missing.status_code == 404, missing.text
    assert missing.json()["error"]["code"] == "WORKFORCE_EMPLOYEE_NOT_FOUND"
    assert provider.person_punch_calls == []


def test_unexpected_provider_history_failure_is_sanitized(api_db) -> None:
    fixture = build_attendance_day(api_db, operational_date=DAY, posts=[("Gate 1", 1)])

    class FailingProvider:
        code = "failing"

        def list_person_punches(self, **_kwargs):
            raise RuntimeError("secret vendor URL and personal response")

    client = _api(api_db, fixture.admin, FailingProvider())
    response = client.get(
        f"/api/v1/workforce/employees/{fixture.employees[0].id}/attendance/history",
        params={"from_date": "2026-08-19", "to_date": "2026-08-19"},
    )

    assert response.status_code == 502, response.text
    assert response.json()["error"] == {
        "code": "PROVIDER_UNAVAILABLE",
        "message": "The attendance provider could not be read.",
        "details": {},
    }
    assert "secret vendor" not in response.text
