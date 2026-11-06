"""Ledger drafts, tracked Revisions, manager signing and post-signature delivery.

A writer drafts privately in ``book_drafts``; Save & Send numbers the draft from
the classified register and turns it into an ordinary ``books`` row (named
distribution, category ``GS``) whose ``book_versions`` rows are its Revisions
(``template_id == LEDGER_BOOK_TEMPLATE_ID``). Each Revision's text lives in
append-only ``ledger_book_saves`` rows; the newest one is current. A signed
Revision is locked; a correction Revision is the only way forward.

Save & Send snapshots To/CC and opens the linked manager's approval step.
Internal delivery shares the desk's inbox/push machinery but commits atomically
with signing. External books are handed off by the writer as signed PDF drafts.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
import secrets
import shutil
from collections.abc import Callable
from datetime import UTC, date, datetime
from pathlib import Path
from typing import cast

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.errors import AppError, NotFoundError, ValidationFailedError
from app.config import get_settings
from app.core import grades
from app.core.book_text import build_search_text, html_to_text
from app.core.classifications import CLASSIFICATIONS, classified_ref
from app.core.constants import LEDGER_BOOK_TEMPLATE_ID
from app.core.ledger_html import sanitize_body
from app.core.ledger_paper import CURRENT_LAYOUT, PaperContext, render_paper
from app.core.roles import INMATE_REPORTER_ROLE
from app.db.models import (
    AddressBookContact,
    AuditLog,
    Book,
    BookAddressee,
    BookApprovalStep,
    BookCategory,
    BookDraft,
    BookFolder,
    BookLink,
    BookRecipient,
    BookVersion,
    LedgerBookSave,
    Manager,
    User,
)
from app.db.repos import classified_refs_repo
from app.db.repos._locking import begin_immediate_if_idle
from app.schemas.book import SendPurpose
from app.schemas.ledger_book import (
    LedgerAddresseeRead,
    LedgerBookRead,
    LedgerDraftCreate,
    LedgerDraftImageRead,
    LedgerDraftRead,
    LedgerDraftUpdate,
    LedgerFolderRead,
    LedgerOutlookDraftRead,
    LedgerReferenceRead,
    LedgerRevisionRead,
    LedgerSaveRead,
    LedgerSignerRead,
)
from app.services import (
    book_folder_service,
    book_link_service,
    book_send_service,
    book_service,
    email_service,
    sheet_pdf_service,
    user_signature_service,
)

log = logging.getLogger(__name__)

CATEGORY_ID = "GS"
PAPER_DATE_FORMAT = "%d-%m-%Y"
PAPER_ASSET_BASE = "/api/v1/ledger/paper-assets"
MAX_IMAGE_BYTES = 5 * 1024 * 1024
_IMAGE_NAME = re.compile(r"[0-9a-f]{32}\.(?:png|jpg|gif|webp)")
_CLASSIFICATION_BY_TAB = {c.tab: c for c in CLASSIFICATIONS}
_DELIVERY_PURPOSES: tuple[tuple[str, SendPurpose], ...] = (("to", "action"), ("cc", "info"))


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
        importance=draft.importance,
        subjects=list(draft.subjects or []),
        body_html=draft.body_html,
        external=draft.external,
        signer_manager_id=draft.signer_manager_id,
        addressees=draft.addressees,
        paper_preset=draft.paper_preset,
        reference_book_ids=list(draft.reference_book_ids or []),
        folder_ids=list(draft.folder_ids or []),
        created_at=draft.created_at,
        updated_at=draft.updated_at,
    )


def get_own_draft(db: Session, user: User, draft_id: int) -> BookDraft:
    """The caller's draft; anyone else's (or a missing one) answers 404."""
    draft = db.get(BookDraft, draft_id)
    if draft is None or draft.owner_user_id != user.id:
        raise NotFoundError("DRAFT_NOT_FOUND", "Draft not found")
    return draft


def _can_open(db: Session, user: User, book: Book) -> bool:
    if book.deleted_at is not None:
        return False
    try:
        book_service.require_full_book_access(db, user, book)
    except AppError:
        return False
    return True


def _validate_references(db: Session, user: User, book_ids: list[int]) -> list[Book]:
    """Distinct books the writer can open; any other id is one opaque field error."""
    invalid = ValidationFailedError("REFERENCE_INVALID", "Choose books you can open, each once.")
    if len(set(book_ids)) != len(book_ids):
        raise invalid
    targets = []
    for book_id in book_ids:
        target = db.get(Book, book_id)
        if target is None or not _can_open(db, user, target):
            raise invalid
        targets.append(target)
    return targets


def _validate_folders(db: Session, user: User, folder_ids: list[int]) -> list[BookFolder]:
    """Distinct outgoing-box folders the writer may file into (own or shared team)."""
    invalid = ValidationFailedError(
        "FOLDER_INVALID", "Choose your own or shared folders in the outgoing box, each once."
    )
    if len(set(folder_ids)) != len(folder_ids):
        raise invalid
    folders = []
    for folder_id in folder_ids:
        try:
            folder = book_folder_service.get_folder(db, user, folder_id)
        except AppError:
            raise invalid from None
        if folder.box != "outgoing":
            raise invalid
        folders.append(folder)
    return folders


def _set_grade(db: Session, user: User, draft: BookDraft, grade: str) -> None:
    # Same rule as book_send_service.set_grade: Secret needs books.secret;
    # Top Secret and Addressee Only need no capability (the record is named).
    if grade != draft.grade:
        book_service.require_grade_clearance(db, user, grade)
    draft.grade = grade


def _validate_signer(db: Session, manager_id: int | None) -> Manager | None:
    if manager_id is None:
        return None
    manager = db.get(Manager, manager_id)
    linked = db.get(User, manager.user_id) if manager is not None and manager.user_id else None
    if (
        manager is None
        or not manager.active
        or linked is None
        or linked.status != "active"
        or linked.role == INMATE_REPORTER_ROLE
    ):
        raise ValidationFailedError("SIGNER_INVALID", "Choose an active manager linked to a user.")
    return manager


def _resolve_addressees(
    db: Session,
    user: User,
    *,
    external: bool,
    grade: str,
    addressees: list[dict[str, object]],
) -> list[BookAddressee]:
    entries = {e.user.id: e for e in book_send_service.recipient_candidates(db, user, grade)}
    resolved = []
    for position, item in enumerate(addressees):
        user_id, contact_id = item.get("user_id"), item.get("contact_id")
        if (user_id is None) == (contact_id is None) or external != (contact_id is not None):
            raise ValidationFailedError(
                "ADDRESSEE_INVALID", "Choose a valid addressee for this book."
            )
        row = BookAddressee(role=item["role"], position=position)
        if external:
            contact = db.get(AddressBookContact, contact_id)
            if contact is None or contact.owner_user_id != user.id:
                raise ValidationFailedError(
                    "ADDRESSEE_INVALID", "Choose one of your saved contacts."
                )
            row.contact_id = contact.id
            row.name_en = contact.display_name
            row.email = contact.address
        else:
            entry = entries.get(user_id) if isinstance(user_id, int) else None
            if entry is None:
                raise ValidationFailedError("ADDRESSEE_INVALID", "Choose an active, cleared user.")
            row.user_id = entry.user.id
            row.name_en, row.name_ar, row.email = entry.name, entry.name_ar, entry.user.email
        resolved.append(row)
    return resolved


def create_draft(db: Session, user: User, payload: LedgerDraftCreate) -> BookDraft:
    _require_writer(user)
    book_service.require_grade_clearance(db, user, payload.grade)
    _validate_signer(db, payload.signer_manager_id)
    _resolve_addressees(
        db,
        user,
        external=payload.external,
        grade=payload.grade,
        addressees=[a.model_dump(exclude_none=True) for a in payload.addressees],
    )
    _validate_references(db, user, payload.reference_book_ids)
    _validate_folders(db, user, payload.folder_ids)
    draft = BookDraft(
        owner_user_id=user.id,
        tab=payload.tab,
        grade=payload.grade,
        importance=payload.importance,
        external=payload.external,
        signer_manager_id=payload.signer_manager_id,
        addressees=[a.model_dump(exclude_none=True) for a in payload.addressees],
        subjects=[subject.strip() for subject in payload.subjects],
        body_html="",
        paper_preset=payload.paper_preset,
        reference_book_ids=list(payload.reference_book_ids),
        folder_ids=list(payload.folder_ids),
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
    _validate_signer(db, data.get("signer_manager_id", draft.signer_manager_id))
    _resolve_addressees(
        db,
        user,
        external=payload.external if payload.external is not None else draft.external,
        grade=payload.grade or draft.grade,
        addressees=[a.model_dump(exclude_none=True) for a in payload.addressees]
        if payload.addressees is not None
        else draft.addressees,
    )
    if payload.reference_book_ids is not None:
        _validate_references(db, user, payload.reference_book_ids)
    if payload.folder_ids is not None:
        _validate_folders(db, user, payload.folder_ids)
    if payload.paper_preset is not None:
        draft.paper_preset = payload.paper_preset
    if payload.reference_book_ids is not None:
        draft.reference_book_ids = list(payload.reference_book_ids)
    if payload.folder_ids is not None:
        draft.folder_ids = list(payload.folder_ids)
    if data.get("external") is not None:
        draft.external = data["external"]
    if "signer_manager_id" in data:
        draft.signer_manager_id = data["signer_manager_id"]
    if data.get("addressees") is not None:
        draft.addressees = [
            {key: value for key, value in a.items() if value is not None}
            for a in data["addressees"]
        ]
    if "tab" in data:
        draft.tab = data["tab"]
    if data.get("grade") is not None:
        _set_grade(db, user, draft, data["grade"])
    if "importance" in data:
        draft.importance = data["importance"]
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
    if not any(a.get("role") == "to" for a in draft.addressees):
        raise ValidationFailedError("DRAFT_TO_REQUIRED", "Choose at least one To addressee.")
    if draft.signer_manager_id is None:
        raise ValidationFailedError("DRAFT_SIGNER_REQUIRED", "Choose the signing manager.")
    _validate_signer(db, draft.signer_manager_id)
    addressees = _resolve_addressees(
        db, user, external=draft.external, grade=draft.grade, addressees=draft.addressees
    )
    # Clearance may have been withdrawn since the grade was chosen.
    book_service.require_grade_clearance(db, user, draft.grade)
    # Access may have changed since the draft was saved: re-check, then hold the
    # grade floor a classified reference sets (refused before any number is used).
    references = _validate_references(db, user, list(draft.reference_book_ids or []))
    folders = _validate_folders(db, user, list(draft.folder_ids or []))
    for target in references:
        book_link_service.require_grade_floor(db, None, draft.grade, target=target)

    classification = _CLASSIFICATION_BY_TAB[draft.tab]
    if db.get(BookCategory, CATEGORY_ID) is None:
        db.add(BookCategory(id=CATEGORY_ID, prefix=CATEGORY_ID))
        db.flush()
        # A new category is a new implicitly granted capability. Caps already
        # memoized on users in this session (the addressee check computes them
        # for every directory user) predate it and would now deny ``GS``.
        for mapped in list(db.identity_map.values()):
            if isinstance(mapped, User):
                mapped._effective_caps_cache = None
    book = Book(
        category_id=CATEGORY_ID,
        ref_number=classified_ref(draft.tab, serial),
        subject=subjects[0],
        grade=draft.grade,
        distribution=grades.NAMED,
        importance=draft.importance,
        external=draft.external,
        doc_manager_id=draft.signer_manager_id,
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
        fields={
            "date": datetime.now().strftime(PAPER_DATE_FORMAT),
            "tab": draft.tab,
            # Printed «نسخة إلى الملف:» names, as chosen at issue.
            **(
                {"_ledger_folders": [{"id": f.id, "name": f.name} for f in folders]}
                if folders
                else {}
            ),
        },
        paper_preset=draft.paper_preset,
        paper_layout=CURRENT_LAYOUT,
        trigger="initial",
        status="none",
        created_by_user_id=user.id,
    )
    db.add(version)
    db.flush()
    for addressee in addressees:
        addressee.book_id = book.id
    db.add_all(addressees)
    db.add_all(
        BookLink(
            book_id=book.id,
            target_book_id=target.id,
            kind="reference",
            attached=True,
            created_by_user_id=user.id,
        )
        for target in references
    )
    # The writer's own issued book is their outgoing side; the folders were
    # checked to be outgoing-box folders they may file into.
    for folder in folders:
        book_folder_service.stage_filing(db, user, book, folder)
    _open_sign_step(db, user, book, version)
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
            # Registered before copying: a copy that fails half-way still
            # leaves a partial file the caller must remove on rollback.
            copied.append(target)
            shutil.copy2(source, target)
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


def _open_sign_step(db: Session, writer: User, book: Book, version: BookVersion) -> None:
    manager = _validate_signer(db, book.doc_manager_id)
    if manager is None or manager.user_id is None:
        raise ValidationFailedError("DRAFT_SIGNER_REQUIRED", "Choose the signing manager.")
    for previous in version.approval_steps:
        book_service.retain_revision_access(db, version, previous)
    version.approval_steps.clear()
    version.approval_steps.append(
        BookApprovalStep(
            book_id=book.id,
            step_order=0,
            stage_label="Approve",
            assignee_user_id=manager.user_id,
            kind="approver",
            state="pending",
        )
    )
    book_service.capture_approval_context(
        db,
        book,
        version,
        submitted_by_user_id=writer.id,
        submitted_at=datetime.now(UTC),
    )
    book_service._recompute_approval_state(book)


def _signer_read(db: Session, manager_id: int | None) -> LedgerSignerRead | None:
    manager = db.get(Manager, manager_id) if manager_id is not None else None
    if manager is None or manager.user_id is None:
        return None
    return LedgerSignerRead(
        manager_id=manager.id,
        user_id=manager.user_id,
        name=manager.name_en or manager.name_ar or "",
        name_ar=manager.name_ar,
        title=manager.title,
    )


def _addressees_read(db: Session, book: Book) -> list[LedgerAddresseeRead]:
    rows = list(
        db.scalars(
            select(BookAddressee)
            .where(BookAddressee.book_id == book.id)
            .order_by(BookAddressee.position)
        )
    )
    users = {
        u.id: u
        for u in db.scalars(select(User).where(User.id.in_([r.user_id for r in rows if r.user_id])))
    }
    return [
        LedgerAddresseeRead(
            role=r.role,
            user_id=r.user_id,
            contact_id=r.contact_id,
            name=r.name_en or r.name_ar or "",
            name_ar=r.name_ar,
            email=r.email,
            g_number=users[r.user_id].employee_id if r.user_id in users else None,
        )
        for r in rows
    ]


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
    pending = next(
        (s for s in latest.approval_steps if s.state == "pending" and s.kind == "approver"), None
    )
    actionable = (
        selected.id == latest.id
        and latest.signed_at is None
        and book.voided_at is None
        and book.deleted_at is None
    )
    writer = user.id == book.created_by_user_id
    assigned = actionable and pending is not None and pending.assignee_user_id == user.id
    return LedgerBookRead(
        id=book.id,
        ref_number=book.ref_number,
        grade=book.grade,
        importance=book.importance,
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
        external=book.external,
        addressees=_addressees_read(db, book),
        signer=(
            LedgerSignerRead.model_validate((selected.fields or {})["_ledger_signer"])
            if (selected.fields or {}).get("_ledger_signer") is not None
            else _signer_read(db, book.doc_manager_id)
        ),
        can_sign=assigned,
        can_return=assigned,
        can_change_signer=actionable and writer,
        can_resubmit=actionable and writer and pending is None,
        can_create_outlook_draft=writer
        and book.external
        and selected.signed_at is not None
        and selected.id == latest.id
        and book.voided_at is None
        and book.deleted_at is None,
        return_note=next((s.note for s in selected.approval_steps if s.state == "returned"), None),
        paper_preset=selected.paper_preset or "normal",
        references=_references_read(db, user, book),
        folders=[
            LedgerFolderRead.model_validate(item)
            for item in cast(list[object], (selected.fields or {}).get("_ledger_folders") or [])
        ],
    )


def _book_date(book: Book) -> date:
    """The issue date a reference prints: the paper date, else the record date."""
    latest = max(book.versions, key=lambda version: version.version_no, default=None)
    printed = (latest.fields or {}).get("date") if latest is not None else None
    if isinstance(printed, str):
        try:
            return datetime.strptime(printed, PAPER_DATE_FORMAT).date()
        except ValueError:
            pass
    return book.created_at.date()


def _references_read(db: Session, user: User, book: Book) -> list[LedgerReferenceRead]:
    """Outgoing references in the order chosen; ``can_open`` follows the viewer's access."""
    links = db.scalars(
        select(BookLink)
        .where(BookLink.book_id == book.id, BookLink.kind == "reference")
        .order_by(BookLink.id)
    )
    result = []
    for link in links:
        target = db.get(Book, link.target_book_id)
        if target is None:
            continue
        result.append(
            LedgerReferenceRead(
                book_id=target.id,
                ref=target.ref_number,
                date=_book_date(target),
                can_open=_can_open(db, user, target),
            )
        )
    return result


