"""Shared read-only scan classification and intake/inbox projections.

``classify`` delegates byte acquisition to the document reader; ``classify_text``
resolves supplied evidence using live Records and employees without file I/O or
writes. The two pure projections retain each caller's response and filing policy.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field, replace
from typing import Literal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.extraction.form_ref import (
    canonical_ref,
    reference_observations,
    stamped_observations,
    stamped_tokens,
)
from app.core.extraction.types import Extraction
from app.db.models import Book
from app.schemas.extraction import ExtractedFieldOut
from app.schemas.intake import ExternalOut, ReturnedFormOut, route_for_doc_type
from app.services.document_reader import DocumentRead, DocumentReader, read_document
from app.services.extraction_service import EmployeeLike, run_pipeline

# doctypes whose exact ID/passport match is safe to auto-file into the vault.
_AUTO_EMPLOYEE_DOCTYPES = {"emirates_id", "passport"}
_EMPLOYEE_DOCTYPES = {"emirates_id", "passport", "bank_iban"}

ReferenceSource = Literal["qr", "ocr_stamped", "ocr_bare"]
ReferenceMatchKind = Literal["none", "exact", "canonical", "edit_distance_one"]
EmployeeMatchKind = Literal["exact_uae_id", "exact_passport", "fuzzy_name"]
InboxTier = Literal["auto", "confirm", "manual"]
InboxRoute = Literal["book_attach", "employee_doc", "leave", "salary_transfer", "unknown"]


@dataclass(frozen=True, slots=True)
class BookMatchEvidence:
    book_id: int
    ref_number: str
    approval_state: str
    category: str | None = None
    subject: str | None = None
    employee_id: str | None = None
    employee_name: str | None = None


@dataclass(frozen=True, slots=True)
class ReferenceCandidate:
    observed: str
    normalized: str
    canonical: str
    source: ReferenceSource
    match_kind: ReferenceMatchKind = "none"
    live_matches: tuple[BookMatchEvidence, ...] = field(default_factory=tuple)


@dataclass(frozen=True, slots=True)
class ReturnedFormMatch:
    candidate: ReferenceCandidate
    book: BookMatchEvidence
    confidence: float


@dataclass(frozen=True, slots=True)
class EmployeeCandidateEvidence:
    employee_id: str
    name_en: str
    name_ar: str | None
    score: float


@dataclass(frozen=True, slots=True)
class EmployeeMatchEvidence:
    employee_id: str
    name_en: str
    name_ar: str | None
    score: float
    kind: EmployeeMatchKind


@dataclass(frozen=True, slots=True)
class ReferenceAmbiguity:
    source: ReferenceSource
    match_kind: ReferenceMatchKind
    observed: tuple[str, ...]
    book_ids: tuple[int, ...]
    kind: Literal["reference"] = field(default="reference", init=False)


@dataclass(frozen=True, slots=True)
class EmployeeAmbiguity:
    match_kind: EmployeeMatchKind
    employee_ids: tuple[str, ...]
    kind: Literal["employee"] = field(default="employee", init=False)


ClassificationAmbiguity = ReferenceAmbiguity | EmployeeAmbiguity


@dataclass(frozen=True, slots=True)
class ReturnedFormClassification:
    read: DocumentRead
    match: ReturnedFormMatch
    reference_candidates: tuple[ReferenceCandidate, ...] = field(default_factory=tuple)
    ambiguities: tuple[ClassificationAmbiguity, ...] = field(default_factory=tuple)
    mode: Literal["returned_form"] = field(default="returned_form", init=False)


@dataclass(frozen=True, slots=True)
class ExternalClassification:
    read: DocumentRead
    extraction: Extraction
    employee_match: EmployeeMatchEvidence | None = None
    best_employee_score: float = 0.0
    employee_candidates: tuple[EmployeeCandidateEvidence, ...] = field(default_factory=tuple)
    reference_candidates: tuple[ReferenceCandidate, ...] = field(default_factory=tuple)
    ambiguities: tuple[ClassificationAmbiguity, ...] = field(default_factory=tuple)
    mode: Literal["external"] = field(default="external", init=False)


ClassificationResult = ReturnedFormClassification | ExternalClassification


@dataclass(frozen=True, slots=True)
class InboxDecision:
    classification: ClassificationResult
    tier: InboxTier
    proposed_route: InboxRoute
    proposed_book_id: int | None = None
    proposed_ref: str | None = None
    proposed_employee_id: str | None = None
    match_score: float = 0.0
    document_type: str = "unknown"
    fields: dict[str, str] = field(default_factory=dict)
    confidence: float = 0.0
    candidates: tuple[EmployeeCandidateEvidence, ...] = field(default_factory=tuple)


def _book_evidence(book: Book) -> BookMatchEvidence:
    return BookMatchEvidence(
        book_id=book.id,
        ref_number=book.ref_number,
        approval_state=book.approval_state,
        category=book.category.name_en if book.category is not None else None,
        subject=book.subject,
        employee_id=book.employee_id,
        employee_name=book.employee_name_snapshot,
    )


def _exact_reference_candidates(
    read: DocumentRead,
    *,
    db: Session,
) -> tuple[ReferenceCandidate, ...]:
    observations: list[tuple[str, ReferenceSource]] = [
        (ref.strip(), "qr") for ref in read.qr_refs if ref.strip()
    ]
    observations.extend(
        (observation.observed, observation.source)
        for observation in reference_observations(read.text)
    )

    candidates: list[ReferenceCandidate] = []
    for observed, source in observations:
        normalized = observed.upper()
        books = list(
            db.scalars(
                select(Book)
                .where(func.lower(Book.ref_number) == normalized.lower())
                .where(Book.deleted_at.is_(None))
                .order_by(Book.id)
            )
        )
        live_matches = tuple(_book_evidence(book) for book in books)
        candidates.append(
            ReferenceCandidate(
                observed=observed,
                normalized=normalized,
                canonical=canonical_ref(normalized),
                source=source,
                match_kind="exact" if live_matches else "none",
                live_matches=live_matches,
            )
        )
    observed_keys = {(candidate.normalized, candidate.source) for candidate in candidates}
    for observation in stamped_observations(read.text):
        normalized = observation.observed.upper()
        key = (normalized, observation.source)
        if key not in observed_keys:
            observed_keys.add(key)
            candidates.append(
                ReferenceCandidate(
                    observed=observation.observed,
                    normalized=normalized,
                    canonical=canonical_ref(normalized),
                    source=observation.source,
                )
            )
    source_order = {"qr": 0, "ocr_stamped": 1, "ocr_bare": 2}
    candidates.sort(key=lambda candidate: source_order[candidate.source])
    return tuple(candidates)


def _edit_distance_le1(a: str, b: str) -> bool:
    """True when Levenshtein distance(a, b) <= 1 (early-out, no full matrix)."""
    if a == b:
        return True
    la, lb = len(a), len(b)
    if abs(la - lb) > 1:
        return False
    if la == lb:
        # Same length → exactly one substitution allowed (a != b here).
        return sum(1 for x, y in zip(a, b, strict=True) if x != y) == 1
    # Lengths differ by 1 → one insertion/deletion. Make `a` the shorter.
    if la > lb:
        a, b = b, a
        la = lb
    i = j = 0
    skipped = False
    while i < la:
        if a[i] == b[j]:
            i += 1
            j += 1
        elif skipped:
            return False
        else:
            skipped = True
            j += 1
    return True  # any trailing char in b is the single allowed edit


def classify(
    raw: bytes,
    *,
    db: Session,
    employees: Sequence[EmployeeLike],
    reader: DocumentReader = read_document,
) -> ClassificationResult:
    return classify_text(reader(raw), db=db, employees=employees)


def classify_text(
    read: DocumentRead,
    *,
    db: Session,
    employees: Sequence[EmployeeLike],
) -> ClassificationResult:
    candidates = _exact_reference_candidates(read, db=db)
    selected: ReferenceCandidate | None = None
    ambiguities: tuple[ClassificationAmbiguity, ...] = ()
    for source in ("qr", "ocr_stamped", "ocr_bare"):
        matching = tuple(
            candidate
            for candidate in candidates
            if candidate.source == source and candidate.live_matches
        )
        book_ids = tuple(
            sorted({book.book_id for candidate in matching for book in candidate.live_matches})
        )
        if len(book_ids) > 1:
            ambiguities = (
                ReferenceAmbiguity(
                    source=matching[0].source,
                    match_kind="exact",
                    observed=tuple(dict.fromkeys(candidate.observed for candidate in matching)),
                    book_ids=book_ids,
                ),
            )
            break
        if book_ids:
            selected = matching[0]
            break
    fuzzy_tokens = set(stamped_tokens(read.text))
    if selected is None and not ambiguities and fuzzy_tokens:
        live_books = list(
            db.scalars(select(Book).where(Book.deleted_at.is_(None)).order_by(Book.id))
        )
        canonical_candidates: list[ReferenceCandidate] = []
        for candidate in candidates:
            matches = tuple(
                _book_evidence(book)
                for book in live_books
                if candidate.source == "ocr_stamped"
                and candidate.normalized in fuzzy_tokens
                and canonical_ref(book.ref_number) == candidate.canonical
            )
            canonical_candidates.append(
                replace(candidate, match_kind="canonical", live_matches=matches)
                if matches
                else candidate
            )
        candidates = tuple(canonical_candidates)
        matching = tuple(
            candidate for candidate in candidates if candidate.match_kind == "canonical"
        )
        book_ids = tuple(
            sorted({book.book_id for candidate in matching for book in candidate.live_matches})
        )
        if len(book_ids) > 1:
            ambiguities = (
                ReferenceAmbiguity(
                    source="ocr_stamped",
                    match_kind="canonical",
                    observed=tuple(dict.fromkeys(candidate.observed for candidate in matching)),
                    book_ids=book_ids,
                ),
            )
        elif book_ids:
            selected = matching[0]
        if selected is None and not ambiguities:
            near_candidates: list[ReferenceCandidate] = []
            for candidate in candidates:
                near_matches: list[BookMatchEvidence] = []
                if (
                    candidate.source == "ocr_stamped"
                    and candidate.normalized in fuzzy_tokens
                    and "-" in candidate.canonical
                ):
                    prefix, number = candidate.canonical.rsplit("-", 1)
                    for book in live_books:
                        canonical = canonical_ref(book.ref_number)
                        if "-" not in canonical:
                            continue
                        book_prefix, book_number = canonical.rsplit("-", 1)
                        if number == book_number and _edit_distance_le1(prefix, book_prefix):
                            near_matches.append(_book_evidence(book))
                near_candidates.append(
                    replace(
                        candidate, match_kind="edit_distance_one", live_matches=tuple(near_matches)
                    )
                    if near_matches
                    else candidate
                )
            candidates = tuple(near_candidates)
            matching = tuple(
                candidate for candidate in candidates if candidate.match_kind == "edit_distance_one"
            )
            book_ids = tuple(
                sorted({book.book_id for candidate in matching for book in candidate.live_matches})
            )
            if len(book_ids) > 1:
                ambiguities = (
                    ReferenceAmbiguity(
                        source="ocr_stamped",
                        match_kind="edit_distance_one",
                        observed=tuple(dict.fromkeys(candidate.observed for candidate in matching)),
                        book_ids=book_ids,
                    ),
                )
            elif book_ids:
                selected = matching[0]
    if selected is not None:
        selected_book = selected.live_matches[0]
        return ReturnedFormClassification(
            read=read,
            match=ReturnedFormMatch(
                candidate=selected,
                book=selected_book,
                confidence=1.0 if selected.match_kind == "exact" else 0.7,
            ),
            reference_candidates=candidates,
        )
    employee_list = list(employees)
    pipeline = run_pipeline(ocr_text=read.text, employees=employee_list)
    matched = next(
        (employee for employee in employee_list if employee.id == pipeline.matched_employee_id),
        None,
    )
    fields = {field.key: field.value for field in pipeline.extraction.fields}
    identifiers: tuple[tuple[str, EmployeeMatchKind], ...] = (
        ("uae_id_no", "exact_uae_id"),
        ("passport_no", "exact_passport"),
    )
    for key, identifier_kind in identifiers:
        value = fields.get(key)
        identifier_matches = tuple(
            sorted(
                {
                    employee.id
                    for employee in employee_list
                    if value and getattr(employee, key) == value
                }
            )
        )
        if len(identifier_matches) > 1:
            ambiguities += (
                EmployeeAmbiguity(match_kind=identifier_kind, employee_ids=identifier_matches),
            )
            matched = None
    employee_match: EmployeeMatchEvidence | None = None
    if pipeline.name_match_ties:
        ambiguities += (
            EmployeeAmbiguity(match_kind="fuzzy_name", employee_ids=pipeline.name_match_ties),
        )
        matched = None
    if matched is not None:
        if fields.get("uae_id_no") and fields["uae_id_no"] == matched.uae_id_no:
            match_kind: EmployeeMatchKind = "exact_uae_id"
        elif fields.get("passport_no") and fields["passport_no"] == matched.passport_no:
            match_kind = "exact_passport"
        else:
            match_kind = "fuzzy_name"
        employee_match = EmployeeMatchEvidence(
            employee_id=matched.id,
            name_en=matched.name_en,
            name_ar=matched.name_ar,
            score=pipeline.match_score,
            kind=match_kind,
        )
    return ExternalClassification(
        read=read,
        extraction=pipeline.extraction,
        employee_match=employee_match,
        best_employee_score=pipeline.match_score,
        employee_candidates=tuple(
            EmployeeCandidateEvidence(
                employee_id=candidate["employee_id"],
                name_en=candidate["name_en"],
                name_ar=candidate["name_ar"],
                score=candidate["score"],
            )
            for candidate in pipeline.candidates
        ),
        reference_candidates=candidates,
        ambiguities=ambiguities,
    )


def project_intake(result: ClassificationResult) -> ReturnedFormOut | ExternalOut:
    if isinstance(result, ReturnedFormClassification):
        book = result.match.book
        return ReturnedFormOut(
            book_id=book.book_id,
            ref_number=book.ref_number,
            approval_state=book.approval_state,
            category=book.category,
            subject=book.subject,
            employee_id=book.employee_id,
            employee_name=book.employee_name,
        )
    extraction = result.extraction
    employee = result.employee_match
    route_kind, form_slug = route_for_doc_type(extraction.doc_type.value)
    return ExternalOut(
        document_type=extraction.doc_type.value,
        document_type_confidence=extraction.doc_type_confidence,
        alternatives=[alternative.value for alternative in extraction.alternatives],
        extraction=[
            ExtractedFieldOut(
                key=field.key,
                value=field.value,
                confidence=field.confidence,
                source_snippet=field.source_snippet,
            )
            for field in extraction.fields
        ],
        matched_employee_id=employee.employee_id if employee is not None else None,
        match_score=employee.score if employee is not None else result.best_employee_score,
        matched_employee_name_en=employee.name_en if employee is not None else None,
        matched_employee_name_ar=employee.name_ar if employee is not None else None,
        route_kind=route_kind,
        route_form_slug=form_slug,
    )


def project_inbox(result: ClassificationResult) -> InboxDecision:
    if isinstance(result, ReturnedFormClassification):
        match = result.match
        auto = (
            match.candidate.match_kind == "exact" and match.book.approval_state != "awaiting_scan"
        )
        return InboxDecision(
            classification=result,
            tier="auto" if auto else "confirm",
            proposed_route="book_attach",
            proposed_book_id=match.book.book_id,
            proposed_ref=match.book.ref_number,
            document_type="returned_form",
            confidence=1.0 if auto else 0.7,
        )
    extraction = result.extraction
    employee = result.employee_match
    fields = {field.key: field.value for field in extraction.fields}
    base = InboxDecision(
        classification=result,
        tier="manual",
        proposed_route="unknown",
        document_type=extraction.doc_type.value,
        fields=fields,
        confidence=extraction.doc_type_confidence,
        candidates=result.employee_candidates,
    )
    if result.ambiguities or extraction.doc_type.value == "unknown" or employee is None:
        return base
    if extraction.doc_type.value == "sick_leave":
        return replace(
            base,
            tier="confirm",
            proposed_route="leave",
            proposed_employee_id=employee.employee_id,
            match_score=employee.score,
            candidates=(),
        )
    if extraction.doc_type.value in _EMPLOYEE_DOCTYPES:
        exact = (
            employee.kind in {"exact_uae_id", "exact_passport"}
            and extraction.doc_type.value in _AUTO_EMPLOYEE_DOCTYPES
        )
        return replace(
            base,
            tier="auto" if exact else "confirm",
            proposed_route="employee_doc",
            proposed_employee_id=employee.employee_id,
            match_score=employee.score,
            candidates=(),
        )
    return base


__all__ = [
    "BookMatchEvidence",
    "ClassificationAmbiguity",
    "ClassificationResult",
    "EmployeeAmbiguity",
    "EmployeeCandidateEvidence",
    "EmployeeLike",
    "EmployeeMatchEvidence",
    "EmployeeMatchKind",
    "ExternalClassification",
    "InboxDecision",
    "InboxRoute",
    "InboxTier",
    "ReferenceAmbiguity",
    "ReferenceCandidate",
    "ReferenceMatchKind",
    "ReferenceSource",
    "ReturnedFormClassification",
    "ReturnedFormMatch",
    "classify",
    "classify_text",
    "project_inbox",
    "project_intake",
]
