"""Duplicate-leave cleanup logic (audit 2026-07-02).

The pre-2026-07-02 dedup guard only looked back 2 minutes, so regenerated
leaves spawned exact-duplicate rows (398 excess rows across 65 natural-key
groups; one 300-row runaway). This module plans and applies a cleanup:

* ``plan_dedupe`` — read-only; groups non-deleted leaves by natural key
  ``(employee_id, leave_type, start_date, end_date)`` and reports which rows to
  keep (lowest id) vs drop.
* ``apply_dedupe`` — soft-deletes the duplicates, re-pointing any
  ``Document.leave_id`` from a dropped row to the survivor first.

The CLI wrapper (``backend/scripts/dedupe_leaves.py``) is dry-run by default.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Document, Leave


@dataclass
class DupeGroup:
    key: tuple
    keep_id: int
    drop_ids: list[int]


def plan_dedupe(db: Session) -> list[DupeGroup]:
    """Read-only. Return one DupeGroup per natural-key group with >1 live row."""
    rows = db.execute(
        select(Leave.id, Leave.employee_id, Leave.leave_type, Leave.start_date, Leave.end_date)
        .where(Leave.deleted_at.is_(None))
        .order_by(Leave.id)
    ).all()
    groups: dict[tuple, list[int]] = {}
    for r in rows:
        groups.setdefault((r.employee_id, r.leave_type, r.start_date, r.end_date), []).append(r.id)
    return [DupeGroup(key, ids[0], ids[1:]) for key, ids in groups.items() if len(ids) > 1]


def apply_dedupe(db: Session, groups: list[DupeGroup]) -> int:
    """Soft-delete the dropped rows (re-pointing documents first). Returns the
    number of rows soft-deleted. Idempotent: already-deleted rows are skipped."""
    now = datetime.now(UTC).replace(tzinfo=None)
    dropped = 0
    for group in groups:
        for drop_id in group.drop_ids:
            db.execute(
                Document.__table__.update()
                .where(Document.leave_id == drop_id)
                .values(leave_id=group.keep_id)
            )
            row = db.get(Leave, drop_id)
            if row is not None and row.deleted_at is None:
                row.deleted_at = now
                dropped += 1
    db.commit()
    return dropped
