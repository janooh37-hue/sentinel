"""Fleet papers use an admin-assigned line manager and an optional branch stage."""

from __future__ import annotations

import pytest
from httpx import Response

from app.db.models import Book, BookVersion
from app.services import book_service
from tests.fleet_support import (
    FleetEnv,
    current_version_id,
    fines_letter,
    general_book,
    set_signer_rows,
)


def _assert_error(response: Response, status: int, code: str) -> None:
    assert response.status_code == status, response.text
    assert response.json()["error"]["code"] == code, response.text


def _assert_pending_line(env: FleetEnv, book_id: int) -> Book:
    book = env.book(book_id)
    assert book.approval_state == "pending"
    version = book.versions[-1]
    assert version.status == ("approved" if version.template_id == "Report" else "pending")
    assert [
        (step.step_order, step.stage_label, step.assignee_user_id, step.state, step.kind)
        for step in version.approval_steps
    ] == [(0, "line_manager", env.line.id, "pending", "approver")]
    assert version.approval_steps[0].note is None
    assert version.approval_steps[0].decided_at is None
    return book


def _submit(env: FleetEnv, book: Book) -> Book:
    response = env.client(env.reporter).post(f"/api/v1/books/{book.id}/submit", json={})
    assert response.status_code == 200, response.text
    assert response.json()["approval_state"] == "pending"
    return _assert_pending_line(env, book.id)


def _forward(env: FleetEnv, book: Book) -> Response:
    return env.client(env.line).post(
        f"/api/v1/books/{book.id}/forward-to-branch",
        json={
            "version_id": current_version_id(book),
            "branch_approver_user_id": env.branch.id,
            "note": "Please review at branch level.",
        },
    )


@pytest.mark.parametrize(
    "line_manager",
    ["missing", "disabled", "without_approval", "without_signer_row", "two_signer_rows"],
)
def test_submit_requires_an_eligible_line_manager(fleet_env: FleetEnv, line_manager: str) -> None:
    env = fleet_env
    book = general_book(env, env.reporter)
    if line_manager == "missing":
        env.reporter.line_manager_user_id = None
    elif line_manager == "disabled":
        env.line.status = "disabled"
    elif line_manager == "without_signer_row":
        set_signer_rows(env, env.line, 0)
    elif line_manager == "two_signer_rows":
        set_signer_rows(env, env.line, 2)
    else:
        env.reporter.line_manager_user_id = env.operator.id
    env.db.commit()

    response = env.client(env.reporter).post(f"/api/v1/books/{book.id}/submit", json={})

    _assert_error(response, 409, "LINE_MANAGER_REQUIRED")
    assert response.json()["error"]["message"] == "Ask an administrator to set your line manager."
    book = env.book(book.id)
    assert book.approval_state == "none"
    assert book.versions[-1].approval_steps == []
    assert book.submitted_by_user_id is None


@pytest.mark.parametrize(
    "choice", ["approver_user_id", "reviewer_user_ids", "priority", "branch_approver_user_id"]
)
def test_submit_rejects_reporter_selected_routing(fleet_env: FleetEnv, choice: str) -> None:
    env = fleet_env
    book = general_book(env, env.reporter)
    value = (
        "High"
        if choice == "priority"
        else [env.branch.id]
        if choice == "reviewer_user_ids"
        else env.branch.id
    )

    response = env.client(env.reporter).post(
        f"/api/v1/books/{book.id}/submit", json={choice: value}
    )

    _assert_error(response, 403, "SCOPED_ROLE_INPUT_FORBIDDEN")
    book = env.book(book.id)
    assert book.approval_state == "none"
    assert book.priority == "Normal"
    assert book.versions[-1].approval_steps == []
    assert book.submitted_by_user_id is None


def test_submit_creates_one_line_manager_assignment_and_worklist_entry(fleet_env: FleetEnv) -> None:
    env = fleet_env
    book = _submit(env, general_book(env, env.reporter))

    assert book.submitted_by_user_id == env.reporter.id
    assert book.id in {item.id for item in book_service.list_awaiting(env.db, user_id=env.line.id)}
    assert book.id not in {
        item.id for item in book_service.list_awaiting(env.db, user_id=env.branch.id)
    }


