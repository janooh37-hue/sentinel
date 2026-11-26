"""Armory shift checks, monthly counts, discrepancy decisions and alerts."""

from __future__ import annotations

import datetime as dt
import hashlib
import json
from collections import defaultdict
from collections.abc import Sequence

from sqlalchemy import Integer, Select, and_, case, func, or_, select, type_coerce
from sqlalchemy.orm import Session, aliased

from app.api.errors import ConflictError
from app.db.models import (
    ARMORY_MAX_QTY,
    ArmoryAssignment,
    ArmoryAssignmentLine,
    ArmoryBatch,
    ArmoryCountLine,
    ArmoryDecision,
    ArmoryDiscrepancy,
    ArmoryItem,
    ArmoryPosting,
    ArmoryPostingLine,
    ArmorySafe,
    ArmorySerial,
    ArmoryStock,
    Employee,
    User,
)
from app.schemas import armory as s
from app.schemas.employee import WORKING_STATUSES
from app.services import armory_catalog_service as catalog
from app.services import armory_custody_service as custody
from app.services import armory_service as core
from app.services import perm_service

_RECONCILIATION_STATES = ("signed_out", "in_custody", "in_repair", "missing", "lost")
_COUNT_KINDS = ("shift_check", "monthly_count")
_SERIAL_KINDS = ("firearm", "serial")


def _snapshot_token(safe: ArmorySafe, period: str, evidence: object) -> str:
    payload = json.dumps([safe.id, period, safe.stock_revision, evidence], separators=(",", ":"))
    return hashlib.sha256(payload.encode()).hexdigest()


def _firearms(safe_id: int | None) -> Select[ArmorySerial]:
    stmt = (
        select(ArmorySerial)
        .join(ArmoryItem, ArmoryItem.id == ArmorySerial.item_id)
        .where(ArmoryItem.kind == "firearm")
        .order_by(ArmorySerial.serial_code, ArmorySerial.id)
    )
    return stmt.where(ArmorySerial.safe_id == safe_id) if safe_id is not None else stmt


def _check_roster(db: Session, safe_id: int) -> list[ArmorySerial]:
    return list(
        db.scalars(
            _firearms(safe_id).where(ArmorySerial.state.in_(("in_safe", *_RECONCILIATION_STATES)))
        )
    )


def _check_token(
    safe: ArmorySafe, window: core.ShiftWindow, expected: Sequence[ArmorySerial]
) -> str:
    return _snapshot_token(
        safe,
        window.period_key,
        sorted((row.id, row.state, row.last_posting_id) for row in expected),
    )


def _reconciliation_ids(roster: Sequence[ArmorySerial]) -> dict[str, list[int]]:
    groups: dict[str, list[int]] = {state: [] for state in _RECONCILIATION_STATES}
    for row in roster:
        if row.state is not None and row.state in groups:
            groups[row.state].append(row.id)
    return groups


def _reconciliation(
    groups: dict[str, list[int]], serials: dict[int, s.ArmorySerialRead], expected_count: int
) -> s.ArmoryCheckReconciliation:
    return s.ArmoryCheckReconciliation(
        signed_out=[serials[key] for key in groups["signed_out"]],
        in_custody=[serials[key] for key in groups["in_custody"]],
        in_repair=[serials[key] for key in groups["in_repair"]],
        missing=[serials[key] for key in groups["missing"]],
        lost=[serials[key] for key in groups["lost"]],
        assigned_count=expected_count + sum(map(len, groups.values())),
    )


def shift_check_draft(db: Session, user: User, safe_id: int) -> s.ArmoryShiftCheckDraftRead:
    now = core.current_time()
    safe = core.get_or_404(db, ArmorySafe, safe_id, "safe")
    window = core.window_at(db, now)
    roster = _check_roster(db, safe_id)
    expected = [row for row in roster if row.state == "in_safe"]
    lookup = core.Lookup(db).prime(safe_ids=[safe_id])
    cards = {row.id: row for row in core.serial_reads(db, roster, now, lookup)}
    return s.ArmoryShiftCheckDraftRead(
        safe=lookup.safe(safe_id),
        window=core.window_read(window),
        snapshot_token=_check_token(safe, window, expected),
        expected=[cards[row.id] for row in expected],
        reconciliation=_reconciliation(_reconciliation_ids(roster), cards, len(expected)),
    )


def _require_unrecorded_period(db: Session, safe_id: int, kind: str, period: str) -> None:
    count_id = db.scalar(
        select(ArmoryPosting.id).where(
            ArmoryPosting.safe_id == safe_id,
            ArmoryPosting.kind == kind,
            ArmoryPosting.period_key == period,
            ArmoryPosting.voided_at.is_(None),
        )
    )
    if count_id is not None:
        raise core.conflict(
            "armory_period_already_recorded",
            "This period already has a live count.",
            count_id=count_id,
        )


def _count_serial_missing(
    db: Session, writer: core.PostingWriter, serial: ArmorySerial, now: dt.datetime
) -> None:
    writer.serial(
        serial,
        state="missing",
        safe_id=writer.posting.safe_id,
        at=now,
        expected_state="in_safe",
        expected_safe_id=writer.posting.safe_id,
        expected_last_posting_id=serial.last_posting_id,
    )
    db.add(
        ArmoryDiscrepancy(
            source_posting_id=writer.posting.id,
            item_id=serial.item_id,
            serial_id=serial.id,
            kind="missing_serial",
            expected_qty=1,
            observed_qty=0,
        )
    )


