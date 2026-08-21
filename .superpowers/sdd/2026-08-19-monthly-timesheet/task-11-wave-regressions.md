# Task 11 — Wave regressions

## Status

Complete. Three bounded corrections landed in three incremental commits:

- `6361ed9` — `fix(i18n): restore Arabic editor templates label`
- `9902191` — `test(timesheet): widen unmount sweep before cleanup`
- `c95c643` — `fix(timesheet): name blocked sheets in export errors`

No migration, `backend/openapi.json`, or `frontend/src/lib/api.types.ts` was changed. The untracked `backend/app/static/` artifact was left untouched.

## Corrections

1. Restored `access.permissions.caps.editor_templates.manage` in `frontend/src/locales/ar.json`, between `submitters.manage` and `users.manage`, exactly matching its original position and Arabic text.
2. Added the sibling test's `pointerOver(cell('G1001', 8), ...)` to the unmount test. This expands the sweep to six cells, so the release reaches `onFill` if unmount cleanup is absent.
3. `_preflight` now derives the distinct blocking sheet names and includes them in the English 422 message:
   `Fix the blocking issues on the following sheet(s) before downloading: drivers.`
   The `details.blocking` payload is unchanged. The API test asserts the message and the existing details assertions remain in place.

## Unmount-test discrimination proof

Command (run from `frontend/`):

```text
cmd.exe /c "pnpm.cmd exec vitest run src/pages/timesheet/TimesheetGrid.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1 --reporter=dot"
```

With the cleanup guard present (`useEffect(() => () => drag.current?.stop.abort(), [])`):

```text
Test Files  1 passed (1)
Tests       42 passed (42)
```

With that guard temporarily commented out, the same command failed as required:

```text
············x···············
FAIL  src/pages/timesheet/TimesheetGrid.test.tsx > TimesheetGrid > removes the sweep listeners when the grid unmounts
AssertionError: expected "vi.fn()" to not be called at all, but actually been called 1 times
Received: [
  [
    { "day": 3, "employeeId": "G1001" },
    { "day": 4, "employeeId": "G1001" },
    { "day": 5, "employeeId": "G1001" },
    { "day": 6, "employeeId": "G1001" },
    { "day": 7, "employeeId": "G1001" },
    { "day": 8, "employeeId": "G1001" }
  ],
  "AL"
]
Tests  1 failed | 41 passed (42)
```

The guard was restored and the same command was rerun: `1` file and all `42` tests passed.

## Locale key-set diff

Executed a recursive JSON leaf-key-set diff over the complete files, plus scoped diffs for `access.permissions.caps` and `access.permissions.domains`. The scoped result is symmetric:

The script run from the worktree was:

```python
import json
from pathlib import Path

def leaf_keys(value, prefix=""):
    if isinstance(value, dict):
        return {
            path
            for key, child in value.items()
            for path in leaf_keys(child, f"{prefix}.{key}" if prefix else key)
        }
    if isinstance(value, list):
        return {
            path
            for index, child in enumerate(value)
            for path in leaf_keys(child, f"{prefix}[{index}]")
        }
    return {prefix}

root = Path("frontend/src/locales")
ar = leaf_keys(json.loads((root / "ar.json").read_text(encoding="utf-8")))
en = leaf_keys(json.loads((root / "en.json").read_text(encoding="utf-8")))
print("ar-only:", sorted(ar - en))
print("en-only:", sorted(en - ar))
for scope in ("access.permissions.caps", "access.permissions.domains"):
    a = {key.removeprefix(scope + ".") for key in ar if key.startswith(scope + ".")}
    e = {key.removeprefix(scope + ".") for key in en if key.startswith(scope + ".")}
    print(scope, "ar-only:", sorted(a - e), "en-only:", sorted(e - a))
```

```text
access.permissions.caps: ar-only=[] en-only=[]
access.permissions.domains: ar-only=[] en-only=[]
```

The full files have pre-existing asymmetries unrelated to this correction: `ar.json` has `272` keys not in `en.json`, and `en.json` has `2` keys not in `ar.json`. The restored editor-template key is not among them. No out-of-scope asymmetry was changed.

The complete full-file diff, grouped by parent path (the suffixes are the exact differing keys), is:

