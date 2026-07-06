from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol

from rapidfuzz import fuzz
from rapidfuzz import utils as fuzz_utils

from app.core.extraction import bank, emirates_id, passport_mrz, sick_leave
from app.core.extraction.classifier import classify
from app.core.extraction.iban import is_valid_iban
from app.core.extraction.types import DocType, Extraction

_MATCH_THRESHOLD = 70.0  # rapidfuzz 0..100
_CANDIDATE_LIMIT = 3
_CANDIDATE_FLOOR = 55.0  # rapidfuzz 0..100


class _Emp(Protocol):
    id: str
    name_en: str
    name_ar: str | None
    uae_id_no: str | None
    passport_no: str | None


@dataclass(frozen=True)
class PipelineResult:
    extraction: Extraction
    matched_employee_id: str | None
    match_score: float
    candidates: list[dict] = field(default_factory=list)


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


def _name_scores(name: str, employees: list[_Emp]) -> list[tuple[_Emp, float]]:
    """(_Emp, best-of-EN/AR score 0..100) for each employee, sorted desc."""
    scored: list[tuple[_Emp, float]] = []
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
    employees: list[_Emp],
    *,
    limit: int = _CANDIDATE_LIMIT,
    floor: float = _CANDIDATE_FLOOR,
) -> list[dict]:
    """Top-N fuzzy NAME near-misses (denormalized), for the triage suggestion chips.

    Exact ID/passport hits never reach here — those resolve to a single certain
    match upstream and the item is never unrouted."""
    name = fields.get("name_en") or fields.get("name_ar")
    if not name:
        return []
    out: list[dict] = []
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


def match_employee(fields: dict[str, str], employees: list[_Emp]) -> tuple[_Emp | None, float]:
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


def run_pipeline(*, ocr_text: str, employees: list[_Emp]) -> PipelineResult:
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
    return PipelineResult(
        extraction=extraction,
        matched_employee_id=emp.id if emp else None,
        match_score=score,
        candidates=match_employee_candidates(field_map, employees),
    )


__all__ = [
    "PipelineResult",
    "is_valid_iban",
    "match_employee",
    "match_employee_candidates",
    "run_pipeline",
]
