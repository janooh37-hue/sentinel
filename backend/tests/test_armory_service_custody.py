"""Armory issue, custody and return behavior with real SQLite postings."""

from __future__ import annotations

import datetime as dt
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from threading import Barrier

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from app.api.errors import AppError
from app.config import Settings
from app.db.models import (
    AppSetting,
    ArmoryBatch,
    ArmoryDiscrepancy,
    ArmoryGuardQualification,
    ArmoryPosting,
    ArmoryPostingLine,
    ArmorySafe,
    ArmorySerial,
    ArmoryStock,
    AuditLog,
    Employee,
    EmployeeFormerId,
    User,
)
from app.db.workforce_models import (
    AttendanceCase,
    AttendanceEvaluation,
    AttendanceSyncState,
    WorkShiftDefinition,
    WorkShiftOverride,
)
from app.schemas import armory as s
from app.services import armory_custody_service as svc
from app.services import armory_service as core
from app.services import employee_id_change_service
from tests.factories.armory import (
    NOW,
    Catalogue,
    account,
    employee,
    pin_clock,
    safe,
    seed_catalogue,
)


@dataclass(frozen=True)
class World:
    db: Session
    actor: User
    holder: Employee
    safe: ArmorySafe
    catalogue: Catalogue


def _world(db: Session) -> World:
    armorer = employee(db, "G9001")
    actor = account(db, employee_id=armorer.id)
    holder = employee(db, "G9002")
    return World(db, actor, holder, safe(db, actor), seed_catalogue(db))


@pytest.fixture(autouse=True)
def _clock(monkeypatch: pytest.MonkeyPatch) -> None:
    pin_clock(monkeypatch)


@pytest.fixture
def world(db_session: Session) -> World:
    return _world(db_session)


def _seed_stock(
    world: World,
    *,
    quantities: dict[str, int],
    serials: dict[str, str],
    batches: dict[str, tuple[str, dt.date, int]] | None = None,
) -> list[int]:
    """Set up stock through the ledger so all balances have posting evidence."""
    db = world.db
    with core.write(db):
        actor = core.actor_for(db, world.actor, require_employee=True)
        posting = core.new_posting(
            db,
            kind="opening",
            safe_id=world.safe.id,
            actor=actor,
            occurred_on=NOW.date(),
            occurred_at=None,
            now=NOW,
        )
        writer = core.PostingWriter(db, posting)
        serial_ids = [
            writer.create_serial(item_id=world.catalogue.item(key), code=code, at=NOW).id
            for code, key in serials.items()
        ]
        for key, qty in quantities.items():
            writer.stock(item_id=world.catalogue.item(key), qty=qty, delta=qty)
        for batch_ref, (key, expires_on, qty) in (batches or {}).items():
            item_id = world.catalogue.item(key)
            batch = ArmoryBatch(item_id=item_id, batch_ref=batch_ref, expires_on=expires_on)
            db.add(batch)
            db.flush()
            writer.stock(item_id=item_id, qty=qty, delta=qty, batch_id=batch.id)
        writer.finish()
    return serial_ids


def _issue_draft(
    world: World,
    *lines: s.ArmoryAssignmentLineInput,
    holder_id: str | None = None,
    kit: str = "rifle",
) -> s.ArmoryShiftIssueCreate:
    return s.ArmoryShiftIssueCreate(
        safe_id=world.safe.id,
        employee_id=holder_id or world.holder.id,
        kit_id=world.catalogue.kit(kit),
        lines=list(lines),
        off_duty_reason="cover",
    )


def _line(
    world: World, key: str, qty: int = 1, *, serial_id: int | None = None
) -> s.ArmoryAssignmentLineInput:
    return s.ArmoryAssignmentLineInput(
        item_id=world.catalogue.item(key), qty=qty, serial_id=serial_id
    )


def _on_hand(world: World, key: str) -> int | None:
    return world.db.scalar(
        select(ArmoryStock.on_hand).where(
            ArmoryStock.safe_id == world.safe.id,
            ArmoryStock.item_id == world.catalogue.item(key),
            ArmoryStock.batch_id.is_(None),
        )
    )


def _assert_ledger_total(world: World, key: str, expected: int) -> None:
    assert _on_hand(world, key) == expected
    delta = world.db.scalar(
        select(func.sum(ArmoryPostingLine.stock_delta))
        .join(ArmoryPosting, ArmoryPosting.id == ArmoryPostingLine.posting_id)
        .where(
            ArmoryPosting.safe_id == world.safe.id,
            ArmoryPosting.voided_at.is_(None),
            ArmoryPostingLine.item_id == world.catalogue.item(key),
            ArmoryPostingLine.batch_id.is_(None),
        )
    )
    assert delta == expected


def test_issue_records_the_actual_lines_and_debits_the_issuing_safe(world: World) -> None:
    [serial_id] = _seed_stock(world, quantities={"cuffs": 2}, serials={"TEST-0001": "radio"})
    start_revision = world.safe.stock_revision
    draft = _issue_draft(
        world, _line(world, "cuffs"), _line(world, "radio", serial_id=serial_id), kit="equipment"
    )
    read = svc.create_issue(world.db, world.actor, draft)
    assert read == svc.get_issue(world.db, read.id)
    assert read.safe.id == world.safe.id
    assert read.state == "active"
    assert read.kind == "shift"
    assert read.holder.employee is not None and read.holder.employee.employee_id == world.holder.id
    assert read.issuer.user_id == world.actor.id
    assert read.due_at == NOW.replace(hour=18).astimezone(dt.UTC)
    assert [(line.item.id, line.remaining_qty) for line in read.lines] == [
        (world.catalogue.item("cuffs"), 1),
        (world.catalogue.item("radio"), 1),
    ]
    serial = world.db.get(ArmorySerial, serial_id)
    assert serial is not None and (serial.state, serial.safe_id, serial.last_posting_id) == (
        "signed_out",
        world.safe.id,
        read.id,
    )
    _assert_ledger_total(world, "cuffs", 1)
    assert world.safe.stock_revision == start_revision + 1
    assert (
        world.db.scalar(
            select(func.count())
            .select_from(AuditLog)
            .where(AuditLog.action == "armory.shift_issue")
        )
        == 1
    )


