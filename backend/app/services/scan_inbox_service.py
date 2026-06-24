"""The ambient Scan Inbox service — enqueue, drain (OCR + route), file-actions.

Triggers (Phase 1: email attachments) insert ``pending_ocr`` rows via
``enqueue_email_attachment``. A background drain job calls ``drain_pending``,
which OCRs each file behind the shared OCR gate, asks ``scan_triage_service`` for
a decision, and either auto-files (reversible attach) or parks the row for the
operator. ``confirm``/``route_item``/``dismiss``/``undo`` are the operator actions.
"""

from __future__ import annotations

import hashlib
import logging
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.errors import NotFoundError, ValidationFailedError
from app.config import get_settings
from app.core.extraction import ocr
from app.core.extraction.dates import parse_date
from app.db.models import Employee, ScanInbox, User
from app.services import book_service, scan_triage_service, vault_service

log = logging.getLogger(__name__)

SCANNABLE_EXTS = frozenset({".pdf", ".png", ".jpg", ".jpeg", ".tif", ".tiff", ".webp", ".bmp", ".heic"})
MAX_OCR_ATTEMPTS = 3
_MODEL_VERSION = "tesseract-v1"

# doctype → vault kind for an employee-doc auto/confirm file.
_VAULT_KIND = {"emirates_id": "uae_id", "passport": "passport", "bank_iban": "other"}
# doctype → which employee expiry column the extracted "expiry" feeds.
_EXPIRY_ATTR = {"emirates_id": "uae_id_expiry", "passport": "passport_expiry"}


def _utcnow() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _abs(rel_path: str) -> Path:
    return (get_settings().data_dir.resolve() / rel_path).resolve()


# ─────────────────────────── enqueue (trigger faucet) ───────────────────────────

def enqueue_email_attachment(
    db: Session,
    *,
    ledger_entry_id: int | None,
    owner_user_id: int | None,
    rel_path: str,
    filename: str,
    data: bytes,
    is_inline: bool,
) -> ScanInbox | None:
    """Insert a ``pending_ocr`` row for one email attachment, or return None if it
    shouldn't be scanned (inline signature image, non-document extension, or a
    duplicate already queued). Does NOT OCR — that's the drain's job."""
    if is_inline:
        return None
    if Path(filename).suffix.lower() not in SCANNABLE_EXTS:
        return None
    content_hash = hashlib.sha256(data).hexdigest()
    dup = db.execute(
        select(ScanInbox.id).where(ScanInbox.content_hash == content_hash).limit(1)
    ).first()
    if dup is not None:
        return None
    row = ScanInbox(
        source="email_attachment",
        owner_user_id=owner_user_id,
        ledger_entry_id=ledger_entry_id,
        file_path=rel_path,
        filename=filename,
        content_hash=content_hash,
        state="pending_ocr",
    )
    db.add(row)
    db.flush()  # caller commits within its own transaction
    return row


# ─────────────────────────────── drain (OCR + route) ───────────────────────────

def drain_pending(db: Session, *, limit: int = 20) -> int:
    """OCR + route a batch of ``pending_ocr`` rows. Returns the number processed."""
    rows = list(
        db.execute(
            select(ScanInbox)
            .where(ScanInbox.state == "pending_ocr")
            .where(ScanInbox.attempts < MAX_OCR_ATTEMPTS)
            .order_by(ScanInbox.id)
            .limit(limit)
        ).scalars()
    )
    for item in rows:
        _process_one(db, item)
    return len(rows)


def _process_one(db: Session, item: ScanInbox) -> None:
    item.attempts += 1
    abs_path = _abs(item.file_path)
    try:
        raw = abs_path.read_bytes()
    except OSError:
        item.state = "error"
        item.error_detail = "file missing on disk"
        db.commit()
        return

    with ocr.OCR_GATE:
        qr_refs = ocr.qr_refs_from_bytes(raw)
        try:
            text = ocr.ocr_bytes_to_text(raw)
        except ocr.OcrUnavailableError:
            if not qr_refs:
                # OCR down + nothing to go on: leave pending for retry; cap to error.
                if item.attempts >= MAX_OCR_ATTEMPTS:
                    item.state = "error"
                    item.error_detail = "OCR unavailable"
                db.commit()
                return
            text = ""
        except ocr.InvalidImageError as exc:
            item.state = "error"
            item.error_detail = str(exc)[:512]
            db.commit()
            return

    employees = list(db.execute(select(Employee)).scalars())
    decision = scan_triage_service.route(
        ocr_text=text, qr_refs=qr_refs, db=db, employees=employees  # type: ignore[arg-type]
    )
    item.document_type = decision.document_type
    item.fields = decision.fields or {}
    item.raw_text = text
    item.confidence = decision.confidence
    item.qr_refs = qr_refs
    item.proposed_route = decision.proposed_route
    item.proposed_book_id = decision.proposed_book_id
    item.proposed_ref = decision.proposed_ref
    item.proposed_employee_id = decision.proposed_employee_id
    item.match_score = decision.match_score
    item.confidence_tier = decision.tier
    item.model_version = _MODEL_VERSION

    if decision.tier == "auto":
        try:
            _apply_file(db, item, user=None, require_undoable=True)
            item.state = "auto_filed"
            item.resolution = "auto_filed"
            item.resolved_at = _utcnow()
        except Exception as exc:  # auto-file failed → fall back to confirm
            log.warning("scan-inbox auto-file failed for %d: %s", item.id, exc)
            item.state = "awaiting_confirmation"
            item.error_detail = str(exc)[:512]
    elif decision.tier == "confirm":
        item.state = "awaiting_confirmation"
    else:
        item.state = "unrouted"
    db.commit()


