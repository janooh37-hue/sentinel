"""Literal identifier search through the real consumers.

Records search (``book_service.list_books`` / ``GET /api/v1/books?q=``) and ledger search
(``search_service.search``) must treat what a user types as data, never as FTS5 syntax:

* hyphenated / slashed / comma-separated identifiers (``E-40817``, ``SP-2026-0142``,
  ``2026/1043``) are found in the *body* text, not only in subject/ref;
* the established records semantics are unchanged: whitespace-separated tokens are AND-ed
  and only the last token is a prefix match; ledger search stays one whole-input phrase;
* ``AND`` / ``OR`` / ``NOT`` / ``col:`` typed by a user are ordinary words;
* no query ever raises, and permission, deletion and exact-ref behaviour is untouched.

Every assertion is on what the caller gets back (rows, snippets, HTTP bodies) - never on how
the query string is built.
"""

from __future__ import annotations

import importlib.util
import itertools
import pathlib
from collections.abc import Iterator
from datetime import date, datetime
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.api.deps import get_current_user
from app.api.errors import NotFoundError
from app.core.book_text import build_search_text
from app.db import session as session_mod
from app.db.models import Base, Book, BookCategory, LedgerEntry
from app.db.session import attach_sqlite_pragmas, get_db
from app.main import create_app
from app.services import book_service, perm_service, search_service
from tests.conftest import make_user

_MIGRATION_0057 = (
    pathlib.Path(__file__).parent.parent / "app/db/migrations/versions/0057_books_fts.py"
)
_ref_seq = itertools.count(1)


# ---------------------------------------------------------------------------
# Records helpers
# ---------------------------------------------------------------------------


def _install_books_fts(bind) -> None:
    """Apply the real 0057 FTS DDL (same pattern as tests/test_books_search.py)."""
    spec = importlib.util.spec_from_file_location("migration_0057_literal_ids", _MIGRATION_0057)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)  # type: ignore[union-attr]
    raw = bind.raw_connection()
    for sql in mod.UPGRADE_SQL:
        raw.executescript(sql)
    raw.commit()


def _rebuild_books_fts(db: Session) -> None:
    raw = db.get_bind().raw_connection()
    raw.execute("INSERT INTO books_fts(books_fts) VALUES('rebuild')")
    raw.commit()


def _category(db: Session, category_id: str) -> None:
    if db.get(BookCategory, category_id) is None:
        db.add(BookCategory(id=category_id, prefix=category_id))
        db.commit()


def _book(
    db: Session,
    *,
    body: str = "",
    subject: str = "plain subject",
    ref: str | None = None,
    category: str = "GS",
    deleted: bool = False,
) -> Book:
    """A record whose searchable text goes through the production ``build_search_text``.

    Default subject/ref hold no punctuation, so a query for identifier text in ``body`` can
    only be satisfied by the full-text body index, never by the subject/ref substring match.
    """
    _category(db, category)
    ref = ref or f"REFX{next(_ref_seq)}"
    book = Book(
        category_id=category,
        ref_number=ref,
        subject=subject,
        approval_state="none",
        search_text=build_search_text(subject=subject, ref=ref, body=body),
        deleted_at=datetime(2026, 7, 1) if deleted else None,
    )
    db.add(book)
    db.commit()
    db.refresh(book)
    return book


def _books(db: Session, q: str | None, **kwargs) -> tuple[dict[str, str | None], int]:
    """``{ref_number: fts_snippet_or_None}`` for the rows ``list_books`` returns, plus total."""
    rows, total, snippets = book_service.list_books(db, q=q, limit=500, **kwargs)
    return {r.ref_number: snippets.get(r.id) for r in rows}, total


@pytest.fixture()
def books_db(db_session: Session) -> Session:
    _install_books_fts(db_session.get_bind())
    return db_session


# ---------------------------------------------------------------------------
# Identifiers are found in the body
# ---------------------------------------------------------------------------

