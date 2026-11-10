from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy.orm import Session

from app.db.models import (
    Book,
    BookCategory,
    BookVersion,
    Document,
    Employee,
    EmployeeFormerId,
    Leave,
    LedgerEntry,
    User,
    Violation,
)
from app.db.workforce_models import DutyAssignmentEvent
from app.services import employee_activity_service, employee_statement_service

BASE = datetime(2026, 8, 10, 9, 0)


@pytest.fixture(autouse=True)
def _activity_reader(db_session: Session) -> None:
    db_session.add(
        User(
            id=7,
            email="activity-reader@test.ae",
            password_hash="x",
            role="operator",
            status="active",
        )
    )
    db_session.commit()


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


def _link_document(db: Session, book_id: int, document_id: int) -> None:
    db.flush()
    db.add(
        BookVersion(
            book_id=book_id,
            version_no=1,
            document_id=document_id,
            template_id="Employment Certificate",
            status="approved",
        )
    )


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
    _link_document(db_session, book.id, document.id)
    db_session.commit()

    result = employee_activity_service.list_employee_activity(
        db_session, owner_user_id=7, limit=25, offset=0
    )

    assert [item.kind for item in result.items] == ["document", "leave", "violation", "ledger"]
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
        "Employment Certificate",
        "Annual",
        "Late arrival",
        "Test correspondence",
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
        id=22,
        employee_id="G100",
        leave_type="Annual",
        start_date=date(2026, 8, 11),
        end_date=date(2026, 8, 12),
        days=2,
        status="Approved",
        created_at=BASE,
    )
    violation = Violation(
        id=33,
        employee_id="G100",
        violation_type="Late",
        date=BASE.date(),
        description="Late",
        status="Open",
        created_at=BASE,
    )
    db_session.add_all([*documents, leave, violation, _ledger(entry_id=44, created_at=BASE)])
    _link_document(db_session, 71, 11)
    _link_document(db_session, 72, 12)
    db_session.commit()

    result = employee_activity_service.list_employee_activity(db_session, owner_user_id=7)

    assert [(x.kind, x.source_id) for x in result.items] == [
        ("document", 12),
        ("document", 11),
        ("leave", 22),
        ("ledger", 44),
        ("violation", 33),
    ]


def test_employee_and_kind_filters_apply_to_rows_and_total(db_session: Session):
    _employee(db_session)
    _employee(db_session, "G200", "BETA EMPLOYEE")
    _category_and_book(db_session, book_id=71, ref_number="HR-0071")
    _category_and_book(db_session, book_id=72, ref_number="HR-0072", employee_id="G200")
    db_session.add_all(
        [
            Document(
                id=11,
                employee_id="G100",
                template_id="Doc 11",
                ref_number="HR-0071",
                docx_path="output/11.docx",
                submission_id="00000000-0000-0000-0000-000000000011",
                created_at=BASE,
            ),
            Document(
                id=12,
                employee_id="G200",
                template_id="Doc 12",
                ref_number="HR-0072",
                docx_path="output/12.docx",
                submission_id="00000000-0000-0000-0000-000000000012",
                created_at=BASE + timedelta(minutes=1),
            ),
            Violation(
                id=33,
                employee_id="G100",
                violation_type="Late",
                date=BASE.date(),
                description="Late",
                status="Open",
                created_at=BASE + timedelta(minutes=2),
            ),
            _ledger(entry_id=44, created_at=BASE + timedelta(minutes=3), employee_id="G200"),
        ]
    )
    _link_document(db_session, 71, 11)
    _link_document(db_session, 72, 12)
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
        db_session.add(
            Document(
                id=100 + index,
                employee_id="G100",
                template_id=f"Doc {index}",
                ref_number=ref,
                docx_path=f"output/{index}.docx",
                submission_id=f"00000000-0000-0000-0000-{index:012d}",
                created_at=BASE + timedelta(minutes=minute),
            )
        )
        _link_document(db_session, 70 + index, 100 + index)
    db_session.add_all(
        [
            Leave(
                id=200,
                employee_id="G100",
                leave_type="Annual",
                start_date=date(2026, 8, 11),
                end_date=date(2026, 8, 12),
                days=2,
                status="Approved",
                created_at=BASE + timedelta(minutes=5),
            ),
            Violation(
                id=300,
                employee_id="G100",
                violation_type="Late",
                date=BASE.date(),
                description="Late",
                status="Open",
                created_at=BASE + timedelta(minutes=4),
            ),
            _ledger(entry_id=400, created_at=BASE + timedelta(minutes=3)),
        ]
    )
    db_session.commit()

    pages = [
        employee_activity_service.list_employee_activity(
            db_session, owner_user_id=7, limit=2, offset=offset
        )
        for offset in (0, 2, 4)
    ]
    full = employee_activity_service.list_employee_activity(db_session, owner_user_id=7, limit=100)
    page_keys = [(item.kind, item.source_id) for page in pages for item in page.items]
    full_keys = [(item.kind, item.source_id) for item in full.items[:6]]

    assert len(set(page_keys)) == len(page_keys)
    assert page_keys == full_keys


