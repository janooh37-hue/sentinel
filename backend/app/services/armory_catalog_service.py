"""Armory catalogue, intake and stock projections."""

from __future__ import annotations

import calendar
import datetime as dt
from collections import Counter, defaultdict
from collections.abc import Collection, Sequence
from dataclasses import dataclass, field

from sqlalchemy import Integer, and_, case, func, or_, select, type_coerce
from sqlalchemy.orm import Session

from app.db.models import (
    ARMORY_CATEGORIES,
    ARMORY_MAX_QTY,
    ArmoryAssignmentLine,
    ArmoryBatch,
    ArmoryDecision,
    ArmoryDiscrepancy,
    ArmoryItem,
    ArmoryKit,
    ArmoryKitItem,
    ArmoryPosting,
    ArmoryPostingLine,
    ArmorySafe,
    ArmorySerial,
    ArmoryShiftPolicy,
    ArmoryStock,
    Employee,
    User,
    VehicleSite,
)
from app.db.repos import armory_repo
from app.schemas import armory as s
from app.services import armory_service as core


def _duplicate_name(
    db: Session, model: type[ArmorySafe] | type[ArmoryItem], name_en: str, name_ar: str
) -> tuple[str, int] | None:
    # SQLite's lower() does not implement Unicode case folding.
    key = core.name_key(name_en)
    ar_match: int | None = None
    for row_id, en, ar in db.execute(select(model.id, model.name_en, model.name_ar)):
        if core.name_key(en) == key:
            return "name_en", row_id
        if ar.strip() == name_ar:
            ar_match = row_id
    return None if ar_match is None else ("name_ar", ar_match)


def _safe_ids(db: Session, safe_id: int | None) -> list[int]:
    if safe_id is not None:
        core.get_or_404(db, ArmorySafe, safe_id, "safe")
        return [safe_id]
    names = db.execute(select(ArmorySafe.id, ArmorySafe.name_en))
    return [row.id for row in sorted(names, key=lambda row: (row.name_en.casefold(), row.id))]


def list_safes(db: Session) -> list[s.ArmorySafeRead]:
    ids = _safe_ids(db, None)
    lookup = core.Lookup(db).prime(safe_ids=ids)
    return [lookup.safe(safe_id) for safe_id in ids]


def _duty_paths(db: Session) -> set[tuple[str, str]]:
    rows = db.execute(
        select(Employee.duty_unit, Employee.duty_post)
        .where(Employee.duty_unit.is_not(None), Employee.duty_post.is_not(None))
        .distinct()
    )
    return {
        (unit, post)
        for raw_unit, raw_post in rows
        if (unit := (raw_unit or "").strip()) and (post := (raw_post or "").strip())
    }


def site_options(db: Session) -> s.ArmorySiteOptionsRead:
    sites = sorted(
        db.scalars(select(VehicleSite).where(VehicleSite.active.is_(True))),
        key=lambda site: (site.name_en.casefold(), site.id),
    )
    return s.ArmorySiteOptionsRead(
        vehicle_sites=[s.ArmorySiteRead.model_validate(site) for site in sites],
        duty_posts=[
            s.ArmoryDutyPostRead(duty_unit=unit, duty_post=post)
            for unit, post in sorted(
                _duty_paths(db), key=lambda pair: (pair[0].casefold(), pair[1].casefold(), pair)
            )
        ],
    )


def create_safe(db: Session, user: User, payload: s.ArmorySafeCreate) -> s.ArmorySafeRead:
    with core.write(db):
        now = core.current_time()
        name_en = core.clean_text(payload.name_en, "name_en", max_length=120)
        name_ar = core.clean_text(payload.name_ar, "name_ar", max_length=120)
        duplicate = _duplicate_name(db, ArmorySafe, name_en, name_ar)
        if duplicate is not None:
            raise core.conflict(
                "armory_duplicate_safe", "A safe with this name exists.", field=duplicate[0]
            )
        site_id = payload.vehicle_site_id
        if site_id is not None:
            if (
                db.scalar(
                    select(VehicleSite.id).where(
                        VehicleSite.id == site_id, VehicleSite.active.is_(True)
                    )
                )
                is None
            ):
                raise core.invalid("vehicle_site_id", "Choose an active Fleet site.")
            if db.scalar(select(ArmorySafe.id).where(ArmorySafe.vehicle_site_id == site_id)):
                raise core.conflict(
                    "armory_duplicate_safe",
                    "This Fleet site already has a safe.",
                    field="vehicle_site_id",
                )
        unit = core.optional_text(payload.duty_unit, "duty_unit", max_length=120)
        post = core.optional_text(payload.duty_post, "duty_post", max_length=120)
        if (unit is None) != (post is None):
            raise core.invalid(
                "duty_unit" if unit is None else "duty_post", "Choose both a duty unit and post."
            )
        if unit is not None and post is not None:
            if (unit, post) not in _duty_paths(db):
                raise core.invalid("duty_post", "Choose an existing duty unit and post.")
            if db.scalar(
                select(ArmorySafe.id).where(
                    ArmorySafe.duty_unit == unit, ArmorySafe.duty_post == post
                )
            ):
                raise core.conflict(
                    "armory_duplicate_safe", "This duty path already has a safe.", field="duty_post"
                )
        actor = core.actor_for(db, user, require_employee=False)
        safe = ArmorySafe(
            name_en=name_en,
            name_ar=name_ar,
            vehicle_site_id=site_id,
            duty_unit=unit,
            duty_post=post,
            created_at=core.naive_utc(now),
            created_by_id=user.id,
        )
        db.add(safe)
        db.flush()
        safe_id = safe.id
        core.audit(
            db,
            action="safe.created",
            posting=None,
            actor=actor,
            entity_type="armory_safe",
            entity_id=safe_id,
            vehicle_site_id=site_id,
            has_duty_path=unit is not None,
        )
    return core.Lookup(db).prime(safe_ids=[safe_id]).safe(safe_id)


