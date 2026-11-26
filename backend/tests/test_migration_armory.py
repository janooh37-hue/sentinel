"""Migration 0126: catalogue seed, SQLite schema parity, and reversible upgrade."""

from collections.abc import Iterator
from pathlib import Path
from sqlite3 import Connection as SQLiteConnection

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import Connection, Engine, create_engine, event, inspect
from sqlalchemy.exc import IntegrityError

from app.db.models import Base

ROOT = Path(__file__).resolve().parents[2]
REVISION = "0126_armory"
PARENT = "0125_employee_added_source"
TABLES = {
    "armory_safes",
    "armory_shift_policies",
    "armory_items",
    "armory_kits",
    "armory_kit_items",
    "armory_batches",
    "armory_stock",
    "armory_guard_qualifications",
    "armory_postings",
    "armory_serials",
    "armory_assignments",
    "armory_assignment_lines",
    "armory_posting_lines",
    "armory_count_lines",
    "armory_discrepancies",
    "armory_decisions",
}

# Preset key, EN/AR names, kind, category, drawing, from the approved catalogue.
ITEMS = """\
rifle|Sultan rifle|بندقية سلطان|firearm|firearms|rifle
pistol|Caracal pistol|مسدس كراكال|firearm|firearms|pistol
rifle-mag|Sultan rifle magazine|مخزن بندقية سلطان|quantity|accessories|magazine
rifle-rod|Rifle cleaning rod|حربة تنظيف بندقية|quantity|accessories|rod
rifle-tool|Sultan rifle tool|مفتاح بندقية سلطان|quantity|accessories|tool
sling|Sultan rifle sling|حمالة بندقية سلطان|quantity|accessories|sling
scabbard|Sultan rifle scabbard|غمد بندقية سلطان|quantity|accessories|scabbard
foregrip|Fore grip|مقبض أمامي|quantity|accessories|grip
adapter|Firing adapter|محول إطلاق|quantity|accessories|adapter
pistol-mag|Caracal pistol magazine|مخزن مسدس كراكال|quantity|accessories|magazine
pistol-case|Caracal pistol case|شنطة مسدس كراكال|quantity|accessories|case
pistol-rod|Pistol cleaning rod|حربة تنظيف مسدس|quantity|accessories|rod
pistol-tool|Caracal pistol tool|مفتاح مسدس كراكال|quantity|accessories|tool
right-holster|Right holster|غمد مسدس يمين|quantity|accessories|holster
left-holster|Left holster|غمد مسدس شمال|quantity|accessories|holster
rifle-rounds|Sultan rifle rounds|عتاد بندقية سلطان|ammunition|ammo|rounds
pistol-rounds|Caracal pistol rounds|عتاد مسدس كراكال|ammunition|ammo|rounds
taser|Taser|مسدس كهربائي|serial|nonlethal|taser
spray|Tear-gas spray|بخاخ مسيل للدموع|expiry|nonlethal|spray
cartridge|Taser cartridge|خرطوشة مسدس كهربائي|expiry|nonlethal|cartridge
cuffs|Steel handcuffs|قيد يدوي حديد|quantity|restraints|cuffs
leg-irons|Steel leg irons|قيد رجل حديد|quantity|restraints|leg-irons
plastic|Plastic restraints|قيود بلاستيكية|quantity|restraints|plastic
leg-key|Leg-iron key|مفتاح قيد رجل|quantity|restraints|key
cuff-key|Handcuff key|مفتاح قيد يدوي|quantity|restraints|key
baton|Riot baton|عصا شغب|quantity|riot|baton
helmet|Riot helmet|خوذة شغب|quantity|riot|helmet
shield|Riot shield|ترس شغب|quantity|riot|shield
riot-suit|Riot gear suit|بدلة مكافحة الشغب|serial|riot|riot-suit
radio|TETRA radio|جهاز تترا|serial|comms|radio
wand|Hand wand|عصا تفتيش كهربائية|serial|comms|wand
bodycam|Body camera|كاميرا صدرية محمولة|serial|comms|bodycam"""


