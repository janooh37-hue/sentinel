"""Reverse live Armory effects without changing the original evidence."""

from __future__ import annotations

import datetime as dt
from collections.abc import Collection

from sqlalchemy import DateTime, Integer, func, select, true, type_coerce
from sqlalchemy.orm import Session

from app.api.errors import ConflictError
from app.db.models import (
    ArmoryAssignment,
    ArmoryAssignmentLine,
    ArmoryDecision,
    ArmoryDiscrepancy,
    ArmoryKit,
    ArmoryPosting,
    ArmoryPostingLine,
    ArmorySerial,
    ArmoryStock,
    User,
)
from app.db.repos import armory_repo
from app.schemas import armory as s
from app.services import armory_service as core


def _dependency(posting_id: int, blocker_id: int | None = None) -> ConflictError:
    return core.conflict(
        "armory_void_dependency",
        "This posting cannot be reversed while its effects are in use.",
        posting_id=posting_id,
        blocking_posting_id=blocker_id,
    )


def _reverse_stock(db: Session, posting_id: int, safe_id: int) -> None:
    lines = db.execute(
        select(ArmoryPostingLine.item_id, ArmoryPostingLine.batch_id, ArmoryPostingLine.stock_delta)
        .where(ArmoryPostingLine.posting_id == posting_id, ArmoryPostingLine.stock_delta != 0)
        .order_by(ArmoryPostingLine.position.desc())
    ).all()
    for item_id, batch_id, delta in lines:
        bucket = armory_repo.find_stock_row(db, safe_id=safe_id, item_id=item_id, batch_id=batch_id)
        if bucket is None or armory_repo.apply_stock_delta(db, bucket.id, -delta) is None:
            raise _dependency(posting_id)


def _clear_opening(db: Session, posting_id: int, safe_id: int) -> None:
    expected = (
        select(ArmoryPostingLine.item_id, func.sum(ArmoryPostingLine.qty).label("qty"))
        .where(ArmoryPostingLine.posting_id == posting_id)
        .group_by(ArmoryPostingLine.item_id)
        .subquery()
    )
    rows = db.execute(
        select(ArmoryStock.id, type_coerce(expected.c.qty, Integer))
        .select_from(expected)
        .outerjoin(
            ArmoryStock,
            (ArmoryStock.item_id == expected.c.item_id)
            & (ArmoryStock.safe_id == safe_id)
            & ArmoryStock.batch_id.is_(None),
        )
    ).all()
    for bucket_id, qty in rows:
        if bucket_id is None or not armory_repo.set_opening(db, bucket_id, None, expected=qty):
            raise _dependency(posting_id)


def _previous_serial_postings(
    db: Session, posting_id: int, serial_ids: Collection[int]
) -> dict[int, tuple[int, dt.datetime]]:
    if not serial_ids:
        return {}
    # Effective chronology follows ledger order, not a receipt's backdated local date.
    previous = (
        select(
            ArmoryPostingLine.serial_id,
            func.max(ArmoryPostingLine.posting_id).label("posting_id"),
        )
        .join(ArmoryPosting, ArmoryPosting.id == ArmoryPostingLine.posting_id)
        .where(
            ArmoryPostingLine.serial_id.in_(serial_ids),
            ArmoryPostingLine.posting_id < posting_id,
            ArmoryPostingLine.after_state.is_not(None),
            ArmoryPosting.voided_at.is_(None),
        )
        .group_by(ArmoryPostingLine.serial_id)
        .subquery()
    )
    return {
        serial_id: (previous_id, at)
        for serial_id, previous_id, at in db.execute(
            select(
                type_coerce(previous.c.serial_id, Integer),
                ArmoryPosting.id,
                type_coerce(
                    func.coalesce(ArmoryPosting.occurred_at, ArmoryPosting.created_at), DateTime
                ),
            ).join(ArmoryPosting, ArmoryPosting.id == previous.c.posting_id)
        )
    }


