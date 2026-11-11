"""Migration 0115: uniform schema, seed, constraints, round trip and repo guards."""

from collections.abc import Iterator
from datetime import date
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import Engine, create_engine, event, inspect, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.errors import NotFoundError
from app.db.models import Base, Employee, UniformItem, UniformSize
from app.db.repos import uniform_repo
from app.db.session import attach_sqlite_pragmas
from app.services import uniform_service as svc

ROOT = Path(__file__).resolve().parents[2]
HEAD = "0115_uniform"
PARENT = "0114_store_count"
TABLES = {
    "uniform_items",
    "uniform_sizes",
    "uniform_receipts",
    "uniform_receipt_lines",
    "uniform_issues",
    "uniform_issue_lines",
    "uniform_returns",
    "uniform_return_lines",
    "uniform_adjustments",
}
PUBLIC_ID_TABLES = {
    "uniform_items",
    "uniform_sizes",
    "uniform_receipts",
    "uniform_issues",
    "uniform_returns",
    "uniform_adjustments",
}


def _config(url: str) -> Config:
    config = Config(str(ROOT / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", url)
    return config


@pytest.fixture
def migrated(tmp_path: Path) -> Iterator[tuple[Config, Engine]]:
    url = f"sqlite:///{(tmp_path / 'uniform.db').as_posix()}"
    config = _config(url)
    command.upgrade(config, HEAD)
    engine = create_engine(url)

    @event.listens_for(engine, "connect")
    def _fk(dbapi_connection, _record) -> None:  # type: ignore[no-untyped-def]
        dbapi_connection.execute("PRAGMA foreign_keys = ON")

    try:
        yield config, engine
    finally:
        engine.dispose()


@pytest.fixture(params=["orm", "migrated"])
def identity_engine(request: pytest.FixtureRequest) -> Iterator[Engine]:
    if request.param == "migrated":
        yield request.getfixturevalue("migrated")[1]
        return

    engine = create_engine("sqlite://")
    attach_sqlite_pragmas(engine, wal=False)
    Base.metadata.create_all(engine)
    try:
        yield engine
    finally:
        engine.dispose()


def _size_id(engine: Engine, drawing: str, label: str) -> int:
    with engine.connect() as connection:
        return connection.execute(
            text(
                "SELECT s.id FROM uniform_sizes s JOIN uniform_items i ON i.id = s.item_id "
                "WHERE i.drawing = :d AND s.label = :l"
            ),
            {"d": drawing, "l": label},
        ).scalar_one()


def _item_id(engine: Engine, drawing: str) -> int:
    with engine.connect() as connection:
        return connection.execute(
            text("SELECT id FROM uniform_items WHERE drawing = :d"), {"d": drawing}
        ).scalar_one()


def test_uniform_is_single_head() -> None:
    script = ScriptDirectory.from_config(Config(str(ROOT / "alembic.ini")))
    assert script.get_heads() == ["0119_employee_former_ids"]
    assert script.get_revision(HEAD).down_revision == PARENT


def test_public_identity_policy_matches_models_and_created_schema(identity_engine: Engine) -> None:
    with identity_engine.connect() as connection:
        for table_name in sorted(TABLES):
            protected = table_name in PUBLIC_ID_TABLES
            table = Base.metadata.tables[table_name]
            assert table.dialect_options["sqlite"]["autoincrement"] is protected
            ddl = connection.execute(
                text("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = :name"),
                {"name": table_name},
            ).scalar_one()
            assert ("AUTOINCREMENT" in ddl.upper()) is protected


def test_deleted_greatest_size_cannot_retarget_stale_receipt(identity_engine: Engine) -> None:
    with Session(identity_engine) as db:
        item = svc.create_item(
            db,
            name_en="Identity jacket",
            name_ar="سترة",
            group_key="guard",
            drawing="jacket",
            sizes=["S", "M"],
        )
        item_id = item.id
        original_id = next(size.id for size in item.sizes if size.label == "M")
        assert original_id == db.scalar(text("SELECT max(id) FROM uniform_sizes"))
        assert svc.remove_size(db, original_id) == "deleted"

        replacement = svc.add_size(db, item_id, label="L")
        assert replacement.id > original_id
        assert replacement.label == "L"
        assert db.get(UniformSize, original_id) is None
        with pytest.raises(NotFoundError) as exc:
            svc.create_receipt(
                db,
                received_on=date(2026, 1, 1),
                lines=[svc.ReceiptLineIn(original_id, 5)],
            )
        assert exc.value.code == "uniform_size_not_found"
        db.refresh(replacement)
        assert replacement.on_hand == 0
        assert db.scalar(text("SELECT count(*) FROM uniform_receipts")) == 0


def test_deleted_greatest_item_and_cascaded_sizes_keep_distinct_identities(
    identity_engine: Engine,
) -> None:
    with Session(identity_engine) as db:
        original = svc.create_item(
            db,
            name_en="Original jacket",
            name_ar="سترة",
            group_key="guard",
            drawing="jacket",
            sizes=["M"],
        )
        original_id = original.id
        original_size_id = original.sizes[0].id
        assert original_id == db.scalar(text("SELECT max(id) FROM uniform_items"))
        assert original_size_id == db.scalar(text("SELECT max(id) FROM uniform_sizes"))
        svc.delete_item(db, original_id)

        replacement = svc.create_item(
            db,
            name_en="Replacement jacket",
            name_ar="سترة جديدة",
            group_key="guard",
            drawing="jacket",
            sizes=["L"],
        )
        assert replacement.id > original_id
        assert replacement.sizes[0].id > original_size_id
        assert db.get(UniformItem, original_id) is None
        assert db.get(UniformSize, original_size_id) is None
        with pytest.raises(NotFoundError) as exc:
            svc.add_size(db, original_id, label="XL")
        assert exc.value.code == "uniform_item_not_found"


@pytest.mark.parametrize(
    "table_name, date_column, line_table_name, parent_column",
    [
        ("uniform_receipts", "received_on", "uniform_receipt_lines", "receipt_id"),
        ("uniform_issues", "issued_on", "uniform_issue_lines", "issue_id"),
        ("uniform_returns", "returned_on", "uniform_return_lines", "return_id"),
        ("uniform_adjustments", "adjusted_on", None, None),
    ],
)
def test_deleted_greatest_posting_id_is_never_reused(
    identity_engine: Engine,
    table_name: str,
    date_column: str,
    line_table_name: str | None,
    parent_column: str | None,
) -> None:
    # Services retain postings by voiding them. Exercise committed hard deletion
    # directly as well: public audit/confirmation IDs must never name another row.
    with Session(identity_engine) as db:
        db.add(Employee(id="IDENTITY", name_en="Identity guard"))
        db.commit()
        item = svc.create_item(
            db,
            name_en="Posting jacket",
            name_ar="سترة",
            group_key="guard",
            drawing="jacket",
            sizes=["M"],
        )
        item_id, size_id = item.id, item.sizes[0].id

    table = Base.metadata.tables[table_name]
    values: dict[str, object] = {date_column: date(2026, 1, 1)}
    if table_name in {"uniform_issues", "uniform_returns"}:
        values["employee_id"] = "IDENTITY"
    if table_name == "uniform_adjustments":
        values.update(size_id=size_id, delta=1, reason="Original count")
    else:
        values["note"] = "Original posting"

    with identity_engine.begin() as connection:
        connection.execute(table.insert().values(values))
        original_id = connection.execute(table.insert().values(values)).inserted_primary_key[0]
        assert original_id == connection.execute(text(f"SELECT max(id) FROM {table_name}")).scalar()
        if line_table_name is not None:
            assert parent_column is not None
            line_values = {parent_column: original_id, "size_id": size_id, "qty": 1}
            if table_name != "uniform_receipts":
                line_values["item_id"] = item_id
            if table_name == "uniform_returns":
                line_values["condition"] = "reusable"
            connection.execute(Base.metadata.tables[line_table_name].insert().values(line_values))
        connection.execute(table.delete().where(table.c.id == original_id))
        if line_table_name is not None:
            assert (
                connection.execute(text(f"SELECT count(*) FROM {line_table_name}")).scalar_one()
                == 0
            )

    values["reason" if table_name == "uniform_adjustments" else "note"] = "Different replacement"
    with identity_engine.begin() as connection:
        replacement_id = connection.execute(table.insert().values(values)).inserted_primary_key[0]
        assert replacement_id > original_id
        assert connection.execute(table.select().where(table.c.id == original_id)).first() is None

    void_record = {
        "uniform_receipts": svc.void_receipt,
        "uniform_issues": svc.void_issue,
        "uniform_returns": svc.void_return,
        "uniform_adjustments": svc.void_adjustment,
    }[table_name]
    with Session(identity_engine) as db, pytest.raises(NotFoundError):
        void_record(db, original_id, reason="Stale confirmation")


def test_seed_is_eight_distinct_drawings_with_zero_stock(migrated) -> None:
    _, engine = migrated
    with engine.connect() as connection:
        items = connection.execute(
            text("SELECT drawing, group_key, tracking, default_qty FROM uniform_items")
        ).all()
        assert len(items) == 8
        assert len({row.drawing for row in items}) == 8
        by_drawing = {row.drawing: row for row in items}
        assert (by_drawing["suit"].tracking, by_drawing["suit"].default_qty) == ("holder", 2)
        assert by_drawing["parka"].group_key == "winter"
        assert {r.tracking for d, r in by_drawing.items() if d != "suit"} == {"shelf"}
        assert connection.execute(text("SELECT sum(on_hand) FROM uniform_sizes")).scalar() == 0
        suit_sizes = connection.execute(
            text(
                "SELECT count(*) FROM uniform_sizes s JOIN uniform_items i "
                "ON i.id = s.item_id WHERE i.drawing = 'suit'"
            )
        ).scalar()
        assert suit_sizes == 0
        boots = connection.execute(
            text(
                "SELECT s.label FROM uniform_sizes s JOIN uniform_items i ON i.id = s.item_id "
                "WHERE i.drawing = 'boots' ORDER BY s.sort_order"
            )
        ).scalars()
        assert list(boots) == [str(n) for n in range(38, 48)]
        assert connection.execute(
            text(
                "SELECT s.label FROM uniform_sizes s JOIN uniform_items i ON i.id = s.item_id "
                "WHERE i.drawing = 'cap'"
            )
        ).scalars().all() == ["one"]
        for table in TABLES - {"uniform_items", "uniform_sizes"}:
            assert connection.execute(text(f"SELECT count(*) FROM {table}")).scalar() == 0


def test_active_drawing_is_unique_but_archived_duplicate_allowed(migrated) -> None:
    _, engine = migrated
    insert = text(
        "INSERT INTO uniform_items (name_en, name_ar, group_key, drawing, tracking, archived_at) "
        "VALUES (:n, 'x', 'guard', 'polo', 'shelf', :a)"
    )
    with pytest.raises(IntegrityError), engine.begin() as connection:
        connection.execute(insert, {"n": "Second polo", "a": None})
    with engine.begin() as connection:
        connection.execute(insert, {"n": "Old polo", "a": "2026-01-01"})
        # Archiving the seeded polo frees the drawing for a new active item.
        connection.execute(
            text("UPDATE uniform_items SET archived_at = '2026-02-01' WHERE name_en = 'Polo shirt'")
        )
        connection.execute(insert, {"n": "New polo", "a": None})


def test_active_name_and_size_label_are_unique_case_insensitively(migrated) -> None:
    _, engine = migrated
    with pytest.raises(IntegrityError), engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO uniform_items (name_en, name_ar, group_key, drawing, tracking) "
                "VALUES ('CAP', 'x', 'guard', 'vest', 'shelf')"
            )
        )
    cap = _item_id(engine, "cap")
    with pytest.raises(IntegrityError), engine.begin() as connection:
        connection.execute(
            text("INSERT INTO uniform_sizes (item_id, label) VALUES (:i, 'ONE')"), {"i": cap}
        )
    with engine.begin() as connection:
        connection.execute(text("UPDATE uniform_sizes SET archived_at = '2026-01-01'"))
        connection.execute(
            text("INSERT INTO uniform_sizes (item_id, label) VALUES (:i, 'ONE')"), {"i": cap}
        )


