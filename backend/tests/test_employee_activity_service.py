from __future__ import annotations

from datetime import date, datetime, timedelta

from sqlalchemy.orm import Session

from app.db.models import (
    Book,
    BookCategory,
    Document,
    Employee,
    Leave,
    LedgerEntry,
    Violation,
)
from app.services import employee_activity_service

BASE = datetime(2026, 8, 10, 9, 0)


def _employee(db: Session, employee_id: str = "G100", name_en: str = "ALPHA EMPLOYEE") -> Employee:
    employee = Employee(id=employee_id, name_en=name_en, name_ar="موظف ألف", status="Active")
    db.add(employee)
    return employee


def _category_and_book(
    db: Session, *, book_id: int, ref_number: str, employee_id: str = "G100"
) -> Book:
    category = BookCategory(id=f"HR{book_id}", name_en="HR", prefix="HR")
    book = Book(
        id=book_id,
        category_id=category.id,
        ref_number=ref_number,
        employee_id=employee_id,
        created_at=BASE,
        deleted_at=None,
    )
    db.add_all([category, book])
    return book


def _ledger(
    *,
    entry_id: int,
    created_at: datetime,
    employee_id: str | None = "G100",
    channel: str = "letter",
    owner_user_id: int | None = None,
    tags: list[str] | None = None,
    deleted_at: datetime | None = None,
) -> LedgerEntry:
    return LedgerEntry(
        id=entry_id,
        entry_date=created_at.date(),
        direction="incoming",
        channel=channel,
        counterparty="Test authority",
        subject="Test correspondence",
        notes_html=None,
        attachment_paths=[],
        tags=tags or [],
        inline_images={},
        draft_meta=None,
        related_employee_id=employee_id,
        created_at=created_at,
        updated_at=None,
        created_by=None,
        deleted_at=deleted_at,
        read_at=None,
        owner_user_id=owner_user_id,
        to_recipients=[],
        cc_recipients=[],
        bcc_recipients=[],
        message_id=None,
        in_reply_to=None,
        email_references=None,
        source_kind=None,
        category_id=None,
    )


def test_activity_merges_all_sources_by_creation_time(db_session: Session):
    emp = _employee(db_session)
    category = BookCategory(id="HR", name_en="HR", prefix="HR")
    book = Book(id=71, category_id="HR", ref_number="HR-0071", employee_id="G100", created_at=BASE)
    document = Document(
        id=11,
        employee_id="G100",
        template_id="Employment Certificate",
        ref_number="HR-0071",
        docx_path="output/fake.docx",
        submission_id="00000000-0000-0000-0000-000000000011",
        created_at=BASE + timedelta(minutes=4),
    )
    leave = Leave(
        id=22,
        employee_id="G100",
        leave_type="Annual",
        start_date=date(2026, 8, 11),
        end_date=date(2026, 8, 12),
        days=2,
        status="Approved",
        notes=None,
        request_date=None,
        doc_path=None,
        certificate_path=None,
        return_doc_path=None,
        return_date=None,
        created_at=BASE + timedelta(minutes=3),
        updated_at=None,
        deleted_at=None,
    )
    violation = Violation(
        id=33,
        employee_id="G100",
        violation_type="Late arrival",
        date=date(2026, 8, 10),
        description="Recorded for test",
        action_taken=None,
        deduction_days=0,
        status="Open",
        doc_path=None,
        created_at=BASE + timedelta(minutes=2),
    )
    ledger = _ledger(entry_id=44, created_at=BASE + timedelta(minutes=1))
    db_session.add_all([emp, category, book, document, leave, violation, ledger])
    db_session.commit()

    result = employee_activity_service.list_employee_activity(
        db_session, owner_user_id=7, limit=25, offset=0
    )

    assert [item.kind for item in result.items] == [
        "document", "leave", "violation", "ledger"
    ]
    assert result.total == 4
    assert result.items[0].source_id == 11
    assert result.items[0].target_id == 71
    assert result.items[1].target_id == 22
    assert result.items[1].days == 2
    assert result.items[2].detail == "Recorded for test"
    assert result.items[3].direction == "incoming"
    assert all(item.employee_id == "G100" for item in result.items)
    assert all(item.employee_name_en == "ALPHA EMPLOYEE" for item in result.items)
    assert [item.target_id for item in result.items] == [71, 22, 33, 44]
    assert [item.title for item in result.items] == [
        "Employment Certificate", "Annual", "Late arrival", "Test correspondence"
    ]
    assert [item.reference for item in result.items] == ["HR-0071", "#22", "#33", "#44"]


