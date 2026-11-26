from __future__ import annotations

import datetime as dt
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, replace
from threading import Barrier
from typing import Literal

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from app.api.errors import AppError
from app.db.models import ArmoryPosting, ArmorySafe, AuditLog, EmployeeFormerId, User
from app.schemas import armory as s
from app.services import armory_audit_service as audit
from app.services import armory_catalog_service as catalog
from app.services import armory_custody_service as custody
from app.services import armory_read_service as reads
from app.services import armory_void_service as voids
from tests.factories import armory as factory


@dataclass(frozen=True)
class Ledger:
    db: Session
    catalog: factory.Catalogue
    actor: User
    safe_id: int


@pytest.fixture
def ledger(db_session: Session, monkeypatch: pytest.MonkeyPatch) -> Ledger:
    factory.pin_clock(monkeypatch)
    catalog = factory.seed_catalogue(db_session)
    actor = factory.account(db_session)
    safe = factory.safe(db_session, actor)
    return Ledger(db_session, catalog, actor, safe.id)


def _receipt(
    ledger: Ledger,
    *lines: tuple[str, int],
    received_on: dt.date | None = None,
    reference: str = "REF-TEST-VOID",
    kind: Literal["receipt", "opening"] = "receipt",
    witness_id: str | None = None,
) -> s.ArmoryPostingRead:
    return catalog.create_receipt(
        ledger.db,
        ledger.actor,
        s.ArmoryReceiptCreate(
            kind=kind,
            safe_id=ledger.safe_id,
            received_on=received_on or factory.NOW.date(),
            source="supplier" if kind == "receipt" else None,
            reference=reference,
            witness_employee_id=witness_id,
            lines=[
                s.ArmoryIntakeLineInput(
                    item_id=ledger.catalog.item(key),
                    entry=s.ArmoryQuantityIntake(type="quantity", qty=qty),
                )
                for key, qty in lines
            ],
        ),
    )


def test_void_receipt_reverses_stock_and_preserves_audited_evidence(ledger: Ledger) -> None:
    db = ledger.db
    item_id = ledger.catalog.item("cuffs")
    receipt_id = _receipt(ledger, ("cuffs", 4)).id

    result = voids.void(db, ledger.actor, receipt_id, s.ArmoryVoid(reason="  Duplicate entry  "))

    totals = catalog.item_detail(db, item_id, safe_id=ledger.safe_id).totals
    assert (totals.known_in_safe, totals.received_qty, totals.opening_qty) == (0, 0, None)
    assert result.id == receipt_id
    assert result.reference == "REF-TEST-VOID"
    assert result.void_reason == "Duplicate entry"
    assert result.voided_at == factory.NOW
    assert result.voided_by is not None and result.voided_by.user_id == ledger.actor.id
    assert result.void_witness is None
    assert [line.stock_delta for line in result.lines] == [4]

    with pytest.raises(AppError) as exc:
        voids.void(db, ledger.actor, receipt_id, s.ArmoryVoid(reason="Another correction"))
    assert (exc.value.http_status, exc.value.code, exc.value.details) == (
        409,
        "armory_already_voided",
        {"posting_id": receipt_id},
    )
    audit_rows = list(
        db.scalars(
            select(AuditLog).where(
                AuditLog.entity_id == str(receipt_id), AuditLog.action == "armory.posting.voided"
            )
        )
    )
    assert [row.action for row in audit_rows] == ["armory.posting.voided"]


def _record_serial(
    ledger: Ledger, code: str, *, item: str = "radio", witness_id: str | None = None
) -> s.ArmoryPostingRead:
    return catalog.create_receipt(
        ledger.db,
        ledger.actor,
        s.ArmoryReceiptCreate(
            kind="receipt",
            safe_id=ledger.safe_id,
            received_on=factory.NOW.date(),
            source="supplier",
            reference="REF-TEST-SERIAL",
            witness_employee_id=witness_id,
            lines=[
                s.ArmoryIntakeLineInput(
                    item_id=ledger.catalog.item(item),
                    entry=s.ArmorySerialIntake(type="serial", serial_codes=[code]),
                )
            ],
        ),
    )


