"""Security-permit service — register CRUD, lifecycle actions, and audit writes.

Greenfield feature (2026-07). Mirrors the conventions in ``leave_service``:
module-level functions, ``db`` first + keyword-only args, an ``actor`` string,
services return ORM rows and the router maps them to schemas, and every
mutation writes an ``AuditLog`` row.

Whether a permit is *expired* / *expiring* is derived from ``end_date`` at read
time (never stored), so the register is correct without a nightly job.
"""

from __future__ import annotations

import csv
import io
import json
import logging
from datetime import UTC, date, datetime, timedelta
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.api.errors import NotFoundError, ValidationFailedError
from app.db.models import AuditLog, Permit, PermitPerson, PermitVisit
from app.schemas.permit import (
    PermitCreate,
    PermitListItem,
    PermitPersonCreate,
    PermitPersonRead,
    PermitRead,
    PermitUpdate,
    PermitVisitCreate,
)

log = logging.getLogger(__name__)

# A permit is "expiring" once it is this close to its end date.
EXPIRING_WITHIN_DAYS = 7


def _utcnow() -> datetime:
    # Naive UTC — matches app.db.models._utcnow so timestamps compare cleanly.
    return datetime.now(UTC).replace(tzinfo=None)


# ─── derived / computed fields ─────────────────────────────────────────────────


def _active_people(row: Permit) -> list[PermitPerson]:
    return [p for p in row.people if p.removed_at is None]


def _duration_days(row: Permit) -> int:
    return (row.end_date - row.start_date).days + 1


def _days_remaining(row: Permit, *, today: date) -> int | None:
    if row.status == "revoked":
        return None
    return (row.end_date - today).days


def _derived_status(row: Permit, *, today: date) -> str:
    if row.status == "revoked":
        return "revoked"
    if row.end_date < today:
        return "expired"
    if (row.end_date - today).days <= EXPIRING_WITHIN_DAYS:
        return "expiring"
    return "active"


def to_read(row: Permit, *, today: date | None = None) -> PermitRead:
    """Build the detail schema (with people) + computed fields off an ORM row."""
    today = today or date.today()
    active = _active_people(row)
    return PermitRead.model_validate(row).model_copy(
        update={
            "derived_status": _derived_status(row, today=today),
            "duration_days": _duration_days(row),
            "days_remaining": _days_remaining(row, today=today),
            "people_count": len(active),
            "people": [PermitPersonRead.model_validate(p) for p in active],
        }
    )


def to_list_item(row: Permit, *, today: date | None = None) -> PermitListItem:
    today = today or date.today()
    return PermitListItem.model_validate(row).model_copy(
        update={
            "derived_status": _derived_status(row, today=today),
            "duration_days": _duration_days(row),
            "days_remaining": _days_remaining(row, today=today),
            "people_count": len(_active_people(row)),
        }
    )


# ─── queries ───────────────────────────────────────────────────────────────────


def _base_query(*, include_deleted: bool):
    stmt = select(Permit).options(selectinload(Permit.people))
    if not include_deleted:
        stmt = stmt.where(Permit.deleted_at.is_(None))
    return stmt


def _apply_state_filter(stmt, *, state: str | None, today: date):
    """Filter by the *derived* lifecycle bucket, expressed in SQL so paging and
    totals stay correct."""
    if not state:
        return stmt
    if state == "revoked":
        return stmt.where(Permit.status == "revoked")
    if state == "expired":
        return stmt.where(Permit.status == "active", Permit.end_date < today)
    cutoff = today + timedelta(days=EXPIRING_WITHIN_DAYS)
    if state == "expiring":
        return stmt.where(
            Permit.status == "active",
            Permit.end_date >= today,
            Permit.end_date <= cutoff,
        )
    if state == "active":
        return stmt.where(Permit.status == "active", Permit.end_date > cutoff)
    if state == "valid":
        # Currently usable = not revoked, not expired.
        return stmt.where(Permit.status == "active", Permit.end_date >= today)
    raise ValidationFailedError(
        "PERMIT_BAD_STATE", f"Unknown permit state filter: {state}", state=state
    )


def list_permits(
    db: Session,
    *,
    state: str | None = None,
    zone: str | None = None,
    company: str | None = None,
    q: str | None = None,
    include_deleted: bool = False,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[Permit], int]:
    today = date.today()
    stmt = _base_query(include_deleted=include_deleted)
    stmt = _apply_state_filter(stmt, state=state, today=today)
    if zone:
        stmt = stmt.where(Permit.zone == zone)
    if company:
        stmt = stmt.where(Permit.company.ilike(f"%{company}%"))
    if q:
        like = f"%{q}%"
        stmt = stmt.where(
            or_(Permit.company.ilike(like), Permit.permit_no.ilike(like))
        )

    count_stmt = select(func.count()).select_from(stmt.order_by(None).subquery())
    total = int(db.execute(count_stmt).scalar_one())

    stmt = stmt.order_by(Permit.created_at.desc(), Permit.id.desc()).limit(limit).offset(offset)
    rows = list(db.execute(stmt).scalars().unique().all())
    return rows, total


