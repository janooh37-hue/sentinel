"""word_book_service — create a classified (or plain) Word-editing book session.

Creates a Book row + reserved ref + a rendered working docx, then opens an
active BookEditSession so Word can edit it over WebDAV.
"""

from __future__ import annotations

import contextlib
import secrets
import shutil
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.errors import AppError
from app.config import get_settings
from app.core import docx_render, manager_override
from app.core.classifications import (
    classified_ref,
    get_classification,
)
from app.core.docx_engine import _normalize_cc
from app.db.models import Book, BookCategory, BookEditSession, BookVersion, Document, Manager, User
from app.db.repos import classified_refs_repo, refs_repo
from app.services._pdf_executor import convert_docx_to_pdf
from app.services.document_service import _build_docx_filename, _output_dir_for_admin

# General Book template filename (plain path, no classification)
_GENERAL_BOOK_TEMPLATE = "GSSG-GS_300-003_General_Book.docx"


@dataclass
class WordSessionInfo:
    book_id: int
    ref_number: str
    token: str
    filename: str  # ref slug + ".docx"
    word_url: str  # ms-word:ofe|u|{public_base_url}/dav/{token}/{filename}
    dav_url: str


def create_word_book(
    db: Session,
    *,
    user: User,
    classification_code: str | None,
    recipient_id: int | None,
    subject: str,
    cc: list[str] | str | None,
    manager_id: int | None,
) -> WordSessionInfo:
    """Create a classified (or plain) General Book with a working docx for Word.

    Returns a WordSessionInfo with the ms-word: URL to hand to the browser.
    """
    settings = get_settings()

    # ------------------------------------------------------------------
    # 1. Resolve ref + template path
    # ------------------------------------------------------------------
    if classification_code is not None:
        cls = get_classification(classification_code)
        if cls is None:
            raise AppError(
                "UNKNOWN_CLASSIFICATION",
                f"Classification code {classification_code!r} is not in the registry",
                http_status=422,
            )
        template_file = cls.template
        template_path = settings.templates_dir / template_file
        if not template_path.exists():
            raise AppError(
                "TEMPLATE_MISSING",
                f"Template file {template_file!r} not found on disk",
                http_status=409,
                details={"file": template_file},
            )
        serial = classified_refs_repo.allocate_classified_serial(db)
        ref = classified_ref(cls.tab, serial)
    else:
        template_path = settings.templates_dir / _GENERAL_BOOK_TEMPLATE
        if not template_path.exists():
            raise AppError(
                "TEMPLATE_MISSING",
                f"Template file {_GENERAL_BOOK_TEMPLATE!r} not found on disk",
                http_status=409,
                details={"file": _GENERAL_BOOK_TEMPLATE},
            )
        ref = refs_repo.allocate_ref_with_retry(db, "GS")

    # ------------------------------------------------------------------
    # 2. Insert Book (flush to get PK before writing the file)
    # ------------------------------------------------------------------
    if db.get(BookCategory, "GS") is None:
        db.add(BookCategory(id="GS", prefix="GS"))
        db.flush()

    book = Book(
        category_id="GS",
        ref_number=ref,
        subject=subject,
        classification_code=classification_code,
        approval_state="none",
        submitted_by_user_id=user.id,
        doc_manager_id=manager_id,
    )
    db.add(book)
    db.flush()  # get book.id

    # ------------------------------------------------------------------
    # 3. Build output path
    # ------------------------------------------------------------------
    filename = ref.replace("/", "-") + ".docx"
    output_path = settings.data_dir / "editing" / f"book-{book.id}" / filename

    # ------------------------------------------------------------------
    # 4. Build template data dict
    # ------------------------------------------------------------------
    data: dict[str, Any] = {
        "ref": ref,
        "date": datetime.now().strftime("%d/%m/%Y"),
        "subject": subject,
        "recipient_name": _resolve_recipient(db, recipient_id),
        "cc": _normalize_cc_for_template(cc),
        "submitter_g": user.employee_id or "",
    }

    # Manager name/title (same tokens as General Book: manager_name, manager_title)
    if manager_id is not None:
        mgr = db.get(Manager, manager_id)
        if mgr is not None:
            manager_override.apply(
                data,
                {
                    "name_en": mgr.name_en,
                    "name_ar": mgr.name_ar,
                    "title": mgr.title,
                    "sig_path": mgr.sig_path,
                },
                embed=False,
                prefer_arabic=True,
            )

    # ------------------------------------------------------------------
    # 5. Render working docx
    # ------------------------------------------------------------------
    docx_render.render(template_path, data, output_path)

    # ------------------------------------------------------------------
    # 6. Insert BookEditSession + commit everything atomically
    # ------------------------------------------------------------------
    token = secrets.token_urlsafe(32)
    session = BookEditSession(
        book_id=book.id,
        user_id=user.id,
        token=token,
        working_path=str(output_path),
        state="active",
    )
    db.add(session)
    db.commit()

    # ------------------------------------------------------------------
    # 7. Build URLs
    # ------------------------------------------------------------------
    base_url = settings.public_base_url.rstrip("/")
    dav_url = f"{base_url}/dav/{token}/{filename}"
    word_url = f"ms-word:ofe|u|{dav_url}"

    return WordSessionInfo(
        book_id=book.id,
        ref_number=ref,
        token=token,
        filename=filename,
        word_url=word_url,
        dav_url=dav_url,
    )


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------


