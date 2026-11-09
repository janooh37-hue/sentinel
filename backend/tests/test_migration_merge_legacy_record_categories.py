from __future__ import annotations

import shutil
from collections.abc import Iterator
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import Connection, Engine, create_engine, inspect, text

ROOT = Path(__file__).resolve().parents[2]
PREVIOUS = "0116_outbound_skip_reason"
REVISION = "0117_merge_legacy_record_categories"
BACKUP = "_record_category_merge_backup"
EXPIRY = "2027-03-04 05:06:07.123456"
HR_SERVICES = (
    "Salary Transfer Request",
    "Salary Deduction Form",
    "Employee Clearance Form",
    "Leave Application Form",
    "Passport Release Form",
    "Duty Resumption Form",
    "HR Request Form",
    "Resignation Letter",
    "Leave Permit Form",
    "Administrative Leave Form",
    "Passport Release List",
    "Manpower Requisition Form",
    "Employment Application Form",
    "Interview Assessment Form",
    "Employment Offer Letter",
    "Employee Performance Appraisal Form",
    "Employee Job Description",
    "Interview Scores Form",
    "Staff Attendance Form",
    "Leave Encashment Form",
    "Loan Request Form",
    "Employee Information Form",
    "Employee Exit Form",
    "Employee Exit Form – Project or Contract",  # noqa: RUF001
    "Salary Advance Request Form",
    "Breach of Discipline Form",
    "Promotion and Salary Increment Request Form",
    "Allowance Request Form",
    "Employee Overtime Form",
    "Expense Claim Form",
)
OPT_IN_HR_SERVICES = frozenset(HR_SERVICES[11:])


