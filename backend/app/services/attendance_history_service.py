"""One person's punch history, read from the provider and never stored.

BioTime already holds every transaction this site has ever recorded. The roster,
the shifts and the cases that judge them only start when the schedule was
installed, so the years before it cannot be marked late or absent - there is no
duty to compare a punch against. Copying that history into this database would
therefore duplicate the source of truth to produce rows nothing can evaluate.

This module answers the question the source can already answer: for one
employee, on which days was there a punch, when was the first, when was the last,
and on which device. It writes nothing.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.errors import ValidationFailedError
from app.db.workforce_models import AttendanceProviderPerson
from app.services.attendance_provider import AttendanceProvider, ProviderPunch
from app.services.workforce_access_service import employee_in_scope
from app.services.workforce_scope_service import WorkforceScope

#: A bounded read: 40 pages of the configured page size covers years of one
#: person's punches, and stops a mistaken range from paging a site forever.
MAX_PAGES = 40

#: One request may not span more than this many days.
MAX_RANGE_DAYS = 400


def _verified_mapping(db: Session, employee_id: str) -> AttendanceProviderPerson | None:
    """The employee's active verified provider identity, if they have one."""
    return db.scalar(
        select(AttendanceProviderPerson).where(
            AttendanceProviderPerson.employee_id == employee_id,
            AttendanceProviderPerson.mapping_state == "verified",
            AttendanceProviderPerson.active.is_(True),
        )
    )


def _window(from_date: date, to_date: date, zone: ZoneInfo) -> tuple[datetime, datetime]:
    """The half-open UTC instants covering these local calendar days."""
    start = datetime.combine(from_date, time.min, tzinfo=zone)
    end = datetime.combine(to_date + timedelta(days=1), time.min, tzinfo=zone)
    return (start.astimezone(UTC), end.astimezone(UTC))


def employee_punch_history(
    db: Session,
    *,
    scope: WorkforceScope,
    employee_id: str,
    from_date: date,
    to_date: date,
    provider: AttendanceProvider,
    zone: ZoneInfo,
) -> dict[str, object]:
    """Group one employee's provider punches by site-local day, newest first."""
    employee_in_scope(db, scope=scope, employee_id=employee_id)
    if to_date < from_date:
        raise ValidationFailedError(
            "WORKFORCE_HISTORY_RANGE_INVALID", "to_date must not precede from_date."
        )
    if (to_date - from_date).days + 1 > MAX_RANGE_DAYS:
        raise ValidationFailedError(
            "WORKFORCE_HISTORY_RANGE_INVALID",
            f"Range must not exceed {MAX_RANGE_DAYS} days.",
        )
    mapping = _verified_mapping(db, employee_id)
    code = mapping.external_employee_code if mapping is not None else None
    payload: dict[str, object] = {
        "employee_id": employee_id,
        "provider_code": provider.code,
        "external_employee_code": code,
        "from_date": from_date,
        "to_date": to_date,
        "linked": mapping is not None and code is not None,
        "truncated": False,
        "days": [],
    }
    if mapping is None or code is None:
        return payload

    since, until = _window(from_date, to_date, zone)
    punches: list[ProviderPunch] = []
    cursor: str | None = None
    truncated = True
    for _page in range(MAX_PAGES):
        page = provider.list_person_punches(
            external_employee_code=code, since=since, until=until, cursor=cursor
        )
        # The vendor filters by ``emp_code``, which two enrollments of the same
        # person can share. Identity is the mapped ``emp``, so anything else the
        # filter returned is not this employee's history.
        punches.extend(
            punch for punch in page.items if punch.external_person_id == mapping.external_person_id
        )
        cursor = page.next_cursor
        if page.exhausted or cursor is None:
            truncated = False
            break

    by_day: dict[date, list[ProviderPunch]] = defaultdict(list)
    for punch in punches:
        moment = punch.occurred_at
        if moment.tzinfo is None:
            moment = moment.replace(tzinfo=UTC)
        by_day[moment.astimezone(zone).date()].append(punch)

    payload["truncated"] = truncated
    payload["days"] = [
        {
            "operational_date": day,
            "first_seen_at": min(punch.occurred_at for punch in rows),
            "last_seen_at": max(punch.occurred_at for punch in rows),
            "punch_count": len(rows),
            "devices": sorted({punch.device_name for punch in rows if punch.device_name}),
        }
        for day, rows in sorted(by_day.items(), reverse=True)
    ]
    return payload


__all__ = ["MAX_PAGES", "MAX_RANGE_DAYS", "employee_punch_history"]
