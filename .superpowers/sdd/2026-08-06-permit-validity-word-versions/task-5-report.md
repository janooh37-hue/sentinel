# Task 5 report: Detail, Renewal, Register, and Print Surfaces

## RED

- Added detail tests for start + validity rendering without a visible permit end date, required add-person job role validation/payload/reset, renewal duration payload, and the exact five presets plus `Custom period`.
- Added register/print tests for start + validity text, server-derived remaining-day text, and no visible permit end date in the print DOM.
- RED verification: the new detail tests initially failed because the old detail rendered an end-date range, omitted role validation, and rendered the end-date renewal picker. The new register assertion initially failed because the old register rendered the start/end range.

## GREEN

- Detail now consumes `PermitRead.validity`, renders `Starts <date>` and `Permit time: <value> <unit>`, and never formats the permit end date.
- Add-person now has a required job/trade input with a visible mobile label, sends the trimmed role through the existing endpoint, disables submission until name/UAE ID/role are present, and resets role on success. Legacy rows still render optional stored roles safely.
- Renewal now uses the shared five validity presets in the approved order plus `Custom period`, submits `{ validity, reason }`, and performs no TypeScript date arithmetic.
- Register and print use `<value> <unit> from <start date>` while status/remaining-day text remains server-derived from `days_remaining`/`derived_status`; expired status no longer exposes an end date.
- English and Arabic locale peers were updated for validity units, start/period copy, expired text, and renewal help.
- Removed both Task 4 compatibility relaxations in `frontend/src/lib/api.ts`: `PermitPersonCreate` is the generated strict alias and `renewPermit` accepts only `PermitRenew`.

## Files changed

- `frontend/src/pages/permits/PermitDetailDialog.tsx`
- `frontend/src/pages/permits/PermitDetailDialog.test.tsx`
- `frontend/src/pages/permits/PermitsPage.tsx`
- `frontend/src/pages/permits/PermitsPage.test.tsx`
- `frontend/src/locales/en.json`
- `frontend/src/locales/ar.json`
- `frontend/src/lib/api.ts`

No Word-version component/backend/document/migration/generated-artifact files were changed.

## Verification

- `pnpm -C frontend exec vitest run src/pages/permits/PermitDetailDialog.test.tsx`: 13 passed.
- `pnpm -C frontend exec vitest run src/pages/permits/PermitsPage.test.tsx`: 10 passed.
- `pnpm -C frontend exec vitest run src/locales/permits.i18n.test.ts`: 97 passed.
- Focused brief command covering all three files: 3 files, 120 tests passed.
- `pnpm -C frontend exec tsc -b --pretty false`: passed with no output.
- `git diff --check`: passed.

## Self-review

- Confirmed no `new_end_date`, `newEnd`, or permit `end_date` formatting remains in the detail/register/print surfaces.
- Confirmed existing lifecycle actions, paper/document actions, vehicle/scanning actions, selection/filter/sort wiring, access-area pairings, and server-derived status inputs remain intact.
- Confirmed strict aliases compile after all callers were migrated.

## Task 4 blocker resolution

Task 4 left `PermitPersonCreate.role` optional and `renewPermit` accepting `PermitRenew | Record<string, unknown>` because the detail callers still used the old contracts. Task 5 migrated those callers to send a trimmed required role and duration-based `{ validity, reason }`; both compatibility relaxations were then removed from `api.ts` and strict TypeScript verification passed.

## Commit

- Exact commit message: `feat(permits): show validity periods across surfaces`.

## Concerns

The focused tests intentionally avoid the broad project suite per the task brief. The server still retains `end_date` internally for status/filter calculations and API responses; it is not rendered in the operator-facing detail/register/print surfaces.

## Follow-up review round

### RED

- Review findings required whole-period pluralization, locale-derived date formatting, bidi-safe surface text, exact preset-button assertions, raw end-date rejection, and expanded locale parity/behavior tests.
- Added failing/strengthened assertions for English `6 months`, Arabic detail/page wording and RTL direction, Arabic plural forms for 1/2/6, exact six validity buttons via `aria-pressed`, and both formatted and raw permit end-date absence.

### GREEN

- Replaced mechanical `<value> <unit>` composition with i18next plural whole-period keys for day/week/month/year, including Arabic zero/one/two/few/many/other forms.
- Detail, register, and print now pass the whole localized period into their translated phrases; detail facts are separate block lines.
- Date formatting now derives its locale from `i18n.language` (`en-GB` for the English presentation and the active Arabic locale for Arabic dates); removed whole-phrase `dir=\"ltr\"`.
- Expanded locale parity covers validity units, every whole-period plural key, `validityFrom`, `expired`, detail start/period copy, and renewal help.

### Follow-up files

- `frontend/src/pages/permits/PermitDetailDialog.tsx`
- `frontend/src/pages/permits/PermitDetailDialog.test.tsx`
- `frontend/src/pages/permits/PermitsPage.tsx`
- `frontend/src/pages/permits/PermitsPage.test.tsx`
- `frontend/src/locales/en.json`
- `frontend/src/locales/ar.json`
- `frontend/src/locales/permits.i18n.test.ts`

### Follow-up verification

- Focused Vitest: 3 files, 188 tests passed.
- `pnpm -C frontend exec tsc -b --pretty false`: passed with no output.
- `git diff --check`: passed.

Follow-up commit message: `fix(permits): localize validity surface wording`.
