"""Unit tests for the _should_autosend guard in the document generation API."""

from types import SimpleNamespace

import pytest

from app.api.v1 import documents as docs_api


def test_should_autosend_true_for_committed_initial():
    assert docs_api._should_autosend(commit=True, revise_of_book_id=None, book_id=5) is True


def test_should_autosend_false_for_preview():
    assert docs_api._should_autosend(commit=False, revise_of_book_id=None, book_id=5) is False


def test_should_autosend_false_for_revision():
    assert docs_api._should_autosend(commit=True, revise_of_book_id=9, book_id=5) is False


def test_should_autosend_false_without_book():
    assert docs_api._should_autosend(commit=True, revise_of_book_id=None, book_id=None) is False


def test_should_autosend_false_for_system_silence():
    """A system suppression (inmate reporter) attempts nothing, not even a skip."""
    assert (
        docs_api._should_autosend(
            commit=True, revise_of_book_id=None, book_id=5, notify_employee="silent"
        )
        is False
    )


@pytest.mark.parametrize(
    ("template_id", "notify_kwargs", "expected_dispatches"),
    [
        # An explicit off still reaches the dispatcher, which logs a skipped row.
        ("Salary Deduction Form", {"notify_employee": False}, [(42, False)]),
        ("Violation Form", {"notify_employee": False}, [(42, False)]),
        ("Salary Deduction Form", {}, [(42, None)]),
        ("Violation Form", {"notify_employee": True}, [(42, True)]),
    ],
)
def test_run_generation_notification_choice_and_book_id(
    monkeypatch,
    template_id,
    notify_kwargs,
    expected_dispatches,
):
    class FakeSession:
        def close(self) -> None:
            return None

    dispatched: list[tuple[int, object]] = []
    monkeypatch.setattr(docs_api, "SessionLocal", FakeSession)
    monkeypatch.setattr(
        docs_api.document_service,
        "generate_document",
        lambda *args, **kwargs: SimpleNamespace(
            book_id=42,
            submission_id="sub",
            documents=[],
            superseded_absences=[],
        ),
    )
    monkeypatch.setattr(
        docs_api.notify_dispatch,
        "auto_send_for_book",
        lambda db, book_id, *, sent_by, choice: dispatched.append((book_id, choice)),
    )

    job_id = docs_api.submit_job(owner_user_id=1)
    request = docs_api.DocumentGenerateRequest(
        template_id=template_id,
        commit=True,
        **notify_kwargs,
    )
    docs_api._run_generation(job_id, request)

    job = docs_api.get_job(job_id)
    assert job is not None
    assert job.status == "done"
    assert job.book_id == 42
    assert dispatched == expected_dispatches
