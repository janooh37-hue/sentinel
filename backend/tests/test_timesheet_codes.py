"""Day-code rules for the monthly time sheet.

Every case here is taken from the June/July 2026 workbooks the sheet must
reproduce, so the numbers are real: G3006's three overlapping annual-leave rows,
G3105's departure on the 9th, G5524 joining on the 2nd.
"""

from datetime import date

from app.core.timesheet_codes import (
    CODE_ABSENT,
    CODE_ANNUAL,
    CODE_NATIONAL,
    CODE_NEW,
    CODE_OFF_ROSTER,
    CODE_PRESENT,
    CODE_SICK,
    LeaveSpan,
    in_roster,
    leave_code,
    month_codes,
)


class TestMonthShape:
    def test_a_quiet_month_is_all_present(self):
        codes = month_codes(2026, 7)
        assert codes[:31] == [CODE_PRESENT] * 31

    def test_day_31_is_blank_in_a_30_day_month(self):
        # June has exactly one blank per row, in column AJ.
        codes = month_codes(2026, 6)
        assert codes[29] == CODE_PRESENT
        assert codes[30] is None

    def test_february_leaves_three_days_blank(self):
        codes = month_codes(2026, 2)
        assert codes[27] == CODE_PRESENT
        assert codes[28:] == [None, None, None]


class TestLeaveUnion:
    def test_overlapping_annual_rows_do_not_double_count(self):
        """G3006: three overlapping rows summing to 64 days inside a 31-day July."""
        codes = month_codes(
            2026,
            7,
            leaves=[
                LeaveSpan("Unknown", date(2026, 7, 6), date(2026, 7, 17), "Generated"),
                LeaveSpan("Annual Leave - الإجازة السنوية", date(2026, 7, 6), date(2026, 7, 31)),
                LeaveSpan("Annual Leave - الإجازة السنوية", date(2026, 7, 6), date(2026, 8, 4)),
            ],
        )
        assert codes.count(CODE_ANNUAL) == 26
        assert codes[:5] == [CODE_PRESENT] * 5

    def test_a_leave_is_clipped_to_the_month(self):
        codes = month_codes(
            2026,
            7,
            leaves=[LeaveSpan("Annual Leave", date(2026, 6, 20), date(2026, 7, 3))],
        )
        assert codes[:3] == [CODE_ANNUAL] * 3
        assert codes[3] == CODE_PRESENT


class TestPrecedence:
    def test_sick_outranks_annual_on_the_same_day(self):
        codes = month_codes(
            2026,
            7,
            leaves=[
                LeaveSpan("Annual Leave", date(2026, 7, 10), date(2026, 7, 10)),
                LeaveSpan("Sick Leave", date(2026, 7, 10), date(2026, 7, 10)),
            ],
        )
        assert codes[9] == CODE_SICK

    def test_absence_outranks_sick(self):
        codes = month_codes(
            2026,
            7,
            leaves=[LeaveSpan("Sick Leave", date(2026, 7, 4), date(2026, 7, 4))],
            absences=[date(2026, 7, 4)],
        )
        assert codes[3] == CODE_ABSENT

    def test_off_roster_outranks_a_leave_reaching_past_the_last_working_day(self):
        codes = month_codes(
            2026,
            7,
            end_date=date(2026, 7, 9),
            leaves=[LeaveSpan("Annual Leave", date(2026, 7, 1), date(2026, 7, 31))],
        )
        assert codes[8] == CODE_ANNUAL
        assert codes[9] == CODE_OFF_ROSTER

    def test_an_override_beats_every_rule(self):
        codes = month_codes(
            2026,
            7,
            end_date=date(2026, 7, 9),
            leaves=[LeaveSpan("Sick Leave", date(2026, 7, 20), date(2026, 7, 20))],
            absences=[date(2026, 7, 20)],
            overrides={20: CODE_NATIONAL},
        )
        assert codes[19] == CODE_NATIONAL

    def test_an_absence_outside_the_month_is_ignored(self):
        codes = month_codes(2026, 7, absences=[date(2026, 6, 4)])
        assert CODE_ABSENT not in codes


