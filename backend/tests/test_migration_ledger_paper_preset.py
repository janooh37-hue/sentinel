"""0115 paper preset, bottom-block selections and the Revision layout pin."""

import pytest
from alembic import command
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import IntegrityError

from tests.test_migration_ledger_book_importance import _config, assert_seed_and_fts_survive

HEAD = "0115_ledger_paper_preset"
PARENT = "0114_ledger_addressees_signer"


def _columns(engine, table):
    return {c["name"] for c in inspect(engine).get_columns(table)}


def test_single_head_backfill_check_and_round_trip(tmp_path):
    config = _config(tmp_path / "preset.db")
    script = ScriptDirectory.from_config(config)
    heads = script.get_heads()
    assert len(heads) == 1
    assert HEAD in {revision.revision for revision in script.walk_revisions("base", heads[0])}
    assert script.get_revision(HEAD).down_revision == PARENT
    command.upgrade(config, PARENT)
    engine = create_engine(f"sqlite:///{tmp_path / 'preset.db'}")
    with engine.begin() as c:
        c.execute(text("INSERT OR IGNORE INTO book_categories (id,prefix) VALUES ('HR','HR')"))
        c.execute(
            text(
                "INSERT INTO books (id,category_id,ref_number,search_text,urgency,created_at) "
                "VALUES (1,'HR','HR-0001','zebraledger','Very High','2026-10-01')"
            )
        )
        c.execute(
            text(
                "INSERT INTO book_versions (id,book_id,version_no,template_id,trigger,status) "
                "VALUES (10,1,1,'Ledger Book','initial','none'), (11,1,2,'GS-300','initial','none')"
            )
        )
        for draft_id in (1, 2, 3):
            c.execute(
                text(
                    "INSERT INTO book_drafts (id,owner_user_id,created_at,updated_at) "
                    "VALUES (:id,7,'2026-10-01','2026-10-01')"
                ),
                {"id": draft_id},
            )
        # Draft 3 was deleted: its number must never be handed out again.
        c.execute(text("DELETE FROM book_drafts WHERE id=3"))
    command.upgrade(config, HEAD)
    with engine.begin() as c:
        assert c.execute(
            text("SELECT paper_preset,reference_book_ids,folder_ids FROM book_drafts WHERE id=1")
        ).one() == ("normal", "[]", "[]")
        assert c.execute(
            text("SELECT id,paper_preset,paper_layout FROM book_versions ORDER BY id")
        ).all() == [(10, "normal", 1), (11, None, None)]
        c.execute(
            text(
                "INSERT INTO book_drafts (owner_user_id,paper_preset,created_at,updated_at) "
                "VALUES (7,'report','2026-10-01','2026-10-01')"
            )
        )
        assert c.execute(text("SELECT max(id) FROM book_drafts")).scalar_one() == 4
    with pytest.raises(IntegrityError), engine.begin() as c:
        c.execute(
            text(
                "INSERT INTO book_drafts (owner_user_id,paper_preset,created_at,updated_at) "
                "VALUES (7,'poster','2026-10-01','2026-10-01')"
            )
        )
    assert_seed_and_fts_survive(engine)
    command.downgrade(config, PARENT)
    assert {"paper_preset", "reference_book_ids", "folder_ids"}.isdisjoint(
        _columns(engine, "book_drafts")
    )
    assert {"paper_preset", "paper_layout"}.isdisjoint(_columns(engine, "book_versions"))
    with engine.begin() as c:
        c.execute(
            text(
                "INSERT INTO book_drafts (owner_user_id,created_at,updated_at) "
                "VALUES (7,'2026-10-01','2026-10-01')"
            )
        )
        assert c.execute(text("SELECT max(id) FROM book_drafts")).scalar_one() == 5
    assert_seed_and_fts_survive(engine)
    command.upgrade(config, HEAD)
    assert "paper_layout" in _columns(engine, "book_versions")
    engine.dispose()
