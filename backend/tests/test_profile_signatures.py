from __future__ import annotations

import io
from pathlib import Path

import pytest
from docx import Document as DocxFile
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.api.deps import get_current_user
from app.api.errors import ValidationFailedError
from app.config import get_settings
from app.core import signature as signature_core
from app.db import session as session_mod
from app.db.models import (
    Base,
    Book,
    BookApprovalStep,
    BookCategory,
    BookVersion,
    Document,
    Employee,
    Manager,
    User,
)
from app.db.session import attach_sqlite_pragmas, get_db
from app.main import create_app
from app.services import (
    artifact_service,
    auth_service,
    book_service,
    document_service,
    manager_service,
    perm_service,
    user_signature_service,
)


@pytest.fixture()
def api_db(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Session:
    monkeypatch.setenv("GSSG_DATA_DIR", str(tmp_path))
    get_settings.cache_clear()
    engine = create_engine(
        f"sqlite:///{tmp_path / 'profile-signatures.db'}",
        future=True,
        connect_args={"check_same_thread": False},
    )
    attach_sqlite_pragmas(engine, wal=False)
    Base.metadata.create_all(engine)
    test_session = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, future=True)
    monkeypatch.setattr(session_mod, "engine", engine)
    monkeypatch.setattr(session_mod, "SessionLocal", test_session)
    db = test_session()
    perm_service.seed_role_defaults(db)
    try:
        yield db
    finally:
        db.close()
        engine.dispose()
        get_settings.cache_clear()


def _user(
    db: Session,
    role: str = "admin",
    email: str = "a@x.ae",
    *,
    employee_id: str | None = None,
) -> User:
    user = User(
        email=email,
        password_hash="x",
        role=role,
        status="active",
        employee_id=employee_id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _client(db: Session, user: User) -> TestClient:
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app, raise_server_exceptions=True)


def _png(color: tuple[int, int, int, int]) -> bytes:
    output = io.BytesIO()
    Image.new("RGBA", (80, 40), color).save(output, format="PNG")
    return output.getvalue()


