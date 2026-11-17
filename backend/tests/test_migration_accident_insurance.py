"""Migration 0120: one-language accident reports and optional insurance details."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import Engine, create_engine, inspect, text
from sqlalchemy.exc import IntegrityError

ROOT = Path(__file__).resolve().parents[2]
REVISION = "0120_accident_insurance"
PARENT = "0119_employee_former_ids"
INSURANCE_COLUMNS = ("claim_no", "claim_status", "insurer", "repair_garage", "cost_payer")


@pytest.fixture
def at_parent(tmp_path: Path) -> Iterator[tuple[Engine, Config]]:
    database = tmp_path / "accident-insurance.db"
    config = Config(str(ROOT / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", f"sqlite:///{database}")
    command.upgrade(config, PARENT)
    engine = create_engine(f"sqlite:///{database}")
    try:
        with engine.begin() as c:
            c.execute(
                text(
                    "INSERT INTO vehicle_sites (id, name_ar, name_en, created_at) "
                    "VALUES (1, 'اختبار', 'Test', '2026-10-01 00:00:00')"
                )
            )
            c.execute(
                text(
                    "INSERT INTO vehicles (id, plate_number, traffic_code, type_ar, type_en, "
                    "class_ar, class_en, site_id, license_start, license_expiry, created_at) "
                    "VALUES (1, '12345', '123456', 'باص', 'Bus', 'خفيف', 'Light', 1, "
                    "'2026-01-01', '2027-01-01', '2026-10-01 00:00:00')"
                )
            )
            c.execute(
                text(
                    "INSERT INTO vehicle_accidents (id, vehicle_id, date, location_ar, "
                    "description_ar, damage_cost, status, photo_file_ids, created_at) "
                    "VALUES (1, 1, '2026-09-01', 'البوابة', 'خدش', 900, 'closed', '[]', "
                    "'2026-09-01 00:00:00')"
                )
            )
        yield engine, config
    finally:
        engine.dispose()


def test_revision_follows_parent_in_single_head_history() -> None:
    script = ScriptDirectory.from_config(Config(str(ROOT / "alembic.ini")))
    heads = script.get_heads()
    assert len(heads) == 1
    assert REVISION in {revision.revision for revision in script.walk_revisions("base", heads[0])}
    assert script.get_revision(REVISION).down_revision == PARENT


def test_upgrade_keeps_existing_reports_and_accepts_english_only(
    at_parent: tuple[Engine, Config],
) -> None:
    engine, config = at_parent
    command.upgrade(config, REVISION)

    columns = {
        column["name"]: column for column in inspect(engine).get_columns("vehicle_accidents")
    }
    assert columns["location_ar"]["nullable"] is True
    assert columns["description_ar"]["nullable"] is True
    for name in INSURANCE_COLUMNS:
        assert columns[name]["nullable"] is True

    with engine.begin() as c:
        kept = c.execute(
            text(
                "SELECT location_ar, damage_cost, claim_status FROM vehicle_accidents WHERE id = 1"
            )
        ).one()
        assert tuple(kept) == ("البوابة", 900, None)
        c.execute(
            text(
                "INSERT INTO vehicle_accidents (id, vehicle_id, date, location_en, "
                "description_en, status, photo_file_ids, claim_status, cost_payer, created_at) "
                "VALUES (2, 1, '2026-10-01', 'Gate', 'Scratch', 'open', '[]', 'submitted', "
                "'insurer', '2026-10-01 00:00:00')"
            )
        )

    with pytest.raises(IntegrityError), engine.begin() as c:
        c.execute(text("UPDATE vehicle_accidents SET claim_status = 'lost' WHERE id = 2"))
    with pytest.raises(IntegrityError), engine.begin() as c:
        c.execute(text("UPDATE vehicle_accidents SET cost_payer = 'nobody' WHERE id = 2"))


def test_downgrade_restores_required_arabic_from_the_english_text(
    at_parent: tuple[Engine, Config],
) -> None:
    engine, config = at_parent
    command.upgrade(config, REVISION)
    with engine.begin() as c:
        c.execute(
            text(
                "INSERT INTO vehicle_accidents (id, vehicle_id, date, location_en, "
                "description_en, status, photo_file_ids, created_at) "
                "VALUES (2, 1, '2026-10-01', 'Gate', 'Scratch', 'open', '[]', "
                "'2026-10-01 00:00:00')"
            )
        )

    command.downgrade(config, PARENT)

    columns = {
        column["name"]: column for column in inspect(engine).get_columns("vehicle_accidents")
    }
    assert columns["location_ar"]["nullable"] is False
    assert columns["description_ar"]["nullable"] is False
    assert not set(INSURANCE_COLUMNS) & set(columns)
    with engine.begin() as c:
        rows = c.execute(
            text("SELECT id, location_ar, description_ar FROM vehicle_accidents ORDER BY id")
        ).all()
    assert [tuple(row) for row in rows] == [(1, "البوابة", "خدش"), (2, "Gate", "Scratch")]
