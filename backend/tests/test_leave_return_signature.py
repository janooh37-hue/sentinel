"""Regression coverage for employee signatures on leave return forms."""

from __future__ import annotations

from datetime import date
from pathlib import Path

import pytest
from docx import Document as DocxDocument
from PIL import Image
from sqlalchemy import select

from app.config import Settings
from app.core import signature as signature_core
from app.core.vault_manager import Vault
from app.db.models import BookCategory, Document, Employee, Leave, Manager
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

    # Neither leave has a resolvable manager (no Manager fixture / default
    # configured) — this test only exercises the EMPLOYEE signature, so it
    # opts out of the new checked-by-default manager-signature requirement
    # rather than tripping MANAGER_SIGNATURE_REQUIRED.
    leave_service.file_return(
        db_session,
        signed_leave.id,
        resumption_date=date(2026, 8, 8),
        embed_manager_signature=False,
    )
    leave_service.file_return(
        db_session,
        unsigned_leave.id,
        resumption_date=date(2026, 8, 8),
        embed_manager_signature=False,
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


def test_file_return_requires_manager_signature_when_requested(
    db_session, tmp_path, monkeypatch
) -> None:
    """The manager-signature checkbox starts checked. A requested manager
    signature that cannot be embedded must stop filing before any reference
    or record is committed (never a silently-unsigned "signed" copy) — and
    an explicit uncheck must file successfully without it."""
    from app.api.errors import AppError

    settings = Settings(data_dir=tmp_path / "data", templates_dir=_TEMPLATES_DIR)
    monkeypatch.setattr(document_service, "get_settings", lambda: settings)
    monkeypatch.setattr(document_service, "convert_docx_to_pdf", lambda _path: None)

    employee = Employee(id="G-4201", name_en="Return Employee", name_ar="موظف مباشرة")
    manager_no_sig = Manager(name_en="No Signature Manager", name_ar="مدير بدون توقيع")
    leave_a = Leave(
        employee_id=employee.id,
        leave_type="Annual Leave",
        start_date=date(2026, 8, 1),
        end_date=date(2026, 8, 7),
        days=7,
        status="Approved",
    )
    leave_b = Leave(
        employee_id=employee.id,
        leave_type="Annual Leave",
        start_date=date(2026, 9, 1),
        end_date=date(2026, 9, 7),
        days=7,
        status="Approved",
    )
    db_session.add_all(
        [BookCategory(id="HR", prefix="HR"), employee, manager_no_sig, leave_a, leave_b]
    )
    db_session.commit()

    existing_docs = db_session.execute(select(Document)).scalars().all()
    doc_count_before = len(existing_docs)

    # Checked (default) + a manager with no saved signature -> stop filing,
    # nothing committed.
    with pytest.raises(AppError) as excinfo:
        leave_service.file_return(
            db_session,
            leave_a.id,
            resumption_date=date(2026, 8, 8),
            manager_id=manager_no_sig.id,
        )
    assert excinfo.value.code == "MANAGER_SIGNATURE_REQUIRED"
    assert excinfo.value.http_status == 422
    db_session.refresh(leave_a)
    assert leave_a.status == "Approved"  # unchanged — not silently completed
    assert db_session.execute(select(Document)).scalars().all().__len__() == doc_count_before

    # Explicit uncheck bypasses the requirement — the same manager (still no
    # signature file) can be printed by name without one.
    leave_service.file_return(
        db_session,
        leave_b.id,
        resumption_date=date(2026, 9, 8),
        manager_id=manager_no_sig.id,
        embed_manager_signature=False,
    )
    db_session.refresh(leave_b)
    assert leave_b.status == "Completed"
