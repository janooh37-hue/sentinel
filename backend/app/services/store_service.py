"""Assets store: Store items, Batches, Monthly deliveries, Stock counts, Disposals.

Quantities are integers in base units (loose units when a Store item has
``contains_qty``, otherwise Counting units). On-hand and Monthly usage are
derived from Stock counts plus the Monthly deliveries and Disposals around them
(ADR 0009); nothing records individual handouts. A delivery or Disposal dated
on a Stock count's day happens after that count.
"""

from __future__ import annotations

import math
import re
import uuid
from collections import defaultdict
from collections.abc import Callable, Iterable, Iterator, Sequence
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Any

from sqlalchemy import exists, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.api.errors import ConflictError, NotFoundError, ValidationFailedError
from app.config import get_settings
from app.core.clock import organization_today, utcnow
from app.core.expiry import expiry_status
from app.core.uploads import SniffedUploadPolicy, validate_sniffed_upload
from app.db.models import (
    StoreBatch,
    StoreCategory,
    StoreCount,
    StoreCountLine,
    StoreDelivery,
    StoreDeliveryLine,
    StoreDisposal,
    StoreItem,
)
from app.db.repos._locking import begin_immediate_if_idle
from app.db.repos.audit_repo import append_audit
from app.schemas.store import (
    StoreBatchRead,
    StoreCategoryCreate,
    StoreCategoryRead,
    StoreCategoryUpdate,
    StoreCountLineInput,
    StoreCountRead,
    StoreCountWrite,
    StoreDashboard,
    StoreDashboardBatch,
    StoreDashboardLowStock,
    StoreDeliveryCreate,
    StoreDeliveryLineInput,
    StoreDeliveryNoteFile,
    StoreDeliveryRead,
    StoreDisposalCreate,
    StoreDisposalRead,
    StoreExpectedBatch,
    StoreItemCreate,
    StoreItemRead,
    StoreItemUpdate,
    StoreLineRead,
    StorePickerItem,
    StoreSuggestion,
    StoreUsage,
    StoreUsageRow,
    parse_expiry,
)
from app.services.workforce_etag import require_if_match, row_etag

EXPIRING_SOON_DAYS = 60
USAGE_WINDOWS = 6
SUGGESTION_WINDOWS = 3

_CODE_PATTERN = re.compile(r"^ST-(\d+)$")

# Delivery notes: the fine-receipt policy (magic-byte sniff, 10 MiB) plus WebP.
NOTE_FILE_MAX_BYTES = 10 * 1024 * 1024
_NOTE_FILE_POLICY = SniffedUploadPolicy(
    code_prefix="STORE_NOTE_FILE",
    noun="delivery note",
    extensions=frozenset({".pdf", ".png", ".jpg", ".jpeg", ".webp"}),
    bad_format_message="Delivery notes must be a PDF, PNG, JPEG, or WebP file.",
    fallback_name="delivery-note",
    max_bytes=NOTE_FILE_MAX_BYTES,
)


def _require_not_future(value: date, field_name: str) -> None:
    if value > organization_today():
        raise ValidationFailedError(
            "STORE_DATE_IN_FUTURE",
            "The date cannot be in the future.",
            field=field_name,
            value=value.isoformat(),
        )


@contextmanager
def _write(
    db: Session,
    *,
    commit: bool = True,
    on_integrity: Callable[[], None] | None = None,
) -> Iterator[None]:
    """One Store write: lock first, then read, check, and write atomically.

    Taking SQLite's write lock before the first read makes every check (first-use
    Batch, archive with stock, contains lock, disposal limit) and its write one
    serial step. With ``commit=False`` the caller owns the transaction: the work
    is only flushed and nothing is rolled back here. A residual constraint
    violation becomes a domain 409, never a 500.
    """
    if commit:
        begin_immediate_if_idle(db)
    try:
        yield
        if commit:
            db.commit()
        else:
            db.flush()
    except IntegrityError as exc:
        if commit:
            db.rollback()
        if on_integrity is not None:
            on_integrity()
        raise ConflictError(
            "STORE_WRITE_CONFLICT", "The Store changed meanwhile; refresh and retry."
        ) from exc
    except BaseException:
        if commit:
            db.rollback()
        raise


# ── Derived stock (counts + deliveries - disposals) ──────────────────────────


@dataclass(frozen=True)
class _Count:
    id: int
    month: str
    counted_on: date
    lines: dict[int, int]


@dataclass(frozen=True)
class _Event:
    batch_id: int
    on: date
    delta: int


