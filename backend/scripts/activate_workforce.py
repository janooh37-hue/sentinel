"""Activate the workforce domain on a real installation, from the data already there.

Four things must exist before the attendance register shows anything: a saved
workforce configuration, this site's shifts/rotation/crews, a verified provider
mapping per person, and crew memberships. This installs all four from facts the
database already holds and invents nothing:

* Crews, rotation, and the default policy come from ``workforce_seed_service``,
  which encodes the shift windows and cycle the site confirmed.
* Membership comes from ``Employee.duty_unit``. A unit with no crew (support
  group, terminated) is reported, never guessed at.
* The provider mapping comes from ``emp_code`` matched against the G number, and
  each decision is reported with the employee's own name so it can be checked.
  Ambiguity is recorded as a conflict for a human, never bound.

Provider credentials are environment-only and are never touched here.

    venv\\Scripts\\python.exe backend\\scripts\\activate_workforce.py            # dry run
    venv\\Scripts\\python.exe backend\\scripts\\activate_workforce.py --apply
"""

from __future__ import annotations

import argparse
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Employee, User
from app.db.session import SessionLocal
from app.db.workforce_models import (
    AttendanceProviderPerson,
    DutyAssignmentEvent,
    WorkCrew,
    WorkCrewMembership,
    WorkShiftDefinition,
)
from app.schemas.workforce import WorkforceConfiguration
from app.services import (
    attendance_identity_service,
    settings_service,
    workforce_schedule_service,
    workforce_seed_service,
)
from app.services.workforce_access_service import organization_scope

PROVIDER = "biotime"

#: Retention is the only irreversible policy in this domain, so activation keeps
#: everything. Lower it deliberately later; the purge cannot be undone.
KEEP_FOREVER_DAYS = 36_500

EXCUSING_RECORD_KINDS = [
    "annual",
    "sick",
    "national_service",
    "administrative_leave",
    "leave_permit",
]


def _admin(db: Session, email: str | None) -> User:
    statement = select(User).where(User.role == "admin").order_by(User.id)
    if email:
        statement = select(User).where(User.email == email)
    user = db.scalars(statement).first()
    if user is None:
        raise SystemExit(f"no admin user found{f' for {email}' if email else ''}")
    return user


def _configure(db: Session, *, actor: User, apply: bool, sync_minutes: int) -> str:
    """Save one complete configuration, enabling the environment-configured provider.

    ``evaluation_start_at`` cannot precede the duty-assignment baseline the
    migration recorded, because a case evaluated before that instant would have
    no placement evidence behind it. The baseline is therefore the start.
    """
    baseline = db.scalar(
        select(DutyAssignmentEvent.effective_at)
        .where(DutyAssignmentEvent.event_type == "baseline")
        .order_by(DutyAssignmentEvent.effective_at)
        .limit(1)
    )
    if baseline is None:
        raise SystemExit("no duty-assignment baseline: run alembic upgrade head first")
    start = baseline.replace(tzinfo=UTC)

    configuration = WorkforceConfiguration(
        integration_enabled=True,
        sync_interval_minutes=sync_minutes,
        stale_after_minutes=90,
        initial_backfill_start_at=start,
        evaluation_start_at=start,
        nationality_fold_min_count=3,
        excusing_record_kinds=EXCUSING_RECORD_KINDS,
        provider_person_retention_days=KEEP_FOREVER_DAYS,
        punch_retention_days=KEEP_FOREVER_DAYS,
        attendance_retention_days=KEEP_FOREVER_DAYS,
        duty_event_retention_days=KEEP_FOREVER_DAYS,
        audit_retention_days=KEEP_FOREVER_DAYS,
    )
    if not apply:
        return f"would enable the integration from {start.isoformat()} (sync every {sync_minutes}m)"
    settings_service.update_workforce_configuration(db, configuration, actor=actor.email)
    return f"integration enabled from {start.isoformat()} (sync every {sync_minutes}m)"


def _seed_roster(db: Session, *, actor: User, apply: bool) -> str:
    if not apply:
        crews = db.scalar(select(WorkCrew).limit(1))
        return (
            "would install shifts, rotation patterns, crews, anchors, and the default policy"
            if crews is None
            else "crews already present; seeding would be a no-op for existing rows"
        )
    result = workforce_seed_service.seed_workforce_roster(
        db,
        scope=organization_scope(),
        actor_user_id=actor.id,
    )
    db.commit()
    return (
        f"shifts={result.shifts} patterns={result.patterns} crews={result.crews} "
        f"schedules={result.schedules} policy_created={result.policy_created}"
    )


