"""Armory catalogue and stock rules through the real SQLite service boundary."""

from __future__ import annotations

import datetime as dt
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from typing import Literal

import pytest
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from app.api.errors import AppError
from app.db.models import ArmorySafe, AuditLog, User, VehicleSite
from app.schemas import armory as s
from app.services import armory_audit_service as audit
from app.services import armory_catalog_service as svc
from app.services import armory_custody_service as custody
from app.services import armory_void_service as voids
from tests.factories.armory import (
    NOW,
    Catalogue,
    account,
    employee,
    pin_clock,
    safe,
    seed_catalogue,
)


@pytest.fixture(autouse=True)
def _clock(monkeypatch: pytest.MonkeyPatch) -> None:
    pin_clock(monkeypatch)


def _error(
    caught: pytest.ExceptionInfo[AppError], status: int, code: str, **details: object
) -> None:
    assert (caught.value.http_status, caught.value.code, caught.value.details) == (
        status,
        code,
        details,
    )


def test_safe_sites_require_active_unused_site_and_exact_duty_path(db_session: Session) -> None:
    actor = account(db_session)
    site = VehicleSite(name_en="Test Fleet Site", name_ar="موقع أسطول تجريبي", active=True)
    inactive = VehicleSite(name_en="Test Closed Site", name_ar="موقع تجريبي مغلق", active=False)
    first = employee(db_session, "G9101")
    second = employee(db_session, "G9102")
    first.duty_unit, first.duty_post = " Test Unit ", " Test Post "
    second.duty_unit, second.duty_post = "Test Unit", "Test Post"
    db_session.add_all([site, inactive])
    db_session.commit()

    options = svc.site_options(db_session)
    assert [option.id for option in options.vehicle_sites] == [site.id]
    assert [(path.duty_unit, path.duty_post) for path in options.duty_posts] == [
        ("Test Unit", "Test Post")
    ]

    base = s.ArmorySafeCreate(name_en="Test Straße Safe", name_ar="خزنة تجريبية أولى")
    for values, field in (
        ({"vehicle_site_id": inactive.id}, "vehicle_site_id"),
        ({"duty_unit": "Test Unit"}, "duty_post"),
        ({"duty_unit": "Test Unit", "duty_post": "test post"}, "duty_post"),
    ):
        with pytest.raises(AppError) as caught:
            svc.create_safe(db_session, actor, base.model_copy(update=values))
        _error(caught, 422, "armory_invalid_input", field=field)

    created = svc.create_safe(
        db_session,
        actor,
        s.ArmorySafeCreate(
            name_en=" Test Straße Safe ",
            name_ar=" خزنة تجريبية أولى ",
            vehicle_site_id=site.id,
            duty_unit="Test Unit",
            duty_post="Test Post",
        ),
    )
    assert created.name_en == "Test Straße Safe"
    assert created.name_ar == "خزنة تجريبية أولى"
    assert created.vehicle_site == options.vehicle_sites[0]
    assert created.duty_post == options.duty_posts[0]
    alternate = s.ArmorySafeCreate(name_en="test alpha safe", name_ar="خزنة تجريبية ثانية")
    for values, field in (
        ({"name_en": "TEST STRASSE SAFE"}, "name_en"),
        ({"name_ar": "خزنة تجريبية أولى"}, "name_ar"),
        ({"vehicle_site_id": site.id}, "vehicle_site_id"),
        ({"duty_unit": "Test Unit", "duty_post": "Test Post"}, "duty_post"),
    ):
        with pytest.raises(AppError) as caught:
            svc.create_safe(db_session, actor, alternate.model_copy(update=values))
        _error(caught, 409, "armory_duplicate_safe", field=field)
    other = svc.create_safe(db_session, actor, alternate)
    assert svc.list_safes(db_session) == [other, created]


