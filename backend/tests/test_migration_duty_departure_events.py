"""Migration 0120: departed employees' duty locations are backfilled and reversible."""

from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import Connection, create_engine, text
from sqlalchemy.exc import IntegrityError

ROOT = Path(__file__).resolve().parents[2]
HEAD = "0120_duty_departure_events"
PARENT = "0119_employee_former_ids"


def _config(database: Path) -> Config:
    config = Config(str(ROOT / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", f"sqlite:///{database.as_posix()}")
    return config


def _seed(connection: Connection) -> None:
    for employee_id, status, end_date, unit, post in (
        ("G1", "Active", None, "Unit A", "Gate"),
        ("G2", "Resigned", "2026-03-04", "Unit A", "Gate"),
        ("G3", "Transferred", "2026-05-06", " Unit B ", None),
        ("G4", "Terminated", None, "Unit C", "  "),
        ("G5", "Resigned", "2026-01-01", None, None),
        ("G6", "Terminated", "2026-01-01", None, "Orphan post"),
    ):
        connection.execute(
            text(
                "INSERT INTO employees "
                "(id, name_en, status, end_date, department, duty_unit, duty_post, "
                "created_at, updated_at) "
                "VALUES (:id, :id, :status, :end, 'Security', :unit, :post, "
                "'2026-01-01', '2026-01-01')"
            ),
            {"id": employee_id, "status": status, "end": end_date, "unit": unit, "post": post},
        )


def _employees(connection: Connection) -> dict[str, tuple[object, object]]:
    return {
        row.id: (row.duty_unit, row.duty_post)
        for row in connection.execute(text("SELECT id, duty_unit, duty_post FROM employees"))
    }


def test_single_head_on_its_parent() -> None:
    script = ScriptDirectory.from_config(Config(str(ROOT / "alembic.ini")))
    assert script.get_heads() == [HEAD]
    assert script.get_revision(HEAD).down_revision == PARENT


def test_backfill_round_trip(tmp_path: Path) -> None:
    database = tmp_path / "departures.db"
    config = _config(database)
    command.upgrade(config, PARENT)
    engine = create_engine(f"sqlite:///{database.as_posix()}")
    try:
        with engine.begin() as connection:
            _seed(connection)
            baseline_count = connection.scalar(text("SELECT count(*) FROM duty_assignment_events"))
        command.upgrade(config, HEAD)
        with engine.begin() as connection:
            assert _employees(connection) == {
                "G1": ("Unit A", "Gate"),
                "G2": (None, None),
                "G3": (None, None),
                "G4": (None, None),
                "G5": (None, None),
                "G6": (None, None),
            }
            events = connection.execute(
                text(
                    "SELECT employee_id, event_type, from_department, from_unit, from_post, "
                    "to_department, to_unit, to_post, effective_at, actor_user_id "
                    "FROM duty_assignment_events WHERE event_type != 'baseline' "
                    "ORDER BY employee_id"
                )
            ).all()
            assert [tuple(e[:8]) for e in events] == [
                ("G2", "service_end", "Security", "Unit A", "Gate", None, None, None),
                ("G3", "transfer_out", "Security", "Unit B", None, None, None, None),
                ("G4", "service_end", "Security", "Unit C", None, None, None, None),
                ("G6", "service_end", "Security", None, None, None, None, None),
            ]
            assert events[0].effective_at == "2026-03-04 00:00:00"
            assert events[1].effective_at == "2026-05-06 00:00:00"
            assert all(e.actor_user_id is None for e in events)
            # Only the status-driven types may be written without an actor.
            with pytest.raises(IntegrityError), connection.begin_nested():
                connection.execute(
                    text(
                        "INSERT INTO duty_assignment_events "
                        "(employee_id, event_type, effective_at, created_at) "
                        "VALUES ('G1', 'transfer', '2026-06-01', '2026-06-01')"
                    )
                )
            connection.execute(
                text(
                    "INSERT INTO duty_assignment_events "
                    "(employee_id, event_type, effective_at, created_at, to_unit) "
                    "VALUES ('G1', 'reinstatement', '2026-06-01', '2026-06-01', 'Unit A')"
                )
            )

        command.downgrade(config, PARENT)
        with engine.begin() as connection:
            # Back to the pre-0120 world: departed staff keep their last post.
            assert _employees(connection) == {
                "G1": ("Unit A", "Gate"),
                "G2": ("Unit A", "Gate"),
                "G3": ("Unit B", None),
                "G4": ("Unit C", None),
                "G5": (None, None),
                "G6": (None, None),
            }
            assert (
                connection.scalar(text("SELECT count(*) FROM duty_assignment_events"))
                == baseline_count
            )
            with pytest.raises(IntegrityError), connection.begin_nested():
                connection.execute(
                    text(
                        "INSERT INTO duty_assignment_events "
                        "(employee_id, event_type, effective_at, created_at) "
                        "VALUES ('G2', 'service_end', '2026-06-01', '2026-06-01')"
                    )
                )

        command.upgrade(config, HEAD)
        with engine.begin() as connection:
            assert _employees(connection)["G2"] == (None, None)
            assert connection.execute(text("PRAGMA integrity_check")).scalar() == "ok"
    finally:
        engine.dispose()
