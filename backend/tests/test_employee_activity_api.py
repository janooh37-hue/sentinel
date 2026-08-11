from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.api.deps import get_current_user
from app.db import session as session_mod
from app.db.models import Base, Book, BookCategory, Document, Employee, User, UserPermission
from app.db.session import attach_sqlite_pragmas, get_db
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
    db.add_all([
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
    ])
    db.commit()
    try:
        yield db
    finally:
        db.close()


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