def create_shift_check(
    db: Session, user: User, safe_id: int, payload: s.ArmoryShiftCheckCreate
) -> s.ArmoryCountRead:
    with core.write(db):
        now = core.current_time()
        safe = core.get_or_404(db, ArmorySafe, safe_id, "safe")
        window = core.window_at(db, now)
        actor = core.actor_for(db, user, require_employee=True)
        core.witness(db, payload.witness_employee_id, actor=actor)
        _require_unrecorded_period(db, safe_id, "shift_check", window.period_key)
        roster = _check_roster(db, safe_id)
        expected = [row for row in roster if row.state == "in_safe"]
        if payload.snapshot_token != _check_token(safe, window, expected):
            raise core.conflict(
                "armory_stale_check", "The shift-check draft is no longer current.", safe_id=safe_id
            )
        observed_ids = set(payload.observed_serial_ids)
        if not observed_ids.issubset(row.id for row in expected):
            raise core.invalid("observed_serial_ids", "Only expected serials can be checked.")
        absent = [row for row in expected if row.id not in observed_ids]
        if bool(absent) != payload.confirm_missing:
            raise core.invalid(
                "confirm_missing", "Confirm missing serials only when some are unchecked."
            )
        posting = core.new_posting(
            db,
            kind="shift_check",
            safe_id=safe_id,
            actor=actor,
            witness_employee_id=payload.witness_employee_id,
            occurred_on=core.local_today(now),
            occurred_at=now,
            period_key=window.period_key,
            count_context={
                "window": core.window_json(window),
                "reconciliation": _reconciliation_ids(roster),
                "reconciliation_anchor_ids": {
                    str(row.id): row.last_posting_id for row in roster if row.state != "in_safe"
                },
            },
            now=now,
        )
        expected_by_item: dict[int, list[ArmorySerial]] = defaultdict(list)
        for row in expected:
            expected_by_item[row.item_id].append(row)
        for item_id, rows in expected_by_item.items():
            codes = [row.serial_code for row in rows if row.id in observed_ids]
            db.add(
                ArmoryCountLine(
                    posting_id=posting.id,
                    item_id=item_id,
                    expected_qty=len(rows),
                    observed_qty=len(codes),
                    expected_serial_ids=[row.id for row in rows],
                    observed_serial_codes=codes,
                )
            )
        writer = core.PostingWriter(db, posting)
        for row in absent:
            _count_serial_missing(db, writer, row, now)
        writer.finish()
        core.audit(
            db,
            action="shift_check",
            posting=posting,
            actor=actor,
            period_key=window.period_key,
            missing_serial_ids=[row.id for row in absent],
        )
    return _count_reads(db, [posting], now)[0]


def _recorded_reconciliation_cards(
    db: Session, lookup: core.Lookup, postings: Sequence[ArmoryPosting], now: dt.datetime
) -> dict[int, dict[int, s.ArmorySerialRead]]:
    checks = [
        (row, row.count_context)
        for row in postings
        if row.kind == "shift_check" and row.count_context is not None
    ]
    anchor_ids = {
        key for _, context in checks for key in context["reconciliation_anchor_ids"].values()
    }
    if not anchor_ids:
        return {}
    anchors = {
        row.id: row
        for row in db.scalars(select(ArmoryPosting).where(ArmoryPosting.id.in_(anchor_ids)))
    }
    assignment_ids = {
        row.id for row in anchors.values() if row.kind in core.ASSIGNMENT_POSTING_KINDS
    }
    assignments = (
        {
            row.posting_id: row
            for row in db.scalars(
                select(ArmoryAssignment).where(ArmoryAssignment.posting_id.in_(assignment_ids))
            )
        }
        if assignment_ids
        else {}
    )
    holders = (
        {
            row.id: row.holder
            for row in core.assignment_summaries(db, list(assignments.values()), now, lookup)
        }
        if assignments
        else {}
    )
    result = {}
    for check, context in checks:
        recorded_at = check.occurred_at or check.created_at
        cards: dict[int, s.ArmorySerialRead] = {}
        for state, serial_ids in context["reconciliation"].items():
            for serial_id in serial_ids:
                serial = lookup.serial_row(serial_id)
                assert serial is not None
                anchor = anchors[context["reconciliation_anchor_ids"][str(serial_id)]]
                assignment = assignments.get(anchor.id)
                cards[serial.id] = s.ArmorySerialRead(
                    id=serial.id,
                    item=lookup.item(serial.item_id),
                    serial_code=serial.serial_code,
                    safe=lookup.safe(check.safe_id),
                    state=state,
                    state_at=anchor.occurred_at or anchor.created_at,
                    last_posting_id=anchor.id,
                    assignment_id=assignment.posting_id if assignment is not None else None,
                    holder=holders.get(anchor.id),
                    overdue_minutes=core.overdue_minutes(
                        kind=anchor.kind,
                        active=True,
                        due_at=assignment.due_at,
                        grace=assignment.grace_minutes,
                        now=recorded_at,
                    )
                    if assignment is not None
                    else None,
                )
        result[check.id] = cards
    return result