@dataclass
class _Ledger:
    """Every Stock count line and stock movement, loaded once per request."""

    counts: list[_Count]
    events: list[_Event] = field(default_factory=list)

    def _balance(self, base: _Count | None, end: date, *, include_end: bool) -> dict[int, int]:
        result: dict[int, int] = defaultdict(int)
        if base is not None:
            result.update(base.lines)
        for event in self.events:
            if base is not None and event.on < base.counted_on:
                continue
            if event.on > end or (event.on == end and not include_end):
                continue
            result[event.batch_id] += event.delta
        return dict(result)

    def on_hand(self, as_of: date) -> dict[int, int]:
        """Latest count on or before ``as_of``, plus events on/after its day."""
        base = next((c for c in reversed(self.counts) if c.counted_on <= as_of), None)
        return self._balance(base, as_of, include_end=True)

    def stock_before(self, day: date, *, exclude_count_id: int | None = None) -> dict[int, int]:
        """Expected stock just before a count taken on ``day``."""
        base = next(
            (c for c in reversed(self.counts) if c.counted_on < day and c.id != exclude_count_id),
            None,
        )
        return self._balance(base, day, include_end=False)

    def disposable(self, batch_id: int, day: date, *, as_of: date) -> int:
        """Most a Disposal dated ``day`` may remove from one Batch.

        The Batch's stock on ``day`` (after a count that day, with every event up
        to and including ``day``), and at every later movement until the next
        Stock count resets the shelf (or until ``as_of`` when none follows), so a
        backdated Disposal can never drive a later balance below zero.
        """
        next_count = next((c.counted_on for c in self.counts if c.counted_on > day), None)
        points = {day} | {
            event.on
            for event in self.events
            if event.batch_id == batch_id
            and day < event.on <= as_of
            and (next_count is None or event.on < next_count)
        }
        return min(self.on_hand(point).get(batch_id, 0) for point in points)

    def usage_windows(self, item_of: dict[int, int]) -> list[tuple[str, dict[int, int | None]]]:
        """Monthly usage per item for each pair of consecutive Stock counts.

        Σc₁ + deliveries in [c₁, c₂) - disposals in [c₁, c₂) - Σc₂, labelled
        with c₂'s month. An item with no line in either count and no movement in
        the window has no value (None), as opposed to a usage of zero.
        """
        windows: list[tuple[str, dict[int, int | None]]] = []
        for first, second in zip(self.counts, self.counts[1:], strict=False):
            totals: dict[int, int] = defaultdict(int)
            seen: set[int] = set()
            for batch_id, quantity in first.lines.items():
                totals[item_of[batch_id]] += quantity
                seen.add(item_of[batch_id])
            for batch_id, quantity in second.lines.items():
                totals[item_of[batch_id]] -= quantity
                seen.add(item_of[batch_id])
            for event in self.events:
                if first.counted_on <= event.on < second.counted_on:
                    totals[item_of[event.batch_id]] += event.delta
                    seen.add(item_of[event.batch_id])
            values: dict[int, int | None] = {item_id: totals[item_id] for item_id in seen}
            windows.append((second.month, values))
        return windows


def _load_ledger(db: Session) -> _Ledger:
    lines: dict[int, dict[int, int]] = defaultdict(dict)
    for count_id, batch_id, quantity in db.execute(
        select(StoreCountLine.count_id, StoreCountLine.batch_id, StoreCountLine.quantity)
    ).all():
        lines[count_id][batch_id] = quantity
    counts = [
        _Count(id=row.id, month=row.month, counted_on=row.counted_on, lines=lines[row.id])
        for row in db.execute(
            select(StoreCount.id, StoreCount.month, StoreCount.counted_on).order_by(
                StoreCount.counted_on, StoreCount.id
            )
        ).all()
    ]
    events = [
        _Event(batch_id, received_on, quantity)
        for batch_id, received_on, quantity in db.execute(
            select(
                StoreDeliveryLine.batch_id, StoreDelivery.received_on, StoreDeliveryLine.quantity
            ).join(StoreDelivery, StoreDelivery.id == StoreDeliveryLine.delivery_id)
        ).all()
    ]
    events.extend(
        _Event(batch_id, disposed_on, -quantity)
        for batch_id, disposed_on, quantity in db.execute(
            select(StoreDisposal.batch_id, StoreDisposal.disposed_on, StoreDisposal.quantity)
        ).all()
    )
    return _Ledger(counts=counts, events=events)


def _item_totals(per_batch: dict[int, int], item_of: dict[int, int]) -> defaultdict[int, int]:
    """Sum per-batch balances into per-item totals; missing items read as 0."""
    totals: defaultdict[int, int] = defaultdict(int)
    for batch_id, quantity in per_batch.items():
        totals[item_of[batch_id]] += quantity
    return totals


def _item_on_hand(db: Session, ledger: _Ledger, as_of: date) -> dict[int, int]:
    per_batch = ledger.on_hand(as_of)
    if not per_batch:
        return {}
    item_of: dict[int, int] = dict(
        db.execute(
            select(StoreBatch.id, StoreBatch.item_id).where(StoreBatch.id.in_(per_batch))
        ).all()
    )
    return dict(_item_totals(per_batch, item_of))


# ── Read builders ────────────────────────────────────────────────────────────


def _item_ref(item: StoreItem) -> dict[str, Any]:
    return {
        "item_id": item.id,
        "item_code": item.code,
        "item_name_en": item.name_en,
        "item_name_ar": item.name_ar,
        "counting_unit_en": item.counting_unit_en,
        "counting_unit_ar": item.counting_unit_ar,
        "contains_qty": item.contains_qty,
        "contains_unit_en": item.contains_unit_en,
        "contains_unit_ar": item.contains_unit_ar,
    }


def _days_left(batch: StoreBatch, as_of: date) -> int | None:
    return (batch.expiry_date - as_of).days if batch.expiry_date is not None else None


def _line_read(line: StoreDeliveryLine | StoreCountLine) -> StoreLineRead:
    batch = line.batch
    return StoreLineRead(
        **_item_ref(batch.item),
        id=line.id,
        batch_id=batch.id,
        expiry_date=batch.expiry_date,
        expiry_month_only=batch.expiry_month_only,
        quantity=line.quantity,
    )


def _item_etag(row: StoreItem) -> str:
    return row_etag(row, extra={"archived_at": row.archived_at})


def _item_read(row: StoreItem, on_hand: int) -> StoreItemRead:
    return StoreItemRead(
        id=row.id,
        code=row.code,
        name_en=row.name_en,
        name_ar=row.name_ar,
        category_id=row.category_id,
        category=StoreCategoryRead.model_validate(row.category),
        counting_unit_en=row.counting_unit_en,
        counting_unit_ar=row.counting_unit_ar,
        contains_qty=row.contains_qty,
        contains_unit_en=row.contains_unit_en,
        contains_unit_ar=row.contains_unit_ar,
        minimum_level=row.minimum_level,
        archived_at=row.archived_at,
        created_at=row.created_at,
        updated_at=row.updated_at,
        on_hand=on_hand,
        version=_item_etag(row),
    )


