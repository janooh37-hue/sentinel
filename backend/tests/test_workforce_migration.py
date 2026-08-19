from __future__ import annotations

from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import Connection, Engine

ROOT = Path(__file__).resolve().parents[2]
WORKFORCE_REVISION = "0071_workforce_attendance"
WORKFORCE_PREDECESSOR = "0069_merge"
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
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO employees "
                "(id, name_en, name_ar, status, department, duty_unit, duty_post, "
                "created_at, updated_at) "
                "VALUES ('G9001', 'Migration Guard', 'حارس الترحيل', 'Active', "
                "'Operations', 'North Unit', 'Gate 1', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
            )
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


def _assert_baseline_duty_event(connection: Connection) -> None:
    baseline = connection.execute(
        text(
            "SELECT event_type, to_department, to_unit, to_post, actor_user_id, effective_at "
            "FROM duty_assignment_events WHERE employee_id = 'G9001'"
        )
    ).one()
    assert baseline.event_type == "baseline"
    assert (baseline.to_department, baseline.to_unit, baseline.to_post) == (
        "Operations",
        "North Unit",
        "Gate 1",
    )
    assert baseline.actor_user_id is None
    assert baseline.effective_at is not None


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
        _assert_baseline_duty_event(connection)

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
            == 1
        )
        _assert_canonical_shift_seed(connection)