def _qualify(world: World, *, expiry_days: int | None = 45, employee_id: str | None = None) -> None:
    world.db.add(
        ArmoryGuardQualification(
            employee_id=employee_id or world.holder.id,
            course_round=2,
            licence_number=None if expiry_days is None else "LIC-TEST-1",
            licence_expires_on=None
            if expiry_days is None
            else NOW.date() + dt.timedelta(days=expiry_days),
            version=1,
            updated_at=core.naive_utc(NOW),
            updated_by_id=world.actor.id,
        )
    )
    world.db.commit()


def _return_line(
    line: s.ArmoryAssignmentLineRead,
    qty: int,
    *,
    condition: s.ReturnCondition | None = None,
    fault_note: str | None = None,
    shortfall: s.ArmoryShortfallInput | None = None,
    expected: int | None = None,
) -> s.ArmoryReturnLineInput:
    return s.ArmoryReturnLineInput(
        assignment_line_id=line.id,
        expected_remaining_qty=line.remaining_qty if expected is None else expected,
        returned_qty=qty,
        condition=condition,
        fault_note=fault_note,
        shortfall=shortfall,
    )


def test_zero_rounds_return_keeps_unconfirmed_lines_out_and_records_the_shortfall(
    world: World,
) -> None:
    [serial_id] = _seed_stock(
        world, quantities={"rifle-rounds": 20}, serials={"TEST-0001": "rifle"}
    )
    _qualify(world)
    witness = employee(world.db, "G9003")
    issue = svc.create_issue(
        world.db,
        world.actor,
        _issue_draft(
            world, _line(world, "rifle", serial_id=serial_id), _line(world, "rifle-rounds", 10)
        ),
    )
    firearm, rounds = issue.lines
    recorded = svc.create_return(
        world.db,
        world.actor,
        s.ArmoryReturnCreate(
            assignment_id=issue.id,
            witness_employee_id=witness.id,
            lines=[
                _return_line(
                    rounds,
                    0,
                    shortfall=s.ArmoryShortfallInput(
                        reason="other",
                        reference="REF-TEST-1",
                        note="Synthetic exception",
                    ),
                )
            ],
        ),
    )
    assert recorded.assignment.state == "active"
    assert [(line.id, line.remaining_qty) for line in recorded.assignment.lines] == [
        (firearm.id, 1),
        (rounds.id, 0),
    ]
    assert recorded.posting.safe.id == world.safe.id
    assert (
        recorded.posting.witness is not None and recorded.posting.witness.employee_id == witness.id
    )
    [line] = recorded.posting.lines
    assert (
        line.assignment_line_id,
        line.qty,
        line.stock_delta,
        line.remaining_before,
        line.remaining_after,
    ) == (rounds.id, 0, 0, 10, 0)
    [discrepancy_id] = recorded.posting.discrepancy_ids
    discrepancy = world.db.get(ArmoryDiscrepancy, discrepancy_id)
    assert discrepancy is not None
    assert (discrepancy.source_posting_id, discrepancy.assignment_line_id, discrepancy.kind) == (
        recorded.posting.id,
        rounds.id,
        "rounds_shortfall",
    )
    assert (
        discrepancy.expected_qty,
        discrepancy.observed_qty,
        discrepancy.involved_employee_id,
    ) == (10, 0, world.holder.id)
    assert (discrepancy.shortfall_reason, discrepancy.reference, discrepancy.note) == (
        "other",
        "REF-TEST-1",
        "Synthetic exception",
    )
    _assert_ledger_total(world, "rifle-rounds", 10)


def _custody_draft(
    world: World,
    *lines: s.ArmoryAssignmentLineInput,
    kit: str = "rifle",
    recipient_safe: ArmorySafe | None = None,
    supervisor_id: str | None = None,
    acknowledged: bool = False,
) -> s.ArmoryCustodyCreate:
    return s.ArmoryCustodyCreate(
        safe_id=world.safe.id,
        holder_kind="person" if recipient_safe is None else "site",
        holder_employee_id=world.holder.id if recipient_safe is None else None,
        holder_safe_id=recipient_safe.id if recipient_safe is not None else None,
        supervisor_employee_id=supervisor_id,
        kit_id=world.catalogue.kit(kit),
        lines=list(lines),
        licence_warning_acknowledged=acknowledged,
    )


