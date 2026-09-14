from __future__ import annotations

import imaplib
import logging
import threading
from collections.abc import Iterator
from datetime import UTC, datetime
from email.message import EmailMessage
from pathlib import Path

import pytest
from sqlalchemy.orm import Session, sessionmaker

from app.config import get_settings
from app.core import crypto
from app.db.models import EmailAccount, LedgerEntry, User
from app.services import email_service, scheduler_service
from tests.fakes.imap import FakeImapConnection, FakeImapServer


@pytest.fixture(autouse=True)
def _forbid_external_imap(monkeypatch: pytest.MonkeyPatch) -> None:
    def blocked(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("tests must inject FakeImapServer.connector")

    monkeypatch.setattr(imaplib, "IMAP4", blocked)
    monkeypatch.setattr(imaplib, "IMAP4_SSL", blocked)


@pytest.fixture()
def isolated_data_dir(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Iterator[Path]:
    monkeypatch.setenv("GSSG_DATA_DIR", str(tmp_path))
    get_settings.cache_clear()
    crypto._load_or_create_key.cache_clear()
    yield tmp_path
    get_settings.cache_clear()
    crypto._load_or_create_key.cache_clear()


class _TrackingSession(Session):
    was_closed = False

    def close(self) -> None:
        self.was_closed = True
        super().close()


def test_scheduler_syncs_real_enabled_mailbox_and_closes_its_session(
    api_db: Session,
    isolated_data_dir: Path,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    user = User(
        email="scheduler-mailbox@test.ae",
        password_hash="x",
        role="operator",
        status="active",
    )
    api_db.add(user)
    api_db.flush()
    account = EmailAccount(
        email="scheduler@gssg.ae",
        imap_host="imap.ionos.com",
        imap_port=993,
        use_ssl=True,
        username="scheduler@gssg.ae",
        password_encrypted="unused-by-fake-imap",
        smtp_host="smtp.ionos.com",
        smtp_port=587,
        smtp_use_tls=True,
        sent_folder="Sent",
        drafts_folder="Drafts",
        inbox_folder="INBOX",
        enabled=True,
        sync_interval_minutes=5,
        owner_user_id=user.id,
    )
    api_db.add(account)
    api_db.commit()

    incoming = EmailMessage()
    incoming["From"] = "Scheduler Vendor <vendor@example.com>"
    incoming["To"] = account.email
    incoming["Subject"] = "Scheduled mailbox import"
    incoming["Message-ID"] = "<scheduler-sync@example.com>"
    incoming["Date"] = "Fri, 05 Sep 2026 09:00:00 +0400"
    incoming.set_content("Scheduled mailbox body")
    server = FakeImapServer()
    server.add_folder(account.inbox_folder)
    server.add_folder(account.sent_folder)
    server.add_message(
        account.inbox_folder,
        incoming.as_bytes(),
        internal_date=datetime.now(UTC),
    )
    monkeypatch.setattr(email_service, "connect_imap", server.connector)

    sessions: list[_TrackingSession] = []
    make_session = sessionmaker(
        bind=api_db.get_bind(),
        class_=_TrackingSession,
        autoflush=False,
        expire_on_commit=False,
        future=True,
    )

    def session_factory() -> _TrackingSession:
        session = make_session()
        sessions.append(session)
        return session

    monkeypatch.setattr(scheduler_service, "SessionLocal", session_factory)
    caplog.set_level(logging.INFO, logger=scheduler_service.__name__)

    scheduler_service._run_email_sync()

    assert len(sessions) == 1
    assert sessions[0].was_closed is True
    assert len(server.connections) == 1
    assert server.connections[0].logged_out is True
    assert server.connection_accounts[0].id == account.id
    api_db.expire_all()
    imported = api_db.query(LedgerEntry).one()
    assert imported.owner_user_id == user.id
    assert imported.direction == "incoming"
    assert imported.subject == "Scheduled mailbox import"
    assert imported.message_id == "<scheduler-sync@example.com>"
    refreshed_account = api_db.get(EmailAccount, account.id)
    assert refreshed_account is not None
    assert refreshed_account.last_sync_count == 1
    assert refreshed_account.last_sync_error is None
    assert refreshed_account.last_synced_at is not None
    assert "scheduler: synced 1 account(s)" in caplog.text
    assert "imported=1" in caplog.text
    assert not (isolated_data_dir / "ledger_attachments").exists()


def test_scheduler_skips_busy_mailbox_sync_and_closes_its_session(
    api_db: Session,
    isolated_data_dir: Path,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    user = User(
        email="scheduler-busy@test.ae",
        password_hash="x",
        role="operator",
        status="active",
    )
    api_db.add(user)
    api_db.flush()
    account = EmailAccount(
        email="busy@gssg.ae",
        imap_host="imap.ionos.com",
        imap_port=993,
        use_ssl=True,
        username="busy@gssg.ae",
        password_encrypted="unused-by-fake-imap",
        smtp_host="smtp.ionos.com",
        smtp_port=587,
        smtp_use_tls=True,
        sent_folder="Sent",
        drafts_folder="Drafts",
        inbox_folder="INBOX",
        enabled=True,
        sync_interval_minutes=5,
        owner_user_id=user.id,
    )
    api_db.add(account)
    api_db.commit()

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

    def run_manual_sync() -> None:
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

    worker = threading.Thread(target=run_manual_sync)
    worker.start()
    assert started.wait(timeout=10), "manual sync never reached the mailbox boundary"

    sessions: list[_TrackingSession] = []
    make_session = sessionmaker(
        bind=api_db.get_bind(),
        class_=_TrackingSession,
        autoflush=False,
        expire_on_commit=False,
        future=True,
    )

    def session_factory() -> _TrackingSession:
        session = make_session()
        sessions.append(session)
        return session

    monkeypatch.setattr(email_service, "connect_imap", server.connector)
    monkeypatch.setattr(scheduler_service, "SessionLocal", session_factory)
    caplog.set_level(logging.INFO, logger=scheduler_service.__name__)
    try:
        scheduler_service._run_email_sync()
    finally:
        release.set()
        worker.join(timeout=10)

    assert len(sessions) == 1
    assert sessions[0].was_closed is True
    assert "scheduler: email sync skipped (a sync is already running)" in caplog.text
    assert worker.is_alive() is False
    assert worker_errors == []
    assert len(server.connections) == 1
    assert server.connections[0].logged_out is True
    assert api_db.query(LedgerEntry).count() == 0
    assert not (isolated_data_dir / "ledger_attachments").exists()
