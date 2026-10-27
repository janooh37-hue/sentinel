"""Dashboard summary and private layout schemas."""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator

from app.schemas._base import ORMBase

# Stable widget and service ids, mirrored in frontend/lib/dashboardLayout.ts.
DASHBOARD_WIDGET_IDS = (
    "pending",
    "workspace",
    "violations",
    "drafts",
    "ledger",
    "on_leave_today",
    "upcoming_leave",
    "quick_actions",
    "waiting_approvals",
    "sent_approvals",
    "expiring_soon",
    "pending_departures",
    "workforce_pulse",
    "violation_months",
    "inbox",
    "permits",
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
    "quick_actions",
    "waiting_approvals",
    "sent_approvals",
    "expiring_soon",
    "pending_departures",
    "workforce_pulse",
    "violation_months",
    "inbox",
    "permits",
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
    size: Literal["S", "M", "L", "W", "XL"] = "S"
    zone: DashboardWidgetZone | None = None

    @model_validator(mode="before")
    @classmethod
    def migrate_legacy_size(cls, value: object) -> object:
        if isinstance(value, dict) and "size" not in value:
            widget_id = value.get("id")
            if widget_id == "quick_actions":
                size = "W"
            elif value.get("zone") == "top" or (
                "zone" not in value and widget_id in {"pending", "workspace"}
            ):
                size = "M"
            elif widget_id == "permits":
                size = "XL"
            elif widget_id in {
                "waiting_approvals",
                "expiring_soon",
                "on_leave_today",
                "upcoming_leave",
                "pending_departures",
                "workforce_pulse",
                "violation_months",
            }:
                size = "L"
            else:
                size = "S"
            zone = value.get("zone") or (
                "top" if widget_id in {"pending", "workspace"} else "under_workspace"
            )
            return {**value, "size": size, "zone": zone}
        return value


class DashboardQuickActionConfig(BaseModel):
    id: DashboardQuickActionId
    visible: bool = True
    order: int


class DashboardLayout(BaseModel):
    widgets: list[DashboardWidgetConfig] = Field(default_factory=list)
    quick_actions: list[DashboardQuickActionConfig] = Field(default_factory=list)
    canvas_width: DashboardCanvasWidth = "compact"

    @model_validator(mode="after")
    def reject_duplicate_widgets(self) -> DashboardLayout:
        if len({widget.id for widget in self.widgets}) != len(self.widgets):
            raise ValueError("Duplicate dashboard widget ids")
        return self


class DashboardTotals(BaseModel):
    # Total working (our staff + loaned). on_leave_today / present_today are our staff only.
    employees_active: int | None
    our_staff: int | None
    loaned: int | None
    on_leave_today: int | None
    present_today: int | None
    forms_this_month: int
    open_violations_count: int | None
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


class DashboardApprovedRecord(ORMBase):
    book_id: int
    ref_number: str
    subject: str | None
    employee_id: str | None
    employee_name_en: str | None
    employee_name_ar: str | None
    created_at: datetime


class DashboardMyRecords(BaseModel):
    """Caller-owned records by creation day, matching the Records page filters."""

    month: str
    from_date: date
    to_date: date
    approved: int
    pending: int
    awaiting_scan: int
    returned: int
    rejected: int
    not_submitted: int
    drafts: int
    latest_approved: list[DashboardApprovedRecord]


class DashboardUnreadMailItem(ORMBase):
    id: int
    subject: str
    counterparty: str
    entry_date: date
    created_at: datetime


class DashboardUnreadMail(BaseModel):
    count: int
    latest: list[DashboardUnreadMailItem]


class DashboardOpenViolation(BaseModel):
    id: int
    employee_id: str
    employee_name_en: str
    employee_name_ar: str | None
    title: str
    date: date


class DashboardOpenViolations(BaseModel):
    count: int
    latest: list[DashboardOpenViolation]


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
    my_records: DashboardMyRecords | None
    unread_mail: DashboardUnreadMail | None
    open_violations: DashboardOpenViolations | None
    email_sync: DashboardSyncStatus


__all__ = [
    "DASHBOARD_QUICK_ACTION_IDS",
    "DASHBOARD_WIDGET_IDS",
    "DashboardApprovedRecord",
    "DashboardCanvasWidth",
    "DashboardLayout",
    "DashboardLeaveItem",
    "DashboardMyRecords",
    "DashboardOpenViolation",
    "DashboardOpenViolations",
    "DashboardQuickActionConfig",
    "DashboardQuickActionId",
    "DashboardSummary",
    "DashboardSyncStatus",
    "DashboardTotals",
    "DashboardUnreadMail",
    "DashboardUnreadMailItem",
    "DashboardUpcomingLeaveItem",
    "DashboardWidgetConfig",
    "DashboardWidgetId",
    "DashboardWidgetZone",
]
