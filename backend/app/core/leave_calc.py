"""Leave-balance calculator ported from `LeaveBalanceCalculator` (v3.5.4 line 1700).

Hardcoded HR rules from v3, preserved verbatim:

* **Probation** — first 6 months from join date earn no leave. Eligibility
  flips on once `today >= join_date + 6 months`.
* **Annual accrual** — 2.5 days per completed month after probation, capped at
  30 days per year.
* **Carry-over** — up to 15 days of unused annual leave roll into the new
  calendar year. Total available (carry-over + current-year accrual) is
  capped at 45.
* **Sick** — 90 days per *anniversary* year (Jan-Dec is *not* used for sick;
  the window resets on `join_date.month/day` each year).

Public contract:

    LeaveBalance(history: LeaveHistory)
        .compute(employee_id, join_date, *, as_of=None) -> BalanceResult

`LeaveHistory` is a Protocol with two methods; Phase 02 wires a SQLAlchemy-
backed implementation, but tests can plug in any object that satisfies the
shape.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Final, Protocol

from dateutil.relativedelta import relativedelta

from app.core.dateutils import excel_date_to_datetime

# --- HR rule constants (mirror v3 hard-coded values) ----------------------

PROBATION_MONTHS: Final[int] = 6
ANNUAL_ACCRUAL_PER_MONTH: Final[float] = 2.5
ANNUAL_CAP_PER_YEAR: Final[int] = 30
CARRY_OVER_CAP: Final[int] = 15
TOTAL_AVAILABLE_CAP: Final[int] = 45
SICK_DAYS_PER_YEAR: Final[int] = 90


class LeaveHistory(Protocol):
    """Read-only view of an employee's leave-day usage.

    Phase 02 implements this against the SQLAlchemy leave_history table.
    Tests can pass any object that satisfies these two signatures.

    `leave_type` is matched against v3's stored values ("Annual", "Sick", ...).
    """

    def get_employee_leaves_in_year(
        self, g_number: str, year: int, leave_type: str
    ) -> float:
        """Total days of `leave_type` taken in `year` (calendar year)."""

    def get_employee_leaves_in_period(
        self,
        g_number: str,
        start: datetime,
        end: datetime,
        leave_type: str,
    ) -> float:
        """Total days of `leave_type` taken between `start` and `end` (inclusive)."""


@dataclass(frozen=True, slots=True)
class BalanceResult:
    """Outcome of a balance computation. Matches v3's return-dict shape so
    the API serializer doesn't need a translation step.

    Phase 06 adds ``annual_accrued`` and ``carry_over`` so the API can expose
    all breakdown fields without recomputing them in the service layer.
    """

    annual: float
    annual_taken: float
    sick_remaining: float
    sick_taken: float
    eligible: bool
    message: str
    # Breakdown fields added in Phase 06 (default 0 for backward compat).
    annual_accrued: float = 0.0
    carry_over: float = 0.0


# Sentinel messages — kept as constants so callers can match exactly if they
# want, and translation tables stay in one place. Bilingual format mirrors v3.
_MSG_INVALID_JOIN: Final[str] = "Invalid join date\nتاريخ الالتحاق غير صالح"  # noqa: RUF001
_MSG_ELIGIBLE: Final[str] = "Eligible مؤهل"


def _probation_message(days_remaining: int) -> str:
    return (
        f"Probation - {days_remaining} days left\n"
        f"تجربة - {days_remaining} يوم متبقي"
    )


class LeaveBalance:
    """Computes annual + sick balances for an employee at a point in time."""

    def __init__(self, history: LeaveHistory) -> None:
        self.history = history

    def compute(
        self,
        employee_id: str,
        join_date: datetime | str | float | int | None,
        *,
        as_of: datetime | None = None,
    ) -> BalanceResult:
        """Compute balances for `employee_id` as of `as_of` (defaults to now)."""
        today = as_of or datetime.now()
        join_dt = _coerce_join_date(join_date)

        if join_dt is None:
            return BalanceResult(
                annual=0,
                annual_taken=0,
                sick_remaining=SICK_DAYS_PER_YEAR,
                sick_taken=0,
                eligible=False,
                message=_MSG_INVALID_JOIN,
            )

        probation_end = join_dt + relativedelta(months=PROBATION_MONTHS)
        if today < probation_end:
            return BalanceResult(
                annual=0,
                annual_taken=0,
                sick_remaining=SICK_DAYS_PER_YEAR,
                sick_taken=0,
                eligible=False,
                message=_probation_message((probation_end - today).days),
            )

        annual_balance, annual_taken, annual_accrued, carry_over = self._annual(
            employee_id, today, probation_end
        )
        sick_remaining, sick_taken = self._sick(employee_id, today, join_dt)

        return BalanceResult(
            annual=round(annual_balance, 1),
            annual_taken=annual_taken,
            sick_remaining=sick_remaining,
            sick_taken=sick_taken,
            eligible=True,
            message=_MSG_ELIGIBLE,
            annual_accrued=round(annual_accrued, 1),
            carry_over=round(carry_over, 1),
        )

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _annual(
        self,
        employee_id: str,
        today: datetime,
        probation_end: datetime,
    ) -> tuple[float, float, float, float]:
        """Annual balance, taken-this-year days, current_earned, carry_over."""
        current_year = today.year
        prev_year = current_year - 1

        if probation_end.year < current_year:
            if probation_end.year == prev_year:
                months_in_prev_year = 12 - probation_end.month + 1
            else:
                months_in_prev_year = 12
            prev_earned = min(
                months_in_prev_year * ANNUAL_ACCRUAL_PER_MONTH, ANNUAL_CAP_PER_YEAR
            )
            prev_taken = self.history.get_employee_leaves_in_year(
                employee_id, prev_year, "Annual"
            )
            carry_over = min(max(0.0, prev_earned - prev_taken), CARRY_OVER_CAP)
        else:
            carry_over = 0.0

        if probation_end.year == current_year:
            months_earning = today.month - probation_end.month + 1
        else:
            months_earning = today.month

        current_earned = min(
            months_earning * ANNUAL_ACCRUAL_PER_MONTH, ANNUAL_CAP_PER_YEAR
        )
        total_available = min(carry_over + current_earned, TOTAL_AVAILABLE_CAP)
        taken = self.history.get_employee_leaves_in_year(
            employee_id, current_year, "Annual"
        )
        balance = max(0.0, total_available - taken)
        return balance, taken, current_earned, carry_over

    def _sick(
        self,
        employee_id: str,
        today: datetime,
        join_dt: datetime,
    ) -> tuple[float, float]:
        """Sick balance reset on each work-anniversary, not calendar year."""
        current_year = today.year
        try:
            anniversary = datetime(current_year, join_dt.month, join_dt.day)
        except ValueError:
            # Feb 29 join date in a non-leap year — fall back to Feb 28.
            anniversary = datetime(current_year, join_dt.month, 28)

        if today >= anniversary:
            period_start = anniversary
        else:
            try:
                period_start = datetime(current_year - 1, join_dt.month, join_dt.day)
            except ValueError:
                period_start = datetime(current_year - 1, join_dt.month, 28)

        period_end = period_start + relativedelta(years=1) - timedelta(days=1)

        taken = self.history.get_employee_leaves_in_period(
            employee_id, period_start, period_end, "Sick"
        )
        remaining = max(0.0, SICK_DAYS_PER_YEAR - taken)
        return remaining, taken


def _coerce_join_date(value: datetime | str | float | int | None) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    return excel_date_to_datetime(value)
