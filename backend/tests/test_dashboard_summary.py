from datetime import date, datetime

from fastapi.testclient import TestClient

from app.api.deps import get_current_user
from app.db.models import (
    Book,
    BookCategory,
    BookVersion,
    Employee,
    Leave,
    LedgerEntry,
    User,
    Violation,
)
from app.db.session import get_db
from app.main import create_app
from app.services import dashboard_service, ledger_service, perm_service

TODAY = date(2026, 10, 23)


def _user(db, email, role="admin"):
    user = User(email=email, password_hash="x", role=role, status="active")
    db.add(user)
    db.flush()
    return user


def test_my_records_matches_records_page_state_dates_and_drafts(api_db):
    db = api_db
    user = _user(db, "records@x.ae", "manager")
    other = _user(db, "other@x.ae")
    db.add_all([BookCategory(id="GS", prefix="GS"), BookCategory(id="HIDDEN", prefix="H")])
    db.flush()
    states = ["approved", "pending", "awaiting_scan", "returned", "rejected", "none"]
    for state in states:
        for index, created_at in enumerate(
            [
                datetime(2026, 9, 30, 23, 59, 59),
                datetime(2026, 10, 1),
                datetime(2026, 10, 31, 23, 59, 59),
                datetime(2026, 11, 1),
            ]
        ):
            for creator in [user, other]:
                book = Book(
                    category_id="GS",
                    ref_number=f"{state}-{index}-{creator.id}",
                    approval_state=state,
                    created_by_user_id=creator.id,
                    created_at=created_at,
                )
                db.add(book)
                db.flush()
                db.add(BookVersion(book_id=book.id, version_no=1, template_id="General Book"))
    for name, extra in [
        ("draft-old", {"created_at": datetime(2026, 9, 1)}),
        ("draft", {}),
        ("voided", {"voided_at": datetime(2026, 10, 2)}),
        ("deleted", {"deleted_at": datetime(2026, 10, 2)}),
        ("hidden", {"category_id": "HIDDEN"}),
    ]:
        values = dict(category_id="GS", created_at=datetime(2026, 10, 2))
        values.update(extra)
        db.add(Book(ref_number=name, created_by_user_id=user.id, **values))
    db.commit()
    perm_service.set_user_overrides(db, user.id, [("books.category.HIDDEN", "deny", None)])
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    client = TestClient(app)
    summary = dashboard_service.get_summary(db, user=user, today=TODAY)
    records = summary.my_records
    assert records is not None
    assert records.month == "2026-10"
    assert records.from_date == date(2026, 10, 1)
    assert records.to_date == date(2026, 10, 31)
    # BooksPage maps mine=1 to created_by_me, then matchesBookFilters compares
    # state and created_at.slice(0,10) inclusively; voided rows remain in states.
    response = client.get("/api/v1/books", params={"created_by_me": True, "limit": 500})
    assert response.status_code == 200, response.text
    rows = response.json()["items"]
    for state in states:
        listed = [
            r
            for r in rows
            if r["approval_state"] == state
            and records.from_date.isoformat() <= r["created_at"][:10] <= records.to_date.isoformat()
        ]
        field = "not_submitted" if state == "none" else state
        assert getattr(records, field) == len(listed)
        # Also prove the equivalent server-side date/state filters agree.
        filtered = client.get(
            "/api/v1/books",
            params={
                "created_by_me": True,
                "approval_state": state,
                "from_date": records.from_date.isoformat(),
                "to_date": records.to_date.isoformat(),
            },
        )
        assert filtered.status_code == 200, filtered.text
        assert filtered.json()["total"] == len(listed)
    assert records.drafts == len([r for r in rows if r["is_draft"] and not r["voided_at"]]) == 2
    assert records.approved == 2
    assert all(row.book_id in {r["id"] for r in rows} for row in records.latest_approved)
    assert "recent_documents" not in summary.model_dump()
    assert "recent_ledger" not in summary.model_dump()
    assert "draft_count" not in summary.totals.model_dump()


