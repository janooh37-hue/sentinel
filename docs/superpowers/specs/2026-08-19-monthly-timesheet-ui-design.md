# Monthly Time Sheet — UI design spec

Locks the look and the interaction model for route `/timesheet` (Task 7) and the
two surfaces Task 8 adds, so the React work in
`docs/superpowers/plans/2026-08-19-monthly-timesheet.md` has nothing left to
invent. The data model, the day-code engine, the statistics split and the API
are already settled in
`docs/superpowers/specs/2026-08-19-monthly-timesheet-design.md`; this document
does not revisit them. It covers tokens, type, layout, the button and fill
inventory, states, keyboard, bilingual behaviour, and the four directions the
mockups explore.

Mockups (open from disk, no build step):

| File | Direction |
| --- | --- |
| `docs/timesheet-mockup-a3-shell.html` | **A3 · Locked Shell — the design to build** (§16) |
| `docs/timesheet-mockup-a2-wide-ledger.html` | A2 · Wide Ledger — superseded by A3 (§15) |
| `docs/timesheet-mockup-a-paper-ledger.html` | A · Paper Ledger — the first pass |
| `docs/timesheet-mockup-b-focus-painter.html` | B · Focus Painter |
| `docs/timesheet-mockup-c-month-canvas.html` | C · Month Canvas |
| `docs/timesheet-mockup-d-close-out.html` | D · Close-out Flow |
| `docs/timesheet-mockups.css`, `docs/timesheet-mockups.js` | shared kernel: tokens, fills, fixture, grid renderer, code picker |

All of them run on the same fixture and the same control vocabulary, so a
reviewer is comparing layout and interaction, never styling.

**The fixture, and what each part of it is for:**

| Fixture fact | Why |
| --- | --- |
| 26 invented rows, 24 contracted posts | mirrors the live ratio (275 rows, 249 posts) closely enough that the statistics split and the daily headcount behave like the real month |
| 2 driver rows (rank 16) behind the Drivers control | the drivers workbook is a real deliverable; switching sheets re-derives row numbers and that workbook's own post count |
| July 2026 — open, 31 days | the working month: a 12-day annual leave, a 3-day sick leave, a full-month national service, a mid-month joiner, a departure tail, two single absences, 2 blocking checks and 3 warnings |
| June 2026 — closed, 30 days | proves the frozen state, the reopen confirm, and the blank day-31 column |
| August 2026 — open, drift | its first block-2 row is still `P`, reproducing the real July overshoot: implied posts reads 24.7 against 24, which fires the drift chip |
| Drivers sheet — no checks | the all-clear state and an enabled download, which the main sheet never shows in July |

Invented names and G-numbers only; nothing in the mockups is a live record.

---

## 1. What the page is for

One operator, twice a month at most, producing two workbooks that leave the
building: the HR attendance sheet for HQ and the statistics sheet for the
Judicial Department. The database already knows the answer for roughly 8,525
cells of 8,525; the operator's job is not data entry, it is **adjudication** —
read the month, override the handful of cells the records get wrong, confirm the
contracted post count, release the files, and accept that the month is then
frozen.

That shapes three requirements the visual design has to serve:

1. **Verification at a glance.** The screen must be comparable to the paper the
   client already holds. A code that reads differently on screen than in Excel
   costs trust that this feature exists to build.
2. **Correction in place, cheaply.** The common edit is a *run* — an annual
   leave the records ended two days early, so days 16–17 need repainting. Twelve
   separate menu round-trips is a bad answer.
3. **A legible point of no return.** The first download closes the month. That
   has to be visible before it happens and unmistakable afterwards.

## 2. Design thesis

> **The codes are the colour. Everything else is quiet.**

The workbook's own conditional formats — `#BDD7EE` annual, `#C6E0B4` sick,
`#FFC7CE` absence, `#CC99FF` national service, `#FF9900` not-yet-joined — are an
inherited, client-approved palette that already carries all the meaning on this
page. So the page spends its entire colour budget on data and keeps its chrome
to navy, cream and hairlines. This satisfies PRODUCT.md's restraint principle
without going austere: the grid is genuinely vivid, and it is vivid *because of
the facts in it*, not because of decoration. Nothing on the page is coloured
that is not a fact.

**Signature element:** the grid card wears the workbook's own header block —
`Global Security Service Group- MONTHLY  TIME SHEET`, `Client : JUDICIAL
DEPARTMENT`, `Clent Code : P0331_JD_PRN_908EXT`, `For the Month of :JUL-2026` —
quoted verbatim in mono, misspellings included, under a hairline `HEADER AS IT
PRINTS` label. It is the one piece of the design a reviewer will remember, it
takes twelve lines of markup, and it does real work: it tells the operator that
this screen is the deliverable, not a report about the deliverable.

Quoted text is never re-worded. The app's own labels beside it (`Designation`,
not the sheet's `Desigantion`) are spelled correctly — the misspellings are
preserved in the xlsx because those files are in circulation, not because the UI
should repeat them.

### Anti-defaults this design refuses

- No hero metric with a gradient accent. The month's headline number would be a
  lie anyway — 806 cells that are *mostly right* is not a KPI.
- No cream-and-terracotta editorial look, no acid accent on near-black, no
  broadsheet hairline pastiche. The palette is the existing GSSG token set plus
  the workbook fills; both were chosen by someone else, for good reasons.
- No numbered `01 / 02 / 03` structural markers except in direction D, where
  the content genuinely is a sequence (checks → corrections → posts → release).
