import pytest

from app.db.models import Employee
from app.services import passport_ocr_service as svc


@pytest.fixture
def emp(db_session):
    e = Employee(id="G7001", name_en="Scan Target", status="Active")
    db_session.add(e)
    db_session.commit()
    return e


def _fake_tree_with_passport(monkeypatch, tmp_path, filename="pp.pdf"):
    from datetime import datetime

    from app.schemas.vault_file import VaultEntry, VaultTree

    # Write real bytes to a temp file so path.read_bytes() works without patching Path
    fake_file = tmp_path / filename
    fake_file.write_bytes(b"%PDF-1.4 fake")

    entry = VaultEntry(
        filename=filename,
        kind="passport",
        size_bytes=10,
        modified=datetime(2026, 1, 1),
        is_pdf=True,
    )
    monkeypatch.setattr(
        svc.vault_service,
        "list_tree",
        lambda g: VaultTree(employee_id=g, folders={"passport": [entry]}),
    )
    monkeypatch.setattr(svc.vault_service, "resolve_file", lambda g, k, f: fake_file)


def test_no_scan_returns_none(db_session, emp, monkeypatch):
    from app.schemas.vault_file import VaultTree

    monkeypatch.setattr(
        svc.vault_service, "list_tree", lambda g: VaultTree(employee_id=g, folders={"passport": []})
    )
    assert svc.extract_passport_for_employee(db_session, "G7001") is None


def test_mrz_hit_is_high_confidence(db_session, emp, monkeypatch, tmp_path):
    _fake_tree_with_passport(monkeypatch, tmp_path)
    monkeypatch.setattr(svc, "ocr_bytes_to_text", lambda raw: "IGNORED")
    from app.core.extraction.types import DocType, ExtractedField, Extraction

    monkeypatch.setattr(
        svc,
        "extract_passport",
        lambda t: Extraction(
            doc_type=DocType.PASSPORT,
            doc_type_confidence=0.95,
            fields=[ExtractedField("passport_no", "N1234567", 0.95)],
        ),
    )
    res = svc.extract_passport_for_employee(db_session, "G7001")
    assert res.method == "mrz" and res.number == "N1234567" and res.confidence >= 0.9


def test_printed_fallback_when_no_mrz(db_session, emp, monkeypatch, tmp_path):
    _fake_tree_with_passport(monkeypatch, tmp_path)
    monkeypatch.setattr(svc, "ocr_bytes_to_text", lambda raw: "Passport No: A7654321")
    monkeypatch.setattr(svc, "extract_passport", lambda t: None)
    res = svc.extract_passport_for_employee(db_session, "G7001")
    assert res.method == "printed" and res.number == "A7654321" and res.confidence < 0.9


def test_apply_writes_mrz_when_empty(db_session, emp):
    res = svc.PassportExtractResult(
        number="N1234567",
        confidence=0.95,
        method="mrz",
        source_snippet=None,
        scan_filename="pp.pdf",
    )
    wrote = svc.apply_passport_extraction(db_session, emp, res)
    assert wrote is True
    db_session.refresh(emp)
    assert emp.passport_no == "N1234567" and emp.passport_no_source == "mrz"


def test_apply_does_not_write_printed(db_session, emp):
    res = svc.PassportExtractResult(
        number="A7654321",
        confidence=0.5,
        method="printed",
        source_snippet=None,
        scan_filename="pp.pdf",
    )
    assert svc.apply_passport_extraction(db_session, emp, res) is False
    db_session.refresh(emp)
    assert emp.passport_no is None


def test_apply_does_not_overwrite_existing(db_session, emp):
    emp.passport_no = "EXISTING1"
    emp.passport_no_source = "manual"
    db_session.commit()
    res = svc.PassportExtractResult(
        number="N1234567",
        confidence=0.95,
        method="mrz",
        source_snippet=None,
        scan_filename="pp.pdf",
    )
    assert svc.apply_passport_extraction(db_session, emp, res) is False
    db_session.refresh(emp)
    assert emp.passport_no == "EXISTING1"


