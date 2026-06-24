"""Automated Correspondence Log service — Ledger→Outlook Phase 3.

Evaluates admin-editable rules against the events the app already emits
(document/Book generation, Book signing, stamped-intake attachment, email send)
and files a *shared* (owner_user_id=NULL, non-email channel) LedgerEntry under
the matched category. Idempotent on the source so a re-generation/re-sign
updates the existing row instead of duplicating it. A failing log_event must be
swallowed by the caller — it never breaks the underlying generation.
"""

from __future__ import annotations

import logging
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.errors import NotFoundError
from app.db.models import (
    Book,
    CorrespondenceCategory,
    CorrespondenceRule,
    LedgerEntry,
)

log = logging.getLogger(__name__)

# Non-email channel for auto-log rows — Phase-1 scoping keeps non-email rows
# visible to everyone (owner_user_id=NULL OR channel != 'email').
LOG_CHANNEL = "document"

# Mirrors migration 0032's seed. (key, name_en, name_ar, sort)
DEFAULT_CATEGORIES: tuple[tuple[str, str, str, int], ...] = (
    ("hr_letters", "HR letters", "خطابات الموارد البشرية", 10),
    ("salary_bank", "Salary / bank", "الرواتب / البنك", 20),
    ("leaves", "Leaves", "الإجازات", 30),
    ("gov_nat", "Government / NAT", "حكومي / الخدمة الوطنية", 40),
    ("incoming_stamped", "Incoming (stamped)", "وارد (مختوم)", 50),
)
# (trigger, condition_json, category_key, enabled, sort)
DEFAULT_RULES: tuple[tuple[str, dict[str, str], str, bool, int], ...] = (
    ("document_generated", {"category": "HR"}, "hr_letters", True, 10),
    ("document_generated", {"category": "NAT"}, "gov_nat", True, 20),
    ("intake_classified", {"kind": "incoming"}, "incoming_stamped", True, 30),
    ("email_sent", {}, "hr_letters", False, 40),
)


def seed_defaults(db: Session) -> None:
    """Create the default categories + rules if absent. Idempotent (keyed on
    category ``key`` + a rule's (trigger, category_id)). Used by tests and as a
    safety net; production seeds via migration 0032."""
    by_key: dict[str, CorrespondenceCategory] = {
        c.key: c
        for c in db.execute(select(CorrespondenceCategory)).scalars()
    }
    for key, en, ar, sort in DEFAULT_CATEGORIES:
        if key not in by_key:
            cat = CorrespondenceCategory(
                key=key, name_en=en, name_ar=ar, sort=sort, system=True
            )
            db.add(cat)
            db.flush()
            by_key[key] = cat
    existing = {
        (r.trigger, r.category_id)
        for r in db.execute(select(CorrespondenceRule)).scalars()
    }
    for trigger, cond, cat_key, enabled, sort in DEFAULT_RULES:
        cat_id = by_key[cat_key].id
        if (trigger, cat_id) not in existing:
            db.add(
                CorrespondenceRule(
                    trigger=trigger,
                    condition_json=dict(cond),
                    category_id=cat_id,
                    enabled=enabled,
                    sort=sort,
                )
            )
    db.commit()


def _match_rule(rule: CorrespondenceRule, condition_fields: dict[str, str]) -> bool:
    """A rule fires when every key in its condition matches the event's fields
    (case-insensitive string compare). An empty condition matches any event of
    the rule's trigger."""
    for key, want in (rule.condition_json or {}).items():
        got = condition_fields.get(key)
        if got is None or str(got).strip().lower() != str(want).strip().lower():
            return False
    return True