def _config(database: Path) -> Config:
    config = Config(str(ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(ROOT / "backend" / "app" / "db" / "migrations"))
    config.set_main_option("sqlalchemy.url", f"sqlite:///{database.as_posix()}")
    return config


@pytest.fixture(scope="module")
def previous_database(tmp_path_factory: pytest.TempPathFactory) -> Path:
    database = tmp_path_factory.mktemp("record-category-baseline") / "baseline.db"
    command.upgrade(_config(database), PREVIOUS)
    return database


@pytest.fixture
def migration(previous_database: Path, tmp_path: Path) -> Iterator[tuple[Config, Engine]]:
    database = tmp_path / "record-categories.db"
    shutil.copyfile(previous_database, database)
    config = _config(database)
    engine = create_engine(config.get_main_option("sqlalchemy.url"))
    try:
        yield config, engine
    finally:
        engine.dispose()


def _user(connection: Connection) -> int:
    return connection.execute(
        text(
            "INSERT INTO users (email, password_hash, role, status) "
            "VALUES ('category-migration@x.ae', 'x', 'operator', 'active') RETURNING id"
        )
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
        {
            "user_id": user_id,
            "capability": capability,
            "effect": effect,
            "expires_at": expires_at,
        },
    )


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


def _snapshot(connection: Connection, *tables: str) -> dict[str, list[tuple]]:
    return {
        table: [
            tuple(row) for row in connection.execute(text(f"SELECT * FROM {table} ORDER BY 1, 2"))
        ]
        for table in tables
    }


@pytest.mark.parametrize(
    ("category", "services"),
    [
        ("HR", HR_SERVICES),
        ("GS", ("Acknowledgment Form", "General Book", "Report", "Vehicle Mileage Log")),
        ("NAT", ("Violation Form", "Warning Form")),
        ("SC", ("Material Request Form", "Material Request Form (Arabic)")),
        ("INV", ("Inmate Conduct Violations",)),
        ("VF", ("Vehicle Fines",)),
        ("VA", ("Vehicle Accident Report",)),
    ],
)
def test_live_category_deny_copies_every_filing_service_and_other(
    migration: tuple[Config, Engine], category: str, services: tuple[str, ...]
) -> None:
    config, engine = migration
    with engine.begin() as connection:
        user_id = _user(connection)
        _override(connection, user_id, f"books.category.{category}", expires_at=EXPIRY)
    command.upgrade(config, REVISION)
    with engine.connect() as connection:
        assert _overrides(connection, user_id) == {
            f"books.servicerecords.{service}": ("deny", EXPIRY) for service in (*services, "other")
        }


@pytest.mark.parametrize(
    ("category", "target"),
    [("1", "12/1"), ("2", "10/1"), ("12", "15/1"), ("IMPORTED", "15/1")],
)
def test_old_only_category_deny_maps_to_record_category(
    migration: tuple[Config, Engine], category: str, target: str
) -> None:
    config, engine = migration
    with engine.begin() as connection:
        user_id = _user(connection)
        _override(connection, user_id, f"books.category.{category}")
    command.upgrade(config, REVISION)
    with engine.connect() as connection:
        assert _overrides(connection, user_id) == {f"books.category.{target}": ("deny", None)}


@pytest.mark.parametrize("legacy", ["HR", "1"])
@pytest.mark.parametrize(
    ("source_effect", "target_effect", "expected_effect", "expected_expiry"),
    [
        ("deny", "grant", "deny", None),
        ("grant", "deny", "deny", EXPIRY),
        ("grant", "grant", "grant", EXPIRY),
        ("deny", "deny", "deny", EXPIRY),
    ],
)
def test_collision_obeys_deny_wins_and_existing_target_expiry(
    migration: tuple[Config, Engine],
    legacy: str,
    source_effect: str,
    target_effect: str,
    expected_effect: str,
    expected_expiry: str | None,
) -> None:
    config, engine = migration
    target = "books.servicerecords.HR Request Form" if legacy == "HR" else "books.category.12/1"
    with engine.begin() as connection:
        user_id = _user(connection)
        _override(connection, user_id, f"books.category.{legacy}", source_effect, "2028-01-01")
        _override(connection, user_id, target, target_effect, EXPIRY)
    command.upgrade(config, REVISION)
    with engine.connect() as connection:
        assert _overrides(connection, user_id)[target] == (expected_effect, expected_expiry)


@pytest.mark.parametrize("legacy", ["HR", "1"])
@pytest.mark.parametrize("expires_at", [None, EXPIRY, "2020-01-01 00:00:00.000001"])
def test_grant_keeps_exact_expiry_without_opening_opt_in_services(
    migration: tuple[Config, Engine], legacy: str, expires_at: str | None
) -> None:
    config, engine = migration
    with engine.begin() as connection:
        user_id = _user(connection)
        _override(connection, user_id, f"books.category.{legacy}", "grant", expires_at)
    command.upgrade(config, REVISION)
    targets = (
        tuple(
            f"books.servicerecords.{service}"
            for service in (*HR_SERVICES, "other")
            if service not in OPT_IN_HR_SERVICES
        )
        if legacy == "HR"
        else ("books.category.12/1",)
    )
    with engine.connect() as connection:
        assert _overrides(connection, user_id) == {
            target: ("grant", expires_at) for target in targets
        }


@pytest.mark.parametrize(
    "target",
    [
        "books.servicerecords.HR Request Form",
        "books.servicerecords.Loan Request Form",
        "books.category.12/1",
    ],
)
@pytest.mark.parametrize(
    ("source_expiry", "target_expiry", "expected_expiry"),
    [
        (EXPIRY, None, EXPIRY),
        (EXPIRY, "2028-01-01", EXPIRY),
        (EXPIRY, "2020-01-01", "2020-01-01"),
        ("2020-01-01", None, "2020-01-01"),
        (None, None, None),
        (None, EXPIRY, EXPIRY),
    ],
)
def test_existing_grant_expiry_is_fail_closed_and_reversible(
    migration: tuple[Config, Engine],
    target: str,
    source_expiry: str | None,
    target_expiry: str | None,
    expected_expiry: str | None,
) -> None:
    config, engine = migration
    legacy = "1" if target.startswith("books.category.") else "HR"
    with engine.begin() as connection:
        user_id = _user(connection)
        _override(connection, user_id, f"books.category.{legacy}", "grant", source_expiry)
        _override(connection, user_id, target, "grant", target_expiry)
        before = _snapshot(connection, "user_permissions")
    command.upgrade(config, REVISION)
    with engine.connect() as connection:
        assert _overrides(connection, user_id)[target] == ("grant", expected_expiry)
    command.downgrade(config, PREVIOUS)
    with engine.connect() as connection:
        assert _snapshot(connection, "user_permissions") == before


@pytest.mark.parametrize("reporter_already_has_target", [False, True])
def test_role_rewrite_removes_legacy_and_restores_exact_prior_rows(
    migration: tuple[Config, Engine], reporter_already_has_target: bool
) -> None:
    config, engine = migration
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT OR IGNORE INTO role_permissions (role, capability) VALUES "
                "('inmate_reporter', 'books.category.INV'), "
                "('inmate_reporter', 'books.category.GS'), "
                "('operator', 'books.category.HR'), "
                "('operator', 'books.category.IMPORTED'), "
                "('operator', 'books.category.7/1')"
            )
        )
        if reporter_already_has_target:
            connection.execute(
                text(
                    "INSERT OR IGNORE INTO role_permissions (role, capability) "
                    "VALUES ('inmate_reporter', 'books.category.13/1')"
                )
            )
        before = _snapshot(connection, "role_permissions")
    command.upgrade(config, REVISION)
    with engine.connect() as connection:
        rows = set(connection.execute(text("SELECT role, capability FROM role_permissions")))
        assert ("inmate_reporter", "books.category.13/1") in rows
        assert ("operator", "books.category.7/1") in rows
        assert not any(
            capability.startswith("books.category.")
            and capability.removeprefix("books.category.") not in {f"{n}/1" for n in range(1, 16)}
            for _, capability in rows
        )
    command.downgrade(config, PREVIOUS)
    with engine.connect() as connection:
        assert _snapshot(connection, "role_permissions") == before
        assert BACKUP not in inspect(connection).get_table_names()


