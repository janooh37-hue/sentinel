# backend/tests/test_timesheet_service.py
"""Roster, ordering, and the statistics posts-vs-headcount split.

The numbers come from July 2026: 275 on the main sheet, 2 drivers, 249 posts.

The tests below the ``--- rules ---`` banner are the ones the plan wrote out
verbatim; the ones after each banner cover the rules those left unguarded (the
statistics keep-sets, the filler lookback, the notes column, the seal) and the
two controller rulings.
"""

import json
from datetime import date, datetime

import pytest

from app.api.errors import ConflictError, NotFoundError, ValidationFailedError
from app.core.timesheet_codes import (
    CODE_ABSENT,
    CODE_ANNUAL,
    CODE_NATIONAL,
    CODE_NEW,
    CODE_OFF_ROSTER,
    CODE_PRESENT,
    CODE_SICK,
)
from app.db.models import (
    Absence,
    AuditLog,
    Employee,
    Leave,
    TimesheetDesignation,
    TimesheetOverride,
    TimesheetPeriod,
    TimesheetRosterAssignment,
    TimesheetSnapshotRow,
    TimesheetStartAck,
    TimesheetStatFiller,
)
from app.schemas.timesheet import TimesheetRosterAssignmentWrite
from app.services import absence_service
from app.services import timesheet_service as svc
from tests.conftest import make_user


@pytest.fixture(autouse=True)
def _designations(db_session):
    """metadata.create_all skips migration 0070, which is what seeds the catalog."""
    svc.seed_designations(db_session)


@pytest.fixture()
def guards(db_session):
    """Three guards and one driver, all joined long ago."""
    rows = {d.name_en: d for d in db_session.query(TimesheetDesignation).all()}
    for employee_id in ("G1001", "G1002", "G0999", "G2000"):
        db_session.add(
            Employee(
                id=employee_id,
                name_en=f"Name {employee_id}",
                nationality="الإمارات",
                doj=date(2020, 1, 1),
            )
        )
    db_session.commit()
    for employee_id, designation in (
        ("G1001", "Security Guard"),
        ("G1002", "Security Guard"),
        ("G0999", "Security Supervisor"),
        ("G2000", "Driver"),
    ):
        _add_assignment(db_session, employee_id, rows[designation].id, date(2026, 1, 1))
    db_session.commit()


def _add_assignment(db, employee_id, designation_id, effective_from):
    db.add(
        TimesheetRosterAssignment(
            employee_id=employee_id,
            designation_id=designation_id,
            effective_from=effective_from,
        )
    )
    db.flush()


def _row(db, year, month, employee_id, *, sheet="main"):
    """The one grid row for ``employee_id``; KeyError-loud if he is not on it."""
    grid = svc.build_month(db, year, month, sheet=sheet)
    return next(r for r in grid.rows if r.employee_id == employee_id)


def test_grid_reports_persisted_edits_with_the_editor(db_session, guards):
    user = make_user(db_session, email="editor@x.ae")

    svc.set_cell(db_session, 2026, 7, "G1001", 14, "AB", user_id=user.id)
    absence = db_session.query(Absence).filter_by(employee_id="G1001").one()
    expected_absence = svc.CellEdit("AB", user.display_name or user.email, absence.created_at)
    assert _row(db_session, 2026, 7, "G1001").edits[14] == expected_absence

    svc.set_cell(db_session, 2026, 7, "G1001", 15, "X", user_id=user.id)
    override = db_session.query(TimesheetOverride).filter_by(day=15).one()
    expected_override = svc.CellEdit("X", user.display_name or user.email, override.created_at)
    assert _row(db_session, 2026, 7, "G1001").edits[15] == expected_override

    svc.close_month(db_session, 2026, 7)
    sealed = _row(db_session, 2026, 7, "G1001")
    assert sealed.edits[14] == expected_absence
    assert sealed.edits[15] == expected_override




def test_effective_roster_assignment_wins_by_month_and_explicit_null_unassigns(db_session, guards):
    guard = db_session.query(TimesheetDesignation).filter_by(name_en="Security Guard").one()
    supervisor = (
        db_session.query(TimesheetDesignation).filter_by(name_en="Security Supervisor").one()
    )
    _add_assignment(db_session, "G1001", supervisor.id, date(2026, 8, 1))
    _add_assignment(db_session, "G1001", None, date(2026, 9, 1))
    db_session.commit()

    july = _row(db_session, 2026, 7, "G1001")
    august = _row(db_session, 2026, 8, "G1001")
    september = _row(db_session, 2026, 9, "G1001")

    assert (july.designation_en, july.designation_id) == ("Security Guard", guard.id)
    assert (august.designation_en, august.designation_id) == ("Security Supervisor", supervisor.id)
    assert (september.designation_en, september.designation_id) == (None, None)
    assert any(
        issue.employee_id == "G1001" and issue.kind == "no_designation"
        for issue in svc.build_month(db_session, 2026, 9).blocking
    )


def test_sealed_rows_keep_frozen_designation_after_later_assignment_and_catalog_edit(
    db_session, guards
):
    guard = db_session.query(TimesheetDesignation).filter_by(name_en="Security Guard").one()
    supervisor = (
        db_session.query(TimesheetDesignation).filter_by(name_en="Security Supervisor").one()
    )
    svc.close_month(db_session, 2026, 7)
    _add_assignment(db_session, "G1001", supervisor.id, date(2026, 8, 1))
    guard.name_en = "Edited after seal"
    db_session.commit()

    sealed = _row(db_session, 2026, 7, "G1001")
    live = _row(db_session, 2026, 8, "G1001")

    assert (sealed.designation_en, sealed.rank_order, sealed.designation_id) == (
        "Security Guard",
        guard.rank_order,
        None,
    )
    assert (live.designation_en, live.designation_id) == ("Security Supervisor", supervisor.id)


def test_seeding_is_idempotent(db_session):
    svc.seed_designations(db_session)
    assert db_session.query(TimesheetDesignation).count() == 16


