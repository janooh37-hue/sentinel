"""Ledger entry service — Phase 07.

Provides create/read/update/soft-delete for LedgerEntry rows, plus a
counterparty autocomplete helper.

Design notes:
- Attachment files live under ``data/ledger_attachments/<entry_id>/``.
  They are NOT routed through the employee Vault layer because ledger entries
  are not employee-scoped; the same security primitives (filename sanitisation,
  size cap, containment check) are applied inline.
- ``attachment_paths`` on the model is a JSON list of relative paths
  (relative to ``data/``), e.g. ``"ledger_attachments/42/report.pdf"``.
- ``q`` search is simple SQLite ``LIKE %q%`` — Phase 14 upgrades to FTS5.
- Tags are a JSON column (``list[str]``). Phase 12 wraps with autocomplete.
"""

from __future__ import annotations

import hashlib
import logging
import re
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sqlalchemy import ColumnElement, func, or_, select
from sqlalchemy.orm import Session

from app.api.errors import AppError, NotFoundError, ValidationFailedError
from app.config import get_settings
from app.core.constants import ALLOWED_DOC_EXTS
from app.db.models import Book, Employee, LedgerEntry
from app.schemas.ledger import DraftWrite, LedgerEntryCreate, LedgerEntryUpdate

log = logging.getLogger(__name__)

LIST_DEFAULT_LIMIT = 100
LIST_MAX_LIMIT = 500

MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024  # 25 MiB — matches vault_service

# Filename sanitiser — same rule-set as vault_service._safe_filename.
_UNSAFE_CHARS = re.compile(
    # Path separators / control chars PLUS unicode bidi-control, zero-width
    # and BOM codepoints that pass ``isalnum`` but enable display-name
    # spoofing (e.g. U+202E RIGHT-TO-LEFT OVERRIDE in a filename).
    "[\\/:*?\"<>|\x00-\x1f"
    "\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]"
)

# Subject normaliser — strips Re:/Fwd:/رد:/توجيه: prefixes so thread lookup
# can match conversation participants regardless of who replied last.
_REPLY_PREFIX = re.compile(
    r"^\s*(?:(?:re|fw|fwd|رد|توجيه|إعادة)\s*:\s*)+",
    flags=re.IGNORECASE,
)


def _normalize_subject(subject: str) -> str:
    cleaned = _REPLY_PREFIX.sub("", subject or "").strip()
    return cleaned.casefold()


DRAFT_TAG = "draft"


def _utcnow() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _safe_filename(raw: str) -> str:
    """Strip directory components and forbidden chars."""
    candidate = raw.replace("\\", "/").rsplit("/", 1)[-1]
    candidate = Path(candidate).name
    cleaned = _UNSAFE_CHARS.sub("_", candidate).strip(". ")
    if not cleaned:
        raise ValidationFailedError(
            "LEDGER_BAD_FILENAME", "Filename is empty or invalid", raw=raw
        )
    return cleaned


def _attachment_dir(entry_id: int) -> Path:
    """Absolute path to the attachment folder for one entry."""
    return get_settings().data_dir / "ledger_attachments" / str(entry_id)


def resolve_attachment_path(relative_path: str) -> Path | None:
    """Resolve a stored attachment path (relative to ``data_dir``) to an
    absolute path on disk, with the usual containment check. Returns
    ``None`` when the resolved path is missing or escapes the data dir."""
    data_dir = get_settings().data_dir.resolve()
    candidate = (data_dir / relative_path).resolve()
    if data_dir not in candidate.parents and candidate != data_dir:
        return None
    if not candidate.is_file():
        return None
    return candidate


_CID_REF_RE = re.compile(r"""cid:([^"'\s>)]+)""", re.IGNORECASE)