- No new typeface. The app is packaged offline; `Inter`, `IBM Plex Mono` and
  `Noto Sans Arabic` / `Lenos` are what exist. Personality comes from treatment.

## 3. Tokens

### 3.1 Chrome — existing tokens only

No new chrome token. Surfaces `--surface` / `--surface-raised` /
`--surface-tinted`, ink `--text` / `--text-muted` / `--text-faint`, rules
`--border` / `--border-strong` / `--hairline`, brand `--primary` /
`--primary-soft`, status `--success` / `--warning` / `--accent` and their
`-soft` pairs. `--accent` (GSSG red) appears only on blocking checks, the drift
chip and the reopen action.

### 3.2 New tokens — the seven code fills

Add to `index.css` in both themes. Light is the workbook hex so screen and paper
agree; dark mixes the same hue into the surface and lifts the ink, because
`#FFC7CE` at full strength on `#131826` is a flashbang and `#FF9900` next to it
is worse.

| Code | `--code-*-fill` light | ink light | `--code-*-fill` dark | ink dark |
| --- | --- | --- | --- | --- |
| `P` | `transparent` | `--text` | `transparent` | `--text` |
| `AL` | `#bdd7ee` | `#10243a` | `color-mix(in oklab, #bdd7ee 24%, var(--surface))` | `#bdd7ee` |
| `SL ` | `#c6e0b4` | `#17300f` | `color-mix(in oklab, #c6e0b4 24%, var(--surface))` | `#c6e0b4` |
| `AB` | `#ffc7ce` | `#9c0006` | `color-mix(in oklab, #ffc7ce 26%, var(--surface))` | `#ff9aa6` |
| `TR` | `#cc99ff` | `#2e0b52` | `color-mix(in oklab, #cc99ff 26%, var(--surface))` | `#d9b3ff` |
| `NG` | `#ff9900` | `#3a2200` | `color-mix(in oklab, #ff9900 34%, var(--surface))` | `#ffbb55` |
| `-` | `transparent` | `--text-faint` | `transparent` | `--text-faint` |

Rules:

