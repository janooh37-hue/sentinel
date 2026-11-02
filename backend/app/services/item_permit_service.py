"""Item-permit (إدخال مواد) service — register CRUD + letter generation.

Same shape as ``permit_service``: module-level functions, ``db`` first, services
return ORM rows and the router maps them to schemas.
The 1/5 letter is regenerated on create and every update through the shared
``permit_service.regenerate_letter_book`` / ``submit_letter_book`` helpers.
"""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import ColumnElement, Select, case, func, or_, select, text
from sqlalchemy.orm import Session, selectinload
from sqlalchemy.sql.elements import TextClause

from app.api.errors import NotFoundError, ValidationFailedError
from app.core.permit_letter import build_item_permit_letter_html
from app.db.models import AuditLog, Book, Employee, ItemPermit, User
from app.schemas.item_permit import (
    ItemPermitCreate,
    ItemPermitRead,
    ItemPermitSummary,
    ItemPermitUpdate,
    ItemPermitZone,
)
from app.services import book_service, permit_service

log = logging.getLogger(__name__)


def _utcnow() -> datetime:
    # Naive UTC — matches app.core.clock.utcnow.
    return datetime.now(UTC).replace(tzinfo=None)


def _audit(
    db: Session, action: str, permit_id: int, actor: str | None, payload: dict[str, Any]
) -> None:
    db.add(
        AuditLog(
            actor=actor,
            action=action,
            entity_type="item_permit",
            entity_id=str(permit_id),
            payload=json.dumps(payload),
        )
    )
    db.commit()


def _require_employee(db: Session, employee_id: str) -> None:
    if db.get(Employee, employee_id) is None:
        raise ValidationFailedError(
            "ITEM_PERMIT_EMPLOYEE_NOT_FOUND",
            f"Employee {employee_id} does not exist.",
            employee_id=employee_id,
        )


# ─── queries ───────────────────────────────────────────────────────────────────


def _base_query() -> Select[tuple[ItemPermit]]:
    return (
        select(ItemPermit)
        .options(selectinload(ItemPermit.employee))
        .where(ItemPermit.deleted_at.is_(None))
    )


def _zone_clause(zone: ItemPermitZone) -> TextClause:
    return text(
        "EXISTS (SELECT 1 FROM json_each(item_permits.zones) WHERE value = :zone)"
    ).bindparams(zone=zone)


def summary(db: Session, *, user: User, zone: ItemPermitZone | None = None) -> ItemPermitSummary:
    """Match to_read's visibility: inaccessible/missing letters count as none."""
    visibility = book_service.user_visibility_clause(db, user)
    state: ColumnElement[str] = func.coalesce(Book.approval_state, "none")
    if visibility is not None:
        state = case((visibility, state), else_="none")
    stmt = (
        select(state, func.count())
        .select_from(ItemPermit)
        .outerjoin(Book, Book.id == ItemPermit.book_id)
        .where(ItemPermit.deleted_at.is_(None))
        .group_by(state)
    )
    if zone is not None:
        stmt = stmt.where(_zone_clause(zone))
    return ItemPermitSummary.model_validate(
        {state: count for state, count in db.execute(stmt).tuples()}
    )


def list_item_permits(
    db: Session,
    *,
    q: str | None = None,
    zone: ItemPermitZone | None = None,
    limit: int = 100,
    offset: int = 0,
) -> tuple[list[ItemPermit], int]:
    stmt = _base_query().join(Employee, Employee.id == ItemPermit.employee_id)
    if zone is not None:
        stmt = stmt.where(_zone_clause(zone))
    if q:
        like = f"%{q}%"
        stmt = stmt.where(
            or_(
                ItemPermit.employee_id.ilike(like),
                Employee.name_ar.ilike(like),
                Employee.name_en.ilike(like),
                ItemPermit.recipient.ilike(like),
                ItemPermit.site.ilike(like),
                # JSON column: match item names without Arabic being \u-escaped.
                text(
                    "EXISTS (SELECT 1 FROM json_each(item_permits.items)"
                    " WHERE json_extract(json_each.value, '$.name') LIKE :like)"
                ).bindparams(like=like),
            )
        )
    total = int(
        db.execute(select(func.count()).select_from(stmt.order_by(None).subquery())).scalar_one()
    )
    stmt = stmt.order_by(ItemPermit.created_at.desc(), ItemPermit.id.desc())
    rows = list(db.execute(stmt.limit(limit).offset(offset)).scalars().all())
    return rows, total


def get_item_permit(db: Session, permit_id: int) -> ItemPermit:
    row: ItemPermit | None = db.execute(
        _base_query().where(ItemPermit.id == permit_id)
    ).scalar_one_or_none()
    if row is None:
        raise NotFoundError(
            "ITEM_PERMIT_NOT_FOUND", f"Item permit {permit_id} does not exist", id=permit_id
        )
    return row


def to_read(row: ItemPermit, *, db: Session, user: User | None = None) -> ItemPermitRead:
    """With ``user``, a letter Record they cannot open is reported as absent."""
    emp = row.employee
    book = permit_service.readable_book(db, row.book_id, user)
    return ItemPermitRead.model_validate(
        {
            **row.__dict__,
            "book_id": row.book_id if user is None or book is not None else None,
            "employee_name": emp.name_ar or emp.name_en,
            "employee_name_en": emp.name_en,
            "employee_title": emp.position_ar or emp.position,
            "book_ref": book.ref_number if book is not None else None,
            "approval_state": book.approval_state if book is not None else None,
        }
    )


