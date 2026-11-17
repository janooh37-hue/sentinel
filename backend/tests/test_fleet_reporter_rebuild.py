"""Rebuilding a returned fleet vehicle letter from current fleet data, and marking
a decision seen."""

from __future__ import annotations

import json
from datetime import UTC, datetime

import pytest
from httpx import Response
from sqlalchemy import select

from app.api.errors import AppError
from app.db.models import AuditLog, Book, VehicleFine, VehicleOdometerReading
from app.services import book_service, vehicle_letter_service
from tests.fleet_support import (
    FleetEnv,
    accident_letter,
    current_version_id,
    fines_letter,
    general_book,
    submit,
)


def _assert_error(response: Response, status: int, code: str) -> None:
    assert response.status_code == status, response.text
    assert response.json()["error"]["code"] == code, response.text


def _returned(env: FleetEnv, book: Book, note: str = "wrong amount") -> Book:
    book = submit(env, book, env.reporter)
    response = env.client(env.line).post(
        f"/api/v1/books/{book.id}/return",
        json={"version_id": current_version_id(book), "note": note},
    )
    assert response.status_code == 200, response.text
    book = env.book(book.id)
    assert book.approval_state == "returned"
    return book


def _rebuild(env: FleetEnv, book: Book, user=None) -> Response:  # type: ignore[no-untyped-def]
    return env.client(user or env.reporter).post(
        f"/api/v1/books/{book.id}/rebuild-vehicle-letter",
        json={"version_id": current_version_id(book)},
    )


def test_rebuilt_fines_letter_carries_the_corrected_amount_under_the_same_ref(
    fleet_env: FleetEnv,
) -> None:
    env = fleet_env
    letter = _returned(env, fines_letter(env, env.reporter))
    original = letter.versions[-1]
    assert original.fields["fines"][0]["amount"] == "349 درهم"
    env.fines[0].amount_fils = 50000
    env.db.commit()

    response = _rebuild(env, letter)

    assert response.status_code == 200, response.text
    assert response.json()["approval_state"] == "none"
    book = env.book(letter.id)
    assert book.ref_number == letter.ref_number
    assert book.approval_state == "none"
    assert [version.version_no for version in book.versions] == [1, 2]
    rebuilt = book.versions[-1]
    assert rebuilt.fields["fines"][0]["amount"] == "500 درهم"
    assert rebuilt.fields["hijri_date"] == original.fields["hijri_date"]
    assert rebuilt.document_id != original.document_id
    # The returned decision stays on the old revision as history.
    assert [(step.stage_label, step.state) for step in book.versions[0].approval_steps] == [
        ("line_manager", "returned")
    ]
    assert rebuilt.approval_steps == []
    audit = env.db.scalars(select(AuditLog).where(AuditLog.action == "letter.rebuilt")).one()
    payload = json.loads(audit.payload)
    assert payload["old_version_id"] == original.id
    assert payload["new_version_id"] == rebuilt.id
    # The reporter then resubmits as usual.
    resubmitted = submit(env, book, env.reporter)
    assert resubmitted.approval_state == "pending"
    assert [step.stage_label for step in resubmitted.versions[-1].approval_steps] == [
        "line_manager"
    ]


def test_rebuild_recovers_the_fine_selection_of_a_letter_filed_before_it_was_stored(
    fleet_env: FleetEnv,
) -> None:
    env = fleet_env
    letter = _returned(env, fines_letter(env, env.reporter))
    version = letter.versions[-1]
    version.fields = {k: v for k, v in version.fields.items() if k != "_letter_source"}
    env.db.commit()
    env.fines[1].amount_fils = 12300
    env.db.commit()

    response = _rebuild(env, env.book(letter.id))

    assert response.status_code == 200, response.text
    amounts = [row["amount"] for row in env.book(letter.id).versions[-1].fields["fines"]]
    assert amounts == ["349 درهم", "123 درهم"]


def test_rebuilt_accident_letter_picks_up_the_edited_description(fleet_env: FleetEnv) -> None:
    env = fleet_env
    letter = _returned(env, accident_letter(env, env.reporter))
    env.accident.description_ar = "اصطدام بالبوابة الشرقية"
    env.db.commit()

    response = _rebuild(env, letter)

    assert response.status_code == 200, response.text
    book = env.book(letter.id)
    assert book.ref_number == letter.ref_number
    assert book.versions[-1].fields["description"] == "اصطدام بالبوابة الشرقية"


def test_rebuilt_accident_letter_keeps_its_issue_date(fleet_env: FleetEnv) -> None:
    env = fleet_env
    letter = _returned(env, accident_letter(env, env.reporter))
    # Issued on an earlier day than the rebuild.
    letter.created_at = datetime(2026, 1, 5, 10, 30)
    env.db.commit()

    response = _rebuild(env, letter)

    assert response.status_code == 200, response.text
    assert env.book(letter.id).versions[-1].fields["today"] == "05/01/2026"


def test_accident_letter_route_returns_the_rebuilt_revision(fleet_env: FleetEnv) -> None:
    env = fleet_env
    letter = _returned(env, accident_letter(env, env.reporter))
    assert _rebuild(env, letter).status_code == 200

    book = env.book(letter.id)
    again = vehicle_letter_service.generate_accident_letter(
        env.db, env.vehicle.id, env.accident.id, user=env.reporter
    )
    assert again.document_id == book.versions[-1].document_id
    assert again.document_id != book.versions[0].document_id


