from __future__ import annotations

from collections.abc import Collection
from datetime import UTC, datetime

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.db.models import CorrespondenceEmployeeLink, Employee, LedgerEntry
from app.schemas.correspondence import (
    CorrespondenceAddress,
    CorrespondenceItemRead,
    CorrespondenceListRead,
)
from app.services import ledger_service

DEFAULT_LIMIT = 25
MAX_LIMIT = 100


def _utcnow() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _normalise_employee_ids(employee_ids: Collection[str]) -> tuple[str, ...]:
    return tuple(
        dict.fromkeys(employee_id.strip().upper() for employee_id in employee_ids if employee_id)
    )


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

    real_ids = set(db.scalars(select(Employee.id).where(Employee.id.in_(normalized_ids))).all())
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


def list_employee_correspondence(
    db: Session,
    *,
    employee_id: str,
    owner_user_id: int,
    limit: int,
    offset: int,
) -> CorrespondenceListRead:
    normalized_employee_id = employee_id.strip().upper()
    filters = (
        CorrespondenceEmployeeLink.employee_id == normalized_employee_id,
        CorrespondenceEmployeeLink.state == "linked",
        LedgerEntry.deleted_at.is_(None),
        ledger_service._tags_contain(ledger_service.DRAFT_TAG, negate=True),
        or_(LedgerEntry.channel != "email", LedgerEntry.owner_user_id == owner_user_id),
    )
    total = int(
        db.scalar(
            select(func.count())
            .select_from(CorrespondenceEmployeeLink)
            .join(LedgerEntry, CorrespondenceEmployeeLink.ledger_entry_id == LedgerEntry.id)
            .where(*filters)
        )
        or 0
    )
    rows = db.execute(
        select(CorrespondenceEmployeeLink, LedgerEntry)
        .join(LedgerEntry, CorrespondenceEmployeeLink.ledger_entry_id == LedgerEntry.id)
        .where(*filters)
        .order_by(
            CorrespondenceEmployeeLink.created_at.desc(),
            CorrespondenceEmployeeLink.id.desc(),
        )
        .offset(offset)
        .limit(limit)
    ).all()
    return CorrespondenceListRead(
        items=[
            CorrespondenceItemRead(
                entry_id=entry.id,
                channel=entry.channel,
                entry_date=entry.entry_date,
                direction=entry.direction,
                counterparty=entry.counterparty,
                subject=entry.subject,
                to_recipients=[
                    CorrespondenceAddress.model_validate(address)
                    for address in (entry.to_recipients or [])
                ],
                cc_recipients=[
                    CorrespondenceAddress.model_validate(address)
                    for address in (entry.cc_recipients or [])
                ],
                attachment_count=len(entry.attachment_paths or []),
                link_source=link.source,
                can_open_in_outlook=entry.channel == "email",
            )
            for link, entry in rows
        ],
        total=total,
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