def _matching_category_id(
    db: Session, *, trigger: str, condition_fields: dict[str, str]
) -> int | None:
    """The category of the first enabled rule (by sort, id) that matches."""
    rules = db.execute(
        select(CorrespondenceRule)
        .where(
            CorrespondenceRule.trigger == trigger,
            CorrespondenceRule.enabled.is_(True),
        )
        .order_by(CorrespondenceRule.sort.asc(), CorrespondenceRule.id.asc())
    ).scalars()
    for rule in rules:
        if _match_rule(rule, condition_fields):
            return rule.category_id
    return None


def log_event(
    db: Session,
    *,
    trigger: str,
    source_kind: str,
    source_book_id: int | None,
    subject: str,
    employee_id: str | None,
    submitter: str | None,
    entry_date: date,
    condition_fields: dict[str, str],
    direction: str = "outgoing",
) -> LedgerEntry | None:
    """Evaluate enabled rules for ``trigger``; on a match, idempotently upsert a
    shared (owner_user_id=NULL, non-email channel) ledger row under the matched
    category. Idempotency key: (source_kind, related_book_id). Returns the row,
    or ``None`` when no rule matched. Commits within the caller's transaction.
    """
    category_id = _matching_category_id(
        db, trigger=trigger, condition_fields=condition_fields
    )
    if category_id is None:
        return None

    existing: LedgerEntry | None = None
    if source_book_id is not None:
        existing = db.execute(
            select(LedgerEntry).where(
                LedgerEntry.source_kind == source_kind,
                LedgerEntry.related_book_id == source_book_id,
                LedgerEntry.deleted_at.is_(None),
            )
        ).scalars().first()

    if existing is not None:
        existing.subject = subject[:255]
        existing.category_id = category_id
        existing.related_employee_id = employee_id
        existing.created_by = submitter
        existing.entry_date = entry_date
        existing.direction = direction
        db.flush()
        return existing

    row = LedgerEntry(
        entry_date=entry_date,
        direction=direction,
        channel=LOG_CHANNEL,
        counterparty=(submitter or "system")[:255],
        subject=subject[:255],
        owner_user_id=None,            # shared — visible to everyone
        source_kind=source_kind,
        category_id=category_id,
        related_book_id=source_book_id,
        related_employee_id=employee_id,
        created_by=submitter,
        tags=["correspondence-log", source_kind],
    )
    db.add(row)
    db.flush()
    return row


# ─── Read helpers (log list + record view) ──────────────────────────────────


def list_log(
    db: Session, *, category_id: int | None = None, limit: int = 50, offset: int = 0
) -> list[LedgerEntry]:
    """The shared auto-log rows (owner_user_id IS NULL, has a source_kind),
    newest first, optionally filtered by category."""
    limit = max(1, min(limit, 200))
    stmt = (
        select(LedgerEntry)
        .where(
            LedgerEntry.owner_user_id.is_(None),
            LedgerEntry.source_kind.is_not(None),
            LedgerEntry.deleted_at.is_(None),
        )
        .order_by(LedgerEntry.entry_date.desc(), LedgerEntry.id.desc())
    )
    if category_id is not None:
        stmt = stmt.where(LedgerEntry.category_id == category_id)
    return list(db.execute(stmt.limit(limit).offset(offset)).scalars())


def get_log_record(db: Session, entry_id: int) -> LedgerEntry:
    """A single shared log row for the record view. 404 if not a shared
    auto-log row (so email entries can't be fetched through this path)."""
    row = db.get(LedgerEntry, entry_id)
    if (
        row is None
        or row.deleted_at is not None
        or row.owner_user_id is not None
        or row.source_kind is None
    ):
        raise NotFoundError(
            "LOG_RECORD_NOT_FOUND",
            f"Correspondence-log record {entry_id} does not exist",
            id=entry_id,
        )
    return row


# ─── Categories + rules CRUD ─────────────────────────────────────────────────


def list_categories(db: Session) -> list[CorrespondenceCategory]:
    return list(
        db.execute(
            select(CorrespondenceCategory).order_by(
                CorrespondenceCategory.sort.asc(), CorrespondenceCategory.id.asc()
            )
        ).scalars()
    )