def test_excludes_deleted_drafts_orphans_and_unrelated_rows(db_session: Session):
    _employee(db_session)
    _category_and_book(db_session, book_id=71, ref_number="HR-0071")
    db_session.add_all(
        [
            Leave(
                id=80,
                employee_id="G100",
                leave_type="Deleted",
                start_date=date(2026, 8, 11),
                end_date=date(2026, 8, 12),
                days=2,
                status="Approved",
                created_at=BASE,
                deleted_at=BASE,
            ),
            Document(
                id=81,
                employee_id="G100",
                template_id="Draft",
                ref_number="DRAFT",
                docx_path="output/draft.docx",
                submission_id="00000000-0000-0000-0000-000000000081",
                created_at=BASE,
            ),
            Document(
                id=82,
                employee_id="G100",
                template_id="Orphan",
                ref_number="HR-9999",
                docx_path="output/orphan.docx",
                submission_id="00000000-0000-0000-0000-000000000082",
                created_at=BASE,
            ),
            _ledger(entry_id=83, created_at=BASE, deleted_at=BASE),
            _ledger(entry_id=84, created_at=BASE, tags=["draft"]),
            _ledger(entry_id=85, created_at=BASE, employee_id=None),
        ]
    )
    db_session.commit()

    result = employee_activity_service.list_employee_activity(db_session, owner_user_id=7)

    assert {(x.kind, x.source_id) for x in result.items}.isdisjoint(
        {
            ("leave", 80),
            ("document", 81),
            ("document", 82),
            ("ledger", 83),
            ("ledger", 84),
            ("ledger", 85),
        }
    )
    assert result.total == 0


def test_private_email_rows_and_total_are_owner_scoped(db_session: Session):
    _employee(db_session)
    db_session.add_all(
        [
            _ledger(entry_id=90, created_at=BASE, channel="email", owner_user_id=7),
            _ledger(
                entry_id=91,
                created_at=BASE + timedelta(minutes=1),
                channel="email",
                owner_user_id=8,
            ),
            _ledger(
                entry_id=92,
                created_at=BASE + timedelta(minutes=2),
                channel="letter",
                owner_user_id=8,
            ),
        ]
    )
    db_session.commit()

    result = employee_activity_service.list_employee_activity(db_session, owner_user_id=7)

    assert [x.source_id for x in result.items] == [92, 90]
    assert result.total == 2