def test_line_manager_finishes_general_book_with_own_signature(fleet_env: FleetEnv) -> None:
    env = fleet_env
    book = _submit(env, general_book(env, env.reporter))

    response = env.client(env.line).post(
        f"/api/v1/books/{book.id}/sign", json={"version_id": current_version_id(book)}
    )

    assert response.status_code == 200, response.text
    assert response.json()["approval_state"] == "approved"
    book = env.book(book.id)
    version = book.versions[-1]
    assert book.approval_state == version.status == "approved"
    assert version.signed_by_user_id == env.line.id
    assert version.signed_pdf_path
    assert len(version.approval_steps) == 1
    assert version.approval_steps[0].state == "approved"
    assert book.id not in {
        item.id for item in book_service.list_awaiting(env.db, user_id=env.line.id)
    }
    decisions = book_service.unseen_decisions(env.db, env.reporter)
    assert any(
        item.id == book.id and step.assignee_user_id == env.line.id and step.state == "approved"
        for item, _, step in decisions
    )


def test_line_manager_approves_vehicle_fines_without_signing_paper(fleet_env: FleetEnv) -> None:
    env = fleet_env
    book = _submit(env, fines_letter(env, env.reporter))

    response = env.client(env.line).post(
        f"/api/v1/books/{book.id}/sign", json={"version_id": current_version_id(book)}
    )

    assert response.status_code == 200, response.text
    assert response.json()["approval_state"] == "approved"
    book = env.book(book.id)
    version = book.versions[-1]
    assert book.approval_state == version.status == "approved"
    assert version.signed_by_user_id is None
    assert version.signed_pdf_path is None
    assert version.approval_steps[0].state == "approved"


def test_report_review_preserves_the_reporters_signed_paper(fleet_env: FleetEnv) -> None:
    env = fleet_env
    book = Book(
        category_id="GS",
        ref_number=f"REPORT-{env.reporter.id}",
        subject="Fleet report",
        approval_state="none",
        created_by_user_id=env.reporter.id,
        submitted_by_user_id=env.reporter.id,
    )
    env.db.add(book)
    env.db.flush()
    signed_path = "signed/fleet-report.pdf"
    fields = {"signer_employee_id": "G7001", "signed": True}
    env.db.add(
        BookVersion(
            book_id=book.id,
            version_no=1,
            trigger="initial",
            status="approved",
            template_id="Report",
            fields=fields,
            created_by_user_id=env.reporter.id,
            signed_pdf_path=signed_path,
            signed_by_user_id=env.reporter.id,
            manager_sig_embedded=True,
        )
    )
    env.db.commit()
    book = _submit(env, env.book(book.id))

    response = env.client(env.line).post(
        f"/api/v1/books/{book.id}/sign", json={"version_id": current_version_id(book)}
    )

    assert response.status_code == 200, response.text
    book = env.book(book.id)
    version = book.versions[-1]
    assert book.approval_state == version.status == "approved"
    assert version.signed_by_user_id == env.reporter.id
    assert version.signed_pdf_path == signed_path
    assert version.fields == fields
    assert len(book.versions) == 1
    assert version.approval_steps[0].state == "approved"


def test_forward_records_unsigned_line_decision_and_branch_signs_final_paper(
    fleet_env: FleetEnv,
) -> None:
    env = fleet_env
    book = _submit(env, general_book(env, env.reporter))

    response = _forward(env, book)

    assert response.status_code == 200, response.text
    assert response.json()["approval_state"] == "pending"
    assert response.json()["can_forward_to_branch"] is False
    book = env.book(book.id)
    version = book.versions[-1]
    assert [
        (step.step_order, step.stage_label, step.assignee_user_id, step.state, step.note)
        for step in version.approval_steps
    ] == [
        (0, "line_manager", env.line.id, "approved", "Please review at branch level."),
        (1, "branch_manager", env.branch.id, "pending", None),
    ]
    assert version.signed_by_user_id is None
    assert version.signed_pdf_path is None
    assert version.approval_steps[0].decided_at is not None
    assert book.id in {
        item.id for item in book_service.list_awaiting(env.db, user_id=env.branch.id)
    }
    assert book.id not in {
        item.id for item in book_service.list_awaiting(env.db, user_id=env.line.id)
    }

    branch_view = env.client(env.branch).get(f"/api/v1/books/{book.id}")
    assert branch_view.status_code == 200, branch_view.text
    assert branch_view.json()["can_forward_to_branch"] is False
    assert branch_view.json()["can_sign"] is True
    response = env.client(env.branch).post(
        f"/api/v1/books/{book.id}/sign", json={"version_id": version.id}
    )
    assert response.status_code == 200, response.text
    assert response.json()["approval_state"] == "approved"
    book = env.book(book.id)
    assert book.approval_state == "approved"
    assert len(book.versions) == 1
    assert [version.signed_by_user_id for version in book.versions] == [env.branch.id]
    assert book.versions[-1].signed_pdf_path
    assert [step.state for step in book.versions[-1].approval_steps] == ["approved", "approved"]
    assert book.versions[-1].approval_steps[0].note == "Please review at branch level."


