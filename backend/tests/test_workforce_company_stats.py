"""Closed-period company statistics from the scoped attendance register and Leaves."""

from __future__ import annotations

from collections import defaultdict
from datetime import date, time, timedelta
from io import BytesIO
from typing import Any
from urllib.parse import unquote
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from openpyxl import load_workbook
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import clock
from app.db.models import Book, BookCategory, BookVersion, Document, Employee
from app.db.workforce_models import (
    AttendanceAdjustment,
    AttendanceCase,
    AttendanceEvaluation,
    AttendancePunchAssignment,
    AttendancePunchProfile,
    DutyAssignmentEvent,
    WorkAttendancePolicy,
    WorkShiftOccurrence,
)
from app.services import perm_service, workforce_read_service
from app.services.attendance_evaluation_service import evaluate_case
from app.services.workforce_access_service import organization_scope
from tests.factories.attendance import build_attendance_day, local, utc_naive
from tests.test_attendance_evaluation_service import _punch, _seed_case
from tests.test_workforce_api_permissions import _client, _scope, _user
from tests.test_workforce_leave_precedence import _employee, _leave

PATH = "/api/v1/workforce/attendance/company-stats"
EXPORT_PATH = f"{PATH}/export"
START, END, TODAY = date(2026, 8, 17), date(2026, 8, 19), date(2026, 8, 20)
REVIEW_CAPS = ("workforce.attendance.review", "workforce.people.view")


@pytest.fixture(autouse=True)
def organization_clock(monkeypatch: pytest.MonkeyPatch) -> None:
    # It is already August 20 in Dubai, but still August 19 in UTC.
    monkeypatch.setattr(clock, "organization_today", lambda: TODAY)
    monkeypatch.setattr(clock, "utcnow", lambda: utc_naive(local(TODAY, time(0, 15))))


@pytest.fixture
def admin_client(api_db: Session) -> TestClient:
    return _client(api_db, _user(api_db, role="admin", email="stats-admin@test.ae"))


def _stats(
    client: TestClient,
    start: date = START,
    end: date = END,
    **params: str | int,
) -> dict[str, Any]:
    response = client.get(PATH, params={"from_date": str(start), "to_date": str(end), **params})
    assert response.status_code == 200, response.text
    return response.json()


def _case(
    db: Session, seed: AttendanceCase, employee_id: str, day: date, unit: str | None
) -> AttendanceCase:
    """Another case in the seed's shift, with its own occurrence if the date changes."""
    source = db.get(WorkShiftOccurrence, seed.shift_occurrence_id)
    assert source is not None
    delta = day - seed.operational_date
    starts_at, ends_at = seed.scheduled_start_at + delta, seed.scheduled_end_at + delta
    occurrence = db.scalar(
        select(WorkShiftOccurrence).where(
            WorkShiftOccurrence.crew_schedule_id == source.crew_schedule_id,
            WorkShiftOccurrence.starts_at == starts_at,
        )
    )
    if occurrence is None:
        occurrence = WorkShiftOccurrence(
            crew_id=source.crew_id,
            crew_schedule_id=source.crew_schedule_id,
            shift_definition_id=source.shift_definition_id,
            starts_at=starts_at,
            ends_at=ends_at,
            operational_date=day,
            pattern_code_snapshot=source.pattern_code_snapshot,
            crew_schedule_version_snapshot=source.crew_schedule_version_snapshot,
            source_anchor_at=source.source_anchor_at,
        )
        db.add(occurrence)
        db.flush()
    case = AttendanceCase(
        employee_id=employee_id,
        shift_occurrence_id=occurrence.id,
        employee_status_snapshot="Active",
        shift_code_snapshot=seed.shift_code_snapshot,
        department_snapshot="Security",
        duty_unit_snapshot=unit,
        scheduled_start_at=starts_at,
        scheduled_end_at=ends_at,
        operational_date=day,
        organization_snapshot_state="captured",
    )
    db.add(case)
    db.flush()
    return case


def _leave_span(
    db: Session, employee_id: str, kind: str, start: date, end: date, status: str = "Approved"
) -> int:
    # Intentionally do not use Leave.days: workforce tiles count calendar overlap.
    return _leave(
        db, employee_id=employee_id, leave_type=kind, start_date=start, end_date=end, status=status
    ).id


def test_dubai_yesterday_clamps_and_previous_period_is_adjacent(admin_client: TestClient) -> None:
    data = _stats(admin_client, end=TODAY)
    assert (data["coverage_from"], data["previous_comparable"]) == (None, False)
    assert data["closed_through"] == "2026-08-19"
    assert data["period"] == {
        "from_date": "2026-08-17",
        "to_date": "2026-08-19",
        "requested_to_date": "2026-08-20",
        "days": 3,
        "clamped": True,
    }
    assert data["previous_period"] == {
        "from_date": "2026-08-14",
        "to_date": "2026-08-16",
        "requested_to_date": "2026-08-16",
        "days": 3,
        "clamped": False,
    }


@pytest.mark.parametrize(
    "start", [TODAY, END - timedelta(days=366)], ids=["no-closed-day", "too-long"]
)
def test_rejects_invalid_closed_periods(admin_client: TestClient, start: date) -> None:
    response = admin_client.get(PATH, params={"from_date": str(start), "to_date": str(TODAY)})
    assert response.status_code == 422, response.text


