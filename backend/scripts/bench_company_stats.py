"""Benchmark company statistics against two dense years of synthetic attendance.

Run from the repository root:
    ~/.venvs/sentinel/bin/python backend/scripts/bench_company_stats.py

The database is created in a temporary directory, never under the app's data
folder. Every employee has one valid occurrence per day, deliberately denser
than the roster's regular rest days. One warm-up per scenario is not timed.
"""

from __future__ import annotations

import sys
from datetime import UTC, date, datetime, time, timedelta
from pathlib import Path
from statistics import median
from tempfile import TemporaryDirectory
from time import perf_counter

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.core import clock
from app.db.models import Base, Book, BookCategory, BookVersion, Document, Employee, Leave, User
from app.db.session import attach_sqlite_pragmas
from app.db.workforce_models import (
    AttendanceAdjustment,
    AttendanceCase,
    AttendanceEvaluation,
    AttendanceEvaluationLeaveSource,
    AttendanceProviderPerson,
    AttendancePunch,
    AttendancePunchAssignment,
    DutyAssignmentEvent,
    WorkAttendancePolicy,
    WorkCrew,
    WorkCrewMembership,
    WorkCrewSchedule,
    WorkRotationPattern,
    WorkRotationStep,
    WorkShiftDefinition,
    WorkShiftOccurrence,
)
from app.services.workforce_access_service import organization_scope
from app.services.workforce_company_stats_service import company_attendance_stats

_PEOPLE = 350
_DAYS = 365
_RUNS = 5
_UNITS = tuple(
    [(f"Company {i}", 62, (5, 13, 21)[i % 3]) for i in range(1, 6)]
    + [("Office", 35, 8), (None, 5, 5)]
)


def _at(day: date, hour: int) -> datetime:
    return (
        datetime.combine(day, time(hour), clock.ORGANIZATION_TIMEZONE)
        .astimezone(UTC)
        .replace(tzinfo=None)
    )


def _employee_id(index: int) -> str:
    return f"B-{index:04}"


def _seed_leaves(db: Session, first: date, today: date) -> dict[tuple[int, date], tuple[int, str]]:
    excused: dict[tuple[int, date], tuple[int, str]] = {}
    db.add(BookCategory(id="bench", prefix="B"))
    db.flush()

    def leave(
        index: int,
        kind: str,
        start: date,
        duration: int,
        *,
        status: str = "Approved",
        reason: str | None = None,
    ) -> Leave:
        row = Leave(
            employee_id=_employee_id(index),
            leave_type=kind,
            start_date=start,
            end_date=start + timedelta(days=duration - 1),
            days=duration,
            status=status,
        )
        db.add(row)
        db.flush()
        if reason is not None:
            for offset in range(duration):
                excused[index, start + timedelta(days=offset)] = row.id, reason
        return row

    for index in range(1, _PEOPLE + 1):
        for season in (first, first + timedelta(days=_DAYS)):
            offset = index % 50
            leave(
                index,
                "Annual Leave",
                season + timedelta(days=30 + offset),
                7,
                reason="LEAVE_ANNUAL",
            )
            leave(
                index, "Sick Leave", season + timedelta(days=100 + offset), 3, reason="LEAVE_SICK"
            )
            if index % 5 == 0:
                leave(
                    index,
                    "Administrative Leave",
                    season + timedelta(days=160 + offset),
                    2,
                    reason="LEAVE_OTHER",
                )
            if index % 3 == 0:
                permit = leave(index, "Leave Permit", season + timedelta(days=220 + offset), 1)
                path = f"B-{permit.id:05}"
                book = Book(category_id="bench", ref_number=path, employee_id=permit.employee_id)
                document = Document(
                    template_id="Leave Permit Form",
                    ref_number=path,
                    employee_id=permit.employee_id,
                    leave_id=permit.id,
                    submission_id=path,
                )
                db.add_all([book, document])
                db.flush()
                db.add(
                    BookVersion(
                        book_id=book.id,
                        version_no=1,
                        document_id=document.id,
                        template_id=document.template_id,
                        fields={
                            "duration_hours": "\u0662\u066b\u0665"
                            if index % 2
                            else "Until end of shift"
                        },
                    )
                )
        if index % 35 == 0:
            leave(
                index,
                "National Service",
                today - timedelta(days=20),
                70,
                status="Pending",
                reason="LEAVE_NATIONAL_SERVICE",
            )
    return excused


