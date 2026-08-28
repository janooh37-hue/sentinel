"""Dashboard summary and private layout schemas."""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas._base import ORMBase

# Known widget / quick-action ids. Add to these lists when the Dashboard
# component grows a new tile so the API validates instead of silently storing
# stale ids. Frontend mirrors these in `lib/dashboardLayout.ts`.
#
# Widget IDs:
#   - Top row (fixed, always visible): pending, workspace
#   - Original bottom row: violations, drafts, ledger
#   - Promoted section cards: on_leave_today, upcoming_leave
#   - New widgets:           recent_docs, email_sync_status,
#                            waiting_approvals, expiring_soon, recent_ledger,
#                            pending_departures
#
# Quick-action IDs are services only: one entry per selectable ``template_id``
# from `app.core.constants.TEMPLATE_FILES`, so every tile deep-links into a
# pre-selected form. The section shortcuts (hr/violations/leaves/books) were
# dropped — the nav owns wayfinding — and the tolerant read path prunes them
# from layouts saved before the removal.
DASHBOARD_WIDGET_IDS = (
    "pending",
    "workspace",
    "violations",
    "drafts",
    "ledger",
    "on_leave_today",
    "upcoming_leave",
    "recent_docs",
    "email_sync_status",
    "waiting_approvals",
    "expiring_soon",
    "recent_ledger",
    "pending_departures",
    "workforce_pulse",
)
DASHBOARD_QUICK_ACTION_IDS = (
    "General Book",
    "Acknowledgment Form",
    "Salary Transfer Request",
    "Leave Permit Form",
    "Violation Form",
    "Leave Application Form",
    "Duty Resumption Form",
    "HR Request Form",
    "Salary Deduction Form",
    "Employee Clearance Form",
    "Passport Release Form",
    "Material Request Form",
    "Resignation Letter",
    "Administrative Leave Form",
    "Warning Form",
    "Passport Release List",
    "Report",
    "Inmate Conduct Violations",
)

DashboardWidgetId = Literal[
    "pending",
    "workspace",
    "violations",
    "drafts",
    "ledger",
    "on_leave_today",
    "upcoming_leave",
    "recent_docs",
    "email_sync_status",
    "waiting_approvals",
    "expiring_soon",
    "recent_ledger",
    "pending_departures",
    "workforce_pulse",
]
DashboardQuickActionId = Literal[
    "General Book",
    "Acknowledgment Form",
    "Salary Transfer Request",
    "Leave Permit Form",
    "Violation Form",
    "Leave Application Form",
    "Duty Resumption Form",
    "HR Request Form",
    "Salary Deduction Form",
    "Employee Clearance Form",
    "Passport Release Form",
    "Material Request Form",
    "Resignation Letter",
    "Administrative Leave Form",
    "Warning Form",
    "Passport Release List",
    "Report",
    "Inmate Conduct Violations",
]


DashboardWidgetZone = Literal["top", "under_workspace", "under_quick_actions"]
#: Dashboard canvas measure. ``compact`` keeps the 1180px column the rest of
#: the app uses; ``wide`` lets the grid span the window. Compact is the
#: default because it is what operators are used to, and a layout saved before
#: this field existed must not silently change width on the next load.
DashboardCanvasWidth = Literal["compact", "wide"]


class DashboardWidgetConfig(BaseModel):
    id: DashboardWidgetId
    visible: bool = True
    order: int
    zone: DashboardWidgetZone = "under_workspace"


class DashboardQuickActionConfig(BaseModel):
    id: DashboardQuickActionId
    visible: bool = True
    order: int


class DashboardLayout(BaseModel):
    widgets: list[DashboardWidgetConfig] = Field(default_factory=list)
    quick_actions: list[DashboardQuickActionConfig] = Field(default_factory=list)
    canvas_width: DashboardCanvasWidth = "compact"


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


class DashboardRecentDocument(ORMBase):
    id: int
    # Nullable: admin-category docs (e.g. General Book) have no employee.
    employee_id: str | None
    employee_name_en: str
    employee_name_ar: str | None
    template_id: str
    ref_number: str | None
    role: str | None
    created_at: datetime


class DashboardRecentLedger(ORMBase):
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


class DashboardSyncStatus(ORMBase):
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
    "DASHBOARD_QUICK_ACTION_IDS",
    "DASHBOARD_WIDGET_IDS",
    "DashboardCanvasWidth",
    "DashboardLayout",
    "DashboardLeaveItem",
    "DashboardQuickActionConfig",
    "DashboardQuickActionId",
    "DashboardRecentDocument",
    "DashboardRecentLedger",
    "DashboardSummary",
    "DashboardSyncStatus",
    "DashboardTotals",
    "DashboardUpcomingLeaveItem",
    "DashboardWidgetConfig",
    "DashboardWidgetId",
    "DashboardWidgetZone",
]