def test_dashboard_record_filters_apply_before_pagination_and_keep_full_counts(api_db):
    db = api_db
    user = _user(db, "many-records@x.ae")
    other = _user(db, "many-records-other@x.ae")
    db.add(BookCategory(id="GS", prefix="GS"))
    db.flush()
    for state, created_at in [
        ("approved", datetime(2026, 10, 1)),
        ("pending", datetime(2026, 10, 31, 23, 59, 59)),
    ]:
        db.add_all(
            [
                Book(
                    category_id="GS",
                    ref_number=f"{state}-{index}",
                    approval_state=state,
                    created_by_user_id=user.id,
                    created_at=created_at,
                    versions=[BookVersion(version_no=1, template_id="General Book")],
                )
                for index in range(501)
            ]
        )
    for name, extra in [
        ("draft-old", {"created_at": datetime(2026, 9, 1)}),
        ("draft", {}),
        ("voided", {"voided_at": datetime(2026, 10, 2)}),
        ("deleted", {"deleted_at": datetime(2026, 10, 2)}),
        ("other", {"created_by_user_id": other.id}),
        ("outside-month", {"created_at": datetime(2026, 11, 1)}),
    ]:
        values = dict(
            category_id="GS",
            created_by_user_id=user.id,
            created_at=datetime(2026, 10, 2),
        )
        values.update(extra)
        book = Book(ref_number=name, **values)
        if name == "outside-month":
            book.approval_state = "approved"
            book.versions = [BookVersion(version_no=1, template_id="General Book")]
        db.add(book)
    db.commit()
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    client = TestClient(app)
    records = dashboard_service.get_summary(db, user=user, today=TODAY).my_records
    assert records is not None
    assert records.approved == records.pending == 501
    assert len(records.latest_approved) == 5
    for state in ["approved", "pending", "none"]:
        params = {
            "created_by_me": True,
            "approval_state": state,
            "from_date": records.from_date.isoformat(),
            "to_date": records.to_date.isoformat(),
            "limit": 500,
        }
        first = client.get("/api/v1/books", params=params)
        assert first.status_code == 200, first.text
        page = first.json()
        field = "not_submitted" if state == "none" else state
        expected = 2 if state == "none" else 501
        assert getattr(records, field) == page["total"] == expected
        rows = page["items"]
        assert len(rows) == min(expected, 500)
        if expected > 500:
            second = client.get("/api/v1/books", params={**params, "offset": 500})
            assert second.status_code == 200, second.text
            assert second.json()["total"] == expected
            rows += second.json()["items"]
        assert len({row["id"] for row in rows}) == expected
        assert all(row["approval_state"] == state for row in rows)
        assert all("2026-10-01" <= row["created_at"][:10] <= "2026-10-31" for row in rows)
    drafts = client.get(
        "/api/v1/books", params={"created_by_me": True, "drafts": True, "limit": 500}
    )
    assert drafts.status_code == 200, drafts.text
    assert records.drafts == drafts.json()["total"] == 2
    assert {row["ref_number"] for row in drafts.json()["items"]} == {"draft-old", "draft"}


def test_summary_mail_is_owner_scoped_and_matches_unread_count_and_leaves_include_today(api_db):
    db = api_db
    user = _user(db, "mail@x.ae")
    other = _user(db, "mail-other@x.ae")
    db.add(Employee(id="G1", name_en="Employee", name_ar="موظف"))
    db.flush()
    for index in range(8):
        db.add(
            LedgerEntry(
                owner_user_id=user.id,
                direction="internal" if index == 0 else "incoming",
                channel="email",
                subject=f"mail-{index}",
                counterparty="sender",
                entry_date=TODAY,
                created_at=datetime(2026, 10, 23, index),
            )
        )
    for extra in [
        dict(owner_user_id=other.id),
        dict(read_at=datetime(2026, 10, 23)),
        dict(deleted_at=datetime(2026, 10, 23)),
        dict(direction="outgoing"),
        dict(channel="paper"),
    ]:
        values = dict(
            owner_user_id=user.id,
            direction="incoming",
            channel="email",
            subject="excluded",
            counterparty="sender",
            entry_date=TODAY,
        )
        values.update(extra)
        db.add(LedgerEntry(**values))
    db.add(
        Leave(
            employee_id="G1",
            leave_type="Annual Leave",
            start_date=date(2026, 10, 1),
            end_date=TODAY,
            days=23,
            status="Approved",
        )
    )
    for index in range(8):
        db.add(
            Violation(
                employee_id="G1",
                violation_type=f"Violation {index}",
                date=date(2026, 10, index + 1),
                status="Open" if index < 7 else "Closed",
            )
        )
    db.commit()
    summary = dashboard_service.get_summary(db, user=user, today=TODAY, owner_user_id=other.id)
    assert summary.unread_mail is not None
    assert summary.unread_mail.count == ledger_service.unread_email_count(db, user.id) == 8
    assert [row.subject for row in summary.unread_mail.latest] == [
        f"mail-{i}" for i in range(7, 2, -1)
    ]
    assert len(summary.on_leave_today) == 1
    assert [leave.days_remaining for leave in summary.upcoming_leave_ends] == [0]
    assert summary.open_violations is not None
    assert summary.open_violations.count == 7
    assert [row.title for row in summary.open_violations.latest] == [
        f"Violation {i}" for i in range(6, 1, -1)
    ]


def test_summary_sections_require_their_source_capabilities(db_session):
    db = db_session
    user = _user(db, "denied@x.ae", "manager")
    db.commit()
    perm_service.set_user_overrides(
        db,
        user.id,
        [
            (cap, "deny", None)
            for cap in ["books.view", "ledger.view", "violations.view", "leaves.view"]
        ],
    )
    summary = dashboard_service.get_summary(db, user=user, today=TODAY)
    assert summary.my_records is None
    assert summary.unread_mail is None
    assert summary.open_violations is None
    assert summary.on_leave_today == []
    assert summary.upcoming_leave_ends == []
