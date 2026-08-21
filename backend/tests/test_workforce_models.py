from __future__ import annotations

from collections.abc import Iterable

from sqlalchemy import PrimaryKeyConstraint, UniqueConstraint
from sqlalchemy.sql.schema import Table

from app.db import models as db_models

MODEL_TABLES = {
    "WorkShiftDefinition": "work_shift_definitions",
    "WorkRotationPattern": "work_rotation_patterns",
    "WorkRotationStep": "work_rotation_steps",
    "WorkCrew": "work_crews",
    "WorkCrewSchedule": "work_crew_schedules",
    "WorkCrewMembership": "work_crew_memberships",
    "WorkShiftOccurrence": "work_shift_occurrences",
    "WorkShiftOverride": "work_shift_overrides",
    "WorkStaffingRequirement": "work_staffing_requirements",
    "WorkAttendancePolicy": "work_attendance_policies",
    "AttendanceProviderPerson": "attendance_provider_people",
    "AttendancePunch": "attendance_punches",
    "AttendancePunchAssignment": "attendance_punch_assignments",
    "AttendanceSyncState": "attendance_sync_state",
    "AttendanceEvaluationQueue": "attendance_evaluation_queue",
    "AttendanceCase": "attendance_cases",
    "AttendanceEvaluation": "attendance_evaluations",
    "AttendanceEvaluationPunchSource": "attendance_evaluation_punch_sources",
    "AttendanceEvaluationLeaveSource": "attendance_evaluation_leave_sources",
    "AttendanceAdjustment": "attendance_adjustments",
    "DutyAssignmentEvent": "duty_assignment_events",
    "UserWorkforceScope": "user_workforce_scopes",
}


def _table(model_name: str) -> Table:
    return getattr(db_models, model_name).__table__


def _unique_column_sets(table: Table) -> set[tuple[str, ...]]:
    return {
        tuple(column.name for column in constraint.columns)
        for constraint in table.constraints
        if isinstance(constraint, UniqueConstraint)
    } | {
        tuple(column.name for column in index.columns)
        for index in table.indexes
        if index.unique
    }


def _primary_key_columns(table: Table) -> tuple[str, ...]:
    primary_key = next(
        constraint
        for constraint in table.constraints
        if isinstance(constraint, PrimaryKeyConstraint)
    )
    return tuple(column.name for column in primary_key.columns)


def _foreign_key(table: Table, column_name: str):
    foreign_keys = table.c[column_name].foreign_keys
    assert len(foreign_keys) == 1
    return next(iter(foreign_keys))


def _assert_columns_are_absent(table: Table, columns: Iterable[str]) -> None:
    assert not (set(columns) & set(table.c))


def test_workforce_models_are_reexported_and_registered_with_exact_tables() -> None:
    assert set(MODEL_TABLES.values()) <= set(db_models.Base.metadata.tables)

    for model_name, table_name in MODEL_TABLES.items():
        assert _table(model_name).name == table_name


def test_workforce_rotation_and_schedule_keys_are_unique() -> None:
    assert ("pattern_id", "start_offset_minutes") in _unique_column_sets(
        _table("WorkRotationStep")
    )
    assert ("crew_id", "version") in _unique_column_sets(_table("WorkCrewSchedule"))
    assert ("employee_id", "effective_from") in _unique_column_sets(
        _table("WorkCrewMembership")
    )
    assert ("crew_id", "starts_at") in _unique_column_sets(_table("WorkShiftOccurrence"))


def test_workforce_rotation_and_scope_foreign_keys_preserve_ownership() -> None:
    rotation_pattern_fk = _foreign_key(_table("WorkRotationStep"), "pattern_id")
    assert rotation_pattern_fk.target_fullname == "work_rotation_patterns.id"
    assert rotation_pattern_fk.ondelete == "CASCADE"

    scope_user_fk = _foreign_key(_table("UserWorkforceScope"), "user_id")
    assert scope_user_fk.target_fullname == "users.id"
    assert scope_user_fk.ondelete == "CASCADE"


def test_workforce_scope_index_normalizes_nullable_hierarchy_keys() -> None:
    scope = _table("UserWorkforceScope")

    assert scope.c.department.nullable is True
    assert scope.c.duty_unit.nullable is True
    assert scope.c.duty_post.nullable is True
    assert any(
        index.unique and "coalesce" in str(index).lower() for index in scope.indexes
    )


def test_provider_identity_and_raw_punches_keep_their_stable_natural_keys() -> None:
    provider_person = _table("AttendanceProviderPerson")
    punches = _table("AttendancePunch")

    assert ("provider", "external_person_id") in _unique_column_sets(provider_person)
    assert ("provider", "external_event_id") in _unique_column_sets(punches)
    assert provider_person.c.employee_id.nullable is True
    assert _foreign_key(provider_person, "employee_id").target_fullname == "employees.id"
    assert _foreign_key(punches, "provider_person_id").target_fullname == (
        "attendance_provider_people.id"
    )
    _assert_columns_are_absent(punches, ("updated_at", "deleted_at"))