# ─────────────────────────────── file actions ──────────────────────────────────

def _apply_file(
    db: Session, item: ScanInbox, *, user: User | None, require_undoable: bool = False
) -> None:
    """Perform the reversible attach for ``item`` and stash an undo token.

    ``require_undoable=True`` is set by the AUTO drain path: every auto-filed item
    must carry an undo token so the operator can reverse it.  The OPERATOR paths
    (confirm / route_item) pass the default ``False`` because the operator is
    explicitly authorising the action — a scan-back flip (awaiting_scan book) is a
    valid, intended outcome there even though it isn't undoable via detach_attachment.
    """
    raw = _abs(item.file_path).read_bytes()
    if item.proposed_route == "book_attach" and item.proposed_book_id is not None:
        book = book_service.add_attachment(db, item.proposed_book_id, item.filename, raw, user=user)
        if book.attachment_paths:
            # Plain-append success path: a new path was added, so we can undo it.
            item.undo_token = f"book:{item.proposed_book_id}:{book.attachment_paths[-1]}"
        else:
            # add_attachment took the scan-back flip branch (awaiting_scan book):
            # it wrote to signed_pdf_path / flipped approval_state → "approved" and
            # committed.  attachment_paths is unchanged, so there is no detach-based
            # undo path.
            #
            # AUTO path: the triage engine is supposed to route awaiting_scan books
            # to tier="confirm", not "auto".  If one slipped through, refuse it here
            # so _process_one's except falls back to awaiting_confirmation rather than
            # silently producing an un-undoable auto_filed item.
            #
            # OPERATOR path (confirm / route_item): the flip IS the intended,
            # operator-authorised outcome.  Accept it and clear the token (a flip is
            # not reversible via detach_attachment, and that is fine).
            if require_undoable:
                raise ValidationFailedError(
                    "SCAN_BOOK_ATTACH_FAILED",
                    "Book attachment did not append a path (awaiting-scan book?)",
                )
            item.undo_token = None  # flip succeeded; operator path — not undoable
    elif item.proposed_route == "employee_doc" and item.proposed_employee_id is not None:
        kind = _VAULT_KIND.get(item.document_type or "", "other")
        vf = vault_service.import_bytes(
            db, employee_id=item.proposed_employee_id, kind=kind,
            filename=item.filename, data=raw,
        )
        item.undo_token = f"vault:{vf.id}"
        _capture_expiry(db, item)
    else:
        raise ValidationFailedError("SCAN_NO_ROUTE", "No fileable route for this item")


def _capture_expiry(db: Session, item: ScanInbox) -> None:
    """Feed an extracted ID/passport expiry into the employee's expiry column."""
    attr = _EXPIRY_ATTR.get(item.document_type or "")
    raw_value = (item.fields or {}).get("expiry")
    if not attr or not raw_value or item.proposed_employee_id is None:
        return
    parsed = parse_date(raw_value)
    if parsed is None:
        return
    emp = db.get(Employee, item.proposed_employee_id)
    if emp is not None:
        setattr(emp, attr, parsed)
        db.flush()  # caller commits atomically; don't prematurely commit mid-_apply_file


def _check_owner(item: ScanInbox, user: User | None) -> None:
    """Raise NotFoundError (not Forbidden) if ``user`` does not own ``item``.

    Items with ``owner_user_id is None`` are accessible to all
    (system-generated items have no owner).  Raising NotFound avoids
    leaking the existence of other users' items.
    """
    if item.owner_user_id is not None and item.owner_user_id != getattr(user, "id", None):
        raise NotFoundError("SCAN_ITEM_NOT_FOUND", f"No scan-inbox item {item.id}")


