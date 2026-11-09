from __future__ import annotations

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.errors import AppError
from app.core.classifications import CLASSIFICATIONS
from app.core.form_kind import OTHER_SERVICE_ID, SERVICE_IDS, resolve_service
from app.core.permissions import SERVICE_RECORDS_CAPABILITY_IDS
from app.core.record_categories import (
    LEGACY_CATEGORY_RECORD_CATEGORY,
    SERVICE_RECORD_CATEGORY,
    record_category,
    services_filing_into_legacy_category,
)
from app.db.models import Book, BookCategory, BookVersion, Document, User, UserPermission
from app.services import book_service
from app.services.document_service import record_category_for_template


def test_service_map_is_total_and_uses_only_record_classifications() -> None:
    assert set(SERVICE_RECORD_CATEGORY) == set(SERVICE_IDS)
    assert set(SERVICE_RECORD_CATEGORY.values()) <= {c.code for c in CLASSIFICATIONS}


@pytest.mark.parametrize("service_id", SERVICE_IDS)
def test_classification_always_overrides_the_service_and_legacy_category(service_id: str) -> None:
    assert (
        record_category(service_id=service_id, classification_code="4/1", category_id="INV")
        == "4/1"
    )
    assert (
        record_category(service_id=service_id, classification_code=None, category_id="INV")
        == SERVICE_RECORD_CATEGORY[service_id]
    )


@pytest.mark.parametrize("category_id, expected", LEGACY_CATEGORY_RECORD_CATEGORY.items())
def test_other_records_use_the_approved_legacy_fallback(category_id: str, expected: str) -> None:
    assert (
        record_category(
            service_id=OTHER_SERVICE_ID, classification_code=None, category_id=category_id
        )
        == expected
    )


@pytest.mark.parametrize("category_id", [None, "imported-unknown", ""])
def test_unmapped_other_records_are_miscellaneous(category_id: str | None) -> None:
    assert (
        record_category(
            service_id=OTHER_SERVICE_ID, classification_code=None, category_id=category_id
        )
        == "15/1"
    )


@pytest.mark.parametrize("classification", CLASSIFICATIONS)
def test_other_records_preserve_a_classification_category_id(classification) -> None:
    assert (
        record_category(
            service_id=OTHER_SERVICE_ID, classification_code=None, category_id=classification.code
        )
        == classification.code
    )


def test_legacy_service_filing_helper_reuses_document_generation_rules() -> None:
    for category_id in (*LEGACY_CATEGORY_RECORD_CATEGORY, "imported-unknown"):
        assert services_filing_into_legacy_category(category_id) == tuple(
            service_id
            for service_id in SERVICE_IDS
            if record_category_for_template(service_id) == category_id
        )


@pytest.fixture()
def categorized_records(db_session: Session) -> list[tuple[Book, str]]:
    # Named forms, including auto-tagged leaves/resignations, retain their old
    # persisted categories; only the permission category changes.
    cases = [
        (service_id, None, record_category_for_template(service_id), None, code)
        for service_id, code in SERVICE_RECORD_CATEGORY.items()
    ]
    cases += [
        ("General Book", None, "GS", "5/1", "5/1"),
        ("Security Permit", None, "GS", "5/1", "5/1"),
        ("Leave Application Form", None, "HR", "3/1", "3/1"),
        ("Leave Application Form", None, "HR", "4/1", "4/1"),
        ("Leave Application Form", None, "HR", "15/1", "15/1"),
        ("Resignation Letter", None, "HR", "12/1", "12/1"),
        ("Vehicle Mileage Log", None, "GS", "11/1", "11/1"),
        (None, "Leave Application Form - import", "HR", "4/1", "4/1"),
        (None, "Resignation Form - import", "HR", None, "12/1"),
        (None, None, "HR", None, "12/1"),
        (None, None, "1", None, "12/1"),
        (None, None, "imported-unknown", None, "15/1"),
        ("Unknown template", "Leave Application Form - ignored", "HR", None, "12/1"),
    ]
    cases += [
        (None, None, category_id, None, code)
        for category_id, code in LEGACY_CATEGORY_RECORD_CATEGORY.items()
    ]
    cases += [(None, None, c.code, None, c.code) for c in CLASSIFICATIONS]
    db_session.add_all(
        BookCategory(id=category_id, prefix=category_id)
        for category_id in {case[2] for case in cases}
    )
    db_session.flush()
    records = []
    for index, (template_id, subject, category_id, classification_code, expected) in enumerate(
        cases
    ):
        book = Book(
            category_id=category_id,
            ref_number=f"TEST-{index}",
            subject=subject,
            classification_code=classification_code,
        )
        db_session.add(book)
        db_session.flush()
        if template_id is not None:
            document = Document(
                template_id=template_id,
                ref_number=book.ref_number,
                submission_id=f"category-{index}",
            )
            db_session.add(document)
            db_session.flush()
            book.versions.append(
                BookVersion(version_no=1, template_id=template_id, document_id=document.id)
            )
        records.append((book, expected))
    db_session.commit()
    return records