# (query, body that must match, body of a near-miss decoy that must not)
_IDENTIFIER_CASES = [
    ("E-40817", "memo about E-40817 and staffing", "memo about E-50000 and staffing"),
    ("SP-2026-0142", "permit SP-2026-0142 issued", "permit SP-2026-0199 issued"),
    ("2026/1043", "see letter 2026/1043 filed", "see letter 2026/2043 filed"),
    ("1,204 visitors", "total 1,204 visitors that day", "total 1,205 visitors that day"),
    ("R-2031", "route R-2031 closed", "route R-2032 closed"),
    ("AUH 48213", "flight AUH 48213 arrival", "flight AUH 48999 arrival"),
    ("E-40817 vacation", "E-40817 vacation request", "E-50000 vacation request"),
    ('"E-40817"', "memo about E-40817 and staffing", "memo about E-50000 and staffing"),
    ("(E-40817)", "memo about E-40817 and staffing", "memo about E-50000 and staffing"),
    ("E-40817:", "memo about E-40817 and staffing", "memo about E-50000 and staffing"),
    ("\u200fE-40817\u200f", "memo about E-40817 and staffing", "memo about E-50000 and staffing"),
    ("تصريح SP-2026-0142", "تصريح رقم SP-2026-0142 للشاحنة", "تصريح رقم SP-2026-0199 للشاحنة"),
]


@pytest.mark.parametrize(
    ("query", "match_body", "decoy_body"),
    _IDENTIFIER_CASES,
    ids=[
        "hyphen",
        "multi-hyphen",
        "slash",
        "comma-number",
        "route-id",
        "plain-two-tokens",
        "id-plus-word",
        "user-quoted",
        "parenthesised",
        "trailing-colon",
        "bidi-wrapped",
        "arabic-plus-id",
    ],
)
def test_identifier_in_body_is_found_with_snippet(
    books_db: Session, query: str, match_body: str, decoy_body: str
) -> None:
    target = _book(books_db, body=match_body)
    _book(books_db, body=decoy_body)
    _book(books_db, body="unrelated filler text")
    _rebuild_books_fts(books_db)

    found, total = _books(books_db, query)

    assert set(found) == {target.ref_number}
    assert total == 1
    assert found[target.ref_number], "body-only match must carry the full-text snippet"


# ---------------------------------------------------------------------------
# Established records semantics stay exactly as they are
# ---------------------------------------------------------------------------


def test_tokens_are_anded_and_only_the_last_token_is_a_prefix(books_db: Session) -> None:
    both = _book(books_db, body="alpha beta")
    prefix_last = _book(books_db, body="alpha betamax")
    _book(books_db, body="alpha")
    _book(books_db, body="beta")
    _book(books_db, body="alphabet beta")  # first token is NOT a prefix match
    _rebuild_books_fts(books_db)

    found, _ = _books(books_db, "alpha beta")

    assert set(found) == {both.ref_number, prefix_last.ref_number}


def test_single_token_is_still_a_prefix_match(books_db: Session) -> None:
    target = _book(books_db, body="the vacation roster")
    _rebuild_books_fts(books_db)

    found, _ = _books(books_db, "vaca")

    assert set(found) == {target.ref_number}


# (typed query, body that literally contains those words, bodies that must NOT match)
_OPERATOR_CASES = [
    ("alpha OR beta", "alpha or beta", ["alpha", "beta"]),
    ("alpha AND beta", "alpha and beta", ["alpha beta"]),
    ("alpha NOT beta", "alpha not beta", ["alpha"]),
    ("search_text:foo", "search text foo", ["foo"]),
]


