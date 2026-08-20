"""SQLAlchemy models for the workforce scheduling and attendance domain.

The tables here intentionally own facts and effective-dated configuration, not
runtime behaviour. Services enforce interval overlap, approval, and retention
workflows; SQLite constraints preserve stable identities, hierarchy shape, and
immutable evidence relationships at the persistence boundary.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, time
from typing import TYPE_CHECKING

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    Text,
    Time,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:  # Runtime resolution goes through SQLAlchemy's class registry.
    from app.db.models import Leave


def _utcnow() -> datetime:
    """Return the repository-standard naive UTC timestamp."""
    return datetime.now(UTC).replace(tzinfo=None)


# This roster is organized by duty unit: the five companies, official hours, and
# the support group.  ``department`` is an optional label recorded for only part
# of the workforce, so it is never a required parent.  The single invariant a
# hierarchy path must satisfy is that a post names the unit it belongs to.
_HIERARCHY_PREFIX_CHECK = "duty_post IS NULL OR duty_unit IS NOT NULL"


class WorkShiftDefinition(Base):
    __tablename__ = "work_shift_definitions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(32), nullable=False, unique=True)
    start_local_time: Mapped[time] = mapped_column(Time, nullable=False)
    duration_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=_utcnow, onupdate=_utcnow
    )

    __table_args__ = (
        CheckConstraint("duration_minutes > 0", name="ck_work_shift_definitions_duration_positive"),
    )


class WorkRotationPattern(Base):
    __tablename__ = "work_rotation_patterns"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(256), nullable=False)
    cycle_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    timezone: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=_utcnow, onupdate=_utcnow
    )

    __table_args__ = (
        CheckConstraint("cycle_minutes > 0", name="ck_work_rotation_patterns_cycle_positive"),
    )


class WorkRotationStep(Base):
    __tablename__ = "work_rotation_steps"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    pattern_id: Mapped[int] = mapped_column(
        ForeignKey("work_rotation_patterns.id", ondelete="CASCADE"), nullable=False
    )
    shift_definition_id: Mapped[int] = mapped_column(
        ForeignKey("work_shift_definitions.id"), nullable=False
    )
    start_offset_minutes: Mapped[int] = mapped_column(Integer, nullable=False)

    __table_args__ = (
        UniqueConstraint(
            "pattern_id", "start_offset_minutes", name="uq_work_rotation_steps_pattern_offset"
        ),
        CheckConstraint(
            "start_offset_minutes >= 0", name="ck_work_rotation_steps_offset_nonnegative"
        ),
    )


class WorkCrew(Base):
    __tablename__ = "work_crews"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    name_en: Mapped[str | None] = mapped_column(String(256), nullable=True)
    name_ar: Mapped[str | None] = mapped_column(String(256), nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="1")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=_utcnow, onupdate=_utcnow
    )

    __table_args__ = (
        CheckConstraint(
            "name_en IS NOT NULL OR name_ar IS NOT NULL", name="ck_work_crews_name_required"
        ),
    )


class WorkCrewSchedule(Base):
    __tablename__ = "work_crew_schedules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    crew_id: Mapped[int] = mapped_column(ForeignKey("work_crews.id"), nullable=False)
    pattern_id: Mapped[int] = mapped_column(
        ForeignKey("work_rotation_patterns.id"), nullable=False
    )
    anchor_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    effective_from: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    effective_to: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    created_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=_utcnow, onupdate=_utcnow
    )

    __table_args__ = (
        UniqueConstraint("crew_id", "version", name="uq_work_crew_schedules_crew_version"),
        CheckConstraint("version > 0", name="ck_work_crew_schedules_version_positive"),
        CheckConstraint(
            "effective_to IS NULL OR effective_to > effective_from",
            name="ck_work_crew_schedules_effective_window",
        ),
        Index("ix_work_crew_schedules_crew_effective", "crew_id", "effective_from"),
    )


class WorkCrewMembership(Base):
    __tablename__ = "work_crew_memberships"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    crew_id: Mapped[int] = mapped_column(ForeignKey("work_crews.id"), nullable=False)
    employee_id: Mapped[str] = mapped_column(ForeignKey("employees.id"), nullable=False)
    effective_from: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    effective_to: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_utcnow)
    updated_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=_utcnow, onupdate=_utcnow
    )
    end_reason: Mapped[str | None] = mapped_column(String(512), nullable=True)

    __table_args__ = (
        UniqueConstraint(
            "employee_id", "effective_from", name="uq_work_crew_memberships_employee_effective"
        ),
        CheckConstraint(
            "effective_to IS NULL OR effective_to > effective_from",
            name="ck_work_crew_memberships_effective_window",
        ),
        Index("ix_work_crew_memberships_crew_effective", "crew_id", "effective_from"),
    )


class WorkShiftOccurrence(Base):
    __tablename__ = "work_shift_occurrences"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    crew_id: Mapped[int] = mapped_column(ForeignKey("work_crews.id"), nullable=False)
    crew_schedule_id: Mapped[int] = mapped_column(
        ForeignKey("work_crew_schedules.id"), nullable=False
    )
    shift_definition_id: Mapped[int] = mapped_column(
        ForeignKey("work_shift_definitions.id"), nullable=False
    )
    starts_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    ends_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    operational_date: Mapped[date] = mapped_column(Date, nullable=False)
    pattern_code_snapshot: Mapped[str] = mapped_column(String(64), nullable=False)
    crew_schedule_version_snapshot: Mapped[int] = mapped_column(Integer, nullable=False)
    source_anchor_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_utcnow)

    __table_args__ = (
        UniqueConstraint("crew_id", "starts_at", name="uq_work_shift_occurrences_crew_start"),
        CheckConstraint("ends_at > starts_at", name="ck_work_shift_occurrences_window"),
        CheckConstraint(
            "crew_schedule_version_snapshot > 0",
            name="ck_work_shift_occurrences_schedule_version_positive",
        ),
        Index("ix_work_shift_occurrences_operational_date", "operational_date"),
    )


class WorkShiftOverride(Base):
    __tablename__ = "work_shift_overrides"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    employee_id: Mapped[str] = mapped_column(ForeignKey("employees.id"), nullable=False)
    assignment_kind: Mapped[str] = mapped_column(String(16), nullable=False)
    reason_kind: Mapped[str] = mapped_column(String(32), nullable=False)
    starts_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    ends_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    shift_definition_id: Mapped[int | None] = mapped_column(
        ForeignKey("work_shift_definitions.id"), nullable=True
    )
    crew_id: Mapped[int | None] = mapped_column(ForeignKey("work_crews.id"), nullable=True)
    department: Mapped[str | None] = mapped_column(String(128), nullable=True)
    duty_unit: Mapped[str | None] = mapped_column(String(128), nullable=True)
    duty_post: Mapped[str | None] = mapped_column(String(128), nullable=True)
    correlation_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    reason: Mapped[str] = mapped_column(String(1024), nullable=False)
    created_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_utcnow)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    cancelled_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)

    __table_args__ = (
        CheckConstraint(
            "assignment_kind IN ('work', 'off')", name="ck_work_shift_overrides_assignment_kind"
        ),
        CheckConstraint(
            "reason_kind IN ('swap', 'training', 'temporary_duty', 'exceptional_work', "
            "'exceptional_off', 'other')",
            name="ck_work_shift_overrides_reason_kind",
        ),
        CheckConstraint("ends_at > starts_at", name="ck_work_shift_overrides_window"),
        CheckConstraint(
            "assignment_kind = 'off' OR shift_definition_id IS NOT NULL",
            name="ck_work_shift_overrides_work_shift_required",
        ),
        CheckConstraint(
            "reason_kind != 'swap' OR correlation_id IS NOT NULL",
            name="ck_work_shift_overrides_swap_correlation_required",
        ),
        CheckConstraint(_HIERARCHY_PREFIX_CHECK, name="ck_work_shift_overrides_hierarchy_prefix"),
        Index("ix_work_shift_overrides_employee_window", "employee_id", "starts_at", "ends_at"),
        Index("ix_work_shift_overrides_correlation", "correlation_id"),
    )


class WorkStaffingRequirement(Base):
    __tablename__ = "work_staffing_requirements"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    scope_kind: Mapped[str] = mapped_column(String(16), nullable=False)
    department: Mapped[str | None] = mapped_column(String(128), nullable=True)
    duty_unit: Mapped[str | None] = mapped_column(String(128), nullable=True)
    duty_post: Mapped[str | None] = mapped_column(String(128), nullable=True)
    shift_definition_id: Mapped[int | None] = mapped_column(
        ForeignKey("work_shift_definitions.id"), nullable=True
    )
    minimum_headcount: Mapped[int] = mapped_column(Integer, nullable=False)
    effective_from: Mapped[date] = mapped_column(Date, nullable=False)
    effective_to: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=_utcnow, onupdate=_utcnow
    )
    approved_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    supersedes_requirement_id: Mapped[int | None] = mapped_column(
        ForeignKey("work_staffing_requirements.id"), nullable=True
    )

    __table_args__ = (
        CheckConstraint(
            "scope_kind IN ('department', 'duty_unit', 'duty_post')",
            name="ck_work_staffing_requirements_scope_kind",
        ),
        CheckConstraint(
            "(scope_kind = 'department' AND department IS NOT NULL AND duty_unit IS NULL "
            "AND duty_post IS NULL) OR "
            "(scope_kind = 'duty_unit' AND duty_unit IS NOT NULL AND duty_post IS NULL) OR "
            "(scope_kind = 'duty_post' AND duty_unit IS NOT NULL AND duty_post IS NOT NULL)",
            name="ck_work_staffing_requirements_hierarchy",
        ),
        CheckConstraint(
            "minimum_headcount >= 0", name="ck_work_staffing_requirements_headcount_nonnegative"
        ),
        CheckConstraint(
            "effective_to IS NULL OR effective_to > effective_from",
            name="ck_work_staffing_requirements_effective_window",
        ),
        CheckConstraint(
            "(approved_by_user_id IS NULL AND approved_at IS NULL) OR "
            "(approved_by_user_id IS NOT NULL AND approved_at IS NOT NULL)",
            name="ck_work_staffing_requirements_approval_pair",
        ),
        Index(
            "ix_work_staffing_requirements_match",
            "scope_kind",
            "department",
            "duty_unit",
            "duty_post",
            "shift_definition_id",
            "effective_from",
        ),
    )


class WorkAttendancePolicy(Base):
    __tablename__ = "work_attendance_policies"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    shift_definition_id: Mapped[int | None] = mapped_column(
        ForeignKey("work_shift_definitions.id"), nullable=True
    )
    grace_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    absence_after_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    early_exit_grace_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    match_before_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    match_after_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    require_checkout: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="1")
    effective_from: Mapped[date] = mapped_column(Date, nullable=False)
    effective_to: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=_utcnow, onupdate=_utcnow
    )
    approved_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    supersedes_policy_id: Mapped[int | None] = mapped_column(
        ForeignKey("work_attendance_policies.id"), nullable=True
    )

    __table_args__ = (
        CheckConstraint(
            "grace_minutes >= 0 AND absence_after_minutes >= grace_minutes "
            "AND early_exit_grace_minutes >= 0 AND match_before_minutes >= 0 "
            "AND match_after_minutes >= 0",
            name="ck_work_attendance_policies_minutes_nonnegative",
        ),
        CheckConstraint(
            "effective_to IS NULL OR effective_to > effective_from",
            name="ck_work_attendance_policies_effective_window",
        ),
        CheckConstraint(
            "(approved_by_user_id IS NULL AND approved_at IS NULL) OR "
            "(approved_by_user_id IS NOT NULL AND approved_at IS NOT NULL)",
            name="ck_work_attendance_policies_approval_pair",
        ),
        Index(
            "ix_work_attendance_policies_shift_effective",
            "shift_definition_id",
            "effective_from",
        ),
    )


class AttendanceProviderPerson(Base):
    __tablename__ = "attendance_provider_people"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    provider: Mapped[str] = mapped_column(String(32), nullable=False)
    external_person_id: Mapped[str] = mapped_column(String(128), nullable=False)
    external_employee_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    display_name_snapshot: Mapped[str | None] = mapped_column(String(256), nullable=True)
    employee_id: Mapped[str | None] = mapped_column(ForeignKey("employees.id"), nullable=True)
    mapping_state: Mapped[str] = mapped_column(String(16), nullable=False, default="unmapped")
    verified_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="1")
    first_seen_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_utcnow)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_utcnow)
    source_updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    __table_args__ = (
        UniqueConstraint(
            "provider", "external_person_id", name="uq_attendance_provider_people_natural_key"
        ),
        CheckConstraint(
            "mapping_state IN ('unmapped', 'verified', 'conflict', 'ignored')",
            name="ck_attendance_provider_people_mapping_state",
        ),
        CheckConstraint(
            "mapping_state != 'verified' OR (employee_id IS NOT NULL "
            "AND verified_by_user_id IS NOT NULL AND verified_at IS NOT NULL)",
            name="ck_attendance_provider_people_verified_fields",
        ),
        Index(
            "uq_attendance_provider_people_verified_active_employee",
            "employee_id",
            unique=True,
            sqlite_where=text("active = 1 AND mapping_state = 'verified'"),
        ),
        Index(
            "ix_attendance_provider_people_provider_employee_code",
            "provider",
            "external_employee_code",
        ),
    )


class AttendancePunch(Base):
    __tablename__ = "attendance_punches"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    provider: Mapped[str] = mapped_column(String(32), nullable=False)
    external_event_id: Mapped[str] = mapped_column(String(128), nullable=False)
    provider_person_id: Mapped[int] = mapped_column(
        ForeignKey("attendance_provider_people.id"), nullable=False
    )
    occurred_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    direction: Mapped[str] = mapped_column(String(16), nullable=False, default="unknown")
    device_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    device_name: Mapped[str | None] = mapped_column(String(256), nullable=True)
    source_updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    imported_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_utcnow)
    normalized_payload_hash: Mapped[str] = mapped_column(String(128), nullable=False)

    __table_args__ = (
        UniqueConstraint("provider", "external_event_id", name="uq_attendance_punches_natural_key"),
        CheckConstraint(
            "direction IN ('in', 'out', 'unknown')", name="ck_attendance_punches_direction"
        ),
        Index("ix_attendance_punches_person_occurred", "provider_person_id", "occurred_at"),
    )


class AttendancePunchAssignment(Base):
    __tablename__ = "attendance_punch_assignments"

    punch_id: Mapped[int] = mapped_column(
        ForeignKey("attendance_punches.id"), primary_key=True
    )
    attendance_case_id: Mapped[int] = mapped_column(
        ForeignKey("attendance_cases.id"), nullable=False
    )
    algorithm_version: Mapped[str] = mapped_column(String(64), nullable=False)
    assigned_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=_utcnow, onupdate=_utcnow
    )

    __table_args__ = (Index("ix_attendance_punch_assignments_case", "attendance_case_id"),)


class AttendanceSyncState(Base):
    __tablename__ = "attendance_sync_state"

    provider: Mapped[str] = mapped_column(String(32), primary_key=True)
    stream: Mapped[str] = mapped_column(String(32), primary_key=True)
    cursor: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_attempt_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_success_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    window_since: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    window_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    fresh_through: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_event_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_import_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    last_error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    last_error_summary: Mapped[str | None] = mapped_column(String(512), nullable=True)
    consecutive_failures: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=_utcnow, onupdate=_utcnow
    )

    __table_args__ = (
        CheckConstraint(
            "last_import_count >= 0", name="ck_attendance_sync_state_import_count_nonnegative"
        ),
        CheckConstraint(
            "consecutive_failures >= 0", name="ck_attendance_sync_state_failures_nonnegative"
        ),
        CheckConstraint(
            "(window_since IS NULL AND window_until IS NULL) OR "
            "(window_since IS NOT NULL AND window_until IS NOT NULL AND window_until > window_since)",
            name="ck_attendance_sync_state_window_pair",
        ),
    )


class AttendanceEvaluationQueue(Base):
    __tablename__ = "attendance_evaluation_queue"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    employee_id: Mapped[str] = mapped_column(ForeignKey("employees.id"), nullable=False)
    window_start_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    window_end_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    reason_codes: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    available_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_utcnow)
    lease_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    failed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    last_error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    last_error_summary: Mapped[str | None] = mapped_column(String(512), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=_utcnow, onupdate=_utcnow
    )

    __table_args__ = (
        CheckConstraint(
            "window_end_at > window_start_at AND "
            "julianday(window_end_at) - julianday(window_start_at) <= 31.0",
            name="ck_attendance_evaluation_queue_window_bounded",
        ),
        CheckConstraint("attempts >= 0", name="ck_attendance_evaluation_queue_attempts_nonnegative"),
        CheckConstraint(
            "json_valid(reason_codes) AND json_type(reason_codes) = 'array' "
            "AND json_array_length(reason_codes) BETWEEN 1 AND 32",
            name="ck_attendance_evaluation_queue_reason_codes_bounded_array",
        ),
        Index(
            "ix_attendance_evaluation_queue_claim",
            "available_at",
            "lease_until",
            "created_at",
        ),
        Index("ix_attendance_evaluation_queue_employee_window", "employee_id", "window_start_at"),
    )


class AttendanceCase(Base):
    __tablename__ = "attendance_cases"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    employee_id: Mapped[str] = mapped_column(ForeignKey("employees.id"), nullable=False)
    shift_occurrence_id: Mapped[int | None] = mapped_column(
        ForeignKey("work_shift_occurrences.id"), nullable=True
    )
    shift_override_id: Mapped[int | None] = mapped_column(
        ForeignKey("work_shift_overrides.id"), nullable=True
    )
    duty_assignment_event_id: Mapped[int | None] = mapped_column(
        ForeignKey("duty_assignment_events.id"), nullable=True
    )
    employee_status_snapshot: Mapped[str] = mapped_column(String(32), nullable=False)
    crew_code_snapshot: Mapped[str | None] = mapped_column(String(64), nullable=True)
    crew_name_snapshot: Mapped[str | None] = mapped_column(String(256), nullable=True)
    shift_code_snapshot: Mapped[str] = mapped_column(String(32), nullable=False)
    department_snapshot: Mapped[str | None] = mapped_column(String(128), nullable=True)
    duty_unit_snapshot: Mapped[str | None] = mapped_column(String(128), nullable=True)
    duty_post_snapshot: Mapped[str | None] = mapped_column(String(128), nullable=True)
    scheduled_start_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    scheduled_end_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    operational_date: Mapped[date] = mapped_column(Date, nullable=False)
    organization_snapshot_state: Mapped[str] = mapped_column(String(16), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_utcnow)
    evaluations: Mapped[list[AttendanceEvaluation]] = relationship(
        back_populates="attendance_case",
        cascade="all, delete-orphan",
        order_by="AttendanceEvaluation.revision",
    )
    adjustments: Mapped[list[AttendanceAdjustment]] = relationship(
        back_populates="attendance_case",
        cascade="all, delete-orphan",
        order_by="AttendanceAdjustment.created_at",
    )


    __table_args__ = (
        UniqueConstraint(
            "employee_id", "scheduled_start_at", name="uq_attendance_cases_employee_scheduled_start"
        ),
        CheckConstraint(
            "(shift_occurrence_id IS NOT NULL AND shift_override_id IS NULL) OR "
            "(shift_occurrence_id IS NULL AND shift_override_id IS NOT NULL)",
            name="ck_attendance_cases_schedule_source_required",
        ),
        CheckConstraint(
            "scheduled_end_at > scheduled_start_at", name="ck_attendance_cases_scheduled_window"
        ),
        CheckConstraint(
            "organization_snapshot_state IN ('captured', 'reconstructed', 'unknown')",
            name="ck_attendance_cases_organization_snapshot_state",
        ),
        Index("ix_attendance_cases_operational_date", "operational_date"),
    )


class AttendanceEvaluation(Base):
    __tablename__ = "attendance_evaluations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    attendance_case_id: Mapped[int] = mapped_column(ForeignKey("attendance_cases.id"), nullable=False)
    revision: Mapped[int] = mapped_column(Integer, nullable=False)
    provider_person_id: Mapped[int | None] = mapped_column(
        ForeignKey("attendance_provider_people.id"), nullable=True
    )
    first_in_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    latest_in_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    final_out_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_directional_punch_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_direction: Mapped[str | None] = mapped_column(String(16), nullable=True)
    presence_state: Mapped[str] = mapped_column(String(32), nullable=False)
    reason_code: Mapped[str] = mapped_column(String(128), nullable=False)
    late_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    early_exit_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    missing_checkout: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")
    sync_fresh_through: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    policy_id: Mapped[int | None] = mapped_column(
        ForeignKey("work_attendance_policies.id"), nullable=True
    )
    algorithm_version: Mapped[str] = mapped_column(String(64), nullable=False)
    input_fingerprint: Mapped[str] = mapped_column(String(128), nullable=False)
    evaluated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_utcnow)
    attendance_case: Mapped[AttendanceCase] = relationship(back_populates="evaluations")
    punch_sources: Mapped[list[AttendanceEvaluationPunchSource]] = relationship(
        back_populates="evaluation",
        cascade="all, delete-orphan",
        order_by="AttendanceEvaluationPunchSource.ordinal",
    )
    leave_sources: Mapped[list[AttendanceEvaluationLeaveSource]] = relationship(
        back_populates="evaluation",
        cascade="all, delete-orphan",
    )
    adjustments_based_on: Mapped[list[AttendanceAdjustment]] = relationship(
        back_populates="base_evaluation",
        primaryjoin=(
            "foreign(AttendanceAdjustment.base_evaluation_id) == AttendanceEvaluation.id"
        ),
    )


    __table_args__ = (
        UniqueConstraint(
            "attendance_case_id", "revision", name="uq_attendance_evaluations_case_revision"
        ),
        UniqueConstraint(
            "id",
            "attendance_case_id",
            name="uq_attendance_evaluations_id_case",
        ),
        UniqueConstraint(
            "attendance_case_id",
            "input_fingerprint",
            name="uq_attendance_evaluations_case_fingerprint",
        ),
        CheckConstraint("revision > 0", name="ck_attendance_evaluations_revision_positive"),
        CheckConstraint(
            "last_direction IS NULL OR last_direction IN ('in', 'out')",
            name="ck_attendance_evaluations_last_direction",
        ),
        CheckConstraint(
            "presence_state IN ('scheduled', 'on_duty', 'completed', 'absent', "
            "'excused_leave', 'off', 'unknown')",
            name="ck_attendance_evaluations_presence_state",
        ),
        CheckConstraint(
            "late_minutes IS NULL OR late_minutes >= 0",
            name="ck_attendance_evaluations_late_nonnegative",
        ),
        CheckConstraint(
            "early_exit_minutes IS NULL OR early_exit_minutes >= 0",
            name="ck_attendance_evaluations_early_exit_nonnegative",
        ),
        Index("ix_attendance_evaluations_case_evaluated", "attendance_case_id", "evaluated_at"),
    )


class AttendanceEvaluationPunchSource(Base):
    __tablename__ = "attendance_evaluation_punch_sources"

    evaluation_id: Mapped[int] = mapped_column(
        ForeignKey("attendance_evaluations.id", ondelete="CASCADE"), primary_key=True
    )
    punch_id: Mapped[int] = mapped_column(
        ForeignKey("attendance_punches.id", ondelete="RESTRICT"), primary_key=True
    )
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False)
    evaluation: Mapped[AttendanceEvaluation] = relationship(back_populates="punch_sources")
    punch: Mapped[AttendancePunch] = relationship()


    __table_args__ = (
        UniqueConstraint(
            "evaluation_id", "ordinal", name="uq_attendance_evaluation_punch_sources_ordinal"
        ),
        CheckConstraint("ordinal > 0", name="ck_attendance_evaluation_punch_sources_ordinal"),
    )


class AttendanceEvaluationLeaveSource(Base):
    __tablename__ = "attendance_evaluation_leave_sources"

    evaluation_id: Mapped[int] = mapped_column(
        ForeignKey("attendance_evaluations.id", ondelete="CASCADE"), primary_key=True
    )
    leave_id: Mapped[int] = mapped_column(
        ForeignKey("leaves.id", ondelete="RESTRICT"), primary_key=True
    )
    is_primary: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")
    evaluation: Mapped[AttendanceEvaluation] = relationship(back_populates="leave_sources")
    leave: Mapped[Leave] = relationship("Leave")
    __table_args__ = (
        Index(
            "uq_attendance_evaluation_leave_sources_primary",
            "evaluation_id",
            unique=True,
            sqlite_where=text("is_primary = 1"),
        ),
    )




class AttendanceAdjustment(Base):
    __tablename__ = "attendance_adjustments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    attendance_case_id: Mapped[int] = mapped_column(ForeignKey("attendance_cases.id"), nullable=False)
    base_evaluation_id: Mapped[int] = mapped_column(Integer, nullable=False)
    replacement_presence_state: Mapped[str | None] = mapped_column(String(32), nullable=True)
    replacement_first_in_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    replacement_latest_in_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    replacement_final_out_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    replacement_late_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    replacement_early_exit_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    replacement_missing_checkout: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    reason: Mapped[str] = mapped_column(String(1024), nullable=False)
    created_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_utcnow)
    supersedes_adjustment_id: Mapped[int | None] = mapped_column(
        ForeignKey("attendance_adjustments.id"), nullable=True
    )
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    revoked_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    attendance_case: Mapped[AttendanceCase] = relationship(back_populates="adjustments")
    base_evaluation: Mapped[AttendanceEvaluation] = relationship(
        back_populates="adjustments_based_on",
        primaryjoin=(
            "foreign(AttendanceAdjustment.base_evaluation_id) == AttendanceEvaluation.id"
        ),
    )

    __table_args__ = (
        ForeignKeyConstraint(
            ("base_evaluation_id", "attendance_case_id"),
            ("attendance_evaluations.id", "attendance_evaluations.attendance_case_id"),
            name="fk_attendance_adjustments_base_evaluation_case",
        ),
        CheckConstraint(
            "replacement_presence_state IS NULL OR replacement_presence_state IN "
            "('scheduled', 'on_duty', 'completed', 'absent', 'excused_leave', 'off', 'unknown')",
            name="ck_attendance_adjustments_presence_state",
        ),
        CheckConstraint(
            "replacement_late_minutes IS NULL OR replacement_late_minutes >= 0",
            name="ck_attendance_adjustments_late_nonnegative",
        ),
        CheckConstraint(
            "replacement_early_exit_minutes IS NULL OR replacement_early_exit_minutes >= 0",
            name="ck_attendance_adjustments_early_exit_nonnegative",
        ),
        Index("ix_attendance_adjustments_case_created", "attendance_case_id", "created_at"),
    )


class DutyAssignmentEvent(Base):
    __tablename__ = "duty_assignment_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    employee_id: Mapped[str] = mapped_column(ForeignKey("employees.id"), nullable=False)
    event_type: Mapped[str] = mapped_column(String(32), nullable=False)
    from_department: Mapped[str | None] = mapped_column(String(128), nullable=True)
    from_unit: Mapped[str | None] = mapped_column(String(128), nullable=True)
    from_post: Mapped[str | None] = mapped_column(String(128), nullable=True)
    to_department: Mapped[str | None] = mapped_column(String(128), nullable=True)
    to_unit: Mapped[str | None] = mapped_column(String(128), nullable=True)
    to_post: Mapped[str | None] = mapped_column(String(128), nullable=True)
    effective_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    document_id: Mapped[int | None] = mapped_column(
        ForeignKey("documents.id", ondelete="SET NULL"), nullable=True
    )
    actor_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    reason: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_utcnow)

    __table_args__ = (
        CheckConstraint(
            "event_type IN ('baseline', 'initial_placement', 'transfer', 'manual_change')",
            name="ck_duty_assignment_events_event_type",
        ),
        CheckConstraint(
            "actor_user_id IS NOT NULL OR event_type = 'baseline'",
            name="ck_duty_assignment_events_actor_required",
        ),
        CheckConstraint(
            "from_post IS NULL OR from_unit IS NOT NULL",
            name="ck_duty_assignment_events_from_hierarchy_prefix",
        ),
        CheckConstraint(
            "to_post IS NULL OR to_unit IS NOT NULL",
            name="ck_duty_assignment_events_to_hierarchy_prefix",
        ),
        Index("ix_duty_assignment_events_employee_effective", "employee_id", "effective_at"),
    )


class UserWorkforceScope(Base):
    __tablename__ = "user_workforce_scopes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    scope_kind: Mapped[str] = mapped_column(String(16), nullable=False)
    department: Mapped[str | None] = mapped_column(String(128), nullable=True)
    duty_unit: Mapped[str | None] = mapped_column(String(128), nullable=True)
    duty_post: Mapped[str | None] = mapped_column(String(128), nullable=True)
    created_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_utcnow)

    __table_args__ = (
        CheckConstraint(
            "(scope_kind = 'organization' AND department IS NULL AND duty_unit IS NULL "
            "AND duty_post IS NULL) OR "
            "(scope_kind = 'department' AND department IS NOT NULL AND duty_unit IS NULL "
            "AND duty_post IS NULL) OR "
            "(scope_kind = 'duty_unit' AND duty_unit IS NOT NULL AND duty_post IS NULL) OR "
            "(scope_kind = 'duty_post' AND duty_unit IS NOT NULL AND duty_post IS NOT NULL)",
            name="ck_user_workforce_scopes_hierarchy",
        ),
        Index(
            "uq_user_workforce_scopes_normalized_hierarchy",
            "user_id",
            "scope_kind",
            func.coalesce(department, ""),
            func.coalesce(duty_unit, ""),
            func.coalesce(duty_post, ""),
            unique=True,
        ),
    )


__all__ = [
    "AttendanceAdjustment",
    "AttendanceCase",
    "AttendanceEvaluation",
    "AttendanceEvaluationLeaveSource",
    "AttendanceEvaluationPunchSource",
    "AttendanceEvaluationQueue",
    "AttendanceProviderPerson",
    "AttendancePunch",
    "AttendancePunchAssignment",
    "AttendanceSyncState",
    "DutyAssignmentEvent",
    "UserWorkforceScope",
    "WorkAttendancePolicy",
    "WorkCrew",
    "WorkCrewMembership",
    "WorkCrewSchedule",
    "WorkRotationPattern",
    "WorkRotationStep",
    "WorkShiftDefinition",
    "WorkShiftOccurrence",
    "WorkShiftOverride",
    "WorkStaffingRequirement",
]
