from __future__ import annotations

from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, text

ROOT = Path(__file__).resolve().parents[2]


def _alembic_config(database: Path) -> Config:
    config = Config(str(ROOT / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", f"sqlite:///{database.as_posix()}")
    return config


def test_outlook_correspondence_backfill_preserves_legacy_body_and_ocr_links(
    tmp_path: Path,
) -> None:
    database = tmp_path / "outlook-correspondence.db"
    config = _alembic_config(database)
    command.upgrade(config, "0077_timesheet_roster_assignments")
    engine = create_engine(config.get_main_option("sqlalchemy.url"))

    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO employees (id, name_en, created_at, updated_at) VALUES "
                "('G1001', 'Legacy', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP), "
                "('G1002', 'Body', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP), "
                "('G1003', 'Attachment', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
            )
        )
        connection.execute(
            text(
                "INSERT INTO ledger_entries "
                "(entry_date, direction, channel, counterparty, subject, notes_html, "
                "attachment_paths, tags, inline_images, related_employee_id, created_at) "
                "VALUES "
                "('2026-08-23', 'inbound', 'email', 'legacy@test', 'Legacy subject', '', "
                "'[]', '[]', '{}', 'G1001', CURRENT_TIMESTAMP), "
                "('2026-08-23', 'inbound', 'email', 'body@test', 'No employee in subject', "
                "'Body contains G1002', '[]', '[]', '{}', NULL, CURRENT_TIMESTAMP), "
                "('2026-08-23', 'inbound', 'email', 'ocr@test', 'No employee in email', '', "
                "'[]', '[]', '{}', NULL, CURRENT_TIMESTAMP)"
            )
        )
        ocr_entry_id = connection.execute(
            text(
                "SELECT id FROM ledger_entries WHERE counterparty = 'ocr@test'"
            )
        ).scalar_one()
        connection.execute(
            text(
                "INSERT INTO scan_inbox "
                "(source, ledger_entry_id, file_path, filename, raw_text) "
                "VALUES ('email_attachment', :entry_id, 'scan/a.pdf', 'a.pdf', "
                "'OCR found G1003')"
            ),
            {"entry_id": ocr_entry_id},
        )

    command.upgrade(config, "0078_outlook_correspondence")

    with engine.connect() as connection:
        rows = connection.execute(
            text(
                "SELECT l.ledger_entry_id, l.employee_id, l.state, l.source "
                "FROM correspondence_employee_links AS l "
                "ORDER BY l.ledger_entry_id, l.employee_id"
            )
        ).fetchall()
        assert [(row[1], row[2], row[3]) for row in rows] == [
            ("G1001", "linked", "legacy"),
            ("G1002", "linked", "detected"),
            ("G1003", "linked", "detected"),
        ]

        table_names = {
            row[0]
            for row in connection.execute(
                text("SELECT name FROM sqlite_master WHERE type = 'table'")
            )
        }
        assert {
            "correspondence_employee_links",
            "outlook_bridge_devices",
            "outlook_pairings",
            "outlook_handoffs",
            "outlook_item_locations",
        } <= table_names

    command.downgrade(config, "0077_timesheet_roster_assignments")
    with engine.connect() as connection:
        assert not connection.dialect.has_table(connection, "correspondence_employee_links")
        assert connection.dialect.has_table(connection, "ledger_entries")