def test_accepts_exactly_366_days_after_clamping(admin_client: TestClient) -> None:
    assert _stats(admin_client, END - timedelta(days=365), TODAY)["period"]["days"] == 366


@pytest.mark.parametrize("path", [PATH, EXPORT_PATH], ids=["stats", "export"])
@pytest.mark.parametrize("denied", REVIEW_CAPS)
def test_both_register_capabilities_are_required(api_db: Session, denied: str, path: str) -> None:
    user = _user(api_db, email="stats-reviewer@test.ae")
    for capability in REVIEW_CAPS:
        perm_service.set_user_override(
            api_db, user.id, capability, "deny" if capability == denied else "grant"
        )
    _scope(api_db, user, kind="organization")
    response = _client(api_db, user).get(
        path, params={"from_date": str(START), "to_date": str(END)}
    )
    assert response.status_code == 403, response.text


def test_scope_uses_case_snapshots_and_leave_day_hierarchy(api_db: Session) -> None:
    inside = _seed_case(api_db)
    inside.department_snapshot, inside.duty_unit_snapshot = "Security", "Alpha"
    inside_employee = inside.employee_id
    outside = _employee(api_db, "G-OUT")
    outside.duty_unit = "Alpha"  # Latest event, not this field, wins for leave/NS.
    _case(api_db, inside, outside.id, START, "Beta")
    user = _user(api_db, email="alpha-reviewer@test.ae")
    for capability in REVIEW_CAPS:
        perm_service.set_user_override(api_db, user.id, capability, "grant")
    _scope(api_db, user, kind="duty_unit", duty_unit="Alpha")
    for employee_id, unit in [(inside_employee, "Alpha"), (outside.id, "Beta")]:
        api_db.add(
            DutyAssignmentEvent(
                employee_id=employee_id,
                event_type="baseline",
                effective_at=utc_naive(local(START, time(0))),
                to_department="Security",
                to_unit=unit,
            )
        )
        _leave_span(api_db, employee_id, "Annual Leave", START, START)
        _leave_span(api_db, employee_id, "National Service", END, TODAY, "Pending")
    api_db.commit()

    data = _stats(_client(api_db, user))
    assert [row["key"] for row in data["companies"]] == ["Alpha"]
    assert data["overall"]["duties_scheduled"] == 1
    assert data["summary"]["current"]["leaves"]["annual"] == {"days": 1, "count": 1}
    assert data["national_service"]["absence_days"] == 1
    assert [row["employee_id"] for row in data["national_service"]["enrolled"]] == [inside_employee]
    assert data["ranking"]["order"]["score"] == [inside_employee]


def test_filter_uses_snapshot_and_keeps_comparison_and_transfer(
    api_db: Session, admin_client: TestClient
) -> None:
    first = _seed_case(api_db)
    first.duty_unit_snapshot = "Alpha"
    _case(api_db, first, first.employee_id, date(2026, 8, 18), "Beta")
    _case(api_db, first, first.employee_id, END, "Beta")
    unassigned = _employee(api_db, "G-UNASSIGNED")
    _case(api_db, first, unassigned.id, START, None)
    _case(api_db, first, unassigned.id, END, "  ")
    _case(api_db, first, unassigned.id, date(2026, 8, 14), None)
    _case(api_db, first, unassigned.id, date(2026, 8, 15), "  ")
    api_db.commit()

    data = _stats(admin_client, duty_unit="Beta")
    alpha, beta, other = data["companies"]
    assert [(r["key"], r["totals"]["duties_scheduled"]) for r in (alpha, beta, other)] == [
        ("Alpha", 1),
        ("Beta", 2),
        ("__unassigned__", 2),
    ]
    assert other["duty_unit"] is None
    assert data["overall"]["strength"] == 2  # Do not double-count the transferee.
    assert data["overall"]["absence"] == {"days": 5, "episodes": 2}
    assert alpha["ratio"]["absence"] == pytest.approx(0.6)
    assert beta["ratio"]["absence"] == pytest.approx(1.2)
    assert beta["small_sample"] is True
    assert beta["status"] == dict.fromkeys(("absence", "single_punch", "late", "overall"))
    assert data["summary"]["current"]["absence"] == {"days": 2, "episodes": 1}
    assert data["ranking"]["total"] == 1
    row = data["ranking"]["rows"][0]
    assert (row["employee_id"], row["duty_unit"], row["score"]) == (first.employee_id, "Beta", 6)
    assert (row["events"], row["small_sample"], row["tier"]) == (2, True, None)
    assert row["transfer"] == {"from_unit": "Alpha", "to_unit": "Beta", "on_date": "2026-08-18"}

    unassigned_data = _stats(admin_client, duty_unit="__unassigned__")
    assert unassigned_data["companies"] == data["companies"]
    assert unassigned_data["summary"]["current"]["duties_scheduled"] == 2
    assert unassigned_data["summary"]["previous"]["duties_scheduled"] == 2
    assert _stats(admin_client, duty_unit="  ")["summary"]["previous"]["duties_scheduled"] == 0
    assert unassigned_data["ranking"]["order"]["score"] == [unassigned.id]
    assert unassigned_data["ranking"]["rows"][0]["transfer"] is None


