"""Standalone template sessions preserve book rows and the partial unique index."""

from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect, text

from app.db.models import BookEditSession

ROOT = Path(__file__).resolve().parents[2]
HEAD = "0101_word_template_sessions"
PARENT = "0100_merge_heads"


def test_single_head_and_model_parity():
    scripts = ScriptDirectory.from_config(Config(str(ROOT / "alembic.ini")))
    assert scripts.get_heads() == [HEAD]
    assert scripts.get_revision(HEAD).down_revision == PARENT
    assert BookEditSession.__table__.c.book_id.nullable
    column = BookEditSession.__table__.c.template_name
    assert column.nullable and column.type.length == 255


def test_upgrade_downgrade_and_reupgrade(tmp_path):
    database = tmp_path / "sessions.db"
    engine = create_engine(f"sqlite:///{database}")
    config = Config(str(ROOT / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", f"sqlite:///{database}")
    with engine.begin() as connection:
        connection.exec_driver_sql("CREATE TABLE books (id INTEGER PRIMARY KEY)")
        connection.exec_driver_sql("INSERT INTO books VALUES (1)")
        connection.exec_driver_sql(
            "CREATE TABLE book_edit_sessions (id INTEGER PRIMARY KEY, "
            "book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE, "
            "user_id INTEGER NOT NULL, state VARCHAR(16), token VARCHAR(64) UNIQUE)"
        )
        connection.exec_driver_sql(
            "CREATE UNIQUE INDEX uq_book_edit_sessions_active "
            "ON book_edit_sessions(book_id) WHERE state = 'active'"
        )
        connection.exec_driver_sql(
            "INSERT INTO book_edit_sessions VALUES (1, 1, 1, 'active', 'book')"
        )
        connection.exec_driver_sql(
            "CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL)"
        )
        connection.execute(text("INSERT INTO alembic_version VALUES (:v)"), {"v": PARENT})
    command.upgrade(config, HEAD)
    with engine.begin() as connection:
        columns = {c["name"]: c for c in inspect(connection).get_columns("book_edit_sessions")}
        assert columns["book_id"]["nullable"]
        assert columns["template_name"]["nullable"]
        connection.exec_driver_sql(
            "INSERT INTO book_edit_sessions (book_id, user_id, state, token, template_name) "
            "VALUES (NULL, 1, 'active', 'template1', 'One.docx'), "
            "(NULL, 1, 'active', 'template2', 'Two.docx')"
        )
        assert connection.execute(text("SELECT COUNT(*) FROM book_edit_sessions")).scalar_one() == 3
    command.downgrade(config, PARENT)
    with engine.connect() as connection:
        columns = {c["name"]: c for c in inspect(connection).get_columns("book_edit_sessions")}
        assert not columns["book_id"]["nullable"]
        assert "template_name" not in columns
        assert connection.execute(text("SELECT token FROM book_edit_sessions")).scalars().all() == [
            "book"
        ]
        assert any(
            index["name"] == "uq_book_edit_sessions_active" and index["unique"]
            for index in inspect(connection).get_indexes("book_edit_sessions")
        )
    command.upgrade(config, HEAD)
    engine.dispose()