def _reverse_serials(db: Session, posting_id: int) -> set[int]:
    lines = db.execute(
        select(
            ArmoryPostingLine.serial_id,
            ArmoryPostingLine.before_state,
            ArmoryPostingLine.after_state,
            ArmoryPostingLine.before_safe_id,
            ArmoryPostingLine.after_safe_id,
        ).where(
            ArmoryPostingLine.posting_id == posting_id,
            ArmoryPostingLine.serial_id.is_not(None),
            ArmoryPostingLine.after_state.is_not(None),
        )
    ).all()
    previous = _previous_serial_postings(
        db,
        posting_id,
        [
            serial_id
            for serial_id, state, *_ in lines
            if serial_id is not None and state is not None
        ],
    )
    revised: set[int] = set()
    for serial_id, before_state, after_state, before_safe_id, after_safe_id in lines:
        assert serial_id is not None
        if before_state is None:
            previous_id, previous_at = posting_id, None
        elif serial_id in previous:
            previous_id, previous_at = previous[serial_id]
        else:
            raise _dependency(posting_id)
        if not armory_repo.transition_serial(
            db,
            serial_id,
            expected_state=after_state,
            expected_safe_id=after_safe_id,
            expected_last_posting_id=posting_id,
            state=before_state,
            safe_id=before_safe_id,
            last_posting_id=previous_id,
            at=previous_at,
        ):
            blocker_id = db.scalar(
                select(ArmorySerial.last_posting_id).where(
                    ArmorySerial.id == serial_id, ArmorySerial.last_posting_id > posting_id
                )
            )
            raise _dependency(posting_id, blocker_id)
        revised.update(
            safe_id for safe_id in (before_safe_id, after_safe_id) if safe_id is not None
        )
    return revised


def _assignment_for(db: Session, posting: ArmoryPosting) -> ArmoryAssignment | None:
    assignment_id: int | None
    if posting.kind in core.ASSIGNMENT_POSTING_KINDS:
        assignment_id = posting.id
    elif posting.kind == "return":
        assignment_id = posting.related_posting_id
    else:
        return None
    assignment = db.get(ArmoryAssignment, assignment_id) if assignment_id is not None else None
    if assignment is None:
        raise _dependency(posting.id)
    return assignment


def _close_assignment(db: Session, assignment: ArmoryAssignment) -> None:
    assignment_id, firearm_open = assignment.posting_id, assignment.firearm_open
    blocker_id = db.scalar(
        select(ArmoryPosting.id)
        .where(
            ArmoryPosting.related_posting_id == assignment_id,
            ArmoryPosting.kind == "return",
            ArmoryPosting.voided_at.is_(None),
        )
        .order_by(ArmoryPosting.id)
        .limit(1)
    )
    if blocker_id is not None:
        raise _dependency(assignment_id, blocker_id)
    lines = db.execute(
        select(ArmoryAssignmentLine.id, ArmoryAssignmentLine.qty)
        .where(ArmoryAssignmentLine.assignment_id == assignment_id)
        .order_by(ArmoryAssignmentLine.position)
    ).all()
    for line_id, qty in lines:
        if not armory_repo.set_remaining(db, line_id, expected=qty, remaining=0):
            raise _dependency(assignment_id)
    if firearm_open and not armory_repo.set_firearm_open(
        db, assignment_id, expected=True, value=False
    ):
        raise _dependency(assignment_id)


def _reopen_return(db: Session, posting_id: int, assignment: ArmoryAssignment) -> None:
    assignment_id = assignment.posting_id
    lines = db.execute(
        select(
            ArmoryPostingLine.assignment_line_id,
            ArmoryPostingLine.item_id,
            ArmoryPostingLine.serial_id,
            ArmoryPostingLine.remaining_before,
            ArmoryPostingLine.remaining_after,
        )
        .where(ArmoryPostingLine.posting_id == posting_id)
        .order_by(ArmoryPostingLine.position)
    ).all()
    serial_ids = {
        serial_id
        for _, _, serial_id, before, after in lines
        if serial_id is not None and before and after == 0
    }
    conflicts = armory_repo.open_lines_for_serials(db, serial_ids)
    if conflicts:
        raise _dependency(posting_id, min(line.assignment_id for line in conflicts.values()))

    firearm_item = db.scalar(
        select(ArmoryKit.firearm_item_id).where(ArmoryKit.id == assignment.kit_id)
    )
    reopens_firearm = any(
        item_id == firearm_item and before and after == 0 for _, item_id, _, before, after in lines
    )
    if reopens_firearm:
        responsible_id = assignment.holder_employee_id or assignment.supervisor_employee_id
        blocker_id = db.scalar(
            select(ArmoryAssignment.posting_id).where(
                ArmoryAssignment.firearm_open == true(),
                ArmoryAssignment.posting_id != assignment_id,
                func.coalesce(
                    ArmoryAssignment.holder_employee_id, ArmoryAssignment.supervisor_employee_id
                )
                == responsible_id,
            )
        )
        if blocker_id is not None:
            raise _dependency(posting_id, blocker_id)

    for line_id, _, _, before, after in lines:
        if (
            line_id is None
            or before is None
            or after is None
            or not armory_repo.set_remaining(
                db,
                line_id,
                expected=after,
                remaining=before,
            )
        ):
            raise _dependency(posting_id)
    if reopens_firearm and not armory_repo.set_firearm_open(
        db, assignment_id, expected=False, value=True
    ):
        raise _dependency(posting_id)