def _count_reads(
    db: Session, postings: Sequence[ArmoryPosting], now: dt.datetime
) -> list[s.ArmoryCountRead]:
    if not postings:
        return []
    ids = [row.id for row in postings]
    lines: dict[int, list[ArmoryCountLine]] = defaultdict(list)
    serial_ids: set[int] = set()
    item_ids: set[int] = set()
    for line in db.scalars(
        select(ArmoryCountLine)
        .where(ArmoryCountLine.posting_id.in_(ids))
        .order_by(ArmoryCountLine.id)
    ):
        lines[line.posting_id].append(line)
        serial_ids.update(line.expected_serial_ids)
        item_ids.add(line.item_id)
    discrepancy_ids: dict[int, list[int]] = defaultdict(list)
    for source_id, key in db.execute(
        select(ArmoryDiscrepancy.source_posting_id, ArmoryDiscrepancy.id)
        .where(ArmoryDiscrepancy.source_posting_id.in_(ids))
        .order_by(ArmoryDiscrepancy.id)
    ):
        discrepancy_ids[source_id].append(key)
    reconciled_ids: set[int] = set()
    for row in postings:
        if row.kind == "shift_check" and row.count_context is not None:
            for group in row.count_context["reconciliation"].values():
                reconciled_ids.update(group)
    lookup = core.Lookup(db).prime(
        safe_ids=[row.safe_id for row in postings],
        employee_ids=[
            key for row in postings for key in (row.actor_employee_id, row.witness_employee_id)
        ],
        user_ids=[row.created_by_id for row in postings],
        item_ids=item_ids,
        serial_ids=serial_ids | reconciled_ids,
    )
    cards = _recorded_reconciliation_cards(db, lookup, postings, now)
    reads = []
    for row in postings:
        context = row.count_context or {}
        witness = lookup.person(row.witness_employee_id)
        assert witness is not None
        window = None
        reconciliation = None
        if row.kind == "shift_check":
            window = core.window_from_json(context["window"])
            reconciliation = _reconciliation(
                context["reconciliation"],
                cards.get(row.id, {}),
                sum(len(line.expected_serial_ids) for line in lines[row.id]),
            )
        reads.append(
            s.ArmoryCountRead(
                posting=core.posting_ref(row),
                safe=lookup.safe(row.safe_id),
                actor=lookup.recorded_actor(row),
                witness=witness,
                window=window,
                month=context.get("month"),
                reconciliation=reconciliation,
                lines=[_count_line_read(lookup, line) for line in lines[row.id]],
                discrepancy_ids=discrepancy_ids[row.id],
            )
        )
    return reads


def _count_line_read(lookup: core.Lookup, line: ArmoryCountLine) -> s.ArmoryCountLineRead:
    expected_serials = []
    for key in line.expected_serial_ids:
        serial = lookup.serial_row(key)
        assert serial is not None
        expected_serials.append(
            s.ArmoryCountSerialRef(serial_id=key, serial_code=serial.serial_code)
        )
    return s.ArmoryCountLineRead(
        item=lookup.item(line.item_id),
        expected_qty=line.expected_qty,
        observed_qty=line.observed_qty,
        expected_serials=expected_serials,
        observed_serial_codes=line.observed_serial_codes,
        expected_unrecorded_qty=line.expected_unrecorded_qty,
        observed_unrecorded_qty=line.observed_unrecorded_qty,
    )


def get_count(db: Session, count_id: int) -> s.ArmoryCountRead:
    posting = core.get_or_404(db, ArmoryPosting, count_id, "count")
    if posting.kind not in _COUNT_KINDS:
        raise core.not_found("count")
    return _count_reads(db, [posting], core.current_time())[0]


def list_counts(
    db: Session,
    *,
    safe_id: int | None,
    kind: str | None,
    month: str | None,
    page: int,
    page_size: int,
) -> s.ArmoryCountPage:
    now = core.current_time()
    page, page_size, offset = core.page_bounds(page, page_size)
    stmt = select(ArmoryPosting).where(ArmoryPosting.kind.in_(_COUNT_KINDS))
    if safe_id is not None:
        core.get_or_404(db, ArmorySafe, safe_id, "safe")
        stmt = stmt.where(ArmoryPosting.safe_id == safe_id)
    if kind is not None:
        stmt = stmt.where(ArmoryPosting.kind == kind)
    if month is not None:
        stmt = stmt.where(ArmoryPosting.period_key.startswith(month, autoescape=True))
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    postings = list(
        db.scalars(
            stmt.order_by(
                ArmoryPosting.occurred_on.desc(),
                func.coalesce(ArmoryPosting.occurred_at, ArmoryPosting.created_at).desc(),
                ArmoryPosting.id.desc(),
            )
            .offset(offset)
            .limit(page_size)
        )
    )
    return s.ArmoryCountPage(
        items=_count_reads(db, postings, now), page=page, page_size=page_size, total=total
    )


def _catalogue(db: Session) -> list[ArmoryItem]:
    return sorted(
        db.scalars(select(ArmoryItem)),
        key=lambda row: (row.category, row.name_en.casefold(), row.id),
    )


def _monthly_token(safe: ArmorySafe, month: str, items: Sequence[ArmoryItem]) -> str:
    return _snapshot_token(safe, month, sorted(row.id for row in items))


def monthly_count_draft(db: Session, user: User, safe_id: int) -> s.ArmoryMonthlyCountDraftRead:
    month = core.local_today(core.current_time()).isoformat()[:7]
    safe = core.get_or_404(db, ArmorySafe, safe_id, "safe")
    items = _catalogue(db)
    return s.ArmoryMonthlyCountDraftRead(
        safe=core.Lookup(db).safe(safe_id),
        month=month,
        snapshot_token=_monthly_token(safe, month, items),
        items=[core.item_ref(row) for row in items],
    )


