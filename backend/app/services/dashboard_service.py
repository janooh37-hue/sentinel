"""Dashboard summary service — Phase 12.

Pure read-only aggregation across employees, leaves, documents, and ledger
entries.  No new tables, no caching, no migrations: every call recomputes
from current data.  The ``today`` kwarg is exposed so tests can pin the
date deterministically.

Filters worth flagging:
- Working employees: ``status in WORKING_STATUSES`` (same rule as ``employee_service``).
  Headcount splits them: our staff (Active) vs loaned (Loaned, ملحق). On-site and
  on-leave count our staff only; a loaned employee counts only as loaned.
- Leaves: only ``status == 'Approved'`` count toward on-leave / upcoming;
  ``deleted_at`` is excluded.
- Documents: the table has no ``deleted_at`` column, so ``forms_this_month``
  is an unfiltered count of rows with ``created_at >= first-of-month``.
- Ledger: excludes ``deleted_at IS NOT NULL``.
"""

from __future__ import annotations

from calendar import monthrange
from datetime import date, datetime, timedelta

from pydantic import ValidationError
from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session

from app.db.models import (
    Book,
    Document,
    Employee,
    Leave,
    LedgerEntry,
    User,
    UserDashboardLayout,
    Violation,
)
from app.schemas.dashboard import (
    DASHBOARD_QUICK_ACTION_IDS,
    DASHBOARD_WIDGET_IDS,
    DashboardApprovedRecord,
    DashboardLayout,
    DashboardLeaveItem,
    DashboardMyRecords,
    DashboardOpenViolation,
    DashboardOpenViolations,
    DashboardSummary,
    DashboardSyncStatus,
    DashboardTotals,
    DashboardUnreadMail,
    DashboardUnreadMailItem,
    DashboardUpcomingLeaveItem,
)
from app.schemas.employee import EMPLOYEE_STATUS_ACTIVE, EMPLOYEE_STATUS_LOANED, WORKING_STATUSES
from app.services import book_service, email_service, ledger_service, perm_service

# How many "recent" rows to surface per stream.
RECENT_LIMIT = 5

# Upcoming window includes today and today+N.
UPCOMING_WINDOW_DAYS = 7

# Only Approved leaves are considered real absences.
_APPROVED_STATUS = "Approved"
_VALID_QUICK_ACTION_IDS = frozenset(DASHBOARD_QUICK_ACTION_IDS)
_VALID_WIDGET_IDS = frozenset(DASHBOARD_WIDGET_IDS)


def get_user_layout(db: Session, user_id: int) -> DashboardLayout | None:
    """Return one user's saved layout, tolerating absent or stale stored JSON."""
    row = db.get(UserDashboardLayout, user_id)
    if row is None:
        return None
    raw = row.layout
    quick_actions = raw.get("quick_actions") if isinstance(raw, dict) else None
    if isinstance(raw, dict) and isinstance(quick_actions, list):
        raw = {
            **raw,
            "quick_actions": [
                action
                for action in quick_actions
                if isinstance(action, dict) and action.get("id") in _VALID_QUICK_ACTION_IDS
            ],
        }
    widgets = raw.get("widgets") if isinstance(raw, dict) else None
    if isinstance(raw, dict) and isinstance(widgets, list):
        raw = {
            **raw,
            "widgets": [
                widget
                for widget in widgets
                if isinstance(widget, dict) and widget.get("id") in _VALID_WIDGET_IDS
            ],
        }
    try:
        return DashboardLayout.model_validate(raw)
    except ValidationError:
        return None


def set_user_layout(
    db: Session,
    user_id: int,
    layout: DashboardLayout,
) -> DashboardLayout:
    """Persist a complete private layout for one user."""
    payload = layout.model_dump(mode="json", exclude={"widgets": {"__all__": {"zone"}}})
    row = db.get(UserDashboardLayout, user_id)
    if row is None:
        db.add(UserDashboardLayout(user_id=user_id, layout=payload))
    else:
        row.layout = payload
    db.commit()
    return DashboardLayout.model_validate(payload)