def test_supervisor_sorts_above_guards_and_ids_break_ties(db_session, guards):
    grid = svc.build_month(db_session, 2026, 7)
    assert [r.employee_id for r in grid.rows] == ["G0999", "G1001", "G1002"]
    assert [r.row_no for r in grid.rows] == [1, 2, 3]


def test_drivers_are_a_separate_sheet(db_session, guards):
    assert [r.employee_id for r in svc.build_month(db_session, 2026, 7, sheet="drivers").rows] == [
        "G2000"
    ]


def test_post_count_defaults_to_249_without_creating_a_period(db_session, guards):
    grid = svc.build_month(db_session, 2026, 7)
    assert grid.post_count == 249
    assert db_session.query(TimesheetPeriod).count() == 0


def test_a_quiet_guard_is_present_all_month(db_session, guards):
    grid = svc.build_month(db_session, 2026, 7)
    assert grid.rows[0].codes[:31] == [CODE_PRESENT] * 31
    assert grid.days_in_month == 31


def test_main_statistics_compensates_by_rank_then_groups_codes():
    assert svc._compensated_day(
        [CODE_SICK, CODE_ANNUAL, CODE_PRESENT, CODE_PRESENT, CODE_PRESENT], 3
    ) == [CODE_PRESENT, CODE_PRESENT, CODE_PRESENT, CODE_ANNUAL, CODE_SICK]


def test_main_statistics_does_not_invent_leave_when_targets_outnumber_sources():
    assert svc._compensated_day(
        [CODE_ANNUAL, CODE_PRESENT, CODE_PRESENT, CODE_PRESENT, CODE_PRESENT], 3
    ) == [CODE_PRESENT, CODE_PRESENT, CODE_PRESENT, CODE_ANNUAL, CODE_PRESENT]


def test_main_statistics_keeps_unmatched_and_fixed_codes():
    assert svc._compensated_day(
        [
            CODE_SICK,
            CODE_ANNUAL,
            CODE_NEW,
            CODE_PRESENT,
            CODE_ABSENT,
            CODE_OFF_ROSTER,
            svc.CODE_BLOCKED,
        ],
        3,
    ) == [
        CODE_PRESENT,
        CODE_ANNUAL,
        CODE_NEW,
        CODE_SICK,
        CODE_ABSENT,
        CODE_OFF_ROSTER,
        svc.CODE_BLOCKED,
    ]


def test_main_statistics_moves_real_leave_without_filling_unused_targets(db_session, guards):
    svc.set_post_count(db_session, 2026, 7, 2)
    db_session.add(
        Leave(
            employee_id="G1001",
            leave_type="Annual Leave",
            start_date=date(2026, 7, 5),
            end_date=date(2026, 7, 9),
            days=5,
            status="Approved",
        )
    )
    db_session.commit()

    source = _row(db_session, 2026, 7, "G1001")
    target = _row(db_session, 2026, 7, "G1002")
    assert source.codes[4:9] == [CODE_ANNUAL] * 5
    assert source.stat_codes[4:9] == [CODE_PRESENT] * 5
    assert target.stat_codes[4:9] == [CODE_ANNUAL] * 5
    assert target.stat_codes[0] == CODE_PRESENT


def test_drivers_keep_existing_filler_derivation(db_session, guards):
    svc.set_post_count(db_session, 2026, 7, 0)
    svc.set_filler(db_session, 2026, 7, "G2000", CODE_SICK)
    row = _row(db_session, 2026, 7, "G2000", sheet="drivers")
    assert row.stat_codes[:31] == [CODE_SICK] * 31


def test_a_driver_filler_choice_carries_into_the_next_month(db_session, guards):
    svc.set_post_count(db_session, 2026, 7, 0)
    svc.set_filler(db_session, 2026, 7, "G2000", CODE_SICK)
    svc.set_post_count(db_session, 2026, 8, 0)
    row = _row(db_session, 2026, 8, "G2000", sheet="drivers")
    assert row.stat_codes[0] == CODE_SICK


def test_sealed_main_statistics_remain_frozen(db_session, guards):
    svc.close_month(db_session, 2026, 7)
    db_session.add(
        Leave(
            employee_id="G0999",
            leave_type="Annual Leave",
            start_date=date(2026, 7, 1),
            end_date=date(2026, 7, 1),
            days=1,
            status="Approved",
        )
    )
    db_session.commit()
    assert _row(db_session, 2026, 7, "G0999").stat_codes[0] == CODE_PRESENT


def test_roster_edges_survive_into_the_client_sheet(db_session, guards):
    employee = db_session.get(Employee, "G1002")
    employee.doj = date(2026, 7, 3)
    employee.end_date = date(2026, 7, 20)
    db_session.commit()
    row = _row(db_session, 2026, 7, "G1002")
    assert row.stat_codes[0] == CODE_NEW
    assert row.stat_codes[20] == CODE_OFF_ROSTER


def test_marking_absence_creates_a_record_on_the_employee(db_session, guards):
    svc.set_cell(db_session, 2026, 7, "G1001", 14, "AB", note="no show")
    assert db_session.query(Absence).filter_by(employee_id="G1001").count() == 1
    assert _row(db_session, 2026, 7, "G1001").codes[13] == "AB"


def test_a_day_the_month_does_not_have_is_rejected(db_session, guards):
    with pytest.raises(ValidationFailedError):
        svc.set_cell(db_session, 2026, 2, "G1001", 29, "AB")


def test_a_sick_certificate_supersedes_the_absence(db_session, guards):
    svc.set_cell(db_session, 2026, 7, "G1001", 14, "AB")
    removed = absence_service.delete_absences_covered_by(
        db_session, "G1001", date(2026, 7, 14), date(2026, 7, 14)
    )
    assert removed == [date(2026, 7, 14)]
    assert db_session.query(Absence).count() == 0


def test_an_employee_without_a_designation_blocks_the_download(db_session, guards):
    db_session.add(
        Employee(id="G9999", name_en="No Designation", nationality="الإمارات", doj=date(2020, 1, 1))
    )
    db_session.commit()
    grid = svc.build_month(db_session, 2026, 7)
    assert [i.kind for i in grid.blocking] == ["no_designation"]
    assert grid.rows[-1].employee_id == "G9999"


