"""Learn each person's punch habit, and use it to read ambiguous punches.

The terminals report ``punch_state 255`` for every event, so nothing in a punch
says whether it is an arrival or a departure. Two facts recover the meaning:

* Punches pair up. A person's punches, in order, form duties: two punches
  separated by a plausible duty length are an arrival and a departure. Pairing by
  gap rather than by calendar day is what makes a night shift readable, since its
  departure falls on the following date.
* Shift starts are fixed. Each pair is anchored to the shift definition whose
  local start sits nearest the arrival, so a habit can be learned without any
  roster history - which matters here, because the roster was installed in
  August while the punch record reaches back to February.

What comes out is, per employee and shift, how early that person habitually
arrives and how late they habitually leave. Attribution then widens to cover
their own habit instead of one global constant, and a lone punch in a closed
window can be read as an arrival or a departure instead of neither.

Nothing here decides lateness. That remains the scheduled start plus grace.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.db.workforce_models import (
    AttendanceCase,
    AttendanceProviderPerson,
    AttendancePunch,
    AttendancePunchProfile,
    WorkAttendancePolicy,
    WorkShiftDefinition,
)
from app.services.workforce_seed_service import SITE_TIMEZONE

#: A duty is at least this long and at most this long. Anything closer together
#: is one arrival recorded twice at the gate; anything further apart is two
#: separate duties with punches missing between them.
MIN_DUTY_GAP = timedelta(hours=4)
MAX_DUTY_GAP = timedelta(hours=16)

#: A habit is only worth trusting once it has repeated. Below this, the policy
#: window stands unchanged - the same behaviour as before any learning existed.
MIN_SAMPLE_DAYS = 5

#: Rolling learning window. Long enough to survive leave and rotation, short
#: enough that a transfer to another post is reflected within weeks.
DEFAULT_WINDOW_DAYS = 90

#: The approved cap: attribution never reaches more than three hours before a
#: shift starts, and never past the end of that person's previous case.
MAX_WIDEN_MINUTES = 180

#: Margin around a learned arrival, so a habit of 04:40 still catches 04:31.
WIDEN_MARGIN_MINUTES = 15

#: A learned habit only re-anchors a punch when it is clearly nearer one edge of
#: the duty than the other; inside this band the punch stays uninterpreted.
DIRECTION_MARGIN_MINUTES = 45

#: A habit "fits" a shift when its arrival sits within this of that shift's
#: start. Outside it on every defined shift, the pattern belongs to no shift the
#: site has defined, which is a scheduling gap rather than a rostering error.
ANCHOR_FIT_MINUTES = 45

_ZONE = ZoneInfo(SITE_TIMEZONE)
_DAY_MINUTES = 24 * 60


@dataclass(frozen=True, slots=True)
class ProfileRebuildResult:
    """What one rebuild learned, and where the roster disagrees with the record."""

    profiles: int
    employees: int
    pairs: int
    mismatches: tuple[tuple[str, str, str], ...]


def _naive_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value
    return value.astimezone(UTC).replace(tzinfo=None)


def _local_minutes(moment: datetime) -> int:
    """Minutes past local midnight, at the site, for a naive UTC instant."""
    local = moment.replace(tzinfo=UTC).astimezone(_ZONE)
    return local.hour * 60 + local.minute


def _signed_offset(actual_minutes: int, anchor_minutes: int) -> int:
    """Shortest signed distance between two times of day, in minutes."""
    delta = (actual_minutes - anchor_minutes) % _DAY_MINUTES
    if delta > _DAY_MINUTES // 2:
        delta -= _DAY_MINUTES
    return delta


def _percentile(values: Sequence[int], fraction: float) -> int:
    ordered = sorted(values)
    index = round(fraction * (len(ordered) - 1))
    return ordered[max(0, min(len(ordered) - 1, index))]


def _pairs(moments: Sequence[datetime]) -> list[tuple[datetime, datetime]]:
    """Read a person's punch stream as duties: an arrival, then its departure."""
    paired: list[tuple[datetime, datetime]] = []
    index = 0
    while index + 1 < len(moments):
        gap = moments[index + 1] - moments[index]
        if MIN_DUTY_GAP <= gap <= MAX_DUTY_GAP:
            paired.append((moments[index], moments[index + 1]))
            index += 2
            continue
        index += 1
    return paired


@dataclass(frozen=True, slots=True)
class _Shift:
    code: str
    start_minutes: int
    end_minutes: int


def _shifts(db: Session) -> list[_Shift]:
    rows = db.scalars(select(WorkShiftDefinition)).all()
    shifts: list[_Shift] = []
    for row in rows:
        start = row.start_local_time.hour * 60 + row.start_local_time.minute
        shifts.append(
            _Shift(
                code=row.code,
                start_minutes=start,
                end_minutes=(start + row.duration_minutes) % _DAY_MINUTES,
            )
        )
    return shifts