def _settings_on(db: Session, today: dt.date) -> s.ArmorySettingsRead:
    pending = core.pending_policy(db, today)
    return s.ArmorySettingsRead(
        version=core.settings_version(db),
        current=core.policy_read(core.policy_on(db, today)),
        pending=None if pending is None else core.policy_read(pending),
    )


def get_settings(db: Session) -> s.ArmorySettingsRead:
    return _settings_on(db, core.local_today(core.current_time()))


def update_settings(
    db: Session, user: User, payload: s.ArmorySettingsUpdate, if_match: str | None
) -> s.ArmorySettingsRead:
    with core.write(db):
        now = core.current_time()
        today = core.local_today(now)
        previous_version = core.settings_version(db)
        core.require_version(if_match, previous_version)
        day = dt.time.fromisoformat(payload.day_start)
        night = dt.time.fromisoformat(payload.night_start)
        if day >= night:
            raise core.invalid("night_start", "Night start must be after day start.")
        actor = core.actor_for(db, user, require_employee=False)
        policy = ArmoryShiftPolicy(
            effective_on=today + dt.timedelta(days=1),
            day_start=day,
            night_start=night,
            grace_minutes=payload.grace_minutes,
            created_at=core.naive_utc(now),
            created_by_id=user.id,
        )
        db.add(policy)
        db.flush()
        core.audit(
            db,
            action="settings.updated",
            posting=None,
            actor=actor,
            entity_type="armory_shift_policy",
            entity_id=policy.id,
            previous_version=previous_version,
            effective_on=policy.effective_on.isoformat(),
        )
    return _settings_on(db, today)


# ── Intake ───────────────────────────────────────────────────────────────────

_CONTROLLED_KINDS = frozenset({"firearm", "ammunition"})
_SERIAL_KINDS = frozenset({"firearm", "serial"})
_ENTRY_TYPES = {
    "firearm": "serial",
    "serial": "serial",
    "ammunition": "quantity",
    "quantity": "quantity",
    "expiry": "expiry",
}


@dataclass(frozen=True, slots=True)
class _Intake:
    item_id: int
    path: str
    unbatched_qty: int = 0
    serial_codes: tuple[str, ...] = ()
    batches: tuple[tuple[str, dt.date, int], ...] = ()

    @property
    def qty(self) -> int:
        return self.unbatched_qty + len(self.serial_codes) + sum(qty for _, _, qty in self.batches)


def _serial_codes(codes: Sequence[str], path: str, seen: set[str]) -> tuple[str, ...]:
    result = []
    for index, raw in enumerate(codes):
        field_path = f"{path}.{index}"
        code = core.normalize_code(raw, field_path)
        if code in seen:
            raise core.invalid(field_path, "A serial cannot occur twice in one request.")
        seen.add(code)
        result.append(code)
    return tuple(result)


def _expiry_date(value: str, path: str) -> dt.date:
    try:
        if len(value) == 7:
            month = dt.date.fromisoformat(f"{value}-01")
            return month.replace(day=calendar.monthrange(month.year, month.month)[1])
        return dt.date.fromisoformat(value)
    except ValueError:
        raise core.invalid(path, "Choose a valid expiry date.") from None


def _intake(
    item: ArmoryItem,
    entry: s.ArmoryIntakeEntry,
    path: str,
    *,
    opening: bool,
    seen_serials: set[str],
) -> _Intake:
    if entry.type != _ENTRY_TYPES[item.kind]:
        raise core.invalid(path, "The count must use this item's tracking type.")
    if isinstance(entry, s.ArmoryQuantityIntake):
        if entry.qty == 0 and not opening:
            raise core.invalid(f"{path}.qty", "A delivery quantity must be positive.")
        return _Intake(item.id, path, unbatched_qty=entry.qty)
    if isinstance(entry, s.ArmorySerialIntake):
        if entry.unrecorded_qty is not None and not opening:
            raise core.invalid(f"{path}.unrecorded_qty", "Only opening stock may be unnumbered.")
        if not entry.serial_codes and entry.unrecorded_qty is None:
            raise core.invalid(
                f"{path}.serial_codes", "Enter serials or explicitly count unnumbered stock."
            )
        return _Intake(
            item.id,
            path,
            unbatched_qty=entry.unrecorded_qty or 0,
            serial_codes=_serial_codes(entry.serial_codes, f"{path}.serial_codes", seen_serials),
        )
    if entry.counted_zero and (not opening or entry.batches):
        raise core.invalid(
            f"{path}.counted_zero", "Count zero only for an opening without batches."
        )
    if not entry.batches and not entry.counted_zero:
        raise core.invalid(f"{path}.batches", "Enter the batches or explicitly count zero.")
    batches = []
    seen_refs: set[str] = set()
    for index, batch in enumerate(entry.batches):
        batch_path = f"{path}.batches.{index}"
        ref = core.normalize_code(batch.batch_ref, f"{batch_path}.batch_ref")
        if ref in seen_refs:
            raise core.invalid(
                f"{batch_path}.batch_ref", "A batch cannot occur twice in one intake line."
            )
        seen_refs.add(ref)
        if batch.qty == 0:
            raise core.invalid(f"{batch_path}.qty", "A batch quantity must be positive.")
        batches.append((ref, _expiry_date(batch.expires_on, f"{batch_path}.expires_on"), batch.qty))
    return _Intake(item.id, path, batches=tuple(batches))