```text
ar-only:
basket.tile: pending_few, pending_many, pending_two
basket.tray: count_few, count_many, count_two, count_zero
books.reviewers: overrideBanner_few, overrideBanner_many, overrideBanner_two, overrideBanner_zero
dashboard: heroLeavesReturning_few, heroLeavesReturning_many, heroLeavesReturning_two, heroLeavesReturning_zero, heroSubtitle_few, heroSubtitle_many, heroSubtitle_two, heroSubtitle_zero
dashboard.pending: footnote_few, footnote_many, footnote_two, footnote_zero
dashboard.widgetLabels: waiting_approvals_aria_few, waiting_approvals_aria_many, waiting_approvals_aria_two, waiting_approvals_aria_zero
dashboard.widgets.emailSync: daysAgo_few, daysAgo_many, daysAgo_two, hoursAgo_few, hoursAgo_many, hoursAgo_two, hoursAgo_zero, minutesAgo_few, minutesAgo_many, minutesAgo_two, minutesAgo_zero, minutesUnit_few, minutesUnit_many, minutesUnit_two, minutesUnit_zero
dashboard.widgets.ledger: deltaWarn_few, deltaWarn_many, deltaWarn_two, deltaWarn_zero, metaRecent_few, metaRecent_many, metaRecent_two, metaRecent_zero
dashboard.widgets.recentDocs: metaRecent_few, metaRecent_many, metaRecent_two, metaRecent_zero
dashboard.workspace: active_few, active_many, active_two, active_zero, onLeave_few, onLeave_many, onLeave_two, onLeave_zero
dutyLocations.completion: detail_few, detail_many, detail_two, detail_zero
dutyLocations.rail: unassignedCount_few, unassignedCount_many, unassignedCount_two
dutyLocations.selection: count_few, count_many, count_two, units_few, units_many, units_two, units_zero
dutyLocations.transfer: subtitle_few, subtitle_many, subtitle_two
employees: pageMeta_few, pageMeta_many, pageMeta_two, pageMeta_zero
expiry: awaitingReturnDashCount_few, awaitingReturnDashCount_many, awaitingReturnDashCount_two, awaitingReturnDashCount_zero
gateway.indicator: checkedAgo_few, checkedAgo_many, checkedAgo_two
leaves.report: awaitingReturnChip_few, awaitingReturnChip_many, awaitingReturnChip_two, awaitingReturnChip_zero, endingSoonChip_few, endingSoonChip_many, endingSoonChip_two, endingSoonChip_zero, leadDays_few, leadDays_many, leadDays_two, leadDays_zero, pendingChip_few, pendingChip_many, pendingChip_two, pendingChip_zero, profileReturns_few, profileReturns_many, profileReturns_two, profileReturns_zero, totalsDays_few, totalsDays_many, totalsDays_two, totalsDays_zero, totalsEmployees_few, totalsEmployees_many, totalsEmployees_two, totalsRecords_few, totalsRecords_many, totalsRecords_two, totalsRecords_zero
ledger: pageMeta_few, pageMeta_many, pageMeta_two, pageMeta_zero
ledger.bulk: selected_few, selected_many, selected_two, selected_zero
ledger.outlook.sync: daysAgo_few, daysAgo_many, daysAgo_two, hoursAgo_few, hoursAgo_many, hoursAgo_two, hoursAgo_zero, minutesAgo_few, minutesAgo_many, minutesAgo_two, minutesAgo_zero
ledger.smart: bannerTitle_few, bannerTitle_many, bannerTitle_two, bannerTitle_zero, createBody_few, createBody_many, createBody_two, createBody_zero, reviewHeading_few, reviewHeading_many, reviewHeading_two, reviewHeading_zero, rowMeta_few, rowMeta_many, rowMeta_two, rowMeta_zero, suggestedPill_few, suggestedPill_many, suggestedPill_two, suggestedPill_zero, willMatch_few, willMatch_many, willMatch_two, willMatch_zero
ledger.sync: hours_few, hours_many, hours_two, hours_zero, minutes_few, minutes_many, minutes_two, minutes_zero
ledger.thread: count_few, count_many, count_two, count_zero
nav.bell: awaitingApproval_few, awaitingApproval_many, awaitingApproval_one, awaitingApproval_two, awaitingApproval_zero, awaitingReturn_few, awaitingReturn_many, awaitingReturn_one, awaitingReturn_other, awaitingReturn_two, awaitingReturn_zero, followUps_few, followUps_many, followUps_two, followUps_zero, scanBack_few, scanBack_many, scanBack_two, scanBack_zero
pendingDepartures: daysLeft_few, daysLeft_many, daysLeft_two, daysLeft_zero
permits: daysLeft_few, daysLeft_many, daysLeft_two, daysLeft_zero, duration_few, duration_many, duration_two, duration_zero, selectedCount_few, selectedCount_many, selectedCount_two, selectedCount_zero
permits.detail: peopleCount_few, peopleCount_many, peopleCount_two, peopleCount_zero, vehicleCount_few, vehicleCount_many, vehicleCount_two, vehicleCount_zero
permits.printout: subtitleAll_few, subtitleAll_many, subtitleAll_two, subtitleAll_zero, subtitleSelected_few, subtitleSelected_many, subtitleSelected_two, subtitleSelected_zero
scanBack: age_few, age_many, age_two, age_zero, viewAll_few, viewAll_many, viewAll_two, viewAll_zero
scanBack.dock: pill_few, pill_many, pill_two, pill_zero
scanBack.gate: title_few, title_many, title_two, title_zero
scanInbox: bellCount_few, bellCount_many, bellCount_two, bellCount_zero
sendToGroup: groupsAvailable_few, groupsAvailable_many, groupsAvailable_two, groupsAvailable_zero
sendToGroup.confirmSend: directPill_few, directPill_many, directPill_two, directPill_zero, groupsPill_few, groupsPill_many, groupsPill_two, groupsPill_zero
sendToGroup.direct: hintPrivate_few, hintPrivate_many, hintPrivate_two, hintPrivate_zero
sendToGroup.reach: groups_few, groups_many, groups_two, groups_zero
settings.navigation: controlsCount_few, controlsCount_many, controlsCount_two, controlsCount_zero
en-only:
nav.bell.awaitingApproval
nav.bell.awaitingReturn
```