@pytest.mark.parametrize(
    ("query", "literal_body", "must_not_match"),
    _OPERATOR_CASES,
    ids=["or", "and", "not", "column-filter"],
)
def test_fts_operators_typed_by_users_are_plain_words(
    books_db: Session, query: str, literal_body: str, must_not_match: list[str]
) -> None:
    target = _book(books_db, body=literal_body)
    for body in must_not_match:
        _book(books_db, body=body)
    _rebuild_books_fts(books_db)

    found, _ = _books(books_db, query)

    assert set(found) == {target.ref_number}


@pytest.mark.parametrize(
    "query",
    [
        "-",
        "--",
        "(",
        ")",
        "()",
        ":",
        "^",
        "+",
        "{}",
        "[]",
        "*",
        "**",
        '"',
        '""',
        "'",
        "- - -",
        ",",
        "/",
        "\\",
    ],
)
def test_punctuation_only_query_matches_nothing_and_never_raises(
    books_db: Session, query: str
) -> None:
    _book(books_db, body="alpha beta gamma")
    _rebuild_books_fts(books_db)

    found, total = _books(books_db, query)

    assert found == {}
    assert total == 0


def test_arabic_text_and_arabic_punctuation(books_db: Session) -> None:
    target = _book(books_db, body="تقرير طبي مفصل عن الحالة")
    _book(books_db, body="تقرير مالي")
    _rebuild_books_fts(books_db)

    assert set(_books(books_db, "تقرير طبي")[0]) == {target.ref_number}
    assert target.ref_number in _books(books_db, "تقرير،")[0]


def test_arabic_alef_variants_are_normalised_on_both_sides(books_db: Session) -> None:
    target = _book(books_db, body="تصريح أمني للمنطقة الشرقية")
    _rebuild_books_fts(books_db)

    assert set(_books(books_db, "امني")[0]) == {target.ref_number}
    assert set(_books(books_db, "أمني")[0]) == {target.ref_number}


def test_mixed_arabic_and_hyphenated_id_requires_both(books_db: Session) -> None:
    target = _book(books_db, body="تقرير مفصل عن E-40817")
    _book(books_db, body="تقرير مفصل")
    _book(books_db, body="E-40817 فقط")
    _rebuild_books_fts(books_db)

    found, _ = _books(books_db, "تقرير E-40817")

    assert set(found) == {target.ref_number}


@pytest.mark.parametrize("query", ["", "   ", "\t\n  "])
def test_blank_query_behaves_like_no_query(books_db: Session, query: str) -> None:
    _book(books_db, body="E-40817 note")
    _book(books_db, body="other note")
    _rebuild_books_fts(books_db)

    everything, total_all = _books(books_db, None)
    found, total = _books(books_db, query)

    assert set(found) == set(everything)
    assert total == total_all == 2
    assert all(snippet is None for snippet in found.values())


# ---------------------------------------------------------------------------
# Control characters and size
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "query",
    ["E-40817\x00", "a\x00b", "E-40817\x00 vacation"],
    ids=["trailing", "inside", "second-token"],
)
def test_nul_in_query_fails_closed_for_full_text_search(books_db: Session, query: str) -> None:
    """A NUL cannot be quoted into an FTS literal. It must neither be dropped (``a\\x00b`` ->
    ``ab`` / ``a b`` would match other records) nor raise: the body search returns nothing."""
    _book(books_db, body="E-40817 vacation appears here")
    _book(books_db, body="ab")
    _book(books_db, body="a b")
    _rebuild_books_fts(books_db)

    found, total = _books(books_db, query)

    assert found == {}
    assert total == 0


def test_other_control_characters_separate_words_like_the_tokenizer_does(books_db: Session) -> None:
    both = _book(books_db, body="alpha beta")
    _book(books_db, body="alphabeta")
    _book(books_db, body="alpha")
    _book(books_db, body="beta")
    _rebuild_books_fts(books_db)

    found, _ = _books(books_db, "alpha\x01beta")

    assert set(found) == {both.ref_number}


