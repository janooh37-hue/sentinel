"""Armory holdings: picking people, recording issue/custody, and returning lines."""

from __future__ import annotations

import datetime as dt
from collections.abc import Collection, Sequence
from dataclasses import dataclass

from sqlalchemy import func, or_, select, true
from sqlalchemy.orm import InstrumentedAttribute, Session, load_only
from sqlalchemy.sql.selectable import Exists, Select

from app.api.errors import ConflictError
from app.db.models import (
    ArmoryAssignment,
    ArmoryAssignmentLine,
    ArmoryBatch,
    ArmoryDiscrepancy,
    ArmoryGuardQualification,
    ArmoryItem,
    ArmoryKit,
    ArmoryPosting,
    ArmorySafe,
    ArmorySerial,
    Employee,
    EmployeeFormerId,
    User,
)
from app.db.repos import armory_repo
from app.schemas import armory as s
from app.schemas.employee import WORKING_STATUSES
from app.services import armory_service as core
from app.services.workforce_dashboard_service import on_site_employee_ids_at_duty_path

_PERSON_COLUMNS = load_only(Employee.id, Employee.name_en, Employee.name_ar, Employee.status)


def _matches(query: str, *values: str | None) -> bool:
    # SQLite's lower()/NOCASE only case-fold ASCII. Normalize stored labels too.
    return any(
        value and query in core.normalize_search(value, max_length=3 * len(value))
        for value in values
    )


def _matching_employee_ids(db: Session, query: str) -> set[str]:
    matching = {
        employee_id
        for employee_id, name_en, name_ar in db.execute(
            select(Employee.id, Employee.name_en, Employee.name_ar)
        )
        if _matches(query, employee_id, name_en, name_ar)
    }
    matching.update(
        employee_id
        for employee_id, former_id in db.execute(
            select(EmployeeFormerId.employee_id, EmployeeFormerId.former_id)
        )
        if _matches(query, former_id)
    )
    return matching


def _qualification_rows(
    db: Session, employee_ids: Collection[str]
) -> dict[str, ArmoryGuardQualification]:
    if not employee_ids:
        return {}
    return {
        row.employee_id: row
        for row in db.scalars(
            select(ArmoryGuardQualification).where(
                ArmoryGuardQualification.employee_id.in_(employee_ids)
            )
        )
    }


def _candidate_reads(
    db: Session,
    people: Sequence[Employee],
    on_duty: set[str],
    now: dt.datetime,
) -> list[s.ArmoryPersonCandidateRead]:
    employee_ids = [person.id for person in people]
    qualifications = _qualification_rows(db, employee_ids)
    firearms = _open_firearms(db, employee_ids)
    today = core.local_today(now)
    result = []
    for person in people:
        qualification = qualifications.get(person.id)
        result.append(
            s.ArmoryPersonCandidateRead(
                person=core.person_read(person),
                on_duty_here=person.id in on_duty,
                course_round=None if qualification is None else qualification.course_round,
                licence_status=core.licence_status(qualification, today),
                licence_expires_on=None
                if qualification is None
                else qualification.licence_expires_on,
                open_firearm=firearms.get(person.id),
            )
        )
    return result


def list_people(
    db: Session,
    user: User,
    *,
    purpose: str,
    q: str | None,
    safe_id: int | None,
    limit: int,
) -> list[s.ArmoryPersonCandidateRead]:
    if purpose not in ("issue", "custody", "witness", "qualification"):
        raise core.invalid("purpose")
    if not 1 <= limit <= 50:
        raise core.invalid("limit")
    rank_duty = purpose in ("issue", "witness")
    if (rank_duty and safe_id is None) or (purpose == "qualification" and safe_id is not None):
        raise core.invalid("safe_id")
    now = core.current_time()
    safe = None if safe_id is None else core.get_or_404(db, ArmorySafe, safe_id, "safe")
    on_duty = set() if safe is None else _duty_ids(db, safe, now)
    stmt = select(Employee).options(_PERSON_COLUMNS)
    if purpose != "qualification":
        stmt = stmt.where(Employee.status.in_(WORKING_STATUSES))
        if user.employee_id is not None:
            stmt = stmt.where(Employee.id != user.employee_id)
    query = core.normalize_search(q)
    if query:
        stmt = stmt.where(Employee.id.in_(_matching_employee_ids(db, query)))
    people = sorted(
        db.scalars(stmt),
        key=lambda person: (
            rank_duty and person.id not in on_duty,
            core.name_key(person.name_en),
            person.id,
        ),
    )
    return _candidate_reads(db, people[:limit], on_duty, now)


def on_duty_people(
    db: Session, safe_id: int, now: dt.datetime
) -> list[s.ArmoryPersonCandidateRead]:
    on_duty = _duty_ids(db, core.get_or_404(db, ArmorySafe, safe_id, "safe"), now)
    if not on_duty:
        return []
    people = sorted(
        db.scalars(
            select(Employee)
            .options(_PERSON_COLUMNS)
            .where(
                Employee.id.in_(on_duty),
                Employee.status.in_(WORKING_STATUSES),
            )
        ),
        key=lambda person: (core.name_key(person.name_en), person.id),
    )
    return _candidate_reads(db, people, on_duty, now)


def _duty_ids(db: Session, safe: ArmorySafe, now: dt.datetime) -> set[str]:
    if safe.duty_unit is None or safe.duty_post is None:
        return set()
    return on_site_employee_ids_at_duty_path(
        db, duty_unit=safe.duty_unit, duty_post=safe.duty_post, now=now
    )


