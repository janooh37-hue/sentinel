from __future__ import annotations

from datetime import date
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.models import Document, EmailAccount, Employee, LedgerEntry, User, UserPermission
from app.db.session import get_db
from app.main import create_app
from app.services import book_service, document_service


@pytest.fixture()
def outlook_client(api_db: Session) -> tuple[TestClient, User]:
    user = User(email="owner@example.test", password_hash="x", role="operator", status="active")
    other = User(email="other@example.test", password_hash="x", role="operator", status="active")
    api_db.add_all([user, other])
    api_db.flush()
    api_db.add(
        EmailAccount(
            email=user.email,
            imap_host="imap.ionos.com",
            imap_port=993,
            use_ssl=True,
            smtp_host="smtp.ionos.com",
            smtp_port=465,
            smtp_use_tls=True,
            username=user.email,
            password_encrypted="secret",
            owner_user_id=user.id,
        )
    )
    api_db.add(Employee(id="G3082", name_en="Alice", name_ar="Alice", status="Active"))
    api_db.add(
        LedgerEntry(
            entry_date=date.today(),
            direction="in",
            channel="email",
            counterparty="sender@example.test",
            subject="Hello",
            message_id="<message-1>",
            owner_user_id=user.id,
        )
    )
    api_db.commit()

    app = create_app()
    app.dependency_overrides[get_db] = lambda: api_db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app), user


def test_pair_and_use_device_without_browser_session(
    outlook_client: tuple[TestClient, User],
) -> None:
    client, _ = outlook_client
    response = client.post("/api/v1/outlook/pairings", json={})
    assert response.status_code == 200, response.text
    pair_token = response.json()["token"]

    paired = client.post(
        "/api/v1/outlook/device/pair",
        json={
            "token": pair_token,
            "device_id": "pc-1",
            "device_label": "HR-01",
            "mailbox_address": "OWNER@EXAMPLE.TEST",
        },
    )
    assert paired.status_code == 200, paired.text
    credential = paired.json()["credential"]

    employees = client.get(
        "/api/v1/outlook/device/employees?q=Alice&limit=10",
        headers={"Authorization": f"Bearer {credential}"},
    )
    assert employees.status_code == 200, employees.text
    assert employees.json()[0]["employee_id"] == "G3082"


def test_device_employee_visibility_uses_owner_capability(
    outlook_client: tuple[TestClient, User], api_db: Session
) -> None:
    client, user = outlook_client
    pair = client.post("/api/v1/outlook/pairings", json={}).json()["token"]
    credential = client.post(
        "/api/v1/outlook/device/pair",
        json={
            "token": pair,
            "device_id": "pc-1",
            "device_label": "HR-01",
            "mailbox_address": "owner@example.test",
        },
    ).json()["credential"]
    api_db.add(UserPermission(user_id=user.id, capability="employees.view", effect="deny"))
    api_db.commit()
    headers = {"Authorization": f"Bearer {credential}"}
    assert client.get("/api/v1/outlook/device/employees", headers=headers).status_code == 403
    assert (
        client.get("/api/v1/outlook/device/employees/G3082/photo", headers=headers).status_code
        == 403
    )


def test_attachment_handoff_checks_capability_before_document_id(
    outlook_client: tuple[TestClient, User], api_db: Session
) -> None:
    client, user = outlook_client
    api_db.add(UserPermission(user_id=user.id, capability="documents.generate", effect="deny"))
    api_db.commit()
    response = client.post(
        "/api/v1/outlook/handoffs",
        json={
            "kind": "compose",
            "payload": {
                "to": ["recipient@example.test"],
                "subject": "x",
                "body_html": "<p>x</p>",
                "basket_key": "b",
                "attachments": [
                    {"kind": "document_pdf", "document_id": 99999, "filename": "x.pdf"}
                ],
            },
        },
    )
    assert response.status_code == 403, response.text


def test_locked_pdf_keeps_books_view_and_missing_id_is_oracle_safe(
    outlook_client: tuple[TestClient, User], api_db: Session, tmp_path, monkeypatch
) -> None:
    client, user = outlook_client
    api_db.add(UserPermission(user_id=user.id, capability="documents.generate", effect="deny"))
    document = Document(
        employee_id=None,
        template_id="General Book",
        ref_number="R-1",
        pdf_path="signed.pdf",
        submission_id="submission-1",
    )
    api_db.add(document)
    api_db.commit()
    api_db.refresh(document)
    (tmp_path / "signed.pdf").write_bytes(b"%PDF-signed")
    monkeypatch.setattr(
        document_service, "get_settings", lambda: SimpleNamespace(data_dir=tmp_path)
    )
    monkeypatch.setattr(
        book_service,
        "is_document_signed_locked",
        lambda _db, document_id: (document_id == document.id, "signed.pdf"),
    )

    payload = {
        "kind": "compose",
        "payload": {
            "to": ["recipient@example.test"],
            "subject": "x",
            "body_html": "<p>x</p>",
            "basket_key": "b",
            "attachments": [
                {"kind": "document_pdf", "document_id": document.id, "filename": "x.pdf"}
            ],
        },
    }
    allowed = client.post("/api/v1/outlook/handoffs", json=payload)
    assert allowed.status_code == 200, allowed.text

    missing = {
        **payload,
        "payload": {
            **payload["payload"],
            "attachments": [{"kind": "document_pdf", "document_id": 99999, "filename": "x.pdf"}],
        },
    }
    denied = client.post("/api/v1/outlook/handoffs", json=missing)
    assert denied.status_code == 403, denied.text


