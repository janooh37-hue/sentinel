"""Migration 0112: Ledger Book Importance replaces draft urgency without breaking FTS."""

from collections.abc import Iterator
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import Engine, create_engine, inspect, text
from sqlalchemy.exc import IntegrityError

ROOT = Path(__file__).resolve().parents[2]
HEAD = "0112_ledger_book_importance"
PARENT = "0111_ledger_book_drafts"
DRAFT_INSERT = (
    "INSERT INTO book_drafts (owner_user_id, created_at, updated_at{columns}) "
    "VALUES (7, '2026-10-01 00:00:00', '2026-10-01 00:00:00'{values})"
)


def _config(database: Path) -> Config:
    config = Config(str(ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(ROOT / "backend/app/db/migrations"))
    config.set_main_option("sqlalchemy.url", f"sqlite:///{database}")
    return config


@pytest.fixture
def at_parent(tmp_path: Path) -> Iterator[tuple[Engine, Config]]:
    database = tmp_path / "ledger-importance.db"
    config = _config(database)
    command.upgrade(config, PARENT)
    engine = create_engine(f"sqlite:///{database}")
    try:
        with engine.begin() as c:
            c.execute(
                text("INSERT OR IGNORE INTO book_categories (id, prefix) VALUES ('HR', 'HR')")
            )
            c.execute(
                text(
                    "INSERT INTO books (id, category_id, ref_number, search_text, urgency, "
                    "created_at) VALUES (1, 'HR', 'HR-0001', 'zebraledger', 'Very High', "
                    "'2026-10-01 00:00:00')"
                )
            )
            c.execute(text(DRAFT_INSERT.format(columns=", urgency", values=", 'High'")))
        yield engine, config
    finally:
        engine.dispose()


def _columns(engine: Engine, table: str) -> dict[str, dict]:
    return {column["name"]: column for column in inspect(engine).get_columns(table)}


def _checks(engine: Engine, table: str) -> set[str | None]:
    return {check["name"] for check in inspect(engine).get_check_constraints(table)}


def assert_seed_and_fts_survive(engine: Engine) -> None:
    with engine.connect() as c:
        assert c.execute(text("SELECT ref_number, urgency FROM books WHERE id = 1")).one() == (
            "HR-0001",
            "Very High",
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
    # The FTS triggers still fire after the rebuild.
    with engine.begin() as c:
        c.execute(text("UPDATE books SET search_text = 'quokkaledger' WHERE id = 1"))
        assert c.execute(
            text("SELECT rowid FROM books_fts WHERE books_fts MATCH 'quokkaledger'")
        ).scalars().all() == [1]
        c.execute(text("UPDATE books SET search_text = 'zebraledger' WHERE id = 1"))


def test_single_head_follows_parent() -> None:
    script = ScriptDirectory.from_config(_config(ROOT / "unused.db"))
    heads = script.get_heads()
    assert len(heads) == 1
    assert HEAD in {revision.revision for revision in script.walk_revisions("base", heads[0])}
    assert script.get_revision(HEAD).down_revision == PARENT


def test_upgrade_adds_importance_drops_draft_urgency_and_preserves_fts(
    at_parent: tuple[Engine, Config],
) -> None:
    """T-M1"""
    engine, config = at_parent
    command.upgrade(config, HEAD)
    drafts, books = _columns(engine, "book_drafts"), _columns(engine, "books")
    assert "urgency" not in drafts
    assert "ck_book_drafts_urgency" not in _checks(engine, "book_drafts")
    assert "urgency" in books  # Word records keep Urgency.
    for columns in (drafts, books):
        assert columns["importance"]["nullable"] is True
        assert columns["importance"]["type"].length == 8
    assert "ck_book_drafts_importance" in _checks(engine, "book_drafts")
    assert "ck_books_importance" in _checks(engine, "books")
    with engine.begin() as c:
        assert c.execute(text("SELECT importance FROM books WHERE id = 1")).scalar_one() is None
        assert c.execute(text("SELECT importance FROM book_drafts")).scalar_one() is None
        for level in ("medium", "high"):
            c.execute(
                text(DRAFT_INSERT.format(columns=", importance", values=", :level")),
                {"level": level},
            )
            c.execute(text("UPDATE books SET importance = :level WHERE id = 1"), {"level": level})
        c.execute(text("UPDATE books SET importance = NULL WHERE id = 1"))
    assert_seed_and_fts_survive(engine)


@pytest.mark.parametrize("value", ["low", "High", ""])
@pytest.mark.parametrize("table", ["books", "book_drafts"])
def test_database_rejects_unknown_importance(
    at_parent: tuple[Engine, Config], table: str, value: str
) -> None:
    engine, config = at_parent
    command.upgrade(config, HEAD)
    with pytest.raises(IntegrityError), engine.begin() as c:
        c.execute(text(f"UPDATE {table} SET importance = :value"), {"value": value})


def test_downgrade_restores_draft_urgency_and_reupgrade_is_clean(
    at_parent: tuple[Engine, Config],
) -> None:
    """T-M2"""
    engine, config = at_parent
    command.upgrade(config, HEAD)
    with engine.begin() as c:
        c.execute(text("UPDATE books SET importance = 'high' WHERE id = 1"))
        c.execute(text("UPDATE book_drafts SET importance = 'medium'"))
    command.downgrade(config, PARENT)
    drafts, books = _columns(engine, "book_drafts"), _columns(engine, "books")
    assert "importance" not in drafts and "importance" not in books
    assert drafts["urgency"]["nullable"] is False
    assert "ck_book_drafts_urgency" in _checks(engine, "book_drafts")
    assert "ck_books_importance" not in _checks(engine, "books")
    with engine.begin() as c:
        assert c.execute(text("SELECT urgency FROM book_drafts")).scalars().all() == ["Normal"]
    with pytest.raises(IntegrityError), engine.begin() as c:
        c.execute(text(DRAFT_INSERT.format(columns=", urgency", values=", 'urgent'")))
    assert_seed_and_fts_survive(engine)
    command.upgrade(config, HEAD)
    assert "importance" in _columns(engine, "books")
    assert_seed_and_fts_survive(engine)


@pytest.mark.parametrize("target", [HEAD, PARENT])
def test_rebuilt_drafts_table_never_reuses_deleted_ids(
    at_parent: tuple[Engine, Config], target: str
) -> None:
    engine, config = at_parent
    command.upgrade(config, HEAD)
    if target == PARENT:
        command.downgrade(config, PARENT)
    with engine.begin() as c:
        first = c.execute(text(DRAFT_INSERT.format(columns="", values=""))).lastrowid
        c.execute(text("DELETE FROM book_drafts WHERE id >= :id"), {"id": first})
        second = c.execute(text(DRAFT_INSERT.format(columns="", values=""))).lastrowid
        indexes = {index["name"] for index in inspect(c).get_indexes("book_drafts")}
    assert second > first
    assert "ix_book_drafts_owner_user_id" in indexes


def _insert_draft(engine: Engine) -> int:
    with engine.begin() as c:
        return int(c.execute(text(DRAFT_INSERT.format(columns="", values=""))).lastrowid)


@pytest.mark.parametrize("empty", [False, True])
@pytest.mark.parametrize("direction", ["upgrade", "downgrade"])
def test_rebuild_keeps_draft_id_high_water_mark(
    at_parent: tuple[Engine, Config], direction: str, empty: bool
) -> None:
    """Ids of drafts deleted BEFORE the rebuild (Save & Send) are never reused."""
    engine, config = at_parent
    if direction == "downgrade":
        command.upgrade(config, HEAD)
    highest = max(_insert_draft(engine) for _ in range(3))
    with engine.begin() as c:
        if empty:
            c.execute(text("DELETE FROM book_drafts"))
        else:
            c.execute(text("DELETE FROM book_drafts WHERE id >= :id"), {"id": highest - 1})
    if direction == "upgrade":
        command.upgrade(config, HEAD)
    else:
        command.downgrade(config, PARENT)
    assert _insert_draft(engine) > highest