def _count_observations(
    items: Sequence[ArmoryItem], lines: Sequence[s.ArmoryCountObservation]
) -> dict[int, tuple[int, list[str]]]:
    catalogue = {row.id: row for row in items}
    observations: dict[int, tuple[int, list[str]]] = {}
    all_codes: set[str] = set()
    for index, line in enumerate(lines):
        path = f"lines.{index}"
        item = catalogue.get(line.item_id)
        if item is None or line.item_id in observations:
            raise core.invalid(f"{path}.item_id", "Count each catalogue item exactly once.")
        codes: list[str] = []
        if item.kind in _SERIAL_KINDS:
            if not line.serials_complete:
                raise core.invalid(
                    f"{path}.serials_complete", "Confirm the serial count is complete."
                )
            if "observed_serial_codes" not in line.model_fields_set:
                raise core.invalid(
                    f"{path}.observed_serial_codes", "Record the observed serial codes."
                )
            for position, raw in enumerate(line.observed_serial_codes):
                field = f"{path}.observed_serial_codes.{position}"
                code = core.normalize_code(raw, field)
                if code in all_codes:
                    raise core.invalid(field, "A serial code can only be counted once.")
                all_codes.add(code)
                codes.append(code)
            codes.sort()
            if line.observed_qty + len(codes) > ARMORY_MAX_QTY:
                raise core.invalid(
                    f"{path}.observed_qty", "The total observed quantity is too large."
                )
        elif line.observed_serial_codes or line.serials_complete:
            raise core.invalid(
                f"{path}.observed_serial_codes", "This item is not tracked by serial."
            )
        observations[line.item_id] = (line.observed_qty, codes)
    if len(catalogue) != len(observations):
        raise core.invalid("lines", "An explicit count is required for every catalogue item.")
    return observations


def _count_balances(db: Session, safe_id: int) -> dict[int, int]:
    batch_totals = (
        select(ArmoryStock.item_id, func.sum(ArmoryStock.on_hand).label("qty"))
        .where(ArmoryStock.safe_id == safe_id, ArmoryStock.batch_id.is_not(None))
        .group_by(ArmoryStock.item_id)
        .subquery()
    )
    return {
        item_id: qty
        for item_id, qty in db.execute(
            select(
                ArmoryStock.item_id,
                type_coerce(
                    case(
                        (ArmoryItem.kind == "expiry", func.coalesce(batch_totals.c.qty, 0)),
                        else_=ArmoryStock.on_hand,
                    ),
                    Integer,
                ),
            )
            .join(ArmoryItem, ArmoryItem.id == ArmoryStock.item_id)
            .outerjoin(batch_totals, batch_totals.c.item_id == ArmoryStock.item_id)
            .where(
                ArmoryStock.safe_id == safe_id,
                ArmoryStock.batch_id.is_(None),
                ArmoryStock.opening_qty.is_not(None),
            )
        )
    }


def _stock_evidence(db: Session, safe_id: int, item_ids: set[int]) -> dict[str, int]:
    """An item/safe revision from immutable postings and the monotone void markers.

    A matching effect always appends a greater posting ID. Voiding even an old
    effect advances the revision too, so a net-zero sequence cannot pass.
    """
    if not item_ids:
        return {}
    line = ArmoryPostingLine
    posting = ArmoryPosting
    voided_ids = case((posting.voided_at.is_not(None), posting.id))
    return {
        str(item_id): latest + voids
        for item_id, latest, voids in db.execute(
            select(line.item_id, func.max(posting.id), func.count(func.distinct(voided_ids)))
            .join(posting, posting.id == line.posting_id)
            .where(
                line.item_id.in_(item_ids),
                or_(
                    and_(
                        posting.safe_id == safe_id,
                        or_(line.stock_delta != 0, posting.kind == "opening"),
                    ),
                    line.before_safe_id == safe_id,
                    line.after_safe_id == safe_id,
                ),
            )
            .group_by(line.item_id)
        )
    }


def _record_monthly_item(
    db: Session,
    writer: core.PostingWriter,
    *,
    item: ArmoryItem,
    observed: tuple[int, list[str]],
    baseline: int | None,
    expected_serials: Sequence[ArmorySerial],
    now: dt.datetime,
) -> bool:
    qty, codes = observed
    tracked = item.kind in _SERIAL_KINDS
    expected_qty = None if baseline is None else baseline + len(expected_serials)
    if expected_qty is not None and expected_qty > ARMORY_MAX_QTY:
        raise core.invalid("lines", "The expected stock exceeds the count quantity limit.")
    posting_id = writer.posting.id
    db.add(
        ArmoryCountLine(
            posting_id=posting_id,
            item_id=item.id,
            expected_qty=expected_qty,
            observed_qty=qty + len(codes),
            expected_serial_ids=[row.id for row in expected_serials],
            observed_serial_codes=codes,
            expected_unrecorded_qty=baseline if tracked else None,
            observed_unrecorded_qty=qty if tracked else None,
        )
    )
    if tracked:
        observed_codes = set(codes)
        expected_codes = {row.serial_code for row in expected_serials}
        for row in expected_serials:
            if row.serial_code not in observed_codes:
                _count_serial_missing(db, writer, row, now)
        for code in codes:
            if code not in expected_codes:
                db.add(
                    ArmoryDiscrepancy(
                        source_posting_id=posting_id,
                        item_id=item.id,
                        unexpected_serial_code=code,
                        kind="unexpected_serial",
                        expected_qty=0,
                        observed_qty=1,
                    )
                )
    if baseline is None or baseline == qty:
        return False
    db.add(
        ArmoryDiscrepancy(
            source_posting_id=posting_id,
            item_id=item.id,
            kind="monthly_quantity",
            expected_qty=baseline,
            observed_qty=qty,
        )
    )
    return True


