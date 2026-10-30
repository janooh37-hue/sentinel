"""Migration 0111: linear head and populated, reversible SQLite alterations.

Full column, constraint, FK and index model parity is covered by
test_migration_store's HEAD-based parity test, including the room models.
"""

from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import IntegrityError

ROOT = Path(__file__).resolve().parents[2]


def test_store_room_is_single_head() -> None:
    script = ScriptDirectory.from_config(Config(str(ROOT / "alembic.ini")))
    assert script.get_heads() == ["0111_store_room"]
    assert script.get_revision("0111_store_room").down_revision == "0110_store"


def test_store_room_populated_round_trip(tmp_path: Path) -> None:
    url = f"sqlite:///{tmp_path / 'room.db'}"
    config = Config(str(ROOT / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", url)
    command.upgrade(config, "0110_store")
    engine = create_engine(url)
    try:
        with engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO store_items (id, code, name_en, category_id, counting_unit_en, "
                    "counting_unit_ar) VALUES (1, 'ST-0001', 'Tea', 1, 'Carton', 'كرتون')"
                )
            )
            connection.execute(text("INSERT INTO store_batches (id, item_id) VALUES (1, 1)"))
            connection.execute(
                text("INSERT INTO store_deliveries (id, received_on) VALUES (1, '2026-01-01')")
            )
            connection.execute(
                text(
                    "INSERT INTO store_delivery_lines (id, delivery_id, batch_id, quantity) "
                    "VALUES (1, 1, 1, 5)"
                )
            )
        command.upgrade(config, "head")
        with engine.begin() as connection:
            assert connection.execute(
                text("SELECT quantity, noted_quantity, difference_reason FROM store_delivery_lines")
            ).one() == (5, None, None)
            connection.execute(
                text("INSERT INTO store_deliveries (id, received_on) VALUES (2, '2026-01-02')")
            )
            connection.execute(
                text(
                    "INSERT INTO store_delivery_lines "
                    "(id, delivery_id, batch_id, quantity, noted_quantity, difference_reason) "
                    "VALUES (2, 2, 1, 0, 3, 'Nothing arrived')"
                )
            )
            connection.execute(
                text(
                    "INSERT INTO store_handovers (id, handed_on, taken_by) "
                    "VALUES (1, '2026-01-02', 'Ali')"
                )
            )
            connection.execute(
                text(
                    "INSERT INTO store_handover_lines (handover_id, batch_id, quantity) "
                    "VALUES (1, 1, 2)"
                )
            )
            connection.execute(
                text("INSERT INTO store_item_aliases (item_id, alias_norm) VALUES (1, 'tea')")
            )
        with pytest.raises(IntegrityError), engine.begin() as connection:
            connection.execute(text("UPDATE store_delivery_lines SET noted_quantity = -1"))
        with pytest.raises(IntegrityError), engine.begin() as connection:
            connection.execute(text("UPDATE store_delivery_lines SET quantity = -1"))
        with pytest.raises(IntegrityError), engine.begin() as connection:
            connection.execute(text("UPDATE store_handover_lines SET quantity = 0"))
        with pytest.raises(IntegrityError), engine.begin() as connection:
            connection.execute(
                text("INSERT INTO store_item_aliases (item_id, alias_norm) VALUES (1, 'tea')")
            )
        command.downgrade(config, "0110_store")
        inspector = inspect(engine)
        assert not {"store_handovers", "store_handover_lines", "store_item_aliases"} & set(
            inspector.get_table_names()
        )
        assert "art_kind" not in {c["name"] for c in inspector.get_columns("store_items")}
        with engine.connect() as connection:
            assert connection.execute(
                text("SELECT id, quantity FROM store_delivery_lines")
            ).all() == [(1, 5)]
        with pytest.raises(IntegrityError), engine.begin() as connection:
            connection.execute(text("UPDATE store_delivery_lines SET quantity = 0"))
        command.upgrade(config, "head")
        with engine.connect() as connection:
            assert connection.execute(
                text("SELECT quantity, noted_quantity FROM store_delivery_lines")
            ).one() == (5, None)
    finally:
        engine.dispose()