def _first_of_month(today: date) -> datetime:
    """First instant of the month containing ``today`` (naive UTC)."""
    return datetime(today.year, today.month, 1)


def get_summary(
    db: Session,
    *,
    user: User | None = None,
    today: date | None = None,
    owner_user_id: int | None = None,
) -> DashboardSummary:
    """Compose the dashboard payload.

    Each section runs an independent query; SQLite handles this well at the
    parity-data scale (< 10k employees, < 100k documents) and keeping the
    queries separate makes the test surface small.

    New sections require the source-page capability; mail is always caller-owned.
    The month is chosen in the organization timezone, while its date boundaries
    use the Records page's UTC creation-day semantics, including voided rows.
    """
    if today is None:
        today = datetime.now(book_service._ORGANIZATION_TIMEZONE).date()
    can_view_leaves = user is not None and perm_service.has_capability(db, user, "leaves.view")
    if user is not None:
        owner_user_id = user.id

    return DashboardSummary(
        totals=_compute_totals(db, today=today, user=user),
        on_leave_today=_on_leave_today(db, today=today) if can_view_leaves else [],
        upcoming_leave_ends=_upcoming_leave_ends(db, today=today) if can_view_leaves else [],
        my_records=_my_records(db, user=user, today=today)
        if user is not None and perm_service.has_capability(db, user, "books.view")
        else None,
        unread_mail=_unread_mail(db, user=user)
        if user is not None and perm_service.has_capability(db, user, "ledger.view")
        else None,
        open_violations=_open_violations(db)
        if user is not None and perm_service.has_capability(db, user, "violations.view")
        else None,
        email_sync=_email_sync(db, today=today, owner_user_id=owner_user_id),
    )


# ---------------------------------------------------------------------------
# Totals
# ---------------------------------------------------------------------------