def confirm(db: Session, item_id: int, *, user: User | None) -> ScanInbox:
    """Accept the proposed destination and file it."""
    item = _get(db, item_id)
    _check_owner(item, user)
    if item.state not in {"awaiting_confirmation", "unrouted"}:
        raise ValidationFailedError("SCAN_BAD_STATE", f"Cannot confirm in state {item.state}")
    _apply_file(db, item, user=user)
    _resolve(item, user, "filed")
    item.state = "filed"
    db.commit()
    return item


def route_item(
    db: Session, item_id: int, *, user: User | None, employee_id: str | None = None, book_id: int | None = None
) -> ScanInbox:
    """Operator overrides the destination, then files."""
    item = _get(db, item_id)
    _check_owner(item, user)
    if item.state not in {"awaiting_confirmation", "unrouted"}:
        raise ValidationFailedError("SCAN_BAD_STATE", f"Cannot route in state {item.state}")
    if book_id is not None:
        item.proposed_route = "book_attach"
        item.proposed_book_id = book_id
    elif employee_id is not None:
        item.proposed_route = "employee_doc"
        item.proposed_employee_id = employee_id
    else:
        raise ValidationFailedError("SCAN_NO_TARGET", "Provide employee_id or book_id")
    _apply_file(db, item, user=user)
    _resolve(item, user, "filed")
    item.state = "filed"
    db.commit()
    return item


def dismiss(db: Session, item_id: int, *, user: User | None) -> ScanInbox:
    item = _get(db, item_id)
    _check_owner(item, user)
    _resolve(item, user, "dismissed")
    item.state = "dismissed"
    db.commit()
    return item


def undo(db: Session, item_id: int, *, user: User | None) -> ScanInbox:
    """Reverse an auto_filed attach using the undo token.

    ``filed`` (operator-confirmed) is a terminal state and cannot be undone.
    Only ``auto_filed`` (reversible background action) is eligible.
    """
    item = _get(db, item_id)
    _check_owner(item, user)
    if item.state not in {"auto_filed"}:
        raise ValidationFailedError("SCAN_BAD_STATE", f"Cannot undo in state {item.state}")
    token = item.undo_token or ""
    if token.startswith("book:"):
        _, book_id, rel = token.split(":", 2)
        book_service.detach_attachment(db, int(book_id), rel)
    elif token.startswith("vault:"):
        _, vf_id = token.split(":", 1)
        vault_service.delete_vault_file(db, int(vf_id))
    item.state = "awaiting_confirmation"
    item.undo_token = None
    item.resolution = None
    item.resolved_at = None
    item.resolved_by = None
    db.commit()
    return item


# ──────────────────────────────── queries ──────────────────────────────────────

def list_items(db: Session, *, owner_user_id: int | None, state: str | None = None) -> list[ScanInbox]:
    stmt = select(ScanInbox).order_by(ScanInbox.created_at.desc())
    if owner_user_id is not None:
        stmt = stmt.where(ScanInbox.owner_user_id == owner_user_id)
    if state is not None:
        stmt = stmt.where(ScanInbox.state == state)
    else:
        stmt = stmt.where(ScanInbox.state.in_(["awaiting_confirmation", "unrouted", "auto_filed", "error"]))
    return list(db.execute(stmt).scalars())


def counts(db: Session, *, owner_user_id: int | None) -> dict[str, int]:
    out: dict[str, int] = {"awaiting_confirmation": 0, "unrouted": 0}
    stmt = select(ScanInbox.state).where(
        ScanInbox.state.in_(["awaiting_confirmation", "unrouted"])
    )
    if owner_user_id is not None:
        stmt = stmt.where(ScanInbox.owner_user_id == owner_user_id)
    for (st,) in db.execute(stmt).all():
        out[st] = out.get(st, 0) + 1
    out["total"] = out["awaiting_confirmation"] + out["unrouted"]
    return out


# ──────────────────────────────── helpers ──────────────────────────────────────

def _get(db: Session, item_id: int) -> ScanInbox:
    item = db.get(ScanInbox, item_id)
    if item is None:
        raise NotFoundError("SCAN_ITEM_NOT_FOUND", f"No scan-inbox item {item_id}")
    return item


def _resolve(item: ScanInbox, user: User | None, resolution: str) -> None:
    item.resolution = resolution
    item.resolved_at = _utcnow()
    item.resolved_by = getattr(user, "id", None)


__all__ = [
    "MAX_OCR_ATTEMPTS",
    "SCANNABLE_EXTS",
    "confirm",
    "counts",
    "dismiss",
    "drain_pending",
    "enqueue_email_attachment",
    "list_items",
    "route_item",
    "undo",
]
