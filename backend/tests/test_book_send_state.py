from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, date, datetime
from email.message import EmailMessage
from pathlib import Path

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db.models import (
    Book,
    BookCategory,
    BookVersion,
    EmailAccount,
    LedgerEntry,
    ScanInbox,
    User,
)
from app.services import book_service, email_service, scan_inbox_service

_FIXTURES = Path(__file__).parent / "fixtures" / "scan_triage"


@pytest.fixture()
def isolated_data_dir(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Iterator[Path]:
    monkeypatch.setenv("GSSG_DATA_DIR", str(tmp_path))
    get_settings.cache_clear()
    yield tmp_path
    get_settings.cache_clear()


def _user(db: Session, *, email: str) -> User:
    user = User(email=email, password_hash="x", role="operator", status="active")
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
        password_encrypted="unused-by-test",
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


def _book(db: Session) -> Book:
    db.add(BookCategory(id="GS", name_en="General", prefix="GS"))
    book = Book(category_id="GS", ref_number="GS-0048", subject="Transfer")
    db.add(book)
    db.commit()
    db.refresh(book)
    return book


def _awaiting_scan_book(db: Session) -> Book:
    db.add(
        BookCategory(
            id="GS",
            name_en="General Services",
            name_ar="الخدمات العامة",
            prefix="GS",
        )
    )
    book = Book(
        category_id="GS",
        ref_number="GS-0042",
        subject="Synthetic returned form",
        approval_state="awaiting_scan",
        attachment_paths=[],
    )
    db.add(book)
    db.flush()
    db.add(
        BookVersion(
            book_id=book.id,
            version_no=1,
            trigger="initial",
            status="awaiting_scan",
        )
    )
    db.flush()
    return book


def _entry(
    db: Session,
    *,
    owner_user_id: int,
    direction: str,
    subject: str,
    message_id: str | None = None,
    in_reply_to: str | None = None,
    related_book_id: int | None = None,
) -> LedgerEntry:
    now = datetime.now(UTC).replace(tzinfo=None)
    entry = LedgerEntry(
        entry_date=date.today(),
        direction=direction,
        channel="email",
        counterparty="other@example.com",
        subject=subject,
        attachment_paths=[],
        tags=["email"],
        owner_user_id=owner_user_id,
        to_recipients=[],
        cc_recipients=[],
        bcc_recipients=[],
        related_book_id=related_book_id,
        created_at=now,
        message_id=message_id,
        in_reply_to=in_reply_to,
        read_at=now,
    )
    db.add(entry)
    db.flush()
    return entry


def _reply_message(*, in_reply_to: str | None, data: bytes | None) -> EmailMessage:
    msg = EmailMessage()
    msg["Message-ID"] = "<reply-1@example.com>"
    if in_reply_to is not None:
        msg["In-Reply-To"] = in_reply_to
    msg.set_content("signed copy attached")
    if data is not None:
        msg.add_attachment(data, maintype="application", subtype="pdf", filename="signed.pdf")
    return msg


def _queue_attachment(
    db: Session, *, entry_id: int, owner_id: int, root: Path, data: bytes
) -> None:
    """Mirror what mail ingest already did before reconciliation runs."""
    rel = f"ledger_attachments/{entry_id}/signed.pdf"
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    scan_inbox_service.enqueue_email_attachment(
        db,
        ledger_entry_id=entry_id,
        owner_user_id=owner_id,
        rel_path=rel,
        filename="signed.pdf",
        data=data,
        is_inline=False,
    )
    db.commit()


# ─────────────────── unsent -> sent on Sent-folder reconciliation ───────────────────


def test_reconcile_sent_entry_marks_book_sent(db_session: Session) -> None:
    user = _user(db_session, email="sent-state@test.ae")
    account = _account(db_session, user)
    book = _book(db_session)
    assert book.send_state == "unsent"
    entry = _entry(
        db_session,
        owner_user_id=user.id,
        direction="outgoing",
        subject="Handoff",
        message_id="<handoff-sent@gssg.ae>",
        related_book_id=book.id,
    )
    message = EmailMessage()
    message["Message-ID"] = "<handoff-sent@gssg.ae>"
    message.set_content("sent")

    email_service.reconcile_sent_entry(db_session, entry=entry, msg=message, account=account)

    db_session.expire_all()
    stored = db_session.get(Book, book.id)
    assert stored is not None
    assert stored.send_state == "sent"
    assert stored.approval_state == "none"


def test_reconcile_sent_entry_never_downgrades_confirmed(db_session: Session) -> None:
    user = _user(db_session, email="sent-state-confirmed@test.ae")
    account = _account(db_session, user)
    book = _book(db_session)
    book.send_state = "confirmed"
    db_session.commit()
    entry = _entry(
        db_session,
        owner_user_id=user.id,
        direction="outgoing",
        subject="Handoff",
        message_id="<handoff-confirmed@gssg.ae>",
        related_book_id=book.id,
    )
    message = EmailMessage()
    message["Message-ID"] = "<handoff-confirmed@gssg.ae>"
    message.set_content("sent")

    email_service.reconcile_sent_entry(db_session, entry=entry, msg=message, account=account)

    db_session.expire_all()
    stored = db_session.get(Book, book.id)
    assert stored is not None
    assert stored.send_state == "confirmed"


# ───────────────────── confirmed via threaded reply match ───────────────────────────


def test_threaded_reply_with_attachment_confirms_and_files(
    db_session: Session,
    isolated_data_dir: Path,
) -> None:
    user = _user(db_session, email="reply-match@test.ae")
    account = _account(db_session, user)
    book = _book(db_session)
    book.approval_state = "approved"
    db_session.commit()
    _entry(
        db_session,
        owner_user_id=user.id,
        direction="outgoing",
        subject="GS-0048 handoff",
        message_id="<handoff-1@gssg.ae>",
        related_book_id=book.id,
    )
    incoming = _entry(
        db_session,
        owner_user_id=user.id,
        direction="incoming",
        subject="Re: returned paperwork",
        in_reply_to="<handoff-1@gssg.ae>",
    )
    db_session.commit()
    pdf_bytes = (_FIXTURES / "returned-form-text.pdf").read_bytes()
    _queue_attachment(
        db_session, entry_id=incoming.id, owner_id=user.id, root=isolated_data_dir, data=pdf_bytes
    )
    message = _reply_message(in_reply_to="<handoff-1@gssg.ae>", data=pdf_bytes)

    email_service.reconcile_incoming_reply(db_session, entry=incoming, msg=message, account=account)

    db_session.expire_all()
    stored_book = db_session.get(Book, book.id)
    assert stored_book is not None
    assert stored_book.send_state == "confirmed"
    assert stored_book.approval_state == "approved"
    assert len(stored_book.attachment_paths) == 1
    filed_path = isolated_data_dir / stored_book.attachment_paths[-1]
    assert filed_path.read_bytes() == pdf_bytes

    row = db_session.execute(
        select(ScanInbox).where(ScanInbox.ledger_entry_id == incoming.id)
    ).scalar_one()
    assert row.state == "auto_filed"
    assert row.source == "email_reply_match"
    assert row.proposed_book_id == book.id


def test_subject_only_match_does_not_confirm(
    db_session: Session,
    isolated_data_dir: Path,
) -> None:
    user = _user(db_session, email="subject-only@test.ae")
    account = _account(db_session, user)
    book = _book(db_session)
    _entry(
        db_session,
        owner_user_id=user.id,
        direction="outgoing",
        subject="GS-0048 handoff",
        message_id="<handoff-2@gssg.ae>",
        related_book_id=book.id,
    )
    incoming = _entry(
        db_session,
        owner_user_id=user.id,
        direction="incoming",
        subject="Re: GS-0048 returned paperwork",
    )
    db_session.commit()
    pdf_bytes = (_FIXTURES / "returned-form-text.pdf").read_bytes()
    _queue_attachment(
        db_session, entry_id=incoming.id, owner_id=user.id, root=isolated_data_dir, data=pdf_bytes
    )
    message = _reply_message(in_reply_to=None, data=pdf_bytes)

    email_service.reconcile_incoming_reply(db_session, entry=incoming, msg=message, account=account)

    db_session.expire_all()
    stored_book = db_session.get(Book, book.id)
    assert stored_book is not None
    assert stored_book.send_state == "unsent"
    assert stored_book.attachment_paths == []
    row = db_session.execute(
        select(ScanInbox).where(ScanInbox.ledger_entry_id == incoming.id)
    ).scalar_one()
    assert row.state == "pending_ocr"
    assert row.source == "email_attachment"


def test_thread_match_without_attachment_does_not_confirm(db_session: Session) -> None:
    user = _user(db_session, email="no-attachment@test.ae")
    account = _account(db_session, user)
    book = _book(db_session)
    _entry(
        db_session,
        owner_user_id=user.id,
        direction="outgoing",
        subject="GS-0048 handoff",
        message_id="<handoff-3@gssg.ae>",
        related_book_id=book.id,
    )
    incoming = _entry(
        db_session,
        owner_user_id=user.id,
        direction="incoming",
        subject="Re: handoff",
        in_reply_to="<handoff-3@gssg.ae>",
    )
    db_session.commit()
    message = _reply_message(in_reply_to="<handoff-3@gssg.ae>", data=None)

    email_service.reconcile_incoming_reply(db_session, entry=incoming, msg=message, account=account)

    db_session.expire_all()
    stored_book = db_session.get(Book, book.id)
    assert stored_book is not None
    assert stored_book.send_state == "unsent"


# ─────────────────────── confirmed via scan-back flip ───────────────────────────────


def test_scan_back_flip_confirms_send_state(
    db_session: Session,
    isolated_data_dir: Path,
) -> None:
    owner = _user(db_session, email="scan-back-owner@test.ae")
    book = _awaiting_scan_book(db_session)
    db_session.commit()
    pdf_bytes = (_FIXTURES / "returned-form-text.pdf").read_bytes()

    book_service.add_attachment(db_session, book.id, "signed.pdf", pdf_bytes, user=owner)

    db_session.expire_all()
    stored = db_session.get(Book, book.id)
    assert stored is not None
    assert stored.send_state == "confirmed"
    assert stored.approval_state == "approved"
