"""Bounded movement history and cross-safe Armory search."""

from __future__ import annotations

import datetime as dt
import sys
from collections.abc import Callable

from sqlalchemy import SQLColumnExpression, String, and_, case, func, or_, select, type_coerce
from sqlalchemy.orm import Session
from sqlalchemy.sql.elements import ColumnElement

from app.db.models import (
    ArmoryAssignment,
    ArmoryAssignmentLine,
    ArmoryDecision,
    ArmoryDiscrepancy,
    ArmoryItem,
    ArmoryPosting,
    ArmoryPostingLine,
    ArmorySafe,
    ArmorySerial,
    Employee,
    EmployeeFormerId,
)
from app.schemas import armory as s
from app.schemas.employee import WORKING_STATUSES
from app.services import armory_service as core

_FIND_LIMIT = 8
_RECENT_LIMIT = 4


def _search_key(value: str | None) -> str:
    # Stored notes can be longer than the query limit.
    return core.normalize_search(value, max_length=sys.maxsize)


def _enable_text_search(db: Session) -> None:
    """SQLite's LOWER/NOCASE only folds ASCII; normalize both sides in SQL."""
    connection = db.connection()
    if not connection.info.get("armory_search_key"):
        driver = connection.connection.driver_connection
        assert driver is not None
        driver.create_function("armory_search_key", 1, _search_key, deterministic=True)
        connection.info["armory_search_key"] = True


def _text_matches(needle: str, *columns: SQLColumnExpression[str | None]) -> ColumnElement[bool]:
    # instr treats '%' and '_' as literal search characters and binds the needle.
    return or_(*(func.instr(func.armory_search_key(column), needle) > 0 for column in columns))


def _record_ref() -> ColumnElement[str]:
    prefix = case(core.RECORD_PREFIX, value=ArmoryPosting.kind)
    return type_coerce(func.printf("%s-%04d", prefix, ArmoryPosting.id), String)


def _movement_order() -> tuple[
    ColumnElement[dt.date], ColumnElement[dt.datetime], ColumnElement[int]
]:
    return (
        ArmoryPosting.occurred_on.desc(),
        func.coalesce(ArmoryPosting.occurred_at, ArmoryPosting.created_at).desc(),
        ArmoryPosting.id.desc(),
    )


def _employee_movements(
    matches: Callable[[SQLColumnExpression[str | None]], ColumnElement[bool]],
) -> ColumnElement[bool]:
    assignment_id = case(
        (ArmoryPosting.kind == "return", ArmoryPosting.related_posting_id),
        else_=ArmoryPosting.id,
    )
    return or_(
        matches(ArmoryPosting.actor_employee_id),
        matches(ArmoryPosting.witness_employee_id),
        select(ArmoryAssignment.posting_id)
        .where(
            ArmoryAssignment.posting_id == assignment_id,
            or_(
                matches(ArmoryAssignment.holder_employee_id),
                matches(ArmoryAssignment.supervisor_employee_id),
            ),
        )
        .exists(),
        select(ArmoryDiscrepancy.id)
        .where(
            ArmoryDiscrepancy.source_posting_id == ArmoryPosting.id,
            matches(ArmoryDiscrepancy.involved_employee_id),
        )
        .exists(),
        select(ArmoryDecision.posting_id)
        .join(ArmoryDiscrepancy, ArmoryDiscrepancy.id == ArmoryDecision.discrepancy_id)
        .where(
            ArmoryDecision.posting_id == ArmoryPosting.id,
            matches(ArmoryDiscrepancy.involved_employee_id),
        )
        .exists(),
    )


def list_movements(
    db: Session,
    *,
    safe_id: int | None = None,
    item_id: int | None = None,
    serial: str | None = None,
    employee_id: str | None = None,
    q: str | None = None,
    date_from: dt.date | None = None,
    date_to: dt.date | None = None,
    kind: str | None = None,
    page: int = 1,
    page_size: int = core.PAGE_SIZE_DEFAULT,
) -> s.ArmoryPostingPage:
    page, page_size, offset = core.page_bounds(page, page_size)
    if date_from is not None and date_to is not None and date_from > date_to:
        raise core.invalid("from", "The start date must be on or before the end date.")

    filters: list[ColumnElement[bool]] = []
    line = select(ArmoryPostingLine.id).where(ArmoryPostingLine.posting_id == ArmoryPosting.id)
    if safe_id is not None:
        filters.append(
            or_(
                ArmoryPosting.safe_id == safe_id,
                and_(
                    ArmoryPosting.serial_action == "transfer",
                    line.where(ArmoryPostingLine.after_safe_id == safe_id).exists(),
                ),
            )
        )
    if item_id is not None:
        filters.append(line.where(ArmoryPostingLine.item_id == item_id).exists())
    if code := core.normalize_search(serial, max_length=80).upper():
        filters.append(
            line.join(ArmorySerial, ArmorySerial.id == ArmoryPostingLine.serial_id)
            .where(func.instr(ArmorySerial.serial_code, code) > 0)
            .exists()
        )
    if employee_id is not None:
        exact_id = employee_id.strip()
        filters.append(_employee_movements(lambda column: column == exact_id))
    if needle := core.normalize_search(q):
        _enable_text_search(db)
        matching_employees = select(Employee.id).where(_employee_search(needle)).cte()
        employee_ids = select(matching_employees.c.id)
        filters.append(
            or_(
                _text_matches(
                    needle,
                    _record_ref(),
                    ArmoryPosting.reference,
                    ArmoryPosting.note,
                    ArmoryPosting.reason,
                ),
                _employee_movements(lambda column: column.in_(employee_ids)),
            )
        )
    if date_from is not None:
        filters.append(ArmoryPosting.occurred_on >= date_from)
    if date_to is not None:
        filters.append(ArmoryPosting.occurred_on <= date_to)
    if kind is not None:
        filters.append(ArmoryPosting.kind == kind)

    total = db.scalar(select(func.count()).select_from(ArmoryPosting).where(*filters))
    postings = list(
        db.scalars(
            select(ArmoryPosting)
            .where(*filters)
            .order_by(*_movement_order())
            .offset(offset)
            .limit(page_size)
        )
    )
    return s.ArmoryPostingPage(
        items=core.posting_reads(db, postings) if postings else [],
        page=page,
        page_size=page_size,
        total=total or 0,
    )


