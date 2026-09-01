from __future__ import annotations

import json
from datetime import UTC, date, datetime, timedelta
from email import policy
from email.message import EmailMessage
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
    CorrespondenceCategory,
    EmailAccount,
    Employee,
    LedgerEntry,
    LedgerFlag,
    User,
    UserPermission,
)
from app.db.session import get_db
from app.main import create_app
from app.services import (
    correspondence_service,
    email_service,
    outlook_handoff_service,
    scheduler_service,
)


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


def _book(db: Session, *, employee_id: str | None = None) -> Book:
    db.add(BookCategory(id="GS", name_en="General", prefix="GS"))
    book = Book(
        category_id="GS",
        ref_number="GS-0048",
        subject="Transfer",
        employee_id=employee_id,
    )
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


def _email_entry(
    db: Session,
    *,
    owner_user_id: int,
    subject: str,
    to: str = "recipient@example.com",
    entry_date: date | None = None,
    tags: list[str] | None = None,
    related_book_id: int | None = None,
    related_employee_id: str | None = None,
    created_at: datetime | None = None,
    deleted_at: datetime | None = None,
    message_id: str | None = None,
) -> LedgerEntry:
    now = datetime.now(UTC).replace(tzinfo=None)
    entry = LedgerEntry(
        entry_date=entry_date or date.today(),
        direction="outgoing",
        channel="email",
        counterparty=to,
        subject=subject,
        attachment_paths=[],
        tags=list(tags) if tags is not None else ["email"],
        owner_user_id=owner_user_id,
        to_recipients=[{"name": "", "address": to}],
        cc_recipients=[],
        bcc_recipients=[],
        related_book_id=related_book_id,
        related_employee_id=related_employee_id,
        created_at=created_at or now,
        deleted_at=deleted_at,
        message_id=message_id,
        read_at=now,
    )
    db.add(entry)
    db.flush()
    return entry


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


def test_reconcile_direct_header_merges_links_and_logs_email_sent(
    api_db: Session,
) -> None:
    user = _user(api_db, email="header-reconcile@test.ae")
    account = _account(api_db, user)
    employee = Employee(id="G0048", name_en="Linked Employee")
    api_db.add(employee)
    book = _book(api_db, employee_id=employee.id)
    correspondence_service.seed_defaults(api_db)
    pending = _email_entry(
        api_db,
        owner_user_id=user.id,
        subject="Benefit paperwork",
        tags=["email", outlook_handoff_service.HANDOFF_TAG],
        related_book_id=book.id,
        related_employee_id=employee.id,
    )
    sent = _email_entry(
        api_db,
        owner_user_id=user.id,
        subject="RE: Benefit paperwork",
    )
    api_db.commit()
    pending_id = pending.id
    sent_id = sent.id
    message = EmailMessage()
    message[outlook_handoff_service.HANDOFF_HEADER] = str(pending_id)
    message["Message-ID"] = "<sent-header@example.com>"

    outlook_handoff_service.reconcile_sent_entry(
        api_db,
        entry=sent,
        msg=message,
        account=account,
    )

    api_db.expire_all()
    merged_pending = api_db.get(LedgerEntry, pending_id)
    confirmed = api_db.get(LedgerEntry, sent_id)
    assert merged_pending is not None
    assert merged_pending.deleted_at is not None
    assert confirmed is not None
    assert confirmed.related_book_id == book.id
    assert confirmed.related_employee_id == employee.id
    log_row = api_db.execute(
        select(LedgerEntry).where(
            LedgerEntry.source_kind == "sent_email",
            LedgerEntry.related_book_id == book.id,
            LedgerEntry.owner_user_id.is_(None),
        )
    ).scalar_one()
    category = api_db.get(CorrespondenceCategory, log_row.category_id)
    assert category is not None
    assert category.key == "hr_letters"
    assert log_row.subject == sent.subject
    assert log_row.related_employee_id == employee.id
    assert log_row.created_by == account.email


