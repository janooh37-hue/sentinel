"""Bring a preview database to life: configuration, crews, leave, evaluation.

The workforce dashboard reads Sentinel's own tables, never BioTime directly, so
an imported directory and a pile of punches still render as empty widgets until
four things exist: a saved workforce configuration, crew memberships, some leave
to reason about, and evaluated attendance cases. This wires all four so the UI
can be judged with realistic data.

**Preview and demonstration only.** It writes invented leave records. Never point
it at production.

    GSSG_DATA_DIR=... venv/Scripts/python.exe backend/scripts/seed_workforce_demo.py --leaves 60
"""

from __future__ import annotations

import argparse
import random
import sys
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import func, select

from app.db import models as _models  # noqa: F401  (registers every mapper)
from app.db.models import Employee, Leave, User
from app.db.session import SessionLocal
from app.db.workforce_models import (
    AttendanceCase,
    AttendanceProviderPerson,
    WorkCrew,
    WorkCrewMembership,
    WorkShiftOccurrence,
)
from app.schemas.workforce import WorkforceConfiguration
from app.services import (
    attendance_evaluation_service,
    settings_service,
    workforce_schedule_service,
    workforce_seed_service,
)
from app.services.workforce_access_service import organization_scope

DUBAI = ZoneInfo("Asia/Dubai")

#: (leave_type, status, weight, min_days, max_days). Weights approximate a real
#: month: mostly annual and sick, a few permits, rarer national service.
_LEAVE_KINDS: tuple[tuple[str, str, int, int, int], ...] = (
    ("Annual Leave", "Approved", 34, 3, 21),
    ("Sick Leave", "Approved", 26, 1, 6),
    ("Leave Permit", "Approved", 18, 1, 1),
    ("Administrative Leave", "Approved", 12, 1, 4),
    ("National Service", "Pending", 6, 20, 60),
    # A cancelled row proves the evaluator ignores it rather than excusing.
    ("Annual Leave", "Cancelled", 4, 2, 8),
)


def _configure(db, *, actor: User, earliest: date) -> None:
    """Persist a complete workforce configuration so the UI stops saying 'not configured'."""
    evaluation_start = datetime.combine(earliest, datetime.min.time(), tzinfo=DUBAI).astimezone(UTC)
    configuration = WorkforceConfiguration(
        integration_enabled=True,
        sync_interval_minutes=10,
        stale_after_minutes=90,
        initial_backfill_start_at=evaluation_start,
        evaluation_start_at=evaluation_start,
        nationality_fold_min_count=3,
        excusing_record_kinds=[
            "annual",
            "sick",
            "national_service",
            "administrative_leave",
            "leave_permit",
        ],
        provider_person_retention_days=1095,
        punch_retention_days=730,
        attendance_retention_days=365,
        duty_event_retention_days=1095,
        audit_retention_days=1095,
    )
    settings_service.update_workforce_configuration(db, configuration, actor=actor.email)
    db.commit()


def _memberships(db, *, actor: User, effective_from: datetime) -> tuple[int, list[str], list[str]]:
    """Assign active employees to the crew named by their duty unit.

    Employees with no verified provider mapping are deliberately left out of the
    roster here. Readiness requires every scheduled employee to have exactly one
    verified mapping, so scheduling someone BioTime has never heard of blocks
    attendance evaluation for the entire installation. In production they belong
    on the roster carrying a NO_PROVIDER_RECORD flag; in a preview they are
    reported separately so the rest of the dashboard can be judged.
    """
    crews = {row.code: row for row in db.scalars(select(WorkCrew))}
    mapped = {
        row.employee_id
        for row in db.scalars(
            select(AttendanceProviderPerson).where(
                AttendanceProviderPerson.mapping_state == "verified",
                AttendanceProviderPerson.employee_id.isnot(None),
            )
        )
    }
    created = 0
    no_unit: list[str] = []
    no_record: list[str] = []
    trusted_scope = organization_scope()
    for employee in db.scalars(select(Employee).where(Employee.status == "Active")):
        code = workforce_seed_service.DUTY_UNIT_TO_CREW.get((employee.duty_unit or "").strip())
        if code is None:
            no_unit.append(employee.id)
            continue
        if employee.id not in mapped:
            no_record.append(employee.id)
            continue
        if db.scalar(
            select(WorkCrewMembership).where(WorkCrewMembership.employee_id == employee.id)
        ):
            continue
        workforce_schedule_service.create_crew_membership(
            db,
            scope=trusted_scope,
            if_match=workforce_schedule_service.crew_membership_collection_etag(
                list(
                    db.scalars(
                        select(WorkCrewMembership).where(
                            WorkCrewMembership.crew_id == crews[code].id
                        )
                    )
                )
            ),
            employee_id=employee.id,
            crew_id=crews[code].id,
            effective_from=effective_from,
            actor_user_id=actor.id,
        )
        created += 1
    db.commit()
    return created, no_unit, no_record


