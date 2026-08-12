"""The books register listing routes honor a ``books.view`` deny override.

`books.view` is an operator default, so every role holds it and no role loses
access from the gate. The contract these tests defend is the *override* layer: a
per-user ``deny`` on ``books.view`` must block the register listing and search,
not just the detail/download routes.

Before the gate was added, `list_books` took no user at all -- a denied user could
still enumerate the whole register, full-text search it via ``q``, and pass
``include_deleted=true``. See docs/permissions-enforcement.md section 4.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.api.deps import get_current_user
from app.db import session as session_mod
from app.db.models import Base, Book, BookCategory, User, UserPermission
from app.db.session import attach_sqlite_pragmas, get_db
from app.main import create_app
from app.services import perm_service

# Every route that reads the register. Each must answer 403 to a denied caller.
GATED_PATHS = (
    "/api/v1/books",
    "/api/v1/books?q=HR&include_deleted=true",
    "/api/v1/books/facets",
    "/api/v1/books/classifications",
    "/api/v1/book-categories",
)


@pytest.fixture()
def api_db(monkeypatch: pytest.MonkeyPatch, tmp_path) -> Session:
    db_file = tmp_path / "test_books_view_gate.db"
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
            BookCategory(id="HR", name_en="HR", prefix="HR"),
            Book(id=1, category_id="HR", ref_number="HR-0001"),
        ]
    )
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


def _user(db: Session, email: str, *, deny_books_view: bool = False) -> User:
    user = User(email=email, password_hash="x", role="operator", status="active")
    db.add(user)
    db.commit()
    db.refresh(user)
    if deny_books_view:
        db.add(UserPermission(user_id=user.id, capability="books.view", effect="deny"))
        db.commit()
    return user


@pytest.fixture()
def denied_client(api_db: Session) -> TestClient:
    return _client(api_db, _user(api_db, "denied@x.ae", deny_books_view=True))


@pytest.fixture()
def operator_client(api_db: Session) -> TestClient:
    return _client(api_db, _user(api_db, "operator@x.ae"))


@pytest.mark.parametrize("path", GATED_PATHS)
def test_denied_user_cannot_read_register(denied_client: TestClient, path: str):
    response = denied_client.get(path)
    assert response.status_code == 403, f"{path} leaked to a books.view-denied user"


@pytest.mark.parametrize("path", GATED_PATHS)
def test_operator_default_still_reads_register(operator_client: TestClient, path: str):
    """books.view is in the operator preset, so the gate costs no role its access."""
    response = operator_client.get(path)
    assert response.status_code == 200, f"{path} regressed for a plain operator"


def test_search_and_include_deleted_are_not_a_bypass(denied_client: TestClient):
    """The pre-fix hole was widest here: full-text search over the whole register
    plus soft-deleted rows, with no user parameter on the route at all."""
    response = denied_client.get("/api/v1/books", params={"q": "HR", "include_deleted": True})
    assert response.status_code == 403
    assert "items" not in response.json()