def _writer_name(db: Session, user_id: int | None) -> str | None:
    if user_id is None:
        return None
    return book_service.resolve_names_ar_by_ids(db, {user_id}).get(
        user_id
    ) or book_service.resolve_names_by_ids(db, {user_id}).get(user_id)


def draft_paper(db: Session, user: User, draft_id: int) -> str:
    """The owner's Draft as paper: DRAFT watermark, no reference, date or barcode."""
    draft = get_own_draft(db, user, draft_id)
    rows = _resolve_addressees(
        db, user, external=draft.external, grade=draft.grade, addressees=draft.addressees
    )
    signer = _signer_read(db, draft.signer_manager_id)
    # The writer chose these; ids that no longer resolve are left out.
    references = [
        target
        for target in (db.get(Book, book_id) for book_id in draft.reference_book_ids or [])
        if target is not None and target.deleted_at is None
    ]
    folders = [
        folder
        for folder in (db.get(BookFolder, folder_id) for folder_id in draft.folder_ids or [])
        if folder is not None
    ]
    return render_paper(
        PaperContext(
            body_html=draft.body_html,
            subjects=tuple(_clean_subjects(list(draft.subjects))),
            grade=draft.grade,
            ref=None,
            paper_date=None,
            draft_number=f"{draft.id:06d}",
            submitter_g_number=user.employee_id,
            viewer_g_number=user.employee_id,
            asset_base=PAPER_ASSET_BASE,
            to_names=tuple(r.name_ar or r.name_en or "" for r in rows if r.role == "to"),
            cc_names=tuple(r.name_ar or r.name_en or "" for r in rows if r.role == "cc"),
            signer_name=(signer.name_ar or signer.name) if signer else None,
            signer_title=signer.title if signer else None,
            preset=draft.paper_preset,
            layout=CURRENT_LAYOUT,
            writer_name=_writer_name(db, user.id),
            writer_g_number=user.employee_id,
            references=tuple((t.ref_number, _book_date(t)) for t in references),
            folder_names=tuple(folder.name for folder in folders),
        )
    )


