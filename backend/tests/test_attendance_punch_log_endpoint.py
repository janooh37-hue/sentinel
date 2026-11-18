"""Scoped provider punch log: dual gates, operational dates and stable keyset pages."""

from __future__ import annotations

from datetime import date, time, timedelta

import pytest

from app.db.workforce_models import AttendancePunchAssignment
from app.services import perm_service
from app.services.workforce_scope_service import decode_cursor, encode_cursor
from tests.conftest import make_user
from tests.factories.attendance import add_punch, build_attendance_day, local
from tests.test_workforce_api_permissions import _client, _scope

DAY = date(2026, 8, 19)
PATH = "/api/v1/workforce/attendance/punches"


@pytest.mark.parametrize("missing", ["workforce.people.view", "workforce.attendance.review"])
def test_punch_log_requires_both_capabilities(api_db, missing) -> None:
    viewer = make_user(api_db, role="operator", email="punch-reviewer@test.ae")
    for capability in ("workforce.people.view", "workforce.attendance.review"):
        perm_service.set_user_override(
            api_db, viewer.id, capability, "deny" if capability == missing else "grant"
        )
    _scope(api_db, viewer, kind="organization")
    api_db.commit()

    response = _client(api_db, viewer).get(PATH, params={"operational_date": DAY.isoformat()})

    assert response.status_code == 403, response.text


def test_punch_log_is_newest_first_and_pages_are_disjoint(api_db) -> None:
    fixture = build_attendance_day(api_db, operational_date=DAY, posts=[("Gate 1", 2)])
    first, second = fixture.employees
    older = add_punch(
        api_db,
        provider_person=fixture.provider_people[first.id],
        occurred_at=local(DAY, time(5)),
    )
    tied = add_punch(
        api_db,
        provider_person=fixture.provider_people[first.id],
        occurred_at=local(DAY, time(9)),
    )
    newest = add_punch(
        api_db,
        provider_person=fixture.provider_people[second.id],
        occurred_at=local(DAY, time(9)),
        device_name="East Gate",
    )
    newest.direction = "out"
    case = next(
        case
        for case in fixture.cases
        if case.employee_id == second.id and case.shift_code_snapshot == "morning"
    )
    api_db.add(
        AttendancePunchAssignment(
            punch_id=newest.id, attendance_case_id=case.id, algorithm_version="read-contract"
        )
    )
    api_db.commit()
    client = _client(api_db, fixture.admin)
    params = {"operational_date": DAY.isoformat(), "limit": 2}

    response = client.get(PATH, params=params)

    assert response.status_code == 200, response.text
    first_page = response.json()
    assert [item["punch_id"] for item in first_page["items"]] == [newest.id, tied.id]
    assert first_page["items"][0] == {
        "punch_id": newest.id,
        "occurred_at": "2026-08-19T05:00:00Z",
        "employee_id": second.id,
        "name_en": second.name_en,
        "name_ar": second.name_ar,
        "department": "الأمن",
        "duty_post": "Gate 1",
        "device": "East Gate",
        "direction": "out",
        "case_id": case.id,
    }
    assert first_page["items"][1]["direction"] == "unknown"
    assert first_page["items"][1]["case_id"] is None
    assert first_page["next_cursor"]

    # Inserting above the cursor must not shift the second page, as an offset would.
    add_punch(
        api_db,
        provider_person=fixture.provider_people[first.id],
        occurred_at=local(DAY, time(12)),
    )
    api_db.commit()
    response = client.get(PATH, params={**params, "cursor": first_page["next_cursor"]})

    assert response.status_code == 200, response.text
    second_page = response.json()
    assert [item["punch_id"] for item in second_page["items"]] == [older.id]
    assert second_page["next_cursor"] is None
    first_ids = {item["punch_id"] for item in first_page["items"]}
    second_ids = {item["punch_id"] for item in second_page["items"]}
    assert first_ids.isdisjoint(second_ids)
    assert first_ids | second_ids == {newest.id, tied.id, older.id}