def _resolve_recipient(db: Session, recipient_id: int | None) -> str:
    """Resolve recipient_id → display name (or empty string)."""
    if recipient_id is None:
        return ""
    from app.db.models import GeneralBookRecipient

    row = db.get(GeneralBookRecipient, recipient_id)
    return row.name if row is not None else ""


def _normalize_cc_for_template(cc: list[str] | str | None) -> str:
    """Normalize cc to newline-joined string matching the General Book adapter."""
    normalized = _normalize_cc(cc)
    if not normalized:
        return ""
    parts = [p.strip() for p in normalized.split(",") if p.strip()]
    return "\n".join(parts)


# ---------------------------------------------------------------------------
# Finish / discard a Word editing session
# ---------------------------------------------------------------------------

_CLASSIFIED_TEMPLATE_ID = "Classified Book"
_GENERAL_TEMPLATE_ID = "General Book"


def _template_id_for_book(book: Book) -> str:
    return _CLASSIFIED_TEMPLATE_ID if book.classification_code else _GENERAL_TEMPLATE_ID


def finish_word_session(db: Session, *, user: User, book_id: int) -> Book:
    """Turn the active Word session into a BookVersion + Document + optional PDF.

    Raises AppError:
    - NO_ACTIVE_SESSION (409) if no active session exists for this book.
    - NO_SAVES_YET (409) if Word has never PUT to the working file.
    """
    book = db.get(Book, book_id)
    if book is None:
        raise AppError("BOOK_NOT_FOUND", f"Book {book_id} not found", http_status=404)

    session = db.query(BookEditSession).filter_by(book_id=book_id, state="active").one_or_none()
    if session is None:
        raise AppError(
            "NO_ACTIVE_SESSION", "No active editing session for this book", http_status=409
        )

    if session.last_put_at is None:
        raise AppError("NO_SAVES_YET", "Nothing saved from Word yet", http_status=409)

    # ------------------------------------------------------------------
    # 1. Move working docx → stable output dir
    # ------------------------------------------------------------------
    template_id = _template_id_for_book(book)
    now = datetime.now(UTC).replace(tzinfo=None)
    out_dir = _output_dir_for_admin(template_id)
    filename = _build_docx_filename(template_id, book.ref_number, now)
    dest = out_dir / filename
    # Avoid collisions (unlikely but possible if clock has low resolution)
    suffix = 0
    while dest.exists():
        suffix += 1
        dest = out_dir / (Path(filename).stem + f"_{suffix}.docx")

    src = Path(session.working_path)
    shutil.move(str(src), str(dest))

    # ------------------------------------------------------------------
    # 2. PDF conversion (lenient — None is fine)
    # ------------------------------------------------------------------
    pdf_path: Path | None = convert_docx_to_pdf(dest)

    # ------------------------------------------------------------------
    # 3. Create Document row
    # ------------------------------------------------------------------
    doc = Document(
        template_id=template_id,
        ref_number=book.ref_number,
        docx_path=str(dest),
        pdf_path=str(pdf_path) if pdf_path else None,
        submission_id=str(uuid.uuid4()),
        role="primary",
    )
    db.add(doc)
    db.flush()  # get doc.id

    # ------------------------------------------------------------------
    # 4. Create BookVersion
    # ------------------------------------------------------------------
    max_version_no: int = (
        db.query(func.max(BookVersion.version_no)).filter(BookVersion.book_id == book_id).scalar()
        or 0
    )
    version_no = max_version_no + 1
    trigger = "initial" if max_version_no == 0 else "revision"

    version = BookVersion(
        book_id=book_id,
        version_no=version_no,
        trigger=trigger,
        status="none",
        template_id=template_id,
        fields={},
        created_by_user_id=user.id,
        document_id=doc.id,
    )
    db.add(version)

    # ------------------------------------------------------------------
    # 5. Mark session finished
    # ------------------------------------------------------------------
    session.state = "finished"

    db.commit()
    db.refresh(book)
    return book


def discard_word_session(db: Session, *, user: User, book_id: int) -> Book:
    """Discard the active Word session; void the book if it has no committed versions."""
    book = db.get(Book, book_id)
    if book is None:
        raise AppError("BOOK_NOT_FOUND", f"Book {book_id} not found", http_status=404)

    session = db.query(BookEditSession).filter_by(book_id=book_id, state="active").one_or_none()
    if session is None:
        raise AppError(
            "NO_ACTIVE_SESSION", "No active editing session for this book", http_status=409
        )

    # Delete working file (lenient)

    src = Path(session.working_path)
    with contextlib.suppress(OSError):
        src.unlink(missing_ok=True)

    session.state = "discarded"

    # Void the book only if it has no committed versions
    has_versions = (
        db.query(func.count(BookVersion.id)).filter(BookVersion.book_id == book_id).scalar() or 0
    ) > 0
    if not has_versions:
        book.voided_at = datetime.now(UTC).replace(tzinfo=None)

    db.commit()
    db.refresh(book)
    return book