def book_paper(db: Session, user: User, book_id: int, *, version_id: int | None = None) -> str:
    """One Revision as paper, under the same read access as the detail route."""
    read = ledger_book_read(db, user, book_id, version_id=version_id)
    book = get_ledger_book(db, book_id)
    paper_date = (
        datetime.strptime(read.paper_date, PAPER_DATE_FORMAT).date() if read.paper_date else None
    )
    version = next(v for v in book.versions if v.id == read.selected_version_id)
    return render_paper(
        PaperContext(
            body_html=read.body_html,
            subjects=tuple(read.subjects),
            grade=read.grade,
            ref=read.ref_number,
            paper_date=paper_date,
            draft_number=None,
            submitter_g_number=book_service.submitter_g_number(db, book),
            viewer_g_number=user.employee_id,
            asset_base=PAPER_ASSET_BASE,
            to_names=tuple(a.name_ar or a.name for a in read.addressees if a.role == "to"),
            cc_names=tuple(a.name_ar or a.name for a in read.addressees if a.role == "cc"),
            signer_name=(read.signer.name_ar or read.signer.name) if read.signer else None,
            signer_title=read.signer.title if read.signer else None,
            signature_src=(
                f"/api/v1/ledger/books/{book.id}/signature?revision={read.selected_version_id}"
                if version.signed_at is not None
                else None
            ),
            preset=read.paper_preset,
            layout=version.paper_layout or CURRENT_LAYOUT,
            writer_name=_writer_name(db, book.created_by_user_id),
            writer_g_number=book_service.submitter_g_number(db, book),
            # A reference the viewer cannot open still prints the ref the writer chose.
            references=tuple((r.ref, r.date) for r in read.references),
            folder_names=tuple(folder.name for folder in read.folders),
        )
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
            **{k: v for k, v in (latest.fields or {}).items() if k == "_ledger_folders"},
        },
        # Issued books do not change: the correction keeps the preset and layout.
        paper_preset=latest.paper_preset,
        paper_layout=latest.paper_layout,
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


