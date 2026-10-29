"""Employee-file statements: the full Activity statement and issued print serials.

The Activity statement is the uncapped sibling of the Employee Detail
``recent_activity`` timeline and applies the same visibility rules (see
``employee_detail_service``):

- violations only with ``violations.view``;
- leaves and absences only with ``leaves.view``;
- documents through the canonical record read gate, preview drafts excluded;
- correspondence that is live, about a Record the caller may open, and not
  another user's private email;
- duty events limited to initial placements and transfers.

Every source is filtered by the requested period in SQL (inclusive dates; the
site calendar for timestamped sources). Timestamps are stored as naive UTC and
are returned as site-local (Asia/Dubai) instants; date-only kinds use 00:00.
"""

from __future__ import annotations

import json
from collections.abc import Iterable
from datetime import UTC, date, datetime, time, timedelta
from typing import Any

from sqlalchemy import ColumnElement, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db import models
from app.schemas._base import DUBAI
from app.schemas.employee_statement import (
    ActivityStatementItemRead,
    ActivityStatementRead,
    StatementPrintCreate,
    StatementPrintRead,
)
from app.services import document_service, perm_service
from app.services.employee_detail_service import (
    document_filters,
    ledger_filters_for,
    user_display_name,
)

# Hard safety cap on one statement; ``truncated`` reports a cut.
STATEMENT_CAP = 2000
_DUTY_EVENT_TYPES = ("initial_placement", "transfer")


