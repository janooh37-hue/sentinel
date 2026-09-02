"""absence_service — employee-facing record writes for day-level absences.

Absence is a plain employee record (one ``absences`` row per day); the time
sheet only reads it. These tests pin the record-side contract: range add with
duplicate/off-roster handling, newest-first listing, scoped delete, and the
sick-leave supersede returning the dates it removed so the generation flow can
announce the overwrite.
"""

from datetime import date

import pytest

from app.api.errors import NotFoundError, ValidationFailedError
from app.db.models import Absence, Employee, Leave
from app.services import absence_service


def _emp(
    db,
    eid: str = "G1001",
    *,
    doj: date | None = date(2020, 1, 1),
    end_date: date | None = None,
) -> Employee:
    e = Employee(id=eid, name_en=f"Name {eid}", name_ar="اختبار", doj=doj, end_date=end_date)
    db.add(e)
    db.commit()
    return e


def _dates(rows) -> list[date]:
    return [row.date for row in rows]


@pytest.mark.parametrize(
    ("leave_type", "expected"),
    [
        ("Sick Leave - الإجازة المرضية", True),
        ("Annual Leave", True),
        ("Leave Permit", True),
        ("Administrative Leave", True),
        ("Unknown", True),
        ("Passport Release", False),
        ("Duty Resumption", False),
        ("Duty Leave", False),
    ],
)
def test_supersedes_absence_matrix(leave_type, expected):
    assert absence_service.supersedes_absence(leave_type) is expected


def test_add_range_creates_one_row_per_day_inclusive(db_session):
    _emp(db_session)
    result = absence_service.add_range(
        db_session, "G1001", start=date(2026, 7, 9), end=date(2026, 7, 11)
    )
    assert _dates(result.created) == [date(2026, 7, 9), date(2026, 7, 10), date(2026, 7, 11)]
    assert result.skipped_off_roster == []
    assert db_session.query(Absence).count() == 3


def test_add_range_stores_note_and_creator(db_session):
    _emp(db_session)
    result = absence_service.add_range(
        db_session,
        "G1001",
        start=date(2026, 7, 9),
        end=date(2026, 7, 9),
        note="no-show, no call",
        user_id=7,
    )
    row = result.created[0]
    assert row.note == "no-show, no call"
    assert row.created_by == 7


def test_add_range_skips_days_already_marked(db_session):
    _emp(db_session)
    db_session.add(Absence(employee_id="G1001", date=date(2026, 7, 10), note="earlier"))
    db_session.commit()

    result = absence_service.add_range(
        db_session, "G1001", start=date(2026, 7, 9), end=date(2026, 7, 11)
    )

    # A repeat mark is not an error and not a duplicate row: only the two new
    # days are reported, and the earlier row keeps its own note.
    assert _dates(result.created) == [date(2026, 7, 9), date(2026, 7, 11)]
    assert db_session.query(Absence).count() == 3
    kept = db_session.query(Absence).filter(Absence.date == date(2026, 7, 10)).one()
    assert kept.note == "earlier"


def test_add_range_skips_and_reports_days_inside_a_superseding_leave(db_session):
    _emp(db_session)
    db_session.add(
        Leave(
            employee_id="G1001",
            leave_type="Sick Leave",
            start_date=date(2026, 7, 10),
            end_date=date(2026, 7, 10),
            days=1,
            status="Approved",
        )
    )
    db_session.commit()

    result = absence_service.add_range(
        db_session, "G1001", start=date(2026, 7, 9), end=date(2026, 7, 11)
    )

    assert _dates(result.created) == [date(2026, 7, 9), date(2026, 7, 11)]
    assert result.skipped_on_leave == [date(2026, 7, 10)]
    assert result.skipped_off_roster == []


def test_add_range_ignores_non_superseding_and_void_leaves(db_session):
    _emp(db_session)
    db_session.add_all(
        [
            Leave(
                employee_id="G1001",
                leave_type="Passport Release",
                start_date=date(2026, 7, 10),
                end_date=date(2026, 7, 10),
                days=1,
                status="Approved",
            ),
            Leave(
                employee_id="G1001",
                leave_type="Sick Leave",
                start_date=date(2026, 7, 11),
                end_date=date(2026, 7, 11),
                days=1,
                status="Cancelled",
            ),
        ]
    )
    db_session.commit()

    result = absence_service.add_range(
        db_session, "G1001", start=date(2026, 7, 9), end=date(2026, 7, 11)
    )

    assert _dates(result.created) == [date(2026, 7, 9), date(2026, 7, 10), date(2026, 7, 11)]
    assert result.skipped_on_leave == []