def test_an_unmapped_nationality_blocks_the_download(db_session, guards):
    db_session.get(Employee, "G1001").nationality = "فرنسا"
    db_session.commit()
    assert {i.kind for i in svc.build_month(db_session, 2026, 7).blocking} == {"no_nationality"}


def test_warnings_are_reported_without_blocking(db_session, guards):
    db_session.get(Employee, "G1001").name_en = "Name G1002"  # duplicate_name
    employee = db_session.get(Employee, "G0999")
    employee.end_date = date(2026, 6, 1)  # departed_but_active
    employee.status = "Active"
    db_session.add(
        Leave(
            employee_id="G1002",
            leave_type="Unknown",
            start_date=date(2026, 7, 3),
            end_date=date(2026, 7, 4),
            days=2,
            status="Approved",
        )
    )
    db_session.commit()
    grid = svc.build_month(db_session, 2026, 7)
    assert {"duplicate_name", "departed_but_active", "unknown_leave"} <= {
        i.kind for i in grid.warnings
    }
    assert grid.blocking == []


def test_closing_freezes_both_sheets(db_session, guards):
    svc.close_month(db_session, 2026, 7)
    db_session.add(
        Leave(
            employee_id="G1001",
            leave_type="Annual Leave",
            start_date=date(2026, 7, 5),
            end_date=date(2026, 7, 9),
            days=5,
            status="Approved",
        )
    )
    db_session.commit()
    grid = svc.build_month(db_session, 2026, 7)
    assert grid.closed_at is not None
    row = next(r for r in grid.rows if r.employee_id == "G1001")
    assert row.codes[4] == CODE_PRESENT  # the snapshot, not the new leave
    drivers = svc.build_month(db_session, 2026, 7, sheet="drivers")
    assert [r.employee_id for r in drivers.rows] == ["G2000"]


def test_a_closed_month_refuses_edits(db_session, guards):
    svc.close_month(db_session, 2026, 7)
    with pytest.raises(ConflictError, match="closed"):
        svc.set_cell(db_session, 2026, 7, "G1001", 3, "AB")


def test_reopening_restores_live_recomputation(db_session, guards):
    svc.close_month(db_session, 2026, 7)
    svc.reopen_month(db_session, 2026, 7)
    svc.set_cell(db_session, 2026, 7, "G1001", 3, "AB")
    assert _row(db_session, 2026, 7, "G1001").codes[2] == "AB"


def test_reorder_rewrites_ranks_and_rejects_a_partial_list(db_session):
    ids = [d.id for d in svc.list_designations(db_session)]
    svc.reorder_designations(db_session, [ids[1], ids[0], *ids[2:]])
    assert [d.rank_order for d in svc.list_designations(db_session)] == list(range(1, 17))
    assert svc.list_designations(db_session)[0].name_en == "Ass. Director"
    with pytest.raises(ValidationFailedError):
        svc.reorder_designations(db_session, ids[:5])


def test_catalog_create_and_rename_are_normalized_and_unique(db_session):
    created = svc.create_designation(db_session, " Relief Supervisor ", " مشرف بديل ", sheet="main")
    assert (created.name_en, created.name_ar, created.system_key, created.rank_order) == (
        "Relief Supervisor",
        "مشرف بديل",
        None,
        17,
    )

    svc.rename_designation(db_session, created.id, " Relief Duty Supervisor ", " مشرف مناوب بديل ")
    db_session.refresh(created)
    assert (created.name_en, created.name_ar, created.rank_order, created.sheet) == (
        "Relief Duty Supervisor",
        "مشرف مناوب بديل",
        17,
        "main",
    )
    with pytest.raises(ValidationFailedError, match="unique"):
        svc.create_designation(db_session, " security guard ", "حارس آخر", sheet="main")


def test_roster_batch_validates_every_row_before_mutating(db_session, guards):
    supervisor = (
        db_session.query(TimesheetDesignation).filter_by(name_en="Security Supervisor").one()
    )
    before = db_session.query(TimesheetRosterAssignment).count()
    with pytest.raises(NotFoundError, match="G9999"):
        svc.set_roster_assignments(
            db_session,
            2026,
            8,
            [
                TimesheetRosterAssignmentWrite(employee_id="G1001", designation_id=supervisor.id),
                TimesheetRosterAssignmentWrite(employee_id="G9999", designation_id=None),
            ],
            actor_id=7,
        )
    db_session.rollback()
    assert db_session.query(TimesheetRosterAssignment).count() == before

    svc.set_roster_assignments(
        db_session,
        2026,
        8,
        [TimesheetRosterAssignmentWrite(employee_id="G1001", designation_id=None)],
        actor_id=7,
    )
    row = (
        db_session.query(TimesheetRosterAssignment)
        .filter_by(employee_id="G1001", effective_from=date(2026, 8, 1))
        .one()
    )
    assert (row.designation_id, row.assigned_by) == (None, 7)


def test_roster_same_month_update_refreshes_audit_timestamp(db_session, guards):
    designation = db_session.query(TimesheetDesignation).filter_by(name_en="Driver").one()
    svc.set_roster_assignments(
        db_session,
        2026,
        8,
        [TimesheetRosterAssignmentWrite(employee_id="G1001", designation_id=designation.id)],
        actor_id=7,
    )
    row = (
        db_session.query(TimesheetRosterAssignment)
        .filter_by(employee_id="G1001", effective_from=date(2026, 8, 1))
        .one()
    )
    old_timestamp = datetime(2020, 1, 1)
    row.assigned_at = old_timestamp
    db_session.commit()

    svc.set_roster_assignments(
        db_session,
        2026,
        8,
        [TimesheetRosterAssignmentWrite(employee_id="G1001", designation_id=None)],
        actor_id=9,
    )
    db_session.refresh(row)
    assert row.assigned_by == 9
    assert row.assigned_at > old_timestamp