# ─── letter ────────────────────────────────────────────────────────────────────


def _submit_book(db: Session, row: ItemPermit, *, user: User) -> None:
    """Best-effort submit (auto paths): a failure leaves the book a draft and
    audits why — the permit mutation itself stands."""
    actor = user.email
    if row.book_id is None:
        _audit(db, "item_permit.book_submit_failed", row.id, actor, {"error": "NO_BOOK"})
        return
    try:
        permit_service.submit_letter_book(db, row.book_id, actor=actor, record_access_user=user)
    except ValidationFailedError as exc:
        log.warning("item permit %s: book submit failed: %s", row.id, exc.message)
        _audit(db, "item_permit.book_submit_failed", row.id, actor, {"error": exc.code})
        return
    _audit(db, "item_permit.book_submitted", row.id, actor, {"book_id": row.book_id})


def _regenerate_book(db: Session, row: ItemPermit, *, user: User, submit: bool = False) -> None:
    actor = user.email
    emp = row.employee
    body = build_item_permit_letter_html(
        zones=row.zones,
        site=row.site,
        items=row.items,
        employee={
            "id": emp.id,
            "title": emp.position_ar or emp.position or "",
            "name": emp.name_ar or emp.name_en,
        },
    )
    book_id, prior_state = permit_service.regenerate_letter_book(
        db,
        book_id=row.book_id,
        manager_id=row.manager_id,
        subject="تصريح إدخال مواد",
        body=body,
        recipient=row.recipient,
        actor=actor,
        record_access_user=user,
    )
    if row.book_id is None:
        row.book_id = book_id
        db.commit()
    _audit(db, "item_permit.book_generated", row.id, actor, {"book_id": row.book_id})
    if submit or prior_state in ("pending", "approved"):
        _submit_book(db, row, user=user)


def _authorize_live_letter(db: Session, row: ItemPermit, user: User) -> bool:
    """Authorize the permit's linked letter before any permit write (WP2).

    Permit grants delegate the letter's edits without ``books.edit``; the
    letter's level and write policy still apply. A letter already deleted from
    Records gates nothing; returns whether a live letter is linked.
    """
    book = db.get(Book, row.book_id) if row.book_id is not None else None
    if book is None or book.deleted_at is not None:
        return False
    book_service.require_full_book_access(db, user, book, write=True)
    return True


# ─── mutations ─────────────────────────────────────────────────────────────────


def create_item_permit(db: Session, payload: ItemPermitCreate, *, user: User) -> ItemPermit:
    actor = user.email
    _require_employee(db, payload.employee_id)
    row = ItemPermit(
        employee_id=payload.employee_id,
        recipient=payload.recipient,
        zones=payload.zones,
        site=payload.site,
        items=[i.model_dump() for i in payload.items],
        manager_id=payload.manager_id,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    _audit(db, "item_permit.created", row.id, actor, {"employee_id": row.employee_id})
    _regenerate_book(db, get_item_permit(db, row.id), user=user, submit=payload.send_for_approval)
    return get_item_permit(db, row.id)


def update_item_permit(
    db: Session, permit_id: int, payload: ItemPermitUpdate, *, user: User
) -> ItemPermit:
    actor = user.email
    row = get_item_permit(db, permit_id)
    regenerate = row.book_id is None or _authorize_live_letter(db, row, user)
    data = payload.model_dump(exclude_unset=True)
    # Omitted = unchanged; an explicit null only means something for manager_id.
    data = {k: v for k, v in data.items() if v is not None or k == "manager_id"}
    if "employee_id" in data:
        _require_employee(db, data["employee_id"])
    for field, value in data.items():
        setattr(row, field, value)
    row.updated_at = _utcnow()
    db.commit()
    db.refresh(row)  # reload `employee` after an employee_id change
    _audit(db, "item_permit.updated", permit_id, actor, {"fields": sorted(data)})
    if regenerate:
        _regenerate_book(db, row, user=user)
    return get_item_permit(db, permit_id)


def submit_item_permit_book(db: Session, permit_id: int, *, user: User) -> ItemPermit:
    """Manual "Send for approval". Unlike the auto paths this does NOT swallow
    chain errors — the operator sees exactly why it can't be sent."""
    actor = user.email
    row = get_item_permit(db, permit_id)
    if row.book_id is None:
        raise ValidationFailedError(
            "ITEM_PERMIT_NO_BOOK", "This permit has no generated letter to submit.", id=permit_id
        )
    permit_service.submit_letter_book(db, row.book_id, actor=actor, record_access_user=user)
    _audit(db, "item_permit.book_submitted", permit_id, actor, {"book_id": row.book_id})
    return get_item_permit(db, permit_id)


def soft_delete_item_permit(db: Session, permit_id: int, *, user: User) -> None:
    actor = user.email
    row = get_item_permit(db, permit_id)
    _authorize_live_letter(db, row, user)
    row.deleted_at = _utcnow()
    db.commit()
    _audit(db, "item_permit.deleted", permit_id, actor, {})
