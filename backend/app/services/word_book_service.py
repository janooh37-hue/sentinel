"""word_book_service — create a classified (or plain) Word-editing book session.

Creates a Book row + reserved ref + a rendered working docx, then opens an
active BookEditSession so Word can edit it over WebDAV.
"""

from __future__ import annotations

import contextlib
import os
import secrets
import shutil
import threading
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.errors import AppError
from app.config import get_settings
from app.core import manager_override
from app.core.book_text import build_search_text, docx_to_text
from app.core.classifications import (
    classified_ref,
    get_classification,
)
from app.core.constants import TEMPLATE_FILES
from app.core.docx_engine import (
    DocxEngine,
    _postprocess_general_book_footer,
    aztec_corner_for,
)
from app.db.models import Book, BookCategory, BookEditSession, BookVersion, Document, Manager, User
from app.db.repos import classified_refs_repo
from app.services._pdf_executor import convert_docx_to_pdf
from app.services.document_service import (
    GENERAL_BOOK_BODY_SENTINEL,
    _build_docx_filename,
    _output_dir_for_admin,
)

# Every Word book renders on the ONE General Book template — the same file the
# rich-editor path fills — so both authoring surfaces produce identical paper.
_TEMPLATE_ID = "General Book"


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
    template_name: str | None = None,
) -> WordSessionInfo:
    """Create a General Book with a working docx for Word.

    Every book takes its ref from the classified register
    (``1/{tab}/GSSG/{serial}``), so a classification is required — same rule as
    the rich-editor path. Returns a WordSessionInfo with the ms-word: URL to
    hand to the browser.
    """
    settings = get_settings()

    # ------------------------------------------------------------------
    # 1. Resolve classification → ref; template is always the General Book
    # ------------------------------------------------------------------
    if classification_code is None:
        raise AppError(
            "CLASSIFICATION_REQUIRED",
            "General Book requires a classification (التبويب) — every book "
            "takes its ref from the classified register",
            http_status=422,
        )
    cls = get_classification(classification_code)
    if cls is None:
        raise AppError(
            "UNKNOWN_CLASSIFICATION",
            f"Classification code {classification_code!r} is not in the registry",
            http_status=422,
        )
    library_template: Path | None = None
    if template_name is not None:
        from app.services import book_template_service

        library_template = book_template_service.resolve_template_path(template_name)
    template_file = TEMPLATE_FILES[_TEMPLATE_ID]
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
    # 4. Build template data dict — routed through the SAME General Book
    # adapter as the rich-editor path (DocxEngine.fill applies
    # _adapt_general_book: dd-mm-yyyy date, CC newline join + font fix,
    # default manager name). ``body`` carries the sentinel with an empty
    # body_html so the {{ body }} anchor is cleared cleanly — the operator
    # writes the body in Word.
    # ------------------------------------------------------------------
    data: dict[str, Any] = {
        "ref": ref,
        "subject": subject,
        "body": GENERAL_BOOK_BODY_SENTINEL,
        "body_html": "",
        "recipient_name": _resolve_recipient(db, recipient_id),
        "cc": cc,
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
    # 5. Render working docx + the same post-render pipeline the rich-editor
    # path runs (document_service steps 8b/9): footer2 ← footer3 sync, then
    # header ref stamp + Aztec code — so the paper is identical no matter
    # where the body was written.
    # ------------------------------------------------------------------
    engine = DocxEngine(settings.templates_dir)
    if library_template is not None:
        try:
            engine.fill_general_book_path(library_template, data, output_path, sandboxed=True)
        except FileNotFoundError:
            raise AppError(
                "TEMPLATE_MISSING",
                f"القالب '{template_name}' غير موجود في المكتبة",
                http_status=409,
            ) from None
    else:
        engine.fill(_TEMPLATE_ID, data, output_path)
    _postprocess_general_book_footer(output_path)
    DocxEngine.stamp_aztec_code(output_path, ref, corner=aztec_corner_for(_TEMPLATE_ID))

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


# ---------------------------------------------------------------------------
# Finish / discard a Word editing session
# ---------------------------------------------------------------------------


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
    template_id = _TEMPLATE_ID
    now = datetime.now(UTC).replace(tzinfo=None)
    out_dir = _output_dir_for_admin(template_id)
    filename = _build_docx_filename(template_id, book.ref_number.replace("/", "-"), now)
    dest = out_dir / filename
    # Avoid collisions (unlikely but possible if clock has low resolution)
    suffix = 0
    while dest.exists():
        suffix += 1
        dest = out_dir / (Path(filename).stem + f"_{suffix}.docx")

    src = Path(session.working_path)
    shutil.move(str(src), str(dest))
    _cleanup_preview_files(src.parent)

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
    # 5. Populate search_text from the finished docx (before commit so the
    #    FTS au trigger fires with the new value).
    # ------------------------------------------------------------------
    try:
        body = docx_to_text(dest)
    except Exception:
        body = ""
    book.search_text = build_search_text(subject=book.subject, ref=book.ref_number, body=body)

    # ------------------------------------------------------------------
    # 6. Mark session finished
    # ------------------------------------------------------------------
    session.state = "finished"

    db.commit()
    db.refresh(book)
    return book


def reopen_word_session(db: Session, *, user: User, book_id: int) -> WordSessionInfo:
    """Copy the latest version's docx into a fresh working file and open an active session.

    For finished books (at least one BookVersion) only.
    Raises AppError:
    - BOOK_NOT_FOUND (404)
    - SESSION_ACTIVE (409) if an active session already exists.
    - NO_SOURCE_DOCX (409) if no versions or latest version's docx is missing.
    """
    book = db.get(Book, book_id)
    if book is None:
        raise AppError("BOOK_NOT_FOUND", f"Book {book_id} not found", http_status=404)

    active = db.query(BookEditSession).filter_by(book_id=book_id, state="active").one_or_none()
    if active is not None:
        raise AppError(
            "SESSION_ACTIVE",
            "An active editing session already exists for this book",
            http_status=409,
        )

    # Find latest version by version_no
    latest_version = (
        db.query(BookVersion)
        .filter_by(book_id=book_id)
        .order_by(BookVersion.version_no.desc())
        .first()
    )
    if latest_version is None or latest_version.document_id is None:
        raise AppError(
            "NO_SOURCE_DOCX",
            "No finished version with a document exists for this book",
            http_status=409,
        )

    source_doc = db.get(Document, latest_version.document_id)
    if source_doc is None or not source_doc.docx_path or not Path(source_doc.docx_path).exists():
        raise AppError(
            "NO_SOURCE_DOCX", "The latest version's docx file is missing on disk", http_status=409
        )

    settings = get_settings()
    # Reuse the same filename slug as create (ref with slashes → dashes)
    filename = book.ref_number.replace("/", "-") + ".docx"
    output_path = settings.data_dir / "editing" / f"book-{book_id}" / filename
    output_path.parent.mkdir(parents=True, exist_ok=True)

    shutil.copy2(str(Path(source_doc.docx_path)), str(output_path))

    token = secrets.token_urlsafe(32)
    session = BookEditSession(
        book_id=book_id,
        user_id=user.id,
        token=token,
        working_path=str(output_path),
        state="active",
    )
    db.add(session)
    db.commit()

    base_url = settings.public_base_url.rstrip("/")
    dav_url = f"{base_url}/dav/{token}/{filename}"
    word_url = f"ms-word:ofe|u|{dav_url}"

    return WordSessionInfo(
        book_id=book_id,
        ref_number=book.ref_number,
        token=token,
        filename=filename,
        word_url=word_url,
        dav_url=dav_url,
    )


def _cleanup_preview_files(editing_dir: Path) -> None:
    """Best-effort removal of the live-preview leftovers in a session dir."""
    for leftover in ("preview-src.pdf", "preview-src.docx"):
        with contextlib.suppress(OSError):
            (editing_dir / leftover).unlink(missing_ok=True)


# One preview conversion at a time. All requests share preview-src.docx/.pdf
# per session dir; overlapping polls (5s cadence vs multi-second Word COM
# conversions, or two viewers) would copy over the converter's open handle.
# ponytail: global lock; per-session locks if several sessions preview at once.
_preview_lock = threading.Lock()


def render_session_preview(db: Session, *, book_id: int) -> Path:
    """PDF preview of the ACTIVE session's working docx.

    Cached beside the working file as ``preview-src.pdf`` and regenerated only
    when the working docx is newer — Word COM conversion costs seconds and the
    dialog polls every 5s. Conversion runs on a COPY so Word's WebDAV PUTs
    never collide with the converter's open handle. No ``os.replace`` step:
    replacing a file another request is still streaming raises PermissionError
    on Windows, so the conversion output itself is the cache. The produced
    PDF's mtime is pinned to the working file's mtime AT COPY TIME, so a PUT
    landing mid-conversion correctly leaves the cache stale for the next poll.
    """
    session = db.query(BookEditSession).filter_by(book_id=book_id, state="active").one_or_none()
    if session is None:
        raise AppError(
            "NO_ACTIVE_SESSION", "No active editing session for this book", http_status=409
        )
    if session.last_put_at is None:
        raise AppError("NO_SAVES_YET", "Nothing saved from Word yet", http_status=409)
    working = Path(session.working_path)
    if not working.exists():
        raise AppError("PREVIEW_UNAVAILABLE", "Working file is missing", http_status=409)

    preview_pdf = working.parent / "preview-src.pdf"
    with _preview_lock:
        if preview_pdf.exists() and preview_pdf.stat().st_mtime >= working.stat().st_mtime:
            return preview_pdf

        snapshot_mtime = working.stat().st_mtime
        src_copy = working.parent / "preview-src.docx"
        shutil.copy2(working, src_copy)
        pdf = convert_docx_to_pdf(src_copy)
        with contextlib.suppress(OSError):
            src_copy.unlink(missing_ok=True)
        if pdf is None:
            raise AppError(
                "PREVIEW_UNAVAILABLE", "PDF conversion is not available", http_status=409
            )
        os.utime(pdf, (snapshot_mtime, snapshot_mtime))
        return pdf  # == preview_pdf (conversion writes beside the source docx)


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
    _cleanup_preview_files(src.parent)

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
