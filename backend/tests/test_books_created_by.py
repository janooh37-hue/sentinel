"""`books.created_by_user_id` — the immutable creator, set on every create path
and exposed (id + name) on every BookRead surface.

Behavior-level: generation goes through `document_service.generate_document`,
direct creation through `POST /books`, and every read surface through the API.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.config import Settings
from app.db.models import (
    Book,
    BookApprovalStep,
    BookCategory,
    BookVersion,
    Employee,
    User,
    UserPermission,
)
from app.db.session import get_db
from app.main import create_app
from app.services import book_service, document_service
from tests.conftest import make_user


def _client(db: Session, user: User) -> TestClient:
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


@pytest.fixture()
def gen_env(api_db: Session, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Session:
    """api_db with the PDF chain stubbed and the categories generation needs."""
    settings = Settings(data_dir=tmp_path / "data")
    monkeypatch.setattr(document_service, "get_settings", lambda: settings)
    monkeypatch.setattr(document_service, "convert_docx_to_pdf", lambda p: None)
    api_db.add_all(
        [
            BookCategory(id="GS", prefix="GS"),
            BookCategory(id="HR", prefix="HR"),
            Employee(id="G-1001", name_en="Test Employee", name_ar="موظف اختبار"),
        ]
    )
    api_db.commit()
    return api_db


def _generate_general_book(db: Session, creator: User | None, **extra) -> int:
    result = document_service.generate_document(
        db,
        employee_id=None,
        template_id="General Book",
        fields={"subject": "Created-by test", "body": "<p>Body</p>"},
        commit=True,
        current_user=creator,
        classification_code="5/1",
        **extra,
    )
    return result.book_id


def _generate_leave(db: Session, creator: User) -> int:
    result = document_service.generate_document(
        db,
        employee_id="G-1001",
        template_id="Leave Application Form",
        fields={
            "leave_type": "Annual Leave",
            "start_date": "10/08/2026",
            "end_date": "11/08/2026",
            "total_days": 2,
        },
        commit=True,
        current_user=creator,
    )
    return result.book_id


# ── create paths ──────────────────────────────────────────────────────────────


def test_generation_sets_the_creator_for_two_form_kinds(gen_env: Session) -> None:
    creator = make_user(gen_env, role="admin", email="creator@x.ae")

    general_id = _generate_general_book(gen_env, creator)
    leave_id = _generate_leave(gen_env, creator)

    for book_id in (general_id, leave_id):
        book = gen_env.get(Book, book_id)
        assert book is not None
        assert book.created_by_user_id == creator.id
        # Generated books carry no submitter until they are submitted.
        assert book.submitted_by_user_id is None


def test_generation_without_a_user_leaves_the_creator_empty(gen_env: Session) -> None:
    book = gen_env.get(Book, _generate_general_book(gen_env, None))
    assert book is not None
    assert book.created_by_user_id is None


@pytest.mark.parametrize("state", ["none", "returned"])
def test_revision_does_not_change_the_creator(gen_env: Session, state: str) -> None:
    """Covers the in-place draft edit (state none overwrites v1's creator with the
    latest drafter) and a real new-version revision (state returned)."""
    creator = make_user(gen_env, role="admin", email="creator@x.ae")
    reviser = make_user(gen_env, role="admin", email="reviser@x.ae")
    book_id = _generate_general_book(gen_env, creator)
    book = gen_env.get(Book, book_id)
    assert book is not None
    book.approval_state = state
    if state != "none":
        book.versions[-1].status = state
    gen_env.commit()

    revised = document_service.generate_document(
        gen_env,
        employee_id=None,
        template_id="General Book",
        fields={"subject": "Revised", "body": "<p>Changed</p>"},
        commit=True,
        current_user=reviser,
        revise_of_book_id=book_id,
        classification_code="5/1",
    )

    assert revised.book_id == book_id
    gen_env.refresh(book)
    assert len(book.versions) == (1 if state == "none" else 2)
    assert book.versions[-1].created_by_user_id == reviser.id
    assert book.created_by_user_id == creator.id


def test_post_books_sets_the_creator(api_db: Session) -> None:
    api_db.add(BookCategory(id="GS", prefix="GS"))
    api_db.commit()
    user = make_user(api_db, role="admin", email="poster@x.ae")

    res = _client(api_db, user).post(
        "/api/v1/books",
        json={"category_id": "GS", "subject": "Direct", "direction": "outgoing"},
    )

    assert res.status_code == 201
    body = res.json()
    assert body["created_by_user_id"] == user.id
    book = api_db.get(Book, body["id"])
    assert book is not None
    assert book.created_by_user_id == user.id


def test_service_create_book_defaults_to_no_creator(api_db: Session) -> None:
    from app.schemas.book import BookCreate

    api_db.add(BookCategory(id="GS", prefix="GS"))
    api_db.commit()
    row = book_service.create_book(
        api_db, BookCreate(category_id="GS", subject="x", direction="outgoing")
    )
    assert row.created_by_user_id is None


# ── read surfaces ─────────────────────────────────────────────────────────────


def _hand_built(
    db: Session,
    *,
    book_id: int,
    creator: User,
    approver: User | None = None,
    state: str = "pending",
    created_at: datetime | None = None,
    version_creator: User | None = None,
) -> Book:
    if db.get(BookCategory, "HR") is None:
        db.add(BookCategory(id="HR", prefix="HR"))
        db.flush()
    book = Book(
        id=book_id,
        category_id="HR",
        ref_number=f"HR-{book_id:04d}",
        approval_state=state,
        created_by_user_id=creator.id,
    )
    if created_at is not None:
        book.created_at = created_at
    version = BookVersion(
        id=book_id,
        book_id=book_id,
        version_no=1,
        trigger="initial",
        status=state,
        created_by_user_id=version_creator.id if version_creator is not None else None,
    )
    if approver is not None:
        version.approval_steps.append(
            BookApprovalStep(
                book_id=book_id,
                step_order=0,
                stage_label="Approve",
                assignee_user_id=approver.id,
                kind="approver",
                state="pending",
            )
        )
    book.versions.append(version)
    db.add(book)
    db.commit()
    return book


def test_list_exposes_creator_id_and_name_with_g_left_empty(api_db: Session) -> None:
    creator = make_user(api_db, role="operator", email="lister@x.ae")
    creator.employee_id = "G-1001"
    api_db.add(Employee(id="G-1001", name_en="Lister Name"))
    viewer = make_user(api_db, role="admin", email="viewer@x.ae")
    _hand_built(api_db, book_id=1, creator=creator, state="none")
    orphan = Book(category_id="HR", ref_number="HR-0002", created_by_user_id=None)
    api_db.add(orphan)
    api_db.commit()

    items = {
        i["ref_number"]: i for i in _client(api_db, viewer).get("/api/v1/books").json()["items"]
    }

    assert items["HR-0001"]["created_by_user_id"] == creator.id
    assert items["HR-0001"]["created_by_name"] == "Lister Name"
    assert items["HR-0001"]["created_by_g"] is None
    assert items["HR-0002"]["created_by_user_id"] is None
    assert items["HR-0002"]["created_by_name"] is None


def test_awaiting_exposes_creator_name(api_db: Session) -> None:
    creator = make_user(api_db, role="operator", email="await-creator@x.ae")
    signer = make_user(api_db, role="manager", email="await-signer@x.ae")
    _hand_built(api_db, book_id=1, creator=creator, approver=signer)

    items = _client(api_db, signer).get("/api/v1/books/awaiting").json()

    assert [i["ref_number"] for i in items] == ["HR-0001"]
    assert items[0]["created_by_user_id"] == creator.id
    assert items[0]["created_by_name"] == "await-creator@x.ae"


def test_awaiting_scan_exposes_creator_name(api_db: Session) -> None:
    creator = make_user(api_db, role="admin", email="scan-creator@x.ae")
    _hand_built(
        api_db,
        book_id=1,
        creator=creator,
        state="awaiting_scan",
        created_at=datetime.now() - timedelta(hours=48),
        version_creator=creator,
    )

    items = _client(api_db, creator).get("/api/v1/books/awaiting-scan").json()

    assert [i["ref_number"] for i in items] == ["HR-0001"]
    assert items[0]["created_by_user_id"] == creator.id
    assert items[0]["created_by_name"] == "scan-creator@x.ae"


def test_detail_exposes_creator_id_name_and_g_number(api_db: Session) -> None:
    creator = make_user(api_db, role="operator", email="detail-creator@x.ae")
    creator.employee_id = "G-2002"
    api_db.add(Employee(id="G-2002", name_en="Detail Creator"))
    viewer = make_user(api_db, role="admin", email="detail-viewer@x.ae")
    _hand_built(api_db, book_id=1, creator=creator, state="none")

    body = _client(api_db, viewer).get("/api/v1/books/1").json()

    assert body["created_by_user_id"] == creator.id
    assert body["created_by_name"] == "Detail Creator"
    assert body["created_by_g"] == "G-2002"
    # The submitter is a different concept and stays empty before submission.
    assert body["submitted_by_user_id"] is None


def test_scoped_projection_exposes_creator_id_and_name_but_not_g(api_db: Session) -> None:
    creator = make_user(api_db, role="operator", email="scoped-creator@x.ae")
    api_db.add(Employee(id="G-3003", name_en="Scoped Creator"))
    api_db.flush()
    creator.employee_id = "G-3003"
    signer = make_user(api_db, role="manager", email="scoped-signer@x.ae")
    # No books.view: the signer reads only the revision assigned to them.
    api_db.add(UserPermission(user_id=signer.id, capability="books.view", effect="deny"))
    book = _hand_built(api_db, book_id=1, creator=creator, approver=signer, state="returned")
    step = book.versions[0].approval_steps[0]
    step.state = "returned"
    step.decided_at = datetime.now() - timedelta(days=1)
    book_service.capture_approval_context(
        api_db, book, book.versions[0], submitted_by_user_id=None, submitted_at=step.created_at
    )
    book_service.retain_revision_access(api_db, book.versions[0], step)
    api_db.commit()

    body = _client(api_db, signer).get("/api/v1/books/1").json()

    assert body["access_scope"] == "assigned_revision"
    assert body["created_by_user_id"] == creator.id
    assert body["created_by_name"] == "Scoped Creator"
    assert body["created_by_g"] is None


def test_inmate_reporter_created_by_me_never_widens_visibility(api_db: Session) -> None:
    """``created_by_me`` narrows on top of the reporter visibility clause: a
    staff-created shared record and another reporter's draft stay out of the
    list and the facet counts, and so does a draft the reporter 'created' but
    whose original creator is someone else (hidden by visibility)."""
    reporter = make_user(api_db, role="inmate_reporter", email="rep@x.ae")
    other_reporter = make_user(api_db, role="inmate_reporter", email="rep2@x.ae")
    staff = make_user(api_db, role="operator", email="staff@x.ae")
    _hand_built(api_db, book_id=1, creator=reporter, state="pending", version_creator=reporter)
    _hand_built(api_db, book_id=2, creator=staff, state="approved", version_creator=staff)
    _hand_built(
        api_db, book_id=3, creator=other_reporter, state="none", version_creator=other_reporter
    )
    _hand_built(api_db, book_id=4, creator=reporter, state="none", version_creator=other_reporter)
    # Reporters only hold the violations category; move the seeded books there.
    api_db.add(BookCategory(id="INV", prefix="INV"))
    api_db.flush()
    for book in api_db.query(Book).all():
        book.category_id = "INV"
        book.versions[0].template_id = "Inmate Conduct Violations"
    api_db.commit()

    client = _client(api_db, reporter)
    response = client.get("/api/v1/books", params={"created_by_me": True, "limit": 100})
    assert response.status_code == 200
    listed = response.json()
    assert [item["id"] for item in listed["items"]] == [1]
    assert listed["total"] == 1

    facets = client.get("/api/v1/books/facets", params={"created_by_me": True}).json()
    assert facets["total"] == 1
    assert facets["states"] == {"pending": 1}
    assert sum(s["count"] for s in facets["services"]) == 1
