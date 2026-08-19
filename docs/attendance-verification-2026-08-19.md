# Attendance register — verification record (2026-08-19)

What was actually run, against what, with the result. Every claim below is a
command that was executed on branch `feat/attendance-register`; nothing here is
inferred from reading code.

## What was built

A BioTime-backed attendance register under Employees, as design **E** from the
five mockups: a section tab strip at the foot of the Employees navy band
(`Directory | Attendance | Duty locations`), a live attendance card in the
Directory hero, and one Attendance page carrying three projections of a single
`GET /workforce/attendance/day` payload — **Register** (design 10, names in
three columns grouped by post, exceptions floated up), **Board** (design 7, a
dark duty-room wall where each post is a tile sized by headcount and colour
marks only trouble) and **Timeline** (design 8, arrivals as dots against the
grace line). Plus a seventh chip inside one employee's file
(`/employees/:id?tab=attendance`, design 3): punctuality KPIs, a month grid
coloured by outcome with the shift letters actually worked, and the selected
day's punch timeline.

## Data the review ran against

A throwaway database at `GSSG_DATA_DIR=%LOCALAPPDATA%/Temp/attendance-preview`,
built by the same factory the tests use (`backend/tests/factories/attendance.py`):

* 40 guards across the **nine real duty posts**, seeded through
  `workforce_seed_service.seed_workforce_roster` — real shift windows
  (morning 05:00–13:00, noon 13:00–21:00, night 21:00–05:00) and the real 5-day
  crew rotation.
* `2026-08-19` is crew 2's **double day** (morning *and* night), so the
  unfiltered day holds 80 rows — which is why the toolbar has a shift filter.
* Arrival spread: 30 verified, 4 late past the 05:30 grace, 3 single-punch,
  3 never seen. Every state the UI can render is present in the data.

## Backend

```
python -m pytest backend/tests -q -p no:randomly -k "workforce or attendance or schema_utc"
  → 170 passed
python -m pytest backend/tests -q -p no:randomly          (full suite, background)
  → 1340 passed, 3 failed
```

The three whole-suite failures were each measured against `main` before being
dismissed: `test_dav_diagnostic_event_is_structured_and_redacted` (StopIteration)
and `test_record_included_papers_migration_upgrades_and_downgrades` (KeyError
`docx_path`) fail identically on `main`; the third —
`test_every_schema_with_a_timestamp_inherits_the_tagging` — **was mine**, a real
contract violation: `EmployeeAttendanceDayRead` / `EmployeeAttendancePunchRead`
subclassed `BaseModel`, so their timestamps would have serialised without the
UTC tag every other schema carries. Fixed by inheriting `ORMBase`; the guard now
passes.

## Frontend

```
pnpm vitest run                    → 1005 of 1007 pass
pnpm exec tsc --noEmit -p tsconfig.app.json   → clean
pnpm exec eslint src/pages/employees src/components/employees e2e
  → 1 error + 1 warning, both pre-existing (Avatar3D, EmployeeForm)
```

The 2 failures are order-dependent flakes in
`src/pages/application/ApprovedViolationUpload.test.tsx`; the file passes in
isolation, and the **same whole-suite command on `main` fails 5 tests across 3
files**. The branch is strictly better than the baseline it started from.

## Live browser review

Backend on `127.0.0.1:8791` against the preview database, Vite on `5199`
(`GSSG_API_TARGET` — the proxy target became env-driven so a review never has to
kill the operator's own instance on 8765).

```
pnpm exec playwright test e2e/attendance.spec.ts --project=chromium
  → 12 passed
```

Covering: the register renders every post section and every name; the shift
filter narrows the day to one window without a second request; the view switch
reaches Board and Timeline off the same payload; arrow keys change the day; a
name deep-links into that employee's attendance tab; the attention queue is
ordered worst-first; and **no horizontal page overflow at 1440 / 1280 / 1024 in
both English and Arabic RTL** (`document.documentElement.scrollWidth <=
window.innerWidth`), with zero console errors throughout.

Arabic is not decoration in that list. Two defects only appear in RTL, and both
are now guarded: an Arabic unit name immediately before a clock range gets
reordered by the bidi algorithm (`05:00 - 13:00` renders as `13:00 - 05:00`)
unless the run is isolated, and the toolbar's start-side controls must move to
the right. The review asserts the clock range still reads `05:00 – 13:00` after
switching language.

Screenshots for every surface in both languages are regenerated on demand by
`pnpm exec playwright test e2e/attendance-shots.spec.ts` (they are not tracked —
same policy as `audit-report/screens/`).

## Defects the review found, that reading the code did not

1. **The hero card lied while loading.** Before its first payload it printed
   `0 seen / 0 late / 0 unpaired` and "every scheduled person has been seen" —
   indistinguishable from a verified clean day. Loading now renders as loading;
   a test proves the clean state cannot appear while the query is in flight (and
   the test was falsified — it fails when the guard is removed).
2. **"freshness unknown"** in the register's source line, while
   `/workforce/integration/status` already exposed `fresh_through`. Now wired,
   capability-gated, and unable to hide the register if it fails.
3. **Coincident arrivals stacked into one dot** on the timeline — a crew arrives
   on one bus, so people hid behind each other. Dots now fan deterministically
   over three pixels.
4. **The navy band collapsed to a strip** at the page level (missing
   `shrink-0` under a flex parent).
5. **The section tab strip floated left** under the Directory's centred hero,
   aligned to nothing. It now sits on the band's centre axis.

## Live BioTime read

`backend/scripts/biotime_probe.py --window-days 0.25` against the installed
build, today:

* **129 real punch rows**, `punch_time` 03:58:52 → 08:51:48.
* `punch_state = 255` / `Unknown` on **every** row — the premise that direction
  cannot be trusted, and that a lone punch must be classified by shift midpoint,
  still holds against the live device.
* Timestamps carry **no offset** (device-local wall time), so the adapter's
  timezone conversion is still required rather than defensive.
* One terminal (`RYQ1252000369`, Al Watbha Prison 2); the time filter provably
  narrows the result set; `verify_type` census: 128 Face, 1 Fingerprint.

Both facts the whole evaluator design rests on were re-confirmed live, not
assumed from a manual.