def _compute_totals(db: Session, *, today: date, user: User | None = None) -> DashboardTotals:
    by_status: dict[str, int] = {
        status: count
        for status, count in db.execute(
            select(Employee.status, func.count())
            .where(Employee.status.in_(WORKING_STATUSES))
            .group_by(Employee.status)
        ).tuples()
    }
    our_staff = by_status.get(EMPLOYEE_STATUS_ACTIVE, 0)
    loaned = by_status.get(EMPLOYEE_STATUS_LOANED, 0)

    on_leave_count = int(
        db.execute(
            select(func.count(func.distinct(Leave.employee_id)))
            .select_from(Leave)
            .join(Employee, Employee.id == Leave.employee_id)
            .where(
                and_(
                    Employee.status == EMPLOYEE_STATUS_ACTIVE,
                    Leave.deleted_at.is_(None),
                    Leave.status == _APPROVED_STATUS,
                    Leave.start_date <= today,
                    Leave.end_date >= today,
                )
            )
        ).scalar_one()
    )

    present_today = max(our_staff - on_leave_count, 0)

    forms_stmt = (
        select(func.count())
        .select_from(Document)
        .where(
            Document.created_at >= _first_of_month(today),
            Document.ref_number != "DRAFT",
        )
    )
    if user is not None:
        document_visibility = book_service.document_visibility_clause(db, user)
        if document_visibility is not None:
            forms_stmt = forms_stmt.where(document_visibility)
    forms_this_month = int(db.execute(forms_stmt).scalar_one())

    open_violations_count = int(
        db.execute(
            select(func.count()).select_from(Violation).where(Violation.status == "Open")
        ).scalar_one()
    )

    book_draft_stmt = (
        select(func.count())
        .select_from(Book)
        .where(and_(Book.deleted_at.is_(None), Book.approval_state == "none"))
    )
    if user is not None:
        visibility = book_service.user_visibility_clause(db, user)
        if visibility is not None:
            book_draft_stmt = book_draft_stmt.where(visibility)
    book_draft_count = int(db.execute(book_draft_stmt).scalar_one())

    return DashboardTotals(
        employees_active=our_staff + loaned,
        our_staff=our_staff,
        loaned=loaned,
        on_leave_today=on_leave_count,
        present_today=present_today,
        forms_this_month=forms_this_month,
        open_violations_count=open_violations_count,
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


def _upcoming_leave_ends(db: Session, *, today: date) -> list[DashboardUpcomingLeaveItem]:
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
            Leave.end_date >= today,
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


def _my_records(db: Session, *, user: User, today: date) -> DashboardMyRecords:
    start = today.replace(day=1)
    end = today.replace(day=monthrange(today.year, today.month)[1])
    # Records compares created_at's calendar day (not approval/signed dates).
    base = select(Book).where(Book.deleted_at.is_(None), Book.created_by_user_id == user.id)
    visibility = book_service.user_visibility_clause(db, user)
    if visibility is not None:
        base = base.where(visibility)
    month = base.where(
        Book.created_at >= datetime.combine(start, datetime.min.time()),
        Book.created_at < datetime.combine(end + timedelta(days=1), datetime.min.time()),
    )
    counts = {
        state: count
        for state, count in db.execute(
            month.with_only_columns(Book.approval_state, func.count()).group_by(Book.approval_state)
        ).tuples()
    }
    drafts = (
        db.scalar(
            base.with_only_columns(func.count()).where(
                Book.voided_at.is_(None), ~Book.versions.any()
            )
        )
        or 0
    )
    latest = db.execute(
        month.with_only_columns(
            Book.id.label("book_id"),
            Book.ref_number,
            Book.subject,
            Book.employee_id,
            Employee.name_en.label("employee_name_en"),
            Employee.name_ar.label("employee_name_ar"),
            Book.created_at,
        )
        .outerjoin(Employee, Employee.id == Book.employee_id)
        .where(Book.approval_state == "approved")
        .order_by(Book.created_at.desc(), Book.id.desc())
        .limit(RECENT_LIMIT)
    ).mappings()
    return DashboardMyRecords(
        month=start.strftime("%Y-%m"),
        from_date=start,
        to_date=end,
        approved=counts.get("approved", 0),
        pending=counts.get("pending", 0),
        awaiting_scan=counts.get("awaiting_scan", 0),
        returned=counts.get("returned", 0),
        rejected=counts.get("rejected", 0),
        not_submitted=counts.get("none", 0),
        drafts=drafts,
        latest_approved=[DashboardApprovedRecord.model_validate(row) for row in latest],
    )


def _unread_mail(db: Session, *, user: User) -> DashboardUnreadMail:
    latest = db.scalars(
        select(LedgerEntry)
        .where(ledger_service.unread_email_clause(user.id))
        .order_by(LedgerEntry.created_at.desc(), LedgerEntry.id.desc())
        .limit(RECENT_LIMIT)
    )
    return DashboardUnreadMail(
        count=ledger_service.unread_email_count(db, user.id),
        latest=[DashboardUnreadMailItem.model_validate(row) for row in latest],
    )


def _open_violations(db: Session) -> DashboardOpenViolations:
    rows = db.execute(
        select(
            Violation.id,
            Violation.employee_id,
            Employee.name_en.label("employee_name_en"),
            Employee.name_ar.label("employee_name_ar"),
            Violation.violation_type.label("title"),
            Violation.date,
        )
        .join(Employee, Employee.id == Violation.employee_id)
        .where(Violation.status == "Open")
        .order_by(Violation.date.desc(), Violation.id.desc())
        .limit(RECENT_LIMIT)
    ).mappings()
    count = (
        db.scalar(select(func.count()).select_from(Violation).where(Violation.status == "Open"))
        or 0
    )
    return DashboardOpenViolations(
        count=count,
        latest=[DashboardOpenViolation.model_validate(row) for row in rows],
    )


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

    incoming_stmt = (
        select(func.count())
        .select_from(LedgerEntry)
        .where(
            and_(
                LedgerEntry.channel == "email",
                LedgerEntry.direction == "incoming",
                LedgerEntry.entry_date == today,
                LedgerEntry.deleted_at.is_(None),
            )
        )
    )
    if owner_user_id is not None:
        incoming_stmt = incoming_stmt.where(LedgerEntry.owner_user_id == owner_user_id)
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
