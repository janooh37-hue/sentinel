"""Printed addressee migration preserves legacy papers, tokens and draft IDs."""

from alembic import command
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect, text

from tests.test_migration_ledger_book_importance import _config, assert_seed_and_fts_survive

HEAD = "0126_ledger_addressed_to"
PARENT = "0125_ledger_paper_preset"


def test_printed_addressee_round_trip_preserves_legacy_rows(tmp_path):
    config = _config(tmp_path / "addressed-to.db")
    assert ScriptDirectory.from_config(config).get_heads() == [HEAD]
    command.upgrade(config, PARENT)
    engine = create_engine(f"sqlite:///{tmp_path / 'addressed-to.db'}")
    with engine.begin() as c:
        c.execute(text("INSERT OR IGNORE INTO book_categories(id,prefix) VALUES ('HR','HR')"))
        c.execute(
            text(
                "INSERT INTO books(id,category_id,ref_number,search_text,urgency,created_at) VALUES(1,'HR','HR-0001','zebraledger','Very High','2026-10-01')"
            )
        )
        c.execute(
            text(
                "INSERT INTO book_versions(id,book_id,version_no,template_id,fields,status,created_at) VALUES(1,1,1,'Ledger Book','{}','none','2026-10-01')"
            )
        )
        c.execute(
            text(
                "INSERT INTO ledger_book_saves(version_id,saved_by_user_id,subjects,body_html,content_sha256) VALUES(1,7,'[\"Legacy\"]','<p>Body</p>',:hash)"
            ),
            {"hash": "a" * 64},
        )
        c.execute(
            text(
                "INSERT INTO book_drafts(id,owner_user_id,created_at,updated_at) VALUES(50,7,'2026-10-01','2026-10-01')"
            )
        )
        c.execute(text("DELETE FROM book_drafts WHERE id=50"))
        c.execute(
            text(
                "INSERT INTO book_drafts(owner_user_id,created_at,updated_at) VALUES(7,'2026-10-01','2026-10-01')"
            )
        )
    command.upgrade(config, HEAD)
    with engine.begin() as c:
        assert c.execute(text("SELECT addressed_to FROM book_drafts")).scalar_one() == ""
        assert c.execute(
            text("SELECT addressed_to,content_sha256 FROM ledger_book_saves")
        ).one() == (None, "a" * 64)
        c.execute(text("UPDATE book_drafts SET addressed_to='Office'"))
    assert_seed_and_fts_survive(engine)
    command.downgrade(config, PARENT)
    assert "addressed_to" not in {col["name"] for col in inspect(engine).get_columns("book_drafts")}
    with engine.begin() as c:
        c.execute(
            text(
                "INSERT INTO book_drafts(owner_user_id,created_at,updated_at) VALUES(7,'2026-10-01','2026-10-01')"
            )
        )
        assert c.execute(text("SELECT max(id) FROM book_drafts")).scalar_one() == 52
    assert_seed_and_fts_survive(engine)
    command.upgrade(config, HEAD)
    engine.dispose()
