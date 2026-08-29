"""Typed, non-secret operational configuration for the workforce domain."""

from __future__ import annotations

from datetime import UTC, date, datetime, time, timedelta
from typing import Annotated, Literal, TypeVar

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    StrictBool,
    field_validator,
    model_validator,
)

from app.schemas._base import ORMBase

# The leave lifecycle recognizes these configured kinds.  Values are persisted
# in this canonical form so evaluation code never needs to interpret UI labels
# or legacy bilingual leave-type strings.
EXCUSING_RECORD_KINDS = frozenset(
    {
        "annual",
        "sick",
        "national_service",
        "administrative_leave",
        "leave_permit",
    }
)

_RECORD_KIND_ALIASES = {
    "annual": "annual",
    "annual_leave": "annual",
    "sick": "sick",
    "sick_leave": "sick",
    "national_service": "national_service",
    "administrative_leave": "administrative_leave",
    "leave_permit": "leave_permit",
}

# Pydantic supplies a clear validation error for timezone-naive values before
# the cross-field ordering checks compare their timestamps.
UtcDateTime = Annotated[AwareDatetime, Field(description="Timezone-aware timestamp normalized to UTC.")]


class WorkforceConfiguration(BaseModel):
    """Validated configuration persisted exclusively under ``workforce.*`` keys.

    This deliberately contains operational values only.  Provider URLs,
    credentials, TLS configuration, and adapter-specific controls are supplied
    by the environment and cannot be represented by this API/storage contract.
    """

    model_config = ConfigDict(extra="forbid")

    integration_enabled: StrictBool
    sync_interval_minutes: int = Field(strict=True, ge=1, le=1_440)
    stale_after_minutes: int = Field(strict=True, ge=1, le=10_080)
    initial_backfill_start_at: UtcDateTime
    evaluation_start_at: UtcDateTime
    nationality_fold_min_count: int = Field(strict=True, ge=1, le=100_000)
    excusing_record_kinds: list[str] = Field(default_factory=list, max_length=len(EXCUSING_RECORD_KINDS))
    provider_person_retention_days: int = Field(strict=True, ge=1, le=36_500)
    punch_retention_days: int = Field(strict=True, ge=1, le=36_500)
    attendance_retention_days: int = Field(strict=True, ge=1, le=36_500)
    duty_event_retention_days: int = Field(strict=True, ge=1, le=36_500)
    audit_retention_days: int = Field(strict=True, ge=1, le=36_500)
    duty_assignment_baseline_at: UtcDateTime | None = None

    @field_validator("excusing_record_kinds", mode="before")
    @classmethod
    def normalize_excusing_record_kinds(cls, value: object) -> list[str]:
        """Canonicalize, de-duplicate, and reject unsupported leave kinds."""
        if not isinstance(value, list):
            raise ValueError("excusing_record_kinds must be a list")

        normalized: set[str] = set()
        for raw_kind in value:
            if not isinstance(raw_kind, str):
                raise ValueError("excusing_record_kinds entries must be strings")
            token = "_".join(raw_kind.strip().lower().replace("-", " ").split())
            canonical = _RECORD_KIND_ALIASES.get(token)
            if canonical is None:
                raise ValueError(f"Unsupported excusing record kind: {raw_kind!r}")
            normalized.add(canonical)
        return sorted(normalized)

    @field_validator(
        "initial_backfill_start_at",
        "evaluation_start_at",
        "duty_assignment_baseline_at",
    )
    @classmethod
    def normalize_datetime_to_utc(cls, value: datetime | None) -> datetime | None:
        """Persist a single timestamp representation irrespective of API offset."""
        return value.astimezone(UTC) if value is not None else None

    @model_validator(mode="after")
    def validate_operational_ordering(self) -> WorkforceConfiguration:
        """Preserve source/audit evidence for each retained attendance decision."""
        if self.initial_backfill_start_at > self.evaluation_start_at:
            raise ValueError("initial_backfill_start_at must be at or before evaluation_start_at")
        if (
            self.duty_assignment_baseline_at is not None
            and self.evaluation_start_at < self.duty_assignment_baseline_at
        ):
            raise ValueError(
                "evaluation_start_at must be at or after duty_assignment_baseline_at"
            )
        if self.provider_person_retention_days < self.punch_retention_days:
            raise ValueError(
                "provider_person_retention_days must be at least punch_retention_days"
            )
        if self.punch_retention_days < self.attendance_retention_days:
            raise ValueError("punch_retention_days must be at least attendance_retention_days")
        if self.duty_event_retention_days < self.attendance_retention_days:
            raise ValueError(
                "duty_event_retention_days must be at least attendance_retention_days"
            )
        if self.audit_retention_days < self.attendance_retention_days:
            raise ValueError("audit_retention_days must be at least attendance_retention_days")
        return self