def test_activity_merges_recorded_duty_location_events_and_paginates(
    db_session: Session, admin_user
):
    _employee(db_session, employee_id="G1001")
    _employee(db_session, employee_id="G1002")
    _category_and_book(db_session, book_id=72, ref_number="HR-0072", employee_id="G1001")
    db_session.add_all(
        [
            Document(
                id=72,
                employee_id="G1001",
                template_id="Employment Certificate",
                ref_number="HR-0072",
                docx_path="output/fake.docx",
                submission_id="00000000-0000-0000-0000-000000000072",
                created_at=datetime(2026, 8, 22, 8),
            ),
            DutyAssignmentEvent(
                employee_id="G1001",
                event_type="initial_placement",
                from_department=None,
                from_unit=None,
                from_post=None,
                to_department="Security",
                to_unit="Main Gate",
                to_post="Gate 1",
                effective_at=datetime(2026, 8, 1, 8, tzinfo=UTC).replace(tzinfo=None),
                actor_user_id=admin_user.id,
                reason="Initial placement",
            ),
            DutyAssignmentEvent(
                employee_id="G1001",
                event_type="transfer",
                from_department="Security",
                from_unit="Main Gate",
                from_post="Gate 1",
                to_department="Security",
                to_unit="Administration",
                to_post="Reception",
                effective_at=datetime(2026, 8, 20, 8, tzinfo=UTC).replace(tzinfo=None),
                actor_user_id=admin_user.id,
                reason="Duty transfer",
            ),
            DutyAssignmentEvent(
                employee_id="G1001",
                event_type="transfer",
                from_department="Security",
                from_unit="Administration",
                from_post="Reception",
                to_department="Security",
                to_unit="Control Room",
                to_post="Dispatch",
                effective_at=datetime(2026, 8, 23, 8, tzinfo=UTC).replace(tzinfo=None),
                actor_user_id=admin_user.id,
                reason="Duty transfer",
            ),
            DutyAssignmentEvent(
                employee_id="G1001",
                event_type="baseline",
                from_department=None,
                from_unit=None,
                from_post=None,
                to_department="Security",
                to_unit="Legacy",
                to_post=None,
                effective_at=datetime(2026, 7, 1, 8, tzinfo=UTC).replace(tzinfo=None),
                actor_user_id=admin_user.id,
                reason="Seed baseline",
            ),
            DutyAssignmentEvent(
                employee_id="G1002",
                event_type="transfer",
                from_department="Security",
                from_unit="Main Gate",
                from_post="Gate 2",
                to_department="Security",
                to_unit="Administration",
                to_post="Reception",
                effective_at=datetime(2026, 8, 24, 8, tzinfo=UTC).replace(tzinfo=None),
                actor_user_id=admin_user.id,
                reason="Other employee transfer",
            ),
        ]
    )
    _link_document(db_session, 72, 72)
    db_session.commit()

    duty_locations = employee_activity_service.list_employee_activity(
        db_session,
        owner_user_id=admin_user.id,
        employee_id="G1001",
        kind="duty_location",
        limit=25,
        offset=0,
    )
    merged_page = employee_activity_service.list_employee_activity(
        db_session,
        owner_user_id=admin_user.id,
        employee_id="G1001",
        limit=2,
        offset=1,
    )

    assert duty_locations.total == 3
    assert [row.event_type for row in duty_locations.items] == [
        "transfer",
        "transfer",
        "initial_placement",
    ]
    assert [row.to_unit for row in duty_locations.items] == [
        "Control Room",
        "Administration",
        "Main Gate",
    ]
    assert duty_locations.items[1].from_unit == "Main Gate"
    assert all(row.event_type != "baseline" for row in duty_locations.items)
    assert merged_page.total == 4
    assert [(row.kind, row.title) for row in merged_page.items] == [
        ("document", "Employment Certificate"),
        ("duty_location", "transfer"),
    ]


def test_id_changes_merge_filter_and_paginate_with_historical_numbers(db_session: Session):
    _employee(db_session, "G1001")
    _employee(db_session, "G2002", "OTHER EMPLOYEE")
    db_session.flush()
    db_session.add_all(
        [
            EmployeeFormerId(
                id=91,
                employee_id="G1001",
                former_id="G1000",
                new_id="G1002",
                changed_at=BASE,
                changed_by_user_id=7,
                reason="Correct the original number",
            ),
            EmployeeFormerId(
                id=92,
                employee_id="G1001",
                former_id="G1002",
                new_id="G1001",
                changed_at=BASE,
                changed_by_user_id=7,
                reason="Correct the second number",
            ),
            EmployeeFormerId(
                id=93,
                employee_id="G2002",
                former_id="G2001",
                new_id="G2002",
                changed_at=BASE + timedelta(minutes=1),
                changed_by_user_id=None,
                reason="Another employee correction",
            ),
            _ledger(entry_id=44, employee_id="G1001", created_at=BASE),
        ]
    )
    db_session.commit()

    result = employee_activity_service.list_employee_activity(
        db_session, owner_user_id=7, employee_id="G1001"
    )
    assert result.total == 3
    assert [(item.kind, item.source_id) for item in result.items] == [
        ("id_change", 92),
        ("id_change", 91),
        ("ledger", 44),
    ]
    assert [(item.reference, item.title) for item in result.items[:2]] == [
        ("G1002", "G1001"),
        ("G1000", "G1002"),
    ]
    assert result.items[1].reason == "Correct the original number"
    assert result.items[1].actor_name == "activity-reader@test.ae"
    assert result.items[1].occurred_at == BASE.replace(tzinfo=UTC)
    assert result.items[1].target_id == 91
    assert all(item.employee_id == "G1001" for item in result.items)
    assert all(item.employee_name_en == "ALPHA EMPLOYEE" for item in result.items)

    page = employee_activity_service.list_employee_activity(
        db_session, owner_user_id=7, employee_id="G1001", kind="id_change", offset=1, limit=1
    )
    assert page.total == 2
    assert [(item.kind, item.source_id) for item in page.items] == [("id_change", 91)]
    assert (page.limit, page.offset) == (1, 1)

    merged_page = employee_activity_service.list_employee_activity(
        db_session, owner_user_id=7, employee_id="G1001", offset=1, limit=1
    )
    assert merged_page.total == 3
    assert [item.source_id for item in merged_page.items] == [91]

    global_changes = employee_activity_service.list_employee_activity(
        db_session, owner_user_id=7, kind="id_change"
    )
    assert global_changes.total == 3
    assert [item.source_id for item in global_changes.items] == [93, 92, 91]