def test_add_range_skips_and_reports_days_before_joining(db_session):
    _emp(db_session, doj=date(2026, 7, 10))
    result = absence_service.add_range(
        db_session, "G1001", start=date(2026, 7, 8), end=date(2026, 7, 11)
    )
    assert _dates(result.created) == [date(2026, 7, 10), date(2026, 7, 11)]
    assert result.skipped_off_roster == [date(2026, 7, 8), date(2026, 7, 9)]


def test_add_range_reports_days_after_departure(db_session):
    _emp(db_session, end_date=date(2026, 7, 10))
    result = absence_service.add_range(
        db_session, "G1001", start=date(2026, 7, 9), end=date(2026, 7, 12)
    )
    assert _dates(result.created) == [date(2026, 7, 9), date(2026, 7, 10)]
    assert result.skipped_off_roster == [date(2026, 7, 11), date(2026, 7, 12)]


def test_add_range_rejects_an_inverted_range(db_session):
    _emp(db_session)
    with pytest.raises(ValidationFailedError):
        absence_service.add_range(
            db_session, "G1001", start=date(2026, 7, 11), end=date(2026, 7, 9)
        )


def test_add_range_unknown_employee(db_session):
    with pytest.raises(NotFoundError):
        absence_service.add_range(db_session, "G9999", start=date(2026, 7, 9), end=date(2026, 7, 9))


def test_replace_episode_redraws_the_row_in_one_unit(db_session):
    _emp(db_session)
    absence_service.add_range(
        db_session,
        "G1001",
        start=date(2026, 7, 9),
        end=date(2026, 7, 11),
        note="a",
    )

    absence_service.replace_episode(
        db_session,
        "G1001",
        old_start=date(2026, 7, 9),
        old_end=date(2026, 7, 11),
        start=date(2026, 7, 10),
        end=date(2026, 7, 12),
        note="b",
        user_id=17,
    )

    rows = db_session.query(Absence).order_by(Absence.date).all()
    assert _dates(rows) == [date(2026, 7, 10), date(2026, 7, 11), date(2026, 7, 12)]
    assert [row.note for row in rows] == ["b", "b", "b"]
    assert [row.created_by for row in rows] == [17, 17, 17]


def test_replace_episode_rejects_an_inverted_new_range(db_session):
    _emp(db_session)
    absence_service.add_range(
        db_session,
        "G1001",
        start=date(2026, 7, 9),
        end=date(2026, 7, 11),
        note="a",
    )

    with pytest.raises(ValidationFailedError) as error:
        absence_service.replace_episode(
            db_session,
            "G1001",
            old_start=date(2026, 7, 9),
            old_end=date(2026, 7, 11),
            start=date(2026, 7, 12),
            end=date(2026, 7, 10),
            note="b",
            user_id=17,
        )

    assert error.value.code == "ABSENCE_RANGE_INVERTED"
    rows = db_session.query(Absence).order_by(Absence.date).all()
    assert _dates(rows) == [date(2026, 7, 9), date(2026, 7, 10), date(2026, 7, 11)]
    assert [row.note for row in rows] == ["a", "a", "a"]


def test_list_for_employee_is_newest_first(db_session):
    _emp(db_session)
    absence_service.add_range(db_session, "G1001", start=date(2026, 7, 9), end=date(2026, 7, 11))
    absence_service.add_range(db_session, "G1001", start=date(2026, 6, 1), end=date(2026, 6, 1))

    rows = absence_service.list_for_employee(db_session, "G1001")

    assert _dates(rows) == [
        date(2026, 7, 11),
        date(2026, 7, 10),
        date(2026, 7, 9),
        date(2026, 6, 1),
    ]


def test_list_for_employee_unknown_employee(db_session):
    with pytest.raises(NotFoundError):
        absence_service.list_for_employee(db_session, "G9999")


def test_delete_range_removes_the_whole_run(db_session):
    _emp(db_session)
    absence_service.add_range(db_session, "G1001", start=date(2026, 7, 9), end=date(2026, 7, 11))

    removed = absence_service.delete_range(db_session, "G1001", date(2026, 7, 9), date(2026, 7, 11))

    assert removed == 3
    assert db_session.query(Absence).count() == 0


def test_delete_range_only_touches_its_window(db_session):
    _emp(db_session)
    absence_service.add_range(db_session, "G1001", start=date(2026, 7, 1), end=date(2026, 7, 10))

    absence_service.delete_range(db_session, "G1001", date(2026, 7, 3), date(2026, 7, 7))

    dates = _dates(db_session.query(Absence).all())
    assert dates == [
        date(2026, 7, 1),
        date(2026, 7, 2),
        date(2026, 7, 8),
        date(2026, 7, 9),
        date(2026, 7, 10),
    ]