def _pending_assignee(
    db: Session,
    user: User,
    book_id: int,
) -> tuple[Book, BookVersion, BookApprovalStep]:
    begin_immediate_if_idle(db)
    book = get_ledger_book(db, book_id)
    db.refresh(book)
    book_service.resolve_book_read_access(db, user, book)
    if book.deleted_at is not None or book.voided_at is not None:
        raise AppError("BOOK_VOIDED", "This record is no longer actionable.", http_status=409)
    version = _versions(book)[-1]
    book_service.require_ledger_revision_unlocked(db, book)
    step = next(
        (s for s in version.approval_steps if s.kind == "approver" and s.state == "pending"), None
    )
    if step is None or step.assignee_user_id != user.id:
        raise AppError("FORBIDDEN", "Only the assigned signing manager may act.", http_status=403)
    return book, version, step


def _revision_signature_file(book_id: int, version_id: int) -> Path:
    return (
        get_settings().data_dir
        / "book_attachments"
        / str(book_id)
        / "signatures"
        / f"{version_id}.png"
    )


def signature_path(db: Session, user: User, book_id: int, revision: int | None) -> Path:
    book = get_ledger_book(db, book_id)
    access = book_service.resolve_book_read_access(db, user, book, version_id=revision)
    version = next((v for v in book.versions if v.id == access.selected_version_id), None)
    if version is None or version.signed_at is None or version.signed_by_user_id is None:
        raise NotFoundError("SIGNATURE_NOT_FOUND", "This Revision has not been signed.")
    path = _revision_signature_file(book.id, version.id)
    if not path.is_file():
        raise NotFoundError("SIGNATURE_NOT_FOUND", "Signature image not found.")
    return path