## Verification

One-line summary: backend timesheet API + golden tests `63 passed`; July golden comparison `0` differing cells; TimesheetGrid `42 passed`; locale i18n `361 passed`; UserPermissionsSheet `3 passed`; `tsc` clean; eslint clean; touched Python files formatted.

- `C:/Users/Admin/sentinel/venv/Scripts/python.exe -m pytest backend/tests/test_timesheet_api.py backend/tests/test_timesheet_golden.py -q` — `63 passed`; golden July is zero-diff.
- `C:/Users/Admin/sentinel/venv/Scripts/ruff.exe check backend/` — `22` errors, all pre-existing and outside the touched timesheet files.
- `C:/Users/Admin/sentinel/venv/Scripts/ruff.exe format --check backend/app/api/v1/timesheet.py backend/tests/test_timesheet_api.py` — `2 files already formatted`.
- `cmd.exe /c "pnpm.cmd exec vitest run src/pages/timesheet/TimesheetGrid.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1 --reporter=dot"` — `42 passed` (existing React `act(...)` stderr warnings).
- `cmd.exe /c "pnpm.cmd exec vitest run src/locales/timesheet.i18n.test.ts --pool=forks --no-file-parallelism --maxWorkers=1 --reporter=dot"` — `361 passed`.
- `cmd.exe /c "pnpm.cmd exec vitest run src/components/access/UserPermissionsSheet.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1 --reporter=dot"` — `3 passed` (existing Radix `DialogContent` description warnings).
- `cmd.exe /c "pnpm.cmd exec tsc --noEmit -p tsconfig.app.json"` — clean.
- `cmd.exe /c "pnpm.cmd exec eslint src/pages/timesheet src/locales src/components/access"` — `0` problems.

## Concerns

Only pre-existing tool warnings remain: 22 repository-wide Ruff findings, React `act(...)` warnings in the existing grid suite, and Radix dialog description warnings in the existing permissions suite. No `eslint-disable` was added.