@pytest.mark.parametrize(
    "sql",
    [
        "UPDATE uniform_sizes SET on_hand = -1",
        "UPDATE uniform_sizes SET min_qty = -1",
        "UPDATE uniform_items SET default_qty = 0",
        "UPDATE uniform_items SET group_key = 'navy'",
        "UPDATE uniform_items SET tracking = 'stock' WHERE drawing = 'cap'",
        "UPDATE uniform_items SET drawing = 'hat' WHERE drawing = 'cap'",
    ],
)
def test_catalogue_checks_reject_bad_values(migrated, sql: str) -> None:
    _, engine = migrated
    with pytest.raises(IntegrityError), engine.begin() as connection:
        connection.execute(text(sql))


def test_posting_checks(migrated) -> None:
    _, engine = migrated
    size = _size_id(engine, "polo", "M")
    with engine.begin() as connection:
        connection.execute(
            text("INSERT INTO uniform_receipts (id, received_on) VALUES (1, '2026-01-01')")
        )
    bad = [
        "UPDATE uniform_receipts SET voided_at = '2026-01-02'",
        "UPDATE uniform_receipts SET voided_at = '2026-01-02', void_reason = '   '",
        "UPDATE uniform_receipts SET void_reason = 'reason without timestamp'",
        f"INSERT INTO uniform_receipt_lines (receipt_id, size_id, qty) VALUES (1, {size}, 0)",
        f"INSERT INTO uniform_adjustments (size_id, delta, reason, adjusted_on) "
        f"VALUES ({size}, 0, 'count', '2026-01-01')",
        f"INSERT INTO uniform_adjustments (size_id, delta, reason, adjusted_on) "
        f"VALUES ({size}, 1, '  ', '2026-01-01')",
    ]
    for sql in bad:
        with pytest.raises(IntegrityError), engine.begin() as connection:
            connection.execute(text(sql))
    with engine.begin() as connection:
        connection.execute(
            text(
                "UPDATE uniform_receipts SET voided_at = '2026-01-02', "
                "voided_by_id = NULL, void_reason = 'Wrong date'"
            )
        )
        connection.execute(
            text(
                "INSERT INTO employees (id, name_en, created_at, updated_at) "
                "VALUES ('T-1', 'Synthetic', '2026-01-01', '2026-01-01')"
            )
        )
        connection.execute(
            text(
                "INSERT INTO uniform_returns (id, employee_id, returned_on) VALUES (1, 'T-1', '2026-01-01')"
            )
        )
    with pytest.raises(IntegrityError), engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO uniform_return_lines (return_id, item_id, size_id, qty, condition) "
                f"VALUES (1, {_item_id(engine, 'polo')}, {size}, 1, 'lost')"
            )
        )
    with pytest.raises(IntegrityError), engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO uniform_issues (employee_id, issued_on) VALUES ('NOPE', '2026-01-01')"
            )
        )