def create_category(
    db: Session, *, key: str, name_en: str, name_ar: str, sort: int
) -> CorrespondenceCategory:
    row = CorrespondenceCategory(
        key=key, name_en=name_en, name_ar=name_ar, sort=sort, system=False
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def update_category(
    db: Session, category_id: int, **fields: object
) -> CorrespondenceCategory:
    row = db.get(CorrespondenceCategory, category_id)
    if row is None:
        raise NotFoundError(
            "CATEGORY_NOT_FOUND", f"Category {category_id} does not exist", id=category_id
        )
    for k, v in fields.items():
        if v is not None:
            setattr(row, k, v)
    db.commit()
    db.refresh(row)
    return row


def delete_category(db: Session, category_id: int) -> None:
    row = db.get(CorrespondenceCategory, category_id)
    if row is None:
        raise NotFoundError(
            "CATEGORY_NOT_FOUND", f"Category {category_id} does not exist", id=category_id
        )
    if row.system:
        raise NotFoundError(  # treat protected-system as not-deletable
            "CATEGORY_PROTECTED",
            f"Category {category_id} is a system category and cannot be deleted",
            id=category_id,
        )
    db.delete(row)
    db.commit()


def list_rules(db: Session) -> list[CorrespondenceRule]:
    return list(
        db.execute(
            select(CorrespondenceRule).order_by(
                CorrespondenceRule.sort.asc(), CorrespondenceRule.id.asc()
            )
        ).scalars()
    )


def create_rule(
    db: Session,
    *,
    trigger: str,
    condition_json: dict[str, str],
    category_id: int,
    enabled: bool,
    sort: int,
) -> CorrespondenceRule:
    if db.get(CorrespondenceCategory, category_id) is None:
        raise NotFoundError(
            "CATEGORY_NOT_FOUND", f"Category {category_id} does not exist", id=category_id
        )
    row = CorrespondenceRule(
        trigger=trigger,
        condition_json=dict(condition_json),
        category_id=category_id,
        enabled=enabled,
        sort=sort,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def update_rule(db: Session, rule_id: int, **fields: object) -> CorrespondenceRule:
    row = db.get(CorrespondenceRule, rule_id)
    if row is None:
        raise NotFoundError(
            "RULE_NOT_FOUND", f"Rule {rule_id} does not exist", id=rule_id
        )
    for k, v in fields.items():
        if v is not None:
            setattr(row, k, v)
    db.commit()
    db.refresh(row)
    return row


def delete_rule(db: Session, rule_id: int) -> None:
    row = db.get(CorrespondenceRule, rule_id)
    if row is None:
        raise NotFoundError(
            "RULE_NOT_FOUND", f"Rule {rule_id} does not exist", id=rule_id
        )
    db.delete(row)
    db.commit()


def resolve_record_extras(
    db: Session, row: LedgerEntry
) -> dict[str, str | None]:
    """Category + linked-Book fields for the record view (used by the route)."""
    cat = (
        db.get(CorrespondenceCategory, row.category_id)
        if row.category_id is not None
        else None
    )
    book = (
        db.get(Book, row.related_book_id)
        if row.related_book_id is not None
        else None
    )
    return {
        "category_key": cat.key if cat else None,
        "category_name_en": cat.name_en if cat else None,
        "category_name_ar": cat.name_ar if cat else None,
        "book_ref_number": book.ref_number if book else None,
        "book_approval_state": book.approval_state if book else None,
    }


__all__ = [
    "DEFAULT_CATEGORIES",
    "DEFAULT_RULES",
    "LOG_CHANNEL",
    "create_category",
    "create_rule",
    "delete_category",
    "delete_rule",
    "get_log_record",
    "list_categories",
    "list_log",
    "list_rules",
    "log_event",
    "resolve_record_extras",
    "seed_defaults",
    "update_category",
    "update_rule",
]
