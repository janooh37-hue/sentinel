"""0114 backfills approved identities without rewriting existing Store history."""

from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import Connection, Engine, create_engine, inspect, text
from sqlalchemy.exc import IntegrityError

ROOT = Path(__file__).resolve().parents[2]
PARENT = "0113_store_room"
HEAD = "0114_store_count"
PRESENTATION_COLUMNS = (
    "brand_label",
    "generic_label_en",
    "generic_label_ar",
    "short_name_en",
    "short_name_ar",
    "pack_description_en",
    "pack_description_ar",
)
# Approved shelf identities, expressed independently of migration/import constants.
EXPECTED_PRESENTATION = {
    "Nescafe Classic 190 g": (
        "NESCAFÉ\nClassic",
        "Coffee",
        "قهوة",
        "Nescafe Classic",
        "نسكافيه كلاسيك",
        "12 jars \u00d7 190 g",
        "كرتون: 12 مرطبانًا، 190 غ لكل مرطبان",
    ),
    "Coffee-mate 400 g": (
        "Coffee-mate",
        "Creamer",
        "مبيض قهوة",
        "Coffee-mate",
        "كوفي ميت",
        "15 jars \u00d7 400 g",
        "كرتون: 15 مرطبانًا، 400 غ لكل مرطبان",
    ),
    "Lipton Yellow Label tea 400 g": (
        "LIPTON\nYellow Label",
        "Tea",
        "شاي",
        "Lipton Yellow Label",
        "ليبتون الأصفر",
        "24 boxes \u00d7 400 g",
        "كرتون: 24 علبة، 400 غ لكل علبة",
    ),
    "Green tea": (
        None,
        "Green tea",
        "شاي أخضر",
        "Green tea",
        "شاي أخضر",
        "Packet; size not recorded",
        "حجم العبوة غير مسجّل · العد بالعلبة",
    ),
    "Lipton Red Label tea, 100 bags": (
        "LIPTON\nRed Label",
        "Tea",
        "شاي",
        "Lipton Red Label",
        "ليبتون الأحمر",
        "36 boxes \u00d7 100 bags",
        "كرتون: 36 علبة، 100 كيس شاي لكل علبة",
    ),
    "Rainbow milk 170 g": (
        "Rainbow",
        "Milk",
        "حليب",
        "Rainbow milk",
        "حليب رينبو",
        "96 tins \u00d7 170 g",
        "كرتون: 96 علبة، 170 غ لكل علبة",
    ),
    "Liwa water": (
        "Liwa",
        "Water",
        "مياه",
        "Liwa water",
        "مياه ليوا",
        "Carton; contents not recorded",
        "حجم العبوة غير مسجّل · العد بالكرتون",
    ),
    "Coffee cups, 40 per sleeve": (
        None,
        "Cups",
        "أكواب",
        "Coffee cups",
        "أكواب قهوة",
        "50 sleeves \u00d7 40 cups",
        "كرتون: 50 رزمة، 40 كوبًا لكل رزمة",
    ),
    "Big coffee cups": (
        None,
        "Cups",
        "أكواب",
        "Large coffee cups",
        "أكواب قهوة كبيرة",
        "Carton; contents not recorded",
        "كرتون · المحتويات غير مسجّلة",
    ),
    "Masafi café tissues, 150 sheets 2-ply": (
        "Masafi",
        "Tissues",
        "مناديل",
        "Masafi tissues",
        "مناديل مسافي",
        "150 sheets · 2-ply; carton contents not recorded",
        "150 منديلًا · طبقتان · محتويات الكرتون غير مسجّلة",
    ),
    "Nitrile gloves": (
        None,
        "Nitrile",
        "نتريل",
        "Nitrile gloves",
        "قفازات نتريل",
        "Carton; contents not recorded",
        "حجم العبوة غير مسجّل · العد بالكرتون",
    ),
    "Vinyl gloves, 100 per box": (
        None,
        "Vinyl",
        "فينيل",
        "Vinyl gloves",
        "قفازات فينيل",
        "10 boxes \u00d7 100 gloves",
        "كرتون: 10 علب، 100 قفاز لكل علبة",
    ),
    "Face masks, 3-ply blue": (
        None,
        "Mask",
        "كمامة",
        "Face masks",
        "كمامات وجه",
        "3-ply; carton contents not recorded",
        "زرقاء · 3 طبقات · حجم العبوة غير مسجّل",
    ),
}
UNKNOWN_NAMES = ("Other tea", "green tea", "Lipton Yellow Label tea 400 g extra")