def test_pending_legacy_requests_are_refused_using_existing_lifecycle_and_restored(
    migration: tuple[Config, Engine],
) -> None:
    config, engine = migration
    with engine.begin() as connection:
        user_id = _user(connection)
        connection.execute(
            text(
                "INSERT INTO permission_requests "
                "(user_id, capability, status, decision, note, decided_at) "
                "VALUES (:user_id, :capability, :status, :decision, :note, :decided_at)"
            ),
            [
                {
                    "user_id": user_id,
                    "capability": capability,
                    "status": status,
                    "decision": decision,
                    "note": note,
                    "decided_at": decided_at,
                }
                for capability, status, decision, note, decided_at in (
                    ("books.category.HR", "pending", None, "Please review", None),
                    ("books.category.IMPORTED", "pending", None, None, None),
                    ("books.category.12/1", "pending", None, None, None),
                    ("books.servicerecords.Report", "pending", None, None, None),
                    ("books.category.GS", "granted", "once", "Approved", EXPIRY),
                    ("books.category.INV", "refused", "refused", "Already refused", EXPIRY),
                )
            ],
        )
        before = _snapshot(connection, "permission_requests")
    command.upgrade(config, REVISION)
    with engine.connect() as connection:
        requests = {
            row["capability"]: row
            for row in connection.execute(text("SELECT * FROM permission_requests")).mappings()
        }
        for capability in ("books.category.HR", "books.category.IMPORTED"):
            request = requests[capability]
            assert request["status"] == request["decision"] == "refused"
            assert "legacy category permissions were replaced" in request["note"]
            assert request["decided_at"] is not None
            assert request["decided_by_user_id"] is None
        assert requests["books.category.HR"]["note"].startswith("Please review\n\n")
        assert requests["books.category.12/1"]["status"] == "pending"
        assert requests["books.servicerecords.Report"]["status"] == "pending"
        assert requests["books.category.GS"]["decision"] == "once"
        assert requests["books.category.INV"]["note"] == "Already refused"
    command.downgrade(config, PREVIOUS)
    with engine.connect() as connection:
        assert _snapshot(connection, "permission_requests") == before


def test_round_trip_restores_deleted_sources_collisions_and_leaves_records_untouched(
    migration: tuple[Config, Engine],
) -> None:
    config, engine = migration
    with engine.begin() as connection:
        user_id = _user(connection)
        _override(connection, user_id, "books.category.HR", "deny", EXPIRY)
        _override(connection, user_id, "books.category.1", "grant", EXPIRY)
        _override(connection, user_id, "books.category.2", "deny")
        _override(connection, user_id, "books.category.IMPORTED", "grant")
        _override(connection, user_id, "books.servicerecords.HR Request Form", "grant", EXPIRY)
        _override(connection, user_id, "books.servicerecords.other", "grant")
        _override(connection, user_id, "books.category.12/1", "deny", EXPIRY)
        _override(connection, user_id, "books.category.10/1", "grant", EXPIRY)
        _override(connection, user_id, "books.service.Report", "grant")
        connection.execute(
            text(
                "INSERT OR IGNORE INTO book_categories (id, name_en, name_ar, prefix) "
                "VALUES ('HR', 'Unchanged', 'دون تغيير', 'HR')"
            )
        )
        connection.execute(
            text(
                "INSERT INTO books (category_id, classification_code, ref_number, created_at) "
                "VALUES ('HR', '7/1', 'KEEP-0001', '2026-01-01')"
            )
        )
        before = _snapshot(connection, "user_permissions", "role_permissions")
        records = _snapshot(connection, "books", "book_categories")
    command.upgrade(config, REVISION)
    with engine.connect() as connection:
        assert _snapshot(connection, "books", "book_categories") == records
        assert _overrides(connection, user_id)["books.category.12/1"] == ("deny", EXPIRY)
        assert _overrides(connection, user_id)["books.servicerecords.other"] == ("deny", None)
    command.downgrade(config, PREVIOUS)
    with engine.connect() as connection:
        assert _snapshot(connection, "user_permissions", "role_permissions") == before
        assert _snapshot(connection, "books", "book_categories") == records
        assert BACKUP not in inspect(connection).get_table_names()
    # A second upgrade uses a new journal, not stale recovery metadata.
    command.upgrade(config, REVISION)
    command.downgrade(config, PREVIOUS)
    with engine.connect() as connection:
        assert _snapshot(connection, "user_permissions", "role_permissions") == before


def test_downgrade_does_not_resurrect_deleted_user(
    migration: tuple[Config, Engine],
) -> None:
    config, engine = migration
    with engine.begin() as connection:
        user_id = _user(connection)
        _override(connection, user_id, "books.category.HR")
    command.upgrade(config, REVISION)
    with engine.begin() as connection:
        connection.exec_driver_sql("PRAGMA foreign_keys = ON")
        connection.execute(text("DELETE FROM users WHERE id = :id"), {"id": user_id})
    command.downgrade(config, PREVIOUS)
    with engine.connect() as connection:
        assert _overrides(connection, user_id) == {}
        assert connection.execute(text("PRAGMA foreign_key_check")).fetchall() == []