def _open_firearms(
    db: Session, employee_ids: Collection[str]
) -> dict[str, s.ArmoryOpenFirearmRead]:
    if not employee_ids:
        return {}
    rows = db.execute(
        select(ArmoryAssignment, ArmoryPosting.kind, ArmoryItem, ArmorySerial)
        .join(ArmoryPosting, ArmoryPosting.id == ArmoryAssignment.posting_id)
        .join(
            ArmoryAssignmentLine, ArmoryAssignmentLine.assignment_id == ArmoryAssignment.posting_id
        )
        .join(ArmoryItem, ArmoryItem.id == ArmoryAssignmentLine.item_id)
        .join(ArmorySerial, ArmorySerial.id == ArmoryAssignmentLine.serial_id)
        .where(
            ArmoryPosting.voided_at.is_(None),
            ArmoryAssignment.firearm_open == true(),
            ArmoryAssignmentLine.remaining_qty > 0,
            ArmoryItem.kind == "firearm",
            (
                ArmoryAssignment.holder_employee_id.in_(employee_ids)
                | ArmoryAssignment.supervisor_employee_id.in_(employee_ids)
            ),
        )
    )
    result = {}
    for assignment, kind, item, serial in rows:
        employee_id = assignment.holder_employee_id or assignment.supervisor_employee_id
        assert employee_id is not None
        result[employee_id] = s.ArmoryOpenFirearmRead(
            assignment_id=assignment.posting_id,
            assignment_kind=core.assignment_kind(kind),
            item=core.item_ref(item),
            serial_id=serial.id,
            serial_code=serial.serial_code,
        )
    return result


def _recipient(db: Session, actor: core.Actor, employee_id: str, field: str) -> Employee:
    employee = core.get_or_404(db, Employee, employee_id, "employee")
    if not core.is_working(employee):
        raise core.invalid(field, "Former employees cannot receive new holdings.")
    if employee.id == actor.employee_id:
        raise core.unprocessable(
            "armory_self_issue",
            "You cannot record a handover to yourself.",
            employee_id=employee.id,
        )
    return employee


def _firearm_eligibility(
    db: Session,
    responsible: Employee | None,
    *,
    includes_firearm: bool,
    acknowledged: bool,
    today: dt.date,
) -> tuple[ArmoryGuardQualification | None, core.LicenceStatus | None]:
    if not includes_firearm:
        if acknowledged:
            raise core.invalid("licence_warning_acknowledged")
        return None, None
    assert responsible is not None
    employee_id = responsible.id
    qualification = db.get(ArmoryGuardQualification, employee_id)
    if qualification is None or qualification.course_round is None:
        raise core.unprocessable(
            "armory_course_required",
            "A passed firearm course must be recorded.",
            employee_id=employee_id,
        )
    held = _open_firearms(db, [employee_id]).get(employee_id)
    if held is not None:
        raise core.conflict(
            "armory_firearm_already_held",
            "This person already holds a firearm.",
            assignment_id=held.assignment_id,
            assignment_kind=held.assignment_kind,
            serial_id=held.serial_id,
        )
    status = core.licence_status(qualification, today)
    if status in ("missing", "expired"):
        if not acknowledged:
            raise core.unprocessable(
                "armory_licence_ack_required",
                "Acknowledge the current licence evidence warning.",
                employee_id=employee_id,
                licence_status=status,
            )
    elif acknowledged:
        raise core.invalid("licence_warning_acknowledged")
    return qualification, status


@dataclass(frozen=True, slots=True)
class _IssueLine:
    item: ArmoryItem
    qty: int
    serial: ArmorySerial | None
    batch_id: int | None


def _issue_lines(
    db: Session,
    kit: ArmoryKit,
    inputs: Sequence[s.ArmoryAssignmentLineInput],
    today: dt.date,
    excess_rounds_reason: str | None,
) -> tuple[list[_IssueLine], str | None]:
    members = (
        {row.item_id: row for row in core.kit_lines(db, kit.id)}
        if kit.firearm_item_id is not None
        else {}
    )
    items = {
        row.id: row
        for row in db.scalars(
            select(ArmoryItem).where(ArmoryItem.id.in_({p.item_id for p in inputs}))
        )
    }
    serial_ids = {line.serial_id for line in inputs if line.serial_id is not None}
    serials = (
        {
            row.id: row
            for row in db.scalars(select(ArmorySerial).where(ArmorySerial.id.in_(serial_ids)))
        }
        if serial_ids
        else {}
    )
    batch_ids = {line.batch_id for line in inputs if line.batch_id is not None}
    batches = (
        {
            row.id: row
            for row in db.scalars(select(ArmoryBatch).where(ArmoryBatch.id.in_(batch_ids)))
        }
        if batch_ids
        else {}
    )

    firearm_count = 0
    excess_rounds = False
    seen_serials: set[int] = set()
    seen_buckets: set[tuple[int, int | None]] = set()
    chosen_slots: dict[int, int] = {}
    resolved = []
    for index, line in enumerate(inputs):
        field = f"lines.{index}"
        item = items.get(line.item_id)
        if item is None:
            raise core.not_found("item")
        if line.qty < 1:
            raise core.invalid(f"{field}.qty")
        if item.kind == "firearm":
            if item.id != kit.firearm_item_id or firearm_count:
                raise core.invalid(
                    f"{field}.item_id", "A firearm kit takes exactly its own firearm."
                )
            firearm_count += 1
        elif kit.firearm_item_id is not None:
            member = members.get(item.id)
            if member is None or (item.kind == "ammunition" and member.role != "default"):
                raise core.invalid(f"{field}.item_id", "This item is not part of the selected kit.")
            slot = member.substitutes_item_id or item.id
            if chosen_slots.setdefault(slot, item.id) != item.id:
                raise core.invalid(f"{field}.item_id", "Choose one item for this kit slot.")
            if item.kind == "ammunition" and line.qty > member.default_qty:
                excess_rounds = True
        elif item.kind == "ammunition":
            raise core.invalid(f"{field}.item_id", "The equipment kit does not take ammunition.")

        serial = None
        if item.kind in ("firearm", "serial"):
            if line.serial_id is None or line.serial_id in seen_serials:
                raise core.invalid(f"{field}.serial_id", "Choose a distinct registered serial.")
            if line.qty != 1:
                raise core.invalid(f"{field}.qty")
            if line.batch_id is not None:
                raise core.invalid(f"{field}.batch_id")
            serial = serials.get(line.serial_id)
            if serial is None:
                raise core.serial_unavailable(line.serial_id)
            if serial.item_id != item.id:
                raise core.invalid(f"{field}.serial_id", "This serial belongs to another item.")
            seen_serials.add(line.serial_id)
        else:
            if line.serial_id is not None:
                raise core.invalid(f"{field}.serial_id")
            if item.kind == "expiry":
                if line.batch_id is None:
                    raise core.invalid(f"{field}.batch_id", "Select a batch.")
                batch = batches.get(line.batch_id)
                if batch is None:
                    raise core.not_found("batch")
                if batch.item_id != item.id:
                    raise core.invalid(f"{field}.batch_id", "This batch belongs to another item.")
                if core.batch_status(batch.expires_on, today) == "expired":
                    raise core.unprocessable(
                        "armory_expired_batch",
                        "An expired batch cannot be issued.",
                        batch_id=batch.id,
                    )
            elif line.batch_id is not None:
                raise core.invalid(f"{field}.batch_id")
            bucket = (item.id, line.batch_id)
            if bucket in seen_buckets:
                raise core.invalid(f"{field}.item_id", "This quantity line is repeated.")
            seen_buckets.add(bucket)
        resolved.append(_IssueLine(item, line.qty, serial, line.batch_id))

    if kit.firearm_item_id is not None and not firearm_count:
        raise core.invalid("lines", "A firearm kit must include its firearm.")
    reason = (
        core.clean_text(excess_rounds_reason, "excess_rounds_reason", min_length=core.NOTE_MIN)
        if excess_rounds
        else core.optional_text(excess_rounds_reason, "excess_rounds_reason")
    )
    return resolved, reason


