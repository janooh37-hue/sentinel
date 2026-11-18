"""0120 backfills only unscoped attendance reviewers and reverses its own grants."""

from datetime import UTC, datetime, timedelta
from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import Connection, DateTime, bindparam, create_engine, text

ROOT = Path(__file__).resolve().parents[2]
REVISION = "0120_backfill_workforce_org_scope"
PARENT = "0119_employee_former_ids"
BACKFILL_AT = datetime(2026, 11, 18)
PEOPLE = "workforce.people.view"
REVIEW = "workforce.attendance.review"


def _config(database: Path) -> Config:
    config = Config(str(ROOT / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", f"sqlite:///{database.as_posix()}")
    return config


def _user(connection: Connection, name: str, role: str, *, status: str = "active") -> int:
    return connection.execute(
        text(
            "INSERT INTO users (email, password_hash, role, status) "
            "VALUES (:email, 'x', :role, :status) RETURNING id"
        ),
        {"email": f"{name}@test.ae", "role": role, "status": status},
    ).scalar_one()


def _override(
    connection: Connection,
    user_id: int,
    capability: str,
    effect: str = "grant",
    expires_at: datetime | None = None,
) -> None:
    connection.execute(
        text(
            "INSERT INTO user_permissions (user_id, capability, effect, expires_at) "
            "VALUES (:user_id, :capability, :effect, :expires_at)"
        ).bindparams(bindparam("expires_at", type_=DateTime())),
        dict(user_id=user_id, capability=capability, effect=effect, expires_at=expires_at),
    )


def _scope(
    connection: Connection,
    user_id: int,
    creator: int,
    *,
    kind: str = "organization",
    created_at: datetime = BACKFILL_AT,
) -> int:
    return connection.execute(
        text(
            "INSERT INTO user_workforce_scopes "
            "(user_id, scope_kind, department, created_by_user_id, created_at) "
            "VALUES (:user_id, :kind, :department, :creator, :created_at) RETURNING id"
        ).bindparams(bindparam("created_at", type_=DateTime())),
        dict(
            user_id=user_id,
            kind=kind,
            department="Operations" if kind == "department" else None,
            creator=creator,
            created_at=created_at,
        ),
    ).scalar_one()


def test_backfill_follows_employee_former_ids(tmp_path: Path) -> None:
    script = ScriptDirectory.from_config(_config(tmp_path / "graph.db"))
    assert script.get_revision(REVISION).down_revision == PARENT


def test_backfill_effective_caps_and_reversible_grant_markers(tmp_path: Path) -> None:
    config = _config(tmp_path / "backfill.db")
    command.upgrade(config, PARENT)
    engine = create_engine(config.get_main_option("sqlalchemy.url"))
    now = datetime.now(UTC).replace(tzinfo=None)
    try:
        with engine.begin() as connection:
            connection.execute(
                text("DELETE FROM role_permissions WHERE role IN ('operator', 'manager')")
            )
            connection.execute(
                text("INSERT INTO role_permissions (role, capability) VALUES (:role, :capability)"),
                [
                    {"role": "manager", "capability": PEOPLE},
                    {"role": "manager", "capability": REVIEW},
                    {"role": "operator", "capability": PEOPLE},
                    # Even corrupt role rows cannot lift the reporter's hard ceiling.
                    {"role": "inmate_reporter", "capability": PEOPLE},
                    {"role": "inmate_reporter", "capability": REVIEW},
                ],
            )
            roles = {
                "role_both": "manager",
                "only_one": "operator",
                "denied": "manager",
                "active": "operator",
                "permanent": "operator",
                "temporary_extra": "operator",
                "temporary_role": "manager",
                "locked": "manager",
                "pending": "manager",
                "disabled": "manager",
                "rejected": "manager",
                "expired_role": "manager",
                "expired_extra": "operator",
                "admin": "admin",
                "department": "manager",
                "existing_org": "manager",
                "self_created_org": "manager",
                "resaved": "manager",
                "reporter": "inmate_reporter",
            }
            statuses = {"locked", "pending", "disabled", "rejected"}
            users = {
                name: _user(connection, name, role, status=name if name in statuses else "active")
                for name, role in roles.items()
            }
            _override(connection, users["denied"], REVIEW, "deny")
            _override(connection, users["active"], REVIEW)
            _override(
                connection, users["temporary_extra"], REVIEW, expires_at=now + timedelta(days=1)
            )
            _override(
                connection, users["temporary_role"], REVIEW, expires_at=now + timedelta(days=1)
            )
            _override(connection, users["permanent"], REVIEW)
            _override(connection, users["expired_role"], REVIEW, expires_at=now - timedelta(days=1))
            _override(
                connection, users["expired_extra"], REVIEW, expires_at=now - timedelta(days=1)
            )
            _override(connection, users["reporter"], REVIEW)
            preserved_ids = {
                _scope(connection, users["department"], users["department"], kind="department"),
                _scope(connection, users["existing_org"], users["admin"]),
                _scope(
                    connection,
                    users["self_created_org"],
                    users["self_created_org"],
                    created_at=BACKFILL_AT - timedelta(days=1),
                ),
            }
            before = connection.execute(
                text("SELECT * FROM user_workforce_scopes ORDER BY id")
            ).all()

        command.upgrade(config, REVISION)
        with engine.begin() as connection:
            rows = connection.execute(
                text(
                    "SELECT id, user_id, scope_kind, created_by_user_id, created_at FROM user_workforce_scopes"
                )
            ).all()
            added = {row.user_id: row for row in rows if row.id not in preserved_ids}
            assert set(added) == {
                users[name] for name in ("role_both", "active", "permanent", "resaved", "locked")
            }
            for row in added.values():
                assert row.scope_kind == "organization"
                assert row.created_by_user_id == row.user_id
                assert datetime.fromisoformat(row.created_at) == BACKFILL_AT
            assert (
                connection.execute(
                    text("SELECT * FROM user_workforce_scopes WHERE id IN :ids").bindparams(
                        bindparam("ids", expanding=True)
                    ),
                    {"ids": sorted(preserved_ids)},
                ).all()
                == before
            )
            # PUT replaces the old rows; an administrator's later save must survive rollback.
            connection.execute(
                text("DELETE FROM user_workforce_scopes WHERE user_id = :user_id"),
                {"user_id": users["resaved"]},
            )
            replacement_id = _scope(
                connection,
                users["resaved"],
                users["admin"],
                created_at=BACKFILL_AT + timedelta(days=1),
            )

        command.downgrade(config, "-1")
        with engine.connect() as connection:
            assert set(
                connection.scalars(text("SELECT id FROM user_workforce_scopes"))
            ) == preserved_ids | {replacement_id}
            assert connection.scalar(text("SELECT version_num FROM alembic_version")) == PARENT
            assert connection.exec_driver_sql("PRAGMA foreign_key_check").all() == []

        command.upgrade(config, REVISION)
        with engine.connect() as connection:
            assert set(connection.scalars(text("SELECT user_id FROM user_workforce_scopes"))) == {
                users[name]
                for name in (
                    "role_both",
                    "active",
                    "permanent",
                    "resaved",
                    "department",
                    "existing_org",
                    "self_created_org",
                    "locked",
                )
            }
    finally:
        engine.dispose()