def _decision_finding(db: Session, posting_id: int) -> ArmoryDiscrepancy:
    finding = db.scalar(
        select(ArmoryDiscrepancy)
        .join(ArmoryDecision, ArmoryDecision.discrepancy_id == ArmoryDiscrepancy.id)
        .where(ArmoryDecision.posting_id == posting_id)
    )
    if finding is None:
        raise _dependency(posting_id)
    if finding.active_decision_posting_id != posting_id:
        raise _dependency(posting_id, finding.active_decision_posting_id)
    return finding


def _require_no_decision_dependency(db: Session, posting_id: int, safe_id: int, kind: str) -> None:
    live_decision = (
        select(ArmoryPosting.id)
        .join(ArmoryDiscrepancy, ArmoryDiscrepancy.active_decision_posting_id == ArmoryPosting.id)
        .where(ArmoryPosting.voided_at.is_(None))
        .order_by(ArmoryPosting.id)
        .limit(1)
    )
    blocker_id = db.scalar(live_decision.where(ArmoryDiscrepancy.source_posting_id == posting_id))
    if blocker_id is not None:
        raise _dependency(posting_id, blocker_id)

    # A monthly count used the full quantity for this safe/item (including all
    # of its batches). A subsequent stock correction relies on that baseline.
    line = ArmoryPostingLine
    affected_items = select(line.item_id).where(line.posting_id == posting_id)
    if kind != "opening":
        affected_items = affected_items.where(line.stock_delta != 0)
    correction_effect = (
        select(line.id).where(line.posting_id == ArmoryPosting.id, line.stock_delta != 0).exists()
    )
    blocker_id = db.scalar(
        live_decision.where(
            ArmoryPosting.safe_id == safe_id,
            ArmoryDiscrepancy.kind == "monthly_quantity",
            ArmoryDiscrepancy.source_posting_id > posting_id,
            ArmoryDiscrepancy.item_id.in_(affected_items),
            correction_effect,
        )
    )
    if blocker_id is not None:
        raise _dependency(posting_id, blocker_id)


def void(db: Session, user: User, posting_id: int, payload: s.ArmoryVoid) -> s.ArmoryPostingRead:
    reason = core.clean_text(payload.reason, "reason", min_length=1)
    with core.write(db):
        now = core.current_time()
        posting = core.get_or_404(db, ArmoryPosting, posting_id, "movement")
        if posting.voided_at is not None:
            raise core.conflict(
                "armory_already_voided", "This posting is already voided.", posting_id=posting_id
            )

        safe_id, kind = posting.safe_id, posting.kind
        assignment = _assignment_for(db, posting)
        finding = _decision_finding(db, posting_id) if kind == "decision" else None
        requires_witness = (
            kind in core.WITNESSED_VOID_KINDS and posting.witness_employee_id is not None
        )
        actor = core.actor_for(db, user, require_employee=requires_witness)
        excluded = [posting.actor_employee_id, posting.witness_employee_id]
        if assignment is not None:
            excluded.extend((assignment.holder_employee_id, assignment.supervisor_employee_id))
        elif finding is not None:
            source_recorder = db.scalar(
                select(ArmoryPosting.actor_employee_id).where(
                    ArmoryPosting.id == finding.source_posting_id
                )
            )
            excluded.extend((finding.involved_employee_id, source_recorder))
        witness = core.witness(
            db,
            payload.witness_employee_id,
            actor=actor,
            excluded=excluded,
            required=requires_witness,
        )

        _require_no_decision_dependency(db, posting_id, safe_id, kind)
        if assignment is not None and kind != "return":
            _close_assignment(db, assignment)
        _reverse_stock(db, posting_id, safe_id)
        if kind == "opening":
            _clear_opening(db, posting_id, safe_id)
        revised = _reverse_serials(db, posting_id)
        if assignment is not None and kind == "return":
            _reopen_return(db, posting_id, assignment)
        revised.add(safe_id)
        armory_repo.bump_revisions(db, revised)
        if finding is not None:
            finding.active_decision_posting_id = None
        posting.voided_at = core.naive_utc(now)
        posting.voided_by_id = user.id
        posting.void_reason = reason
        posting.void_witness_employee_id = witness.id if witness is not None else None
        core.audit(
            db,
            action="posting.voided",
            posting=posting,
            actor=actor,
            void_witness_employee_id=posting.void_witness_employee_id,
            state="voided",
            reason=reason,
        )

    return core.posting_read(db, posting_id)