def _write_assignment(
    db: Session,
    actor: core.Actor,
    posting: ArmoryPosting,
    assignment: ArmoryAssignment,
    lines: Sequence[_IssueLine],
    now: dt.datetime,
) -> None:
    db.add(assignment)
    db.flush()
    writer = core.PostingWriter(db, posting)
    target_state = "signed_out" if posting.kind == "shift_issue" else "in_custody"
    for position, resolved in enumerate(lines, start=1):
        serial = resolved.serial
        if serial is not None and (serial.state != "in_safe" or serial.safe_id != posting.safe_id):
            raise core.serial_unavailable(serial.id)
        line = ArmoryAssignmentLine(
            assignment_id=posting.id,
            position=position,
            item_id=resolved.item.id,
            serial_id=serial.id if serial is not None else None,
            batch_id=resolved.batch_id,
            qty=resolved.qty,
            remaining_qty=resolved.qty,
        )
        db.add(line)
        db.flush()
        if serial is not None:
            writer.serial(
                serial,
                state=target_state,
                safe_id=posting.safe_id,
                at=now,
                expected_state="in_safe",
                expected_safe_id=posting.safe_id,
                expected_last_posting_id=serial.last_posting_id,
                assignment_line_id=line.id,
                remaining_before=0,
                remaining_after=line.qty,
            )
        else:
            writer.stock(
                item_id=line.item_id,
                qty=line.qty,
                delta=-line.qty,
                batch_id=line.batch_id,
                assignment_line_id=line.id,
                remaining_before=0,
                remaining_after=line.qty,
            )
    writer.finish()
    core.audit(
        db,
        action=posting.kind,
        posting=posting,
        actor=actor,
        state="active",
        holder_employee_id=assignment.holder_employee_id,
        holder_safe_id=assignment.holder_safe_id,
        supervisor_employee_id=assignment.supervisor_employee_id,
        kit_id=assignment.kit_id,
        licence_status=assignment.licence_status_at_issue,
        licence_warning_acknowledged=assignment.licence_warning_acknowledged,
    )


def get_issue(db: Session, issue_id: int) -> s.ArmoryAssignmentRead:
    return core.assignment_read(db, issue_id, core.current_time(), kind="shift_issue")


def create_issue(
    db: Session, user: User, payload: s.ArmoryShiftIssueCreate
) -> s.ArmoryAssignmentRead:
    with core.write(db):
        now = core.current_time()
        today = core.local_today(now)
        actor = core.actor_for(db, user, require_employee=True)
        safe = core.get_or_404(db, ArmorySafe, payload.safe_id, "safe")
        holder = _recipient(db, actor, payload.employee_id, "employee_id")
        kit = core.get_or_404(db, ArmoryKit, payload.kit_id, "kit")

        if payload.off_duty_reason is None and holder.id not in _duty_ids(db, safe, now):
            raise core.unprocessable(
                "armory_off_duty_reason_required",
                "Choose a reason when the recipient is not on duty at this safe.",
                employee_id=holder.id,
            )
        note = (
            core.clean_text(payload.off_duty_note, "off_duty_note", min_length=core.NOTE_MIN)
            if payload.off_duty_reason == "other"
            else core.optional_text(payload.off_duty_note, "off_duty_note")
        )
        if note is not None and payload.off_duty_reason is None:
            raise core.invalid("off_duty_note", "Choose an off-duty reason first.")

        window = core.window_at(db, now)
        due = payload.due_at or window.ends_at
        if not now < due <= window.next_ends_at:
            raise core.unprocessable(
                "armory_due_out_of_range",
                "Due must be after the issue time and no later than the next shift end.",
                earliest_exclusive=now.isoformat(),
                latest_inclusive=window.next_ends_at.isoformat(),
            )
        includes_firearm = kit.firearm_item_id is not None
        lines, excess_reason = _issue_lines(
            db, kit, payload.lines, today, payload.excess_rounds_reason
        )
        qualification, status = _firearm_eligibility(
            db,
            holder,
            includes_firearm=includes_firearm,
            acknowledged=payload.licence_warning_acknowledged,
            today=today,
        )
        posting = core.new_posting(
            db,
            kind="shift_issue",
            safe_id=safe.id,
            actor=actor,
            occurred_on=today,
            occurred_at=now,
            now=now,
        )
        posting_id = posting.id
        assignment = ArmoryAssignment(
            posting_id=posting_id,
            holder_kind="person",
            holder_employee_id=holder.id,
            kit_id=kit.id,
            firearm_open=includes_firearm,
            course_round_snapshot=qualification.course_round if qualification is not None else None,
            licence_status_at_issue=status,
            licence_warning_acknowledged=payload.licence_warning_acknowledged,
            off_duty_reason=payload.off_duty_reason,
            off_duty_note=note,
            excess_rounds_reason=excess_reason,
            due_at=core.naive_utc(due),
            grace_minutes=window.grace_minutes,
            shift_window=core.window_json(window),
        )
        _write_assignment(db, actor, posting, assignment, lines, now)
    return core.assignment_read(db, posting_id, now, kind="shift_issue")


