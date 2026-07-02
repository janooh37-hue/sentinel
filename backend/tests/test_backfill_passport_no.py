# backend/tests/test_backfill_passport_no.py
from scripts.backfill_passport_no import run_backfill

from app.db.models import Employee
from app.services import passport_ocr_service as svc


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
