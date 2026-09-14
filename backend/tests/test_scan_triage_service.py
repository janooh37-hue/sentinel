from __future__ import annotations

from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.extraction import ocr
from app.core.extraction.form_ref import candidate_refs, stamped_tokens
from app.core.extraction.types import DocType, ExtractedField, Extraction
from app.db.models import Book, BookCategory, Employee
from app.services.document_reader import DocumentRead
from app.services.scan_triage_service import (
    BookMatchEvidence,
    EmployeeCandidateEvidence,
    EmployeeMatchEvidence,
    ExternalClassification,
    InboxDecision,
    ReferenceCandidate,
    ReturnedFormClassification,
    ReturnedFormMatch,
    classify,
    classify_text,
    project_inbox,
    project_intake,
)

FIXTURE_DIR = Path(__file__).parent / "fixtures" / "scan_triage"


def test_exact_stamped_reference_produces_both_compatibility_projections(
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    book = Book(
        category=BookCategory(
            id="GS",
            name_en="General Records",
            name_ar="السجلات العامة",
            prefix="GS",
        ),
        ref_number="GS-0042",
        approval_state="approved",
        subject="Synthetic returned form",
        employee_name_snapshot="Synthetic Employee",
    )
    db_session.add(book)
    db_session.commit()
    db_session.refresh(book)
    writes_before = db_session.execute(text("SELECT total_changes()")).scalar_one()

    def reject_ocr(*_args, **_kwargs):
        raise AssertionError("searchable PDF unexpectedly invoked Tesseract")

    monkeypatch.setattr(ocr, "extract_text", reject_ocr)
    monkeypatch.setattr(ocr, "_resolve_tesseract_cmd", reject_ocr)

    result = classify(
        (FIXTURE_DIR / "returned-form-text.pdf").read_bytes(),
        db=db_session,
        employees=[],
    )

    book_evidence = BookMatchEvidence(
        book_id=book.id,
        ref_number="GS-0042",
        approval_state="approved",
        category="General Records",
        subject="Synthetic returned form",
        employee_id=None,
        employee_name="Synthetic Employee",
    )
    candidate = ReferenceCandidate(
        observed="GS-0042",
        normalized="GS-0042",
        canonical="65-0042",
        source="ocr_stamped",
        match_kind="exact",
        live_matches=(book_evidence,),
    )
    assert result == ReturnedFormClassification(
        read=result.read,
        match=ReturnedFormMatch(candidate=candidate, book=book_evidence, confidence=1.0),
        reference_candidates=(candidate,),
    )
    assert result.read.text == "Synthetic returned form\nRef: GS-0042\n"

    assert project_intake(result).model_dump() == {
        "mode": "returned_form",
        "book_id": book.id,
        "ref_number": "GS-0042",
        "approval_state": "approved",
        "category": "General Records",
        "subject": "Synthetic returned form",
        "employee_id": None,
        "employee_name": "Synthetic Employee",
    }
    assert project_inbox(result) == InboxDecision(
        classification=result,
        tier="auto",
        proposed_route="book_attach",
        proposed_book_id=book.id,
        proposed_ref="GS-0042",
        document_type="returned_form",
        confidence=1.0,
    )
    db_session.flush()
    assert db_session.execute(text("SELECT total_changes()")).scalar_one() == writes_before


def test_external_multisignal_preserves_evidence_in_both_projections(
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    employee = Employee(
        id="G-FIX-1",
        name_en="LAYLA HASSAN",
        name_ar="ليلى حسن",
        uae_id_no="784-1990-1234567-1",
    )
    db_session.add(employee)
    db_session.commit()
    writes_before = db_session.execute(text("SELECT total_changes()")).scalar_one()

    def reject_ocr(*_args, **_kwargs):
        raise AssertionError("searchable PDF unexpectedly invoked Tesseract")

    monkeypatch.setattr(ocr, "extract_text", reject_ocr)
    monkeypatch.setattr(ocr, "_resolve_tesseract_cmd", reject_ocr)

    result = classify(
        (FIXTURE_DIR / "external-multi-signal.pdf").read_bytes(),
        db=db_session,
        employees=[employee],
    )

    extraction = Extraction(
        doc_type=DocType.EMIRATES_ID,
        doc_type_confidence=0.9,
        fields=[
            ExtractedField("uae_id_no", "784-1990-1234567-1", 0.97, "784-1990-1234567-1"),
            ExtractedField("name_en", "LAYLA HASSAN", 0.6, "Name: LAYLA HASSAN"),
            ExtractedField("name_ar", "ليلى حسن", 0.6, "الاسم: ليلى حسن"),
            ExtractedField("expiry", "2030-12-31", 0.9, "Expiry Date: 31/12/2030"),
        ],
        alternatives=[DocType.BANK_IBAN],
        raw_text=(
            "Resident Identity Card\n"
            "784-1990-1234567-1\n"
            "Name: LAYLA HASSAN\n"
            "الاسم: ليلى حسن\n"
            "IBAN AE070331234567890123456\n"
            "Expiry Date: 31/12/2030\n"
        ),
        language="ar+en",
    )
    employee_match = EmployeeMatchEvidence(
        employee_id="G-FIX-1",
        name_en="LAYLA HASSAN",
        name_ar="ليلى حسن",
        score=1.0,
        kind="exact_uae_id",
    )
    employee_candidate = EmployeeCandidateEvidence(
        employee_id="G-FIX-1",
        name_en="LAYLA HASSAN",
        name_ar="ليلى حسن",
        score=1.0,
    )
    unmatched_reference = ReferenceCandidate(
        observed="784-1990",
        normalized="784-1990",
        canonical="784-1990",
        source="ocr_bare",
    )
    assert result == ExternalClassification(
        read=result.read,
        extraction=extraction,
        employee_match=employee_match,
        best_employee_score=1.0,
        employee_candidates=(employee_candidate,),
        reference_candidates=(unmatched_reference,),
    )
    assert result.read.text == extraction.raw_text

    assert project_intake(result).model_dump() == {
        "mode": "external",
        "document_type": "emirates_id",
        "document_type_confidence": 0.9,
        "alternatives": ["bank_iban"],
        "extraction": [
            {
                "key": "uae_id_no",
                "value": "784-1990-1234567-1",
                "confidence": 0.97,
                "source_snippet": "784-1990-1234567-1",
            },
            {
                "key": "name_en",
                "value": "LAYLA HASSAN",
                "confidence": 0.6,
                "source_snippet": "Name: LAYLA HASSAN",
            },
            {
                "key": "name_ar",
                "value": "ليلى حسن",
                "confidence": 0.6,
                "source_snippet": "الاسم: ليلى حسن",
            },
            {
                "key": "expiry",
                "value": "2030-12-31",
                "confidence": 0.9,
                "source_snippet": "Expiry Date: 31/12/2030",
            },
        ],
        "matched_employee_id": "G-FIX-1",
        "match_score": 1.0,
        "matched_employee_name_en": "LAYLA HASSAN",
        "matched_employee_name_ar": "ليلى حسن",
        "route_kind": "employee",
        "route_form_slug": None,
    }
    assert project_inbox(result) == InboxDecision(
        classification=result,
        tier="auto",
        proposed_route="employee_doc",
        proposed_employee_id="G-FIX-1",
        match_score=1.0,
        document_type="emirates_id",
        fields={
            "uae_id_no": "784-1990-1234567-1",
            "name_en": "LAYLA HASSAN",
            "name_ar": "ليلى حسن",
            "expiry": "2030-12-31",
        },
        confidence=0.9,
    )
    db_session.flush()
    assert db_session.execute(text("SELECT total_changes()")).scalar_one() == writes_before


def test_reference_candidate_preserves_observed_case(
    db_session: Session,
) -> None:
    book = Book(
        category=BookCategory(id="GS", name_en="General Records", prefix="GS"),
        ref_number="GS-0042",
    )
    db_session.add(book)
    db_session.commit()

    result = classify_text(
        DocumentRead(text="Ref: gs-0042", text_source="ocr"),
        db=db_session,
        employees=[],
    )

    assert isinstance(result, ReturnedFormClassification)
    assert result.match.candidate.observed == "gs-0042"
    assert result.match.candidate.normalized == "GS-0042"
    assert result.match.candidate.canonical == "65-0042"
    assert result.match.candidate.source == "ocr_stamped"
    assert candidate_refs("Ref: gs-0042") == ["GS-0042"]
    assert stamped_tokens("Ref: gs-0042") == ["GS-0042"]


def test_name_match_without_employee_identifiers_is_not_an_exact_id_match(
    db_session: Session,
) -> None:
    employee = Employee(id="NAME-ONLY", name_en="LAYLA HASSAN", name_ar=None)
    db_session.add(employee)
    db_session.flush()
    result = classify_text(
        DocumentRead(
            text="Resident Identity Card\n784-1990-1234567-1\nName: LAYLA HASSAN\n",
            text_source="ocr",
        ),
        db=db_session,
        employees=[employee],
    )
    assert isinstance(result, ExternalClassification)
    assert result.employee_match == EmployeeMatchEvidence(
        employee_id="NAME-ONLY",
        name_en="LAYLA HASSAN",
        name_ar=None,
        score=1.0,
        kind="fuzzy_name",
    )
    assert project_inbox(result).tier == "confirm"


def test_two_exact_stamped_books_are_ambiguous_and_require_manual_filing(
    db_session: Session,
) -> None:
    from app.services.scan_triage_service import ReferenceAmbiguity

    category = BookCategory(id="GS", name_en="Records", prefix="GS")
    first = Book(category=category, ref_number="GS-0042", approval_state="approved")
    second = Book(category=category, ref_number="GS-0043", approval_state="approved")
    db_session.add_all([first, second])
    db_session.flush()
    result = classify_text(
        DocumentRead(text="Ref: GS-0042\nRef: GS-0043\n", text_source="ocr"),
        db=db_session,
        employees=[],
    )
    assert isinstance(result, ExternalClassification)
    assert result.ambiguities == (
        ReferenceAmbiguity(
            source="ocr_stamped",
            match_kind="exact",
            observed=("GS-0042", "GS-0043"),
            book_ids=(first.id, second.id),
        ),
    )
    decision = project_inbox(result)
    assert decision.tier == "manual"
    assert decision.proposed_route == "unknown"
    assert decision.proposed_book_id is None


def test_duplicate_exact_employee_identifier_is_ambiguous_and_manual(
    db_session: Session,
) -> None:
    from app.services.scan_triage_service import EmployeeAmbiguity

    first = Employee(id="DUP-B", name_en="First Person", uae_id_no="784-1990-1234567-1")
    second = Employee(id="DUP-A", name_en="Second Person", uae_id_no="784-1990-1234567-1")
    db_session.add_all([first, second])
    db_session.flush()
    result = classify_text(
        DocumentRead(text="Resident Identity Card\n784-1990-1234567-1\n", text_source="ocr"),
        db=db_session,
        employees=[first, second],
    )
    assert isinstance(result, ExternalClassification)
    assert result.employee_match is None
    assert result.ambiguities == (
        EmployeeAmbiguity(match_kind="exact_uae_id", employee_ids=("DUP-A", "DUP-B")),
    )
    assert result.best_employee_score == 1.0
    assert project_intake(result).matched_employee_id is None
    assert project_inbox(result).tier == "manual"
    assert project_inbox(result).proposed_employee_id is None


def test_equal_top_name_scores_are_ambiguous_and_require_manual_filing(
    db_session: Session,
) -> None:
    from app.services.scan_triage_service import EmployeeAmbiguity

    first = Employee(id="TIE-B", name_en="LAYLA HASSAN")
    second = Employee(id="TIE-A", name_en="LAYLA HASSAN")
    db_session.add_all([first, second])
    db_session.flush()
    result = classify_text(
        DocumentRead(
            text="Resident Identity Card\n784-1990-1234567-1\nName: LAYLA HASSAN\n",
            text_source="ocr",
        ),
        db=db_session,
        employees=[first, second],
    )
    assert isinstance(result, ExternalClassification)
    assert result.employee_match is None
    assert result.ambiguities == (
        EmployeeAmbiguity(match_kind="fuzzy_name", employee_ids=("TIE-A", "TIE-B")),
    )
    assert result.best_employee_score == 1.0
    assert [
        (candidate.employee_id, candidate.score) for candidate in result.employee_candidates
    ] == [
        ("TIE-B", 1.0),
        ("TIE-A", 1.0),
    ]
    assert project_inbox(result).tier == "manual"


def test_canonical_reference_requires_confirmation(db_session: Session) -> None:
    book = Book(
        category=BookCategory(id="SC", name_en="Records", prefix="SC"),
        ref_number="SC-0315",
        approval_state="approved",
    )
    db_session.add(book)
    db_session.flush()
    result = classify_text(
        DocumentRead(text="Ref: 50-0315", text_source="ocr"),
        db=db_session,
        employees=[],
    )
    assert isinstance(result, ReturnedFormClassification)
    assert result.match.book.book_id == book.id
    assert result.match.candidate.observed == "50-0315"
    assert result.match.candidate.match_kind == "canonical"
    assert result.match.confidence == 0.7
    assert project_inbox(result).tier == "confirm"


def test_unmatched_external_keeps_legacy_zero_inbox_score(db_session: Session) -> None:
    employee = Employee(id="NEAR-MISS", name_en="LAYLA AHMED")
    db_session.add(employee)
    db_session.flush()
    result = classify_text(
        DocumentRead(
            text="Resident Identity Card\n784-1990-1234567-1\nName: LAYLA HASSAN\n",
            text_source="ocr",
        ),
        db=db_session,
        employees=[employee],
    )
    assert isinstance(result, ExternalClassification)
    assert result.employee_match is None
    assert result.best_employee_score == pytest.approx(0.6086956521739131)
    assert project_intake(result).match_score == pytest.approx(0.6086956521739131)
    decision = project_inbox(result)
    assert decision.tier == "manual"
    assert decision.match_score == 0.0
    assert decision.candidates == (
        EmployeeCandidateEvidence(
            employee_id="NEAR-MISS", name_en="LAYLA AHMED", name_ar=None, score=0.609
        ),
    )


def test_loose_stamped_ocr_token_is_preserved_for_canonical_matching(db_session: Session) -> None:
    book = Book(
        category=BookCategory(id="SC", name_en="Records", prefix="SC"),
        ref_number="SC-0315",
        approval_state="approved",
    )
    db_session.add(book)
    db_session.flush()
    result = classify_text(
        DocumentRead(text="Ref: 50-@315", text_source="ocr"), db=db_session, employees=[]
    )
    assert isinstance(result, ReturnedFormClassification)
    assert result.match.book.book_id == book.id
    assert result.match.candidate.observed == "50-@315"
    assert result.match.candidate.normalized == "50-@315"
    assert result.match.candidate.canonical == "50-0315"
    assert result.match.candidate.match_kind == "canonical"
    assert project_inbox(result).tier == "confirm"


def test_prefix_edit_requires_confirmation_without_changing_numeric_suffix(
    db_session: Session,
) -> None:
    book = Book(
        category=BookCategory(id="SC", name_en="Records", prefix="SC"),
        ref_number="SC-0315",
        approval_state="approved",
    )
    db_session.add(book)
    db_session.flush()
    result = classify_text(
        DocumentRead(text="Ref: SX-0315", text_source="ocr"), db=db_session, employees=[]
    )
    assert isinstance(result, ReturnedFormClassification)
    assert result.match.book.book_id == book.id
    assert result.match.candidate.match_kind == "edit_distance_one"
    assert result.match.confidence == 0.7
    assert project_inbox(result).tier == "confirm"


@pytest.mark.parametrize("observed", ["Ref: SX-0316", "Ref: SC-031", "الرقم: 50-0315"])
def test_fuzzy_reference_does_not_relax_numeric_suffix_or_arabic_anchor(
    db_session: Session, observed: str
) -> None:
    book = Book(
        category=BookCategory(id="SC", name_en="Records", prefix="SC"),
        ref_number="SC-0315",
        approval_state="approved",
    )
    db_session.add(book)
    db_session.flush()
    result = classify_text(
        DocumentRead(text=observed, text_source="ocr"), db=db_session, employees=[]
    )
    assert isinstance(result, ExternalClassification)
    assert project_inbox(result).tier == "manual"
    assert project_inbox(result).proposed_book_id is None


def test_unique_qr_precedes_conflicting_ocr_and_keeps_reference_evidence(
    db_session: Session,
) -> None:
    category = BookCategory(id="GS", name_en="Records", prefix="GS")
    qr_book = Book(category=category, ref_number="GS-0042", approval_state="approved")
    ocr_book = Book(category=category, ref_number="GS-0043", approval_state="approved")
    db_session.add_all([qr_book, ocr_book])
    db_session.flush()
    result = classify_text(
        DocumentRead("Ref: GS-0043", "ocr", qr_refs=("GS-0042",)), db=db_session, employees=[]
    )
    assert isinstance(result, ReturnedFormClassification)
    assert result.match.book.book_id == qr_book.id
    assert result.match.candidate.source == "qr"
    assert [(item.source, item.normalized) for item in result.reference_candidates] == [
        ("qr", "GS-0042"),
        ("ocr_stamped", "GS-0043"),
    ]
    assert result.ambiguities == ()
    assert project_inbox(result).tier == "auto"


@pytest.mark.parametrize("state,deleted", [("voided", False), ("approved", True)])
def test_reference_liveness_preserves_voided_and_excludes_soft_deleted(
    db_session: Session, state: str, deleted: bool
) -> None:
    from datetime import UTC, datetime

    book = Book(
        category=BookCategory(id="GS", name_en="Records", prefix="GS"),
        ref_number="GS-0042",
        approval_state=state,
        deleted_at=datetime.now(UTC) if deleted else None,
    )
    db_session.add(book)
    db_session.flush()
    result = classify_text(DocumentRead("Ref: GS-0042", "ocr"), db=db_session, employees=[])
    if deleted:
        assert isinstance(result, ExternalClassification)
        assert result.reference_candidates[0].live_matches == ()
        assert project_inbox(result).tier == "manual"
    else:
        assert isinstance(result, ReturnedFormClassification)
        assert result.match.book.approval_state == "voided"
        assert project_inbox(result).tier == "auto"


@pytest.mark.parametrize(
    "text,qr_refs,refs,kind,source",
    [
        ("", ("GS-0042", "GS-0043"), ("GS-0042", "GS-0043"), "exact", "qr"),
        ("Ref: 50-0315", (), ("SC-0315", "SO-0315"), "canonical", "ocr_stamped"),
        ("Ref: SX-0315", (), ("SC-0315", "ST-0315"), "edit_distance_one", "ocr_stamped"),
    ],
)
def test_same_active_reference_tier_ambiguity_never_selects_a_record(
    db_session: Session,
    text: str,
    qr_refs: tuple[str, ...],
    refs: tuple[str, str],
    kind: str,
    source: str,
) -> None:
    from app.services.scan_triage_service import ReferenceAmbiguity

    category = BookCategory(id="GS", name_en="Records", prefix="GS")
    books = [Book(category=category, ref_number=ref, approval_state="approved") for ref in refs]
    db_session.add_all(books)
    db_session.flush()
    result = classify_text(DocumentRead(text, "ocr", qr_refs=qr_refs), db=db_session, employees=[])
    assert isinstance(result, ExternalClassification)
    assert len(result.ambiguities) == 1
    ambiguity = result.ambiguities[0]
    assert isinstance(ambiguity, ReferenceAmbiguity)
    assert (ambiguity.source, ambiguity.match_kind, ambiguity.book_ids) == (
        source,
        kind,
        (books[0].id, books[1].id),
    )
    assert project_inbox(result).tier == "manual"
    assert project_inbox(result).proposed_book_id is None


@pytest.mark.parametrize(
    "qr_refs,expected_mode", [((), "external"), (("GS-0042",), "returned_form")]
)
def test_classification_skips_full_reference_scan_without_fuzzy_work(
    db_session: Session, qr_refs: tuple[str, ...], expected_mode: str
) -> None:
    from sqlalchemy import event

    book = Book(
        category=BookCategory(id="GS", name_en="Records", prefix="GS"),
        ref_number="GS-0042",
        approval_state="approved",
    )
    db_session.add(book)
    db_session.flush()
    statements = []
    connection = db_session.connection()

    def capture(_connection, _cursor, statement, _parameters, _context, _executemany):
        statements.append(" ".join(statement.lower().split()))

    event.listen(connection, "before_cursor_execute", capture)
    try:
        result = classify_text(
            DocumentRead(
                "Ref: SX-0315" if qr_refs else "Synthetic external document", "ocr", qr_refs=qr_refs
            ),
            db=db_session,
            employees=[],
        )
    finally:
        event.remove(connection, "before_cursor_execute", capture)
    assert result.mode == expected_mode
    assert not any(
        "from books where books.deleted_at is null" in statement for statement in statements
    )
