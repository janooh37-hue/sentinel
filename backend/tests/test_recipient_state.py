"""Recipient state transitions, inbox visibility, and migration 0103."""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import pytest
from alembic import command
from sqlalchemy import inspect, text
from sqlalchemy.exc import IntegrityError

from app.db.models import BookRecipient
from app.services import notification_service
from tests.test_book_confidentiality import (
    API,
    ApiHarness,
    _listing,
    _send,
)
from tests.test_book_confidentiality import (
    confidentiality_api as confidentiality_api,
)
from tests.test_migration_record_confidentiality import HEAD, _at_parent_with_a_book


def test_send_purpose_rejects_sign_and_accepts_circulate(confidentiality_api: ApiHarness) -> None:
    api = confidentiality_api
    path = f"{API}/books/{api.records['directed'].id}/send"
    targets = [api.users["B"].id]
    rejected = api.client.post(path, json={"user_ids": targets, "purpose": "sign"})
    assert rejected.status_code == 422, rejected.text
    accepted = api.client.post(path, json={"user_ids": targets, "purpose": "circulate"})
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["sent"][0]["purpose"] == "circulate"


def test_detail_peek_does_not_mark_recipient_read(confidentiality_api: ApiHarness) -> None:
    api = confidentiality_api
    sent = _send(api, "directed", ["B"])["sent"][0]
    api.as_user("B")
    path = f"{API}/books/{api.records['directed'].id}"
    response = api.client.get(path, params={"mark_read": False})
    assert response.status_code == 200, response.text
    assert response.json()["my_inbox"]["read_at"] is None
    recipient = api.db.get(BookRecipient, sent["id"])
    assert recipient is not None
    api.db.refresh(recipient)
    assert recipient.read_at is None
    assert api.client.get(f"{API}/books/inbox/summary").json()["unread"] == 1
    opened = api.client.get(path)
    assert opened.status_code == 200, opened.text
    assert opened.json()["my_inbox"]["read_at"] is not None
    api.db.refresh(recipient)
    assert recipient.read_at is not None
    assert api.client.get(f"{API}/books/inbox/summary").json()["unread"] == 0


def test_done_marks_read_and_undo_preserves_first_read(confidentiality_api: ApiHarness) -> None:
    api = confidentiality_api
    _send(api, "directed", ["B", "C"], purpose="action")
    api.as_user("B")
    path = f"{API}/books/{api.records['directed'].id}/inbox/done"
    done = api.client.post(path)
    assert done.status_code == 200, done.text
    state = done.json()
    assert state["done_at"] is not None
    assert state["read_at"] == state["done_at"]
    summary = api.client.get(f"{API}/books/inbox/summary").json()
    assert summary["unread"] == 0
    assert summary["received"] == summary["by_purpose"]["action"] == 1
    assert api.client.get(f"{API}/notifications/counts").json()["inbox"] == 0
    assert not any(
        item.kind == "inbox"
        for item in notification_service.actionable_items(api.db, api.users["B"])
    )
    undo = api.client.delete(path)
    assert undo.status_code == 200, undo.text
    assert undo.json()["done_at"] is None
    assert undo.json()["read_at"] == state["read_at"]
    redone = api.client.post(path)
    assert redone.status_code == 200, redone.text
    assert redone.json()["read_at"] == state["read_at"]
    api.as_user("A")
    recipients = api.client.get(f"{API}/books/{api.records['directed'].id}/recipients").json()
    own = next(row for row in recipients if row["user_id"] == api.users["B"].id)
    other = next(row for row in recipients if row["user_id"] == api.users["C"].id)
    assert own["done_at"] == redone.json()["done_at"]
    assert other["done_at"] is None
    assert other["read_at"] is None


