"""Migration 0102: books.confidentiality + book_recipients."""

from __future__ import annotations

from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import Engine, create_engine, inspect, text
from sqlalchemy.exc import IntegrityError

ROOT = Path(__file__).resolve().parents[2]
HEAD = "0105_record_confidentiality"
PARENT = "0104_vehicle_maintenance_requests"


def _config(database: Path) -> Config:
    config = Config(str(ROOT / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", f"sqlite:///{database}")
    return config


def _at_parent_with_a_book(tmp_path: Path) -> tuple[Engine, Config]:
    database = tmp_path / "confidentiality.db"
    config = _config(database)
    command.upgrade(config, PARENT)
    engine = create_engine(f"sqlite:///{database}")
    with engine.begin() as c:
        c.execute(text("INSERT OR IGNORE INTO book_categories (id, prefix) VALUES ('HR', 'HR')"))
        c.execute(
            text(
                "INSERT INTO books (id, category_id, ref_number, search_text, created_at) "
                "VALUES (1, 'HR', 'HR-0001', 'zebra', '2026-10-01 00:00:00')"
            )
        )
    return engine, config


def _triggers(engine: Engine) -> set[str]:
    with engine.connect() as c:
        return {
            row[0]
            for row in c.execute(
                text(
                    "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'books_a_'"
                )
            )
        }


def _fts_hits(engine: Engine, term: str) -> list[int]:
    with engine.connect() as c:
        return [
            row[0]
            for row in c.execute(
                text("SELECT rowid FROM books_fts WHERE books_fts MATCH :t"), {"t": term}
            )
        ]


def test_head_follows_parent() -> None:
    script = ScriptDirectory.from_config(Config(str(ROOT / "alembic.ini")))
    heads = script.get_heads()
    assert len(heads) == 1
    assert HEAD in {revision.revision for revision in script.walk_revisions("base", heads[0])}
    assert script.get_revision(HEAD).down_revision == PARENT


def test_upgrade_defaults_existing_rows_and_enforces_the_level(tmp_path: Path) -> None:
    engine, config = _at_parent_with_a_book(tmp_path)

    command.upgrade(config, HEAD)

    with engine.begin() as c:
        assert c.execute(text("SELECT confidentiality FROM books WHERE id = 1")).scalar_one() == (
            "general"
        )
    with pytest.raises(IntegrityError), engine.begin() as c:
        c.execute(text("UPDATE books SET confidentiality = 'top' WHERE id = 1"))
    assert _triggers(engine) == {"books_ai", "books_ad", "books_au"}
    with engine.begin() as c:
        c.execute(text("UPDATE books SET search_text = 'giraffe' WHERE id = 1"))
    assert _fts_hits(engine, "giraffe") == [1]

    insert = text(
        "INSERT INTO book_recipients "
        "(book_id, user_id, sent_by_user_id, purpose, revoked_at, created_at) "
        "VALUES (1, 7, 3, :purpose, :revoked, '2026-10-01 00:00:00')"
    )
    with engine.begin() as c:
        c.execute(insert, {"purpose": "info", "revoked": "2026-10-01 00:00:00"})
        c.execute(insert, {"purpose": "action", "revoked": None})
    # One ACTIVE row per (book, user); revoked history rows don't count.
    with pytest.raises(IntegrityError), engine.begin() as c:
        c.execute(insert, {"purpose": "sign", "revoked": None})
    with pytest.raises(IntegrityError), engine.begin() as c:
        c.execute(insert, {"purpose": "notify", "revoked": "2026-10-02 00:00:00"})
    engine.dispose()


def test_downgrade_round_trip(tmp_path: Path) -> None:
    engine, config = _at_parent_with_a_book(tmp_path)

    command.upgrade(config, HEAD)
    command.downgrade(config, PARENT)

    with engine.connect() as c:
        inspector = inspect(c)
        assert "confidentiality" not in {col["name"] for col in inspector.get_columns("books")}
        assert "book_recipients" not in inspector.get_table_names()
        assert c.execute(text("SELECT COUNT(*) FROM books")).scalar_one() == 1
    assert _triggers(engine) == {"books_ai", "books_ad", "books_au"}
    assert _fts_hits(engine, "zebra") == [1]

    command.upgrade(config, HEAD)
    with engine.connect() as c:
        assert "book_recipients" in inspect(c).get_table_names()
    engine.dispose()
