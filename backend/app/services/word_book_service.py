"""word_book_service — create a classified (or plain) Word-editing book session.

Creates a Book row + reserved ref + a rendered working docx, then opens an
active BookEditSession so Word can edit it over WebDAV.
"""

from __future__ import annotations

import secrets
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from app.api.errors import AppError
from app.config import get_settings
from app.core import docx_render, manager_override
from app.core.classifications import (
    classified_ref,
    get_classification,
)
from app.core.docx_engine import _normalize_cc
from app.db.models import Book, BookCategory, BookEditSession, Manager, User
from app.db.repos import classified_refs_repo, refs_repo

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
