"""Migration 0104: live record links, database constraints and reversibility."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import Engine, create_engine, event, inspect, text
from sqlalchemy.exc import IntegrityError

from app.db.models import BookLink

ROOT = Path(__file__).resolve().parents[2]
HEAD = "0107_book_links"
PARENT = "0106_recipient_state"


@pytest.fixture
def at_parent(tmp_path: Path) -> Iterator[tuple[Engine, Config]]:
    database = tmp_path / "book-links.db"
    config = Config(str(ROOT / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", f"sqlite:///{database}")
    command.upgrade(config, PARENT)
    engine = create_engine(f"sqlite:///{database}")

    @event.listens_for(engine, "connect")
    def enable_foreign_keys(connection, _record) -> None:
        connection.execute("PRAGMA foreign_keys = ON")

    try:
        with engine.begin() as c:
            c.execute(
                text("INSERT OR IGNORE INTO book_categories (id, prefix) VALUES ('HR', 'HR')")
            )
            c.execute(
                text(
                    "INSERT INTO books (id, category_id, ref_number, search_text, created_at) "
                    "VALUES (:id, 'HR', :ref, 'zebra', '2026-10-01 00:00:00')"
                ),
                [{"id": value, "ref": f"HR-{value:04d}"} for value in range(1, 5)],
            )
        yield engine, config
    finally:
        engine.dispose()


def test_revision_follows_parent_in_single_head_history() -> None:
    script = ScriptDirectory.from_config(Config(str(ROOT / "alembic.ini")))
    heads = script.get_heads()
    assert len(heads) == 1
    assert HEAD in {revision.revision for revision in script.walk_revisions("base", heads[0])}
    assert script.get_revision(HEAD).down_revision == PARENT


def test_upgrade_schema_defaults_constraints_and_cascades(at_parent: tuple[Engine, Config]) -> None:
    engine, config = at_parent
    command.upgrade(config, HEAD)

    inspector = inspect(engine)
    columns = {column["name"]: column for column in inspector.get_columns("book_links")}
    expected_nullable = {
        "id": False,
        "book_id": False,
        "target_book_id": False,
        "kind": False,
        "attached": False,
        "created_by_user_id": True,
        "created_at": False,
    }
    assert {name: column["nullable"] for name, column in columns.items()} == expected_nullable
    assert {
        column.name: column.nullable for column in BookLink.__table__.columns
    } == expected_nullable
    assert columns["kind"]["type"].length == BookLink.__table__.c.kind.type.length == 16
    expected_types = {
        "id": "INTEGER",
        "book_id": "INTEGER",
        "target_book_id": "INTEGER",
        "kind": "VARCHAR(16)",
        "attached": "BOOLEAN",
        "created_by_user_id": "INTEGER",
        "created_at": "DATETIME",
    }
    assert {name: str(column["type"]) for name, column in columns.items()} == expected_types
    assert {
        column.name: str(column.type) for column in BookLink.__table__.columns
    } == expected_types
    assert BookLink.__table__.c.attached.default.arg is False
    assert BookLink.__table__.c.attached.server_default.arg == "0"
    assert inspector.get_pk_constraint("book_links")["constrained_columns"] == ["id"]
    assert {constraint["name"] for constraint in inspector.get_check_constraints("book_links")} == {
        "ck_book_links_kind"
    }
    assert {
        (constraint["name"], tuple(constraint["column_names"]))
        for constraint in inspector.get_unique_constraints("book_links")
    } == {("uq_book_links_pair", ("book_id", "target_book_id"))}
    assert {
        (index["name"], tuple(index["column_names"]), bool(index["unique"]))
        for index in inspector.get_indexes("book_links")
    } == {("ix_book_links_target", ("target_book_id",), False)}
    assert {
        (
            tuple(foreign_key["constrained_columns"]),
            foreign_key["referred_table"],
            tuple(foreign_key["referred_columns"]),
            foreign_key["options"]["ondelete"],
        )
        for foreign_key in inspector.get_foreign_keys("book_links")
    } == {
        (("book_id",), "books", ("id",), "CASCADE"),
        (("target_book_id",), "books", ("id",), "CASCADE"),
    }

    insert = text(
        "INSERT INTO book_links (book_id, target_book_id, kind, created_at) "
        "VALUES (:book, :target, :kind, '2026-10-01 00:00:00')"
    )
    with engine.begin() as c:
        c.execute(insert, {"book": 1, "target": 2, "kind": "reply"})
        c.execute(insert, {"book": 1, "target": 3, "kind": "based_on"})
        c.execute(insert, {"book": 1, "target": 4, "kind": "reference"})
        assert c.execute(
            text("SELECT attached, created_by_user_id FROM book_links ORDER BY id")
        ).all() == [(0, None), (0, None), (0, None)]
        c.execute(
            text(
                "UPDATE book_links SET attached = 1, created_by_user_id = 7 WHERE target_book_id = 4"
            )
        )
        assert c.execute(
            text("SELECT attached, created_by_user_id FROM book_links WHERE target_book_id = 4")
        ).one() == (1, 7)
        # The ordered pair is unique; the reverse direction is a separate link.
        c.execute(insert, {"book": 2, "target": 1, "kind": "reply"})
        c.execute(insert, {"book": 2, "target": 3, "kind": "based_on"})

    for values in (
        {"book": 1, "target": 2, "kind": "reference"},
        {"book": 3, "target": 2, "kind": "unknown"},
        {"book": 999, "target": 2, "kind": "reply"},
        {"book": 2, "target": 999, "kind": "reply"},
    ):
        with pytest.raises(IntegrityError), engine.begin() as c:
            c.execute(insert, values)
    for name in ("book_id", "target_book_id", "kind", "attached", "created_at"):
        with pytest.raises(IntegrityError), engine.begin() as c:
            c.execute(text(f"UPDATE book_links SET {name} = NULL WHERE id = 1"))

    with engine.begin() as c:
        c.execute(text("DELETE FROM books WHERE id = 1"))
        assert c.execute(text("SELECT book_id, target_book_id FROM book_links")).all() == [(2, 3)]
        c.execute(text("DELETE FROM books WHERE id = 3"))
        assert c.execute(text("SELECT COUNT(*) FROM book_links")).scalar_one() == 0


def test_downgrade_round_trip_preserves_books_and_parent_schema(
    at_parent: tuple[Engine, Config],
) -> None:
    engine, config = at_parent
    command.upgrade(config, HEAD)
    with engine.begin() as c:
        c.execute(
            text(
                "INSERT INTO book_links (book_id, target_book_id, kind, attached, created_at) "
                "VALUES (1, 2, 'reference', 1, '2026-10-01 00:00:00')"
            )
        )
    command.downgrade(config, PARENT)
    with engine.connect() as c:
        inspector = inspect(c)
        assert "book_links" not in inspector.get_table_names()
        assert {"done_at", "archived_at"} <= {
            column["name"] for column in inspector.get_columns("book_recipients")
        }
        assert c.execute(text("SELECT version_num FROM alembic_version")).scalar_one() == PARENT
        assert c.execute(text("SELECT id, ref_number FROM books ORDER BY id")).all() == [
            (1, "HR-0001"),
            (2, "HR-0002"),
            (3, "HR-0003"),
            (4, "HR-0004"),
        ]
        assert c.execute(
            text("SELECT rowid FROM books_fts WHERE books_fts MATCH 'zebra'")
        ).all() == [(1,), (2,), (3,), (4,)]

    command.upgrade(config, HEAD)
    with engine.begin() as c:
        assert "book_links" in inspect(c).get_table_names()
        assert c.execute(text("SELECT COUNT(*) FROM book_links")).scalar_one() == 0
        c.execute(
            text(
                "INSERT INTO book_links (book_id, target_book_id, kind, created_at) "
                "VALUES (1, 2, 'reply', '2026-10-01 00:00:00')"
            )
        )
        assert c.execute(text("SELECT attached FROM book_links")).scalar_one() == 0
