"""Migration 0094: books.created_by_user_id (immutable creator) + backfill."""

from __future__ import annotations

from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import Engine, create_engine, inspect, text

from app.db.models import Book

ROOT = Path(__file__).resolve().parents[2]
HEAD = "0094_book_created_by"
PARENT = "0093_password_setup"


def _config(database: Path) -> Config:
    config = Config(str(ROOT / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", f"sqlite:///{database}")
    return config


def _seed_pre_migration_db(engine: Engine) -> None:
    """The slice of the 0093 schema the migration touches, with FTS triggers."""
    with engine.begin() as c:
        c.exec_driver_sql(
            "CREATE TABLE books (id INTEGER PRIMARY KEY, submitted_by_user_id INTEGER, "
            "search_text TEXT)"
        )
        c.exec_driver_sql(
            "CREATE TABLE book_versions (id INTEGER PRIMARY KEY, book_id INTEGER NOT NULL, "
            "version_no INTEGER NOT NULL, created_by_user_id INTEGER)"
        )
        c.exec_driver_sql(
            "CREATE TABLE book_edit_sessions (id INTEGER PRIMARY KEY, book_id INTEGER NOT NULL, "
            "user_id INTEGER NOT NULL, created_at DATETIME)"
        )
        c.exec_driver_sql(
            "CREATE VIRTUAL TABLE books_fts USING fts5("
            "search_text, content='books', content_rowid='id')"
        )
        c.exec_driver_sql(
            "CREATE TRIGGER books_ai AFTER INSERT ON books BEGIN "
            "INSERT INTO books_fts(rowid, search_text) "
            "VALUES (new.id, COALESCE(new.search_text, '')); END"
        )
        c.exec_driver_sql(
            "CREATE TRIGGER books_ad AFTER DELETE ON books BEGIN "
            "INSERT INTO books_fts(books_fts, rowid, search_text) "
            "VALUES ('delete', old.id, COALESCE(old.search_text, '')); END"
        )
        c.exec_driver_sql(
            "CREATE TRIGGER books_au AFTER UPDATE OF search_text ON books BEGIN "
            "INSERT INTO books_fts(books_fts, rowid, search_text) "
            "VALUES ('delete', old.id, COALESCE(old.search_text, '')); "
            "INSERT INTO books_fts(rowid, search_text) "
            "VALUES (new.id, COALESCE(new.search_text, '')); END"
        )

        # id, submitted_by_user_id
        for book_id, submitter in (
            (1, 31),  # v1 creator wins over session and submitter
            (2, 31),  # v1 creator NULL -> earliest session wins over submitter
            (3, 31),  # no versions, no sessions -> submitter
            (4, None),  # nothing recorded -> stays NULL
            (5, 31),  # v1 creator NULL, no session -> submitter
            (6, None),  # only a revision row exists: MIN(version_no) is that row
        ):
            c.execute(
                text("INSERT INTO books (id, submitted_by_user_id) VALUES (:id, :s)"),
                {"id": book_id, "s": submitter},
            )
        # (book_id, version_no, creator)
        for book_id, version_no, creator in (
            (1, 1, 11),
            (1, 2, 12),  # a later drafter must not displace the v1 creator
            (2, 1, None),
            (2, 2, 12),  # a revision creator is never a fallback
            (5, 1, None),
            (6, 2, 12),
        ):
            c.execute(
                text(
                    "INSERT INTO book_versions (book_id, version_no, created_by_user_id) "
                    "VALUES (:b, :v, :u)"
                ),
                {"b": book_id, "v": version_no, "u": creator},
            )
        # (book_id, user_id, created_at)
        for book_id, user_id, created_at in (
            (1, 21, "2026-01-01 00:00:00"),
            (2, 22, "2026-02-02 00:00:00"),  # later session, listed first
            (2, 21, "2026-02-01 00:00:00"),  # earliest session -> 21
        ):
            c.execute(
                text(
                    "INSERT INTO book_edit_sessions (book_id, user_id, created_at) "
                    "VALUES (:b, :u, :t)"
                ),
                {"b": book_id, "u": user_id, "t": created_at},
            )
        c.exec_driver_sql("CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL)")
        c.execute(text("INSERT INTO alembic_version VALUES (:v)"), {"v": PARENT})


def _creators(engine: Engine) -> dict[int, int | None]:
    with engine.connect() as c:
        return {
            row[0]: row[1]
            for row in c.execute(text("SELECT id, created_by_user_id FROM books ORDER BY id"))
        }


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


def test_model_declares_an_indexed_nullable_creator_column() -> None:
    column = Book.__table__.c.created_by_user_id
    assert column.nullable
    assert not column.foreign_keys
    assert any(
        index.name == "ix_books_created_by_user_id"
        and [c.name for c in index.columns] == [column.name]
        for index in Book.__table__.indexes
    )


def test_there_is_exactly_one_head() -> None:
    heads = ScriptDirectory.from_config(Config(str(ROOT / "alembic.ini"))).get_heads()
    assert heads == [HEAD]


def test_upgrade_backfills_in_precedence_order(tmp_path: Path) -> None:
    database = tmp_path / "created-by.db"
    engine = create_engine(f"sqlite:///{database}")
    _seed_pre_migration_db(engine)

    command.upgrade(_config(database), HEAD)

    assert _creators(engine) == {1: 11, 2: 21, 3: 31, 4: None, 5: 31, 6: 12}
    with engine.connect() as c:
        assert "ix_books_created_by_user_id" in {
            index["name"] for index in inspect(c).get_indexes("books")
        }
    engine.dispose()


def test_upgrade_keeps_fts_indexing_new_and_updated_rows(tmp_path: Path) -> None:
    database = tmp_path / "created-by-fts.db"
    engine = create_engine(f"sqlite:///{database}")
    _seed_pre_migration_db(engine)

    command.upgrade(_config(database), HEAD)

    assert _triggers(engine) == {"books_ai", "books_ad", "books_au"}
    with engine.begin() as c:
        c.execute(text("INSERT INTO books (id, search_text) VALUES (100, 'zebra crossing')"))
    assert _fts_hits(engine, "zebra") == [100]
    with engine.begin() as c:
        c.execute(text("UPDATE books SET search_text = 'giraffe' WHERE id = 100"))
    assert _fts_hits(engine, "zebra") == []
    assert _fts_hits(engine, "giraffe") == [100]
    engine.dispose()


def test_downgrade_and_reupgrade_round_trip(tmp_path: Path) -> None:
    database = tmp_path / "created-by-roundtrip.db"
    engine = create_engine(f"sqlite:///{database}")
    _seed_pre_migration_db(engine)
    config = _config(database)

    command.upgrade(config, HEAD)
    command.downgrade(config, PARENT)

    with engine.connect() as c:
        inspector = inspect(c)
        assert "created_by_user_id" not in {col["name"] for col in inspector.get_columns("books")}
        assert "ix_books_created_by_user_id" not in {
            index["name"] for index in inspector.get_indexes("books")
        }
        assert c.execute(text("SELECT COUNT(*) FROM books")).scalar_one() == 6
    assert _triggers(engine) == {"books_ai", "books_ad", "books_au"}
    with engine.begin() as c:
        c.execute(text("INSERT INTO books (id, search_text) VALUES (101, 'okapi')"))
    assert _fts_hits(engine, "okapi") == [101]

    command.upgrade(config, HEAD)

    assert _creators(engine) == {1: 11, 2: 21, 3: 31, 4: None, 5: 31, 6: 12, 101: None}
    assert _triggers(engine) == {"books_ai", "books_ad", "books_au"}
    engine.dispose()