def test_site_custody_receipt_freezes_posting_identities_after_renumber(
    world: World,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    settings = Settings(data_dir=tmp_path / "data")
    settings.ensure_dirs()
    monkeypatch.setattr(employee_id_change_service, "get_settings", lambda: settings)
    [serial_id] = _seed_stock(world, quantities={}, serials={"TEST-0001": "rifle"})
    original_id = world.holder.id
    _qualify(world, expiry_days=-1)
    site = safe(world.db, world.actor, "Synthetic Receiving Safe")
    armorer = world.db.get(Employee, world.actor.employee_id)
    assert armorer is not None
    draft = _custody_draft(
        world,
        _line(world, "rifle", serial_id=serial_id),
        recipient_safe=site,
        supervisor_id=original_id,
        acknowledged=True,
    )
    custody = svc.create_custody(
        world.db, world.actor, draft.model_copy(update={"condition_note": "Synthetic condition"})
    )
    assert custody.kind == "custody" and custody.due_at is None
    assert custody.licence_status_at_issue == "expired"
    receipt = custody.receipt
    assert receipt is not None
    assert receipt.issued_at == NOW and receipt.firearm_included
    assert receipt.licence_number == "LIC-TEST-1"
    assert receipt.holder_employee_id is None and receipt.holder.name_en == site.name_en
    assert receipt.supervisor is not None and receipt.supervisor.name_en == world.holder.name_en
    assert receipt.supervisor_employee_id == original_id
    assert receipt.armorer.name_en == armorer.name_en and receipt.armorer.name_ar == armorer.name_ar
    assert (
        receipt.lines[0].item == custody.lines[0].item
        and receipt.lines[0].serial_code == "TEST-0001"
    )
    assert receipt.condition_note == "Synthetic condition"
    with_id = employee_id_change_service.change(
        world.db, world.actor, original_id, "G9004", "Synthetic ID correction"
    )
    reread = svc.get_custody(world.db, custody.id)
    assert (
        reread.holder.supervisor is not None and reread.holder.supervisor.employee_id == with_id.id
    )
    assert reread.receipt == receipt


def _record_presence(world: World, on_site: Employee) -> None:
    now = core.naive_utc(NOW)
    start = now - dt.timedelta(hours=1)
    end = now + dt.timedelta(hours=1)
    shift = WorkShiftDefinition(code="fixture", start_local_time=start.time(), duration_minutes=120)
    world.db.add(shift)
    world.db.flush()
    override = WorkShiftOverride(
        employee_id=on_site.id,
        shift_definition_id=shift.id,
        assignment_kind="work",
        reason_kind="other",
        reason="Synthetic duty assignment",
        starts_at=start,
        ends_at=end,
        created_by_user_id=world.actor.id,
    )
    world.db.add(override)
    world.db.flush()
    case = AttendanceCase(
        employee_id=on_site.id,
        shift_override_id=override.id,
        scheduled_start_at=start,
        scheduled_end_at=end,
        operational_date=NOW.date(),
        employee_status_snapshot=on_site.status,
        organization_snapshot_state="captured",
        crew_code_snapshot="fixture",
        crew_name_snapshot="Synthetic Crew",
        shift_code_snapshot="fixture",
        duty_unit_snapshot=" Test Duty Unit ",
        duty_post_snapshot="Test Post",
    )
    world.db.add(case)
    world.db.flush()
    world.safe.duty_unit = "Test Duty Unit"
    world.safe.duty_post = "Test Post"
    world.db.add_all(
        [
            AppSetting(key="workforce.stale_after_minutes", value="120"),
            AttendanceSyncState(
                provider="biotime",
                stream="punches",
                fresh_through=now,
                last_success_at=now,
                consecutive_failures=0,
                last_import_count=0,
            ),
            AttendanceEvaluation(
                attendance_case_id=case.id,
                revision=1,
                presence_state="on_duty",
                first_in_at=start,
                latest_in_at=start,
                reason_code="PUNCH_IN_ACTIVE",
                sync_fresh_through=now,
                algorithm_version="v1",
                input_fingerprint="synthetic-presence",
                evaluated_at=now,
            ),
        ]
    )
    world.db.commit()


def test_picker_and_off_duty_guard_use_authoritative_presence_at_this_safe(world: World) -> None:
    off_duty = employee(world.db, "G9003", name="Aardvark Test Guard")
    former = employee(world.db, "G9004", status="Resigned")
    world.holder.name_en = "Straße Test Guard"
    world.db.add(
        EmployeeFormerId(
            employee_id=world.holder.id,
            former_id="G9992",
            new_id=world.holder.id,
            reason="Synthetic number correction",
        )
    )
    _record_presence(world, world.holder)
    home_id = world.safe.id

    for purpose in ("issue", "witness"):
        picks = svc.list_people(
            world.db, world.actor, purpose=purpose, q=None, safe_id=home_id, limit=50
        )
        assert [(p.person.employee_id, p.on_duty_here) for p in picks] == [
            (world.holder.id, True),
            (off_duty.id, False),
        ]
        with pytest.raises(AppError) as missing_safe:
            svc.list_people(world.db, world.actor, purpose=purpose, q=None, safe_id=None, limit=50)
        assert missing_safe.value.http_status == 422 and missing_safe.value.details == {
            "field": "safe_id"
        }
    for query in (" STRASSE ", "g٩٩٩٢"):
        [pick] = svc.list_people(
            world.db, world.actor, purpose="issue", q=query, safe_id=home_id, limit=50
        )
        assert pick.person.employee_id == world.holder.id
    [present] = svc.on_duty_people(world.db, home_id, NOW)
    assert present.person.employee_id == world.holder.id and present.on_duty_here
    other_safe = safe(world.db, world.actor, "Test Unmapped Safe")
    assert svc.on_duty_people(world.db, other_safe.id, NOW) == []
    assert (
        svc.list_people(
            world.db, world.actor, purpose="custody", q=former.id, safe_id=None, limit=20
        )
        == []
    )
    [past] = svc.list_people(
        world.db, world.actor, purpose="qualification", q=former.id, safe_id=None, limit=20
    )
    assert past.person.is_former

    _seed_stock(world, quantities={"cuffs": 1}, serials={})
    draft = _issue_draft(world, _line(world, "cuffs"), kit="equipment").model_copy(
        update={"off_duty_reason": None}
    )
    with pytest.raises(AppError) as missing_reason:
        svc.create_issue(
            world.db, world.actor, draft.model_copy(update={"employee_id": off_duty.id})
        )
    assert missing_reason.value.code == "armory_off_duty_reason_required"
    assert missing_reason.value.details == {"employee_id": off_duty.id}
    with pytest.raises(AppError) as short_other_note:
        svc.create_issue(
            world.db,
            world.actor,
            draft.model_copy(
                update={
                    "employee_id": off_duty.id,
                    "off_duty_reason": "other",
                    "off_duty_note": "x",
                }
            ),
        )
    assert short_other_note.value.details == {"field": "off_duty_note"}
    issued = svc.create_issue(world.db, world.actor, draft)
    assert issued.off_duty_reason is None and issued.state == "active"


def test_qualification_is_versioned_and_updates_do_not_rewrite_custody_receipts(
    world: World,
) -> None:
    db = world.db
    holder_id = world.holder.id
    missing = svc.get_guard(db, holder_id)
    assert missing.qualification.version == 0 and missing.qualification.licence_status == "missing"
    original = s.ArmoryQualificationUpsert(
        course_round=2,
        licence_number="LIC-TEST-1",
        licence_expires_on=NOW.date() + dt.timedelta(days=45),
    )
    with pytest.raises(AppError) as precondition:
        svc.save_qualification(db, world.actor, holder_id, original, None)
    assert precondition.value.http_status == 412 and precondition.value.details == {"version": 0}
    with pytest.raises(AppError) as unpaired:
        svc.save_qualification(
            db,
            world.actor,
            holder_id,
            original.model_copy(update={"licence_expires_on": None}),
            '"0"',
        )
    assert unpaired.value.http_status == 422 and unpaired.value.details == {
        "field": "licence_expires_on"
    }
    saved = svc.save_qualification(db, world.actor, holder_id, original, '"0"')
    assert (saved.qualification.version, saved.qualification.licence_status) == (1, "valid")

    [serial_id] = _seed_stock(world, quantities={}, serials={"TEST-0001": "rifle"})
    custody = svc.create_custody(
        db, world.actor, _custody_draft(world, _line(world, "rifle", serial_id=serial_id))
    )
    assert custody.receipt is not None and custody.receipt.licence_number == "LIC-TEST-1"
    assert custody.receipt.holder_employee_id == holder_id

    updated = s.ArmoryQualificationUpsert(
        course_round=3, licence_number=None, licence_expires_on=None
    )
    with pytest.raises(AppError) as stale:
        svc.save_qualification(db, world.actor, holder_id, updated, '"0"')
    assert stale.value.http_status == 412 and stale.value.details == {"version": 1}
    live = svc.save_qualification(db, world.actor, holder_id, updated, '"1"')
    assert (
        live.qualification.version,
        live.qualification.course_round,
        live.qualification.licence_status,
    ) == (2, 3, "missing")
    assert live == svc.get_guard(db, holder_id)
    assert [assignment.id for assignment in live.open_assignments] == [custody.id]
    reread = svc.get_custody(db, custody.id)
    assert reread.receipt == custody.receipt and reread.course_round_snapshot == 2
    assert reread.licence_status_at_issue == "valid" and not reread.licence_warning_acknowledged


def test_employee_clearance_lists_only_outstanding_lines_for_a_former_site_supervisor(
    world: World,
) -> None:
    db = world.db
    radio, bodycam = _seed_stock(
        world,
        quantities={"cuffs": 3},
        serials={"TEST-0001": "radio", "TEST-0002": "bodycam"},
    )
    shift = svc.create_issue(
        db,
        world.actor,
        _issue_draft(
            world,
            _line(world, "cuffs", 2),
            _line(world, "radio", serial_id=radio),
            kit="equipment",
        ),
    )
    cuffs_line, _ = shift.lines
    svc.create_return(
        db,
        world.actor,
        s.ArmoryReturnCreate(
            assignment_id=shift.id,
            lines=[_return_line(cuffs_line, 2)],
        ),
    )
    receiving_safe = safe(db, world.actor, "Synthetic Receiving Safe")
    custody = svc.create_custody(
        db,
        world.actor,
        _custody_draft(
            world,
            _line(world, "bodycam", serial_id=bodycam),
            kit="equipment",
            recipient_safe=receiving_safe,
            supervisor_id=world.holder.id,
        ),
    )
    other_guard = employee(db, "G9003")
    unrelated = svc.create_issue(
        db,
        world.actor,
        _issue_draft(
            world,
            _line(world, "cuffs"),
            kit="equipment",
            holder_id=other_guard.id,
        ),
    )
    world.holder.status = "Resigned"
    db.commit()

    clearance = svc.clearance(db, world.holder.id)
    assert clearance.employee_id == world.holder.id
    assert [record.id for record in clearance.records] == [custody.id, shift.id]
    assert all(record.safe.name_en == world.safe.name_en for record in clearance.records)
    assert [
        (record.kind, [(line.serial_code, line.remaining_qty) for line in record.lines])
        for record in clearance.records
    ] == [("custody", [("TEST-0002", 1)]), ("shift", [("TEST-0001", 1)])]
    assert {key for record in clearance.records for key in record.model_dump()} == {
        "id",
        "record_ref",
        "kind",
        "safe",
        "issued_at",
        "due_at",
        "lines",
    }
    assert [record.id for record in svc.clearance(db, other_guard.id).records] == [unrelated.id]

    employee_file = svc.employee_armory(db, world.holder.id, page=1, page_size=1)
    assert employee_file.person.is_former
    assert {row.id for row in employee_file.open_assignments} == {custody.id, shift.id}
    assert employee_file.history.total == 2 and [row.id for row in employee_file.history.items] == [
        custody.id
    ]
    page_two = svc.employee_armory(db, world.holder.id, page=2, page_size=1)
    assert [row.id for row in page_two.history.items] == [shift.id]


def test_shift_issue_rejects_self_unlinked_actor_and_missing_course(world: World) -> None:
    [serial_id] = _seed_stock(world, quantities={}, serials={"TEST-0001": "rifle"})
    draft = _issue_draft(world, _line(world, "rifle", serial_id=serial_id))
    with pytest.raises(AppError) as self_issue:
        svc.create_issue(
            world.db, world.actor, draft.model_copy(update={"employee_id": world.actor.employee_id})
        )
    assert self_issue.value.code == "armory_self_issue"
    assert self_issue.value.details == {"employee_id": world.actor.employee_id}

    unlinked = account(world.db)
    with pytest.raises(AppError) as no_actor:
        svc.create_issue(world.db, unlinked, draft)
    assert no_actor.value.code == "armory_actor_employee_required"
    assert no_actor.value.http_status == 422 and no_actor.value.details == {}

    with pytest.raises(AppError) as no_course:
        svc.create_issue(
            world.db, world.actor, draft.model_copy(update={"licence_warning_acknowledged": True})
        )
    assert no_course.value.code == "armory_course_required"
    assert no_course.value.details == {"employee_id": world.holder.id}
    serial = world.db.get(ArmorySerial, serial_id)
    assert serial is not None and serial.state == "in_safe"


@pytest.mark.parametrize(
    ("expiry_days", "status"),
    [
        (None, "missing"),
        (-1, "expired"),
        (0, "expiring"),
        (30, "expiring"),
        (31, "valid"),
    ],
)
def test_licence_acknowledgement_only_applies_to_current_missing_or_expired_evidence(
    world: World,
    expiry_days: int | None,
    status: str,
) -> None:
    [serial_id] = _seed_stock(world, quantities={}, serials={"TEST-0001": "rifle"})
    _qualify(world, expiry_days=expiry_days)
    draft = _issue_draft(world, _line(world, "rifle", serial_id=serial_id))
    needs_ack = status in {"missing", "expired"}
    with pytest.raises(AppError) as error:
        svc.create_issue(
            world.db,
            world.actor,
            draft.model_copy(update={"licence_warning_acknowledged": not needs_ack}),
        )
    assert error.value.http_status == 422
    if needs_ack:
        assert error.value.code == "armory_licence_ack_required"
        assert error.value.details == {"employee_id": world.holder.id, "licence_status": status}
    else:
        assert error.value.code == "armory_invalid_input"
        assert error.value.details == {"field": "licence_warning_acknowledged"}

    issue = svc.create_issue(
        world.db,
        world.actor,
        draft.model_copy(update={"licence_warning_acknowledged": needs_ack}),
    )
    assert issue.licence_status_at_issue == status
    assert issue.licence_warning_acknowledged is needs_ack and issue.course_round_snapshot == 2


@pytest.mark.parametrize("starts_in_custody", [False, True])
def test_one_firearm_per_responsible_employee_across_shift_and_site_custody(
    world: World,
    starts_in_custody: bool,
) -> None:
    db = world.db
    first_serial, next_serial = _seed_stock(
        world,
        quantities={"cuffs": 1},
        serials={"TEST-0001": "rifle", "TEST-0002": "rifle"},
    )
    _qualify(world)
    recipient = safe(db, world.actor, "Synthetic Receiving Safe")
    witness = employee(db, "G9003")
    first_line = _line(world, "rifle", serial_id=first_serial)
    next_line = _line(world, "rifle", serial_id=next_serial)
    if starts_in_custody:
        first = svc.create_custody(
            db,
            world.actor,
            _custody_draft(
                world,
                first_line,
                _line(world, "cuffs"),
                recipient_safe=recipient,
                supervisor_id=world.holder.id,
            ),
        )
    else:
        first = svc.create_issue(
            db,
            world.actor,
            _issue_draft(world, first_line, _line(world, "cuffs")),
        )

    [candidate] = svc.list_people(
        db,
        world.actor,
        purpose="custody",
        q=world.holder.id,
        safe_id=None,
        limit=1,
    )
    held = candidate.open_firearm
    assert held is not None and (held.assignment_id, held.assignment_kind, held.serial_id) == (
        first.id,
        first.kind,
        first_serial,
    )
    with pytest.raises(AppError) as conflict:
        if starts_in_custody:
            svc.create_issue(db, world.actor, _issue_draft(world, next_line))
        else:
            svc.create_custody(
                db,
                world.actor,
                _custody_draft(
                    world,
                    next_line,
                    recipient_safe=recipient,
                    supervisor_id=world.holder.id,
                ),
            )
    assert (conflict.value.http_status, conflict.value.code) == (409, "armory_firearm_already_held")
    assert conflict.value.details == {
        "assignment_id": first.id,
        "assignment_kind": first.kind,
        "serial_id": first_serial,
    }

    partial = svc.create_return(
        db,
        world.actor,
        s.ArmoryReturnCreate(
            assignment_id=first.id,
            lines=[_return_line(first.lines[0], 1)],
            witness_employee_id=witness.id if starts_in_custody else None,
        ),
    )
    assert partial.assignment.state == "active" and partial.assignment.lines[1].remaining_qty == 1
    if starts_in_custody:
        second = svc.create_issue(db, world.actor, _issue_draft(world, next_line))
    else:
        second = svc.create_custody(
            db,
            world.actor,
            _custody_draft(
                world,
                next_line,
                recipient_safe=recipient,
                supervisor_id=world.holder.id,
            ),
        )
    assert second.id != first.id and second.lines[0].serial_id == next_serial


@pytest.mark.parametrize("serialized", [False, True])
def test_two_sqlite_sessions_race_for_the_last_unit(api_db: Session, serialized: bool) -> None:
    world = _world(api_db)
    serial_ids = _seed_stock(
        world,
        quantities={"cuffs": 2 if serialized else 1},
        serials={"TEST-0001": "radio"} if serialized else {},
    )
    contender = employee(api_db, "G9003")
    lines = [_line(world, "cuffs")]
    if serialized:
        lines.append(_line(world, "radio", serial_id=serial_ids[0]))
    drafts = [
        _issue_draft(world, *lines, holder_id=employee_id, kit="equipment")
        for employee_id in (world.holder.id, contender.id)
    ]
    actor_id = world.actor.id
    revision = world.safe.stock_revision
    factory = sessionmaker(bind=api_db.get_bind(), expire_on_commit=False, autoflush=False)
    ready = Barrier(2)

    def record(payload: s.ArmoryShiftIssueCreate) -> tuple[int, str]:
        with factory() as db:
            actor = db.get(User, actor_id)
            assert actor is not None
            ready.wait(timeout=5)
            try:
                svc.create_issue(db, actor, payload)
            except AppError as exc:
                return exc.http_status, exc.code
            return 201, "recorded"

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = sorted(executor.map(record, drafts))
    expected = "armory_serial_unavailable" if serialized else "armory_insufficient_stock"
    assert results == [(201, "recorded"), (409, expected)]
    api_db.expire_all()
    _assert_ledger_total(world, "cuffs", 1 if serialized else 0)
    [winner] = list(
        api_db.scalars(select(ArmoryPosting).where(ArmoryPosting.kind == "shift_issue"))
    )
    assert world.safe.stock_revision == revision + 1
    if serialized:
        serial = api_db.get(ArmorySerial, serial_ids[0])
        assert serial is not None and (serial.state, serial.last_posting_id) == (
            "signed_out",
            winner.id,
        )


def test_overnight_due_bounds_default_and_grace(
    world: World, monkeypatch: pytest.MonkeyPatch
) -> None:
    _seed_stock(world, quantities={"cuffs": 2}, serials={})
    night = NOW.replace(hour=1)
    pin_clock(monkeypatch, night)
    draft = _issue_draft(world, _line(world, "cuffs"), kit="equipment")
    next_end = night.replace(hour=18)
    for invalid_due in (night, next_end + dt.timedelta(microseconds=1)):
        with pytest.raises(AppError) as error:
            svc.create_issue(
                world.db, world.actor, draft.model_copy(update={"due_at": invalid_due})
            )
        assert (error.value.http_status, error.value.code) == (422, "armory_due_out_of_range")
        assert dt.datetime.fromisoformat(error.value.details["earliest_exclusive"]) == night
        assert dt.datetime.fromisoformat(error.value.details["latest_inclusive"]) == next_end
    default = svc.create_issue(world.db, world.actor, draft)
    window = default.shift_window
    assert window is not None and window.shift_date == night.date() - dt.timedelta(days=1)
    assert window.shift_kind == "night"
    assert default.due_at == window.ends_at == night.replace(hour=6)
    assert default.grace_minutes == 30
    bounded = svc.create_issue(world.db, world.actor, draft.model_copy(update={"due_at": next_end}))
    assert bounded.due_at == next_end

    grace_end = window.ends_at + dt.timedelta(minutes=30)
    pin_clock(monkeypatch, grace_end)
    assert svc.get_issue(world.db, default.id).overdue_minutes is None
    pin_clock(monkeypatch, grace_end + dt.timedelta(seconds=1))
    assert svc.get_issue(world.db, default.id).overdue_minutes == 30


def test_return_rejects_overcount_then_records_repair_and_refuses_the_old_draft(
    world: World,
) -> None:
    [serial_id] = _seed_stock(world, quantities={"cuffs": 2}, serials={"TEST-0001": "radio"})
    issue = svc.create_issue(
        world.db,
        world.actor,
        _issue_draft(
            world,
            _line(world, "cuffs", 2),
            _line(world, "radio", serial_id=serial_id),
            kit="equipment",
        ),
    )
    cuffs, radio = issue.lines
    for qty in (1, 3):
        with pytest.raises(AppError) as invalid:
            svc.create_return(
                world.db,
                world.actor,
                s.ArmoryReturnCreate(
                    assignment_id=issue.id,
                    lines=[_return_line(cuffs, qty)],
                ),
            )
        assert invalid.value.http_status == 422 and invalid.value.details == {
            "field": "lines.0.returned_qty"
        }
    with pytest.raises(AppError) as missing_fault:
        svc.create_return(
            world.db,
            world.actor,
            s.ArmoryReturnCreate(
                assignment_id=issue.id,
                lines=[_return_line(radio, 1, condition="repair", fault_note="x")],
            ),
        )
    assert missing_fault.value.details == {"field": "lines.0.fault_note"}
    _assert_ledger_total(world, "cuffs", 0)

    request = s.ArmoryReturnCreate(
        assignment_id=issue.id,
        lines=[
            _return_line(radio, 1, condition="repair", fault_note="Synthetic fault"),
        ],
    )
    repaired = svc.create_return(world.db, world.actor, request)
    [movement] = repaired.posting.lines
    assert (movement.condition, movement.fault_note, movement.after_state) == (
        "repair",
        "Synthetic fault",
        "in_repair",
    )
    assert [(line.id, line.remaining_qty) for line in repaired.assignment.lines] == [
        (cuffs.id, 2),
        (radio.id, 0),
    ]
    serial = world.db.get(ArmorySerial, serial_id)
    assert serial is not None and serial.state == "in_repair"
    with pytest.raises(AppError) as stale:
        svc.create_return(world.db, world.actor, request)
    assert (stale.value.http_status, stale.value.code) == (409, "armory_stale_return")
    assert stale.value.details == {"assignment_id": issue.id, "assignment_line_id": radio.id}


def test_custody_returns_require_witness_independent_of_both_humans(world: World) -> None:
    db = world.db
    _seed_stock(world, quantities={"cuffs": 1}, serials={})
    destination = safe(db, world.actor, "Synthetic Receiving Safe")
    custody = svc.create_custody(
        db,
        world.actor,
        _custody_draft(
            world,
            _line(world, "cuffs"),
            kit="equipment",
            recipient_safe=destination,
            supervisor_id=world.holder.id,
        ),
    )
    alternate_account = account(db, employee_id=world.actor.employee_id)
    former = employee(db, "G9003", status="Resigned")
    actual_witness = employee(db, "G9004")
    request = s.ArmoryReturnCreate(
        assignment_id=custody.id, lines=[_return_line(custody.lines[0], 1)]
    )
    for witness_id in (None, alternate_account.employee_id, former.id, world.holder.id):
        with pytest.raises(AppError) as invalid_witness:
            svc.create_return(
                db, world.actor, request.model_copy(update={"witness_employee_id": witness_id})
            )
        assert invalid_witness.value.code == "armory_invalid_witness"
        assert invalid_witness.value.details == {"witness_employee_id": witness_id}
    witnessed = request.model_copy(update={"witness_employee_id": actual_witness.id})
    with pytest.raises(AppError) as unlinked:
        svc.create_return(db, account(db), witnessed)
    assert unlinked.value.code == "armory_actor_employee_required"

    returned = svc.create_return(db, alternate_account, witnessed)
    assert returned.assignment.state == "ended" and returned.posting.safe.id == world.safe.id
    assert (
        returned.posting.witness is not None
        and returned.posting.witness.employee_id == actual_witness.id
    )
    closed = svc.get_custody(db, custody.id)
    assert closed.ended_by is not None and closed.ended_by.user_id == alternate_account.id
    assert closed.ended_at == returned.posting.occurred_at and closed.return_ids == [
        returned.posting.id
    ]
    _assert_ledger_total(world, "cuffs", 1)
    assert db.scalar(select(ArmoryStock.id).where(ArmoryStock.safe_id == destination.id)) is None


def test_bulk_return_is_atomic_rejects_duplicate_and_excludes_custody(world: World) -> None:
    db = world.db
    _seed_stock(world, quantities={"cuffs": 3}, serials={})
    draft = _issue_draft(world, _line(world, "cuffs"), kit="equipment")
    first = svc.create_issue(db, world.actor, draft)
    second = svc.create_issue(db, world.actor, draft)
    custody = svc.create_custody(
        db, world.actor, _custody_draft(world, _line(world, "cuffs"), kit="equipment")
    )
    first_return = s.ArmoryReturnCreate(
        assignment_id=first.id, lines=[_return_line(first.lines[0], 1)]
    )
    second_return = s.ArmoryReturnCreate(
        assignment_id=second.id, lines=[_return_line(second.lines[0], 1)]
    )
    stale_return = second_return.model_copy(
        update={"lines": [_return_line(second.lines[0], 1, expected=2)]}
    )
    custody_return = s.ArmoryReturnCreate(
        assignment_id=custody.id, lines=[_return_line(custody.lines[0], 1)]
    )
    for bad, code in (
        (stale_return, "armory_stale_return"),
        (first_return, "armory_invalid_input"),
        (custody_return, "armory_invalid_input"),
    ):
        with pytest.raises(AppError) as rejected:
            svc.create_bulk_return(
                db,
                world.actor,
                s.ArmoryBulkReturnCreate(
                    safe_id=world.safe.id,
                    records=[first_return, bad],
                ),
            )
        assert rejected.value.code == code
        _assert_ledger_total(world, "cuffs", 0)
        assert svc.get_issue(db, first.id).lines[0].remaining_qty == 1
        assert db.scalar(select(ArmoryPosting.id).where(ArmoryPosting.kind == "return")) is None
        assert db.scalar(select(AuditLog.id).where(AuditLog.action == "armory.return")) is None

    returned = svc.create_bulk_return(
        db,
        world.actor,
        s.ArmoryBulkReturnCreate(
            safe_id=world.safe.id,
            records=[first_return, second_return],
        ),
    )
    assert [(row.assignment.id, row.assignment.state) for row in returned] == [
        (first.id, "ended"),
        (second.id, "ended"),
    ]
    _assert_ledger_total(world, "cuffs", 2)
    assert svc.get_custody(db, custody.id).state == "active"


def test_firearm_kit_rejects_cross_model_rounds_both_holsters_and_missing_serial(
    world: World,
) -> None:
    [serial_id] = _seed_stock(
        world,
        quantities={"left-holster": 1, "right-holster": 1, "pistol-rounds": 20},
        serials={"TEST-0001": "pistol"},
    )
    _qualify(world)
    firearm = _line(world, "pistol", serial_id=serial_id)
    for lines, field in (
        ([_line(world, "pistol")], "lines.0.serial_id"),
        ([_line(world, "pistol-rounds")], "lines"),
        ([firearm, _line(world, "rifle-rounds")], "lines.1.item_id"),
        ([firearm, _line(world, "right-holster"), _line(world, "left-holster")], "lines.2.item_id"),
        ([firearm, _line(world, "left-holster"), _line(world, "left-holster")], "lines.2.item_id"),
        ([firearm, _line(world, "pistol-rounds", 13)], "excess_rounds_reason"),
    ):
        with pytest.raises(AppError) as invalid:
            svc.create_issue(world.db, world.actor, _issue_draft(world, *lines, kit="pistol"))
        assert invalid.value.http_status == 422 and invalid.value.details == {"field": field}
    draft = _issue_draft(
        world,
        firearm,
        _line(world, "left-holster"),
        _line(world, "pistol-rounds", 13),
        kit="pistol",
    )
    issued = svc.create_issue(
        world.db,
        world.actor,
        draft.model_copy(update={"excess_rounds_reason": "Synthetic evidence"}),
    )
    assert issued.changed_kit and issued.excess_rounds_reason == "Synthetic evidence"
    _assert_ledger_total(world, "left-holster", 0)
    _assert_ledger_total(world, "right-holster", 1)


def test_batch_issue_refuses_expired_lot_but_returns_to_original_batch(
    world: World,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db = world.db
    _seed_stock(
        world,
        quantities={},
        serials={},
        batches={
            "TEST-OLD": ("spray", NOW.date() - dt.timedelta(days=1), 1),
            "TEST-NEW": ("spray", NOW.date(), 1),
        },
    )
    batch_ids = {batch.batch_ref: batch.id for batch in db.scalars(select(ArmoryBatch))}
    line = _line(world, "spray")
    for code in ("TEST-OLD", "TEST-NEW"):
        batch_id = batch_ids[code]
        draft = _issue_draft(world, line.model_copy(update={"batch_id": batch_id}), kit="equipment")
        if code == "TEST-OLD":
            with pytest.raises(AppError) as expired:
                svc.create_issue(db, world.actor, draft)
            assert expired.value.code == "armory_expired_batch" and expired.value.details == {
                "batch_id": batch_id
            }
        else:
            issue = svc.create_issue(db, world.actor, draft)
    pin_clock(monkeypatch, NOW + dt.timedelta(days=1))
    returned = svc.create_return(
        db,
        world.actor,
        s.ArmoryReturnCreate(
            assignment_id=issue.id,
            lines=[_return_line(issue.lines[0], 1)],
        ),
    )
    [movement] = returned.posting.lines
    assert (
        movement.stock_delta == 1
        and movement.batch is not None
        and movement.batch.id == batch_ids["TEST-NEW"]
    )
    assert {stock.batch_id: stock.on_hand for stock in db.scalars(select(ArmoryStock))} == {
        batch_ids["TEST-OLD"]: 1,
        batch_ids["TEST-NEW"]: 1,
    }


def test_custody_list_searches_holder_serial_and_reference_with_state_and_safe_scope(
    world: World,
) -> None:
    db = world.db
    [serial_id] = _seed_stock(world, quantities={"cuffs": 1}, serials={"TEST-0001": "radio"})
    active = svc.create_custody(
        db,
        world.actor,
        _custody_draft(
            world,
            _line(world, "radio", serial_id=serial_id),
            kit="equipment",
        ),
    )
    receiving_safe = safe(db, world.actor, "Synthetic Receiving Safe")
    ended = svc.create_custody(
        db,
        world.actor,
        _custody_draft(
            world,
            _line(world, "cuffs"),
            kit="equipment",
            recipient_safe=receiving_safe,
        ),
    )
    witness = employee(db, "G9003")
    svc.create_return(
        db,
        world.actor,
        s.ArmoryReturnCreate(
            assignment_id=ended.id,
            witness_employee_id=witness.id,
            lines=[_return_line(ended.lines[0], 1)],
        ),
    )
    first = svc.list_custody(db, safe_id=None, state="all", q=None, page=1, page_size=1)
    assert first.total == 2 and [item.id for item in first.items] == [active.id]
    for q, expected in (
        (" RECEIVING ", ended.id),
        (active.record_ref.lower(), active.id),
        ("test-\u0660\u0660\u0660\u0661", active.id),
    ):
        page = svc.list_custody(db, safe_id=world.safe.id, state="all", q=q, page=1, page_size=20)
        assert page.total == 1 and [row.id for row in page.items] == [expected]
    ended_page = svc.list_custody(db, safe_id=None, state="ended", q=None, page=1, page_size=20)
    assert [item.id for item in ended_page.items] == [ended.id]
    assert (
        svc.list_custody(
            db, safe_id=receiving_safe.id, state="all", q=None, page=1, page_size=20
        ).total
        == 0
    )
    with pytest.raises(AppError) as not_a_shift:
        svc.get_issue(db, active.id)
    assert not_a_shift.value.http_status == 404


def test_guard_population_sort_and_filter_counts_are_independent_of_the_page_filter(
    world: World,
) -> None:
    db = world.db
    _qualify(world)
    expiring = employee(db, "G9003", status="Loaned")
    expired = employee(db, "G9004")
    missing = employee(db, "G9005")
    assignment_only = employee(db, "G9006", name="Assignment Only Fixture")
    former = employee(db, "G9007", status="Resigned")
    for person, offset in ((expiring, 30), (expired, -1), (missing, None), (former, -1)):
        _qualify(world, employee_id=person.id, expiry_days=offset)
    _seed_stock(world, quantities={"cuffs": 1}, serials={})
    site = safe(db, world.actor, "Synthetic Site")
    holding = svc.create_custody(
        db,
        world.actor,
        _custody_draft(
            world,
            _line(world, "cuffs"),
            kit="equipment",
            recipient_safe=site,
            supervisor_id=assignment_only.id,
        ),
    )
    guards = svc.list_guards(
        db, q=None, licence_status=None, include_former=True, page=1, page_size=50
    )
    assert [guard.person.employee_id for guard in guards.items] == [
        expiring.id,
        expired.id,
        missing.id,
        assignment_only.id,
        world.holder.id,
        former.id,
    ]
    assert (
        guards.filter_counts
        == svc.licence_counts(db, NOW.date())
        == s.ArmoryLicenceCounts(
            missing=1,
            expiring=1,
            expired=1,
            valid=1,
        )
    )
    page = svc.list_guards(
        db, q=None, licence_status="missing", include_former=False, page=2, page_size=1
    )
    assert page.total == 2 and page.filter_counts == guards.filter_counts
    [assignment_guard] = page.items
    assert assignment_guard.person.employee_id == assignment_only.id
    assert [row.id for row in assignment_guard.open_assignments] == [holding.id]
    filtered = svc.list_guards(
        db, q="only fixture", licence_status=None, include_former=False, page=1, page_size=50
    )
    assert filtered.total == 1 and filtered.filter_counts.missing == 0