def test_store_count_is_only_head_after_retained_recovery_history() -> None:
    script = ScriptDirectory.from_config(Config(str(ROOT / "alembic.ini")))
    assert script.get_heads() == [HEAD]
    assert script.get_revision(HEAD).down_revision == PARENT
    assert script.get_revision(PARENT).down_revision == "0112_store"
    assert script.get_revision("0112_store").down_revision == "0111_step_outcome_seen"
    assert set(script.get_revision("0111_step_outcome_seen").down_revision) == {
        "0110_employee_statement_prints",
        "0110_step_outcome_seen",
    }
    for revision in ("0110_employee_statement_prints", "0110_step_outcome_seen"):
        assert script.get_revision(revision).down_revision == "0109_book_folder_shares"


def _snapshot(connection: Connection) -> dict[str, tuple[list[str], list[tuple]]]:
    inspector = inspect(connection)
    return {
        table: (
            [column["name"] for column in inspector.get_columns(table)],
            [
                tuple(row)
                for row in connection.exec_driver_sql(f'SELECT * FROM "{table}" ORDER BY id')
            ],
        )
        for table in inspector.get_table_names()
        if table.startswith("store_")
    }


def _assert_preserved(engine: Engine, before: dict[str, tuple[list[str], list[tuple]]]) -> None:
    with engine.connect() as connection:
        for table, (columns, rows) in before.items():
            selected = ", ".join(f'"{column}"' for column in columns)
            assert [
                tuple(row)
                for row in connection.exec_driver_sql(
                    f'SELECT {selected} FROM "{table}" ORDER BY id'
                )
            ] == rows, table
        assert connection.exec_driver_sql("PRAGMA integrity_check").scalars().all() == ["ok"]
        assert connection.exec_driver_sql("PRAGMA foreign_key_check").all() == []


def _assert_presentation(engine: Engine) -> None:
    with engine.connect() as connection:
        columns = ", ".join(PRESENTATION_COLUMNS)
        actual = {
            row[0]: tuple(row[1:])
            for row in connection.exec_driver_sql(f"SELECT name_en, {columns} FROM store_items")
        }
        assert actual == {
            **EXPECTED_PRESENTATION,
            **{name: (None, None, None, None, None, None, None) for name in UNKNOWN_NAMES},
        }
        assert connection.exec_driver_sql(
            "SELECT version_num FROM alembic_version"
        ).scalars().all() == [HEAD]
        assert connection.exec_driver_sql(
            "SELECT id, carton_contains_qty FROM store_delivery_lines ORDER BY id"
        ).all() == [(line_id, None) for line_id in range(1, 18)]


def _assert_delivery_integrity(engine: Engine) -> None:
    """The SQLite rebuild must retain ledger boundaries, not merely its rows."""
    with engine.connect() as connection:
        connection.exec_driver_sql("PRAGMA foreign_keys=ON")
        connection.commit()
        for statement in (
            "INSERT INTO store_delivery_lines (delivery_id, batch_id, quantity) VALUES (1, 1, 2)",
            "INSERT INTO store_delivery_lines (delivery_id, batch_id, quantity) VALUES (99, 1, 2)",
            "INSERT INTO store_delivery_lines (delivery_id, batch_id, quantity) VALUES (1, 99, 2)",
            "UPDATE store_delivery_lines SET quantity = -1",
            "UPDATE store_delivery_lines SET noted_quantity = -1",
        ):
            with pytest.raises(IntegrityError), connection.begin():
                connection.execute(text(statement))
        with connection.begin():
            connection.execute(text("DELETE FROM store_deliveries WHERE id = 1"))
            assert (
                connection.execute(
                    text("SELECT count(*) FROM store_delivery_lines WHERE delivery_id = 1")
                ).scalar()
                == 0
            )
            # The separate stock-neutral note discrepancy must not be cascaded.
            assert connection.execute(
                text("SELECT id, quantity, noted_quantity FROM store_delivery_lines")
            ).all() == [(17, 0, 9)]
            connection.rollback()