def test_equal_timestamps_use_kind_then_source_id_tiebreak(db_session: Session):
    _employee(db_session)
    _category_and_book(db_session, book_id=71, ref_number="HR-0071")
    _category_and_book(db_session, book_id=72, ref_number="HR-0072")
    documents = [
        Document(
            id=11,
            employee_id="G100",
            template_id="Certificate 11",
            ref_number="HR-0071",
            docx_path="output/11.docx",
            submission_id="00000000-0000-0000-0000-000000000011",
            created_at=BASE,
        ),
        Document(
            id=12,
            employee_id="G100",
            template_id="Certificate 12",
            ref_number="HR-0072",
            docx_path="output/12.docx",
            submission_id="00000000-0000-0000-0000-000000000012",
            created_at=BASE,
        ),
    ]
    leave = Leave(
        id=22, employee_id="G100", leave_type="Annual", start_date=date(2026, 8, 11),
        end_date=date(2026, 8, 12), days=2, status="Approved", created_at=BASE,
    )
    violation = Violation(
        id=33, employee_id="G100", violation_type="Late", date=BASE.date(),
        description="Late", status="Open", created_at=BASE,
    )
    db_session.add_all([*documents, leave, violation, _ledger(entry_id=44, created_at=BASE)])
    db_session.commit()

    result = employee_activity_service.list_employee_activity(db_session, owner_user_id=7)

    assert [(x.kind, x.source_id) for x in result.items] == [
        ("document", 12), ("document", 11), ("leave", 22), ("ledger", 44), ("violation", 33)
    ]


def test_employee_and_kind_filters_apply_to_rows_and_total(db_session: Session):
    _employee(db_session)
    _employee(db_session, "G200", "BETA EMPLOYEE")
    _category_and_book(db_session, book_id=71, ref_number="HR-0071")
    _category_and_book(db_session, book_id=72, ref_number="HR-0072", employee_id="G200")
    db_session.add_all([
        Document(
            id=11, employee_id="G100", template_id="Doc 11", ref_number="HR-0071",
            docx_path="output/11.docx", submission_id="00000000-0000-0000-0000-000000000011",
            created_at=BASE,
        ),
        Document(
            id=12, employee_id="G200", template_id="Doc 12", ref_number="HR-0072",
            docx_path="output/12.docx", submission_id="00000000-0000-0000-0000-000000000012",
            created_at=BASE + timedelta(minutes=1),
        ),
        Violation(
            id=33, employee_id="G100", violation_type="Late", date=BASE.date(),
            description="Late", status="Open", created_at=BASE + timedelta(minutes=2),
        ),
        _ledger(entry_id=44, created_at=BASE + timedelta(minutes=3), employee_id="G200"),
    ])
    db_session.commit()

    by_employee = employee_activity_service.list_employee_activity(
        db_session, owner_user_id=7, employee_id="G200"
    )
    documents = employee_activity_service.list_employee_activity(
        db_session, owner_user_id=7, kind="document"
    )

    assert {item.employee_id for item in by_employee.items} == {"G200"}
    assert by_employee.total == len(by_employee.items)
    assert documents.items
    assert {item.kind for item in documents.items} == {"document"}
    assert documents.total == len(documents.items)


