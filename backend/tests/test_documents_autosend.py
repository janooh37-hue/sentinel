"""Unit tests for the _should_autosend guard in the document generation API."""

from app.api.v1 import documents as docs_api


def test_should_autosend_true_for_committed_initial():
    assert docs_api._should_autosend(commit=True, revise_of_book_id=None, book_id=5) is True


def test_should_autosend_false_for_preview():
    assert docs_api._should_autosend(commit=False, revise_of_book_id=None, book_id=5) is False


def test_should_autosend_false_for_revision():
    assert docs_api._should_autosend(commit=True, revise_of_book_id=9, book_id=5) is False


def test_should_autosend_false_without_book():
    assert docs_api._should_autosend(commit=True, revise_of_book_id=None, book_id=None) is False


def test_should_autosend_false_when_notify_employee_off():
    """The per-book notify switch, when off, suppresses autosend even for an
    otherwise-eligible committed initial generation."""
    assert (
        docs_api._should_autosend(
            commit=True, revise_of_book_id=None, book_id=5, notify_employee=False
        )
        is False
    )