def create_monthly_count(
    db: Session, user: User, safe_id: int, payload: s.ArmoryMonthlyCountCreate
) -> s.ArmoryCountRead:
    with core.write(db):
        now = core.current_time()
        today = core.local_today(now)
        month = today.isoformat()[:7]
        safe = core.get_or_404(db, ArmorySafe, safe_id, "safe")
        actor = core.actor_for(db, user, require_employee=True)
        core.witness(db, payload.witness_employee_id, actor=actor)
        _require_unrecorded_period(db, safe_id, "monthly_count", month)
        items = _catalogue(db)
        if payload.snapshot_token != _monthly_token(safe, month, items):
            raise core.conflict(
                "armory_stale_count",
                "The monthly-count draft is no longer current.",
                safe_id=safe_id,
            )
        observations = _count_observations(items, payload.lines)
        expected: dict[int, list[ArmorySerial]] = defaultdict(list)
        for row in db.scalars(
            select(ArmorySerial)
            .where(ArmorySerial.safe_id == safe_id, ArmorySerial.state == "in_safe")
            .order_by(ArmorySerial.serial_code, ArmorySerial.id)
        ):
            expected[row.item_id].append(row)
        balances = _count_balances(db, safe_id)
        posting = core.new_posting(
            db,
            kind="monthly_count",
            safe_id=safe_id,
            actor=actor,
            witness_employee_id=payload.witness_employee_id,
            occurred_on=today,
            occurred_at=now,
            period_key=month,
            count_context={"month": month},
            now=now,
        )
        writer = core.PostingWriter(db, posting)
        variances = {
            item.id
            for item in items
            if _record_monthly_item(
                db,
                writer,
                item=item,
                observed=observations[item.id],
                baseline=balances.get(item.id),
                expected_serials=expected[item.id],
                now=now,
            )
        }
        writer.finish()
        if variances:
            posting.count_context = {
                "month": month,
                "stock_evidence": _stock_evidence(db, safe_id, variances),
            }
        core.audit(
            db,
            action="monthly_count",
            posting=posting,
            actor=actor,
            period_key=month,
            variance_item_ids=sorted(variances),
        )
    return _count_reads(db, [posting], now)[0]


def _allowed_outcomes(item_kind: str, finding: ArmoryDiscrepancy) -> list[s.ArmoryDecisionOutcome]:
    if finding.kind == "rounds_shortfall":
        return ["found", "used_in_training", "lost", "recording_error"]
    if finding.kind == "missing_serial":
        return ["found", "lost", "recording_error"]
    if finding.kind == "unexpected_serial":
        return ["recording_error"]
    if finding.observed_qty > finding.expected_qty:
        return ["found", "recording_error"]
    if item_kind == "ammunition":
        return ["found", "used_in_training", "lost", "recording_error"]
    return ["found", "lost", "recording_error"]


def _decision_independent(
    actor: core.Actor, finding: ArmoryDiscrepancy, source: ArmoryPosting
) -> bool:
    return (
        actor.employee is not None
        and core.is_working(actor.employee)
        and actor.user.id != source.created_by_id
        and actor.employee_id not in (source.actor_employee_id, finding.involved_employee_id)
    )


def _discrepancy_status(finding: ArmoryDiscrepancy, source: ArmoryPosting) -> s.DiscrepancyStatus:
    if source.voided_at is not None:
        return "voided"
    return "resolved" if finding.active_decision_posting_id is not None else "open"


def _discrepancy_reads(
    db: Session, user: User, rows: Sequence[tuple[ArmoryDiscrepancy, ArmoryPosting]]
) -> list[s.ArmoryDiscrepancyRead]:
    if not rows:
        return []
    lookup = core.Lookup(db).prime(
        safe_ids=[source.safe_id for _, source in rows],
        employee_ids=[
            key
            for finding, source in rows
            for key in (
                source.actor_employee_id,
                source.witness_employee_id,
                finding.involved_employee_id,
            )
        ],
        user_ids=[source.created_by_id for _, source in rows],
        item_ids=[finding.item_id for finding, _ in rows],
        serial_ids=[finding.serial_id for finding, _ in rows],
    )
    decision_ids = {
        finding.active_decision_posting_id
        for finding, _ in rows
        if finding.active_decision_posting_id is not None
    }
    decisions: dict[int, s.ArmoryDecisionRead] = {}
    if decision_ids:
        decision_rows = list(
            db.execute(
                select(ArmoryDecision, ArmoryPosting)
                .join(ArmoryPosting, ArmoryPosting.id == ArmoryDecision.posting_id)
                .where(ArmoryDecision.posting_id.in_(decision_ids))
            ).tuples()
        )
        decisions = {
            posting.id: s.ArmoryDecisionRead(posting=posting, outcome=decision.outcome)
            for (decision, _), posting in zip(
                decision_rows,
                core.posting_reads(db, [posting for _, posting in decision_rows], lookup),
                strict=True,
            )
        }
    actor = None
    if any(_discrepancy_status(finding, source) == "open" for finding, source in rows) and {
        "armory.view",
        "armory.edit",
    } <= perm_service.effective_caps(db, user):
        actor = core.actor_for(db, user, require_employee=False)
    result = []
    for finding, source in rows:
        status = _discrepancy_status(finding, source)
        item = lookup.item(finding.item_id)
        serial = lookup.serial_row(finding.serial_id)
        decision_id = finding.active_decision_posting_id
        result.append(
            s.ArmoryDiscrepancyRead(
                id=finding.id,
                kind=finding.kind,
                status=status,
                source=core.posting_ref(source),
                safe=lookup.safe(source.safe_id),
                item=item,
                serial_id=finding.serial_id,
                serial_code=serial.serial_code
                if serial is not None
                else finding.unexpected_serial_code,
                assignment_line_id=finding.assignment_line_id,
                person=lookup.person(finding.involved_employee_id),
                expected_qty=finding.expected_qty,
                observed_qty=finding.observed_qty,
                recorder=lookup.recorded_actor(source),
                source_witness=lookup.person(source.witness_employee_id),
                shortfall_reason=finding.shortfall_reason,
                reference=finding.reference,
                note=finding.note,
                allowed_outcomes=_allowed_outcomes(item.kind, finding),
                can_decide=(
                    status == "open"
                    and actor is not None
                    and _decision_independent(actor, finding, source)
                ),
                decision=decisions[decision_id] if decision_id is not None else None,
            )
        )
    return result


