from __future__ import annotations

from datetime import UTC, date, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker

from app.api.deps import get_current_user
from app.db import session as session_mod
from app.db.models import (
    Base,
    Book,
    BookCategory,
    BookVersion,
    Document,
    Employee,
    Leave,
    User,
    UserPermission,
)
from app.db.session import attach_sqlite_pragmas, get_db
from app.db.workforce_models import DutyAssignmentEvent
from app.main import create_app
from app.services import perm_service


@pytest.fixture()
def api_db(monkeypatch: pytest.MonkeyPatch, tmp_path: pytest.TempPathFactory) -> Session:
    db_file = tmp_path / "test_employee_activity.db"  # type: ignore[operator]
    eng = create_engine(
        f"sqlite:///{db_file}", future=True, connect_args={"check_same_thread": False}
    )
    attach_sqlite_pragmas(eng, wal=False)
    Base.metadata.create_all(eng)
    TestSession = sessionmaker(bind=eng, autoflush=False, expire_on_commit=False, future=True)
    monkeypatch.setattr(session_mod, "engine", eng)
    monkeypatch.setattr(session_mod, "SessionLocal", TestSession)
    db = TestSession()
    perm_service.seed_role_defaults(db)
    db.add_all(
        [
            Employee(id="G100", name_en="ALPHA EMPLOYEE", name_ar="موظف ألف", status="Active"),
            BookCategory(id="HR", name_en="HR", prefix="HR"),
            Book(id=71, category_id="HR", ref_number="HR-0071", employee_id="G100"),
            Document(
                id=11,
                employee_id="G100",
                template_id="Employment Certificate",
                ref_number="HR-0071",
                docx_path="output/fake.docx",
                submission_id="00000000-0000-0000-0000-000000000011",
            ),
        ]
    )
    db.commit()
    db.add(
        BookVersion(
            book_id=71,
            version_no=1,
            document_id=11,
            template_id="Employment Certificate",
            status="approved",
        )
    )
    db.commit()
    try:
        yield db
    finally:
        db.close()
        eng.dispose()


def _client(db: Session, user: User) -> TestClient:
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app, raise_server_exceptions=True)


@pytest.fixture()
def manager_client(api_db: Session) -> TestClient:
    user = User(email="mgr@x.ae", password_hash="x", role="manager", status="active")
    api_db.add(user)
    api_db.commit()
    api_db.refresh(user)
    return _client(api_db, user)


@pytest.fixture()
def operator_client(api_db: Session) -> TestClient:
    user = User(email="operator@x.ae", password_hash="x", role="operator", status="active")
    api_db.add(user)
    api_db.commit()
    api_db.refresh(user)
    api_db.add(UserPermission(user_id=user.id, capability="employees.view", effect="deny"))
    api_db.commit()
    return _client(api_db, user)


def test_activity_static_route_wins_over_employee_id_route(manager_client: TestClient):
    response = manager_client.get("/api/v1/employees/activity")
    assert response.status_code == 200
    assert set(response.json()) == {"items", "total", "limit", "offset"}


