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


class AppSettingsRead(BaseModel):
    stamp_style: str
    default_manager_id: int | None
    manager_hand_sign_default: bool
    theme: Literal["light", "dark"]
    language: Literal["en", "ar"]
    font_scale: int = Field(
        ge=16, le=24
    )  # was Literal["sm","md","lg"] before Phase 17; widened to 16..24 in Phase 18 (client snaps to discrete stops)
    # Legacy signature slots — preserved verbatim; consumed by doc gen pipeline.
    sig_personnel_path: str | None
    sig_admin_path: str | None
    legacy_signature_path: str | None
    # Read-only — toggled via POST /system/admin-key, not via PATCH /settings.
    admin_gate_enabled: bool
    # Observability opt-in (off by default; actual SDK integration is Phase 10+).
    sentry_opt_in: bool
    # Master on/off switch for SMS auto-send (on by default).
    sms_autosend_enabled: bool
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
    font_scale: int | None = Field(
        default=None, ge=16, le=24
    )  # was Literal["sm","md","lg"] before Phase 17; widened to 16..24 in Phase 18 (client snaps to discrete stops)
    sig_personnel_path: str | None = None
    sig_admin_path: str | None = None
    legacy_signature_path: str | None = None
    sentry_opt_in: bool | None = None
    sms_autosend_enabled: bool | None = None
    email_signature: str | None = None
    signature_size_mm: int | None = None
    signature_boldness: int | None = None
    dashboard_layout: DashboardLayout | None = None