def _seed(db: Session, today: date) -> dict[str, int]:
    first = today - timedelta(days=2 * _DAYS)
    actor = User(email="bench@example.test", password_hash="unused", role="admin", status="active")
    db.add(actor)
    db.flush()
    policy = WorkAttendancePolicy(
        grace_minutes=30,
        absence_after_minutes=60,
        early_exit_grace_minutes=10,
        match_before_minutes=60,
        match_after_minutes=120,
        effective_from=first,
        created_by_user_id=actor.id,
        approved_by_user_id=actor.id,
        approved_at=_at(first, 0),
    )
    db.add(policy)
    db.flush()

    crews: list[tuple[str | None, range, int, WorkShiftDefinition, WorkCrew, WorkCrewSchedule]] = []
    next_employee = 1
    for slot, (unit, headcount, hour) in enumerate(_UNITS, start=1):
        code = f"bench-{slot}"
        shift = WorkShiftDefinition(code=code, start_local_time=time(hour), duration_minutes=480)
        pattern = WorkRotationPattern(
            code=code, name=code, cycle_minutes=1440, timezone="Asia/Dubai"
        )
        crew = WorkCrew(code=code, name_en=unit or "Unassigned")
        db.add_all([shift, pattern, crew])
        db.flush()
        anchor = _at(first, hour)
        schedule = WorkCrewSchedule(
            crew_id=crew.id,
            pattern_id=pattern.id,
            anchor_at=anchor,
            effective_from=anchor,
            version=1,
            created_by_user_id=actor.id,
        )
        db.add_all(
            [
                schedule,
                WorkRotationStep(
                    pattern_id=pattern.id, shift_definition_id=shift.id, start_offset_minutes=0
                ),
            ]
        )
        db.flush()
        members = range(next_employee, next_employee + headcount)
        crews.append((unit, members, hour, shift, crew, schedule))
        next_employee += headcount
        for index in members:
            employee_id = _employee_id(index)
            db.add(
                Employee(
                    id=employee_id,
                    name_en=f"Employee {index}",
                    status="Active",
                    department="Operations",
                    duty_unit=unit,
                )
            )
            db.flush()
            db.add_all(
                [
                    AttendanceProviderPerson(
                        id=index,
                        provider="biotime",
                        external_person_id=str(index),
                        employee_id=employee_id,
                        mapping_state="verified",
                        verified_by_user_id=actor.id,
                        verified_at=anchor,
                    ),
                    WorkCrewMembership(
                        crew_id=crew.id,
                        employee_id=employee_id,
                        effective_from=anchor,
                        created_by_user_id=actor.id,
                        updated_by_user_id=actor.id,
                    ),
                    DutyAssignmentEvent(
                        employee_id=employee_id,
                        event_type="baseline",
                        to_department="Operations",
                        to_unit=unit,
                        effective_at=anchor,
                    ),
                ]
            )
    db.flush()
    excused = _seed_leaves(db, first, today)

    counts = dict(cases=0, evaluations=0, punches=0, corrections=0)
    for day_index in range(2 * _DAYS):
        day = first + timedelta(days=day_index)
        cases, occurrences, evaluations, punches, assignments, adjustments, sources = (
            [] for _ in range(7)
        )
        for slot, (unit, members, hour, shift, crew, schedule) in enumerate(crews, start=1):
            base = _at(day, hour)
            end = base + timedelta(hours=8)
            occurrence_id = day_index * len(crews) + slot
            occurrences.append(
                {
                    "id": occurrence_id,
                    "crew_id": crew.id,
                    "crew_schedule_id": schedule.id,
                    "shift_definition_id": shift.id,
                    "starts_at": base,
                    "ends_at": end,
                    "operational_date": day,
                    "pattern_code_snapshot": crew.code,
                    "crew_schedule_version_snapshot": 1,
                    "source_anchor_at": schedule.anchor_at,
                }
            )
            for index in members:
                case_id = day_index * _PEOPLE + index
                employee_id = _employee_id(index)
                cases.append(
                    {
                        "id": case_id,
                        "employee_id": employee_id,
                        "shift_occurrence_id": occurrence_id,
                        "employee_status_snapshot": "Active",
                        "shift_code_snapshot": shift.code,
                        "crew_code_snapshot": crew.code,
                        "department_snapshot": "Operations",
                        "duty_unit_snapshot": unit,
                        "scheduled_start_at": base,
                        "scheduled_end_at": end,
                        "operational_date": day,
                        "organization_snapshot_state": "captured",
                        "created_at": base,
                    }
                )
                variant = (index * 7 + day_index * 11) % 41
                leave_info = excused.get((index, day))
                arrival = departure = None
                late_minutes = None
                if leave_info is not None:
                    leave_id, reason = leave_info
                    presence = "excused_leave"
                    sources.append(
                        {"evaluation_id": 2 * case_id, "leave_id": leave_id, "is_primary": True}
                    )
                elif variant == 0:
                    presence, reason = "absent", "ABSENCE_DUE"
                else:
                    arrival = base + timedelta(
                        minutes=47 if variant in (1, 2) else variant % 15 - 7
                    )
                    late_minutes = 17 if variant in (1, 2) else 0
                    if variant in (1, 3):
                        presence, reason = "on_duty", "FIRST_IN"
                    else:
                        presence, reason = "completed", "SHIFT_COMPLETED"
                        departure = end + timedelta(minutes=4)
                    for slot_index, occurred_at in enumerate((arrival, departure)):
                        if occurred_at is None:
                            continue
                        punch_id = 2 * case_id + slot_index
                        punches.append(
                            {
                                "id": punch_id,
                                "provider": "biotime",
                                "external_event_id": str(punch_id),
                                "provider_person_id": index,
                                "occurred_at": occurred_at,
                                "imported_at": end,
                                "normalized_payload_hash": f"bench-{punch_id}",
                            }
                        )
                        if index % 5 == 0:
                            assignments.append(
                                {
                                    "punch_id": punch_id,
                                    "attendance_case_id": case_id,
                                    "algorithm_version": "bench",
                                }
                            )
                eval_row = {
                    "id": 2 * case_id,
                    "attendance_case_id": case_id,
                    "revision": 1,
                    "provider_person_id": index,
                    "policy_id": policy.id,
                    "presence_state": presence,
                    "reason_code": reason,
                    "first_in_at": arrival,
                    "final_out_at": departure,
                    "late_minutes": late_minutes,
                    "algorithm_version": "bench",
                    "input_fingerprint": "first",
                    "evaluated_at": end,
                }
                evaluations.append(eval_row)
                if case_id % 247 == 0 and leave_info is None:
                    evaluations.append(
                        {
                            **eval_row,
                            "id": 2 * case_id + 1,
                            "revision": 2,
                            "input_fingerprint": "repeat",
                        }
                    )
                if case_id % 1103 == 0:
                    adjustments.append(
                        {
                            "attendance_case_id": case_id,
                            "base_evaluation_id": 2 * case_id,
                            "replacement_presence_state": "completed",
                            "replacement_first_in_at": arrival,
                            "replacement_final_out_at": departure,
                            "replacement_late_minutes": 0,
                            "reason": "Supervisor confirmed duty",
                            "created_by_user_id": actor.id,
                            "created_at": end,
                        }
                    )
        for table, rows in (
            (WorkShiftOccurrence, occurrences),
            (AttendanceCase, cases),
            (AttendanceEvaluation, evaluations),
            (AttendancePunch, punches),
            (AttendancePunchAssignment, assignments),
            (AttendanceEvaluationLeaveSource, sources),
            (AttendanceAdjustment, adjustments),
        ):
            if rows:
                db.execute(table.__table__.insert(), rows)
        counts["cases"] += len(cases)
        counts["evaluations"] += len(evaluations)
        counts["punches"] += len(punches)
        counts["corrections"] += len(adjustments)
    db.commit()
    return counts