def test_verified_provider_mapping_has_a_partial_unique_employee_guard() -> None:
    provider_person = _table("AttendanceProviderPerson")
    partial_mapping_indexes = [
        index
        for index in provider_person.indexes
        if index.unique and tuple(index.columns.keys()) == ("employee_id",)
    ]

    assert len(partial_mapping_indexes) == 1
    sqlite_where = partial_mapping_indexes[0].dialect_options["sqlite"]["where"]
    assert sqlite_where is not None
    assert "active" in str(sqlite_where).lower()
    assert "verified" in str(sqlite_where).lower()


def test_current_punch_allocation_cannot_assign_one_punch_to_multiple_cases() -> None:
    assignment = _table("AttendancePunchAssignment")

    assert _primary_key_columns(assignment) == ("punch_id",)
    punch_fk = _foreign_key(assignment, "punch_id")
    assert punch_fk.target_fullname == "attendance_punches.id"
    assert _foreign_key(assignment, "attendance_case_id").target_fullname == "attendance_cases.id"


def test_sync_state_uses_provider_and_stream_as_its_identity() -> None:
    sync_state = _table("AttendanceSyncState")

    assert _primary_key_columns(sync_state) == ("provider", "stream")
    assert {"cursor", "window_since", "window_until", "fresh_through"} <= set(
        sync_state.c.keys()
    )


def test_queue_has_claim_index_and_bounded_evaluation_window_shape() -> None:
    queue = _table("AttendanceEvaluationQueue")

    assert any(
        tuple(index.columns.keys()) == ("available_at", "lease_until", "created_at")
        for index in queue.indexes
    )
    assert {"window_start_at", "window_end_at", "reason_codes", "failed_at"} <= set(
        queue.c.keys()
    )


def test_case_allows_only_the_documented_nullable_schedule_associations() -> None:
    case = _table("AttendanceCase")

    assert case.c.shift_occurrence_id.nullable is True
    assert case.c.shift_override_id.nullable is True
    assert case.c.duty_assignment_event_id.nullable is True
    assert _foreign_key(case, "shift_occurrence_id").target_fullname == "work_shift_occurrences.id"
    assert _foreign_key(case, "shift_override_id").target_fullname == "work_shift_overrides.id"
    assert _foreign_key(case, "duty_assignment_event_id").target_fullname == "duty_assignment_events.id"


def test_evaluations_are_revisioned_append_only_records() -> None:
    evaluation = _table("AttendanceEvaluation")

    assert ("attendance_case_id", "revision") in _unique_column_sets(evaluation)
    assert ("attendance_case_id", "input_fingerprint") in _unique_column_sets(evaluation)
    assert evaluation.c.provider_person_id.nullable is True
    _assert_columns_are_absent(evaluation, ("updated_at", "deleted_at"))


def test_evaluation_source_links_preserve_immutable_evidence() -> None:
    punch_source = _table("AttendanceEvaluationPunchSource")
    leave_source = _table("AttendanceEvaluationLeaveSource")

    assert _primary_key_columns(punch_source) == ("evaluation_id", "punch_id")
    assert ("evaluation_id", "ordinal") in _unique_column_sets(punch_source)
    assert _primary_key_columns(leave_source) == ("evaluation_id", "leave_id")
    assert leave_source.c.is_primary.nullable is False

    for table in (punch_source, leave_source):
        evaluation_fk = _foreign_key(table, "evaluation_id")
        assert evaluation_fk.target_fullname == "attendance_evaluations.id"
        assert evaluation_fk.ondelete == "CASCADE"
        _assert_columns_are_absent(table, ("id", "updated_at", "deleted_at"))

    punch_fk = _foreign_key(punch_source, "punch_id")
    assert punch_fk.target_fullname == "attendance_punches.id"
    assert punch_fk.ondelete == "RESTRICT"

    leave_fk = _foreign_key(leave_source, "leave_id")
    assert leave_fk.target_fullname == "leaves.id"
    assert leave_fk.ondelete == "RESTRICT"


def test_work_override_and_adjustment_keep_audited_nullable_links() -> None:
    override = _table("WorkShiftOverride")
    adjustment = _table("AttendanceAdjustment")

    assert override.c.shift_definition_id.nullable is True
    assert override.c.crew_id.nullable is True
    assert override.c.cancelled_at.nullable is True
    assert adjustment.c.supersedes_adjustment_id.nullable is True
    assert adjustment.c.revoked_at.nullable is True
    assert adjustment.c.revoked_by_user_id.nullable is True