def _anchor(
    shifts: Iterable[_Shift], arrival_minutes: int, *, prefer: frozenset[str] = frozenset()
) -> _Shift | None:
    """The shift this arrival belongs to, preferring ones the person is rostered on.

    Nearest-start alone mislabels a duty that falls between two definitions: a
    crew arriving 05:52 and leaving 14:00 is 54 minutes after the 05:00 start and
    68 minutes before the 07:00 one, so the nearer start wins by twelve minutes
    and the habit lands under a shift the person has never worked. Restricting
    the candidates to shifts the roster actually assigns keeps the habit filed
    where it will be read, and leaves the odd offset visible instead of hiding it
    behind a confident wrong label.
    """
    candidates = [shift for shift in shifts if shift.code in prefer] or list(shifts)
    best: _Shift | None = None
    best_distance = _DAY_MINUTES
    for shift in candidates:
        distance = abs(_signed_offset(arrival_minutes, shift.start_minutes))
        if distance < best_distance:
            best, best_distance = shift, distance
    return best


def rebuild_profiles(
    db: Session, *, now: datetime, window_days: int = DEFAULT_WINDOW_DAYS
) -> ProfileRebuildResult:
    """Relearn every habit from the stored punch record.

    Whole-table replacement on purpose: a profile is a derived summary of a
    rolling window, so a row that no longer has evidence behind it must not
    linger and keep widening a window.
    """
    if window_days <= 0:
        raise ValueError("window_days must be positive")
    shifts = _shifts(db)
    if not shifts:
        return ProfileRebuildResult(profiles=0, employees=0, pairs=0, mismatches=())

    since = _naive_utc(now) - timedelta(days=window_days)
    rows = db.execute(
        select(AttendanceProviderPerson.employee_id, AttendancePunch.occurred_at)
        .join(AttendancePunch, AttendancePunch.provider_person_id == AttendanceProviderPerson.id)
        .where(
            AttendanceProviderPerson.employee_id.is_not(None),
            AttendanceProviderPerson.mapping_state == "verified",
            AttendancePunch.occurred_at >= since,
        )
        .order_by(AttendanceProviderPerson.employee_id, AttendancePunch.occurred_at)
    ).all()

    streams: dict[str, list[datetime]] = {}
    for employee_id, occurred_at in rows:
        streams.setdefault(str(employee_id), []).append(occurred_at)

    rostered: dict[str, set[str]] = {}
    for employee_id, shift_code in db.execute(
        select(AttendanceCase.employee_id, AttendanceCase.shift_code_snapshot)
        .where(AttendanceCase.operational_date >= (_naive_utc(now) - timedelta(days=30)).date())
        .distinct()
    ).all():
        rostered.setdefault(str(employee_id), set()).add(str(shift_code))

    db.execute(delete(AttendancePunchProfile))
    computed_at = _naive_utc(now)
    written = 0
    total_pairs = 0
    mismatches: list[tuple[str, str, str]] = []

    for employee_id, moments in streams.items():
        arrivals: dict[str, list[int]] = {}
        departures: dict[str, list[int]] = {}
        for arrival, departure in _pairs(moments):
            total_pairs += 1
            arrival_minutes = _local_minutes(arrival)
            shift = _anchor(
                shifts, arrival_minutes, prefer=frozenset(rostered.get(employee_id, ()))
            )
            if shift is None:
                continue
            arrivals.setdefault(shift.code, []).append(
                _signed_offset(arrival_minutes, shift.start_minutes)
            )
            departures.setdefault(shift.code, []).append(
                _signed_offset(_local_minutes(departure), shift.end_minutes)
            )

        for shift_code, arrival_offsets in arrivals.items():
            if len(arrival_offsets) < MIN_SAMPLE_DAYS:
                continue
            departure_offsets = departures[shift_code]
            db.add(
                AttendancePunchProfile(
                    employee_id=employee_id,
                    shift_code=shift_code,
                    sample_days=len(arrival_offsets),
                    arrival_early_offset=_percentile(arrival_offsets, 0.05),
                    arrival_typical_offset=_percentile(arrival_offsets, 0.5),
                    departure_typical_offset=_percentile(departure_offsets, 0.5),
                    departure_late_offset=_percentile(departure_offsets, 0.95),
                    suggested_shift_code=None,
                    window_days=window_days,
                    computed_at=computed_at,
                )
            )
            written += 1

        # The habit is filed under a shift this person is rostered on, so what is
        # worth reporting is a habit that fits some *other* defined shift much
        # better than the one they are assigned. An offset that fits nothing -
        # a crew running 06:00 to 14:00 when no such shift exists - is left to
        # speak for itself through the offsets, because naming the nearest shift
        # would be a confident wrong answer.
        for shift_code, arrival_offsets in arrivals.items():
            if len(arrival_offsets) < MIN_SAMPLE_DAYS:
                continue
            own = _percentile(arrival_offsets, 0.5)
            if abs(own) <= ANCHOR_FIT_MINUTES:
                continue
            anchored = next((shift for shift in shifts if shift.code == shift_code), None)
            if anchored is None:
                continue
            observed_minutes = (anchored.start_minutes + own) % _DAY_MINUTES
            better = min(
                (
                    shift
                    for shift in shifts
                    if shift.code != shift_code
                    and abs(_signed_offset(observed_minutes, shift.start_minutes))
                    <= ANCHOR_FIT_MINUTES
                ),
                key=lambda shift: abs(_signed_offset(observed_minutes, shift.start_minutes)),
                default=None,
            )
            if better is not None:
                mismatches.append((employee_id, shift_code, better.code))

    db.flush()
    # Keyed on the row that was flagged, not on the person: a rotating crew holds
    # one profile per shift, and only the shift whose habit disagrees carries the
    # suggestion.
    for employee_id, shift_code, better in mismatches:
        profile = db.get(AttendancePunchProfile, (employee_id, shift_code))
        if profile is not None:
            profile.suggested_shift_code = better

    db.flush()
    return ProfileRebuildResult(
        profiles=written,
        employees=len(streams),
        pairs=total_pairs,
        mismatches=tuple(mismatches),
    )