def test_void_serial_intake_leaves_history_and_allows_fresh_registration(ledger: Ledger) -> None:
    registered = _record_serial(ledger, "TEST-0101")
    serial_id = registered.lines[0].serial_id
    assert serial_id is not None

    reversed_posting = voids.void(
        ledger.db, ledger.actor, registered.id, s.ArmoryVoid(reason="Wrong intake")
    )
    serial = catalog.serial_detail(ledger.db, serial_id)
    assert (serial.state, serial.safe, serial.state_at) == (None, None, None)
    assert serial.last_posting_id == registered.id
    assert reversed_posting.lines[0].serial_code == "TEST-0101"

    replacement = _record_serial(ledger, "TEST-0101")
    assert replacement.lines[0].serial_id != serial_id


def test_movement_date_filters_sort_and_page_with_void_history(
    ledger: Ledger, monkeypatch: pytest.MonkeyPatch
) -> None:
    db = ledger.db
    today = factory.NOW.date()
    first = _receipt(ledger, ("cuffs", 4), reference="TEST-MÖVEMENT-1")
    factory.pin_clock(monkeypatch, factory.NOW + dt.timedelta(minutes=1))
    tied_first = _receipt(ledger, ("cuffs", 2), reference="TEST-MÖVEMENT-2")
    tied_latest = _receipt(ledger, ("cuffs", 3), reference="TEST-MÖVEMENT-3")
    voided = voids.void(db, ledger.actor, tied_latest.id, s.ArmoryVoid(reason="Duplicate line"))
    _receipt(ledger, ("baton", 1), reference="TEST-MÖVEMENT-4")
    backdated = _receipt(
        ledger,
        ("cuffs", 1),
        received_on=today - dt.timedelta(days=1),
        reference="TEST-MÖVEMENT-5",
    )

    item_id = ledger.catalog.item("cuffs")
    latest = reads.list_movements(
        db,
        safe_id=ledger.safe_id,
        item_id=item_id,
        q=" mövement ",
        date_from=today,
        date_to=today,
        kind="receipt",
        page=1,
        page_size=2,
    )
    previous = reads.list_movements(
        db,
        safe_id=ledger.safe_id,
        item_id=item_id,
        q=" mövement ",
        date_from=today,
        date_to=today,
        kind="receipt",
        page=2,
        page_size=2,
    )
    assert (latest.page, latest.page_size, latest.total) == (1, 2, 3)
    assert [posting.id for posting in latest.items] == [tied_latest.id, tied_first.id]
    assert latest.items[0] == voided == reads.get_movement(db, tied_latest.id)
    assert [posting.id for posting in previous.items] == [first.id]
    across_dates = reads.list_movements(db, item_id=item_id, q="mövement")
    assert [row.id for row in across_dates.items] == [
        tied_latest.id,
        tied_first.id,
        first.id,
        backdated.id,
    ]
    assert [row.id for row in reads.list_movements(db, q=tied_first.record_ref).items] == [
        tied_first.id
    ]
    with pytest.raises(AppError) as exc:
        reads.list_movements(db, date_from=today, date_to=today - dt.timedelta(days=1))
    assert (exc.value.http_status, exc.value.code, exc.value.details) == (
        422,
        "armory_invalid_input",
        {"field": "from"},
    )


