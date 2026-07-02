# backend/tests/test_backfill_passport_no.py
from app.db.models import Employee
from app.services import passport_ocr_service as svc
from scripts.backfill_passport_no import run_backfill


def test_dry_run_writes_nothing_but_reports(db_session, monkeypatch):
    a = Employee(id="G6001", name_en="A", status="Active")
    b = Employee(id="G6002", name_en="B", status="Active")
    db_session.add_all([a, b])
    db_session.commit()

    def fake_extract(db, g):
        if g == "G6001":
            return svc.PassportExtractResult("N1234567", 0.95, "mrz", None, "pp.pdf")
        return None  # G6002: no scan

    monkeypatch.setattr(svc, "extract_passport_for_employee", fake_extract)
    report = run_backfill(db_session, apply=False)
    assert "G6001" in report["filled"]
    assert "G6002" in report["no_scan"]
    db_session.refresh(a)
    assert a.passport_no is None  # dry-run: nothing written


def test_apply_writes_mrz(db_session, monkeypatch):
    a = Employee(id="G6003", name_en="A", status="Active")
    db_session.add(a)
    db_session.commit()
    monkeypatch.setattr(
        svc,
        "extract_passport_for_employee",
        lambda db, g: svc.PassportExtractResult("N7654321", 0.95, "mrz", None, "pp.pdf"),
    )
    run_backfill(db_session, apply=True)
    db_session.refresh(a)
    assert a.passport_no == "N7654321"


def test_already_filled_employee_is_skipped(db_session, monkeypatch):
    """Employee with passport_no already set is counted in already_filled, not OCR'd."""
    a = Employee(id="G6010", name_en="A", status="Active", passport_no="X9999999")
    db_session.add(a)
    db_session.commit()

    extract_calls: list[str] = []

    def spy_extract(db, g):
        extract_calls.append(g)
        return svc.PassportExtractResult("X9999999", 0.99, "mrz", None, "pp.pdf")

    monkeypatch.setattr(svc, "extract_passport_for_employee", spy_extract)
    report = run_backfill(db_session, apply=False)

    assert "G6010" in report["already_filled"]
    assert "G6010" not in report["filled"]
    assert "G6010" not in report["needs_review"]
    assert "G6010" not in report["no_scan"]
    assert "G6010" not in extract_calls  # OCR was never invoked


def test_low_confidence_mrz_goes_to_needs_review(db_session, monkeypatch):
    """Empty-field employee with MRZ result below threshold lands in needs_review."""
    a = Employee(id="G6011", name_en="A", status="Active")
    db_session.add(a)
    db_session.commit()

    monkeypatch.setattr(
        svc,
        "extract_passport_for_employee",
        lambda db, g: svc.PassportExtractResult("N1111111", 0.89, "mrz", None, "pp.pdf"),
    )
    report = run_backfill(db_session, apply=False)

    assert "G6011" in report["needs_review"]
    assert "G6011" not in report["filled"]