def derive_inline_map(
    notes_html: str | None,
    attachment_paths: list[str],
    stored_inline: dict[str, str] | None,
) -> dict[str, str]:
    """Map each ``cid:`` token in the body to the attachment path it references.

    An attachment is an inline/signature image iff its filename is referenced by
    a ``cid:`` URL in ``notes_html`` (Outlook's rule). Keyed by the body's exact
    token so the frontend can rewrite ``src="cid:token"``. Any persisted
    ``stored_inline`` entries are kept (and take precedence).
    """
    result: dict[str, str] = dict(stored_inline or {})
    if not notes_html:
        return result

    by_name: dict[str, str] = {}
    by_stem: dict[str, str] = {}
    for rel in attachment_paths:
        name = rel.rsplit("/", 1)[-1]
        by_name.setdefault(name.lower(), rel)
        by_stem.setdefault(name.rsplit(".", 1)[0].lower(), rel)

    for token in _CID_REF_RE.findall(notes_html):
        if token in result:
            continue
        head = token.split("@", 1)[0]  # "image001.png@host" -> "image001.png"
        candidate = (
            by_name.get(token.lower())
            or by_name.get(head.lower())
            or by_stem.get(head.rsplit(".", 1)[0].lower())
        )
        if candidate:
            result[token] = candidate
    return result


def non_inline_attachments(
    attachment_paths: list[str], inline_map: dict[str, str]
) -> list[str]:
    """Attachment paths that are NOT referenced as inline images."""
    inline = set(inline_map.values())
    return [p for p in attachment_paths if p not in inline]


def _collision_safe(target_dir: Path, filename: str) -> Path:
    """Append a short hash suffix if ``filename`` already exists."""
    dest = target_dir / filename
    if not dest.exists():
        return dest
    stem = Path(filename).stem
    suffix = Path(filename).suffix
    tag = hashlib.sha1(filename.encode(), usedforsecurity=False).hexdigest()[:6]
    return target_dir / f"{stem}_{tag}{suffix}"


# ---------------------------------------------------------------------------
# Read helpers
# ---------------------------------------------------------------------------


def _tags_contain(tag: str, *, negate: bool = False) -> Any:
    """SQL clause: the entry's ``tags`` JSON array contains *tag* exactly.

    Uses SQLite ``json_each`` for exact-array-membership so e.g. "draft" never
    matches "predraft" (a substring LIKE on the serialised JSON would). Pass
    ``negate=True`` for the complementary ``NOT EXISTS`` clause (raw ``text``
    clauses aren't invertible with ``~``).
    """
    from sqlalchemy import text

    # Distinct bindparam names so the positive filter and the draft exclusion
    # (both emitted on the same statement) don't collide and overwrite each other.
    keyword = "NOT EXISTS" if negate else "EXISTS"
    param = "ledger_no_tag" if negate else "ledger_tag"
    return text(
        f"{keyword} (SELECT 1 FROM json_each(ledger_entries.tags)"
        f" WHERE json_each.value = :{param})"
    ).bindparams(**{param: tag})