class TestRosterEdges:
    def test_days_before_joining_are_new_guard(self):
        """G5524 joined on 2 June: NG on the 1st only."""
        codes = month_codes(2026, 6, doj=date(2026, 6, 2))
        assert codes[0] == CODE_NEW
        assert codes[1] == CODE_PRESENT

    def test_the_end_date_is_the_last_working_day(self):
        """G3105 resigned 9 July: nine present days, then 22 off-roster."""
        codes = month_codes(2026, 7, end_date=date(2026, 7, 9))
        assert codes.count(CODE_PRESENT) == 9
        assert codes.count(CODE_OFF_ROSTER) == 22
        assert codes[8] == CODE_PRESENT

    def test_a_departure_after_the_month_leaves_no_marks(self):
        codes = month_codes(2026, 7, end_date=date(2026, 8, 9))
        assert CODE_OFF_ROSTER not in codes


class TestLeaveKinds:
    def test_paid_short_kinds_leave_the_employee_present(self):
        """Verified against the July sheet: these never change a cell."""
        for leave_type in (
            "Administrative Leave",
            "Leave Permit",
            "Duty Leave - الاستئذان",
            "Duty Resumption",
            "Passport Release تسليم جواز",
        ):
            codes = month_codes(
                2026,
                7,
                leaves=[LeaveSpan(leave_type, date(2026, 7, 8), date(2026, 7, 8))],
            )
            assert codes[7] == CODE_PRESENT, leave_type

    def test_void_statuses_never_reach_the_sheet(self):
        for status in ("Cancelled", "Rejected", "Cancelled - ملغى"):
            codes = month_codes(
                2026,
                7,
                leaves=[LeaveSpan("Sick Leave", date(2026, 7, 8), date(2026, 7, 8), status)],
            )
            assert codes[7] == CODE_PRESENT, status

    def test_bilingual_types_resolve(self):
        codes = month_codes(
            2026,
            7,
            leaves=[LeaveSpan("Sick Leave - الإجازة المرضية", date(2026, 7, 2), date(2026, 7, 2))],
        )
        assert codes[1] == CODE_SICK

    def test_an_untyped_leave_counts_as_annual(self):
        """Rows born from form generation sometimes lost their type."""
        assert leave_code("Unknown") == CODE_ANNUAL

    def test_national_service_maps_to_tr(self):
        assert leave_code("National Service - الخدمة الوطنية") == CODE_NATIONAL

    def test_sick_code_keeps_its_trailing_space(self):
        """The workbook totals sick days with COUNTIF(F:AJ,$AO$5) and AO5 is "SL ".

        Dropping the space silently zeroes the client's sick-leave column.
        """
        assert CODE_SICK == "SL "


class TestInRoster:
    MONTH = (date(2026, 7, 1), date(2026, 7, 31))

    def test_a_permanent_employee_is_in(self):
        assert in_roster(
            doj=date(2020, 1, 1), end_date=None, month_start=self.MONTH[0], month_end=self.MONTH[1]
        )

    def test_someone_who_left_during_the_month_stays_on_the_sheet(self):
        assert in_roster(
            doj=date(2024, 8, 13),
            end_date=date(2026, 7, 9),
            month_start=self.MONTH[0],
            month_end=self.MONTH[1],
        )

    def test_someone_who_left_before_the_month_is_dropped(self):
        assert not in_roster(
            doj=date(2024, 8, 13),
            end_date=date(2026, 6, 30),
            month_start=self.MONTH[0],
            month_end=self.MONTH[1],
        )

    def test_someone_joining_after_the_month_is_not_yet_listed(self):
        assert not in_roster(
            doj=date(2026, 8, 3), end_date=None, month_start=self.MONTH[0], month_end=self.MONTH[1]
        )

    def test_joining_on_the_last_day_still_counts(self):
        assert in_roster(
            doj=date(2026, 7, 31), end_date=None, month_start=self.MONTH[0], month_end=self.MONTH[1]
        )