def _leaves(db, *, count: int, seed: int, today: date) -> dict[str, int]:
    """Invent a spread of leave across every excusing kind, around today."""
    rng = random.Random(seed)
    employees = list(db.scalars(select(Employee.id).where(Employee.status == "Active")))
    if not employees:
        return {}
    kinds = [k for k in _LEAVE_KINDS for _ in range(k[2])]
    made: dict[str, int] = {}
    attempts = 0
    while sum(made.values()) < count and attempts < count * 12:
        attempts += 1
        leave_type, status, _, low, high = rng.choice(kinds)
        days = rng.randint(low, high)
        # Bias toward windows that overlap today so the "on leave now" widgets
        # have something to show, while still leaving history and future rows.
        start = today - timedelta(days=rng.randint(0, max(1, days + 6)))
        end = start + timedelta(days=days - 1)
        employee_id = rng.choice(employees)
        exists = db.scalar(
            select(Leave).where(
                Leave.employee_id == employee_id,
                Leave.leave_type == leave_type,
                Leave.start_date == start,
                Leave.end_date == end,
                Leave.deleted_at.is_(None),
            )
        )
        if exists is not None:
            continue
        db.add(
            Leave(
                employee_id=employee_id,
                leave_type=leave_type,
                start_date=start,
                end_date=end,
                days=days,
                status=status,
                request_date=start - timedelta(days=rng.randint(1, 10)),
                notes="preview sample",
            )
        )
        made[f"{leave_type} ({status})"] = made.get(f"{leave_type} ({status})", 0) + 1
    db.commit()
    return made


def _evaluate(db, *, as_of: datetime, evaluation_start_at: datetime) -> tuple[int, int]:
    """Materialize started cases for every active employee, then evaluate them."""
    created = 0
    for employee_id in db.scalars(select(Employee.id).where(Employee.status == "Active")):
        created += len(
            attendance_evaluation_service.materialize_scheduled_cases(
                db,
                employee_id=employee_id,
                horizon=as_of,
                evaluation_start_at=evaluation_start_at,
            )
        )
    db.commit()

    evaluated = 0
    for case in db.scalars(select(AttendanceCase)):
        result = attendance_evaluation_service.evaluate_case(
            db,
            case.id,
            evaluated_at=as_of,
            evaluation_start_at=evaluation_start_at,
        )
        if result is not None:
            evaluated += 1
    db.commit()
    return created, evaluated


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--leaves", type=int, default=60)
    parser.add_argument("--seed", type=int, default=20260818)
    parser.add_argument("--history-days", type=int, default=3)
    args = parser.parse_args(argv)

    db = SessionLocal()
    try:
        actor = db.scalar(select(User).order_by(User.id))
        if actor is None:
            print("no user exists; register an admin first", file=sys.stderr)
            return 2

        now = datetime.now(UTC)
        today = now.astimezone(DUBAI).date()
        earliest = today - timedelta(days=args.history_days)

        anchor = min(spec for spec in (earliest,))
        _configure(db, actor=actor, earliest=anchor)
        print(f"configuration saved (evaluation starts {anchor})")

        first_occurrence = db.scalar(select(func.min(WorkShiftOccurrence.starts_at)))
        effective_from = (
            first_occurrence.replace(tzinfo=UTC)
            if first_occurrence is not None
            else datetime.combine(earliest, datetime.min.time(), tzinfo=DUBAI).astimezone(UTC)
        )
        created, no_unit, no_record = _memberships(db, actor=actor, effective_from=effective_from)
        print(f"crew memberships created: {created}")
        print(f"NO_DUTY_UNIT (duty_unit maps to no crew): {len(no_unit)}")
        print(f"NO_PROVIDER_RECORD (no verified BioTime mapping): {len(no_record)}")

        made = _leaves(db, count=args.leaves, seed=args.seed, today=today)
        print(f"leave records created: {sum(made.values())}")
        for label, n in sorted(made.items()):
            print(f"    {n:3}  {label}")

        cases, evaluated = _evaluate(
            db,
            as_of=now,
            evaluation_start_at=datetime.combine(
                earliest, datetime.min.time(), tzinfo=DUBAI
            ).astimezone(UTC),
        )
        print(f"attendance cases materialized: {cases}")
        print(f"cases evaluated: {evaluated}")

        from app.services import attendance_queue_service

        drained = 0
        for _ in range(200):
            result = attendance_queue_service.drain_evaluation_queue(db, now=now)
            db.commit()
            if not result.completed:
                break
            drained += result.completed
        print(f"evaluation queue drained: {drained}")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
