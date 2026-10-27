"""Migration 0111 adds private drafts and Revision saves without breaking FTS."""

from collections.abc import Iterator
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import Engine, create_engine, event, inspect, text
from sqlalchemy.exc import IntegrityError

ROOT = Path(__file__).resolve().parents[2]
HEAD = "0111_ledger_book_drafts"
PARENT = "0110_record_grade"
DRAFT_INSERT = (
    "INSERT INTO book_drafts (owner_user_id, created_at, updated_at{columns}) "
    "VALUES (7, '2026-10-01 00:00:00', '2026-10-01 00:00:00'{values})"
)


@pytest.fixture
def at_parent(tmp_path: Path) -> Iterator[tuple[Engine, Config]]:
    database = tmp_path / "ledger-drafts.db"
    config = Config(str(ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(ROOT / "backend/app/db/migrations"))
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
                    "VALUES (1, 'HR', 'HR-0001', 'zebraledger', '2026-10-01 00:00:00')"
                )
            )
            c.execute(
                text(
                    "INSERT INTO book_versions (id, book_id, version_no, trigger, status, created_at) "
                    "VALUES (1, 1, 1, 'initial', 'none', '2026-10-01 00:00:00')"
                )
            )
        yield engine, config
    finally:
        engine.dispose()


def assert_seed_and_fts_survive(engine: Engine) -> None:
    with engine.connect() as c:
        assert (
            c.execute(text("SELECT ref_number FROM books WHERE id = 1")).scalar_one() == "HR-0001"
        )
        assert c.execute(
            text("SELECT rowid FROM books_fts WHERE books_fts MATCH 'zebraledger'")
        ).scalars().all() == [1]
        triggers = set(
            c.execute(
                text(
                    "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'books_a_'"
                )
            ).scalars()
        )
        assert triggers == {"books_ai", "books_ad", "books_au"}


