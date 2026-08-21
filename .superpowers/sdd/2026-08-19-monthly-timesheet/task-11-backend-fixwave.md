Status: complete

Commits:
- `12750d9` — preflight both sheets before sealing
- `bfa43cd` — widen the workbook code dropdown to the paper's full code set
- `f21d278` — centralize sheet names, unknown-leave sentinel, month helper, filename encoding, and golden citation
- `5a2d5a7` — bound the filler lookback to the latest row per employee in SQL
- `db65257` — restore the existing atomic PATCH route body after a bad intermediate edit
- `f02c8a8` — format the backend fix-wave files
- Coexisting sibling commit: `4e14c5f` (UndoPinFix service/test changes)

Findings applied:

1. Export and `POST /close` now build every sheet before calling the unguarded service seal. Any blocking issue is reported with its `sheet`, employee, kind, and detail. The RED-first API test proves a clean main sheet cannot seal a blocked drivers sheet; both period and snapshot counts remain zero.
2. Chose widening. `_CODE_LIST` is now exactly `"P,AL,SL ,AB,TR,NG,-,R,S ,OFF,X"`, retaining the load-bearing `SL ` space and accepting every paper/footer code while `showErrorMessage=True` continues to reject unknown typed values. The validation regression test pins the complete list.
3. Renamed the service helper to `previous_month` and routed the employee span endpoint through `svc.previous_month`.
4. Exported `UNKNOWN_LEAVE` from `timesheet_codes` and imported it in the service; `leave_code` and warning detection share one sentinel.
5. `_attachment` now calls `quote(filename, safe="")`, encoding slashes from employee names as well as all other filename characters.
6. Added `TIMESHEET_MAIN`, `TIMESHEET_DRIVERS`, and `TIMESHEET_SHEETS` in constants; the service and workbook renderer use those names instead of duplicate literals.
7. `_fillers_by_employee` now uses one grouped SQL subquery with `MAX(year * 12 + month)` per employee, joining only the latest row at or before the requested month.
8. Corrected the golden test citation to `docs/superpowers/specs/2026-08-19-monthly-timesheet-design.md`.

Required RED output:

```text
$ python -m pytest backend/tests/test_timesheet_api.py -q -k preflights_both_sheets
F                                                                        [100%]
E       assert response.status_code == 422
E       assert 200 == 422
1 failed, 53 deselected
```

```text
$ python -m pytest backend/tests/test_timesheet_xlsx.py -q -k code_validation_is_a_quoted_literal_list
F                                                                        [100%]
E       assert validation.formula1 == '"P,AL,SL ,AB,TR,NG,-,R,S ,OFF,X"'
E       assert '"P,AL,SL ,AB,TR,NG,-,X"' == '"P,AL,SL ,AB,TR,NG,-,R,S ,OFF,X"'
1 failed, 27 deselected
```

Verification:
- Targeted acceptance modules: **179 passed**.
- Golden gate included in that run: **0 differing cells for July** (the golden tests passed).
- `ruff check backend/`: 22 errors, all pre-existing and none in the touched timesheet files.
- `ruff format --check` on all 8 touched backend files: clean.
- `mypy`: 30 pre-existing errors in 11 unrelated files; none in touched timesheet files.

Concerns: no backend-specific concerns remain. No migration, `openapi.json`, `api.types.ts`, or frontend source was changed by this wave. Concurrent frontend work and generated `backend/app/static/` remain outside this backend assignment and were not staged.