def test_round_trip_drops_everything_and_reseeds(migrated) -> None:
    config, engine = migrated
    command.downgrade(config, PARENT)
    with engine.connect() as connection:
        assert not TABLES & set(inspect(connection).get_table_names())
    command.upgrade(config, HEAD)
    with engine.connect() as connection:
        assert set(inspect(connection).get_table_names()) >= TABLES
        assert connection.execute(text("SELECT count(*) FROM uniform_items")).scalar() == 8
        drawing_index = connection.execute(
            text("SELECT sql FROM sqlite_master WHERE name = 'uq_uniform_items_drawing_active'")
        ).scalar_one()
        assert "archived_at IS NULL" in drawing_index


def test_guarded_decrement_never_goes_negative(migrated) -> None:
    _, engine = migrated
    size = _size_id(engine, "boots", "42")
    with Session(engine) as db:
        assert uniform_repo.decrement_on_hand(db, size, 1) == 0
        assert uniform_repo.increment_on_hand(db, size, 3) == 1
        assert uniform_repo.decrement_on_hand(db, size, 4) == 0
        assert uniform_repo.decrement_on_hand(db, size, 3) == 1
        assert uniform_repo.decrement_on_hand(db, size, 1) == 0
        assert uniform_repo.increment_on_hand(db, 999_999, 1) == 0
        assert uniform_repo.balances(db)[size] == 0
        with pytest.raises(ValueError):
            uniform_repo.decrement_on_hand(db, size, 0)
        with pytest.raises(ValueError):
            uniform_repo.increment_on_hand(db, size, -2)


