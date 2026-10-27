from __future__ import annotations

from itertools import chain

from sqlalchemy import ColumnElement, func, select
from sqlalchemy.orm import Session

from app.db.models import (
    Document,
    Employee,
    EmployeeStatusEvent,
    Leave,
    LedgerEntry,
    User,
    Violation,
)
from app.db.workforce_models import DutyAssignmentEvent
from app.schemas.employee_activity import (
    EmployeeActivityItemRead,
    EmployeeActivityKind,
    EmployeeActivityListRead,
)
from app.services import document_service, ledger_service, perm_service
from app.services.department_scope_service import DepartmentScope, employee_visibility_clause

DEFAULT_LIMIT = 25
MAX_LIMIT = 100


def _sort_key(item: EmployeeActivityItemRead) -> tuple[float, str, int]:
    return (-item.occurred_at.timestamp(), item.kind, -item.source_id)


def _documents(
    db: Session,
    *,
    employee_id: str | None,
    requested: int,
    user: User | None,
    excluded_ids: set[int],
    scope: DepartmentScope | None = None,
) -> tuple[list[EmployeeActivityItemRead], int]:
    """Documents owned by a live Record the caller may read, filtered in SQL.

    Activity links open Records, so standalone documents have no target.
    """
    target_id = document_service.owning_record_id()
    stmt = (
        select(
            Document.id.label("source_id"),
            target_id.label("target_id"),
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
            Document.ref_number != "DRAFT",
            document_service.live_record_document_clause(db, user),
        )
    )
    if employee_id is not None:
        stmt = stmt.where(Document.employee_id == employee_id)
    if excluded_ids:
        stmt = stmt.where(Document.id.not_in(excluded_ids))
    clause = employee_visibility_clause(scope)
    if clause is not None:
        stmt = stmt.where(clause)
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
    db: Session, *, employee_id: str | None, requested: int, scope: DepartmentScope | None = None
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
    clause = employee_visibility_clause(scope)
    if clause is not None:
        stmt = stmt.where(clause)
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
    db: Session, *, employee_id: str | None, requested: int, scope: DepartmentScope | None = None
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
    clause = employee_visibility_clause(scope)
    if clause is not None:
        stmt = stmt.where(clause)
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
    visible: ColumnElement[bool] | None = None,
    scope: DepartmentScope | None = None,
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
        .join(Employee, LedgerEntry.related_employee_id == Employee.id)
        .where(
            LedgerEntry.related_employee_id.is_not(None),
            LedgerEntry.deleted_at.is_(None),
            ledger_service._tags_contain(ledger_service.DRAFT_TAG, negate=True),
            ledger_service.email_owned_by(owner_user_id),
        )
    )
    if employee_id is not None:
        stmt = stmt.where(LedgerEntry.related_employee_id == employee_id)
    if visible is not None:
        stmt = stmt.where(visible)
    clause = employee_visibility_clause(scope)
    if clause is not None:
        stmt = stmt.where(clause)
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
            reference=f"#{row.source_id}",
        )
        for row in rows
    ], total


def _duty_locations(
    db: Session, *, employee_id: str | None, requested: int, scope: DepartmentScope | None = None
) -> tuple[list[EmployeeActivityItemRead], int]:
    stmt = (
        select(
            DutyAssignmentEvent.id.label("source_id"),
            DutyAssignmentEvent.effective_at.label("occurred_at"),
            DutyAssignmentEvent.event_type,
            DutyAssignmentEvent.from_department,
            DutyAssignmentEvent.from_unit,
            DutyAssignmentEvent.from_post,
            DutyAssignmentEvent.to_department,
            DutyAssignmentEvent.to_unit,
            DutyAssignmentEvent.to_post,
            DutyAssignmentEvent.reason,
            Employee.id.label("employee_id"),
            Employee.name_en.label("employee_name_en"),
            Employee.name_ar.label("employee_name_ar"),
            func.count().over().label("source_total"),
        )
        .join(Employee, DutyAssignmentEvent.employee_id == Employee.id)
        .where(DutyAssignmentEvent.event_type.in_(("initial_placement", "transfer")))
    )
    if employee_id is not None:
        stmt = stmt.where(DutyAssignmentEvent.employee_id == employee_id)
    clause = employee_visibility_clause(scope)
    if clause is not None:
        stmt = stmt.where(clause)
    rows = db.execute(
        stmt.order_by(DutyAssignmentEvent.effective_at.desc(), DutyAssignmentEvent.id.desc()).limit(
            requested
        )
    ).all()
    total = int(rows[0].source_total) if rows else 0
    return [
        EmployeeActivityItemRead(
            kind="duty_location",
            source_id=row.source_id,
            target_id=row.source_id,
            occurred_at=row.occurred_at,
            employee_id=row.employee_id,
            employee_name_en=row.employee_name_en,
            employee_name_ar=row.employee_name_ar,
            title=row.event_type,
            detail=row.reason,
            reference=f"#{row.source_id}",
            event_type=row.event_type,
            from_department=row.from_department,
            from_unit=row.from_unit,
            from_post=row.from_post,
            to_department=row.to_department,
            to_unit=row.to_unit,
            to_post=row.to_post,
            reason=row.reason,
        )
        for row in rows
    ], total


