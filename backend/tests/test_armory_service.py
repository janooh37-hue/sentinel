"""Armory audit evidence, independent decisions and shift reads on real SQLite."""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, replace

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from app.api.errors import AppError
from app.db.models import ArmorySafe, AuditLog, User
from app.schemas import armory as s
from app.services import armory_audit_service as svc
from app.services import armory_catalog_service as catalog
from app.services import armory_custody_service as custody
from app.services import armory_read_service as reads
from app.services import armory_service as core
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


@dataclass(frozen=True, slots=True)
class AuditEnv:
    db: Session
    recorder: User
    witness_id: str
    reviewer: User
    reviewer_witness_id: str
    source: ArmorySafe


def _env(db: Session, monkeypatch: pytest.MonkeyPatch) -> AuditEnv:
    pin_clock(monkeypatch)
    recorder = account(db, employee_id=employee(db, "G9101").id)
    return AuditEnv(
        db=db,
        recorder=recorder,
        witness_id=employee(db, "G9102").id,
        reviewer=account(db, employee_id=employee(db, "G9103").id),
        reviewer_witness_id=employee(db, "G9104").id,
        source=safe(db, recorder),
    )


@pytest.fixture
def env(db_session: Session, monkeypatch: pytest.MonkeyPatch) -> AuditEnv:
    return _env(db_session, monkeypatch)


def _error(exc: pytest.ExceptionInfo[AppError], status: int, code: str, **details: object) -> None:
    assert (exc.value.http_status, exc.value.code, exc.value.details) == (status, code, details)


def test_empty_safe_check_is_witnessed_and_can_only_be_recorded_once(env: AuditEnv) -> None:
    db, recorder, safe_id = env.db, env.recorder, env.source.id
    draft = svc.shift_check_draft(db, recorder, safe_id)
    assert draft.expected == []
    assert draft.reconciliation.assigned_count == 0
    payload = s.ArmoryShiftCheckCreate(
        snapshot_token=draft.snapshot_token,
        witness_employee_id=env.witness_id,
        observed_serial_ids=[],
        confirm_missing=False,
    )
    saved = svc.create_shift_check(db, recorder, safe_id, payload)
    assert saved.window == draft.window
    assert saved.witness.employee_id == env.witness_id
    assert not saved.lines and not saved.discrepancy_ids
    assert svc.get_count(db, saved.posting.id) == saved
    with pytest.raises(AppError) as exc:
        svc.create_shift_check(db, recorder, safe_id, payload)
    _error(exc, 409, "armory_period_already_recorded", count_id=saved.posting.id)
    assert db.scalar(select(func.count()).select_from(AuditLog)) == 1


def _receive(
    env: AuditEnv, safe_id: int, *lines: tuple[int, s.ArmoryIntakeEntry], opening: bool = False
) -> s.ArmoryPostingRead:
    return catalog.create_receipt(
        env.db,
        env.recorder,
        s.ArmoryReceiptCreate(
            safe_id=safe_id,
            kind="opening" if opening else "receipt",
            received_on=NOW.date(),
            source=None if opening else "supplier",
            reference="REF-TEST-INTAKE",
            witness_employee_id=env.witness_id,
            lines=[
                s.ArmoryIntakeLineInput(item_id=item_id, entry=entry) for item_id, entry in lines
            ],
        ),
    )


def _register(env: AuditEnv, safe_id: int, item_id: int, *codes: str) -> list[int]:
    posting = _receive(
        env, safe_id, (item_id, s.ArmorySerialIntake(type="serial", serial_codes=list(codes)))
    )
    return [line.serial_id for line in posting.lines if line.serial_id is not None]


def _observations(
    draft: s.ArmoryMonthlyCountDraftRead,
    *,
    quantities: dict[int, int] | None = None,
    serials: dict[int, list[str]] | None = None,
) -> list[s.ArmoryCountObservation]:
    rows = []
    for item in draft.items:
        qty = (quantities or {}).get(item.id, 0)
        if item.kind in ("firearm", "serial"):
            rows.append(
                s.ArmoryCountObservation(
                    item_id=item.id,
                    observed_qty=qty,
                    serials_complete=True,
                    observed_serial_codes=(serials or {}).get(item.id, []),
                )
            )
        else:
            rows.append(s.ArmoryCountObservation(item_id=item.id, observed_qty=qty))
    return rows


def test_blind_monthly_count_keeps_unknown_and_unexpected_serial_evidence(env: AuditEnv) -> None:
    catalogue = seed_catalogue(env.db)
    rifle = catalogue.item("rifle")
    (serial_id,) = _register(env, env.source.id, rifle, "TEST-COUNT-01")
    draft = svc.monthly_count_draft(env.db, env.recorder, env.source.id)
    evidence = draft.model_dump()
    assert set(evidence) == {"safe", "month", "snapshot_token", "items"}
    assert "TEST-COUNT-01" not in draft.model_dump_json()
    assert all(
        set(item) == {"id", "name_en", "name_ar", "kind", "category", "drawing"}
        for item in evidence["items"]
    )
    assert draft.month == "2026-11"
    assert len(draft.items) == len(catalogue.items)
    keys = [(item.category, item.name_en.casefold(), item.id) for item in draft.items]
    assert keys == sorted(keys)

    lines = _observations(draft, quantities={rifle: 3}, serials={rifle: [" test-count-٠٢ "]})
    with pytest.raises(AppError) as exc:
        svc.create_monthly_count(
            env.db,
            env.recorder,
            env.source.id,
            s.ArmoryMonthlyCountCreate(
                snapshot_token=draft.snapshot_token,
                witness_employee_id=env.witness_id,
                lines=lines[:-1],
            ),
        )
    _error(exc, 422, "armory_invalid_input", field="lines")
    saved = svc.create_monthly_count(
        env.db,
        env.recorder,
        env.source.id,
        s.ArmoryMonthlyCountCreate(
            snapshot_token=draft.snapshot_token,
            witness_employee_id=env.witness_id,
            lines=lines,
        ),
    )
    observed = {line.item.id: line for line in saved.lines}
    counted = observed[rifle]
    assert counted.expected_qty is None and counted.expected_unrecorded_qty is None
    assert counted.expected_serials == [
        s.ArmoryCountSerialRef(serial_id=serial_id, serial_code="TEST-COUNT-01")
    ]
    assert counted.observed_qty == 4
    assert counted.observed_serial_codes == ["TEST-COUNT-02"]
    assert counted.observed_unrecorded_qty == 3
    assert observed[catalogue.item("cuffs")].observed_qty == 0
    assert observed[catalogue.item("cuffs")].expected_qty is None
    posting = core.posting_read(env.db, saved.posting.id)
    assert [(line.serial_id, line.after_state, line.stock_delta) for line in posting.lines] == [
        (serial_id, "missing", 0)
    ]
    assert len(saved.discrepancy_ids) == 2
    assert svc.get_count(env.db, saved.posting.id) == saved
    page = svc.list_counts(
        env.db, safe_id=env.source.id, kind="monthly_count", month=draft.month, page=1, page_size=1
    )
    assert page.total == 1 and page.items == [saved]


