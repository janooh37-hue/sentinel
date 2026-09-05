from __future__ import annotations

import imaplib

import pytest
from sqlalchemy.orm import Session

from app.db.models import EmailAccount, User
from app.services import email_service
from tests.fakes.imap import FakeImapServer


@pytest.fixture(autouse=True)
def _forbid_external_imap(monkeypatch: pytest.MonkeyPatch) -> None:
    def blocked(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("tests must inject FakeImapServer.connector")

    monkeypatch.setattr(imaplib, "IMAP4", blocked)
    monkeypatch.setattr(imaplib, "IMAP4_SSL", blocked)


def _account(db: Session) -> EmailAccount:
    user = User(
        email="connection-test@test.ae",
        password_hash="x",
        role="operator",
        status="active",
    )
    db.add(user)
    db.flush()
    account = EmailAccount(
        email="connection@gssg.ae",
        imap_host="imap.ionos.com",
        imap_port=993,
        use_ssl=True,
        username="connection@gssg.ae",
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
    db.add(account)
    db.commit()
    db.refresh(account)
    return account


def test_connection_passes_the_account_to_noop_and_logs_out(
    db_session: Session,
) -> None:
    account = _account(db_session)
    server = FakeImapServer()

    email_service.test_connection(account, connector=server.connector)

    assert server.connection_accounts == [account]
    assert len(server.connections) == 1
    assert server.connections[0].logged_out is True
    assert [operation.name for operation in server.operations] == ["noop", "logout"]


def test_connection_preserves_ignored_no_status_and_logs_out(
    db_session: Session,
) -> None:
    account = _account(db_session)
    server = FakeImapServer()
    server.queue_response("noop", ("NO", [b"server rejected NOOP"]))

    email_service.test_connection(account, connector=server.connector)

    assert len(server.connections) == 1
    assert server.connections[0].logged_out is True
    assert [operation.name for operation in server.operations] == ["noop", "logout"]


def test_connection_logs_out_after_noop_raises(db_session: Session) -> None:
    account = _account(db_session)
    server = FakeImapServer()
    server.queue_response("noop", RuntimeError("NOOP transport failed"))

    with pytest.raises(RuntimeError, match="NOOP transport failed"):
        email_service.test_connection(account, connector=server.connector)

    assert len(server.connections) == 1
    assert server.connections[0].logged_out is True
    assert [operation.name for operation in server.operations] == ["noop", "logout"]


def test_connection_propagates_auth_failure_before_session_acquisition(
    db_session: Session,
) -> None:
    account = _account(db_session)
    server = FakeImapServer()
    server.queue_connect_failure(RuntimeError("authentication rejected"))

    with pytest.raises(RuntimeError, match="authentication rejected"):
        email_service.test_connection(account, connector=server.connector)

    assert server.connection_accounts == [account]
    assert server.connections == []
    assert server.operations == []