def get_permit(db: Session, permit_id: int, *, include_deleted: bool = False) -> Permit:
    stmt = _base_query(include_deleted=include_deleted).where(Permit.id == permit_id)
    row = db.execute(stmt).scalars().unique().one_or_none()
    if row is None:
        raise NotFoundError(
            "PERMIT_NOT_FOUND", f"Permit {permit_id} does not exist", id=permit_id
        )
    return row


# ─── mutations ─────────────────────────────────────────────────────────────────


def _validate_window(start: date, end: date) -> None:
    if end < start:
        raise ValidationFailedError(
            "PERMIT_BAD_WINDOW",
            "Permit end date must not be before its start date.",
            start_date=str(start),
            end_date=str(end),
        )


def create_permit(db: Session, payload: PermitCreate, *, actor: str | None = None) -> Permit:
    _validate_window(payload.start_date, payload.end_date)
    row = Permit(
        company=payload.company,
        zone=payload.zone,
        start_date=payload.start_date,
        end_date=payload.end_date,
        purpose=payload.purpose,
        notes=payload.notes,
        status="active",
    )
    for person in payload.people:
        row.people.append(_new_person(person))
    db.add(row)
    db.flush()  # assign row.id so we can stamp the reference
    row.permit_no = f"PMT-{row.id:04d}"
    db.commit()
    db.refresh(row)
    _audit(db, "permit.created", row.id, actor, {"company": row.company, "zone": row.zone})
    return get_permit(db, row.id)


def update_permit(
    db: Session, permit_id: int, payload: PermitUpdate, *, actor: str | None = None
) -> Permit:
    row = get_permit(db, permit_id)
    if row.status == "revoked":
        raise ValidationFailedError(
            "PERMIT_REVOKED", "A revoked permit cannot be edited.", id=permit_id
        )
    data = payload.model_dump(exclude_unset=True)
    new_start = data.get("start_date", row.start_date)
    new_end = data.get("end_date", row.end_date)
    _validate_window(new_start, new_end)
    for field, value in data.items():
        setattr(row, field, value)
    row.updated_at = _utcnow()
    db.commit()
    _audit(db, "permit.updated", permit_id, actor, {"fields": sorted(data.keys())})
    return get_permit(db, permit_id)


def renew_permit(
    db: Session, permit_id: int, *, new_end_date: date, reason: str | None = None,
    actor: str | None = None,
) -> Permit:
    row = get_permit(db, permit_id)
    if row.status == "revoked":
        raise ValidationFailedError(
            "PERMIT_REVOKED", "A revoked permit cannot be renewed.", id=permit_id
        )
    if new_end_date <= row.end_date:
        raise ValidationFailedError(
            "PERMIT_BAD_RENEWAL",
            "The new end date must be after the current end date.",
            current_end=str(row.end_date),
            new_end=str(new_end_date),
        )
    old_end = row.end_date
    row.end_date = new_end_date
    row.updated_at = _utcnow()
    db.commit()
    _audit(
        db, "permit.renewed", permit_id, actor,
        {"from": str(old_end), "to": str(new_end_date), "reason": reason},
    )
    return get_permit(db, permit_id)


def revoke_permit(
    db: Session, permit_id: int, *, reason: str | None = None, actor: str | None = None
) -> Permit:
    row = get_permit(db, permit_id)
    if row.status == "revoked":
        raise ValidationFailedError(
            "PERMIT_REVOKED", "This permit is already revoked.", id=permit_id
        )
    row.status = "revoked"
    row.revoked_at = _utcnow()
    row.revoke_reason = reason
    row.updated_at = _utcnow()
    db.commit()
    _audit(db, "permit.revoked", permit_id, actor, {"reason": reason})
    return get_permit(db, permit_id)


def soft_delete_permit(db: Session, permit_id: int, *, actor: str | None = None) -> None:
    row = get_permit(db, permit_id)
    now = _utcnow()
    row.deleted_at = now
    row.updated_at = now
    db.commit()
    _audit(db, "permit.deleted", permit_id, actor, {})


# ─── people ────────────────────────────────────────────────────────────────────


def _new_person(payload: PermitPersonCreate) -> PermitPerson:
    return PermitPerson(
        name=payload.name,
        uae_id=payload.uae_id,
        nationality=payload.nationality,
        role=payload.role,
    )


