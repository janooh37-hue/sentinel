from __future__ import annotations

from itertools import chain

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.db.models import (
    Book,
    CorrespondenceEmployeeLink,
    Document,
    Employee,
    Leave,
    LedgerEntry,
    Violation,
)
from app.schemas.employee_activity import (
    EmployeeActivityItemRead,
    EmployeeActivityKind,
    EmployeeActivityListRead,
)
from app.services import correspondence_service

DEFAULT_LIMIT = 25
MAX_LIMIT = 100


def _sort_key(item: EmployeeActivityItemRead) -> tuple[float, str, int]:
    return (-item.occurred_at.timestamp(), item.kind, -item.source_id)


def _documents(
    db: Session, *, employee_id: str | None, requested: int
) -> tuple[list[EmployeeActivityItemRead], int]:
    book_id = (
        select(Book.id)
        .where(Book.ref_number == Document.ref_number, Book.deleted_at.is_(None))
        .order_by(Book.id.desc())
        .limit(1)
        .correlate(Document)
        .scalar_subquery()
    )
    stmt = (
        select(
            Document.id.label("source_id"),
            book_id.label("target_id"),
            Document.created_at.label("occurred_at"),
            Document.template_id.label("title"),
            Document.ref_number.label("reference"),
            Employee.id.label("employee_id"),
            Employee.name_en.label("employee_name_en"),
            Employee.name_ar.label("employee_name_ar"),
            func.count().over().label("source_total"),
        )
        .join(Employee, Document.employee_id == Employee.id)
        .where(
            Document.employee_id.is_not(None),
            Document.ref_number != "DRAFT",
            book_id.is_not(None),
        )
    )
    if employee_id is not None:
        stmt = stmt.where(Document.employee_id == employee_id)
    rows = db.execute(
        stmt.order_by(Document.created_at.desc(), Document.id.desc()).limit(requested)
    ).all()
    total = int(rows[0].source_total) if rows else 0
    return [
        EmployeeActivityItemRead(
            kind="document",
            source_id=row.source_id,
            target_id=row.target_id,
            occurred_at=row.occurred_at,
            employee_id=row.employee_id,
            employee_name_en=row.employee_name_en,
            employee_name_ar=row.employee_name_ar,
            title=row.title,
            reference=row.reference,
        )
        for row in rows
    ], total


def _leaves(
    db: Session, *, employee_id: str | None, requested: int
) -> tuple[list[EmployeeActivityItemRead], int]:
    stmt = (
        select(
            Leave.id.label("source_id"),
            Leave.id.label("target_id"),
            Leave.created_at.label("occurred_at"),
            Leave.leave_type.label("title"),
            Leave.status,
            Leave.days,
            Employee.id.label("employee_id"),
            Employee.name_en.label("employee_name_en"),
            Employee.name_ar.label("employee_name_ar"),
            func.count().over().label("source_total"),
        )
        .join(Employee, Leave.employee_id == Employee.id)
        .where(Leave.deleted_at.is_(None))
    )
    if employee_id is not None:
        stmt = stmt.where(Leave.employee_id == employee_id)
    rows = db.execute(
        stmt.order_by(Leave.created_at.desc(), Leave.id.desc()).limit(requested)
    ).all()
    total = int(rows[0].source_total) if rows else 0
    return [
        EmployeeActivityItemRead(
            kind="leave",
            source_id=row.source_id,
            target_id=row.target_id,
            occurred_at=row.occurred_at,
            employee_id=row.employee_id,
            employee_name_en=row.employee_name_en,
            employee_name_ar=row.employee_name_ar,
            title=row.title,
            status=row.status,
            days=row.days,
            reference=f"#{row.source_id}",
        )
        for row in rows
    ], total