def test_find_is_bounded_cross_safe_and_matches_former_employee_ids(
    ledger: Ledger,
    people: People,
) -> None:
    db = ledger.db
    other_safe = factory.safe(db, ledger.actor, "Test Safe B")
    other = replace(ledger, safe_id=other_safe.id)
    last_custody: s.ArmoryAssignmentRead | None = None
    for n in range(10):
        local = ledger if n % 2 == 0 else other
        _record_serial(local, f"TEST-FIND-{n:03}")
        _receipt(local, ("cuffs", 1), reference=f"REF-FIND-{n:03}")
        holder = factory.employee(db, f"G93{n:02}", name=f"Test Find Guard {n}")
        catalog.create_item(
            db,
            people.operator,
            s.ArmoryItemCreate(
                name_en=f"Test Find Item {n}",
                name_ar=f"عنصر بحث تجريبي {n}",
                kind="quantity",
                category="restraints",
                drawing="cuffs",
            ),
        )
        last_custody = custody.create_custody(
            db,
            people.operator,
            s.ArmoryCustodyCreate(
                safe_id=local.safe_id,
                holder_kind="person",
                holder_employee_id=holder.id,
                kit_id=ledger.catalog.kit("equipment"),
                lines=[s.ArmoryAssignmentLineInput(item_id=ledger.catalog.item("cuffs"), qty=1)],
            ),
        )

    matches = reads.find(db, q=" FIND ", recent_safe_id=ledger.safe_id)
    assert [
        len(group)
        for group in (
            matches.serials,
            matches.guards,
            matches.items,
            matches.custody,
            matches.postings,
        )
    ] == [8, 8, 8, 8, 8]
    (bilingual,) = reads.find(db, q="بحث تجريبي ٩", recent_safe_id=None).items
    assert bilingual.name_en == "Test Find Item 9"
    assert last_custody is not None
    record = reads.find(db, q=last_custody.record_ref, recent_safe_id=ledger.safe_id)
    assert [row.id for row in record.custody] == [last_custody.id]
    assert [row.id for row in record.postings] == [last_custody.id]
    assert {row.safe.id for row in matches.serials if row.safe is not None} == {
        ledger.safe_id,
        other.safe_id,
    }
    (cross_safe,) = reads.find(db, q="  finD-٠٠٩  ", recent_safe_id=ledger.safe_id).serials
    assert cross_safe.safe is not None and cross_safe.safe.id == other.safe_id
    assert cross_safe.serial_code == "TEST-FIND-009"

    recent = reads.find(db, q="   ", recent_safe_id=ledger.safe_id)
    assert [row.serial_code for row in recent.serials] == [
        "TEST-FIND-008",
        "TEST-FIND-006",
        "TEST-FIND-004",
        "TEST-FIND-002",
    ]
    assert not any((recent.guards, recent.items, recent.custody, recent.postings))

    former = factory.employee(db, "G9400", status="Resigned")
    db.add(
        EmployeeFormerId(
            employee_id=former.id,
            new_id=former.id,
            former_id="G9499",
            reason="Fixture ID correction",
        )
    )
    db.commit()
    (match,) = reads.find(db, q="  g٩٤٩٩ ", recent_safe_id=None).guards
    assert match.employee_id == former.id
    assert match.is_former


def _assert_dependency(exc: AppError, posting_id: int, blocker_id: int | None) -> None:
    assert (exc.http_status, exc.code, exc.details) == (
        409,
        "armory_void_dependency",
        {"posting_id": posting_id, "blocking_posting_id": blocker_id},
    )


def test_void_receipt_rolls_back_every_bucket_when_issued_stock_blocks_it(ledger: Ledger) -> None:
    db = ledger.db
    receipt = _receipt(ledger, ("cuffs", 4), ("baton", 2))
    operator = factory.account(db, employee_id=factory.employee(db, "G9200").id)
    holder_id = factory.employee(db, "G9201").id
    custody.create_issue(
        db,
        operator,
        s.ArmoryShiftIssueCreate(
            safe_id=ledger.safe_id,
            employee_id=holder_id,
            kit_id=ledger.catalog.kit("equipment"),
            off_duty_reason="cover",
            lines=[s.ArmoryAssignmentLineInput(item_id=ledger.catalog.item("cuffs"), qty=1)],
        ),
    )

    with pytest.raises(AppError) as exc:
        voids.void(db, ledger.actor, receipt.id, s.ArmoryVoid(reason="Duplicate delivery"))

    _assert_dependency(exc.value, receipt.id, None)
    assert reads.get_movement(db, receipt.id).voided_at is None
    assert (
        catalog.item_detail(
            db, ledger.catalog.item("cuffs"), safe_id=ledger.safe_id
        ).totals.known_in_safe
        == 3
    )
    assert (
        catalog.item_detail(
            db, ledger.catalog.item("baton"), safe_id=ledger.safe_id
        ).totals.known_in_safe
        == 2
    )