def test_rebuilt_mileage_log_reads_the_same_month_again(fleet_env: FleetEnv) -> None:
    env = fleet_env
    env.db.add_all(
        [
            VehicleOdometerReading(
                vehicle_id=env.vehicle.id, month="2026-08", opening_km=100000, closing_km=101000
            ),
            VehicleOdometerReading(vehicle_id=env.vehicle.id, month="2026-09", closing_km=103450),
        ]
    )
    env.db.commit()
    result = vehicle_letter_service.generate_odometer_form(
        env.db, month="2026-09", vehicle_ids=None, user=env.reporter
    )
    letter = _returned(env, env.book(result.book_id))
    original_date = letter.versions[-1].fields["date"]
    reading = env.db.scalars(
        select(VehicleOdometerReading).where(VehicleOdometerReading.month == "2026-09")
    ).one()
    reading.closing_km = 104000
    env.db.commit()

    response = _rebuild(env, letter)

    assert response.status_code == 200, response.text
    book = env.book(letter.id)
    assert book.ref_number == letter.ref_number
    assert book.classification_code == "11/1"
    rebuilt = book.versions[-1].fields
    assert rebuilt["date"] == original_date
    assert rebuilt["rows"][0]["closing_km"] == "104,000"


def test_rebuild_refuses_when_a_source_fine_was_archived(fleet_env: FleetEnv) -> None:
    env = fleet_env
    letter = _returned(env, fines_letter(env, env.reporter))
    archived = env.db.get(VehicleFine, env.fines[1].id)
    assert archived is not None
    archived.archived_at = datetime.now(UTC).replace(tzinfo=None)
    env.db.commit()

    response = _rebuild(env, letter)

    _assert_error(response, 409, "LETTER_SOURCE_CHANGED")
    assert response.json()["error"]["details"]["fine_ids"] == [env.fines[1].id]
    assert [version.version_no for version in env.book(letter.id).versions] == [1]


def test_rebuild_is_refused_to_anyone_but_the_author(fleet_env: FleetEnv) -> None:
    env = fleet_env
    letter = _returned(env, fines_letter(env, env.reporter))

    assert _rebuild(env, letter, env.operator).status_code == 403
    with pytest.raises(AppError) as raised:
        vehicle_letter_service.rebuild_vehicle_letter(
            env.db, letter.id, version_id=current_version_id(letter), user=env.line
        )
    assert raised.value.code == "SCOPED_ROLE_CHAIN_AUTHOR_ONLY"
    assert raised.value.http_status == 403
    assert [version.version_no for version in env.book(letter.id).versions] == [1]


def test_rebuild_is_refused_for_a_pending_paper(fleet_env: FleetEnv) -> None:
    env = fleet_env
    letter = submit(env, fines_letter(env, env.reporter), env.reporter)

    _assert_error(_rebuild(env, letter), 409, "SCOPED_ROLE_STATE_LOCKED")


def test_rebuild_is_refused_for_a_general_book(fleet_env: FleetEnv) -> None:
    env = fleet_env
    book = _returned(env, general_book(env, env.reporter))

    _assert_error(_rebuild(env, book), 422, "NOT_A_VEHICLE_LETTER")


def test_can_rebuild_vehicle_letter_only_for_the_author_of_a_returned_letter(
    fleet_env: FleetEnv,
) -> None:
    env = fleet_env
    letter = fines_letter(env, env.reporter)
    pending = submit(env, letter, env.reporter)
    assert (
        env.client(env.reporter)
        .get(f"/api/v1/books/{pending.id}")
        .json()["can_rebuild_vehicle_letter"]
        is False
    )
    env.client(env.line).post(
        f"/api/v1/books/{pending.id}/return",
        json={"version_id": current_version_id(pending), "note": "wrong amount"},
    )

    for user, expected in (
        (env.reporter, True),
        (env.line, False),
        (env.admin, False),
    ):
        response = env.client(user).get(f"/api/v1/books/{letter.id}")
        assert response.status_code == 200, response.text
        assert response.json()["can_rebuild_vehicle_letter"] is expected, user.email


# Marking a decision seen -----------------------------------------------------------


def test_fleet_reporter_marks_his_decided_paper_seen(fleet_env: FleetEnv) -> None:
    env = fleet_env
    letter = _returned(env, fines_letter(env, env.reporter))
    assert [book.id for book, _v, _s in book_service.unseen_decisions(env.db, env.reporter)] == [
        letter.id
    ]

    response = env.client(env.reporter).post(f"/api/v1/books/{letter.id}/seen")

    assert response.status_code == 204, response.text
    assert book_service.unseen_decisions(env.db, env.reporter) == []


def test_fleet_reporter_cannot_mark_another_reporters_draft_seen(fleet_env: FleetEnv) -> None:
    env = fleet_env
    draft = fines_letter(env, env.other_reporter)

    response = env.client(env.reporter).post(f"/api/v1/books/{draft.id}/seen")

    _assert_error(response, 404, "BOOK_NOT_FOUND")