def sign(db: Session, user: User, book_id: int) -> LedgerBookRead:
    """Lock the Revision and stage internal deliveries in one transaction."""
    target: Path | None = None
    try:
        book, version, step = _pending_assignee(db, user, book_id)
        source = user_signature_service.resolve_signature(user)
        if source is None:
            raise ValidationFailedError("NO_SIGNATURE", "Save your own signature before signing.")
        target = _revision_signature_file(book.id, version.id)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
        writer = db.get(User, book.created_by_user_id)
        if writer is None:
            raise NotFoundError("USER_NOT_FOUND", "Writer not found.")
        deliveries: list[BookRecipient] = []
        if not book.external:
            for role, purpose in _DELIVERY_PURPOSES:
                ids = [
                    a.user_id
                    for a in _addressees_read(db, book)
                    if a.role == role and a.user_id is not None
                ]
                # A correction does not redeliver an already-addressed record,
                # including sends that were subsequently recalled.
                existing = set(
                    db.scalars(
                        select(BookRecipient.user_id).where(BookRecipient.book_id == book.id)
                    )
                )
                rows, _ = book_send_service.prepare_delivery(
                    db,
                    writer,
                    book,
                    user_ids=[uid for uid in ids if uid not in existing],
                    purpose=purpose,
                    note=None,
                )
                deliveries.extend(rows)
        version.signed_at = datetime.now(UTC).replace(tzinfo=None)
        version.signed_by_user_id = user.id
        signer = _signer_read(db, book.doc_manager_id)
        version.fields = {
            **(version.fields or {}),
            "_ledger_signer": signer.model_dump() if signer else None,
        }
        step.state = "approved"
        step.decided_at = version.signed_at
        book_service.retain_revision_access(db, version, step)
        book_service._recompute_approval_state(book)
        _audit(db, user, "ledger_book_signed", book, {"version_id": version.id})
        db.commit()
    except BaseException:
        db.rollback()
        if target is not None:
            target.unlink(missing_ok=True)
        raise
    book_send_service._push_new(db, book, deliveries, writer)
    return ledger_book_read(db, user, book.id)