def _resolve_batches(
    db: Session, lines: Sequence[_Intake], now: dt.datetime
) -> dict[tuple[int, str], int]:
    requested = [(line.item_id, ref, expiry) for line in lines for ref, expiry, _ in line.batches]
    if not requested:
        return {}
    batches = {
        (batch.item_id, batch.batch_ref): batch
        for batch in db.scalars(
            select(ArmoryBatch).where(
                ArmoryBatch.item_id.in_({item_id for item_id, _, _ in requested}),
                ArmoryBatch.batch_ref.in_({ref for _, ref, _ in requested}),
            )
        )
    }
    keys = set()
    for item_id, ref, expiry in requested:
        key = (item_id, ref)
        keys.add(key)
        batch = batches.get(key)
        if batch is not None:
            if batch.expires_on != expiry:
                raise core.conflict(
                    "armory_batch_expiry_conflict",
                    "This batch reference already has a different expiry date.",
                    item_id=item_id,
                    batch_ref=ref,
                )
        else:
            batch = ArmoryBatch(
                item_id=item_id, batch_ref=ref, expires_on=expiry, created_at=core.naive_utc(now)
            )
            db.add(batch)
            batches[key] = batch
    db.flush()
    return {key: batches[key].id for key in keys}


def _apply_intake(
    writer: core.PostingWriter,
    line: _Intake,
    batch_ids: dict[tuple[int, str], int],
    now: dt.datetime,
    *,
    opening: bool,
) -> None:
    item_id = line.item_id
    if opening:
        qty = line.qty
        if qty > ARMORY_MAX_QTY:
            raise core.invalid(line.path, "The opening quantity is too large.")
        safe_id = writer.posting.safe_id
        bucket = armory_repo.stock_row(writer.db, safe_id=safe_id, item_id=item_id, batch_id=None)
        if not armory_repo.set_opening(writer.db, bucket.id, qty, expected=None):
            raise core.invalid(
                line.path, "Opening stock has already been counted for this item and safe."
            )
        writer.revised.add(safe_id)
        if qty == 0:
            writer.evidence(item_id=item_id, qty=0)
            return
    if line.unbatched_qty:
        writer.stock(item_id=item_id, qty=line.unbatched_qty, delta=line.unbatched_qty)
    for code in line.serial_codes:
        writer.create_serial(item_id=item_id, code=code, at=now)
    for ref, _, qty in line.batches:
        writer.stock(item_id=item_id, qty=qty, delta=qty, batch_id=batch_ids[item_id, ref])


def _intake_date(received_on: dt.date, today: dt.date, field_path: str) -> dt.date:
    if received_on > today:
        raise core.invalid(field_path, "A stock intake cannot be dated in the future.")
    return received_on


def _reference(value: str | None, field_path: str, *, required: bool) -> str | None:
    if required:
        return core.clean_text(value, field_path, max_length=80)
    return core.optional_text(value, field_path, max_length=80)


def _write_intake(
    db: Session,
    posting: ArmoryPosting,
    lines: Sequence[_Intake],
    batch_ids: dict[tuple[int, str], int],
    now: dt.datetime,
) -> None:
    writer = core.PostingWriter(db, posting)
    opening = posting.kind == "opening"
    for line in lines:
        _apply_intake(writer, line, batch_ids, now, opening=opening)
    writer.finish()