@pytest.mark.parametrize(
    ("outcome", "state"),
    [("found", "in_safe"), ("lost", "lost"), ("recording_error", "missing")],
)
def test_missing_serial_decision_only_changes_its_own_recorded_state(
    env: AuditEnv, outcome: s.ArmoryDecisionOutcome, state: s.ArmorySerialState
) -> None:
    catalogue = seed_catalogue(env.db)
    (serial_id,) = _register(env, env.source.id, catalogue.item("rifle"), "TEST-MISSING-01")
    draft = svc.shift_check_draft(env.db, env.recorder, env.source.id)
    count = svc.create_shift_check(
        env.db,
        env.recorder,
        env.source.id,
        s.ArmoryShiftCheckCreate(
            snapshot_token=draft.snapshot_token,
            witness_employee_id=env.witness_id,
            observed_serial_ids=[],
            confirm_missing=True,
        ),
    )
    (key,) = count.discrepancy_ids
    (finding,) = svc.list_discrepancies(
        env.db,
        env.reviewer,
        safe_id=env.source.id,
        status="open",
        discrepancy_id=key,
        page=1,
        page_size=1,
    ).items
    assert (finding.serial_id, finding.kind, finding.expected_qty, finding.observed_qty) == (
        serial_id,
        "missing_serial",
        1,
        0,
    )
    assert finding.allowed_outcomes == ["found", "lost", "recording_error"]
    assert finding.can_decide
    payload = s.ArmoryDecisionCreate(
        outcome=outcome, note="Test decision", witness_employee_id=env.reviewer_witness_id
    )
    resolved = svc.decide(env.db, env.reviewer, key, payload)
    assert resolved.status == "resolved" and not resolved.can_decide
    assert resolved.decision is not None and resolved.decision.outcome == outcome
    posting = resolved.decision.posting
    assert posting.related_posting_id == count.posting.id and posting.safe.id == env.source.id
    if outcome == "recording_error":
        assert posting.lines == []
    else:
        assert [
            (row.serial_id, row.before_state, row.after_state, row.stock_delta)
            for row in posting.lines
        ] == [(serial_id, "missing", state, 0)]
    after = svc.shift_check_draft(env.db, env.recorder, env.source.id)
    cards = {
        "in_safe": after.expected,
        "missing": after.reconciliation.missing,
        "lost": after.reconciliation.lost,
    }
    assert [row.id for row in cards[state]] == [serial_id]
    with pytest.raises(AppError) as exc:
        svc.decide(env.db, env.reviewer, key, payload)
    _error(exc, 409, "armory_already_decided", discrepancy_id=key)


def test_check_slots_follow_safe_creation_and_overnight_boundaries(
    env: AuditEnv, monkeypatch: pytest.MonkeyPatch
) -> None:
    env.source.created_at = dt.datetime(2026, 11, 25, 15)
    env.db.commit()
    draft = svc.shift_check_draft(env.db, env.recorder, env.source.id)
    saved = svc.create_shift_check(
        env.db,
        env.recorder,
        env.source.id,
        s.ArmoryShiftCheckCreate(
            snapshot_token=draft.snapshot_token,
            witness_employee_id=env.witness_id,
            observed_serial_ids=[],
            confirm_missing=False,
        ),
    )
    overnight = dt.datetime(2026, 11, 26, 21, tzinfo=dt.UTC)
    slots = svc.check_slots(env.db, env.source, overnight)
    day = dt.date(2026, 11, 26)
    assert [
        (
            slot.window.shift_date,
            slot.window.shift_kind,
            slot.status,
            slot.count_id,
            slot.missing_count,
        )
        for slot in slots
    ] == [
        (day, "night", "due", None, None),
        (day, "day", "completed", saved.posting.id, 0),
        (day - dt.timedelta(days=1), "night", "missed", None, None),
    ]
    assert slots[0].window.starts_at == dt.datetime(2026, 11, 26, 14, tzinfo=dt.UTC)
    boundary = dt.datetime(2026, 11, 27, 2, tzinfo=dt.UTC)
    assert slots[0].window.ends_at == boundary

    pin_clock(monkeypatch, overnight)
    night = svc.shift_check_draft(env.db, env.recorder, env.source.id)
    assert night.window == slots[0].window
    pin_clock(monkeypatch, boundary)
    with pytest.raises(AppError) as exc:
        svc.create_shift_check(
            env.db,
            env.recorder,
            env.source.id,
            s.ArmoryShiftCheckCreate(
                snapshot_token=night.snapshot_token,
                witness_employee_id=env.witness_id,
                observed_serial_ids=[],
                confirm_missing=False,
            ),
        )
    _error(exc, 409, "armory_stale_check", safe_id=env.source.id)
    after = svc.check_slots(env.db, env.source, boundary)
    assert [row.status for row in after] == ["due", "missed", "completed", "missed"]
    assert after[0].window.shift_date == dt.date(2026, 11, 27)
    assert after[0].window.shift_kind == "day"


