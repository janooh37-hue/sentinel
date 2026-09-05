from __future__ import annotations

import imaplib
import json
from collections.abc import Iterator
from datetime import UTC, date, datetime, timedelta
from email import policy
from email.message import EmailMessage
from email.parser import BytesParser
from email.utils import getaddresses
from pathlib import Path
from typing import Literal

import pytest
from sqlalchemy import event, select
from sqlalchemy.orm import Session

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
    ScanInbox,
    User,
)
from app.services import correspondence_service, email_service
from tests.fakes.imap import FakeImapConnection, FakeImapServer


@pytest.fixture(autouse=True)
def _isolate_mailbox_boundaries(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> Iterator[None]:
    def refuse(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("live IMAP transport is blocked in mailbox tests")

    monkeypatch.setattr(imaplib, "IMAP4", refuse)
    monkeypatch.setattr(imaplib, "IMAP4_SSL", refuse)
    monkeypatch.setenv("GSSG_DATA_DIR", str(tmp_path))
    get_settings.cache_clear()
    crypto._load_or_create_key.cache_clear()
    yield
    get_settings.cache_clear()
    crypto._load_or_create_key.cache_clear()


def _user(db: Session, *, email: str) -> User:
    user = User(email=email, password_hash="x", role="operator", status="active")
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _account(
    db: Session,
    user: User,
    *,
    drafts_folder: str = "Outlook Drafts",
) -> EmailAccount:
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


def _required_entry(db: Session, entry_id: int) -> LedgerEntry:
    entry = db.get(LedgerEntry, entry_id)
    assert entry is not None
    return entry


def _draft(
    db: Session,
    *,
    user: User,
    server: FakeImapServer,
    attachment: bytes = b"%PDF-1.4 attachment",
    related_book_id: int | None = None,
    related_employee_id: str | None = None,
) -> LedgerEntry:
    return email_service.draft_outgoing(
        db,
        owner_user_id=user.id,
        to=["recipient@example.com"],
        cc=[],
        subject="Draft delivery",
        html="<p>Body</p>",
        mode="draft",
        related_book_id=related_book_id,
        related_employee_id=related_employee_id,
        in_reply_to=None,
        references=None,
        use_signature=False,
        attachments=[("record.pdf", "application/pdf", attachment)],
        connector=server.connector,
    )


def _message(
    *,
    sender: str,
    to: str,
    subject: str,
    message_id: str,
    handoff_id: int | None = None,
    unsafe_html: bool = False,
    with_attachments: bool = False,
) -> bytes:
    message = EmailMessage()
    message["From"] = sender
    message["To"] = to
    message["Subject"] = subject
    message["Date"] = "Fri, 05 Sep 2026 08:00:00 +0000"
    message["Message-ID"] = message_id
    if handoff_id is not None:
        message[email_service.HANDOFF_HEADER] = str(handoff_id)
    message.set_content("Plain mailbox body")
    html = "<p>Mailbox <strong>body</strong></p>"
    if unsafe_html:
        html = '<p onclick="steal()">Mailbox <strong>body</strong></p><script>steal()</script>'
    message.add_alternative(html, subtype="html")
    if with_attachments:
        message.add_attachment(
            b"inline-image",
            maintype="image",
            subtype="png",
            cid="<logo-1>",
            filename="logo.png",
            disposition="inline",
        )
        message.add_attachment(
            b"%PDF-1.4 incoming",
            maintype="application",
            subtype="pdf",
            filename="incoming.pdf",
        )
    return message.as_bytes()


def test_draft_outgoing_appends_complete_mime_and_returns_pending_entry(
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    user = _user(db_session, email="draft-service@test.ae")
    account = _account(db_session, user)
    signature = "<p>Kind regards,<br>GSSG</p>"
    db_session.add(AppSetting(key="settings.email_signature", value=json.dumps(signature)))
    db_session.commit()
    server = FakeImapServer()
    server.add_folder(account.drafts_folder)

    entry = email_service.draft_outgoing(
        db_session,
        owner_user_id=user.id,
        to=["primary@example.com", "second@example.com"],
        cc=["copy@example.com"],
        subject="GS-0048 draft handoff",
        html='<p onclick="steal()">Hello <strong>Outlook</strong></p><script>steal()</script>',
        mode="draft",
        related_book_id=None,
        related_employee_id=None,
        in_reply_to="<prior@example.com>",
        references="<first@example.com> <prior@example.com>",
        use_signature=True,
        attachments=[("record.pdf", "application/pdf", b"%PDF-1.4 attachment")],
        connector=server.connector,
    )

    assert isinstance(entry, LedgerEntry)
    assert entry.id is not None
    assert entry.owner_user_id == user.id
    assert entry.message_id
    assert entry.in_reply_to == "<prior@example.com>"
    assert entry.email_references == "<first@example.com> <prior@example.com>"
    assert {"email", "outlook-pending"}.issubset(entry.tags)
    assert entry.attachment_paths
    assert (tmp_path / entry.attachment_paths[0]).read_bytes() == b"%PDF-1.4 attachment"

    stored = server.folders[account.drafts_folder].messages
    assert len(stored) == 1
    message = BytesParser(policy=policy.default).parsebytes(stored[0].raw)
    assert message["From"] == account.email
    assert [address for _name, address in getaddresses(message.get_all("To", []))] == [
        "primary@example.com",
        "second@example.com",
    ]
    assert [address for _name, address in getaddresses(message.get_all("Cc", []))] == [
        "copy@example.com"
    ]
    assert message["Subject"] == "GS-0048 draft handoff"
    assert message["Message-ID"] == entry.message_id
    assert message["X-GSSG-Handoff"] == str(entry.id)
    assert message["In-Reply-To"] == "<prior@example.com>"
    assert message["References"] == "<first@example.com> <prior@example.com>"

    plain_parts = [
        part.get_content()
        for part in message.walk()
        if part.get_content_type() == "text/plain"
        and part.get_content_disposition() != "attachment"
    ]
    assert len(plain_parts) == 1
    assert "Hello Outlook" in plain_parts[0]
    assert "Kind regards," in plain_parts[0]
    assert "GSSG" in plain_parts[0]
    html_parts = [
        part.get_content() for part in message.walk() if part.get_content_type() == "text/html"
    ]
    assert len(html_parts) == 1
    assert "Hello <strong>Outlook</strong>" in html_parts[0]
    assert signature in html_parts[0]
    assert "<!-- gssg-signature -->" in html_parts[0]
    assert "onclick" not in html_parts[0]
    assert "<script" not in html_parts[0]
    attachment = next(
        part for part in message.iter_attachments() if part.get_filename() == "record.pdf"
    )
    assert attachment.get_content_type() == "application/pdf"
    assert attachment.get_payload(decode=True) == b"%PDF-1.4 attachment"
    assert server.connections[0].logged_out is True


def test_mailto_outgoing_sanitizes_and_persists_without_email_account(
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    user = _user(db_session, email="mailto-service@test.ae")

    entry = email_service.draft_outgoing(
        db_session,
        owner_user_id=user.id,
        to=["first@example.com", "second@example.com"],
        cc=["copy@example.com"],
        subject="Mailto handoff",
        html='<p onclick="steal()">Approved <strong>body</strong></p><script>steal()</script>',
        mode="mailto",
        related_book_id=None,
        related_employee_id=None,
        in_reply_to=None,
        references=None,
        use_signature=True,
        attachments=[],
    )

    assert entry.owner_user_id == user.id
    assert entry.direction == "outgoing"
    assert entry.message_id is None
    assert entry.counterparty == "first@example.com"
    assert entry.to_recipients == [
        {"name": "", "address": "first@example.com"},
        {"name": "", "address": "second@example.com"},
    ]
    assert entry.cc_recipients == [{"name": "", "address": "copy@example.com"}]
    assert {"email", email_service.HANDOFF_TAG}.issubset(entry.tags)
    assert "Approved <strong>body</strong>" in (entry.notes_html or "")
    assert "onclick" not in (entry.notes_html or "")
    assert "<script" not in (entry.notes_html or "")
    assert db_session.execute(select(EmailAccount)).scalar_one_or_none() is None


def test_draft_outgoing_creates_missing_folder_and_retries_once(
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    user = _user(db_session, email="missing-folder@test.ae")
    account = _account(db_session, user, drafts_folder="Custom Drafts")
    server = FakeImapServer()

    entry = _draft(db_session, user=user, server=server)

    assert db_session.get(LedgerEntry, entry.id) is entry
    assert len(server.folders[account.drafts_folder].messages) == 1
    assert [operation.name for operation in server.connections[0].operations] == [
        "append",
        "create",
        "append",
        "logout",
    ]
    assert server.connections[0].logged_out is True


@pytest.mark.parametrize("failed_stage", ["create", "retry_append", "connect"])
def test_draft_outgoing_failure_rolls_back_row_file_and_logs_out_acquired_session(
    failed_stage: str,
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    user = _user(db_session, email=f"{failed_stage}@test.ae")
    account = _account(db_session, user, drafts_folder="Unavailable Drafts")
    server = FakeImapServer()
    if failed_stage == "create":
        server.queue_response("create", ("NO", [b"create refused"]))
    elif failed_stage == "retry_append":
        server.queue_response("append", ("NO", [b"missing folder"]))
        server.queue_response("append", ("NO", [b"retry refused"]))
    else:
        server.queue_connect_failure(RuntimeError("authentication rejected"))

    with pytest.raises(email_service.HandoffDeliveryError):
        _draft(db_session, user=user, server=server)

    db_session.expire_all()
    assert db_session.execute(select(LedgerEntry)).scalars().all() == []
    attachment_root = tmp_path / "ledger_attachments"
    assert not attachment_root.exists() or not any(
        path.is_file() for path in attachment_root.rglob("*")
    )
    assert server.connection_accounts == [account]
    if server.connections:
        assert server.connections[0].logged_out is True


def test_draft_outgoing_commit_failure_keeps_accepted_server_draft_only(
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    user = _user(db_session, email="commit-failure@test.ae")
    account = _account(db_session, user)
    server = FakeImapServer()
    server.add_folder(account.drafts_folder)

    def fail_commit(_session: Session) -> None:
        raise RuntimeError("synthetic commit failure")

    event.listen(db_session, "before_commit", fail_commit, once=True)

    with pytest.raises(
        email_service.HandoffDeliveryError,
        match="synthetic commit failure",
    ):
        _draft(db_session, user=user, server=server, attachment=b"accepted externally")

    db_session.expire_all()
    assert db_session.execute(select(LedgerEntry)).scalars().all() == []
    assert len(server.folders[account.drafts_folder].messages) == 1
    assert [operation.name for operation in server.connections[0].operations] == [
        "append",
        "logout",
    ]
    attachment_root = tmp_path / "ledger_attachments"
    assert not attachment_root.exists() or not any(
        path.is_file() for path in attachment_root.rglob("*")
    )


def test_sync_now_imports_stateful_mailbox_reconciles_once_and_repeats_idempotently(
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    user = _user(db_session, email="sync-owner@test.ae")
    account = _account(db_session, user)
    server = FakeImapServer()
    server.add_folder("INBOX")
    server.add_folder("Sent")
    server.add_folder(account.drafts_folder)
    employee = Employee(id="G9001", name_en="Mailbox Employee")
    db_session.add(employee)
    book = _book(db_session, employee_id=employee.id)
    correspondence_service.seed_defaults(db_session)
    pending = _draft(
        db_session,
        user=user,
        server=server,
        attachment=b"pending file",
        related_book_id=book.id,
        related_employee_id=employee.id,
    )
    unmatched = email_service.draft_outgoing(
        db_session,
        owner_user_id=user.id,
        to=["unmatched@example.com"],
        cc=[],
        subject="Unmatched pending",
        html="<p>Keep pending</p>",
        mode="mailto",
        related_book_id=None,
        related_employee_id=None,
        in_reply_to=None,
        references=None,
        use_signature=False,
        attachments=[],
    )
    now = datetime.now(UTC)
    server.add_message(
        "INBOX",
        _message(
            sender="outsider@example.com",
            to=account.email,
            subject="Incoming record",
            message_id="<incoming-1@example.com>",
            unsafe_html=True,
            with_attachments=True,
        ),
        internal_date=now,
        sequence_id=7,
    )
    server.add_message(
        "Sent",
        _message(
            sender=account.email,
            to="recipient@example.com",
            subject=pending.subject,
            message_id="<sent-1@gssg.ae>",
            handoff_id=pending.id,
        ),
        internal_date=now,
        sequence_id=31,
    )

    first = email_service.sync_now(
        db_session,
        user.id,
        connector=server.connector,
    )

    assert first.imported == 2
    assert first.skipped_duplicate == 0
    assert first.errors == []
    assert account.last_synced_at is not None
    assert account.last_synced_at.replace(tzinfo=UTC) == first.last_synced_at
    rows = (
        db_session.execute(select(LedgerEntry).where(LedgerEntry.channel == "email"))
        .scalars()
        .all()
    )
    incoming = next(row for row in rows if row.message_id == "<incoming-1@example.com>")
    sent = next(row for row in rows if row.message_id == "<sent-1@gssg.ae>")
    assert incoming.owner_user_id == user.id
    assert incoming.direction == "incoming"
    assert incoming.counterparty == "outsider@example.com"
    assert incoming.to_recipients == [{"name": "", "address": account.email}]
    assert "Mailbox <strong>body</strong>" in (incoming.notes_html or "")
    assert "onclick" not in (incoming.notes_html or "")
    assert "<script" not in (incoming.notes_html or "")
    assert len(incoming.attachment_paths) == 2
    assert incoming.inline_images == {"logo-1": incoming.attachment_paths[0]}
    assert {
        (tmp_path / relative_path).read_bytes() for relative_path in incoming.attachment_paths
    } == {b"inline-image", b"%PDF-1.4 incoming"}
    assert sent.direction == "outgoing"
    assert sent.owner_user_id == user.id
    assert sent.related_book_id == book.id
    assert sent.related_employee_id == employee.id
    assert pending.deleted_at is not None
    assert unmatched.deleted_at is None
    scan_rows = db_session.execute(select(ScanInbox)).scalars().all()
    assert len(scan_rows) == 1
    assert scan_rows[0].filename == "incoming.pdf"
    assert scan_rows[0].file_path in incoming.attachment_paths
    assert (tmp_path / scan_rows[0].file_path).read_bytes() == b"%PDF-1.4 incoming"
    scan_snapshot = [(row.id, row.file_path) for row in scan_rows]
    first_file_snapshot = list(incoming.attachment_paths)
    assert [
        operation.args[0]
        for operation in server.connections[-1].operations
        if operation.name == "fetch"
    ] == ["7", "31"]
    first_row_count = len(rows)
    assert (
        len(
            db_session.execute(select(LedgerEntry).where(LedgerEntry.source_kind == "sent_email"))
            .scalars()
            .all()
        )
        == 1
    )

    second = email_service.sync_now(
        db_session,
        user.id,
        connector=server.connector,
    )

    assert second.imported == 0
    assert second.skipped_duplicate == 2
    assert second.errors == []
    db_session.expire_all()
    rows_after_repeat = (
        db_session.execute(select(LedgerEntry).where(LedgerEntry.channel == "email"))
        .scalars()
        .all()
    )
    assert len(rows_after_repeat) == first_row_count
    repeated_incoming = next(
        row for row in rows_after_repeat if row.message_id == "<incoming-1@example.com>"
    )
    assert repeated_incoming.attachment_paths == first_file_snapshot
    assert [
        (row.id, row.file_path) for row in db_session.execute(select(ScanInbox)).scalars().all()
    ] == scan_snapshot
    assert _required_entry(db_session, pending.id).deleted_at == pending.deleted_at
    assert _required_entry(db_session, unmatched.id).deleted_at is None
    assert (
        len(
            db_session.execute(select(LedgerEntry).where(LedgerEntry.source_kind == "sent_email"))
            .scalars()
            .all()
        )
        == 1
    )


def test_sync_watermark_distinguishes_raised_list_error_from_no_status(
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    raised_user = _user(db_session, email="raised-list@test.ae")
    raised_account = _account(db_session, raised_user)
    prior = datetime(2026, 8, 1, 9, 30)
    raised_account.last_synced_at = prior
    db_session.commit()
    raised_server = FakeImapServer()
    raised_server.queue_response("list", RuntimeError("LIST transport failed"))

    raised = email_service.sync_now(
        db_session,
        raised_user.id,
        connector=raised_server.connector,
    )

    assert raised.errors == ["list inbox tree: LIST transport failed"]
    assert raised_account.last_synced_at == prior
    assert raised.last_synced_at == prior.replace(tzinfo=UTC)
    assert raised_account.last_sync_error == "list inbox tree: LIST transport failed"
    assert raised_server.connections[0].logged_out is True

    no_user = _user(db_session, email="no-status@test.ae")
    no_account = _account(db_session, no_user)
    no_account.last_synced_at = prior
    db_session.commit()
    no_server = FakeImapServer()
    no_server.queue_response("list", ("NO", [b"LIST refused"]))
    no_server.queue_response("list", ("NO", [b"LIST refused"]))

    no_result = email_service.sync_now(
        db_session,
        no_user.id,
        connector=no_server.connector,
    )

    assert no_result.errors == []
    assert no_account.last_synced_at is not None
    assert no_account.last_synced_at > prior
    assert no_result.last_synced_at == no_account.last_synced_at.replace(tzinfo=UTC)
    assert no_account.last_sync_error is None
    assert no_server.connections[0].logged_out is True


@pytest.mark.parametrize("operation", ["select", "search", "fetch"])
def test_sync_status_no_is_silent_and_advances_watermark(
    operation: Literal["select", "search", "fetch"],
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    user = _user(db_session, email=f"{operation}-no@test.ae")
    account = _account(db_session, user)
    prior = datetime(2026, 8, 2, 10, 0)
    account.last_synced_at = prior
    db_session.commit()
    server = FakeImapServer()
    server.add_folder("INBOX")
    server.add_folder("Sent")
    server.add_message(
        "INBOX",
        _message(
            sender="sender@example.com",
            to=account.email,
            subject="Silently unavailable",
            message_id=f"<{operation}-no@example.com>",
        ),
        internal_date=datetime.now(UTC),
    )
    if operation == "fetch":
        server.queue_fetch_response(("NO", [b"FETCH refused"]))
    else:
        server.queue_response(operation, ("NO", [f"{operation} refused".encode()]))

    result = email_service.sync_now(
        db_session,
        user.id,
        connector=server.connector,
    )

    assert result.imported == 0
    assert result.errors == []
    assert account.last_synced_at is not None
    assert account.last_synced_at > prior
    assert account.last_sync_error is None
    assert server.connections[0].logged_out is True


def test_sync_fetch_exception_is_reported_and_retains_watermark(
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    user = _user(db_session, email="fetch-error@test.ae")
    account = _account(db_session, user)
    prior = datetime(2026, 8, 2, 10, 0)
    account.last_synced_at = prior
    db_session.commit()
    server = FakeImapServer()
    server.add_folder("INBOX")
    server.add_folder("Sent")
    server.add_message(
        "INBOX",
        _message(
            sender="sender@example.com",
            to=account.email,
            subject="Fetch transport exception",
            message_id="<fetch-error@example.com>",
        ),
        internal_date=datetime.now(UTC),
    )
    server.queue_fetch_response(RuntimeError("FETCH transport failed"))

    result = email_service.sync_now(
        db_session,
        user.id,
        connector=server.connector,
    )

    assert result.imported == 0
    assert result.errors == ["INBOX: FETCH transport failed"]
    assert account.last_synced_at == prior
    assert account.last_sync_error == "INBOX: FETCH transport failed"
    assert server.connections[0].logged_out is True


def test_sync_attachment_processing_failure_rolls_back_row_and_retains_watermark(
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    blocked_data_path = tmp_path / "not-a-directory"
    blocked_data_path.write_text("blocks attachment directory creation")
    monkeypatch.setenv("GSSG_DATA_DIR", str(blocked_data_path))
    get_settings.cache_clear()
    crypto._load_or_create_key.cache_clear()
    user = _user(db_session, email="processing-error@test.ae")
    account = _account(db_session, user)
    prior = datetime(2026, 8, 2, 10, 0)
    account.last_synced_at = prior
    db_session.commit()
    server = FakeImapServer()
    server.add_folder("INBOX")
    server.add_folder("Sent")
    server.add_message(
        "INBOX",
        _message(
            sender="sender@example.com",
            to=account.email,
            subject="Attachment processing failure",
            message_id="<processing-error@example.com>",
            with_attachments=True,
        ),
        internal_date=datetime.now(UTC),
    )

    result = email_service.sync_now(
        db_session,
        user.id,
        connector=server.connector,
    )

    assert result.imported == 0
    assert len(result.errors) == 1
    assert result.errors[0].startswith("parse <processing-error@example.com>:")
    assert account.last_synced_at == prior
    assert account.last_sync_error == result.errors[0]
    assert db_session.execute(select(LedgerEntry)).scalars().all() == []
    assert db_session.execute(select(ScanInbox)).scalars().all() == []
    assert server.connections[0].logged_out is True


def test_sync_stale_tag_database_failure_is_reported_and_retains_watermark(
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    user = _user(db_session, email="stale-sync-error@test.ae")
    account = _account(db_session, user)
    prior = datetime(2026, 8, 2, 10, 0)
    account.last_synced_at = prior
    stale = _email_entry(
        db_session,
        owner_user_id=user.id,
        subject="Stale row whose flag query fails",
        tags=["email", email_service.HANDOFF_TAG],
        created_at=datetime.now(UTC).replace(tzinfo=None) - timedelta(hours=72),
    )
    db_session.commit()
    server = FakeImapServer()
    server.add_folder("INBOX")
    server.add_folder("Sent")
    engine = db_session.get_bind()

    def fail_stale_query(
        _connection: object,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: object,
    ) -> None:
        if "ledger_entries.created_at <" in statement and "json_each" in statement:
            raise RuntimeError("stale query unavailable")

    event.listen(engine, "before_cursor_execute", fail_stale_query)
    try:
        result = email_service.sync_now(
            db_session,
            user.id,
            connector=server.connector,
        )
    finally:
        event.remove(engine, "before_cursor_execute", fail_stale_query)

    assert result.errors == ["stale Outlook handoffs: stale query unavailable"]
    assert account.last_synced_at == prior
    assert account.last_sync_error == "stale Outlook handoffs: stale query unavailable"
    assert email_service.STALE_TAG not in _required_entry(db_session, stale.id).tags
    assert db_session.execute(select(LedgerFlag)).scalars().all() == []
    assert server.connections[0].logged_out is True


def test_reconciliation_commit_failure_is_not_retried_after_sent_import_dedup(
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    user = _user(db_session, email="reconcile-commit-error@test.ae")
    account = _account(db_session, user)
    prior = datetime(2026, 8, 2, 10, 0)
    account.last_synced_at = prior
    db_session.commit()
    server = FakeImapServer()
    server.add_folder("INBOX")
    server.add_folder("Sent")
    server.add_folder(account.drafts_folder)
    pending = _draft(db_session, user=user, server=server)
    sent_message_id = "<reconcile-commit-error@gssg.ae>"
    server.add_message(
        "Sent",
        _message(
            sender=account.email,
            to="recipient@example.com",
            subject=pending.subject,
            message_id=sent_message_id,
            handoff_id=pending.id,
        ),
        internal_date=datetime.now(UTC),
    )
    commits = 0

    def fail_reconciliation_commit(_session: Session) -> None:
        nonlocal commits
        commits += 1
        if commits == 2:
            raise RuntimeError("reconciliation commit unavailable")

    event.listen(db_session, "before_commit", fail_reconciliation_commit)
    try:
        first = email_service.sync_now(
            db_session,
            user.id,
            connector=server.connector,
        )
    finally:
        event.remove(db_session, "before_commit", fail_reconciliation_commit)

    assert first.imported == 1
    assert first.skipped_duplicate == 0
    assert len(first.errors) == 1
    assert first.errors[0].startswith(f"parse {sent_message_id}: reconciliation commit unavailable")
    assert account.last_synced_at == prior
    assert _required_entry(db_session, pending.id).deleted_at is None
    sent_rows = (
        db_session.execute(select(LedgerEntry).where(LedgerEntry.message_id == sent_message_id))
        .scalars()
        .all()
    )
    assert len(sent_rows) == 1
    assert sent_rows[0].deleted_at is None

    second = email_service.sync_now(
        db_session,
        user.id,
        connector=server.connector,
    )

    assert second.imported == 0
    assert second.skipped_duplicate == 1
    assert second.errors == []
    assert _required_entry(db_session, pending.id).deleted_at is None
    assert (
        len(
            db_session.execute(select(LedgerEntry).where(LedgerEntry.message_id == sent_message_id))
            .scalars()
            .all()
        )
        == 1
    )


def test_sync_connect_failure_commits_error_and_reraises(
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    user = _user(db_session, email="connect-error@test.ae")
    account = _account(db_session, user)
    server = FakeImapServer()
    server.queue_connect_failure(RuntimeError("authentication unavailable"))

    with pytest.raises(RuntimeError, match="authentication unavailable"):
        email_service.sync_now(
            db_session,
            user.id,
            connector=server.connector,
        )

    db_session.expire_all()
    stored = db_session.get(EmailAccount, account.id)
    assert stored is not None
    assert stored.last_sync_error == "connect: authentication unavailable"
    assert stored.last_synced_at is None
    assert server.connection_accounts == [account]
    assert server.connections == []


def test_never_synced_partial_result_reports_run_time_without_storing_watermark(
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    user = _user(db_session, email="first-partial@test.ae")
    account = _account(db_session, user)
    server = FakeImapServer()
    server.queue_response("list", RuntimeError("temporary LIST failure"))
    before = datetime.now(UTC)

    result = email_service.sync_now(
        db_session,
        user.id,
        connector=server.connector,
    )

    after = datetime.now(UTC)
    assert result.errors == ["list inbox tree: temporary LIST failure"]
    assert before <= result.last_synced_at <= after
    assert account.last_synced_at is None
    assert account.last_sync_error == "list inbox tree: temporary LIST failure"


def test_sync_all_accounts_continues_after_failure_under_one_global_lock(
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    failed_user = _user(db_session, email="batch-failed@test.ae")
    failed_account = _account(db_session, failed_user)
    successful_user = _user(db_session, email="batch-success@test.ae")
    successful_account = _account(db_session, successful_user)
    server = FakeImapServer()
    server.queue_connect_failure(RuntimeError("first account rejected"))
    lock_states: list[bool] = []

    def connector(account: EmailAccount) -> FakeImapConnection:
        lock_states.append(
            email_service.get_sync_status(
                db_session,
                owner_user_id=account.owner_user_id,
            ).syncing
        )
        return server.connector(account)

    results = email_service.sync_all_accounts(
        db_session,
        connector=connector,
    )

    assert len(results) == 1
    assert results[0].imported == 0
    assert results[0].errors == []
    assert server.connection_accounts == [failed_account, successful_account]
    assert lock_states == [True, True]
    assert failed_account.last_sync_error == "connect: first account rejected"
    assert failed_account.last_synced_at is None
    assert successful_account.last_sync_error is None
    assert successful_account.last_synced_at is not None
    assert server.connections[0].account is successful_account
    assert server.connections[0].logged_out is True
    assert (
        email_service.get_sync_status(
            db_session,
            owner_user_id=successful_user.id,
        ).syncing
        is False
    )


def test_sync_discovers_space_folder_batches_sequence_ids_and_reports_backlog(
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    user = _user(db_session, email="batching@test.ae")
    account = _account(db_session, user)
    account.sent_folder = "Sent Items"
    prior = datetime(2026, 8, 3, 11, 0)
    account.last_synced_at = prior
    db_session.commit()
    server = FakeImapServer()
    server.add_folder("INBOX")
    server.add_folder("Sent Items")
    server.add_folder("Sent Items/Archive")
    server.add_folder("Sent Items/Groups", flags=[r"\Noselect"])
    for sequence_id in range(1, 52):
        server.add_message(
            "Sent Items/Archive",
            _message(
                sender=account.email,
                to="recipient@example.com",
                subject=f"Archived message {sequence_id}",
                message_id=f"<archived-{sequence_id}@gssg.ae>",
            ),
            internal_date=datetime.now(UTC),
            sequence_id=sequence_id,
        )

    result = email_service.sync_now(
        db_session,
        user.id,
        connector=server.connector,
    )

    assert result.imported == 50
    assert result.errors == ["Sent Items/Archive: fetch limit hit (1 pending)"]
    assert account.last_synced_at == prior
    connection = server.connections[0]
    selected = [
        operation.args[0] for operation in connection.operations if operation.name == "select"
    ]
    assert selected == ["INBOX", '"Sent Items"', '"Sent Items/Archive"']
    fetched = [
        operation.args[0] for operation in connection.operations if operation.name == "fetch"
    ]
    assert fetched == [
        ",".join(str(value) for value in range(2, 27)),
        ",".join(str(value) for value in range(27, 52)),
    ]
    assert connection.logged_out is True


def test_reconcile_direct_header_merges_links_and_logs_email_sent(
    db_session: Session,
) -> None:
    user = _user(db_session, email="header-reconcile@test.ae")
    account = _account(db_session, user)
    employee = Employee(id="G0048", name_en="Linked Employee")
    db_session.add(employee)
    book = _book(db_session, employee_id=employee.id)
    correspondence_service.seed_defaults(db_session)
    pending = _email_entry(
        db_session,
        owner_user_id=user.id,
        subject="Benefit paperwork",
        tags=["email", email_service.HANDOFF_TAG],
        related_book_id=book.id,
        related_employee_id=employee.id,
    )
    sent = _email_entry(
        db_session,
        owner_user_id=user.id,
        subject="RE: Benefit paperwork",
    )
    db_session.commit()
    pending_id = pending.id
    sent_id = sent.id
    message = EmailMessage()
    message[email_service.HANDOFF_HEADER] = str(pending_id)
    message["Message-ID"] = "<sent-header@example.com>"

    email_service.reconcile_sent_entry(
        db_session,
        entry=sent,
        msg=message,
        account=account,
    )

    db_session.expire_all()
    merged_pending = db_session.get(LedgerEntry, pending_id)
    confirmed = db_session.get(LedgerEntry, sent_id)
    assert merged_pending is not None
    assert merged_pending.deleted_at is not None
    assert confirmed is not None
    assert confirmed.related_book_id == book.id
    assert confirmed.related_employee_id == employee.id
    log_row = db_session.execute(
        select(LedgerEntry).where(
            LedgerEntry.source_kind == "sent_email",
            LedgerEntry.related_book_id == book.id,
            LedgerEntry.owner_user_id.is_(None),
        )
    ).scalar_one()
    category = db_session.get(CorrespondenceCategory, log_row.category_id)
    assert category is not None
    assert category.key == "hr_letters"
    assert log_row.subject == sent.subject
    assert log_row.related_employee_id == employee.id
    assert log_row.created_by == account.email


def test_reconcile_normalized_fallback_deletes_oldest_matching_pending_only(
    db_session: Session,
) -> None:
    user = _user(db_session, email="fallback-reconcile@test.ae")
    account = _account(db_session, user)
    sent_date = date.today()
    now = datetime.now(UTC).replace(tzinfo=None)
    oldest = _email_entry(
        db_session,
        owner_user_id=user.id,
        subject="Quarterly   Transfer",
        to="Recipient@Example.COM",
        entry_date=sent_date - timedelta(days=4),
        tags=[
            "email",
            email_service.HANDOFF_TAG,
            "msgid:original-oldest@example.com",
        ],
        created_at=now - timedelta(days=4),
    )
    newer = _email_entry(
        db_session,
        owner_user_id=user.id,
        subject="RE: quarterly transfer",
        to="recipient@example.com",
        entry_date=sent_date - timedelta(days=2),
        tags=[
            "email",
            email_service.HANDOFF_TAG,
            "msgid:original-newer@example.com",
        ],
        created_at=now - timedelta(days=2),
    )
    unrelated = _email_entry(
        db_session,
        owner_user_id=user.id,
        subject="Different subject",
        to="recipient@example.com",
        entry_date=sent_date - timedelta(days=3),
        tags=["email", email_service.HANDOFF_TAG],
        created_at=now - timedelta(days=3),
    )
    sent = _email_entry(
        db_session,
        owner_user_id=user.id,
        subject="FW: RE:   QUARTERLY transfer",
        to="recipient@example.com",
        entry_date=sent_date,
        tags=["email", "msgid:rewritten@example.com"],
        message_id="<rewritten@example.com>",
    )
    db_session.commit()
    oldest_id, newer_id, unrelated_id = oldest.id, newer.id, unrelated.id
    message = EmailMessage()
    message["Message-ID"] = "<rewritten@example.com>"

    email_service.reconcile_sent_entry(
        db_session,
        entry=sent,
        msg=message,
        account=account,
    )

    db_session.expire_all()
    assert _required_entry(db_session, oldest_id).deleted_at is not None
    assert _required_entry(db_session, newer_id).deleted_at is None
    assert _required_entry(db_session, unrelated_id).deleted_at is None


def test_reconcile_message_id_matches_same_owner_and_rejects_foreign_header(
    db_session: Session,
) -> None:
    user = _user(db_session, email="message-id-owner@test.ae")
    account = _account(db_session, user)
    foreign_user = _user(db_session, email="message-id-foreign@test.ae")
    exact_id = "<exact-match@example.com>"
    exact = _email_entry(
        db_session,
        owner_user_id=user.id,
        subject="Original subject",
        tags=["email", email_service.HANDOFF_TAG, "msgid:exact-match@example.com"],
    )
    exact_sent = _email_entry(
        db_session,
        owner_user_id=user.id,
        subject="Different sent subject",
        message_id=exact_id,
    )
    foreign = _email_entry(
        db_session,
        owner_user_id=foreign_user.id,
        subject="Foreign pending",
        tags=["email", email_service.HANDOFF_TAG],
    )
    foreign_sent = _email_entry(
        db_session,
        owner_user_id=user.id,
        subject="No fallback candidate",
    )
    db_session.commit()

    exact_message = EmailMessage()
    exact_message["Message-ID"] = exact_id
    email_service.reconcile_sent_entry(
        db_session,
        entry=exact_sent,
        msg=exact_message,
        account=account,
    )
    foreign_message = EmailMessage()
    foreign_message[email_service.HANDOFF_HEADER] = str(foreign.id)
    email_service.reconcile_sent_entry(
        db_session,
        entry=foreign_sent,
        msg=foreign_message,
        account=account,
    )

    db_session.expire_all()
    assert _required_entry(db_session, exact.id).deleted_at is not None
    assert _required_entry(db_session, foreign.id).deleted_at is None


def test_reconcile_direct_outlook_links_mixed_case_ref_but_ignores_no_ref_subject(
    db_session: Session,
) -> None:
    user = _user(db_session, email="direct-outlook@test.ae")
    account = _account(db_session, user)
    employee = Employee(id="G1048", name_en="Direct Outlook Employee")
    db_session.add(employee)
    book = _book(db_session, employee_id=employee.id)
    correspondence_service.seed_defaults(db_session)
    linked_sent = _email_entry(
        db_session,
        owner_user_id=user.id,
        subject="Direct Outlook update for gS-0048",
    )
    db_session.commit()
    linked_message = EmailMessage()
    linked_message["Message-ID"] = "<direct-linked@example.com>"

    email_service.reconcile_sent_entry(
        db_session,
        entry=linked_sent,
        msg=linked_message,
        account=account,
    )

    db_session.expire_all()
    linked = db_session.get(LedgerEntry, linked_sent.id)
    assert linked is not None
    assert linked.related_book_id == book.id
    assert linked.related_employee_id == employee.id
    initial_logs = (
        db_session.execute(select(LedgerEntry).where(LedgerEntry.source_kind == "sent_email"))
        .scalars()
        .all()
    )
    assert len(initial_logs) == 1
    assert initial_logs[0].related_book_id == book.id
    assert initial_logs[0].subject == linked_sent.subject

    foreign_sent = _email_entry(
        db_session,
        owner_user_id=user.id,
        subject="Direct Outlook update without a book reference",
    )
    db_session.commit()
    foreign_id = foreign_sent.id
    foreign_message = EmailMessage()
    foreign_message["Message-ID"] = "<direct-foreign@example.com>"

    email_service.reconcile_sent_entry(
        db_session,
        entry=foreign_sent,
        msg=foreign_message,
        account=account,
    )

    db_session.expire_all()
    foreign = db_session.get(LedgerEntry, foreign_id)
    assert foreign is not None
    assert foreign.related_book_id is None
    assert foreign.related_employee_id is None
    all_logs = (
        db_session.execute(select(LedgerEntry).where(LedgerEntry.source_kind == "sent_email"))
        .scalars()
        .all()
    )
    assert len(all_logs) == 1


def test_flag_stale_handoffs_is_idempotent_and_scoped_to_live_pending_rows(
    db_session: Session,
) -> None:
    user = _user(db_session, email="stale-handoff@test.ae")
    account = _account(db_session, user)
    foreign_user = _user(db_session, email="foreign-stale@test.ae")
    now = datetime.now(UTC).replace(tzinfo=None)
    stale = _email_entry(
        db_session,
        owner_user_id=user.id,
        subject="Stale pending handoff",
        tags=["email", email_service.HANDOFF_TAG],
        created_at=now - timedelta(hours=49),
    )
    fresh = _email_entry(
        db_session,
        owner_user_id=user.id,
        subject="Fresh pending handoff",
        tags=["email", email_service.HANDOFF_TAG],
        created_at=now - timedelta(hours=47),
    )
    deleted = _email_entry(
        db_session,
        owner_user_id=user.id,
        subject="Deleted pending handoff",
        tags=["email", email_service.HANDOFF_TAG],
        created_at=now - timedelta(hours=72),
        deleted_at=now - timedelta(hours=1),
    )
    already_stale = _email_entry(
        db_session,
        owner_user_id=user.id,
        subject="Already stale pending handoff",
        tags=["email", email_service.HANDOFF_TAG, email_service.STALE_TAG],
        created_at=now - timedelta(hours=72),
    )
    foreign = _email_entry(
        db_session,
        owner_user_id=foreign_user.id,
        subject="Foreign stale pending handoff",
        tags=["email", email_service.HANDOFF_TAG],
        created_at=now - timedelta(hours=72),
    )
    db_session.commit()

    email_service.flag_stale_handoffs(db_session, account=account)
    email_service.flag_stale_handoffs(db_session, account=account)

    db_session.expire_all()
    assert _required_entry(db_session, stale.id).tags.count(email_service.STALE_TAG) == 1
    assert email_service.STALE_TAG not in _required_entry(db_session, fresh.id).tags
    assert email_service.STALE_TAG not in _required_entry(db_session, deleted.id).tags
    assert _required_entry(db_session, already_stale.id).tags.count(email_service.STALE_TAG) == 1
    assert email_service.STALE_TAG not in _required_entry(db_session, foreign.id).tags
    flags = (
        db_session.execute(select(LedgerFlag).where(LedgerFlag.user_id == user.id)).scalars().all()
    )
    assert len(flags) == 1
    assert flags[0].entry_id == stale.id
    assert flags[0].followup_due == date.today()


def test_sync_excludes_pending_message_id_from_dedup_but_skips_confirmed_mail(
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    user = _user(db_session, email="dedupe-handoff@test.ae")
    account = _account(db_session, user)
    pending_message_id = "<pending-draft@example.com>"
    confirmed_message_id = "<confirmed-sent@example.com>"
    pending = _email_entry(
        db_session,
        owner_user_id=user.id,
        subject="Pending draft",
        tags=["email", email_service.HANDOFF_TAG, "msgid:pending-draft@example.com"],
        message_id=pending_message_id,
    )
    confirmed = _email_entry(
        db_session,
        owner_user_id=user.id,
        subject="Confirmed sent mail",
        tags=["email", "msgid:confirmed-sent@example.com"],
        message_id=confirmed_message_id,
    )
    db_session.commit()
    server = FakeImapServer()
    server.add_folder("INBOX")
    server.add_folder("Sent")
    now = datetime.now(UTC)
    server.add_message(
        "Sent",
        _message(
            sender=account.email,
            to="recipient@example.com",
            subject=pending.subject,
            message_id=pending_message_id,
            handoff_id=pending.id,
        ),
        internal_date=now,
        sequence_id=4,
    )
    server.add_message(
        "Sent",
        _message(
            sender=account.email,
            to="recipient@example.com",
            subject=confirmed.subject,
            message_id=confirmed_message_id,
        ),
        internal_date=now,
        sequence_id=9,
    )

    first = email_service.sync_now(
        db_session,
        user.id,
        connector=server.connector,
    )

    assert first.imported == 1
    assert first.skipped_duplicate == 1
    db_session.expire_all()
    assert _required_entry(db_session, pending.id).deleted_at is not None
    pending_id_rows = (
        db_session.execute(select(LedgerEntry).where(LedgerEntry.message_id == pending_message_id))
        .scalars()
        .all()
    )
    assert len(pending_id_rows) == 2
    assert sum(row.deleted_at is None for row in pending_id_rows) == 1
    confirmed_id_rows = (
        db_session.execute(
            select(LedgerEntry).where(LedgerEntry.message_id == confirmed_message_id)
        )
        .scalars()
        .all()
    )
    assert [row.id for row in confirmed_id_rows] == [confirmed.id]

    second = email_service.sync_now(
        db_session,
        user.id,
        connector=server.connector,
    )

    assert second.imported == 0
    assert second.skipped_duplicate == 2
