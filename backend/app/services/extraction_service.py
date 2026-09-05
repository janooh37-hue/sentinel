from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Protocol, TypedDict

from rapidfuzz import fuzz
from rapidfuzz import utils as fuzz_utils

from app.core.extraction import bank, emirates_id, passport_mrz, sick_leave
from app.core.extraction.classifier import classify
from app.core.extraction.iban import is_valid_iban
from app.core.extraction.types import DocType, Extraction

_MATCH_THRESHOLD = 70.0  # rapidfuzz 0..100
_CANDIDATE_LIMIT = 3
_CANDIDATE_FLOOR = 55.0  # rapidfuzz 0..100


class EmployeeLike(Protocol):
    id: str
    name_en: str
    name_ar: str | None
    uae_id_no: str | None
    passport_no: str | None


class EmployeeCandidate(TypedDict):
    employee_id: str
    name_en: str
    name_ar: str | None
    score: float


@dataclass(frozen=True)
class PipelineResult:
    extraction: Extraction
    matched_employee_id: str | None
    match_score: float
    candidates: list[EmployeeCandidate] = field(default_factory=list)
    name_match_ties: tuple[str, ...] = ()


def _extract(doc_type: DocType, text: str) -> Extraction:
    if doc_type is DocType.PASSPORT:
        ex = passport_mrz.extract_passport(text)
        if ex is not None:
            return ex
    if doc_type is DocType.EMIRATES_ID:
        return emirates_id.extract_emirates_id(text)
    if doc_type is DocType.SICK_LEAVE:
        return sick_leave.extract_sick_leave(text)
    if doc_type is DocType.BANK_IBAN:
        return bank.extract_bank(text)
    return Extraction(DocType.UNKNOWN, 0.2, [], raw_text=text)


def _name_scores(name: str, employees: Sequence[EmployeeLike]) -> list[tuple[EmployeeLike, float]]:
    """(employee, best-of-EN/AR score 0..100) pairs sorted descending."""
    scored: list[tuple[EmployeeLike, float]] = []
    for emp in employees:
        best = 0.0
        for cand in (emp.name_en, emp.name_ar):
            if not cand:
                continue
            s = fuzz.token_sort_ratio(name, cand, processor=fuzz_utils.default_process)
            if s > best:
                best = s
        scored.append((emp, best))
    scored.sort(key=lambda t: t[1], reverse=True)
    return scored


def match_employee_candidates(
    fields: dict[str, str],
    employees: Sequence[EmployeeLike],
    *,
    limit: int = _CANDIDATE_LIMIT,
    floor: float = _CANDIDATE_FLOOR,
) -> list[EmployeeCandidate]:
    """Top-N fuzzy NAME near-misses (denormalized), for the triage suggestion chips.

    Exact ID/passport hits never reach here — those resolve to a single certain
    match upstream and the item is never unrouted."""
    name = fields.get("name_en") or fields.get("name_ar")
    if not name:
        return []
    out: list[EmployeeCandidate] = []
    for emp, score in _name_scores(name, employees):
        if score < floor:
            break
        out.append(
            {
                "employee_id": emp.id,
                "name_en": emp.name_en,
                "name_ar": emp.name_ar,
                "score": round(score / 100.0, 3),
            }
        )
        if len(out) >= limit:
            break
    return out


def match_employee(
    fields: dict[str, str], employees: Sequence[EmployeeLike]
) -> tuple[EmployeeLike | None, float]:
    """Exact ID/passport match first (certain), then fuzzy name match."""
    uae_id = fields.get("uae_id_no")
    passport = fields.get("passport_no")
    for emp in employees:
        if uae_id and emp.uae_id_no and uae_id == emp.uae_id_no:
            return emp, 1.0
        if passport and emp.passport_no and passport == emp.passport_no:
            return emp, 1.0

    name = fields.get("name_en") or fields.get("name_ar")
    if not name:
        return None, 0.0
    scored = _name_scores(name, employees)
    if not scored:
        return None, 0.0
    best, best_score = scored[0]
    if best_score >= _MATCH_THRESHOLD:
        return best, best_score / 100.0
    return None, best_score / 100.0


def run_pipeline(*, ocr_text: str, employees: Sequence[EmployeeLike]) -> PipelineResult:
    doc_type, conf, alts = classify(ocr_text)
    extraction = _extract(doc_type, ocr_text)
    # carry classifier confidence + alternatives onto the extraction
    extraction = Extraction(
        doc_type=extraction.doc_type,
        doc_type_confidence=max(extraction.doc_type_confidence, conf),
        fields=extraction.fields,
        alternatives=alts,
        raw_text=extraction.raw_text,
        language=extraction.language,
    )
    field_map = {f.key: f.value for f in extraction.fields}
    emp, score = match_employee(field_map, employees)
    name_match_ties: tuple[str, ...] = ()
    if emp is not None:
        exact = (bool(field_map.get("uae_id_no")) and field_map["uae_id_no"] == emp.uae_id_no) or (
            bool(field_map.get("passport_no")) and field_map["passport_no"] == emp.passport_no
        )
        name = field_map.get("name_en") or field_map.get("name_ar")
        if not exact and name:
            scores = _name_scores(name, employees)
            ties = tuple(
                sorted(
                    {
                        candidate.id
                        for candidate, candidate_score in scores
                        if candidate_score == scores[0][1]
                    }
                )
            )
            if len(ties) > 1:
                name_match_ties = ties
    return PipelineResult(
        extraction=extraction,
        matched_employee_id=emp.id if emp else None,
        match_score=score,
        candidates=match_employee_candidates(field_map, employees),
        name_match_ties=name_match_ties,
    )


__all__ = [
    "EmployeeLike",
    "PipelineResult",
    "is_valid_iban",
    "match_employee",
    "match_employee_candidates",
    "run_pipeline",
]
