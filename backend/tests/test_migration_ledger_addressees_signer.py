"""0114 addressee snapshots and draft signer round trip on SQLite."""

from alembic import command
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect, text

from tests.test_migration_ledger_book_importance import _config, assert_seed_and_fts_survive

HEAD = "0123_ledger_addressees_signer"
PARENT = "0122_book_folder_box"


def test_single_head_and_upgrade_downgrade(tmp_path):
    config = _config(tmp_path / "recipients.db")
    script = ScriptDirectory.from_config(config)
    heads = script.get_heads()
    assert len(heads) == 1
    assert HEAD in {revision.revision for revision in script.walk_revisions("base", heads[0])}
    assert script.get_revision(HEAD).down_revision == PARENT
    command.upgrade(config, PARENT)
    engine = create_engine(f"sqlite:///{tmp_path / 'recipients.db'}")
    with engine.begin() as c:
        c.execute(text("INSERT OR IGNORE INTO book_categories (id,prefix) VALUES ('HR','HR')"))
        c.execute(
            text(
                "INSERT INTO books (id,category_id,ref_number,search_text,urgency,created_at) VALUES (1,'HR','HR-0001','zebraledger','Very High','2026-10-01')"
            )
        )
        c.execute(
            text(
                "INSERT INTO book_drafts (owner_user_id,created_at,updated_at) VALUES (7,'2026-10-01','2026-10-01')"
            )
        )
    command.upgrade(config, HEAD)
    with engine.begin() as c:
        assert c.execute(text("SELECT external FROM books")).scalar_one() == 0
        assert c.execute(
            text("SELECT external,signer_manager_id,addressees FROM book_drafts")
        ).one() == (0, None, "[]")
        c.execute(
            text(
                "INSERT INTO book_addressees (book_id,role,position,name_en) VALUES (1,'to',0,'Snapshot')"
            )
        )
    assert_seed_and_fts_survive(engine)
    command.downgrade(config, PARENT)
    assert "book_addressees" not in inspect(engine).get_table_names()
    assert "external" not in {c["name"] for c in inspect(engine).get_columns("books")}
    assert "addressees" not in {c["name"] for c in inspect(engine).get_columns("book_drafts")}
    assert_seed_and_fts_survive(engine)
    command.upgrade(config, HEAD)
    assert "book_addressees" in inspect(engine).get_table_names()
    engine.dispose()