def _has_remaining(assignment_id: int | InstrumentedAttribute[int]) -> Exists:
    return (
        select(1)
        .where(
            ArmoryAssignmentLine.assignment_id == assignment_id,
            ArmoryAssignmentLine.remaining_qty > 0,
        )
        .exists()
    )


def _stale_return(assignment_id: int, line_id: int) -> ConflictError:
    return core.conflict(
        "armory_stale_return",
        "This assignment line changed; reload the outstanding quantities.",
        assignment_id=assignment_id,
        assignment_line_id=line_id,
    )


@dataclass(frozen=True, slots=True)
class _ReturnLine:
    assignment_line: ArmoryAssignmentLine
    item_kind: str
    qty: int
    condition: s.ReturnCondition | None
    fault_note: str | None
    shortfall: tuple[s.ShortfallReason, str, str | None] | None


def _return_lines(
    db: Session,
    assignment: ArmoryPosting,
    inputs: Sequence[s.ArmoryReturnLineInput],
    prefix: str,
) -> list[_ReturnLine]:
    rows = {
        line.id: (line, kind)
        for line, kind in db.execute(
            select(ArmoryAssignmentLine, ArmoryItem.kind)
            .join(ArmoryItem, ArmoryItem.id == ArmoryAssignmentLine.item_id)
            .where(
                ArmoryAssignmentLine.assignment_id == assignment.id,
                ArmoryAssignmentLine.id.in_({row.assignment_line_id for row in inputs}),
            )
        )
    }
    resolved = []
    seen: set[int] = set()
    for index, request in enumerate(inputs):
        field = f"{prefix}lines.{index}"
        line_id = request.assignment_line_id
        if line_id not in rows or line_id in seen:
            raise core.invalid(
                f"{field}.assignment_line_id", "Select a distinct line on this assignment."
            )
        seen.add(line_id)
        line, kind = rows[line_id]
        remaining = line.remaining_qty
        if (
            assignment.voided_at is not None
            or remaining == 0
            or remaining != request.expected_remaining_qty
        ):
            raise _stale_return(assignment.id, line_id)

        returns_rounds = kind == "ammunition"
        qty = request.returned_qty
        if qty > remaining or (not returns_rounds and qty != remaining):
            raise core.invalid(f"{field}.returned_qty", "Confirm a valid quantity for this line.")
        has_shortfall = returns_rounds and qty < remaining
        shortfall = request.shortfall
        if has_shortfall != (shortfall is not None):
            raise core.invalid(
                f"{field}.shortfall", "Record evidence only for an actual rounds shortfall."
            )
        shortfall_evidence = None
        if shortfall is not None:
            reference = core.clean_text(
                shortfall.reference,
                f"{field}.shortfall.reference",
                min_length=3,
                max_length=80,
            )
            if sum(char.isalpha() or char.isdigit() for char in reference) < 2:
                raise core.invalid(
                    f"{field}.shortfall.reference", "Include at least two letters or digits."
                )
            note = (
                core.clean_text(shortfall.note, f"{field}.shortfall.note", min_length=core.NOTE_MIN)
                if shortfall.reason == "other"
                else core.optional_text(shortfall.note, f"{field}.shortfall.note")
            )
            shortfall_evidence = (shortfall.reason, reference, note)

        condition: s.ReturnCondition | None = None
        fault_note = None
        if line.serial_id is not None:
            condition = request.condition or "ok"
        elif request.condition is not None:
            raise core.invalid(
                f"{field}.condition", "Only a serialized item has a return condition."
            )
        if condition == "repair":
            fault_note = core.clean_text(
                request.fault_note, f"{field}.fault_note", min_length=core.NOTE_MIN
            )
        elif request.fault_note is not None:
            raise core.invalid(f"{field}.fault_note", "Only a repair return has a fault note.")

        resolved.append(_ReturnLine(line, kind, qty, condition, fault_note, shortfall_evidence))
    return resolved