def test_large_query_keeps_every_constraint(books_db: Session) -> None:
    """No term may be silently dropped: a record missing ANY one of 1000 words is not a match."""
    words = [f"w{n:04d}" for n in range(1000)]
    full = _book(books_db, body=" ".join(words))
    for skipped in ("w0000", "w0500", "w0999"):
        _book(books_db, body=" ".join(w for w in words if w != skipped))
    _rebuild_books_fts(books_db)

    found, _ = _books(books_db, " ".join(words))

    assert set(found) == {full.ref_number}


def test_large_hyphenated_identifier_query_keeps_every_constraint(books_db: Session) -> None:
    ids = [f"ID-{n:04d}" for n in range(500)]
    full = _book(books_db, body=" ".join(ids))
    for skipped in ("ID-0000", "ID-0250", "ID-0499"):
        _book(books_db, body=" ".join(i for i in ids if i != skipped))
    _rebuild_books_fts(books_db)

    found, _ = _books(books_db, " ".join(ids))

    assert set(found) == {full.ref_number}


def test_very_long_token_neither_raises_nor_broadens(books_db: Session) -> None:
    _book(books_db, body="alpha beta")
    _rebuild_books_fts(books_db)

    assert _books(books_db, "x" * 40_000)[0] == {}
    assert _books(books_db, "alpha " + "x" * 40_000)[0] == {}


# ---------------------------------------------------------------------------
# Permissions, deletion, freshness, exact ref
# ---------------------------------------------------------------------------


def _restricted_scenario(db: Session) -> SimpleNamespace:
    visible = _book(db, body="visit log E-40817 for the gate", category="GS")
    hidden = _book(db, body="classified sensitive E-40817 watch list", category="SEC")
    deleted = _book(db, body="deleted note E-40817", category="GS", deleted=True)
    _rebuild_books_fts(db)
    admin = make_user(db, role="admin", email="admin-lit@test.ae")
    clerk = make_user(db, role="operator", email="clerk-lit@test.ae")
    perm_service.set_user_override(db, clerk.id, "books.category.SEC", "deny", actor=admin)
    return SimpleNamespace(
        visible=visible, hidden=hidden, deleted=deleted, admin=admin, clerk=clerk
    )


def test_restricted_user_never_gets_a_hidden_record_for_an_identifier(books_db: Session) -> None:
    s = _restricted_scenario(books_db)

    admin_found, admin_total = _books(books_db, "E-40817", user=s.admin)
    clerk_found, clerk_total = _books(books_db, "E-40817", user=s.clerk)

    assert set(admin_found) == {s.visible.ref_number, s.hidden.ref_number}
    assert admin_total == 2
    assert set(clerk_found) == {s.visible.ref_number}
    assert clerk_total == 1
    assert s.deleted.ref_number not in admin_found and s.deleted.ref_number not in clerk_found


def test_deleted_record_only_appears_when_asked(books_db: Session) -> None:
    s = _restricted_scenario(books_db)

    found, _ = _books(books_db, "E-40817", user=s.admin, include_deleted=True)

    assert s.deleted.ref_number in found


def test_revoking_the_deny_takes_effect_on_the_next_identifier_search(books_db: Session) -> None:
    s = _restricted_scenario(books_db)
    assert set(_books(books_db, "E-40817", user=s.clerk)[0]) == {s.visible.ref_number}

    perm_service.set_user_override(books_db, s.clerk.id, "books.category.SEC", None, actor=s.admin)

    assert set(_books(books_db, "E-40817", user=s.clerk)[0]) == {
        s.visible.ref_number,
        s.hidden.ref_number,
    }


