# Attendance: judge at duty end, and read history from the device

2026-08-20. Approved by the site owner in session; implemented the same day.

## What was wrong

Three complaints, one morning, all on the live install:

1. **Today's punches were flagged while the duty was still running.** The
   evaluator asserted `absent` `absence_after_minutes` (30) after a shift start,
   so at 08:00 seventeen people were absences against a duty that ends at 15:00.
   The register's client rules made it worse: a row with exactly one punch was an
   exception, which on this site is every person who has arrived and not yet left.
2. **Only `الدوام الرسمي` appeared on the Attendance page.** The register reads
   cases, and cases were created only for shifts that had *already started*, so a
   site running three guard rotations plus the office day could see one of them at
   a time.
3. **Nothing before 17 August existed.** The schedule starts there, so the product
   showed an empty life for a person who had been punching since January -
   while BioTime held 40,104 transactions.

## The device has no direction

Probed live against the installed build: **every** transaction carries
`punch_state = 255 / "Unknown"` - 123 of 123 in a six-hour window, and the same
on a June row. So `_DIRECTIONS` never matches, and the evaluator's directional
path can never produce `on_duty`, late minutes, or early exit here.

The owner chose inference over a blank register: **inside a closed case window
the earliest punch is the arrival and the latest is the departure.** The
alternative - keep reporting `unknown` until the terminals are reconfigured to
emit punch state 0/1 - was rejected as leaving attendance permanently mute.

## Decisions

### 1. A duty is judged when its own match window closes

`ALGORITHM_VERSION` was `workforce-attendance-v2`. **Superseded the same day by
the arrival ladder below (v4); the table here is the v2 rule, kept because the
reasoning about pairing still stands.**

`settled = evaluated_at >= scheduled_end_at + policy.match_after_minutes`.

| evidence | before `settled` | at/after `settled` |
| --- | --- | --- |
| no punches, before absence boundary | `scheduled` / `SCHEDULED_BEFORE_ABSENCE_BOUNDARY` | - |
| no punches, past absence boundary | `scheduled` / `AWAITING_ARRIVAL` | `absent` / `NO_IN_AFTER_THRESHOLD` |
| directionless punches | `on_duty` / `PUNCH_RECORDED_DIRECTIONLESS` | `completed` / `PUNCH_ORDER_INFERRED` |
| directional punches | unchanged (`on_duty`, `completed`) | unchanged |

Nothing is attributed mid-duty: `late_minutes`, `early_exit_minutes` and
`final_out_at` stay null until the window closes, so a single punch is never read
as a departure just because nobody punched again. Freshness gating moved from the
absence boundary to the checkout boundary, matching the moment of judgment.
`AWAITING_ARRIVAL` keeps "has not arrived yet" visible without it being an
exception.

The client had its own copy of this rule and was wrong in the same way, so the
server now publishes `judgment_due_at` on every day row and `rowState` uses it.
One boundary, one source; a row with no policy behind it is never judged at all.

### 1b. The arrival ladder: grace, late, absent — and absence is provisional

`ALGORITHM_VERSION` is now `workforce-attendance-v4`. Decision 1 held every
verdict, arrival included, until the duty was over. The site's own rule is
narrower, and it separates arrival from pairing:

| arrival, against `scheduled_start_at` | verdict |
| --- | --- |
| at or before the start | on time |
| after the start, within `grace_minutes` | inside the grace — noted, costs nothing |
| past `grace_minutes` | **late**, by `arrival − (start + grace)` |
| no punch, before `absence_after_minutes` | not here yet |
| no punch, at/after `absence_after_minutes` (twice the grace) | **absent** |
| a punch arriving after that boundary | **late**, never absent |

`absence_after_minutes` is a policy column, not a constant; migration
`0073_absence_after_twice_grace` moves the seeded default from 30 (equal to the
grace, which is what produced the 08:00 mass-absence bug) to 60, and the seeder
now derives it as `grace × 2`.

Absence is asserted at the absence boundary rather than at the end of the duty,
which is what decision 1 rejected. What makes it safe is that it is provisional
by construction: the evaluation queue already re-runs a case at every freshness
advance, so a punch landing after the boundary appends a new revision reading the
day as a late arrival. The absence revision stays in the record; the effective
verdict is the arrival. Freshness for this verdict is measured to the absence
boundary, so a stalled mirror reads `unknown` / `SYNC_STALE` instead of
manufacturing absences out of missing data.

Pairing is untouched: a lone punch is only `unpaired` once `judgment_due_at`
passes, because mid-duty that describes every person currently at their post.

The client applies exactly these rules, from the server's own numbers: every day
row and every day of an employee's month now carries `grace_minutes`,
`absence_due_at` and `judgment_due_at`, and one `rowState` in
`frontend/src/pages/employees/attendance/attendanceModel.ts` classifies both
payloads. States: `verified`, `grace` (yellow, `--caution`), `late` (amber),
`unpaired` (rose), `absent` (red), `leave`, `pending`. Lateness outranks pairing
so a punch hours past the boundary reads as the very late arrival it is, and the
registers count unpaired separately so both facts survive.

### 2. Cases cover the whole operational day

`materialize_started_cases` became `materialize_scheduled_cases(horizon=...)`,
and the scheduler passes the end of the site-local day. Upcoming shifts get a
case that evaluates to `scheduled`, so the register lists every shift of the day.
The evaluation boundary still applies: a shift that started before
`evaluation_start_at` is skipped rather than judged without arrival evidence.

### 3. History is read from the provider, never stored

`GET /workforce/employees/{id}/attendance/history?from_date=&to_date=` reads
BioTime live and groups punches by Asia/Dubai calendar day: first seen, last
seen, count, devices. No rows are written.

- `emp_code` is the filter, because it is the only person field the transactions
  endpoint honours - `emp` is accepted and silently ignored, returning the whole
  site.
- `emp_code` is **not** identity: two enrollments can share it (G2218 and G3805
  do), so every returned row is checked against the mapped `external_person_id`.
- Bounded: 40 pages per request, 400 days per range, `truncated` when the cap
  stops the read.
- The provider is a FastAPI dependency (`get_attendance_provider`) so tests
  substitute a double instead of reaching the vendor - which they did, once.

The employee Attendance tab shows these as a `seen` outcome in its existing month
grid, with a summary panel stating sightings and nothing more. Months the roster
never covered stop reading as empty; nothing there is called late or absent,
because there is no duty to compare against.

## Not done

- Punch→case allocation (`attendance_punch_service`) still has no production
  caller, so `attendance_punch_assignments` stays empty. Evaluation reads punches
  directly, so the register is unaffected; the allocation audit trail is unused.
- The 8 unmapped provider people (6 codes absent from Sentinel, 2 duplicate
  enrollments) need an operator decision, not code.