ScopeKind = Literal["organization", "department", "duty_unit", "duty_post"]
AssignmentKind = Literal["work", "off"]
PresenceState = Literal[
    "scheduled",
    "on_duty",
    "completed",
    "absent",
    "excused_leave",
    "off",
    "unknown",
]
MappingState = Literal["unmapped", "verified", "conflict", "ignored"]
T = TypeVar("T")


class CursorPage[T](BaseModel):
    """A bounded, endpoint-bound cursor page."""

    model_config = ConfigDict(extra="forbid")

    items: list[T]
    next_cursor: str | None = None


class WorkforceScopeRead(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)

    scope_kind: ScopeKind
    department: str | None = None
    duty_unit: str | None = None
    duty_post: str | None = None


class WorkforceScopeWrite(WorkforceScopeRead):
    """One normalized hierarchy grant; the router rejects duplicate grants.

    ``department`` is optional on a unit or post grant because this roster is
    placed by duty unit and only part of it records a department.
    """

    @model_validator(mode="after")
    def validate_hierarchy(self) -> WorkforceScopeWrite:
        values = (self.department, self.duty_unit, self.duty_post)
        normalized = tuple(value.strip() if isinstance(value, str) else None for value in values)
        self.department, self.duty_unit, self.duty_post = normalized
        # "value" is required, "optional" may be absent, None must be absent.
        required = {
            "organization": (None, None, None),
            "department": ("value", None, None),
            "duty_unit": ("optional", "value", None),
            "duty_post": ("optional", "value", "value"),
        }[self.scope_kind]
        for actual, expected in zip(normalized, required, strict=True):
            if expected == "value" and not actual:
                raise ValueError("scope hierarchy level is required")
            if expected is None and actual is not None:
                raise ValueError("scope hierarchy must be a prefix")
        return self