def create_item(db: Session, user: User, payload: s.ArmoryItemCreate) -> s.ArmoryItemDetailRead:
    with core.write(db):
        now = core.current_time()
        today = core.local_today(now)
        name_en = core.clean_text(payload.name_en, "name_en", max_length=120)
        name_ar = core.clean_text(payload.name_ar, "name_ar", max_length=120)
        duplicate = _duplicate_name(db, ArmoryItem, name_en, name_ar)
        if duplicate is not None:
            field_path, existing_item_id = duplicate
            raise core.conflict(
                "armory_duplicate_item",
                "A catalogue item with this name exists.",
                field=field_path,
                item_id=existing_item_id,
            )
        if (payload.kind == "firearm") != (payload.category == "firearms") or (
            payload.kind == "ammunition"
        ) != (payload.category == "ammo"):
            raise core.invalid("category", "This category does not match the tracking type.")
        controlled = payload.kind in _CONTROLLED_KINDS
        if payload.optional_kit_ids:
            if controlled:
                raise core.invalid(
                    "optional_kit_ids", "Firearms and ammunition are not optional kit items."
                )
            kit_ids = set(
                db.scalars(select(ArmoryKit.id).where(ArmoryKit.id.in_(payload.optional_kit_ids)))
            )
            for index, kit_id in enumerate(payload.optional_kit_ids):
                if kit_id not in kit_ids:
                    raise core.invalid(f"optional_kit_ids.{index}", "This kit does not exist.")
        actor = core.actor_for(db, user, require_employee=controlled and bool(payload.openings))
        item = ArmoryItem(
            name_en=name_en,
            name_ar=name_ar,
            kind=payload.kind,
            category=payload.category,
            drawing=payload.drawing,
            created_at=core.naive_utc(now),
            created_by_id=user.id,
        )
        db.add(item)
        db.flush()
        item_id = item.id
        db.add_all(
            ArmoryKitItem(kit_id=kit_id, item_id=item_id, role="optional", default_qty=0)
            for kit_id in payload.optional_kit_ids
        )
        openings: list[tuple[s.ArmoryOpeningInput, _Intake, str | None, str | None]] = []
        seen_serials: set[str] = set()
        if payload.openings:
            opening_safe_ids = {opening.safe_id for opening in payload.openings}
            known_safe_ids = set(
                db.scalars(select(ArmorySafe.id).where(ArmorySafe.id.in_(opening_safe_ids)))
            )
            for index, opening in enumerate(payload.openings):
                path = f"openings.{index}"
                if opening.safe_id not in known_safe_ids:
                    raise core.invalid(f"{path}.safe_id", "This safe does not exist.")
                _intake_date(opening.received_on, today, f"{path}.received_on")
                intake = _intake(
                    item, opening.entry, f"{path}.entry", opening=True, seen_serials=seen_serials
                )
                reference = _reference(opening.reference, f"{path}.reference", required=controlled)
                witness = core.witness(
                    db, opening.witness_employee_id, actor=actor, required=controlled
                )
                openings.append(
                    (opening, intake, reference, witness.id if witness is not None else None)
                )
        batch_ids = _resolve_batches(db, [line for _, line, _, _ in openings], now)
        evidence = []
        for opening, intake, reference, witness_id in openings:
            posting = core.new_posting(
                db,
                kind="opening",
                safe_id=opening.safe_id,
                actor=actor,
                occurred_on=opening.received_on,
                occurred_at=None,
                now=now,
                witness_employee_id=witness_id,
                reference=reference,
            )
            evidence.append(
                {
                    "posting_id": posting.id,
                    "safe_id": opening.safe_id,
                    "witness_employee_id": witness_id,
                    "reference": reference,
                }
            )
            _write_intake(db, posting, [intake], batch_ids, now)
        core.audit(
            db,
            action="item.created",
            posting=None,
            actor=actor,
            entity_type="armory_item",
            entity_id=item_id,
            kind=payload.kind,
            optional_kit_ids=payload.optional_kit_ids,
            openings=evidence,
        )
    return _item_detail(db, item_id, safe_id=None, now=now)


def list_kits(db: Session) -> list[s.ArmoryKitRead]:
    kits = list(db.scalars(select(ArmoryKit).order_by(ArmoryKit.id)))
    if not kits:
        return []
    lines = list(
        db.scalars(
            select(ArmoryKitItem)
            .where(ArmoryKitItem.kit_id.in_([kit.id for kit in kits]))
            .order_by(ArmoryKitItem.kit_id, ArmoryKitItem.item_id)
        )
    )
    lookup = core.Lookup(db).prime(
        item_ids=[*(kit.firearm_item_id for kit in kits), *(line.item_id for line in lines)]
    )
    by_kit: dict[int, list[s.ArmoryKitLineRead]] = defaultdict(list)
    for line in lines:
        by_kit[line.kit_id].append(
            s.ArmoryKitLineRead(
                item=lookup.item(line.item_id),
                role=line.role,
                default_qty=line.default_qty,
                substitutes_item_id=line.substitutes_item_id,
            )
        )
    return [
        s.ArmoryKitRead(
            id=kit.id,
            code=kit.code,
            name_en=kit.name_en,
            name_ar=kit.name_ar,
            firearm_item=None if kit.firearm_item_id is None else lookup.item(kit.firearm_item_id),
            lines=by_kit.get(kit.id, []),
        )
        for kit in kits
    ]