def _guard(db, employee_id, *, doj=date(2024, 1, 1), end_date=None, rank=15):
    """One roster member on the main sheet, with the dates that make the edges.

    ``id`` is the Employee primary key (``models.py:60``) — there is no
    ``employee_id`` attribute on Employee. ``nationality`` must be one of the
    fifteen Arabic values ``NATIONALITY_EN`` maps, or every test using this
    helper picks up a spurious ``no_nationality`` blocking issue.
    """
    designation = db.query(TimesheetDesignation).filter_by(rank_order=rank).one()
    db.add(
        Employee(
            id=employee_id,
            name_en=f"GUARD {employee_id}",
            name_ar="حارس",
            nationality="الإمارات",
            doj=doj,
            end_date=end_date,
            status="Resigned" if end_date else "Active",
        )
    )
    db.flush()
    _add_assignment(db, employee_id, designation.id, date(2024, 1, 1))


def test_a_joiner_is_ng_until_his_starting_point(db_session):
    _guard(db_session, "G8001", doj=date(2026, 7, 12))
    row = _row(db_session, 2026, 7, "G8001")
    assert row.codes[:11] == [CODE_NEW] * 11
    assert row.codes[11] == CODE_PRESENT
    assert row.joined_day == 12
    assert row.start_confirmed is False


def test_acknowledging_a_starting_point_changes_no_code(db_session):
    _guard(db_session, "G8002", doj=date(2026, 7, 12))
    before = _row(db_session, 2026, 7, "G8002")
    svc.acknowledge_start(db_session, 2026, 7, "G8002")
    svc.acknowledge_start(db_session, 2026, 7, "G8002")  # idempotent
    after = _row(db_session, 2026, 7, "G8002")
    assert after.start_confirmed is True
    assert after.codes == before.codes


def test_a_leaver_is_off_the_next_month_and_reported_as_removed(db_session):
    """The rule the client's invoice depends on, in both directions."""
    _guard(db_session, "G8003", end_date=date(2026, 7, 17))
    july = svc.build_month(db_session, 2026, 7)
    row = next(r for r in july.rows if r.employee_id == "G8003")
    assert row.left_day == 17
    assert row.codes[17:] == [CODE_OFF_ROSTER] * 14
    assert [r.employee_id for r in july.removed] == []

    august = svc.build_month(db_session, 2026, 8)
    assert "G8003" not in [r.employee_id for r in august.rows]
    removed = next(r for r in august.removed if r.employee_id == "G8003")
    assert (removed.last_day, removed.month) == (17, 7)


def test_removal_notice_uses_the_departure_month_assignment(db_session):
    _guard(db_session, "G8006", end_date=date(2026, 7, 17))
    _add_assignment(db_session, "G8006", None, date(2026, 8, 1))
    db_session.commit()

    august = svc.build_month(db_session, 2026, 8)

    assert [(row.employee_id, row.month) for row in august.removed] == [("G8006", 7)]


def test_the_red_block_is_accepted_manually_and_survives_the_statistics(db_session):
    _guard(db_session, "G8004")
    svc.set_post_count(db_session, 2026, 7, 249)  # G8004 lands in block 1
    for day in range(1, 23):
        svc.set_cell(db_session, 2026, 7, "G8004", day, "X")
    row = _row(db_session, 2026, 7, "G8004")
    assert row.codes[:22] == ["X"] * 22
    # block 1 forces P — but never over a day that is outside the billing window
    assert row.stat_codes[:22] == ["X"] * 22
    assert row.stat_codes[22] == CODE_PRESENT


def test_an_unknown_code_is_rejected(db_session):
    _guard(db_session, "G8005")
    with pytest.raises(ValidationFailedError):
        svc.set_cell(db_session, 2026, 7, "G8005", 3, "R")


# --- rule 1: the seed is additive, and owns the labels but not the order -----


def test_seeding_restores_a_missing_row_without_resetting_the_operator_order(db_session):
    """Re-seeding restores by stable key and leaves the existing order alone."""
    ids = [d.id for d in svc.list_designations(db_session)]
    svc.reorder_designations(db_session, [ids[-1], *ids[:-1]])
    db_session.delete(
        db_session.query(TimesheetDesignation).filter_by(system_key="prisons_director").one()
    )
    db_session.commit()

    svc.seed_designations(db_session)

    rows = svc.list_designations(db_session)
    restored = db_session.query(TimesheetDesignation).filter_by(system_key="prisons_director").one()
    assert len(rows) == 16
    assert rows[0].name_en == "Driver"
    assert restored.name_en == "Prisons Director"
    assert restored.rank_order == rows[-1].rank_order
    assert len({r.rank_order for r in rows}) == 16


def test_seeding_preserves_operator_edits_to_an_existing_key(db_session):
    row = db_session.query(TimesheetDesignation).filter_by(system_key="driver").one()
    row.name_en = "Edited Driver"
    row.name_ar = "تعديل"
    row.sheet = "main"
    row.active = False
    row.rank_order = 17
    db_session.commit()

    svc.seed_designations(db_session)

    row = db_session.query(TimesheetDesignation).filter_by(system_key="driver").one()
    assert (row.name_en, row.name_ar, row.sheet, row.active, row.rank_order) == (
        "Edited Driver",
        "تعديل",
        "main",
        False,
        17,
    )


# --- rules 3 and 4: the period upsert and the tie-break ----------------------


def test_set_post_count_updates_the_single_period_in_place(db_session, guards):
    svc.set_post_count(db_session, 2026, 7, 200)
    svc.set_post_count(db_session, 2026, 7, 210)
    assert db_session.query(TimesheetPeriod).count() == 1
    grid = svc.build_month(db_session, 2026, 7)
    assert grid.post_count == 210
    assert (grid.year, grid.month, grid.sheet) == (2026, 7, "main")


def test_a_non_numeric_id_sorts_last(db_session, guards):
    _guard(db_session, "TEMPX")
    db_session.commit()
    assert [r.employee_id for r in svc.build_month(db_session, 2026, 7).rows] == [
        "G0999",
        "G1001",
        "G1002",
        "TEMPX",
    ]


