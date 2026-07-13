"""Test that migration 0051 backfills legacy rows into outbound_messages.

Uses Alembic's command.upgrade against a temp SQLite DB so the actual INSERT
SQL is exercised, not mocked. env.py respects cfg.set_main_option("sqlalchemy.url")
over the placeholder URL in alembic.ini.
"""

from __future__ import annotations

import pathlib

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, text


@pytest.fixture()
def alembic_cfg(tmp_path: pathlib.Path) -> Config:
    """Return an Alembic Config pointed at a fresh temp SQLite DB."""
    ini = pathlib.Path(__file__).parents[2] / "alembic.ini"
    cfg = Config(str(ini))
    db_path = tmp_path / "test_backfill.db"
    cfg.set_main_option("sqlalchemy.url", f"sqlite:///{db_path.as_posix()}")
    return cfg


def test_backfill_copies_legacy_rows(alembic_cfg: Config) -> None:
    """After upgrading through 0051, legacy sms + whatsapp rows appear in outbound_messages."""
    url = alembic_cfg.get_main_option("sqlalchemy.url")
    assert url is not None

    # 1. Bring schema up to 0050 (outbound_messages created empty; legacy tables exist)
    command.upgrade(alembic_cfg, "0050_outbound_messages")

    # 2. Insert one legacy SMS row and one WhatsApp row via raw SQL
    engine = create_engine(url)
    with engine.begin() as conn:
        # Need a parent employee row (FK constraint).
        # created_at/updated_at have no server_default — supply them explicitly.
        conn.execute(
            text(
                "INSERT INTO employees (id, name_en, name_ar, created_at, updated_at)"
                " VALUES ('G9999', 'Test', 'اختبار', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
            )
        )
        conn.execute(
            text(
                "INSERT INTO sms_messages"
                " (employee_id, event_type, event_ref, language, phone, status,"
                "  body, delivery_state, delivery_checked_at, created_at)"
                " VALUES ('G9999', 'leave_approved', 'leave_approved:1', 'ar',"
                "         '971500000000', 'sent', 'تمت الموافقة', NULL, NULL, CURRENT_TIMESTAMP)"
            )
        )
        conn.execute(
            text(
                "INSERT INTO whatsapp_messages"
                " (employee_id, event_type, event_ref, language, phone, template,"
                "  status, created_at)"
                " VALUES ('G9999', 'leave_approved', 'leave_approved:2', 'ar',"
                "         '971500000000', 'leave_approved_ar', 'sent', CURRENT_TIMESTAMP)"
            )
        )
    engine.dispose()

    # 3. Run the backfill migration
    command.upgrade(alembic_cfg, "head")

    # 4. Assert both rows are now in outbound_messages
    engine = create_engine(url)
    with engine.connect() as conn:
        total = conn.execute(text("SELECT COUNT(*) FROM outbound_messages")).scalar()
        sms_count = conn.execute(
            text(
                "SELECT COUNT(*) FROM outbound_messages"
                " WHERE channel='sms' AND event_ref='leave_approved:1'"
            )
        ).scalar()
        wa_count = conn.execute(
            text(
                "SELECT COUNT(*) FROM outbound_messages"
                " WHERE channel='whatsapp' AND event_ref='leave_approved:2'"
            )
        ).scalar()
        sms_body = conn.execute(
            text(
                "SELECT body FROM outbound_messages"
                " WHERE channel='sms' AND event_ref='leave_approved:1'"
            )
        ).scalar()
    engine.dispose()

    assert total == 2, f"Expected 2 outbound_messages rows, got {total}"
    assert sms_count == 1, "SMS row not backfilled"
    assert wa_count == 1, "WhatsApp row not backfilled"
    assert sms_body == "تمت الموافقة", f"SMS body not copied: {sms_body!r}"