def _record_return(
    db: Session,
    user: User,
    payload: s.ArmoryReturnCreate,
    now: dt.datetime,
    *,
    bulk_safe_id: int | None = None,
    prefix: str = "",
) -> int:
    assignment_id = payload.assignment_id
    assignment = core.get_or_404(db, ArmoryAssignment, assignment_id, "assignment")
    source = core.get_or_404(db, ArmoryPosting, assignment_id, "assignment")
    if bulk_safe_id is not None and (
        source.kind != "shift_issue" or source.safe_id != bulk_safe_id
    ):
        raise core.invalid(
            f"{prefix}assignment_id", "Bulk return takes only shift issues from the selected safe."
        )
    lines = _return_lines(db, source, payload.lines, prefix)
    witnessed = source.kind == "custody" or any(row.shortfall is not None for row in lines)
    actor = core.actor_for(db, user, require_employee=witnessed)
    involved = (assignment.holder_employee_id, assignment.supervisor_employee_id)
    witness = core.witness(
        db, payload.witness_employee_id, actor=actor, excluded=involved, required=witnessed
    )
    posting = core.new_posting(
        db,
        kind="return",
        safe_id=source.safe_id,
        actor=actor,
        occurred_on=core.local_today(now),
        occurred_at=now,
        related_posting_id=assignment_id,
        witness_employee_id=witness.id if witness is not None else None,
        now=now,
    )
    writer = core.PostingWriter(db, posting)
    expected_state = "signed_out" if source.kind == "shift_issue" else "in_custody"
    discrepancy_ids: list[int] = []
    for resolved in lines:
        line = resolved.assignment_line
        line_id = line.id
        before = line.remaining_qty
        if not armory_repo.set_remaining(db, line_id, expected=before, remaining=0):
            raise _stale_return(assignment_id, line_id)
        if line.serial_id is not None:
            serial = db.get(ArmorySerial, line.serial_id)
            if serial is None:
                raise core.serial_unavailable(line.serial_id)
            writer.serial(
                serial,
                state="in_repair" if resolved.condition == "repair" else "in_safe",
                safe_id=source.safe_id,
                at=now,
                expected_state=expected_state,
                expected_safe_id=source.safe_id,
                expected_last_posting_id=serial.last_posting_id,
                assignment_line_id=line_id,
                remaining_before=before,
                remaining_after=0,
                condition=resolved.condition,
                fault_note=resolved.fault_note,
            )
            if resolved.item_kind == "firearm" and not armory_repo.set_firearm_open(
                db, assignment_id, expected=True, value=False
            ):
                raise core.write_conflict()
        elif resolved.qty:
            writer.stock(
                item_id=line.item_id,
                qty=resolved.qty,
                delta=resolved.qty,
                batch_id=line.batch_id,
                assignment_line_id=line_id,
                remaining_before=before,
                remaining_after=0,
            )
        else:
            writer.evidence(
                item_id=line.item_id,
                qty=0,
                assignment_line_id=line_id,
                remaining_before=before,
                remaining_after=0,
            )
        if resolved.shortfall is not None:
            reason, reference, note = resolved.shortfall
            discrepancy = ArmoryDiscrepancy(
                source_posting_id=posting.id,
                item_id=line.item_id,
                assignment_line_id=line_id,
                kind="rounds_shortfall",
                expected_qty=before,
                observed_qty=resolved.qty,
                involved_employee_id=involved[0] or involved[1],
                shortfall_reason=reason,
                reference=reference,
                note=note,
            )
            db.add(discrepancy)
            db.flush()
            discrepancy_ids.append(discrepancy.id)
    writer.finish()
    core.audit(
        db,
        action="return",
        posting=posting,
        actor=actor,
        assignment_id=assignment_id,
        state="active" if db.scalar(select(_has_remaining(assignment_id))) else "ended",
        assignment_line_ids=[row.assignment_line_id for row in payload.lines],
        discrepancy_ids=discrepancy_ids,
    )
    return posting.id


def return_reads(
    db: Session, return_postings: Sequence[ArmoryPosting], now: dt.datetime
) -> list[s.ArmoryReturnRead]:
    if not return_postings:
        return []
    assignments = list(
        db.scalars(
            select(ArmoryAssignment).where(
                ArmoryAssignment.posting_id.in_(
                    {posting.related_posting_id for posting in return_postings}
                )
            )
        )
    )
    lookup = core.Lookup(db)
    summaries = {row.id: row for row in core.assignment_summaries(db, assignments, now, lookup)}
    result = []
    for posting in core.posting_reads(db, return_postings, lookup):
        assignment_id = posting.related_posting_id
        assert assignment_id is not None
        result.append(s.ArmoryReturnRead(posting=posting, assignment=summaries[assignment_id]))
    return result


def create_return(db: Session, user: User, payload: s.ArmoryReturnCreate) -> s.ArmoryReturnRead:
    with core.write(db):
        now = core.current_time()
        posting_id = _record_return(db, user, payload, now)
    return return_reads(db, [core.get_or_404(db, ArmoryPosting, posting_id, "return")], now)[0]


def create_bulk_return(
    db: Session, user: User, payload: s.ArmoryBulkReturnCreate
) -> list[s.ArmoryReturnRead]:
    with core.write(db):
        now = core.current_time()
        core.get_or_404(db, ArmorySafe, payload.safe_id, "safe")
        assignment_ids: set[int] = set()
        posting_ids = []
        for index, record in enumerate(payload.records):
            prefix = f"records.{index}."
            if record.assignment_id in assignment_ids:
                raise core.invalid(
                    f"{prefix}assignment_id", "An assignment may appear only once per batch."
                )
            assignment_ids.add(record.assignment_id)
            posting_ids.append(
                _record_return(db, user, record, now, bulk_safe_id=payload.safe_id, prefix=prefix)
            )
    postings = {
        row.id: row
        for row in db.scalars(select(ArmoryPosting).where(ArmoryPosting.id.in_(posting_ids)))
    }
    return return_reads(db, [postings[posting_id] for posting_id in posting_ids], now)


def get_custody(db: Session, custody_id: int) -> s.ArmoryAssignmentRead:
    return core.assignment_read(db, custody_id, core.current_time(), kind="custody")