def _issue(
    env: AuditEnv,
    catalogue: Catalogue,
    employee_id: str,
    *lines: s.ArmoryAssignmentLineInput,
    due_at: dt.datetime | None = None,
    kit: s.ArmoryKitCode = "equipment",
) -> s.ArmoryAssignmentRead:
    return custody.create_issue(
        env.db,
        env.recorder,
        s.ArmoryShiftIssueCreate(
            safe_id=env.source.id,
            kit_id=catalogue.kit(kit),
            employee_id=employee_id,
            lines=list(lines),
            due_at=due_at,
            off_duty_reason="cover",
        ),
    )


def _qualified(env: AuditEnv, employee_id: str, *, expires_on: dt.date | None = None) -> None:
    custody.save_qualification(
        env.db,
        env.recorder,
        employee_id,
        s.ArmoryQualificationUpsert(
            course_round=1,
            licence_number=f"LIC-TEST-{employee_id}",
            licence_expires_on=expires_on or NOW.date() + dt.timedelta(days=90),
        ),
        core.etag(0),
    )


def _return(
    env: AuditEnv, issue: s.ArmoryAssignmentRead, line: s.ArmoryAssignmentLineRead
) -> s.ArmoryReturnRead:
    return custody.create_return(
        env.db,
        env.recorder,
        s.ArmoryReturnCreate(
            assignment_id=issue.id,
            lines=[
                s.ArmoryReturnLineInput(
                    assignment_line_id=line.id,
                    expected_remaining_qty=line.remaining_qty,
                    returned_qty=line.remaining_qty,
                )
            ],
        ),
    )


def test_shift_and_summary_scope_global_missing_and_order_open_issues(
    env: AuditEnv, monkeypatch: pytest.MonkeyPatch
) -> None:
    catalogue = seed_catalogue(env.db)
    other = safe(env.db, env.recorder, "Test Safe B")
    rifle = catalogue.item("rifle")
    _register(env, other.id, rifle, "TEST-SUMMARY-Z", "TEST-SUMMARY-A")
    draft = svc.shift_check_draft(env.db, env.recorder, other.id)
    check = svc.create_shift_check(
        env.db,
        env.recorder,
        other.id,
        s.ArmoryShiftCheckCreate(
            snapshot_token=draft.snapshot_token,
            witness_employee_id=env.witness_id,
            observed_serial_ids=[],
            confirm_missing=True,
        ),
    )
    cuffs = catalogue.item("cuffs")
    _receive(
        env,
        env.source.id,
        (cuffs, s.ArmoryQuantityIntake(type="quantity", qty=8)),
        (
            catalogue.item("spray"),
            s.ArmoryExpiryIntake(
                type="expiry",
                batches=[
                    s.ArmoryBatchIntake(batch_ref="TEST-LOT-OLD", expires_on="2026-11-25", qty=2),
                    s.ArmoryBatchIntake(batch_ref="TEST-LOT-NEXT", expires_on="2026-11-26", qty=3),
                ],
            ),
        ),
    )
    former = employee(env.db, "G9110")
    active = employee(env.db, "G9111")
    _qualified(env, active.id, expires_on=NOW.date())
    line = s.ArmoryAssignmentLineInput(item_id=cuffs, qty=1)
    later = _issue(env, catalogue, active.id, line, due_at=NOW + dt.timedelta(hours=2))
    earlier = _issue(env, catalogue, former.id, line, due_at=NOW + dt.timedelta(hours=1))
    at_grace = _issue(env, catalogue, active.id, line, due_at=NOW + dt.timedelta(minutes=210))
    to_return = _issue(env, catalogue, active.id, line, due_at=NOW + dt.timedelta(hours=4))
    former.status = "Resigned"
    former.end_date = NOW.date()
    env.db.commit()
    now = NOW + dt.timedelta(hours=4)
    pin_clock(monkeypatch, now)
    returned = _return(env, to_return, to_return.lines[0])

    scoped = svc.summary(env.db, safe_id=env.source.id)
    assert scoped.now_at == now
    assert scoped.missing_firearm_count == 2
    assert [row.serial_code for row in scoped.missing_firearms] == [
        "TEST-SUMMARY-A",
        "TEST-SUMMARY-Z",
    ]
    assert scoped.overdue_count == 2
    assert [(row.id, row.overdue_minutes) for row in scoped.overdue] == [
        (earlier.id, 180),
        (later.id, 120),
    ]
    assert scoped.decision_count == 0 and scoped.due_check_count == 1
    assert (scoped.expired_batch_count, scoped.expiring_batch_count) == (1, 1)
    assert scoped.licences == s.ArmoryLicenceCounts(missing=0, expired=0, expiring=1, valid=0)
    assert scoped.former_open_count == 1
    assert svc.summary(env.db, safe_id=None).decision_count == 2

    view = svc.shift(env.db, env.recorder, safe_id=env.source.id)
    assert view.attention == scoped
    (section,) = view.safes
    assert section.safe.id == env.source.id
    assert not section.firearms and not section.on_duty
    assert [row.id for row in section.out] == [earlier.id, later.id, at_grace.id]
    assert section.returned_today == [returned]
    assert section.check_history[0].status == "due"
    all_safes = svc.shift(env.db, env.recorder, safe_id=None)
    assert [row.safe.id for row in all_safes.safes] == [env.source.id, other.id]
    complete = all_safes.safes[1].check_history[0]
    assert (complete.status, complete.count_id, complete.missing_count) == (
        "completed",
        check.posting.id,
        2,
    )


def _shift_payload(
    env: AuditEnv, draft: s.ArmoryShiftCheckDraftRead, *observed_ids: int, missing: bool = False
) -> s.ArmoryShiftCheckCreate:
    return s.ArmoryShiftCheckCreate(
        snapshot_token=draft.snapshot_token,
        witness_employee_id=env.witness_id,
        observed_serial_ids=list(observed_ids),
        confirm_missing=missing,
    )


