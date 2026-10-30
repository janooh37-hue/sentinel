"""Migration 0116: the statistics quota columns, their backfill and reversibility."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import Engine, create_engine, inspect, text
from sqlalchemy.exc import IntegrityError

ROOT = Path(__file__).resolve().parents[2]
HEAD = "0116_timesheet_statistics_quotas"
PARENT = "0115_employee_statement_prints"


@pytest.fixture
def at_parent(tmp_path: Path) -> Iterator[tuple[Engine, Config]]:
    database = tmp_path / "statistics-quotas.db"
    config = Config(str(ROOT / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", f"sqlite:///{database}")
    command.upgrade(config, PARENT)
    engine = create_engine(f"sqlite:///{database}")
    try:
        yield engine, config
    finally:
        engine.dispose()


def _columns(engine: Engine, table: str) -> set[str]:
    return {column["name"] for column in inspect(engine).get_columns(table)}


def test_revision_follows_parent_in_single_head_history() -> None:
    script = ScriptDirectory.from_config(Config(str(ROOT / "alembic.ini")))
    heads = script.get_heads()
    assert len(heads) == 1
    assert HEAD in {revision.revision for revision in script.walk_revisions("base", heads[0])}
    assert script.get_revision(HEAD).down_revision == PARENT


def test_upgrade_writes_the_contract_quotas_and_guards_them(
    at_parent: tuple[Engine, Config],
) -> None:
    engine, config = at_parent
    command.upgrade(config, HEAD)

    with engine.connect() as c:
        quotas = {
            key: (uae, arab, fill)
            for key, uae, arab, fill in c.execute(
                text(
                    "SELECT system_key, quota_uae, quota_arab, quota_fill "
                    "FROM timesheet_designations"
                )
            )
        }
    assert quotas["security_guard"] == (55, 38, "own_then_guards")
    assert quotas["escort_security_guard"] == (0, 10, "guards_only")
    assert quotas["clinic_security_guard"] == (0, 8, "own")
    assert quotas["driver"] == (0, 0, "own")
    assert sum(uae + arab for uae, arab, _ in quotas.values()) == 249
    assert "stat_row_no" in _columns(engine, "timesheet_snapshot_rows")

    for bad in ("quota_uae = -1", "quota_fill = 'anyone'"):
        with pytest.raises(IntegrityError), engine.begin() as c:
            c.execute(text(f"UPDATE timesheet_designations SET {bad}"))


def test_downgrade_round_trip_restores_the_parent_schema(
    at_parent: tuple[Engine, Config],
) -> None:
    engine, config = at_parent
    with engine.connect() as c:
        before = c.execute(text("SELECT id, rank_order FROM timesheet_designations")).all()
    command.upgrade(config, HEAD)
    command.downgrade(config, PARENT)

    with engine.connect() as c:
        after = c.execute(text("SELECT id, rank_order FROM timesheet_designations")).all()
    assert after == before
    assert not {"quota_uae", "quota_arab", "quota_fill"} & _columns(
        engine, "timesheet_designations"
    )
    assert "stat_row_no" not in _columns(engine, "timesheet_snapshot_rows")
