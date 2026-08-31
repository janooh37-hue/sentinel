"""Regression coverage for employee signatures on leave return forms."""

from __future__ import annotations

from datetime import date
from pathlib import Path

from docx import Document as DocxDocument
from PIL import Image
from sqlalchemy import select

from app.config import Settings
from app.core import signature as signature_core
from app.core.vault_manager import Vault
from app.db.models import BookCategory, Document, Employee, Leave
from app.services import document_service, leave_service
from app.services.document_service import _TEMPLATES_DIR


def _make_sig_png(path: Path) -> Path:
    image = Image.new("RGBA", (400, 168), (255, 255, 255, 0))
    for x in range(40, 360):
        y = 20 + int((x - 40) * 120 / 320)
        for dy in (-1, 0, 1):
            image.putpixel((x, y + dy), (0, 0, 0, 255))
    image.save(path)
    return path


def _drawing_count(path: Path) -> int:
    return DocxDocument(str(path)).element.body.xml.count("<w:drawing>")


def test_file_return_embeds_saved_employee_signature(db_session, tmp_path, monkeypatch) -> None:
    settings = Settings(data_dir=tmp_path / "data", templates_dir=_TEMPLATES_DIR)
    monkeypatch.setattr(document_service, "get_settings", lambda: settings)
    monkeypatch.setattr(document_service, "convert_docx_to_pdf", lambda _path: None)

    signed_employee = Employee(id="G-4101", name_en="Signed Employee", name_ar="موظف موقع")
    unsigned_employee = Employee(
        id="G-4102", name_en="Unsigned Employee", name_ar="موظف بدون توقيع"
    )
    signed_leave = Leave(
        employee_id=signed_employee.id,
        leave_type="Annual Leave",
        start_date=date(2026, 8, 1),
        end_date=date(2026, 8, 7),
        days=7,
        status="Approved",
    )
    unsigned_leave = Leave(
        employee_id=unsigned_employee.id,
        leave_type="Annual Leave",
        start_date=date(2026, 8, 1),
        end_date=date(2026, 8, 7),
        days=7,
        status="Approved",
    )
    db_session.add_all(
        [
            BookCategory(id="HR", prefix="HR"),
            signed_employee,
            unsigned_employee,
            signed_leave,
            unsigned_leave,
        ]
    )
    db_session.commit()

    signature_path = signature_core.vault_path(Vault(settings.vault_dir), signed_employee.id)
    signature_path.parent.mkdir(parents=True, exist_ok=True)
    _make_sig_png(signature_path)

    leave_service.file_return(
        db_session,
        signed_leave.id,
        resumption_date=date(2026, 8, 8),
    )
    leave_service.file_return(
        db_session,
        unsigned_leave.id,
        resumption_date=date(2026, 8, 8),
    )

    signed_document = db_session.execute(
        select(Document).where(Document.leave_id == signed_leave.id)
    ).scalar_one()
    unsigned_document = db_session.execute(
        select(Document).where(Document.leave_id == unsigned_leave.id)
    ).scalar_one()
    assert signed_document.docx_path is not None
    assert unsigned_document.docx_path is not None
    signed_count = _drawing_count(settings.data_dir / signed_document.docx_path)
    unsigned_count = _drawing_count(settings.data_dir / unsigned_document.docx_path)
    assert signed_count == unsigned_count + 1