def test_exact_ref_lookup_and_ref_substring_search_are_unchanged(books_db: Session) -> None:
    by_ref = _book(books_db, subject="permit", ref="SP-2026-0142")
    gone = _book(books_db, subject="permit", ref="SP-2026-0150", deleted=True)
    _rebuild_books_fts(books_db)

    assert book_service.get_book_by_ref(books_db, " sp-2026-0142 ").id == by_ref.id
    with pytest.raises(NotFoundError):
        book_service.get_book_by_ref(books_db, "SP-2026-0143")
    with pytest.raises(NotFoundError):
        book_service.get_book_by_ref(books_db, gone.ref_number)

    assert by_ref.ref_number in _books(books_db, "SP-2026-0142")[0]
    assert by_ref.ref_number in _books(books_db, "sp-2026-0142")[0]
    assert gone.ref_number not in _books(books_db, "SP-2026-0150")[0]


# ---------------------------------------------------------------------------
# API surface: GET /api/v1/books?q=
# ---------------------------------------------------------------------------


@pytest.fixture()
def books_api(monkeypatch: pytest.MonkeyPatch, tmp_path) -> Iterator[SimpleNamespace]:
    eng = create_engine(
        f"sqlite:///{tmp_path / 'literal_ids.db'}",
        future=True,
        connect_args={"check_same_thread": False},
    )
    attach_sqlite_pragmas(eng, wal=False)
    Base.metadata.create_all(eng)
    test_session = sessionmaker(bind=eng, autoflush=False, expire_on_commit=False, future=True)
    monkeypatch.setattr(session_mod, "engine", eng)
    monkeypatch.setattr(session_mod, "SessionLocal", test_session)
    db = test_session()
    perm_service.seed_role_defaults(db)
    _install_books_fts(eng)
    scenario = _restricted_scenario(db)
    current = {"user": scenario.admin}

    app = create_app()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: current["user"]
    with TestClient(app) as client:
        yield SimpleNamespace(client=client, current=current, **vars(scenario))
    db.close()
    eng.dispose()


def test_api_identifier_search_returns_snippet_and_hides_restricted_records(
    books_api: SimpleNamespace,
) -> None:
    books_api.current["user"] = books_api.admin
    admin_res = books_api.client.get("/api/v1/books", params={"q": "E-40817"})
    assert admin_res.status_code == 200
    admin_body = admin_res.json()
    assert {i["ref_number"] for i in admin_body["items"]} == {
        books_api.visible.ref_number,
        books_api.hidden.ref_number,
    }
    assert admin_body["total"] == 2
    assert all("40817" in (i["search_snippet"] or "") for i in admin_body["items"])

    books_api.current["user"] = books_api.clerk
    res = books_api.client.get("/api/v1/books", params={"q": "E-40817"})
    assert res.status_code == 200
    body = res.json()
    assert [i["ref_number"] for i in body["items"]] == [books_api.visible.ref_number]
    assert body["total"] == 1
    assert "40817" in body["items"][0]["search_snippet"]
    for secret in ("sensitive", "classified", books_api.hidden.ref_number):
        assert secret not in str(
            [
                (item["subject"], item["search_snippet"], item["ref_number"])
                for item in body["items"]
            ]
        )


# ---------------------------------------------------------------------------
# Ledger search (search_service.search): one whole-input phrase, unchanged
# ---------------------------------------------------------------------------


@pytest.fixture()
def ledger_db(db_session: Session) -> Session:
    search_service.create_fts_schema(db_session.get_bind())
    return db_session


