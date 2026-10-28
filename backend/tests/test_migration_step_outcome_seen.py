"""Migration 0114 suppresses historical outcomes and reverses without losing steps."""

from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect, text

ROOT = Path(__file__).resolve().parents[2]
HEAD = "0114_step_outcome_seen"
PARENT = "0113_book_folder_box"


def test_single_head_and_backfill_round_trip(tmp_path: Path) -> None:
    config = Config(str(ROOT / "alembic.ini"))
    script = ScriptDirectory.from_config(config)
    assert script.get_heads() == [HEAD]
    assert script.get_revision(HEAD).down_revision == PARENT
    database = tmp_path / "outcomes.db"
    config.set_main_option("sqlalchemy.url", f"sqlite:///{database}")
    engine = create_engine(f"sqlite:///{database}")
    with engine.begin() as connection:
        connection.exec_driver_sql(
            "CREATE TABLE book_approval_steps (id INTEGER PRIMARY KEY, state VARCHAR(16), "
            "decided_at DATETIME)"
        )
        connection.exec_driver_sql(
            "INSERT INTO book_approval_steps VALUES "
            "(1, 'approved', '2026-10-01 12:00:00'), "
            "(2, 'returned', '2026-10-02 12:00:00'), "
            "(3, 'rejected', '2026-10-03 12:00:00'), (4, 'pending', NULL), "
            "(5, 'approved', NULL)"
        )
        connection.exec_driver_sql(
            "CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL)"
        )
        connection.execute(text("INSERT INTO alembic_version VALUES (:v)"), {"v": PARENT})
    try:
        command.upgrade(config, HEAD)
        with engine.connect() as connection:
            assert connection.execute(
                text("SELECT outcome_seen_at FROM book_approval_steps ORDER BY id")
            ).scalars().all() == [
                "2026-10-01 12:00:00",
                "2026-10-02 12:00:00",
                "2026-10-03 12:00:00",
                None,
                None,
            ]
        command.downgrade(config, PARENT)
        with engine.connect() as connection:
            assert "outcome_seen_at" not in {
                col["name"] for col in inspect(connection).get_columns("book_approval_steps")
            }
            assert connection.scalar(text("SELECT COUNT(*) FROM book_approval_steps")) == 5
        command.upgrade(config, HEAD)
        with engine.connect() as connection:
            assert (
                connection.scalar(
                    text(
                        "SELECT COUNT(*) FROM book_approval_steps WHERE outcome_seen_at IS NOT NULL"
                    )
                )
                == 3
            )
    finally:
        engine.dispose()