- **Components never carry a code hex.** A cell renders
  `data-code="AL"`; CSS resolves the pair. This matches the existing rule in
  `index.css` for the ledger rail gradients ("Semantic — never hardcode these
  hex in components") and it is what makes the dark-theme remap a one-file
  change. The `CODE_COLORS` map in the plan (Task 7 step 3) becomes this token
  block instead of a TS object.
- `AB` ink is the workbook's own `#9C0006`, and `AB` / `NG` cells render
  `font-weight: 600` — the two codes that mean "something went wrong" are the
  two that get weight.
- Every fill is paired with its letter. Colour is redundant encoding
  everywhere on this page (PRODUCT.md: never signal state by colour alone).
- A `.paper` scope keeps the exact hex on a white slab in both themes, used by
  the *As printed* legend so the operator can confirm what the client receives
  regardless of app theme.

### 3.3 Grid metrics

| Token | Compact | Default | Roomy |
| --- | --- | --- | --- |
| `--cell` | `22px` | `26px` | `34px` |
| `--row` | `24px` | `28px` | `36px` |
| `--cell-font` | `10px` | `11px` | `13px` |

The grid **deliberately opts out of the em-relative scale** documented in
DESIGN.md §1.2. Thirty-one columns is a fixed count; if the cell tracked the Aa
slider the sheet would stop fitting at the second stop. The Aa slider keeps
scaling the chrome; the sheet gets its own three-stop zoom control, which is also
the mental model the operator already has from Excel (the reference workbooks are
saved at zoom 70). Accessibility is served by the zoom control, not by
suppressing it.

## 4. Type

| Role | Family | Treatment |
| --- | --- | --- |
| Page title | `--font-sans` | `26px/700`, `-0.4px` tracking |
| Month datum | `--font-mono` | `30px/600`, `-1px` tracking, `07 · 2026`, Arabic month as a `14px` caption |
| Eyebrow, group headings, legend caps | `--font-sans` | `10–11px/600`, `0.12–0.18em` tracking, uppercase |
| Grid cells, day numbers, G-numbers, totals | `--font-mono` | tabular; the codes must be columnar or the eye cannot scan a row |
| Quoted workbook header | `--font-mono` | `11.5px`, `white-space: pre-wrap`, muted ink with the varying month in `--primary` |
| Body, labels | `--font-sans` | `12–13px` |
| Arabic | `--font-arabic` | switched by `:lang(ar)`, numerals stay Western per DESIGN.md §1.7 |

The month set as a mono datum rather than a heading is the one typographic
liberty taken: it is the page's subject, it is compared against a filename, and
`07 · 2026` beside `يوليو 2026` reads as an identifier rather than a title.

## 5. Layout

```
┌ TopNav (existing chrome) ─────────────────────────────────────────────────┐
│ MONTHLY DELIVERABLES · SITE JD 908                                        │
│ Monthly time sheet                                    07 · 2026  يوليو    │
│ Check the month, correct what the records got wrong,   [2 to fix] [Open]   │
│ then release the two workbooks.                                           │
├───────────────────────────────────────────────────────────────────────────┤
│ ( ‹  July 2026  › | All staff · Drivers | Attendance · Client statistics  │
│                                            | Sheet zoom S M L )           │
│ CODES  [P Working day p][AL Annual leave a][SL Sick leave s][AB …]   3 ↩   │
├───────────────────────────────────────────────────────────────────────────┤
│ Checks   2 fix before download · 3 worth a look                           │
│  ▌ Fix before download  G7099  No designation on file       Open employee ›│
│  ▌ Fix before download  G7099  Nationality has no mapping   Open employee ›│
│  ▸ 3 worth a look                                                         │
├───────────────────────────────────────────────────────────────────────────┤
│ ── HEADER AS IT PRINTS ────────────────────────  [Date Of Issued]         │
│ [GSSG] Global Security Service Group- MONTHLY  TIME SHEET  [Issue No]      │
│        Client : JUDICIAL DEPARTMENT   Site Name :   JD 908 [Révision]      │
│        For the Month of :JUL-2026                                         │
│ ┌─────┬──────┬───────────┬─────┬──────┬─1─2─3─…─31─┬─Total─Off─AB─AL─SL─TR┐│
│ │  #  │  ID  │   Name    │ Nat │Desig │ P P AL AL …│  24   -  1  12  3  - ││
│ └─────┴──────┴───────────┴─────┴──────┴────────────┴──────────────────────┘│
│   On post   25 25 24 24 23 …                        (per-day headcount)   │
├───────────────────────────────────────────────────────────────────────────┤
│ [Closed seal?] كشف حضور شهر يوليو.xlsx    The first download closes the    │
│                الاحصائية شهر يوليو.xlsx   month and freezes this grid.     │
│                        [↓ Download attendance sheet] [↓ Client statistics] │
├───────────────────────────────────────────────────────────────────────────┤
│ AS PRINTED  [P][AL][SL][AB][TR][NG][–]   SL␣ carries a trailing space      │
└───────────────────────────────────────────────────────────────────────────┘
```

Structure notes:

- Page shell follows the app: centred container, `px-7`-equivalent gutters,
  generous bottom padding. Max width goes to `1320px` here (the Dashboard's
  `1180px` cannot hold 31 columns plus the identity block).
- Reading order is the task order: what is wrong → the sheet → release. The
  release strip is last because it is irreversible.
- Frozen identity columns (`#`, ID, Name) and a sticky day header; the totals
  block (`Total day`, `Off`, `AB`, `AL`, `SL␣`, `TR`) mirrors the workbook's
  `AK..AP` and is separated by a 2px rule.
- A **per-day headcount footer row** sits under the grid. It is not on the
  paper, and it is the cheapest possible drift detector: a day that dips below
  the contracted post count is the visible form of "July overshot by 59".
- Rank-group heading rows label the sort order the client asked for. In the
  statistics variant they are replaced by the two block headings with the gap
  drawn.
- **A row is exactly one line high, always.** The table is `table-layout:
  fixed` with every column width declared on its header, and the identity
  columns clip with an ellipsis (full value in `title`). A wrapping name would
  make neighbouring rows different heights and destroy the vertical scan down a
  day column, which is the only reason the grid exists. Measured while building
  the mockups: one long name is enough to triple a row.
- **All 31 day columns render in every month.** The workbook's row 5 carries
  `1..31` always and leaves column `AJ` blank in a 30-day month, so the screen
  keeps the column, quiets its header, and renders an empty `aria-hidden`,
  untabbable cell. The grid therefore never reflows when the month changes.
- **A blocking check marks its row with a compact flag, not a chip.** The
  explanation lives in the checks list; the cell carries the value plus a 15px
  `!` marker whose `title` and `aria-label` state the problem. Measured while
  building the mockups: an inline `Myanmar · no English mapping` chip widened
  the 82px nationality column to 202px and pushed four day columns off screen.

## 6. Button and fill inventory

Every control on the page, mapped to its DESIGN.md §2 pattern. Anything not in
this table does not get a new style.

| Control | Pattern | Classes / notes |
| --- | --- | --- |
| Download attendance sheet | §2.5b primary pill | `bg-primary text-primary-foreground rounded-full px-4 py-2 text-[0.85em] font-semibold hover:bg-primary-hover`; `disabled:pointer-events-none disabled:opacity-50` while a blocking check is open and the month is still open |
| Download client statistics | §2.5b outline pill | `border border-border-strong bg-surface text-muted-foreground hover:bg-surface-tinted hover:text-foreground` |
| Reopen month | §2.5b outline pill, accent ink | `text-accent border-accent/40 hover:bg-accent-soft`; two-step — the click reveals an inline `Reopen` / `Cancel` confirm with the audit sentence. Never a bare destructive button, never a modal |
| Month `‹` `›` | §2.7c icon-button | `rounded-md p-1.5 text-muted-foreground hover:bg-surface-tinted hover:text-foreground`, `aria-label` per direction |
| All staff / Drivers · Attendance / Client statistics · Sheet zoom | **EXTENSION** segmented control | tinted-pill track from §2.7b: `bg-surface-tinted rounded-full p-0.5`; each option a pill, selected gets `bg-surface text-primary font-semibold shadow-sm` and `aria-pressed="true"`; focus ring offsets against the track (`ring-offset-surface-tinted`) |
| Code ribbon swatch | §2.5 pill, `aria-pressed` | glyph + name + `<kbd>`; pressed shows a primary ring. Reads as a legend, behaves as a brush |
| Grid cell | **EXTENSION** cell-as-button | see §7 |
| Preflight row | §2.3 row-as-button | `flex w-full items-center gap-3 rounded-sm px-3 py-2 text-start hover:bg-surface-tinted`, plus a 3px `border-inline-start` in `--accent` (blocking) or `--warning` (warning) and a level chip so the level is never colour-only |
| Undo last change | §2.4 inline button-link | `text-primary text-[0.85em] hover:underline`, `opacity-40` when the stack is empty |
| Employee name in a row | §2.3 row-as-button | navigates to the employee record |
| Post count | form field | mono, tabular, `border-border-strong rounded-sm`, `onChange` → `PATCH` |
| Warnings disclosure | §2.4 inline button-link | `▸ 3 worth a look` with `aria-expanded`; blocking checks are never collapsed, warnings always are |
| Row flag | non-interactive marker | 15px `--accent` disc with a mono `!`, `role="img"` + `aria-label` + `title` naming the check |
| Status / count chips | pill, not a button | `chip ok` / `warn` / `stop` / `info`; always text + shape, e.g. `▲ 24.7 / 24` |
| Closed seal | non-interactive | `success-soft` pill with a ringed `✓` and the close stamp |

Fill discipline:

| Surface | Fill |
| --- | --- |
| Page background | `--bg` |
| Cards, grid body, frozen columns | `--surface` |
| Day header, totals block, group headings, footer | `--surface-raised` |
| Row hover, segmented track, `kbd` | `--surface-tinted` |
| Armed / selected row | `--primary-soft` |
| Grid cells | `--code-*-fill` only |
| Blocking / warning rows | `color-mix(--accent-soft | --warning-soft 55%, --surface)` |
| Printed-fidelity legend | `.paper` — white with the exact workbook hex |

Nothing else gets a background. In particular the grid does **not** stripe
alternate rows: with seven fills in play, zebra striping fights the data.

## 7. The cell — a new pattern (DESIGN.md §2.9 candidate)

806 buttons on one screen is a pattern DESIGN.md does not yet have. It is the
dense sibling of §2.3 row-as-button:

```
display:block; inline-size:100%; block-size:var(--row);
font-family:var(--font-mono); font-size:var(--cell-font); font-weight:500;
border:0; border-radius:3px; text-align:center; cursor:pointer;
background:var(--code-*-fill); color:var(--code-*-ink);
hover:        box-shadow: inset 0 0 0 2px var(--primary);
focus-visible: box-shadow: inset 0 0 0 2px var(--primary), inset 0 0 0 4px var(--surface);
```

Decisions, and why:

- **Inset rings, not offset rings.** An outset ring (§2.2, §2.3) is clipped by
  the neighbouring cells and reads as a smear across the row. Inset is the only
  ring geometry that survives a dense grid.
- **No hover lift, no shadow.** 806 lifting targets is nausea. The hover
  affordance is the ring alone.
- **The letter is the accessible name's core.** `aria-label` is
  `"G7057 day 14 — annual leave"`, which also satisfies the Task 7 test
  (`{ name: /G1001 day 3/i }`).
- **Edited cells are marked structurally**, not just by fill: a 1px primary
  inset ring plus a 4px corner dot, so an override is visible as an override
  even in the statistics variant where the fill has been rewritten.
- **A 30-day month's day-31 column renders an empty, `aria-hidden`,
  untabbable cell** — the column stays in place so the grid does not reflow
  between months, and it is not a target.
- **Commit feedback is a 120ms `scale(0.82) → 1`**, under the
  `prefers-reduced-motion` guard. That is the whole motion budget for editing.

## 8. Correcting cells

Two mechanisms, both operating on the same cells:

1. **Picker** (discoverable). Click a cell → a `role="menu"` of the seven codes
   with a keyboard hint each, plus `Clear cell`. `AB` swaps the menu body for an
   optional note field with `Save` / `Cancel`, matching the plan's
   `onSetCell(employeeId, day, code, note?)` contract. Escape and outside-click
   close; the menu flips above the cell near the viewport edge and mirrors in
   RTL.
2. **Brush** (fast). Click a ribbon swatch to arm a code — `aria-pressed`, and
   the keys `p a s b t n -` do the same from the keyboard. With a brush armed a
   click paints one day and **shift-click paints the inclusive run** from the
   last painted day, which turns a 12-day annual leave into two clicks. The
   range toast names what happened (`G7057 · day 6–17 — AL`).

Keyboard model: `Tab` reaches the grid, arrows move within it (`ArrowLeft` /
`ArrowRight` follow the reading direction and therefore invert in RTL), a code
letter paints the focused cell immediately, `Enter` / `Space` opens the picker,
`Escape` closes it, `Ctrl+Z` undoes. A repaint must not eat focus: the focused
cell is restored after every re-render.

Every mutation is optimistic with a rollback on error, and the change counter
(`3 corrections this month`) plus `Undo last change` give the operator a way
back that does not require finding the cell again.

## 9. States

| State | Treatment |
| --- | --- |
| Loading | Skeleton rows at the real metrics — the identity block and 31 columns are already known, so the grid must not resize when data lands |
| Empty roster | `EmptyState` with the reason (`No one was employed at JD 908 in this month`) and a month stepper, not a shrug |
| Blocking check open | Downloads disabled with the reason stated *next to the disabled button*, not only in the banner; the banner rows link to the employee that fixes it |
| Warnings only | Downloads enabled; warnings collapse behind a count so the grid stays above the fold |
| Saving a cell | Optimistic fill + commit animation; failure re-fills the old code and toasts the reason |
| Statistics variant | Two blocks with the two-row gap drawn, continuous row numbering across it, post-count field, implied-post readout; cells are read-only in this variant — the statistics grid is derived, and the fix belongs in the attendance grid or the filler assignment |
| Implied posts above contract | `chip stop` naming the drift (`▲ 23.5 / 18`) with the one-line rule: at or below the contract is correct, above it means block-2 rows are still `P` |
| Closed | `html[data-locked="1"]`: no edit affordances anywhere, seal in the release strip with who closed it and when, downloads become re-downloads, reopen behind the two-step confirm with the audit sentence |
| Reopened | Toast and a persistent line: *a new download supersedes the file already sent* |

## 10. Bilingual and RTL

- Every string in a nested `timesheet` namespace in both locale files; parity
  enforced by `timesheet.i18n.test.ts`.
- Logical properties only. The consequence to accept deliberately: **the day
  axis mirrors in Arabic** — day 1 sits at the reading-start edge, so it is on
  the right in RTL. That is the correct behaviour for a native Arabic layout,
  and it is what logical properties give for free; the printed workbook keeps
  day 1 in column `F` regardless, and the *As printed* legend is the bridge.
  Arrow keys follow the same rule, which is why `ArrowRight` decrements the day
  in RTL.
- Numerals stay Western in both languages (DESIGN.md §1.7).
- The designation column shows `name_en` in the attendance variant and
  `name_ar` in the statistics variant *regardless of UI language*, because that
  is what each workbook prints. This is the one place where the column does not
  follow the interface language, and it needs the caption to say so.
- Arabic copy is formal and instructional, matching PRODUCT.md: `راجع الشهر،
  صحّح ما أخطأت به السجلات، ثم أصدر الملفين.`

## 11. Copy

Written from the operator's side of the screen, active voice, action names that
survive the whole flow.

| Element | English | Arabic |
| --- | --- | --- |
| Title | Monthly time sheet | كشف الحضور الشهري |
| Lede | Check the month, correct what the records got wrong, then release the two workbooks. | راجع الشهر، صحّح ما أخطأت به السجلات، ثم أصدر الملفين. |
| Checks, blocking | Fix before download | يجب إصلاحه قبل التنزيل |
| Checks, warning | Worth a look | يستحق المراجعة |
| All clear | Every check passed. Both workbooks are ready. | اجتازت جميع الفحوصات. الملفان جاهزان. |
| Freeze warning | The first download closes the month and freezes this grid. | أول تنزيل يغلق الشهر ويثبّت هذه الشبكة. |
| Closed | Closed on 01 Jul 2026 by A. Al Mansoori · the grid is frozen as printed. | أُغلق في ٠١ يوليو ٢٠٢٦ بواسطة أ. المنصوري · الشبكة مثبتة كما طُبعت. |
| Reopen consequence | A new download supersedes the file already sent. | أي تنزيل جديد يلغي الملف المُرسل. |
| Actions | Download attendance sheet · Download client statistics · Reopen month · Undo last change · Clear cell | تنزيل كشف الحضور · تنزيل إحصائية العميل · إعادة فتح الشهر · تراجع عن آخر تغيير · مسح الخلية |

No apologies in errors, no exclamation marks, no emoji on this page. (The
Services tiles keep theirs — that is wayfinding for a wall of forms, which this
page is not.)

## 12. The four directions

Each mockup is a complete answer to §1, differing in what it optimises.

### A · Paper Ledger — recommended

The workbook, on screen: frozen identity columns, 31 day columns, the totals
block, the quoted header, the headcount footer. Corrections happen in place via
the picker or the brush.

- **Optimises** verification and the operator's existing muscle memory — this is
  the artefact they have been maintaining by hand all year.
- **Costs** density. Editing is precise clicking, and 275 live rows means the
  roster scrolls.
- **Risk** it is "just a table". Mitigated by the quoted header, the ribbon and
  the headcount footer, which are the three things a plain table would not have.

```
[controls][ribbon]
[checks: blocking open, warnings collapsed]
[quoted header]
[#][ID][Name][Nat][Desig][1..31][totals]   ← frozen left, sticky top
[On post 25 25 24 …]
[release: two files, two buttons, freeze warning]
[as printed legend]
```

### B · Focus Painter

A roster rail — search, rank groups, and a 31-bar mini heat strip per person —
beside one employee's month blown up into paintable day tiles, with a change
log.

- **Optimises** the actual edit. The mini-heat lets an operator find the right
  person by the *shape* of their month; the tiles make a range trivial.
- **Costs** the month-wide view. Two surfaces must agree.
- **Risk** the rail becomes the page and the sheet becomes secondary, which
  inverts the deliverable.

```
┌ rail ─────────┬ focus ─────────────────────────────┐
│ search        │ G7057 · SECURITY GUARD · India     │
│ ▸ rank group  │ [ribbon p a s b t n -]  3 edits ↩  │
│  name  ▇▇▁▁▇  │ W1 1..7   W2 8..14  W3 …           │
│  name  ▇▇▇▇▇  │ P 24 · AL 12 · SL 3 · AB 1         │
│  name  ▁▁▇▇▇  │ change log: day 6–17 → AL     ↩    │
└───────────────┴────────────────────────────────────┘
```

Landed in the mockup and worth keeping: working days render as a 4px baseline
bar and only exceptions run full height, so the silhouette reads without
colour; the rail is one tab stop for 26 rows (roving `tabindex`, arrows plus
Home/End move the selection); and the change log groups by contiguous run, so
one undo peels back a whole 5-day range instead of five presses.

### C · Month Canvas

The whole roster-month as one dense colour field with a rank gutter, a per-day
headcount sparkline, and a lens that opens an editable slab over the hovered or
focused band.

- **Optimises** anomaly and drift detection across the entire roster — the
  failure mode that shipped a wrong July file.
- **Costs** legibility of individual facts; the canvas is not readable text, so
  it needs a text alternative to stay accessible.
- **Risk** at 275 rows this needs virtualization, which the plan explicitly
  defers ("only reach for `@tanstack/react-virtual` if 275 rows measurably
  drag").

```
[day axis 1..31]
rank ▏████░░████████░░░░████  ← 26 rows × 31 blocks, read-only
     ▏████████████████████
[sparkline: per-day headcount, low days flagged]
[lens: rows 12–16, editable slab]
```

Landed in the mockup and worth keeping: the lens **pins** on click so the
pointer can travel into the grid without the band sliding away (hover only
previews); the day curve draws one neutral bar per day against a dashed
contract line, so the reading is a shape rather than a hue, with short days
capped in accent *and* labelled; and `Next of 4` walks every `AB` / `NG` / `-`
run in printing order, opening the lens and focusing the offending cell.
Because a 10px block has no room for a letter, `P` needs a body of
`var(--border)` in this direction — the one place the "letter carries it" rule
does not hold.

### D · Close-out Flow

The month as four steps on a sticky spine — Checks, Corrections, Contracted
posts, Release — with the grid living inside step 2 and the two deliverables
presented as documents in step 4.

- **Optimises** the ritual and the freeze semantics. Nobody downloads before the
  checks are read; the seal and the reopen confirm are unmissable.
- **Costs** directness. A re-download is four steps away unless the spine is
  jumpable (it is).
- **Risk** wizard fatigue for a monthly task the operator will know by heart in
  three months.

```
① Checks        ✓ clear
② Corrections   3 corrections   ← the grid lives here
③ Posts         18 · implied 17.6
④ Release       [كشف حضور شهر يوليو.xlsx] [الاحصائية شهر يوليو.xlsx]
```

Landed in the mockup and worth keeping: three genuinely different marker shapes
(filled disc / 2px ring / 1px dashed ring) paired with the words Done, Now and
Waiting plus a count, so step state survives greyscale; and Arabic number
agreement in the counters (1 singular, 2 dual, 3–10 plural, 11+ singular
accusative) — `1 corrections` and `2 صفًا` were both wrong before it.

### Recommendation

**Build A, and take three things from the others:**

1. **B's ribbon-as-brush and shift-click range**, on A's grid. This is the one
   idea that changes the cost of the real task, and it needs no second surface.
2. **A's headcount footer plus D's implied-post readout** instead of C's
   canvas. Between them they catch the July drift at a tenth of the cost, and C
   can be revisited if virtualization lands for another reason.
3. **D's release strip** — two named files, the freeze sentence, the seal, the
   two-step reopen — as A's bottom section, without the spine. The ceremony is
   worth keeping; the wizard is not.

C is deferred, not rejected: if the roster ever spans multiple sites, the canvas
is the right way to compare them.

## 13. Acceptance for the built page

- Grid renders all 31 day columns in every month, blanks and un-tabs the days
  the month does not have, and does not reflow between months.
- Cells carry `data-code`; no code hex appears in any `.tsx`.
- Downloads disabled while `preflight.blocking` is non-empty and the month is
  open; the reason is rendered beside the disabled button.
- First download closes the month; the closed grid offers no edit affordance and
  reopen requires the two-step confirm.
- Statistics variant shows both blocks, the drawn gap, continuous numbering, the
  post-count field and the implied-post readout with the drift rule stated.
- Keyboard: arrows traverse the grid in the reading direction, code letters
  paint, `Escape` closes the picker **and returns focus to the cell it was
  opened from**, focus survives a repaint.
- `aria-label` on every cell in the form `"<id> day <n> — <meaning>"`; every
  fill paired with its letter; `prefers-reduced-motion` honoured.
- Verified in EN/LTR and AR/RTL, light and dark, at all three sheet zooms, then
  reviewed by `i18n-rtl-reviewer` per AGENTS.md.

## 14. Traps measured while building the mockups

Each of these cost a debugging round in a 900-line static file; they will cost
more in React. None is hypothetical.

| Trap | What happens | Rule |
| --- | --- | --- |
| `@media (max-inline-size: …)` | No engine ships it, so the query never matches and the responsive collapse silently never fires | Media queries use `max-width`; a viewport is physical. Keep *layout* logical |
| `direction: ltr` on a flex container | Mirrors the children back and resolves `margin-inline-start: auto` to the wrong side | Isolate the numeric **leaf**, never the container |
| `unicode-bidi: isolate` alone on a filename | Base direction is inherited (`<bdi>` resolves RTL from the first Arabic character), so `.xlsx` jumps to the wrong end | `direction: ltr` + isolate for a quoted filename |
| `letter-spacing` + `uppercase` on Arabic | Tears joined letters apart; there is no uppercase | Neutralise on `:lang(ar)`, never on `html[lang="ar"]` — the attendance sheet's designations are English inside an Arabic page |
| `max-inline-size: 0` on a table cell | Collapses the column to its minimum, even with `inline-size` declared | Declare widths on the header row and use `table-layout: fixed` |
| `pointer-events: none` for a read-only cell | Blocks the pointer but not `Enter` / `Space` | Guard the activation in a capture-phase listener, or do not render the control |
| A wide chip inside a narrow column | Column grows and pushes day columns off screen | Value plus a compact flag in the cell; the sentence lives in the checks list |
| `requestAnimationFrame` for coalesced repaints | Never fires in a hidden or background tab, so state and DOM silently diverge | Coalesce with a task, not a frame |
| `:root` vs `html` for a token override | `:root` is a pseudo-class (0,1,0) and outranks `html` (0,0,1) whatever the source order, so the override silently loses | Override kernel tokens on `:root` |
| A handler closing over the selected record | A change event repaints on the next task; a click landing in between writes to the *previous* selection | Read the selection at event time, never from the render closure |

---

## 15. Revision A2 — the selected direction

Direction A reviewed as the right spine, with eight changes. All of them are in
`docs/timesheet-mockup-a2-wide-ledger.html`; the xlsx template and the renderer
are untouched.

| # | Change | How it is built |
| --- | --- | --- |
| 1 | **Screen wide.** The grid takes the whole viewport instead of a 1320px column | `.page { max-inline-size: none }` and `--cell: clamp(26px, calc((100vw - 600px) / 31), 46px)`. 600px is the frozen identity block (568px) plus the gutters; the rest divides by 31, so all 31 columns land on screen from ~1560px up and the sheet scrolls internally below that. Never under 26px (unreadable) or over 46px (the row stops scanning as one line) |
| 2 | **Cell by code, from C.** Every working day carries a quiet body, so the month reads as a field rather than a page of letters | `button.cell[data-code="P"]` gets `--surface-tinted` (`--surface-raised` in dark). The five exception fills still carry all the weight, and the letter still carries the meaning. C's whole-workbook **Cells by code** tally comes with it as a panel under the grid |
| 3 | **Drag to fill.** Sweep across days *and* rows to fill a rectangle | Pointer-based, previewed with a ring and a live count that follows the cursor, committed once on release — a mid-gesture repaint would tear the cell out from under the pointer. With a code armed the drag fills that code; with nothing armed it fills the code of the cell it started from, which is the spreadsheet reflex. `Escape` cancels. The trailing click is swallowed so it cannot also open the picker |
| 4 | **Row counts on hover.** Hovering or focusing a row shows that employee's per-code counts | A `role="status"` box anchored to the row: `P 19 · AL 12 · SL 0 · AB 0 · TR 0 · NG 0 · – 0 · X 0`, zero pairs dimmed. Focus works as well as the pointer, and the box follows the row through the scroll that focusing a cell causes instead of being destroyed by it |
| 5 | **Two-month employee extract.** Select one employee, export his sheet for the month of departure **and the month before it** | A `<select>` is the accessible control; clicking a name in the grid is the shortcut. The card states both months, prints both Arabic filenames, and derives "off roster from day 18 — last worked day 17" from the roster edge |
| 6 | **The red block.** A manual code for days inside the roster but outside the billing window | New cell value `X`, fill `#990033` with white ink — already the client's termination fill, so nothing new is invented. It survives the statistics transform exactly like `NG` and `-`: an unbilled day is never presented to the client as a manned post. A helper does the common case in one click — *Bill starts on day 23* → red block 1–22 of the month on screen, skipping roster edges, which outrank a block |
| 7 | **No totals columns on screen.** `Total day`, `Off`, `AB`, `AL`, `SL␣`, `TR` come off the grid | `renderSheet({ totals: false })`. The workbook still prints the `AK..AP` `COUNTIF` block — the columns are gone from the screen only, and change 4 puts the same six numbers a hover away |
| 8 | **Template unchanged.** The quoted header, the column widths, the footer and the formulas are exactly as they were | The header band is still a verbatim quotation, misspellings included |

### Backend consequences of A2 — these are not UI-only

1. **`X` is an eighth emitted code.** `timesheet_codes.EMITTED_CODES` currently
   allows `P, AL, SL , AB, TR, NG, -`. A red block reaches the workbook as a
   manual `timesheet_overrides` row, so: allow `X` as an override value, add its
   conditional-format fill (`#990033`, white font) in `timesheet_xlsx`, and add
   one legend row to the footer block. The golden reproduction tests are
   unaffected — June and July contain no `X` — but the footer row count in
   `test_timesheet_template.py` moves from 18 to 19.
2. **`X` must not be counted as presence.** It is excluded from the `AK`
   `COUNTIF(...,"P")` by construction, and the statistics generator must treat
   it as a survivor beside `NG` / `-`, or the client is billed for days the
   contract does not cover.
3. **The employee export takes a span, not a month.** The spec's
   `GET /api/v1/timesheet/employee/{id}/{year}/{month}/export` becomes
   `…/export?months=2` (or an explicit `from`/`to`), returning two sheets —
   HR asked for the month of departure and the one before it. Filenames stay on
   the agreed pattern: `كشف حضور <name> <month>.xlsx`, one per month.
4. **Per-row totals stay in the renderer.** Nothing about change 7 touches the
   workbook; a test that asserts the screen shows the totals block would be
   wrong, a test that asserts the *file* does is required.

---

## 16. Revision A3 — the design to build

A2 plus five changes, all in `docs/timesheet-mockup-a3-shell.html`. A2's
seven changes (§15) all carry forward unchanged.

### 16.1 The page does not scroll — only the grid does

The complaint was concrete: reaching the release actions meant scrolling past
275 employees. Neither offered option was quite right on its own — moving the
widgets to the top pushes the grid below the fold, and a "scroll to bottom"
affordance fights the roster's own scrolling. So the page becomes an **app
shell**:

```
[TopNav]                                            fixed
 head    title · month · search · status            fixed
 bar     month ‹ › · roster · deliverable · zoom    fixed
 ribbon  codes · hint · corrections · undo          fixed
 notice  2 to fix · 3 to review · 1 new · 1 leaving · 1 removed   fixed
 ┌ grid ──────────────────────────────────────────┐ flex: 1
 │ the ONLY scroll region on the page             │ min-block-size: 0
 └────────────────────────────────────────────────┘
 dock    posts · codes · employee · downloads      fixed, 54px
```

`body { overflow: hidden }`, the shell takes the remaining viewport, the sheet
wrapper is `flex: 1; min-block-size: 0`. Nothing below the grid can ever be
scrolled away from, and the roster scroll is untouched. Verified: page
`scrollHeight === clientHeight` at 1760, 1280 and 900px, dock bottom inside the
viewport in every case, in both directions.

### 16.2 The dock, and panels instead of stacked cards

The three cards that used to sit under the roster become one 54px dock of four
groups, each a button that opens a panel **upward over the grid** — so opening
one costs no layout shift and no scrolling:

| Dock group | Reads at a glance | Panel |
| --- | --- | --- |
| Contracted posts | `24 · 23.1 ✓` | post-count field, implied-post readout, the two-block rule |
| Codes | all 8 counts inline: `P 716 · AL 20 · SL 3 · AB 2 · TR 31 · NG 20 · – 14 · X 0` | full tally with share bars |
| Employee sheet | `G7301 · 2 months` or `⌕ search` | the picker (§16.3) plus the two-month extract and the red-block helper |
| Files + downloads | the two download buttons, always live | filenames, freeze sentence, seal, two-step reopen |

The notice line does the same for checks and roster movement. `Escape` closes
any panel; the dock buttons carry `aria-expanded`.

### 16.3 Search by G-number, with a picker

A search field in the head (always visible) and the same field inside the
panel. Matching is deliberately forgiving: `7141`, `g7141`, `G7141`, `rasel`, or
a designation in either language all find the row. Two panes, following
`ReferencePicker` (`frontend/src/components/ledger/ReferencePicker.tsx`):
results on the reading-start side, a **preview** on the other — name, G-number,
designation, nationality, printed row number, all eight code counts, the
new/leaving badge, and the actions (`Show in grid`, `Extract · 2 months`, red
block). `ArrowUp`/`ArrowDown` move the cursor, `Enter` selects, selecting
scrolls the row into the centre of the grid and highlights it.

### 16.4 A new employee raises a starting-point flag

A joiner is not a blank row: every day before he started is `NG`, and the
operator is told so rather than left to notice it.

- The roster edge is **data**, not painted cells: `JOINERS`/`LEAVERS` in the
  fixture, applied after leave so edges outrank it — the engine's own precedence.
- The row carries a badge (`new`, then `from 12` once confirmed), the notice
  line counts them, and the checks panel states it in words: *"Started on day 12
  of July — days 1–11 are NG until you say otherwise"* with **Confirm starting
  point** and **Show row**.
- Verified: adding `AHMED BILAL NOOR` from day 12 produced `NG×11` then `P`,
  the flag, and the notice count; confirming flipped the badge and the chip.

**Scope call, needs your sign-off:** the mockup's inline *Add employee* is a
demonstration of the trigger. In the app, creating an employee belongs to the
Employees page — the time sheet's job is to **detect a date of joining inside
the month and flag the starting point**, then link to the record. I recommend
the timesheet page keep the flag and the confirm, and its add button open the
existing create flow rather than owning a second one.

### 16.5 A leaver is off the next month, on both deliverables

Already the roster rule (`doj <= month_end AND (end_date IS NULL OR end_date >=
month_start)`); A3 makes it observable, because "he must not appear on the next
invoice" is the part that costs money when it goes wrong.

- In his final month: `-` after the last worked day, a `to 17` row badge, and a
  *Leaving* line reading *"off roster after it, and off next month's sheet
  entirely"*.
- In the month after: he is absent from the roster, and the notice line reports
  *"1 removed from the sheet"* with the reason — *"Finished on day 17 of June, so
  he is not on this month's attendance sheet or statistics"*.
- Verified across the fixture: June 26 rows → July 25 (G7169 gone) → August 24
  (G7141 gone), on both the attendance and the statistics variant.

### 16.6 Backend consequences of A3

1. **Nothing new for the leaver rule** — it is the roster query already in the
   spec. What is new is the *report*: the grid response needs the previous
   month's departures (`removed: [{employee_id, name, end_date}]`) so the page
   can state who dropped off and why. Cheap: one extra query on the same period.
2. **New-hire flags come from `doj` inside the month.** Add
   `joined_day` to the grid row payload (null unless `doj` falls inside the
   month) plus a per-period `confirmed_starts` set — the confirmation is an
   operator acknowledgement, so it wants a column on `timesheet_periods` or a
   small `timesheet_start_acks` table. It is not a correction and must not
   create an override row.
3. **The picker needs no new endpoint** — the grid response already carries the
   roster; search is client-side over 275 rows.
4. Unchanged from §15.3: the employee export takes a two-month span, and the red
   block `X` needs its legend row and conditional format.

### 16.7 What locking A3 means

Build `TimesheetPage` as this shell: fixed head/bar/ribbon/notice, one scrolling
grid, one dock with four panels. Everything in §§3–11 still applies — tokens,
the cell-as-button, the segmented control, the copy table, the RTL rules and the
traps in §14 are the same. Sections 12 and 15 stay as the record of how the
design got here.
