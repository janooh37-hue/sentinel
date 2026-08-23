from __future__ import annotations

from datetime import date
from types import SimpleNamespace

import pytest

from app.db.models import Employee, LedgerEntry, User
from app.services import correspondence_link_service as links


@pytest.fixture()
def employees(db_session):
    user = User(email="link-actor@test.ae", password_hash="x", role="operator", status="active")
    db_session.add(user)
    db_session.add_all(
        [
            Employee(id="G3082", name_en="First", name_ar="أول"),
            Employee(id="G123", name_en="Second", name_ar="ثان"),
        ]
    )
    db_session.flush()
    return SimpleNamespace(user=user)


@pytest.fixture()
def ledger_email(db_session):
    entry = LedgerEntry(
        entry_date=date(2026, 8, 23),
        direction="inbound",
        channel="email",
        counterparty="sender@example.test",
        subject="G3082 subject",
        notes_html="<p>body</p>",
        attachment_paths=[],
        tags=[],
        inline_images={},
        to_recipients=[],
        cc_recipients=[],
        bcc_recipients=[],
    )
    db_session.add(entry)
    db_session.flush()
    return entry


def test_detector_normalizes_and_deduplicates() -> None:
    from app.core.gnumber import detect_g_numbers

    assert detect_g_numbers("g3082 / G3082 / G123") == ("G3082", "G123")


def test_dismissal_survives_detection(db_session, ledger_email, employees) -> None:
    links.sync_detected_links(db_session, entry_id=ledger_email.id, employee_ids={"G3082"})
    links.dismiss_link(
        db_session,
        entry_id=ledger_email.id,
        employee_id="G3082",
        actor_user_id=employees.user.id,
    )
    links.sync_detected_links(db_session, entry_id=ledger_email.id, employee_ids={"G3082"})
    row = links.get_link(db_session, entry_id=ledger_email.id, employee_id="G3082")
    assert row.state == "dismissed"
    assert row.acted_by_user_id == employees.user.id


def test_sync_ignores_unknown_ids_and_preserves_manual_links(
    db_session, ledger_email, employees
) -> None:
    manual = links.set_manual_link(
        db_session,
        entry_id=ledger_email.id,
        employee_id="G3082",
        actor_user_id=employees.user.id,
    )
    rows = links.sync_detected_links(
        db_session,
        entry_id=ledger_email.id,
        employee_ids={"G3082", "G9999"},
    )
    assert [row.employee_id for row in rows] == ["G3082"]
    assert rows[0].id == manual.id
    assert rows[0].state == "linked"
    assert rows[0].source == "manual"


def test_link_state_operations_flush_without_commit(db_session, ledger_email, employees) -> None:
    row = links.set_manual_link(
        db_session,
        entry_id=ledger_email.id,
        employee_id="G123",
        actor_user_id=employees.user.id,
    )
    assert row.id is not None
    assert db_session.in_transaction()
    assert db_session.get(LedgerEntry, ledger_email.id) is not None


@pytest.mark.parametrize("employee_id", ["G9999", "g9999"])
def test_manual_link_rejects_unknown_employee(db_session, ledger_email, employees, employee_id) -> None:
    with pytest.raises(ValueError, match="employee"):
        links.set_manual_link(
            db_session,
            entry_id=ledger_email.id,
            employee_id=employee_id,
            actor_user_id=employees.user.id,
        )