def test_sql_predicate_agrees_with_python_for_every_category(
    db_session: Session, categorized_records: list[tuple[Book, str]]
) -> None:
    for book, expected in categorized_records:
        newest = book.versions[-1] if book.versions else None
        service_id = resolve_service(
            book.subject, newest.template_id if newest else None, versioned=newest is not None
        )
        assert (
            record_category(
                service_id=service_id,
                classification_code=book.classification_code,
                category_id=book.category_id,
            )
            == expected
        )
    code_groups = [set(), {"not-a-category"}, {"3/1", "4/1", "12/1"}]
    code_groups += [{c.code} for c in CLASSIFICATIONS]
    for codes in code_groups:
        actual = set(
            db_session.scalars(select(Book.id).where(book_service.record_category_in_clause(codes)))
        )
        assert actual == {book.id for book, expected in categorized_records if expected in codes}


@pytest.mark.parametrize("denied_code", ["3/1", "4/1", "7/1", "12/1", "15/1"])
def test_document_and_direct_gates_match_the_record_category(
    db_session: Session, categorized_records: list[tuple[Book, str]], denied_code: str
) -> None:
    user = User(email="categories@test.ae", password_hash="x", role="operator", status="active")
    db_session.add(user)
    db_session.flush()
    db_session.add_all(
        UserPermission(user_id=user.id, capability=capability, effect="grant")
        for capability in SERVICE_RECORDS_CAPABILITY_IDS
    )
    db_session.add(
        UserPermission(user_id=user.id, capability=f"books.category.{denied_code}", effect="deny")
    )
    db_session.commit()
    visible = set(
        db_session.scalars(
            select(Document.id).where(book_service.document_visibility_clause(db_session, user))
        )
    )
    expected = {
        version.document_id
        for book, code in categorized_records
        if code != denied_code
        for version in book.versions
    }
    assert visible == expected
    for book, code in categorized_records:
        if code == denied_code:
            with pytest.raises(AppError) as exc:
                book_service.assert_record_type_visible(db_session, user, book)
            assert exc.value.code == "RECORD_TYPE_FORBIDDEN"
        else:
            book_service.assert_record_type_visible(db_session, user, book)


def test_newest_service_decides_unclassified_category_even_in_document_subqueries(
    db_session: Session, categorized_records: list[tuple[Book, str]]
) -> None:
    book = next(
        book
        for book, _ in categorized_records
        if book.versions and book.versions[0].template_id == "Report"
    )
    book.versions.append(BookVersion(version_no=2, template_id="Salary Deduction Form"))
    db_session.commit()
    assert (
        db_session.scalar(
            select(Book.id).where(
                Book.id == book.id, book_service.record_category_in_clause({"7/1"})
            )
        )
        == book.id
    )
    assert (
        db_session.scalar(
            select(Book.id).where(
                Book.id == book.id, book_service.record_category_in_clause({"13/1"})
            )
        )
        is None
    )
    user = User(
        email="newest-category@test.ae", password_hash="x", role="operator", status="active"
    )
    db_session.add(user)
    db_session.flush()
    db_session.add(UserPermission(user_id=user.id, capability="books.category.7/1", effect="deny"))
    db_session.commit()
    original_document_id = book.versions[0].document_id
    assert (
        db_session.scalar(
            select(Document.id).where(
                Document.id == original_document_id,
                book_service.document_visibility_clause(db_session, user),
            )
        )
        is None
    )
