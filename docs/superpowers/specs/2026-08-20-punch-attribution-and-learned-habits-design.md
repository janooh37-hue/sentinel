# Punch attribution, learned habits, and a year of evidence

2026-08-20. Approved by the site owner in session, after the judgment and
history work earlier the same day.

## What was wrong

Office-day people who punch at 04:00–05:00 were invisible to the register. One
policy row governs all four shifts with `match_before_minutes = 60`, so the
office window (start 07:00) opens at 06:00 and an earlier punch is not evidence
for anything. Measured over 20 July – 20 August, 8,788 punches, 283 mapped
people:

| shift | starts | window opened | person-days | first punch median | dropped |
| --- | --- | --- | --- | --- | --- |
| `office_day` | 07:00 | 06:00 | 1,272 | 06:54 | **152 days, 12 people** |

Those 12 are not outliers having a bad week: 152 dropped days is roughly every
shift each of them worked. The habit is stable, and stable habits are the thing
worth learning from.

Two facts shape everything below.

**The terminals report no direction.** Every punch carries `punch_state 255`
("Unknown"). Within a closed window the earliest punch is the arrival and the
latest is the departure, which the previous change already implements. It does
not help the 61 office days last month — 45 of today's 147 rows — that hold
exactly one punch. One punch with no direction is unresolvable from the punch
alone.

**There is one device.** `Al Watbha Prison 2` (`RYQ1252000369`) recorded
8,788 of 8,788 punches; all 7 duty units and all 263 punching people use it.
BioTime's own `area_alias` and `department` fields are the site name. A check
that compared the punch device against the employee's duty post would therefore
pass unconditionally — false assurance, not verification. The post is still
load-bearing, but in the other direction: it selects the window
(G-number → duty unit → post → crew → schedule → shift → policy), so the
question worth asking is whether a person is rostered on the shift they
actually work.

## The design

### 1. The punch record reaches back to 1 January

`initial_backfill_start_at` moves to 2026-01-01. The sync's existing window
loop walks forward in bounded steps; draining it to exhaustion stores roughly
40,000 punches in `attendance_punches`. No new code.

This deliberately reverses part of the earlier "history is read live, never
stored" rule for the backfilled range: learning and offline auditing both need
local evidence, and the year view should not go blank when the device server is
unreachable. Live reads remain the only path for anything older than the
backfill. Retention is dormant (36,500 days for every kind), so the January
punches survive; the purge only removes punches no evidence and no allocation
reference, which would have deleted them silently had retention been active.

### 2. `office_day` gets its own policy

A second policy row scoped to the `office_day` shift definition, with
`match_before_minutes = 180`. The window opens at 04:00 and the 12 early birds
become visible immediately, through the audited policy service rather than a
hand-written row.

Widening cannot steal another shift's punches: attribution matches punches by
`provider_person_id` to that person's own case, so a wide office window never
reaches a night guard's exit. The one case where overlap is real is a rotation
double-day, where a single person holds two cases; section 4 bounds it.

### 3. Habits are learned as offsets, anchored on shift starts

A nightly job computes, per `(employee_id, shift_code)` over a rolling 90 days
of stored punches:

- `arrival_early_offset` (p05), `arrival_typical_offset` (median)
- `departure_typical_offset` (median), `departure_late_offset` (p95)
- `sample_days`, `window_days`, `computed_at`

Arrival offsets are signed minutes against the shift's local start, departures
against its local end, so a shift-time change does not invalidate the sample and
`-20` reads as twenty minutes early.

**Corrected during implementation.** The design first anchored each pair on its
case. There are no cases before 17 August, when the roster was installed, so
that would have learned from four days instead of eight months. Pairs are
therefore anchored on the *shift definitions*, whose local starts are fixed:
punches pair by gap (4h to 16h apart), and each pair is attributed to the shift
whose start is nearest its arrival. No roster history is required, and the
February-to-August record becomes usable. Pairing by gap rather than by calendar
day is also what keeps a night duty whole; grouping by date reads the 05:00
departure as the next day's arrival, the mistake that made the first
measurement of `noon` and `night` unusable.

Fewer than 5 paired days writes no profile at all, and the policy window stands
unchanged. **The group fallback in the first draft was dropped**: with eight
months of punches, 271 of 283 mapped people clear the floor on their own, so a
`(duty_unit, duty_post)` prior would have been an unused branch.

### 4. Attribution widens by habit, within a hard cap

The window start becomes the earlier of the policy window and
`arrival_p05_offset` minus a small margin, subject to two bounds:

- never more than **3 hours** before the scheduled start
- never earlier than the end of that person's previous case

The second bound is what keeps a double-day honest: one punch cannot serve as
evidence for two cases.

### 5. Direction on single-punch days

With one punch in a closed window, the punch is read as a departure when it sits
clearly nearer the person's habitual departure than their habitual arrival, and
the case records `PUNCH_OUT_ONLY_INFERRED` with no lateness — the arrival is what
went unrecorded. Otherwise behaviour is unchanged: the punch is the arrival and
the case reads `PUNCH_ORDER_INFERRED`. Inside a 45-minute band around the
midpoint nothing is inferred, because a wrong answer here invents lateness.

Where no habit exists the shift's own edges are the anchors, which is enough to
stop a punch recorded at going-home time from being timed as an eight-hour-late
arrival — the fabricated-lateness bug this closes for every employee, not only
those with a learned profile.

Lateness is never computed from a learned value. It stays
`first punch − scheduled start − grace`. Learning changes which punches are
*seen*, never what being late means.

### 6. Roster versus habit

Where a person's learned profile fits a different shift than the one they are
rostered on, the profile records the better-fitting shift. Reported with
G-number, duty unit and post, this finds rostering errors — a person filed
under `الدوام الرسمي` at 07:00 who punches 04:30 and 13:00 every day is
mis-rostered, not mis-punching.

### 7. A year of evidence on the Attendance tab

The history endpoint already accepts 400 days; only the frontend asked for one
month. The tab now carries a band of every month the device saw this person,
from 1 January, each month showing its day count and selecting itself on click.
The judged range endpoint keeps its 92-day cap, which costs nothing here: cases
exist only from 17 August, so a judged year would be empty by construction. The
band is the device's own answer, the grid below is ours, and the two being read
side by side is what lets the BioTime dashboard go unused.

The tab also states the learned habit per shift and, when the profile fits a
different shift than the roster, says so.

## Testing

- Profile computation: known punch series in, known offsets out; a night duty
  paired across midnight; a doubled gate punch rejected as a duty.
- The 5-day sample floor, the 3-hour cap, and the previous-case bound on a
  double-day.
- Single-punch direction both ways, the no-habit fallback to shift edges, and
  the ambiguous mid-duty band.
- A rotating crew is not reported as mis-rostered; a fixed pattern on the wrong
  shift is.
- Frontend: the month band renders one entry per month seen and selects that
  month; the habit line and the roster warning render from the payload.

## Deliberately not built

- No machine learning. Percentiles over a rolling window are explainable, and
  an operator can audit them.
- No device-to-post verification, for the reason given above. If a second
  terminal is ever installed, revisit.
- No per-weekday profiles. Rotations already carry the day pattern; add them
  only if a measured weekday effect appears.
