"""Dashboard summary service.

Pure read-only aggregation across employees, leaves, and documents. No new
tables, no caching, no migrations: every call recomputes from current data.
The ``today`` kwarg is exposed so tests can pin the date deterministically.

Filters:
- Active employees: ``status == 'Active'``.
- Leaves: only ``status == 'Approved'`` count toward on-leave / upcoming;
  ``deleted_at`` is excluded.
- Documents: the table has no ``deleted_at`` column, so ``forms_this_month``
  is an unfiltered count of rows with ``created_at >= first-of-month``.
"""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session

from app.db.models import Document, Employee, Leave, Violation
from app.schemas.dashboard import (
    DashboardLeaveItem,
    DashboardRecentDocument,
    DashboardSummary,
    DashboardTotals,
    DashboardUpcomingLeaveItem,
)

# How many "recent" rows to surface per stream.
RECENT_LIMIT = 5
# Upcoming-window length in days (exclusive of today, inclusive of today+N).
UPCOMING_WINDOW_DAYS = 7

# Canonical "active" employee status — must match ``employee_service``.
_ACTIVE_STATUS = "Active"

# Only Approved leaves are considered real absences.
_APPROVED_STATUS = "Approved"


def _first_of_month(today: date) -> datetime:
    """First instant of the month containing ``today`` (naive UTC)."""
    return datetime(today.year, today.month, 1)


def get_summary(db: Session, *, today: date | None = None) -> DashboardSummary:
    """Compose the dashboard payload without mailbox-owned metrics."""
    if today is None:
        today = date.today()

    return DashboardSummary(
        totals=_compute_totals(db, today=today),
        on_leave_today=_on_leave_today(db, today=today),
        upcoming_leave_ends=_upcoming_leave_ends(db, today=today),
        recent_documents=_recent_documents(db),
    )


# ---------------------------------------------------------------------------
# Totals
# ---------------------------------------------------------------------------


def _compute_totals(db: Session, *, today: date) -> DashboardTotals:
    employees_active = int(
        db.execute(
            select(func.count()).select_from(Employee).where(
                Employee.status == _ACTIVE_STATUS
            )
        ).scalar_one()
    )

    on_leave_count = int(
        db.execute(
            select(func.count()).select_from(Leave).where(
                and_(
                    Leave.deleted_at.is_(None),
                    Leave.status == _APPROVED_STATUS,
                    Leave.start_date <= today,
                    Leave.end_date >= today,
                )
            )
        ).scalar_one()
    )

    present_today = max(employees_active - on_leave_count, 0)

    forms_this_month = int(
        db.execute(
            select(func.count()).select_from(Document).where(
                Document.created_at >= _first_of_month(today),
                Document.ref_number != "DRAFT",
            )
        ).scalar_one()
    )

    open_violations_count = int(
        db.execute(
            select(func.count()).select_from(Violation).where(
                Violation.status == "Open"
            )
        ).scalar_one()
    )


    return DashboardTotals(
        employees_active=employees_active,
        on_leave_today=on_leave_count,
        present_today=present_today,
        forms_this_month=forms_this_month,
        open_violations_count=open_violations_count,
    )


# ---------------------------------------------------------------------------
# Leave sections
# ---------------------------------------------------------------------------


def _on_leave_today(db: Session, *, today: date) -> list[DashboardLeaveItem]:
    stmt = (
        select(
            Leave.id,
            Leave.leave_type,
            Leave.start_date,
            Leave.end_date,
            Employee.id.label("employee_id"),
            Employee.name_en.label("employee_name_en"),
            Employee.name_ar.label("employee_name_ar"),
        )
        .join(Employee, Employee.id == Leave.employee_id)
        .where(
            Leave.deleted_at.is_(None),
            Leave.status == _APPROVED_STATUS,
            Leave.start_date <= today,
            Leave.end_date >= today,
        )
        .order_by(Leave.end_date.asc(), Leave.id.asc())
    )

    return [
        DashboardLeaveItem(
            employee_id=r.employee_id,
            employee_name_en=r.employee_name_en,
            employee_name_ar=r.employee_name_ar,
            leave_id=r.id,
            leave_type=r.leave_type,
            start_date=r.start_date,
            end_date=r.end_date,
        )
        for r in db.execute(stmt).all()
    ]


def _upcoming_leave_ends(
    db: Session, *, today: date
) -> list[DashboardUpcomingLeaveItem]:
    horizon = date.fromordinal(today.toordinal() + UPCOMING_WINDOW_DAYS)
    stmt = (
        select(
            Leave.id,
            Leave.leave_type,
            Leave.start_date,
            Leave.end_date,
            Employee.id.label("employee_id"),
            Employee.name_en.label("employee_name_en"),
            Employee.name_ar.label("employee_name_ar"),
        )
        .join(Employee, Employee.id == Leave.employee_id)
        .where(
            Leave.deleted_at.is_(None),
            Leave.status == _APPROVED_STATUS,
            Leave.end_date > today,
            Leave.end_date <= horizon,
        )
        .order_by(Leave.end_date.asc(), Leave.id.asc())
    )

    return [
        DashboardUpcomingLeaveItem(
            employee_id=r.employee_id,
            employee_name_en=r.employee_name_en,
            employee_name_ar=r.employee_name_ar,
            leave_id=r.id,
            leave_type=r.leave_type,
            start_date=r.start_date,
            end_date=r.end_date,
            days_remaining=(r.end_date - today).days,
        )
        for r in db.execute(stmt).all()
    ]


# ---------------------------------------------------------------------------
# Recent activity
# ---------------------------------------------------------------------------


def _recent_documents(db: Session) -> list[DashboardRecentDocument]:
    stmt = (
        select(
            Document.id,
            Document.template_id,
            Document.ref_number,
            Document.role,
            Document.created_at,
            Employee.id.label("employee_id"),
            Employee.name_en.label("employee_name_en"),
            Employee.name_ar.label("employee_name_ar"),
        )
        .outerjoin(Employee, Employee.id == Document.employee_id)
        .where(Document.ref_number != "DRAFT")
        .order_by(Document.created_at.desc(), Document.id.desc())
        .limit(RECENT_LIMIT)
    )

    return [
        DashboardRecentDocument(
            id=r.id,
            employee_id=r.employee_id,
            # Admin-category docs have no employee — label them rather than
            # dropping the row (the join is now outer).
            employee_name_en=r.employee_name_en or "General Book",
            employee_name_ar=r.employee_name_ar,
            template_id=r.template_id,
            ref_number=r.ref_number,
            role=r.role,
            created_at=r.created_at,
        )
        for r in db.execute(stmt).all()
    ]




__all__ = [
    "RECENT_LIMIT",
    "UPCOMING_WINDOW_DAYS",
    "get_summary",
]