def _monthly_payload(
    env: AuditEnv,
    draft: s.ArmoryMonthlyCountDraftRead,
    *,
    quantities: dict[int, int] | None = None,
    serials: dict[int, list[str]] | None = None,
) -> s.ArmoryMonthlyCountCreate:
    return s.ArmoryMonthlyCountCreate(
        snapshot_token=draft.snapshot_token,
        witness_employee_id=env.witness_id,
        lines=_observations(draft, quantities=quantities, serials=serials),
    )


def _findings(
    env: AuditEnv, *, status: str = "open", key: int | None = None, user: User | None = None
) -> list[s.ArmoryDiscrepancyRead]:
    return svc.list_discrepancies(
        env.db,
        user or env.reviewer,
        safe_id=env.source.id,
        status=status,
        discrepancy_id=key,
        page=1,
        page_size=50,
    ).items


def _decision(
    env: AuditEnv, outcome: s.ArmoryDecisionOutcome, *, witness: str | None = None
) -> s.ArmoryDecisionCreate:
    return s.ArmoryDecisionCreate(
        outcome=outcome,
        note="Test review evidence",
        witness_employee_id=witness or env.reviewer_witness_id,
    )


def test_shift_check_only_counts_expected_serials_and_requires_exact_missing_confirmation(
    env: AuditEnv, monkeypatch: pytest.MonkeyPatch
) -> None:
    db, actor, safe_id = env.db, env.recorder, env.source.id
    catalogue = seed_catalogue(db)
    rifle = catalogue.item("rifle")
    pin_clock(monkeypatch, NOW - dt.timedelta(hours=5))
    (previous_missing,) = _register(env, safe_id, rifle, "TEST-PRIOR-MISS")
    prior = svc.shift_check_draft(db, actor, safe_id)
    svc.create_shift_check(db, actor, safe_id, _shift_payload(env, prior, missing=True))
    pin_clock(monkeypatch)
    seen, absent_a, absent_b, repair, lost, written_off, signed_out, in_custody = _register(
        env,
        safe_id,
        rifle,
        "TEST-CK-01",
        "TEST-CK-02",
        "TEST-CK-03",
        "TEST-CK-04",
        "TEST-CK-05",
        "TEST-CK-06",
        "TEST-CK-07",
        "TEST-CK-08",
    )
    (non_firearm,) = _register(env, safe_id, catalogue.item("radio"), "TEST-CK-RADIO")
    (other_safe_serial,) = _register(
        env,
        safe(db, actor, "Test Safe Other").id,
        rifle,
        "TEST-CK-OTHER",
    )
    actions: list[tuple[int, s.ArmorySerialAction]] = [
        (repair, "send_repair"),
        (lost, "mark_lost"),
        (written_off, "write_off"),
    ]
    for serial_id, action in actions:
        current = catalog.serial_detail(db, serial_id)
        catalog.move_serial(
            db,
            actor,
            serial_id,
            s.ArmorySerialMovementCreate(
                action=action,
                expected_state="in_safe",
                expected_safe_id=safe_id,
                expected_posting_id=current.last_posting_id,
                reason="Test evidence",
                witness_employee_id=env.witness_id,
            ),
        )
    holder = employee(db, "G9121").id
    custodian = employee(db, "G9122").id
    _qualified(env, holder)
    _qualified(env, custodian)
    issue = _issue(
        env,
        catalogue,
        holder,
        s.ArmoryAssignmentLineInput(item_id=rifle, serial_id=signed_out, qty=1),
        kit="rifle",
    )
    custody.create_custody(
        db,
        actor,
        s.ArmoryCustodyCreate(
            safe_id=safe_id,
            holder_kind="person",
            holder_employee_id=custodian,
            kit_id=catalogue.kit("rifle"),
            lines=[s.ArmoryAssignmentLineInput(item_id=rifle, serial_id=in_custody, qty=1)],
        ),
    )
    draft = svc.shift_check_draft(db, actor, safe_id)
    assert [row.id for row in draft.expected] == [seen, absent_a, absent_b]
    reconciliation = draft.reconciliation
    assert reconciliation.assigned_count == 8
    assert [row.id for row in reconciliation.signed_out] == [signed_out]
    assert [row.id for row in reconciliation.in_custody] == [in_custody]
    assert [row.id for row in reconciliation.in_repair] == [repair]
    assert [row.id for row in reconciliation.missing] == [previous_missing]
    assert [row.id for row in reconciliation.lost] == [lost]
    assert svc.shift_check_draft(db, actor, safe_id).snapshot_token == draft.snapshot_token

    failures = [
        (_shift_payload(env, draft, seen), "confirm_missing"),
        (_shift_payload(env, draft, seen, absent_a, absent_b, missing=True), "confirm_missing"),
        (_shift_payload(env, draft, other_safe_serial, missing=True), "observed_serial_ids"),
        (_shift_payload(env, draft, non_firearm, missing=True), "observed_serial_ids"),
    ]
    for payload, field in failures:
        with pytest.raises(AppError) as exc:
            svc.create_shift_check(db, actor, safe_id, payload)
        _error(exc, 422, "armory_invalid_input", field=field)
    result = svc.create_shift_check(
        db, actor, safe_id, _shift_payload(env, draft, seen, missing=True)
    )
    assert result.reconciliation == reconciliation
    (line,) = result.lines
    assert (line.expected_qty, line.observed_qty) == (3, 1)
    assert [row.serial_id for row in line.expected_serials] == [seen, absent_a, absent_b]
    assert line.observed_serial_codes == ["TEST-CK-01"]
    effects = core.posting_read(db, result.posting.id).lines
    assert [(row.serial_id, row.before_state, row.after_state) for row in effects] == [
        (absent_a, "in_safe", "missing"),
        (absent_b, "in_safe", "missing"),
    ]
    findings = [row for row in _findings(env) if row.source.id == result.posting.id]
    assert set(result.discrepancy_ids) == {row.id for row in findings}
    assert {(row.serial_id, row.kind, row.expected_qty, row.observed_qty) for row in findings} == {
        (absent_a, "missing_serial", 1, 0),
        (absent_b, "missing_serial", 1, 0),
    }

    pin_clock(monkeypatch, NOW + dt.timedelta(hours=3))
    _return(env, issue, issue.lines[0])
    assert catalog.serial_detail(db, signed_out).state == "in_safe"
    assert svc.get_count(db, result.posting.id).reconciliation == reconciliation