# --- rules 6 and 12: the filler lookback and the statistics keep-sets --------


def test_the_filler_lookback_takes_the_most_recent_earlier_month(db_session, guards):
    """Not "last month": the operator is allowed to skip months (rule 6).

    March, May and September are all set. Building August must read May — the
    most recent *earlier* month — not March and not September.
    """
    svc.set_filler(db_session, 2026, 3, "G2000", CODE_NATIONAL)
    svc.set_filler(db_session, 2026, 5, "G2000", CODE_SICK)
    svc.set_filler(db_session, 2026, 9, "G2000", CODE_PRESENT)
    svc.set_post_count(db_session, 2026, 8, 0)

    row = _row(db_session, 2026, 8, "G2000", sheet="drivers")
    assert row.stat_filler == CODE_SICK
    assert row.stat_codes[0] == CODE_SICK


def test_a_month_with_no_filler_anywhere_falls_back_to_annual_leave(db_session, guards):
    svc.set_post_count(db_session, 2026, 7, 2)
    grid = svc.build_month(db_session, 2026, 7)
    assert grid.rows[2].stat_filler == CODE_ANNUAL


def test_the_red_block_and_a_real_absence_survive_block_two(db_session, guards):
    """Rule 12: ``X`` is kept in BOTH keep sets, and rule 6 keeps a real ``AB``."""
    svc.set_post_count(db_session, 2026, 7, 2)
    svc.set_cell(db_session, 2026, 7, "G1002", 5, "X")
    svc.set_cell(db_session, 2026, 7, "G1002", 6, "AB")
    row = _row(db_session, 2026, 7, "G1002")
    assert row.stat_block == 2
    assert row.stat_codes[4] == "X"  # outside the billing window, never filled over
    assert row.stat_codes[5] == CODE_ABSENT  # a real absence is not filled over
    assert row.stat_codes[6] == CODE_PRESENT  # no real code above needs this P target


def test_a_filler_code_the_legend_does_not_carry_is_rejected(db_session, guards):
    with pytest.raises(ValidationFailedError) as excinfo:
        svc.set_filler(db_session, 2026, 7, "G1002", "NOPE")
    assert excinfo.value.code == "TIMESHEET_BAD_CODE"


# --- rule 7: what set_cell writes, and what it clears ------------------------


def test_a_non_absence_code_writes_an_override_and_none_clears_it(db_session, guards):
    svc.set_cell(db_session, 2026, 7, "G1001", 10, CODE_NATIONAL, note="reserve duty")
    assert db_session.query(TimesheetOverride).count() == 1
    assert db_session.query(Absence).count() == 0
    assert _row(db_session, 2026, 7, "G1001").codes[9] == CODE_NATIONAL

    svc.set_cell(db_session, 2026, 7, "G1001", 10, None)
    assert db_session.query(TimesheetOverride).count() == 0
    assert _row(db_session, 2026, 7, "G1001").codes[9] == CODE_PRESENT


def test_set_cell_writes_an_audit_row(db_session, guards):
    user = make_user(db_session, email="editor@x.ae")

    svc.set_cell(
        db_session,
        2026,
        7,
        "G1001",
        14,
        "AB",
        note="no show",
        user_id=user.id,
        actor=user.email,
    )

    rows = db_session.query(AuditLog).all()
    assert len(rows) == 1
    assert rows[0].actor == user.email
    assert rows[0].entity_type == "timesheet_cell"
    assert rows[0].entity_id == "G1001:2026-07-14"
    payload = json.loads(rows[0].payload)
    assert payload == {"from": "P", "to": "AB", "code": "AB", "note": "no show"}

    svc.set_cell(
        db_session,
        2026,
        7,
        "G1001",
        14,
        None,
        user_id=user.id,
        actor=user.email,
    )

    rows = db_session.query(AuditLog).all()
    assert len(rows) == 2
    cleared = json.loads(rows[1].payload)
    assert cleared["from"] == "AB"
    assert cleared["to"] == "P"
    assert cleared["code"] is None


def test_switching_a_cell_never_leaves_two_records_fighting(db_session, guards):
    """The cell must show what was last set, so setting one form clears the other."""
    svc.set_cell(db_session, 2026, 7, "G1001", 10, "X")
    svc.set_cell(db_session, 2026, 7, "G1001", 10, "AB", note="no show")
    assert (db_session.query(TimesheetOverride).count(), db_session.query(Absence).count()) == (
        0,
        1,
    )
    assert _row(db_session, 2026, 7, "G1001").codes[9] == CODE_ABSENT

    svc.set_cell(db_session, 2026, 7, "G1001", 10, CODE_SICK)
    assert (db_session.query(TimesheetOverride).count(), db_session.query(Absence).count()) == (
        1,
        0,
    )
    assert _row(db_session, 2026, 7, "G1001").codes[9] == CODE_SICK

    svc.set_cell(db_session, 2026, 7, "G1001", 10, CODE_SICK)  # re-setting is idempotent
    assert db_session.query(TimesheetOverride).count() == 1

    svc.set_cell(db_session, 2026, 7, "G1001", 10, None)
    assert (db_session.query(TimesheetOverride).count(), db_session.query(Absence).count()) == (
        0,
        0,
    )


def test_undoing_a_present_cell_does_not_leave_a_silent_override(db_session, guards):
    """Undoing AB on a derived P cell must restore derivation, not pin P."""
    employee_id = "G1001"
    day = 5

    svc.set_cell(db_session, 2026, 7, employee_id, day, CODE_ABSENT)
    svc.set_cell(db_session, 2026, 7, employee_id, day, CODE_PRESENT)

    assert (
        db_session.query(TimesheetOverride)
        .filter_by(year=2026, month=7, day=day, employee_id=employee_id)
        .count()
        == 0
    )
    assert _row(db_session, 2026, 7, employee_id).codes[day - 1] == CODE_PRESENT