@pytest.mark.parametrize("action", ["done", "archive"])
@pytest.mark.parametrize("method", ["post", "delete"])
def test_recipient_state_requires_visible_record_and_own_active_send(
    confidentiality_api: ApiHarness, action: str, method: str
) -> None:
    api = confidentiality_api
    sent = _send(api, "general", ["B"])["sent"][0]
    path = f"{API}/books/{api.records['general'].id}/inbox/{action}"
    # The creator can open the record, but cannot change a recipient's state.
    denied = getattr(api.client, method)(path)
    assert denied.status_code == 404, denied.text
    api.as_user("B")
    # An active send never overrides Personal visibility.
    api.records["general"].confidentiality = "personal"
    api.db.commit()
    hidden = getattr(api.client, method)(path)
    assert hidden.status_code == 404, hidden.text
    api.records["general"].confidentiality = "general"
    api.db.commit()
    api.as_user("A")
    recall = api.client.delete(f"{API}/books/{api.records['general'].id}/recipients/{sent['id']}")
    assert recall.status_code == 204, recall.text
    api.as_user("B")
    revoked = getattr(api.client, method)(path)
    assert revoked.status_code == 404, revoked.text


def test_archive_hides_inbox_counts_not_access_and_unarchive_restores(
    confidentiality_api: ApiHarness,
) -> None:
    api = confidentiality_api
    _send(api, "directed", ["B", "C"], purpose="circulate")
    api.as_user("B")
    path = f"{API}/books/{api.records['directed'].id}/inbox/archive"
    archived = api.client.post(path)
    assert archived.status_code == 200, archived.text
    assert archived.json()["archived_at"] is not None
    assert archived.json()["read_at"] is None
    _listing(api, set(), "received")
    _listing(api, {"directed"}, "archived")
    summary = api.client.get(f"{API}/books/inbox/summary")
    assert summary.status_code == 200, summary.text
    assert summary.json() == {
        "unread": 0,
        "received": 0,
        "sent": 0,
        "archived": 1,
        "by_purpose": {"info": 0, "action": 0, "reply": 0, "circulate": 0},
    }
    assert api.client.get(f"{API}/notifications/counts").json()["inbox"] == 0
    assert not any(
        item.kind == "inbox"
        for item in notification_service.actionable_items(api.db, api.users["B"])
    )
    api.as_user("C")
    _listing(api, {"directed"}, "received")
    assert api.client.get(f"{API}/books/inbox/summary").json()["unread"] == 1
    api.as_user("B")
    restored = api.client.delete(path)
    assert restored.status_code == 200, restored.text
    assert restored.json()["archived_at"] is None
    _listing(api, {"directed"}, "received")
    _listing(api, set(), "archived")
    restored_summary = api.client.get(f"{API}/books/inbox/summary").json()
    assert restored_summary["unread"] == restored_summary["received"] == 1
    assert restored_summary["archived"] == 0
    assert restored_summary["by_purpose"]["circulate"] == 1
    assert api.client.get(f"{API}/notifications/counts").json()["inbox"] == 1
    assert (
        sum(
            item.kind == "inbox"
            for item in notification_service.actionable_items(api.db, api.users["B"])
        )
        == 1
    )
    # Archive again before opening, proving the grant survives archive.
    assert api.client.post(path).status_code == 200
    detail = api.client.get(f"{API}/books/{api.records['directed'].id}")
    assert detail.status_code == 200, detail.text
    assert detail.json()["my_inbox"]["archived_at"] is not None