def list_discrepancies(
    db: Session,
    user: User,
    *,
    safe_id: int | None,
    status: str,
    discrepancy_id: int | None,
    page: int,
    page_size: int,
) -> s.ArmoryDiscrepancyPage:
    page, page_size, offset = core.page_bounds(page, page_size)
    stmt = select(ArmoryDiscrepancy, ArmoryPosting).join(
        ArmoryPosting, ArmoryPosting.id == ArmoryDiscrepancy.source_posting_id
    )
    if safe_id is not None:
        core.get_or_404(db, ArmorySafe, safe_id, "safe")
        stmt = stmt.where(ArmoryPosting.safe_id == safe_id)
    if discrepancy_id is not None:
        stmt = stmt.where(ArmoryDiscrepancy.id == discrepancy_id)
    live = ArmoryPosting.voided_at.is_(None)
    undecided = ArmoryDiscrepancy.active_decision_posting_id.is_(None)
    if status == "open":
        stmt = stmt.where(live, undecided)
    elif status == "resolved":
        stmt = stmt.where(live, ~undecided)
    elif status != "all":
        raise core.invalid("status", "Choose open, resolved or all.")
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    stmt = (
        stmt.order_by(
            case((and_(live, undecided), 0), else_=1),
            ArmoryPosting.occurred_on.desc(),
            func.coalesce(ArmoryPosting.occurred_at, ArmoryPosting.created_at).desc(),
            ArmoryPosting.id.desc(),
            ArmoryDiscrepancy.id.desc(),
        )
        .offset(offset)
        .limit(page_size)
    )
    return s.ArmoryDiscrepancyPage(
        items=_discrepancy_reads(db, user, list(db.execute(stmt).tuples())),
        page=page,
        page_size=page_size,
        total=total,
    )


def _stale_decision(discrepancy_id: int) -> ConflictError:
    return core.conflict(
        "armory_stale_decision",
        "The evidence for this decision has changed.",
        discrepancy_id=discrepancy_id,
    )


def _quantity_effect(finding: ArmoryDiscrepancy, outcome: s.ArmoryDecisionOutcome) -> int:
    diff = finding.observed_qty - finding.expected_qty
    if finding.kind == "rounds_shortfall" and outcome == "found":
        return -diff
    if finding.kind == "monthly_quantity" and (
        outcome in ("used_in_training", "lost") or (outcome == "found" and diff > 0)
    ):
        return diff
    return 0


def _decision_allocations(
    db: Session, item: ArmoryItem, batches: Sequence[s.ArmoryDecisionBatchInput], delta: int
) -> list[tuple[int | None, int]]:
    if not delta or item.kind != "expiry":
        if batches:
            raise core.invalid(
                "batches", "Batch allocations are only for expiry stock corrections."
            )
        return [(None, delta)] if delta else []
    if (
        len({row.batch_id for row in batches}) != len(batches)
        or any(row.qty == 0 for row in batches)
        or sum(row.qty for row in batches) != abs(delta)
    ):
        raise core.invalid(
            "batches", "Allocate the whole difference across distinct existing batches."
        )
    known = set(
        db.scalars(
            select(ArmoryBatch.id).where(
                ArmoryBatch.item_id == item.id,
                ArmoryBatch.id.in_([row.batch_id for row in batches]),
            )
        )
    )
    direction = 1 if delta > 0 else -1
    result: list[tuple[int | None, int]] = []
    for index, row in enumerate(batches):
        if row.batch_id not in known:
            raise core.invalid(
                f"batches.{index}.batch_id", "This batch does not belong to the item."
            )
        result.append((row.batch_id, direction * row.qty))
    return result


def decide(
    db: Session, user: User, discrepancy_id: int, payload: s.ArmoryDecisionCreate
) -> s.ArmoryDiscrepancyRead:
    with core.write(db):
        now = core.current_time()
        finding = core.get_or_404(db, ArmoryDiscrepancy, discrepancy_id, "discrepancy")
        source = core.get_or_404(db, ArmoryPosting, finding.source_posting_id, "posting")
        if source.voided_at is not None:
            raise _stale_decision(discrepancy_id)
        if finding.active_decision_posting_id is not None:
            raise core.conflict(
                "armory_already_decided",
                "This discrepancy already has a live decision.",
                discrepancy_id=discrepancy_id,
            )
        actor = core.actor_for(db, user, require_employee=True)
        if not _decision_independent(actor, finding, source):
            raise core.unprocessable(
                "armory_second_user_required",
                "Choose a different, uninvolved employee to decide.",
                discrepancy_id=discrepancy_id,
            )
        core.witness(
            db,
            payload.witness_employee_id,
            actor=actor,
            excluded=(source.actor_employee_id, finding.involved_employee_id),
        )
        note = core.clean_text(payload.note, "note", min_length=1)
        item = core.get_or_404(db, ArmoryItem, finding.item_id, "item")
        if payload.outcome not in _allowed_outcomes(item.kind, finding):
            raise core.unprocessable(
                "armory_invalid_outcome",
                "This outcome does not apply to the discrepancy.",
                discrepancy_id=discrepancy_id,
            )
        delta = _quantity_effect(finding, payload.outcome)
        if delta and finding.kind == "monthly_quantity":
            item_key = str(item.id)
            stored = (source.count_context or {}).get("stock_evidence", {}).get(item_key)
            current = _stock_evidence(db, source.safe_id, {item.id}).get(item_key, 0)
            if stored != current:
                raise _stale_decision(discrepancy_id)
        allocations = _decision_allocations(db, item, payload.batches, delta)
        serial = None
        if finding.kind == "missing_serial" and payload.outcome != "recording_error":
            serial = (
                db.get(ArmorySerial, finding.serial_id) if finding.serial_id is not None else None
            )
            if (
                serial is None
                or serial.state != "missing"
                or serial.safe_id != source.safe_id
                or serial.last_posting_id != source.id
            ):
                raise _stale_decision(discrepancy_id)
        posting = core.new_posting(
            db,
            kind="decision",
            safe_id=source.safe_id,
            actor=actor,
            occurred_on=core.local_today(now),
            occurred_at=now,
            witness_employee_id=payload.witness_employee_id,
            related_posting_id=source.id,
            note=note,
            now=now,
        )
        writer = core.PostingWriter(db, posting)
        if serial is not None:
            writer.serial(
                serial,
                state="in_safe" if payload.outcome == "found" else "lost",
                safe_id=source.safe_id,
                at=now,
                expected_state="missing",
                expected_safe_id=source.safe_id,
                expected_last_posting_id=source.id,
            )
        for batch_id, adjustment in allocations:
            writer.stock(
                item_id=item.id,
                batch_id=batch_id,
                qty=abs(adjustment),
                delta=adjustment,
                assignment_line_id=finding.assignment_line_id,
            )
        writer.finish()
        db.add(
            ArmoryDecision(
                posting_id=posting.id, discrepancy_id=discrepancy_id, outcome=payload.outcome
            )
        )
        finding.active_decision_posting_id = posting.id
        core.audit(
            db,
            action="decision",
            posting=posting,
            actor=actor,
            source_posting_id=source.id,
            discrepancy_id=discrepancy_id,
            outcome=payload.outcome,
        )
    return _discrepancy_reads(db, user, [(finding, source)])[0]


