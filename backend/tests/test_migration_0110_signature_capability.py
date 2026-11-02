"""Migration 0110 must keep everyone's signature access exactly as it was.

Before 0110, writing an employee's profile signature needed ``employees.edit``.
After it, the write needs ``employees.signature.manage``, so every per-user
``employees.edit`` override must reach the new capability unchanged. Role rows
belong to the startup reconcile and must not move.
"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, text

ALEMBIC_INI = str(Path(__file__).parents[2] / "alembic.ini")
SIGNATURE = "employees.signature.manage"


def _cfg(db_url: str) -> Config:
    cfg = Config(ALEMBIC_INI)
    cfg.set_main_option("sqlalchemy.url", db_url)
    return cfg


def _rows(url: str, sql: str) -> set[tuple[object, ...]]:
    eng = create_engine(url)
    with eng.begin() as c:
        rows = {tuple(r) for r in c.execute(text(sql))}
    eng.dispose()
    return rows


def test_0110_mirrors_employee_edit_overrides_and_reverses(tmp_path):
    url = f"sqlite:///{tmp_path / 'mig.db'}"
    cfg = _cfg(url)
    command.upgrade(cfg, "0109_book_folder_shares")

    expiry = datetime(2031, 6, 15)
    eng = create_engine(url)
    with eng.begin() as c:
        # Simulates a reconcile that already ran new code: operators hold
        # employees.edit by role. They must NOT gain signature rights from it.
        c.execute(
            text(
                "INSERT OR IGNORE INTO role_permissions(role, capability) "
                "VALUES ('operator','employees.edit'), ('manager','employees.edit')"
            )
        )
        c.execute(
            text(
                "INSERT INTO user_permissions(user_id, capability, effect, expires_at) VALUES "
                "(1,'employees.edit','grant',:exp), "
                "(2,'employees.edit','deny',NULL), "
                "(3,'employees.vault.manage','grant',NULL)"
            ),
            {"exp": expiry},
        )
    eng.dispose()

    command.upgrade(cfg, "0110_employee_signature_capability")

    mirrored = _rows(
        url,
        f"SELECT user_id, effect, expires_at FROM user_permissions WHERE capability='{SIGNATURE}'",
    )
    assert {(uid, effect) for uid, effect, _ in mirrored} == {(1, "grant"), (2, "deny")}
    expiries = {uid: exp for uid, _, exp in mirrored}
    assert expiries[1] in (expiry, str(expiry))
    assert expiries[2] is None
    # The originals stay; an unrelated override does not spread.
    assert _rows(url, "SELECT user_id FROM user_permissions WHERE capability='employees.edit'") == {
        (1,),
        (2,),
    }
    assert _rows(url, f"SELECT role FROM role_permissions WHERE capability='{SIGNATURE}'") == set()

    # Startup reconcile then adds the manager preset row; downgrade removes both kinds.
    eng = create_engine(url)
    with eng.begin() as c:
        c.execute(
            text("INSERT INTO role_permissions(role, capability) VALUES ('manager', :cap)"),
            {"cap": SIGNATURE},
        )
    eng.dispose()

    command.downgrade(cfg, "0109_book_folder_shares")

    assert _rows(url, f"SELECT 1 FROM user_permissions WHERE capability='{SIGNATURE}'") == set()
    assert _rows(url, f"SELECT 1 FROM role_permissions WHERE capability='{SIGNATURE}'") == set()
    assert _rows(url, "SELECT user_id FROM user_permissions WHERE capability='employees.edit'") == {
        (1,),
        (2,),
    }
