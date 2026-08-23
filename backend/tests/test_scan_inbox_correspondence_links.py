from __future__ import annotations

from datetime import date
from types import SimpleNamespace

import pytest

from app.core.extraction import ocr
from app.db.models import CorrespondenceEmployeeLink, Employee, LedgerEntry, ScanInbox
from app.services import scan_inbox_service


def _employee(db, employee_id: str) -> Employee:
    employee = Employee(id=employee_id, name_en=employee_id, name_ar=None)
    db.add(employee)
    db.flush()
    return employee


def _entry(db) -> LedgerEntry:
    entry = LedgerEntry(
        entry_date=date(2026, 8, 23),
        direction="incoming",
        channel="email",
        counterparty="sender@example.ae",
        subject="Attachment",
    )
    db.add(entry)
    db.flush()
    return entry


def _item(db, entry_id: int | None, source: str = "email_attachment") -> ScanInbox:
    item = ScanInbox(
        source=source,
        ledger_entry_id=entry_id,
        file_path="attachment.pdf",
        filename="attachment.pdf",
        state="pending_ocr",
    )
    db.add(item)
    db.flush()
    return item


def _decision() -> SimpleNamespace:
    return SimpleNamespace(
        document_type="unknown",
        fields={},
        candidates=[],
        confidence=0.0,
        proposed_route="unknown",
        proposed_book_id=None,
        proposed_ref=None,
        proposed_employee_id=None,
        match_score=None,
        tier="manual",
    )


def test_email_attachment_ocr_text_links_employees(db_session, tmp_path, monkeypatch) -> None:
    _employee(db_session, "G3082")
    _employee(db_session, "G1234")
    entry = _entry(db_session)
    item = _item(db_session, entry.id)
    (tmp_path / "attachment.pdf").write_bytes(b"fake image")
    monkeypatch.setattr(scan_inbox_service, "_abs", lambda _path: tmp_path / "attachment.pdf")
    monkeypatch.setattr(ocr, "qr_refs_from_bytes", lambda _raw: [])
    monkeypatch.setattr(ocr, "ocr_bytes_to_text", lambda _raw: "Document for G3082 and G1234")
    monkeypatch.setattr(scan_inbox_service.scan_triage_service, "route", lambda **_kwargs: _decision())

    scan_inbox_service._process_one(db_session, item)

    rows = db_session.query(CorrespondenceEmployeeLink).filter_by(ledger_entry_id=entry.id).all()
    assert {row.employee_id for row in rows if row.state == "linked"} == {"G3082", "G1234"}


@pytest.mark.parametrize("text", ["", None])
def test_empty_ocr_text_does_not_create_links(db_session, tmp_path, monkeypatch, text) -> None:
    _employee(db_session, "G3082")
    entry = _entry(db_session)
    item = _item(db_session, entry.id)
    (tmp_path / "attachment.pdf").write_bytes(b"fake image")
    monkeypatch.setattr(scan_inbox_service, "_abs", lambda _path: tmp_path / "attachment.pdf")
    monkeypatch.setattr(ocr, "qr_refs_from_bytes", lambda _raw: [])
    monkeypatch.setattr(ocr, "ocr_bytes_to_text", lambda _raw: text)
    monkeypatch.setattr(scan_inbox_service.scan_triage_service, "route", lambda **_kwargs: _decision())

    scan_inbox_service._process_one(db_session, item)

    assert db_session.query(CorrespondenceEmployeeLink).filter_by(ledger_entry_id=entry.id).count() == 0


def test_invalid_image_does_not_create_links(db_session, tmp_path, monkeypatch) -> None:
    _employee(db_session, "G3082")
    entry = _entry(db_session)
    item = _item(db_session, entry.id)
    (tmp_path / "attachment.pdf").write_bytes(b"invalid")
    monkeypatch.setattr(scan_inbox_service, "_abs", lambda _path: tmp_path / "attachment.pdf")
    monkeypatch.setattr(ocr, "qr_refs_from_bytes", lambda _raw: [])
    monkeypatch.setattr(ocr, "ocr_bytes_to_text", lambda _raw: (_ for _ in ()).throw(ocr.InvalidImageError("bad image")))

    scan_inbox_service._process_one(db_session, item)

    assert db_session.query(CorrespondenceEmployeeLink).filter_by(ledger_entry_id=entry.id).count() == 0


def test_non_email_attachment_source_does_not_create_links(db_session, tmp_path, monkeypatch) -> None:
    _employee(db_session, "G3082")
    entry = _entry(db_session)
    item = _item(db_session, entry.id, source="upload")
    (tmp_path / "attachment.pdf").write_bytes(b"fake image")
    monkeypatch.setattr(scan_inbox_service, "_abs", lambda _path: tmp_path / "attachment.pdf")
    monkeypatch.setattr(ocr, "qr_refs_from_bytes", lambda _raw: [])
    monkeypatch.setattr(ocr, "ocr_bytes_to_text", lambda _raw: "Document for G3082")
    monkeypatch.setattr(scan_inbox_service.scan_triage_service, "route", lambda **_kwargs: _decision())

    scan_inbox_service._process_one(db_session, item)

    assert db_session.query(CorrespondenceEmployeeLink).filter_by(ledger_entry_id=entry.id).count() == 0
