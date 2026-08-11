from __future__ import annotations

from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text

ROOT = Path(__file__).resolve().parents[2]


def test_document_docx_nullable_migration_round_trip(tmp_path: Path) -> None:
    database = tmp_path / "document-docx-nullable.db"
    url = f"sqlite:///{database}"
    config = Config(str(ROOT / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", url)
    command.upgrade(config, "0067")
    engine = create_engine(url)

    with engine.begin() as connection:
        before = {column["name"]: column for column in inspect(connection).get_columns("documents")}
        assert before["docx_path"]["nullable"] is False
        connection.execute(
            text(
                "INSERT INTO documents "
                "(template_id, ref_number, docx_path, pdf_path, submission_id, role) "
                "VALUES ('Leave Application Form', 'HR-0001', "
                "'generated/HR-0001.docx', 'generated/HR-0001.pdf', "
                "'existing-submission', 'primary')"
            )
        )
    command.upgrade(config, "0068")

    with engine.begin() as connection:
        after = {column["name"]: column for column in inspect(connection).get_columns("documents")}
        assert after["docx_path"]["nullable"] is True
        preserved = (
            connection.execute(
                text(
                    "SELECT template_id, ref_number, docx_path, pdf_path, submission_id, role "
                    "FROM documents WHERE ref_number = 'HR-0001'"
                )
            )
            .mappings()
            .one()
        )
        assert dict(preserved) == {
            "template_id": "Leave Application Form",
            "ref_number": "HR-0001",
            "docx_path": "generated/HR-0001.docx",
            "pdf_path": "generated/HR-0001.pdf",
            "submission_id": "existing-submission",
            "role": "primary",
        }
        connection.execute(
            text(
                "INSERT INTO documents "
                "(template_id, ref_number, docx_path, pdf_path, submission_id, role) "
                "VALUES ('Inmate Conduct Violations', 'NAT-0001', NULL, "
                "'book_attachments/1/original-v1.pdf', 'submission', 'primary')"
            )
        )

    with pytest.raises(RuntimeError, match="PDF-only documents"):
        command.downgrade(config, "0067")

    with engine.begin() as connection:
        connection.execute(text("DELETE FROM documents WHERE docx_path IS NULL"))

    command.downgrade(config, "0067")

    with engine.connect() as connection:
        downgraded = {
            column["name"]: column for column in inspect(connection).get_columns("documents")
        }
        assert downgraded["docx_path"]["nullable"] is False
        preserved = (
            connection.execute(
                text(
                    "SELECT template_id, ref_number, docx_path, pdf_path, submission_id, role "
                    "FROM documents WHERE ref_number = 'HR-0001'"
                )
            )
            .mappings()
            .one()
        )
        assert dict(preserved) == {
            "template_id": "Leave Application Form",
            "ref_number": "HR-0001",
            "docx_path": "generated/HR-0001.docx",
            "pdf_path": "generated/HR-0001.pdf",
            "submission_id": "existing-submission",
            "role": "primary",
        }
