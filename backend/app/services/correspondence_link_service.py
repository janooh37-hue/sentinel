from __future__ import annotations

from collections.abc import Collection
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import CorrespondenceEmployeeLink, Employee


def _utcnow() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _normalise_employee_ids(employee_ids: Collection[str]) -> tuple[str, ...]:
    return tuple(dict.fromkeys(employee_id.strip().upper() for employee_id in employee_ids if employee_id))


def _require_employee(db: Session, employee_id: str) -> str:
    normalized = employee_id.strip().upper()
    if db.get(Employee, normalized) is None:
        raise ValueError(f"unknown employee {normalized}")
    return normalized


def sync_detected_links(
    db: Session, *, entry_id: int, employee_ids: Collection[str]
) -> list[CorrespondenceEmployeeLink]:
    normalized_ids = _normalise_employee_ids(employee_ids)
    if not normalized_ids:
        db.flush()
        return []

    real_ids = set(
        db.scalars(select(Employee.id).where(Employee.id.in_(normalized_ids))).all()
    )
    valid_ids = tuple(employee_id for employee_id in normalized_ids if employee_id in real_ids)
    if not valid_ids:
        db.flush()
        return []

    existing = {
        row.employee_id: row
        for row in db.scalars(
            select(CorrespondenceEmployeeLink).where(
                CorrespondenceEmployeeLink.ledger_entry_id == entry_id,
                CorrespondenceEmployeeLink.employee_id.in_(valid_ids),
            )
        ).all()
    }
    rows: list[CorrespondenceEmployeeLink] = []
    for employee_id in valid_ids:
        row = existing.get(employee_id)
        if row is None:
            row = CorrespondenceEmployeeLink(
                ledger_entry_id=entry_id,
                employee_id=employee_id,
                state="linked",
                source="detected",
            )
            db.add(row)
        rows.append(row)
    db.flush()
    return rows


def get_link(db: Session, *, entry_id: int, employee_id: str) -> CorrespondenceEmployeeLink | None:
    return db.scalar(
        select(CorrespondenceEmployeeLink).where(
            CorrespondenceEmployeeLink.ledger_entry_id == entry_id,
            CorrespondenceEmployeeLink.employee_id == employee_id.strip().upper(),
        )
    )


def set_manual_link(
    db: Session, *, entry_id: int, employee_id: str, actor_user_id: int
) -> CorrespondenceEmployeeLink:
    normalized = _require_employee(db, employee_id)
    row = get_link(db, entry_id=entry_id, employee_id=normalized)
    now = _utcnow()
    if row is None:
        row = CorrespondenceEmployeeLink(
            ledger_entry_id=entry_id,
            employee_id=normalized,
            state="linked",
            source="manual",
            acted_by_user_id=actor_user_id,
            created_at=now,
            updated_at=now,
        )
        db.add(row)
    else:
        row.state = "linked"
        row.source = "manual"
        row.acted_by_user_id = actor_user_id
        row.updated_at = now
    db.flush()
    return row


def dismiss_link(
    db: Session, *, entry_id: int, employee_id: str, actor_user_id: int
) -> CorrespondenceEmployeeLink:
    normalized = _require_employee(db, employee_id)
    row = get_link(db, entry_id=entry_id, employee_id=normalized)
    now = _utcnow()
    if row is None:
        row = CorrespondenceEmployeeLink(
            ledger_entry_id=entry_id,
            employee_id=normalized,
            state="dismissed",
            source="manual",
            acted_by_user_id=actor_user_id,
            created_at=now,
            updated_at=now,
        )
        db.add(row)
    else:
        row.state = "dismissed"
        row.acted_by_user_id = actor_user_id
        row.updated_at = now
    db.flush()
    return row
