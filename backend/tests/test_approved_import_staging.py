from __future__ import annotations

import os
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace

import fitz
import pytest

from app.config import get_settings
from app.core.extraction import ocr
from app.core.extraction.ocr import InvalidImageError
from app.services import approved_import_service


def _pdf_bytes() -> bytes:
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 100), "Approved report source text")
    data = doc.tobytes()
    doc.close()
    return data


def _blank_pdf(*, width: float, height: float, pages: int = 1) -> bytes:
    doc = fitz.open()
    for _ in range(pages):
        doc.new_page(width=width, height=height)
    data = doc.tobytes()
    doc.close()
    return data


def _data_dir(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Path:
    monkeypatch.setenv("GSSG_DATA_DIR", str(tmp_path))
    get_settings.cache_clear()
    return tmp_path


def test_inspect_stages_normalized_pdf_and_extracts_editable_metadata(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    _data_dir(monkeypatch, tmp_path)
    monkeypatch.setattr(
        approved_import_service,
        "text_from_pdf",
        lambda _data: (
            "Date: 10/08/2026\nInmate Name: Ali Hassan\nInmate Name: Omar Saleh\nViolation details"
        ),
    )

    result = approved_import_service.inspect_upload(
        owner_user_id=17,
        filename="approved.png",
        data=_pdf_bytes(),
    )

    staged = tmp_path / "staged_approved_imports" / result.token
    assert (staged / "source.pdf").read_bytes().startswith(b"%PDF")
    assert result.filename == "approved.png"
    assert result.report_date.isoformat() == "2026-08-10"
    assert [item.name for item in result.inmate_names] == ["Ali Hassan", "Omar Saleh"]
    assert result.proposed_subject == "Inmate Conduct Violations — Ali Hassan, Omar Saleh"
    assert result.warnings == []
    claim = approved_import_service.claim_staged(result.token, owner_user_id=17)
    assert claim.ocr_text.endswith("Violation details")
    approved_import_service.release_claim(claim)


def test_staged_import_is_scoped_to_uploading_user(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    _data_dir(monkeypatch, tmp_path)
    monkeypatch.setattr(approved_import_service, "text_from_pdf", lambda _data: "")
    inspected = approved_import_service.inspect_upload(
        owner_user_id=17,
        filename="approved.pdf",
        data=_pdf_bytes(),
    )
    assert inspected.warnings == [
        "APPROVED_IMPORT_WARNING_CONFIRM_DATE",
        "APPROVED_IMPORT_WARNING_CONFIRM_NAMES",
    ]

    with pytest.raises(approved_import_service.StagedApprovedImportError) as exc:
        approved_import_service.claim_staged(inspected.token, owner_user_id=18)

    assert exc.value.code == "APPROVED_IMPORT_TOKEN_FORBIDDEN"
    assert (tmp_path / "staged_approved_imports" / inspected.token).is_dir()


def test_staged_import_expiry_removes_only_owned_token_directory(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    _data_dir(monkeypatch, tmp_path)
    monkeypatch.setattr(approved_import_service, "text_from_pdf", lambda _data: "")
    now = datetime(2026, 8, 10, 12, 0, tzinfo=UTC)
    inspected = approved_import_service.inspect_upload(
        owner_user_id=17,
        filename="approved.pdf",
        data=_pdf_bytes(),
        now=now,
    )
    staging_root = tmp_path / "staged_approved_imports"
    unrelated = staging_root / "keep-me"
    unrelated.mkdir()

    with pytest.raises(approved_import_service.StagedApprovedImportError) as exc:
        approved_import_service.claim_staged(
            inspected.token,
            owner_user_id=17,
            now=now + timedelta(hours=25),
        )

    assert exc.value.code == "APPROVED_IMPORT_TOKEN_EXPIRED"
    assert not (staging_root / inspected.token).exists()
    assert unrelated.is_dir()


def test_claim_is_atomic_releasable_and_consumed_once(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    _data_dir(monkeypatch, tmp_path)
    monkeypatch.setattr(approved_import_service, "text_from_pdf", lambda _data: "")
    inspected = approved_import_service.inspect_upload(
        owner_user_id=17,
        filename="approved.pdf",
        data=_pdf_bytes(),
    )

    claim = approved_import_service.claim_staged(inspected.token, owner_user_id=17)
    with pytest.raises(approved_import_service.StagedApprovedImportError) as in_use:
        approved_import_service.claim_staged(inspected.token, owner_user_id=17)
    assert in_use.value.code == "APPROVED_IMPORT_TOKEN_IN_USE"

    approved_import_service.release_claim(claim)
    retried = approved_import_service.claim_staged(inspected.token, owner_user_id=17)
    approved_import_service.consume_claim(retried)

    with pytest.raises(approved_import_service.StagedApprovedImportError) as consumed:
        approved_import_service.claim_staged(inspected.token, owner_user_id=17)
    assert consumed.value.code == "APPROVED_IMPORT_TOKEN_NOT_FOUND"


def test_inspect_purges_expired_interrupted_staging_directories(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    _data_dir(monkeypatch, tmp_path)
    monkeypatch.setattr(approved_import_service, "text_from_pdf", lambda _data: "")
    old = datetime(2026, 8, 10, 12, 0, tzinfo=UTC)
    inspected = approved_import_service.inspect_upload(
        owner_user_id=17,
        filename="approved.pdf",
        data=_pdf_bytes(),
        now=old,
    )
    claim = approved_import_service.claim_staged(inspected.token, owner_user_id=17, now=old)
    staging_root = tmp_path / "staged_approved_imports"
    temporary = staging_root / f".{'f' * 32}.tmp"
    temporary.mkdir()
    os.utime(temporary, (old.timestamp(), old.timestamp()))
    unrelated = staging_root / "keep-me"
    unrelated.mkdir()

    fresh = approved_import_service.inspect_upload(
        owner_user_id=17,
        filename="fresh.pdf",
        data=_pdf_bytes(),
        now=old + timedelta(hours=25),
    )

    assert not claim.path.exists()
    assert not temporary.exists()
    assert unrelated.is_dir()
    assert (staging_root / fresh.token).is_dir()


def test_inspect_uses_global_ocr_gate_for_pdf_text(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    _data_dir(monkeypatch, tmp_path)
    entered = False

    class Gate:
        def __enter__(self) -> None:
            nonlocal entered
            entered = True

        def __exit__(self, *_args: object) -> None:
            return None

    monkeypatch.setattr(approved_import_service, "OCR_GATE", Gate())
    monkeypatch.setattr(approved_import_service, "text_from_pdf", lambda _data: "")

    approved_import_service.inspect_upload(
        owner_user_id=17,
        filename="approved.pdf",
        data=_pdf_bytes(),
    )

    assert entered


def test_invalid_rendered_pdf_is_reported_as_bad_file(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    _data_dir(monkeypatch, tmp_path)
    monkeypatch.setattr(
        approved_import_service,
        "text_from_pdf",
        lambda _data: (_ for _ in ()).throw(InvalidImageError("bad render")),
    )

    with pytest.raises(approved_import_service.StagedApprovedImportError) as exc:
        approved_import_service.inspect_upload(
            owner_user_id=17,
            filename="approved.pdf",
            data=_pdf_bytes(),
        )

    assert exc.value.code == "APPROVED_IMPORT_BAD_FILE"


def test_huge_pdf_page_is_rejected_before_rasterization(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    _data_dir(monkeypatch, tmp_path)

    def fail_render(*_args: object, **_kwargs: object) -> object:
        raise AssertionError("oversized page reached the rasterizer")

    monkeypatch.setattr(fitz.Page, "get_pixmap", fail_render)

    with pytest.raises(approved_import_service.StagedApprovedImportError) as exc:
        approved_import_service.inspect_upload(
            owner_user_id=17,
            filename="approved.pdf",
            data=_blank_pdf(width=100_000, height=72),
        )

    assert exc.value.code == "APPROVED_IMPORT_BAD_FILE"


def test_multipage_pdf_is_rejected_when_cumulative_raster_budget_is_exceeded(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    _data_dir(monkeypatch, tmp_path)
    monkeypatch.setattr(
        fitz.Page,
        "get_pixmap",
        lambda *_args, **_kwargs: SimpleNamespace(
            width=1,
            height=1,
            samples=b"\0\0\0",
        ),
    )
    monkeypatch.setattr(ocr, "extract_text", lambda _image: SimpleNamespace(text=""))

    with pytest.raises(approved_import_service.StagedApprovedImportError) as exc:
        approved_import_service.inspect_upload(
            owner_user_id=17,
            filename="approved.pdf",
            data=_blank_pdf(width=3600, height=3600, pages=2),
        )

    assert exc.value.code == "APPROVED_IMPORT_BAD_FILE"


def test_official_inmate_table_rows_are_extracted_and_defaults_are_bounded(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    _data_dir(monkeypatch, tmp_path)
    long_name = "A" * 400
    table = "\n".join(
        [
            "ت إسم النزيل الجنسية الليوان الرقم الموحد رقم الامانات",
            "1 محمد سالم ياسر الامارات 1A 159809450 1565118",
            "2 Ali Hassan UAE 2B 123456789 123456",
            f"3 {long_name} UAE 3C 123456789 123456",
        ]
        + [f"{index}\tCandidate {index}\tUAE\t{index}" for index in range(4, 150)]
    )
    monkeypatch.setattr(approved_import_service, "text_from_pdf", lambda _data: table)

    result = approved_import_service.inspect_upload(
        owner_user_id=17,
        filename="approved.pdf",
        data=_pdf_bytes(),
    )

    assert len(result.inmate_names) == 100
    assert all(0 < len(item.name) <= 256 for item in result.inmate_names)
    assert result.inmate_names[0].name == "محمد سالم ياسر"
    assert result.inmate_names[1].name == "Ali Hassan"
    assert len(result.proposed_subject) <= 512
