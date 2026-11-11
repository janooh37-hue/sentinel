"""Migration 0119: record grade + distribution replace confidentiality; urgency."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import Engine, create_engine, inspect, text
from sqlalchemy.exc import IntegrityError

ROOT = Path(__file__).resolve().parents[2]
HEAD = "0120_record_grade"
PARENT = "0119_employee_former_ids"

LEGACY = {
    1: ("general", "Normal", "unclassified", "organization"),
    2: ("directed", "High", "unclassified", "named"),
    3: ("personal", "Normal", "unclassified", "named"),
    4: ("secret", "High", "secret", "organization"),
}


def _config(database: Path) -> Config:
    config = Config(str(ROOT / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", f"sqlite:///{database}")
    return config


def _at_parent(tmp_path: Path) -> tuple[Engine, Config]:
    database = tmp_path / "grade.db"
    config = _config(database)
    command.upgrade(config, PARENT)
    engine = create_engine(f"sqlite:///{database}")
    with engine.begin() as c:
        c.execute(text("INSERT OR IGNORE INTO book_categories (id, prefix) VALUES ('HR', 'HR')"))
        for book_id, (level, priority, _grade, _distribution) in LEGACY.items():
            c.execute(
                text(
                    "INSERT INTO books (id, category_id, ref_number, search_text, created_at, "
                    "confidentiality, priority) VALUES (:id, 'HR', :ref, :text, "
                    "'2026-10-01 00:00:00', :level, :priority)"
                ),
                {
                    "id": book_id,
                    "ref": f"HR-{book_id:04d}",
                    "text": f"zebra{book_id}",
                    "level": level,
                    "priority": priority,
                },
            )
            c.execute(
                text(
                    "INSERT INTO book_versions (id, book_id, version_no, trigger, status, "
                    "approval_context, created_at) VALUES (:id, :id, 1, 'initial', 'none', "
                    ":context, '2026-10-01 00:00:00')"
                ),
                {"id": book_id, "context": json.dumps({"priority": priority, "note": "keep"})},
            )
        # A sent record later set back to Personal kept its active recipient.
        c.execute(
            text(
                "INSERT INTO book_recipients (book_id, user_id, sent_by_user_id, purpose, "
                "created_at) VALUES (3, 9, 3, 'info', '2026-10-01 00:00:00')"
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


def _contexts(engine: Engine) -> dict[int, dict[str, object]]:
    with engine.connect() as c:
        return {
            row[0]: json.loads(row[1])
            for row in c.execute(text("SELECT id, approval_context FROM book_versions"))
        }


def test_single_head_follows_parent() -> None:
    script = ScriptDirectory.from_config(Config(str(ROOT / "alembic.ini")))
    heads = script.get_heads()
    assert len(heads) == 1
    assert HEAD in {revision.revision for revision in script.walk_revisions("base", heads[0])}
    assert script.get_revision(HEAD).down_revision == PARENT


def test_upgrade_backfills_grade_distribution_and_urgency(tmp_path: Path) -> None:
    engine, config = _at_parent(tmp_path)

    command.upgrade(config, HEAD)

    with engine.connect() as c:
        columns = {col["name"] for col in inspect(c).get_columns("books")}
        rows = {
            row[0]: (row[1], row[2], row[3])
            for row in c.execute(text("SELECT id, grade, distribution, urgency FROM books"))
        }
    assert {"confidentiality", "priority"}.isdisjoint(columns)
    assert rows == {
        book_id: (grade, distribution, priority)
        for book_id, (_level, priority, grade, distribution) in LEGACY.items()
    }
    with engine.connect() as c:
        legacy = c.execute(
            text("SELECT entity_id, payload FROM audit_log WHERE action = 'book_legacy_personal'")
        ).all()
    assert [(row[0], json.loads(row[1])) for row in legacy] == [
        ("3", {"ref_number": "HR-0003", "revoked_recipient_user_ids": [9]})
    ]
    with engine.connect() as c:
        # Personal opened for its creator only; named must not reopen it.
        assert c.execute(
            text("SELECT revoked_at IS NOT NULL FROM book_recipients WHERE book_id = 3")
        ).scalar_one()
    assert _contexts(engine) == {
        book_id: {"urgency": priority, "note": "keep"}
        for book_id, (_level, priority, _grade, _distribution) in LEGACY.items()
    }
    for column, value in (
        ("grade", "personal"),
        ("distribution", "directed"),
        ("urgency", "Low"),
    ):
        with pytest.raises(IntegrityError), engine.begin() as c:
            c.execute(text(f"UPDATE books SET {column} = :v WHERE id = 1"), {"v": value})
    with engine.begin() as c:
        c.execute(text("UPDATE books SET urgency = 'Very High', grade = 'top_secret' WHERE id = 1"))
        c.execute(text("UPDATE books SET search_text = 'giraffe' WHERE id = 1"))
    assert _triggers(engine) == {"books_ai", "books_ad", "books_au"}
    assert _fts_hits(engine, "giraffe") == [1]
    engine.dispose()


def test_downgrade_restores_levels_and_priority(tmp_path: Path) -> None:
    engine, config = _at_parent(tmp_path)
    with engine.begin() as c:
        c.execute(text("DELETE FROM book_recipients WHERE book_id = 3"))
    command.upgrade(config, HEAD)
    with engine.begin() as c:
        c.execute(
            text(
                "INSERT INTO book_recipients (book_id, user_id, sent_by_user_id, purpose, "
                "created_at) VALUES (2, 7, 3, 'info', '2026-10-01 00:00:00')"
            )
        )
        c.execute(text("UPDATE books SET urgency = 'Very High' WHERE id = 1"))

    command.downgrade(config, PARENT)

    with engine.connect() as c:
        columns = {col["name"] for col in inspect(c).get_columns("books")}
        rows = {
            row[0]: (row[1], row[2])
            for row in c.execute(text("SELECT id, confidentiality, priority FROM books"))
        }
    assert {"grade", "distribution", "urgency"}.isdisjoint(columns)
    assert rows == {
        1: ("general", "High"),
        2: ("directed", "High"),
        3: ("personal", "Normal"),
        4: ("secret", "High"),
    }
    assert _contexts(engine)[2] == {"priority": "High", "note": "keep"}
    with engine.connect() as c:
        assert not c.execute(
            text("SELECT 1 FROM audit_log WHERE action = 'book_legacy_personal'")
        ).all()
    assert _triggers(engine) == {"books_ai", "books_ad", "books_au"}
    assert _fts_hits(engine, "zebra3") == [3]

    command.upgrade(config, HEAD)
    with engine.connect() as c:
        assert c.execute(text("SELECT grade FROM books WHERE id = 4")).scalar_one() == "secret"
    engine.dispose()


@pytest.mark.parametrize(
    "grade,distribution",
    [
        ("top_secret", "organization"),
        ("top_secret", "named"),
        ("addressee_only", "named"),
        ("secret", "named"),
    ],
)
def test_downgrade_refuses_visibility_broadening_before_mutation(
    tmp_path: Path, grade: str, distribution: str
) -> None:
    engine, config = _at_parent(tmp_path)
    command.upgrade(config, HEAD)
    with engine.begin() as c:
        c.execute(
            text("UPDATE books SET grade = :grade, distribution = :distribution WHERE id = 1"),
            {"grade": grade, "distribution": distribution},
        )
    with pytest.raises(RuntimeError, match="visibility"):
        command.downgrade(config, PARENT)
    with engine.connect() as c:
        assert "confidentiality" not in {col["name"] for col in inspect(c).get_columns("books")}
        assert c.execute(text("SELECT version_num FROM alembic_version")).scalar_one() == HEAD
    engine.dispose()


@pytest.mark.parametrize("later_change", [False, True])
def test_downgrade_preserves_personal_revocation_journal(
    tmp_path: Path, later_change: bool
) -> None:
    engine, config = _at_parent(tmp_path)
    command.upgrade(config, HEAD)
    with engine.begin() as c:
        if later_change:
            c.execute(
                text("UPDATE book_recipients SET revoked_at = '2030-01-01' WHERE book_id = 3")
            )
        before = c.execute(
            text("SELECT revoked_at FROM book_recipients WHERE book_id = 3")
        ).scalar_one()
    with pytest.raises(RuntimeError, match="Personal recipient"):
        command.downgrade(config, PARENT)
    with engine.connect() as c:
        assert (
            c.execute(text("SELECT revoked_at FROM book_recipients WHERE book_id = 3")).scalar_one()
            == before
        )
        assert c.execute(
            text("SELECT payload FROM audit_log WHERE action = 'book_legacy_personal'")
        ).scalar_one()
        assert "confidentiality" not in {col["name"] for col in inspect(c).get_columns("books")}
    engine.dispose()


def test_downgrade_refuses_malformed_personal_journal(tmp_path: Path) -> None:
    engine, config = _at_parent(tmp_path)
    command.upgrade(config, HEAD)
    for payload in (
        '{"revoked_recipient_user_ids": 9}',
        '{"revoked_recipient_user_ids": {}}',
        "{}",
        "invalid json",
    ):
        with engine.begin() as c:
            c.execute(
                text(
                    "UPDATE audit_log SET payload = :payload WHERE action = 'book_legacy_personal'"
                ),
                {"payload": payload},
            )
        with pytest.raises(RuntimeError, match="Personal recipient"):
            command.downgrade(config, PARENT)
        with engine.connect() as c:
            assert (
                c.execute(
                    text("SELECT payload FROM audit_log WHERE action = 'book_legacy_personal'")
                ).scalar_one()
                == payload
            )
            assert "confidentiality" not in {col["name"] for col in inspect(c).get_columns("books")}
    engine.dispose()