_CheckPostings = dict[tuple[int, str], tuple[ArmoryPosting, int]]


def _completed_checks(
    db: Session, windows: Sequence[core.ShiftWindow], safe_id: int | None
) -> _CheckPostings:
    stmt = (
        select(ArmoryPosting, func.count(ArmoryDiscrepancy.id))
        .outerjoin(
            ArmoryDiscrepancy,
            and_(
                ArmoryDiscrepancy.source_posting_id == ArmoryPosting.id,
                ArmoryDiscrepancy.kind == "missing_serial",
            ),
        )
        .where(
            ArmoryPosting.kind == "shift_check",
            ArmoryPosting.voided_at.is_(None),
            ArmoryPosting.period_key.in_([window.period_key for window in windows]),
        )
        .group_by(ArmoryPosting.id)
    )
    if safe_id is not None:
        stmt = stmt.where(ArmoryPosting.safe_id == safe_id)
    return {
        (posting.safe_id, posting.period_key): (posting, missing)
        for posting, missing in db.execute(stmt)
        if posting.period_key is not None
    }


def _check_slots(
    safe: ArmorySafe,
    now: dt.datetime,
    windows: Sequence[core.ShiftWindow],
    completed: _CheckPostings,
) -> list[s.ArmoryCheckSlotRead]:
    created_at = core.aware_utc(safe.created_at)
    if created_at > now:
        return []
    result = []
    for window in windows:
        if created_at >= window.ends_at:
            continue
        count = completed.get((safe.id, window.period_key))
        if count is None:
            result.append(
                s.ArmoryCheckSlotRead(
                    window=core.window_read(window),
                    status="due" if window.contains(now) else "missed",
                    count_id=None,
                    missing_count=None,
                )
            )
        else:
            posting, missing = count
            assert posting.count_context is not None
            result.append(
                s.ArmoryCheckSlotRead(
                    window=core.window_from_json(posting.count_context["window"]),
                    status="completed",
                    count_id=posting.id,
                    missing_count=missing,
                )
            )
    return result


def check_slots(db: Session, safe: ArmorySafe, now: dt.datetime) -> list[s.ArmoryCheckSlotRead]:
    now = core.aware_utc(now)
    windows = core.previous_windows(db, now)
    return _check_slots(safe, now, windows, _completed_checks(db, windows, safe.id))


def _open_assignments(safe_id: int | None) -> Select[ArmoryAssignment]:
    has_remaining = (
        select(1)
        .where(
            ArmoryAssignmentLine.assignment_id == ArmoryAssignment.posting_id,
            ArmoryAssignmentLine.remaining_qty > 0,
        )
        .exists()
    )
    query = (
        select(ArmoryAssignment)
        .join(ArmoryPosting, ArmoryPosting.id == ArmoryAssignment.posting_id)
        .where(ArmoryPosting.voided_at.is_(None), has_remaining)
    )
    return query.where(ArmoryPosting.safe_id == safe_id) if safe_id is not None else query


def _shift_issue_order(
    row: s.ArmoryAssignmentSummary,
) -> tuple[bool, dt.datetime, dt.datetime, int]:
    assert row.due_at is not None
    return row.overdue_minutes is None, row.due_at, row.issued_at, row.id


def _open_shift_issues(
    db: Session, safe_id: int | None, now: dt.datetime, *, overdue_only: bool = False
) -> list[s.ArmoryAssignmentSummary]:
    rows = list(db.scalars(_open_assignments(safe_id).where(ArmoryPosting.kind == "shift_issue")))
    if overdue_only:
        rows = [
            row
            for row in rows
            if core.overdue_minutes(
                kind="shift_issue",
                active=True,
                due_at=row.due_at,
                grace=row.grace_minutes,
                now=now,
            )
            is not None
        ]
    return sorted(core.assignment_summaries(db, rows, now), key=_shift_issue_order) if rows else []