def test_activity_route_forwards_filters_and_page(manager_client: TestClient):
    response = manager_client.get(
        "/api/v1/employees/activity",
        params={"employee_id": "G100", "kind": "document", "limit": 1, "offset": 0},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["limit"] == 1
    assert body["offset"] == 0
    assert body["items"][0]["employee_id"] == "G100"
    assert body["items"][0]["kind"] == "document"


def test_activity_route_validates_kind_and_limit(manager_client: TestClient):
    assert manager_client.get("/api/v1/employees/activity?kind=profile").status_code == 422
    assert manager_client.get("/api/v1/employees/activity?limit=101").status_code == 422


def test_activity_route_requires_employees_view(operator_client: TestClient):
    assert operator_client.get("/api/v1/employees/activity").status_code == 403


def test_activity_route_returns_recorded_duty_location_events(
    api_db: Session, manager_client: TestClient
):
    manager = api_db.query(User).filter_by(email="mgr@x.ae").one()
    api_db.add_all(
        [
            DutyAssignmentEvent(
                employee_id="G100",
                event_type="initial_placement",
                from_department=None,
                from_unit=None,
                from_post=None,
                to_department="Security",
                to_unit="Main Gate",
                to_post="Gate 1",
                effective_at=datetime(2026, 8, 1, 8, tzinfo=UTC).replace(tzinfo=None),
                actor_user_id=manager.id,
                reason="Initial placement",
            ),
            DutyAssignmentEvent(
                employee_id="G100",
                event_type="transfer",
                from_department="Security",
                from_unit="Main Gate",
                from_post="Gate 1",
                to_department="Security",
                to_unit="Administration",
                to_post="Reception",
                effective_at=datetime(2026, 8, 20, 8, tzinfo=UTC).replace(tzinfo=None),
                actor_user_id=manager.id,
                reason="Duty transfer",
            ),
            DutyAssignmentEvent(
                employee_id="G100",
                event_type="baseline",
                from_department=None,
                from_unit=None,
                from_post=None,
                to_department="Security",
                to_unit="Legacy",
                to_post=None,
                effective_at=datetime(2026, 7, 1, 8, tzinfo=UTC).replace(tzinfo=None),
                actor_user_id=manager.id,
                reason="Seed baseline",
            ),
        ]
    )
    api_db.commit()

    response = manager_client.get(
        "/api/v1/employees/activity",
        params={"employee_id": "G100", "kind": "duty_location"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 2
    assert [item["event_type"] for item in body["items"]] == ["transfer", "initial_placement"]
    assert body["items"][0]["from_unit"] == "Main Gate"
    assert body["items"][0]["to_unit"] == "Administration"
    assert body["items"][0]["reason"] == "Duty transfer"
    assert all(item["event_type"] != "baseline" for item in body["items"])
    assert manager_client.get("/api/v1/employees/activity?kind=unknown").status_code == 422


def test_service_employee_lookup_does_not_grant_profile_access(
    api_db: Session, operator_client: TestClient
):
    employee = api_db.get(Employee, "G100")
    assert employee is not None
    employee.contact = "private phone"
    employee.uae_id_no = "private emirates id"
    employee.passport_no = "PASSPORT100"
    employee.nationality = "Egyptian"
    employee.notes = "private notes"
    employee.iban = "private bank account"
    api_db.commit()

    response = operator_client.get("/api/v1/employees/lookup", params={"q": "G100", "limit": 1})
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    assert body["limit"] == 1
    assert set(body["items"][0]) == {
        "id",
        "name_en",
        "name_ar",
        "department",
        "position",
        "position_ar",
        "duty_unit",
        "duty_post",
    }
    assert body["items"][0]["id"] == "G100"

    selected = operator_client.get("/api/v1/employees/lookup/G100")
    assert selected.status_code == 200
    assert set(selected.json()) == set(body["items"][0]) | {
        "nationality",
        "passport_no",
        "has_photo",
    }
    assert selected.json()["passport_no"] == "PASSPORT100"
    assert selected.json()["nationality"] == "Egyptian"
    assert operator_client.get("/api/v1/employees").status_code == 403
    assert operator_client.get("/api/v1/employees/G100").status_code == 403
    assert operator_client.get("/api/v1/employees/G100/detail").status_code == 403


def test_lookup_hides_passport_fields_without_passport_release_service(api_db: Session):
    employee = api_db.get(Employee, "G100")
    assert employee is not None
    employee.passport_no = "PASSPORT100"
    employee.nationality = "Egyptian"
    user = User(email="no-passport@x.ae", password_hash="x", role="operator", status="active")
    api_db.add(user)
    api_db.flush()
    api_db.add(
        UserPermission(
            user_id=user.id, capability="books.service.Passport Release List", effect="deny"
        )
    )
    api_db.commit()
    selected = _client(api_db, user).get("/api/v1/employees/lookup/G100")
    assert selected.status_code == 200
    assert selected.json()["id"] == "G100"
    assert selected.json()["passport_no"] is None
    assert selected.json()["nationality"] is None


def test_employee_lookup_forbids_user_without_either_capability(api_db: Session):
    user = User(email="no-picker@x.ae", password_hash="x", role="operator", status="active")
    api_db.add(user)
    api_db.flush()
    api_db.add_all(
        [
            UserPermission(user_id=user.id, capability=cap, effect="deny")
            for cap in ("employees.view", "documents.generate")
        ]
    )
    api_db.commit()
    client = _client(api_db, user)
    assert client.get("/api/v1/employees/lookup").status_code == 403
    assert client.get("/api/v1/employees/lookup/G100").status_code == 403


def test_employee_view_alone_allows_lookup(api_db: Session):
    user = User(email="view-picker@x.ae", password_hash="x", role="operator", status="active")
    api_db.add(user)
    api_db.flush()
    api_db.add(UserPermission(user_id=user.id, capability="documents.generate", effect="deny"))
    api_db.commit()
    client = _client(api_db, user)
    assert client.get("/api/v1/employees/lookup").status_code == 200
    assert client.get("/api/v1/employees/lookup/G100").status_code == 200


def _seed_linked_documents(
    db: Session, count: int, *, first_id: int, named_every_third: bool = False
) -> list[int]:
    """Seed ``count`` committed documents, each owned by its own live Record.

    With ``named_every_third``, every third Record is someone else's named
    Record, which no other non-admin caller may open.
    """
    created = datetime(2026, 8, 1, 8)
    books: list[Book] = []
    documents: list[Document] = []
    hidden: list[int] = []
    for offset in range(count):
        record_id = first_id + offset
        named = named_every_third and offset % 3 == 0
        if named:
            hidden.append(record_id)
        books.append(
            Book(
                id=record_id,
                category_id="HR",
                ref_number=f"HR-{record_id}",
                employee_id="G100",
                grade="unclassified",
                distribution="named" if named else "organization",
                created_by_user_id=None,
            )
        )
        documents.append(
            Document(
                id=record_id,
                employee_id="G100",
                template_id="Employment Certificate",
                ref_number=f"HR-{record_id}",
                docx_path="output/fake.docx",
                submission_id=f"00000000-0000-0000-0000-{record_id:012d}",
                created_at=created,
            )
        )
    db.add_all([*books, *documents])
    db.flush()
    db.add_all(
        BookVersion(
            book_id=record_id,
            version_no=1,
            document_id=record_id,
            template_id="Employment Certificate",
            status="approved",
        )
        for record_id in range(first_id, first_id + count)
    )
    db.commit()
    return hidden


def _counted_activity(db: Session, client: TestClient, params: dict[str, object]):
    statements = 0

    def _count(*_args: object) -> None:
        nonlocal statements
        statements += 1

    engine = db.get_bind()
    event.listen(engine, "before_cursor_execute", _count)
    try:
        response = client.get("/api/v1/employees/activity", params=params)
    finally:
        event.remove(engine, "before_cursor_execute", _count)
    assert response.status_code == 200
    return statements, response.json()


@pytest.mark.parametrize("kind", [None, "document"])
def test_activity_page_cost_does_not_grow_with_document_total(
    api_db: Session, manager_client: TestClient, kind: str | None
):
    params: dict[str, object] = {"limit": 25, "offset": 0}
    if kind is not None:
        params["kind"] = kind
    _seed_linked_documents(api_db, 200, first_id=1000)
    smaller, body = _counted_activity(api_db, manager_client, params)
    assert body["total"] == 201
    assert len(body["items"]) == 25

    _seed_linked_documents(api_db, 200, first_id=2000)
    larger, body = _counted_activity(api_db, manager_client, params)
    assert body["total"] == 401
    assert len(body["items"]) == 25

    assert larger - smaller <= 2, (smaller, larger)


def test_activity_total_matches_the_pages_when_records_are_hidden(
    api_db: Session, manager_client: TestClient
):
    hidden = set(_seed_linked_documents(api_db, 30, first_id=1000, named_every_third=True))

    seen: list[int] = []
    total = None
    offset = 0
    while True:
        response = manager_client.get(
            "/api/v1/employees/activity",
            params={"kind": "document", "limit": 7, "offset": offset},
        )
        assert response.status_code == 200
        body = response.json()
        total = body["total"]
        if not body["items"]:
            break
        seen.extend(item["source_id"] for item in body["items"])
        offset += 7

    assert hidden.isdisjoint(seen)
    assert len(seen) == len(set(seen)) == total == 31 - len(hidden)


def test_activity_omits_documents_of_soft_deleted_records_for_admins(api_db: Session):
    admin = User(email="admin@x.ae", password_hash="x", role="admin", status="active")
    api_db.add(admin)
    record = api_db.get(Book, 71)
    assert record is not None
    record.deleted_at = datetime(2026, 8, 2, 8)
    api_db.commit()

    response = _client(api_db, admin).get("/api/v1/employees/activity", params={"kind": "document"})

    assert response.status_code == 200
    assert response.json()["items"] == []
    assert response.json()["total"] == 0


@pytest.mark.parametrize("deny_leaves", [False, True])
def test_activity_leave_privacy_applies_before_pagination_and_totals(
    api_db: Session, manager_client: TestClient, deny_leaves: bool
):
    manager = api_db.query(User).filter_by(email="mgr@x.ae").one()
    leaves = [
        Leave(
            employee_id="G100",
            leave_type="Annual Leave",
            start_date=date(2026, 10, day),
            end_date=date(2026, 10, day),
            days=1,
            status="Approved",
            created_at=datetime(2030, 10, day),
        )
        for day in range(1, 6)
    ]
    api_db.add_all(leaves)
    if deny_leaves:
        api_db.add(UserPermission(user_id=manager.id, capability="leaves.view", effect="deny"))
    api_db.commit()

    total = 1 if deny_leaves else 6
    seen = []
    for offset in range(total + 1):
        response = manager_client.get(
            "/api/v1/employees/activity",
            params={"employee_id": "G100", "limit": 1, "offset": offset},
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["total"] == total
        assert len(body["items"]) == (1 if offset < total else 0)
        seen.extend((row["kind"], row["source_id"]) for row in body["items"])
    assert seen[-1] == ("document", 11)
    assert {source_id for kind, source_id in seen if kind == "leave"} == (
        set() if deny_leaves else {leave.id for leave in leaves}
    )
    for employee_filter in ({}, {"employee_id": "G100"}):
        response = manager_client.get(
            "/api/v1/employees/activity",
            params={"kind": "leave", **employee_filter},
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["total"] == (0 if deny_leaves else 5)
        assert {row["source_id"] for row in body["items"]} == (
            set() if deny_leaves else {leave.id for leave in leaves}
        )
