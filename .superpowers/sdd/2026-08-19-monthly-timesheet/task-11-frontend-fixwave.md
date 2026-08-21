# Task 11 — frontend final-review fix wave

## Status

Complete. All fourteen frontend findings were applied without touching backend code, migrations, `openapi.json`, or `api.types.ts`.

- `98013c1` — RTL drag-tag origin subtraction, LTR drag-tag/masthead quoted controls, pointer-cancel and unmount cleanup, stable RowTally dismiss callback, and the persistent keyboard/activation-path enumeration comment.
- `12a78bd` — prune refused single-cell corrections by object identity and index page rows with a memoized employee map.
- `43a672a` — suppress sentinel-month filenames/footer text and reset the employee billing-day draft when the target changes.
- `9ba22f0` — add Arabic/English `timesheet` permission labels, strengthen global Arabic isolate-span checks, and correct stale test precedent paths in tests and the plan.
- `782ee60` — keep the row-index dependency lint-clean and complete the unmount-listener regression assertion.
- `96b108f` — make the paint-path comment explicitly enumerate the capture-phase refusal branch.
- `3335972` — this report.

## Verification

One-line test summary: `TimesheetGrid.test.tsx` 42 passed; `TimesheetFill.test.tsx` 5 passed; `TimesheetPage.test.tsx` 12 passed; `TimesheetDock.test.tsx` 25 passed; `TimesheetEntry.test.tsx` 2 passed; `panels/ChecksPanel.test.tsx` 12 passed; `panels/EmployeePanel.test.tsx` 18 passed; `locales/timesheet.i18n.test.ts` 361 passed; `tsc --noEmit -p tsconfig.app.json` clean; ESLint on `src/pages/timesheet src/locales src/components/access` clean with 0 problems.

The RTL regression mounts the masthead and grid under `dir="rtl"`, pins the drag tag and printed form wrapper to `dir="ltr"`, and exercises the origin-subtraction transform branch with a stubbed width. jsdom cannot observe the browser's resolved fixed-overlay geometry or the physical RTL sweep, so those visual/layout claims remain a live-browser concern; the test intentionally asserts the attributes and arithmetic branch that control them.

No `PostsPanel.test.tsx` exists in this tree, so there was no additional PostsPanel module to run. The full frontend suite was intentionally not run per the 8 GB host constraint.

## Concerns

- Existing grid tests still emit React `act(...)` stderr warnings in several pre-existing keyboard cases; they do not fail the suite and no new warning was introduced by this wave.
- An unrelated untracked `backend/app/static/` directory was present in the worktree and was left untouched.