@pytest.mark.parametrize("change", ["registration", "return"])
def test_a_second_sqlite_session_invalidates_both_count_drafts(
    api_db: Session, monkeypatch: pytest.MonkeyPatch, change: str
) -> None:
    env = _env(api_db, monkeypatch)
    catalogue = seed_catalogue(api_db)
    rifle = catalogue.item("rifle")
    safe_id = env.source.id
    _receive(
        env,
        safe_id,
        (rifle, s.ArmorySerialIntake(type="serial", serial_codes=[], unrecorded_qty=1)),
        opening=True,
    )
    issue = None
    if change == "return":
        (serial_id,) = _register(env, safe_id, rifle, "TEST-RACE-RETURN")
        holder = employee(api_db, "G9123")
        _qualified(env, holder.id)
        issue = _issue(
            env,
            catalogue,
            holder.id,
            s.ArmoryAssignmentLineInput(item_id=rifle, serial_id=serial_id, qty=1),
            kit="rifle",
        )
    checking = svc.shift_check_draft(api_db, env.recorder, safe_id)
    monthly = svc.monthly_count_draft(api_db, env.recorder, safe_id)
    assert checking.expected == []

    with sessionmaker(bind=api_db.get_bind(), expire_on_commit=False)() as concurrent:
        operator = concurrent.get(User, env.recorder.id)
        assert operator is not None
        if issue is not None:
            _return(replace(env, db=concurrent, recorder=operator), issue, issue.lines[0])
        else:
            catalog.record_serials(
                concurrent,
                operator,
                rifle,
                s.ArmorySerialRegistrationCreate(
                    safe_id=safe_id,
                    serial_codes=["TEST-RACE-REGISTER"],
                    reference="REF-TEST-REGISTER",
                    witness_employee_id=env.witness_id,
                ),
            )

    with pytest.raises(AppError) as exc:
        svc.create_shift_check(api_db, env.recorder, safe_id, _shift_payload(env, checking))
    _error(exc, 409, "armory_stale_check", safe_id=safe_id)
    with pytest.raises(AppError) as exc:
        svc.create_monthly_count(api_db, env.recorder, safe_id, _monthly_payload(env, monthly))
    _error(exc, 409, "armory_stale_count", safe_id=safe_id)
    fresh = svc.shift_check_draft(api_db, env.recorder, safe_id)
    assert len(fresh.expected) == 1 and fresh.reconciliation.missing == []
    assert (
        svc.list_counts(
            api_db,
            safe_id=safe_id,
            kind=None,
            month=None,
            page=1,
            page_size=10,
        ).items
        == []
    )


def test_monthly_serial_observations_must_explicitly_confirm_even_an_empty_roster(
    env: AuditEnv,
) -> None:
    seed_catalogue(env.db)
    draft = svc.monthly_count_draft(env.db, env.recorder, env.source.id)
    payload = _monthly_payload(env, draft)
    index = next(i for i, item in enumerate(draft.items) if item.kind == "serial")
    item_id = payload.lines[index].item_id
    invalid = [
        (
            s.ArmoryCountObservation(item_id=item_id, observed_qty=0, serials_complete=True),
            "observed_serial_codes",
        ),
        (
            s.ArmoryCountObservation(item_id=item_id, observed_qty=0, observed_serial_codes=[]),
            "serials_complete",
        ),
        (payload.lines[0], "item_id"),
    ]
    for replacement, field in invalid:
        lines = payload.lines.copy()
        lines[index] = replacement
        with pytest.raises(AppError) as exc:
            svc.create_monthly_count(
                env.db,
                env.recorder,
                env.source.id,
                payload.model_copy(update={"lines": lines}),
            )
        _error(exc, 422, "armory_invalid_input", field=f"lines.{index}.{field}")
    saved = svc.create_monthly_count(env.db, env.recorder, env.source.id, payload)
    assert len(saved.lines) == len(draft.items) and not saved.discrepancy_ids
    with pytest.raises(AppError) as exc:
        svc.create_monthly_count(env.db, env.recorder, env.source.id, payload)
    _error(exc, 409, "armory_period_already_recorded", count_id=saved.posting.id)


def _rounds_shortfall(env: AuditEnv) -> tuple[int, str]:
    catalogue = seed_catalogue(env.db)
    rifle = catalogue.item("rifle")
    rounds = catalogue.item("rifle-rounds")
    (serial_id,) = _register(env, env.source.id, rifle, "TEST-ROUNDS-HOLDER")
    _receive(
        env, env.source.id, (rounds, s.ArmoryQuantityIntake(type="quantity", qty=19)), opening=True
    )
    holder = employee(env.db, "G9124")
    _qualified(env, holder.id)
    issue = _issue(
        env,
        catalogue,
        holder.id,
        s.ArmoryAssignmentLineInput(item_id=rifle, serial_id=serial_id, qty=1),
        s.ArmoryAssignmentLineInput(item_id=rounds, qty=7),
        kit="rifle",
    )
    round_line = next(line for line in issue.lines if line.item.id == rounds)
    returned = custody.create_return(
        env.db,
        env.recorder,
        s.ArmoryReturnCreate(
            assignment_id=issue.id,
            witness_employee_id=env.witness_id,
            lines=[
                s.ArmoryReturnLineInput(
                    assignment_line_id=round_line.id,
                    expected_remaining_qty=7,
                    returned_qty=2,
                    shortfall=s.ArmoryShortfallInput(reason="training", reference="REF-TEST-SHORT"),
                )
            ],
        ),
    )
    assert len(returned.posting.discrepancy_ids) == 1
    return rounds, holder.id


