# Task 4 report — Generated Contract and Permit Form

## RED evidence

Added failing form tests before the UI implementation for:

- exact preset order (`1 day`, `1 week`, `1 month`, `6 months`, `1 year`, `Custom period`) and absence of `3 months`;
- preset payload `{ start_date, validity: { value: 6, unit: 'month' }, people[].role }` with no `end_date`;
- custom positive duration/unit interaction and payload;
- required nonblank visitor job/trade;
- edit validity round-trip with no `end_date`;
- unchanged vehicle payload fields.

The pre-implementation focused Vitest run produced **6 failed / 10 passed** tests. Failures were the expected missing job label, missing validity controls, missing role validation, and edit payload still using `end_date`.

## GREEN evidence

Implementation completed in `PermitFormDialog.tsx`:

- one `{ value, unit }` validity state initialized to `{ value: 1, unit: 'month' }`;
- exact five presets plus Custom period; custom positive-integer duration and four-unit select;
- no form `endDate`, `windowValid`, end-date control, or write payload `end_date`;
- required trimmed `role` in every new-person row, with a visible mobile label and desktop grid column;
- existing access areas, global Work residence, people/vehicle rows and scans, permit paper, purpose, notes, manager, approval/draft routing, and upload behavior retained.

Focused GREEN command:

```text
pnpm -C frontend exec vitest run src/pages/permits/PermitFormDialog.test.tsx src/locales/permits.i18n.test.ts
Test Files 2 passed; Tests 113 passed
```

Typecheck command:

```text
pnpm -C frontend exec tsc -b --noEmit
(no output; exit 0)
```

## Generated contract evidence

Ran the prescribed workflow:

1. `venv\\Scripts\\python.exe -X utf8 scripts\\dump_openapi.py` (the worktree has no local venv, so the equivalent absolute shared venv path was used); OpenAPI dump completed with 190 paths.
2. `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "cd frontend; pnpm run gen:api"` completed with openapi-typescript 7.13.0.
3. Frontend typecheck passed as shown above.

Verified generated schema properties:

- `PermitCreate`: includes `start_date`, `validity`; no `end_date`.
- `PermitUpdate`: includes optional `validity`; no `end_date`.
- `PermitRenew`: includes `validity`, `reason`; no `new_end_date`.
- `PermitRead`: retains `start_date`, `validity`, and internal `end_date`.

`api.ts` now exports generated `PermitValidityPeriod` and `PermitRenew`. A temporary structural compatibility parameter remains on the unchanged renewal client caller until Task 5 migrates that caller; the generated write schema and form payload remain strict and validity-based. The person-create alias similarly keeps the unchanged detail add-person caller type-compatible while generated `PermitCreate.people` remains strict. Task 5 should remove those compatibility relaxations when it updates the detail surface.

## Locale evidence

Added EN/AR parity for permit validity heading, all exact preset labels, custom controls, four unit forms, job-required copy, and revised help text. Renamed visible `permits.person.role` to `Job / trade` / `المهنة` while retaining the role key/API field. The focused locale parity suite passed.

## Self-review

- Desktop: validity controls render in a six-column row at `sm` and above; the people row gains a dedicated role column.
- Mobile: controls stack responsively; the job/trade label is visible rather than placeholder-only (`sm:sr-only` hides it only on desktop), and duration/unit labels remain visible.
- Work residence remains a single global access button outside W1/W2 cards.
- No dependency, detail/register/print/Word-version changes were made.

## Commit

`feat(permits): select preset or custom validity` (final SHA is recorded in the delivery status)

## Follow-up preservation round

### RED

Added regression tests for the labelled start-date input and create/edit start-date payloads, no-access submit blocking/no request, and edit hydration of a stored custom `{ value: 2, unit: 'month' }` period. Before implementation, the focused form run reported **4 failed / 16 passed** tests: missing start-date input (create and edit), missing access gating, and missing custom edit controls.

### GREEN

Restored the start-date input before validity controls, restored `hasAnyAccess` in `canSave`, and set `customOpen` from stored validity when it is not one of the five presets. Focused verification now reports:

```text
pnpm -C frontend exec vitest run src/pages/permits/PermitFormDialog.test.tsx src/locales/permits.i18n.test.ts
Test Files 2 passed; Tests 117 passed

pnpm -C frontend exec tsc -b --noEmit
(no output; exit 0)
```

### Files and downstream concern

Follow-up changes are limited to `PermitFormDialog.tsx` and `PermitFormDialog.test.tsx`. The existing temporary `api.ts` compatibility for unchanged Task 5 detail add-person/renew callers remains documented above and is not addressed in this round.

### Follow-up commit

`fix(permits): preserve validity form behavior` (final SHA is recorded in the delivery status)