def create_receipt(db: Session, user: User, payload: s.ArmoryReceiptCreate) -> s.ArmoryPostingRead:
    with core.write(db):
        now = core.current_time()
        opening = payload.kind == "opening"
        core.get_or_404(db, ArmorySafe, payload.safe_id, "safe")
        on = _intake_date(payload.received_on, core.local_today(now), "received_on")
        if not opening and payload.source is None:
            raise core.invalid("source", "A delivery source is required.")
        item_ids = {line.item_id for line in payload.lines}
        items = {
            item.id: item
            for item in db.scalars(select(ArmoryItem).where(ArmoryItem.id.in_(item_ids)))
        }
        seen_items: set[int] = set()
        seen_serials: set[str] = set()
        intakes = []
        controlled = False
        for index, line in enumerate(payload.lines):
            item = items.get(line.item_id)
            if item is None:
                raise core.invalid(f"lines.{index}.item_id", "This catalogue item does not exist.")
            if line.item_id in seen_items:
                raise core.invalid(
                    f"lines.{index}.item_id", "An item cannot occur twice in one intake."
                )
            seen_items.add(line.item_id)
            controlled |= item.kind in _CONTROLLED_KINDS
            intakes.append(
                _intake(
                    item,
                    line.entry,
                    f"lines.{index}.entry",
                    opening=opening,
                    seen_serials=seen_serials,
                )
            )
        reference = _reference(payload.reference, "reference", required=controlled or not opening)
        actor = core.actor_for(db, user, require_employee=controlled)
        witness = core.witness(db, payload.witness_employee_id, actor=actor, required=controlled)
        batch_ids = _resolve_batches(db, intakes, now)
        posting = core.new_posting(
            db,
            kind=payload.kind,
            safe_id=payload.safe_id,
            actor=actor,
            occurred_on=on,
            occurred_at=None,
            now=now,
            witness_employee_id=witness.id if witness is not None else None,
            reference=reference,
            source=payload.source,
        )
        posting_id = posting.id
        _write_intake(db, posting, intakes, batch_ids, now)
        core.audit(
            db,
            action=f"{payload.kind}.created",
            actor=actor,
            posting=posting,
            item_ids=[line.item_id for line in intakes],
            reference=reference,
        )
    return core.posting_read(db, posting_id)


def record_serials(
    db: Session, user: User, item_id: int, payload: s.ArmorySerialRegistrationCreate
) -> s.ArmoryPostingRead:
    with core.write(db):
        now = core.current_time()
        item = core.get_or_404(db, ArmoryItem, item_id, "item")
        if item.kind not in _SERIAL_KINDS:
            raise core.invalid("item_id", "This item does not use serials.")
        core.get_or_404(db, ArmorySafe, payload.safe_id, "safe")
        codes = _serial_codes(payload.serial_codes, "serial_codes", set())
        controlled = item.kind == "firearm"
        reference = _reference(payload.reference, "reference", required=controlled)
        actor = core.actor_for(db, user, require_employee=controlled)
        witness = core.witness(db, payload.witness_employee_id, actor=actor, required=controlled)
        posting = core.new_posting(
            db,
            kind="serial_registration",
            safe_id=payload.safe_id,
            actor=actor,
            occurred_on=core.local_today(now),
            occurred_at=now,
            now=now,
            witness_employee_id=witness.id if witness is not None else None,
            reference=reference,
        )
        posting_id = posting.id
        writer = core.PostingWriter(db, posting)
        writer.stock(item_id=item_id, qty=len(codes), delta=-len(codes))
        for code in codes:
            writer.create_serial(item_id=item_id, code=code, at=now)
        writer.finish()
        core.audit(
            db,
            action="serial_registration.created",
            posting=posting,
            actor=actor,
            item_id=item_id,
            qty=len(codes),
            reference=reference,
        )
    return core.posting_read(db, posting_id)


# ── Serial movements ────────────────────────────────────────────────────────

_SERIAL_TRANSITIONS = {
    "send_repair": (("in_safe",), "in_repair"),
    "return_repair": (("in_repair",), "in_safe"),
    "mark_lost": (("in_safe", "in_repair"), "lost"),
    "write_off": (("in_safe", "in_repair", "lost"), "written_off"),
    "transfer": (("in_safe",), "in_safe"),
}


def serial_detail(db: Session, serial_id: int) -> s.ArmorySerialDetailRead:
    now = core.current_time()
    serial = core.get_or_404(db, ArmorySerial, serial_id, "serial")
    read = core.serial_reads(db, [serial], now)[0]
    return s.ArmorySerialDetailRead(
        **read.model_dump(),
        recent_movements=_recent_movements(db, serial_id=serial_id),
    )


def move_serial(
    db: Session, user: User, serial_id: int, payload: s.ArmorySerialMovementCreate
) -> s.ArmoryPostingRead:
    with core.write(db):
        now = core.current_time()
        serial = core.get_or_404(db, ArmorySerial, serial_id, "serial")
        if (serial.state, serial.safe_id, serial.last_posting_id) != (
            payload.expected_state,
            payload.expected_safe_id,
            payload.expected_posting_id,
        ):
            raise core.serial_unavailable(serial_id)
        allowed, next_state = _SERIAL_TRANSITIONS[payload.action]
        if payload.expected_state not in allowed:
            raise core.invalid(
                "action", "This action is not allowed from the current serial state."
            )
        from_safe = payload.expected_safe_id
        to_safe = from_safe
        if payload.destination_safe_id is not None:
            to_safe = payload.destination_safe_id
            if from_safe == to_safe:
                raise core.invalid("destination_safe_id", "Choose a different safe for a transfer.")
            core.get_or_404(db, ArmorySafe, to_safe, "safe")
        reason = core.clean_text(payload.reason, "reason", min_length=core.NOTE_MIN)
        actor = core.actor_for(db, user, require_employee=True)
        witness = core.witness(db, payload.witness_employee_id, actor=actor)
        assert witness is not None
        posting = core.new_posting(
            db,
            kind="serial_state",
            safe_id=from_safe,
            actor=actor,
            occurred_on=core.local_today(now),
            occurred_at=now,
            now=now,
            witness_employee_id=witness.id,
            reason=reason,
            serial_action=payload.action,
        )
        posting_id = posting.id
        writer = core.PostingWriter(db, posting)
        writer.serial(
            serial,
            state=next_state,
            safe_id=to_safe,
            at=now,
            expected_state=payload.expected_state,
            expected_safe_id=from_safe,
            expected_last_posting_id=payload.expected_posting_id,
        )
        writer.finish()
        core.audit(
            db,
            action="serial_state.created",
            posting=posting,
            actor=actor,
            serial_id=serial_id,
            serial_action=payload.action,
            before_state=payload.expected_state,
            after_state=next_state,
            after_safe_id=to_safe,
        )
    return core.posting_read(db, posting_id)


