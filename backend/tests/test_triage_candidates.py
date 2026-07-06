"""Unrouted triage decisions must carry the matcher's near-miss candidates."""

from app.core.extraction.types import DocType, Extraction
from app.services import scan_triage_service
from app.services.extraction_service import PipelineResult
from app.services.intake_service import IntakeResult

_CANDS = [{"employee_id": "G1", "name_en": "Ahmed Ali", "name_ar": None, "score": 0.62}]


def _fake_intake(pr):
    return lambda **_kw: IntakeResult(mode="external", pipeline=pr)


def test_manual_decision_carries_candidates(monkeypatch):
    # passport doctype but NO confident employee -> manual/unrouted, candidates attached
    ex = Extraction(DocType.PASSPORT, 0.9, [], raw_text="")
    pr = PipelineResult(
        extraction=ex, matched_employee_id=None, match_score=0.62, candidates=_CANDS
    )
    monkeypatch.setattr(scan_triage_service, "run_intake", _fake_intake(pr))
    d = scan_triage_service.route(ocr_text="x", qr_refs=[], db=None, employees=[])
    assert d.tier == "manual"
    assert d.candidates == _CANDS


def test_confident_decision_has_no_candidates(monkeypatch):
    # exact employee match -> auto, candidates stay empty (the proposal is the chip)
    ex = Extraction(DocType.EMIRATES_ID, 0.95, [], raw_text="")
    pr = PipelineResult(extraction=ex, matched_employee_id="G7", match_score=1.0, candidates=_CANDS)
    monkeypatch.setattr(scan_triage_service, "run_intake", _fake_intake(pr))
    d = scan_triage_service.route(ocr_text="x", qr_refs=[], db=None, employees=[])
    assert d.tier == "auto"
    assert d.candidates == []