def test_undoing_a_present_cell_restores_a_preexisting_override(db_session, guards):
    """Undoing AB must restore P when P was already an explicit override."""
    employee_id = "G1001"
    day = 5
    db_session.add(
        Leave(
            employee_id=employee_id,
            leave_type="Annual Leave",
            start_date=date(2026, 7, day),
            end_date=date(2026, 7, day),
            days=1,
            status="Approved",
        )
    )
    db_session.commit()

    svc.set_cell(db_session, 2026, 7, employee_id, day, CODE_PRESENT)
    svc.set_cell(db_session, 2026, 7, employee_id, day, CODE_ABSENT)
    svc.set_cell(db_session, 2026, 7, employee_id, day, CODE_PRESENT)

    override = (
        db_session.query(TimesheetOverride)
        .filter_by(year=2026, month=7, day=day, employee_id=employee_id)
        .one()
    )
    assert override.code == CODE_PRESENT
    assert _row(db_session, 2026, 7, employee_id).codes[day - 1] == CODE_PRESENT


def test_undoing_a_present_cell_still_tracks_a_later_leave(db_session, guards):
    """A derived cell restored by undo must react to a leave added later."""
    employee_id = "G1001"
    day = 5

    svc.set_cell(db_session, 2026, 7, employee_id, day, CODE_ABSENT)
    svc.set_cell(db_session, 2026, 7, employee_id, day, CODE_PRESENT)
    db_session.add(
        Leave(
            employee_id=employee_id,
            leave_type="Annual Leave",
            start_date=date(2026, 7, day),
            end_date=date(2026, 7, day),
            days=1,
            status="Approved",
        )
    )
    db_session.commit()

    assert _row(db_session, 2026, 7, employee_id).codes[day - 1] == CODE_ANNUAL


def test_an_edit_for_an_employee_who_does_not_exist_is_a_404(db_session, guards):
    from app.api.errors import NotFoundError

    with pytest.raises(NotFoundError):
        svc.set_cell(db_session, 2026, 7, "G0000", 3, "AB")


# --- ruling 1: an override outside the roster window is rejected -------------


def test_an_override_outside_the_roster_window_is_rejected(db_session):
    """Roster edges outrank the manual codes, so the cell may not be painted.

    The engine applies ``overrides`` last and unconditionally, so the only place
    this can be enforced is here — and it reads the same ``doj``/``end_date``
    pair ``in_roster`` does, so it cannot disagree with the ``NG``/``-`` cells.
    """
    _guard(db_session, "G8101", doj=date(2026, 7, 12), end_date=date(2026, 7, 20))
    db_session.commit()

    with pytest.raises(ValidationFailedError) as before_doj:
        svc.set_cell(db_session, 2026, 7, "G8101", 5, "X")
    assert before_doj.value.code == "TIMESHEET_OFF_ROSTER"
    assert before_doj.value.details == {"employee_id": "G8101", "day": 5}

    with pytest.raises(ValidationFailedError) as after_end:
        svc.set_cell(db_session, 2026, 7, "G8101", 25, CODE_SICK)
    assert after_end.value.code == "TIMESHEET_OFF_ROSTER"

    with pytest.raises(ValidationFailedError):  # an absence cannot render there either
        svc.set_cell(db_session, 2026, 7, "G8101", 5, "AB")

    assert (db_session.query(TimesheetOverride).count(), db_session.query(Absence).count()) == (
        0,
        0,
    )

    svc.set_cell(db_session, 2026, 7, "G8101", 15, "X")  # inside the window: accepted
    row = _row(db_session, 2026, 7, "G8101")
    assert row.codes[14] == "X"
    assert row.codes[4] == CODE_NEW
    assert row.codes[24] == CODE_OFF_ROSTER


def test_clearing_a_cell_outside_the_roster_window_is_allowed(db_session):
    """Deletion is not an override — a stale cell must always be clearable."""
    _guard(db_session, "G8102")
    db_session.commit()
    svc.set_cell(db_session, 2026, 7, "G8102", 5, "X")
    db_session.get(Employee, "G8102").doj = date(2026, 7, 12)
    db_session.commit()

    svc.set_cell(db_session, 2026, 7, "G8102", 5, None)
    assert db_session.query(TimesheetOverride).count() == 0


# --- ruling 2: no designation means the main sheet only ----------------------


def test_a_designation_less_employee_is_absent_from_the_drivers_sheet(db_session, guards):
    db_session.add(
        Employee(id="G9999", name_en="No Designation", nationality="الإمارات", doj=date(2020, 1, 1))
    )
    db_session.commit()

    main = svc.build_month(db_session, 2026, 7)
    assert main.rows[-1].employee_id == "G9999"
    assert (main.rows[-1].rank_order, main.rows[-1].designation_en) == (None, None)
    assert [i.kind for i in main.blocking] == ["no_designation"]

    drivers = svc.build_month(db_session, 2026, 7, sheet="drivers")
    assert [r.employee_id for r in drivers.rows] == ["G2000"]
    assert drivers.blocking == []


# --- rule 9: the remaining warnings, and what a void leave must not do -------


def test_a_missing_doj_and_overlapping_leave_are_warnings(db_session, guards):
    db_session.get(Employee, "G1001").doj = None
    for start, end, status, deleted in (
        (date(2026, 7, 5), date(2026, 7, 9), "Approved", None),
        (date(2026, 7, 8), date(2026, 7, 12), "Approved", None),
        (date(2026, 7, 6), date(2026, 7, 7), "Cancelled", None),  # void: not an overlap
        (date(2026, 7, 5), date(2026, 7, 9), "Approved", datetime(2026, 7, 20)),  # soft-deleted
    ):
        db_session.add(
            Leave(
                employee_id="G1002",
                leave_type="Annual Leave",
                start_date=start,
                end_date=end,
                days=5,
                status=status,
                deleted_at=deleted,
            )
        )
    db_session.commit()

    grid = svc.build_month(db_session, 2026, 7)
    kinds = {(i.employee_id, i.kind) for i in grid.warnings}
    assert ("G1001", "no_doj") in kinds
    assert ("G1002", "overlapping_leave") in kinds
    assert sum(1 for i in grid.warnings if i.kind == "overlapping_leave") == 1
    assert grid.blocking == []


