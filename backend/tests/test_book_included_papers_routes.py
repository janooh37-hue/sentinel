from __future__ import annotations

import base64
import uuid
from pathlib import Path

import fitz
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.api.deps import get_current_user
from app.config import get_settings
from app.db import session as session_mod
from app.db.models import (
    Base,
    Book,
    BookApprovalStep,
    BookCategory,
    BookVersion,
    Document,
    User,
)
from app.db.session import attach_sqlite_pragmas, get_db
from app.main import create_app
from app.services import included_papers_service, perm_service, staging_service


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
    session_factory = sessionmaker(
        bind=engine, autoflush=False, expire_on_commit=False, future=True
    )
    monkeypatch.setattr(session_mod, "engine", engine)
    monkeypatch.setattr(session_mod, "SessionLocal", session_factory)
    db = session_factory()
    perm_service.seed_role_defaults(db)
    try:
        yield db
    finally:
        db.close()
        get_settings.cache_clear()


def _pdf(path: Path, labels: list[str]) -> Path:
    doc = fitz.open()
    try:
        for label in labels:
            page = doc.new_page(width=300, height=400)
            page.insert_text((40, 80), label)
        doc.save(path)
    finally:
        doc.close()
    return path


def _texts(data: bytes) -> list[str]:
    with fitz.open("pdf", data) as doc:
        return [page.get_text().strip() for page in doc]


def _client(db: Session, user: User) -> TestClient:
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app, raise_server_exceptions=True)


def _record(db: Session, tmp_path: Path) -> tuple[Book, BookVersion, Document, User, User]:
    creator = User(
        email="creator@example.ae",
        password_hash="x",
        role="operator",
        status="active",
        display_name="Record creator",
    )
    viewer = User(
        email="viewer@example.ae",
        password_hash="x",
        role="manager",
        status="active",
        display_name="Other manager",
    )
    db.add_all([creator, viewer, BookCategory(id="HR", prefix="HR")])
    db.flush()
    fixed = _pdf(tmp_path / "fixed.pdf", ["FORM", "COMPANION"])
    companion = _pdf(tmp_path / "companion.pdf", ["COMPANION"])
    paper = _pdf(tmp_path / "paper.pdf", ["PAPER"])
    published = _pdf(tmp_path / "published.pdf", ["FORM", "COMPANION", "PAPER"])
    document = Document(
        employee_id=None,
        template_id="General Book",
        ref_number="HR-1",
        docx_path="source.docx",
        pdf_path=published.relative_to(tmp_path).as_posix(),
        base_pdf_path=fixed.relative_to(tmp_path).as_posix(),
        submission_id="submission-1",
        role="primary",
    )
    db.add(document)
    db.flush()
    db.add(
        Document(
            employee_id=None,
            template_id="Leave Undertaking",
            ref_number="HR-1",
            docx_path="companion.docx",
            pdf_path=companion.relative_to(tmp_path).as_posix(),
            submission_id="submission-1",
            role="companion",
        )
    )
    book = Book(
        category_id="HR",
        ref_number="HR-1",
        subject="Test record",
        approval_state="none",
        merged_attachment_paths=[
            {
                "path": paper.relative_to(tmp_path).as_posix(),
                "slot_key": "medical_certificate",
            }
        ],
    )
    db.add(book)
    db.flush()
    version = BookVersion(
        book_id=book.id,
        version_no=1,
        document_id=document.id,
        template_id="General Book",
        fields={"subject": "Test record"},
        status="none",
        created_by_user_id=creator.id,
    )
    db.add(version)
    db.commit()
    db.refresh(book)
    db.refresh(version)
    return book, version, document, creator, viewer