def test_void_counted_zero_opening_restores_unknown_and_allows_reattestation(
    ledger: Ledger,
) -> None:
    db = ledger.db
    item_id = ledger.catalog.item("cuffs")
    opening = _receipt(ledger, ("cuffs", 0), kind="opening")
    _receipt(ledger, ("cuffs", 3))
    assert catalog.item_detail(db, item_id, safe_id=ledger.safe_id).totals.opening_qty == 0

    voids.void(db, ledger.actor, opening.id, s.ArmoryVoid(reason="Unattested baseline"))

    totals = catalog.item_detail(db, item_id, safe_id=ledger.safe_id).totals
    assert (totals.opening_qty, totals.in_safe, totals.known_in_safe, totals.received_qty) == (
        None,
        None,
        3,
        3,
    )
    _receipt(ledger, ("cuffs", 2), kind="opening")
    totals = catalog.item_detail(db, item_id, safe_id=ledger.safe_id).totals
    assert (totals.opening_qty, totals.in_safe) == (2, 5)


@dataclass(frozen=True)
class People:
    operator: User
    holder_id: str
    witness_id: str
    fresh_witness_id: str


@pytest.fixture
def people(ledger: Ledger) -> People:
    db = ledger.db
    return People(
        factory.account(db, employee_id=factory.employee(db, "G9210").id),
        factory.employee(db, "G9211").id,
        factory.employee(db, "G9212").id,
        factory.employee(db, "G9213").id,
    )


def _issue(
    ledger: Ledger,
    people: People,
    *lines: s.ArmoryAssignmentLineInput,
    kit: str = "equipment",
) -> s.ArmoryAssignmentRead:
    return custody.create_issue(
        ledger.db,
        people.operator,
        s.ArmoryShiftIssueCreate(
            safe_id=ledger.safe_id,
            employee_id=people.holder_id,
            kit_id=ledger.catalog.kit(kit),
            off_duty_reason="cover",
            lines=list(lines),
            licence_warning_acknowledged=kit != "equipment",
        ),
    )


def _return(
    ledger: Ledger,
    people: People,
    assignment_id: int,
    *lines: s.ArmoryReturnLineInput,
    witnessed: bool = False,
) -> s.ArmoryReturnRead:
    return custody.create_return(
        ledger.db,
        people.operator,
        s.ArmoryReturnCreate(
            assignment_id=assignment_id,
            witness_employee_id=people.witness_id if witnessed else None,
            lines=list(lines),
        ),
    )


def test_void_issue_requires_return_to_be_voided_first(ledger: Ledger, people: People) -> None:
    db = ledger.db
    item_id = ledger.catalog.item("cuffs")
    _receipt(ledger, ("cuffs", 4))
    issue = _issue(ledger, people, s.ArmoryAssignmentLineInput(item_id=item_id, qty=2))
    (issued,) = issue.lines
    returned = _return(
        ledger,
        people,
        issue.id,
        s.ArmoryReturnLineInput(
            assignment_line_id=issued.id, expected_remaining_qty=2, returned_qty=2
        ),
    )
    payload = s.ArmoryVoid(reason="Wrong entry")

    with pytest.raises(AppError) as exc:
        voids.void(db, ledger.actor, issue.id, payload)
    _assert_dependency(exc.value, issue.id, returned.posting.id)

    voids.void(db, ledger.actor, returned.posting.id, payload)
    reopened = custody.get_issue(db, issue.id)
    assert (reopened.state, reopened.lines[0].remaining_qty) == ("active", 2)
    voids.void(db, ledger.actor, issue.id, payload)
    reversed_issue = custody.get_issue(db, issue.id)
    assert (reversed_issue.state, reversed_issue.lines[0].remaining_qty) == ("voided", 0)
    totals = catalog.item_detail(db, item_id, safe_id=ledger.safe_id).totals
    assert (totals.known_in_safe, totals.out_on_shift) == (4, 0)
    assert [row.id for row in reads.list_movements(db, employee_id=people.holder_id).items] == [
        returned.posting.id,
        issue.id,
    ]


def _qualify(ledger: Ledger, people: People) -> None:
    custody.save_qualification(
        ledger.db,
        people.operator,
        people.holder_id,
        s.ArmoryQualificationUpsert(course_round=1, licence_number=None, licence_expires_on=None),
        if_match='"0"',
    )