def activity_statement(
    db: Session,
    employee_id: str,
    *,
    user: models.User | None,
    from_date: date | None,
    to_date: date | None,
) -> ActivityStatementRead | None:
    """Every readable fact in the employee's record in the period, newest first.

    ``None`` means the employee does not exist.
    """
    emp = db.get(models.Employee, employee_id)
    if emp is None:
        return None
    can_view_violations = user is None or perm_service.has_capability(db, user, "violations.view")
    can_view_leaves = user is None or perm_service.has_capability(db, user, "leaves.view")

    # Fetch one past the cap per source so a cut is detectable after the merge.
    fetch = STATEMENT_CAP + 1
    items: list[ActivityStatementItemRead] = []
    pending_actor: list[tuple[ActivityStatementItemRead, int | None]] = []

    # Documents: the read gate runs per row, so it cannot be limited in SQL.
    doc_rows = document_service.readable_documents(
        db,
        db.scalars(
            select(models.Document)
            .where(*document_filters(emp.id))
            .where(*_instant_bounds(models.Document.created_at, from_date, to_date))
            .order_by(models.Document.created_at.desc(), models.Document.id.desc())
        ),
        user=user,
    )
    fields_meta = document_service.load_fields_meta()
    for document, version in doc_rows:
        meta = fields_meta.get(document.template_id) or {}
        item = ActivityStatementItemRead(
            kind="document",
            source_id=document.id,
            occurred_at=_site(document.created_at),
            date_only=False,
            reference=document.ref_number,
            template_id=document.template_id,
            template_name_en=meta.get("name_en"),
            template_name_ar=meta.get("name_ar"),
        )
        pending_actor.append((item, _document_actor_id(version)))

    if can_view_leaves:
        leaves = list(
            db.scalars(
                select(models.Leave)
                .where(models.Leave.employee_id == emp.id, models.Leave.deleted_at.is_(None))
                .where(*_date_bounds(models.Leave.start_date, from_date, to_date))
                .order_by(models.Leave.start_date.desc(), models.Leave.id.desc())
                .limit(fetch)
            )
        )
        leave_docs = document_service.documents_for_leaves(
            db, [leave.id for leave in leaves], user=user
        )
        items.extend(
            ActivityStatementItemRead(
                kind="leave",
                source_id=leave.id,
                occurred_at=_site_midnight(leave.start_date),
                date_only=True,
                leave_type=leave.leave_type,
                start_date=leave.start_date,
                end_date=leave.end_date,
                days=leave.days,
                leave_status=leave.status,
                linked_documents=leave_docs.get(leave.id, []),
            )
            for leave in leaves
        )
        for absence in db.scalars(
            select(models.Absence)
            .where(models.Absence.employee_id == emp.id)
            .where(*_date_bounds(models.Absence.date, from_date, to_date))
            .order_by(models.Absence.date.desc(), models.Absence.id.desc())
            .limit(fetch)
        ):
            item = ActivityStatementItemRead(
                kind="absence",
                source_id=absence.id,
                occurred_at=_site_midnight(absence.date),
                date_only=True,
                note=absence.note,
            )
            pending_actor.append((item, absence.created_by))

    if can_view_violations:
        violations = list(
            db.scalars(
                select(models.Violation)
                .where(models.Violation.employee_id == emp.id)
                .where(*_date_bounds(models.Violation.date, from_date, to_date))
                .order_by(models.Violation.date.desc(), models.Violation.id.desc())
                .limit(fetch)
            )
        )
        violation_docs = document_service.documents_for_violations(
            db, [violation.id for violation in violations], user=user
        )
        items.extend(
            ActivityStatementItemRead(
                kind="violation",
                source_id=violation.id,
                occurred_at=_site_midnight(violation.date),
                date_only=True,
                violation_type=violation.violation_type,
                description=violation.description,
                action_taken=violation.action_taken,
                deduction_days=violation.deduction_days,
                violation_status=violation.status,
                linked_documents=violation_docs.get(violation.id, []),
            )
            for violation in violations
        )

    for entry in db.scalars(
        select(models.LedgerEntry)
        .where(*ledger_filters_for(db, emp.id, user))
        .where(*_instant_bounds(models.LedgerEntry.created_at, from_date, to_date))
        .order_by(models.LedgerEntry.created_at.desc(), models.LedgerEntry.id.desc())
        .limit(fetch)
    ):
        items.append(
            ActivityStatementItemRead(
                kind="ledger",
                source_id=entry.id,
                occurred_at=_site(entry.created_at),
                date_only=False,
                actor_name=(entry.created_by or "").strip() or None,
                subject=entry.subject,
                direction=entry.direction,
                channel=entry.channel,
                counterparty=entry.counterparty,
            )
        )

    for event in db.scalars(
        select(models.DutyAssignmentEvent)
        .where(
            models.DutyAssignmentEvent.employee_id == emp.id,
            models.DutyAssignmentEvent.event_type.in_(_DUTY_EVENT_TYPES),
        )
        .where(*_instant_bounds(models.DutyAssignmentEvent.effective_at, from_date, to_date))
        .order_by(
            models.DutyAssignmentEvent.effective_at.desc(), models.DutyAssignmentEvent.id.desc()
        )
        .limit(fetch)
    ):
        item = ActivityStatementItemRead(
            kind="duty_location",
            source_id=event.id,
            occurred_at=_site(event.effective_at),
            date_only=False,
            event_type=event.event_type,
            from_department=event.from_department,
            from_unit=event.from_unit,
            from_post=event.from_post,
            to_department=event.to_department,
            to_unit=event.to_unit,
            to_post=event.to_post,
            reason=event.reason,
        )
        pending_actor.append((item, event.actor_user_id))

    for status_event in db.scalars(
        select(models.EmployeeStatusEvent)
        .where(models.EmployeeStatusEvent.employee_id == emp.id)
        .where(*_instant_bounds(models.EmployeeStatusEvent.created_at, from_date, to_date))
        .order_by(
            models.EmployeeStatusEvent.created_at.desc(), models.EmployeeStatusEvent.id.desc()
        )
        .limit(fetch)
    ):
        item = ActivityStatementItemRead(
            kind="status",
            source_id=status_event.id,
            occurred_at=_site(status_event.created_at),
            date_only=False,
            from_status=status_event.from_status,
            to_status=status_event.to_status,
            effective_date=status_event.effective_date,
            site=status_event.site,
            return_date=status_event.return_date,
            status_event_kind=status_event.kind,
            status_source=status_event.source,
        )
        pending_actor.append((item, status_event.actor_user_id))

    user_ids = {uid for _, uid in pending_actor if uid is not None}
    names = _user_names(db, user_ids)
    for item, uid in pending_actor:
        item.actor_name = names.get(uid) if uid is not None else None
        items.append(item)

    items.sort(key=lambda i: (-i.occurred_at.timestamp(), i.kind, -i.source_id))
    truncated = len(items) > STATEMENT_CAP
    return ActivityStatementRead(
        employee_id=emp.id,
        from_date=from_date,
        to_date=to_date,
        items=items[:STATEMENT_CAP],
        truncated=truncated,
    )