def _profile(employee_id: str, data: bytes) -> Path:
    path = signature_core.employee_signature_path(get_settings().vault_dir, employee_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return path


def _signable_book(
    db: Session, tmp_path: Path, signer: User, suffix: str
) -> tuple[Book, BookVersion]:
    if db.get(BookCategory, "GS") is None:
        db.add(BookCategory(id="GS", prefix="GS"))
        db.flush()
    source = tmp_path / f"source-{suffix}.docx"
    DocxFile().save(source)
    document = Document(
        template_id="General Book",
        ref_number=f"GS-{suffix}",
        docx_path=str(source),
        submission_id=f"profile-signature-{suffix}",
        role="primary",
    )
    db.add(document)
    db.flush()
    book = Book(
        category_id="GS",
        ref_number=f"GS-{suffix}",
        subject="Profile signature test",
        approval_state="pending",
    )
    db.add(book)
    db.flush()
    version = BookVersion(
        book_id=book.id,
        version_no=1,
        document_id=document.id,
        template_id="General Book",
        fields={},
        status="pending",
    )
    db.add(version)
    db.flush()
    db.add(
        BookApprovalStep(
            book_id=book.id,
            version_id=version.id,
            step_order=1,
            stage_label="Signature",
            assignee_user_id=signer.id,
            kind="approver",
            state="pending",
        )
    )
    db.commit()
    return book, version


def test_linked_surfaces_and_book_signing_use_profile_signature(
    api_db: Session, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    profile_bytes = _png((210, 20, 20, 255))
    approval_bytes = _png((20, 180, 20, 255))
    manager_bytes = _png((20, 20, 210, 255))
    employee = Employee(id="G1001", name_en="Unified Signer")
    api_db.add(employee)
    api_db.flush()
    approval_path = tmp_path / "legacy" / "approval.png"
    approval_path.parent.mkdir(parents=True)
    approval_path.write_bytes(approval_bytes)
    signer = User(
        email="signer@x.ae",
        password_hash="x",
        role="manager",
        status="active",
        employee_id=employee.id,
        signature_path=str(approval_path),
    )
    api_db.add(signer)
    api_db.flush()
    manager_path = tmp_path / "legacy" / "manager.png"
    manager_path.write_bytes(manager_bytes)
    manager = Manager(
        name_en="Unified Signer",
        user_id=signer.id,
        sig_path=str(manager_path),
    )
    api_db.add(manager)
    api_db.commit()
    profile_path = _profile(employee.id, profile_bytes)

    user_client = _client(api_db, signer)
    admin_client = _client(api_db, _user(api_db, email="admin-unified@x.ae"))
    assert user_client.get("/api/v1/signatures/me").content == profile_bytes
    assert admin_client.get(f"/api/v1/employees/{employee.id}/signature").content == profile_bytes
    assert admin_client.get(f"/api/v1/managers/{manager.id}/signature").content == profile_bytes
    assert user_client.get("/api/v1/auth/me").json()["has_signature"] is True

    perm_service.set_user_override(api_db, signer.id, "books.approve", "grant")
    api_db.commit()
    assert auth_service.set_default_manager(api_db, signer.id, enabled=True).is_default_manager

    book, version = _signable_book(api_db, tmp_path, signer, "profile-wins")
    rendered = tmp_path / "signed-profile-wins.docx"
    DocxFile().save(rendered)
    captured: dict[str, str] = {}

    def render(*_args: object, **kwargs: object) -> artifact_service.ArtifactResult:
        captured["signature"] = str(kwargs["signer_signature_path"])
        return artifact_service.ArtifactResult(
            docx_path=rendered,
            conversion=artifact_service.ConversionOutcome(status="unavailable"),
            created_paths=(rendered,),
        )

    monkeypatch.setattr(document_service, "render_signed_artifact", render)
    signed = book_service.sign_book(api_db, book.id, user_id=signer.id, version_id=version.id)
    assert signed.approval_state == "approved"
    assert Path(captured["signature"]) == profile_path
    assert profile_path.read_bytes() != approval_bytes
    assert profile_path.read_bytes() != manager_bytes


def test_profile_only_employee_and_linked_manager_generate_duty_resumption(
    api_db: Session, tmp_path: Path
) -> None:
    profile_only = Employee(id="G2001", name_en="Profile Only")
    manager_employee = Employee(id="G2002", name_en="Profile Manager")
    api_db.add_all([profile_only, manager_employee])
    api_db.commit()
    profile_only_bytes = _png((130, 40, 180, 255))
    manager_profile_bytes = _png((240, 140, 20, 255))
    _profile(profile_only.id, profile_only_bytes)
    manager_profile = _profile(manager_employee.id, manager_profile_bytes)

    admin = _user(api_db, email="admin-profile-only@x.ae")
    response = _client(api_db, admin).get(f"/api/v1/employees/{profile_only.id}/signature")
    assert response.status_code == 200
    assert response.content == profile_only_bytes

    linked_user = _user(
        api_db,
        role="manager",
        email="profile-manager@x.ae",
        employee_id=manager_employee.id,
    )
    manager = Manager(name_en="Profile Manager", user_id=linked_user.id)
    api_db.add(manager)
    api_db.commit()
    api_db.refresh(manager)
    assert manager_service.has_signature(api_db, manager) is True
    assert manager_service.signature_path(api_db, manager) == manager_profile

    result = document_service.generate_document(
        api_db,
        employee_id=profile_only.id,
        template_id="Duty Resumption Form",
        fields={},
        manager_id=manager.id,
        embed_signature={"manager": True},
        commit=False,
        converter=lambda _path: None,
    )
    assert result.docx_path.is_file()


def test_replace_and_delete_propagate_to_every_linked_surface(
    api_db: Session, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    employee = Employee(id="G3001", name_en="Replace Signer")
    api_db.add(employee)
    api_db.flush()
    signer = User(
        email="replace-signer@x.ae",
        password_hash="x",
        role="manager",
        status="active",
        employee_id=employee.id,
    )
    api_db.add(signer)
    api_db.flush()
    stale_manager = tmp_path / "legacy-manager.png"
    stale_manager.write_bytes(_png((30, 30, 30, 255)))
    manager = Manager(
        name_en="Replace Signer",
        user_id=signer.id,
        sig_path=str(stale_manager),
    )
    api_db.add(manager)
    api_db.commit()
    _profile(employee.id, _png((100, 100, 100, 255)))

    user_client = _client(api_db, signer)
    admin_client = _client(api_db, _user(api_db, email="admin-replace@x.ae"))
    replacement_self = _png((0, 150, 210, 255))
    response = user_client.post(
        "/api/v1/auth/me/signature",
        files={"file": ("self.png", replacement_self, "image/png")},
    )
    assert response.status_code == 200, response.text
    assert (
        admin_client.get(f"/api/v1/employees/{employee.id}/signature").content == replacement_self
    )

    replacement_manager = _png((230, 80, 130, 255))
    response = admin_client.post(
        f"/api/v1/managers/{manager.id}/signature",
        files={"file": ("manager.png", replacement_manager, "image/png")},
    )
    assert response.status_code == 201, response.text
    assert user_client.get("/api/v1/signatures/me").content == replacement_manager

    assert admin_client.delete(f"/api/v1/employees/{employee.id}/signature").status_code == 204
    assert user_client.get("/api/v1/signatures/me").status_code == 404
    assert admin_client.get(f"/api/v1/employees/{employee.id}/signature").status_code == 404
    assert admin_client.get(f"/api/v1/managers/{manager.id}/signature").status_code == 404
    assert user_client.get("/api/v1/auth/me").json()["has_signature"] is False
    assert stale_manager.is_file()

    perm_service.set_user_override(api_db, signer.id, "books.approve", "grant")
    api_db.commit()
    book, version = _signable_book(api_db, tmp_path, signer, "deleted")

    def should_not_render(*_args: object, **_kwargs: object) -> artifact_service.ArtifactResult:
        raise AssertionError("should not be called")

    monkeypatch.setattr(document_service, "render_signed_artifact", should_not_render)
    with pytest.raises(ValidationFailedError) as error:
        book_service.sign_book(api_db, book.id, user_id=signer.id, version_id=version.id)
    assert error.value.code == "NO_SIGNATURE"


def test_unlinked_user_and_standalone_manager_remain_isolated(api_db: Session) -> None:
    unlinked = _user(
        api_db,
        role="manager",
        email="unlinked-signature@x.ae",
    )
    account_bytes = _png((20, 190, 170, 255))
    user_signature_service.save_signature(api_db, unlinked, "account.png", account_bytes)

    same_name_employee = Employee(id="G4001", name_en="Same Name")
    missing_employee = Employee(id="G4002", name_en="Missing Profile")
    api_db.add_all([same_name_employee, missing_employee])
    api_db.commit()
    employee_profile = _profile(same_name_employee.id, _png((180, 30, 180, 255)))

    standalone = Manager(name_en=same_name_employee.name_en, user_id=None)
    api_db.add(standalone)
    api_db.commit()
    standalone_bytes = _png((220, 200, 40, 255))
    standalone_path = manager_service.save_manager_signature(
        api_db, standalone.id, standalone_bytes
    )
    api_db.refresh(standalone)

    response = _client(api_db, unlinked).get("/api/v1/signatures/me")
    assert response.status_code == 200
    assert response.content == account_bytes
    assert manager_service.has_signature(api_db, standalone) is True
    assert manager_service.signature_path(api_db, standalone) == standalone_path
    assert standalone_path.read_bytes() == standalone_bytes
    assert standalone_path != employee_profile

    missing = _user(
        api_db,
        role="manager",
        email="missing-profile@x.ae",
        employee_id=missing_employee.id,
    )
    assert user_signature_service.resolve_signature(missing) is None
    assert _client(api_db, missing).get("/api/v1/auth/me").json()["has_signature"] is False
    assert _client(api_db, unlinked).get("/api/v1/signatures/me").content == account_bytes


def test_consolidation_migrates_once_and_never_resurrects_cleared_pointer(
    api_db: Session, tmp_path: Path
) -> None:
    employee = Employee(id="G5001", name_en="Migration Signer")
    api_db.add(employee)
    api_db.flush()
    source_bytes = _png((60, 100, 230, 255))
    source = tmp_path / "legacy" / "approval-only.png"
    source.parent.mkdir(parents=True)
    source.write_bytes(source_bytes)
    user = User(
        email="migration@x.ae",
        password_hash="x",
        role="manager",
        status="active",
        employee_id=employee.id,
        signature_path=str(source),
    )
    api_db.add(user)
    api_db.commit()

    migrated = user_signature_service.consolidate_employee_signatures(
        api_db, employee.id, data_dir=tmp_path, apply=True
    )
    assert migrated["status"] == "migrated"
    assert migrated["source"] == "user"
    profile_path = Path(str(migrated["profile_path"]))
    assert profile_path.read_bytes() == source_bytes
    api_db.commit()
    api_db.refresh(user)
    assert user.signature_path is None

    before = profile_path.read_bytes()
    rerun = user_signature_service.consolidate_employee_signatures(
        api_db, employee.id, data_dir=tmp_path, apply=True
    )
    assert rerun["status"] == "profile_kept"
    assert rerun["cleared"] == []
    assert profile_path.read_bytes() == before

    profile_path.unlink()
    missing = user_signature_service.consolidate_employee_signatures(
        api_db, employee.id, data_dir=tmp_path, apply=True
    )
    assert missing["status"] == "missing"
    assert not profile_path.exists()
