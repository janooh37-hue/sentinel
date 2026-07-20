"""Task 16 — FTS body-search endpoint + snippet.

TDD: RED → implement → GREEN.

Covers:
- Arabic body word (with alef variant) found via FTS; BookRead.search_snippet set.
- Slashed ref 1/5/141 matched via ilike; search_snippet is None.
- q absent → all rows returned unchanged.
- FTS-error fallback: when books_fts is absent, ilike still finds subject/ref hits.
"""

from __future__ import annotations

import importlib.util
import pathlib
import secrets

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _get_migration_0057():
    p = pathlib.Path(__file__).parent.parent / "app/db/migrations/versions/0057_books_fts.py"
    spec = importlib.util.spec_from_file_location("migration_0057", p)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)  # type: ignore[union-attr]
    return mod


def _install_fts(db_session) -> None:
    """Apply the 0057 FTS DDL to the test connection (mirrors test_book_text pattern)."""
    raw = db_session.get_bind().raw_connection()
    mod = _get_migration_0057()
    for sql in mod.UPGRADE_SQL:
        raw.executescript(sql)
    raw.commit()


def _make_category(db):
    from app.db.models import BookCategory

    if db.get(BookCategory, "GS") is None:
        db.add(BookCategory(id="GS", prefix="GS"))
        db.commit()


def _make_user(db):
    from app.db.models import User

    u = User(email=f"{secrets.token_hex(4)}@test.ae", password_hash="x", status="active")
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _make_book(db, *, ref_number: str, subject: str, search_text: str | None = None):
    from app.db.models import Book

    book = Book(
        category_id="GS",
        ref_number=ref_number,
        subject=subject,
        approval_state="none",
        search_text=search_text,
    )
    db.add(book)
    db.commit()
    db.refresh(book)
    return book


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_fts_body_match_returns_snippet(db_session):
    """A book whose search_text contains an Arabic word is found by list_books(q=...)
    and the returned BookRead has a non-None search_snippet."""
    _install_fts(db_session)
    _make_category(db_session)

    from app.core.book_text import normalize_ar

    body = "تصريح أمني للمنطقة الشرقية"
    book = _make_book(
        db_session,
        ref_number="GS-0001",
        subject="موضوع عام",
        search_text=normalize_ar(body),
    )
    # Rebuild FTS index so the existing row is indexed.
    raw = db_session.get_bind().raw_connection()
    raw.execute("INSERT INTO books_fts(books_fts) VALUES('rebuild')")
    raw.commit()

    from app.services.book_service import list_books

    # Query with alef-variant: "أمني" (hamza above) vs stored "امني" (plain alef after normalize).
    rows, total, snippets = list_books(db_session, q="أمني")

    assert total >= 1
    found = [r for r in rows if r.id == book.id]
    assert found, "FTS body match should return the book"
    assert book.id in snippets, "snippet map should contain the book id"
    snippet = snippets[book.id]
    assert snippet, "snippet should be non-empty"
    # The snippet uses [ ] delimiters around the matched token.
    assert "[" in snippet, f"snippet should contain bracketed highlight, got: {snippet!r}"


def test_slashed_ref_ilike_match(db_session):
    """A slashed ref like 1/5/141 is found via ilike (not FTS) and
    search_snippet is None for that row."""
    _install_fts(db_session)
    _make_category(db_session)

    book = _make_book(
        db_session,
        ref_number="1/5/141",
        subject="وثيقة رسمية",
        search_text=None,  # no body — ilike only
    )
    raw = db_session.get_bind().raw_connection()
    raw.execute("INSERT INTO books_fts(books_fts) VALUES('rebuild')")
    raw.commit()

    from app.services.book_service import list_books

    rows, total, snippets = list_books(db_session, q="1/5/141")

    assert total >= 1
    found = [r for r in rows if r.id == book.id]
    assert found, "slashed ref should be matched via ilike"
    # ilike-only hit: no FTS snippet.
    assert book.id not in snippets, "ilike-only hit should have no snippet"


def test_no_q_returns_all(db_session):
    """When q is absent, all non-deleted books are returned (baseline behavior)."""
    _install_fts(db_session)
    _make_category(db_session)

    _make_book(db_session, ref_number="GS-0010", subject="أول")
    _make_book(db_session, ref_number="GS-0011", subject="ثاني")

    from app.services.book_service import list_books

    _rows, total, snippets = list_books(db_session)

    assert total >= 2
    assert snippets == {}, "no q → snippet map should be empty"


def test_fts_error_fallback_ilike(db_session):
    """When books_fts doesn't exist, list_books falls back to ilike-only
    and still finds subject/ref matches (search_snippet absent)."""
    # Deliberately do NOT install FTS — the table is missing.
    _make_category(db_session)

    book = _make_book(
        db_session,
        ref_number="GS-0020",
        subject="تقرير سنوي",
    )

    from app.services.book_service import list_books

    # Should not raise even though books_fts doesn't exist.
    rows, total, snippets = list_books(db_session, q="تقرير")

    assert total >= 1
    found = [r for r in rows if r.id == book.id]
    assert found, "ilike fallback should find the book by subject"
    assert snippets == {}, "FTS errored → snippet map should be empty"