def test_device_router_requires_bearer_and_browser_router_requires_session(
    outlook_client: tuple[TestClient, User],
) -> None:
    client, _ = outlook_client
    assert client.get("/api/v1/outlook/device/employees").status_code == 401
    app = client.app
    app.dependency_overrides.pop(get_current_user, None)
    assert client.post("/api/v1/outlook/pairings", json={}).status_code == 401


def test_selection_and_manual_link_are_mailbox_scoped(
    outlook_client: tuple[TestClient, User],
) -> None:
    client, _ = outlook_client
    pair = client.post("/api/v1/outlook/pairings", json={}).json()["token"]
    credential = client.post(
        "/api/v1/outlook/device/pair",
        json={
            "token": pair,
            "device_id": "pc-1",
            "device_label": "HR-01",
            "mailbox_address": "owner@example.test",
        },
    ).json()["credential"]
    headers = {"Authorization": f"Bearer {credential}"}
    selection = client.post(
        "/api/v1/outlook/device/selection",
        headers=headers,
        json={
            "internet_message_id": "<unknown>",
            "outlook_store_id": "store",
            "outlook_entry_id": "entry",
            "g_numbers": ["G3082"],
        },
    )
    assert selection.status_code == 200, selection.text
    assert selection.json()["recording_pending"] is True
    assert (
        client.put(
            "/api/v1/outlook/device/messages/999/employees/G3082", headers=headers
        ).status_code
        == 404
    )


def test_typed_attachment_does_not_accept_path_or_url(
    outlook_client: tuple[TestClient, User],
) -> None:
    client, _ = outlook_client
    invalid = client.post(
        "/api/v1/outlook/handoffs",
        json={
            "kind": "compose",
            "payload": {
                "to": ["recipient@example.test"],
                "subject": "x",
                "body_html": "<p>x</p>",
                "basket_key": "b",
                "attachments": [
                    {
                        "kind": "document_pdf",
                        "document_id": 1,
                        "filename": "secret.pdf",
                        "path": "C:/secret.pdf",
                    }
                ],
            },
        },
    )
    assert invalid.status_code == 422


def test_open_handoff_redeems_and_erases_payload(
    outlook_client: tuple[TestClient, User],
) -> None:
    client, _ = outlook_client
    created = client.post(
        "/api/v1/outlook/handoffs",
        json={"kind": "open", "payload": {"ledger_entry_id": 1}},
    )
    assert created.status_code == 200, created.text
    handoff = created.json()
    pair = client.post("/api/v1/outlook/pairings", json={}).json()["token"]
    credential = client.post(
        "/api/v1/outlook/device/pair",
        json={
            "token": pair,
            "device_id": "pc-1",
            "device_label": "HR-01",
            "mailbox_address": "owner@example.test",
        },
    ).json()["credential"]
    headers = {"Authorization": f"Bearer {credential}"}
    redeemed = client.post(
        "/api/v1/outlook/device/handoffs/redeem",
        headers=headers,
        json={"token": handoff["token"]},
    )
    assert redeemed.status_code == 200, redeemed.text
    assert redeemed.json()["payload"]["ledger_entry_id"] == 1
    completed = client.post(
        f"/api/v1/outlook/device/handoffs/{handoff['id']}/complete",
        headers=headers,
    )
    assert completed.status_code == 200, completed.text
    assert completed.json()["payload"] is None
    assert (
        client.post(
            "/api/v1/outlook/device/handoffs/redeem",
            headers=headers,
            json={"token": handoff["token"]},
        ).status_code
        == 401
    )


def test_revoked_device_cannot_redeem_handoff(
    outlook_client: tuple[TestClient, User],
) -> None:
    client, _ = outlook_client
    handoff = client.post(
        "/api/v1/outlook/handoffs",
        json={"kind": "open", "payload": {"ledger_entry_id": 1}},
    ).json()
    pair = client.post("/api/v1/outlook/pairings", json={}).json()["token"]
    paired = client.post(
        "/api/v1/outlook/device/pair",
        json={
            "token": pair,
            "device_id": "pc-1",
            "device_label": "HR-01",
            "mailbox_address": "owner@example.test",
        },
    ).json()
    headers = {"Authorization": f"Bearer {paired['credential']}"}
    assert client.delete("/api/v1/outlook/devices/pc-1").status_code == 204
    assert (
        client.post(
            "/api/v1/outlook/device/handoffs/redeem",
            headers=headers,
            json={"token": handoff["token"]},
        ).status_code
        == 401
    )
