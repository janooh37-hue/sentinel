"""Aggregate-fetch for the Employee Detail page (TAMM redesign §6.6a).

Returns everything tied to an employee in one query: stats, recent
docs/leaves/violations/ledger entries, and a merged activity timeline.

Filter rules:
- Approved leaves count toward ``leaves_taken_days``; other statuses don't.
- ``LedgerEntry.deleted_at`` rows are excluded from counts and the recent list.
- Tenure is derived from ``Employee.doj`` (the column v3 used; ``doj_company``
  is the start at this specific company, but historical data keeps it equal to
  ``doj`` for most rows — sticking with ``doj`` matches the dashboard service).
"""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session

from app.db import models
from app.schemas import employee_detail as sx
from app.schemas.employee import EmployeeRead
from app.services import photo_service

# Cap each recent-* array. The Employee Detail page paginates the per-tab
# views via dedicated endpoints; this aggregate is for the at-a-glance hero.
RECENT_LIMIT = 10
ACTIVITY_LIMIT = 20

# Stand-in until the leave policy service lands. v3 used a flat 30-day annual
# allowance for the on-screen counter; keep parity here.
DEFAULT_LEAVE_ALLOWANCE_DAYS = 30

# Canonical leave status that counts as "taken" — matches ``dashboard_service``.
_APPROVED_STATUS = "Approved"


def get_employee_detail(db: Session, employee_id: str) -> sx.EmployeeDetailRead | None:
    emp = db.get(models.Employee, employee_id)
    if emp is None:
        return None

    tenure_years = _tenure_years(emp.doj)

    doc_count = int(
        db.execute(
            select(func.count(models.Document.id)).where(
                models.Document.employee_id == emp.id,
                models.Document.ref_number != "DRAFT",
            )
        ).scalar_one()
    )

    # Scoped to the current calendar year so the value is comparable to
    # ``leaves_allowed_days`` (a 30-day annual allowance). Summing the
    # employee's entire tenure here would be misleading on the UI.
    current_year = date.today().year
    leave_days = int(
        db.execute(
            select(func.coalesce(func.sum(models.Leave.days), 0))
            .where(models.Leave.employee_id == emp.id)
            .where(models.Leave.status == _APPROVED_STATUS)
            .where(models.Leave.deleted_at.is_(None))
            .where(func.extract("year", models.Leave.start_date) == current_year)
        ).scalar_one()
    )

    violation_count = int(
        db.execute(
            select(func.count(models.Violation.id)).where(models.Violation.employee_id == emp.id)
        ).scalar_one()
    )

    ledger_count = int(
        db.execute(
            select(func.count(models.LedgerEntry.id))
            .where(models.LedgerEntry.related_employee_id == emp.id)
            .where(models.LedgerEntry.deleted_at.is_(None))
        ).scalar_one()
    )

    stats = sx.EmployeeStatsRead(
        documents=doc_count,
        leaves_taken_days=leave_days,
        leaves_allowed_days=DEFAULT_LEAVE_ALLOWANCE_DAYS,
        violations=violation_count,
        ledger_count=ledger_count,
        tenure_years=tenure_years,
    )

    doc_rows = db.execute(
        select(
            models.Document,
            models.Book.id.label("book_id"),
            models.Book.approval_state.label("approval_state"),
        )
        .outerjoin(
            models.Book,
            and_(
                models.Book.ref_number == models.Document.ref_number,
                models.Book.deleted_at.is_(None),
            ),
        )
        .where(
            models.Document.employee_id == emp.id,
            models.Document.ref_number != "DRAFT",
        )
        .order_by(models.Document.created_at.desc())
        .limit(RECENT_LIMIT)
    ).all()
    recent_docs = [
        sx.RecentDocumentRead(
            id=r.Document.id,
            template_id=r.Document.template_id,
            ref_number=r.Document.ref_number,
            created_at=r.Document.created_at,
            book_id=r.book_id,
            approval_state=r.approval_state,
        )
        for r in doc_rows
    ]

    recent_leaves = [
        sx.RecentLeaveRead.model_validate(lv)
        for lv in db.scalars(
            select(models.Leave)
            .where(models.Leave.employee_id == emp.id)
            .where(models.Leave.deleted_at.is_(None))
            .order_by(models.Leave.start_date.desc())
            .limit(RECENT_LIMIT)
        )
    ]

    recent_violations = [
        sx.RecentViolationRead.model_validate(v)
        for v in db.scalars(
            select(models.Violation)
            .where(models.Violation.employee_id == emp.id)
            .order_by(models.Violation.date.desc())
            .limit(RECENT_LIMIT)
        )
    ]

    recent_ledger = [
        sx.RecentLedgerRead.model_validate(le)
        for le in db.scalars(
            select(models.LedgerEntry)
            .where(models.LedgerEntry.related_employee_id == emp.id)
            .where(models.LedgerEntry.deleted_at.is_(None))
            .order_by(models.LedgerEntry.created_at.desc())
            .limit(RECENT_LIMIT)
        )
    ]

    activity = _build_activity(recent_docs, recent_leaves, recent_violations, recent_ledger)

    recent_sms = [
        sx.SmsMessageRead.model_validate(m)
        for m in db.scalars(
            select(models.SmsMessage)
            .where(models.SmsMessage.employee_id == emp.id)
            .order_by(models.SmsMessage.id.desc())
            .limit(50)
        )
    ]

    _ver = photo_service.get_photo_version(db, emp.id)
    return sx.EmployeeDetailRead(
        employee=EmployeeRead.model_validate(emp).model_copy(
            update={"has_photo": _ver is not None, "photo_version": _ver}
        ),
        stats=stats,
        recent_documents=recent_docs,
        recent_leaves=recent_leaves,
        recent_violations=recent_violations,
        recent_ledger=recent_ledger,
        recent_activity=activity,
        recent_sms=recent_sms,
    )


def _tenure_years(doj: date | None) -> float:
    if doj is None:
        return 0.0
    days = (date.today() - doj).days
    if days < 0:
        return 0.0
    return round(days / 365.25, 1)


def _build_activity(
    docs: list[sx.RecentDocumentRead],
    leaves: list[sx.RecentLeaveRead],
    violations: list[sx.RecentViolationRead],
    ledger: list[sx.RecentLedgerRead],
) -> list[sx.ActivityItemRead]:
    items: list[sx.ActivityItemRead] = []
    for d in docs:
        items.append(
            sx.ActivityItemRead(
                when=d.created_at,
                kind="document",
                summary=f"Generated {d.template_id}",
                ref_id=d.id,
            )
        )
    # Date-only events (leaves, violations) use 00:00 so they sort AFTER any
    # timestamped event on the same day (documents, ledger entries) when items
    # are sorted newest-first. A doc created at 14:00 today appears above a
    # leave that simply started today.
    for lv in leaves:
        items.append(
            sx.ActivityItemRead(
                when=datetime.combine(lv.start_date, datetime.min.time()),
                kind="leave",
                summary=f"{lv.leave_type} ({lv.days}d)",
                ref_id=lv.id,
            )
        )
    for v in violations:
        items.append(
            sx.ActivityItemRead(
                when=datetime.combine(v.date, datetime.min.time()),
                kind="violation",
                summary=v.description or v.violation_type,
                ref_id=v.id,
            )
        )
    for le in ledger:
        items.append(
            sx.ActivityItemRead(
                when=le.created_at,
                kind="ledger",
                summary=le.subject,
                ref_id=le.id,
            )
        )
    items.sort(key=lambda x: x.when, reverse=True)
    return items[:ACTIVITY_LIMIT]