def create_print(
    db: Session, employee: models.Employee, body: StatementPrintCreate, *, user: models.User
) -> StatementPrintRead:
    """Issue the employee's next statement serial and record what was printed.

    The serial is ``max + 1`` inside the transaction; a concurrent print that
    took the same number trips the unique constraint and is retried once.
    """
    for attempt in range(2):
        serial = (
            db.scalar(
                select(func.coalesce(func.max(models.EmployeeStatementPrint.serial), 0)).where(
                    models.EmployeeStatementPrint.employee_id == employee.id
                )
            )
            or 0
        ) + 1
        row = models.EmployeeStatementPrint(
            employee_id=employee.id,
            serial=serial,
            kind=body.kind,
            from_date=body.from_date,
            to_date=body.to_date,
            language=body.language,
            options=json.dumps(body.options, ensure_ascii=False, sort_keys=True),
            printed_by_user_id=user.id,
        )
        try:
            with db.begin_nested():
                db.add(row)
                db.flush()
        except IntegrityError:
            if attempt == 1:
                raise
            continue
        db.commit()
        db.refresh(row)
        return print_read(db, row)
    raise AssertionError("unreachable")


def print_read(db: Session, row: models.EmployeeStatementPrint) -> StatementPrintRead:
    names = _user_names(db, {row.printed_by_user_id} if row.printed_by_user_id else set())
    return StatementPrintRead(
        id=row.id,
        employee_id=row.employee_id,
        kind=row.kind,
        serial=row.serial,
        reference=f"{row.employee_id}/1/12/{row.serial}",
        from_date=row.from_date,
        to_date=row.to_date,
        language=row.language,
        printed_at=row.printed_at,
        printed_by_name=names.get(row.printed_by_user_id) if row.printed_by_user_id else None,
    )


def _document_actor_id(version: models.BookVersion | None) -> int | None:
    if version is None:
        return None
    if version.created_by_user_id is not None:
        return version.created_by_user_id
    return version.book.created_by_user_id if version.book is not None else None


def _user_names(db: Session, user_ids: Iterable[int]) -> dict[int, str]:
    ids = set(user_ids)
    if not ids:
        return {}
    return {
        uid: name
        for uid, name in db.execute(
            select(models.User.id, user_display_name()).where(models.User.id.in_(ids))
        ).tuples()
        if name
    }


def _site(stored_utc: datetime) -> datetime:
    """A stored naive-UTC timestamp as a site-local instant."""
    return stored_utc.replace(tzinfo=UTC).astimezone(DUBAI)


def _site_midnight(day: date) -> datetime:
    return datetime.combine(day, time.min, tzinfo=DUBAI)


def _utc_start_of(day: date) -> datetime:
    """The naive-UTC instant at which the site day ``day`` begins."""
    return _site_midnight(day).astimezone(UTC).replace(tzinfo=None)


def _instant_bounds(
    column: Any, from_date: date | None, to_date: date | None
) -> list[ColumnElement[bool]]:
    bounds: list[ColumnElement[bool]] = []
    if from_date is not None:
        bounds.append(column >= _utc_start_of(from_date))
    if to_date is not None:
        bounds.append(column < _utc_start_of(to_date + timedelta(days=1)))
    return bounds


def _date_bounds(
    column: Any, from_date: date | None, to_date: date | None
) -> list[ColumnElement[bool]]:
    bounds: list[ColumnElement[bool]] = []
    if from_date is not None:
        bounds.append(column >= from_date)
    if to_date is not None:
        bounds.append(column <= to_date)
    return bounds