def create_custody(
    db: Session, user: User, payload: s.ArmoryCustodyCreate
) -> s.ArmoryAssignmentRead:
    with core.write(db):
        now = core.current_time()
        today = core.local_today(now)
        actor = core.actor_for(db, user, require_employee=True)
        actor_employee = actor.employee
        assert actor_employee is not None
        safe = core.get_or_404(db, ArmorySafe, payload.safe_id, "safe")
        kit = core.get_or_404(db, ArmoryKit, payload.kit_id, "kit")
        includes_firearm = kit.firearm_item_id is not None

        holder: Employee | ArmorySafe
        responsible: Employee | None
        supervisor: Employee | None = None
        if payload.holder_kind == "person":
            if payload.holder_employee_id is None:
                raise core.invalid("holder_employee_id")
            if payload.holder_safe_id is not None:
                raise core.invalid("holder_safe_id")
            if payload.supervisor_employee_id is not None:
                raise core.invalid("supervisor_employee_id")
            holder = responsible = _recipient(
                db, actor, payload.holder_employee_id, "holder_employee_id"
            )
        else:
            if payload.holder_employee_id is not None:
                raise core.invalid("holder_employee_id")
            if payload.holder_safe_id is None:
                raise core.invalid("holder_safe_id")
            holder = core.get_or_404(db, ArmorySafe, payload.holder_safe_id, "safe")
            if payload.supervisor_employee_id is not None:
                supervisor = _recipient(
                    db, actor, payload.supervisor_employee_id, "supervisor_employee_id"
                )
            elif includes_firearm:
                raise core.invalid(
                    "supervisor_employee_id",
                    "Name an active supervisor for firearm custody at a site.",
                )
            responsible = supervisor
        holder_employee_id = holder.id if isinstance(holder, Employee) else None
        holder_safe_id = holder.id if isinstance(holder, ArmorySafe) else None
        supervisor_id = None if supervisor is None else supervisor.id

        lines, excess_reason = _issue_lines(
            db, kit, payload.lines, today, payload.excess_rounds_reason
        )
        qualification, status = _firearm_eligibility(
            db,
            responsible,
            includes_firearm=includes_firearm,
            acknowledged=payload.licence_warning_acknowledged,
            today=today,
        )
        condition_note = core.optional_text(payload.condition_note, "condition_note")
        posting = core.new_posting(
            db,
            kind="custody",
            safe_id=safe.id,
            actor=actor,
            occurred_on=today,
            occurred_at=now,
            note=condition_note,
            now=now,
        )
        posting_id = posting.id
        receipt = s.ArmoryCustodyReceiptRead(
            record_ref=core.record_ref("custody", posting_id),
            issued_at=now,
            source_safe=s.ArmoryNameRead.model_validate(safe),
            holder=s.ArmoryNameRead.model_validate(holder),
            holder_employee_id=holder_employee_id,
            supervisor=None if supervisor is None else s.ArmoryNameRead.model_validate(supervisor),
            supervisor_employee_id=supervisor_id,
            armorer=s.ArmoryNameRead.model_validate(actor_employee),
            firearm_included=includes_firearm,
            licence_number=None if qualification is None else qualification.licence_number,
            condition_note=condition_note,
            lines=[
                s.ArmoryCustodyReceiptLineRead(
                    item=core.item_ref(line.item),
                    qty=line.qty,
                    serial_code=None if line.serial is None else line.serial.serial_code,
                )
                for line in lines
            ],
        )
        assignment = ArmoryAssignment(
            posting_id=posting_id,
            holder_kind=payload.holder_kind,
            holder_employee_id=holder_employee_id,
            holder_safe_id=holder_safe_id,
            supervisor_employee_id=supervisor_id,
            kit_id=kit.id,
            firearm_open=includes_firearm,
            course_round_snapshot=None if qualification is None else qualification.course_round,
            licence_status_at_issue=status,
            licence_warning_acknowledged=payload.licence_warning_acknowledged,
            excess_rounds_reason=excess_reason,
            receipt_snapshot=receipt.model_dump(mode="json"),
        )
        _write_assignment(db, actor, posting, assignment, lines, now)
    return core.assignment_read(db, posting_id, now, kind="custody")


_ISSUANCE_DESC = (
    func.coalesce(ArmoryPosting.occurred_at, ArmoryPosting.created_at).desc(),
    ArmoryPosting.id.desc(),
)
_LICENCE_ORDER = {"expiring": 0, "expired": 1, "missing": 2, "valid": 3}


def _assignment_query() -> Select[ArmoryAssignment]:
    return select(ArmoryAssignment).join(
        ArmoryPosting, ArmoryPosting.id == ArmoryAssignment.posting_id
    )


def _open_assignment_order(
    row: s.ArmoryAssignmentSummary,
) -> tuple[int, dt.datetime | None, dt.datetime | None, int]:
    # Keep custody newest-first from the query; open shifts sort by urgency.
    if row.kind == "custody":
        return 2, None, None, 0
    return int(row.overdue_minutes is None), row.due_at, row.issued_at, row.id


def _open_assignments(
    db: Session,
    employee_ids: Collection[str],
    now: dt.datetime,
) -> dict[str, list[s.ArmoryAssignmentSummary]]:
    if not employee_ids:
        return {}
    rows = list(
        db.scalars(
            _assignment_query()
            .where(
                or_(
                    ArmoryAssignment.holder_employee_id.in_(employee_ids),
                    ArmoryAssignment.supervisor_employee_id.in_(employee_ids),
                ),
                ArmoryPosting.voided_at.is_(None),
                _has_remaining(ArmoryAssignment.posting_id),
            )
            .order_by(*_ISSUANCE_DESC)
        )
    )
    grouped: dict[str, list[s.ArmoryAssignmentSummary]] = {
        employee_id: [] for employee_id in employee_ids
    }
    for row, summary in zip(rows, core.assignment_summaries(db, rows, now), strict=True):
        employee_id = row.holder_employee_id or row.supervisor_employee_id
        assert employee_id is not None
        grouped[employee_id].append(summary)
    for group in grouped.values():
        group.sort(key=_open_assignment_order)
    return grouped


