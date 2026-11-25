"""0124 copies Passport Release List denies onto the new ID release lists, reversibly."""

from datetime import datetime
from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import Connection, DateTime, bindparam, create_engine, text

ROOT = Path(__file__).resolve().parents[2]
REVISION = "0124_id_release_denies"
PARENT = "0123_backfill_workforce_org_scope"
EXPIRY = datetime(2027, 3, 4, 5, 6, 7)
EXPIRED = datetime(2025, 1, 2, 3, 4, 5)

SERVICE = "books.service."
RECORDS = "books.servicerecords."
PASSPORT = "Passport Release List"
WORK_ID = "Work ID Release List"
UAE_ID = "UAE ID Release List"

Row = tuple[str, str, datetime | None]


def _config(database: Path) -> Config:
    config = Config(str(ROOT / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", f"sqlite:///{database.as_posix()}")
    return config


def _user(connection: Connection, name: str) -> int:
    return connection.execute(
        text(
            "INSERT INTO users (email, password_hash, role, status) "
            "VALUES (:email, 'x', 'operator', 'active') RETURNING id"
        ),
        {"email": f"{name}@test.ae"},
    ).scalar_one()


def _override(
    connection: Connection,
    user_id: int,
    capability: str,
    effect: str,
    expires_at: datetime | None = None,
) -> None:
    connection.execute(
        text(
            "INSERT INTO user_permissions (user_id, capability, effect, expires_at) "
            "VALUES (:user_id, :capability, :effect, :expires_at)"
        ).bindparams(bindparam("expires_at", type_=DateTime())),
        dict(user_id=user_id, capability=capability, effect=effect, expires_at=expires_at),
    )


def _rows(connection: Connection, user_id: int) -> set[Row]:
    result = connection.execute(
        text(
            "SELECT capability, effect, expires_at FROM user_permissions WHERE user_id = :user_id"
        ).columns(expires_at=DateTime()),
        {"user_id": user_id},
    )
    return {(row.capability, row.effect, row.expires_at) for row in result}


def test_revision_follows_workforce_org_scope_backfill(tmp_path: Path) -> None:
    script = ScriptDirectory.from_config(_config(tmp_path / "graph.db"))
    assert script.get_revision(REVISION).down_revision == PARENT


def test_passport_denies_are_copied_to_both_new_services_and_reversed(tmp_path: Path) -> None:
    database = tmp_path / "denies.db"
    config = _config(database)
    command.upgrade(config, PARENT)
    engine = create_engine(f"sqlite:///{database.as_posix()}")
    try:
        with engine.begin() as connection:
            denied = _user(connection, "denied")
            _override(connection, denied, SERVICE + PASSPORT, "deny")
            _override(connection, denied, RECORDS + PASSPORT, "deny", EXPIRY)

            granted = _user(connection, "granted")
            _override(connection, granted, SERVICE + PASSPORT, "grant")
            _override(connection, granted, RECORDS + PASSPORT, "grant")

            # Temporary grants suspend a deny (active or expired-but-unswept):
            # the new services get the standing deny, not the time-boxed exception.
            suspended = _user(connection, "suspended")
            _override(connection, suspended, SERVICE + PASSPORT, "grant", EXPIRY)
            _override(connection, suspended, RECORDS + PASSPORT, "grant", EXPIRED)

            unrelated = _user(connection, "unrelated")
            _override(connection, unrelated, SERVICE + "Passport Release Form", "deny")
            _override(connection, unrelated, "documents.generate", "deny")

            # Already has rows for some targets: they are neither duplicated nor
            # overwritten, and downgrade keeps them because they differ from the
            # Passport source (a grant; a deny with another expiry).
            preset = _user(connection, "preset")
            _override(connection, preset, SERVICE + PASSPORT, "deny")
            _override(connection, preset, RECORDS + PASSPORT, "deny")
            _override(connection, preset, SERVICE + WORK_ID, "grant")
            _override(connection, preset, RECORDS + UAE_ID, "deny", EXPIRY)

            users = (denied, granted, suspended, unrelated, preset)
            before = {user: _rows(connection, user) for user in users}

        command.upgrade(config, REVISION)

        with engine.connect() as connection:
            assert _rows(connection, denied) == before[denied] | {
                (SERVICE + WORK_ID, "deny", None),
                (SERVICE + UAE_ID, "deny", None),
                (RECORDS + WORK_ID, "deny", EXPIRY),
                (RECORDS + UAE_ID, "deny", EXPIRY),
            }
            assert _rows(connection, granted) == before[granted]
            assert _rows(connection, suspended) == before[suspended] | {
                (family + target, "deny", None)
                for family in (SERVICE, RECORDS)
                for target in (WORK_ID, UAE_ID)
            }
            assert _rows(connection, unrelated) == before[unrelated]
            assert _rows(connection, preset) == before[preset] | {
                (SERVICE + UAE_ID, "deny", None),
                (RECORDS + WORK_ID, "deny", None),
            }

        command.downgrade(config, PARENT)

        with engine.connect() as connection:
            for user, rows in before.items():
                assert _rows(connection, user) == rows

        command.upgrade(config, REVISION)

        with engine.connect() as connection:
            assert len(_rows(connection, denied)) == 6
            assert len(_rows(connection, suspended)) == 6
    finally:
        engine.dispose()
