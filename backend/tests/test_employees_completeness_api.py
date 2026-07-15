"""Detail payload gaps + aggregate completeness endpoint.

Tests for Task 2:
  - EmployeeDetailRead includes missing_fields and completeness
  - GET /api/v1/employees/completeness returns aggregate stats (Active only)

Auth pattern: override get_db + get_current_user so require_capability can
resolve a real manager user (managers have employees.view by default).
Uses a temp-file SQLite DB so the ASGI worker thread shares the same tables.
"""

from __future__ import annotations

from collections.abc import Callable

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.api.deps import get_current_user
from app.db import session as session_mod
from app.db.models import Base, Employee, User
from app.db.session import attach_sqlite_pragmas, get_db
from app.main import create_app
from app.services import perm_service


@pytest.fixture()
def api_db(monkeypatch: pytest.MonkeyPatch, tmp_path: pytest.TempPathFactory) -> Session:
    """Temp-file SQLite session accessible from the ASGI worker thread."""
    db_file = tmp_path / "test_completeness.db"  # type: ignore[operator]
    eng = create_engine(
        f"sqlite:///{db_file}",
        future=True,
        connect_args={"check_same_thread": False},
    )
    attach_sqlite_pragmas(eng, wal=False)
    Base.metadata.create_all(eng)
    TestSession = sessionmaker(bind=eng, autoflush=False, expire_on_commit=False, future=True)
    monkeypatch.setattr(session_mod, "engine", eng)
    monkeypatch.setattr(session_mod, "SessionLocal", TestSession)
    db = TestSession()
    perm_service.seed_role_defaults(db)
    try:
        yield db
    finally:
        db.close()


@pytest.fixture()
def client(api_db: Session) -> TestClient:
    """TestClient with the test DB and a manager user (has employees.view)."""
    user = User(email="mgr@x.ae", password_hash="x", role="manager", status="active")
    api_db.add(user)
    api_db.commit()
    api_db.refresh(user)
    app = create_app()
    app.dependency_overrides[get_db] = lambda: api_db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app, raise_server_exceptions=True)


@pytest.fixture()
def db_employee_factory(api_db: Session) -> Callable[..., Employee]:
    """Factory that creates and commits an Employee with sensible defaults."""

    def _factory(**kwargs: object) -> Employee:
        defaults: dict[str, object] = dict(
            name_en="Test Employee",
            name_ar="موظف اختبار",
            status="Active",
        )
        defaults.update(kwargs)
        emp = Employee(**defaults)  # type: ignore[arg-type]
        api_db.add(emp)
        api_db.commit()
        api_db.refresh(emp)
        return emp

    return _factory


def test_detail_includes_missing_fields(
    client: TestClient, db_employee_factory: Callable[..., Employee]
) -> None:
    emp = db_employee_factory(id="G9001", nationality=None, iban=None)
    res = client.get(f"/api/v1/employees/{emp.id}/detail")
    assert res.status_code == 200
    body = res.json()
    assert "nationality" in body["missing_fields"]
    assert body["completeness"]["tracked"] == 14


def test_completeness_summary_counts_active_only(
    client: TestClient, db_employee_factory: Callable[..., Employee]
) -> None:
    db_employee_factory(id="G9002", status="Active", nationality=None)
    db_employee_factory(id="G9003", status="Resigned", nationality=None)
    res = client.get("/api/v1/employees/completeness")
    assert res.status_code == 200
    body = res.json()
    assert body["incomplete"] == 1
    assert body["first_incomplete_id"] == "G9002"
    fields = [m["field"] for m in body["top_missing"]]
    assert "nationality" in fields
    assert len(body["top_missing"]) <= 3


def test_employee_list_includes_contact(
    client: TestClient, db_employee_factory: Callable[..., Employee]
) -> None:
    db_employee_factory(id="G-1", contact="+971509059931")
    items = client.get("/api/v1/employees").json()["items"]
    assert items[0]["contact"] == "+971509059931"
