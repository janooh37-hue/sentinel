"""Ledger Books, Phase 2a (ADR 0007 + ADR 0008, org-independent half).

A writer drafts privately in ``book_drafts``; Save & Send numbers the draft from
the classified register and turns it into an ordinary ``books`` row (named
distribution, category ``GS``) whose ``book_versions`` rows are its Revisions
(``template_id == LEDGER_BOOK_TEMPLATE_ID``). Each Revision's text lives in
append-only ``ledger_book_saves`` rows; the newest one is current. A signed
Revision is locked; a correction Revision is the only way forward.

The approval chain, signing, addressees and delivery are Phase 2b.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
import secrets
import shutil
from datetime import datetime
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.errors import AppError, NotFoundError, ValidationFailedError
from app.config import get_settings
from app.core import grades
from app.core.book_text import build_search_text, html_to_text
from app.core.classifications import CLASSIFICATIONS, classified_ref
from app.core.constants import LEDGER_BOOK_TEMPLATE_ID
from app.core.ledger_html import sanitize_body
from app.core.roles import INMATE_REPORTER_ROLE
from app.db.models import AuditLog, Book, BookCategory, BookDraft, BookVersion, LedgerBookSave, User
from app.db.repos import classified_refs_repo
from app.schemas.ledger_book import (
    LedgerBookRead,
    LedgerDraftCreate,
    LedgerDraftImageRead,
    LedgerDraftRead,
    LedgerDraftUpdate,
    LedgerRevisionRead,
    LedgerSaveRead,
)
from app.services import book_service

log = logging.getLogger(__name__)

CATEGORY_ID = "GS"
PAPER_DATE_FORMAT = "%d-%m-%Y"
MAX_IMAGE_BYTES = 5 * 1024 * 1024
_IMAGE_NAME = re.compile(r"[0-9a-f]{32}\.(?:png|jpg|gif|webp)")
_CLASSIFICATION_BY_TAB = {c.tab: c for c in CLASSIFICATIONS}


# ---------------------------------------------------------------------------
# Paths and helpers
# ---------------------------------------------------------------------------


def draft_image_prefix(draft_id: int) -> str:
    return f"/api/v1/ledger/drafts/{draft_id}/images/"


def book_image_prefix(book_id: int) -> str:
    return f"/api/v1/ledger/books/{book_id}/images/"


def _draft_image_dir(draft_id: int) -> Path:
    return get_settings().data_dir / "ledger_drafts" / str(draft_id)


def _book_image_dir(book_id: int) -> Path:
    # Same root as book_service's attachment dir, in an ``images/`` subfolder.
    return get_settings().data_dir / "book_attachments" / str(book_id) / "images"


def _contained_file(directory: Path, name: str) -> Path | None:
    """``directory / name`` when ``name`` is a stored image name inside ``data_dir``."""
    if not _IMAGE_NAME.fullmatch(name):
        return None
    data_dir = get_settings().data_dir.resolve()
    candidate = (directory / name).resolve()
    if data_dir not in candidate.parents or candidate.parent != directory.resolve():
        return None
    return candidate if candidate.is_file() else None


def _sniff_image(data: bytes) -> str | None:
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if data.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if data.startswith((b"GIF87a", b"GIF89a")):
        return "gif"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    return None


def _clean_subjects(subjects: list[str]) -> list[str]:
    return [subject.strip() for subject in subjects if subject.strip()]


def _has_body(html: str) -> bool:
    return bool(html_to_text(html).strip()) or "<img" in html


def _content_sha256(subjects: list[str], body_html: str) -> str:
    canonical = json.dumps(
        {"subjects": subjects, "body_html": body_html}, ensure_ascii=False, sort_keys=True
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _search_text(book: Book, subjects: list[str], body_html: str) -> str:
    # Every subject is searchable, not only the first one printed as Book.subject.
    return build_search_text(
        subject=" ".join(subjects), ref=book.ref_number, body=html_to_text(body_html)
    )


def _audit(db: Session, user: User, action: str, book: Book, payload: dict[str, object]) -> None:
    db.add(
        AuditLog(
            actor=user.employee_id,
            action=action,
            entity_type="book",
            entity_id=str(book.id),
            payload=json.dumps({"ref_number": book.ref_number, **payload}, ensure_ascii=False),
        )
    )


def _require_writer(user: User) -> None:
    if user.status != "active" or user.role == INMATE_REPORTER_ROLE:
        raise AppError("FORBIDDEN", "You cannot write Ledger Books.", http_status=403)


# ---------------------------------------------------------------------------
# Drafts
# ---------------------------------------------------------------------------


def draft_read(draft: BookDraft) -> LedgerDraftRead:
    return LedgerDraftRead(
        id=draft.id,
        draft_number=f"{draft.id:06d}",
        tab=draft.tab,
        grade=draft.grade,
        urgency=draft.urgency,
        subjects=list(draft.subjects or []),
        body_html=draft.body_html,
        created_at=draft.created_at,
        updated_at=draft.updated_at,
    )


def get_own_draft(db: Session, user: User, draft_id: int) -> BookDraft:
    """The caller's draft; anyone else's (or a missing one) answers 404."""
    draft = db.get(BookDraft, draft_id)
    if draft is None or draft.owner_user_id != user.id:
        raise NotFoundError("DRAFT_NOT_FOUND", "Draft not found")
    return draft


def _set_grade(db: Session, user: User, draft: BookDraft, grade: str) -> None:
    # Same rule as book_send_service.set_grade: Secret needs books.secret;
    # Top Secret and Addressee Only need no capability (the record is named).
    if grade != draft.grade:
        book_service.require_grade_clearance(db, user, grade)
    draft.grade = grade


def create_draft(db: Session, user: User, payload: LedgerDraftCreate) -> BookDraft:
    _require_writer(user)
    book_service.require_grade_clearance(db, user, payload.grade)
    draft = BookDraft(
        owner_user_id=user.id,
        tab=payload.tab,
        grade=payload.grade,
        urgency=payload.urgency,
        subjects=[subject.strip() for subject in payload.subjects],
        body_html="",
    )
    db.add(draft)
    db.flush()
    draft.body_html = sanitize_body(
        payload.body_html, image_src_prefixes=(draft_image_prefix(draft.id),)
    )
    db.commit()
    return draft


def list_drafts(db: Session, user: User) -> list[BookDraft]:
    return list(
        db.scalars(
            select(BookDraft)
            .where(BookDraft.owner_user_id == user.id)
            .order_by(BookDraft.updated_at.desc(), BookDraft.id.desc())
        )
    )


def update_draft(db: Session, user: User, draft_id: int, payload: LedgerDraftUpdate) -> BookDraft:
    draft = get_own_draft(db, user, draft_id)
    _require_writer(user)
    data = payload.model_dump(exclude_unset=True)
    if "tab" in data:
        draft.tab = data["tab"]
    if data.get("grade") is not None:
        _set_grade(db, user, draft, data["grade"])
    if data.get("urgency") is not None:
        draft.urgency = data["urgency"]
    if data.get("subjects") is not None:
        draft.subjects = [subject.strip() for subject in data["subjects"]]
    if data.get("body_html") is not None:
        draft.body_html = sanitize_body(
            data["body_html"], image_src_prefixes=(draft_image_prefix(draft.id),)
        )
    db.commit()
    return draft


def delete_draft(db: Session, user: User, draft_id: int) -> None:
    draft = get_own_draft(db, user, draft_id)
    db.delete(draft)
    db.commit()
    shutil.rmtree(_draft_image_dir(draft_id), ignore_errors=True)


def add_draft_image(db: Session, user: User, draft_id: int, data: bytes) -> LedgerDraftImageRead:
    draft = get_own_draft(db, user, draft_id)
    _require_writer(user)
    if not data:
        raise ValidationFailedError("IMAGE_EMPTY", "The image is empty.")
    if len(data) > MAX_IMAGE_BYTES:
        raise AppError(
            "IMAGE_TOO_LARGE",
            "Images are limited to 5 MiB.",
            http_status=413,
            details={"max_bytes": MAX_IMAGE_BYTES},
        )
    extension = _sniff_image(data)
    if extension is None:
        raise ValidationFailedError(
            "IMAGE_TYPE_UNSUPPORTED", "Only PNG, JPEG, GIF and WebP images are accepted."
        )
    name = f"{secrets.token_hex(16)}.{extension}"
    directory = _draft_image_dir(draft.id)
    directory.mkdir(parents=True, exist_ok=True)
    (directory / name).write_bytes(data)
    return LedgerDraftImageRead(name=name, src=draft_image_prefix(draft.id) + name)


def draft_image_path(db: Session, user: User, draft_id: int, name: str) -> Path:
    draft = get_own_draft(db, user, draft_id)
    path = _contained_file(_draft_image_dir(draft.id), name)
    if path is None:
        raise NotFoundError("IMAGE_NOT_FOUND", "Image not found")
    return path


# ---------------------------------------------------------------------------
# Save & Send
# ---------------------------------------------------------------------------


def save_and_send(db: Session, user: User, draft_id: int) -> Book:
    """Number the draft and turn it into a Ledger Book, in one transaction.

    The classified serial is allocated before anything is flushed, so the
    allocator takes the write lock itself; every other write follows in the
    same transaction and commits once. Any failure rolls back, which also
    rolls back the serial: no number is burned.
    """
    _require_writer(user)
    get_own_draft(db, user, draft_id)
    copied: list[Path] = []
    try:
        serial = classified_refs_repo.allocate_classified_serial(db)
        # Re-read under the write lock: a concurrent Save & Send of the same
        # draft has deleted it by now.
        draft = db.get(BookDraft, draft_id, populate_existing=True)
        if draft is None or draft.owner_user_id != user.id:
            raise NotFoundError("DRAFT_NOT_FOUND", "Draft not found")
        book = _number_draft(db, user, draft, serial, copied)
        db.commit()
    except BaseException:
        db.rollback()
        for path in copied:
            path.unlink(missing_ok=True)
        raise
    shutil.rmtree(_draft_image_dir(draft_id), ignore_errors=True)
    return book


def _number_draft(
    db: Session, user: User, draft: BookDraft, serial: int, copied: list[Path]
) -> Book:
    if draft.tab is None:
        raise ValidationFailedError("DRAFT_TAB_REQUIRED", "Choose the tab (التبويب) first.")
    subjects = _clean_subjects(list(draft.subjects or []))
    if not subjects:
        raise ValidationFailedError("DRAFT_SUBJECT_REQUIRED", "Write at least one subject.")
    body_html = sanitize_body(draft.body_html, image_src_prefixes=(draft_image_prefix(draft.id),))
    if not _has_body(body_html):
        raise ValidationFailedError("DRAFT_BODY_REQUIRED", "Write the letter body first.")
    # Clearance may have been withdrawn since the grade was chosen.
    book_service.require_grade_clearance(db, user, draft.grade)

    classification = _CLASSIFICATION_BY_TAB[draft.tab]
    if db.get(BookCategory, CATEGORY_ID) is None:
        db.add(BookCategory(id=CATEGORY_ID, prefix=CATEGORY_ID))
    book = Book(
        category_id=CATEGORY_ID,
        ref_number=classified_ref(draft.tab, serial),
        subject=subjects[0],
        grade=draft.grade,
        distribution=grades.NAMED,
        urgency=draft.urgency,
        classification_code=classification.code,
        approval_state="none",
        submitted_by_user_id=user.id,
        created_by_user_id=user.id,
        source_draft_id=draft.id,
    )
    db.add(book)
    db.flush()

    body_html = _move_draft_images(draft.id, book.id, body_html, copied)
    book.search_text = _search_text(book, subjects, body_html)
    version = BookVersion(
        book_id=book.id,
        version_no=1,
        template_id=LEDGER_BOOK_TEMPLATE_ID,
        fields={"date": datetime.now().strftime(PAPER_DATE_FORMAT), "tab": draft.tab},
        trigger="initial",
        status="none",
        created_by_user_id=user.id,
    )
    db.add(version)
    db.flush()
    db.add(
        LedgerBookSave(
            version_id=version.id,
            saved_by_user_id=user.id,
            subjects=subjects,
            body_html=body_html,
            content_sha256=_content_sha256(subjects, body_html),
        )
    )
    _audit(
        db,
        user,
        "ledger_book_saved_and_sent",
        book,
        {"draft_id": draft.id, "draft_number": f"{draft.id:06d}", "grade": book.grade},
    )
    db.delete(draft)
    return book


def _move_draft_images(draft_id: int, book_id: int, body_html: str, copied: list[Path]) -> str:
    """Copy the draft's images into the book's folder and point ``src`` at them.

    Copies (not moves) so a rollback leaves the draft intact; the caller
    removes the draft folder after commit, and the copies on failure.
    """
    source_dir = _draft_image_dir(draft_id)
    target_dir = _book_image_dir(book_id)
    data_dir = get_settings().data_dir.resolve()
    if source_dir.is_dir():
        for source in sorted(source_dir.iterdir()):
            if _contained_file(source_dir, source.name) is None:
                continue
            target_dir.mkdir(parents=True, exist_ok=True)
            target = (target_dir / source.name).resolve()
            if data_dir not in target.parents:
                raise AppError("INVALID_PATH", "Image path escapes the data directory.")
            shutil.copy2(source, target)
            copied.append(target)
    rewritten = body_html.replace(
        f'src="{draft_image_prefix(draft_id)}', f'src="{book_image_prefix(book_id)}'
    )
    return sanitize_body(rewritten, image_src_prefixes=(book_image_prefix(book_id),))


# ---------------------------------------------------------------------------
# Ledger Book read / write
# ---------------------------------------------------------------------------


def get_ledger_book(db: Session, book_id: int) -> Book:
    """The Ledger Book ``book_id``; any other record answers 404."""
    book = db.get(Book, book_id)
    if book is None or not book_service.is_ledger_book(book):
        raise NotFoundError("BOOK_NOT_FOUND", "Record not found")
    return book


def _versions(book: Book) -> list[BookVersion]:
    return sorted(book.versions, key=lambda version: version.version_no)


def _current_save(db: Session, version_id: int) -> LedgerBookSave | None:
    return db.scalar(
        select(LedgerBookSave)
        .where(LedgerBookSave.version_id == version_id)
        .order_by(LedgerBookSave.id.desc())
        .limit(1)
    )


def ledger_book_read(
    db: Session, user: User, book_id: int, *, version_id: int | None = None
) -> LedgerBookRead:
    book = get_ledger_book(db, book_id)
    access = book_service.resolve_book_read_access(db, user, book, version_id=version_id)
    versions = _versions(book)
    latest = versions[-1]
    visible = [v for v in versions if access.full_access or v.id in access.allowed_version_ids]
    selected = next(v for v in versions if v.id == access.selected_version_id)
    save = _current_save(db, selected.id)
    fields = latest.fields or {}
    tab = fields.get("tab")
    paper_date = (selected.fields or {}).get("date")
    return LedgerBookRead(
        id=book.id,
        ref_number=book.ref_number,
        grade=book.grade,
        urgency=book.urgency,
        tab=tab if isinstance(tab, int) else None,
        classification_code=book.classification_code,
        paper_date=paper_date if isinstance(paper_date, str) else None,
        approval_state=book.approval_state,
        created_by_user_id=book.created_by_user_id,
        voided=book.voided_at is not None,
        revisions=[
            LedgerRevisionRead(
                version_id=v.id,
                version_no=v.version_no,
                trigger=v.trigger,
                created_at=v.created_at,
                signed_at=v.signed_at,
                superseded=v.id != latest.id,
                locked=v.signed_at is not None,
            )
            for v in visible
        ],
        selected_version_id=selected.id,
        subjects=list(save.subjects) if save is not None else [],
        body_html=save.body_html if save is not None else "",
        content_sha256=save.content_sha256 if save is not None else "",
    )


def _require_creator_write(db: Session, user: User, book: Book) -> None:
    """Phase 2a: only the writer edits or corrects, with full write access."""
    book_service.require_full_book_access(db, user, book, write=True)
    if book.created_by_user_id != user.id:
        raise AppError("FORBIDDEN", "Only the writer can change this Ledger Book.", http_status=403)
    if book.deleted_at is not None:
        raise AppError("BOOK_DELETED", "This record has been deleted.", http_status=409)
    if book.voided_at is not None:
        raise AppError("BOOK_VOIDED", "This record has been voided.", http_status=409)


def save_content(
    db: Session, user: User, book_id: int, *, subjects: list[str], body_html: str
) -> LedgerBookRead:
    """Append a tracked save to the latest Revision (no row when unchanged)."""
    book = get_ledger_book(db, book_id)
    _require_creator_write(db, user, book)
    book_service.require_ledger_revision_unlocked(db, book)
    cleaned_subjects = _clean_subjects(subjects)
    if not cleaned_subjects:
        raise ValidationFailedError("LEDGER_SUBJECT_REQUIRED", "Write at least one subject.")
    cleaned_body = sanitize_body(body_html, image_src_prefixes=(book_image_prefix(book.id),))
    if not _has_body(cleaned_body):
        raise ValidationFailedError("LEDGER_BODY_REQUIRED", "The letter body cannot be empty.")
    latest = _versions(book)[-1]
    digest = _content_sha256(cleaned_subjects, cleaned_body)
    current = _current_save(db, latest.id)
    if current is None or current.content_sha256 != digest:
        db.add(
            LedgerBookSave(
                version_id=latest.id,
                saved_by_user_id=user.id,
                subjects=cleaned_subjects,
                body_html=cleaned_body,
                content_sha256=digest,
            )
        )
        book.subject = cleaned_subjects[0]
        book.search_text = _search_text(book, cleaned_subjects, cleaned_body)
        db.commit()
    return ledger_book_read(db, user, book.id, version_id=latest.id)


def list_saves(db: Session, user: User, book_id: int, version_id: int) -> list[LedgerSaveRead]:
    book = get_ledger_book(db, book_id)
    # Raises unless the caller may read this Revision.
    book_service.resolve_book_read_access(db, user, book, version_id=version_id)
    rows = list(
        db.scalars(
            select(LedgerBookSave)
            .where(LedgerBookSave.version_id == version_id)
            .order_by(LedgerBookSave.id)
        )
    )
    names = book_service.resolve_names_by_ids(db, {row.saved_by_user_id for row in rows})
    return [
        LedgerSaveRead(
            id=row.id,
            saved_by_user_id=row.saved_by_user_id,
            saved_by_name=names.get(row.saved_by_user_id),
            saved_at=row.saved_at,
            content_sha256=row.content_sha256,
        )
        for row in rows
    ]


def start_correction(db: Session, user: User, book_id: int) -> LedgerBookRead:
    """Open Revision N+1 (trigger ``correction``) from the signed Revision N."""
    book = get_ledger_book(db, book_id)
    _require_creator_write(db, user, book)
    latest = _versions(book)[-1]
    if latest.signed_at is None:
        raise AppError(
            "REVISION_NOT_SIGNED",
            "Only a signed Revision can be corrected; edit this one instead.",
            http_status=409,
        )
    signed = _current_save(db, latest.id)
    if signed is None:
        raise AppError("REVISION_EMPTY", "The signed Revision has no content.", http_status=409)
    version = BookVersion(
        book_id=book.id,
        version_no=latest.version_no + 1,
        template_id=LEDGER_BOOK_TEMPLATE_ID,
        fields={
            "date": datetime.now().strftime(PAPER_DATE_FORMAT),
            "tab": (latest.fields or {}).get("tab"),
        },
        trigger="correction",
        status="none",
        created_by_user_id=user.id,
    )
    db.add(version)
    db.flush()
    db.add(
        LedgerBookSave(
            version_id=version.id,
            saved_by_user_id=user.id,
            subjects=list(signed.subjects),
            body_html=signed.body_html,
            content_sha256=signed.content_sha256,
        )
    )
    previous_state = book.approval_state
    book.approval_state = "none"
    _audit(
        db,
        user,
        "ledger_book_correction_started",
        book,
        {
            "version_no": version.version_no,
            "corrects_version_no": latest.version_no,
            "previous_approval_state": previous_state,
        },
    )
    db.commit()
    db.refresh(book)
    return ledger_book_read(db, user, book.id, version_id=version.id)


def book_image_path(db: Session, user: User, book_id: int, name: str) -> Path:
    book = get_ledger_book(db, book_id)
    book_service.resolve_book_read_access(db, user, book)
    path = _contained_file(_book_image_dir(book.id), name)
    if path is None:
        raise NotFoundError("IMAGE_NOT_FOUND", "Image not found")
    return path