def list_entries(
    db: Session,
    *,
    from_date: Any | None = None,
    to_date: Any | None = None,
    since: Any | None = None,
    direction: str | None = None,
    channel: str | None = None,
    counterparty: str | None = None,
    q: str | None = None,
    tag: str | None = None,
    related_employee_id: str | None = None,
    related_book_id: int | None = None,
    has_attachment: bool | None = None,
    include_deleted: bool = False,
    include_drafts: bool = False,
    owner_user_id: int | None = None,
    limit: int = LIST_DEFAULT_LIMIT,
    offset: int = 0,
) -> tuple[list[LedgerEntry], int]:
    """Filtered + paginated list. Returns ``(rows, total_count)``."""
    limit = max(1, min(limit, LIST_MAX_LIMIT))
    offset = max(0, offset)

    stmt = select(LedgerEntry)
    count_stmt = select(func.count()).select_from(LedgerEntry)

    if not include_deleted:
        stmt = stmt.where(LedgerEntry.deleted_at.is_(None))
        count_stmt = count_stmt.where(LedgerEntry.deleted_at.is_(None))

    if from_date is not None:
        stmt = stmt.where(LedgerEntry.entry_date >= from_date)
        count_stmt = count_stmt.where(LedgerEntry.entry_date >= from_date)

    if to_date is not None:
        stmt = stmt.where(LedgerEntry.entry_date <= to_date)
        count_stmt = count_stmt.where(LedgerEntry.entry_date <= to_date)

    if since is not None:
        stmt = stmt.where(LedgerEntry.entry_date >= since)
        count_stmt = count_stmt.where(LedgerEntry.entry_date >= since)

    if direction is not None:
        # The Inbox asks for direction='incoming'. Mail where every party is on
        # the operator's own @gssg.ae domain is classified 'internal' by the sync
        # (email_service._is_internal) — surface it in the Inbox too, otherwise
        # intra-office mail is hidden from every folder. (We can't reliably tell
        # internal-sent from internal-received, so it all lands in the Inbox.)
        dir_clause: ColumnElement[bool]
        if direction == "incoming":
            dir_clause = LedgerEntry.direction.in_(("incoming", "internal"))
        else:
            dir_clause = LedgerEntry.direction == direction
        stmt = stmt.where(dir_clause)
        count_stmt = count_stmt.where(dir_clause)

    if channel is not None:
        stmt = stmt.where(LedgerEntry.channel == channel)
        count_stmt = count_stmt.where(LedgerEntry.channel == channel)

    if owner_user_id is not None:
        # Private inbox (Phase 6): an EMAIL row is visible only to its owner
        # (legacy null-owner email surfaces only via the admin scope=all path,
        # which passes owner_user_id=None here). Non-email rows (the shared
        # correspondence log) stay visible to everyone. Drafts are a subset of
        # the email rule (always owned), so the email clause already covers them.
        owner_clause = or_(
            LedgerEntry.channel != "email",
            LedgerEntry.owner_user_id == owner_user_id,
        )
        stmt = stmt.where(owner_clause)
        count_stmt = count_stmt.where(owner_clause)

    if counterparty is not None:
        needle = f"%{counterparty.strip()}%"
        stmt = stmt.where(LedgerEntry.counterparty.ilike(needle))
        count_stmt = count_stmt.where(LedgerEntry.counterparty.ilike(needle))

    if q:
        needle = f"%{q.strip()}%"
        clause = or_(
            LedgerEntry.subject.ilike(needle),
            LedgerEntry.notes_html.ilike(needle),
        )
        stmt = stmt.where(clause)
        count_stmt = count_stmt.where(clause)

    if tag is not None:
        # SQLite JSON: tags is a JSON array. Match exact array membership via
        # json_each so a tag like "draft" never matches "predraft" (a LIKE on
        # the raw JSON text would). EXISTS keeps the row when the value is present.
        tag_member = _tags_contain(tag)
        stmt = stmt.where(tag_member)
        count_stmt = count_stmt.where(tag_member)

    if not include_drafts and tag != DRAFT_TAG:
        no_draft = _tags_contain(DRAFT_TAG, negate=True)
        stmt = stmt.where(no_draft)
        count_stmt = count_stmt.where(no_draft)

    if related_employee_id is not None:
        stmt = stmt.where(LedgerEntry.related_employee_id == related_employee_id)
        count_stmt = count_stmt.where(LedgerEntry.related_employee_id == related_employee_id)

    if related_book_id is not None:
        stmt = stmt.where(LedgerEntry.related_book_id == related_book_id)
        count_stmt = count_stmt.where(LedgerEntry.related_book_id == related_book_id)

    if has_attachment is not None:
        # JSON column is stored as TEXT in SQLite; an empty list serialises
        # to "[]" with no spaces. Anything else means at least one element.
        from sqlalchemy import Text, cast

        text_repr = cast(LedgerEntry.attachment_paths, Text)
        if has_attachment:
            stmt = stmt.where(text_repr != "[]")
            count_stmt = count_stmt.where(text_repr != "[]")
        else:
            stmt = stmt.where(text_repr == "[]")
            count_stmt = count_stmt.where(text_repr == "[]")

    stmt = (
        stmt.order_by(LedgerEntry.entry_date.desc(), LedgerEntry.created_at.desc())
        .limit(limit)
        .offset(offset)
    )

    rows = list(db.execute(stmt).scalars().all())
    total = int(db.execute(count_stmt).scalar_one())
    return rows, total


