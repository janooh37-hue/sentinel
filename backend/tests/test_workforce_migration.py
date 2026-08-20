from __future__ import annotations

from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import Connection, Engine
from sqlalchemy.exc import IntegrityError

ROOT = Path(__file__).resolve().parents[2]
WORKFORCE_REVISION = "0071_workforce_attendance"
WORKFORCE_PREDECESSOR = "0070_timesheet"
WORKFORCE_TABLES = {
    "work_shift_definitions",
    "work_rotation_patterns",
    "work_rotation_steps",
    "work_crews",
    "work_crew_schedules",
    "work_crew_memberships",
    "work_shift_occurrences",
    "work_shift_overrides",
    "work_staffing_requirements",
    "work_attendance_policies",
    "attendance_provider_people",
    "attendance_punches",
    "attendance_punch_assignments",
    "attendance_sync_state",
    "attendance_evaluation_queue",
    "attendance_cases",
    "attendance_evaluations",
    "attendance_evaluation_punch_sources",
    "attendance_evaluation_leave_sources",
    "attendance_adjustments",
    "duty_assignment_events",
    "user_workforce_scopes",
}
WORKFORCE_CAPABILITIES = {
    "workforce.self.view",
    "workforce.dashboard.view",
    "workforce.people.view",
    "workforce.schedule.manage",
    "workforce.policy.manage",
    "workforce.attendance.review",
    "workforce.attendance.correct",
    "workforce.integration.manage",
}
def _alembic_config(database: Path) -> Config:
    config = Config(str(ROOT / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", f"sqlite:///{database}")
    return config


def _resolve_workforce_revisions(config: Config) -> tuple[str, str]:
    script = ScriptDirectory.from_config(config)
    heads = script.get_heads()

    assert len(heads) == 1
    revision = heads[0]
    assert revision == WORKFORCE_REVISION

    predecessor = script.get_revision(revision).down_revision
    assert predecessor == WORKFORCE_PREDECESSOR
    assert isinstance(predecessor, str)
    return revision, predecessor


def _seed_predecessor_data(engine: Engine) -> None:
    """Seed the four placement shapes this roster actually contains.

    Most employees are placed by duty unit with no department recorded, and one
    row carries a post with no unit at all, which is not a hierarchy path.
    """
    with engine.begin() as connection:
        for employee_id, name_en, department, duty_unit, duty_post in (
            ("G9001", "Migration Guard", "Operations", "North Unit", "Gate 1"),
            ("G9002", "Company Guard", None, "السرية الأولى", "Gate 2"),
            ("G9003", "Support Guard", None, "Support Group", None),
            ("G9004", "Unplaced Guard", None, None, None),
            ("G9005", "Orphan Post Guard", None, None, "Gate 5"),
        ):
            connection.execute(
                text(
                    "INSERT INTO employees "
                    "(id, name_en, name_ar, status, department, duty_unit, duty_post, "
                    "created_at, updated_at) "
                    "VALUES (:id, :name_en, 'حارس الترحيل', 'Active', :department, "
                    ":duty_unit, :duty_post, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                ),
                {
                    "id": employee_id,
                    "name_en": name_en,
                    "department": department,
                    "duty_unit": duty_unit,
                    "duty_post": duty_post,
                },
            )
        connection.execute(
            text(
                "INSERT INTO users (id, email, password_hash, role, status) "
                "VALUES (1, 'workforce-migration@test.ae', 'not-a-login-secret', "
                "'operator', 'active')"
            )
        )


def _assert_canonical_shift_seed(connection: Connection) -> None:
    shifts = {
        row.code: (str(row.start_local_time)[:5], row.duration_minutes)
        for row in connection.execute(
            text(
                "SELECT code, start_local_time, duration_minutes "
                "FROM work_shift_definitions ORDER BY code"
            )
        )
    }
    assert shifts == {
        "morning": ("04:00", 480),
        "night": ("20:00", 480),
        "noon": ("12:00", 480),
    }

    pattern = connection.execute(
        text(
            "SELECT id, cycle_minutes, timezone FROM work_rotation_patterns "
            "WHERE cycle_minutes = 7200 AND timezone = 'Asia/Dubai'"
        )
    ).one()
    steps = {
        (row.code, row.start_offset_minutes)
        for row in connection.execute(
            text(
                "SELECT shift.code, step.start_offset_minutes "
                "FROM work_rotation_steps AS step "
                "JOIN work_shift_definitions AS shift ON shift.id = step.shift_definition_id "
                "WHERE step.pattern_id = :pattern_id"
            ),
            {"pattern_id": pattern.id},
        )
    }
    assert steps == {("noon", 0), ("morning", 960), ("night", 1920)}


def _assert_conservative_capability_seed(connection: Connection) -> None:
    caps_by_role: dict[str, set[str]] = {}
    for row in connection.execute(
        text(
            "SELECT role, capability FROM role_permissions "
            "WHERE capability LIKE 'workforce.%'"
        )
    ):
        caps_by_role.setdefault(row.role, set()).add(row.capability)

    assert set().union(*caps_by_role.values()) == WORKFORCE_CAPABILITIES
    assert caps_by_role["operator"] == {"workforce.self.view"}
    assert caps_by_role["admin"] >= WORKFORCE_CAPABILITIES
    assert "workforce.integration.manage" not in caps_by_role.get("manager", set())
    assert "workforce.attendance.correct" not in caps_by_role.get("manager", set())


def _assert_baseline_duty_events(connection: Connection) -> None:
    """Every employee gets one baseline holding their own recorded placement.

    A missing department stays missing - inventing one would fabricate an
    organization chart - and a post with no unit is dropped because it is not a
    hierarchy path.
    """
    events = {
        row.employee_id: (row.event_type, row.to_department, row.to_unit, row.to_post)
        for row in connection.execute(
            text(
                "SELECT employee_id, event_type, to_department, to_unit, to_post "
                "FROM duty_assignment_events"
            )
        )
    }
    assert events == {
        "G9001": ("baseline", "Operations", "North Unit", "Gate 1"),
        "G9002": ("baseline", None, "السرية الأولى", "Gate 2"),
        "G9003": ("baseline", None, "Support Group", None),
        "G9004": ("baseline", None, None, None),
        "G9005": ("baseline", None, None, None),
    }
    assert (
        connection.execute(
            text(
                "SELECT count(*) FROM duty_assignment_events WHERE effective_at IS NULL "
                "OR actor_user_id IS NOT NULL OR from_department IS NOT NULL "
                "OR from_unit IS NOT NULL OR from_post IS NOT NULL"
            )
        ).scalar_one()
        == 0
    )


def test_workforce_migration_is_the_single_next_head_from_the_merge_head(tmp_path: Path) -> None:
    config = _alembic_config(tmp_path / "workforce-head.db")

    revision, predecessor = _resolve_workforce_revisions(config)

    assert revision == WORKFORCE_REVISION
    assert predecessor == WORKFORCE_PREDECESSOR


def test_workforce_migration_round_trip_preserves_existing_data_and_seeds(tmp_path: Path) -> None:
    database = tmp_path / "workforce-round-trip.db"
    engine = create_engine(f"sqlite:///{database}")
    config = _alembic_config(database)
    workforce_revision, predecessor = _resolve_workforce_revisions(config)

    command.upgrade(config, predecessor)
    _seed_predecessor_data(engine)

    command.upgrade(config, workforce_revision)
    with engine.connect() as connection:
        assert set(inspect(connection).get_table_names()) >= WORKFORCE_TABLES
        assert connection.execute(
            text(
                "SELECT name_en, department, duty_unit, duty_post "
                "FROM employees WHERE id = 'G9001'"
            )
        ).one() == ("Migration Guard", "Operations", "North Unit", "Gate 1")
        _assert_canonical_shift_seed(connection)
        _assert_conservative_capability_seed(connection)
        _assert_baseline_duty_events(connection)

    command.downgrade(config, predecessor)
    with engine.connect() as connection:
        assert not (WORKFORCE_TABLES & set(inspect(connection).get_table_names()))
        assert connection.execute(
            text(
                "SELECT name_en, department, duty_unit, duty_post "
                "FROM employees WHERE id = 'G9001'"
            )
        ).one() == ("Migration Guard", "Operations", "North Unit", "Gate 1")
        assert connection.execute(
            text("SELECT count(*) FROM role_permissions WHERE capability LIKE 'workforce.%'")
        ).scalar_one() == 0

    command.upgrade(config, workforce_revision)
    with engine.connect() as connection:
        assert set(inspect(connection).get_table_names()) >= WORKFORCE_TABLES
        assert (
            connection.execute(text("SELECT count(*) FROM work_shift_definitions")).scalar_one()
            == 3
        )
        assert (
            connection.execute(text("SELECT count(*) FROM work_rotation_patterns")).scalar_one()
            == 1
        )
        assert (
            connection.execute(text("SELECT count(*) FROM duty_assignment_events")).scalar_one()
            == 5
        )
        _assert_canonical_shift_seed(connection)


def test_workforce_placement_accepts_unit_rooted_paths_and_rejects_orphan_posts(
    tmp_path: Path,
) -> None:
    """Placement needs a unit for a post, never a department for a unit."""
    database = tmp_path / "workforce-unit-rooted.db"
    engine = create_engine(f"sqlite:///{database}")
    config = _alembic_config(database)
    workforce_revision, predecessor = _resolve_workforce_revisions(config)

    command.upgrade(config, predecessor)
    _seed_predecessor_data(engine)
    command.upgrade(config, workforce_revision)

    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO duty_assignment_events "
                "(employee_id, event_type, to_unit, to_post, effective_at, actor_user_id) "
                "VALUES ('G9002', 'transfer', 'Support Group', 'Gate 7', "
                "CURRENT_TIMESTAMP, 1)"
            )
        )
        connection.execute(
            text(
                "INSERT INTO work_shift_overrides "
                "(employee_id, assignment_kind, reason_kind, starts_at, ends_at, "
                "duty_unit, duty_post, reason, created_by_user_id) "
                "VALUES ('G9002', 'off', 'other', '2026-08-20 04:00:00', "
                "'2026-08-20 12:00:00', 'Support Group', 'Gate 7', 'unit-rooted', 1)"
            )
        )

    with engine.connect() as connection:
        with pytest.raises(IntegrityError):
            connection.execute(
                text(
                    "INSERT INTO duty_assignment_events "
                    "(employee_id, event_type, to_post, effective_at, actor_user_id) "
                    "VALUES ('G9002', 'transfer', 'Gate 9', CURRENT_TIMESTAMP, 1)"
                )
            )
        connection.rollback()
        with pytest.raises(IntegrityError):
            connection.execute(
                text(
                    "INSERT INTO work_shift_overrides "
                    "(employee_id, assignment_kind, reason_kind, starts_at, ends_at, "
                    "duty_post, reason, created_by_user_id) "
                    "VALUES ('G9002', 'off', 'other', '2026-08-21 04:00:00', "
                    "'2026-08-21 12:00:00', 'Gate 9', 'orphan post', 1)"
                )
            )
        connection.rollback()
