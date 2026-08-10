from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path

import fitz
import pytest

from app.config import get_settings
from app.services import approved_import_service


def _pdf_bytes() -> bytes:
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 100), "Approved report source text")
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
    assert result.proposed_subject == "Inmate Conduct Violations - Ali Hassan, Omar Saleh"
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

    with pytest.raises(approved_import_service.StagedApprovedImportError) as exc:
        approved_import_service.claim_staged(inspected.token, owner_user_id=18)

    assert exc.value.code == "STAGED_IMPORT_NOT_FOUND"
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

    assert exc.value.code == "STAGED_IMPORT_EXPIRED"
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
    with pytest.raises(approved_import_service.StagedApprovedImportError):
        approved_import_service.claim_staged(inspected.token, owner_user_id=17)

    approved_import_service.release_claim(claim)
    retried = approved_import_service.claim_staged(inspected.token, owner_user_id=17)
    approved_import_service.consume_claim(retried)

    with pytest.raises(approved_import_service.StagedApprovedImportError):
        approved_import_service.claim_staged(inspected.token, owner_user_id=17)