def get_entry(
    db: Session,
    entry_id: int,
    *,
    include_deleted: bool = False,
    owner_user_id: int | None = None,
) -> LedgerEntry:
    row = db.get(LedgerEntry, entry_id)
    if row is None:
        raise NotFoundError(
            "LEDGER_ENTRY_NOT_FOUND",
            f"Ledger entry {entry_id} does not exist",
            id=entry_id,
        )
    if not include_deleted and row.deleted_at is not None:
        raise NotFoundError(
            "LEDGER_ENTRY_NOT_FOUND",
            f"Ledger entry {entry_id} has been deleted",
            id=entry_id,
        )
    if (
        owner_user_id is not None
        and row.channel == "email"
        and DRAFT_TAG in (row.tags or [])
        and row.owner_user_id != owner_user_id
    ):
        # Shared mailbox: synced/sent email opens for any signed-in user; only a
        # cross-owner DRAFT is a 404 (don't leak existence), not a 403.
        raise NotFoundError(
            "LEDGER_ENTRY_NOT_FOUND",
            f"Ledger entry {entry_id} does not exist",
            id=entry_id,
        )
    return row


def list_thread(
    db: Session,
    entry_id: int,
    *,
    limit: int = 50,
    owner_user_id: int | None = None,
) -> list[LedgerEntry]:
    """Return email entries that belong to the same conversation as ``entry_id``.

    "Same conversation" = email channel + same counterparty + same normalised
    subject (Re:/Fwd: prefixes stripped, case-folded). Returned oldest-first
    so the UI can render a chronological transcript.

    The seed entry is excluded from the result list. Soft-deleted entries
    are excluded.
    """
    from app.services.email_service import _first_address

    seed = get_entry(db, entry_id, owner_user_id=owner_user_id)
    if seed.channel != "email":
        return []

    target = _normalize_subject(seed.subject)
    if not target:
        return []

    # Normalise the seed counterparty to a bare address so "Name <addr>"
    # and "addr" both match the same thread participants.
    seed_addr = _first_address(seed.counterparty) or seed.counterparty

    stmt = (
        select(LedgerEntry)
        .where(
            LedgerEntry.deleted_at.is_(None),
            LedgerEntry.channel == "email",
            LedgerEntry.id != seed.id,
        )
        .order_by(LedgerEntry.entry_date.asc(), LedgerEntry.created_at.asc())
        .limit(limit * 4)  # over-fetch; Python-side filter trims to actual matches
    )
    if owner_user_id is not None:
        stmt = stmt.where(LedgerEntry.owner_user_id == owner_user_id)
    candidates = list(db.execute(stmt).scalars().all())
    matches = [
        r
        for r in candidates
        if _normalize_subject(r.subject) == target
        and (_first_address(r.counterparty) or r.counterparty) == seed_addr
    ]
    return matches[:limit]


# ---------------------------------------------------------------------------
# Write helpers
# ---------------------------------------------------------------------------


def _validate_fks(db: Session, payload_dict: dict[str, Any]) -> None:
    """Validate FK existence for related_book_id and related_employee_id."""
    book_id = payload_dict.get("related_book_id")
    if book_id is not None and db.get(Book, book_id) is None:
        raise NotFoundError(
            "BOOK_NOT_FOUND",
            f"Book {book_id} does not exist",
            related_book_id=book_id,
        )
    employee_id = payload_dict.get("related_employee_id")
    if employee_id is not None and db.get(Employee, employee_id) is None:
        raise NotFoundError(
            "EMPLOYEE_NOT_FOUND",
            f"Employee {employee_id!r} does not exist",
            related_employee_id=employee_id,
        )