def test_company_selection_and_workbook_share_natural_company_order(
    api_db: Session, admin_client: TestClient
) -> None:
    ordered = [
        "السرية الأولى",
        "السرية الثانية",
        "السرية الثالثة",
        "السرية الرابعة",
        "السرية الخامسة",
        "الفريق التاسع",
        "الفريق العاشر",
        "Company 2",
        "Company \u0663",
        "Company 10",
        "apple",
        "Zebra",
        "الدوام الرسمي",
        "مجموعة الدعم",
    ]
    seed = _seed_case(api_db)  # Null duty unit sorts last, regardless of insertion order.
    for index, unit in enumerate(reversed(ordered)):
        employee = _employee(api_db, f"G-SORT-{index}")
        _case(api_db, seed, employee.id, START, unit)
    api_db.commit()

    data = _stats(admin_client, duty_unit="السرية الثانية")
    assert [row["key"] for row in data["companies"]] == [*ordered, "__unassigned__"]

    response = admin_client.get(
        EXPORT_PATH,
        params={"from_date": str(START), "to_date": str(END), "language": "en"},
    )
    assert response.status_code == 200, response.text
    workbook = load_workbook(BytesIO(response.content))
    assert [cell.value for cell in workbook["Companies"]["A"][1:]] == [
        *ordered,
        "Unassigned",
        "Total",
    ]


def test_rate_excludes_both_kinds_of_excused_duties(
    api_db: Session, admin_client: TestClient
) -> None:
    absent = _seed_case(api_db)
    absent.duty_unit_snapshot = "Alpha"
    present = _employee(api_db, "G-PRESENT")
    present_case = _case(api_db, absent, present.id, START, "Alpha")
    api_db.add(
        AttendanceEvaluation(
            attendance_case_id=present_case.id,
            revision=1,
            presence_state="completed",
            reason_code="SHIFT_COMPLETED",
            algorithm_version="stats-test",
            input_fingerprint="present",
        )
    )
    for label, status in [("Annual Leave", "Approved"), ("National Service", "Pending")]:
        employee = _employee(api_db, f"G-{label}")
        case = _case(api_db, absent, employee.id, START, "Alpha")
        _leave_span(api_db, employee.id, label, START, END, status)
        evaluation = evaluate_case(api_db, case.id, evaluated_at=local(END, time(23, 0)))
        assert evaluation is not None and evaluation.presence_state == "excused_leave"
    api_db.commit()

    totals = _stats(admin_client)["summary"]["current"]
    assert (totals["duties_scheduled"], totals["duties_excused"], totals["duties_due"]) == (4, 2, 2)
    assert totals["absence"] == {"days": 1, "episodes": 1}
    assert totals["absence_rate"] == 50.0


