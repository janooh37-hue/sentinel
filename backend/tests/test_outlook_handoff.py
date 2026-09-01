from __future__ import annotations

import json
from email import policy
from email.parser import BytesParser
from email.utils import getaddresses
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.config import get_settings
from app.core import crypto
from app.db.models import (
    AppSetting,
    Book,
    BookCategory,
    EmailAccount,
    LedgerEntry,
    User,
    UserPermission,
)
from app.db.session import get_db
from app.main import create_app
from app.services import email_service, scheduler_service


def _user(db: Session, *, email: str, role: str = "operator") -> User:
    user = User(email=email, password_hash="x", role=role, status="active")
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _client(db: Session, user: User) -> TestClient:
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app, raise_server_exceptions=True)


def _book(db: Session) -> Book:
    db.add(BookCategory(id="GS", name_en="General", prefix="GS"))
    book = Book(category_id="GS", ref_number="GS-0048", subject="Transfer")
    db.add(book)
    db.commit()
    db.refresh(book)
    return book


def _account(db: Session, user: User, *, drafts_folder: str = "Outlook Drafts") -> EmailAccount:
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
        drafts_folder=drafts_folder,
        inbox_folder="INBOX",
        enabled=True,
        sync_interval_minutes=5,
        owner_user_id=user.id,
    )
    db.add(account)
    db.commit()
    db.refresh(account)
    return account


class _FakeImap:
    def __init__(self, append_status: str = "OK") -> None:
        self.append_status = append_status
        self.appends: list[tuple[str, str, str, bytes]] = []
        self.created: list[str] = []
        self.logged_out = False

    def append(self, folder: str, flags: str, internal_date: str, message: bytes):
        self.appends.append((folder, flags, internal_date, bytes(message)))
        return self.append_status, [b"append result"]

    def create(self, folder: str):
        self.created.append(folder)
        return "OK", [b"created"]

    def logout(self):
        self.logged_out = True
        return "BYE", [b"logout"]