@pytest.mark.parametrize("kind", ["organization", "department", "duty_unit", "duty_post", "self"])
def test_punch_log_reuses_day_scope_for_assigned_and_unassigned_punches(api_db, kind) -> None:
    fixture = build_attendance_day(
        api_db, operational_date=DAY, posts=[("Gate 1", 1), ("Gate 2", 1)]
    )
    mine, foreign = fixture.employees
    foreign.department = "Finance"
    foreign.duty_unit = "Other unit"
    for case in fixture.cases:
        if case.employee_id == foreign.id:
            case.department_snapshot = "Finance"
            case.duty_unit_snapshot = "Other unit"
    punches = []
    for employee in fixture.employees:
        assigned = add_punch(
            api_db,
            provider_person=fixture.provider_people[employee.id],
            occurred_at=local(DAY, time(5)),
        )
        case = next(
            case
            for case in fixture.cases
            if case.employee_id == employee.id and case.shift_code_snapshot == "morning"
        )
        api_db.add(
            AttendancePunchAssignment(
                punch_id=assigned.id, attendance_case_id=case.id, algorithm_version="read-contract"
            )
        )
        unassigned = add_punch(
            api_db,
            provider_person=fixture.provider_people[employee.id],
            occurred_at=local(DAY, time(12)),
        )
        punches.extend([(employee.id, assigned.id), (employee.id, unassigned.id)])
    viewer = make_user(api_db, role="operator", email="scoped-punch-reviewer@test.ae")
    viewer.employee_id = mine.id
    for capability in ("workforce.people.view", "workforce.attendance.review"):
        perm_service.set_user_override(api_db, viewer.id, capability, "grant")
    if kind != "self":
        dimensions = {
            "department": {"department": mine.department},
            "duty_unit": {"duty_unit": mine.duty_unit},
            "duty_post": {"duty_unit": mine.duty_unit, "duty_post": mine.duty_post},
        }.get(kind, {})
        _scope(api_db, viewer, kind=kind, **dimensions)
    api_db.commit()
    client = _client(api_db, viewer)
    params = {"operational_date": DAY.isoformat()}

    response = client.get(PATH, params=params)

    assert response.status_code == 200, response.text
    expected_employees = {mine.id, foreign.id} if kind == "organization" else {mine.id}
    assert {item["punch_id"] for item in response.json()["items"]} == {
        punch_id for employee_id, punch_id in punches if employee_id in expected_employees
    }
    day_response = client.get("/api/v1/workforce/attendance/day", params=params)
    assert day_response.status_code == 200, day_response.text
    assert {item["employee_id"] for item in day_response.json()["items"]} == expected_employees


def test_assigned_punch_uses_case_snapshot_for_scope_and_person_fields(api_db) -> None:
    fixture = build_attendance_day(api_db, operational_date=DAY, posts=[("Gate 1", 1)])
    employee = fixture.employees[0]
    punch = add_punch(
        api_db,
        provider_person=fixture.provider_people[employee.id],
        occurred_at=local(DAY, time(5)),
    )
    case = next(case for case in fixture.cases if case.shift_code_snapshot == "morning")
    api_db.add(
        AttendancePunchAssignment(
            punch_id=punch.id, attendance_case_id=case.id, algorithm_version="read-contract"
        )
    )
    employee.department = "Finance"
    employee.duty_unit = "Other unit"
    employee.duty_post = "Other gate"
    viewer = make_user(api_db, role="operator", email="historical-punch-reviewer@test.ae")
    for capability in ("workforce.people.view", "workforce.attendance.review"):
        perm_service.set_user_override(api_db, viewer.id, capability, "grant")
    _scope(api_db, viewer, kind="duty_post", duty_unit="السرية الثانية", duty_post="Gate 1")
    api_db.commit()

    response = _client(api_db, viewer).get(PATH, params={"operational_date": DAY.isoformat()})

    assert response.status_code == 200, response.text
    assert [item["punch_id"] for item in response.json()["items"]] == [punch.id]
    assert response.json()["items"][0]["department"] == "الأمن"
    assert response.json()["items"][0]["duty_post"] == "Gate 1"


