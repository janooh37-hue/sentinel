"""Intake orchestration — ref-first classification.

Given OCR text and the full employee list, tries to recognise the document as:

1. A **returned GSSG form**: OCR text contains a stamped ref (``Ref: 9-0042``)
   that matches a live Book row → ``mode="returned_form"``.
2. An **external document**: falls through to the Phase-A extraction pipeline
   (emirates ID, passport, bank IBAN, sick leave, …) → ``mode="external"``.

No DB rows are written — intake is a read-only classification pass.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.errors import NotFoundError
from app.core.extraction.form_ref import candidate_refs, canonical_ref, stamped_tokens
from app.db.models import Book
from app.services import book_service
from app.services.extraction_service import PipelineResult, _Emp, run_pipeline


@dataclass(frozen=True)
class IntakeResult:
    mode: Literal["returned_form", "external"]
    book: Book | None = None
    pipeline: PipelineResult | None = None


def run_intake(
    *,
    ocr_text: str,
    db: Session,
    employees: list[_Emp],
    qr_refs: list[str] | None = None,
) -> IntakeResult:
    """Classify *ocr_text* using QR-first, then ref-first ordering.

    QR refs (if provided) are tried first before OCR-extracted refs.

    For each QR ref in *qr_refs* (if provided):
    * look up the ref in the DB via ``get_book_by_ref``;
    * on a hit (live book, not soft-deleted) → return Mode 1 immediately;
    * on a miss (``NotFoundError``) → continue to the next QR ref.

    Then, for each candidate ref extracted from *ocr_text* (stamped hits first):
    * look up the ref in the DB via ``get_book_by_ref``;
    * on a hit (live book, not soft-deleted) → return Mode 1 immediately;
    * on a miss (``NotFoundError``) → continue to the next candidate.

    If no ref matches, fall through to the Phase-A extraction pipeline (Mode 2).
    """
    # QR-first: a decoded GSSG QR ref is machine-read and exact — try it ahead of
    # the OCR/fuzzy chain so a scan-back never relies on re-reading a stamped ref
    # that Tesseract mangles ("GS-0333" -> "65-3").
    for ref in qr_refs or []:
        try:
            book = book_service.get_book_by_ref(db, ref)
        except NotFoundError:
            continue
        return IntakeResult(mode="returned_form", book=book)

    for ref in candidate_refs(ocr_text):
        try:
            book = book_service.get_book_by_ref(db, ref)
        except NotFoundError:
            continue
        # get_book_by_ref already excludes soft-deleted rows (deleted_at IS NULL
        # in its query), so no additional check needed.
        return IntakeResult(mode="returned_form", book=book)

    # Fuzzy fallback: OCR often substitutes lookalike digits into the alpha
    # prefix ("SC-0315" → "50-0315"). Compare confusion-canonical forms of the
    # raw stamped tokens against all live refs, in two tiers per token:
    #   1. exact canonical equality (a perfect lookalike read);
    #   2. unique match within edit distance ≤ 1 (one extra OCR slip).
    # Ambiguity within a tier, or heavy mangling, falls through to external.
    tokens = stamped_tokens(ocr_text)
    if tokens:
        live_refs = [
            r for (r,) in db.execute(select(Book.ref_number).where(Book.deleted_at.is_(None))).all()
        ]
        canon_to_refs: dict[str, list[str]] = {}
        for live_ref in live_refs:
            canon_to_refs.setdefault(canonical_ref(live_ref), []).append(live_ref)
        for token in tokens:
            token_canon = canonical_ref(token)
            # Tier 1: exact canonical equality.
            exact = canon_to_refs.get(token_canon, [])
            if len(exact) == 1:
                matched = exact[0]
            elif len(exact) > 1:
                continue  # two live refs collapse to this canon → ambiguous
            else:
                # Tier 2: unique distance-1 match, restricted to PREFIX-segment
                # edits with an EXACTLY-equal digit segment.
                # Split each canonical form at the LAST '-'; tokens without a
                # '-' produce no tier-2 matches (can't split → skip).
                if "-" not in token_canon:
                    continue
                tok_prefix, tok_digit = token_canon.rsplit("-", 1)
                near: set[str] = set()
                for canon, refs in canon_to_refs.items():
                    if "-" not in canon:
                        continue
                    ref_prefix, ref_digit = canon.rsplit("-", 1)
                    if tok_digit == ref_digit and _edit_distance_le1(tok_prefix, ref_prefix):
                        near.update(refs)
                if len(near) != 1:
                    continue
                matched = next(iter(near))
            try:
                book = book_service.get_book_by_ref(db, matched)
            except NotFoundError:
                continue
            return IntakeResult(mode="returned_form", book=book)

    pipeline = run_pipeline(ocr_text=ocr_text, employees=employees)
    return IntakeResult(mode="external", pipeline=pipeline)


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


__all__ = ["IntakeResult", "run_intake"]
