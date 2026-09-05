"""Compatibility projections preserve manual chips and hide selected-match chips."""

from app.core.extraction.types import DocType, Extraction
from app.services.document_reader import DocumentRead
from app.services.scan_triage_service import (
    EmployeeCandidateEvidence,
    EmployeeMatchEvidence,
    ExternalClassification,
    project_inbox,
)

_CANDIDATE = EmployeeCandidateEvidence("G1", "Ahmed Ali", None, 0.62)


def test_manual_decision_carries_candidates():
    result = ExternalClassification(
        read=DocumentRead("", "ocr"),
        extraction=Extraction(DocType.PASSPORT, 0.9, [], raw_text=""),
        best_employee_score=0.62,
        employee_candidates=(_CANDIDATE,),
    )
    decision = project_inbox(result)
    assert decision.tier == "manual"
    assert decision.candidates == (_CANDIDATE,)


def test_confident_decision_has_no_candidates():
    result = ExternalClassification(
        read=DocumentRead("", "ocr"),
        extraction=Extraction(DocType.EMIRATES_ID, 0.95, [], raw_text=""),
        employee_match=EmployeeMatchEvidence("G7", "Synthetic Employee", None, 1.0, "exact_uae_id"),
        best_employee_score=1.0,
        employee_candidates=(_CANDIDATE,),
    )
    decision = project_inbox(result)
    assert decision.tier == "auto"
    assert decision.candidates == ()
    assert result.employee_candidates == (_CANDIDATE,)