@pytest.mark.parametrize(
    ("display_name", "has_actor", "expected"),
    [
        ("Correction Admin", True, "Correction Admin"),
        ("", True, "activity-reader@test.ae"),
        (None, True, "activity-reader@test.ae"),
        (None, False, None),
    ],
)
def test_id_change_actor_uses_display_name_or_email_and_allows_missing_user(
    db_session: Session, display_name: str | None, has_actor: bool, expected: str | None
):
    _employee(db_session, "G1001")
    caller = db_session.get(User, 7)
    assert caller is not None
    caller.display_name = display_name
    db_session.flush()
    db_session.add(
        EmployeeFormerId(
            employee_id="G1001",
            former_id="G1000",
            new_id="G1001",
            changed_at=BASE,
            changed_by_user_id=7 if has_actor else None,
            reason="Correct the employee number",
        )
    )
    db_session.commit()

    activity = employee_activity_service.list_employee_activity(
        db_session, owner_user_id=7, employee_id="G1001", kind="id_change"
    )
    statement = employee_statement_service.activity_statement(
        db_session, "G1001", user=caller, from_date=None, to_date=None
    )
    assert activity.total == 1
    assert activity.items[0].actor_name == expected
    assert statement is not None
    assert len(statement.items) == 1
    assert statement.items[0].actor_name == expected


def test_id_changes_in_statement_obey_site_dates_actor_and_cap(
    db_session: Session, monkeypatch: pytest.MonkeyPatch
):
    _employee(db_session, "G1001")
    _employee(db_session, "G2002")
    caller = db_session.get(User, 7)
    assert caller is not None
    caller.employee_id = "G1001"
    db_session.flush()
    timestamps = [
        datetime(2026, 8, 10, 19, 59),
        datetime(2026, 8, 10, 20),
        datetime(2026, 8, 11, 19, 59),
        datetime(2026, 8, 11, 20),
    ]
    db_session.add_all(
        [
            EmployeeFormerId(
                id=index + 1,
                employee_id="G1001",
                former_id=f"G{1100 + index}",
                new_id=f"G{1101 + index}" if index < 3 else "G1001",
                changed_at=changed_at,
                changed_by_user_id=7,
                reason=f"Correction number {index + 1}",
            )
            for index, changed_at in enumerate(timestamps)
        ]
        + [
            EmployeeFormerId(
                employee_id="G2002",
                former_id="G2001",
                new_id="G2002",
                changed_at=timestamps[1],
                changed_by_user_id=7,
                reason="Another employee correction",
            )
        ]
    )
    db_session.commit()

    statement = employee_statement_service.activity_statement(
        db_session, "G1001", user=caller, from_date=date(2026, 8, 11), to_date=date(2026, 8, 11)
    )
    assert statement is not None
    assert not statement.truncated
    assert [(item.kind, item.source_id) for item in statement.items] == [
        ("id_change", 3),
        ("id_change", 2),
    ]
    older = statement.items[1]
    assert older.reference == "G1101"
    assert older.title == "G1102"
    assert older.reason == "Correction number 2"
    assert older.actor_name == "activity-reader@test.ae"
    assert older.actor_employee_id == "G1001"
    assert not older.date_only
    assert older.occurred_at.isoformat() == "2026-08-11T00:00:00+04:00"

    monkeypatch.setattr(employee_statement_service, "STATEMENT_CAP", 1)
    capped = employee_statement_service.activity_statement(
        db_session, "G1001", user=caller, from_date=date(2026, 8, 11), to_date=date(2026, 8, 11)
    )
    assert capped is not None
    assert capped.truncated
    assert [item.source_id for item in capped.items] == [3]
