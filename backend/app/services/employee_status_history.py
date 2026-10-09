"""Append-only employee status history (``employee_status_events``).

Every status writer — the status dialog / form, the Resignation Letter, the
daily scheduler — calls :func:`record_status_event` so the Activity tab can show
one coherent timeline. The helper only adds the row; the caller commits, so the
event is atomic with the change it describes.
"""

from __future__ import annotations

from datetime import date
from typing import Final

from sqlalchemy.orm import Session

from app.db.models import EmployeeStatusEvent

KIND_CHANGED: Final = "changed"
KIND_SCHEDULED: Final = "scheduled"
KIND_SCHEDULED_CANCELLED: Final = "scheduled_cancelled"
KIND_APPLIED: Final = "applied"
KIND_IMPORTED: Final = "imported"

SOURCE_MANUAL: Final = "manual"
SOURCE_RESIGNATION_LETTER: Final = "resignation_letter"
SOURCE_SCHEDULER: Final = "scheduler"
SOURCE_BACKFILL: Final = "backfill"


def record_status_event(
    db: Session,
    employee_id: str,
    *,
    from_status: str,
    to_status: str,
    effective_date: date | None,
    kind: str,
    source: str,
    actor_user_id: int | None = None,
    site: str | None = None,
    return_date: date | None = None,
) -> EmployeeStatusEvent:
    """Add one status event to the session. Does not commit."""
    event = EmployeeStatusEvent(
        employee_id=employee_id,
        from_status=from_status,
        to_status=to_status,
        effective_date=effective_date,
        site=site,
        return_date=return_date,
        kind=kind,
        source=source,
        actor_user_id=actor_user_id,
    )
    db.add(event)
    return event