def test_store_count_populated_round_trip(tmp_path: Path) -> None:
    url = f"sqlite:///{tmp_path / 'store-count.db'}"
    config = Config(str(ROOT / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", url)
    command.upgrade(config, PARENT)
    engine = create_engine(url)
    try:
        with engine.begin() as connection:
            connection.exec_driver_sql(
                "INSERT INTO store_deliveries (id, received_on, note) "
                "VALUES (1, '2026-01-01', 'Existing receipt'), (2, '2026-01-02', 'Nothing received')"
            )
            connection.exec_driver_sql(
                "INSERT INTO store_counts (id, month, counted_on, note) "
                "VALUES (1, '2026-01', '2026-01-03', 'Existing count')"
            )
            connection.exec_driver_sql(
                "INSERT INTO store_handovers (id, handed_on, taken_by, note) "
                "VALUES (1, '2026-01-04', 'Synthetic recipient', 'Existing handover')"
            )
            for batch_id, name in enumerate((*EXPECTED_PRESENTATION, *UNKNOWN_NAMES), start=1):
                # Deliberately non-opening IDs and existing conversions: presentation
                # backfill must match names, not IDs, and must not reset pack facts.
                item_id = 97 + batch_id * 3
                contains = None if batch_id % 2 == 0 else 37
                connection.execute(
                    text(
                        "INSERT INTO store_items (id, code, name_en, name_ar, category_id, "
                        "counting_unit_en, counting_unit_ar, contains_qty, contains_unit_en, "
                        "contains_unit_ar, minimum_level, art_kind, art_color) "
                        "VALUES (:id, :code, :name, 'اسم رسمي محفوظ', 1, 'Carton', 'كرتون', "
                        ":contains, :unit_en, :unit_ar, 19, 'box', '#123456')"
                    ),
                    {
                        "id": item_id,
                        "code": f"ST-{item_id:04d}",
                        "name": name,
                        "contains": contains,
                        "unit_en": "Piece" if contains else None,
                        "unit_ar": "قطعة" if contains else None,
                    },
                )
                connection.execute(
                    text("INSERT INTO store_batches (id, item_id) VALUES (:batch, :item)"),
                    {"batch": batch_id, "item": item_id},
                )
                connection.execute(
                    text(
                        "INSERT INTO store_item_aliases (item_id, alias_norm) VALUES (:item, :alias)"
                    ),
                    {"item": item_id, "alias": f"existing-{batch_id}"},
                )
                connection.execute(
                    text(
                        "INSERT INTO store_delivery_lines "
                        "(id, delivery_id, batch_id, quantity, noted_quantity, difference_reason) "
                        "VALUES (:batch, 1, :batch, :quantity, :noted, 'Existing discrepancy')"
                    ),
                    {"batch": batch_id, "quantity": 400 + batch_id, "noted": 500 + batch_id},
                )
                connection.execute(
                    text(
                        "INSERT INTO store_count_lines (count_id, batch_id, quantity) "
                        "VALUES (1, :batch, :quantity)"
                    ),
                    {"batch": batch_id, "quantity": 300 + batch_id},
                )
                connection.execute(
                    text(
                        "INSERT INTO store_handover_lines (handover_id, batch_id, quantity) "
                        "VALUES (1, :batch, :quantity)"
                    ),
                    {"batch": batch_id, "quantity": 10 + batch_id},
                )
                connection.execute(
                    text(
                        "INSERT INTO store_disposals (batch_id, disposed_on, quantity, reason, note) "
                        "VALUES (:batch, '2026-01-05', :quantity, 'damaged', 'Existing disposal')"
                    ),
                    {"batch": batch_id, "quantity": 20 + batch_id},
                )
            connection.exec_driver_sql(
                "INSERT INTO store_delivery_lines "
                "(id, delivery_id, batch_id, quantity, noted_quantity, difference_reason) "
                "VALUES (17, 2, 1, 0, 9, 'Nothing arrived')"
            )
            before = _snapshot(connection)
        command.upgrade(config, HEAD)
        _assert_preserved(engine, before)
        _assert_presentation(engine)
        with engine.begin() as connection:
            connection.exec_driver_sql(
                "UPDATE store_delivery_lines SET carton_contains_qty = 24 WHERE id = 1"
            )
            assert connection.exec_driver_sql(
                "SELECT quantity, noted_quantity, carton_contains_qty "
                "FROM store_delivery_lines WHERE id = 1"
            ).one() == (401, 501, 24)
        for invalid in (0, -1):
            with pytest.raises(IntegrityError), engine.begin() as connection:
                connection.execute(
                    text(
                        "UPDATE store_delivery_lines SET carton_contains_qty = :value WHERE id = 1"
                    ),
                    {"value": invalid},
                )
        _assert_delivery_integrity(engine)
        command.downgrade(config, PARENT)
        assert not set(PRESENTATION_COLUMNS) & {
            column["name"] for column in inspect(engine).get_columns("store_items")
        }
        assert "carton_contains_qty" not in {
            column["name"] for column in inspect(engine).get_columns("store_delivery_lines")
        }
        _assert_preserved(engine, before)
        _assert_delivery_integrity(engine)
        command.upgrade(config, HEAD)
        _assert_preserved(engine, before)
        _assert_presentation(engine)
        _assert_delivery_integrity(engine)
    finally:
        engine.dispose()