def test_punch_log_uses_assigned_operational_date_else_dubai_calendar_date(api_db) -> None:
    fixture = build_attendance_day(api_db, operational_date=DAY, posts=[("Gate 1", 1)])
    person = fixture.provider_people[fixture.employees[0].id]
    midnight = add_punch(api_db, provider_person=person, occurred_at=local(DAY, time.min))
    tail = add_punch(api_db, provider_person=person, occurred_at=local(DAY, time(23, 59, 59)))
    add_punch(
        api_db, provider_person=person, occurred_at=local(DAY - timedelta(days=1), time(23, 59))
    )
    add_punch(api_db, provider_person=person, occurred_at=local(DAY + timedelta(days=1), time.min))
    overnight = add_punch(
        api_db, provider_person=person, occurred_at=local(DAY + timedelta(days=1), time(4))
    )
    night_case = next(case for case in fixture.cases if case.shift_code_snapshot == "night")
    morning_case = next(case for case in fixture.cases if case.shift_code_snapshot == "morning")
    morning_case.operational_date = DAY - timedelta(days=1)
    previous_case_punch = add_punch(api_db, provider_person=person, occurred_at=local(DAY, time(6)))
    api_db.add_all(
        [
            AttendancePunchAssignment(
                punch_id=overnight.id,
                attendance_case_id=night_case.id,
                algorithm_version="read-contract",
            ),
            AttendancePunchAssignment(
                punch_id=previous_case_punch.id,
                attendance_case_id=morning_case.id,
                algorithm_version="read-contract",
            ),
        ]
    )
    api_db.commit()
    client = _client(api_db, fixture.admin)

    response = client.get(PATH, params={"operational_date": DAY.isoformat()})

    assert response.status_code == 200, response.text
    assert [item["punch_id"] for item in response.json()["items"]] == [
        overnight.id,
        tail.id,
        midnight.id,
    ]
    following = client.get(PATH, params={"operational_date": (DAY + timedelta(days=1)).isoformat()})
    assert following.status_code == 200, following.text
    assert overnight.id not in {item["punch_id"] for item in following.json()["items"]}


def test_punch_log_excludes_unmapped_unverified_and_inactive_people(api_db) -> None:
    fixture = build_attendance_day(api_db, operational_date=DAY, posts=[("Gate 1", 5)])
    punches = []
    for employee in fixture.employees:
        punches.append(
            add_punch(
                api_db,
                provider_person=fixture.provider_people[employee.id],
                occurred_at=local(DAY, time(5)),
            )
        )
    for employee, state in zip(
        fixture.employees[1:4], ["unmapped", "conflict", "ignored"], strict=True
    ):
        person = fixture.provider_people[employee.id]
        person.mapping_state = state
        if state == "unmapped":
            person.employee_id = None
    fixture.provider_people[fixture.employees[4].id].active = False
    api_db.commit()

    response = _client(api_db, fixture.admin).get(
        PATH, params={"operational_date": DAY.isoformat()}
    )

    assert response.status_code == 200, response.text
    assert [item["punch_id"] for item in response.json()["items"]] == [punches[0].id]


@pytest.mark.parametrize(
    "params", [{"limit": 0}, {"limit": 201}, {"cursor": "garbage"}, {"cursor": ""}]
)
def test_punch_log_rejects_invalid_limits_and_cursors(api_db, params) -> None:
    admin = make_user(api_db, role="admin", email="invalid-punch-query@test.ae")

    response = _client(api_db, admin).get(
        PATH, params={"operational_date": DAY.isoformat(), **params}
    )

    assert response.status_code == 422, response.text


def test_punch_cursor_is_bound_to_endpoint_date_scope_and_sort_position(api_db) -> None:
    fixture = build_attendance_day(
        api_db, operational_date=DAY, posts=[("Gate 1", 1)], punches={None: [time(5), time(12)]}
    )
    client = _client(api_db, fixture.admin)
    response = client.get(PATH, params={"operational_date": DAY.isoformat(), "limit": 1})
    assert response.status_code == 200, response.text
    cursor = response.json()["next_cursor"]
    assert cursor

    other_date = client.get(
        PATH, params={"operational_date": (DAY + timedelta(days=1)).isoformat(), "cursor": cursor}
    )
    assert other_date.status_code == 422, other_date.text
    other_endpoint = client.get(
        "/api/v1/workforce/attendance/day",
        params={"operational_date": DAY.isoformat(), "cursor": cursor},
    )
    assert other_endpoint.status_code == 422, other_endpoint.text
    viewer = make_user(api_db, role="operator", email="different-punch-scope@test.ae")
    viewer.employee_id = fixture.employees[0].id
    for capability in ("workforce.people.view", "workforce.attendance.review"):
        perm_service.set_user_override(api_db, viewer.id, capability, "grant")
    api_db.commit()
    other_scope = _client(api_db, viewer).get(
        PATH, params={"operational_date": DAY.isoformat(), "cursor": cursor}
    )
    assert other_scope.status_code == 422, other_scope.text

    payload = decode_cursor(cursor)
    assert payload is not None
    for position in (["not-a-timestamp", 1], ["2026-08-19T01:00:00", -1], 1):
        malformed = client.get(
            PATH,
            params={
                "operational_date": DAY.isoformat(),
                "cursor": encode_cursor({**payload, "position": position}),
            },
        )
        assert malformed.status_code == 422, malformed.text
