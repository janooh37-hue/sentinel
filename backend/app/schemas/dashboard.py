"""Dashboard summary schemas — Phase 12.

Aggregate read-only response for ``GET /api/v1/dashboard/summary``.  The
backend composes the values from existing tables (employees, leaves,
documents, ledger_entries) so there's nothing to write — only ``Read``
shapes here.
"""

from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel


class DashboardTotals(BaseModel):
    employees_active: int
    on_leave_today: int
    present_today: int
    forms_this_month: int
    open_violations_count: int = 0
    draft_count: int = 0
    book_draft_count: int = 0


class DashboardLeaveItem(BaseModel):
    employee_id: str
    employee_name_en: str
    employee_name_ar: str | None
    leave_id: int
    leave_type: str
    start_date: date
    end_date: date


class DashboardUpcomingLeaveItem(DashboardLeaveItem):
    days_remaining: int


class DashboardRecentDocument(BaseModel):
    id: int
    # Nullable: admin-category docs (e.g. General Book) have no employee.
    employee_id: str | None
    employee_name_en: str
    employee_name_ar: str | None
    template_id: str
    ref_number: str | None
    role: str | None
    created_at: datetime


class DashboardRecentLedger(BaseModel):
    id: int
    entry_date: date
    direction: str
    channel: str
    counterparty: str
    subject: str
    related_employee_id: str | None
    related_employee_name_en: str | None
    related_employee_name_ar: str | None
    created_at: datetime


class DashboardSyncStatus(BaseModel):
    """Email-sync widget payload (Phase 18).

    ``enabled`` requires both: an EmailAccount row exists AND its
    ``sync_interval_minutes > 0``. ``last_synced_at`` is sourced from
    ``EmailAccount.last_synced_at`` (populated by the scheduler / manual sync).
    """

    last_synced_at: datetime | None
    enabled: bool
    interval_minutes: int
    incoming_today: int


class DashboardSummary(BaseModel):
    totals: DashboardTotals
    on_leave_today: list[DashboardLeaveItem]
    upcoming_leave_ends: list[DashboardUpcomingLeaveItem]
    recent_documents: list[DashboardRecentDocument]
    recent_ledger: list[DashboardRecentLedger]
    email_sync: DashboardSyncStatus


__all__ = [
    "DashboardLeaveItem",
    "DashboardRecentDocument",
    "DashboardRecentLedger",
    "DashboardSummary",
    "DashboardSyncStatus",
    "DashboardTotals",
    "DashboardUpcomingLeaveItem",
]