def return_book(db: Session, user: User, book_id: int, note: str) -> LedgerBookRead:
    try:
        book, version, step = _pending_assignee(db, user, book_id)
        if not note.strip():
            raise ValidationFailedError(
                "REASON_REQUIRED", "A nonblank reason is required to return."
            )
        step.state = "returned"
        step.note = note.strip()
        step.decided_at = datetime.now(UTC).replace(tzinfo=None)
        book_service.retain_revision_access(db, version, step)
        book_service._recompute_approval_state(book)
        _audit(
            db, user, "ledger_book_returned", book, {"version_id": version.id, "note": step.note}
        )
        db.commit()
    except BaseException:
        db.rollback()
        raise
    return ledger_book_read(db, user, book.id)


def resubmit(db: Session, user: User, book_id: int) -> LedgerBookRead:
    """Submit a returned Revision or a fresh, edited correction; same reference."""
    try:
        begin_immediate_if_idle(db)
        book = get_ledger_book(db, book_id)
        db.refresh(book)
        _require_creator_write(db, user, book)
        book_service.require_ledger_revision_unlocked(db, book)
        version = _versions(book)[-1]
        if any(s.state == "pending" for s in version.approval_steps):
            raise AppError(
                "NO_PENDING_STEP", "This Revision is already awaiting signature.", http_status=409
            )
        _open_sign_step(db, user, book, version)
        _audit(db, user, "ledger_book_resubmitted", book, {"version_id": version.id})
        db.commit()
    except BaseException:
        db.rollback()
        raise
    return ledger_book_read(db, user, book.id)


