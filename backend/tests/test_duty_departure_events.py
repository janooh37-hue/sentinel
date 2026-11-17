"""Departed employees leave the duty-unit structure, and return to it on reactivation.

Resigned/Terminated record ``service_end``, Transferred ``transfer_out``; both
clear ``duty_unit``/``duty_post``. Returning to Active/Loaned restores the
latest departure's unit/post with a ``reinstatement`` event.
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest
from sqlalchemy import select

from app.api.errors import ValidationFailedError
from app.db.models import Employee, User
from app.db.workforce_models import DutyAssignmentEvent
from app.schemas.duty import DutyTransferMove
from app.schemas.employee import EmployeeCreate, EmployeeUpdate
from app.services import duty_service, employee_activity_service, employee_service
from app.services.document_service import _record_pending_resignation

TODAY = date.today()
UNIT = "السرية الثانية"
POST = "ليوان"


def _user(db) -> User:
    user = User(
        email="hr@example.ae",
        password_hash="x",
        role="admin",
        status="active",
        display_name="HR Admin",
    )
    db.add(user)
    db.commit()
    return user


def _emp(db, employee_id: str = "G8001", **kw) -> Employee:
    kw.setdefault("status", "Active")
    kw.setdefault("duty_unit", UNIT)
    kw.setdefault("duty_post", POST)
    row = Employee(id=employee_id, name_en=f"Emp {employee_id}", department="Security", **kw)
    db.add(row)
    db.commit()
    return row


def _events(db, employee_id: str = "G8001") -> list[DutyAssignmentEvent]:
    return list(
        db.scalars(
            select(DutyAssignmentEvent)
            .where(DutyAssignmentEvent.employee_id == employee_id)
            .order_by(DutyAssignmentEvent.id)
        )
    )


def _location(event: DutyAssignmentEvent) -> tuple[object, ...]:
    return (
        event.from_department,
        event.from_unit,
        event.from_post,
        event.to_department,
        event.to_unit,
        event.to_post,
    )


@pytest.mark.parametrize(
    ("status", "event_type"),
    [
        ("Resigned", "service_end"),
        ("Terminated", "service_end"),
        ("Transferred", "transfer_out"),
    ],
)
@pytest.mark.parametrize("working", ["Active", "Loaned"])
def test_immediate_departure_clears_the_post_and_logs_it(db_session, status, event_type, working):
    user = _user(db_session)
    _emp(db_session, status=working)
    payload = {"status": status, "end_date": TODAY}
    if status == "Transferred":
        payload["transfer_site"] = "Abu Dhabi"
    row = employee_service.update_employee(
        db_session, "G8001", EmployeeUpdate(**payload), actor_user_id=user.id
    )

    assert (row.duty_unit, row.duty_post) == (None, None)
    (event,) = _events(db_session)
    assert event.event_type == event_type
    assert _location(event) == ("Security", UNIT, POST, None, None, None)
    assert event.actor_user_id == user.id


def test_full_form_save_cannot_resend_the_old_post_onto_a_departure(db_session):
    """EmployeeForm submits every field it renders, duty location included."""
    user = _user(db_session)
    _emp(db_session)
    row = employee_service.update_employee(
        db_session,
        "G8001",
        EmployeeUpdate(status="Resigned", end_date=TODAY, duty_unit=UNIT, duty_post=POST),
        actor_user_id=user.id,
    )
    assert (row.duty_unit, row.duty_post) == (None, None)
    assert [e.event_type for e in _events(db_session)] == ["service_end"]


def test_scheduled_departure_keeps_the_post_until_the_flip(db_session):
    user = _user(db_session)
    _emp(db_session)
    end = TODAY + timedelta(days=14)
    row = employee_service.update_employee(
        db_session,
        "G8001",
        EmployeeUpdate(status="Resigned", end_date=end),
        actor_user_id=user.id,
    )
    assert (row.status, row.duty_unit, row.duty_post) == ("Active", UNIT, POST)
    assert _events(db_session) == []

    assert employee_service.apply_due_departures(db_session, today=end - timedelta(days=1)) == []
    assert (row.duty_unit, row.duty_post) == (UNIT, POST)

    (moved,) = employee_service.apply_due_departures(db_session, today=end)
    assert (moved.status, moved.duty_unit, moved.duty_post) == ("Resigned", None, None)
    (event,) = _events(db_session)
    assert event.event_type == "service_end"
    assert (event.from_unit, event.from_post, event.to_unit) == (UNIT, POST, None)
    assert event.actor_user_id is None


def test_reactivation_restores_the_post_left_behind(db_session):
    user = _user(db_session)
    _emp(db_session)
    employee_service.update_employee(
        db_session,
        "G8001",
        EmployeeUpdate(status="Terminated", end_date=TODAY),
        actor_user_id=user.id,
    )
    row = employee_service.update_employee(
        db_session, "G8001", EmployeeUpdate(status="Loaned"), actor_user_id=user.id
    )

    assert (row.status, row.duty_unit, row.duty_post) == ("Loaned", UNIT, POST)
    departure, restore = _events(db_session)
    assert departure.event_type == "service_end"
    assert restore.event_type == "reinstatement"
    # Like an initial placement: no unit before, the department is unchanged.
    assert _location(restore) == ("Security", None, None, "Security", UNIT, POST)
    assert restore.actor_user_id == user.id


def test_reactivation_keeps_a_post_chosen_in_the_same_edit(db_session):
    user = _user(db_session)
    _emp(db_session)
    employee_service.update_employee(
        db_session,
        "G8001",
        EmployeeUpdate(status="Resigned", end_date=TODAY),
        actor_user_id=user.id,
    )
    row = employee_service.update_employee(
        db_session,
        "G8001",
        EmployeeUpdate(status="Active", duty_unit="السرية الأولى"),
        actor_user_id=user.id,
    )
    assert (row.duty_unit, row.duty_post) == ("السرية الأولى", None)
    assert [e.event_type for e in _events(db_session)] == ["service_end"]


def test_transfer_return_restores_the_post(db_session):
    user = _user(db_session)
    _emp(db_session)
    back = TODAY + timedelta(days=30)
    employee_service.update_employee(
        db_session,
        "G8001",
        EmployeeUpdate(
            status="Transferred",
            end_date=TODAY,
            transfer_site="Abu Dhabi",
            transfer_return_date=back,
        ),
        actor_user_id=user.id,
    )
    ((row, _, _),) = employee_service.apply_due_transfer_returns(db_session, today=back)

    assert (row.status, row.duty_unit, row.duty_post) == ("Active", UNIT, POST)
    departure, restore = _events(db_session)
    assert departure.event_type == "transfer_out"
    assert restore.event_type == "reinstatement"
    assert (restore.to_unit, restore.to_post, restore.actor_user_id) == (UNIT, POST, None)


def test_moving_between_departed_statuses_adds_no_duty_event(db_session):
    user = _user(db_session)
    _emp(db_session)
    employee_service.update_employee(
        db_session,
        "G8001",
        EmployeeUpdate(status="Transferred", end_date=TODAY, transfer_site="Abu Dhabi"),
        actor_user_id=user.id,
    )
    row = employee_service.update_employee(
        db_session,
        "G8001",
        EmployeeUpdate(status="Resigned", end_date=TODAY),
        actor_user_id=user.id,
    )
    assert row.status == "Resigned"
    assert [e.event_type for e in _events(db_session)] == ["transfer_out"]


def test_reactivation_without_a_departure_event_stays_unassigned(db_session):
    user = _user(db_session)
    _emp(db_session, status="Resigned", end_date=TODAY, duty_unit=None, duty_post=None)
    row = employee_service.update_employee(
        db_session, "G8001", EmployeeUpdate(status="Active"), actor_user_id=user.id
    )
    assert (row.status, row.duty_unit, row.duty_post) == ("Active", None, None)
    assert _events(db_session) == []


def test_an_unassigned_departure_is_recorded_so_an_older_post_is_never_restored(db_session):
    user = _user(db_session)
    _emp(db_session)
    employee_service.update_employee(
        db_session,
        "G8001",
        EmployeeUpdate(status="Resigned", end_date=TODAY),
        actor_user_id=user.id,
    )
    employee_service.update_employee(
        db_session, "G8001", EmployeeUpdate(status="Active"), actor_user_id=user.id
    )
    # Unassigned by hand, then departs again.
    employee_service.update_employee(
        db_session, "G8001", EmployeeUpdate(duty_unit=None, duty_post=None), actor_user_id=user.id
    )
    employee_service.update_employee(
        db_session,
        "G8001",
        EmployeeUpdate(status="Resigned", end_date=TODAY),
        actor_user_id=user.id,
    )
    row = employee_service.update_employee(
        db_session, "G8001", EmployeeUpdate(status="Active"), actor_user_id=user.id
    )
    assert (row.duty_unit, row.duty_post) == (None, None)
    assert [e.event_type for e in _events(db_session)] == [
        "service_end",
        "reinstatement",
        "service_end",
    ]


def test_creating_an_already_departed_employee_leaves_no_post(db_session):
    user = _user(db_session)
    row = employee_service.create_employee(
        db_session,
        EmployeeCreate(
            id="G8002",
            name_en="Emp G8002",
            status="Resigned",
            end_date=TODAY,
            duty_unit=UNIT,
            duty_post=POST,
        ),
        actor_user_id=user.id,
    )
    assert (row.duty_unit, row.duty_post) == (None, None)
    (event,) = _events(db_session, "G8002")
    assert (event.event_type, event.from_unit, event.from_post) == ("service_end", UNIT, POST)


def test_resignation_letter_dated_today_clears_the_post(db_session):
    user = _user(db_session)
    emp = _emp(db_session)
    _record_pending_resignation(
        db_session, emp, {"resignation_date": TODAY.isoformat()}, actor_user_id=user.id
    )
    db_session.commit()
    assert (emp.status, emp.duty_unit, emp.duty_post) == ("Resigned", None, None)
    (event,) = _events(db_session)
    assert (event.event_type, event.actor_user_id) == ("service_end", user.id)


def test_future_resignation_letter_keeps_the_post(db_session):
    emp = _emp(db_session)
    _record_pending_resignation(
        db_session, emp, {"resignation_date": (TODAY + timedelta(days=5)).isoformat()}
    )
    db_session.commit()
    assert (emp.status, emp.duty_unit, emp.duty_post) == ("Active", UNIT, POST)
    assert _events(db_session) == []


def test_departed_employee_cannot_be_posted(db_session, admin_user):
    _emp(db_session, status="Resigned", end_date=TODAY, duty_unit=None, duty_post=None)
    with pytest.raises(ValidationFailedError) as exc:
        duty_service.transfer(
            db_session,
            moves=[DutyTransferMove(employee_id="G8001", to_unit=UNIT, to_post=POST)],
            current_user=admin_user,
        )
    assert exc.value.code == "DUTY_EMPLOYEE_DEPARTED"
    assert db_session.get(Employee, "G8001").duty_unit is None
    assert _events(db_session) == []


def test_departure_and_return_show_in_the_activity_timeline(db_session):
    user = _user(db_session)
    _emp(db_session)
    employee_service.update_employee(
        db_session,
        "G8001",
        EmployeeUpdate(status="Resigned", end_date=TODAY),
        actor_user_id=user.id,
    )
    employee_service.update_employee(
        db_session, "G8001", EmployeeUpdate(status="Active"), actor_user_id=user.id
    )
    result = employee_activity_service.list_employee_activity(
        db_session, owner_user_id=user.id, employee_id="G8001", kind="duty_location"
    )
    assert [(i.event_type, i.from_unit, i.to_unit) for i in result.items] == [
        ("reinstatement", None, UNIT),
        ("service_end", UNIT, None),
    ]


def test_restore_moves_the_crew_without_a_second_reconciliation_event(db_session):
    """The reinstatement event already matches, so reconciliation adds none."""
    from app.db.workforce_models import WorkCrew, WorkCrewMembership
    from app.services import workforce_seed_service
    from tests.factories.attendance import build_attendance_day

    fixture = build_attendance_day(
        db_session, operational_date=TODAY - timedelta(days=1), unit=UNIT, posts=[(POST, 1)]
    )
    (emp,) = fixture.employees
    other = "السرية الأولى"
    emp.duty_unit = other  # enrolled in UNIT's crew, posted to another unit
    db_session.commit()
    employee_service.update_employee(
        db_session,
        emp.id,
        EmployeeUpdate(status="Resigned", end_date=TODAY),
        actor_user_id=fixture.admin.id,
    )
    employee_service.update_employee(
        db_session, emp.id, EmployeeUpdate(status="Active"), actor_user_id=fixture.admin.id
    )

    assert emp.duty_unit == other
    assert [e.event_type for e in _events(db_session, emp.id)] == ["service_end", "reinstatement"]
    latest = db_session.scalar(
        select(WorkCrewMembership)
        .where(WorkCrewMembership.employee_id == emp.id)
        .order_by(WorkCrewMembership.effective_from.desc())
    )
    crew = db_session.get(WorkCrew, latest.crew_id)
    assert crew.code == workforce_seed_service.DUTY_UNIT_TO_CREW[other]
