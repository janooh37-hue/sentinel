"""The per-book notify switch (notify_employee) gates the autosend decision,
alongside the existing commit / new-book / non-revision conditions."""

from app.api.v1.documents import _should_autosend


def test_autosend_true_for_committed_new_book_with_notify_on():
    assert (
        _should_autosend(commit=True, revise_of_book_id=None, book_id=42, notify_employee=True)
        is True
    )


def test_autosend_false_when_notify_employee_off():
    assert (
        _should_autosend(commit=True, revise_of_book_id=None, book_id=42, notify_employee=False)
        is False
    )


def test_autosend_false_for_preview_even_with_notify_on():
    assert (
        _should_autosend(commit=False, revise_of_book_id=None, book_id=42, notify_employee=True)
        is False
    )


def test_autosend_false_for_revision():
    assert (
        _should_autosend(commit=True, revise_of_book_id=7, book_id=42, notify_employee=True)
        is False
    )
