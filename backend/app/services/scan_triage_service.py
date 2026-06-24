"""Confidence-tiered routing for the ambient Scan Inbox.

Pure decision logic: given OCR text + decoded QR refs, decide whether an inbound
document should auto-file (deterministic match, reversible attach), wait for the
operator's confirmation (fuzzy match), or sit unrouted (unknown). No DB writes,
no file I/O — just a read of Books/Employees to resolve refs and matches.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from sqlalchemy.orm import Session

from app.api.errors import NotFoundError
from app.core.extraction.form_ref import candidate_refs
from app.db.models import Book
from app.services import book_service
from app.services.extraction_service import _Emp
from app.services.intake_service import run_intake

# doctypes whose exact ID/passport match is safe to auto-file into the vault.
_AUTO_EMPLOYEE_DOCTYPES = {"emirates_id", "passport"}
_EMPLOYEE_DOCTYPES = {"emirates_id", "passport", "bank_iban"}


@dataclass(frozen=True)
class TriageDecision:
    tier: Literal["auto", "confirm", "manual"]
    proposed_route: str  # book_attach | employee_doc | leave | salary_transfer | unknown
    proposed_book_id: int | None = None
    proposed_ref: str | None = None
    proposed_employee_id: str | None = None
    match_score: float = 0.0
    document_type: str = "unknown"
    fields: dict[str, str] = field(default_factory=dict)
    confidence: float = 0.0


def _book_attach(book: Book, tier: Literal["auto", "confirm"]) -> TriageDecision:
    return TriageDecision(
        tier=tier,
        proposed_route="book_attach",
        proposed_book_id=book.id,
        proposed_ref=book.ref_number,
        document_type="returned_form",
        confidence=1.0 if tier == "auto" else 0.7,
        fields={},
    )


def route(
    *, ocr_text: str, qr_refs: list[str], db: Session, employees: list[_Emp]
) -> TriageDecision:
    # 1. Deterministic ref paths (QR or exact stamped ref) → AUTO, unless the book
    #    is awaiting a scanned signature (attaching would FLIP it to approved —
    #    too much to do silently), in which case it needs confirmation.
    for ref in [*qr_refs, *candidate_refs(ocr_text)]:
        try:
            book = book_service.get_book_by_ref(db, ref)
        except NotFoundError:
            continue
        tier: Literal["auto", "confirm"] = (
            "confirm" if book.approval_state == "awaiting_scan" else "auto"
        )
        return _book_attach(book, tier)

    # 2. Fuzzy ref path: run_intake re-tries QR + exact (already ruled out above)
    #    then the OCR-confusion fuzzy matcher. A returned_form here is therefore a
    #    FUZZY ref hit → CONFIRM ("we think this is GS-0333").
    result = run_intake(ocr_text=ocr_text, db=db, employees=employees, qr_refs=qr_refs)
    if result.mode == "returned_form" and result.book is not None:
        return _book_attach(result.book, "confirm")

    # 3. External document → classify + employee match.
    pr = result.pipeline
    if pr is None:
        return TriageDecision(
            tier="manual", proposed_route="unknown",
            document_type="unknown", fields={}, confidence=0.0,
        )
    fields = {f.key: f.value for f in pr.extraction.fields}
    doctype = pr.extraction.doc_type.value
    score = pr.match_score
    emp_id = pr.matched_employee_id
    conf = pr.extraction.doc_type_confidence

    if doctype == "unknown" or emp_id is None:
        return TriageDecision(
            tier="manual", proposed_route="unknown",
            document_type=doctype, fields=fields, confidence=conf,
        )

    if doctype == "sick_leave":
        # Filing a sick-leave means a leave record gets created → always confirm.
        return TriageDecision(
            tier="confirm", proposed_route="leave",
            proposed_employee_id=emp_id, match_score=score,
            document_type=doctype, fields=fields, confidence=conf,
        )

    if doctype in _EMPLOYEE_DOCTYPES:
        exact = score >= 1.0 and doctype in _AUTO_EMPLOYEE_DOCTYPES
        return TriageDecision(
            tier="auto" if exact else "confirm",
            proposed_route="employee_doc",
            proposed_employee_id=emp_id, match_score=score,
            document_type=doctype, fields=fields, confidence=conf,
        )

    return TriageDecision(
        tier="manual", proposed_route="unknown",
        document_type=doctype, fields=fields, confidence=conf,
    )


__all__ = ["TriageDecision", "route"]
