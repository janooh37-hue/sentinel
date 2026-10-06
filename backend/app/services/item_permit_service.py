"""Item-permit (إدخال مواد) service — register CRUD + letter generation.

Same shape as ``permit_service``: module-level functions, ``db`` first, an
``actor`` string, services return ORM rows and the router maps them to schemas.
The 1/5 letter is regenerated on create and every update through the shared
``permit_service.regenerate_letter_book`` / ``submit_letter_book`` helpers.
"""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import Select, func, or_, select, text
from sqlalchemy.orm import Session, selectinload

from app.api.errors import NotFoundError, ValidationFailedError
from app.core.permit_letter import build_item_permit_letter_html
from app.db.models import AuditLog, Book, Employee, ItemPermit
from app.schemas.item_permit import ItemPermitCreate, ItemPermitRead, ItemPermitUpdate
from app.services import permit_service

log = logging.getLogger(__name__)


def _utcnow() -> datetime:
    # Naive UTC — matches app.db.models._utcnow.
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


def list_item_permits(
    db: Session, *, q: str | None = None, limit: int = 100, offset: int = 0
) -> tuple[list[ItemPermit], int]:
    stmt = _base_query().join(Employee, Employee.id == ItemPermit.employee_id)
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


def to_read(row: ItemPermit, *, db: Session) -> ItemPermitRead:
    emp = row.employee
    book = db.get(Book, row.book_id) if row.book_id is not None else None
    return ItemPermitRead.model_validate(
        {
            **row.__dict__,
            "employee_name": emp.name_ar or emp.name_en,
            "employee_name_en": emp.name_en,
            "employee_title": emp.position_ar or emp.position,
            "book_ref": book.ref_number if book is not None else None,
            "approval_state": book.approval_state if book is not None else None,
        }
    )


# ─── letter ────────────────────────────────────────────────────────────────────


def _submit_book(db: Session, row: ItemPermit, *, actor: str | None) -> None:
    """Best-effort submit (auto paths): a failure leaves the book a draft and
    audits why — the permit mutation itself stands."""
    if row.book_id is None:
        _audit(db, "item_permit.book_submit_failed", row.id, actor, {"error": "NO_BOOK"})
        return
    try:
        permit_service.submit_letter_book(db, row.book_id, actor=actor)
    except ValidationFailedError as exc:
        log.warning("item permit %s: book submit failed: %s", row.id, exc.message)
        _audit(db, "item_permit.book_submit_failed", row.id, actor, {"error": exc.code})
        return
    _audit(db, "item_permit.book_submitted", row.id, actor, {"book_id": row.book_id})


def _regenerate_book(
    db: Session, row: ItemPermit, *, actor: str | None, submit: bool = False
) -> None:
    emp = row.employee
    body = build_item_permit_letter_html(
        zone=row.zone,
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
        subject="التصاريح",
        body=body,
        recipient=row.recipient,
        actor=actor,
    )
    if row.book_id is None:
        row.book_id = book_id
        db.commit()
    _audit(db, "item_permit.book_generated", row.id, actor, {"book_id": row.book_id})
    if submit or prior_state in ("pending", "approved"):
        _submit_book(db, row, actor=actor)


# ─── mutations ─────────────────────────────────────────────────────────────────


def create_item_permit(
    db: Session, payload: ItemPermitCreate, *, actor: str | None = None
) -> ItemPermit:
    _require_employee(db, payload.employee_id)
    row = ItemPermit(
        employee_id=payload.employee_id,
        recipient=payload.recipient,
        zone=payload.zone,
        site=payload.site,
        items=[i.model_dump() for i in payload.items],
        manager_id=payload.manager_id,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    _audit(db, "item_permit.created", row.id, actor, {"employee_id": row.employee_id})
    _regenerate_book(db, get_item_permit(db, row.id), actor=actor, submit=payload.send_for_approval)
    return get_item_permit(db, row.id)


def update_item_permit(
    db: Session, permit_id: int, payload: ItemPermitUpdate, *, actor: str | None = None
) -> ItemPermit:
    row = get_item_permit(db, permit_id)
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
    _regenerate_book(db, row, actor=actor)
    return get_item_permit(db, permit_id)


def submit_item_permit_book(db: Session, permit_id: int, *, actor: str | None = None) -> ItemPermit:
    """Manual "Send for approval". Unlike the auto paths this does NOT swallow
    chain errors — the operator sees exactly why it can't be sent."""
    row = get_item_permit(db, permit_id)
    if row.book_id is None:
        raise ValidationFailedError(
            "ITEM_PERMIT_NO_BOOK", "This permit has no generated letter to submit.", id=permit_id
        )
    permit_service.submit_letter_book(db, row.book_id, actor=actor)
    _audit(db, "item_permit.book_submitted", permit_id, actor, {"book_id": row.book_id})
    return get_item_permit(db, permit_id)


def soft_delete_item_permit(db: Session, permit_id: int, *, actor: str | None = None) -> None:
    row = get_item_permit(db, permit_id)
    row.deleted_at = _utcnow()
    db.commit()
    _audit(db, "item_permit.deleted", permit_id, actor, {})
