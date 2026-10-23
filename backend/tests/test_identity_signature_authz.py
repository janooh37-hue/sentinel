"""Employee identity claims and manager aliases cannot bypass signature authority."""

from __future__ import annotations

import io
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.config import get_settings
from app.core.signature import employee_signature_path
from app.db.models import Employee, Manager, User
from app.db.session import get_db
from app.main import create_app
from app.services import perm_service


@pytest.fixture()
def data_dir(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Iterator[Path]:
    monkeypatch.setenv("GSSG_DATA_DIR", str(tmp_path))
    get_settings.cache_clear()
    yield tmp_path
    get_settings.cache_clear()


def _png(color: str) -> bytes:
    output = io.BytesIO()
    Image.new("RGBA", (80, 40), color).save(output, format="PNG")
    return output.getvalue()


def _user(
    db: Session, email: str, *, role: str = "operator", employee_id: str | None = None
) -> User:
    user = User(email=email, password_hash="x", role=role, status="active", employee_id=employee_id)
    db.add(user)
    db.commit()
    return user


def _client(db: Session, user: User) -> TestClient:
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


def _snapshot(db: Session, data_dir: Path) -> dict[str, object]:
    db.expire_all()
    return {
        "users": [
            (u.id, u.employee_id, u.signature_path)
            for u in db.scalars(select(User).order_by(User.id))
        ],
        "managers": [
            (m.id, m.name_en, m.user_id, m.sig_path)
            for m in db.scalars(select(Manager).order_by(Manager.id))
        ],
        "files": {
            str(p.relative_to(data_dir)): p.read_bytes()
            for root in (data_dir / "vault", data_dir / "signatures")
            for p in root.rglob("*")
            if p.is_file()
        },
    }


def test_unlinked_account_cannot_claim_or_access_another_employee_signature(
    api_db: Session, data_dir: Path
) -> None:
    api_db.add(Employee(id="G-2", name_en="Victim"))
    api_db.commit()
    victim = _user(api_db, "victim@x.ae", employee_id="G-2")
    attacker = _user(api_db, "attacker@x.ae")
    admin = _user(api_db, "admin@x.ae", role="admin")
    profile = employee_signature_path(get_settings().vault_dir, "G-2")
    profile.parent.mkdir(parents=True, exist_ok=True)
    original = _png("red")
    profile.write_bytes(original)
    client = _client(api_db, attacker)
    before = _snapshot(api_db, data_dir)

    claim = client.post("/api/v1/auth/me/link", json={"employee_id": "G-2"})
    # The existing frontend GET catchall makes removed POST routes return 405.
    assert claim.status_code == 405
    assert _snapshot(api_db, data_dir) == before
    assert client.get("/api/v1/signatures/me").status_code == 404
    # An unlinked account may still manage its own isolated signature.
    assert (
        client.post(
            "/api/v1/auth/me/signature", files={"file": ("sig.png", _png("blue"), "image/png")}
        ).status_code
        == 200
    )
    assert client.get("/api/v1/signatures/me").content != original
    assert profile.read_bytes() == original
    assert client.delete("/api/v1/auth/me/signature").status_code == 204
    assert profile.read_bytes() == original
    api_db.refresh(attacker)
    assert attacker.employee_id is None
    assert _client(api_db, victim).get("/api/v1/signatures/me").content == original

    # The reviewed admin flow remains the only way to assign employee identity.
    assert (
        _client(api_db, admin)
        .patch(f"/api/v1/auth/users/{attacker.id}/link", json={"employee_id": "G-2"})
        .status_code
        == 200
    )
    assert client.get("/api/v1/signatures/me").content == original
    replacement = _png("green")
    assert (
        client.post(
            "/api/v1/auth/me/signature", files={"file": ("sig.png", replacement, "image/png")}
        ).status_code
        == 200
    )
    assert profile.read_bytes() == replacement
    assert client.delete("/api/v1/auth/me/signature").status_code == 204
    assert not profile.exists()


@pytest.mark.parametrize("profile_exists", [True, False])
@pytest.mark.parametrize(
    "operation", ["create", "link", "relink", "unlink", "same_link", "upload", "delete"]
)
def test_employee_linked_manager_mutations_require_employee_edit_before_any_changes(
    api_db: Session, data_dir: Path, profile_exists: bool, operation: str
) -> None:
    api_db.add(Employee(id="G-2", name_en="Victim"))
    api_db.commit()
    victim = _user(api_db, "victim@x.ae", employee_id="G-2")
    other = _user(api_db, "other@x.ae")
    editor = _user(api_db, "settings@x.ae")
    authorized = _user(api_db, "both@x.ae")
    for user in (editor, authorized):
        perm_service.set_user_override(api_db, user.id, "settings.edit", "grant")
    perm_service.set_user_override(api_db, editor.id, "employees.edit", "deny")
    perm_service.set_user_override(api_db, authorized.id, "employees.edit", "grant")
    profile = employee_signature_path(get_settings().vault_dir, "G-2")
    original = _png("red")
    if profile_exists:
        profile.parent.mkdir(parents=True, exist_ok=True)
        profile.write_bytes(original)
    # Missing profiles exercise link-time migration, not only profile_kept.
    legacy = data_dir / "signatures" / "legacy.png"
    legacy.parent.mkdir(parents=True, exist_ok=True)
    legacy.write_bytes(original)
    victim.signature_path = "signatures/legacy.png"
    manager = Manager(
        name_en="Victim alias",
        user_id=victim.id
        if operation in {"relink", "unlink", "same_link", "upload", "delete"}
        else None,
        sig_path=str(legacy),
    )
    api_db.add(manager)
    api_db.commit()
    before = _snapshot(api_db, data_dir)

    def mutate(client: TestClient):
        if operation == "create":
            return client.post(
                "/api/v1/managers", json={"name_en": "New alias", "user_id": victim.id}
            )
        if operation in {"upload", "delete"}:
            url = f"/api/v1/managers/{manager.id}/signature"
            if operation == "delete":
                return client.delete(url)
            return client.post(url, files={"file": ("sig.png", _png("blue"), "image/png")})
        target = other.id if operation == "relink" else None if operation == "unlink" else victim.id
        return client.patch(
            f"/api/v1/managers/{manager.id}", json={"name_en": "Changed", "user_id": target}
        )

    response = mutate(_client(api_db, editor))
    assert response.status_code == 403
    assert response.json()["error"]["details"]["capability"] == "employees.edit"
    assert _snapshot(api_db, data_dir) == before
    assert profile.read_bytes() == original if profile_exists else not profile.exists()

    allowed = mutate(_client(api_db, authorized))
    assert allowed.status_code == (
        201 if operation in {"create", "upload"} else 204 if operation == "delete" else 200
    ), allowed.text
    if operation == "upload":
        assert profile.read_bytes() == _png("blue")
    elif operation == "delete":
        assert not profile.exists()
    elif operation in {"create", "link", "same_link"}:
        assert profile.read_bytes() == original


def test_settings_only_editor_can_manage_standalone_manager_signature(
    api_db: Session, data_dir: Path
) -> None:
    editor = _user(api_db, "settings@x.ae")
    perm_service.set_user_override(api_db, editor.id, "settings.edit", "grant")
    perm_service.set_user_override(api_db, editor.id, "employees.edit", "deny")
    client = _client(api_db, editor)
    response = client.post("/api/v1/managers", json={"name_en": "Standalone"})
    assert response.status_code == 201
    manager_id = response.json()["id"]
    assert (
        client.patch(f"/api/v1/managers/{manager_id}", json={"title": "Director"}).status_code
        == 200
    )
    signature = _png("blue")
    url = f"/api/v1/managers/{manager_id}/signature"
    assert client.post(url, files={"file": ("sig.png", signature, "image/png")}).status_code == 201
    assert client.get(url).content == signature
    assert client.delete(url).status_code == 204
    assert client.get(url).status_code == 404