# ── Stock and catalogue projections ──────────────────────────────────────────

_RECENT_MOVEMENTS = 20


@dataclass(slots=True)
class _StockFacts:
    opening_qty: int | None = None
    on_hand: int = 0
    received_qty: int = 0
    expired_qty: int = 0
    batch_alert: bool = False
    serials: Counter[str] = field(default_factory=Counter)
    outstanding: Counter[str] = field(default_factory=Counter)
    shortfalls: Counter[str | None] = field(default_factory=Counter)

    def include(self, other: _StockFacts) -> None:
        if self.opening_qty is not None:
            self.opening_qty = (
                None if other.opening_qty is None else self.opening_qty + other.opening_qty
            )
        self.on_hand += other.on_hand
        self.received_qty += other.received_qty
        self.expired_qty += other.expired_qty
        self.batch_alert |= other.batch_alert
        self.serials.update(other.serials)
        self.outstanding.update(other.outstanding)
        self.shortfalls.update(other.shortfalls)

    def read(self, kind: str) -> s.ArmoryStockTotals:
        serialized = kind in _SERIAL_KINDS
        ammunition = kind == "ammunition"
        in_safe = self.on_hand + self.serials["in_safe"]
        out = self.serials["signed_out"] if serialized else self.outstanding["shift_issue"]
        custody = self.serials["in_custody"] if serialized else self.outstanding["custody"]
        book_total = (
            in_safe
            + out
            + custody
            + self.serials["in_repair"]
            + self.serials["missing"]
            + self.serials["lost"]
        )
        known = self.opening_qty is not None
        return s.ArmoryStockTotals(
            opening_qty=self.opening_qty,
            received_qty=self.received_qty,
            known_in_safe=in_safe,
            in_safe=in_safe if known else None,
            available_qty=self.serials["in_safe"]
            if serialized
            else self.on_hand - self.expired_qty,
            unrecorded_qty=self.on_hand if serialized else None,
            out_on_shift=out,
            in_custody=custody,
            in_repair=self.serials["in_repair"] if serialized else None,
            missing=self.serials["missing"] if serialized else None,
            lost=self.serials["lost"] if serialized else None,
            written_off=self.serials["written_off"] if serialized else None,
            awaiting_rounds_decision=self.shortfalls[None] if ammunition else None,
            expended_rounds=self.shortfalls["used_in_training"] if ammunition else None,
            lost_rounds=self.shortfalls["lost"] if ammunition else None,
            settled_rounds=self.shortfalls["recording_error"] if ammunition else None,
            expired_qty=self.expired_qty if kind == "expiry" else None,
            book_total=book_total if known else None,
        )