def test_detail_exposes_package_state_but_list_keeps_heavy_fields_empty(
    api_db: Session, monkeypatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("GSSG_DATA_DIR", str(tmp_path))
    get_settings.cache_clear()
    book, _version, _document, creator, _viewer = _record(api_db, tmp_path)
    client = _client(api_db, creator)

    detail = client.get(f"/api/v1/books/{book.id}")
    listing = client.get("/api/v1/books")

    assert detail.status_code == 200, detail.text
    body = detail.json()
    assert body["original_creator_user_id"] == creator.id
    assert body["included_papers_revision"] == 0
    assert body["included_papers_fixed_page_count"] == 2
    assert body["included_papers_total_page_count"] == 3
    assert body["included_papers"][0]["original_name"] == "paper.pdf"
    assert body["included_papers"][0]["slot_key"] == "medical_certificate"
    assert body["included_papers"][0]["page_start"] == 3
    assert body["included_papers_history"] == []

    assert listing.status_code == 200, listing.text
    listed = next(item for item in listing.json()["items"] if item["id"] == book.id)
    assert listed["original_creator_user_id"] == creator.id
    assert listed["included_papers"] == []
    assert listed["included_papers_history"] == []
    get_settings.cache_clear()


def test_preview_save_and_download_use_one_package_without_duplicate_companion(
    api_db: Session, monkeypatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("GSSG_DATA_DIR", str(tmp_path))
    get_settings.cache_clear()
    book, _version, document, creator, viewer = _record(api_db, tmp_path)
    creator_client = _client(api_db, creator)
    viewer_client = _client(api_db, viewer)
    opened = creator_client.get(f"/api/v1/books/{book.id}").json()
    existing = opened["included_papers"][0]
    late = _pdf(tmp_path / "late.pdf", ["LATE-1", "LATE-2"])
    staged = staging_service.stage(late.read_bytes(), "late.pdf")
    proposal = {
        "revision": 0,
        "items": [
            {"id": existing["id"]},
            {
                "id": str(uuid.uuid4()),
                "staged_token": staged.token,
                "original_name": "late.pdf",
            },
        ],
    }

    forbidden = viewer_client.post(
        f"/api/v1/books/{book.id}/included-papers/preview", json=proposal
    )
    assert forbidden.status_code == 403
    assert forbidden.json()["error"]["code"] == "INCLUDED_PAPERS_CREATOR_ONLY"

    preview = creator_client.post(f"/api/v1/books/{book.id}/included-papers/preview", json=proposal)
    assert preview.status_code == 200, preview.text
    preview_body = preview.json()
    assert _texts(base64.b64decode(preview_body["pdf_base64"])) == [
        "FORM",
        "COMPANION",
        "PAPER",
        "LATE-1",
        "LATE-2",
    ]
    assert preview_body["fixed_page_count"] == 2
    assert preview_body["total_page_count"] == 5

    before_download = creator_client.get(f"/api/v1/documents/{document.id}/download?format=pdf")
    assert before_download.status_code == 200
    before_disposition = before_download.headers["content-disposition"]

    saved = creator_client.put(f"/api/v1/books/{book.id}/included-papers", json=proposal)
    assert saved.status_code == 200, saved.text
    saved_body = saved.json()
    assert saved_body["included_papers_revision"] == 1
    assert [item["original_name"] for item in saved_body["included_papers"]] == [
        "paper.pdf",
        "late.pdf",
    ]
    assert len(saved_body["included_papers_history"]) == 1
    assert saved_body["included_papers_history"][0]["revision_after"] == 1

    stale = creator_client.put(f"/api/v1/books/{book.id}/included-papers", json=proposal)
    assert stale.status_code == 409
    assert stale.json()["error"]["code"] == "INCLUDED_PAPERS_STALE_REVISION"

    after_download = creator_client.get(f"/api/v1/documents/{document.id}/download?format=pdf")
    assert after_download.status_code == 200
    assert after_download.headers["content-disposition"] == before_disposition
    assert _texts(after_download.content) == [
        "FORM",
        "COMPANION",
        "PAPER",
        "LATE-1",
        "LATE-2",
    ]
    get_settings.cache_clear()


def test_save_notifies_each_approver_after_an_approved_package_change(
    api_db: Session, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    book, version, _document, creator, manager = _record(api_db, tmp_path)
    book.approval_state = "approved"
    version.status = "approved"
    api_db.add(
        BookApprovalStep(
            book_id=book.id,
            version_id=version.id,
            step_order=1,
            stage_label="Manager approval",
            assignee_user_id=manager.id,
            kind="approver",
            state="approved",
        )
    )
    api_db.commit()
    client = _client(api_db, creator)
    existing = client.get(f"/api/v1/books/{book.id}").json()["included_papers"][0]
    late = _pdf(tmp_path / "late-notification.pdf", ["LATE"])
    staged = staging_service.stage(late.read_bytes(), late.name)
    sent: list[int] = []
    monkeypatch.setattr(
        included_papers_service.push_service,
        "send_to_user",
        lambda _db, user_id, _messages, url: sent.append(user_id),
    )

    response = client.put(
        f"/api/v1/books/{book.id}/included-papers",
        json={
            "revision": 0,
            "items": [
                {"id": existing["id"]},
                {
                    "id": str(uuid.uuid4()),
                    "staged_token": staged.token,
                    "original_name": late.name,
                },
            ],
        },
    )

    assert response.status_code == 200, response.text
    assert sent == [manager.id]