@pytest.fixture
def at_parent(tmp_path: Path) -> Iterator[tuple[Config, Engine]]:
    url = f"sqlite:///{tmp_path / 'armory.db'}"
    config = Config(str(ROOT / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", url)
    command.upgrade(config, PARENT)
    engine = create_engine(url)

    @event.listens_for(engine, "connect")
    def enable_foreign_keys(connection: SQLiteConnection, _record: object) -> None:
        connection.execute("PRAGMA foreign_keys = ON")

    try:
        with engine.begin() as connection:
            connection.exec_driver_sql(
                "INSERT INTO employees (id, name_en, created_at, updated_at) "
                "VALUES ('TEST-ARMORY', 'Synthetic employee', '2026-01-01', '2026-01-01')"
            )
            connection.exec_driver_sql(
                "INSERT INTO users (id, email, password_hash, employee_id) "
                "VALUES (9001, 'armory@example.invalid', 'not-a-password', 'TEST-ARMORY')"
            )
            connection.exec_driver_sql(
                "INSERT INTO vehicle_sites (id, name_en, name_ar, created_at) "
                "VALUES (9001, 'Synthetic site', 'موقع اختباري', '2026-01-01')"
            )
            connection.exec_driver_sql(
                "INSERT INTO uniform_items "
                "(id, name_en, name_ar, group_key, drawing, tracking, archived_at) "
                "VALUES (9001, 'Synthetic uniform item', 'زي اختباري', "
                "'formal', 'polo', 'holder', '2026-01-01')"
            )
        yield config, engine
    finally:
        engine.dispose()


def _legacy_rows(connection: Connection) -> list[tuple]:
    return [
        tuple(connection.exec_driver_sql(f"SELECT * FROM {table} WHERE id = ?", (key,)).one())
        for table, key in (
            ("employees", "TEST-ARMORY"),
            ("users", 9001),
            ("vehicle_sites", 9001),
            ("uniform_items", 9001),
        )
    ]


def _assert_seed(connection: Connection) -> None:
    items = connection.exec_driver_sql(
        "SELECT preset_key, name_en, name_ar, kind, category, drawing, created_by_id "
        "FROM armory_items"
    ).all()
    assert len(items) == 32
    assert set(items) == {(*line.split("|"), None) for line in ITEMS.splitlines()}
    assert set(
        connection.exec_driver_sql(
            "SELECT k.code, k.name_en, k.name_ar, i.preset_key FROM armory_kits k "
            "LEFT JOIN armory_items i ON i.id = k.firearm_item_id"
        )
    ) == {
        ("rifle", "Sultan rifle kit", "طقم بندقية سلطان", "rifle"),
        ("pistol", "Caracal pistol kit", "طقم مسدس كراكال", "pistol"),
        ("equipment", "Equipment only", "معدات فقط", None),
    }
    assert set(
        connection.exec_driver_sql(
            "SELECT k.code, i.preset_key, l.role, l.default_qty, s.preset_key "
            "FROM armory_kit_items l JOIN armory_kits k ON k.id = l.kit_id "
            "JOIN armory_items i ON i.id = l.item_id "
            "LEFT JOIN armory_items s ON s.id = l.substitutes_item_id"
        )
    ) == {
        ("rifle", "rifle-mag", "default", 2, None),
        ("rifle", "sling", "default", 1, None),
        ("rifle", "rifle-rounds", "default", 30, None),
        ("pistol", "pistol-mag", "default", 2, None),
        ("pistol", "right-holster", "default", 1, None),
        ("pistol", "left-holster", "alternative", 0, "right-holster"),
        ("pistol", "pistol-rounds", "default", 12, None),
    } | {
        (kit, item, "optional", 0, None)
        for kit in ("rifle", "pistol", "equipment")
        for item in ("radio", "bodycam", "taser", "cuffs")
    }
    for table in TABLES - {"armory_items", "armory_kits", "armory_kit_items"}:
        assert connection.exec_driver_sql(f"SELECT count(*) FROM {table}").scalar_one() == 0, table


def _sqlite_ddl(connection: Connection, table: str) -> dict[str, list[str]]:
    # SQLite reflection skips expression indexes. Compare their stored SQL along
    # with table DDL; only the generation order of table constraints may differ.
    return {
        name: sorted(line.strip().removesuffix(",") for line in sql.splitlines())
        for name, sql in connection.exec_driver_sql(
            "SELECT name, sql FROM sqlite_schema WHERE tbl_name = ? AND sql IS NOT NULL",
            (table,),
        )
    }


def test_armory_schema_seed_and_round_trip(at_parent: tuple[Config, Engine]) -> None:
    config, engine = at_parent
    with engine.connect() as connection:
        legacy_tables = set(inspect(connection).get_table_names())
        legacy_rows = _legacy_rows(connection)

    command.upgrade(config, REVISION)
    orm = create_engine("sqlite://")
    try:
        assert {name for name in Base.metadata.tables if name.startswith("armory_")} == TABLES
        armory_models = [table for table in Base.metadata.tables.values() if table.name in TABLES]
        Base.metadata.create_all(orm, tables=armory_models)
        with engine.connect() as migrated, orm.connect() as expected:
            assert set(inspect(migrated).get_table_names()) == legacy_tables | TABLES
            assert _legacy_rows(migrated) == legacy_rows
            _assert_seed(migrated)
            for table in TABLES:
                pragma = f"PRAGMA table_info({table})"
                assert (
                    migrated.exec_driver_sql(pragma).all() == expected.exec_driver_sql(pragma).all()
                )
                assert _sqlite_ddl(migrated, table) == _sqlite_ddl(expected, table), table
    finally:
        orm.dispose()

    command.downgrade(config, PARENT)
    with engine.connect() as connection:
        assert set(inspect(connection).get_table_names()) == legacy_tables
        assert _legacy_rows(connection) == legacy_rows

    command.upgrade(config, REVISION)
    with engine.connect() as connection:
        assert set(inspect(connection).get_table_names()) == legacy_tables | TABLES
        assert _legacy_rows(connection) == legacy_rows
        _assert_seed(connection)


def test_armory_constraints_enforced_by_sqlite(at_parent: tuple[Config, Engine]) -> None:
    config, engine = at_parent
    command.upgrade(config, REVISION)
    with engine.begin() as connection:
        with pytest.raises(IntegrityError, match="ck_armory_items_firearms"):
            connection.exec_driver_sql(
                "INSERT INTO armory_items (name_en, name_ar, kind, category, drawing) "
                "VALUES ('Synthetic invalid item', 'عنصر اختباري', 'firearm', 'accessories', 'rifle')"
            )
        connection.exec_driver_sql(
            "INSERT INTO armory_safes (id, name_en, name_ar, created_at, created_by_id) "
            "VALUES (1, 'Synthetic safe', 'خزنة اختبارية', '2026-01-01', 9001)"
        )
        connection.exec_driver_sql(
            "INSERT INTO armory_postings (id, kind, safe_id, occurred_on, created_at, created_by_id) "
            "VALUES (?, ?, 1, '2026-01-01', '2026-01-01', 9001)",
            [(1, "opening"), (2, "shift_issue"), (3, "custody")],
        )
        insert_serial = (
            "INSERT INTO armory_serials (item_id, serial_code, safe_id, state, state_at, last_posting_id) "
            "SELECT id, 'SYNTHETIC-SERIAL-01', ?, ?, ?, 1 FROM armory_items WHERE preset_key = 'rifle'"
        )
        live = (1, "in_safe", "2026-01-01")
        assert connection.exec_driver_sql(insert_serial, live).rowcount == 1
        with pytest.raises(IntegrityError, match=r"armory_serials\.serial_code"):
            connection.exec_driver_sql(insert_serial, live)
        assert connection.exec_driver_sql(insert_serial, (None, None, None)).rowcount == 1

        connection.exec_driver_sql(
            "INSERT INTO armory_assignments "
            "(posting_id, holder_kind, holder_employee_id, kit_id, firearm_open) "
            "SELECT 2, 'person', 'TEST-ARMORY', id, 1 FROM armory_kits WHERE code = 'rifle'"
        )
        insert_site_assignment = (
            "INSERT INTO armory_assignments "
            "(posting_id, holder_kind, holder_safe_id, supervisor_employee_id, kit_id, firearm_open) "
            "SELECT 3, 'site', 1, 'TEST-ARMORY', id, ? FROM armory_kits WHERE code = 'rifle'"
        )
        with pytest.raises(IntegrityError, match="uq_armory_assignments_open_firearm"):
            connection.exec_driver_sql(insert_site_assignment, (1,))
        assert connection.exec_driver_sql(insert_site_assignment, (0,)).rowcount == 1

        with pytest.raises(IntegrityError, match="ck_armory_postings_void"):
            connection.exec_driver_sql(
                "UPDATE armory_postings SET voided_at = '2026-01-01' WHERE id = 1"
            )
        assert (
            connection.exec_driver_sql(
                "UPDATE armory_postings SET voided_at = '2026-01-01', voided_by_id = 9001, "
                "void_reason = 'Synthetic correction' WHERE id = 1"
            ).rowcount
            == 1
        )
