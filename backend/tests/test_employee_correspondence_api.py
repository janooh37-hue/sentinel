from __future__ import annotations

from datetime import date, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.models import CorrespondenceEmployeeLink, Employee, LedgerEntry, User
from app.db.session import get_db
from app.main import create_app


@pytest.fixture()
def correspondence_client(api_db: Session) -> TestClient:
    current_user = User(
        email="correspondence-owner@test.ae", password_hash="x", role="manager", status="active"
    )
    api_db.add_all(
        [
            current_user,
            User(email="other-owner@test.ae", password_hash="x", role="manager", status="active"),
            Employee(id="G100", name_en="ALPHA", name_ar="ألف", status="Active"),
            Employee(id="G200", name_en="BETA", name_ar="باء", status="Active"),
        ]
    )
    api_db.commit()
    api_db.refresh(current_user)

    def entry(
        entry_id: int, *, channel: str, owner_user_id: int | None, minutes: int, subject: str
    ) -> LedgerEntry:
        return LedgerEntry(
            id=entry_id,
            entry_date=date(2026, 8, 23),
            direction="incoming",
            channel=channel,
            counterparty="Authority",
            subject=subject,
            notes_html="<p>private body</p>",
            attachment_paths=["private/secret.pdf"],
            tags=[],
            inline_images={},
            related_employee_id=None,
            created_at=datetime(2026, 8, 23, 9, minutes),
            owner_user_id=owner_user_id,
            to_recipients=[{"name": "Sender", "address": "sender@example.test"}],
            cc_recipients=[],
            bcc_recipients=[],
        )

    shared_email = entry(
        1, channel="email", owner_user_id=current_user.id, minutes=3, subject="Shared email"
    )
    legacy_letter = entry(
        2, channel="letter", owner_user_id=None, minutes=2, subject="Legacy letter"
    )
    dismissed = entry(
        3, channel="email", owner_user_id=current_user.id, minutes=1, subject="Dismissed"
    )
    other_mailbox = entry(
        4, channel="email", owner_user_id=current_user.id + 1, minutes=4, subject="Other mailbox"
    )
    api_db.add_all([shared_email, legacy_letter, dismissed, other_mailbox])
    api_db.flush()
    api_db.add_all(
        [
            CorrespondenceEmployeeLink(
                ledger_entry_id=shared_email.id,
                employee_id="G100",
                state="linked",
                source="detected",
                created_at=datetime(2026, 8, 23, 9, 3),
                updated_at=datetime(2026, 8, 23, 9, 3),
            ),
            CorrespondenceEmployeeLink(
                ledger_entry_id=shared_email.id,
                employee_id="G200",
                state="linked",
                source="detected",
                created_at=datetime(2026, 8, 23, 9, 3),
                updated_at=datetime(2026, 8, 23, 9, 3),
            ),
            CorrespondenceEmployeeLink(
                ledger_entry_id=legacy_letter.id,
                employee_id="G100",
                state="linked",
                source="legacy",
                created_at=datetime(2026, 8, 23, 9, 2),
                updated_at=datetime(2026, 8, 23, 9, 2),
            ),
            CorrespondenceEmployeeLink(
                ledger_entry_id=dismissed.id,
                employee_id="G100",
                state="dismissed",
                source="manual",
                created_at=datetime(2026, 8, 23, 9, 1),
                updated_at=datetime(2026, 8, 23, 9, 1),
            ),
            CorrespondenceEmployeeLink(
                ledger_entry_id=other_mailbox.id,
                employee_id="G100",
                state="linked",
                source="detected",
                created_at=datetime(2026, 8, 23, 9, 4),
                updated_at=datetime(2026, 8, 23, 9, 4),
            ),
        ]
    )
    api_db.commit()

    app = create_app()
    app.dependency_overrides[get_db] = lambda: api_db
    app.dependency_overrides[get_current_user] = lambda: current_user
    return TestClient(app, raise_server_exceptions=True)


def test_employee_correspondence_is_linked_owned_paginated_and_sanitized(
    correspondence_client: TestClient,
):
    first = correspondence_client.get(
        "/api/v1/employees/G100/correspondence", params={"limit": 1, "offset": 0}
    )
    assert first.status_code == 200, first.text
    body = first.json()
    assert body["total"] == 2
    assert [item["entry_id"] for item in body["items"]] == [1]
    assert body["items"][0]["link_source"] == "detected"
    assert body["items"][0]["can_open_in_outlook"] is True
    assert "notes_html" not in body["items"][0]
    assert "attachment_paths" not in body["items"][0]
    assert body["items"][0]["attachment_count"] == 1

    second = correspondence_client.get(
        "/api/v1/employees/G100/correspondence", params={"limit": 1, "offset": 1}
    )
    assert second.status_code == 200
    assert [item["entry_id"] for item in second.json()["items"]] == [2]
    assert second.json()["items"][0]["link_source"] == "legacy"
    assert second.json()["items"][0]["can_open_in_outlook"] is False
    assert "notes_html" not in second.json()["items"][0]
    assert "attachment_paths" not in second.json()["items"][0]
    assert second.json()["items"][0]["attachment_count"] == 1

    other_profile = correspondence_client.get("/api/v1/employees/G200/correspondence")
    assert other_profile.status_code == 200
    assert [item["entry_id"] for item in other_profile.json()["items"]] == [1]
    assert other_profile.json()["items"][0]["can_open_in_outlook"] is True

    assert (
        correspondence_client.get(
            "/api/v1/employees/G100/correspondence", params={"limit": 0}
        ).status_code
        == 422
    )