def _status_events(
    db: Session, *, employee_id: str | None, requested: int, scope: DepartmentScope | None = None
) -> tuple[list[EmployeeActivityItemRead], int]:
    stmt = (
        select(
            EmployeeStatusEvent.id.label("source_id"),
            EmployeeStatusEvent.created_at.label("occurred_at"),
            EmployeeStatusEvent.from_status,
            EmployeeStatusEvent.to_status,
            EmployeeStatusEvent.effective_date,
            EmployeeStatusEvent.site,
            EmployeeStatusEvent.return_date,
            EmployeeStatusEvent.kind.label("event_kind"),
            EmployeeStatusEvent.source.label("event_source"),
            func.coalesce(func.nullif(User.display_name, ""), User.email).label("actor_name"),
            Employee.id.label("employee_id"),
            Employee.name_en.label("employee_name_en"),
            Employee.name_ar.label("employee_name_ar"),
            func.count().over().label("source_total"),
        )
        .join(Employee, EmployeeStatusEvent.employee_id == Employee.id)
        .outerjoin(User, EmployeeStatusEvent.actor_user_id == User.id)
    )
    if employee_id is not None:
        stmt = stmt.where(EmployeeStatusEvent.employee_id == employee_id)
    clause = employee_visibility_clause(scope)
    if clause is not None:
        stmt = stmt.where(clause)
    rows = db.execute(
        stmt.order_by(EmployeeStatusEvent.created_at.desc(), EmployeeStatusEvent.id.desc()).limit(
            requested
        )
    ).all()
    total = int(rows[0].source_total) if rows else 0
    return [
        EmployeeActivityItemRead(
            kind="status",
            source_id=row.source_id,
            target_id=row.source_id,
            occurred_at=row.occurred_at,
            employee_id=row.employee_id,
            employee_name_en=row.employee_name_en,
            employee_name_ar=row.employee_name_ar,
            title=row.to_status,
            reference=f"#{row.source_id}",
            from_status=row.from_status,
            to_status=row.to_status,
            effective_date=row.effective_date,
            site=row.site,
            return_date=row.return_date,
            status_event_kind=row.event_kind,
            status_source=row.event_source,
            actor_name=row.actor_name,
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
    scope: DepartmentScope | None = None,
) -> EmployeeActivityListRead:
    requested = offset + limit
    # owner_user_id is the caller: rows about Records they cannot open are hidden.
    caller = db.get(User, owner_user_id)
    sources: list[tuple[list[EmployeeActivityItemRead], int]] = []
    if kind in (None, "leave"):
        sources.append(_leaves(db, employee_id=employee_id, requested=requested, scope=scope))
    if (
        kind in (None, "violation")
        and caller is not None
        and perm_service.has_capability(db, caller, "violations.view")
    ):
        sources.append(_violations(db, employee_id=employee_id, requested=requested, scope=scope))
    if kind in (None, "ledger"):
        sources.append(
            _ledger(
                db,
                owner_user_id=owner_user_id,
                employee_id=employee_id,
                requested=requested,
                visible=ledger_service.related_book_visible(db, caller),
                scope=scope,
            )
        )
    if kind in (None, "duty_location"):
        sources.append(
            _duty_locations(db, employee_id=employee_id, requested=requested, scope=scope)
        )
    if kind in (None, "status"):
        sources.append(
            _status_events(db, employee_id=employee_id, requested=requested, scope=scope)
        )

    # Documents are filtered in SQL; the exact per-document gate then re-checks
    # only the documents that land on this page. A refused one is excluded and
    # the page refilled, so each pass removes at least one row.
    refused: set[int] = set()
    while True:
        documents: tuple[list[EmployeeActivityItemRead], int] = ([], 0)
        if kind in (None, "document"):
            documents = _documents(
                db,
                employee_id=employee_id,
                requested=requested,
                user=caller,
                excluded_ids=refused,
                scope=scope,
            )
        merged = sorted(
            chain(documents[0], chain.from_iterable(rows for rows, _ in sources)),
            key=_sort_key,
        )
        page = merged[offset : offset + limit]
        newly_refused = document_service.unreadable_live_record_documents(
            db,
            {item.source_id: item.target_id for item in page if item.kind == "document"},
            user=caller,
        )
        if not newly_refused:
            break
        refused |= newly_refused
    return EmployeeActivityListRead(
        items=page,
        total=documents[1] + sum(total for _, total in sources),
        limit=limit,
        offset=offset,
    )