def _reconcile(db: Session, *, actor: User, apply: bool) -> str:
    outcomes = attendance_identity_service.reconcile_provider_people(
        db, provider=PROVIDER, actor_user_id=actor.id, apply=apply
    )
    if not outcomes:
        return "no unresolved provider people (has the provider synced yet?)"
    bound = [item for item in outcomes if item.bound]
    conflicts = [item for item in outcomes if item.state == "conflict"]
    unmatched = [item for item in outcomes if item.state == "none"]
    skipped = [item for item in outcomes if item.skipped_reason]
    for item in bound[:20]:
        print(
            f"    {item.external_employee_code or '-':>10} -> {item.employee_id}"
            f"  {item.employee_name_en or item.employee_name_ar or ''}"
            f"   (provider: {item.display_name_snapshot or '-'})"
        )
    if len(bound) > 20:
        print(f"    ... {len(bound) - 20} more")
    for item in conflicts:
        print(f"    CONFLICT {item.external_employee_code or '-'} -> {', '.join(item.candidates)}")
    for item in unmatched:
        print(
            f"    NO MATCH {item.external_employee_code or '-'}  ({item.display_name_snapshot or '-'})"
        )
    for item in skipped:
        print(f"    SKIPPED  {item.external_employee_code or '-'}: {item.skipped_reason}")
    if apply:
        db.commit()
    verb = "bound" if apply else "would bind"
    return f"{verb} {len(bound)}, conflicts {len(conflicts)}, no match {len(unmatched)}, skipped {len(skipped)}"


def _membership_start(db: Session) -> datetime:
    """Return the most recent configured shift boundary, in UTC-naive form.

    A roster change must land on a shift boundary, otherwise a crew would own
    half of a shift nobody can evaluate. The latest boundary already passed is
    the earliest start that cannot rewrite a shift in progress.
    """
    zone = ZoneInfo(workforce_seed_service.SITE_TIMEZONE)
    boundaries = sorted(db.scalars(select(WorkShiftDefinition.start_local_time)))
    if not boundaries:
        raise SystemExit("no shift definitions: run the roster step first")
    now_local = datetime.now(zone)
    candidates = [
        datetime.combine(now_local.date() - timedelta(days=offset), boundary, tzinfo=zone)
        for offset in (1, 0)
        for boundary in boundaries
    ]
    latest = max(moment for moment in candidates if moment <= now_local)
    return latest.astimezone(UTC).replace(tzinfo=None)


def _memberships(db: Session, *, actor: User, apply: bool) -> str:
    """Put every verified, unit-bearing active employee on their unit's crew."""
    crews = {row.code: row for row in db.scalars(select(WorkCrew))}
    if not crews:
        return "no crews yet; run the roster step first"
    verified = {
        employee_id
        for employee_id in db.scalars(
            select(AttendanceProviderPerson.employee_id).where(
                AttendanceProviderPerson.mapping_state == "verified",
                AttendanceProviderPerson.employee_id.isnot(None),
            )
        )
    }
    effective_from = _membership_start(db)
    trusted_scope = organization_scope()

    created = 0
    no_crew: dict[str, int] = {}
    no_mapping: list[str] = []
    for employee in db.scalars(
        select(Employee).where(Employee.status == "Active").order_by(Employee.id)
    ):
        unit = (employee.duty_unit or "").strip()
        code = workforce_seed_service.DUTY_UNIT_TO_CREW.get(unit)
        if code is None:
            no_crew[unit or "(none)"] = no_crew.get(unit or "(none)", 0) + 1
            continue
        if employee.id not in verified:
            # Scheduling someone the provider has never reported would make the
            # installation unready for evaluation, so they wait for a mapping.
            no_mapping.append(employee.id)
            continue
        if db.scalar(
            select(WorkCrewMembership).where(WorkCrewMembership.employee_id == employee.id)
        ):
            continue
        if apply:
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
    if apply:
        db.commit()
    for unit, count in sorted(no_crew.items(), key=lambda item: -item[1]):
        print(f"    no crew for duty unit {unit!r}: {count} active employee(s) left unscheduled")
    if no_mapping:
        print(f"    waiting for a verified provider mapping: {len(no_mapping)} active employee(s)")
    verb = "created" if apply else "would create"
    return f"{verb} {created} crew membership(s)"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="write; omit for a dry run")
    parser.add_argument("--actor-email", default=None, help="admin whose name owns the changes")
    parser.add_argument("--sync-minutes", type=int, default=10, help="provider sync interval")
    parser.add_argument(
        "--skip",
        action="append",
        default=[],
        choices=["configuration", "roster", "reconcile", "memberships"],
        help="skip a step; repeatable",
    )
    args = parser.parse_args(argv)

    db = SessionLocal()
    try:
        actor = _admin(db, args.actor_email)
        print(
            f"actor: {actor.email} (id {actor.id}){'' if args.apply else '   DRY RUN — nothing is written'}"
        )
        steps = (
            (
                "configuration",
                lambda: _configure(
                    db, actor=actor, apply=args.apply, sync_minutes=args.sync_minutes
                ),
            ),
            ("roster", lambda: _seed_roster(db, actor=actor, apply=args.apply)),
            ("reconcile", lambda: _reconcile(db, actor=actor, apply=args.apply)),
            ("memberships", lambda: _memberships(db, actor=actor, apply=args.apply)),
        )
        for name, step in steps:
            if name in args.skip:
                print(f"  {name}: skipped")
                continue
            print(f"  {name}: {step()}")
    finally:
        db.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