class WorkforceScopeReplace(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scopes: list[WorkforceScopeWrite] = Field(default_factory=list, max_length=200)


class WorkforceAccessRead(BaseModel):
    model_config = ConfigDict(extra="forbid")

    workforce_access_tier: Literal["none", "self", "scoped", "organization"]
    scopes: list[WorkforceScopeRead]


class HealthStreamRead(ORMBase):
    model_config = ConfigDict(extra="forbid")

    state: Literal["not_configured", "healthy", "stale", "error", "pending"]
    fresh_through: datetime | None = None
    last_success_at: datetime | None = None
    last_error_code: str | None = None


class EvaluationHealthRead(ORMBase):
    model_config = ConfigDict(extra="forbid")

    pending_count: int = Field(ge=0)
    error_count: int = Field(ge=0)
    oldest_pending_at: datetime | None = None


class SelfShiftRead(ORMBase):
    model_config = ConfigDict(extra="forbid")

    employee_id: str
    shift_code: str | None = None
    presence_state: PresenceState | None = None
    reason_code: str | None = None
    scheduled_start_at: datetime | None = None
    scheduled_end_at: datetime | None = None


class CurrentShiftRead(ORMBase):
    model_config = ConfigDict(extra="forbid")

    starts_at: datetime | None = None
    ends_at: datetime | None = None
    scheduled: int = Field(ge=0)
    excused: int = Field(ge=0)
    expected: int | None = Field(default=None, ge=0)
    evaluated_count: int = Field(ge=0)
    pending_or_error_excluded_count: int = Field(ge=0)
    working: int | None = Field(default=None, ge=0)
    verified_roster_gap: int | None = None
    verified_coverage_percent: float | None = Field(default=None, ge=0)
    staffing_status: Literal["adequate", "deficient", "indeterminate"] | None = None


class NextShiftRead(ORMBase):
    model_config = ConfigDict(extra="forbid")

    starts_at: datetime | None = None
    ends_at: datetime | None = None
    shift_code: str | None = None
    shift_name: str | None = None
    crews: list[str] = Field(default_factory=list)
    scheduled: int = Field(ge=0)
    expected: int | None = Field(default=None, ge=0)
    staffing_minimum: int | None = Field(default=None, ge=0)


class LeaveCompositionRead(BaseModel):
    model_config = ConfigDict(extra="forbid")

    annual: int = Field(ge=0)
    sick: int = Field(ge=0)
    national_service: int = Field(ge=0)
    other: int = Field(ge=0)


class WorkforceReadinessRead(BaseModel):
    """Non-identifying setup gates for truthful dashboard state rendering."""

    model_config = ConfigDict(extra="forbid")

    schedules_ready: bool
    policy_ready: bool
    mappings_ready: bool
    integration_ready: bool


class WorkforceSnapshotRead(ORMBase):
    """Fast, privacy-safe workforce dashboard projection."""

    model_config = ConfigDict(extra="forbid")

    as_of: datetime
    operational_date: date
    timezone: str
    # Aggregate-only blocks: omitted entirely (via response_model_exclude_unset)
    # for a self-only caller, who must not receive organization-wide state.
    sync_health: dict[str, HealthStreamRead] | None = None
    evaluation_health: EvaluationHealthRead
    readiness: WorkforceReadinessRead | None = None
    current_shift: CurrentShiftRead
    next_shift: NextShiftRead
    leave_today: LeaveCompositionRead
    mapping_completeness: dict[str, int]
    schedule_completeness: dict[str, int]
    self: SelfShiftRead | None = None
    aggregate: dict[str, int] | None = None


class CoverageRowRead(BaseModel):
    """Aggregate hierarchy row.  Deliberately contains no person identity."""

    model_config = ConfigDict(extra="forbid")

    kind: Literal["department", "duty_unit", "duty_post"]
    department: str | None = None
    duty_unit: str | None = None
    duty_post: str | None = None
    scheduled: int = Field(ge=0)
    excused: int = Field(ge=0)
    expected: int = Field(ge=0)
    evaluated_count: int = Field(ge=0)
    pending_or_error_excluded_count: int = Field(ge=0)
    working: int | None = Field(default=None, ge=0)
    child_count: int = Field(ge=0)


class NationalityDistributionRead(BaseModel):
    model_config = ConfigDict(extra="forbid")

    nationality: str
    count: int = Field(ge=0)


class WorkforceAnalyticsRead(ORMBase):
    model_config = ConfigDict(extra="forbid")

    department_coverage: list[CoverageRowRead]
    shift_roster: list[dict[str, int | str | None]]
    leave_today: LeaveCompositionRead
    leave_trend: list[dict[str, int | str]]
    nationality_distribution: list[NationalityDistributionRead]
    duty_assignment_events: list[dict[str, datetime | int | str | None]]


class RosterRowRead(ORMBase):
    model_config = ConfigDict(extra="forbid")

    employee_id: str
    name_en: str
    name_ar: str | None = None
    department: str | None = None
    duty_unit: str | None = None
    duty_post: str | None = None
    crew_code: str | None = None
    shift_code: str | None = None
    presence_state: PresenceState | None = None
    reason_code: str | None = None
    scheduled_start_at: datetime | None = None
    scheduled_end_at: datetime | None = None


class AttendanceExceptionRead(RosterRowRead):
    case_id: int

    late_minutes: int | None = Field(default=None, ge=0)
    early_exit_minutes: int | None = Field(default=None, ge=0)
    missing_checkout: bool | None = None


class AttendanceDayRowRead(RosterRowRead):
    case_id: int

    """One person's scheduled shift on one operational date, with punch facts.

    ``first_punch_at`` / ``last_punch_at`` are the earliest and latest punches
    inside this case's policy match window. They are timestamps of events, not a
    check-in and a check-out: this provider reports no direction, so a single
    punch yields ``punch_count == 1`` with both bounds equal, and a client must
    present it as "seen at", never as a span.

    ``judgment_due_at`` is when the duty stops running and a lone punch may be
    called unpaired: before that instant one punch is an arrival still waiting for
    its departure, not an exception. ``absence_due_at`` is the earlier boundary,
    twice the grace past the start, after which a case with no punch at all is an
    absence. ``grace_minutes`` is the policy's own grace, published so a client
    names the same arrival late as the evaluator does instead of guessing.
    """

    first_punch_at: datetime | None = None
    last_punch_at: datetime | None = None
    punch_count: int = Field(default=0, ge=0)
    late_minutes: int | None = Field(default=None, ge=0)
    on_leave: bool = False
    judgment_due_at: datetime | None = None
    absence_due_at: datetime | None = None
    grace_minutes: int | None = Field(default=None, ge=0)


class EmployeeAttendancePunchRead(ORMBase):
    """One provider event.

    Inherits ORMBase so `occurred_at` serializes UTC-tagged, like every other
    timestamp in the API (pinned by test_schema_utc_serialization).

    Direction is omitted deliberately: this build reports ``punch_state 255``
    for every row, so a client must not render an in/out pair.
    """

    model_config = ConfigDict(extra="forbid")

    occurred_at: datetime
    device_name: str | None = None


class EmployeeAttendanceDayRead(ORMBase):
    model_config = ConfigDict(extra="forbid")

    operational_date: date
    shift_code: str | None = None
    scheduled_start_at: datetime | None = None
    scheduled_end_at: datetime | None = None
    presence_state: PresenceState | None = None
    reason_code: str | None = None
    late_minutes: int | None = Field(default=None, ge=0)
    punch_count: int = Field(default=0, ge=0)
    #: Same contract as ``AttendanceDayRowRead``: the two judgment boundaries and
    #: the policy grace, so one employee's month is classified by exactly the
    #: rules the register applies to the day.
    absence_due_at: datetime | None = None
    judgment_due_at: datetime | None = None
    grace_minutes: int | None = Field(default=None, ge=0)
    punches: list[EmployeeAttendancePunchRead] = Field(default_factory=list)


class EmployeeAttendanceHabitRead(BaseModel):
    """What this person's own punches say about one shift they work.

    Offsets are signed minutes: arrivals against the shift's start, departures
    against its end, so -20 reads as "twenty minutes early". A
    ``suggested_shift_code`` means the punches fit a different shift than the one
    the roster assigns, which is a rostering question rather than a punch one.
    """

    model_config = ConfigDict(extra="forbid")

    shift_code: str
    sample_days: int
    arrival_typical_offset: int
    departure_typical_offset: int | None = None
    suggested_shift_code: str | None = None


class EmployeeAttendanceRangeRead(BaseModel):
    model_config = ConfigDict(extra="forbid")

    employee_id: str
    from_date: date
    to_date: date
    days: list[EmployeeAttendanceDayRead]
    habits: list[EmployeeAttendanceHabitRead] = Field(default_factory=list)


class EmployeeAttendanceHistoryDayRead(ORMBase):
    """One local calendar day of provider punches, with no verdict attached.

    ``first_seen_at`` and ``last_seen_at`` are sightings, not a check-in pair:
    this build reports no punch direction, and days before the roster existed
    have no shift to judge them against.
    """

    model_config = ConfigDict(extra="forbid")

    operational_date: date
    first_seen_at: datetime
    last_seen_at: datetime
    punch_count: int = Field(ge=1)
    devices: list[str] = Field(default_factory=list)


class EmployeeAttendanceHistoryRead(BaseModel):
    """Provider-held punch history, read on request and never stored here.

    ``linked`` is false when the employee has no verified provider identity, in
    which case there is nothing to ask the provider for. ``truncated`` says the
    bounded read stopped before the range was exhausted.
    """

    model_config = ConfigDict(extra="forbid")

    employee_id: str
    provider_code: str
    external_employee_code: str | None = None
    from_date: date
    to_date: date
    linked: bool
    truncated: bool
    days: list[EmployeeAttendanceHistoryDayRead] = Field(default_factory=list)


class AttendanceAdjustmentWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")

    replacement_presence_state: PresenceState | None
    replacement_first_in_at: UtcDateTime | None
    replacement_latest_in_at: UtcDateTime | None
    replacement_final_out_at: UtcDateTime | None
    replacement_late_minutes: int | None = Field(ge=0)
    replacement_early_exit_minutes: int | None = Field(ge=0)
    replacement_missing_checkout: bool | None
    reason: str = Field(min_length=1, max_length=1024)


class AdjustmentRevokeWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: str = Field(min_length=1, max_length=1024)


class AttendanceCasePunchRead(ORMBase):
    occurred_at: datetime
    device_name: str | None = None


class AttendanceEvaluationRead(ORMBase):
    id: int
    revision: int
    presence_state: PresenceState | None = None
    reason_code: str | None = None
    first_in_at: datetime | None = None
    latest_in_at: datetime | None = None
    final_out_at: datetime | None = None
    late_minutes: int | None = None
    early_exit_minutes: int | None = None
    missing_checkout: bool | None = None
    evaluated_at: datetime


class AttendanceAdjustmentRead(ORMBase):
    id: int
    base_evaluation_id: int
    replacement_presence_state: PresenceState | None = None
    replacement_first_in_at: datetime | None = None
    replacement_latest_in_at: datetime | None = None
    replacement_final_out_at: datetime | None = None
    replacement_late_minutes: int | None = None
    replacement_early_exit_minutes: int | None = None
    replacement_missing_checkout: bool | None = None
    reason: str
    created_at: datetime
    revoked_at: datetime | None = None
    supersedes_adjustment_id: int | None = None


class AttendanceAdjustmentAuditRead(ORMBase):
    adjustment_id: int
    action: Literal["created", "revoked"]
    actor: str | None = None
    occurred_at: datetime
    reason: str


class AttendanceCaseRead(ORMBase):
    model_config = ConfigDict(extra="forbid")

    id: int
    employee_id: str
    name_en: str
    name_ar: str | None = None
    operational_date: date
    scheduled_start_at: datetime
    scheduled_end_at: datetime
    department_snapshot: str | None = None
    duty_unit_snapshot: str | None = None
    duty_post_snapshot: str | None = None
    crew_code_snapshot: str | None = None
    crew_name_snapshot: str | None = None
    shift_code_snapshot: str
    organization_snapshot_state: str
    punches: list[AttendanceCasePunchRead] = Field(default_factory=list)
    effective: dict[str, object] | None = None
    evaluations: list[AttendanceEvaluationRead] = Field(default_factory=list)
    adjustments: list[AttendanceAdjustmentRead] = Field(default_factory=list)
    adjustment_audit: list[AttendanceAdjustmentAuditRead] = Field(default_factory=list)


class DutyAssignmentEventRead(ORMBase):
    model_config = ConfigDict(extra="forbid")

    id: int
    employee_id: str
    event_type: str
    from_department: str | None = None
    from_unit: str | None = None
    from_post: str | None = None
    to_department: str | None = None
    to_unit: str | None = None
    to_post: str | None = None
    effective_at: datetime
    reason: str | None = None


class WorkCrewWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str = Field(min_length=1, max_length=64)
    name_en: str | None = Field(default=None, max_length=256)
    name_ar: str | None = Field(default=None, max_length=256)
    active: bool = True

    @model_validator(mode="after")
    def require_name(self) -> WorkCrewWrite:
        self.code = self.code.strip()
        self.name_en = self.name_en.strip() if self.name_en else None
        self.name_ar = self.name_ar.strip() if self.name_ar else None
        if not self.name_en and not self.name_ar:
            raise ValueError("name_en or name_ar is required")
        return self


class WorkCrewRead(ORMBase, WorkCrewWrite):
    id: int
    version: str
    created_at: datetime
    updated_at: datetime


class WorkCrewPatch(BaseModel):
    """Mutable crew attributes; a referenced crew code is enforced server-side immutable."""

    model_config = ConfigDict(extra="forbid")

    code: str | None = Field(default=None, min_length=1, max_length=64)
    name_en: str | None = Field(default=None, max_length=256)
    name_ar: str | None = Field(default=None, max_length=256)
    active: bool | None = None

    @model_validator(mode="after")
    def normalize_values(self) -> WorkCrewPatch:
        if not self.model_fields_set:
            raise ValueError("at least one crew field is required")
        if "code" in self.model_fields_set and self.code is None:
            raise ValueError("code cannot be null")
        if "active" in self.model_fields_set and self.active is None:
            raise ValueError("active cannot be null")
        if self.code is not None:
            self.code = self.code.strip()
        if self.name_en is not None:
            self.name_en = self.name_en.strip() or None
        if self.name_ar is not None:
            self.name_ar = self.name_ar.strip() or None
        return self


class WorkforceShiftDefinitionRead(ORMBase):
    model_config = ConfigDict(extra="forbid", from_attributes=True)

    id: int
    code: str
    start_local_time: time
    duration_minutes: int = Field(gt=0)
    created_at: datetime
    updated_at: datetime


class WorkforceRotationStepRead(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)

    id: int
    pattern_id: int
    shift_definition_id: int
    start_offset_minutes: int = Field(ge=0)


class WorkforceRotationRead(ORMBase):
    model_config = ConfigDict(extra="forbid", from_attributes=True)

    id: int
    code: str
    name: str
    cycle_minutes: int = Field(gt=0)
    timezone: str
    created_at: datetime
    updated_at: datetime
    steps: list[WorkforceRotationStepRead] = Field(default_factory=list, max_length=500)


class WorkforceCrewScheduleRead(ORMBase):
    model_config = ConfigDict(extra="forbid", from_attributes=True)

    id: int
    crew_id: int
    pattern_id: int
    anchor_at: datetime
    effective_from: datetime
    effective_to: datetime | None = None
    version: int = Field(gt=0)
    created_by_user_id: int
    created_at: datetime
    updated_at: datetime


class WorkforceCrewMembershipRead(ORMBase):
    model_config = ConfigDict(extra="forbid", from_attributes=True)

    id: int
    crew_id: int
    employee_id: str
    effective_from: datetime
    effective_to: datetime | None = None
    created_by_user_id: int
    created_at: datetime
    updated_by_user_id: int
    updated_at: datetime
    end_reason: str | None = None


class CrewMembershipEndWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")

    effective_to: UtcDateTime
    end_reason: str = Field(min_length=1, max_length=512)


class CrewScheduleReplaceWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")

    pattern_id: int = Field(gt=0)
    anchor_at: UtcDateTime
    effective_from: UtcDateTime




class CrewScheduleWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")

    pattern_id: int = Field(gt=0)
    anchor_at: UtcDateTime
    effective_from: UtcDateTime
    effective_to: UtcDateTime | None = None

    @model_validator(mode="after")
    def validate_window(self) -> CrewScheduleWrite:
        if self.effective_to is not None and self.effective_to <= self.effective_from:
            raise ValueError("effective_to must be after effective_from")
        return self

class CrewSchedulePreviewWrite(CrewScheduleWrite):
    """Side-effect-free bounded horizon for an anchor candidate."""

    preview_ends_at: UtcDateTime
    replaces_schedule_id: int | None = Field(default=None, gt=0)

    @model_validator(mode="after")
    def validate_preview_horizon(self) -> CrewSchedulePreviewWrite:
        if self.preview_ends_at <= self.effective_from:
            raise ValueError("preview_ends_at must be after effective_from")
        if self.preview_ends_at - self.effective_from > timedelta(days=366):
            raise ValueError("preview horizon must not exceed 366 days")
        return self


class WorkforceShiftOccurrencePreviewRead(ORMBase):
    model_config = ConfigDict(extra="forbid")

    crew_id: int
    shift_definition_id: int
    shift_code: str
    starts_at: datetime
    ends_at: datetime
    operational_date: date


class WorkforceScheduleValidationConflictRead(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str
    message: str
    schedule_id: int | None = None


class CrewSchedulePreviewRead(BaseModel):
    model_config = ConfigDict(extra="forbid")

    crew_id: int
    occurrences: list[WorkforceShiftOccurrencePreviewRead] = Field(
        default_factory=list, max_length=2_000
    )
    conflicts: list[WorkforceScheduleValidationConflictRead] = Field(
        default_factory=list, max_length=500
    )


class CrewMembershipWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")

    employee_id: str = Field(min_length=1, max_length=16)
    effective_from: UtcDateTime
    effective_to: UtcDateTime | None = None
    end_reason: str | None = Field(default=None, max_length=512)

    @model_validator(mode="after")
    def validate_window(self) -> CrewMembershipWrite:
        if self.effective_to is not None and self.effective_to <= self.effective_from:
            raise ValueError("effective_to must be after effective_from")
        return self


class ShiftOverrideWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")

    employee_id: str = Field(min_length=1, max_length=16)
    assignment_kind: AssignmentKind
    reason_kind: Literal[
        "swap",
        "training",
        "temporary_duty",
        "exceptional_work",
        "exceptional_off",
        "other",
    ]
    starts_at: UtcDateTime
    ends_at: UtcDateTime
    shift_definition_id: int | None = Field(default=None, gt=0)
    crew_id: int | None = Field(default=None, gt=0)
    department: str | None = Field(default=None, max_length=128)
    duty_unit: str | None = Field(default=None, max_length=128)
    duty_post: str | None = Field(default=None, max_length=128)
    reason: str = Field(min_length=1, max_length=1024)

    @model_validator(mode="after")
    def validate_work_override(self) -> ShiftOverrideWrite:
        if self.ends_at <= self.starts_at:
            raise ValueError("ends_at must be after starts_at")
        if self.assignment_kind == "work" and self.shift_definition_id is None:
            raise ValueError("work override requires shift_definition_id")
        return self


class ShiftSwapWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")

    from_employee_id: str = Field(min_length=1, max_length=16)
    to_employee_id: str = Field(min_length=1, max_length=16)
    starts_at: UtcDateTime
    ends_at: UtcDateTime
    shift_definition_id: int = Field(gt=0)
    reason: str = Field(min_length=1, max_length=1024)


class StaffingRequirementWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scope_kind: Literal["department", "duty_unit", "duty_post"]
    department: str | None = Field(default=None, max_length=128)
    duty_unit: str | None = Field(default=None, max_length=128)
    duty_post: str | None = Field(default=None, max_length=128)
    shift_definition_id: int | None = Field(default=None, gt=0)
    minimum_headcount: int = Field(ge=0)
    effective_from: date
    effective_to: date | None = None

    @model_validator(mode="after")
    def validate_hierarchy(self) -> StaffingRequirementWrite:
        # A department target names a department; a unit or post target names its
        # own levels and may leave the department unrecorded.
        needs_unit = self.scope_kind in {"duty_unit", "duty_post"}
        needs_post = self.scope_kind == "duty_post"
        if bool(self.duty_unit) != needs_unit or bool(self.duty_post) != needs_post:
            raise ValueError("scope hierarchy must match scope_kind")
        if self.scope_kind == "department" and not self.department:
            raise ValueError("department is required for a department requirement")
        if self.effective_to is not None and self.effective_to <= self.effective_from:
            raise ValueError("effective_to must be after effective_from")
        return self


class AttendancePolicyWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")

    shift_definition_id: int | None = Field(default=None, gt=0)
    grace_minutes: int = Field(ge=0)
    absence_after_minutes: int = Field(ge=0)
    early_exit_grace_minutes: int = Field(ge=0)
    match_before_minutes: int = Field(ge=0)
    match_after_minutes: int = Field(ge=0)
    require_checkout: bool = True
    effective_from: date
    effective_to: date | None = None

    @model_validator(mode="after")
    def validate_policy(self) -> AttendancePolicyWrite:
        if self.absence_after_minutes < self.grace_minutes:
            raise ValueError("absence_after_minutes must be at least grace_minutes")
        if self.effective_to is not None and self.effective_to <= self.effective_from:
            raise ValueError("effective_to must be after effective_from")
        return self


class ProviderPersonMappingWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")

    employee_id: str | None = Field(default=None, max_length=16)
    mapping_state: MappingState

    @model_validator(mode="after")
    def validate_mapping(self) -> ProviderPersonMappingWrite:
        if self.mapping_state == "verified" and not self.employee_id:
            raise ValueError("verified mapping requires employee_id")
        if self.mapping_state != "verified" and self.employee_id is not None:
            raise ValueError("only a verified mapping may name an employee")
        return self


class ProviderPersonRead(ORMBase):
    model_config = ConfigDict(extra="forbid")

    id: int
    provider: str
    external_person_id: str
    external_employee_code: str | None = None
    display_name_snapshot: str | None = None
    employee_id: str | None = None
    mapping_state: MappingState
    active: bool
    first_seen_at: datetime
    last_seen_at: datetime


class EvaluationQueueRead(ORMBase):
    model_config = ConfigDict(extra="forbid")

    id: int
    employee_id: str
    window_start_at: datetime
    window_end_at: datetime
    reason_codes: list[str]
    available_at: datetime
    failed_at: datetime | None = None
    attempts: int = Field(ge=0)
    last_error_code: str | None = None


class IntegrationStatusRead(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool
    provider_state: Literal["not_configured", "ready", "disabled"]
    streams: dict[str, HealthStreamRead]
    sync_running: bool


class WorkforceConfigurationRead(BaseModel):
    """Truthful configuration state without invented site-policy defaults."""

    model_config = ConfigDict(extra="forbid")

    configured: bool
    configuration: WorkforceConfiguration | None = None

    @model_validator(mode="after")
    def validate_state(self) -> WorkforceConfigurationRead:
        if self.configured != (self.configuration is not None):
            raise ValueError(
                "configured must match whether configuration is present"
            )
        return self


class ConfigurationPatch(BaseModel):
    """Partial typed patch; the router combines it with the current configuration."""

    model_config = ConfigDict(extra="forbid")

    integration_enabled: StrictBool | None = None
    sync_interval_minutes: int | None = Field(default=None, strict=True, ge=1, le=1_440)
    stale_after_minutes: int | None = Field(default=None, strict=True, ge=1, le=10_080)
    initial_backfill_start_at: UtcDateTime | None = None
    evaluation_start_at: UtcDateTime | None = None
    nationality_fold_min_count: int | None = Field(default=None, strict=True, ge=1, le=100_000)
    excusing_record_kinds: list[str] | None = None
    provider_person_retention_days: int | None = Field(default=None, strict=True, ge=1, le=36_500)
    punch_retention_days: int | None = Field(default=None, strict=True, ge=1, le=36_500)
    attendance_retention_days: int | None = Field(default=None, strict=True, ge=1, le=36_500)
    duty_event_retention_days: int | None = Field(default=None, strict=True, ge=1, le=36_500)
    audit_retention_days: int | None = Field(default=None, strict=True, ge=1, le=36_500)
__all__ = [
    "EXCUSING_RECORD_KINDS",
    "AdjustmentRevokeWrite",
    "AssignmentKind",
    "AttendanceAdjustmentAuditRead",
    "AttendanceAdjustmentRead",
    "AttendanceAdjustmentWrite",
    "AttendanceCasePunchRead",
    "AttendanceCaseRead",
    "AttendanceDayRowRead",
    "AttendanceEvaluationRead",
    "AttendanceExceptionRead",
    "AttendancePolicyWrite",
    "ConfigurationPatch",
    "CoverageRowRead",
    "CrewMembershipEndWrite",
    "CrewMembershipWrite",
    "CrewSchedulePreviewRead",
    "CrewSchedulePreviewWrite",
    "CrewScheduleReplaceWrite",
    "CrewScheduleWrite",
    "CurrentShiftRead",
    "CursorPage",
    "DutyAssignmentEventRead",
    "EmployeeAttendanceDayRead",
    "EmployeeAttendancePunchRead",
    "EmployeeAttendanceRangeRead",
    "EvaluationHealthRead",
    "EvaluationQueueRead",
    "HealthStreamRead",
    "IntegrationStatusRead",
    "LeaveCompositionRead",
    "MappingState",
    "NationalityDistributionRead",
    "NextShiftRead",
    "PresenceState",
    "ProviderPersonMappingWrite",
    "ProviderPersonRead",
    "RosterRowRead",
    "ScopeKind",
    "SelfShiftRead",
    "ShiftOverrideWrite",
    "ShiftSwapWrite",
    "StaffingRequirementWrite",
    "WorkCrewPatch",
    "WorkCrewRead",
    "WorkCrewWrite",
    "WorkforceAccessRead",
    "WorkforceAnalyticsRead",
    "WorkforceConfiguration",
    "WorkforceConfigurationRead",
    "WorkforceCrewMembershipRead",
    "WorkforceCrewScheduleRead",
    "WorkforceReadinessRead",
    "WorkforceRotationRead",
    "WorkforceRotationStepRead",
    "WorkforceScheduleValidationConflictRead",
    "WorkforceScopeRead",
    "WorkforceScopeReplace",
    "WorkforceScopeWrite",
    "WorkforceShiftDefinitionRead",
    "WorkforceShiftOccurrencePreviewRead",
    "WorkforceSnapshotRead",
]