def change_signer(db: Session, user: User, book_id: int, manager_id: int) -> LedgerBookRead:
    try:
        begin_immediate_if_idle(db)
        book = get_ledger_book(db, book_id)
        db.refresh(book)
        _require_creator_write(db, user, book)
        book_service.require_ledger_revision_unlocked(db, book)
        manager = _validate_signer(db, manager_id)
        assert manager is not None and manager.user_id is not None
        previous_id = book.doc_manager_id
        book.doc_manager_id = manager.id
        version = _versions(book)[-1]
        for step in version.approval_steps:
            if step.kind == "approver" and step.state == "pending":
                step.assignee_user_id = manager.user_id
                step.seen_at = None
        context = dict(version.approval_context or {})
        context.update(
            doc_manager_user_id=manager.user_id,
            doc_manager_name=manager.name_en,
            doc_manager_name_ar=manager.name_ar,
        )
        version.approval_context = context
        _audit(
            db,
            user,
            "ledger_book_signer_changed",
            book,
            {"previous_manager_id": previous_id, "manager_id": manager.id},
        )
        db.commit()
    except BaseException:
        db.rollback()
        raise
    return ledger_book_read(db, user, book.id)


def _local_assets(paper: str, image_prefix: str, image_path: Callable[[str], Path]) -> str:
    """Resolve assets and body images to local files; headless Edge has no login session."""
    assets = Path(__file__).resolve().parents[1] / "core" / "ledger_paper_assets"
    paper = paper.replace(PAPER_ASSET_BASE, assets.as_uri())
    image_pattern = re.compile(re.escape(image_prefix) + r"([0-9a-f]{32}\.(?:png|jpg|gif|webp))")
    paper = image_pattern.sub(lambda match: image_path(match.group(1)).resolve().as_uri(), paper)
    csp = "default-src 'none'; img-src file: data:; font-src file: data:; style-src 'unsafe-inline'"
    return paper.replace(
        "<head>", f'<head><meta http-equiv="Content-Security-Policy" content="{csp}">', 1
    )