@pytest.mark.parametrize("caller", ["branch", "admin"])
def test_only_the_pending_line_assignee_can_forward(fleet_env: FleetEnv, caller: str) -> None:
    env = fleet_env
    book = _submit(env, general_book(env, env.reporter))

    response = env.client(getattr(env, caller)).post(
        f"/api/v1/books/{book.id}/forward-to-branch",
        json={"version_id": current_version_id(book), "branch_approver_user_id": env.branch.id},
    )

    _assert_error(response, 409, "NOT_LINE_MANAGER_STAGE")
    _assert_pending_line(env, book.id)


@pytest.mark.parametrize(
    "candidate",
    [
        "reporter",
        "line",
        "operator",
        "disabled_branch",
        "admin_without_signer_row",
        "branch_with_two_signer_rows",
    ],
)
def test_forward_rejects_ineligible_branch_candidates(fleet_env: FleetEnv, candidate: str) -> None:
    env = fleet_env
    book = _submit(env, general_book(env, env.reporter))
    if candidate == "disabled_branch":
        env.branch.status = "disabled"
        env.db.commit()
        target = env.branch
    elif candidate == "admin_without_signer_row":
        target = env.admin  # holds books.approve but signs as no Manager row
    elif candidate == "branch_with_two_signer_rows":
        set_signer_rows(env, env.branch, 2)
        target = env.branch
    else:
        target = getattr(env, candidate)

    response = env.client(env.line).post(
        f"/api/v1/books/{book.id}/forward-to-branch",
        json={
            "version_id": current_version_id(book),
            "branch_approver_user_id": target.id,
            "note": "Must not be stored.",
        },
    )

    _assert_error(response, 422, "BRANCH_APPROVER_NOT_ELIGIBLE")
    book = _assert_pending_line(env, book.id)
    assert book.versions[-1].signed_by_user_id is None
    assert book.versions[-1].signed_pdf_path is None


def test_line_manager_cannot_forward_again_after_branch_assignment(fleet_env: FleetEnv) -> None:
    env = fleet_env
    book = _submit(env, general_book(env, env.reporter))
    response = _forward(env, book)
    assert response.status_code == 200, response.text

    response = _forward(env, env.book(book.id))

    _assert_error(response, 409, "NOT_LINE_MANAGER_STAGE")
    book = env.book(book.id)
    assert book.approval_state == "pending"
    assert [
        (step.stage_label, step.assignee_user_id, step.state)
        for step in book.versions[-1].approval_steps
    ] == [
        ("line_manager", env.line.id, "approved"),
        ("branch_manager", env.branch.id, "pending"),
    ]


def test_forward_action_is_only_exposed_to_pending_line_assignee(fleet_env: FleetEnv) -> None:
    env = fleet_env
    book = _submit(env, general_book(env, env.reporter))
    for user in (env.line, env.reporter, env.branch, env.admin, env.operator):
        response = env.client(user).get(f"/api/v1/books/{book.id}")
        if user.id == env.operator.id and response.status_code in (403, 404):
            continue
        assert response.status_code == 200, response.text
        assert response.json()["can_forward_to_branch"] is (user.id == env.line.id)