def get_movement(db: Session, posting_id: int) -> s.ArmoryPostingRead:
    return core.posting_read(db, posting_id)


def _employee_search(needle: str) -> ColumnElement[bool]:
    return or_(
        _text_matches(needle, Employee.id, Employee.name_en, Employee.name_ar),
        select(EmployeeFormerId.id)
        .where(
            EmployeeFormerId.employee_id == Employee.id,
            _text_matches(needle, EmployeeFormerId.former_id),
        )
        .exists(),
    )


def _find_custody(db: Session, needle: str, now: dt.datetime) -> list[s.ArmoryAssignmentSummary]:
    employees = select(Employee.id).where(_employee_search(needle))
    sites = select(ArmorySafe.id).where(
        _text_matches(needle, ArmorySafe.name_en, ArmorySafe.name_ar)
    )
    active = ArmoryPosting.voided_at.is_(None) & (
        select(ArmoryAssignmentLine.id)
        .where(
            ArmoryAssignmentLine.assignment_id == ArmoryAssignment.posting_id,
            ArmoryAssignmentLine.remaining_qty > 0,
        )
        .exists()
    )
    assignments = list(
        db.scalars(
            select(ArmoryAssignment)
            .join(ArmoryPosting, ArmoryPosting.id == ArmoryAssignment.posting_id)
            .where(
                ArmoryPosting.kind == "custody",
                or_(
                    _text_matches(needle, _record_ref()),
                    ArmoryAssignment.holder_employee_id.in_(employees),
                    ArmoryAssignment.supervisor_employee_id.in_(employees),
                    ArmoryAssignment.holder_safe_id.in_(sites),
                ),
            )
            .order_by(active.desc(), *_movement_order())
            .limit(_FIND_LIMIT)
        )
    )
    return core.assignment_summaries(db, assignments, now) if assignments else []


def find(db: Session, *, q: str | None, recent_safe_id: int | None) -> s.ArmoryFindRead:
    now = core.current_time()
    needle = core.normalize_search(q)
    serial_stmt = (
        select(ArmorySerial)
        .where(ArmorySerial.state.is_not(None))
        .order_by(ArmorySerial.state_at.desc(), ArmorySerial.id.desc())
    )
    if not needle:
        if recent_safe_id is not None:
            serial_stmt = serial_stmt.where(ArmorySerial.safe_id == recent_safe_id)
        serials = list(db.scalars(serial_stmt.limit(_RECENT_LIMIT)))
        return s.ArmoryFindRead(
            serials=core.serial_reads(db, serials, now) if serials else [],
            guards=[],
            items=[],
            custody=[],
            postings=[],
        )

    _enable_text_search(db)
    serials = list(
        db.scalars(
            serial_stmt.where(func.instr(ArmorySerial.serial_code, needle.upper()) > 0).limit(
                _FIND_LIMIT
            )
        )
    )
    guards = db.scalars(
        select(Employee)
        .where(_employee_search(needle))
        .order_by(Employee.status.in_(WORKING_STATUSES).desc(), Employee.id)
        .limit(_FIND_LIMIT)
    ).all()
    items = db.scalars(
        select(ArmoryItem)
        .where(_text_matches(needle, ArmoryItem.name_en, ArmoryItem.name_ar))
        .order_by(func.armory_search_key(ArmoryItem.name_en), ArmoryItem.id)
        .limit(_FIND_LIMIT)
    ).all()
    postings = db.scalars(
        select(ArmoryPosting)
        .where(_text_matches(needle, _record_ref(), ArmoryPosting.reference))
        .order_by(*_movement_order())
        .limit(_FIND_LIMIT)
    ).all()
    return s.ArmoryFindRead(
        serials=core.serial_reads(db, serials, now) if serials else [],
        guards=[core.person_read(row) for row in guards],
        items=[core.item_ref(row) for row in items],
        custody=_find_custody(db, needle, now),
        postings=[core.posting_ref(row) for row in postings],
    )