def _violations(
    db: Session, *, employee_id: str | None, requested: int
) -> tuple[list[EmployeeActivityItemRead], int]:
    stmt = select(
        Violation.id.label("source_id"),
        Violation.id.label("target_id"),
        Violation.created_at.label("occurred_at"),
        Violation.violation_type.label("title"),
        Violation.description.label("detail"),
        Violation.status,
        Employee.id.label("employee_id"),
        Employee.name_en.label("employee_name_en"),
        Employee.name_ar.label("employee_name_ar"),
        func.count().over().label("source_total"),
    ).join(Employee, Violation.employee_id == Employee.id)
    if employee_id is not None:
        stmt = stmt.where(Violation.employee_id == employee_id)
    rows = db.execute(
        stmt.order_by(Violation.created_at.desc(), Violation.id.desc()).limit(requested)
    ).all()
    total = int(rows[0].source_total) if rows else 0
    return [
        EmployeeActivityItemRead(
            kind="violation",
            source_id=row.source_id,
            target_id=row.target_id,
            occurred_at=row.occurred_at,
            employee_id=row.employee_id,
            employee_name_en=row.employee_name_en,
            employee_name_ar=row.employee_name_ar,
            title=row.title,
            detail=row.detail,
            status=row.status,
            reference=f"#{row.source_id}",
        )
        for row in rows
    ], total


def _ledger(
    db: Session,
    *,
    owner_user_id: int,
    employee_id: str | None,
    requested: int,
) -> tuple[list[EmployeeActivityItemRead], int]:
    stmt = (
        select(
            LedgerEntry.id.label("source_id"),
            LedgerEntry.id.label("target_id"),
            LedgerEntry.created_at.label("occurred_at"),
            LedgerEntry.subject.label("title"),
            LedgerEntry.counterparty.label("detail"),
            LedgerEntry.direction,
            LedgerEntry.channel,
            Employee.id.label("employee_id"),
            Employee.name_en.label("employee_name_en"),
            Employee.name_ar.label("employee_name_ar"),
            func.count().over().label("source_total"),
        )
        .join(
            CorrespondenceEmployeeLink,
            CorrespondenceEmployeeLink.ledger_entry_id == LedgerEntry.id,
        )
        .join(Employee, CorrespondenceEmployeeLink.employee_id == Employee.id)
        .where(
            CorrespondenceEmployeeLink.state == "linked",
            LedgerEntry.deleted_at.is_(None),
            correspondence_service.tags_contain(correspondence_service.DRAFT_TAG, negate=True),
            or_(LedgerEntry.channel != "email", LedgerEntry.owner_user_id == owner_user_id),
        )
    )
    if employee_id is not None:
        stmt = stmt.where(CorrespondenceEmployeeLink.employee_id == employee_id)
    rows = db.execute(
        stmt.order_by(LedgerEntry.created_at.desc(), LedgerEntry.id.desc()).limit(requested)
    ).all()
    total = int(rows[0].source_total) if rows else 0
    return [
        EmployeeActivityItemRead(
            kind="ledger",
            source_id=row.source_id,
            target_id=row.target_id,
            occurred_at=row.occurred_at,
            employee_id=row.employee_id,
            employee_name_en=row.employee_name_en,
            employee_name_ar=row.employee_name_ar,
            title=row.title,
            detail=row.detail,
            direction=row.direction,
            channel=row.channel,
            can_open_in_outlook=row.channel == "email",
            reference=f"#{row.source_id}",
        )
        for row in rows
    ], total


def list_employee_activity(
    db: Session,
    *,
    owner_user_id: int,
    employee_id: str | None = None,
    kind: EmployeeActivityKind | None = None,
    limit: int = DEFAULT_LIMIT,
    offset: int = 0,
) -> EmployeeActivityListRead:
    requested = offset + limit
    sources: list[tuple[list[EmployeeActivityItemRead], int]] = []
    if kind in (None, "document"):
        sources.append(_documents(db, employee_id=employee_id, requested=requested))
    if kind in (None, "leave"):
        sources.append(_leaves(db, employee_id=employee_id, requested=requested))
    if kind in (None, "violation"):
        sources.append(_violations(db, employee_id=employee_id, requested=requested))
    if kind in (None, "ledger"):
        sources.append(
            _ledger(
                db,
                owner_user_id=owner_user_id,
                employee_id=employee_id,
                requested=requested,
            )
        )
    merged = sorted(chain.from_iterable(rows for rows, _ in sources), key=_sort_key)
    return EmployeeActivityListRead(
        items=merged[offset : offset + limit],
        total=sum(total for _, total in sources),
        limit=limit,
        offset=offset,
    )