def test_apply_overwrite_flag_allows_replace(db_session, emp):
    emp.passport_no = "EXISTING1"
    db_session.commit()
    res = svc.PassportExtractResult(
        number="N1234567",
        confidence=0.95,
        method="mrz",
        source_snippet=None,
        scan_filename="pp.pdf",
    )
    assert svc.apply_passport_extraction(db_session, emp, res, allow_overwrite=True) is True
    db_session.refresh(emp)
    assert emp.passport_no == "N1234567"


def test_escalation_returns_valid_mrz_when_cheap_pass_fails(db_session, emp, monkeypatch, tmp_path):
    _fake_tree_with_passport(monkeypatch, tmp_path)
    # cheap upright pass finds no MRZ...
    monkeypatch.setattr(svc, "ocr_bytes_to_text", lambda raw: "no mrz here")
    monkeypatch.setattr(svc, "extract_passport", lambda t: None)
    # ...but escalation rasterises + finds a valid MRZ on page 2, rotated 180°.
    monkeypatch.setattr(svc, "pages_from_bytes", lambda raw: ["p1", "p2"])
    monkeypatch.setattr(
        svc,
        "best_mrz",
        lambda pages: svc.MrzCandidate(
            number="N1234567", confidence=0.95, valid=True, page_index=1, rotation=180
        ),
    )
    res = svc.extract_passport_for_employee(db_session, "G7001")
    assert res.method == "mrz" and res.number == "N1234567" and res.confidence >= 0.9
    assert "page 2" in res.source_snippet and "180" in res.source_snippet


def test_escalation_structural_mrz_is_review_only(db_session, emp, monkeypatch, tmp_path):
    _fake_tree_with_passport(monkeypatch, tmp_path)
    monkeypatch.setattr(svc, "ocr_bytes_to_text", lambda raw: "no mrz")
    monkeypatch.setattr(svc, "extract_passport", lambda t: None)
    monkeypatch.setattr(svc, "pages_from_bytes", lambda raw: ["p1"])
    monkeypatch.setattr(
        svc,
        "best_mrz",
        lambda pages: svc.MrzCandidate(
            number="N7654321", confidence=0.55, valid=False, page_index=0, rotation=0
        ),
    )
    res = svc.extract_passport_for_employee(db_session, "G7001")
    assert res.method == "mrz" and res.number == "N7654321"
    # 0.55 < MRZ_AUTOWRITE_CONFIDENCE -> apply() refuses to write it.
    assert svc.apply_passport_extraction(db_session, emp, res) is False


def test_escalation_falls_back_to_printed(db_session, emp, monkeypatch, tmp_path):
    _fake_tree_with_passport(monkeypatch, tmp_path)
    monkeypatch.setattr(svc, "ocr_bytes_to_text", lambda raw: "no mrz")
    monkeypatch.setattr(svc, "extract_passport", lambda t: None)
    monkeypatch.setattr(svc, "pages_from_bytes", lambda raw: ["p1"])
    monkeypatch.setattr(svc, "best_mrz", lambda pages: None)
    monkeypatch.setattr(
        svc, "best_printed_number", lambda pages: ("A7654321", "Passport No: A7654321")
    )
    res = svc.extract_passport_for_employee(db_session, "G7001")
    assert res.method == "printed" and res.number == "A7654321" and res.confidence < 0.9


def test_escalation_not_reached_when_cheap_pass_valid(db_session, emp, monkeypatch, tmp_path):
    _fake_tree_with_passport(monkeypatch, tmp_path)
    monkeypatch.setattr(svc, "ocr_bytes_to_text", lambda raw: "IGNORED")
    from app.core.extraction.types import DocType, ExtractedField, Extraction

    monkeypatch.setattr(
        svc,
        "extract_passport",
        lambda t: Extraction(
            doc_type=DocType.PASSPORT,
            doc_type_confidence=0.95,
            fields=[ExtractedField("passport_no", "N1234567", 0.95)],
        ),
    )

    def _boom(pages):
        raise AssertionError("escalation must not run when the cheap pass is valid")

    monkeypatch.setattr(svc, "best_mrz", _boom)
    res = svc.extract_passport_for_employee(db_session, "G7001")
    assert res.method == "mrz" and res.number == "N1234567"
