"""BookRead.service_id — the frontend must never re-derive the service rule."""

from __future__ import annotations

from datetime import UTC, datetime

from app.core.form_kind import OTHER_SERVICE_ID
from app.schemas.book import BookRead, BookVersionRead


def _version(template_id: str | None) -> BookVersionRead:
    return BookVersionRead(
        id=1,
        version_no=1,
        trigger="initial",
        status="none",
        template_id=template_id,
        created_at=datetime(2026, 7, 30, tzinfo=UTC),
    )


def _book(subject: str | None, versions: list[BookVersionRead]) -> BookRead:
    return BookRead(
        id=1,
        ref_number="GS-0001",
        category_id="GEN",
        subject=subject,
        direction="outgoing",
        stamp_style=None,
        deleted_at=None,
        priority="Normal",
        approval_state="none",
        created_at=datetime(2026, 7, 30, tzinfo=UTC),
        versions=versions,
    )


def test_service_id_comes_from_the_newest_version_template() -> None:
    book = _book("anything at all", [_version("Report")])
    assert book.service_id == "Report"


def test_service_id_falls_back_to_subject_only_when_versionless() -> None:
    book = _book("Leave Application Form - Saif", [])
    assert book.service_id == "Leave Application Form"


def test_versioned_book_with_unknown_template_is_other() -> None:
    book = _book("Leave Application Form - Saif", [_version(None)])
    assert book.service_id == OTHER_SERVICE_ID


def test_service_id_is_serialised() -> None:
    book = _book(None, [_version("Warning Form")])
    assert book.model_dump()["service_id"] == "Warning Form"
