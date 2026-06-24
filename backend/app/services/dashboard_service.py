"""Dashboard summary service — Phase 12.

Pure read-only aggregation across employees, leaves, documents, and ledger
entries.  No new tables, no caching, no migrations: every call recomputes
from current data.  The ``today`` kwarg is exposed so tests can pin the
date deterministically.

Filters worth flagging:
- Active employees: ``status == 'Active'`` (same rule as ``employee_service``).
- Leaves: only ``status == 'Approved'`` count toward on-leave / upcoming;
  ``deleted_at`` is excluded.
- Documents: the table has no ``deleted_at`` column, so ``forms_this_month``
  is an unfiltered count of rows with ``created_at >= first-of-month``.
- Ledger: excludes ``deleted_at IS NOT NULL``.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

from sqlalchemy import Text, and_, cast, func, select
from sqlalchemy.orm import Session

from app.db.models import Book, Document, Employee, Leave, LedgerEntry, Violation
from app.schemas.dashboard import (
    DashboardLeaveItem,
    DashboardRecentDocument,
    DashboardRecentLedger,
    DashboardSummary,
    DashboardSyncStatus,
    DashboardTotals,
    DashboardUpcomingLeaveItem,
)
from app.services import email_service
from app.services.ledger_service import DRAFT_TAG

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


def get_summary(
    db: Session, *, today: date | None = None, owner_user_id: int | None = None
) -> DashboardSummary:
    """Compose the dashboard payload.

    Each section runs an independent query; SQLite handles this well at the
    parity-data scale (< 10k employees, < 100k documents) and keeping the
    queries separate makes the test surface small.

    ``owner_user_id`` scopes only the email-sync widget to the signed-in
    user's mailbox/rows; the other sections are install-wide. ``None``
    (legacy/no-user callers) preserves the unscoped behavior.
    """
    if today is None:
        today = date.today()

    return DashboardSummary(
        totals=_compute_totals(db, today=today),
        on_leave_today=_on_leave_today(db, today=today),
        upcoming_leave_ends=_upcoming_leave_ends(db, today=today),
        recent_documents=_recent_documents(db),
        recent_ledger=_recent_ledger(db),
        email_sync=_email_sync(db, today=today, owner_user_id=owner_user_id),
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

    draft_needle = f'%"{DRAFT_TAG}"%'
    draft_count = int(
        db.execute(
            select(func.count()).select_from(LedgerEntry).where(
                and_(
                    LedgerEntry.deleted_at.is_(None),
                    cast(LedgerEntry.tags, Text).like(draft_needle),
                )
            )
        ).scalar_one()
    )

    book_draft_count = int(
        db.execute(
            select(func.count()).select_from(Book).where(
                and_(Book.deleted_at.is_(None), Book.approval_state == "none")
            )
        ).scalar_one()
    )

    return DashboardTotals(
        employees_active=employees_active,
        on_leave_today=on_leave_count,
        present_today=present_today,
        forms_this_month=forms_this_month,
        open_violations_count=open_violations_count,
        draft_count=draft_count,
        book_draft_count=book_draft_count,
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


def _recent_ledger(db: Session) -> list[DashboardRecentLedger]:
    related_emp = Employee.__table__.alias("related_emp")

    stmt = (
        select(
            LedgerEntry.id,
            LedgerEntry.entry_date,
            LedgerEntry.direction,
            LedgerEntry.channel,
            LedgerEntry.counterparty,
            LedgerEntry.subject,
            LedgerEntry.related_employee_id,
            LedgerEntry.created_at,
            related_emp.c.name_en.label("related_employee_name_en"),
            related_emp.c.name_ar.label("related_employee_name_ar"),
        )
        .outerjoin(
            related_emp, related_emp.c.id == LedgerEntry.related_employee_id
        )
        .where(
            LedgerEntry.deleted_at.is_(None),
            cast(LedgerEntry.tags, Text).not_like(f'%"{DRAFT_TAG}"%'),
        )
        .order_by(LedgerEntry.created_at.desc(), LedgerEntry.id.desc())
        .limit(RECENT_LIMIT)
    )

    rows: list[Any] = list(db.execute(stmt).all())
    return [
        DashboardRecentLedger(
            id=r.id,
            entry_date=r.entry_date,
            direction=r.direction,
            channel=r.channel,
            counterparty=r.counterparty,
            subject=r.subject,
            related_employee_id=r.related_employee_id,
            related_employee_name_en=r.related_employee_name_en,
            related_employee_name_ar=r.related_employee_name_ar,
            created_at=r.created_at,
        )
        for r in rows
    ]


# ---------------------------------------------------------------------------
# Email sync status
# ---------------------------------------------------------------------------


def _email_sync(
    db: Session, *, today: date, owner_user_id: int | None = None
) -> DashboardSyncStatus:
    """Compose the email-sync widget payload, scoped to the current user.

    ``account`` is the caller's own mailbox (Phase-1 owner-aware
    ``email_service.get_account``); ``enabled`` requires both: an account row
    exists AND its ``sync_interval_minutes > 0``. ``last_synced_at`` comes
    straight off ``EmailAccount.last_synced_at`` (set by the scheduler / manual
    sync). ``incoming_today`` counts that owner's incoming email entries with
    ``entry_date == today`` (non-deleted), regardless of read-state. ``None``
    owner (legacy/no-user callers) falls back to the lowest-id account and an
    unscoped count.
    """
    account = email_service.get_account(db, owner_user_id)

    incoming_stmt = select(func.count()).select_from(LedgerEntry).where(
        and_(
            LedgerEntry.channel == "email",
            LedgerEntry.direction == "incoming",
            LedgerEntry.entry_date == today,
            LedgerEntry.deleted_at.is_(None),
        )
    )
    if owner_user_id is not None:
        incoming_stmt = incoming_stmt.where(
            LedgerEntry.owner_user_id == owner_user_id
        )
    incoming_today = int(db.execute(incoming_stmt).scalar_one())

    if account is None:
        return DashboardSyncStatus(
            last_synced_at=None,
            enabled=False,
            interval_minutes=0,
            incoming_today=incoming_today,
        )

    return DashboardSyncStatus(
        last_synced_at=account.last_synced_at,
        enabled=bool(account.enabled and account.sync_interval_minutes > 0),
        interval_minutes=account.sync_interval_minutes,
        incoming_today=incoming_today,
    )


__all__ = [
    "RECENT_LIMIT",
    "UPCOMING_WINDOW_DAYS",
    "get_summary",
]
