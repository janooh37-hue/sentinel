from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, text
from sqlalchemy.exc import IntegrityError

ROOT = Path(__file__).resolve().parents[2]


def _alembic_config(database: Path) -> Config:
    config = Config(str(ROOT / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", f"sqlite:///{database.as_posix()}")
    return config


def test_timesheet_roster_assignment_migration_backfills_and_downgrades(
    tmp_path: Path,
) -> None:
    database = tmp_path / "timesheet-roster-assignments.db"
    config = _alembic_config(database)
    command.upgrade(config, "0076")
    engine = create_engine(config.get_main_option("sqlalchemy.url"))

    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO employees "
                "(id, name_en, created_at, updated_at, designation_id) "
                "VALUES ('G1001', 'Assigned', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, :designation_id), "
                "('G1002', 'Unassigned', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL)"
            ),
            {"designation_id": 1},
        )

    command.upgrade(config, "0077")

    with engine.begin() as connection:
        columns = {
            row[1] for row in connection.exec_driver_sql("PRAGMA table_info(employees)")
        }
        assert "designation_id" not in columns

        assignment = connection.execute(
            text(
                "SELECT employee_id, designation_id, effective_from "
                "FROM timesheet_roster_assignments"
            )
        ).fetchall()
        assert assignment == [("G1001", 1, "2026-01-01")]

        keys = connection.execute(
            text(
                "SELECT system_key FROM timesheet_designations "
                "ORDER BY rank_order"
            )
        ).fetchall()
        assert keys[0] == ("prisons_director",)
        assert keys[-1] == ("driver",)
        assert keys == [
            ("prisons_director",),
            ("assistant_director",),
            ("project_manager",),
            ("branch_manager",),
            ("duty_in_charge",),
            ("security_supervisor",),
            ("armory_officer",),
            ("assistant_security_supervisor",),
            ("armory_keeper",),
            ("control_room_security_guard",),
            ("clinic_security_guard",),
            ("habilitation_security_guard",),
            ("escort_security_guard",),
            ("messengers",),
            ("security_guard",),
            ("driver",),
        ]

        connection.execute(
            text(
                "INSERT INTO timesheet_roster_assignments "
                "(employee_id, designation_id, effective_from) "
                "VALUES ('G1001', 16, '2026-02-01')"
            )
        )

    with pytest.raises(IntegrityError):
        with engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO timesheet_roster_assignments "
                    "(employee_id, designation_id, effective_from) "
                    "VALUES ('G1001', 16, '2026-02-01')"
                )
            )

    with pytest.raises(IntegrityError):
        with engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO timesheet_designations "
                    "(name_en, name_ar, rank_order, system_key) "
                    "VALUES ('Duplicate', 'Duplicate', 17, 'driver')"
                )
            )

    command.downgrade(config, "0076")

    with engine.connect() as connection:
        columns = {
            row[1] for row in connection.exec_driver_sql("PRAGMA table_info(employees)")
        }
        assert "designation_id" in columns
        designation_columns = {
            row[1]
            for row in connection.exec_driver_sql(
                "PRAGMA table_info(timesheet_designations)"
            )
        }
        assert "system_key" not in designation_columns
        assert not connection.dialect.has_table(connection, "timesheet_roster_assignments")

        restored = connection.execute(
            text(
                "SELECT id, designation_id FROM employees "
                "WHERE id IN ('G1001', 'G1002') ORDER BY id"
            )
        ).fetchall()
        assert restored == [("G1001", 16), ("G1002", None)]


def test_timesheet_roster_system_keys_follow_designation_names_after_reorder(
    tmp_path: Path,
) -> None:
    database = tmp_path / "timesheet-roster-reordered.db"
    config = _alembic_config(database)
    command.upgrade(config, "0076")
    engine = create_engine(config.get_main_option("sqlalchemy.url"))

    with engine.begin() as connection:
        connection.execute(
            text(
                "UPDATE timesheet_designations "
                "SET rank_order = CASE rank_order "
                "WHEN 1 THEN 101 WHEN 16 THEN 102 ELSE rank_order END"
            )
        )
        connection.execute(
            text(
                "UPDATE timesheet_designations SET rank_order = CASE rank_order "
                "WHEN 101 THEN 16 WHEN 102 THEN 1 ELSE rank_order END"
            )
        )

    command.upgrade(config, "0077")

    with engine.connect() as connection:
        rows = connection.execute(
            text(
                "SELECT name_en, rank_order, system_key "
                "FROM timesheet_designations "
                "WHERE name_en IN ('Prisons Director', 'Driver') "
                "ORDER BY rank_order"
            )
        ).fetchall()
        assert rows == [
            ("Driver", 1, "driver"),
            ("Prisons Director", 16, "prisons_director"),
        ]