def test_global_offset_is_correct_when_one_source_dominates(db_session: Session):
    _employee(db_session)
    for index, minute in enumerate(range(10, 5, -1), start=1):
        ref = f"HR-{index:04d}"
        _category_and_book(db_session, book_id=70 + index, ref_number=ref)
        db_session.add(Document(
            id=100 + index, employee_id="G100", template_id=f"Doc {index}", ref_number=ref,
            docx_path=f"output/{index}.docx",
            submission_id=f"00000000-0000-0000-0000-{index:012d}",
            created_at=BASE + timedelta(minutes=minute),
        ))
    db_session.add_all([
        Leave(
            id=200, employee_id="G100", leave_type="Annual", start_date=date(2026, 8, 11),
            end_date=date(2026, 8, 12), days=2, status="Approved", created_at=BASE + timedelta(minutes=5),
        ),
        Violation(
            id=300, employee_id="G100", violation_type="Late", date=BASE.date(),
            description="Late", status="Open", created_at=BASE + timedelta(minutes=4),
        ),
        _ledger(entry_id=400, created_at=BASE + timedelta(minutes=3)),
    ])
    db_session.commit()

    pages = [employee_activity_service.list_employee_activity(
        db_session, owner_user_id=7, limit=2, offset=offset
    ) for offset in (0, 2, 4)]
    full = employee_activity_service.list_employee_activity(db_session, owner_user_id=7, limit=100)
    page_keys = [(item.kind, item.source_id) for page in pages for item in page.items]
    full_keys = [(item.kind, item.source_id) for item in full.items[:6]]

    assert len(set(page_keys)) == len(page_keys)
    assert page_keys == full_keys


def test_excludes_deleted_drafts_orphans_and_unrelated_rows(db_session: Session):
    _employee(db_session)
    _category_and_book(db_session, book_id=71, ref_number="HR-0071")
    db_session.add_all([
        Leave(
            id=80, employee_id="G100", leave_type="Deleted", start_date=date(2026, 8, 11),
            end_date=date(2026, 8, 12), days=2, status="Approved", created_at=BASE,
            deleted_at=BASE,
        ),
        Document(
            id=81, employee_id="G100", template_id="Draft", ref_number="DRAFT",
            docx_path="output/draft.docx", submission_id="00000000-0000-0000-0000-000000000081",
            created_at=BASE,
        ),
        Document(
            id=82, employee_id="G100", template_id="Orphan", ref_number="HR-9999",
            docx_path="output/orphan.docx", submission_id="00000000-0000-0000-0000-000000000082",
            created_at=BASE,
        ),
        _ledger(entry_id=83, created_at=BASE, deleted_at=BASE),
        _ledger(entry_id=84, created_at=BASE, tags=["draft"]),
        _ledger(entry_id=85, created_at=BASE, employee_id=None),
    ])
    db_session.commit()

    result = employee_activity_service.list_employee_activity(db_session, owner_user_id=7)

    assert {(x.kind, x.source_id) for x in result.items}.isdisjoint({
        ("leave", 80), ("document", 81), ("document", 82),
        ("ledger", 83), ("ledger", 84), ("ledger", 85),
    })
    assert result.total == 0


def test_private_email_rows_and_total_are_owner_scoped(db_session: Session):
    _employee(db_session)
    db_session.add_all([
        _ledger(entry_id=90, created_at=BASE, channel="email", owner_user_id=7),
        _ledger(entry_id=91, created_at=BASE + timedelta(minutes=1), channel="email", owner_user_id=8),
        _ledger(entry_id=92, created_at=BASE + timedelta(minutes=2), channel="letter", owner_user_id=8),
    ])
    db_session.commit()

    result = employee_activity_service.list_employee_activity(db_session, owner_user_id=7)

    assert [x.source_id for x in result.items] == [92, 90]
    assert result.total == 2
