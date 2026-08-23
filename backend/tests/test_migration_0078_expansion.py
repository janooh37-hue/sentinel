"""Migration 0078 must preserve effective access exactly.

Runs the full alembic chain to 0077 on a temp SQLite file, seeds old-style
rows, upgrades to 0078, and asserts the expansion:
  role_permissions: children in, parent out
  user_permissions: grant/deny (incl. expires_at) copied to every child
  permission_requests: pending rows re-pointed to the primary child
"""

from __future__ import annotations

from datetime import datetime

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, text

ALEMBIC_INI = "alembic.ini"


def _cfg(db_url: str) -> Config:
    cfg = Config(ALEMBIC_INI)
    cfg.set_main_option("sqlalchemy.url", db_url)
    return cfg


def test_0078_expands_bundled_rows(tmp_path):
    db_file = tmp_path / "mig.db"
    url = f"sqlite:///{db_file}"
    cfg = _cfg(url)

    command.upgrade(cfg, "0077")
    eng = create_engine(url)
    with eng.begin() as c:
        # role preset: manager held the old bundle
        c.execute(
            text(
                "INSERT OR IGNORE INTO role_permissions(role, capability) VALUES ('manager','books.manage')"
            )
        )
        c.execute(
            text(
                "INSERT OR IGNORE INTO role_permissions(role, capability) VALUES ('manager','ledger.edit')"
            )
        )
        # per-user overrides: grant w/ expiry + deny
        c.execute(
            text(
                "INSERT INTO user_permissions(user_id, capability, effect, expires_at) "
                "VALUES (1,'books.manage','grant',:exp)"
            ),
            {"exp": datetime(2030, 1, 1)},
        )
        c.execute(
            text(
                "INSERT INTO user_permissions(user_id, capability, effect, expires_at) "
                "VALUES (2,'permits.manage','deny',NULL)"
            )
        )
        # a pending request for an old id
        c.execute(
            text(
                "INSERT INTO permission_requests(user_id, capability, status, created_at) "
                "VALUES (3,'books.manage','pending',:now)"
            ),
            {"now": datetime.now()},
        )
    eng.dispose()

    command.upgrade(cfg, "0078")

    eng = create_engine(url)
    with eng.begin() as c:
        role_caps = {
            r
            for (r,) in c.execute(
                text("SELECT capability FROM role_permissions WHERE role='manager'")
            )
        }
        grants = dict(
            c.execute(
                text("SELECT capability, expires_at FROM user_permissions WHERE user_id=1")
            ).all()
        )
        denies = {
            r for (r,) in c.execute(text("SELECT capability FROM user_permissions WHERE user_id=2"))
        }
        req = c.execute(
            text("SELECT capability FROM permission_requests WHERE user_id=3")
        ).scalar_one()

    # role preset: children in, parent out
    assert "books.manage" not in role_caps
    assert {
        "books.create",
        "books.edit",
        "books.submit",
        "books.templates",
        "books.delete",
    } <= role_caps
    assert (
        "ledger.edit" in role_caps and "ledger.create" in role_caps and "ledger.delete" in role_caps
    )

    # user grant expanded to all children, expiry preserved on each
    assert set(grants) == {
        "books.create",
        "books.edit",
        "books.submit",
        "books.templates",
        "books.delete",
    }
    # raw text() selects hand expires_at back as a SQLite string, so accept
    # both representations of the seeded value — every child must still match.
    expected_expiry = datetime(2030, 1, 1)
    assert all(v in (expected_expiry, str(expected_expiry)) for v in grants.values())

    # deny expanded
    assert denies == {"permits.create", "permits.edit", "permits.revoke", "permits.delete"}

    # pending request re-pointed to primary child
    assert req == "books.edit"
    eng.dispose()
