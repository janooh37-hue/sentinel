from __future__ import annotations

import imaplib
import json
import threading
from collections.abc import Iterator
from datetime import UTC, date, datetime
from email import policy
from email.message import EmailMessage
from email.parser import BytesParser
from email.utils import getaddresses
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker

from app.api.deps import get_current_user
from app.config import get_settings
from app.core import crypto
from app.db.models import AppSetting, EmailAccount, LedgerEntry, User, UserPermission
from app.db.session import get_db
from app.main import create_app
from app.services import email_service, ledger_service, scheduler_service, smart_folder_service
from tests.fakes.imap import FakeImapConnection, FakeImapServer


@pytest.fixture(autouse=True)
def _forbid_external_imap(monkeypatch: pytest.MonkeyPatch) -> None:
    def blocked(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("tests must inject FakeImapServer.connector")

    monkeypatch.setattr(imaplib, "IMAP4", blocked)
    monkeypatch.setattr(imaplib, "IMAP4_SSL", blocked)


def _user(db: Session, *, email: str = "draft-route-user@test.ae") -> User:
    user = User(
        email=email,
        password_hash="x",
        role="operator",
        status="active",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _account(db: Session, user: User) -> EmailAccount:
    account = EmailAccount(
        email="sender@gssg.ae",
        imap_host="imap.ionos.com",
        imap_port=993,
        use_ssl=True,
        username="sender@gssg.ae",
        password_encrypted="unused-by-fake-imap",
        smtp_host="smtp.ionos.com",
        smtp_port=587,
        smtp_use_tls=True,
        sent_folder="Sent",
        drafts_folder="Outlook Drafts",
        inbox_folder="INBOX",
        enabled=True,
        sync_interval_minutes=5,
        owner_user_id=user.id,
    )
    db.add(account)
    db.commit()
    db.refresh(account)
    return account


def _ledger_email(
    db: Session,
    *,
    owner_user_id: int,
    subject: str,
    counterparty: str,
) -> LedgerEntry:
    row = LedgerEntry(
        entry_date=date(2026, 9, 5),
        direction="incoming",
        channel="email",
        counterparty=counterparty,
        subject=subject,
        tags=["email"],
        attachment_paths=[],
        owner_user_id=owner_user_id,
        to_recipients=[],
        cc_recipients=[],
        bcc_recipients=[],
    )
    db.add(row)
    db.flush()
    return row


@pytest.fixture()
def isolated_data_dir(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Iterator[Path]:
    monkeypatch.setenv("GSSG_DATA_DIR", str(tmp_path))
    get_settings.cache_clear()
    crypto._load_or_create_key.cache_clear()
    yield tmp_path
    get_settings.cache_clear()
    crypto._load_or_create_key.cache_clear()


def test_draft_handoff_preserves_http_ledger_file_and_server_message(
    api_db: Session,
    isolated_data_dir: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = _user(api_db)
    account = _account(api_db, user)
    signature = "<p>Kind regards,<br>GSSG</p>"
    api_db.add(AppSetting(key="settings.email_signature", value=json.dumps(signature)))
    api_db.commit()

    server = FakeImapServer()
    drafts = server.add_folder(account.drafts_folder)
    monkeypatch.setattr(email_service, "connect_imap", server.connector)

    app = create_app()
    app.dependency_overrides[get_db] = lambda: api_db
    app.dependency_overrides[get_current_user] = lambda: user
    with TestClient(app, raise_server_exceptions=True) as client:
        response = client.post(
            "/api/v1/email/handoff",
            data={
                "to": "primary@example.com, second@example.com",
                "cc": "copy@example.com",
                "subject": "GS-0048 draft handoff",
                "html": '<p onclick="steal()">Hello <strong>Mailbox</strong></p><script>bad()</script>',
                "mode": "draft",
                "in_reply_to": "<original@example.com>",
                "references": "<root@example.com> <original@example.com>",
                "use_signature": "true",
            },
            files=[
                (
                    "files",
                    (
                        "record.pdf",
                        b"%PDF-1.4 synthetic handoff attachment",
                        "application/pdf",
                    ),
                )
            ],
        )

    assert response.status_code == 201, response.text
    payload = response.json()
    assert payload == {"ledger_entry_id": payload["ledger_entry_id"], "mode": "draft"}

    assert len(server.connections) == 1
    assert server.connection_accounts == [account]
    assert server.connections[0].logged_out is True
    assert len(drafts.messages) == 1
    stored = drafts.messages[0]
    assert stored.flags == r"(\Draft)"
    assert stored.appended_internal_date

    message = BytesParser(policy=policy.default).parsebytes(stored.raw)
    assert message["From"] == account.email
    assert [address for _name, address in getaddresses(message.get_all("To", []))] == [
        "primary@example.com",
        "second@example.com",
    ]
    assert [address for _name, address in getaddresses(message.get_all("Cc", []))] == [
        "copy@example.com"
    ]
    assert message["Subject"] == "GS-0048 draft handoff"
    assert message["X-GSSG-Handoff"] == str(payload["ledger_entry_id"])
    assert message["Message-ID"]
    assert message["In-Reply-To"] == "<original@example.com>"
    assert message["References"] == "<root@example.com> <original@example.com>"

    plain_parts = [
        part.get_content()
        for part in message.walk()
        if part.get_content_type() == "text/plain"
        and part.get_content_disposition() != "attachment"
    ]
    assert len(plain_parts) == 1
    assert "Hello Mailbox" in plain_parts[0]
    assert "Kind regards" in plain_parts[0]

    html_parts = [
        part.get_content() for part in message.walk() if part.get_content_type() == "text/html"
    ]
    assert len(html_parts) == 1
    assert "Hello <strong>Mailbox</strong>" in html_parts[0]
    assert signature in html_parts[0]
    assert "<!-- gssg-signature -->" in html_parts[0]
    assert "data-gssg-signature" in html_parts[0]
    assert "onclick" not in html_parts[0]
    assert "<script" not in html_parts[0]

    attachment = next(
        part for part in message.iter_attachments() if part.get_filename() == "record.pdf"
    )
    assert attachment.get_content_type() == "application/pdf"
    assert attachment.get_payload(decode=True) == b"%PDF-1.4 synthetic handoff attachment"

    entry = api_db.get(LedgerEntry, payload["ledger_entry_id"])
    assert entry is not None
    assert entry.owner_user_id == user.id
    assert entry.direction == "outgoing"
    assert entry.channel == "email"
    assert entry.counterparty == "primary@example.com"
    assert entry.subject == "GS-0048 draft handoff"
    assert entry.to_recipients == [
        {"name": "", "address": "primary@example.com"},
        {"name": "", "address": "second@example.com"},
    ]
    assert entry.cc_recipients == [{"name": "", "address": "copy@example.com"}]
    assert entry.message_id == message["Message-ID"]
    assert entry.in_reply_to == "<original@example.com>"
    assert entry.email_references == "<root@example.com> <original@example.com>"
    assert {"email", "outlook-pending"}.issubset(entry.tags)
    assert entry.read_at is not None
    assert entry.attachment_paths == [f"ledger_attachments/{entry.id}/record.pdf"]
    assert (isolated_data_dir / entry.attachment_paths[0]).read_bytes() == (
        b"%PDF-1.4 synthetic handoff attachment"
    )


def test_mailto_handoff_without_account_preserves_pending_ledger_response(
    api_db: Session,
    isolated_data_dir: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = _user(api_db)
    server = FakeImapServer()
    monkeypatch.setattr(email_service, "connect_imap", server.connector)

    app = create_app()
    app.dependency_overrides[get_db] = lambda: api_db
    app.dependency_overrides[get_current_user] = lambda: user
    with TestClient(app, raise_server_exceptions=True) as client:
        response = client.post(
            "/api/v1/email/handoff",
            data={
                "to": "primary@example.com, second@example.com",
                "cc": "copy@example.com",
                "subject": "Manual mailbox handoff",
                "html": '<p onclick="bad()">Approved <strong>body</strong></p><script>bad()</script>',
                "mode": "mailto",
                "use_signature": "true",
            },
        )

    assert response.status_code == 201, response.text
    payload = response.json()
    assert payload == {"ledger_entry_id": payload["ledger_entry_id"], "mode": "mailto"}
    assert server.connections == []
    assert server.connection_accounts == []

    entry = api_db.get(LedgerEntry, payload["ledger_entry_id"])
    assert entry is not None
    assert entry.owner_user_id == user.id
    assert entry.direction == "outgoing"
    assert entry.channel == "email"
    assert entry.counterparty == "primary@example.com"
    assert entry.to_recipients == [
        {"name": "", "address": "primary@example.com"},
        {"name": "", "address": "second@example.com"},
    ]
    assert entry.cc_recipients == [{"name": "", "address": "copy@example.com"}]
    assert entry.message_id is None
    assert entry.attachment_paths == []
    assert {"email", "outlook-pending"}.issubset(entry.tags)
    assert "Approved <strong>body</strong>" in (entry.notes_html or "")
    assert "onclick" not in (entry.notes_html or "")
    assert "<script" not in (entry.notes_html or "")
    assert not (isolated_data_dir / "ledger_attachments").exists()


def test_handoff_validation_returns_400_without_side_effects(
    api_db: Session,
    isolated_data_dir: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = _user(api_db)
    server = FakeImapServer()
    monkeypatch.setattr(email_service, "connect_imap", server.connector)

    app = create_app()
    app.dependency_overrides[get_db] = lambda: api_db
    app.dependency_overrides[get_current_user] = lambda: user
    with TestClient(app, raise_server_exceptions=True) as client:
        response = client.post(
            "/api/v1/email/handoff",
            data={
                "to": " , ",
                "subject": "Invalid handoff",
                "html": "<p>No recipient</p>",
                "mode": "mailto",
            },
        )

    assert response.status_code == 400
    assert response.json() == {
        "error": {
            "code": "HTTP_400",
            "message": "at least one recipient is required",
            "details": {},
        }
    }
    assert server.connections == []
    api_db.flush()
    assert api_db.query(LedgerEntry).count() == 0
    assert not (isolated_data_dir / "ledger_attachments").exists()


def test_draft_delivery_failure_returns_502_and_cleans_local_state(
    api_db: Session,
    isolated_data_dir: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = _user(api_db)
    _account(api_db, user)
    server = FakeImapServer()
    server.queue_response("create", ("NO", [b"creation denied"]))
    monkeypatch.setattr(email_service, "connect_imap", server.connector)

    app = create_app()
    app.dependency_overrides[get_db] = lambda: api_db
    app.dependency_overrides[get_current_user] = lambda: user
    with TestClient(app, raise_server_exceptions=True) as client:
        response = client.post(
            "/api/v1/email/handoff",
            data={
                "to": "recipient@example.com",
                "subject": "Rejected draft",
                "html": "<p>Clean this attachment</p>",
                "mode": "draft",
                "use_signature": "false",
            },
            files=[
                (
                    "files",
                    ("orphan.pdf", b"%PDF-1.4 rejected draft", "application/pdf"),
                )
            ],
        )

    assert response.status_code == 502
    assert response.json() == {
        "error": {
            "code": "HTTP_502",
            "message": "could not create the Outlook Drafts folder",
            "details": {},
        }
    }
    assert len(server.connections) == 1
    assert server.connections[0].logged_out is True
    assert [operation.name for operation in server.operations] == [
        "append",
        "create",
        "logout",
    ]
    api_db.flush()
    assert api_db.query(LedgerEntry).count() == 0
    attachment_root = isolated_data_dir / "ledger_attachments"
    assert not attachment_root.exists() or not any(
        path.is_file() for path in attachment_root.rglob("*")
    )


def test_handoff_denial_returns_403_without_mailbox_or_local_side_effects(
    api_db: Session,
    isolated_data_dir: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = _user(api_db)
    _account(api_db, user)
    api_db.add(UserPermission(user_id=user.id, capability="ledger.send", effect="deny"))
    api_db.commit()
    server = FakeImapServer()
    server.add_folder("Outlook Drafts")
    monkeypatch.setattr(email_service, "connect_imap", server.connector)

    app = create_app()
    app.dependency_overrides[get_db] = lambda: api_db
    app.dependency_overrides[get_current_user] = lambda: user
    with TestClient(app, raise_server_exceptions=True) as client:
        response = client.post(
            "/api/v1/email/handoff",
            data={
                "to": "recipient@example.com",
                "subject": "Forbidden draft",
                "html": "<p>Must not persist</p>",
                "mode": "draft",
            },
            files=[
                (
                    "files",
                    ("forbidden.pdf", b"%PDF-1.4 forbidden", "application/pdf"),
                )
            ],
        )

    assert response.status_code == 403
    assert response.json()["error"]["details"] == {"capability": "ledger.send"}
    assert server.connections == []
    assert server.connection_accounts == []
    api_db.flush()
    assert api_db.query(LedgerEntry).count() == 0
    assert not (isolated_data_dir / "ledger_attachments").exists()


@pytest.mark.parametrize("path", ["/api/v1/email/test", "/api/v1/email/sync"])
def test_email_manage_denial_never_opens_a_mailbox_session(
    path: str,
    api_db: Session,
    isolated_data_dir: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = _user(api_db)
    _account(api_db, user)
    api_db.add(UserPermission(user_id=user.id, capability="email.manage", effect="deny"))
    api_db.commit()
    server = FakeImapServer()
    server.add_folder("INBOX")
    server.add_folder("Sent")
    monkeypatch.setattr(email_service, "connect_imap", server.connector)

    app = create_app()
    app.dependency_overrides[get_db] = lambda: api_db
    app.dependency_overrides[get_current_user] = lambda: user
    with TestClient(app, raise_server_exceptions=True) as client:
        response = client.post(path)

    assert response.status_code == 403
    assert response.json()["error"]["details"] == {"capability": "email.manage"}
    assert server.connections == []
    assert server.connection_accounts == []
    api_db.flush()
    assert api_db.query(LedgerEntry).count() == 0
    assert not (isolated_data_dir / "ledger_attachments").exists()


def test_connection_route_does_not_use_another_users_mailbox(
    api_db: Session,
    isolated_data_dir: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    owner = _user(api_db, email="mailbox-owner@test.ae")
    _account(api_db, owner)
    other = _user(api_db, email="other-operator@test.ae")
    server = FakeImapServer()
    monkeypatch.setattr(email_service, "connect_imap", server.connector)

    app = create_app()
    app.dependency_overrides[get_db] = lambda: api_db
    app.dependency_overrides[get_current_user] = lambda: other
    with TestClient(app, raise_server_exceptions=True) as client:
        response = client.post("/api/v1/email/test")

    assert response.status_code == 404
    assert response.json() == {
        "error": {
            "code": "HTTP_404",
            "message": "no email account configured",
            "details": {},
        }
    }
    assert server.connections == []
    assert server.connection_accounts == []
    api_db.flush()
    assert api_db.query(EmailAccount).count() == 1
    assert api_db.query(LedgerEntry).count() == 0
    assert not (isolated_data_dir / "ledger_attachments").exists()


def test_email_account_round_trips_custom_drafts_folder(
    api_db: Session,
    isolated_data_dir: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = _user(api_db, email="account-user@test.ae")
    monkeypatch.setattr(scheduler_service, "reschedule_email_sync", lambda: None)

    app = create_app()
    app.dependency_overrides[get_db] = lambda: api_db
    app.dependency_overrides[get_current_user] = lambda: user
    with TestClient(app, raise_server_exceptions=True) as client:
        put_response = client.put(
            "/api/v1/email/account",
            json={
                "email": "outlook@gssg.ae",
                "username": "outlook@gssg.ae",
                "password": "test-only-password",
                "drafts_folder": "INBOX.Outlook Drafts",
            },
        )
        get_response = client.get("/api/v1/email/account")

    assert put_response.status_code == 200, put_response.text
    assert put_response.json()["drafts_folder"] == "INBOX.Outlook Drafts"
    assert get_response.status_code == 200, get_response.text
    assert get_response.json()["drafts_folder"] == "INBOX.Outlook Drafts"
    account = api_db.query(EmailAccount).filter(EmailAccount.owner_user_id == user.id).one()
    assert account.drafts_folder == "INBOX.Outlook Drafts"
    assert isolated_data_dir.exists()


def test_sync_route_serializes_real_mailbox_import_and_account_status(
    api_db: Session,
    isolated_data_dir: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = _user(api_db)
    account = _account(api_db, user)
    incoming = EmailMessage()
    incoming["From"] = "Vendor <vendor@example.com>"
    incoming["To"] = account.email
    incoming["Subject"] = "Synthetic mailbox import"
    incoming["Message-ID"] = "<route-sync@example.com>"
    incoming["Date"] = "Fri, 05 Sep 2026 08:30:00 +0400"
    incoming.set_content("Mailbox route body")

    server = FakeImapServer()
    server.add_folder(account.inbox_folder)
    server.add_folder(account.sent_folder)
    server.add_message(
        account.inbox_folder,
        incoming.as_bytes(),
        internal_date=datetime.now(UTC),
    )
    monkeypatch.setattr(email_service, "connect_imap", server.connector)

    app = create_app()
    app.dependency_overrides[get_db] = lambda: api_db
    app.dependency_overrides[get_current_user] = lambda: user
    with TestClient(app, raise_server_exceptions=True) as client:
        response = client.post("/api/v1/email/sync")

    assert response.status_code == 200, response.text
    payload = response.json()
    assert set(payload) == {"imported", "skipped_duplicate", "errors", "last_synced_at"}
    assert payload["imported"] == 1
    assert payload["skipped_duplicate"] == 0
    assert payload["errors"] == []
    response_synced_at = datetime.fromisoformat(payload["last_synced_at"])

    assert len(server.connections) == 1
    assert server.connection_accounts == [account]
    assert server.connections[0].logged_out is True
    imported = api_db.query(LedgerEntry).one()
    assert imported.owner_user_id == user.id
    assert imported.direction == "incoming"
    assert imported.channel == "email"
    assert imported.counterparty == "vendor@example.com"
    assert imported.subject == "Synthetic mailbox import"
    assert imported.message_id == "<route-sync@example.com>"
    assert imported.to_recipients == [{"name": "", "address": account.email}]
    assert "Mailbox route body" in (imported.notes_html or "")
    assert "msgid:route-sync@example.com" in imported.tags
    api_db.refresh(account)
    assert account.last_sync_count == 1
    assert account.last_sync_error is None
    assert account.last_synced_at is not None
    assert response_synced_at.tzinfo is UTC
    assert response_synced_at.replace(tzinfo=None) == account.last_synced_at
    assert not (isolated_data_dir / "ledger_attachments").exists()


def test_sync_route_returns_409_while_a_real_mailbox_sync_holds_the_lock(
    api_db: Session,
    isolated_data_dir: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = _user(api_db)
    account = _account(api_db, user)
    server = FakeImapServer()
    server.add_folder(account.inbox_folder)
    server.add_folder(account.sent_folder)
    started = threading.Event()
    release = threading.Event()
    worker_errors: list[BaseException] = []

    def blocking_connector(fake_account: EmailAccount) -> FakeImapConnection:
        started.set()
        if not release.wait(timeout=10):
            raise TimeoutError("test did not release the mailbox connector")
        return server.connector(fake_account)

    worker_session_factory = sessionmaker(
        bind=api_db.get_bind(),
        autoflush=False,
        expire_on_commit=False,
        future=True,
    )

    def run_first_sync() -> None:
        worker_db = worker_session_factory()
        try:
            email_service.sync_now(
                worker_db,
                owner_user_id=user.id,
                connector=blocking_connector,
            )
        except BaseException as exc:  # pragma: no cover - asserted below
            worker_errors.append(exc)
        finally:
            worker_db.close()

    worker = threading.Thread(target=run_first_sync)
    worker.start()
    assert started.wait(timeout=10), "first sync never reached the mailbox boundary"

    monkeypatch.setattr(email_service, "connect_imap", server.connector)
    app = create_app()
    app.dependency_overrides[get_db] = lambda: api_db
    app.dependency_overrides[get_current_user] = lambda: user
    try:
        with TestClient(app, raise_server_exceptions=True) as client:
            response = client.post("/api/v1/email/sync")
    finally:
        release.set()
        worker.join(timeout=10)

    assert response.status_code == 409
    assert response.json() == {
        "error": {
            "code": "HTTP_409",
            "message": "sync already running",
            "details": {},
        }
    }
    assert worker.is_alive() is False
    assert worker_errors == []
    assert len(server.connections) == 1
    assert server.connections[0].logged_out is True
    assert server.connection_accounts[0].id == account.id
    api_db.flush()
    assert api_db.query(LedgerEntry).count() == 0
    assert not (isolated_data_dir / "ledger_attachments").exists()


def test_handoff_openapi_operation_contract_is_unchanged() -> None:
    schema = create_app().openapi()
    operation = schema["paths"]["/api/v1/email/handoff"]["post"]

    assert operation["operationId"] == "create_handoff_api_v1_email_handoff_post"
    assert operation["requestBody"] == {
        "content": {
            "multipart/form-data": {
                "schema": {
                    "$ref": "#/components/schemas/Body_create_handoff_api_v1_email_handoff_post"
                }
            }
        },
        "required": True,
    }
    assert operation["responses"]["201"] == {
        "description": "Successful Response",
        "content": {
            "application/json": {"schema": {"$ref": "#/components/schemas/EmailHandoffResult"}}
        },
    }
    assert schema["components"]["schemas"]["EmailHandoffResult"] == {
        "properties": {
            "ledger_entry_id": {"type": "integer", "title": "Ledger Entry Id"},
            "mode": {
                "type": "string",
                "enum": ["mailto", "draft"],
                "title": "Mode",
            },
        },
        "type": "object",
        "required": ["ledger_entry_id", "mode"],
        "title": "EmailHandoffResult",
    }


def test_ledger_thread_matches_display_name_and_bare_email_counterparties(
    api_db: Session,
) -> None:
    user = _user(api_db)
    seed = _ledger_email(
        api_db,
        owner_user_id=user.id,
        subject="Quarterly transfer",
        counterparty="Vendor Team <vendor@example.com>",
    )
    reply = _ledger_email(
        api_db,
        owner_user_id=user.id,
        subject="RE: quarterly   transfer",
        counterparty="vendor@example.com",
    )
    _ledger_email(
        api_db,
        owner_user_id=user.id,
        subject="Quarterly transfer",
        counterparty="other@example.com",
    )
    api_db.commit()

    result = ledger_service.list_thread(
        api_db,
        seed.id,
        owner_user_id=user.id,
    )

    assert [row.id for row in result] == [reply.id]


def test_smart_folder_suggestion_counts_bare_email_correspondents(
    api_db: Session,
) -> None:
    user = _user(api_db)
    counterparties = [
        "Vendor Team <vendor@example.com>",
        "vendor@example.com",
        "Accounts <accounts@example.com>",
        "accounts@example.com",
        "Vendor Alias <vendor@example.com>",
    ]
    subjects = [
        "Quarterly transfer",
        "RE: quarterly transfer",
        "FWD: Quarterly   Transfer",
        "Quarterly transfer",
        "RE: QUARTERLY TRANSFER",
    ]
    for subject, counterparty in zip(subjects, counterparties, strict=True):
        _ledger_email(
            api_db,
            owner_user_id=user.id,
            subject=subject,
            counterparty=counterparty,
        )
    api_db.commit()

    suggestions = smart_folder_service.suggest(api_db, user_id=user.id)

    assert len(suggestions) == 1
    suggestion = suggestions[0]
    assert suggestion.cluster_key == "quarterly transfer"
    assert suggestion.count == 5
    assert suggestion.correspondent_count == 2
    assert suggestion.name_suggestion == "Quarterly transfer"