def add_person(
    db: Session, permit_id: int, payload: PermitPersonCreate, *, actor: str | None = None
) -> Permit:
    row = get_permit(db, permit_id)
    if row.status == "revoked":
        raise ValidationFailedError(
            "PERMIT_REVOKED", "Cannot add people to a revoked permit.", id=permit_id
        )
    person = _new_person(payload)
    row.people.append(person)
    row.updated_at = _utcnow()
    db.commit()
    _audit(db, "permit.person_added", permit_id, actor, {"name": payload.name})
    return get_permit(db, permit_id)


def remove_person(
    db: Session, permit_id: int, person_id: int, *, actor: str | None = None
) -> Permit:
    row = get_permit(db, permit_id)
    person = next((p for p in row.people if p.id == person_id), None)
    if person is None:
        raise NotFoundError(
            "PERMIT_PERSON_NOT_FOUND",
            f"Person {person_id} is not on permit {permit_id}",
            permit_id=permit_id,
            person_id=person_id,
        )
    if person.removed_at is not None:
        raise ValidationFailedError(
            "PERMIT_PERSON_REMOVED",
            "This person has already been removed from the permit.",
            person_id=person_id,
        )
    person.removed_at = _utcnow()
    row.updated_at = _utcnow()
    db.commit()
    _audit(db, "permit.person_removed", permit_id, actor, {"person_id": person_id})
    return get_permit(db, permit_id)


# ─── visits (gate / UAE-ID hook) ───────────────────────────────────────────────


def list_visits(db: Session, permit_id: int, *, limit: int = 100) -> list[PermitVisit]:
    get_permit(db, permit_id, include_deleted=True)  # existence check
    stmt = (
        select(PermitVisit)
        .where(PermitVisit.permit_id == permit_id)
        .order_by(PermitVisit.occurred_at.desc(), PermitVisit.id.desc())
        .limit(limit)
    )
    return list(db.execute(stmt).scalars().all())


def record_visit(
    db: Session, permit_id: int, payload: PermitVisitCreate, *, actor: str | None = None
) -> PermitVisit:
    get_permit(db, permit_id)  # existence + not-deleted check
    visit = PermitVisit(
        permit_id=permit_id,
        person_id=payload.person_id,
        direction=payload.direction,
        occurred_at=payload.occurred_at or _utcnow(),
        uae_id=payload.uae_id,
        gate=payload.gate,
        source=payload.source,
    )
    db.add(visit)
    db.commit()
    db.refresh(visit)
    _audit(
        db, "permit.visit_recorded", permit_id, actor,
        {"direction": visit.direction, "source": visit.source},
    )
    return visit


# ─── summary + export ──────────────────────────────────────────────────────────


def summary(db: Session) -> dict[str, int]:
    today = date.today()
    rows, _ = list_permits(db, limit=100_000, offset=0)
    active = expiring = expired = revoked = 0
    people_active = people_green = people_red = 0
    for row in rows:
        ds = _derived_status(row, today=today)
        if ds == "active":
            active += 1
        elif ds == "expiring":
            expiring += 1
        elif ds == "expired":
            expired += 1
        elif ds == "revoked":
            revoked += 1
        # Head-count only counts people on currently-valid permits.
        if ds in ("active", "expiring"):
            n = len(_active_people(row))
            people_active += n
            if row.zone in ("green", "both"):
                people_green += n
            if row.zone in ("red", "both"):
                people_red += n
    return {
        "active": active,
        "expiring": expiring,
        "expired": expired,
        "revoked": revoked,
        "people_active": people_active,
        "people_green": people_green,
        "people_red": people_red,
    }


def export_csv(db: Session, **filters: Any) -> str:
    """Flat CSV of the (filtered) register — one row per permit."""
    filters.setdefault("limit", 100_000)
    filters.setdefault("offset", 0)
    rows, _ = list_permits(db, **filters)
    today = date.today()
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(
        [
            "permit_no", "company", "zone", "start_date", "end_date",
            "duration_days", "status", "days_remaining", "people_count", "purpose",
        ]
    )
    for row in rows:
        writer.writerow(
            [
                row.permit_no or "",
                row.company,
                row.zone,
                row.start_date.isoformat(),
                row.end_date.isoformat(),
                _duration_days(row),
                _derived_status(row, today=today),
                _days_remaining(row, today=today) if row.status != "revoked" else "",
                len(_active_people(row)),
                (row.purpose or "").replace("\n", " "),
            ]
        )
    return buf.getvalue()


# ─── audit ─────────────────────────────────────────────────────────────────────


def _audit(
    db: Session, action: str, permit_id: int, actor: str | None, payload: dict[str, Any]
) -> None:
    entry = AuditLog(
        actor=actor,
        action=action,
        entity_type="permit",
        entity_id=str(permit_id),
        payload=json.dumps(payload),
    )
    db.add(entry)
    db.commit()