def test_holdings_and_ledger_skip_voided_and_damaged(migrated) -> None:
    _, engine = migrated
    polo = _item_id(engine, "polo")
    suit = _item_id(engine, "suit")
    m = _size_id(engine, "polo", "M")
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO employees (id, name_en, created_at, updated_at) VALUES "
                "('E1', 'A', '2026-01-01', '2026-01-01'), ('E2', 'B', '2026-01-01', '2026-01-01')"
            )
        )
        connection.execute(
            text("INSERT INTO uniform_receipts (id, received_on) VALUES (1, '2026-01-01')")
        )
        connection.execute(
            text(
                f"INSERT INTO uniform_receipt_lines (receipt_id, size_id, qty) VALUES (1, {m}, 10)"
            )
        )
        connection.execute(
            text(
                "INSERT INTO uniform_issues (id, employee_id, issued_on) VALUES "
                "(1, 'E1', '2026-01-02'), (2, 'E2', '2026-01-02')"
            )
        )
        connection.execute(
            text(
                "INSERT INTO uniform_issue_lines (issue_id, item_id, size_id, qty) VALUES "
                f"(1, {polo}, {m}, 3), (1, {suit}, NULL, 2), (2, {polo}, {m}, 4)"
            )
        )
        connection.execute(
            text(
                "UPDATE uniform_issues SET voided_at = '2026-01-03', void_reason = 'Typo' "
                "WHERE id = 2"
            )
        )
        connection.execute(
            text(
                "INSERT INTO uniform_returns (id, employee_id, returned_on) VALUES "
                "(1, 'E1', '2026-01-04')"
            )
        )
        connection.execute(
            text(
                "INSERT INTO uniform_return_lines (return_id, item_id, size_id, qty, condition) "
                f"VALUES (1, {polo}, {m}, 1, 'damaged'), (1, {polo}, {m}, 1, 'reusable'), "
                f"(1, {suit}, NULL, 2, 'reusable')"
            )
        )
        connection.execute(
            text(
                "INSERT INTO uniform_adjustments (size_id, delta, reason, adjusted_on) "
                f"VALUES ({m}, -2, 'Recount', '2026-01-05')"
            )
        )
    with Session(engine) as db:
        assert uniform_repo.holdings(db) == [uniform_repo.Holding("E1", polo, m, 1)]
        assert uniform_repo.holdings(db, employee_id="E2") == []
        assert uniform_repo.held_qty(db, employee_id="E1", item_id=suit, size_id=None) == 0
        assert uniform_repo.held_qty(db, employee_id="E1", item_id=polo, size_id=m) == 1
        # 10 received - 3 issued + 1 reusable - 2 adjusted; damaged and voided ignored.
        assert uniform_repo.ledger_balances(db) == {m: 6}
    with pytest.raises(IntegrityError), engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO uniform_issue_lines (issue_id, item_id, size_id, qty) "
                f"VALUES (1, {suit}, NULL, 1)"
            )
        )