def profile_for(
    db: Session, *, employee_id: str, shift_code: str | None
) -> AttendancePunchProfile | None:
    """The learned habit backing one case, when it has repeated often enough."""
    if not shift_code:
        return None
    profile = db.get(AttendancePunchProfile, (employee_id, shift_code))
    if profile is None or profile.sample_days < MIN_SAMPLE_DAYS:
        return None
    return profile


def _previous_case_end(db: Session, *, case: AttendanceCase) -> datetime | None:
    """When this person's previous duty ended, so one punch cannot serve two."""
    return db.scalar(
        select(AttendanceCase.scheduled_end_at)
        .where(
            AttendanceCase.employee_id == case.employee_id,
            AttendanceCase.id != case.id,
            AttendanceCase.scheduled_end_at <= case.scheduled_start_at,
        )
        .order_by(AttendanceCase.scheduled_end_at.desc())
        .limit(1)
    )


def evidence_window(
    db: Session,
    *,
    case: AttendanceCase,
    policy: WorkAttendancePolicy,
    profile: AttendancePunchProfile | None = None,
) -> tuple[datetime, datetime]:
    """The instants inside which a punch counts as evidence for one case.

    The policy window, widened to cover this person's own habitual arrival and
    departure, bounded by the approved cap and by their previous duty.
    """
    start = case.scheduled_start_at - timedelta(minutes=policy.match_before_minutes)
    end = case.scheduled_end_at + timedelta(minutes=policy.match_after_minutes)
    if profile is None:
        return (start, end)

    learned_start = case.scheduled_start_at + timedelta(
        minutes=profile.arrival_early_offset - WIDEN_MARGIN_MINUTES
    )
    floor = case.scheduled_start_at - timedelta(minutes=MAX_WIDEN_MINUTES)
    previous_end = _previous_case_end(db, case=case)
    if previous_end is not None and previous_end > floor:
        floor = previous_end
    start = min(start, max(learned_start, floor))

    if profile.departure_late_offset is not None:
        learned_end = case.scheduled_end_at + timedelta(
            minutes=profile.departure_late_offset + WIDEN_MARGIN_MINUTES
        )
        end = max(end, min(learned_end, case.scheduled_end_at + timedelta(minutes=MAX_WIDEN_MINUTES)))
    return (start, end)


def infer_direction(
    *,
    case: AttendanceCase,
    punch_at: datetime,
    profile: AttendancePunchProfile | None,
) -> str | None:
    """Read a lone punch as ``"in"`` or ``"out"``, by habit where one exists.

    Without a learned habit the shift's own edges are the anchors, which is still
    enough to keep a punch recorded near going-home time from being timed as a
    very late arrival. ``None`` when the punch sits between the two with no
    clearly nearer one: a wrong answer here invents lateness, so ambiguity is
    left as ambiguity and the caller keeps its existing behaviour.
    """
    if profile is not None and profile.departure_typical_offset is not None:
        arrival = case.scheduled_start_at + timedelta(minutes=profile.arrival_typical_offset)
        departure = case.scheduled_end_at + timedelta(minutes=profile.departure_typical_offset)
    else:
        arrival = case.scheduled_start_at
        departure = case.scheduled_end_at
    moment = _naive_utc(punch_at)
    to_arrival = abs((moment - _naive_utc(arrival)).total_seconds()) / 60
    to_departure = abs((moment - _naive_utc(departure)).total_seconds()) / 60
    if abs(to_arrival - to_departure) < DIRECTION_MARGIN_MINUTES:
        return None
    return "in" if to_arrival < to_departure else "out"


__all__ = [
    "DEFAULT_WINDOW_DAYS",
    "MAX_WIDEN_MINUTES",
    "MIN_SAMPLE_DAYS",
    "ProfileRebuildResult",
    "evidence_window",
    "infer_direction",
    "profile_for",
    "rebuild_profiles",
]
