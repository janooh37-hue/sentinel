from __future__ import annotations

import shutil
from collections.abc import Iterator
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import Connection, Engine, create_engine, select, text
from sqlalchemy.orm import Session

from app.api.errors import AppError
from app.db.models import Book, User
from app.services import book_service, permit_service

ROOT = Path(__file__).resolve().parents[2]
BASE = "0116_outbound_skip_reason"
MERGE = "0117_merge_legacy_record_categories"
REVISION = "0118_drop_record_category_overreach"
EXPIRY = "2027-03-04 05:06:07.123456"


def _config(database: Path) -> Config:
    config = Config(str(ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(ROOT / "backend" / "app" / "db" / "migrations"))
    config.set_main_option("sqlalchemy.url", f"sqlite:///{database.as_posix()}")
    return config


@pytest.fixture(scope="module")
def base_database(tmp_path_factory: pytest.TempPathFactory) -> Path:
    database = tmp_path_factory.mktemp("record-category-overreach") / "baseline.db"
    command.upgrade(_config(database), BASE)
    return database


@pytest.fixture
def migration(base_database: Path, tmp_path: Path) -> Iterator[tuple[Config, Engine]]:
    database = tmp_path / "overreach.db"
    shutil.copyfile(base_database, database)
    config = _config(database)
    engine = create_engine(config.get_main_option("sqlalchemy.url"))
    try:
        yield config, engine
    finally:
        engine.dispose()


def _user(connection: Connection, email: str) -> int:
    return connection.execute(
        text(
            "INSERT INTO users (email, password_hash, role, status) "
            "VALUES (:email, 'x', 'operator', 'active') RETURNING id"
        ),
        {"email": email},
    ).scalar_one()


def _override(
    connection: Connection,
    user_id: int,
    capability: str,
    effect: str = "deny",
    expires_at: str | None = None,
) -> None:
    connection.execute(
        text(
            "INSERT INTO user_permissions (user_id, capability, effect, expires_at) "
            "VALUES (:user_id, :capability, :effect, :expires_at)"
        ),
        {"user_id": user_id, "capability": capability, "effect": effect, "expires_at": expires_at},
    )


def _book(
    connection: Connection,
    *,
    category_id: str,
    ref_number: str,
    template_id: str,
    classification_code: str | None = None,
) -> int:
    connection.execute(
        text("INSERT OR IGNORE INTO book_categories (id, prefix) VALUES (:id, :id)"),
        {"id": category_id},
    )
    book_id = connection.execute(
        text(
            "INSERT INTO books (category_id, classification_code, ref_number, subject, created_at) "
            "VALUES (:category_id, :classification_code, :ref_number, :ref_number, '2026-01-01') "
            "RETURNING id"
        ),
        {
            "category_id": category_id,
            "classification_code": classification_code,
            "ref_number": ref_number,
        },
    ).scalar_one()
    connection.execute(
        text(
            "INSERT INTO book_versions (book_id, version_no, template_id) "
            "VALUES (:book_id, 1, :template_id)"
        ),
        {"book_id": book_id, "template_id": template_id},
    )
    return book_id


def _overrides(connection: Connection, user_id: int) -> dict[str, tuple[str, str | None]]:
    return {
        row.capability: (row.effect, row.expires_at)
        for row in connection.execute(
            text(
                "SELECT capability, effect, expires_at FROM user_permissions "
                "WHERE user_id = :user_id"
            ),
            {"user_id": user_id},
        )
    }


def _visible(db: Session, user: User, book_id: int) -> bool:
    clause = book_service.user_visibility_clause(db, user)
    sql_visible = clause is None or db.scalar(select(Book.id).where(Book.id == book_id, clause))
    row = db.get(Book, book_id)
    assert row is not None
    try:
        book_service.assert_record_type_visible(db, user, row)
    except AppError as exc:
        assert exc.code == "RECORD_TYPE_FORBIDDEN"
        assert not sql_visible
        return False
    assert sql_visible
    return True


@pytest.mark.parametrize(
    ("legacy", "stray", "overreach"),
    [
        # An HR-filed classified General Book used to deny all of 5/1.
        (
            "HR",
            {"category_id": "HR", "template_id": "General Book", "classification_code": "5/1"},
            "books.category.5/1",
        ),
        # An inmate form revised into a General Book used to deny every General Book.
        (
            "INV",
            {"category_id": "INV", "template_id": "General Book"},
            "books.servicerecords.General Book",
        ),
        # An imported leave form in old-only category 1 used to deny every leave record.
        (
            "1",
            {"category_id": "1", "template_id": "Leave Application Form"},
            "books.servicerecords.Leave Application Form",
        ),
    ],
)
def test_legacy_deny_keeps_the_stray_record_hidden_without_hiding_permit_letters(
    migration: tuple[Config, Engine], legacy: str, stray: dict[str, str], overreach: str
) -> None:
    config, engine = migration
    with engine.begin() as connection:
        user_id = _user(connection, "permit-viewer@x.ae")
        _override(connection, user_id, f"books.category.{legacy}")
        stray_id = _book(connection, ref_number="STRAY-1", **stray)
        letter_id = _book(
            connection,
            category_id="GS",
            ref_number="1/5/0001",
            template_id="Security Permit",
            classification_code="5/1",
        )
        leave_id = _book(
            connection, category_id="HR", ref_number="HR-0001", template_id="Leave Application Form"
        )
    command.upgrade(config, MERGE)
    with engine.connect() as connection:
        merged = _overrides(connection, user_id)
    assert overreach in merged
    command.upgrade(config, REVISION)
    with engine.connect() as connection:
        repaired = _overrides(connection, user_id)
    assert repaired == {k: v for k, v in merged.items() if k != overreach}
    with Session(engine) as db:
        user = db.get(User, user_id)
        assert user is not None
        assert not _visible(db, user, stray_id)
        assert _visible(db, user, letter_id)
        letter = permit_service.readable_book(db, letter_id, user)
        assert letter is not None and letter.id == letter_id
        assert _visible(db, user, leave_id) is (legacy != "HR")
    command.downgrade(config, MERGE)
    with engine.connect() as connection:
        assert _overrides(connection, user_id) == merged


def test_a_tightened_existing_deny_gets_its_own_expiry_back(
    migration: tuple[Config, Engine],
) -> None:
    config, engine = migration
    with engine.begin() as connection:
        user_id = _user(connection, "tightened@x.ae")
        _override(connection, user_id, "books.category.HR")
        _override(connection, user_id, "books.category.5/1", expires_at=EXPIRY)
        _book(
            connection,
            category_id="HR",
            ref_number="STRAY-2",
            template_id="General Book",
            classification_code="5/1",
        )
    command.upgrade(config, MERGE)
    with engine.connect() as connection:
        assert _overrides(connection, user_id)["books.category.5/1"] == ("deny", None)
    command.upgrade(config, REVISION)
    with engine.connect() as connection:
        assert _overrides(connection, user_id)["books.category.5/1"] == ("deny", EXPIRY)
    command.downgrade(config, MERGE)
    with engine.connect() as connection:
        assert _overrides(connection, user_id)["books.category.5/1"] == ("deny", None)


@pytest.mark.parametrize(
    "change",
    [
        "DELETE FROM book_versions WHERE book_id = :book_id; DELETE FROM books WHERE id = :book_id",
        "UPDATE books SET classification_code = '6/1' WHERE id = :book_id",
        "UPDATE books SET category_id = 'GS' WHERE id = :book_id",
    ],
    ids=["deleted", "reclassified", "refiled"],
)
def test_the_extra_deny_goes_even_after_its_stray_record_changed(
    migration: tuple[Config, Engine], change: str
) -> None:
    config, engine = migration
    with engine.begin() as connection:
        user_id = _user(connection, "changed-stray@x.ae")
        _override(connection, user_id, "books.category.HR")
        stray_id = _book(
            connection,
            category_id="HR",
            ref_number="STRAY-6",
            template_id="General Book",
            classification_code="5/1",
        )
    command.upgrade(config, MERGE)
    with engine.begin() as connection:
        merged = _overrides(connection, user_id)
        assert merged["books.category.5/1"] == ("deny", None)
        for statement in change.split("; "):
            connection.execute(text(statement), {"book_id": stray_id})
    command.upgrade(config, REVISION)
    with engine.connect() as connection:
        assert _overrides(connection, user_id) == {
            k: v for k, v in merged.items() if k != "books.category.5/1"
        }
    command.downgrade(config, MERGE)
    with engine.connect() as connection:
        assert _overrides(connection, user_id) == merged


def test_a_copied_deny_loses_the_expiry_an_extra_deny_stretched(
    migration: tuple[Config, Engine],
) -> None:
    config, engine = migration
    with engine.begin() as connection:
        user_id = _user(connection, "stretched@x.ae")
        _override(connection, user_id, "books.category.GS", expires_at=EXPIRY)
        _override(connection, user_id, "books.category.INV")
        _book(connection, category_id="INV", ref_number="STRAY-5", template_id="General Book")
    command.upgrade(config, MERGE)
    with engine.connect() as connection:
        merged = _overrides(connection, user_id)
    assert merged["books.servicerecords.General Book"] == ("deny", None)
    command.upgrade(config, REVISION)
    with engine.connect() as connection:
        assert _overrides(connection, user_id) == {
            **merged,
            "books.servicerecords.General Book": ("deny", EXPIRY),
        }
    command.downgrade(config, MERGE)
    with engine.connect() as connection:
        assert _overrides(connection, user_id) == merged


@pytest.mark.parametrize(
    ("hr_expiry", "inv_deny", "admin_expiry"),
    [
        # The admin re-dates the deny 0117 made permanent.
        (None, False, "2028-01-02 03:04:05.000000"),
        # The admin makes permanent a deny 0117 wrote with the HR expiry; the
        # user's unrelated permanent INV deny never reached books.category.5/1.
        (EXPIRY, True, None),
    ],
)
def test_a_deny_an_admin_changed_after_0117_survives(
    migration: tuple[Config, Engine],
    hr_expiry: str | None,
    inv_deny: bool,
    admin_expiry: str | None,
) -> None:
    config, engine = migration
    with engine.begin() as connection:
        user_id = _user(connection, "admin-edited@x.ae")
        _override(connection, user_id, "books.category.HR", expires_at=hr_expiry)
        if inv_deny:
            _override(connection, user_id, "books.category.INV")
        _book(
            connection,
            category_id="HR",
            ref_number="STRAY-4",
            template_id="General Book",
            classification_code="5/1",
        )
    command.upgrade(config, MERGE)
    with engine.begin() as connection:
        assert _overrides(connection, user_id)["books.category.5/1"] == ("deny", hr_expiry)
        connection.execute(
            text(
                "UPDATE user_permissions SET expires_at = :expires_at "
                "WHERE user_id = :user_id AND capability = 'books.category.5/1'"
            ),
            {"user_id": user_id, "expires_at": admin_expiry},
        )
        edited = _overrides(connection, user_id)
    command.upgrade(config, REVISION)
    with engine.connect() as connection:
        assert _overrides(connection, user_id) == edited
    command.downgrade(config, MERGE)
    with engine.connect() as connection:
        assert _overrides(connection, user_id) == edited


def test_a_legacy_grant_keeps_its_copy_when_the_extra_deny_goes(
    migration: tuple[Config, Engine],
) -> None:
    config, engine = migration
    with engine.begin() as connection:
        user_id = _user(connection, "granted@x.ae")
        _override(connection, user_id, "books.category.GS", effect="grant", expires_at=EXPIRY)
        _override(connection, user_id, "books.category.HR")
        letter_id = _book(
            connection,
            category_id="GS",
            ref_number="1/5/0002",
            template_id="Security Permit",
            classification_code="5/1",
        )
        _book(connection, category_id="HR", ref_number="STRAY-3", template_id="General Book")
    command.upgrade(config, MERGE)
    with engine.connect() as connection:
        merged = _overrides(connection, user_id)
    assert merged["books.servicerecords.General Book"] == ("deny", None)
    command.upgrade(config, REVISION)
    with engine.connect() as connection:
        assert _overrides(connection, user_id) == {
            **merged,
            "books.servicerecords.General Book": ("grant", EXPIRY),
        }
    with Session(engine) as db:
        user = db.get(User, user_id)
        assert user is not None
        assert _visible(db, user, letter_id)
    command.downgrade(config, MERGE)
    with engine.connect() as connection:
        assert _overrides(connection, user_id) == merged
