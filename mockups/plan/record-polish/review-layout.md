VERDICT: CONFIRMED

No blocking layout issues remain.

- **Applied corrections.** All of layout items 1–16 are applied, and item 18 is recorded as a known limit in §8. I checked each against the revised plan:
  - Aa-24 → drawer: §2, §7 assertion 8.
  - Identity refline replaces the chips row: S1.
  - Dock order More → primary, with More in decide and Mark up in the sheet: S2 and §7 assertion 5.
  - Phone status line: S1.
  - Registry fall-through, stable registration and the escape resolver: 3c.
  - `useRecordChrome`: 3i, and §4 contracts.
  - Paper width, with Fit = min(desk, `--paper-w`): §2 and S3.
  - ScanBackDock hidden by route: S2.
  - Extraction ranges `:1029-1386` / `:1245-1385`.
  - Inmate-reporter grid.
  - `hasActiveFilters`.
  - Always-on `['books','facets',true]` query.
  - RecordPane Open gate keeps the inmate branch.
  - Creator in list rows.
  - Creator names on `/books/awaiting` and `/books/awaiting-scan`.
- **Rejected items.** I accept all three:
  - **Item 17 (scoped projection).** The rejection is correct. `backend/app/api/v1/books.py:1155` sets `submitted_by_user_id=_context_user_id(context, "submitted_by_user_id")`, so exposing the creator's id and name is parity. My earlier claim was wrong.
  - **Item 6 (Esc order).** The plan follows proto:1114. The annotation composer is an editable target, so the global layer skips it and the composer handles Esc locally. That is acceptable.
  - **Item 8 (`xl` instead of `min-[1440px]` for 880).** Both choices hit the prototype's sample points: 1180 → 760 and 1440 → 880. The 1280 boundary lines up with the rail switch, where the desk at 1280 minus the 15rem rail still holds 880.