def test_register_evidence_latest_correction_and_ranking_top_sort_union(
    api_db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(clock, "utcnow", lambda: utc_naive(local(TODAY, time(12))))
    fixture = build_attendance_day(
        api_db,
        operational_date=END,
        posts=[("Gate", 3)],
        punches={"G-9001": [time(5, 47)], "G-9002": [time(5, 7)]},
    )
    late, unpaired, corrected = fixture.employees
    case = next(
        c
        for c in fixture.cases
        if c.employee_id == corrected.id and c.shift_code_snapshot == "morning"
    )
    latest = AttendanceEvaluation(
        attendance_case_id=case.id,
        revision=2,
        presence_state="absent",
        reason_code="NO_PUNCH",
        algorithm_version="stats-test",
        input_fingerprint="latest-absence",
    )
    api_db.add(latest)
    api_db.flush()
    api_db.add(
        AttendanceAdjustment(
            attendance_case_id=case.id,
            base_evaluation_id=latest.id,
            replacement_presence_state="completed",
            reason="Supervisor confirmed duty",
            created_by_user_id=fixture.admin.id,
        )
    )
    api_db.commit()

    data = _stats(_client(api_db, fixture.admin), END, END, limit=1)
    totals = data["summary"]["current"]
    assert totals["duties_scheduled"] == 6
    assert totals["single_punch"] == 1  # A late lone punch is late, not unpaired.
    assert totals["late"] == {"count": 1, "minutes": 17}
    assert totals["absence"] == {"days": 3, "episodes": 3}
    assert totals["duties_pending"] == 0
    assert data["summary"]["previous"]["duties_scheduled"] == 3
    assert data["ranking"]["total"] == 3
    assert data["ranking"]["average_score"] == 4
    assert data["ranking"]["order"] == {
        "score": [unpaired.id],
        "absence": [late.id],
        "late": [late.id],
        "single_punch": [unpaired.id],
    }
    assert {row["employee_id"] for row in data["ranking"]["rows"]} == {late.id, unpaired.id}


def test_range_matches_the_registers_profile_boundary_and_cross_case_assignments(
    api_db: Session, admin_client: TestClient
) -> None:
    case = _seed_case(api_db)
    case.duty_unit_snapshot = "Alpha"
    previous = _case(api_db, case, case.employee_id, START - timedelta(days=1), "Beta")
    # This duty ends at 03:00 UTC, inside the current duty's learned arrival window.
    shift = timedelta(hours=15)
    previous.scheduled_start_at += shift
    previous.scheduled_end_at += shift
    occurrence = api_db.get(WorkShiftOccurrence, previous.shift_occurrence_id)
    assert occurrence is not None
    occurrence.starts_at, occurrence.ends_at = (
        previous.scheduled_start_at,
        previous.scheduled_end_at,
    )
    api_db.add(
        AttendancePunchProfile(
            employee_id=case.employee_id,
            shift_code=case.shift_code_snapshot,
            sample_days=30,
            arrival_early_offset=-150,
            arrival_typical_offset=-100,
            window_days=90,
        )
    )
    _punch(
        api_db,
        case,
        event_id="within-previous-duty",
        at=utc_naive(local(START, time(6, 45))),
        direction="unknown",
    )
    assigned = _punch(
        api_db,
        case,
        event_id="allocated-to-previous",
        at=utc_naive(local(START, time(7, 5))),
        direction="out",
    )
    api_db.add(
        AttendancePunchAssignment(
            punch_id=assigned.id, attendance_case_id=previous.id, algorithm_version="test"
        )
    )
    _punch(
        api_db,
        case,
        event_id="learned-arrival",
        at=utc_naive(local(START, time(7, 10))),
        direction="unknown",
    )
    api_db.commit()

    response = admin_client.get(
        "/api/v1/workforce/attendance/day", params={"operational_date": str(START)}
    )
    assert response.status_code == 200, response.text
    (row,) = response.json()["items"]
    assert (row["punch_count"], row["first_punch_at"]) == (1, "2026-08-17T03:10:00Z")
    totals = _stats(admin_client, START, START, duty_unit="Alpha")["summary"]["current"]
    assert totals["single_punch"] == 1
    assert totals["absence"]["days"] == 0


def test_leave_tiles_clip_both_edges_and_split_calendar_days_at_transfer(
    api_db: Session, admin_client: TestClient
) -> None:
    actor = _user(api_db, email="transfer@test.ae")
    case = _seed_case(api_db)
    case.duty_unit_snapshot = "Alpha"
    _case(api_db, case, case.employee_id, END, "Beta")
    api_db.add_all(
        [
            DutyAssignmentEvent(
                employee_id=case.employee_id,
                event_type="baseline",
                to_unit="Alpha",
                effective_at=utc_naive(local(date(2026, 8, 14), time(0))),
            ),
            # This transfer is after duty, but on August 18 in Dubai, not August 19.
            DutyAssignmentEvent(
                employee_id=case.employee_id,
                event_type="transfer",
                from_unit="Alpha",
                to_unit="Beta",
                effective_at=utc_naive(local(date(2026, 8, 18), time(23, 59))),
                actor_user_id=actor.id,
            ),
        ]
    )
    for label, lo, hi, status in [
        ("Annual Leave - إجازة سنوية", date(2026, 8, 16), TODAY, "Approved - موافق"),
        ("Administrative Leave إجازة إدارية", END, TODAY, "Approved"),
        ("Emergency Leave", START, END, "Approved"),
        ("Annual Leave", START, START, "Pending"),
        ("National Service", END, TODAY, "Pending"),
        ("Sick Leave", START, END, "Approved"),
    ]:
        _leave_span(api_db, case.employee_id, label, lo, hi, status)
    api_db.commit()

    data = _stats(admin_client)
    leaves = data["summary"]["current"]["leaves"]
    assert leaves["annual"] == {"days": 3, "count": 1}
    assert leaves["administrative"] == {"days": 1, "count": 1}
    assert leaves["other"] == {"days": 3, "count": 1}
    assert leaves["national_service"] == {"days": 1, "count": 1}
    assert data["summary"]["previous"]["leaves"]["annual"] == {"days": 1, "count": 1}
    assert data["companies"][0]["totals"]["leaves"]["annual"] == {"days": 1, "count": 1}
    assert data["companies"][1]["totals"]["leaves"]["annual"] == {"days": 2, "count": 1}

    beta = _stats(admin_client, duty_unit="Beta")
    assert beta["summary"]["current"]["leaves"]["annual"] == {"days": 2, "count": 1}
    assert (beta["series"][0]["sick_days"], beta["series"][0]["sick_count"]) == (2, 1)
    assert beta["national_service"]["enrolled"][0]["employee_id"] == case.employee_id
    row = beta["ranking"]["rows"][0]
    assert (row["sick_days"], row["leave_days"], row["leave_count"]) == (2, 8, 5)


def _permit_book(db: Session, leave_id: int, *durations: object) -> Book:
    book = Book(category_id="HR", ref_number=f"HR-{uuid4().hex[:16]}")
    db.add(book)
    db.flush()
    for index, hours in enumerate(durations, start=1):
        document = Document(
            template_id="Leave Permit Form",
            ref_number=book.ref_number,
            leave_id=leave_id,
            submission_id=f"permit-{book.id}-{index}",
        )
        db.add(document)
        db.flush()
        db.add(
            BookVersion(
                book_id=book.id,
                version_no=index,
                document_id=document.id,
                template_id=document.template_id,
                fields={"duration_hours": hours},
            )
        )
    db.flush()
    return book


def test_permit_hours_use_the_live_owning_current_version(
    api_db: Session, admin_client: TestClient
) -> None:
    api_db.add(BookCategory(id="HR", prefix="HR"))
    employee = _employee(api_db, "G-PERMIT")
    employee.duty_unit = "Alpha"
    prose = _employee(api_db, "G-PROSE")
    prose.duty_unit = "Beta"
    first = _leave_span(api_db, employee.id, "Leave Permit", START, START, "Generated")
    second = _leave_span(api_db, employee.id, "Leave Permit - تصريح خروج", END, END)
    third = _leave_span(api_db, prose.id, "Leave Permit", END, TODAY)
    _permit_book(api_db, first, 99, 2)
    _permit_book(api_db, second, 12)  # Reissued: the newer live owning Document wins.
    _permit_book(api_db, second, "\u0662\u066b\u0665")  # Arabic-Indic 2.5.
    _permit_book(api_db, second, 18).voided_at = utc_naive(local(TODAY, time(1)))
    _permit_book(api_db, third, 99, "8:30 to end of shift")
    outside = _leave_span(api_db, prose.id, "Leave Permit", date(2026, 8, 16), START)
    _permit_book(api_db, outside, 20)  # A permit counts only on its starting date.
    api_db.commit()

    all_permits = _stats(admin_client)["summary"]["current"]["leaves"]["exit_permits"]
    assert all_permits == {"count": 3, "hours": 4.5, "with_hours": 2}
    prose_permits = _stats(admin_client, duty_unit="Beta")["summary"]["current"]["leaves"][
        "exit_permits"
    ]
    assert prose_permits == {"count": 1, "hours": None, "with_hours": 0}


def test_national_service_is_live_today_even_outside_requested_period(
    api_db: Session, admin_client: TestClient
) -> None:
    for employee_id, start, end, status in [
        ("G-LONG", date(2026, 8, 18), date(2026, 8, 22), "Pending - انتظار"),
        ("G-LAST-DAY", date(2026, 8, 19), TODAY, "Pending"),
        ("G-DONE", START, END + timedelta(days=2), "Completed"),
        ("G-CANCELLED", START, TODAY, "Cancelled"),
        ("G-SCHEDULED", date(2026, 8, 21), date(2026, 8, 22), "Pending"),
    ]:
        employee = _employee(api_db, employee_id)
        employee.duty_unit = "Alpha"
        _leave_span(api_db, employee.id, "National Service الخدمة الوطنية", start, end, status)
    api_db.commit()

    data = _stats(admin_client, START, START)["national_service"]
    assert data["absence_days"] == 1  # Completed is still an excusing historical NS row.
    assert [r["employee_id"] for r in data["enrolled"]] == ["G-LAST-DAY", "G-LONG"]
    last_day, long = data["enrolled"]
    assert (last_day["return_date"], last_day["days_remaining"], last_day["progress"]) == (
        "2026-08-21",
        1,
        0.5,
    )
    assert (long["return_date"], long["days_remaining"], long["progress"]) == ("2026-08-23", 3, 0.4)


def test_excused_only_company_and_empty_period_have_defined_zero_states(
    api_db: Session, admin_client: TestClient
) -> None:
    case = _seed_case(api_db)
    case.duty_unit_snapshot = "Only company"
    _leave_span(api_db, case.employee_id, "Sick Leave", START, START)
    evaluate_case(api_db, case.id, evaluated_at=local(END, time(23, 0)))
    api_db.commit()

    row = _stats(admin_client)["companies"][0]
    assert row["totals"]["duties_due"] == 0
    assert row["totals"]["absence_rate"] is None
    assert row["ratio"] == {"absence": None, "single_punch": None, "late": None}
    assert row["status"] == {"absence": None, "single_punch": None, "late": None, "overall": None}
    data = _stats(admin_client, END, END)
    assert data["companies"] == []
    assert data["summary"]["current"]["strength"] == 0
    assert data["summary"]["current"]["duties_scheduled"] == 0
    assert data["summary"]["current"]["absence"] == {"days": 0, "episodes": 0}
    assert data["ranking"] == {
        "total": 0,
        "average_score": 0,
        "rows": [],
        "order": {"score": [], "absence": [], "late": [], "single_punch": []},
    }


def test_leave_only_company_is_listed_unrated_and_reconciles_with_overall(
    api_db: Session, admin_client: TestClient
) -> None:
    absent = _seed_case(api_db)  # A non-zero overall baseline for the ratios.
    absent.duty_unit_snapshot = "Alpha"
    on_leave = _employee(api_db, "G-LEAVE-ONLY")
    on_leave.duty_unit = "Beta"  # No case in the period: Beta exists only through Leaves.
    _leave_span(api_db, on_leave.id, "Annual Leave", START, END)
    _leave_span(api_db, on_leave.id, "Leave Permit", END, END)
    api_db.commit()

    data = _stats(admin_client)
    assert [row["key"] for row in data["companies"]] == ["Alpha", "Beta"]
    beta = data["companies"][1]
    totals = beta["totals"]
    assert (totals["strength"], totals["duties_scheduled"], totals["duties_due"]) == (0, 0, 0)
    assert totals["absence_rate"] is None
    assert totals["leaves"]["annual"] == {"days": 3, "count": 1}
    assert totals["leaves"]["exit_permits"]["count"] == 1
    assert beta["small_sample"] is True
    assert beta["ratio"] == {"absence": None, "single_punch": None, "late": None}
    assert beta["status"] == dict.fromkeys(("absence", "single_punch", "late", "overall"))
    overall = data["overall"]["leaves"]
    for kind, field in (("annual", "days"), ("annual", "count"), ("exit_permits", "count")):
        companies = sum(row["totals"]["leaves"][kind][field] for row in data["companies"])
        assert companies == overall[kind][field]

    selected = _stats(admin_client, duty_unit="Beta")["summary"]["current"]["leaves"]
    assert selected["annual"] == {"days": 3, "count": 1}
    response = admin_client.get(
        EXPORT_PATH, params={"from_date": str(START), "to_date": str(END), "language": "en"}
    )
    assert response.status_code == 200, response.text
    sheet = load_workbook(BytesIO(response.content))["Companies"]
    assert [cell.value for cell in sheet["A"][1:]] == ["Alpha", "Beta", "Total"]


def test_series_is_weekly_for_short_periods_and_monthly_with_clipped_edges(
    api_db: Session, admin_client: TestClient
) -> None:
    first = _seed_case(api_db)
    _case(api_db, first, first.employee_id, END, None)
    api_db.commit()
    weekly = _stats(admin_client, date(2026, 8, 12), END)
    assert weekly["granularity"] == "week"
    assert [(b["start"], b["end"]) for b in weekly["series"]] == [
        ("2026-08-12", "2026-08-18"),
        ("2026-08-19", "2026-08-19"),
    ]
    # No duty was scheduled between the two absences. The run starts in week 1.
    assert [(b["absence_days"], b["absence_episodes"]) for b in weekly["series"]] == [
        (1, 1),
        (1, 0),
    ]
    monthly = _stats(admin_client, date(2026, 7, 19), END)
    assert monthly["granularity"] == "month"
    assert [(b["start"], b["end"]) for b in monthly["series"]] == [
        ("2026-07-19", "2026-07-31"),
        ("2026-08-01", "2026-08-19"),
    ]


def test_coverage_is_scoped_before_the_company_filter(
    api_db: Session, admin_client: TestClient
) -> None:
    seed = _seed_case(api_db)
    seed.duty_unit_snapshot = "Alpha"
    older = date(2026, 8, 14)
    _case(api_db, seed, seed.employee_id, older, "Beta")
    reviewer = _user(api_db, email="stats-coverage@test.ae")
    for cap in REVIEW_CAPS:
        perm_service.set_user_override(api_db, reviewer.id, cap, "grant")
    _scope(api_db, reviewer, kind="duty_unit", duty_unit="Alpha")
    api_db.commit()

    all_scope = _stats(admin_client, duty_unit="Alpha")
    assert all_scope["coverage_from"] == "2026-08-14"
    assert all_scope["previous_comparable"] is True  # Equality is comparable.
    assert (
        all_scope["summary"]["previous"]["duties_scheduled"] == 0
    )  # Beta did not leak into Alpha totals.
    limited = _stats(_client(api_db, reviewer))
    assert limited["coverage_from"] == "2026-08-17"
    assert limited["previous_comparable"] is False

    empty_reviewer = _user(api_db, email="stats-no-scope@test.ae")
    for cap in REVIEW_CAPS:
        perm_service.set_user_override(api_db, empty_reviewer.id, cap, "grant")
    empty = _stats(_client(api_db, empty_reviewer))
    assert (empty["coverage_from"], empty["previous_comparable"]) == (None, False)


def test_partial_previous_period_keeps_its_actual_totals(
    api_db: Session, admin_client: TestClient
) -> None:
    seed = _seed_case(api_db)
    seed.duty_unit_snapshot = "Alpha"
    previous = _case(api_db, seed, seed.employee_id, date(2026, 8, 15), "Alpha")
    _case(api_db, seed, seed.employee_id, date(2026, 8, 16), "Alpha")
    _punch(
        api_db,
        previous,
        event_id="past-grace",
        at=previous.scheduled_start_at + timedelta(minutes=28),
        direction="in",
    )
    _leave_span(api_db, seed.employee_id, "Sick Leave", date(2026, 8, 14), date(2026, 8, 14))
    api_db.commit()

    data = _stats(admin_client, duty_unit="Alpha")
    assert data["coverage_from"] == "2026-08-15"
    assert data["previous_comparable"] is False
    previous_totals = data["summary"]["previous"]
    assert previous_totals["duties_scheduled"] == 2
    assert previous_totals["strength"] == 1
    assert previous_totals["absence"] == {"days": 1, "episodes": 1}
    assert previous_totals["late"] == {"count": 1, "minutes": 18}
    assert previous_totals["leaves"]["sick"] == {"days": 0, "count": 0}
    # Coverage clips the case scan, not leave history. This leave has no unit of its own.
    assert _stats(admin_client)["summary"]["previous"]["leaves"]["sick"] == {"days": 1, "count": 1}


def test_previous_totals_reader_uses_the_same_judgment_fields_as_the_register(
    api_db: Session,
) -> None:
    fixture = build_attendance_day(
        api_db,
        operational_date=END,
        posts=[("Gate", 2)],
        punches={"G-9002": [time(5, 47), time(12, 22)]},
    )
    excused, corrected = fixture.employees
    correction_case = next(
        case
        for case in fixture.cases
        if case.employee_id == corrected.id and case.shift_code_snapshot == "morning"
    )
    _leave_span(api_db, excused.id, "Sick Leave", END, END)
    for case in fixture.cases:
        if case.employee_id == excused.id:
            evaluate_case(api_db, case.id, evaluated_at=local(TODAY, time(12)))
    latest = api_db.scalar(
        select(AttendanceEvaluation)
        .where(AttendanceEvaluation.attendance_case_id == correction_case.id)
        .order_by(AttendanceEvaluation.revision.desc())
    )
    assert latest is not None
    api_db.add(
        AttendanceAdjustment(
            attendance_case_id=correction_case.id,
            base_evaluation_id=latest.id,
            replacement_presence_state="completed",
            replacement_late_minutes=45,
            reason="Supervisor correction",
            created_by_user_id=fixture.admin.id,
        )
    )
    _case(api_db, correction_case, corrected.id, TODAY, correction_case.duty_unit_snapshot)
    for policy in api_db.scalars(select(WorkAttendancePolicy)):
        policy.effective_to = TODAY
    api_db.commit()

    scope = organization_scope()
    expected = defaultdict(list)
    for case, judgment, _ in workforce_read_service.iter_effective_attendance_rows(
        api_db,
        scope=scope,
        from_date=END,
        to_date=TODAY,
        include_day_fields=True,
    ):
        expected[case.employee_id].append(judgment)
    assert len(expected[excused.id]) == 2  # Double shift.
    assert all(row.on_leave and row.leave_kind == "sick" for row in expected[excused.id])
    assert expected[corrected.id][0].late_minutes == 45
    assert expected[corrected.id][-1].absence_due_at is None  # No policy for this date.
    actual = defaultdict(list)
    for employee_id, judgment in workforce_read_service.iter_effective_attendance_totals_rows(
        api_db,
        scope=scope,
        from_date=END,
        to_date=TODAY,
    ):
        actual[employee_id].append(judgment)
    assert actual == expected


def test_company_status_starts_at_thirty_due_duties_not_thirty_scheduled(
    api_db: Session, admin_client: TestClient
) -> None:
    seed = _seed_case(api_db)
    seed.duty_unit_snapshot = "Alpha"
    seed_employee = api_db.get(Employee, seed.employee_id)
    assert seed_employee is not None
    seed_employee.duty_unit = "Alpha"  # The sick leave stays in Alpha, not "Unassigned".
    for unit in ("Alpha", "Beta"):
        for index in range(29 if unit == "Alpha" else 30):
            person = _employee(api_db, f"G-{unit}-{index}")
            _case(api_db, seed, person.id, START, unit)
    _leave_span(api_db, seed.employee_id, "Sick Leave", START, START)
    evaluate_case(api_db, seed.id, evaluated_at=local(END, time(23)))
    api_db.commit()

    alpha, beta = _stats(admin_client)["companies"]
    assert alpha["totals"]["duties_scheduled"] == 30
    assert alpha["totals"]["duties_due"] == 29
    assert alpha["small_sample"] is True
    assert alpha["ratio"]["absence"] == pytest.approx(58 / 59)
    assert alpha["status"] == dict.fromkeys(("absence", "single_punch", "late", "overall"))
    assert beta["totals"]["duties_due"] == 30
    assert beta["small_sample"] is False
    assert beta["status"]["absence"] == beta["status"]["overall"] == "normal"


def test_employee_tier_starts_at_three_events(api_db: Session, admin_client: TestClient) -> None:
    seed = _seed_case(api_db)
    two = _employee(api_db, "G-TWO")
    _case(api_db, seed, two.id, START, None)
    for day in (START + timedelta(days=1), END):
        _case(api_db, seed, seed.employee_id, day, None)
    _case(api_db, seed, two.id, END, None)
    for index in range(2):
        person = _employee(api_db, f"G-ON-TIME-{index}")
        case = _case(api_db, seed, person.id, START, None)
        api_db.add(
            AttendanceEvaluation(
                attendance_case_id=case.id,
                revision=1,
                presence_state="completed",
                reason_code="SHIFT_COMPLETED",
                algorithm_version="stats-test",
                input_fingerprint="present",
            )
        )
    api_db.commit()
    ranking = _stats(admin_client)["ranking"]
    assert ranking["average_score"] == 3.75
    by_id = {row["employee_id"]: row for row in ranking["rows"]}
    assert (by_id[two.id]["events"], by_id[two.id]["small_sample"], by_id[two.id]["tier"]) == (
        2,
        True,
        None,
    )
    three = by_id[seed.employee_id]
    assert (three["events"], three["small_sample"], three["tier"]) == (
        3,
        False,
        "needs_intervention",
    )


@pytest.mark.parametrize("start", [TODAY, END - timedelta(days=366)])
def test_export_rejects_invalid_closed_period(admin_client: TestClient, start: date) -> None:
    response = admin_client.get(
        EXPORT_PATH, params={"from_date": str(start), "to_date": str(TODAY)}
    )
    assert response.status_code == 422, response.text


@pytest.mark.parametrize(
    "language,titles,note",
    [
        (
            "en",
            ["Summary", "Companies", "Trend", "Ranking", "National service"],
            "Not enough earlier data",
        ),
        (
            "ar",
            ["ملخص الفترة", "السرايا", "الاتجاه عبر الزمن", "الأكثر تكراراً", "الخدمة الوطنية"],
            "لا توجد بيانات سابقة كافية",
        ),
    ],
)
def test_export_workbook_has_localized_worksheets_and_typed_cells(
    api_db: Session,
    admin_client: TestClient,
    language: str,
    titles: list[str],
    note: str,
) -> None:
    case = _seed_case(api_db)
    case.duty_unit_snapshot = "Alpha"
    employee = _employee(api_db, "G-EXCEL")
    employee.name_en = "=1+1"  # Employee data must export as text, not a spreadsheet formula.
    employee.name_ar = "=1+1"
    _case(api_db, case, employee.id, START, "Alpha")
    employee.duty_unit = "Alpha"
    _leave_span(api_db, employee.id, "National Service", END, TODAY + timedelta(days=2), "Pending")
    api_db.commit()
    response = admin_client.get(
        EXPORT_PATH,
        params={"from_date": str(START), "to_date": str(TODAY), "language": language},
    )
    assert response.status_code == 200, response.text
    assert (
        response.headers["Content-Type"]
        == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    disposition = response.headers["Content-Disposition"]
    assert disposition.startswith("attachment; filename*=UTF-8''")
    filename = unquote(disposition.split("''", 1)[1])
    assert filename.startswith("إحصائيات السرايا" if language == "ar" else "Company statistics")
    assert filename.endswith("2026-08-19.xlsx")  # Uses the clamped end date.

    workbook = load_workbook(BytesIO(response.content))
    assert workbook.sheetnames == titles
    for sheet in workbook:
        assert sheet.sheet_view.rightToLeft is (language == "ar")
        assert sheet.freeze_panes is not None
    summary, companies, trend, ranking, national_service = workbook.worksheets
    assert summary.max_column == 3  # No delta column at all when coverage is incomplete.
    assert note in {cell.value for row in summary for cell in row}
    fraction = next(
        cell
        for row in companies
        for cell in row
        if cell.data_type == "n" and cell.number_format == "0.0%"
    )
    assert fraction.value == 1
    assert trend["C2"].value == 2
    assert trend["C2"].data_type == "n"
    assert national_service["H2"].value == pytest.approx(0.25)
    assert national_service["H2"].data_type == "n"
    assert national_service["H2"].number_format == "0.0%"
    name = next(cell for row in ranking for cell in row if cell.value == "=1+1")
    assert name.data_type == "s"
    assert ("عينة صغيرة" if language == "ar" else "Small sample") in {
        cell.value for row in ranking for cell in row
    }


def test_export_includes_all_ranked_employees_but_no_out_of_scope_data(api_db: Session) -> None:
    first = _seed_case(api_db)
    first.duty_unit_snapshot = "Alpha"
    _case(api_db, first, first.employee_id, END, "Alpha")  # Score 6; must rank first.
    earlier = date(2026, 8, 14)
    _case(api_db, first, first.employee_id, earlier, "Alpha")
    visible_ids = {first.employee_id}
    for index in range(52):
        employee = _employee(api_db, f"G-ALPHA-{index:02}")
        visible_ids.add(employee.id)
        _case(api_db, first, employee.id, START, "Alpha")
    outsider = _employee(api_db, "G-HIDDEN")
    outsider.duty_unit = "Beta"
    _case(api_db, first, outsider.id, START, "Beta")
    _leave_span(api_db, outsider.id, "National Service", END, TODAY, "Pending")
    user = _user(api_db, email="stats-export-reviewer@test.ae")
    for cap in REVIEW_CAPS:
        perm_service.set_user_override(api_db, user.id, cap, "grant")
    _scope(api_db, user, kind="duty_unit", duty_unit="Alpha")
    api_db.commit()
    response = _client(api_db, user).get(
        EXPORT_PATH,
        params={"from_date": str(START), "to_date": str(END), "language": "en"},
    )
    assert response.status_code == 200, response.text
    workbook = load_workbook(BytesIO(response.content))
    ranked_ids = [row[0] for row in workbook["Ranking"].iter_rows(min_row=2, values_only=True)]
    assert ranked_ids[0] == first.employee_id
    assert len(ranked_ids) == 53
    assert set(ranked_ids) == visible_ids
    for sheet in workbook:
        assert outsider.id not in {cell.value for row in sheet for cell in row}
    summary = workbook["Summary"]
    assert summary.max_column == 4
    absence = next(row for row in summary.iter_rows() if row[0].value == "Absence · Days")
    assert [(cell.value, cell.data_type) for cell in absence[1:]] == [
        (54, "n"),
        (1, "n"),
        (53, "n"),
    ]
    assert absence[3].number_format == "0%"
