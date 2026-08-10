from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text

from app.db.models import Book, BookVersion, Document

ROOT = Path(__file__).resolve().parents[2]


def test_package_fields_are_present_in_model_metadata() -> None:
    assert Document.__table__.c.base_pdf_path.nullable
    assert not Book.__table__.c.included_papers_revision.nullable
    assert Book.__table__.c.included_papers_revision.server_default is not None
    assert BookVersion.__table__.c.signed_base_pdf_path.nullable
    assert not BookVersion.__table__.c.signed_embedded_paper_ids.nullable
    assert BookVersion.__table__.c.signed_embedded_paper_ids.server_default is not None


def test_record_included_papers_migration_upgrades_and_downgrades(tmp_path: Path) -> None:
    database = tmp_path / "record-included-papers.db"
    engine = create_engine(f"sqlite:///{database}")
    with engine.begin() as connection:
        connection.exec_driver_sql(
            """
            CREATE TABLE documents (
                id INTEGER PRIMARY KEY,
                pdf_path VARCHAR(1024)
            )
            """
        )
        connection.exec_driver_sql(
            """
            CREATE TABLE books (
                id INTEGER PRIMARY KEY,
                merged_attachment_paths JSON NOT NULL DEFAULT '[]'
            )
            """
        )
        connection.exec_driver_sql(
            """
            CREATE TABLE book_versions (
                id INTEGER PRIMARY KEY,
                signed_pdf_path VARCHAR(1024)
            )
            """
        )
        connection.execute(text("INSERT INTO documents (id, pdf_path) VALUES (1, 'generated/a.pdf')"))
        connection.execute(
            text("INSERT INTO book_versions (id, signed_pdf_path) VALUES (1, 'signed/a.pdf')")
        )
        connection.execute(
            text(
                "INSERT INTO books (id, merged_attachment_paths) "
                "VALUES (1, '[{\"path\":\"book_attachments/1/a.pdf\",\"slot_key\":\"extra\"}]')"
            )
        )
        connection.exec_driver_sql(
            "CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL)"
        )
        connection.execute(text("INSERT INTO alembic_version VALUES ('0067')"))

    config = Config(str(ROOT / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", f"sqlite:///{database}")
    command.upgrade(config, "0068")

    with engine.connect() as connection:
        document_columns = {
            column["name"] for column in inspect(connection).get_columns("documents")
        }
        book_columns = {
            column["name"] for column in inspect(connection).get_columns("books")
        }
        version_columns = {
            column["name"] for column in inspect(connection).get_columns("book_versions")
        }
        assert "base_pdf_path" in document_columns
        assert "included_papers_revision" in book_columns
        assert {
            "signed_base_pdf_path",
            "signed_embedded_paper_ids",
        } <= version_columns
        book_row = connection.execute(
            text("SELECT merged_attachment_paths, included_papers_revision FROM books WHERE id = 1")
        ).one()
        assert book_row == (
            '[{"path":"book_attachments/1/a.pdf","slot_key":"extra"}]',
            0,
        )
        version_row = connection.execute(
            text(
                "SELECT signed_pdf_path, signed_base_pdf_path, "
                "signed_embedded_paper_ids FROM book_versions WHERE id = 1"
            )
        ).one()
        assert version_row == ("signed/a.pdf", None, "[]")

    command.downgrade(config, "0067")

    with engine.connect() as connection:
        document_columns = {
            column["name"] for column in inspect(connection).get_columns("documents")
        }
        book_columns = {
            column["name"] for column in inspect(connection).get_columns("books")
        }
        version_columns = {
            column["name"] for column in inspect(connection).get_columns("book_versions")
        }
        assert "base_pdf_path" not in document_columns
        assert "included_papers_revision" not in book_columns
        assert "signed_base_pdf_path" not in version_columns
        assert "signed_embedded_paper_ids" not in version_columns
        assert connection.execute(
            text("SELECT pdf_path FROM documents WHERE id = 1")
        ).scalar_one() == "generated/a.pdf"
        assert connection.execute(
            text("SELECT merged_attachment_paths FROM books WHERE id = 1")
        ).scalar_one() == '[{"path":"book_attachments/1/a.pdf","slot_key":"extra"}]'
        assert connection.execute(
            text("SELECT signed_pdf_path FROM book_versions WHERE id = 1")
        ).scalar_one() == "signed/a.pdf"
