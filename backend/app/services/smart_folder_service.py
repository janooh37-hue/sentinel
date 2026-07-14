"""Smart-folder service — per-user saved subject filters over the Ledger.

A smart folder is a saved, per-user subject filter (no membership): selecting it
filters the ledger list by ``LOWER(subject) LIKE '%'||rule_value||'%'``. The
suggestion engine groups the caller's mail by ``core.subject.normalise_subject``
and offers clusters with ≥ ``SUGGEST_MIN_COUNT`` related emails that the caller
hasn't already turned into a folder or dismissed.

Owner scoping mirrors the private-inbox / Phase-A rules in ``ledger_service``:
only email rows with ``source_kind IS NULL`` owned by the caller are considered
(the old correspondence-log auto-log rows are excluded).
"""

from __future__ import annotations

from dataclasses import dataclass, field

from sqlalchemy import ColumnElement, and_, func, select
from sqlalchemy.orm import Session

from app.api.errors import ConflictError, NotFoundError
from app.core.subject import normalise_subject
from app.db.models import LedgerEntry, SmartFolder, SmartFolderDismissal
from app.schemas.smart_folder import SmartFolderCreate, SmartFolderUpdate
from app.services.ledger_service import DRAFT_TAG, _tags_contain, _utcnow

# A cluster needs at least this many related emails before it's suggested.
SUGGEST_MIN_COUNT = 5
# How many suggestions to return (top-N by count).
SUGGEST_TOP_N = 5
# How many sample subjects to attach to each suggestion.
SAMPLE_SUBJECTS = 3


@dataclass(frozen=True)
class Suggestion:
    cluster_key: str
    name_suggestion: str
    count: int
    correspondent_count: int
    sample_subjects: list[str]


@dataclass
class _Cluster:
    count: int = 0
    correspondents: set[str] = field(default_factory=set)
    samples: list[str] = field(default_factory=list)


def _owned_email_clause(owner_user_id: int) -> ColumnElement[bool]:
    """The Phase-A / private-inbox scope: the caller's own non-deleted,
    non-auto-log email rows (``source_kind IS NULL``)."""
    return and_(
        LedgerEntry.deleted_at.is_(None),
        LedgerEntry.channel == "email",
        LedgerEntry.owner_user_id == owner_user_id,
        LedgerEntry.source_kind.is_(None),
    )


# ---------------------------------------------------------------------------
# Suggestions
# ---------------------------------------------------------------------------


def suggest(db: Session, *, user_id: int) -> list[Suggestion]:
    """Top subject clusters in the caller's mailbox worth a folder.

    Groups the caller's non-draft, non-deleted email by normalised subject;
    keeps clusters with ``count >= SUGGEST_MIN_COUNT``; excludes any cluster
    already covered by one of the caller's active folders (same ``rule_value``)
    or dismissed by the caller. Returns the top ``SUGGEST_TOP_N`` by count.
    """
    from app.services.email_service import _first_address

    stmt = (
        select(LedgerEntry.subject, LedgerEntry.counterparty)
        .where(_owned_email_clause(user_id))
        .where(_tags_contain(DRAFT_TAG, negate=True))
    )
    rows = db.execute(stmt).all()

    # Group by normalised subject in Python (the normaliser is not SQL-able).
    clusters: dict[str, _Cluster] = {}
    for subject, counterparty in rows:
        key = normalise_subject(subject)
        if not key:
            continue
        bucket = clusters.setdefault(key, _Cluster())
        bucket.count += 1
        addr = _first_address(counterparty) or (counterparty or "")
        if addr:
            bucket.correspondents.add(addr)
        raw = (subject or "").strip()
        if raw and raw not in bucket.samples and len(bucket.samples) < SAMPLE_SUBJECTS:
            bucket.samples.append(raw)

    # Exclude clusters already covered by an active folder or dismissed.
    taken = _active_rule_values(db, user_id) | _dismissed_keys(db, user_id)

    suggestions: list[Suggestion] = []
    for key, bucket in clusters.items():
        if bucket.count < SUGGEST_MIN_COUNT or key in taken:
            continue
        suggestions.append(
            Suggestion(
                cluster_key=key,
                name_suggestion=(bucket.samples[0] if bucket.samples else key),
                count=bucket.count,
                correspondent_count=len(bucket.correspondents),
                sample_subjects=list(bucket.samples),
            )
        )

    # Top-N by count desc, then cluster_key for a stable order.
    suggestions.sort(key=lambda s: (-s.count, s.cluster_key))
    return suggestions[:SUGGEST_TOP_N]


def _active_rule_values(db: Session, user_id: int) -> set[str]:
    rows = db.execute(
        select(SmartFolder.rule_value).where(
            SmartFolder.owner_user_id == user_id,
            SmartFolder.deleted_at.is_(None),
        )
    ).scalars()
    return {r for r in rows}