def test_reconcile_normalized_fallback_deletes_oldest_matching_pending_only(
    api_db: Session,
) -> None:
    user = _user(api_db, email="fallback-reconcile@test.ae")
    account = _account(api_db, user)
    sent_date = date.today()
    now = datetime.now(UTC).replace(tzinfo=None)
    oldest = _email_entry(
        api_db,
        owner_user_id=user.id,
        subject="Quarterly   Transfer",
        to="Recipient@Example.COM",
        entry_date=sent_date - timedelta(days=4),
        tags=[
            "email",
            outlook_handoff_service.HANDOFF_TAG,
            email_service._msgid_tag("<original-oldest@example.com>"),
        ],
        created_at=now - timedelta(days=4),
    )
    newer = _email_entry(
        api_db,
        owner_user_id=user.id,
        subject="RE: quarterly transfer",
        to="recipient@example.com",
        entry_date=sent_date - timedelta(days=2),
        tags=[
            "email",
            outlook_handoff_service.HANDOFF_TAG,
            email_service._msgid_tag("<original-newer@example.com>"),
        ],
        created_at=now - timedelta(days=2),
    )
    unrelated = _email_entry(
        api_db,
        owner_user_id=user.id,
        subject="Different subject",
        to="recipient@example.com",
        entry_date=sent_date - timedelta(days=3),
        tags=["email", outlook_handoff_service.HANDOFF_TAG],
        created_at=now - timedelta(days=3),
    )
    sent = _email_entry(
        api_db,
        owner_user_id=user.id,
        subject="FW: RE:   QUARTERLY transfer",
        to="recipient@example.com",
        entry_date=sent_date,
        tags=["email", email_service._msgid_tag("<rewritten@example.com>")],
        message_id="<rewritten@example.com>",
    )
    api_db.commit()
    oldest_id, newer_id, unrelated_id = oldest.id, newer.id, unrelated.id
    message = EmailMessage()
    message["Message-ID"] = "<rewritten@example.com>"

    outlook_handoff_service.reconcile_sent_entry(
        api_db,
        entry=sent,
        msg=message,
        account=account,
    )

    api_db.expire_all()
    assert api_db.get(LedgerEntry, oldest_id).deleted_at is not None
    assert api_db.get(LedgerEntry, newer_id).deleted_at is None
    assert api_db.get(LedgerEntry, unrelated_id).deleted_at is None


def test_reconcile_direct_outlook_links_mixed_case_ref_but_ignores_no_ref_subject(
    api_db: Session,
) -> None:
    user = _user(api_db, email="direct-outlook@test.ae")
    account = _account(api_db, user)
    employee = Employee(id="G1048", name_en="Direct Outlook Employee")
    api_db.add(employee)
    book = _book(api_db, employee_id=employee.id)
    correspondence_service.seed_defaults(api_db)
    linked_sent = _email_entry(
        api_db,
        owner_user_id=user.id,
        subject="Direct Outlook update for gS-0048",
    )
    api_db.commit()
    linked_message = EmailMessage()
    linked_message["Message-ID"] = "<direct-linked@example.com>"

    outlook_handoff_service.reconcile_sent_entry(
        api_db,
        entry=linked_sent,
        msg=linked_message,
        account=account,
    )

    api_db.expire_all()
    linked = api_db.get(LedgerEntry, linked_sent.id)
    assert linked is not None
    assert linked.related_book_id == book.id
    assert linked.related_employee_id == employee.id
    initial_logs = api_db.execute(
        select(LedgerEntry).where(LedgerEntry.source_kind == "sent_email")
    ).scalars().all()
    assert len(initial_logs) == 1
    assert initial_logs[0].related_book_id == book.id
    assert initial_logs[0].subject == linked_sent.subject

    foreign_sent = _email_entry(
        api_db,
        owner_user_id=user.id,
        subject="Direct Outlook update without a book reference",
    )
    api_db.commit()
    foreign_id = foreign_sent.id
    foreign_message = EmailMessage()
    foreign_message["Message-ID"] = "<direct-foreign@example.com>"

    outlook_handoff_service.reconcile_sent_entry(
        api_db,
        entry=foreign_sent,
        msg=foreign_message,
        account=account,
    )

    api_db.expire_all()
    foreign = api_db.get(LedgerEntry, foreign_id)
    assert foreign is not None
    assert foreign.related_book_id is None
    assert foreign.related_employee_id is None
    all_logs = api_db.execute(
        select(LedgerEntry).where(LedgerEntry.source_kind == "sent_email")
    ).scalars().all()
    assert len(all_logs) == 1


