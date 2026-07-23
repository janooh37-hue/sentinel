"""Tests for report_service.create_report (Task 2).

Exercises the real render + PDF (Word COM) — Word must be available on the host.
Mirrors test_word_book_service fixture patterns: db_session, inline _user helper,
_seed_gs for BookCategory, real settings (no monkeypatch).
"""

from __future__ import annotations

import secrets
import struct
import zlib
from pathlib import Path

from app.db.models import BookCategory, BookVersion, Employee, Submitter, User

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _seed_gs(db) -> None:
    if db.get(BookCategory, "GS") is None:
        db.add(BookCategory(id="GS", prefix="GS"))
        db.flush()


def _user(db, *, employee_id: str | None = None) -> User:
    u = User(email=f"{secrets.token_hex(4)}@test.ae", password_hash="x", status="active")
    u.employee_id = employee_id
    db.add(u)
    db.flush()
    db.refresh(u)
    return u


def _write_minimal_png(path: Path) -> None:
    """Write a 1x1 white PNG — enough for signature embedding to see a real file."""

    def chunk(tag: bytes, data: bytes) -> bytes:
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(b"\x00\xff\xff\xff"))
        + chunk(b"IEND", b"")
    )
    path.write_bytes(png)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_create_report_no_ref_signer_and_footer(db_session, tmp_path):
    """create_report: correct Book shape, REPORT- prefix, approved, signed version."""
    from app.services import report_service

    _seed_gs(db_session)

    # Write a real 1x1 PNG so stored_sig_path resolves and signed=True
    sig_path = tmp_path / "G1042_sig.png"
    _write_minimal_png(sig_path)

    db_session.add(
        Employee(
            id="G1042",
            name_en="Muhannad",
            name_ar="مهند أل علي",
            position="Dispatch Head",
            position_ar="مسؤول وحدة الإرساليات",
        )
    )
    db_session.add(
        Submitter(
            employee_id="G1042",
            name="مهند أل علي",
            stored_sig_path=str(sig_path),
        )
    )
    operator = _user(db_session)  # no linked employee needed for the operator
    db_session.commit()

    book = report_service.create_report(
        db_session,
        operator=operator,
        signer_employee_id="G1042",
        recipient_id=None,
        subject="النزيل محمد",
        date="23-07-2026",
        body_html="<p>نص التقرير</p>",
        sign=True,
    )

    assert book.classification_code is None
    assert book.ref_number.startswith("REPORT-")
    assert book.approval_state == "approved"

    ver = db_session.query(BookVersion).filter_by(book_id=book.id).one()
    assert ver.template_id == "Report"
    assert ver.fields["signer_employee_id"] == "G1042"
    assert ver.fields["signed"] is True
    # generated file exists
    assert ver.document_id is not None
