"""Dashboard summary schemas — Phase 12.

Aggregate read-only response for ``GET /api/v1/dashboard/summary``.  The
backend composes the values from existing tables (employees, leaves,
documents, ledger_entries) so there's nothing to write — only ``Read``
shapes here.
"""

from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel

from app.schemas._base import ORMBase


class DashboardTotals(BaseModel):
    employees_active: int
    on_leave_today: int
    present_today: int
    forms_this_month: int
    open_violations_count: int = 0


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






class DashboardSummary(BaseModel):
    totals: DashboardTotals
    on_leave_today: list[DashboardLeaveItem]
    upcoming_leave_ends: list[DashboardUpcomingLeaveItem]
    recent_documents: list[DashboardRecentDocument]


__all__ = [
    "DashboardLeaveItem",
    "DashboardRecentDocument",
    "DashboardTotals",
    "DashboardUpcomingLeaveItem",
]
