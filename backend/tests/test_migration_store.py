"""Migration 0110: Store schema, model parity, seeded categories, reversibility."""

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
HEAD = "0111_store_room"
STORE_REVISION = "0110_store"
PARENT = "0109_book_folder_shares"
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


def test_revision_follows_parent_in_single_head_history() -> None:
    script = ScriptDirectory.from_config(Config(str(ROOT / "alembic.ini")))
    heads = script.get_heads()
    assert len(heads) == 1
    assert HEAD in {revision.revision for revision in script.walk_revisions("base", heads[0])}
    assert script.get_revision(STORE_REVISION).down_revision == PARENT


def test_upgrade_matches_models_and_seeds_categories(at_parent: tuple[Engine, Config]) -> None:
    engine, config = at_parent
    command.upgrade(config, HEAD)
    inspector = inspect(engine)
    for model in MODELS:
        table = model.__table__
        columns = {column["name"]: column for column in inspector.get_columns(table.name)}
        assert {name: (str(c["type"]), c["nullable"]) for name, c in columns.items()} == {
            column.name: (str(column.type), column.nullable) for column in table.columns
        }, table.name
        assert {
            (index["name"], tuple(index["column_names"]), bool(index["unique"]))
            for index in inspector.get_indexes(table.name)
        } == {
            (index.name, tuple(column.name for column in index.columns), bool(index.unique))
            for index in table.indexes
        }, table.name
        assert {c["name"] for c in inspector.get_check_constraints(table.name)} == {
            constraint.name
            for constraint in table.constraints
            if constraint.__class__.__name__ == "CheckConstraint"
        }, table.name
        assert {c["name"] for c in inspector.get_unique_constraints(table.name)} == {
            constraint.name
            for constraint in table.constraints
            if constraint.__class__.__name__ == "UniqueConstraint"
        }, table.name
        assert {
            (tuple(fk["constrained_columns"]), fk["referred_table"], fk["options"].get("ondelete"))
            for fk in inspector.get_foreign_keys(table.name)
        } == {
            ((fk.parent.name,), fk.column.table.name, fk.ondelete) for fk in table.foreign_keys
        }, table.name

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
