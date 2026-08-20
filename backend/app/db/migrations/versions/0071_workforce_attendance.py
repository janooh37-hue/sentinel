"""workforce attendance persistence foundation.

Revision ID: 0071_workforce_attendance
Revises: 0070_timesheet
Create Date: 2026-08-17
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import sqlalchemy as sa
from alembic import op

revision: str = "0071_workforce_attendance"
down_revision: str | Sequence[str] | None = "0070_timesheet"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_WORKFORCE_CAPABILITIES = (
    "workforce.self.view",
    "workforce.dashboard.view",
    "workforce.people.view",
    "workforce.schedule.manage",
    "workforce.policy.manage",
    "workforce.attendance.review",
    "workforce.attendance.correct",
    "workforce.integration.manage",
)

_ROLE_DEFAULTS: dict[str, tuple[str, ...]] = {
    "operator": ("workforce.self.view",),
    "manager": (),
    "admin": _WORKFORCE_CAPABILITIES,
}

_QUEUE_REASON_CODES = (
    "ATTENDANCE_ADJUSTMENT_CHANGED",
    "CREW_MEMBERSHIP_CHANGED",
    "DUTY_ASSIGNMENT_CHANGED",
    "LEAVE_AMENDED",
    "LEAVE_APPROVED",
    "LEAVE_CANCELLED",
    "LEAVE_COMPLETED",
    "LEAVE_CREATED",
    "LEAVE_DATES_AMENDED",
    "LEAVE_DELETED",
    "LEAVE_PENDING",
    "LEAVE_REJECTED",
    "PUNCH_FRESHNESS_ADVANCED",
    "PUNCH_IMPORTED",
    "SHIFT_OVERRIDE_CANCELLED",
    "SHIFT_OVERRIDE_CHANGED",
)
_QUEUE_REASON_CODES_SQL = ", ".join(f"'{code}'" for code in _QUEUE_REASON_CODES)
_SQLITE_INVARIANT_TRIGGER_NAMES = (
    "trg_work_rotation_steps_offset_insert",
    "trg_work_rotation_steps_offset_update",
    "trg_work_rotation_patterns_cycle_update",
    "trg_attendance_evaluation_queue_reasons_insert",
    "trg_attendance_evaluation_queue_reasons_update",
)


def _created_at() -> sa.Column[Any]:
    return sa.Column(
        "created_at",
        sa.DateTime(),
        nullable=False,
        server_default=sa.func.current_timestamp(),
    )


def _updated_at() -> sa.Column[Any]:
    return sa.Column(
        "updated_at",
        sa.DateTime(),
        nullable=False,
        server_default=sa.func.current_timestamp(),
    )


def _create_workforce_tables() -> None:
    """Create the workforce graph in parent-first dependency order."""
    op.create_table(
        "work_shift_definitions",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("code", sa.String(length=32), nullable=False, unique=True),
        sa.Column("start_local_time", sa.Time(), nullable=False),
        sa.Column("duration_minutes", sa.Integer(), nullable=False),
        _created_at(),
        _updated_at(),
        sa.CheckConstraint(
            "duration_minutes > 0", name="ck_work_shift_definitions_duration_positive"
        ),
    )
    op.create_table(
        "work_rotation_patterns",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("code", sa.String(length=64), nullable=False, unique=True),
        sa.Column("name", sa.String(length=256), nullable=False),
        sa.Column("cycle_minutes", sa.Integer(), nullable=False),
        sa.Column("timezone", sa.String(length=64), nullable=False),
        _created_at(),
        _updated_at(),
        sa.CheckConstraint("cycle_minutes > 0", name="ck_work_rotation_patterns_cycle_positive"),
    )
    op.create_table(
        "work_rotation_steps",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "pattern_id",
            sa.Integer(),
            sa.ForeignKey("work_rotation_patterns.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "shift_definition_id",
            sa.Integer(),
            sa.ForeignKey("work_shift_definitions.id"),
            nullable=False,
        ),
        sa.Column("start_offset_minutes", sa.Integer(), nullable=False),
        sa.UniqueConstraint(
            "pattern_id", "start_offset_minutes", name="uq_work_rotation_steps_pattern_offset"
        ),
        sa.CheckConstraint(
            "start_offset_minutes >= 0", name="ck_work_rotation_steps_offset_nonnegative"
        ),
    )
    op.create_table(
        "work_crews",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("code", sa.String(length=64), nullable=False, unique=True),
        sa.Column("name_en", sa.String(length=256), nullable=True),
        sa.Column("name_ar", sa.String(length=256), nullable=True),
        sa.Column("active", sa.Boolean(), nullable=False, server_default="1"),
        _created_at(),
        _updated_at(),
        sa.CheckConstraint("name_en IS NOT NULL OR name_ar IS NOT NULL", name="ck_work_crews_name_required"),
    )
    op.create_table(
        "work_crew_schedules",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("crew_id", sa.Integer(), sa.ForeignKey("work_crews.id"), nullable=False),
        sa.Column(
            "pattern_id", sa.Integer(), sa.ForeignKey("work_rotation_patterns.id"), nullable=False
        ),
        sa.Column("anchor_at", sa.DateTime(), nullable=False),
        sa.Column("effective_from", sa.DateTime(), nullable=False),
        sa.Column("effective_to", sa.DateTime(), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("created_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        _created_at(),
        _updated_at(),
        sa.UniqueConstraint("crew_id", "version", name="uq_work_crew_schedules_crew_version"),
        sa.CheckConstraint("version > 0", name="ck_work_crew_schedules_version_positive"),
        sa.CheckConstraint(
            "effective_to IS NULL OR effective_to > effective_from",
            name="ck_work_crew_schedules_effective_window",
        ),
    )
    op.create_index(
        "ix_work_crew_schedules_crew_effective",
        "work_crew_schedules",
        ["crew_id", "effective_from"],
    )
    op.create_table(
        "work_crew_memberships",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("crew_id", sa.Integer(), sa.ForeignKey("work_crews.id"), nullable=False),
        sa.Column("employee_id", sa.String(length=16), sa.ForeignKey("employees.id"), nullable=False),
        sa.Column("effective_from", sa.DateTime(), nullable=False),
        sa.Column("effective_to", sa.DateTime(), nullable=True),
        sa.Column("created_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        _created_at(),
        sa.Column("updated_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        _updated_at(),
        sa.Column("end_reason", sa.String(length=512), nullable=True),
        sa.UniqueConstraint(
            "employee_id", "effective_from", name="uq_work_crew_memberships_employee_effective"
        ),
        sa.CheckConstraint(
            "effective_to IS NULL OR effective_to > effective_from",
            name="ck_work_crew_memberships_effective_window",
        ),
    )
    op.create_index(
        "ix_work_crew_memberships_crew_effective",
        "work_crew_memberships",
        ["crew_id", "effective_from"],
    )
    op.create_table(
        "work_shift_occurrences",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("crew_id", sa.Integer(), sa.ForeignKey("work_crews.id"), nullable=False),
        sa.Column(
            "crew_schedule_id", sa.Integer(), sa.ForeignKey("work_crew_schedules.id"), nullable=False
        ),
        sa.Column(
            "shift_definition_id",
            sa.Integer(),
            sa.ForeignKey("work_shift_definitions.id"),
            nullable=False,
        ),
        sa.Column("starts_at", sa.DateTime(), nullable=False),
        sa.Column("ends_at", sa.DateTime(), nullable=False),
        sa.Column("operational_date", sa.Date(), nullable=False),
        sa.Column("pattern_code_snapshot", sa.String(length=64), nullable=False),
        sa.Column("crew_schedule_version_snapshot", sa.Integer(), nullable=False),
        sa.Column("source_anchor_at", sa.DateTime(), nullable=False),
        _created_at(),
        sa.UniqueConstraint("crew_id", "starts_at", name="uq_work_shift_occurrences_crew_start"),
        sa.CheckConstraint("ends_at > starts_at", name="ck_work_shift_occurrences_window"),
        sa.CheckConstraint(
            "crew_schedule_version_snapshot > 0",
            name="ck_work_shift_occurrences_schedule_version_positive",
        ),
    )
    op.create_index(
        "ix_work_shift_occurrences_operational_date", "work_shift_occurrences", ["operational_date"]
    )
    op.create_table(
        "work_shift_overrides",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("employee_id", sa.String(length=16), sa.ForeignKey("employees.id"), nullable=False),
        sa.Column("assignment_kind", sa.String(length=16), nullable=False),
        sa.Column("reason_kind", sa.String(length=32), nullable=False),
        sa.Column("starts_at", sa.DateTime(), nullable=False),
        sa.Column("ends_at", sa.DateTime(), nullable=False),
        sa.Column(
            "shift_definition_id",
            sa.Integer(),
            sa.ForeignKey("work_shift_definitions.id"),
            nullable=True,
        ),
        sa.Column("crew_id", sa.Integer(), sa.ForeignKey("work_crews.id"), nullable=True),
        sa.Column("department", sa.String(length=128), nullable=True),
        sa.Column("duty_unit", sa.String(length=128), nullable=True),
        sa.Column("duty_post", sa.String(length=128), nullable=True),
        sa.Column("correlation_id", sa.String(length=64), nullable=True),
        sa.Column("reason", sa.String(length=1024), nullable=False),
        sa.Column("created_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        _created_at(),
        sa.Column("cancelled_at", sa.DateTime(), nullable=True),
        sa.Column("cancelled_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.CheckConstraint(
            "assignment_kind IN ('work', 'off')", name="ck_work_shift_overrides_assignment_kind"
        ),
        sa.CheckConstraint(
            "reason_kind IN ('swap', 'training', 'temporary_duty', 'exceptional_work', "
            "'exceptional_off', 'other')",
            name="ck_work_shift_overrides_reason_kind",
        ),
        sa.CheckConstraint("ends_at > starts_at", name="ck_work_shift_overrides_window"),
        sa.CheckConstraint(
            "assignment_kind = 'off' OR shift_definition_id IS NOT NULL",
            name="ck_work_shift_overrides_work_shift_required",
        ),
        sa.CheckConstraint(
            "reason_kind != 'swap' OR correlation_id IS NOT NULL",
            name="ck_work_shift_overrides_swap_correlation_required",
        ),
        sa.CheckConstraint(
            "duty_post IS NULL OR duty_unit IS NOT NULL",
            name="ck_work_shift_overrides_hierarchy_prefix",
        ),
    )
    op.create_index(
        "ix_work_shift_overrides_employee_window",
        "work_shift_overrides",
        ["employee_id", "starts_at", "ends_at"],
    )
    op.create_index("ix_work_shift_overrides_correlation", "work_shift_overrides", ["correlation_id"])
    op.create_table(
        "work_staffing_requirements",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("scope_kind", sa.String(length=16), nullable=False),
        sa.Column("department", sa.String(length=128), nullable=True),
        sa.Column("duty_unit", sa.String(length=128), nullable=True),
        sa.Column("duty_post", sa.String(length=128), nullable=True),
        sa.Column(
            "shift_definition_id",
            sa.Integer(),
            sa.ForeignKey("work_shift_definitions.id"),
            nullable=True,
        ),
        sa.Column("minimum_headcount", sa.Integer(), nullable=False),
        sa.Column("effective_from", sa.Date(), nullable=False),
        sa.Column("effective_to", sa.Date(), nullable=True),
        sa.Column("created_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        _created_at(),
        _updated_at(),
        sa.Column("approved_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("approved_at", sa.DateTime(), nullable=True),
        sa.Column(
            "supersedes_requirement_id",
            sa.Integer(),
            sa.ForeignKey("work_staffing_requirements.id"),
            nullable=True,
        ),
        sa.CheckConstraint(
            "scope_kind IN ('department', 'duty_unit', 'duty_post')",
            name="ck_work_staffing_requirements_scope_kind",
        ),
        sa.CheckConstraint(
            "(scope_kind = 'department' AND department IS NOT NULL AND duty_unit IS NULL "
            "AND duty_post IS NULL) OR "
            "(scope_kind = 'duty_unit' AND duty_unit IS NOT NULL AND duty_post IS NULL) OR "
            "(scope_kind = 'duty_post' AND duty_unit IS NOT NULL AND duty_post IS NOT NULL)",
            name="ck_work_staffing_requirements_hierarchy",
        ),
        sa.CheckConstraint(
            "minimum_headcount >= 0", name="ck_work_staffing_requirements_headcount_nonnegative"
        ),
        sa.CheckConstraint(
            "effective_to IS NULL OR effective_to > effective_from",
            name="ck_work_staffing_requirements_effective_window",
        ),
        sa.CheckConstraint(
            "(approved_by_user_id IS NULL AND approved_at IS NULL) OR "
            "(approved_by_user_id IS NOT NULL AND approved_at IS NOT NULL)",
            name="ck_work_staffing_requirements_approval_pair",
        ),
    )
    op.create_index(
        "ix_work_staffing_requirements_match",
        "work_staffing_requirements",
        [
            "scope_kind",
            "department",
            "duty_unit",
            "duty_post",
            "shift_definition_id",
            "effective_from",
        ],
    )
    op.create_table(
        "work_attendance_policies",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "shift_definition_id",
            sa.Integer(),
            sa.ForeignKey("work_shift_definitions.id"),
            nullable=True,
        ),
        sa.Column("grace_minutes", sa.Integer(), nullable=False),
        sa.Column("absence_after_minutes", sa.Integer(), nullable=False),
        sa.Column("early_exit_grace_minutes", sa.Integer(), nullable=False),
        sa.Column("match_before_minutes", sa.Integer(), nullable=False),
        sa.Column("match_after_minutes", sa.Integer(), nullable=False),
        sa.Column("require_checkout", sa.Boolean(), nullable=False, server_default="1"),
        sa.Column("effective_from", sa.Date(), nullable=False),
        sa.Column("effective_to", sa.Date(), nullable=True),
        sa.Column("created_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        _created_at(),
        _updated_at(),
        sa.Column("approved_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("approved_at", sa.DateTime(), nullable=True),
        sa.Column(
            "supersedes_policy_id",
            sa.Integer(),
            sa.ForeignKey("work_attendance_policies.id"),
            nullable=True,
        ),
        sa.CheckConstraint(
            "grace_minutes >= 0 AND absence_after_minutes >= grace_minutes "
            "AND early_exit_grace_minutes >= 0 AND match_before_minutes >= 0 "
            "AND match_after_minutes >= 0",
            name="ck_work_attendance_policies_minutes_nonnegative",
        ),
        sa.CheckConstraint(
            "effective_to IS NULL OR effective_to > effective_from",
            name="ck_work_attendance_policies_effective_window",
        ),
        sa.CheckConstraint(
            "(approved_by_user_id IS NULL AND approved_at IS NULL) OR "
            "(approved_by_user_id IS NOT NULL AND approved_at IS NOT NULL)",
            name="ck_work_attendance_policies_approval_pair",
        ),
    )
    op.create_index(
        "ix_work_attendance_policies_shift_effective",
        "work_attendance_policies",
        ["shift_definition_id", "effective_from"],
    )
    op.create_table(
        "attendance_provider_people",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("provider", sa.String(length=32), nullable=False),
        sa.Column("external_person_id", sa.String(length=128), nullable=False),
        sa.Column("external_employee_code", sa.String(length=64), nullable=True),
        sa.Column("display_name_snapshot", sa.String(length=256), nullable=True),
        sa.Column("employee_id", sa.String(length=16), sa.ForeignKey("employees.id"), nullable=True),
        sa.Column("mapping_state", sa.String(length=16), nullable=False, server_default="unmapped"),
        sa.Column("verified_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("verified_at", sa.DateTime(), nullable=True),
        sa.Column("active", sa.Boolean(), nullable=False, server_default="1"),
        sa.Column(
            "first_seen_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.current_timestamp(),
        ),
        sa.Column(
            "last_seen_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.current_timestamp(),
        ),
        sa.Column("source_updated_at", sa.DateTime(), nullable=True),
        sa.UniqueConstraint(
            "provider", "external_person_id", name="uq_attendance_provider_people_natural_key"
        ),
        sa.CheckConstraint(
            "mapping_state IN ('unmapped', 'verified', 'conflict', 'ignored')",
            name="ck_attendance_provider_people_mapping_state",
        ),
        sa.CheckConstraint(
            "mapping_state != 'verified' OR (employee_id IS NOT NULL "
            "AND verified_by_user_id IS NOT NULL AND verified_at IS NOT NULL)",
            name="ck_attendance_provider_people_verified_fields",
        ),
    )
    op.create_index(
        "uq_attendance_provider_people_verified_active_employee",
        "attendance_provider_people",
        ["employee_id"],
        unique=True,
        sqlite_where=sa.text("active = 1 AND mapping_state = 'verified'"),
    )
    op.create_index(
        "ix_attendance_provider_people_provider_employee_code",
        "attendance_provider_people",
        ["provider", "external_employee_code"],
    )
    op.create_table(
        "attendance_punches",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("provider", sa.String(length=32), nullable=False),
        sa.Column("external_event_id", sa.String(length=128), nullable=False),
        sa.Column(
            "provider_person_id",
            sa.Integer(),
            sa.ForeignKey("attendance_provider_people.id"),
            nullable=False,
        ),
        sa.Column("occurred_at", sa.DateTime(), nullable=False),
        sa.Column("direction", sa.String(length=16), nullable=False, server_default="unknown"),
        sa.Column("device_id", sa.String(length=128), nullable=True),
        sa.Column("device_name", sa.String(length=256), nullable=True),
        sa.Column("source_updated_at", sa.DateTime(), nullable=True),
        sa.Column(
            "imported_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.current_timestamp(),
        ),
        sa.Column("normalized_payload_hash", sa.String(length=128), nullable=False),
        sa.UniqueConstraint("provider", "external_event_id", name="uq_attendance_punches_natural_key"),
        sa.CheckConstraint("direction IN ('in', 'out', 'unknown')", name="ck_attendance_punches_direction"),
    )
    op.create_index(
        "ix_attendance_punches_person_occurred",
        "attendance_punches",
        ["provider_person_id", "occurred_at"],
    )
    op.create_table(
        "attendance_sync_state",
        sa.Column("provider", sa.String(length=32), primary_key=True),
        sa.Column("stream", sa.String(length=32), primary_key=True),
        sa.Column("cursor", sa.Text(), nullable=True),
        sa.Column("last_attempt_at", sa.DateTime(), nullable=True),
        sa.Column("last_success_at", sa.DateTime(), nullable=True),
        sa.Column("window_since", sa.DateTime(), nullable=True),
        sa.Column("window_until", sa.DateTime(), nullable=True),
        sa.Column("fresh_through", sa.DateTime(), nullable=True),
        sa.Column("last_event_at", sa.DateTime(), nullable=True),
        sa.Column("last_import_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_error_code", sa.String(length=64), nullable=True),
        sa.Column("last_error_summary", sa.String(length=512), nullable=True),
        sa.Column("consecutive_failures", sa.Integer(), nullable=False, server_default="0"),
        _updated_at(),
        sa.CheckConstraint(
            "last_import_count >= 0", name="ck_attendance_sync_state_import_count_nonnegative"
        ),
        sa.CheckConstraint(
            "consecutive_failures >= 0", name="ck_attendance_sync_state_failures_nonnegative"
        ),
        sa.CheckConstraint(
            "(window_since IS NULL AND window_until IS NULL) OR "
            "(window_since IS NOT NULL AND window_until IS NOT NULL AND window_until > window_since)",
            name="ck_attendance_sync_state_window_pair",
        ),
    )
    op.create_table(
        "attendance_evaluation_queue",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("employee_id", sa.String(length=16), sa.ForeignKey("employees.id"), nullable=False),
        sa.Column("window_start_at", sa.DateTime(), nullable=False),
        sa.Column("window_end_at", sa.DateTime(), nullable=False),
        sa.Column("reason_codes", sa.JSON(), nullable=False),
        sa.Column(
            "available_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.current_timestamp(),
        ),
        sa.Column("lease_until", sa.DateTime(), nullable=True),
        sa.Column("failed_at", sa.DateTime(), nullable=True),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_error_code", sa.String(length=64), nullable=True),
        sa.Column("last_error_summary", sa.String(length=512), nullable=True),
        _created_at(),
        _updated_at(),
        sa.CheckConstraint(
            "window_end_at > window_start_at AND "
            "julianday(window_end_at) - julianday(window_start_at) <= 31.0",
            name="ck_attendance_evaluation_queue_window_bounded",
        ),
        sa.CheckConstraint("attempts >= 0", name="ck_attendance_evaluation_queue_attempts_nonnegative"),
        sa.CheckConstraint(
            "json_valid(reason_codes) AND json_type(reason_codes) = 'array' "
            "AND json_array_length(reason_codes) BETWEEN 1 AND 32",
            name="ck_attendance_evaluation_queue_reason_codes_bounded_array",
        ),
    )
    op.create_index(
        "ix_attendance_evaluation_queue_claim",
        "attendance_evaluation_queue",
        ["available_at", "lease_until", "created_at"],
    )
    op.create_index(
        "ix_attendance_evaluation_queue_employee_window",
        "attendance_evaluation_queue",
        ["employee_id", "window_start_at"],
    )
    op.create_table(
        "duty_assignment_events",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("employee_id", sa.String(length=16), sa.ForeignKey("employees.id"), nullable=False),
        sa.Column("event_type", sa.String(length=32), nullable=False),
        sa.Column("from_department", sa.String(length=128), nullable=True),
        sa.Column("from_unit", sa.String(length=128), nullable=True),
        sa.Column("from_post", sa.String(length=128), nullable=True),
        sa.Column("to_department", sa.String(length=128), nullable=True),
        sa.Column("to_unit", sa.String(length=128), nullable=True),
        sa.Column("to_post", sa.String(length=128), nullable=True),
        sa.Column("effective_at", sa.DateTime(), nullable=False),
        sa.Column(
            "document_id",
            sa.Integer(),
            sa.ForeignKey("documents.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "actor_user_id",
            sa.Integer(),
            sa.ForeignKey("users.id"),
            nullable=True,
        ),
        sa.Column("reason", sa.String(length=1024), nullable=True),
        _created_at(),
        sa.CheckConstraint(
            "event_type IN ('baseline', 'initial_placement', 'transfer', 'manual_change')",
            name="ck_duty_assignment_events_event_type",
        ),
        sa.CheckConstraint(
            "actor_user_id IS NOT NULL OR event_type = 'baseline'",
            name="ck_duty_assignment_events_actor_required",
        ),
        sa.CheckConstraint(
            "from_post IS NULL OR from_unit IS NOT NULL",
            name="ck_duty_assignment_events_from_hierarchy_prefix",
        ),
        sa.CheckConstraint(
            "to_post IS NULL OR to_unit IS NOT NULL",
            name="ck_duty_assignment_events_to_hierarchy_prefix",
        ),
    )
    op.create_index(
        "ix_duty_assignment_events_employee_effective",
        "duty_assignment_events",
        ["employee_id", "effective_at"],
    )
    op.create_table(
        "attendance_cases",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("employee_id", sa.String(length=16), sa.ForeignKey("employees.id"), nullable=False),
        sa.Column(
            "shift_occurrence_id",
            sa.Integer(),
            sa.ForeignKey("work_shift_occurrences.id"),
            nullable=True,
        ),
        sa.Column(
            "shift_override_id", sa.Integer(), sa.ForeignKey("work_shift_overrides.id"), nullable=True
        ),
        sa.Column(
            "duty_assignment_event_id",
            sa.Integer(),
            sa.ForeignKey("duty_assignment_events.id"),
            nullable=True,
        ),
        sa.Column("employee_status_snapshot", sa.String(length=32), nullable=False),
        sa.Column("crew_code_snapshot", sa.String(length=64), nullable=True),
        sa.Column("crew_name_snapshot", sa.String(length=256), nullable=True),
        sa.Column("shift_code_snapshot", sa.String(length=32), nullable=False),
        sa.Column("department_snapshot", sa.String(length=128), nullable=True),
        sa.Column("duty_unit_snapshot", sa.String(length=128), nullable=True),
        sa.Column("duty_post_snapshot", sa.String(length=128), nullable=True),
        sa.Column("scheduled_start_at", sa.DateTime(), nullable=False),
        sa.Column("scheduled_end_at", sa.DateTime(), nullable=False),
        sa.Column("operational_date", sa.Date(), nullable=False),
        sa.Column("organization_snapshot_state", sa.String(length=16), nullable=False),
        _created_at(),
        sa.UniqueConstraint(
            "employee_id", "scheduled_start_at", name="uq_attendance_cases_employee_scheduled_start"
        ),
        sa.CheckConstraint(
            "(shift_occurrence_id IS NOT NULL AND shift_override_id IS NULL) OR "
            "(shift_occurrence_id IS NULL AND shift_override_id IS NOT NULL)",
            name="ck_attendance_cases_schedule_source_required",
        ),
        sa.CheckConstraint("scheduled_end_at > scheduled_start_at", name="ck_attendance_cases_scheduled_window"),
        sa.CheckConstraint(
            "organization_snapshot_state IN ('captured', 'reconstructed', 'unknown')",
            name="ck_attendance_cases_organization_snapshot_state",
        ),
    )
    op.create_index("ix_attendance_cases_operational_date", "attendance_cases", ["operational_date"])
    op.create_table(
        "attendance_evaluations",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "attendance_case_id", sa.Integer(), sa.ForeignKey("attendance_cases.id"), nullable=False
        ),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column(
            "provider_person_id",
            sa.Integer(),
            sa.ForeignKey("attendance_provider_people.id"),
            nullable=True,
        ),
        sa.Column("first_in_at", sa.DateTime(), nullable=True),
        sa.Column("latest_in_at", sa.DateTime(), nullable=True),
        sa.Column("final_out_at", sa.DateTime(), nullable=True),
        sa.Column("last_directional_punch_at", sa.DateTime(), nullable=True),
        sa.Column("last_direction", sa.String(length=16), nullable=True),
        sa.Column("presence_state", sa.String(length=32), nullable=False),
        sa.Column("reason_code", sa.String(length=128), nullable=False),
        sa.Column("late_minutes", sa.Integer(), nullable=True),
        sa.Column("early_exit_minutes", sa.Integer(), nullable=True),
        sa.Column("missing_checkout", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("sync_fresh_through", sa.DateTime(), nullable=True),
        sa.Column(
            "policy_id", sa.Integer(), sa.ForeignKey("work_attendance_policies.id"), nullable=True
        ),
        sa.Column("algorithm_version", sa.String(length=64), nullable=False),
        sa.Column("input_fingerprint", sa.String(length=128), nullable=False),
        sa.Column(
            "evaluated_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.current_timestamp(),
        ),
        sa.UniqueConstraint(
            "attendance_case_id", "revision", name="uq_attendance_evaluations_case_revision"
        ),
        sa.UniqueConstraint(
            "attendance_case_id",
            "input_fingerprint",
            name="uq_attendance_evaluations_case_fingerprint",
        ),
        sa.UniqueConstraint(
            "id",
            "attendance_case_id",
            name="uq_attendance_evaluations_id_case",
        ),
        sa.CheckConstraint("revision > 0", name="ck_attendance_evaluations_revision_positive"),
        sa.CheckConstraint(
            "last_direction IS NULL OR last_direction IN ('in', 'out')",
            name="ck_attendance_evaluations_last_direction",
        ),
        sa.CheckConstraint(
            "presence_state IN ('scheduled', 'on_duty', 'completed', 'absent', "
            "'excused_leave', 'off', 'unknown')",
            name="ck_attendance_evaluations_presence_state",
        ),
        sa.CheckConstraint(
            "late_minutes IS NULL OR late_minutes >= 0",
            name="ck_attendance_evaluations_late_nonnegative",
        ),
        sa.CheckConstraint(
            "early_exit_minutes IS NULL OR early_exit_minutes >= 0",
            name="ck_attendance_evaluations_early_exit_nonnegative",
        ),
    )
    op.create_index(
        "ix_attendance_evaluations_case_evaluated",
        "attendance_evaluations",
        ["attendance_case_id", "evaluated_at"],
    )
    op.create_table(
        "attendance_punch_assignments",
        sa.Column(
            "punch_id", sa.Integer(), sa.ForeignKey("attendance_punches.id"), primary_key=True
        ),
        sa.Column(
            "attendance_case_id", sa.Integer(), sa.ForeignKey("attendance_cases.id"), nullable=False
        ),
        sa.Column("algorithm_version", sa.String(length=64), nullable=False),
        sa.Column(
            "assigned_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.current_timestamp(),
        ),
        _updated_at(),
    )
    op.create_index(
        "ix_attendance_punch_assignments_case", "attendance_punch_assignments", ["attendance_case_id"]
    )
    op.create_table(
        "attendance_evaluation_punch_sources",
        sa.Column(
            "evaluation_id",
            sa.Integer(),
            sa.ForeignKey("attendance_evaluations.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "punch_id",
            sa.Integer(),
            sa.ForeignKey("attendance_punches.id", ondelete="RESTRICT"),
            primary_key=True,
        ),
        sa.Column("ordinal", sa.Integer(), nullable=False),
        sa.UniqueConstraint(
            "evaluation_id", "ordinal", name="uq_attendance_evaluation_punch_sources_ordinal"
        ),
        sa.CheckConstraint("ordinal > 0", name="ck_attendance_evaluation_punch_sources_ordinal"),
    )
    op.create_table(
        "attendance_evaluation_leave_sources",
        sa.Column(
            "evaluation_id",
            sa.Integer(),
            sa.ForeignKey("attendance_evaluations.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "leave_id",
            sa.Integer(),
            sa.ForeignKey("leaves.id", ondelete="RESTRICT"),
            primary_key=True,
        ),
        sa.Column("is_primary", sa.Boolean(), nullable=False, server_default="0"),
    )
    op.create_index(
        "uq_attendance_evaluation_leave_sources_primary",
        "attendance_evaluation_leave_sources",
        ["evaluation_id"],
        unique=True,
        sqlite_where=sa.text("is_primary = 1"),
    )

    op.create_table(
        "attendance_adjustments",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "attendance_case_id", sa.Integer(), sa.ForeignKey("attendance_cases.id"), nullable=False
        ),
        sa.Column("base_evaluation_id", sa.Integer(), nullable=False),
        sa.Column("replacement_presence_state", sa.String(length=32), nullable=True),
        sa.Column("replacement_first_in_at", sa.DateTime(), nullable=True),
        sa.Column("replacement_latest_in_at", sa.DateTime(), nullable=True),
        sa.Column("replacement_final_out_at", sa.DateTime(), nullable=True),
        sa.Column("replacement_late_minutes", sa.Integer(), nullable=True),
        sa.Column("replacement_early_exit_minutes", sa.Integer(), nullable=True),
        sa.Column("replacement_missing_checkout", sa.Boolean(), nullable=True),
        sa.Column("reason", sa.String(length=1024), nullable=False),
        sa.Column("created_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        _created_at(),
        sa.Column(
            "supersedes_adjustment_id",
            sa.Integer(),
            sa.ForeignKey("attendance_adjustments.id"),
            nullable=True,
        ),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
        sa.Column("revoked_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.ForeignKeyConstraint(
            ["base_evaluation_id", "attendance_case_id"],
            ["attendance_evaluations.id", "attendance_evaluations.attendance_case_id"],
            name="fk_attendance_adjustments_base_evaluation_case",
        ),
        sa.CheckConstraint(
            "replacement_presence_state IS NULL OR replacement_presence_state IN "
            "('scheduled', 'on_duty', 'completed', 'absent', 'excused_leave', 'off', 'unknown')",
            name="ck_attendance_adjustments_presence_state",
        ),
        sa.CheckConstraint(
            "replacement_late_minutes IS NULL OR replacement_late_minutes >= 0",
            name="ck_attendance_adjustments_late_nonnegative",
        ),
        sa.CheckConstraint(
            "replacement_early_exit_minutes IS NULL OR replacement_early_exit_minutes >= 0",
            name="ck_attendance_adjustments_early_exit_nonnegative",
        ),
    )
    op.create_index(
        "ix_attendance_adjustments_case_created",
        "attendance_adjustments",
        ["attendance_case_id", "created_at"],
    )
    op.create_table(
        "user_workforce_scopes",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("scope_kind", sa.String(length=16), nullable=False),
        sa.Column("department", sa.String(length=128), nullable=True),
        sa.Column("duty_unit", sa.String(length=128), nullable=True),
        sa.Column("duty_post", sa.String(length=128), nullable=True),
        sa.Column("created_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        _created_at(),
        sa.CheckConstraint(
            "(scope_kind = 'organization' AND department IS NULL AND duty_unit IS NULL "
            "AND duty_post IS NULL) OR "
            "(scope_kind = 'department' AND department IS NOT NULL AND duty_unit IS NULL "
            "AND duty_post IS NULL) OR "
            "(scope_kind = 'duty_unit' AND duty_unit IS NOT NULL AND duty_post IS NULL) OR "
            "(scope_kind = 'duty_post' AND duty_unit IS NOT NULL AND duty_post IS NOT NULL)",
            name="ck_user_workforce_scopes_hierarchy",
        ),
    )
    op.execute(
        "CREATE UNIQUE INDEX uq_user_workforce_scopes_normalized_hierarchy "
        "ON user_workforce_scopes "
        "(user_id, scope_kind, COALESCE(department, ''), COALESCE(duty_unit, ''), "
        "COALESCE(duty_post, ''))"
    )


def _seed_canonical_rotation() -> None:
    """Seed immutable shift definitions and the approved 120-hour pattern."""
    connection = op.get_bind()
    for code, start_local_time in (("morning", "04:00:00"), ("noon", "12:00:00"), ("night", "20:00:00")):
        connection.execute(
            sa.text(
                "INSERT OR IGNORE INTO work_shift_definitions "
                "(code, start_local_time, duration_minutes) "
                "VALUES (:code, :start_local_time, 480)"
            ),
            {"code": code, "start_local_time": start_local_time},
        )
    connection.execute(
        sa.text(
            "INSERT OR IGNORE INTO work_rotation_patterns "
            "(code, name, cycle_minutes, timezone) "
            "VALUES ('five_team_120_hour', 'Five-team 120-hour rotation', 7200, 'Asia/Dubai')"
        )
    )
    for shift_code, offset in (("noon", 0), ("morning", 960), ("night", 1920)):
        connection.execute(
            sa.text(
                "INSERT OR IGNORE INTO work_rotation_steps "
                "(pattern_id, shift_definition_id, start_offset_minutes) "
                "SELECT pattern.id, shift.id, :offset "
                "FROM work_rotation_patterns AS pattern "
                "JOIN work_shift_definitions AS shift "
                "WHERE pattern.code = 'five_team_120_hour' AND shift.code = :shift_code"
            ),
            {"offset": offset, "shift_code": shift_code},
        )


def _seed_role_permissions() -> None:
    """Seed only approved conservative role defaults; user overrides remain untouched."""
    connection = op.get_bind()
    for role, capabilities in _ROLE_DEFAULTS.items():
        for capability in capabilities:
            connection.execute(
                sa.text(
                    "INSERT OR IGNORE INTO role_permissions (role, capability) "
                    "VALUES (:role, :capability)"
                ),
                {"role": role, "capability": capability},
            )


def _seed_baseline_duty_events() -> None:
    """Snapshot every current employee's duty hierarchy without fabricating history.

    ``department`` is copied exactly as recorded, including NULL: most of this
    roster is placed by duty unit alone and inventing a department here would
    fabricate an organization chart.  A post is dropped when its unit is
    missing, because a post that names no unit is not a hierarchy path - the
    ``to``/``from`` prefix constraints reject it, and one malformed employee row
    must not abort the upgrade for everyone else.
    """
    op.get_bind().execute(
        sa.text(
            "INSERT INTO duty_assignment_events "
            "(employee_id, event_type, from_department, from_unit, from_post, "
            "to_department, to_unit, to_post, effective_at, actor_user_id, reason) "
            "SELECT id, 'baseline', NULL, NULL, NULL, department, duty_unit, "
            "CASE WHEN duty_unit IS NULL THEN NULL ELSE duty_post END, "
            "CURRENT_TIMESTAMP, NULL, NULL FROM employees"
        )
    )


def upgrade() -> None:
    _create_workforce_tables()
    _seed_canonical_rotation()
    _seed_role_permissions()
    _seed_baseline_duty_events()


def downgrade() -> None:
    connection = op.get_bind()
    for capability in _WORKFORCE_CAPABILITIES:
        connection.execute(
            sa.text("DELETE FROM role_permissions WHERE capability = :capability"),
            {"capability": capability},
        )

    # Child-first teardown preserves the predecessor's employees, users, leaves,
    # documents, role permissions, settings, and account preferences.
    op.drop_table("user_workforce_scopes")
    op.drop_table("attendance_adjustments")
    op.drop_table("attendance_evaluation_leave_sources")
    op.drop_table("attendance_evaluation_punch_sources")
    op.drop_table("attendance_punch_assignments")
    op.drop_table("attendance_evaluations")
    op.drop_table("attendance_cases")
    op.drop_table("duty_assignment_events")
    op.drop_table("attendance_evaluation_queue")
    op.drop_table("attendance_sync_state")
    op.drop_table("attendance_punches")
    op.drop_table("attendance_provider_people")
    op.drop_table("work_attendance_policies")
    op.drop_table("work_staffing_requirements")
    op.drop_table("work_shift_overrides")
    op.drop_table("work_shift_occurrences")
    op.drop_table("work_crew_memberships")
    op.drop_table("work_crew_schedules")
    op.drop_table("work_crews")
    op.drop_table("work_rotation_steps")
    op.drop_table("work_rotation_patterns")
    op.drop_table("work_shift_definitions")
