from __future__ import annotations

import re
from datetime import datetime
from pathlib import Path

import fitz
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.api.deps import get_current_user
from app.config import get_settings
from app.db import session as session_mod
from app.db.models import Base, BookCategory, User, UserPermission
from app.db.session import attach_sqlite_pragmas, get_db
from app.main import create_app
from app.services import approved_import_service, perm_service


@pytest.fixture()
def api_db(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Session:
    monkeypatch.setenv("GSSG_DATA_DIR", str(tmp_path))
    get_settings.cache_clear()
    engine = create_engine(
        f"sqlite:///{tmp_path / 'api.db'}",
        future=True,
        connect_args={"check_same_thread": False},
    )
    attach_sqlite_pragmas(engine, wal=False)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, future=True)
    monkeypatch.setattr(session_mod, "engine", engine)
    monkeypatch.setattr(session_mod, "SessionLocal", factory)
    db = factory()
    perm_service.seed_role_defaults(db)
    db.add(BookCategory(id="NAT", prefix="NAT"))
    db.commit()
    monkeypatch.setattr(
        approved_import_service,
        "text_from_pdf",
        lambda _data: "Date: 05/08/2026\nInmate Name: محمد سالم ياسر",
    )
    try:
        yield db
    finally:
        db.close()
        get_settings.cache_clear()


def _user(db: Session, *, email: str, role: str = "admin") -> User:
    user = User(
        email=email,
        password_hash="x",
        display_name=email,
        role=role,
        status="active",
    )
    db.add(user)
    db.commit()
    return user


def _client(db: Session, user: User) -> TestClient:
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


def _pdf_bytes() -> bytes:
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 100), "Approved inmate report")
    data = doc.tobytes()
    doc.close()
    return data


def _inspect(client: TestClient, sample_pdf: bytes):
    return client.post(
        "/api/v1/documents/inmate-violations/approved-imports/inspect",
        files={"file": ("approved.pdf", sample_pdf, "application/pdf")},
    )


def test_inspect_serializes_extracted_metadata(api_db: Session) -> None:
    user = _user(api_db, email="admin@example.ae")
    sample_pdf = _pdf_bytes()

    response = _inspect(_client(api_db, user), sample_pdf)

    assert response.status_code == 200
    body = response.json()
    assert re.fullmatch(r"[0-9a-f]{32}", body["token"])
    assert datetime.fromisoformat(body["expires_at"])
    assert body["filename"] == "approved.pdf"
    assert body["size"] == len(sample_pdf)
    assert body["report_date"] == "2026-08-05"
    assert body["inmate_names"] == [{"name": "محمد سالم ياسر", "confidence": 0.9}]
    assert body["proposed_subject"] == "Inmate Conduct Violations — محمد سالم ياسر"
    assert body["warnings"] == []


def test_commit_returns_approved_records_handoff(api_db: Session) -> None:
    user = _user(api_db, email="admin@example.ae")
    client = _client(api_db, user)
    inspection = _inspect(client, _pdf_bytes()).json()

    response = client.post(
        "/api/v1/documents/inmate-violations/approved-imports",
        json={
            "token": inspection["token"],
            "report_date": "2026-08-05",
            "inmate_names": ["محمد سالم ياسر"],
            "subject": inspection["proposed_subject"],
        },
    )

    assert response.status_code == 201
    assert response.json() == {
        "book_id": 1,
        "document_id": 1,
        "ref_number": "NAT-0001",
        "approval_state": "approved",
    }


def test_routes_require_documents_generate(api_db: Session) -> None:
    user = _user(api_db, email="denied@example.ae", role="operator")
    api_db.add(
        UserPermission(
            user_id=user.id,
            capability="documents.generate",
            effect="deny",
        )
    )
    api_db.commit()

    response = _inspect(_client(api_db, user), _pdf_bytes())

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "FORBIDDEN"


def test_commit_rejects_another_users_token(api_db: Session) -> None:
    owner = _user(api_db, email="owner@example.ae")
    other = _user(api_db, email="other@example.ae")
    inspection = _inspect(_client(api_db, owner), _pdf_bytes()).json()

    response = _client(api_db, other).post(
        "/api/v1/documents/inmate-violations/approved-imports",
        json={
            "token": inspection["token"],
            "report_date": "2026-08-05",
            "inmate_names": ["محمد سالم ياسر"],
            "subject": inspection["proposed_subject"],
        },
    )

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "APPROVED_IMPORT_TOKEN_FORBIDDEN"