def _new_firearm(ledger: Ledger, people: People, code: str) -> s.ArmoryAssignmentLineInput:
    firearm = _record_serial(
        replace(ledger, actor=people.operator), code, item="rifle", witness_id=people.witness_id
    ).lines[0]
    assert firearm.serial_id is not None
    return s.ArmoryAssignmentLineInput(item_id=firearm.item.id, qty=1, serial_id=firearm.serial_id)


def test_void_shortfall_return_reopens_holds_only_with_a_fresh_witness(
    ledger: Ledger,
    people: People,
) -> None:
    db = ledger.db
    _qualify(ledger, people)
    original_firearm = _new_firearm(ledger, people, "TEST-VOID-1001")
    another_firearm = _new_firearm(ledger, people, "TEST-VOID-1002")
    _receipt(
        replace(ledger, actor=people.operator), ("rifle-rounds", 7), witness_id=people.witness_id
    )
    ammo_id = ledger.catalog.item("rifle-rounds")
    issue = _issue(
        ledger,
        people,
        original_firearm,
        s.ArmoryAssignmentLineInput(item_id=ammo_id, qty=5),
        kit="rifle",
    )
    firearm, ammo = issue.lines
    ret = _return(
        ledger,
        people,
        issue.id,
        s.ArmoryReturnLineInput(
            assignment_line_id=firearm.id, expected_remaining_qty=1, returned_qty=1
        ),
        s.ArmoryReturnLineInput(
            assignment_line_id=ammo.id,
            expected_remaining_qty=5,
            returned_qty=3,
            shortfall=s.ArmoryShortfallInput(reason="training", reference="REF-TEST-SHORT"),
        ),
        witnessed=True,
    )
    ret_id = ret.posting.id
    former_witness = factory.employee(db, "G9214", status="Resigned")
    for witness_id in (
        None,
        people.operator.employee_id,
        people.witness_id,
        people.holder_id,
        former_witness.id,
    ):
        with pytest.raises(AppError) as exc:
            voids.void(
                db,
                people.operator,
                ret_id,
                s.ArmoryVoid(reason="Wrong return", witness_employee_id=witness_id),
            )
        assert (exc.value.http_status, exc.value.code, exc.value.details) == (
            422,
            "armory_invalid_witness",
            {"witness_employee_id": witness_id},
        )
    payload = s.ArmoryVoid(reason="Wrong return", witness_employee_id=people.fresh_witness_id)
    with pytest.raises(AppError) as exc:
        voids.void(db, ledger.actor, ret_id, payload)
    assert (exc.value.http_status, exc.value.code) == (422, "armory_actor_employee_required")

    holder_safe = factory.safe(db, ledger.actor, "Test Site Holder")
    conflicting = custody.create_custody(
        db,
        people.operator,
        s.ArmoryCustodyCreate(
            safe_id=ledger.safe_id,
            holder_kind="site",
            holder_safe_id=holder_safe.id,
            supervisor_employee_id=people.holder_id,
            kit_id=ledger.catalog.kit("rifle"),
            lines=[another_firearm],
            licence_warning_acknowledged=True,
        ),
    )
    assert [
        row.id
        for row in reads.list_movements(
            db,
            employee_id=people.holder_id,
            kind="custody",
        ).items
    ] == [conflicting.id]
    assert [row.id for row in reads.find(db, q="site holder", recent_safe_id=None).custody] == [
        conflicting.id
    ]
    with pytest.raises(AppError) as exc:
        voids.void(db, people.operator, ret_id, payload)
    _assert_dependency(exc.value, ret_id, conflicting.id)
    assert custody.get_issue(db, issue.id).state == "ended"
    assert reads.get_movement(db, ret_id).voided_at is None
    totals = catalog.item_detail(db, ammo_id, safe_id=ledger.safe_id).totals
    assert (totals.known_in_safe, totals.awaiting_rounds_decision) == (5, 2)

    voids.void(db, people.operator, conflicting.id, s.ArmoryVoid(reason="Wrong custody"))
    closed = custody.get_custody(db, conflicting.id)
    assert (closed.state, closed.lines[0].remaining_qty) == ("voided", 0)
    voided = voids.void(db, people.operator, ret_id, payload)
    assert voided.void_witness is not None
    assert voided.void_witness.employee_id == people.fresh_witness_id
    reopened = custody.get_issue(db, issue.id)
    assert reopened.state == "active"
    assert [line.remaining_qty for line in reopened.lines] == [1, 5]
    assert [line.remaining_before for line in voided.lines] == [1, 5]
    totals = catalog.item_detail(db, ammo_id, safe_id=ledger.safe_id).totals
    assert (totals.known_in_safe, totals.awaiting_rounds_decision, totals.out_on_shift) == (2, 0, 5)
    with pytest.raises(AppError) as exc:
        _issue(ledger, people, another_firearm, kit="rifle")
    assert (exc.value.http_status, exc.value.code) == (409, "armory_firearm_already_held")


