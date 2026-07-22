"""Test that regenerate_permit_book embeds the manager signature when manager_id is set.

RED before the force_manager_embed fix (General Book signing_path=="chain" -> embed OFF),
GREEN after (force_manager_embed=True overrides the chain-path policy).
"""

from __future__ import annotations

import struct
import zlib
from datetime import date
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy.orm import Session

from app.db.models import BookCategory, Manager
from app.schemas.permit import PermitCreate
from app.services import document_service, permit_service

# ---------------------------------------------------------------------------
# Minimal 1x1 white PNG -- no Pillow required
# ---------------------------------------------------------------------------


def _minimal_png() -> bytes:
    """Build a valid 1x1 white PNG from scratch (pure stdlib)."""

    def _chunk(tag: bytes, data: bytes) -> bytes:
        length = struct.pack(">I", len(data))
        crc = struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        return length + tag + data + crc

    signature = b"\x89PNG\r\n\x1a\n"
    ihdr = _chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
    raw = b"\x00\xff\xff\xff"  # filter-byte + RGB white
    idat = _chunk(b"IDAT", zlib.compress(raw))
    iend = _chunk(b"IEND", b"")
    return signature + ihdr + idat + iend


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def _seed_gs(db: Session) -> None:
    if db.get(BookCategory, "GS") is None:
        db.add(BookCategory(id="GS", prefix="GS"))
        db.commit()


@pytest.fixture()
def gen_env(
    db_session: Session, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> tuple[Session, Any]:
    """Point document_service at a tmp data dir and stub the PDF chain."""
    from app.config import Settings

    settings = Settings(data_dir=tmp_path / "data")
    monkeypatch.setattr(document_service, "get_settings", lambda: settings)
    monkeypatch.setattr(document_service, "convert_docx_to_pdf", lambda p: None)
    _seed_gs(db_session)
    return db_session, settings


def _make_manager_with_sig(db: Session, settings: Any) -> Manager:
    """Create a Manager row and write a real PNG to its canonical sig path."""
    mgr = Manager(name_en="Test Signer", name_ar="اختبار", title="Commander")
    db.add(mgr)
    db.commit()
    db.refresh(mgr)

    # Compute the canonical path (mirrors manager_service.manager_signature_path)
    sig_dir = settings.data_dir / "signatures" / "managers"
    sig_dir.mkdir(parents=True, exist_ok=True)
    sig_path = sig_dir / f"manager_{mgr.id}.png"
    sig_path.write_bytes(_minimal_png())

    mgr.sig_path = str(sig_path)
    db.commit()
    db.refresh(mgr)
    return mgr


def _payload(**kw: Any) -> PermitCreate:
    base: dict[str, Any] = dict(
        company="ACME",
        zones=["green"],
        start_date=date(2026, 7, 1),
        end_date=date(2026, 8, 1),
        people=[{"name": "Ali", "uae_id": "784-1", "nationality": "مصر"}],
        vehicles=[],
    )
    base.update(kw)
    return PermitCreate(**base)


# ---------------------------------------------------------------------------
# The load-bearing test
# ---------------------------------------------------------------------------


def test_permit_book_embeds_manager_signature(gen_env: tuple[Session, Any]) -> None:
    """manager_sig_embedded must be True on the permit's book version when
    the permit has manager_id pointing to a manager with a signature on disk.

    This test fails WITHOUT the force_manager_embed fix (General Book
    signing_path=="chain" -> embed_signature["manager"]=False -> sig1_path popped
    -> manager_sig_embedded=False) and passes WITH it.
    """
    from app.db.models import Book

    db, settings = gen_env
    mgr = _make_manager_with_sig(db, settings)

    permit = permit_service.create_permit(db, _payload(manager_id=mgr.id))
    assert permit.book_id is not None, "book must be generated"

    book = db.get_one(Book, permit.book_id)
    assert book.versions, "book must have at least one version"
    latest = max(book.versions, key=lambda v: v.version_no)
    assert latest.manager_sig_embedded is True, (
        "manager signature should be baked into the permit letter "
        "(force_manager_embed=True should override the 'chain' signing_path)"
    )