def _returned_today(db: Session, safe_id: int | None, now: dt.datetime) -> list[s.ArmoryReturnRead]:
    issue = aliased(ArmoryPosting)
    stmt = (
        select(ArmoryPosting)
        .join(issue, issue.id == ArmoryPosting.related_posting_id)
        .where(
            ArmoryPosting.kind == "return",
            ArmoryPosting.voided_at.is_(None),
            ArmoryPosting.occurred_on == core.local_today(now),
            issue.kind == "shift_issue",
            issue.voided_at.is_(None),
        )
        .order_by(ArmoryPosting.occurred_at.desc(), ArmoryPosting.id.desc())
    )
    if safe_id is not None:
        stmt = stmt.where(ArmoryPosting.safe_id == safe_id)
    rows = list(db.scalars(stmt))
    return custody.return_reads(db, rows, now) if rows else []


def _missing_firearms(db: Session, now: dt.datetime) -> list[s.ArmorySerialRead]:
    rows = list(db.scalars(_firearms(None).where(ArmorySerial.state == "missing")))
    return core.serial_reads(db, rows, now) if rows else []


def _alerts(
    db: Session,
    *,
    safe_id: int | None,
    now: dt.datetime,
    window: core.ShiftWindow,
    missing: list[s.ArmorySerialRead],
    overdue: list[s.ArmoryAssignmentSummary],
) -> s.ArmoryAlertsRead:
    open_decisions = (
        select(func.count(ArmoryDiscrepancy.id))
        .join(ArmoryPosting, ArmoryPosting.id == ArmoryDiscrepancy.source_posting_id)
        .where(
            ArmoryPosting.voided_at.is_(None),
            ArmoryDiscrepancy.active_decision_posting_id.is_(None),
        )
    )
    has_check = (
        select(1)
        .where(
            ArmoryPosting.safe_id == ArmorySafe.id,
            ArmoryPosting.kind == "shift_check",
            ArmoryPosting.period_key == window.period_key,
            ArmoryPosting.voided_at.is_(None),
        )
        .exists()
    )
    due_checks = select(func.count(ArmorySafe.id)).where(
        ArmorySafe.created_at <= core.naive_utc(now), ~has_check
    )
    if safe_id is not None:
        open_decisions = open_decisions.where(ArmoryPosting.safe_id == safe_id)
        due_checks = due_checks.where(ArmorySafe.id == safe_id)
    former_open = (
        _open_assignments(safe_id)
        .join(
            Employee,
            Employee.id
            == func.coalesce(
                ArmoryAssignment.holder_employee_id, ArmoryAssignment.supervisor_employee_id
            ),
        )
        .where(Employee.status.not_in(WORKING_STATUSES))
        .with_only_columns(func.count(ArmoryAssignment.posting_id))
    )
    today = core.local_today(now)
    expired, expiring = catalog.batch_alert_counts(db, today, safe_id)
    return s.ArmoryAlertsRead(
        now_at=now,
        missing_firearm_count=len(missing),
        missing_firearms=missing,
        overdue_count=len(overdue),
        overdue=overdue,
        decision_count=db.scalar(open_decisions) or 0,
        due_check_count=db.scalar(due_checks) or 0,
        expired_batch_count=expired,
        expiring_batch_count=expiring,
        licences=custody.licence_counts(db, today),
        former_open_count=db.scalar(former_open) or 0,
    )


def summary(db: Session, *, safe_id: int | None) -> s.ArmoryAlertsRead:
    now = core.current_time()
    if safe_id is not None:
        core.get_or_404(db, ArmorySafe, safe_id, "safe")
    return _alerts(
        db,
        safe_id=safe_id,
        now=now,
        window=core.window_at(db, now),
        missing=_missing_firearms(db, now),
        overdue=_open_shift_issues(db, safe_id, now, overdue_only=True),
    )


def shift(db: Session, user: User, *, safe_id: int | None) -> s.ArmoryShiftRead:
    now = core.current_time()
    windows = core.previous_windows(db, now)
    window = windows[0]
    safes = (
        sorted(db.scalars(select(ArmorySafe)), key=lambda safe: (safe.name_en.casefold(), safe.id))
        if safe_id is None
        else [core.get_or_404(db, ArmorySafe, safe_id, "safe")]
    )
    lookup = core.Lookup(db).prime(safe_ids=[safe.id for safe in safes])
    rows = list(db.scalars(_firearms(safe_id).where(ArmorySerial.state != "written_off")))
    cards = core.serial_reads(db, rows, now, lookup) if rows else []
    firearms: dict[int, list[s.ArmorySerialRead]] = defaultdict(list)
    for card in cards:
        assert card.safe is not None
        firearms[card.safe.id].append(card)
    issues = _open_shift_issues(db, safe_id, now)
    out: dict[int, list[s.ArmoryAssignmentSummary]] = defaultdict(list)
    for issue in issues:
        out[issue.safe.id].append(issue)
    returned: dict[int, list[s.ArmoryReturnRead]] = defaultdict(list)
    for row in _returned_today(db, safe_id, now):
        returned[row.posting.safe.id].append(row)
    completed = _completed_checks(db, windows, safe_id)
    missing = (
        [card for card in cards if card.state == "missing"]
        if safe_id is None
        else _missing_firearms(db, now)
    )
    return s.ArmoryShiftRead(
        window=core.window_read(window),
        safes=[
            s.ArmoryShiftSafeRead(
                safe=lookup.safe(safe.id),
                firearms=firearms[safe.id],
                out=out[safe.id],
                returned_today=returned[safe.id],
                on_duty=custody.on_duty_people(db, safe.id, now),
                check_history=_check_slots(safe, now, windows, completed),
            )
            for safe in safes
        ],
        attention=_alerts(
            db,
            safe_id=safe_id,
            now=now,
            window=window,
            missing=missing,
            overdue=[issue for issue in issues if issue.overdue_minutes is not None],
        ),
    )