@pytest.mark.parametrize("stage", ["line_manager", "branch_manager"])
def test_return_from_either_stage_resubmits_as_fresh_line_manager_chain(
    fleet_env: FleetEnv, stage: str
) -> None:
    env = fleet_env
    book = _submit(env, general_book(env, env.reporter))
    decider = env.line
    if stage == "branch_manager":
        forwarded = _forward(env, book)
        assert forwarded.status_code == 200, forwarded.text
        decider = env.branch
    version_id = current_version_id(book)

    response = env.client(decider).post(
        f"/api/v1/books/{book.id}/return",
        json={"version_id": version_id, "note": "Please correct."},
    )

    assert response.status_code == 200, response.text
    assert response.json()["approval_state"] == "returned"
    book = env.book(book.id)
    assert book.approval_state == book.versions[-1].status == "returned"
    assert book.versions[-1].approval_steps[-1].state == "returned"
    assert book.versions[-1].approval_steps[-1].note == "Please correct."

    book = _submit(env, book)
    assert current_version_id(book) == version_id
    assert book.versions[-1].signed_by_user_id is None
    assert book.versions[-1].signed_pdf_path is None
    assert book.id in {item.id for item in book_service.list_awaiting(env.db, user_id=env.line.id)}
    assert book.id not in {
        item.id for item in book_service.list_awaiting(env.db, user_id=env.branch.id)
    }


@pytest.mark.parametrize("stage", ["line_manager", "branch_manager"])
def test_reject_from_either_stage_finishes_with_rejected_state(
    fleet_env: FleetEnv, stage: str
) -> None:
    env = fleet_env
    book = _submit(env, general_book(env, env.reporter))
    decider = env.line
    if stage == "branch_manager":
        forwarded = _forward(env, book)
        assert forwarded.status_code == 200, forwarded.text
        decider = env.branch

    response = env.client(decider).post(
        f"/api/v1/books/{book.id}/reject",
        json={"version_id": current_version_id(book), "note": "Not approved."},
    )

    assert response.status_code == 200, response.text
    assert response.json()["approval_state"] == "rejected"
    book = env.book(book.id)
    assert book.approval_state == book.versions[-1].status == "rejected"
    assert book.versions[-1].approval_steps[-1].state == "rejected"
    assert book.versions[-1].approval_steps[-1].note == "Not approved."
    assert book.versions[-1].signed_by_user_id is None
    assert book.versions[-1].signed_pdf_path is None
    assert book.id not in {
        item.id for item in book_service.list_awaiting(env.db, user_id=decider.id)
    }
    assert any(
        item.id == book.id and step.state == "rejected"
        for item, _, step in book_service.unseen_decisions(env.db, env.reporter)
    )


def test_branch_candidates_exclude_author_and_line_and_require_current_assignee(
    fleet_env: FleetEnv,
) -> None:
    env = fleet_env
    book = _submit(env, general_book(env, env.reporter))

    response = env.client(env.line).get(f"/api/v1/books/{book.id}/branch-candidates")

    assert response.status_code == 200, response.text
    candidates = response.json()
    ids = {candidate["id"] for candidate in candidates}
    assert env.branch.id in ids
    # The admin can approve but has no Manager (signer) row, so cannot sign the paper.
    assert ids.isdisjoint(
        {env.reporter.id, env.line.id, env.operator.id, env.other_reporter.id, env.admin.id}
    )
    set_signer_rows(env, env.admin, 1)
    ids = {
        candidate["id"]
        for candidate in env.client(env.line)
        .get(f"/api/v1/books/{book.id}/branch-candidates")
        .json()
    }
    assert env.admin.id in ids
    for candidate in candidates:
        assert {"id", "name", "name_ar", "is_default"} <= candidate.keys()
    response = env.client(env.branch).get(f"/api/v1/books/{book.id}/branch-candidates")
    _assert_error(response, 409, "NOT_LINE_MANAGER_STAGE")


def test_non_fleet_general_book_keeps_normal_approve_stage_without_forwarding(
    fleet_env: FleetEnv,
) -> None:
    env = fleet_env
    book = general_book(env, env.operator)
    book_service.submit_for_approval(
        env.db,
        book.id,
        priority="Normal",
        approver_user_id=env.line.id,
        reviewer_user_ids=[],
        submitted_by_user_id=env.admin.id,
    )
    book = env.book(book.id)
    assert book.approval_state == "pending"
    assert [
        (step.step_order, step.stage_label, step.assignee_user_id, step.state)
        for step in book.versions[-1].approval_steps
    ] == [(0, "Approve", env.line.id, "pending")]

    response = env.client(env.line).get(f"/api/v1/books/{book.id}")
    assert response.status_code == 200, response.text
    assert response.json()["can_forward_to_branch"] is False
    response = _forward(env, book)
    _assert_error(response, 409, "NOT_LINE_MANAGER_STAGE")
    assert [
        (step.stage_label, step.state) for step in env.book(book.id).versions[-1].approval_steps
    ] == [("Approve", "pending")]