def _dismissed_keys(db: Session, user_id: int) -> set[str]:
    rows = db.execute(
        select(SmartFolderDismissal.cluster_key).where(
            SmartFolderDismissal.owner_user_id == user_id
        )
    ).scalars()
    return {r for r in rows}


# ---------------------------------------------------------------------------
# Folders CRUD
# ---------------------------------------------------------------------------


def list_for(db: Session, user_id: int) -> list[SmartFolder]:
    """The caller's active (non-deleted) folders, oldest first."""
    return list(
        db.execute(
            select(SmartFolder)
            .where(
                SmartFolder.owner_user_id == user_id,
                SmartFolder.deleted_at.is_(None),
            )
            .order_by(SmartFolder.created_at.asc(), SmartFolder.id.asc())
        ).scalars()
    )


def get_owned(db: Session, *, folder_id: int, user_id: int) -> SmartFolder | None:
    """Fetch a caller-owned, non-deleted folder, or ``None``."""
    return db.execute(
        select(SmartFolder).where(
            SmartFolder.id == folder_id,
            SmartFolder.owner_user_id == user_id,
            SmartFolder.deleted_at.is_(None),
        )
    ).scalar_one_or_none()


def count_for(db: Session, *, folder: SmartFolder, user_id: int) -> int:
    """How many of the caller's mailbox entries the folder's filter matches.

    Mirrors the ``GET /ledger?smart_folder_id`` list filter: owner-scoped,
    non-deleted, non-auto-log, NON-DRAFT email whose subject contains the rule.
    """
    needle = f"%{folder.rule_value}%"
    stmt = (
        select(func.count(LedgerEntry.id))
        .where(_owned_email_clause(user_id))
        .where(_tags_contain(DRAFT_TAG, negate=True))
        .where(func.lower(LedgerEntry.subject).like(needle))
    )
    return int(db.execute(stmt).scalar_one())


def create(db: Session, *, user_id: int, payload: SmartFolderCreate) -> SmartFolder:
    """Create a folder for the caller. The rule_value is normalised so it
    matches the suggestion cluster key. A duplicate active rule_value for the
    same owner is a 409."""
    rule_value = normalise_subject(payload.rule_value)
    if not rule_value:
        raise ConflictError(
            "SMART_FOLDER_EMPTY_RULE",
            "rule_value normalises to empty",
        )
    if rule_value in _active_rule_values(db, user_id):
        raise ConflictError(
            "SMART_FOLDER_RULE_TAKEN",
            "A folder with that rule already exists",
            rule_value=rule_value,
        )
    row = SmartFolder(
        owner_user_id=user_id,
        name_en=payload.name_en.strip(),
        name_ar=payload.name_ar.strip(),
        rule_kind=payload.rule_kind,
        rule_value=rule_value,
        created_at=_utcnow(),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def rename(
    db: Session, *, folder_id: int, user_id: int, payload: SmartFolderUpdate
) -> SmartFolder:
    """Rename either/both localized names of a caller-owned folder."""
    row = get_owned(db, folder_id=folder_id, user_id=user_id)
    if row is None:
        raise NotFoundError(
            "SMART_FOLDER_NOT_FOUND",
            f"Smart folder {folder_id} does not exist",
            id=folder_id,
        )
    if payload.name_en is not None:
        row.name_en = payload.name_en.strip()
    if payload.name_ar is not None:
        row.name_ar = payload.name_ar.strip()
    db.commit()
    db.refresh(row)
    return row


def soft_delete(db: Session, *, folder_id: int, user_id: int) -> None:
    """Soft-delete a caller-owned folder (sets ``deleted_at``)."""
    row = get_owned(db, folder_id=folder_id, user_id=user_id)
    if row is None:
        raise NotFoundError(
            "SMART_FOLDER_NOT_FOUND",
            f"Smart folder {folder_id} does not exist",
            id=folder_id,
        )
    row.deleted_at = _utcnow()
    db.commit()


def dismiss(db: Session, *, user_id: int, cluster_key: str) -> None:
    """Record a per-user dismissal of a suggestion cluster (idempotent)."""
    key = normalise_subject(cluster_key)
    if not key:
        return
    existing = db.execute(
        select(SmartFolderDismissal.id).where(
            SmartFolderDismissal.owner_user_id == user_id,
            SmartFolderDismissal.cluster_key == key,
        )
    ).scalar_one_or_none()
    if existing is not None:
        return
    db.add(
        SmartFolderDismissal(
            owner_user_id=user_id,
            cluster_key=key,
            created_at=_utcnow(),
        )
    )
    db.commit()


__all__ = [
    "SAMPLE_SUBJECTS",
    "SUGGEST_MIN_COUNT",
    "SUGGEST_TOP_N",
    "Suggestion",
    "count_for",
    "create",
    "dismiss",
    "get_owned",
    "list_for",
    "rename",
    "soft_delete",
    "suggest",
]