def test_recipient_state_applies_to_all_active_sends(confidentiality_api: ApiHarness) -> None:
    api = confidentiality_api
    _send(api, "directed", ["B"])
    # Legacy/multiple-send rows must all transition even though today's index
    # prevents creating a second active row through the send API.
    api.db.execute(text("DROP INDEX uq_book_recipients_active"))
    api.db.execute(
        text(
            "INSERT INTO book_recipients "
            "(book_id, user_id, sent_by_user_id, purpose, created_at) "
            "SELECT book_id, user_id, sent_by_user_id, 'reply', created_at FROM book_recipients"
        )
    )
    api.db.execute(
        text(
            "INSERT INTO book_recipients "
            "(book_id, user_id, sent_by_user_id, purpose, created_at, revoked_at) "
            "SELECT book_id, user_id, sent_by_user_id, purpose, created_at, '2026-10-02' "
            "FROM book_recipients WHERE id = (SELECT MIN(id) FROM book_recipients)"
        )
    )
    api.db.execute(
        text(
            "UPDATE book_recipients SET archived_at = '2026-10-01' "
            "WHERE id = (SELECT MIN(id) FROM book_recipients)"
        )
    )
    api.db.commit()
    api.as_user("B")
    base = f"{API}/books/{api.records['directed'].id}/inbox"
    _listing(api, {"directed"}, "received")
    _listing(api, set(), "archived")
    assert api.client.get(f"{API}/books/inbox/summary").json()["archived"] == 0
    assert api.client.post(f"{base}/done").status_code == 200
    assert api.client.post(f"{base}/archive").status_code == 200
    _listing(api, set(), "received")
    _listing(api, {"directed"}, "archived")
    assert api.client.get(f"{API}/books/inbox/summary").json()["archived"] == 1
    api.as_user("A")
    rows = api.client.get(f"{API}/books/{api.records['directed'].id}/recipients").json()
    assert len(rows) == 3
    active = [row for row in rows if row["revoked_at"] is None]
    revoked = next(row for row in rows if row["revoked_at"] is not None)
    assert len(active) == 2
    assert all(row["done_at"] and row["read_at"] and row["archived_at"] for row in active)
    assert revoked["done_at"] is revoked["read_at"] is revoked["archived_at"] is None
    api.as_user("B")
    assert api.client.delete(f"{base}/done").status_code == 200
    assert api.client.delete(f"{base}/archive").status_code == 200
    api.as_user("A")
    rows = api.client.get(f"{API}/books/{api.records['directed'].id}/recipients").json()
    assert all(row["done_at"] is None and row["archived_at"] is None for row in rows)
    assert all(row["read_at"] for row in rows if row["revoked_at"] is None)
    assert next(row for row in rows if row["revoked_at"] is not None)["read_at"] is None


def test_open_marks_all_active_sends_read_even_when_newest_is_already_read(
    confidentiality_api: ApiHarness,
) -> None:
    api = confidentiality_api
    sent = _send(api, "directed", ["B", "C"])["sent"]
    api.db.execute(text("DROP INDEX uq_book_recipients_active"))
    api.db.execute(
        text(
            "INSERT INTO book_recipients "
            "(book_id, user_id, sent_by_user_id, purpose, created_at, read_at) "
            "SELECT book_id, user_id, sent_by_user_id, purpose, created_at, "
            "'2026-10-02 00:00:00' FROM book_recipients WHERE user_id = :user_id"
        ),
        {"user_id": api.users["B"].id},
    )
    api.db.commit()
    api.as_user("B")
    response = api.client.get(f"{API}/books/{api.records['directed'].id}")
    assert response.status_code == 200, response.text
    assert datetime.fromisoformat(response.json()["my_inbox"]["read_at"]) == datetime(
        2026, 10, 2, tzinfo=UTC
    )
    assert api.client.get(f"{API}/books/inbox/summary").json()["unread"] == 0
    for row in sent:
        stored = api.db.get(BookRecipient, row["id"])
        api.db.refresh(stored)
        assert (stored.read_at is not None) == (row["user_id"] == api.users["B"].id)


@pytest.mark.parametrize("hidden", ["personal", "secret", "deleted"])
@pytest.mark.parametrize("archived", [False, True])
def test_hidden_received_records_do_not_leak_inbox_counts_or_allow_state_changes(
    confidentiality_api: ApiHarness,
    hidden: str,
    archived: bool,
) -> None:
    api = confidentiality_api
    sent = _send(api, "general", ["B"])["sent"][0]
    recipient = api.db.get(BookRecipient, sent["id"])
    if archived:
        recipient.archived_at = datetime(2026, 10, 1)
    if hidden == "deleted":
        api.records["general"].deleted_at = datetime(2026, 10, 2)
    else:
        api.records["general"].confidentiality = hidden
    api.db.commit()
    api.as_user("B")
    _listing(api, set(), "received")
    _listing(api, set(), "archived")
    summary = api.client.get(f"{API}/books/inbox/summary").json()
    assert summary["received"] == summary["unread"] == summary["archived"] == 0
    assert not any(summary["by_purpose"].values())
    assert api.client.get(f"{API}/notifications/counts").json()["inbox"] == 0
    assert not any(
        item.kind == "inbox"
        for item in notification_service.actionable_items(api.db, api.users["B"])
    )
    for action in ("done", "archive"):
        path = f"{API}/books/{api.records['general'].id}/inbox/{action}"
        for method in ("post", "delete"):
            response = getattr(api.client, method)(path)
            assert response.status_code == 404, response.text
    api.db.refresh(recipient)
    assert recipient.done_at is None
    assert recipient.read_at is None
    assert (recipient.archived_at is not None) == archived