def stock_totals(
    db: Session,
    *,
    item_ids: Collection[int],
    safe_ids: Collection[int],
    today: dt.date | None = None,
) -> dict[tuple[int, int], _StockFacts]:
    """Read per-(item, safe) totals in set-based queries; absent buckets are unknown."""
    if not item_ids or not safe_ids:
        return {}
    if today is None:
        today = core.local_today(core.current_time())
    expiry_limit = today + dt.timedelta(days=core.BATCH_EXPIRING_DAYS)
    facts: defaultdict[tuple[int, int], _StockFacts] = defaultdict(_StockFacts)
    for item_id, safe_id, opening, hand, expired, batch_alert in db.execute(
        select(
            ArmoryStock.item_id,
            ArmoryStock.safe_id,
            func.max(ArmoryStock.opening_qty),
            func.sum(ArmoryStock.on_hand),
            type_coerce(
                func.sum(case((ArmoryBatch.expires_on < today, ArmoryStock.on_hand), else_=0)),
                Integer,
            ),
            type_coerce(
                func.max(
                    case(
                        (and_(ArmoryBatch.expires_on <= expiry_limit, ArmoryStock.on_hand > 0), 1),
                        else_=0,
                    )
                ),
                Integer,
            ),
        )
        .outerjoin(ArmoryBatch, ArmoryBatch.id == ArmoryStock.batch_id)
        .where(ArmoryStock.item_id.in_(item_ids), ArmoryStock.safe_id.in_(safe_ids))
        .group_by(ArmoryStock.item_id, ArmoryStock.safe_id)
    ):
        stock = facts[item_id, safe_id]
        stock.opening_qty = opening
        stock.on_hand = hand
        stock.expired_qty = expired
        stock.batch_alert = bool(batch_alert)
    for item_id, serial_safe_id, state, qty in db.execute(
        select(ArmorySerial.item_id, ArmorySerial.safe_id, ArmorySerial.state, func.count())
        .where(
            ArmorySerial.item_id.in_(item_ids),
            ArmorySerial.safe_id.in_(safe_ids),
            ArmorySerial.state.is_not(None),
        )
        .group_by(ArmorySerial.item_id, ArmorySerial.safe_id, ArmorySerial.state)
    ):
        assert serial_safe_id is not None and state is not None
        facts[item_id, serial_safe_id].serials[state] = qty
    for item_id, safe_id, kind, qty in db.execute(
        select(
            ArmoryAssignmentLine.item_id,
            ArmoryPosting.safe_id,
            ArmoryPosting.kind,
            func.sum(ArmoryAssignmentLine.remaining_qty),
        )
        .join(ArmoryPosting, ArmoryPosting.id == ArmoryAssignmentLine.assignment_id)
        .where(
            ArmoryAssignmentLine.item_id.in_(item_ids),
            ArmoryAssignmentLine.serial_id.is_(None),
            ArmoryAssignmentLine.remaining_qty > 0,
            ArmoryPosting.safe_id.in_(safe_ids),
            ArmoryPosting.voided_at.is_(None),
        )
        .group_by(ArmoryAssignmentLine.item_id, ArmoryPosting.safe_id, ArmoryPosting.kind)
    ):
        facts[item_id, safe_id].outstanding[kind] = qty
    for item_id, safe_id, received in db.execute(
        select(ArmoryPostingLine.item_id, ArmoryPosting.safe_id, func.sum(ArmoryPostingLine.qty))
        .join(ArmoryPosting, ArmoryPosting.id == ArmoryPostingLine.posting_id)
        .where(
            ArmoryPostingLine.item_id.in_(item_ids),
            ArmoryPosting.safe_id.in_(safe_ids),
            ArmoryPosting.voided_at.is_(None),
            ArmoryPosting.kind == "receipt",
        )
        .group_by(ArmoryPostingLine.item_id, ArmoryPosting.safe_id)
    ):
        facts[item_id, safe_id].received_qty = received
    for item_id, safe_id, outcome, qty in db.execute(
        select(
            ArmoryDiscrepancy.item_id,
            ArmoryPosting.safe_id,
            ArmoryDecision.outcome,
            func.sum(ArmoryDiscrepancy.expected_qty - ArmoryDiscrepancy.observed_qty),
        )
        .join(ArmoryPosting, ArmoryPosting.id == ArmoryDiscrepancy.source_posting_id)
        .outerjoin(
            ArmoryDecision,
            ArmoryDecision.posting_id == ArmoryDiscrepancy.active_decision_posting_id,
        )
        .where(
            ArmoryDiscrepancy.item_id.in_(item_ids),
            ArmoryDiscrepancy.kind == "rounds_shortfall",
            ArmoryPosting.safe_id.in_(safe_ids),
            ArmoryPosting.voided_at.is_(None),
        )
        .group_by(ArmoryDiscrepancy.item_id, ArmoryPosting.safe_id, ArmoryDecision.outcome)
    ):
        # A recovery is already in stock, not a shortfall allocation.
        if outcome != "found":
            facts[item_id, safe_id].shortfalls[outcome] = qty
    return facts


def _needs_attention(totals: s.ArmoryStockTotals, *, batch_alert: bool) -> bool:
    return bool(
        totals.opening_qty is None
        or totals.available_qty == 0
        or totals.in_repair
        or totals.missing
        or totals.lost
        or batch_alert
    )


def _item_reads(
    db: Session,
    items: Sequence[ArmoryItem],
    safe_ids: Sequence[int],
    today: dt.date,
    *,
    attention_only: bool = False,
) -> list[s.ArmoryItemRead]:
    if not items:
        return []
    item_ids = [item.id for item in items]
    lookup = core.Lookup(db).prime(safe_ids=safe_ids)
    safe_reads = [lookup.safe(safe_id) for safe_id in safe_ids]
    stock = stock_totals(db, item_ids=item_ids, safe_ids=safe_ids, today=today)
    optional: dict[int, list[int]] = defaultdict(list)
    for item_id, kit_id in db.execute(
        select(ArmoryKitItem.item_id, ArmoryKitItem.kit_id)
        .where(ArmoryKitItem.item_id.in_(item_ids), ArmoryKitItem.role == "optional")
        .order_by(ArmoryKitItem.kit_id)
    ):
        optional[item_id].append(kit_id)
    empty = _StockFacts()
    result = []
    for item in items:
        buckets = [(safe, stock.get((item.id, safe.id), empty)) for safe in safe_reads]
        aggregate = _StockFacts(opening_qty=0 if buckets else None)
        for _, bucket in buckets:
            aggregate.include(bucket)
        totals = aggregate.read(item.kind)
        if attention_only and not _needs_attention(totals, batch_alert=aggregate.batch_alert):
            continue
        result.append(
            s.ArmoryItemRead(
                **core.item_ref(item).model_dump(),
                preset_key=item.preset_key,
                optional_kit_ids=optional.get(item.id, []),
                stock=[
                    s.ArmoryStockRead(safe=safe, **bucket.read(item.kind).model_dump())
                    for safe, bucket in buckets
                ],
                totals=totals,
            )
        )
    return result