def _guard_reads(
    db: Session,
    rows: Sequence[tuple[Employee, ArmoryGuardQualification | None]],
    now: dt.datetime,
) -> list[s.ArmoryGuardRead]:
    holdings = _open_assignments(db, [person.id for person, _ in rows], now)
    today = core.local_today(now)
    return [
        s.ArmoryGuardRead(
            person=core.person_read(person),
            qualification=core.qualification_read(qualification, today),
            open_assignments=holdings[person.id],
        )
        for person, qualification in rows
    ]


def list_guards(
    db: Session,
    *,
    q: str | None,
    licence_status: str | None,
    include_former: bool,
    page: int,
    page_size: int,
) -> s.ArmoryGuardPage:
    page, page_size, offset = core.page_bounds(page, page_size)
    if licence_status is not None and licence_status not in _LICENCE_ORDER:
        raise core.invalid("licence_status")
    now = core.current_time()
    today = core.local_today(now)
    stmt = (
        select(Employee, ArmoryGuardQualification)
        .options(_PERSON_COLUMNS)
        .outerjoin(ArmoryGuardQualification, ArmoryGuardQualification.employee_id == Employee.id)
        .where(
            or_(
                ArmoryGuardQualification.employee_id.is_not(None),
                select(1).where(ArmoryAssignment.holder_employee_id == Employee.id).exists(),
                select(1).where(ArmoryAssignment.supervisor_employee_id == Employee.id).exists(),
            )
        )
    )
    if not include_former:
        stmt = stmt.where(Employee.status.in_(WORKING_STATUSES))
    query = core.normalize_search(q)
    if query:
        stmt = stmt.where(Employee.id.in_(_matching_employee_ids(db, query)))
    counts = dict.fromkeys(_LICENCE_ORDER, 0)
    matches: list[tuple[Employee, ArmoryGuardQualification | None, core.LicenceStatus]] = []
    for person, qualification in db.execute(stmt):
        status = core.licence_status(qualification, today)
        if qualification is not None and core.is_working(person):
            counts[status] += 1
        if licence_status is None or licence_status == status:
            matches.append((person, qualification, status))
    matches.sort(key=lambda row: (not core.is_working(row[0]), _LICENCE_ORDER[row[2]], row[0].id))
    visible = [
        (person, qualification) for person, qualification, _ in matches[offset : offset + page_size]
    ]
    return s.ArmoryGuardPage(
        items=_guard_reads(db, visible, now),
        page=page,
        page_size=page_size,
        total=len(matches),
        filter_counts=s.ArmoryLicenceCounts(**counts),
    )


def licence_counts(db: Session, today: dt.date) -> s.ArmoryLicenceCounts:
    counts = dict.fromkeys(_LICENCE_ORDER, 0)
    for qualification in db.scalars(
        select(ArmoryGuardQualification)
        .options(load_only(ArmoryGuardQualification.licence_expires_on))
        .join(Employee, Employee.id == ArmoryGuardQualification.employee_id)
        .where(Employee.status.in_(WORKING_STATUSES))
    ):
        counts[core.licence_status(qualification, today)] += 1
    return s.ArmoryLicenceCounts(**counts)


def get_guard(db: Session, employee_id: str) -> s.ArmoryGuardRead:
    now = core.current_time()
    person = core.get_or_404(db, Employee, employee_id, "employee")
    qualification = db.get(ArmoryGuardQualification, employee_id)
    return _guard_reads(db, [(person, qualification)], now)[0]


def save_qualification(
    db: Session,
    user: User,
    employee_id: str,
    payload: s.ArmoryQualificationUpsert,
    if_match: str | None,
) -> s.ArmoryGuardRead:
    with core.write(db):
        now = core.current_time()
        actor = core.actor_for(db, user, require_employee=False)
        person = core.get_or_404(db, Employee, employee_id, "employee")
        if not core.is_working(person):
            raise core.invalid("employee_id", "A former employee's qualification is read-only.")
        qualification = db.get(ArmoryGuardQualification, employee_id)
        version = 0 if qualification is None else qualification.version
        core.require_version(if_match, version)
        number = payload.licence_number
        expiry = payload.licence_expires_on
        if number is not None:
            number = core.clean_text(number, "licence_number", max_length=80)
            if expiry is None:
                raise core.invalid("licence_expires_on", "Record licence evidence as a pair.")
        elif expiry is not None:
            raise core.invalid("licence_number", "Record licence evidence as a pair.")
        if qualification is None:
            qualification = ArmoryGuardQualification(employee_id=employee_id)
            db.add(qualification)
        qualification.course_round = payload.course_round
        qualification.licence_number = number
        qualification.licence_expires_on = expiry
        qualification.version = version + 1
        qualification.updated_at = core.naive_utc(now)
        qualification.updated_by_id = user.id
        core.audit(
            db,
            action="qualification_saved",
            posting=None,
            actor=actor,
            entity_type="armory_guard_qualification",
            entity_id=employee_id,
            version=version + 1,
            course_round=payload.course_round,
            licence_status=core.licence_status(qualification, core.local_today(now)),
        )
    return _guard_reads(db, [(person, qualification)], now)[0]


def _assignment_page(
    db: Session,
    stmt: Select[ArmoryAssignment],
    now: dt.datetime,
    *,
    page: int,
    page_size: int,
) -> s.ArmoryAssignmentPage:
    page, page_size, offset = core.page_bounds(page, page_size)
    total = db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery())) or 0
    rows = list(db.scalars(stmt.order_by(*_ISSUANCE_DESC).limit(page_size).offset(offset)))
    return s.ArmoryAssignmentPage(
        items=core.assignment_summaries(db, rows, now),
        page=page,
        page_size=page_size,
        total=total,
    )