def test_recipient_state_migration_translates_purpose_and_round_trips(tmp_path: Path) -> None:
    engine, config = _at_parent_with_a_book(tmp_path)
    command.upgrade(config, HEAD)
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO book_recipients "
                "(id, book_id, user_id, sent_by_user_id, purpose, created_at, read_at) "
                "VALUES (1, 1, 7, 3, 'sign', '2026-10-01 00:00:00', '2026-10-02 00:00:00')"
            )
        )
    command.upgrade(config, "0103_recipient_state")
    with engine.connect() as connection:
        row = connection.execute(
            text("SELECT purpose, read_at, done_at, archived_at FROM book_recipients")
        ).one()
        assert tuple(row) == ("circulate", "2026-10-02 00:00:00", None, None)
    with pytest.raises(IntegrityError), engine.begin() as connection:
        connection.execute(text("UPDATE book_recipients SET purpose = 'sign'"))
    with engine.begin() as connection:
        connection.execute(
            text("UPDATE book_recipients SET done_at = '2026-10-03', archived_at = '2026-10-04'")
        )
    command.downgrade(config, HEAD)
    with engine.connect() as connection:
        assert (
            connection.execute(text("SELECT purpose FROM book_recipients")).scalar_one() == "sign"
        )
        columns = {column["name"] for column in inspect(connection).get_columns("book_recipients")}
        assert not {"done_at", "archived_at"} & columns
        assert "uq_book_recipients_active" in {
            index["name"] for index in inspect(connection).get_indexes("book_recipients")
        }
    with pytest.raises(IntegrityError), engine.begin() as connection:
        connection.execute(text("UPDATE book_recipients SET purpose = 'circulate'"))
    command.upgrade(config, "0103_recipient_state")
    with engine.connect() as connection:
        assert (
            connection.execute(text("SELECT purpose FROM book_recipients")).scalar_one()
            == "circulate"
        )
    engine.dispose()


def test_recipient_state_migration_preserves_partial_unique_index(tmp_path: Path) -> None:
    engine, config = _at_parent_with_a_book(tmp_path)
    command.upgrade(config, HEAD)
    insert = text(
        "INSERT INTO book_recipients "
        "(book_id, user_id, sent_by_user_id, purpose, revoked_at, created_at) "
        "VALUES (1, 7, 3, 'info', :revoked, '2026-10-01 00:00:00')"
    )
    with engine.begin() as connection:
        connection.execute(insert, {"revoked": None})
    for migrate, target in (
        (command.upgrade, "0103_recipient_state"),
        (command.downgrade, HEAD),
        (command.upgrade, "0103_recipient_state"),
    ):
        migrate(config, target)
        with engine.connect() as connection:
            index = next(
                index
                for index in inspect(connection).get_indexes("book_recipients")
                if index["name"] == "uq_book_recipients_active"
            )
            assert index["unique"]
            assert index["column_names"] == ["book_id", "user_id"]
        with pytest.raises(IntegrityError), engine.begin() as connection:
            connection.execute(insert, {"revoked": None})
        # The surviving index must stay partial: recalled history is allowed.
        with engine.begin() as connection:
            connection.execute(insert, {"revoked": "2026-10-02 00:00:00"})
            assert (
                connection.execute(
                    text("SELECT COUNT(*) FROM book_recipients WHERE revoked_at IS NULL")
                ).scalar_one()
                == 1
            )
    engine.dispose()