def test_flag_stale_handoffs_is_idempotent_and_ignores_fresh_or_deleted_rows(
    api_db: Session,
) -> None:
    user = _user(api_db, email="stale-handoff@test.ae")
    account = _account(api_db, user)
    now = datetime.now(UTC).replace(tzinfo=None)
    stale = _email_entry(
        api_db,
        owner_user_id=user.id,
        subject="Stale pending handoff",
        tags=["email", outlook_handoff_service.HANDOFF_TAG],
        created_at=now - timedelta(hours=49),
    )
    fresh = _email_entry(
        api_db,
        owner_user_id=user.id,
        subject="Fresh pending handoff",
        tags=["email", outlook_handoff_service.HANDOFF_TAG],
        created_at=now - timedelta(hours=47),
    )
    deleted = _email_entry(
        api_db,
        owner_user_id=user.id,
        subject="Deleted pending handoff",
        tags=["email", outlook_handoff_service.HANDOFF_TAG],
        created_at=now - timedelta(hours=72),
        deleted_at=now - timedelta(hours=1),
    )
    api_db.commit()
    stale_id, fresh_id, deleted_id = stale.id, fresh.id, deleted.id

    outlook_handoff_service.flag_stale_handoffs(api_db, account=account)
    outlook_handoff_service.flag_stale_handoffs(api_db, account=account)

    api_db.expire_all()
    stale_after = api_db.get(LedgerEntry, stale_id)
    fresh_after = api_db.get(LedgerEntry, fresh_id)
    deleted_after = api_db.get(LedgerEntry, deleted_id)
    assert stale_after is not None
    assert stale_after.tags.count(outlook_handoff_service.STALE_TAG) == 1
    assert fresh_after is not None
    assert outlook_handoff_service.STALE_TAG not in fresh_after.tags
    assert deleted_after is not None
    assert outlook_handoff_service.STALE_TAG not in deleted_after.tags
    flags = api_db.execute(
        select(LedgerFlag).where(LedgerFlag.user_id == user.id)
    ).scalars().all()
    assert len(flags) == 1
    assert flags[0].entry_id == stale_id
    assert flags[0].followup_due == date.today()


def test_existing_message_ids_exclude_pending_handoffs_but_keep_confirmed_mail(
    api_db: Session,
) -> None:
    user = _user(api_db, email="dedupe-handoff@test.ae")
    pending_message_id = "<pending-draft@example.com>"
    confirmed_message_id = "<confirmed-sent@example.com>"
    pending_tag = email_service._msgid_tag(pending_message_id)
    confirmed_tag = email_service._msgid_tag(confirmed_message_id)
    pending = _email_entry(
        api_db,
        owner_user_id=user.id,
        subject="Pending draft",
        tags=["email", outlook_handoff_service.HANDOFF_TAG, pending_tag],
        message_id=pending_message_id,
    )
    confirmed = _email_entry(
        api_db,
        owner_user_id=user.id,
        subject="Confirmed sent mail",
        tags=["email", confirmed_tag],
        message_id=confirmed_message_id,
    )
    api_db.commit()

    existing = email_service._existing_msgids(api_db)

    assert pending_tag not in existing
    assert existing[confirmed_tag] == (confirmed.id, 0)
    assert pending.id != confirmed.id