def create_entry(
    db: Session,
    payload: LedgerEntryCreate,
    owner_user_id: int | None = None,
) -> LedgerEntry:
    data = payload.model_dump()
    _validate_fks(db, data)

    # Only email rows are owner-scoped (non-email = shared correspondence log).
    row_owner = (
        owner_user_id if (data.get("channel") or "").strip() == "email" else None
    )

    # Default created_by to the linked employee when caller didn't supply one.
    created_by = data.get("created_by")
    if not created_by:
        from app.db.models import EmailAccount

        account = db.execute(
            select(EmailAccount).where(EmailAccount.id == 1)
        ).scalar_one_or_none()
        if account is not None and account.linked_employee_id:
            created_by = account.linked_employee_id

    row = LedgerEntry(
        entry_date=data["entry_date"],
        direction=data["direction"],
        channel=data["channel"],
        counterparty=data["counterparty"],
        subject=data["subject"],
        notes_html=data.get("notes_html"),
        attachment_paths=[],
        tags=data.get("tags") or [],
        related_book_id=data.get("related_book_id"),
        related_employee_id=data.get("related_employee_id"),
        created_by=created_by,
        owner_user_id=row_owner,
        created_at=_utcnow(),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def update_entry(db: Session, entry_id: int, payload: LedgerEntryUpdate) -> LedgerEntry:
    row = get_entry(db, entry_id)
    data: dict[str, Any] = payload.model_dump(exclude_unset=True)
    _validate_fks(db, data)

    for k, v in data.items():
        setattr(row, k, v)
    row.updated_at = _utcnow()
    db.commit()
    db.refresh(row)
    return row


def soft_delete_entry(db: Session, entry_id: int) -> None:
    row = get_entry(db, entry_id)
    row.deleted_at = _utcnow()
    db.commit()


STAR_TAG = "starred"


def unread_email_count(db: Session, owner_user_id: int | None = None) -> int:
    """Count un-opened received emails — drives the numeric NavBell badge.

    Filter: channel='email', direction IN ('incoming','internal'), read_at IS
    NULL, not soft-deleted. Internal (intra-office) mail is treated as received,
    matching the Inbox (list_entries) — sent mail is born read (email_service),
    so this won't count internal-sent. Drafts are 'outgoing' so can't match.
    """
    stmt = select(func.count(LedgerEntry.id)).where(
        LedgerEntry.channel == "email",
        LedgerEntry.direction.in_(("incoming", "internal")),
        LedgerEntry.read_at.is_(None),
        LedgerEntry.deleted_at.is_(None),
    )
    if owner_user_id is not None:
        stmt = stmt.where(LedgerEntry.owner_user_id == owner_user_id)
    return int(db.execute(stmt).scalar_one())


def unread_email_ids(db: Session, owner_user_id: int | None = None) -> list[int]:
    """Ids behind ``unread_email_count`` (same filter) — for per-item push.

    Kept beside ``unread_email_count`` so the two never diverge.
    """
    stmt = select(LedgerEntry.id).where(
        LedgerEntry.channel == "email",
        LedgerEntry.direction.in_(("incoming", "internal")),
        LedgerEntry.read_at.is_(None),
        LedgerEntry.deleted_at.is_(None),
    )
    if owner_user_id is not None:
        stmt = stmt.where(LedgerEntry.owner_user_id == owner_user_id)
    return list(db.execute(stmt).scalars())


def mark_entry_read(
    db: Session, entry_id: int, owner_user_id: int | None = None
) -> LedgerEntry:
    """Idempotently set ``read_at`` to now if currently NULL.

    Calling twice is safe — second call is a no-op. Hard-deleted entries
    raise NotFoundError; soft-deleted ones do too (matches get_entry).
    """
    row = get_entry(db, entry_id, owner_user_id=owner_user_id)
    if row.read_at is None:
        row.read_at = _utcnow()
        db.commit()
        db.refresh(row)
    return row


def mark_all_emails_read(db: Session, owner_user_id: int | None = None) -> int:
    """Bulk-mark every unread received email as read. Returns rows updated.

    Scope mirrors ``unread_email_count``: incoming + internal (received) mail.
    """
    now = _utcnow()
    # Two-step: select ids first so we can return an accurate count even on
    # backends where UPDATE doesn't expose rowcount reliably through ORM.
    id_stmt = select(LedgerEntry.id).where(
        LedgerEntry.channel == "email",
        LedgerEntry.direction.in_(("incoming", "internal")),
        LedgerEntry.read_at.is_(None),
        LedgerEntry.deleted_at.is_(None),
    )
    if owner_user_id is not None:
        id_stmt = id_stmt.where(LedgerEntry.owner_user_id == owner_user_id)
    ids = list(db.execute(id_stmt).scalars())
    if not ids:
        return 0
    for row in db.execute(
        select(LedgerEntry).where(LedgerEntry.id.in_(ids))
    ).scalars():
        row.read_at = now
    db.commit()
    return len(ids)


def toggle_star(
    db: Session, entry_id: int, owner_user_id: int | None = None
) -> LedgerEntry:
    """Flip the ★ tag on ``entry_id``: add when absent, remove when present."""
    row = get_entry(db, entry_id, owner_user_id=owner_user_id)
    tags = list(row.tags or [])
    if STAR_TAG in tags:
        tags = [t for t in tags if t != STAR_TAG]
    else:
        tags.append(STAR_TAG)
    row.tags = tags
    row.updated_at = _utcnow()
    db.commit()
    db.refresh(row)
    return row


# ---------------------------------------------------------------------------
# Attachment helper
# ---------------------------------------------------------------------------


def add_attachment(
    db: Session,
    entry_id: int,
    *,
    data: bytes,
    original_filename: str,
) -> LedgerEntry:
    """Save ``data`` under ``data/ledger_attachments/<entry_id>/`` and update the row.

    Security: same rules as vault_service — filename sanitised, size capped,
    extension whitelisted, resolved path checked for containment.
    """
    row = get_entry(db, entry_id)

    if len(data) == 0:
        raise ValidationFailedError("LEDGER_EMPTY_FILE", "Uploaded file is empty")
    if len(data) > MAX_ATTACHMENT_BYTES:
        raise ValidationFailedError(
            "LEDGER_FILE_TOO_LARGE",
            f"File exceeds {MAX_ATTACHMENT_BYTES} bytes",
            max_bytes=MAX_ATTACHMENT_BYTES,
            size=len(data),
        )

    safe_name = _safe_filename(original_filename)
    ext = Path(safe_name).suffix.lower()
    if ext not in ALLOWED_DOC_EXTS:
        raise ValidationFailedError(
            "LEDGER_BAD_EXTENSION",
            f"File type {ext!r} is not allowed",
            allowed=sorted(ALLOWED_DOC_EXTS),
        )

    target_dir = _attachment_dir(entry_id)
    target_dir.mkdir(parents=True, exist_ok=True)
    dest = _collision_safe(target_dir, safe_name)

    # Containment check: dest must be under data_dir.
    data_dir = get_settings().data_dir.resolve()
    dest_resolved = dest.resolve()
    if data_dir not in dest_resolved.parents:
        raise AppError(
            "LEDGER_PATH_ESCAPE",
            "Resolved attachment path escaped the data directory",
            http_status=500,
        )

    dest.write_bytes(data)
    log.info("ledger attachment: entry=%d -> %s (%d bytes)", entry_id, dest.name, len(data))

    # Store relative path (relative to data_dir) for portability.
    rel_path = dest_resolved.relative_to(data_dir).as_posix()
    current_paths: list[str] = list(row.attachment_paths or [])
    current_paths.append(rel_path)
    row.attachment_paths = current_paths
    row.updated_at = _utcnow()
    db.commit()
    db.refresh(row)
    return row


# ---------------------------------------------------------------------------
# Counterparty autocomplete
# ---------------------------------------------------------------------------


def list_counterparties(
    db: Session,
    *,
    q: str | None = None,
    limit: int = 20,
) -> list[str]:
    """Return distinct counterparty values ordered by frequency desc then alpha.

    ``q`` filters with ``LIKE q%`` (prefix, for autocomplete).  Only active
    (non-deleted) entries are considered.
    """
    stmt = (
        select(
            LedgerEntry.counterparty,
            func.count(LedgerEntry.counterparty).label("freq"),
        )
        .where(LedgerEntry.deleted_at.is_(None))
        .group_by(LedgerEntry.counterparty)
    )

    if q:
        stmt = stmt.where(LedgerEntry.counterparty.ilike(f"{q.strip()}%"))

    stmt = stmt.order_by(
        func.count(LedgerEntry.counterparty).desc(),
        LedgerEntry.counterparty,
    ).limit(limit)

    rows = db.execute(stmt).all()
    return [r.counterparty for r in rows]


# ---------------------------------------------------------------------------
# Draft helpers — Phase 16
# ---------------------------------------------------------------------------


def _draft_meta_payload(payload: DraftWrite) -> dict[str, Any]:
    return {
        "to": list(payload.to),
        "cc": list(payload.cc),
        "in_reply_to": payload.in_reply_to,
        "references": payload.references,
        "use_signature": payload.use_signature,
    }


def _assert_is_draft(row: LedgerEntry) -> None:
    if DRAFT_TAG not in (row.tags or []):
        raise ValidationFailedError(
            "LEDGER_NOT_A_DRAFT",
            f"Ledger entry {row.id} is not a draft",
            id=row.id,
        )


def upsert_draft(
    db: Session,
    draft_id: int | None,
    payload: DraftWrite,
    author_employee_id: str | None = None,
    owner_user_id: int | None = None,
) -> LedgerEntry:
    """Create a new draft or update an existing one in place."""
    from datetime import date as _date

    primary_counterparty = (payload.to[0] if payload.to else "").strip()
    if not primary_counterparty:
        primary_counterparty = "(draft)"

    if draft_id is None:
        row = LedgerEntry(
            entry_date=_date.today(),
            direction="outgoing",
            channel="email",
            counterparty=primary_counterparty[:255],
            subject=(payload.subject or "(no subject)")[:255],
            notes_html=payload.html or "",
            attachment_paths=[],
            tags=[DRAFT_TAG],
            draft_meta=_draft_meta_payload(payload),
            created_at=_utcnow(),
            created_by=author_employee_id,
            owner_user_id=owner_user_id,
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        return row

    row = get_entry(db, draft_id, owner_user_id=owner_user_id)
    _assert_is_draft(row)
    row.counterparty = primary_counterparty[:255]
    row.subject = (payload.subject or "(no subject)")[:255]
    row.notes_html = payload.html or ""
    row.draft_meta = _draft_meta_payload(payload)
    row.updated_at = _utcnow()
    db.commit()
    db.refresh(row)
    return row


def delete_draft(db: Session, draft_id: int) -> None:
    """Hard-delete a draft row (drafts are never soft-deleted)."""
    row = get_entry(db, draft_id)
    _assert_is_draft(row)
    db.delete(row)
    db.commit()


def promote_draft_to_sent(db: Session, draft_id: int) -> LedgerEntry:
    """Send the draft via SMTP and remove the draft row.

    ``email_service.send_email`` writes a new outgoing ``LedgerEntry`` itself,
    so the cleanest contract here is: delete the draft, return the freshly-
    inserted sent entry. Caller never sees the draft id again.
    """
    from app.schemas.email import EmailSendRequest
    from app.services import email_service

    row = get_entry(db, draft_id)
    _assert_is_draft(row)

    meta = row.draft_meta or {}
    raw_to = meta.get("to") or []
    raw_cc = meta.get("cc") or []
    to_list = [s for s in (raw_to if isinstance(raw_to, list) else []) if isinstance(s, str) and s.strip()]
    cc_list = [s for s in (raw_cc if isinstance(raw_cc, list) else []) if isinstance(s, str) and s.strip()]
    if not to_list:
        raise ValidationFailedError(
            "LEDGER_DRAFT_NO_RECIPIENTS",
            "Draft has no recipients",
            id=draft_id,
        )

    in_reply_to = meta.get("in_reply_to")
    references = meta.get("references")
    use_signature = meta.get("use_signature")

    send_payload = EmailSendRequest(
        to=to_list,
        cc=cc_list,
        subject=row.subject,
        html=row.notes_html or "",
        in_reply_to=in_reply_to if isinstance(in_reply_to, str) else None,
        references=references if isinstance(references, str) else None,
        use_signature=bool(use_signature) if use_signature is not None else True,
    )

    owner_id = row.owner_user_id
    if owner_id is None:
        raise AppError(
            "LEDGER_DRAFT_NO_OWNER",
            "Draft has no owner; cannot determine which mailbox to send from",
            http_status=400,
        )
    result = email_service.send_email(db, send_payload, owner_user_id=owner_id)

    db.delete(row)
    db.commit()

    sent = db.get(LedgerEntry, result.ledger_entry_id)
    if sent is None:
        raise AppError(
            "LEDGER_SEND_LOST",
            "Send succeeded but the resulting ledger entry could not be loaded",
            http_status=500,
        )
    return sent


__all__ = [
    "DRAFT_TAG",
    "LIST_DEFAULT_LIMIT",
    "LIST_MAX_LIMIT",
    "MAX_ATTACHMENT_BYTES",
    "STAR_TAG",
    "add_attachment",
    "create_entry",
    "delete_draft",
    "derive_inline_map",
    "get_entry",
    "list_counterparties",
    "list_entries",
    "list_thread",
    "mark_all_emails_read",
    "mark_entry_read",
    "non_inline_attachments",
    "promote_draft_to_sent",
    "resolve_attachment_path",
    "soft_delete_entry",
    "toggle_star",
    "unread_email_count",
    "unread_email_ids",
    "update_entry",
    "upsert_draft",
]