def list_items(
    db: Session,
    *,
    safe_id: int | None,
    category: str | None,
    q: str | None,
    stock_view: str,
) -> list[s.ArmoryItemRead]:
    today = core.local_today(core.current_time())
    if stock_view not in ("all", "needs_attention"):
        raise core.invalid("stock_view")
    if category is not None and category not in ARMORY_CATEGORIES:
        raise core.invalid("category")
    safe_ids = _safe_ids(db, safe_id)
    stmt = select(ArmoryItem)
    if category is not None:
        stmt = stmt.where(ArmoryItem.category == category)
    items = list(db.scalars(stmt))
    needle = core.normalize_search(q)
    if needle and items:
        matching_serials = select(ArmorySerial.item_id).where(
            ArmorySerial.state.is_not(None),
            ArmorySerial.item_id.in_([item.id for item in items]),
            ArmorySerial.serial_code.contains(needle.upper(), autoescape=True),
        )
        if safe_id is not None:
            matching_serials = matching_serials.where(ArmorySerial.safe_id == safe_id)
        matched = set(db.scalars(matching_serials.distinct()))
        items = [
            item
            for item in items
            if item.id in matched
            or needle in core.normalize_search(item.name_en)
            or needle in core.normalize_search(item.name_ar)
        ]
    items.sort(key=lambda item: (item.name_en.casefold(), item.id))
    return _item_reads(db, items, safe_ids, today, attention_only=stock_view == "needs_attention")


def _recent_movements(
    db: Session,
    *,
    item_id: int | None = None,
    serial_id: int | None = None,
    safe_id: int | None = None,
) -> list[s.ArmoryPostingRef]:
    query = select(ArmoryPosting).join(
        ArmoryPostingLine, ArmoryPostingLine.posting_id == ArmoryPosting.id
    )
    if item_id is not None:
        query = query.where(ArmoryPostingLine.item_id == item_id)
    if serial_id is not None:
        query = query.where(ArmoryPostingLine.serial_id == serial_id)
    if safe_id is not None:
        query = query.where(
            or_(ArmoryPosting.safe_id == safe_id, ArmoryPostingLine.after_safe_id == safe_id)
        )
    return [
        core.posting_ref(row)
        for row in db.scalars(
            query.distinct()
            .order_by(
                ArmoryPosting.occurred_on.desc(),
                func.coalesce(ArmoryPosting.occurred_at, ArmoryPosting.created_at).desc(),
                ArmoryPosting.id.desc(),
            )
            .limit(_RECENT_MOVEMENTS)
        )
    ]


def _item_detail(
    db: Session, item_id: int, *, safe_id: int | None, now: dt.datetime
) -> s.ArmoryItemDetailRead:
    item = core.get_or_404(db, ArmoryItem, item_id, "item")
    safe_ids = _safe_ids(db, safe_id)
    today = core.local_today(now)
    read = _item_reads(db, [item], safe_ids, today)[0]
    serials = []
    if item.kind in _SERIAL_KINDS:
        serial_query = select(ArmorySerial).where(
            ArmorySerial.item_id == item_id, ArmorySerial.state.is_not(None)
        )
        if safe_id is not None:
            serial_query = serial_query.where(ArmorySerial.safe_id == safe_id)
        serial_rows = list(
            db.scalars(serial_query.order_by(ArmorySerial.serial_code, ArmorySerial.id))
        )
        if serial_rows:
            serials = core.serial_reads(db, serial_rows, now)
    batches = []
    if item.kind == "expiry" and safe_ids:
        rows = db.execute(
            select(ArmoryBatch, ArmoryStock.safe_id, ArmoryStock.on_hand)
            .join(ArmoryStock, ArmoryStock.batch_id == ArmoryBatch.id)
            .where(ArmoryStock.item_id == item_id, ArmoryStock.safe_id.in_(safe_ids))
        )
        safe_reads = {stock.safe.id: stock.safe for stock in read.stock}
        batches = [
            s.ArmoryBatchRead(
                batch=s.ArmoryBatchRef.model_validate(batch),
                safe=safe_reads[batch_safe_id],
                on_hand=on_hand,
                status=core.batch_status(batch.expires_on, today),
            )
            for batch, batch_safe_id, on_hand in rows
        ]
        batches.sort(
            key=lambda row: (
                row.safe.name_en.casefold(),
                row.safe.id,
                row.batch.expires_on,
                row.batch.batch_ref,
                row.batch.id,
            )
        )
    return s.ArmoryItemDetailRead(
        **read.model_dump(),
        serials=serials,
        batches=batches,
        recent_movements=_recent_movements(db, item_id=item_id, safe_id=safe_id),
    )


def item_detail(db: Session, item_id: int, *, safe_id: int | None) -> s.ArmoryItemDetailRead:
    return _item_detail(db, item_id, safe_id=safe_id, now=core.current_time())


def batch_alert_counts(db: Session, today: dt.date, safe_id: int | None) -> tuple[int, int]:
    query = (
        select(
            func.count().filter(ArmoryBatch.expires_on < today),
            func.count().filter(ArmoryBatch.expires_on >= today),
        )
        .select_from(ArmoryStock)
        .join(ArmoryBatch, ArmoryBatch.id == ArmoryStock.batch_id)
        .where(
            ArmoryStock.on_hand > 0,
            ArmoryBatch.expires_on <= today + dt.timedelta(days=core.BATCH_EXPIRING_DAYS),
        )
    )
    if safe_id is not None:
        query = query.where(ArmoryStock.safe_id == safe_id)
    expired, expiring = db.execute(query).one()
    return expired, expiring