@pytest.mark.parametrize(
    ("outcome", "total", "classified"),
    [
        ("found", 19, (0, 0, 0)),
        ("used_in_training", 14, (5, 0, 0)),
        ("lost", 14, (0, 5, 0)),
        ("recording_error", 14, (0, 0, 5)),
    ],
)
def test_rounds_decisions_credit_only_found_to_the_sending_safe(
    env: AuditEnv, outcome: s.ArmoryDecisionOutcome, total: int, classified: tuple[int, int, int]
) -> None:
    rounds, holder = _rounds_shortfall(env)
    (discrepancy,) = _findings(env)
    assert discrepancy.person is not None and discrepancy.person.employee_id == holder
    assert discrepancy.allowed_outcomes == ["found", "used_in_training", "lost", "recording_error"]
    before = catalog.item_detail(env.db, rounds, safe_id=env.source.id).totals
    assert (before.in_safe, before.awaiting_rounds_decision) == (14, 5)
    result = svc.decide(env.db, env.reviewer, discrepancy.id, _decision(env, outcome))
    assert result.decision is not None
    posting = result.decision.posting
    assert (posting.safe.id, posting.related_posting_id) == (env.source.id, discrepancy.source.id)
    assert [line.stock_delta for line in posting.lines] == ([5] if outcome == "found" else [])
    after = catalog.item_detail(env.db, rounds, safe_id=env.source.id).totals
    assert (after.in_safe, after.awaiting_rounds_decision) == (total, 0)
    assert (after.expended_rounds, after.lost_rounds, after.settled_rounds) == classified
    assert _findings(env) == []
    assert _findings(env, status="resolved", key=discrepancy.id) == [result]
    assert _findings(env, status="all", key=discrepancy.id + 1) == []


def test_decision_movement_keeps_its_discrepancy_link_after_void(env: AuditEnv) -> None:
    _rounds_shortfall(env)
    (finding,) = _findings(env)
    resolved = svc.decide(env.db, env.reviewer, finding.id, _decision(env, "recording_error"))
    assert resolved.decision is not None
    posting = resolved.decision.posting
    assert posting.discrepancy_ids == [finding.id]

    voided = voids.void(
        env.db,
        env.reviewer,
        posting.id,
        s.ArmoryVoid(reason="Correct the decision evidence", witness_employee_id=env.witness_id),
    )
    assert voided.voided_at is not None
    assert reads.get_movement(env.db, posting.id).discrepancy_ids == [finding.id]
    assert reads.get_movement(env.db, finding.source.id).discrepancy_ids == [finding.id]


def test_decision_rejects_same_user_same_employee_involved_people_and_invalid_witnesses(
    env: AuditEnv,
) -> None:
    _, holder = _rounds_shortfall(env)
    (finding,) = _findings(env)
    first_employee = env.recorder.employee_id
    assert first_employee is not None
    same_person = account(env.db, employee_id=first_employee)
    holder_account = account(env.db, employee_id=holder)
    viewer = account(env.db, employee_id=env.reviewer.employee_id, grants=("armory.view",))
    env.recorder.employee_id = employee(env.db, "G9125").id
    env.db.commit()
    for candidate in (env.recorder, same_person, holder_account):
        (projection,) = _findings(env, key=finding.id, user=candidate)
        assert not projection.can_decide
        assert projection.recorder.employee is not None
        assert projection.recorder.employee.employee_id == first_employee
        with pytest.raises(AppError) as exc:
            svc.decide(env.db, candidate, finding.id, _decision(env, "found"))
        _error(exc, 422, "armory_second_user_required", discrepancy_id=finding.id)
    assert not _findings(env, key=finding.id, user=viewer)[0].can_decide
    no_employee = account(env.db)
    with pytest.raises(AppError) as exc:
        svc.decide(env.db, no_employee, finding.id, _decision(env, "found"))
    _error(exc, 422, "armory_actor_employee_required")
    former = employee(env.db, "G9126", status="Resigned")
    for witness in (env.reviewer.employee_id, first_employee, holder, former.id, "G9199"):
        assert witness is not None
        with pytest.raises(AppError) as exc:
            svc.decide(env.db, env.reviewer, finding.id, _decision(env, "found", witness=witness))
        _error(exc, 422, "armory_invalid_witness", witness_employee_id=witness)
    assert _findings(env, key=finding.id)[0].can_decide


@pytest.mark.parametrize(
    ("key", "opening", "observed", "outcome", "delta"),
    [
        ("cuffs", 8, 5, "found", 0),
        ("cuffs", 8, 5, "lost", -3),
        ("cuffs", 8, 5, "recording_error", 0),
        ("rifle-rounds", 8, 5, "used_in_training", -3),
        ("cuffs", 0, 4, "found", 4),
        ("cuffs", 0, 4, "recording_error", 0),
    ],
)
def test_monthly_quantity_decisions_apply_only_the_known_variance(
    env: AuditEnv,
    key: str,
    opening: int,
    observed: int,
    outcome: s.ArmoryDecisionOutcome,
    delta: int,
) -> None:
    catalogue = seed_catalogue(env.db)
    item_id = catalogue.item(key)
    _receive(
        env,
        env.source.id,
        (item_id, s.ArmoryQuantityIntake(type="quantity", qty=opening)),
        opening=True,
    )
    draft = svc.monthly_count_draft(env.db, env.recorder, env.source.id)
    saved = svc.create_monthly_count(
        env.db,
        env.recorder,
        env.source.id,
        _monthly_payload(env, draft, quantities={item_id: observed}),
    )
    (finding,) = _findings(env)
    assert finding.id in saved.discrepancy_ids
    assert (finding.kind, finding.expected_qty, finding.observed_qty) == (
        "monthly_quantity",
        opening,
        observed,
    )
    assert catalog.item_detail(env.db, item_id, safe_id=env.source.id).totals.in_safe == opening
    unrelated = catalogue.item("baton")
    _receive(env, env.source.id, (unrelated, s.ArmoryQuantityIntake(type="quantity", qty=1)))
    other = safe(env.db, env.recorder, "Test Safe Separate")
    _receive(env, other.id, (item_id, s.ArmoryQuantityIntake(type="quantity", qty=1)))

    if key == "cuffs":
        assert "used_in_training" not in finding.allowed_outcomes
        with pytest.raises(AppError) as exc:
            svc.decide(env.db, env.reviewer, finding.id, _decision(env, "used_in_training"))
        _error(exc, 422, "armory_invalid_outcome", discrepancy_id=finding.id)
    resolved = svc.decide(env.db, env.reviewer, finding.id, _decision(env, outcome))
    assert resolved.decision is not None
    assert [line.stock_delta for line in resolved.decision.posting.lines] == (
        [delta] if delta else []
    )
    assert (
        catalog.item_detail(env.db, item_id, safe_id=env.source.id).totals.in_safe
        == opening + delta
    )


