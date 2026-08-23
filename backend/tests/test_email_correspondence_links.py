from __future__ import annotations

from datetime import date

from sqlalchemy import select

from app.db.models import CorrespondenceEmployeeLink, Employee, LedgerEntry, User
from app.services import correspondence_link_service, email_service


def _actor(db) -> User:
    actor = User(
        email="link-actor@example.ae",
        password_hash="x",
        role="operator",
        status="active",
    )
    db.add(actor)
    db.flush()
    return actor


def _employee(db, employee_id: str) -> Employee:
    employee = Employee(id=employee_id, name_en=employee_id, name_ar=None)
    db.add(employee)
    db.flush()
    return employee


def _entry(db) -> LedgerEntry:
    entry = LedgerEntry(
        entry_date=date(2026, 8, 23),
        direction="incoming",
        channel="email",
        counterparty="sender@example.ae",
        subject="Subject",
        notes_html=None,
    )
    db.add(entry)
    db.flush()
    return entry


def active_employee_ids(db, entry_id: int) -> set[str]:
    return set(
        db.scalars(
            select(CorrespondenceEmployeeLink.employee_id).where(
                CorrespondenceEmployeeLink.ledger_entry_id == entry_id,
                CorrespondenceEmployeeLink.state == "linked",
            )
        ).all()
    )


def test_email_text_links_every_real_employee(db_session) -> None:
    _employee(db_session, "G3082")
    _employee(db_session, "G1234")
    entry = _entry(db_session)

    email_service.index_entry_text(db_session, entry, "G3082 and G1234 and G9999")

    assert active_employee_ids(db_session, entry.id) == {"G3082", "G1234"}


def test_resync_does_not_restore_dismissed_link(db_session) -> None:
    _employee(db_session, "G3082")
    actor = _actor(db_session)
    entry = _entry(db_session)
    correspondence_link_service.dismiss_link(
        db_session, entry_id=entry.id, employee_id="G3082", actor_user_id=actor.id
    )

    email_service.index_entry_text(db_session, entry, "G3082")

    assert active_employee_ids(db_session, entry.id) == set()
    row = correspondence_link_service.get_link(
        db_session, entry_id=entry.id, employee_id="G3082"
    )
    assert row is not None and row.state == "dismissed"

def test_duplicate_message_resync_indexes_existing_entry(db_session, monkeypatch) -> None:
    _employee(db_session, "G3082")
    entry = _entry(db_session)
    entry.notes_html = "G3082"
    entry.tags = ["email", "msgid:duplicate@example.ae"]
    db_session.commit()
    account = email_service.EmailAccount(
        email="operator@example.ae",
        imap_host="imap.example.ae",
        username="operator@example.ae",
        password_encrypted="encrypted",
        inbox_folder="INBOX",
        sent_folder="Sent",
        enabled=True,
    )
    db_session.add(account)
    db_session.commit()

    class _Connection:
        def logout(self):
            return None

    message = email_service.stdlib_email.message_from_string(
        "Message-ID: <duplicate@example.ae>\n"
        "Subject: Existing\n"
        "From: sender@example.ae\n"
        "To: operator@example.ae\n"
        "Date: Sat, 23 Aug 2026 00:00:00 +0000\n"
        "Content-Type: text/plain\n\nG3082"
    )
    monkeypatch.setattr(email_service, "_connect", lambda _account: _Connection())
    monkeypatch.setattr(email_service, "_discover_folders", lambda _conn, root: [root])
    monkeypatch.setattr(
        email_service,
        "_fetch_folder",
        lambda _conn, _folder, _since: ([(b"1", message)], 0),
    )

    email_service._sync_account_locked(db_session, account)

    assert active_employee_ids(db_session, entry.id) == {"G3082"}
    assert db_session.query(LedgerEntry).filter(LedgerEntry.channel == "email").count() == 1
