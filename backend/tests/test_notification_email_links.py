from datetime import date

from app.db.models import LedgerEntry
from app.services.notification_service import actionable_items
from tests.conftest import make_user


def test_email_notification_links_to_specific_ledger_message(api_db):
    user = make_user(api_db, email="mail-link@test.ae")
    entry = LedgerEntry(
        entry_date=date(2026, 9, 5),
        direction="incoming",
        channel="email",
        counterparty="sender@test.ae",
        subject="Test message",
        owner_user_id=user.id,
        tags=["email"],
        attachment_paths=[],
        to_recipients=[],
        cc_recipients=[],
        bcc_recipients=[],
    )
    api_db.add(entry)
    api_db.flush()

    item = next(item for item in actionable_items(api_db, user) if item.kind == "email")

    assert item.url == f"/ledger?mail={entry.id}"