def test_a_void_or_deleted_leave_never_reaches_the_sheet(db_session, guards):
    db_session.add(
        Leave(
            employee_id="G1001",
            leave_type="Annual Leave",
            start_date=date(2026, 7, 5),
            end_date=date(2026, 7, 9),
            days=5,
            status="Cancelled",
        )
    )
    db_session.add(
        Leave(
            employee_id="G1001",
            leave_type="Sick Leave",
            start_date=date(2026, 7, 15),
            end_date=date(2026, 7, 16),
            days=2,
            status="Approved",
            deleted_at=datetime(2026, 7, 20),
        )
    )
    db_session.commit()
    assert _row(db_session, 2026, 7, "G1001").codes[:31] == [CODE_PRESENT] * 31


# --- rule 14: who is reported as having dropped off -------------------------


def test_a_departure_without_a_designation_is_never_reported_as_removed(db_session):
    db_session.add(
        Employee(
            id="G8201",
            name_en="Gone",
            nationality="الإمارات",
            doj=date(2020, 1, 1),
            end_date=date(2026, 7, 17),
            status="Resigned",
        )
    )
    db_session.commit()
    august = svc.build_month(db_session, 2026, 8)
    assert august.rows == []
    assert august.removed == []


def test_a_driver_who_left_is_reported_on_the_drivers_sheet_only(db_session):
    _guard(db_session, "G8202", end_date=date(2026, 7, 17), rank=16)
    db_session.commit()
    assert [r.employee_id for r in svc.build_month(db_session, 2026, 8).removed] == []
    drivers = svc.build_month(db_session, 2026, 8, sheet="drivers")
    assert [(r.employee_id, r.last_day, r.month, r.year) for r in drivers.removed] == [
        ("G8202", 17, 7, 2026)
    ]


def test_a_december_departure_reads_right_in_january(db_session):
    _guard(db_session, "G8203", end_date=date(2025, 12, 20))
    db_session.commit()
    removed = svc.build_month(db_session, 2026, 1).removed
    assert [(r.employee_id, r.last_day, r.month, r.year) for r in removed] == [
        ("G8203", 20, 12, 2025)
    ]


# --- rules 15 and 16: the acknowledgement, and the note column --------------


def test_acknowledging_a_start_writes_no_override_and_is_month_scoped(db_session):
    _guard(db_session, "G8301", doj=date(2026, 7, 12))
    db_session.commit()
    svc.acknowledge_start(db_session, 2026, 7, "G8301")
    svc.acknowledge_start(db_session, 2026, 7, "G8301")

    assert db_session.query(TimesheetOverride).count() == 0
    assert db_session.query(Absence).count() == 0
    assert db_session.query(TimesheetStartAck).count() == 1
    assert _row(db_session, 2026, 7, "G8301").start_confirmed is True
    assert _row(db_session, 2026, 8, "G8301").start_confirmed is False


def test_absence_notes_reach_the_grid(db_session, guards):
    svc.set_cell(db_session, 2026, 7, "G1001", 14, "AB", note="no show")
    svc.set_cell(db_session, 2026, 7, "G1001", 15, "AB")
    row = _row(db_session, 2026, 7, "G1001")
    assert row.notes == {14: "no show"}
    assert row.codes[14] == CODE_ABSENT


# --- rule 8: what the seal freezes, and what it deliberately does not -------


def test_a_closed_month_recomputes_the_five_unfrozen_fields(db_session, guards):
    employee = db_session.get(Employee, "G1002")
    employee.doj = date(2026, 7, 3)
    employee.end_date = date(2026, 7, 20)
    db_session.commit()
    svc.set_post_count(db_session, 2026, 7, 2)  # G1002 is row 3 -> block 2
    svc.close_month(db_session, 2026, 7)

    # Everything below happens after the seal.
    svc.acknowledge_start(db_session, 2026, 7, "G1002")
    svc.set_filler(db_session, 2026, 7, "G1002", CODE_SICK)
    db_session.add(Absence(employee_id="G1002", date=date(2026, 7, 10), note="late"))
    db_session.commit()

    row = _row(db_session, 2026, 7, "G1002")
    assert row.start_confirmed is True  # Task 5 may ack a closed month
    assert row.stat_filler == CODE_SICK
    assert row.notes == {10: "late"}
    assert (row.joined_day, row.left_day) == (3, 20)
    # ...while the codes stay exactly as they were sealed.
    assert row.codes[9] == CODE_PRESENT
    assert row.stat_codes[2] == CODE_PRESENT  # the frozen derived code, not the new filler
    assert row.stat_codes[0] == CODE_NEW
    assert row.stat_block == 2


def test_re_closing_a_month_reproduces_the_first_seal(db_session, guards):
    """``closed_at`` is set by the first download; a later one must reproduce it."""
    svc.close_month(db_session, 2026, 7)
    sealed_at = svc.build_month(db_session, 2026, 7).closed_at
    _guard(db_session, "G7777")
    db_session.commit()

    svc.close_month(db_session, 2026, 7)

    grid = svc.build_month(db_session, 2026, 7)
    assert grid.closed_at == sealed_at
    assert "G7777" not in [r.employee_id for r in grid.rows]
    assert db_session.query(TimesheetSnapshotRow).count() == 4  # 3 main + 1 driver


def test_a_closed_month_survives_live_drift(db_session, guards):
    svc.close_month(db_session, 2026, 7)
    _add_assignment(db_session, "G1001", None, date(2026, 8, 1))
    db_session.get(Employee, "G1002").nationality = "فرنسا"
    db_session.commit()

    grid = svc.build_month(db_session, 2026, 7)
    assert grid.blocking == []  # the seal cannot be broken by later drift
    row = next(r for r in grid.rows if r.employee_id == "G1001")
    assert (row.designation_en, row.rank_order, row.designation_id) == ("Security Guard", 15, None)
    assert next(r for r in grid.rows if r.employee_id == "G1002").nationality_en == "U.A.E"