def list_custody(
    db: Session,
    *,
    safe_id: int | None,
    state: str,
    q: str | None,
    page: int,
    page_size: int,
) -> s.ArmoryAssignmentPage:
    if state not in ("active", "ended", "all"):
        raise core.invalid("state")
    now = core.current_time()
    stmt = _assignment_query().where(ArmoryPosting.kind == "custody")
    if safe_id is not None:
        core.get_or_404(db, ArmorySafe, safe_id, "safe")
        stmt = stmt.where(ArmoryPosting.safe_id == safe_id)
    live = ArmoryPosting.voided_at.is_(None)
    remaining = _has_remaining(ArmoryAssignment.posting_id)
    if state == "all":
        stmt = stmt.order_by((live & remaining).desc())
    else:
        stmt = stmt.where(live, remaining if state == "active" else ~remaining)
    query = core.normalize_search(q)
    if query:
        employee_ids = _matching_employee_ids(db, query)
        recipient_safe_ids = {
            key
            for key, name_en, name_ar in db.execute(
                select(ArmorySafe.id, ArmorySafe.name_en, ArmorySafe.name_ar)
            )
            if _matches(query, name_en, name_ar)
        }
        # Registered codes are normalized ASCII; instr is a literal substring match.
        matching_serial = (
            select(1)
            .select_from(ArmoryAssignmentLine)
            .join(ArmorySerial, ArmorySerial.id == ArmoryAssignmentLine.serial_id)
            .where(
                ArmoryAssignmentLine.assignment_id == ArmoryAssignment.posting_id,
                func.instr(func.lower(ArmorySerial.serial_code), query) > 0,
            )
            .exists()
        )
        record_ref = func.printf(f"{core.RECORD_PREFIX['custody'].lower()}-%04d", ArmoryPosting.id)
        stmt = stmt.where(
            or_(
                ArmoryAssignment.holder_employee_id.in_(employee_ids),
                ArmoryAssignment.supervisor_employee_id.in_(employee_ids),
                ArmoryAssignment.holder_safe_id.in_(recipient_safe_ids),
                matching_serial,
                func.instr(record_ref, query) > 0,
            )
        )
    return _assignment_page(db, stmt, now, page=page, page_size=page_size)


def employee_armory(
    db: Session,
    employee_id: str,
    *,
    page: int,
    page_size: int,
) -> s.ArmoryEmployeeRead:
    now = core.current_time()
    person = core.get_or_404(db, Employee, employee_id, "employee")
    qualification = db.get(ArmoryGuardQualification, employee_id)
    history = _assignment_query().where(
        or_(
            ArmoryAssignment.holder_employee_id == employee_id,
            ArmoryAssignment.supervisor_employee_id == employee_id,
        )
    )
    return s.ArmoryEmployeeRead(
        person=core.person_read(person),
        qualification=core.qualification_read(qualification, core.local_today(now)),
        open_assignments=_open_assignments(db, [employee_id], now)[employee_id],
        history=_assignment_page(db, history, now, page=page, page_size=page_size),
    )


def clearance(db: Session, employee_id: str) -> s.ArmoryClearanceRead:
    if db.scalar(select(Employee.id).where(Employee.id == employee_id)) is None:
        raise core.not_found("employee")
    # Do not join guard qualifications, users or stock for a clearance read.
    rows = db.execute(
        select(
            ArmoryPosting,
            ArmoryAssignment.due_at,
            ArmorySafe,
            ArmoryItem,
            ArmorySerial.serial_code,
            ArmoryAssignmentLine.remaining_qty,
        )
        .options(
            load_only(
                ArmoryPosting.id,
                ArmoryPosting.kind,
                ArmoryPosting.occurred_at,
                ArmoryPosting.created_at,
            ),
            load_only(ArmorySafe.name_en, ArmorySafe.name_ar),
            load_only(ArmoryItem.name_en, ArmoryItem.name_ar),
        )
        .select_from(ArmoryAssignment)
        .join(ArmoryPosting, ArmoryPosting.id == ArmoryAssignment.posting_id)
        .join(ArmorySafe, ArmorySafe.id == ArmoryPosting.safe_id)
        .join(
            ArmoryAssignmentLine, ArmoryAssignmentLine.assignment_id == ArmoryAssignment.posting_id
        )
        .join(ArmoryItem, ArmoryItem.id == ArmoryAssignmentLine.item_id)
        .outerjoin(ArmorySerial, ArmorySerial.id == ArmoryAssignmentLine.serial_id)
        .where(
            or_(
                ArmoryAssignment.holder_employee_id == employee_id,
                ArmoryAssignment.supervisor_employee_id == employee_id,
            ),
            ArmoryPosting.voided_at.is_(None),
            ArmoryAssignmentLine.remaining_qty > 0,
        )
        .order_by(*_ISSUANCE_DESC, ArmoryAssignmentLine.position)
    )
    records: dict[int, s.ArmoryClearanceRecordRead] = {}
    for posting, due_at, safe, item, serial_code, qty in rows:
        key = posting.id
        if key not in records:
            records[key] = s.ArmoryClearanceRecordRead(
                id=key,
                record_ref=core.record_ref(posting.kind, key),
                kind=core.assignment_kind(posting.kind),
                safe=s.ArmoryNameRead.model_validate(safe),
                issued_at=posting.occurred_at or posting.created_at,
                due_at=due_at,
                lines=[],
            )
        records[key].lines.append(
            s.ArmoryClearanceLineRead(
                item=s.ArmoryNameRead.model_validate(item),
                serial_code=serial_code,
                remaining_qty=qty,
            )
        )
    return s.ArmoryClearanceRead(employee_id=employee_id, records=list(records.values()))
