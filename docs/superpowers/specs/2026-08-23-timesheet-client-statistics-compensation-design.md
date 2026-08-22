# Time Sheet Client Statistics Compensation

## Scope

Two focused changes:

1. Increase the expanded Time Sheet side glance from 210px to 400px. The collapsed rail remains 36px and an open bottom panel still removes the side column.
2. Correct the Main workbook's live Client Statistics derivation so it transfers real absence and leave codes instead of inventing Annual Leave below the contracted-post boundary.

Drivers retains its current derivation. Closed months retain their frozen statistics snapshot.

## Daily compensation rule

The calculation runs independently for every calendar day after the Main roster has been sorted into its existing rank order.

- The contracted-post boundary is fixed: rows 1 through `post_count` are above the line; later rows are below it.
- Eligible sources are above-line cells containing `AL`, `SL `, `AB`, or `TR`, considered from highest-ranked row to lowest-ranked row.
- Eligible targets are below-line cells containing `P`, considered from the first row below the line downward.
- Select as many sources as there are targets, preserving source rank priority. A source is changed to `P` only when it has a target.
- Sort the selected source codes by display priority: `AL`, then `SL `, then `AB`, then `TR`.
- Write those sorted codes into the eligible targets in row order. This keeps the lower block organized without claiming that the lower employee took the leave.
- Continue until either every movable source was transferred or no eligible target remains. A lower `P` may remain only when every movable source above has already been handled.
- Unmatched sources keep their real codes.
- Existing non-`P` cells below the line are never overwritten.
- `-`, `NG`, and manual red-block `X` cells never move and never change.
- The total number of each transferred code is conserved for that day; the derivation never invents leave.

Example with three contracted posts:

| Rank order | Attendance | Client Statistics |
|---|---:|---:|
| A | `SL ` | `P` |
| B | `AL` | `P` |
| C | `P` | `P` |
| D | `P` | `AL` |
| E | `P` | `SL ` |

With only row D available below, the higher-ranked A is protected first: A becomes `P`, D becomes `SL `, and B keeps `AL`.

## Architecture

The backend Time Sheet service remains the single source of truth. It derives all Main `stat_codes` for a day together after the raw attendance rows have been built. The API, web grid, and generated XLSX therefore receive the same values without duplicate frontend or export logic.

The existing live/frozen split remains intact: open Main months use the corrected derivation; sealed rows continue reading their stored snapshot. No schema or API-contract change is required.

## Verification

Focused service tests cover:

- rank-first source selection when targets are scarce;
- lower-block grouping by `AL`, `SL `, `AB`, then `TR`;
- surplus targets remaining `P` only after all sources move;
- unmatched sources retaining their real code;
- non-`P`, `-`, `NG`, and `X` targets remaining unchanged;
- Drivers retaining its current behavior;
- sealed Main months retaining their frozen output.

The existing Time Sheet page test will pin the expanded track at 400px and the collapsed track at 36px.