def test_a_gap_sealed_into_the_month_is_still_reported(db_session, guards):
    """The seal's preflight is the frozen row, not an empty list."""
    _add_assignment(db_session, "G1001", None, date(2026, 7, 1))
    db_session.get(Employee, "G1002").nationality = "فرنسا"
    db_session.commit()
    svc.close_month(db_session, 2026, 7)

    grid = svc.build_month(db_session, 2026, 7)
    assert {(i.employee_id, i.kind) for i in grid.blocking} == {
        ("G1001", "no_designation"),
        ("G1002", "no_nationality"),
    }


def test_the_seal_carries_the_closing_user_and_reopening_clears_it(db_session, guards):
    user = make_user(db_session, role="operator", email="op@test.ae")
    user.display_name = "Op One"
    db_session.commit()

    svc.close_month(db_session, 2026, 7, user_id=user.id)
    grid = svc.build_month(db_session, 2026, 7)
    assert grid.closed_by == "Op One"

    svc.reopen_month(db_session, 2026, 7, user_id=user.id)
    grid = svc.build_month(db_session, 2026, 7)
    assert (grid.closed_at, grid.closed_by) == (None, None)
    assert db_session.query(TimesheetSnapshotRow).count() == 0


def test_a_certificate_may_still_be_filed_against_a_closed_month(db_session, guards):
    """The absence row is the employee's record; the sheet is protected by the seal."""
    svc.set_cell(db_session, 2026, 7, "G1001", 14, "AB")
    svc.close_month(db_session, 2026, 7)

    assert absence_service.delete_absences_covered_by(
        db_session, "G1001", date(2026, 7, 1), date(2026, 7, 31)
    ) == [date(2026, 7, 14)]
    assert db_session.query(Absence).count() == 0
    assert _row(db_session, 2026, 7, "G1001").codes[13] == CODE_ABSENT  # still sealed


# --- the loads are batched, not per row -------------------------------------


def test_build_month_does_not_query_once_per_row(db_session, guards, count_queries):
    """275 rows must not become 1,100 round trips — the filler lookback included."""
    svc.set_post_count(db_session, 2026, 7, 1)  # everyone but row 1 falls into block 2
    with count_queries() as small:
        svc.build_month(db_session, 2026, 7)

    for n in range(30):
        employee_id = f"G60{n:02d}"
        _guard(db_session, employee_id)
        svc.set_filler(db_session, 2026, 6, employee_id, CODE_SICK)
    db_session.commit()

    with count_queries() as large:
        grid = svc.build_month(db_session, 2026, 7)

    assert len(grid.rows) == 33
    assert grid.rows[-1].stat_filler == CODE_SICK  # the batched lookback really ran
    assert large.count == small.count
    assert large.count <= 12


# --- fix round 1: the three writers agree, and the seal's two halves ---------


def test_an_acknowledgement_records_the_actor_when_one_is_supplied(db_session):
    """Rule 15 names ``acked_by``; the four-argument call must still work."""
    _guard(db_session, "G8401", doj=date(2026, 7, 12))
    _guard(db_session, "G8402", doj=date(2026, 7, 12))
    user = make_user(db_session, role="operator", email="ack@test.ae")

    svc.acknowledge_start(db_session, 2026, 7, "G8401", user_id=user.id)
    svc.acknowledge_start(db_session, 2026, 7, "G8402")  # the mandated signature

    acks = {a.employee_id: a for a in db_session.query(TimesheetStartAck).all()}
    assert acks["G8401"].acked_by == user.id
    assert acks["G8402"].acked_by is None
    assert acks["G8401"].acked_at is not None
    assert _row(db_session, 2026, 7, "G8401").start_confirmed is True
    assert _row(db_session, 2026, 7, "G8402").start_confirmed is True


def test_a_closed_month_refuses_a_post_count_change_but_not_a_filler(db_session, guards):
    """post_count would disagree with the frozen stat_block; the filler is display-only."""
    svc.set_post_count(db_session, 2026, 7, 2)
    svc.close_month(db_session, 2026, 7)

    with pytest.raises(ConflictError, match="closed"):
        svc.set_post_count(db_session, 2026, 7, 200)
    assert svc.build_month(db_session, 2026, 7).post_count == 2

    svc.set_filler(db_session, 2026, 7, "G1002", CODE_SICK)  # still permitted
    row = _row(db_session, 2026, 7, "G1002")
    assert row.stat_filler == CODE_SICK
    assert row.stat_codes[2] == CODE_PRESENT  # ...and the sealed codes did not move


def test_every_writer_refuses_an_employee_who_does_not_exist(db_session, guards):
    from app.api.errors import NotFoundError

    with pytest.raises(NotFoundError):
        svc.set_cell(db_session, 2026, 7, "GHOST", 3, "AB")
    with pytest.raises(NotFoundError):
        svc.set_filler(db_session, 2026, 7, "GHOST", CODE_SICK)
    with pytest.raises(NotFoundError):
        svc.acknowledge_start(db_session, 2026, 7, "GHOST")
    assert db_session.query(TimesheetStatFiller).count() == 0
    assert db_session.query(TimesheetStartAck).count() == 0


def test_a_closed_month_still_reports_live_warnings(db_session, guards):
    """Warnings are display-only, so the seal does not silence them (rule 9)."""
    svc.close_month(db_session, 2026, 7)
    assert svc.build_month(db_session, 2026, 7).warnings == []

    db_session.get(Employee, "G1001").doj = None  # no_doj, after the seal
    _add_assignment(db_session, "G1001", None, date(2026, 8, 1))  # not effective in July
    db_session.commit()

    grid = svc.build_month(db_session, 2026, 7)
    assert [(i.employee_id, i.kind) for i in grid.warnings] == [("G1001", "no_doj")]
    assert grid.blocking == []  # ...while blocking still comes from the frozen row
    assert next(r for r in grid.rows if r.employee_id == "G1001").designation_en == "Security Guard"
