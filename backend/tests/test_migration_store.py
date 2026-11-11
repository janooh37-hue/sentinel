"""Migration 0112: seeded categories, stock constraints and reversibility."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import Engine, create_engine, event, inspect, text
from sqlalchemy.exc import IntegrityError

from app.db.models import (
    StoreBatch,
    StoreCategory,
    StoreCount,
    StoreCountLine,
    StoreDelivery,
    StoreDeliveryLine,
    StoreDisposal,
    StoreHandover,
    StoreHandoverLine,
    StoreItem,
    StoreItemAlias,
)

ROOT = Path(__file__).resolve().parents[2]
HEAD = "0114_store_count"
PARENT = "0111_step_outcome_seen"
MODELS = (
    StoreCategory,
    StoreItem,
    StoreBatch,
    StoreDelivery,
    StoreDeliveryLine,
    StoreCount,
    StoreCountLine,
    StoreDisposal,
    StoreHandover,
    StoreHandoverLine,
    StoreItemAlias,
)


@pytest.fixture()
def at_parent(tmp_path: Path) -> Iterator[tuple[Engine, Config]]:
    database = tmp_path / "store.db"
    config = Config(str(ROOT / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", f"sqlite:///{database}")
    command.upgrade(config, PARENT)
    engine = create_engine(f"sqlite:///{database}")

    @event.listens_for(engine, "connect")
    def enable_foreign_keys(connection, _record) -> None:
        connection.execute("PRAGMA foreign_keys = ON")

    try:
        yield engine, config
    finally:
        engine.dispose()


def test_store_room_remains_in_single_head_history() -> None:
    script = ScriptDirectory.from_config(Config(str(ROOT / "alembic.ini")))
    heads = script.get_heads()
    assert len(heads) == 1
    assert HEAD in {revision.revision for revision in script.walk_revisions("base", heads[0])}


def test_upgrade_seeds_categories_and_enforces_batch_constraints(
    at_parent: tuple[Engine, Config],
) -> None:
    engine, config = at_parent
    command.upgrade(config, HEAD)

    with engine.begin() as connection:
        assert connection.execute(
            text("SELECT name_en, name_ar FROM store_categories ORDER BY id")
        ).all() == [("Pantry", "ضيافة"), ("Protective", "وقاية")]
        connection.execute(
            text(
                "INSERT INTO store_items (id, code, name_en, category_id, counting_unit_en, "
                "counting_unit_ar) VALUES (1, 'ST-0001', 'Water', 1, 'Carton', 'كرتون')"
            )
        )
        connection.execute(text("INSERT INTO store_batches (item_id) VALUES (1)"))
    # One undated Batch per item.
    with pytest.raises(IntegrityError), engine.begin() as connection:
        connection.execute(text("INSERT INTO store_batches (item_id) VALUES (1)"))
    with pytest.raises(IntegrityError), engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO store_items (code, name_en, category_id, counting_unit_en, "
                "counting_unit_ar, contains_qty) VALUES ('ST-0002', 'Tea', 1, 'Carton', "
                "'كرتون', 12)"
            )
        )


def test_downgrade_round_trip(at_parent: tuple[Engine, Config]) -> None:
    engine, config = at_parent
    command.upgrade(config, HEAD)
    command.downgrade(config, PARENT)
    assert not {model.__table__.name for model in MODELS} & set(inspect(engine).get_table_names())
    command.upgrade(config, HEAD)
    with engine.connect() as connection:
        assert connection.execute(text("SELECT COUNT(*) FROM store_categories")).scalar() == 2
