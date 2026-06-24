"""Typed settings schemas — wraps the app_settings key-value table."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

# Known widget / quick-action ids. Add to these lists when the Dashboard
# component grows a new tile so the API validates instead of silently storing
# stale ids. Frontend mirrors these in `lib/dashboardLayout.ts`.
#
# Widget IDs:
#   - Top row (fixed, always visible): pending, workspace
#   - Original bottom row: violations, drafts, ledger
#   - Promoted section cards: on_leave_today, upcoming_leave
#   - New widgets:           recent_docs, email_sync_status,
#                            waiting_approvals, expiring_soon, recent_ledger
#
# Quick-action IDs combine the original 4 service tiles with every template_id
# from `app.core.constants.TEMPLATE_FILES` so an operator can pin a specific
# template to the dashboard quick-launcher.
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
)
DASHBOARD_QUICK_ACTION_IDS = (
    "hr",
    "violations",
    "leaves",
    "books",
    "Acknowledgment Form",
    "Salary Transfer Request",
    "Salary Deduction Form",
    "Violation Form",
    "Employee Clearance Form",
    "Leave Application Form",
    "Passport Release Form",
    "Duty Resumption Form",
    "Material Request Form",
    "General Book",
    "HR Request Form",
    "Resignation Declaration",
    "Resignation Letter",
    "Leave Undertaking",
    "Leave Permit Form",
    "Administrative Leave Form",
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
]
DashboardQuickActionId = Literal[
    "hr",
    "violations",
    "leaves",
    "books",
    "Acknowledgment Form",
    "Salary Transfer Request",
    "Salary Deduction Form",
    "Violation Form",
    "Employee Clearance Form",
    "Leave Application Form",
    "Passport Release Form",
    "Duty Resumption Form",
    "Material Request Form",
    "General Book",
    "HR Request Form",
    "Resignation Declaration",
    "Resignation Letter",
    "Leave Undertaking",
    "Leave Permit Form",
    "Administrative Leave Form",
]


DashboardWidgetZone = Literal["top", "under_workspace", "under_quick_actions"]


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


class AppSettingsRead(BaseModel):
    stamp_style: str
    default_manager_id: int | None
    manager_hand_sign_default: bool
    theme: Literal["light", "dark"]
    language: Literal["en", "ar"]
    font_scale: int = Field(ge=16, le=24)  # was Literal["sm","md","lg"] before Phase 17; widened to 16..24 in Phase 18 (client snaps to discrete stops)
    # Legacy signature slots — preserved verbatim; consumed by doc gen pipeline.
    sig_personnel_path: str | None
    sig_admin_path: str | None
    legacy_signature_path: str | None
    # Read-only — toggled via POST /system/admin-key, not via PATCH /settings.
    admin_gate_enabled: bool
    # Observability opt-in (off by default; actual SDK integration is Phase 10+).
    sentry_opt_in: bool
    # HTML signature appended to outgoing email when use_signature=True.
    email_signature: str
    # Global signature appearance (key-value; no migration). Boldness 0..3.
    signature_size_mm: int
    signature_boldness: int
    # Operator-specified dashboard widget/quick-action visibility + ordering.
    # ``None`` means "use frontend defaults".
    dashboard_layout: DashboardLayout | None = None


class AppSettingsUpdate(BaseModel):
    """PATCH semantics — every field is optional."""

    stamp_style: str | None = None
    default_manager_id: int | None = None
    manager_hand_sign_default: bool | None = None
    theme: Literal["light", "dark"] | None = None
    language: Literal["en", "ar"] | None = None
    font_scale: int | None = Field(default=None, ge=16, le=24)  # was Literal["sm","md","lg"] before Phase 17; widened to 16..24 in Phase 18 (client snaps to discrete stops)
    sig_personnel_path: str | None = None
    sig_admin_path: str | None = None
    legacy_signature_path: str | None = None
    sentry_opt_in: bool | None = None
    email_signature: str | None = None
    signature_size_mm: int | None = None
    signature_boldness: int | None = None
    dashboard_layout: DashboardLayout | None = None