def test_single_head_follows_parent() -> None:
    config = Config(str(ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(ROOT / "backend/app/db/migrations"))
    script = ScriptDirectory.from_config(config)
    assert script.get_heads() == [HEAD]
    assert script.get_revision(HEAD).down_revision == PARENT


def test_upgrade_creates_columns_defaults_indexes_and_preserves_fts(
    at_parent: tuple[Engine, Config],
) -> None:
    engine, config = at_parent
    command.upgrade(config, HEAD)
    inspector = inspect(engine)
    drafts = {column["name"]: column for column in inspector.get_columns("book_drafts")}
    assert set(drafts) == {
        "id",
        "owner_user_id",
        "tab",
        "grade",
        "urgency",
        "subjects",
        "body_html",
        "created_at",
        "updated_at",
    }
    assert drafts["tab"]["nullable"] is True
    for name in (
        "owner_user_id",
        "grade",
        "urgency",
        "subjects",
        "body_html",
        "created_at",
        "updated_at",
    ):
        assert drafts[name]["nullable"] is False
    saves = {column["name"]: column for column in inspector.get_columns("ledger_book_saves")}
    assert set(saves) == {
        "id",
        "version_id",
        "saved_by_user_id",
        "saved_at",
        "subjects",
        "body_html",
        "content_sha256",
    }
    assert all(not column["nullable"] for column in saves.values())
    assert saves["content_sha256"]["type"].length == 64
    assert any(
        index["column_names"] == ["owner_user_id"] for index in inspector.get_indexes("book_drafts")
    )
    assert any(
        index["column_names"] == ["version_id"]
        for index in inspector.get_indexes("ledger_book_saves")
    )
    assert (
        next(
            column
            for column in inspector.get_columns("books")
            if column["name"] == "source_draft_id"
        )["nullable"]
        is True
    )
    with engine.begin() as c:
        c.execute(text(DRAFT_INSERT.format(columns="", values="")))
        assert c.execute(
            text("SELECT tab, grade, urgency, subjects, body_html FROM book_drafts")
        ).one() == (None, "unclassified", "Normal", "[]", "")
        assert (
            c.execute(text("SELECT source_draft_id FROM books WHERE id = 1")).scalar_one() is None
        )
    assert_seed_and_fts_survive(engine)


@pytest.mark.parametrize(
    "column,value", [("tab", 0), ("tab", 16), ("grade", "public"), ("urgency", "urgent")]
)
def test_database_rejects_invalid_draft_values(
    at_parent: tuple[Engine, Config], column: str, value: object
) -> None:
    engine, config = at_parent
    command.upgrade(config, HEAD)
    with pytest.raises(IntegrityError), engine.begin() as c:
        c.execute(
            text(DRAFT_INSERT.format(columns=f", {column}", values=", :value")), {"value": value}
        )


@pytest.mark.parametrize("tab", [1, 15])
def test_database_accepts_tab_boundaries(at_parent: tuple[Engine, Config], tab: int) -> None:
    engine, config = at_parent
    command.upgrade(config, HEAD)
    with engine.begin() as c:
        c.execute(text(DRAFT_INSERT.format(columns=", tab", values=", :tab")), {"tab": tab})
        assert c.execute(text("SELECT tab FROM book_drafts")).scalar_one() == tab


def test_revision_deletion_cascades_to_saved_content(at_parent: tuple[Engine, Config]) -> None:
    engine, config = at_parent
    command.upgrade(config, HEAD)
    with engine.begin() as c:
        assert c.execute(text("PRAGMA foreign_keys")).scalar_one() == 1
        c.execute(
            text(
                "INSERT INTO ledger_book_saves (version_id, saved_by_user_id, subjects, body_html, content_sha256) "
                "VALUES (1, 7, '[\"Subject\"]', '<p>Body</p>', :sha)"
            ),
            {"sha": "a" * 64},
        )
        assert c.execute(text("SELECT saved_at FROM ledger_book_saves")).scalar_one() is not None
        c.execute(text("DELETE FROM book_versions WHERE id = 1"))
        assert c.execute(text("SELECT COUNT(*) FROM ledger_book_saves")).scalar_one() == 0


def test_downgrade_and_reupgrade_preserve_books_and_fts(at_parent: tuple[Engine, Config]) -> None:
    engine, config = at_parent
    command.upgrade(config, HEAD)
    with engine.begin() as c:
        c.execute(text(DRAFT_INSERT.format(columns="", values="")))
        c.execute(text("UPDATE books SET source_draft_id = 1 WHERE id = 1"))
    command.downgrade(config, PARENT)
    inspector = inspect(engine)
    assert "book_drafts" not in inspector.get_table_names()
    assert "ledger_book_saves" not in inspector.get_table_names()
    assert "source_draft_id" not in {column["name"] for column in inspector.get_columns("books")}
    assert_seed_and_fts_survive(engine)
    command.upgrade(config, HEAD)
    assert {"book_drafts", "ledger_book_saves"} <= set(inspect(engine).get_table_names())
    with engine.begin() as c:
        c.execute(text(DRAFT_INSERT.format(columns="", values="")))
        assert c.execute(text("SELECT grade FROM book_drafts")).scalar_one() == "unclassified"
    assert_seed_and_fts_survive(engine)


def test_deleted_draft_ids_are_not_reused(at_parent: tuple[Engine, Config]) -> None:
    engine, config = at_parent
    command.upgrade(config, HEAD)
    insert = text(
        "INSERT INTO book_drafts (owner_user_id, created_at, updated_at) "
        "VALUES (1, '2026-10-01 00:00:00', '2026-10-01 00:00:00')"
    )
    with engine.begin() as c:
        first = c.execute(insert).lastrowid
        c.execute(text("DELETE FROM book_drafts WHERE id = :id"), {"id": first})
        second = c.execute(insert).lastrowid
    assert second > first