def _time_report(db: Session, today: date, now: datetime) -> None:
    scope = organization_scope()
    for days, unit in ((_DAYS, None), (_DAYS, "Company 1"), (92, None)):
        start, end = today - timedelta(days=days), today - timedelta(days=1)
        elapsed = []
        for run in range(_RUNS + 1):
            before = perf_counter()
            result = company_attendance_stats(
                db, scope=scope, from_date=start, to_date=end, duty_unit=unit, limit=10, now=now
            )
            seconds = perf_counter() - before
            assert result["previous_comparable"], "The timed request must have full history."
            if run:
                elapsed.append(seconds)
            assert result["summary"]["current"]["duties_scheduled"] == days * (
                62 if unit else _PEOPLE
            )
            assert result["summary"]["previous"]["duties_scheduled"] == days * (
                62 if unit else _PEOPLE
            )
        print(
            f"{days} days / {unit or 'all companies'}: {median(elapsed):.3f} s median ({', '.join(f'{seconds:.3f}' for seconds in elapsed)} s)",
            flush=True,
        )


def main() -> None:
    today, now = clock.organization_today(), clock.utcnow()
    with TemporaryDirectory(prefix="sentinel-company-stats-") as directory:
        engine = create_engine(f"sqlite:///{(Path(directory) / 'bench.sqlite').as_posix()}")
        attach_sqlite_pragmas(engine)
        try:
            Base.metadata.create_all(engine)
            with Session(engine) as db:
                counts = _seed(db, today)
                print(f"Seeded {_PEOPLE} employees (2 x {_DAYS} days): {counts}", flush=True)
                _time_report(db, today, now)
        finally:
            engine.dispose()


if __name__ == "__main__":
    main()