def _entry(
    db: Session,
    *,
    notes: str = "",
    channel: str = "letter",
    owner: int | None = None,
    deleted: bool = False,
) -> LedgerEntry:
    entry = LedgerEntry(
        entry_date=date(2026, 7, 1),
        direction="outgoing",
        channel=channel,
        counterparty="Acme Trading",
        subject="plain note",
        notes_html=notes,
        attachment_paths=[],
        tags=[],
        owner_user_id=owner,
        to_recipients=[],
        cc_recipients=[],
        bcc_recipients=[],
        deleted_at=datetime(2026, 7, 1) if deleted else None,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


def _ledger(db: Session, q: str, **kwargs) -> set[int]:
    return {hit.entry.id for hit in search_service.search(db, q, **kwargs)}


@pytest.mark.parametrize("query", ["E-40817", '"E-40817"', "(E-40817)", "e-40817"])
def test_ledger_identifier_in_notes_is_found(ledger_db: Session, query: str) -> None:
    target = _entry(ledger_db, notes="ref E-40817 attached")
    _entry(ledger_db, notes="ref E-408170 attached")  # ledger has no prefix match
    _entry(ledger_db, notes="ref E-50000 attached")

    hits = search_service.search(ledger_db, query)

    assert [h.entry.id for h in hits] == [target.id]
    assert hits[0].snippet


def test_ledger_multi_word_query_is_one_phrase(ledger_db: Session) -> None:
    adjacent = _entry(ledger_db, notes="alpha beta")
    _entry(ledger_db, notes="beta alpha")
    _entry(ledger_db, notes="alpha gamma beta")
    _entry(ledger_db, notes="alpha betamax")

    assert _ledger(ledger_db, "alpha beta") == {adjacent.id}


def test_ledger_operator_words_are_plain_words(ledger_db: Session) -> None:
    literal = _entry(ledger_db, notes="alpha or beta")
    _entry(ledger_db, notes="alpha")
    _entry(ledger_db, notes="beta")

    assert _ledger(ledger_db, "alpha OR beta") == {literal.id}


@pytest.mark.parametrize("query", ["", "   ", "\t\n"])
def test_ledger_blank_query_returns_nothing(ledger_db: Session, query: str) -> None:
    _entry(ledger_db, notes="anything at all")

    assert search_service.search(ledger_db, query) == []


@pytest.mark.parametrize("query", ["-", '"', '""', "()", "- - -", "*"])
def test_ledger_punctuation_only_query_never_raises(ledger_db: Session, query: str) -> None:
    _entry(ledger_db, notes="alpha beta")

    assert search_service.search(ledger_db, query) == []


@pytest.mark.parametrize("query", ["E-40817\x00", "a\x00b"], ids=["trailing", "inside"])
def test_ledger_nul_fails_closed(ledger_db: Session, query: str) -> None:
    _entry(ledger_db, notes="E-40817 ab a b")

    assert search_service.search(ledger_db, query) == []


def test_ledger_owner_scope_and_deletion(ledger_db: Session) -> None:
    mine = _entry(ledger_db, notes="E-40817 mine", channel="email", owner=1)
    other_mail = _entry(ledger_db, notes="E-40817 theirs", channel="email", owner=2)
    shared = _entry(ledger_db, notes="E-40817 shared letter", channel="letter", owner=2)
    gone = _entry(ledger_db, notes="E-40817 removed", channel="letter", deleted=True)

    assert _ledger(ledger_db, "E-40817", owner_user_id=1) == {mine.id, shared.id}
    assert _ledger(ledger_db, "E-40817", owner_user_id=2) == {other_mail.id, shared.id}
    assert _ledger(ledger_db, "E-40817") == {mine.id, other_mail.id, shared.id}
    assert gone.id not in _ledger(ledger_db, "E-40817", owner_user_id=None)


def test_ledger_large_phrase_keeps_every_constraint(ledger_db: Session) -> None:
    ids = [f"ID-{n:04d}" for n in range(500)]
    exact = _entry(ledger_db, notes=" ".join(ids))
    _entry(ledger_db, notes=" ".join(i for i in ids if i != "ID-0250"))
    _entry(ledger_db, notes=" ".join(reversed(ids)))

    assert _ledger(ledger_db, " ".join(ids), limit=200) == {exact.id}


def test_ledger_very_long_token_neither_raises_nor_broadens(ledger_db: Session) -> None:
    _entry(ledger_db, notes="alpha beta")

    assert search_service.search(ledger_db, "x" * 40_000) == []
    assert search_service.search(ledger_db, "alpha " + "x" * 40_000) == []