def _note_url(delivery_id: int) -> str:
    return f"/api/v1/store/deliveries/{delivery_id}/note-file"


def _delivery_read(row: StoreDelivery) -> StoreDeliveryRead:
    note_file = (
        StoreDeliveryNoteFile(
            name=row.note_file_name or "delivery-note",
            media_type=row.note_file_media_type or "application/octet-stream",
            size=row.note_file_size or 0,
            url=_note_url(row.id),
        )
        if row.note_file_path is not None
        else None
    )
    return StoreDeliveryRead(
        id=row.id,
        received_on=row.received_on,
        note=row.note,
        note_file=note_file,
        lines=[_line_read(line) for line in row.lines],
        created_by_user_id=row.created_by_user_id,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _count_read(row: StoreCount) -> StoreCountRead:
    return StoreCountRead(
        id=row.id,
        month=row.month,
        counted_on=row.counted_on,
        note=row.note,
        lines=[_line_read(line) for line in row.lines],
        created_by_user_id=row.created_by_user_id,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _disposal_read(row: StoreDisposal) -> StoreDisposalRead:
    batch = row.batch
    return StoreDisposalRead(
        **_item_ref(batch.item),
        id=row.id,
        batch_id=batch.id,
        expiry_date=batch.expiry_date,
        expiry_month_only=batch.expiry_month_only,
        disposed_on=row.disposed_on,
        quantity=row.quantity,
        reason=row.reason,
        note=row.note,
        created_by_user_id=row.created_by_user_id,
        created_at=row.created_at,
    )


# ── Categories ───────────────────────────────────────────────────────────────


def list_categories(db: Session) -> list[StoreCategoryRead]:
    rows = db.scalars(select(StoreCategory).order_by(StoreCategory.name_en)).all()
    return [StoreCategoryRead.model_validate(row) for row in rows]


def _get_category(db: Session, category_id: int) -> StoreCategory:
    row = db.get(StoreCategory, category_id)
    if row is None:
        raise NotFoundError(
            "STORE_CATEGORY_NOT_FOUND", "Store category not found.", category_id=category_id
        )
    return row


def _category_name_taken(db: Session, name_en: str, *, exclude_id: int | None = None) -> bool:
    stmt = select(StoreCategory.id).where(StoreCategory.name_en == name_en)
    if exclude_id is not None:
        stmt = stmt.where(StoreCategory.id != exclude_id)
    return db.scalar(stmt) is not None


def _raise_category_exists(name_en: str) -> None:
    raise ConflictError(
        "STORE_CATEGORY_EXISTS", "A Store category with this name already exists.", name_en=name_en
    )


def create_category(
    db: Session,
    payload: StoreCategoryCreate,
    *,
    actor: str | None = None,
    commit: bool = True,
) -> StoreCategoryRead:
    name_en = payload.name_en.strip()
    with _write(db, commit=commit, on_integrity=lambda: _raise_category_exists(name_en)):
        if _category_name_taken(db, name_en):
            _raise_category_exists(name_en)
        row = StoreCategory(name_en=name_en, name_ar=payload.name_ar.strip())
        db.add(row)
        db.flush()
        append_audit(
            db,
            action="category.created",
            entity_type="store_category",
            entity_id=row.id,
            actor=actor,
            payload={"name_en": row.name_en, "name_ar": row.name_ar},
        )
    return StoreCategoryRead.model_validate(row)


def update_category(
    db: Session, category_id: int, payload: StoreCategoryUpdate, *, actor: str | None = None
) -> StoreCategoryRead:
    data = payload.model_dump(exclude_unset=True, exclude_none=True)
    if "name_en" in data:
        data["name_en"] = data["name_en"].strip()
    if "name_ar" in data:
        data["name_ar"] = data["name_ar"].strip()
    with _write(db, on_integrity=lambda: _raise_category_exists(str(data.get("name_en")))):
        row = _get_category(db, category_id)
        if "name_en" in data and _category_name_taken(db, data["name_en"], exclude_id=row.id):
            _raise_category_exists(data["name_en"])
        for key, value in data.items():
            setattr(row, key, value)
        append_audit(
            db,
            action="category.updated",
            entity_type="store_category",
            entity_id=row.id,
            actor=actor,
            payload=data,
        )
    return StoreCategoryRead.model_validate(row)


# ── Store items ──────────────────────────────────────────────────────────────


def _item_options() -> tuple[Any, ...]:
    return (selectinload(StoreItem.category),)


def get_item(db: Session, item_id: int) -> StoreItem:
    row = db.scalar(select(StoreItem).where(StoreItem.id == item_id).options(*_item_options()))
    if row is None:
        raise NotFoundError("STORE_ITEM_NOT_FOUND", "Store item not found.", item_id=item_id)
    return row


def item_read(db: Session, row: StoreItem) -> StoreItemRead:
    on_hand = _item_on_hand(db, _load_ledger(db), organization_today()).get(row.id, 0)
    return _item_read(row, on_hand)


def list_items(db: Session, *, include_archived: bool = False) -> list[StoreItemRead]:
    stmt = select(StoreItem).options(*_item_options()).order_by(StoreItem.code)
    if not include_archived:
        stmt = stmt.where(StoreItem.archived_at.is_(None))
    rows = db.scalars(stmt).all()
    on_hand = _item_on_hand(db, _load_ledger(db), organization_today())
    return [_item_read(row, on_hand.get(row.id, 0)) for row in rows]


def list_picker_items(db: Session) -> list[StorePickerItem]:
    rows = db.scalars(
        select(StoreItem).where(StoreItem.archived_at.is_(None)).order_by(StoreItem.code)
    ).all()
    return [
        StorePickerItem(
            id=row.id,
            code=row.code,
            name_en=row.name_en,
            name_ar=row.name_ar,
            counting_unit_en=row.counting_unit_en,
            counting_unit_ar=row.counting_unit_ar,
            contains_qty=row.contains_qty,
            contains_unit_en=row.contains_unit_en,
            contains_unit_ar=row.contains_unit_ar,
        )
        for row in rows
    ]


def _check_contains(qty: int | None, unit_en: str | None, unit_ar: str | None) -> None:
    given = [value is not None for value in (qty, unit_en, unit_ar)]
    if any(given) and not all(given):
        raise ValidationFailedError(
            "STORE_ITEM_CONTAINS_INCOMPLETE",
            "A contained quantity needs its unit in English and Arabic, and the reverse.",
        )


def _next_code(db: Session) -> str:
    highest = 0
    for code in db.scalars(select(StoreItem.code)).all():
        match = _CODE_PATTERN.fullmatch(code)
        if match is not None:
            highest = max(highest, int(match.group(1)))
    return f"ST-{highest + 1:04d}"


def create_item(
    db: Session,
    payload: StoreItemCreate,
    *,
    actor: str | None = None,
    actor_user_id: int | None = None,
    commit: bool = True,
) -> StoreItem:
    _check_contains(payload.contains_qty, payload.contains_unit_en, payload.contains_unit_ar)
    with _write(db, commit=commit):
        _get_category(db, payload.category_id)
        row = StoreItem(
            code=_next_code(db),
            name_en=payload.name_en.strip(),
            name_ar=payload.name_ar,
            category_id=payload.category_id,
            counting_unit_en=payload.counting_unit_en.strip(),
            counting_unit_ar=payload.counting_unit_ar.strip(),
            contains_qty=payload.contains_qty,
            contains_unit_en=payload.contains_unit_en,
            contains_unit_ar=payload.contains_unit_ar,
            minimum_level=payload.minimum_level,
            created_by_user_id=actor_user_id,
        )
        db.add(row)
        db.flush()
        append_audit(
            db,
            action="item.created",
            entity_type="store_item",
            entity_id=row.id,
            actor=actor,
            payload={"code": row.code, "name_en": row.name_en, "category_id": row.category_id},
        )
    return get_item(db, row.id)


def _item_has_lines(db: Session, item_id: int) -> bool:
    batch_ids = select(StoreBatch.id).where(StoreBatch.item_id == item_id)
    return bool(
        db.scalar(
            select(
                exists().where(StoreDeliveryLine.batch_id.in_(batch_ids))
                | exists().where(StoreCountLine.batch_id.in_(batch_ids))
                | exists().where(StoreDisposal.batch_id.in_(batch_ids))
            )
        )
    )


_REQUIRED_ITEM_FIELDS = frozenset(
    {"name_en", "category_id", "counting_unit_en", "counting_unit_ar"}
)
_CONTAINS_FIELDS = ("contains_qty", "contains_unit_en", "contains_unit_ar")


def update_item(
    db: Session,
    item_id: int,
    payload: StoreItemUpdate,
    *,
    if_match: str | None,
    actor: str | None = None,
) -> StoreItem:
    data = payload.model_dump(exclude_unset=True)
    cleared = sorted(key for key in _REQUIRED_ITEM_FIELDS if key in data and data[key] is None)
    if cleared:
        raise ValidationFailedError(
            "STORE_ITEM_FIELD_REQUIRED", "These Store item fields cannot be empty.", fields=cleared
        )
    for key in ("name_en", "counting_unit_en", "counting_unit_ar"):
        if key in data:
            data[key] = data[key].strip()
    with _write(db):
        row = get_item(db, item_id)
        require_if_match(if_match, _item_etag(row), code="STORE_ITEM_VERSION_CONFLICT")
        if any(key in data for key in _CONTAINS_FIELDS):
            new_contains = tuple(data.get(key, getattr(row, key)) for key in _CONTAINS_FIELDS)
            _check_contains(*new_contains)
            old_contains = tuple(getattr(row, key) for key in _CONTAINS_FIELDS)
            if new_contains != old_contains and _item_has_lines(db, row.id):
                raise ConflictError(
                    "STORE_ITEM_CONTAINS_LOCKED",
                    "What a Counting unit contains cannot change once the item has stock records.",
                    item_id=row.id,
                )
        if "category_id" in data:
            _get_category(db, data["category_id"])
        for key, value in data.items():
            setattr(row, key, value)
        row.updated_at = utcnow()
        append_audit(
            db,
            action="item.updated",
            entity_type="store_item",
            entity_id=row.id,
            actor=actor,
            payload=data,
        )
    return get_item(db, row.id)


def archive_item(db: Session, item_id: int, *, actor: str | None = None) -> StoreItem:
    with _write(db):
        row = get_item(db, item_id)
        if row.archived_at is None:
            on_hand = _item_on_hand(db, _load_ledger(db), organization_today()).get(row.id, 0)
            if on_hand > 0:
                raise ConflictError(
                    "STORE_ITEM_HAS_STOCK",
                    "A Store item with stock on hand cannot be archived.",
                    item_id=row.id,
                    on_hand=on_hand,
                )
            row.archived_at = utcnow()
            row.updated_at = row.archived_at
            append_audit(
                db,
                action="item.archived",
                entity_type="store_item",
                entity_id=row.id,
                actor=actor,
                payload={"code": row.code},
            )
    return get_item(db, item_id)


def restore_item(db: Session, item_id: int, *, actor: str | None = None) -> StoreItem:
    with _write(db):
        row = get_item(db, item_id)
        if row.archived_at is not None:
            row.archived_at = None
            row.updated_at = utcnow()
            append_audit(
                db,
                action="item.restored",
                entity_type="store_item",
                entity_id=row.id,
                actor=actor,
                payload={"code": row.code},
            )
    return get_item(db, item_id)


# ── Batches ──────────────────────────────────────────────────────────────────


def _find_batch(db: Session, item_id: int, expiry_date: date | None) -> StoreBatch | None:
    stmt = select(StoreBatch).where(StoreBatch.item_id == item_id)
    stmt = stmt.where(
        StoreBatch.expiry_date.is_(None)
        if expiry_date is None
        else StoreBatch.expiry_date == expiry_date
    )
    return db.scalar(stmt)


def _refuse_archived(item: StoreItem) -> None:
    """An archived item takes no new stock records (Deliveries, Counts, Disposals)."""
    if item.archived_at is not None:
        raise ConflictError(
            "STORE_ITEM_ARCHIVED",
            "An archived Store item takes no new stock records.",
            item_id=item.id,
        )


def _resolve_lines(
    db: Session,
    lines: Sequence[StoreDeliveryLineInput | StoreCountLineInput],
    *,
    reusable_batch_ids: Iterable[int] = (),
) -> list[tuple[StoreBatch, int]]:
    """Find or create each line's Batch; flushes new Batches into the session.

    An archived item takes no new lines, except a Batch listed in
    ``reusable_batch_ids`` (lines a Stock count already held before an edit).
    """
    reusable = set(reusable_batch_ids)
    items: dict[int, StoreItem] = {}
    seen: set[tuple[int, date | None]] = set()
    resolved: list[tuple[StoreBatch, int]] = []
    for index, line in enumerate(lines):
        item = items.get(line.item_id) or get_item(db, line.item_id)
        items[item.id] = item
        expiry_date, month_only = parse_expiry(line.expiry)
        key = (item.id, expiry_date)
        if key in seen:
            raise ValidationFailedError(
                "STORE_DUPLICATE_LINE",
                "The same Store item and expiry appear twice.",
                line=index,
                item_id=item.id,
                expiry_date=expiry_date.isoformat() if expiry_date else None,
            )
        seen.add(key)
        batch = _find_batch(db, item.id, expiry_date)
        if batch is None or batch.id not in reusable:
            _refuse_archived(item)
        if batch is None:
            batch = StoreBatch(
                item_id=item.id, expiry_date=expiry_date, expiry_month_only=month_only
            )
            db.add(batch)
            db.flush()
        resolved.append((batch, line.quantity))
    return resolved


def _remove_orphan_batches(db: Session, batch_ids: Iterable[int]) -> None:
    """Delete Batches no delivery line, count line, or Disposal refers to any more."""
    for batch_id in set(batch_ids):
        used = db.scalar(
            select(
                exists().where(StoreDeliveryLine.batch_id == batch_id)
                | exists().where(StoreCountLine.batch_id == batch_id)
                | exists().where(StoreDisposal.batch_id == batch_id)
            )
        )
        if not used:
            batch = db.get(StoreBatch, batch_id)
            if batch is not None:
                db.delete(batch)
    db.flush()


def _batch_sort_key(batch: StoreBatch) -> tuple[str, int, date]:
    return (batch.item.code, batch.expiry_date is None, batch.expiry_date or date.max)


def list_batches(db: Session, *, item_id: int | None = None) -> list[StoreBatchRead]:
    stmt = select(StoreBatch).options(selectinload(StoreBatch.item))
    if item_id is not None:
        get_item(db, item_id)
        stmt = stmt.where(StoreBatch.item_id == item_id)
    current = organization_today()
    on_hand = _load_ledger(db).on_hand(current)
    rows = sorted(db.scalars(stmt).all(), key=_batch_sort_key)
    return [
        StoreBatchRead(
            **_item_ref(row.item),
            id=row.id,
            expiry_date=row.expiry_date,
            expiry_month_only=row.expiry_month_only,
            on_hand=on_hand.get(row.id, 0),
            days_to_expiry=_days_left(row, current),
        )
        for row in rows
    ]


# ── Monthly deliveries ───────────────────────────────────────────────────────


def _line_options() -> Any:
    return selectinload(StoreDeliveryLine.batch).selectinload(StoreBatch.item)


def list_deliveries(db: Session) -> list[StoreDeliveryRead]:
    rows = db.scalars(
        select(StoreDelivery)
        .options(selectinload(StoreDelivery.lines).options(_line_options()))
        .order_by(StoreDelivery.received_on.desc(), StoreDelivery.id.desc())
    ).all()
    return [_delivery_read(row) for row in rows]


def _get_delivery(db: Session, delivery_id: int) -> StoreDelivery:
    row = db.scalar(
        select(StoreDelivery)
        .where(StoreDelivery.id == delivery_id)
        .options(selectinload(StoreDelivery.lines).options(_line_options()))
    )
    if row is None:
        raise NotFoundError(
            "STORE_DELIVERY_NOT_FOUND", "Monthly delivery not found.", delivery_id=delivery_id
        )
    return row


def get_delivery(db: Session, delivery_id: int) -> StoreDeliveryRead:
    return _delivery_read(_get_delivery(db, delivery_id))


def create_delivery(
    db: Session,
    payload: StoreDeliveryCreate,
    *,
    actor: str | None = None,
    actor_user_id: int | None = None,
) -> StoreDeliveryRead:
    _require_not_future(payload.received_on, "received_on")
    with _write(db):
        resolved = _resolve_lines(db, payload.lines)
        row = StoreDelivery(
            received_on=payload.received_on,
            note=payload.note,
            created_by_user_id=actor_user_id,
            lines=[StoreDeliveryLine(batch_id=b.id, quantity=q) for b, q in resolved],
        )
        db.add(row)
        db.flush()
        append_audit(
            db,
            action="delivery.created",
            entity_type="store_delivery",
            entity_id=row.id,
            actor=actor,
            payload={
                "received_on": row.received_on.isoformat(),
                "lines": [{"batch_id": b.id, "quantity": q} for b, q in resolved],
            },
        )
    db.expire_all()
    return get_delivery(db, row.id)


def _resolve_stored_path(relative: str, delivery_id: int) -> Path:
    data_dir = get_settings().data_dir.resolve()
    path = (data_dir / relative).resolve()
    if not path.is_relative_to(data_dir):
        raise ValidationFailedError(
            "STORE_FILE_INVALID_PATH",
            "The stored delivery note path is outside the data directory.",
            delivery_id=delivery_id,
        )
    return path


def delete_delivery(db: Session, delivery_id: int, *, actor: str | None = None) -> None:
    with _write(db):
        row = _get_delivery(db, delivery_id)
        batch_ids = [line.batch_id for line in row.lines]
        old_file = row.note_file_path
        append_audit(
            db,
            action="delivery.deleted",
            entity_type="store_delivery",
            entity_id=row.id,
            actor=actor,
            payload={
                "received_on": row.received_on.isoformat(),
                "lines": [{"batch_id": ln.batch_id, "quantity": ln.quantity} for ln in row.lines],
            },
        )
        db.delete(row)
        db.flush()
        _remove_orphan_batches(db, batch_ids)
    if old_file is not None:
        _resolve_stored_path(old_file, delivery_id).unlink(missing_ok=True)


def attach_note_file(
    db: Session,
    delivery_id: int,
    *,
    filename: str,
    data: bytes,
    media_type: str,
    actor: str | None = None,
) -> StoreDeliveryRead:
    safe_name, normalized_media = validate_sniffed_upload(
        _NOTE_FILE_POLICY, filename=filename, data=data, media_type=media_type
    )
    data_dir = get_settings().data_dir.resolve()
    destination_dir = data_dir / "store_files" / str(delivery_id)
    destination = destination_dir / f"{uuid.uuid4().hex}-{safe_name}"
    try:
        with _write(db):
            row = _get_delivery(db, delivery_id)
            old_file = row.note_file_path
            destination_dir.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(data)
            row.note_file_path = destination.relative_to(data_dir).as_posix()
            row.note_file_name = safe_name
            row.note_file_media_type = normalized_media
            row.note_file_size = len(data)
            row.updated_at = utcnow()
            append_audit(
                db,
                action="delivery.note_file.attached",
                entity_type="store_delivery",
                entity_id=row.id,
                actor=actor,
                payload={"name": safe_name, "size": len(data), "replaced": old_file is not None},
            )
    except BaseException:
        # A partially written or uncommitted file never outlives its failed write.
        destination.unlink(missing_ok=True)
        raise
    if old_file is not None:
        _resolve_stored_path(old_file, delivery_id).unlink(missing_ok=True)
    return get_delivery(db, delivery_id)


def delete_note_file(
    db: Session, delivery_id: int, *, actor: str | None = None
) -> StoreDeliveryRead:
    with _write(db):
        row = _get_delivery(db, delivery_id)
        old_file = row.note_file_path
        if old_file is None:
            raise NotFoundError(
                "STORE_NOTE_FILE_NOT_FOUND",
                "This delivery has no delivery note attached.",
                delivery_id=delivery_id,
            )
        row.note_file_path = None
        row.note_file_name = None
        row.note_file_media_type = None
        row.note_file_size = None
        row.updated_at = utcnow()
        append_audit(
            db,
            action="delivery.note_file.deleted",
            entity_type="store_delivery",
            entity_id=row.id,
            actor=actor,
            payload={},
        )
    _resolve_stored_path(old_file, delivery_id).unlink(missing_ok=True)
    return get_delivery(db, delivery_id)


def resolve_note_file(db: Session, delivery_id: int) -> tuple[StoreDelivery, Path]:
    row = _get_delivery(db, delivery_id)
    if row.note_file_path is None:
        raise NotFoundError(
            "STORE_NOTE_FILE_NOT_FOUND",
            "This delivery has no delivery note attached.",
            delivery_id=delivery_id,
        )
    path = _resolve_stored_path(row.note_file_path, row.id)
    if not path.is_file():
        raise NotFoundError(
            "STORE_NOTE_FILE_MISSING",
            "The delivery note is missing on disk.",
            delivery_id=delivery_id,
        )
    return row, path


# ── Stock counts ─────────────────────────────────────────────────────────────


def list_counts(db: Session) -> list[StoreCountRead]:
    rows = db.scalars(
        select(StoreCount)
        .options(selectinload(StoreCount.lines).options(_count_line_options()))
        .order_by(StoreCount.counted_on.desc(), StoreCount.id.desc())
    ).all()
    return [_count_read(row) for row in rows]


def _count_line_options() -> Any:
    return selectinload(StoreCountLine.batch).selectinload(StoreBatch.item)


def _get_count(db: Session, count_id: int) -> StoreCount:
    row = db.scalar(
        select(StoreCount)
        .where(StoreCount.id == count_id)
        .options(selectinload(StoreCount.lines).options(_count_line_options()))
    )
    if row is None:
        raise NotFoundError("STORE_COUNT_NOT_FOUND", "Stock count not found.", count_id=count_id)
    return row


def get_count(db: Session, count_id: int) -> StoreCountRead:
    return _count_read(_get_count(db, count_id))


def _expected_batches(
    db: Session, counted_on: date, *, exclude_count_id: int | None = None
) -> list[StoreBatch]:
    before = _load_ledger(db).stock_before(counted_on, exclude_count_id=exclude_count_id)
    positive = [batch_id for batch_id, quantity in before.items() if quantity > 0]
    if not positive:
        return []
    rows = db.scalars(
        select(StoreBatch)
        .join(StoreItem, StoreItem.id == StoreBatch.item_id)
        .where(StoreBatch.id.in_(positive), StoreItem.archived_at.is_(None))
        .options(selectinload(StoreBatch.item))
    ).all()
    return sorted(rows, key=_batch_sort_key)


def expected_batches(db: Session, counted_on: date) -> list[StoreExpectedBatch]:
    """Batches a Stock count on ``counted_on`` must include; never their quantities."""
    return [
        StoreExpectedBatch(
            **_item_ref(batch.item),
            batch_id=batch.id,
            expiry_date=batch.expiry_date,
            expiry_month_only=batch.expiry_month_only,
        )
        for batch in _expected_batches(db, counted_on)
    ]


def _require_month_free(db: Session, month: str, *, exclude_id: int | None = None) -> None:
    stmt = select(StoreCount.id).where(StoreCount.month == month)
    if exclude_id is not None:
        stmt = stmt.where(StoreCount.id != exclude_id)
    existing = db.scalar(stmt)
    if existing is not None:
        raise ConflictError(
            "STORE_COUNT_MONTH_EXISTS",
            "This month already has a Stock count.",
            month=month,
            count_id=existing,
        )


def _require_complete(
    db: Session,
    counted_on: date,
    resolved: list[tuple[StoreBatch, int]],
    *,
    exclude_count_id: int | None = None,
) -> None:
    counted = {batch.id for batch, _quantity in resolved}
    missing = [
        batch
        for batch in _expected_batches(db, counted_on, exclude_count_id=exclude_count_id)
        if batch.id not in counted
    ]
    if missing:
        raise ValidationFailedError(
            "STORE_COUNT_MISSING_BATCHES",
            "The Stock count leaves out Batches that should be on the shelf.",
            batches=[
                {
                    "batch_id": batch.id,
                    "item_code": batch.item.code,
                    "expiry_date": batch.expiry_date.isoformat() if batch.expiry_date else None,
                }
                for batch in missing
            ],
        )


def create_count(
    db: Session,
    payload: StoreCountWrite,
    *,
    actor: str | None = None,
    actor_user_id: int | None = None,
    commit: bool = True,
) -> StoreCountRead:
    _require_not_future(payload.counted_on, "counted_on")
    month = payload.counted_on.strftime("%Y-%m")
    with _write(db, commit=commit, on_integrity=lambda: _require_month_free(db, month)):
        _require_month_free(db, month)
        resolved = _resolve_lines(db, payload.lines)
        _require_complete(db, payload.counted_on, resolved)
        row = StoreCount(
            month=month,
            counted_on=payload.counted_on,
            note=payload.note,
            created_by_user_id=actor_user_id,
            lines=[StoreCountLine(batch_id=b.id, quantity=q) for b, q in resolved],
        )
        db.add(row)
        db.flush()
        append_audit(
            db,
            action="count.created",
            entity_type="store_count",
            entity_id=row.id,
            actor=actor,
            payload={
                "counted_on": row.counted_on.isoformat(),
                "lines": [{"batch_id": b.id, "quantity": q} for b, q in resolved],
            },
        )
    db.expire_all()
    return get_count(db, row.id)


def update_count(
    db: Session,
    count_id: int,
    payload: StoreCountWrite,
    *,
    actor: str | None = None,
) -> StoreCountRead:
    _require_not_future(payload.counted_on, "counted_on")
    month = payload.counted_on.strftime("%Y-%m")
    with _write(db, on_integrity=lambda: _require_month_free(db, month, exclude_id=count_id)):
        row = _get_count(db, count_id)
        _require_month_free(db, month, exclude_id=row.id)
        old_batch_ids = [line.batch_id for line in row.lines]
        row.lines.clear()
        db.flush()
        resolved = _resolve_lines(db, payload.lines, reusable_batch_ids=old_batch_ids)
        _require_complete(db, payload.counted_on, resolved, exclude_count_id=row.id)
        row.month = month
        row.counted_on = payload.counted_on
        row.note = payload.note
        row.lines.extend(StoreCountLine(batch_id=b.id, quantity=q) for b, q in resolved)
        row.updated_at = utcnow()
        db.flush()
        _remove_orphan_batches(db, old_batch_ids)
        append_audit(
            db,
            action="count.updated",
            entity_type="store_count",
            entity_id=row.id,
            actor=actor,
            payload={
                "counted_on": row.counted_on.isoformat(),
                "lines": [{"batch_id": b.id, "quantity": q} for b, q in resolved],
            },
        )
    db.expire_all()
    return get_count(db, count_id)


# ── Disposals ────────────────────────────────────────────────────────────────


def _disposal_options() -> Any:
    return selectinload(StoreDisposal.batch).selectinload(StoreBatch.item)


def list_disposals(db: Session) -> list[StoreDisposalRead]:
    rows = db.scalars(
        select(StoreDisposal)
        .options(_disposal_options())
        .order_by(StoreDisposal.disposed_on.desc(), StoreDisposal.id.desc())
    ).all()
    return [_disposal_read(row) for row in rows]


def create_disposal(
    db: Session,
    payload: StoreDisposalCreate,
    *,
    actor: str | None = None,
    actor_user_id: int | None = None,
) -> StoreDisposalRead:
    _require_not_future(payload.disposed_on, "disposed_on")
    expiry_date, _month_only = parse_expiry(payload.expiry)
    with _write(db):
        item = get_item(db, payload.item_id)
        _refuse_archived(item)
        batch = _find_batch(db, item.id, expiry_date)
        if batch is None:
            raise NotFoundError(
                "STORE_BATCH_NOT_FOUND",
                "This Store item has no Batch with that expiry.",
                item_id=item.id,
                expiry_date=expiry_date.isoformat() if expiry_date else None,
            )
        on_hand = _load_ledger(db).disposable(
            batch.id, payload.disposed_on, as_of=organization_today()
        )
        if payload.quantity > on_hand:
            raise ValidationFailedError(
                "STORE_DISPOSAL_EXCEEDS_STOCK",
                "A Disposal cannot remove more than the Batch has on hand.",
                batch_id=batch.id,
                on_hand=on_hand,
                quantity=payload.quantity,
            )
        row = StoreDisposal(
            batch_id=batch.id,
            disposed_on=payload.disposed_on,
            quantity=payload.quantity,
            reason=payload.reason,
            note=payload.note,
            created_by_user_id=actor_user_id,
        )
        db.add(row)
        db.flush()
        append_audit(
            db,
            action="disposal.created",
            entity_type="store_disposal",
            entity_id=row.id,
            actor=actor,
            payload={
                "batch_id": batch.id,
                "disposed_on": row.disposed_on.isoformat(),
                "quantity": row.quantity,
                "reason": row.reason,
            },
        )
    return _disposal_read(
        db.scalars(
            select(StoreDisposal).where(StoreDisposal.id == row.id).options(_disposal_options())
        ).one()
    )


def delete_disposal(db: Session, disposal_id: int, *, actor: str | None = None) -> None:
    with _write(db):
        row = db.get(StoreDisposal, disposal_id)
        if row is None:
            raise NotFoundError(
                "STORE_DISPOSAL_NOT_FOUND", "Disposal not found.", disposal_id=disposal_id
            )
        batch_id = row.batch_id
        append_audit(
            db,
            action="disposal.deleted",
            entity_type="store_disposal",
            entity_id=row.id,
            actor=actor,
            payload={"batch_id": batch_id, "quantity": row.quantity, "reason": row.reason},
        )
        db.delete(row)
        db.flush()
        _remove_orphan_batches(db, [batch_id])


# ── Dashboard ────────────────────────────────────────────────────────────────


def dashboard(db: Session) -> StoreDashboard:
    current = organization_today()
    ledger = _load_ledger(db)
    batch_on_hand = ledger.on_hand(current)
    items = db.scalars(
        select(StoreItem).where(StoreItem.archived_at.is_(None)).order_by(StoreItem.code)
    ).all()
    active_ids = {item.id for item in items}
    batches = db.scalars(select(StoreBatch).options(selectinload(StoreBatch.item))).all()
    item_of = {batch.id: batch.item_id for batch in batches}

    item_on_hand = _item_totals(batch_on_hand, item_of)

    expired: list[StoreDashboardBatch] = []
    expiring: list[StoreDashboardBatch] = []
    for batch in sorted(batches, key=_batch_sort_key):
        quantity = batch_on_hand.get(batch.id, 0)
        if batch.item_id not in active_ids or batch.expiry_date is None or quantity <= 0:
            continue
        days_left = (batch.expiry_date - current).days
        row = StoreDashboardBatch(
            **_item_ref(batch.item),
            batch_id=batch.id,
            expiry_date=batch.expiry_date,
            expiry_month_only=batch.expiry_month_only,
            on_hand=quantity,
            days_left=days_left,
        )
        status = expiry_status(batch.expiry_date, today=current, notify_days=EXPIRING_SOON_DAYS)
        if status == "expired":
            expired.append(row)
        elif status == "due":
            expiring.append(row)
    expired.sort(key=lambda row: row.days_left or 0)
    expiring.sort(key=lambda row: row.days_left or 0)

    low_stock = [
        StoreDashboardLowStock(
            **_item_ref(item), on_hand=item_on_hand[item.id], minimum_level=item.minimum_level
        )
        for item in items
        if item.minimum_level is not None and item_on_hand[item.id] < item.minimum_level
    ]

    windows = ledger.usage_windows(item_of)
    shown = windows[-USAGE_WINDOWS:]
    usage_rows = [
        StoreUsageRow(**_item_ref(item), values=[values.get(item.id) for _m, values in shown])
        for item in items
        if any(item.id in values for _m, values in shown)
    ]

    suggestions: list[StoreSuggestion] = []
    for item in items:
        recent = [
            value for _month, values in windows if (value := values.get(item.id)) is not None
        ][-SUGGESTION_WINDOWS:]
        if not recent:
            continue
        average = sum(recent) / len(recent)
        on_hand = item_on_hand[item.id]
        suggested = max(0, math.ceil(average) - on_hand)
        if suggested <= 0:
            continue
        suggestions.append(
            StoreSuggestion(
                **_item_ref(item),
                average_usage=average,
                on_hand=on_hand,
                suggested=suggested,
                suggested_units=math.ceil(suggested / (item.contains_qty or 1)),
            )
        )

    return StoreDashboard(
        today=current,
        expiring_soon_days=EXPIRING_SOON_DAYS,
        expired=expired,
        expiring_soon=expiring,
        low_stock=low_stock,
        usage=StoreUsage(months=[month for month, _values in shown], rows=usage_rows),
        suggestions=suggestions,
        last_count_on=ledger.counts[-1].counted_on if ledger.counts else None,
        last_delivery_on=db.scalar(
            select(StoreDelivery.received_on).order_by(StoreDelivery.received_on.desc()).limit(1)
        ),
    )
