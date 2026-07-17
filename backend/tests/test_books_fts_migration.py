"""FTS5 trigger behaviour for books_fts — tested on a raw sqlite3 connection.

The db_session fixture builds schema from Base.metadata (no Alembic), so the
FTS virtual table and triggers never exist there.  Instead we spin up an
in-memory SQLite connection, run the same DDL the migration executes, and
verify the three sync triggers (ai / ad / au).
"""

from __future__ import annotations

import sqlite3


def _get_migration():
    """Import the migration module dynamically so the test is always in sync."""
    import importlib.util
    import pathlib

    p = pathlib.Path(__file__).parent.parent / "app/db/migrations/versions/0057_books_fts.py"
    spec = importlib.util.spec_from_file_location("migration_0057", p)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)  # type: ignore[union-attr]
    return mod


def _setup_db() -> sqlite3.Connection:
    """Create an in-memory DB with the books table + FTS index extracted from
    the migration module so this test always mirrors what Alembic will run."""
    conn = sqlite3.connect(":memory:")
    conn.execute(
        """
        CREATE TABLE books (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            search_text TEXT
        )
        """
    )

    mod = _get_migration()
    # Extract each DDL statement from the module's SQL strings.
    # The migration stores them as op.execute("""...""").  We reproduce by
    # pulling the _FTS_DDL and _TRIGGER_* constants or by re-running the
    # same literal strings the migration defines.
    for sql in mod.UPGRADE_SQL:
        conn.executescript(sql)

    conn.commit()
    return conn


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_fts_ai_trigger():
    """After INSERT a book row is findable via FTS MATCH."""
    conn = _setup_db()
    conn.execute("INSERT INTO books (search_text) VALUES (?)", ("التصاريح الأمنية للموظفين",))
    conn.commit()
    rows = conn.execute(
        "SELECT rowid FROM books_fts WHERE books_fts MATCH ?", ("التصاريح",)
    ).fetchall()
    assert rows, "ai trigger: inserted row should be in FTS index"


def test_fts_au_trigger():
    """After UPDATE old term disappears and new term is findable."""
    conn = _setup_db()
    conn.execute("INSERT INTO books (search_text) VALUES (?)", ("موضوع قديم",))
    conn.commit()
    conn.execute("UPDATE books SET search_text = ? WHERE id = 1", ("موضوع جديد",))
    conn.commit()

    old_hits = conn.execute(
        "SELECT rowid FROM books_fts WHERE books_fts MATCH ?", ("قديم",)
    ).fetchall()
    new_hits = conn.execute(
        "SELECT rowid FROM books_fts WHERE books_fts MATCH ?", ("جديد",)
    ).fetchall()

    assert not old_hits, "au trigger: old term should no longer match"
    assert new_hits, "au trigger: new term should match"


def test_fts_ad_trigger():
    """After DELETE the row is gone from the FTS index."""
    conn = _setup_db()
    conn.execute("INSERT INTO books (search_text) VALUES (?)", ("وثيقة مهمة",))
    conn.commit()
    conn.execute("DELETE FROM books WHERE id = 1")
    conn.commit()

    rows = conn.execute(
        "SELECT rowid FROM books_fts WHERE books_fts MATCH ?", ("وثيقة",)
    ).fetchall()
    assert not rows, "ad trigger: deleted row should no longer be in FTS index"