def test_unregistered_count_variance_and_missing_and_unexpected_codes_are_independent(
    env: AuditEnv,
) -> None:
    catalogue = seed_catalogue(env.db)
    radio = catalogue.item("radio")
    _receive(
        env,
        env.source.id,
        (
            radio,
            s.ArmorySerialIntake(type="serial", serial_codes=["TEST-RADIO-MISS"], unrecorded_qty=5),
        ),
        opening=True,
    )
    other = safe(env.db, env.recorder, "Test Safe Radio")
    (elsewhere,) = _register(env, other.id, radio, "TEST-RADIO-AWAY")
    draft = svc.monthly_count_draft(env.db, env.recorder, env.source.id)
    saved = svc.create_monthly_count(
        env.db,
        env.recorder,
        env.source.id,
        _monthly_payload(env, draft, quantities={radio: 3}, serials={radio: [" test-radio-away "]}),
    )
    evidence = next(line for line in saved.lines if line.item.id == radio)
    assert (evidence.expected_qty, evidence.observed_qty) == (6, 4)
    assert (evidence.expected_unrecorded_qty, evidence.observed_unrecorded_qty) == (5, 3)
    findings = {row.kind: row for row in _findings(env)}
    assert set(findings) == {"monthly_quantity", "missing_serial", "unexpected_serial"}
    variance = findings["monthly_quantity"]
    assert (variance.expected_qty, variance.observed_qty) == (5, 3)
    wrong = findings["unexpected_serial"]
    assert (wrong.serial_id, wrong.serial_code, wrong.expected_qty, wrong.observed_qty) == (
        None,
        "TEST-RADIO-AWAY",
        0,
        1,
    )
    assert wrong.allowed_outcomes == ["recording_error"]
    with pytest.raises(AppError) as exc:
        svc.decide(env.db, env.reviewer, wrong.id, _decision(env, "found"))
    _error(exc, 422, "armory_invalid_outcome", discrepancy_id=wrong.id)
    error = svc.decide(env.db, env.reviewer, wrong.id, _decision(env, "recording_error"))
    assert error.decision is not None and error.decision.posting.lines == []
    serial = catalog.serial_detail(env.db, elsewhere)
    assert serial.safe is not None and serial.safe.id == other.id and serial.state == "in_safe"
    applied = svc.decide(env.db, env.reviewer, variance.id, _decision(env, "lost"))
    assert applied.decision is not None
    (effect,) = applied.decision.posting.lines
    assert (effect.serial_id, effect.stock_delta) == (None, -2)
    live = catalog.item_detail(env.db, radio, safe_id=env.source.id)
    assert live.totals.unrecorded_qty == 3
    assert [row.state for row in live.serials] == ["missing"]


@pytest.mark.parametrize(("observed", "outcome", "delta"), [(3, "lost", -2), (11, "found", 2)])
def test_expiry_quantity_decision_allocates_whole_difference_to_existing_batches_atomically(
    env: AuditEnv,
    observed: int,
    outcome: s.ArmoryDecisionOutcome,
    delta: int,
) -> None:
    catalogue = seed_catalogue(env.db)
    spray, cartridge = catalogue.item("spray"), catalogue.item("cartridge")
    intake = _receive(
        env,
        env.source.id,
        (
            spray,
            s.ArmoryExpiryIntake(
                type="expiry",
                batches=[
                    s.ArmoryBatchIntake(batch_ref="TEST-EXPIRED", expires_on="2026-10", qty=2),
                    s.ArmoryBatchIntake(batch_ref="TEST-VALID", expires_on="2027-07", qty=5),
                ],
            ),
        ),
        (
            cartridge,
            s.ArmoryExpiryIntake(
                type="expiry",
                batches=[s.ArmoryBatchIntake(batch_ref="TEST-OTHER", expires_on="2027-08", qty=4)],
            ),
        ),
        opening=True,
    )
    batches = {
        line.batch.batch_ref: line.batch.id for line in intake.lines if line.batch is not None
    }
    old, valid, unrelated = batches["TEST-EXPIRED"], batches["TEST-VALID"], batches["TEST-OTHER"]
    draft = svc.monthly_count_draft(env.db, env.recorder, env.source.id)
    saved = svc.create_monthly_count(
        env.db,
        env.recorder,
        env.source.id,
        _monthly_payload(env, draft, quantities={spray: observed, cartridge: 4}),
    )
    evidence = next(line for line in saved.lines if line.item.id == spray)
    assert evidence.expected_qty == 7
    (finding,) = _findings(env)
    decision = _decision(env, outcome)
    with pytest.raises(AppError) as exc:
        svc.decide(env.db, env.reviewer, finding.id, decision)
    _error(exc, 422, "armory_invalid_input", field="batches")

    def allocate(*rows: tuple[int, int]) -> s.ArmoryDecisionCreate:
        return decision.model_copy(
            update={
                "batches": [
                    s.ArmoryDecisionBatchInput(batch_id=batch_id, qty=qty) for batch_id, qty in rows
                ],
            }
        )

    with pytest.raises(AppError) as exc:
        svc.decide(env.db, env.reviewer, finding.id, allocate((old, 1), (unrelated, 3)))
    _error(exc, 422, "armory_invalid_input", field="batches.1.batch_id")
    if delta < 0:
        with pytest.raises(AppError) as exc:
            svc.decide(env.db, env.reviewer, finding.id, allocate((valid, 1), (old, 3)))
        _error(
            exc,
            409,
            "armory_insufficient_stock",
            safe_id=env.source.id,
            item_id=spray,
            batch_id=old,
            available_qty=2,
        )
    assert catalog.item_detail(env.db, spray, safe_id=env.source.id).totals.in_safe == 7
    resolution = svc.decide(env.db, env.reviewer, finding.id, allocate((valid, 2), (old, 2)))
    assert resolution.decision is not None
    assert [
        (line.batch.id, line.stock_delta)
        for line in resolution.decision.posting.lines
        if line.batch is not None
    ] == [(valid, delta), (old, delta)]
    detail = catalog.item_detail(env.db, spray, safe_id=env.source.id)
    assert {row.batch.id: row.on_hand for row in detail.batches} == {
        valid: 5 + delta,
        old: 2 + delta,
    }