def _discrepancy(
    ledger: Ledger,
    user: User,
    discrepancy_id: int,
) -> s.ArmoryDiscrepancyRead:
    (found,) = audit.list_discrepancies(
        ledger.db,
        user,
        safe_id=ledger.safe_id,
        status="all",
        discrepancy_id=discrepancy_id,
        page=1,
        page_size=50,
    ).items
    return found


def test_void_check_marks_only_its_own_missing_serials_and_reopens_a_decision(
    ledger: Ledger,
    people: People,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db = ledger.db
    first = _new_firearm(ledger, people, "TEST-VOID-2001").serial_id
    second = _new_firearm(ledger, people, "TEST-VOID-2002").serial_id
    assert first is not None and second is not None
    before = catalog.serial_detail(db, first)
    draft = audit.shift_check_draft(db, people.operator, ledger.safe_id)
    check = audit.create_shift_check(
        db,
        people.operator,
        ledger.safe_id,
        s.ArmoryShiftCheckCreate(
            snapshot_token=draft.snapshot_token,
            observed_serial_ids=[second],
            confirm_missing=True,
            witness_employee_id=people.witness_id,
        ),
    )
    (discrepancy_id,) = check.discrepancy_ids
    decider = factory.account(db, employee_id=factory.employee(db, "G9215").id)
    decision = audit.decide(
        db,
        decider,
        discrepancy_id,
        s.ArmoryDecisionCreate(
            outcome="found", note="Found", witness_employee_id=people.witness_id
        ),
    ).decision
    assert decision is not None
    assert catalog.serial_detail(db, first).state == "in_safe"

    payload = s.ArmoryVoid(reason="Wrong observation", witness_employee_id=people.fresh_witness_id)
    with pytest.raises(AppError) as exc:
        voids.void(db, people.operator, check.posting.id, payload)
    _assert_dependency(exc.value, check.posting.id, decision.posting.id)

    voids.void(db, decider, decision.posting.id, payload)
    assert _discrepancy(ledger, decider, discrepancy_id).status == "open"
    reversed_serial = catalog.serial_detail(db, first)
    assert (reversed_serial.state, reversed_serial.last_posting_id) == ("missing", check.posting.id)
    assert reads.get_movement(db, decision.posting.id).decision_outcome == "found"

    factory.pin_clock(monkeypatch, factory.NOW + dt.timedelta(hours=10))
    night_draft = audit.shift_check_draft(db, people.operator, ledger.safe_id)
    night = audit.create_shift_check(
        db,
        people.operator,
        ledger.safe_id,
        s.ArmoryShiftCheckCreate(
            snapshot_token=night_draft.snapshot_token,
            observed_serial_ids=[],
            confirm_missing=True,
            witness_employee_id=people.witness_id,
        ),
    )
    (night_finding,) = night.discrepancy_ids
    voids.void(db, people.operator, check.posting.id, payload)
    assert _discrepancy(ledger, decider, discrepancy_id).status == "voided"
    assert _discrepancy(ledger, decider, night_finding).status == "open"
    restored = catalog.serial_detail(db, first)
    assert (restored.state, restored.last_posting_id, restored.state_at) == (
        before.state,
        before.last_posting_id,
        before.state_at,
    )
    still_missing = catalog.serial_detail(db, second)
    assert (still_missing.state, still_missing.last_posting_id) == ("missing", night.posting.id)


def test_void_stock_posting_refuses_a_quantity_correction_even_with_enough_stock(
    ledger: Ledger,
    people: People,
) -> None:
    db = ledger.db
    item_id = ledger.catalog.item("cuffs")
    _receipt(ledger, ("cuffs", 2), kind="opening")
    receipt = _receipt(ledger, ("cuffs", 4))
    draft = audit.monthly_count_draft(db, people.operator, ledger.safe_id)
    monthly = audit.create_monthly_count(
        db,
        people.operator,
        ledger.safe_id,
        s.ArmoryMonthlyCountCreate(
            snapshot_token=draft.snapshot_token,
            witness_employee_id=people.witness_id,
            lines=[
                s.ArmoryCountObservation(
                    item_id=row.id,
                    observed_qty=8 if row.id == item_id else 0,
                    observed_serial_codes=[],
                    serials_complete=row.kind in ("serial", "firearm"),
                )
                for row in draft.items
            ],
        ),
    )
    (discrepancy_id,) = monthly.discrepancy_ids
    decider = factory.account(db, employee_id=factory.employee(db, "G9215").id)
    decision = audit.decide(
        db,
        decider,
        discrepancy_id,
        s.ArmoryDecisionCreate(
            outcome="found", note="Surplus counted", witness_employee_id=people.witness_id
        ),
    ).decision
    assert decision is not None
    payload = s.ArmoryVoid(reason="Duplicate quantity")

    with pytest.raises(AppError) as exc:
        voids.void(db, ledger.actor, receipt.id, payload)
    _assert_dependency(exc.value, receipt.id, decision.posting.id)
    assert catalog.item_detail(db, item_id, safe_id=ledger.safe_id).totals.known_in_safe == 8

    voids.void(
        db,
        decider,
        decision.posting.id,
        s.ArmoryVoid(reason="Wrong correction", witness_employee_id=people.fresh_witness_id),
    )
    assert _discrepancy(ledger, decider, discrepancy_id).status == "open"
    assert catalog.item_detail(db, item_id, safe_id=ledger.safe_id).totals.known_in_safe == 6
    voids.void(db, ledger.actor, receipt.id, payload)
    assert catalog.item_detail(db, item_id, safe_id=ledger.safe_id).totals.known_in_safe == 2


def test_void_transfer_restores_previous_fact_and_bumps_both_safe_revisions(
    ledger: Ledger,
    people: People,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db = ledger.db
    destination = factory.safe(db, ledger.actor, "Test Transfer Destination")
    intake = _record_serial(ledger, "TEST-TRANSFER-0302")
    serial_id = intake.lines[0].serial_id
    assert serial_id is not None
    before = catalog.serial_detail(db, serial_id)
    factory.pin_clock(monkeypatch, factory.NOW + dt.timedelta(minutes=5))
    transfer = catalog.move_serial(
        db,
        people.operator,
        serial_id,
        s.ArmorySerialMovementCreate(
            action="transfer",
            expected_state="in_safe",
            expected_safe_id=ledger.safe_id,
            expected_posting_id=intake.id,
            destination_safe_id=destination.id,
            reason="Test equipment relocation",
            witness_employee_id=people.witness_id,
        ),
    )
    source = db.get(ArmorySafe, ledger.safe_id)
    assert source is not None
    revisions = (source.stock_revision, destination.stock_revision)
    for safe_id in (source.id, destination.id):
        (movement,) = reads.list_movements(
            db,
            safe_id=safe_id,
            item_id=ledger.catalog.item("radio"),
            serial=" transfer-٠٣٠٢ ",
            employee_id=people.witness_id,
            kind="serial_state",
            q="equipment relocation",
        ).items
        assert movement.id == transfer.id
        assert (
            movement.destination_safe is not None and movement.destination_safe.id == destination.id
        )
    assert [
        row.id
        for row in reads.list_movements(
            db,
            employee_id=people.operator.employee_id,
        ).items
    ] == [transfer.id]
    with pytest.raises(AppError) as exc:
        voids.void(db, people.operator, intake.id, s.ArmoryVoid(reason="Wrong intake"))
    _assert_dependency(exc.value, intake.id, transfer.id)

    voids.void(
        db,
        people.operator,
        transfer.id,
        s.ArmoryVoid(reason="Wrong destination", witness_employee_id=people.fresh_witness_id),
    )
    assert (source.stock_revision, destination.stock_revision) == tuple(n + 1 for n in revisions)
    restored = catalog.serial_detail(db, serial_id)
    assert (restored.safe, restored.state, restored.state_at, restored.last_posting_id) == (
        before.safe,
        before.state,
        before.state_at,
        intake.id,
    )
    (history,) = reads.list_movements(db, safe_id=destination.id).items
    assert history.id == transfer.id
    assert history.voided_at is not None


def test_void_serial_registration_restores_unregistered_quantity(ledger: Ledger) -> None:
    db = ledger.db
    item_id = ledger.catalog.item("radio")
    catalog.create_receipt(
        db,
        ledger.actor,
        s.ArmoryReceiptCreate(
            kind="opening",
            safe_id=ledger.safe_id,
            received_on=factory.NOW.date(),
            lines=[
                s.ArmoryIntakeLineInput(
                    item_id=item_id,
                    entry=s.ArmorySerialIntake(type="serial", serial_codes=[], unrecorded_qty=1),
                )
            ],
        ),
    )
    payload = s.ArmorySerialRegistrationCreate(safe_id=ledger.safe_id, serial_codes=["TEST-0501"])
    registered = catalog.record_serials(db, ledger.actor, item_id, payload)
    before = catalog.item_detail(db, item_id, safe_id=ledger.safe_id).totals
    assert (before.known_in_safe, before.unrecorded_qty, before.available_qty) == (1, 0, 1)
    voids.void(db, ledger.actor, registered.id, s.ArmoryVoid(reason="Wrong registration"))
    after = catalog.item_detail(db, item_id, safe_id=ledger.safe_id).totals
    assert (after.known_in_safe, after.unrecorded_qty, after.available_qty) == (1, 1, 0)
    replacement = catalog.record_serials(db, ledger.actor, item_id, payload)
    (old_id,) = [row.serial_id for row in registered.lines if row.serial_id is not None]
    (fresh_id,) = [row.serial_id for row in replacement.lines if row.serial_id is not None]
    assert fresh_id != old_id


def test_two_sessions_can_void_a_posting_only_once(
    api_db: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    factory.pin_clock(monkeypatch)
    catalogue = factory.seed_catalogue(api_db)
    actor = factory.account(api_db)
    safe = factory.safe(api_db, actor)
    actor_id, safe_id = actor.id, safe.id
    ledger = Ledger(api_db, catalogue, actor, safe_id)
    receipt_id = _receipt(ledger, ("cuffs", 1)).id
    sessions = sessionmaker(bind=api_db.get_bind(), autoflush=False, expire_on_commit=False)
    ready = Barrier(2)

    def attempt() -> s.ArmoryPostingRead | AppError:
        with sessions() as db:
            user = db.get(User, actor_id)
            cached = db.get(ArmoryPosting, receipt_id)
            assert user is not None and cached is not None and cached.voided_at is None
            ready.wait(timeout=3)
            try:
                return voids.void(db, user, receipt_id, s.ArmoryVoid(reason="Duplicate receipt"))
            except AppError as exc:
                return exc

    with ThreadPoolExecutor(max_workers=2) as workers:
        one = workers.submit(attempt)
        two = workers.submit(attempt)
        outcomes = (one.result(), two.result())
    (winner,) = [result for result in outcomes if isinstance(result, s.ArmoryPostingRead)]
    (loser,) = [result for result in outcomes if isinstance(result, AppError)]
    assert winner.voided_at == factory.NOW
    assert (loser.http_status, loser.code, loser.details) == (
        409,
        "armory_already_voided",
        {"posting_id": receipt_id},
    )
    audits = api_db.scalars(
        select(AuditLog.id).where(
            AuditLog.entity_id == str(receipt_id),
            AuditLog.action == "armory.posting.voided",
        )
    ).all()
    assert len(audits) == 1