@pytest.fixture()
def isolated_data_dir(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    monkeypatch.setenv("GSSG_DATA_DIR", str(tmp_path))
    get_settings.cache_clear()
    crypto._load_or_create_key.cache_clear()
    yield tmp_path
    get_settings.cache_clear()
    crypto._load_or_create_key.cache_clear()


def test_mailto_handoff_persists_sanitized_pending_ledger_row_without_account(
    api_db: Session,
    isolated_data_dir: Path,
) -> None:
    user = _user(api_db, email="mailto-user@test.ae")
    book = _book(api_db)
    unsafe_html = '<p onclick="steal()">Approved <strong>body</strong></p><script>steal()</script>'

    response = _client(api_db, user).post(
        "/api/v1/email/handoff",
        data={
            "to": "a@x.ae, second@example.com",
            "cc": "copy@example.com",
            "subject": "كتاب رقم GS-0048 — تحويل",
            "html": unsafe_html,
            "mode": "mailto",
            "related_book_id": str(book.id),
            "use_signature": "true",
        },
    )

    assert response.status_code in (200, 201), response.text
    payload = response.json()
    assert payload["mode"] == "mailto"
    entry = api_db.get(LedgerEntry, payload["ledger_entry_id"])
    assert entry is not None
    assert entry.owner_user_id == user.id
    assert entry.direction == "outgoing"
    assert entry.channel == "email"
    assert entry.counterparty == "a@x.ae"
    assert entry.to_recipients == [
        {"name": "", "address": "a@x.ae"},
        {"name": "", "address": "second@example.com"},
    ]
    assert entry.cc_recipients == [{"name": "", "address": "copy@example.com"}]
    assert entry.related_book_id == book.id
    assert {"email", "outlook-pending"}.issubset(entry.tags)
    assert "Approved <strong>body</strong>" in (entry.notes_html or "")
    assert "onclick" not in (entry.notes_html or "")
    assert "<script" not in (entry.notes_html or "")
    assert entry.read_at is not None
    assert api_db.execute(select(EmailAccount)).scalar_one_or_none() is None


def test_draft_handoff_appends_prefilled_mime_with_signature_and_attachment(
    api_db: Session,
    isolated_data_dir: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = _user(api_db, email="draft-user@test.ae")
    account = _account(api_db, user)
    signature = "<p>Kind regards,<br>GSSG</p>"
    api_db.add(AppSetting(key="settings.email_signature", value=json.dumps(signature)))
    api_db.commit()
    fake_imap = _FakeImap()
    monkeypatch.setattr(email_service, "_connect", lambda _account: fake_imap)

    response = _client(api_db, user).post(
        "/api/v1/email/handoff",
        data={
            "to": "primary@example.com, second@example.com",
            "cc": "copy@example.com",
            "subject": "GS-0048 draft handoff",
            "html": "<p>Hello <strong>Outlook</strong></p>",
            "mode": "draft",
            "use_signature": "true",
        },
        files=[("files", ("record.pdf", b"%PDF-1.4 handoff attachment", "application/pdf"))],
    )

    assert response.status_code in (200, 201), response.text
    payload = response.json()
    assert payload["mode"] == "draft"
    assert len(fake_imap.appends) == 1
    folder, flags, internal_date, raw_message = fake_imap.appends[0]
    assert folder == account.drafts_folder
    assert flags == "(\\Draft)"
    assert internal_date

    message = BytesParser(policy=policy.default).parsebytes(raw_message)
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

    html_parts = [part.get_content() for part in message.walk() if part.get_content_type() == "text/html"]
    assert len(html_parts) == 1
    assert "Hello <strong>Outlook</strong>" in html_parts[0]
    assert signature in html_parts[0]
    assert "<!-- gssg-signature -->" in html_parts[0]
    assert "data-gssg-signature" in html_parts[0]
    attachment = next(part for part in message.iter_attachments() if part.get_filename() == "record.pdf")
    assert attachment.get_content_type() == "application/pdf"
    assert attachment.get_payload(decode=True) == b"%PDF-1.4 handoff attachment"

    entry = api_db.get(LedgerEntry, payload["ledger_entry_id"])
    assert entry is not None
    assert entry.message_id == message["Message-ID"]
    assert "outlook-pending" in entry.tags
    assert "<!-- gssg-signature -->" in (entry.notes_html or "")
    assert "data-gssg-signature" in (entry.notes_html or "")
    assert entry.attachment_paths
    assert (isolated_data_dir / entry.attachment_paths[0]).read_bytes() == b"%PDF-1.4 handoff attachment"


def test_draft_append_failure_retries_once_and_rolls_back_row_and_file(
    api_db: Session,
    isolated_data_dir: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = _user(api_db, email="failed-draft-user@test.ae")
    account = _account(api_db, user, drafts_folder="Custom Drafts")
    fake_imap = _FakeImap(append_status="NO")
    monkeypatch.setattr(email_service, "_connect", lambda _account: fake_imap)

    response = _client(api_db, user).post(
        "/api/v1/email/handoff",
        data={
            "to": "recipient@example.com",
            "cc": "",
            "subject": "Draft that cannot be appended",
            "html": "<p>Keep no orphan</p>",
            "mode": "draft",
            "use_signature": "false",
        },
        files=[("files", ("orphan.pdf", b"%PDF-1.4 orphan", "application/pdf"))],
    )

    assert response.status_code == 502, response.text
    assert [call[0] for call in fake_imap.appends] == [account.drafts_folder, account.drafts_folder]
    assert fake_imap.created == [account.drafts_folder]
    api_db.expire_all()
    entries = api_db.execute(select(LedgerEntry)).scalars().all()
    assert not any("outlook-pending" in (entry.tags or []) for entry in entries)
    attachment_root = isolated_data_dir / "ledger_attachments"
    assert not attachment_root.exists() or not any(path.is_file() for path in attachment_root.rglob("*"))


def test_handoff_requires_ledger_send_capability(
    api_db: Session,
    isolated_data_dir: Path,
) -> None:
    user = _user(api_db, email="denied-handoff-user@test.ae")
    api_db.add(UserPermission(user_id=user.id, capability="ledger.send", effect="deny"))
    api_db.commit()

    response = _client(api_db, user).post(
        "/api/v1/email/handoff",
        data={
            "to": "recipient@example.com",
            "cc": "",
            "subject": "Denied handoff",
            "html": "<p>Denied</p>",
            "mode": "mailto",
        },
    )

    assert response.status_code == 403
    assert response.json()["error"]["details"]["capability"] == "ledger.send"


def test_email_account_round_trips_custom_drafts_folder(
    api_db: Session,
    isolated_data_dir: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = _user(api_db, email="account-user@test.ae")
    monkeypatch.setattr(scheduler_service, "reschedule_email_sync", lambda: None)
    client = _client(api_db, user)

    put_response = client.put(
        "/api/v1/email/account",
        json={
            "email": "outlook@gssg.ae",
            "username": "outlook@gssg.ae",
            "password": "test-only-password",
            "drafts_folder": "INBOX.Outlook Drafts",
        },
    )

    assert put_response.status_code == 200, put_response.text
    assert put_response.json()["drafts_folder"] == "INBOX.Outlook Drafts"
    get_response = client.get("/api/v1/email/account")
    assert get_response.status_code == 200
    assert get_response.json()["drafts_folder"] == "INBOX.Outlook Drafts"
    account = api_db.execute(
        select(EmailAccount).where(EmailAccount.owner_user_id == user.id)
    ).scalar_one()
    assert account.drafts_folder == "INBOX.Outlook Drafts"