@pytest.mark.parametrize("drift", ["same_total_new_effects", "voided_zero_opening"])
def test_monthly_stock_corrections_reject_evidence_drift_even_at_equal_totals(
    env: AuditEnv, drift: str
) -> None:
    catalogue = seed_catalogue(env.db)
    cuffs = catalogue.item("cuffs")
    opening = 8 if drift == "same_total_new_effects" else 0
    stock = _receive(
        env,
        env.source.id,
        (cuffs, s.ArmoryQuantityIntake(type="quantity", qty=opening)),
        opening=True,
    )
    draft = svc.monthly_count_draft(env.db, env.recorder, env.source.id)
    svc.create_monthly_count(
        env.db,
        env.recorder,
        env.source.id,
        _monthly_payload(env, draft, quantities={cuffs: 5 if opening else 2}),
    )
    (finding,) = _findings(env)
    outcome: s.ArmoryDecisionOutcome = "found"
    if drift == "same_total_new_effects":
        _receive(env, env.source.id, (cuffs, s.ArmoryQuantityIntake(type="quantity", qty=2)))
        holder = employee(env.db, "G9127")
        _issue(env, catalogue, holder.id, s.ArmoryAssignmentLineInput(item_id=cuffs, qty=2))
        outcome = "lost"
    else:
        voids.void(
            env.db,
            env.reviewer,
            stock.id,
            s.ArmoryVoid(
                reason="Test voided baseline", witness_employee_id=env.reviewer_witness_id
            ),
        )
    assert catalog.item_detail(env.db, cuffs, safe_id=env.source.id).totals.known_in_safe == opening
    with pytest.raises(AppError) as exc:
        svc.decide(env.db, env.reviewer, finding.id, _decision(env, outcome))
    _error(exc, 409, "armory_stale_decision", discrepancy_id=finding.id)
    result = svc.decide(env.db, env.reviewer, finding.id, _decision(env, "recording_error"))
    assert result.decision is not None and result.decision.posting.lines == []


def test_voided_check_remains_in_history_but_cannot_be_decided(env: AuditEnv) -> None:
    catalogue = seed_catalogue(env.db)
    (serial_id,) = _register(env, env.source.id, catalogue.item("rifle"), "TEST-VOIDED-CHECK")
    draft = svc.shift_check_draft(env.db, env.recorder, env.source.id)
    saved = svc.create_shift_check(
        env.db,
        env.recorder,
        env.source.id,
        _shift_payload(env, draft, missing=True),
    )
    (key,) = saved.discrepancy_ids
    voided = voids.void(
        env.db,
        env.reviewer,
        saved.posting.id,
        s.ArmoryVoid(reason="Test correction", witness_employee_id=env.reviewer_witness_id),
    )
    assert voided.voided_at is not None
    historical = svc.get_count(env.db, saved.posting.id)
    assert historical.posting.voided_at == voided.voided_at
    assert historical.lines == saved.lines
    assert _findings(env) == _findings(env, status="resolved") == []
    (past,) = _findings(env, status="all", key=key)
    assert past.status == "voided" and not past.can_decide
    with pytest.raises(AppError) as exc:
        svc.decide(env.db, env.reviewer, key, _decision(env, "found"))
    _error(exc, 409, "armory_stale_decision", discrepancy_id=key)
    fresh = svc.shift_check_draft(env.db, env.recorder, env.source.id)
    assert [row.id for row in fresh.expected] == [serial_id]
    assert svc.check_slots(env.db, env.source, NOW)[0].status == "due"


def test_monthly_token_changes_with_catalogue_and_local_month_not_utc_day(
    env: AuditEnv, monkeypatch: pytest.MonkeyPatch
) -> None:
    seed_catalogue(env.db)
    before_midnight = dt.datetime(2026, 11, 30, 19, 59, tzinfo=dt.UTC)
    pin_clock(monkeypatch, before_midnight)
    old = svc.monthly_count_draft(env.db, env.recorder, env.source.id)
    added = catalog.create_item(
        env.db,
        env.recorder,
        s.ArmoryItemCreate(
            name_en="Test Count Accessory",
            name_ar="ملحق اختبار",
            category="accessories",
            kind="quantity",
            drawing="tool",
        ),
    )
    with pytest.raises(AppError) as exc:
        svc.create_monthly_count(env.db, env.recorder, env.source.id, _monthly_payload(env, old))
    _error(exc, 409, "armory_stale_count", safe_id=env.source.id)
    november = svc.monthly_count_draft(env.db, env.recorder, env.source.id)
    assert november.month == "2026-11" and added.id in {item.id for item in november.items}
    pin_clock(monkeypatch, before_midnight + dt.timedelta(minutes=1))
    december = svc.monthly_count_draft(env.db, env.recorder, env.source.id)
    assert december.month == "2026-12"
    with pytest.raises(AppError) as exc:
        svc.create_monthly_count(
            env.db, env.recorder, env.source.id, _monthly_payload(env, november)
        )
    _error(exc, 409, "armory_stale_count", safe_id=env.source.id)