def test_delete_range_is_scoped_to_the_employee(db_session):
    _emp(db_session)
    _emp(db_session, "G1002")
    absence_service.add_range(db_session, "G1001", start=date(2026, 7, 9), end=date(2026, 7, 9))

    absence_service.delete_range(db_session, "G1002", date(2026, 7, 9), date(2026, 7, 9))

    assert db_session.query(Absence).count() == 1


def test_delete_range_rejects_an_inverted_range(db_session):
    _emp(db_session)
    with pytest.raises(ValidationFailedError):
        absence_service.delete_range(db_session, "G1001", date(2026, 7, 9), date(2026, 7, 8))


def test_list_episodes_merges_touching_days_into_one_row(db_session):
    """Adding a day that extends a run updates that row's end — the register
    shows one row per contiguous run, not one row per day."""
    _emp(db_session)
    absence_service.add_range(db_session, "G1001", start=date(2026, 7, 9), end=date(2026, 7, 10))
    absence_service.add_range(db_session, "G1001", start=date(2026, 7, 11), end=date(2026, 7, 11))

    episodes = absence_service.list_episodes(db_session, "G1001")

    assert len(episodes) == 1
    assert episodes[0].start == date(2026, 7, 9)
    assert episodes[0].end == date(2026, 7, 11)
    assert episodes[0].day_count == 3


def test_list_episodes_splits_on_any_gap_including_one_day(db_session):
    """A single day between runs — a sick-leave day, a rest day — starts a new row."""
    _emp(db_session)
    absence_service.add_range(db_session, "G1001", start=date(2026, 7, 9), end=date(2026, 7, 10))
    absence_service.add_range(db_session, "G1001", start=date(2026, 7, 12), end=date(2026, 7, 12))

    episodes = absence_service.list_episodes(db_session, "G1001")

    assert [(e.start, e.end, e.day_count) for e in episodes] == [
        (date(2026, 7, 9), date(2026, 7, 10), 2),
        (date(2026, 7, 12), date(2026, 7, 12), 1),
    ]


def test_list_episodes_joins_distinct_notes_in_day_order(db_session):
    _emp(db_session)
    db_session.add(Absence(employee_id="G1001", date=date(2026, 7, 9), note="no call"))
    db_session.add(Absence(employee_id="G1001", date=date(2026, 7, 10), note=None))
    db_session.add(Absence(employee_id="G1001", date=date(2026, 7, 11), note="no call"))
    db_session.commit()

    episodes = absence_service.list_episodes(db_session, "G1001")

    assert episodes[0].notes == "no call"


def test_list_episodes_unknown_employee(db_session):
    with pytest.raises(NotFoundError):
        absence_service.list_episodes(db_session, "G9999")


def test_supersede_returns_the_dates_it_removed(db_session):
    """The sick-leave overwrite announces itself: the caller needs the dates,
    not just a count, to say 'absence from X to Y is overwritten'."""
    _emp(db_session)
    absence_service.add_range(db_session, "G1001", start=date(2026, 7, 8), end=date(2026, 7, 11))

    removed = absence_service.delete_absences_covered_by(
        db_session, "G1001", date(2026, 7, 9), date(2026, 7, 10)
    )

    assert removed == [date(2026, 7, 9), date(2026, 7, 10)]
    assert _dates(db_session.query(Absence).all()) == [date(2026, 7, 8), date(2026, 7, 11)]


# --------------------------------------------------------------------------- #
# Employee detail surfacing
# --------------------------------------------------------------------------- #


def test_employee_detail_surfaces_absences(db_session):
    """The record page reads absences from the detail aggregate: a stat, the
    recent list, and the activity timeline — same as leaves and violations."""
    from app.services import employee_detail_service

    _emp(db_session, doj=None)
    year = date.today().year
    absence_service.add_range(db_session, "G1001", start=date(year, 7, 9), end=date(year, 7, 10))

    detail = employee_detail_service.get_employee_detail(db_session, "G1001")

    assert detail is not None
    assert detail.stats.absence_days == 2
    assert _dates(detail.recent_absences) == [date(year, 7, 10), date(year, 7, 9)]
    absence_events = [item for item in detail.recent_activity if item.kind == "absence"]
    assert len(absence_events) == 2


def test_employee_detail_absence_stat_counts_the_current_year_only(db_session):
    from app.services import employee_detail_service

    _emp(db_session, doj=None)
    year = date.today().year
    absence_service.add_range(db_session, "G1001", start=date(year, 3, 1), end=date(year, 3, 2))
    absence_service.add_range(
        db_session, "G1001", start=date(year - 1, 3, 1), end=date(year - 1, 3, 1)
    )

    detail = employee_detail_service.get_employee_detail(db_session, "G1001")

    assert detail is not None
    assert detail.stats.absence_days == 2
    assert len(detail.recent_absences) == 3