def _pdf_paper(db: Session, user: User, book: Book, version_id: int) -> str:
    """One Revision's paper, ready for headless Edge (signature only once signed)."""
    paper = book_paper(db, user, book.id, version_id=version_id)
    version = next(v for v in book.versions if v.id == version_id)
    if version.signed_at is not None:
        signature_url = f"/api/v1/ledger/books/{book.id}/signature?revision={version_id}"
        paper = paper.replace(
            signature_url, signature_path(db, user, book.id, version_id).resolve().as_uri()
        )
    return _local_assets(
        paper,
        book_image_prefix(book.id),
        lambda name: book_image_path(db, user, book.id, name),
    )


def book_pdf(db: Session, user: User, book_id: int, *, version_id: int | None = None) -> bytes:
    """The preview PDF of one Revision, under the paper's read access."""
    read = ledger_book_read(db, user, book_id, version_id=version_id)
    book = get_ledger_book(db, book_id)
    return sheet_pdf_service.print_document(_pdf_paper(db, user, book, read.selected_version_id))


def draft_pdf(db: Session, user: User, draft_id: int) -> bytes:
    """The owner's Draft preview PDF."""
    paper = draft_paper(db, user, draft_id)
    return sheet_pdf_service.print_document(
        _local_assets(
            paper,
            draft_image_prefix(draft_id),
            lambda name: draft_image_path(db, user, draft_id, name),
        )
    )


def create_outlook_draft(db: Session, user: User, book_id: int) -> LedgerOutlookDraftRead:
    book = get_ledger_book(db, book_id)
    _require_creator_write(db, user, book)
    version = _versions(book)[-1]
    if not book.external or version.signed_at is None:
        raise AppError(
            "REVISION_NOT_SIGNED",
            "Only signed external books can create Outlook drafts.",
            http_status=409,
        )
    read = ledger_book_read(db, user, book.id)
    pdf = sheet_pdf_service.print_document(_pdf_paper(db, user, book, version.id))
    try:
        entry = email_service.draft_outgoing(
            db,
            owner_user_id=user.id,
            to=[a.email for a in read.addressees if a.role == "to" and a.email],
            cc=[a.email for a in read.addressees if a.role == "cc" and a.email],
            subject=f"{book.ref_number} — {read.subjects[0]}",
            html="",
            mode="draft",
            related_book_id=book.id,
            related_employee_id=None,
            in_reply_to=None,
            references=None,
            use_signature=False,
            attachments=[(book.ref_number.replace("/", "_") + ".pdf", "application/pdf", pdf)],
        )
    except email_service.HandoffValidationError as exc:
        raise AppError("HTTP_400", str(exc), http_status=400) from exc
    except email_service.HandoffDeliveryError as exc:
        raise AppError("HTTP_502", str(exc), http_status=502) from exc
    return LedgerOutlookDraftRead(id=entry.id)