def test_shift_settings_are_versioned_and_apply_at_next_local_midnight(
    db_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    actor = account(db_session)
    defaults = svc.get_settings(db_session)
    assert defaults.version == 0
    assert (defaults.current.day_start, defaults.current.night_start) == ("06:00", "18:00")
    assert defaults.pending is None
    update = s.ArmorySettingsUpdate(day_start="07:00", night_start="19:00", grace_minutes=15)
    saved = svc.update_settings(db_session, actor, update, '"0"')
    assert saved.version > defaults.version
    assert saved.current == defaults.current
    assert saved.pending is not None
    assert saved.pending.effective_on == NOW.date() + dt.timedelta(days=1)
    for precondition in (None, '"0"'):
        with pytest.raises(AppError) as caught:
            svc.update_settings(db_session, actor, update, precondition)
        assert (caught.value.http_status, caught.value.code, caught.value.details) == (
            412,
            "armory_version_mismatch",
            {"version": saved.version},
        )
    revised = svc.update_settings(
        db_session,
        actor,
        update.model_copy(update={"day_start": "08:00"}),
        f'"{saved.version}"',
    )
    assert revised.version > saved.version
    assert revised.pending is not None and revised.pending.effective_on is not None
    assert revised.pending.day_start == "08:00"

    midnight = dt.datetime.combine(revised.pending.effective_on, dt.time(), tzinfo=NOW.tzinfo)
    pin_clock(monkeypatch, midnight - dt.timedelta(seconds=1))
    assert svc.get_settings(db_session) == revised
    pin_clock(monkeypatch, midnight)
    effective = svc.get_settings(db_session)
    assert effective.current == revised.pending
    assert effective.pending is None
    assert effective.version == revised.version


@pytest.fixture
def catalogue(db_session: Session) -> Catalogue:
    return seed_catalogue(db_session)


def _line(item_id: int, entry: s.ArmoryIntakeEntry) -> s.ArmoryIntakeLineInput:
    return s.ArmoryIntakeLineInput(item_id=item_id, entry=entry)


def _receipt(
    safe_id: int,
    *lines: s.ArmoryIntakeLineInput,
    kind: Literal["opening", "receipt"] = "receipt",
    witness_employee_id: str | None = None,
) -> s.ArmoryReceiptCreate:
    return s.ArmoryReceiptCreate(
        safe_id=safe_id,
        kind=kind,
        received_on=NOW.date(),
        source="supplier" if kind == "receipt" else None,
        reference="REF-TEST-1",
        witness_employee_id=witness_employee_id,
        lines=list(lines),
    )


def test_receipt_keeps_opening_unknown_until_explicit_attestation(
    db_session: Session, catalogue: Catalogue
) -> None:
    actor = account(db_session)
    item_id = catalogue.item("cuffs")
    assert svc.item_detail(db_session, item_id, safe_id=None).totals.opening_qty is None
    first = safe(db_session, actor).id
    second = safe(db_session, actor, "Test Safe B").id
    uncounted = svc.item_detail(db_session, item_id, safe_id=first)
    assert uncounted.totals.opening_qty is None
    assert uncounted.totals.in_safe is None
    assert uncounted.totals.book_total is None
    assert uncounted.totals.known_in_safe == uncounted.totals.available_qty == 0

    received = svc.create_receipt(
        db_session,
        actor,
        _receipt(first, _line(item_id, s.ArmoryQuantityIntake(type="quantity", qty=3))),
    )
    assert (received.kind, received.occurred_on, received.occurred_at) == (
        "receipt",
        NOW.date(),
        None,
    )
    with_receipt = svc.item_detail(db_session, item_id, safe_id=first).totals
    assert with_receipt.opening_qty is with_receipt.in_safe is with_receipt.book_total is None
    assert (
        with_receipt.received_qty == with_receipt.known_in_safe == with_receipt.available_qty == 3
    )
    opening = _receipt(
        first, _line(item_id, s.ArmoryQuantityIntake(type="quantity", qty=0)), kind="opening"
    )
    attestation = svc.create_receipt(db_session, actor, opening)
    assert attestation.kind == "opening" and attestation.source is None
    assert [(line.qty, line.stock_delta) for line in attestation.lines] == [(0, 0)]
    with pytest.raises(AppError) as caught:
        svc.create_receipt(db_session, actor, opening)
    _error(caught, 422, "armory_invalid_input", field="lines.0.entry")

    all_safes = svc.item_detail(db_session, item_id, safe_id=None)
    assert [stock.safe.id for stock in all_safes.stock] == [first, second]
    assert all_safes.stock[0].opening_qty == 0
    assert all_safes.stock[0].in_safe == all_safes.stock[0].book_total == 3
    assert all_safes.stock[1].opening_qty is all_safes.totals.opening_qty is None
    assert all_safes.totals.in_safe is all_safes.totals.book_total is None
    assert all_safes.totals.received_qty == all_safes.totals.known_in_safe == 3
    assert [posting.id for posting in all_safes.recent_movements] == [attestation.id, received.id]


def _audit_count(db: Session) -> int:
    return db.scalar(select(func.count()).select_from(AuditLog)) or 0


def test_item_openings_and_kit_links_commit_together_or_not_at_all(
    db_session: Session, catalogue: Catalogue
) -> None:
    actor = account(db_session)
    first = safe(db_session, actor).id
    second = safe(db_session, actor, "Test Safe B").id
    existing_code = "TEST-EXISTING-1"
    svc.create_receipt(
        db_session,
        actor,
        _receipt(
            second,
            _line(
                catalogue.item("radio"),
                s.ArmorySerialIntake(type="serial", serial_codes=[existing_code]),
            ),
        ),
    )
    audits_before = _audit_count(db_session)
    equipment_kit_id = catalogue.kit("equipment")
    first_opening = s.ArmoryOpeningInput(
        safe_id=first,
        received_on=NOW.date(),
        entry=s.ArmorySerialIntake(type="serial", serial_codes=[], unrecorded_qty=0),
    )
    second_opening = s.ArmoryOpeningInput(
        safe_id=second,
        received_on=NOW.date(),
        entry=s.ArmorySerialIntake(type="serial", serial_codes=[existing_code.lower()]),
    )
    item = s.ArmoryItemCreate(
        name_en=" Test Straße Camera ",
        name_ar=" كاميرا تجريبية جديدة ",
        kind="serial",
        category="comms",
        drawing="bodycam",
        optional_kit_ids=[equipment_kit_id],
        openings=[first_opening, second_opening],
    )
    with pytest.raises(AppError) as caught:
        svc.create_item(db_session, actor, item)
    _error(caught, 409, "armory_duplicate_serial", serial_code=existing_code)
    assert (
        svc.list_items(
            db_session, safe_id=None, category=None, q="Test Strasse Camera", stock_view="all"
        )
        == []
    )
    assert db_session.scalar(select(ArmorySafe.stock_revision).where(ArmorySafe.id == first)) == 0
    assert _audit_count(db_session) == audits_before

    second_opening = second_opening.model_copy(
        update={"entry": s.ArmorySerialIntake(type="serial", serial_codes=["TEST-NEW-1"])}
    )
    created = svc.create_item(
        db_session, actor, item.model_copy(update={"openings": [first_opening, second_opening]})
    )
    assert created.name_en == "Test Straße Camera" and created.name_ar == "كاميرا تجريبية جديدة"
    assert [(stock.safe.id, stock.opening_qty) for stock in created.stock] == [
        (first, 0),
        (second, 1),
    ]
    assert created.totals.opening_qty == created.totals.in_safe == created.totals.book_total == 1
    assert created.totals.received_qty == 0
    assert [p.kind for p in created.recent_movements] == ["opening", "opening"]
    assert created.optional_kit_ids == [equipment_kit_id]
    equipment = next(kit for kit in svc.list_kits(db_session) if kit.id == equipment_kit_id)
    linked = next(line for line in equipment.lines if line.item.id == created.id)
    assert (linked.role, linked.default_qty, linked.substitutes_item_id) == ("optional", 0, None)
    assert _audit_count(db_session) == audits_before + 1

    for names, field in (
        ({"name_en": "TEST STRASSE CAMERA", "name_ar": "كاميرا تجريبية أخرى"}, "name_en"),
        ({"name_en": "Test Other Camera", "name_ar": "كاميرا تجريبية جديدة"}, "name_ar"),
    ):
        with pytest.raises(AppError) as caught:
            svc.create_item(db_session, actor, item.model_copy(update=names))
        _error(caught, 409, "armory_duplicate_item", field=field, item_id=created.id)


def test_two_sessions_race_to_register_the_last_unrecorded_unit(api_db: Session) -> None:
    item_id = seed_catalogue(api_db).item("radio")
    actor = account(api_db)
    actor_id = actor.id
    safe_id = safe(api_db, actor).id
    svc.create_receipt(
        api_db,
        actor,
        _receipt(
            safe_id,
            _line(item_id, s.ArmorySerialIntake(type="serial", serial_codes=[], unrecorded_qty=1)),
            kind="opening",
        ),
    )
    before = svc.item_detail(api_db, item_id, safe_id=safe_id)
    assert before.totals.unrecorded_qty == before.totals.book_total == 1
    assert before.totals.available_qty == 0
    audits_before = _audit_count(api_db)
    factory = sessionmaker(bind=api_db.get_bind(), expire_on_commit=False, autoflush=False)
    barrier = Barrier(2)

    def register(code: str) -> s.ArmoryPostingRead | AppError:
        with factory() as db:
            recorder = db.get(User, actor_id)
            assert recorder is not None
            barrier.wait(timeout=10)
            try:
                return svc.record_serials(
                    db,
                    recorder,
                    item_id,
                    s.ArmorySerialRegistrationCreate(safe_id=safe_id, serial_codes=[code]),
                )
            except AppError as error:
                return error

    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(pool.map(register, [" test-\u0661 ", "test-\u06f2"]))
    accepted = [outcome for outcome in outcomes if isinstance(outcome, s.ArmoryPostingRead)]
    rejected = [outcome for outcome in outcomes if isinstance(outcome, AppError)]
    assert len(accepted) == len(rejected) == 1
    assert (rejected[0].http_status, rejected[0].code, rejected[0].details) == (
        409,
        "armory_insufficient_stock",
        {"safe_id": safe_id, "item_id": item_id, "batch_id": None, "available_qty": 0},
    )
    assert accepted[0].kind == "serial_registration"
    assert accepted[0].record_ref.startswith("SR-")
    assert [line.stock_delta for line in accepted[0].lines] == [-1, 0]
    with factory() as verify:
        after = svc.item_detail(verify, item_id, safe_id=safe_id)
        assert [row.serial_code for row in after.serials] in (["TEST-1"], ["TEST-2"])
        assert after.totals.book_total == after.totals.known_in_safe == before.totals.book_total
        assert after.totals.opening_qty == after.totals.available_qty == 1
        assert after.totals.unrecorded_qty == after.totals.received_qty == 0
        assert _audit_count(verify) == audits_before + 1


def _movement(
    serial: s.ArmorySerialRead,
    action: s.ArmorySerialAction,
    witness_id: str,
    *,
    destination: int | None = None,
) -> s.ArmorySerialMovementCreate:
    assert serial.state is not None and serial.safe is not None
    return s.ArmorySerialMovementCreate(
        action=action,
        expected_state=serial.state,
        expected_safe_id=serial.safe.id,
        expected_posting_id=serial.last_posting_id,
        destination_safe_id=destination,
        reason="Test movement evidence",
        witness_employee_id=witness_id,
    )


def test_serial_transfer_and_lifecycle_are_guarded_and_keep_one_history(
    db_session: Session, catalogue: Catalogue
) -> None:
    actor = account(db_session, employee_id=employee(db_session, "G9101").id)
    witness_id = employee(db_session, "G9102").id
    first = safe(db_session, actor).id
    second = safe(db_session, actor, "Test Safe B").id
    item_id = catalogue.item("radio")
    opening = svc.create_receipt(
        db_session,
        actor,
        _receipt(
            first,
            _line(item_id, s.ArmorySerialIntake(type="serial", serial_codes=["TEST-XFER-1"])),
            kind="opening",
        ),
    )
    svc.create_receipt(
        db_session,
        actor,
        _receipt(
            second,
            _line(item_id, s.ArmorySerialIntake(type="serial", serial_codes=[], unrecorded_qty=0)),
            kind="opening",
        ),
    )
    serial_id = opening.lines[0].serial_id
    assert serial_id is not None
    start = svc.serial_detail(db_session, serial_id)
    revisions = select(ArmorySafe.stock_revision).order_by(ArmorySafe.id)
    before = list(db_session.scalars(revisions))
    assert before == [1, 1]
    transfer = svc.move_serial(
        db_session, actor, serial_id, _movement(start, "transfer", witness_id, destination=second)
    )
    assert transfer.safe.id == first
    assert transfer.destination_safe is not None and transfer.destination_safe.id == second
    assert [
        (
            line.before_safe_id,
            line.after_safe_id,
            line.before_state,
            line.after_state,
            line.stock_delta,
        )
        for line in transfer.lines
    ] == [(first, second, "in_safe", "in_safe", 0)]
    assert list(db_session.scalars(revisions)) == [2, 2]
    now_at_second = svc.serial_detail(db_session, serial_id)
    assert now_at_second.safe == transfer.destination_safe
    assert [posting.id for posting in now_at_second.recent_movements] == [transfer.id, opening.id]
    at_source = svc.item_detail(db_session, item_id, safe_id=first)
    at_destination = svc.item_detail(db_session, item_id, safe_id=second)
    assert at_source.serials == [] and at_source.recent_movements[0].id == transfer.id
    assert at_destination.recent_movements[0].id == transfer.id
    assert at_source.totals.book_total == at_source.totals.received_qty == 0
    assert at_destination.totals.book_total == at_destination.totals.available_qty == 1
    assert at_destination.totals.received_qty == 0
    repair = _movement(now_at_second, "send_repair", witness_id)
    for stale_field, value in (
        ("expected_safe_id", first),
        ("expected_state", "in_repair"),
        ("expected_posting_id", opening.id),
    ):
        with pytest.raises(AppError) as caught:
            svc.move_serial(
                db_session, actor, serial_id, repair.model_copy(update={stale_field: value})
            )
        _error(caught, 409, "armory_serial_unavailable", serial_id=serial_id)
    svc.move_serial(db_session, actor, serial_id, repair)
    repairing = svc.serial_detail(db_session, serial_id)
    assert repairing.state == "in_repair"
    with pytest.raises(AppError) as caught:
        svc.move_serial(
            db_session,
            actor,
            serial_id,
            _movement(repairing, "transfer", witness_id, destination=first),
        )
    _error(caught, 422, "armory_invalid_input", field="action")
    svc.move_serial(db_session, actor, serial_id, _movement(repairing, "return_repair", witness_id))
    repaired = svc.serial_detail(db_session, serial_id)
    svc.move_serial(db_session, actor, serial_id, _movement(repaired, "mark_lost", witness_id))
    lost = svc.serial_detail(db_session, serial_id)
    assert lost.state == "lost"
    before_writeoff = svc.item_detail(db_session, item_id, safe_id=None).totals
    assert before_writeoff.lost == before_writeoff.book_total == 1
    assert before_writeoff.available_qty == 0
    svc.move_serial(db_session, actor, serial_id, _movement(lost, "write_off", witness_id))
    written_off = svc.serial_detail(db_session, serial_id)
    assert written_off.state == "written_off"
    with pytest.raises(AppError) as caught:
        svc.move_serial(
            db_session, actor, serial_id, _movement(written_off, "return_repair", witness_id)
        )
    _error(caught, 422, "armory_invalid_input", field="action")
    after_writeoff = svc.item_detail(db_session, item_id, safe_id=None).totals
    assert after_writeoff.written_off == 1
    assert after_writeoff.book_total == after_writeoff.lost == 0


def test_receipt_validates_delivery_header_and_requires_controlled_witness(
    db_session: Session, catalogue: Catalogue
) -> None:
    actor = account(db_session, employee_id=employee(db_session, "G9101").id)
    witness_id = employee(db_session, "G9102").id
    safe_id = safe(db_session, actor).id
    rounds_id = catalogue.item("rifle-rounds")
    line = _line(rounds_id, s.ArmoryQuantityIntake(type="quantity", qty=4))
    receipt = _receipt(safe_id, line, witness_employee_id=witness_id)
    for updates, field in (
        ({"received_on": NOW.date() + dt.timedelta(days=1)}, "received_on"),
        ({"source": None}, "source"),
        ({"reference": " "}, "reference"),
        ({"lines": [line, line]}, "lines.1.item_id"),
        (
            {
                "lines": [
                    _line(rounds_id, s.ArmorySerialIntake(type="serial", serial_codes=["TEST-1"]))
                ]
            },
            "lines.0.entry",
        ),
    ):
        with pytest.raises(AppError) as caught:
            svc.create_receipt(db_session, actor, receipt.model_copy(update=updates))
        _error(caught, 422, "armory_invalid_input", field=field)
    with pytest.raises(ValidationError, match="source is only allowed for receipts"):
        s.ArmoryReceiptCreate(
            safe_id=safe_id,
            kind="opening",
            received_on=NOW.date(),
            source="supplier",
            lines=[line],
        )
    for invalid_witness in (None, actor.employee_id):
        with pytest.raises(AppError) as caught:
            svc.create_receipt(
                db_session,
                actor,
                receipt.model_copy(update={"witness_employee_id": invalid_witness}),
            )
        _error(caught, 422, "armory_invalid_witness", witness_employee_id=invalid_witness)
    assert svc.item_detail(db_session, rounds_id, safe_id=safe_id).recent_movements == []
    saved = svc.create_receipt(db_session, actor, receipt)
    assert saved.witness is not None and saved.witness.employee_id == witness_id
    assert (saved.source, saved.reference) == ("supplier", "REF-TEST-1")


@pytest.mark.parametrize("item_key", ["rifle", "rifle-rounds"])
def test_controlled_opening_zero_requires_full_attestation(
    db_session: Session, catalogue: Catalogue, item_key: str
) -> None:
    actor = account(db_session, employee_id=employee(db_session, "G9101").id)
    unlinked = account(db_session)
    witness_id = employee(db_session, "G9102").id
    safe_id = safe(db_session, actor).id
    item_id = catalogue.item(item_key)
    entry: s.ArmoryIntakeEntry = (
        s.ArmorySerialIntake(type="serial", serial_codes=[], unrecorded_qty=0)
        if item_key == "rifle"
        else s.ArmoryQuantityIntake(type="quantity", qty=0)
    )
    opening = _receipt(
        safe_id, _line(item_id, entry), kind="opening", witness_employee_id=witness_id
    )
    with pytest.raises(AppError) as caught:
        svc.create_receipt(db_session, actor, opening.model_copy(update={"reference": None}))
    _error(caught, 422, "armory_invalid_input", field="reference")
    with pytest.raises(AppError) as caught:
        svc.create_receipt(
            db_session, actor, opening.model_copy(update={"witness_employee_id": None})
        )
    _error(caught, 422, "armory_invalid_witness", witness_employee_id=None)
    with pytest.raises(AppError) as caught:
        svc.create_receipt(db_session, unlinked, opening)
    _error(caught, 422, "armory_actor_employee_required")
    assert svc.item_detail(db_session, item_id, safe_id=safe_id).totals.opening_qty is None
    attested = svc.create_receipt(db_session, actor, opening)
    assert attested.witness is not None and attested.witness.employee_id == witness_id
    assert svc.item_detail(db_session, item_id, safe_id=safe_id).totals.opening_qty == 0


def test_receipt_normalizes_serials_and_rejects_duplicates_before_posting(
    db_session: Session, catalogue: Catalogue
) -> None:
    actor = account(db_session)
    first = safe(db_session, actor).id
    second = safe(db_session, actor, "Test Safe B").id
    radio, camera = catalogue.item("radio"), catalogue.item("bodycam")
    line = _line(radio, s.ArmorySerialIntake(type="serial", serial_codes=[" test-\u0661 "]))
    for lines, field in (
        (
            [
                _line(
                    radio,
                    s.ArmorySerialIntake(
                        type="serial", serial_codes=["test-\u0661", "TEST-\u06f1"]
                    ),
                )
            ],
            "lines.0.entry.serial_codes.1",
        ),
        (
            [line, _line(camera, s.ArmorySerialIntake(type="serial", serial_codes=["TEST-1"]))],
            "lines.1.entry.serial_codes.0",
        ),
        (
            [_line(radio, s.ArmorySerialIntake(type="serial", serial_codes=[], unrecorded_qty=0))],
            "lines.0.entry.unrecorded_qty",
        ),
        (
            [_line(radio, s.ArmorySerialIntake(type="serial", serial_codes=[]))],
            "lines.0.entry.serial_codes",
        ),
    ):
        with pytest.raises(AppError) as caught:
            svc.create_receipt(db_session, actor, _receipt(first, *lines))
        _error(caught, 422, "armory_invalid_input", field=field)
    assert svc.item_detail(db_session, radio, safe_id=first).recent_movements == []
    saved = svc.create_receipt(db_session, actor, _receipt(first, line))
    assert saved.lines[0].serial_code == "TEST-1"
    assert [
        item.id
        for item in svc.list_items(
            db_session, safe_id=first, category="comms", q="TEST-\u06f1", stock_view="all"
        )
    ] == [radio]
    assert (
        svc.list_items(db_session, safe_id=second, category=None, q="test-1", stock_view="all")
        == []
    )
    duplicate = _line(camera, s.ArmorySerialIntake(type="serial", serial_codes=["test-1"]))
    with pytest.raises(AppError) as caught:
        svc.create_receipt(db_session, actor, _receipt(second, duplicate))
    _error(caught, 409, "armory_duplicate_serial", serial_code="TEST-1")


def _batches(
    item_id: int, *rows: tuple[str, str, int], counted_zero: bool = False
) -> s.ArmoryIntakeLineInput:
    return _line(
        item_id,
        s.ArmoryExpiryIntake(
            type="expiry",
            counted_zero=counted_zero,
            batches=[
                s.ArmoryBatchIntake(batch_ref=ref, expires_on=expiry, qty=qty)
                for ref, expiry, qty in rows
            ],
        ),
    )


def test_expiry_uses_inclusive_month_end_and_an_item_wide_batch_identity(
    db_session: Session, catalogue: Catalogue
) -> None:
    actor = account(db_session)
    first = safe(db_session, actor).id
    second = safe(db_session, actor, "Test Safe B").id
    item_id = catalogue.item("spray")
    today = NOW.date()
    opening = _receipt(first, _batches(item_id, counted_zero=True), kind="opening")
    assert svc.create_receipt(db_session, actor, opening).lines[0].qty == 0
    for rows, field in (
        ([("TEST-BATCH-1", "2026-02-30", 1)], "lines.0.entry.batches.0.expires_on"),
        ([("TEST-BATCH-1", "2026-02", 0)], "lines.0.entry.batches.0.qty"),
        (
            [("test-batch-\u0661", "2026-02", 1), ("TEST-BATCH-1", "2026-02-28", 1)],
            "lines.0.entry.batches.1.batch_ref",
        ),
        ([], "lines.0.entry.batches"),
    ):
        with pytest.raises(AppError) as caught:
            svc.create_receipt(db_session, actor, _receipt(first, _batches(item_id, *rows)))
        _error(caught, 422, "armory_invalid_input", field=field)

    saved = svc.create_receipt(
        db_session,
        actor,
        _receipt(
            first,
            _batches(
                item_id,
                (" test-batch-\u0661 ", "2024-02", 2),
                ("TEST-BATCH-TODAY", today.isoformat(), 3),
                ("TEST-BATCH-EDGE", (today + dt.timedelta(days=60)).isoformat(), 4),
                ("TEST-BATCH-FAR", (today + dt.timedelta(days=61)).isoformat(), 5),
            ),
        ),
    )
    expired = saved.lines[0].batch
    assert expired is not None
    assert (expired.batch_ref, expired.expires_on) == ("TEST-BATCH-1", dt.date(2024, 2, 29))
    first_view = svc.item_detail(db_session, item_id, safe_id=first)
    assert [read.status for read in first_view.batches] == [
        "expired",
        "expiring",
        "expiring",
        "valid",
    ]
    assert first_view.totals.expired_qty == 2
    assert first_view.totals.book_total == first_view.totals.received_qty == 14
    assert first_view.totals.available_qty == 12

    with pytest.raises(AppError) as caught:
        svc.create_receipt(
            db_session,
            actor,
            _receipt(second, _batches(item_id, ("test-batch-1", "2024-02-28", 1))),
        )
    _error(caught, 409, "armory_batch_expiry_conflict", item_id=item_id, batch_ref="TEST-BATCH-1")
    transferred_batch = svc.create_receipt(
        db_session, actor, _receipt(second, _batches(item_id, ("TEST-BATCH-1", "2024-02-29", 1)))
    )
    assert transferred_batch.lines[0].batch == expired
    assert svc.batch_alert_counts(db_session, today, first) == (1, 2)
    assert svc.batch_alert_counts(db_session, today, second) == (1, 0)
    assert svc.batch_alert_counts(db_session, today, None) == (2, 2)


def test_needs_attention_includes_stock_exceptions_but_not_empty_alert_batches(
    db_session: Session, catalogue: Catalogue
) -> None:
    actor = account(db_session, employee_id=employee(db_session, "G9101").id)
    witness_id = employee(db_session, "G9102").id
    safe_id = safe(db_session, actor).id
    today = NOW.date()
    empty, healthy = catalogue.item("baton"), catalogue.item("cuffs")
    due, fresh = catalogue.item("spray"), catalogue.item("cartridge")
    serial_kind, uncounted = catalogue.item("radio"), catalogue.item("bodycam")
    opening = svc.create_receipt(
        db_session,
        actor,
        _receipt(
            safe_id,
            _line(empty, s.ArmoryQuantityIntake(type="quantity", qty=0)),
            _line(healthy, s.ArmoryQuantityIntake(type="quantity", qty=2)),
            _batches(due, ("TEST-DUE", today.isoformat(), 1)),
            _batches(fresh, ("TEST-FRESH", (today + dt.timedelta(days=61)).isoformat(), 1)),
            _line(
                serial_kind,
                s.ArmorySerialIntake(type="serial", serial_codes=["TEST-R1", "TEST-R2"]),
            ),
            kind="opening",
        ),
    )
    serial_id = next(line.serial_id for line in opening.lines if line.serial_id is not None)
    serial = svc.serial_detail(db_session, serial_id)
    svc.move_serial(db_session, actor, serial_id, _movement(serial, "send_repair", witness_id))
    receipt = svc.create_receipt(
        db_session, actor, _receipt(safe_id, _batches(fresh, ("TEST-EMPTY", today.isoformat(), 1)))
    )
    voids.void(
        db_session, actor, receipt.id, s.ArmoryVoid(reason="Test duplicate delivery correction")
    )
    assert svc.batch_alert_counts(db_session, today, safe_id) == (0, 1)
    fresh_stock = svc.item_detail(db_session, fresh, safe_id=safe_id)
    assert [(row.status, row.on_hand) for row in fresh_stock.batches] == [
        ("expiring", 0),
        ("valid", 1),
    ]
    assert fresh_stock.totals.received_qty == 0
    attention = {
        item.id
        for item in svc.list_items(
            db_session, safe_id=safe_id, category=None, q=None, stock_view="needs_attention"
        )
    }
    assert {empty, due, serial_kind, uncounted} <= attention
    assert {healthy, fresh}.isdisjoint(attention)


@pytest.mark.parametrize(
    ("outcome", "expected"),
    [
        ("used_in_training", (0, 5, 0, 0)),
        ("lost", (0, 0, 5, 0)),
        ("recording_error", (0, 0, 0, 5)),
        ("found", (0, 0, 0, 0)),
    ],
)
def test_rounds_projection_classifies_only_the_live_unreturned_difference(
    db_session: Session,
    catalogue: Catalogue,
    outcome: s.ArmoryDecisionOutcome,
    expected: tuple[int, int, int, int],
) -> None:
    actor = account(db_session, employee_id=employee(db_session, "G9101").id)
    witness_id = employee(db_session, "G9102").id
    holder_id = employee(db_session, "G9103").id
    decider = account(db_session, employee_id=employee(db_session, "G9104").id)
    safe_id = safe(db_session, actor).id
    firearm, rounds = catalogue.item("rifle"), catalogue.item("rifle-rounds")
    opening = svc.create_receipt(
        db_session,
        actor,
        _receipt(
            safe_id,
            _line(firearm, s.ArmorySerialIntake(type="serial", serial_codes=["TEST-PROJ-1"])),
            _line(rounds, s.ArmoryQuantityIntake(type="quantity", qty=20)),
            kind="opening",
            witness_employee_id=witness_id,
        ),
    )
    serial_id = opening.lines[0].serial_id
    assert serial_id is not None
    svc.create_receipt(
        db_session,
        actor,
        _receipt(
            safe_id,
            _line(rounds, s.ArmoryQuantityIntake(type="quantity", qty=4)),
            witness_employee_id=witness_id,
        ),
    )
    custody.save_qualification(
        db_session,
        actor,
        holder_id,
        s.ArmoryQualificationUpsert(
            course_round=2,
            licence_number="LIC-TEST-1",
            licence_expires_on=NOW.date() + dt.timedelta(days=90),
        ),
        '"0"',
    )
    issue = custody.create_issue(
        db_session,
        actor,
        s.ArmoryShiftIssueCreate(
            safe_id=safe_id,
            employee_id=holder_id,
            kit_id=catalogue.kit("rifle"),
            off_duty_reason="cover",
            lines=[
                s.ArmoryAssignmentLineInput(item_id=firearm, serial_id=serial_id, qty=1),
                s.ArmoryAssignmentLineInput(item_id=rounds, qty=7),
            ],
        ),
    )
    issued = svc.item_detail(db_session, rounds, safe_id=safe_id).totals
    assert (issued.in_safe, issued.out_on_shift, issued.book_total) == (17, 7, 24)
    serial = svc.serial_detail(db_session, serial_id)
    assert serial.state == "signed_out" and serial.assignment_id == issue.id
    outstanding = next(line for line in issue.lines if line.item.id == rounds)
    saved_return = custody.create_return(
        db_session,
        actor,
        s.ArmoryReturnCreate(
            assignment_id=issue.id,
            witness_employee_id=witness_id,
            lines=[
                s.ArmoryReturnLineInput(
                    assignment_line_id=outstanding.id,
                    expected_remaining_qty=7,
                    returned_qty=2,
                    shortfall=s.ArmoryShortfallInput(
                        reason="other", reference="REF-TEST-2", note="Test difference"
                    ),
                )
            ],
        ),
    )
    pending = svc.item_detail(db_session, rounds, safe_id=safe_id).totals
    assert (pending.book_total, pending.out_on_shift, pending.awaiting_rounds_decision) == (
        19,
        0,
        5,
    )
    (finding_id,) = saved_return.posting.discrepancy_ids
    audit.decide(
        db_session,
        decider,
        finding_id,
        s.ArmoryDecisionCreate(
            outcome=outcome, note="Test evidence reviewed", witness_employee_id=witness_id
        ),
    )
    final = svc.item_detail(db_session, rounds, safe_id=safe_id).totals
    assert (
        final.awaiting_rounds_decision,
        final.expended_rounds,
        final.lost_rounds,
        final.settled_rounds,
    ) == expected
    assert final.received_qty == 4
    assert final.book_total == (24 if outcome == "found" else 19)


def test_catalogue_never_grants_controlled_items_optional_kit_membership(
    db_session: Session, catalogue: Catalogue
) -> None:
    actor = account(db_session)
    base = s.ArmoryItemCreate(
        name_en="Test Controlled Catalogue Entry",
        name_ar="صنف مراقب تجريبي",
        kind="firearm",
        category="firearms",
        drawing="pistol",
    )
    for kind, category in (("firearm", "firearms"), ("ammunition", "ammo")):
        bad_kit = base.model_copy(
            update={
                "kind": kind,
                "category": category,
                "optional_kit_ids": [catalogue.kit("equipment")],
            }
        )
        with pytest.raises(AppError) as caught:
            svc.create_item(db_session, actor, bad_kit)
        _error(caught, 422, "armory_invalid_input", field="optional_kit_ids")
    for kind, category in (
        ("firearm", "accessories"),
        ("ammunition", "accessories"),
        ("serial", "firearms"),
        ("quantity", "ammo"),
    ):
        with pytest.raises(AppError) as caught:
            svc.create_item(
                db_session, actor, base.model_copy(update={"kind": kind, "category": category})
            )
        _error(caught, 422, "armory_invalid_input", field="category")
    item = svc.create_item(db_session, actor, base)
    assert item.kind == "firearm" and item.optional_kit_ids == []
    assert all(
        kit.firearm_item is None or kit.firearm_item.id != item.id
        for kit in svc.list_kits(db_session)
    )


def test_firearm_registration_requires_independent_evidence_for_opening_stock(
    db_session: Session, catalogue: Catalogue
) -> None:
    actor = account(db_session, employee_id=employee(db_session, "G9101").id)
    witness_id = employee(db_session, "G9102").id
    safe_id = safe(db_session, actor).id
    item_id = catalogue.item("rifle")
    svc.create_receipt(
        db_session,
        actor,
        _receipt(
            safe_id,
            _line(item_id, s.ArmorySerialIntake(type="serial", serial_codes=[], unrecorded_qty=2)),
            kind="opening",
            witness_employee_id=witness_id,
        ),
    )
    registration = s.ArmorySerialRegistrationCreate(
        safe_id=safe_id,
        serial_codes=["TEST-FIREARM-1"],
        reference="REF-TEST-2",
        witness_employee_id=witness_id,
    )
    with pytest.raises(AppError) as caught:
        svc.record_serials(
            db_session, actor, item_id, registration.model_copy(update={"reference": None})
        )
    _error(caught, 422, "armory_invalid_input", field="reference")
    with pytest.raises(AppError) as caught:
        svc.record_serials(
            db_session,
            actor,
            item_id,
            registration.model_copy(update={"witness_employee_id": None}),
        )
    _error(caught, 422, "armory_invalid_witness", witness_employee_id=None)
    before = svc.item_detail(db_session, item_id, safe_id=safe_id).totals
    assert before.unrecorded_qty == before.book_total == 2
    posting = svc.record_serials(db_session, actor, item_id, registration)
    assert posting.reference == "REF-TEST-2"
    assert posting.witness is not None and posting.witness.employee_id == witness_id
    after = svc.item_detail(db_session, item_id, safe_id=safe_id).totals
    assert after.unrecorded_qty == after.available_qty == 1
    assert after.book_total == before.book_total
