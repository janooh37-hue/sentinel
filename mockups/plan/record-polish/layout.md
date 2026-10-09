# Record page: responsive layout and surface parity (tab: `layout`)

Read-only audit. Paths are relative to `frontend/src/` unless they start with `backend/`. Abbreviations:

- **BRP**: `pages/books/BookRecordPage.tsx`
- **BP**: `pages/books/BooksPage.tsx`
- **RP**: `pages/books/RecordPane.tsx`
- **RPV**: `pages/books/RecordPaperViewer.tsx`
- **RL**: `pages/books/RecordsList.tsx`
- **BWA**: `components/books/BookWordActions.tsx`
- **BDD**: `components/books/BookDetailDrawer.tsx`

Three Sonnet subagents produced the raw findings. I checked every claim listed below against the code. Items marked `[INFERENCE]` were worked out from the CSS but not rendered in a browser.

## 0. Breakpoint facts (current)

| Mechanism | Value | Evidence |
|---|---|---|
| Tailwind breakpoints | v4 defaults: `sm` 640, `md` 768, `lg` 1024, `xl` 1280, `2xl` 1536. There is no `--breakpoint` override. | `package.json` `tailwindcss ^4.3.0`; `index.css` has no `--breakpoint` |
| JS mobile switch | `useIsMobile()` is `(max-width: 767px)`, so it lines up with `md` | `lib/useIsMobile.ts:3` |
| TopNav tiers | Brand copy is hidden below 1560px; link labels are hidden below 1240px. This is plain CSS and unrelated to the page grid. | `index.css:816-850` |
| Aa font scale | Root font size is 16, 19, 22 or 24px. Every `rem` size scales with it. | `lib/theme.ts:20`, `index.css:778-788` |
| Media queries vs Aa | `@media` rem is resolved against the browser's initial 16px, **not** the root font size. Breakpoints therefore never move when Aa is raised, but `15rem` rails grow 1.5× at Aa 24. Container queries resolve `rem` against the root, so they do track Aa. [INFERENCE: from the CSS spec; not tested here] | — |
| Container queries in use | None (no `@container` anywhere in `src`) | grep |

## 1. Findings

Width columns: P = phone <640, T = tablet 640–1024, L = laptop 1024–1440, D = desktop ≥1440. `md` (768) splits T into a mobile half and a desktop half.

| id | Problem | Evidence | P | T | L | D | Sev |
|---|---|---|---|---|---|---|---|
| L1 | **There is no Delete on a phone, and no Delete on the record page at any width.** The only record deletes are (a) the bulk-delete bar on the desktop list and (b) Discard inside `BookPreview`, which opens only from RecordPane's "Continue editing". The mobile card has no checkbox and no delete. | BRP Tools menu `1250-1384` (no `deleteBook`). BP `571-595` (bulk bar, inside `isDesktop` branch `:408`). `BookPreview.tsx:193-199` is triggered only by BP `:610`. `BookMobileCard` BP `848-929`. The only `api.deleteBook` callers are BP `:334` and `BookPreview.tsx:58`. | ✔ | ✔ | ✔ | ✔ | high |
| L2 | Draft Discard is gated on `books.edit`, but the backend requires `books.delete`, so an edit-only user sees a button that returns 403. | `BookPreview.tsx:71` (`canDiscard = !isInmateReporter && canEdit`) vs `backend/app/api/v1/books.py:1497` (`require_capability("books.delete")`) | | ✔ | ✔ | ✔ | med |
| L3 | **On a phone, a draft record is a dead end.** A card opens `/books/:id`, and BRP has no Continue editing or Discard for state `none`. Those actions exist only in RecordPane → BookPreview. | BP `239-245` (`openBook`). RP `212-221` (`continue`). BP `:610`. | ✔ | ✔ (<768) | | | high |
| L4 | Scans and executed copies can't be viewed, downloaded, replaced, deleted or added from BRP. The paper switcher, zoom, full preview and "Add scan" live only in RecordPane, which is desktop-list-only. | RP `268-281`, `327-350`, `533-567`; RPV `193-307`; BRP has no `attachment`/`papersOf` | ✔ | ✔ | ✔ | ✔ | high |
| L5 | "Add to email" (basket) exists only on the desktop pane and the desktop bulk bar. The phone has only Tools → Email via Outlook, which behaves differently. | RP `403-407`; BP `576-582`; BRP `1271-1283` | ✔ | ✔ (<768) | | | low |
| L6 | On a phone, Tools shows "Edit in Word (creates a new version)" disabled with no reason. The "needs a PC" hint is rendered only by the hidden trigger. | BWA `163-164` (`disabled = isMobile === true`), hint BWA `205-209` suppressed by `hideTrigger` BRP `1112` | ✔ | ✔ (<768) | | | low |
| L7 | The workflow bar promises "always labelled — never icon-only", yet Word **Finish** and **Discard** (Discard voids the book) are 36px icon-only buttons. | BRP comment `1149-1153` vs BWA `95-115` | ✔ | ✔ | ✔ | ✔ | med |
| L8 | Tools is the desktop Radix popover on every width. On a phone it holds up to 11 items with ~36px rows (`py-2 text-[0.84em]`), and its trigger is the last control of the 3rd–4th header row. | BRP `1245-1384`; `components/ui/dropdown-menu.tsx:77` | ✔ | ✔ | | | med |
| L9 | **The phone header permanently eats the paper's height.** The page root is `overflow-hidden` and only the desk scrolls, so these are all always on screen: row 1 (back · queue · identity), the chips row (`basis-full`), the workflow bar (`w-full`), the utility row (Mark + Tools, `w-full`) and the `<details>` progress strip. That is ≈210–250px. [INFERENCE] | BRP `1013`, `1029`, `1095`, `1160`, `1245`, `1494`, `1539-1542` | ✔ | ✔ (<768) | | | high |
| L10 | The phone dock appears only for `decide`. Revise, Send for approval, Scan signed and Word stay in the header bar, so phone users get a dock for one state and a header for the rest. | BRP `1670-1671` (`isMobile && action==='decide'`) | ✔ | ✔ (<768) | | | med |
| L11 | The decide dock (z-40) and `ScanBackDock` (z-30) sit in the same bottom band, so ScanBackDock is covered on phone. [INFERENCE: ScanBackDock renders only when it has items] | BRP `1679` `bottom-[calc(5.5rem+var(--safe-bottom))] z-40`; `pages/scanBack/ScanBackDock.tsx:107-122` (same bottom, `z-30`, `end-4`) | ✔ | ✔ (<768) | | | low |
| L12 | **The "one row from lg" header intent is defeated by DOM order.** The workflow bar is `w-full` and comes *before* the Mark+Tools div, so whenever a workflow bar exists (decide, review, revise, submit, scan, Word) the header is 3 rows at ≥lg. | BRP comment `1022`; bar `1160`; utility `1245` (`lg:ms-auto lg:w-auto` cannot rejoin row 1) | | | ✔ | ✔ | high |
| L13 | **768–1023 is a hybrid.** JS and `md:` switch to desktop (decide triple in the header, 236px aside, reason strip), but the header only goes horizontal at `lg:`. The result is a 4-row header, a wrapping h1 and a ~484px paper at 768. | BRP `1062` (`lg:min-w-[18rem]`), `1069` (`lg:truncate`), `1095` (`basis-full … lg:basis-auto`), `1245`, aside `1658` (`md:block`), triple `1168` (`!isMobile`) | | ✔ | | | high |
| L14 | The timeline aside is a fixed `w-[236px] shrink-0` from 768 and can't be collapsed. Its text is em-based inside a px column, so it gets cramped at Aa 22/24. | BRP `1658` | | ✔ | ✔ | | med |
| L15 | **The paper is hard-capped at 640px at every width, with no fit/zoom/expand on BRP.** The desk gutter is ≈282px per side at 1440 and ≈520px per side at 1920. (Overlaps complaint #4; controls belong to the preview tab, the layout contract belongs here.) | BRP `1548` `max-w-[640px]`; `pages/application/DocPdfCanvas.tsx:152` `max-w-full` | | | ✔ | ✔ | high |
| L16 | RTL bug: the aside has `border-s` with `dir=rtl` inside a physically pinned `direction:ltr` row, so in Arabic the hairline lands on the viewport edge instead of facing the desk. | BRP `1539` (`direction:'ltr'`), `1657` (`dir={isAr?'rtl':'ltr'}`), `1658` (`border-s`) | | ✔ | ✔ | ✔ | low |
| L17 | **The BooksPage three-pane grid starts at 768 with a fixed 15rem rail and a `clamp(360px,36%,480px)` pane, so the list column is ≈96px at 768, ≈352px at 1024 and ≈524px at 1280.** No intermediate layout exists. | BP `455-461` (`grid-cols-[15rem_minmax(0,1fr)_clamp(360px,36%,480px)]`), wrapper `px-6` BP `410` | | ✔ | ✔ | | high |
| L18 | Because of the Aa × breakpoint mismatch, at Aa 22/24 the rail grows to 330/360px while the switch stays at 768. The list is negative at 768 and ≈196–235px at 1024. | BP `460` (`15rem`); `theme.ts:20` | | ✔ | ✔ | ✔ | high |
| L19 | List rows never drop parts. The checkbox, glyph tile, `w-[4.6rem]` ref, paper count and seal are all `shrink-0`; only the label truncates. The label reaches 0 below a ≈290px list. There are no container queries. | RL `107`, `130`, `135`, `143`, `146-147`, `170`, `177` | | ✔ | ✔ | | med |
| L20 | The pane can never be closed. The first row is auto-selected whenever nothing is selected, so the list can never reclaim the pane's 360–480px. | BP `397-404` | | ✔ | ✔ | ✔ | med |
| L21 | Pane paper `baseWidth={400}` + `p-4` = 432px is wider than the 358px pane interior below ≈1250px viewport, so the paper pans sideways. The paper toolbar doesn't wrap (filename, ±, %, Fit, Download, Replace, Delete, Full preview). | RP `331`; RPV `226-231`, `324-325` | | ✔ | ✔ (<1250) | | med |
| L22 | All pane workflow actions are icon-only 32px buttons: Continue, Send, Revise, Scan signed, Open, Edit in Word, Add to PDF, Add to email. | RP `359-374` (`iconOnly`), `382-407`; `PaneBtn` RP `573-606` | | ✔ | ✔ | ✔ | med |
| L23 | StatusSpine has 6–7 `flex-1` segments inside `overflow-hidden` with no wrap or scroll, so Arabic and large-Aa labels clip. [INFERENCE] | `StatusSpine.tsx:47`, `59` | | ✔ | ✔ | | low |
| L24 | Filters are asymmetric. Desktop has no category, direction or date filters. `BooksFilterBar` renders only on mobile, so its `md:` rules are dead code. Mobile has no status spine (the chips cover status). | BP `681` (mobile branch only); `BooksFilterBar.tsx:246`, `337` | ✔ | ✔ | ✔ | ✔ | low |
| L25 | IncludedPapersDialog row controls (move, replace, remove) are `sm:opacity-0 sm:group-hover:opacity-100`, so they are invisible on touch tablets until a row has focus. | `IncludedPapersDialog.tsx:652` | | ✔ | | | med |
| L26 | `BookDetailDrawer` is dead code (no importer). It holds the only UI for version history, DOCX download and "Add note", and it signs **without** confirmation. Do not revive it as-is. | grep for importers: none. BDD `124-204`, `626-638`, `643` | — | — | — | — | low |
| L27 | Nested interactive elements: a checkbox inside the row `<button>`, and a Submit `<button>` inside the card `<article role=button>`. | RL `100-131`; BP `861-907` | ✔ | ✔ | ✔ | ✔ | low |
| L28 | Unfile gates disagree. BRP needs approved + signed + edit + current version; the pane's viewer Delete on a signed paper needs only `canEdit`. | BRP `665-666`; RP `334` | | ✔ | ✔ | ✔ | low |

### Desktop ↔ mobile action parity (record actions)

"Desktop" means ≥768 (BRP and the pane). "Phone" means <768 (BRP only, since the pane is not mounted).

| Action | Desktop | Phone | Verdict |
|---|---|---|---|
| Sign & approve / Return / Reject | Header bar BRP `1168-1198` | Inline panel BRP `1627-1649` + dock `1670-1694` | parity |
| Reviewer actions | Bar BRP `1201-1205` | same | parity (but in the scrolling header, not the dock) |
| Revise & regenerate | Bar BRP `1207-1215` | same | parity |
| Send for approval | Bar BRP `1217-1227`; pane RP `222-231` | Bar; card chip BP `892-907` | parity |
| Scan signed copy | Bar BRP `1229-1237`; pane RP `242-251` | Bar | parity |
| Word Finish / Discard | Bar (icon-only) BWA `95-115`; pane RP `353-358` | same, plus a disabled "Open in Word" BWA `79-93` | parity (both unlabeled) |
| Edit in Word (new version) | Tools BRP `1323-1331`; pane RP `383-387` | Disabled with no reason | intentional, unexplained (L6) |
| Tools: Print, Email via Outlook, Add to PDF, Download signed, Original form, Adjust signature, Replace signed, State, Revision access, Remove signed copy | BRP `1264-1380` | Same popover | parity, poor ergonomics (L8) |
| Mark (annotate) | BRP `1246-1248` | same | parity |
| Queue prev/next, back | BRP `1030-1061` | same | parity (icon-only) |
| **Delete record** | Bulk bar BP `583-593`; draft Discard `BookPreview.tsx:193-199` | **missing** | **L1** |
| **Continue editing (draft)** | RP `212-221` → BookPreview `200-213` | **missing** | **L3** |
| **Paper switcher / zoom / download any paper / full preview** | RP `327-350`, `533-567` | **missing** | **L4** |
| **Add scan (attachment)** | RP `268-281` | **missing** | L4 |
| **Replace / Delete a scan** | RPV `281-298` | **missing** (only signed-copy Replace/Remove via Tools) | L4 |
| **Add to email (basket)** | RP `403-407`; BP `576-582` | **missing** | L5 |
| Multi-select (bulk) | RL checkbox `117-132` | **missing** | L1 |
| Desktop-only list nav: FormRail, StatusSpine, server search | BP `448-484` | Filter bar instead | different by design |
| **Phone-only:** progress `<details>` | — | BRP `1493-1531` | desktop gets the aside |
| **Phone-only:** category / direction / date filters | **missing on desktop** | `BooksFilterBar` | L24 |
| Version history, DOCX download, Add note | none live (only in dead BDD) | none | both missing |

## 2. Proposals

Breakpoint vocabulary: base (<640), `sm`, `md` (768), `lg` (1024), `xl` (1280), `2xl` (1536). The JS switch stays at 768 (`useIsMobile`); everything above it uses CSS breakpoints plus **container queries** where the space depends on sibling panes.

**P1 — Delete record on the record page (L1, L2)**
- **Change**
  - Add a Tools → Administration item, **Delete record** (danger, last, after a separator).
  - Gate: `has('books.delete') && !isInmateReporter`.
  - It opens `ConfirmDialog destructive`. The title names the ref; the body reuses the soft-delete copy (`books.bulk.deleteBody`).
  - On success: invalidate `['books']` and `['dashboard']`, show a toast, then navigate to `/books`, or to the next queue item when `QueueNav` has one.
  - Fix `BookPreview.tsx:71` to gate Discard on `has('books.delete')` as well.
- **Components:** BRP (Tools menu + ConfirmDialog), `BookPreview.tsx`.
- **Desktop:** a menu item.
- **Phone:** an item in the "More" sheet (P5).
- **RTL:** no layout risk. The ref goes through `bidi()`, the same idiom as the sign confirm at BRP `1425`.
- **Risk:** irreversible from the UI (backend soft-delete, no restore endpoint: `book_service.py:1043-1046`), so there is no undo toast.
- **Effort:** S.

**P2 — Draft actions on the record page (L3)**
- **Change:** when `state==='none'` and the book is not a Word book, the workflow bar gets **Continue editing**. It reuses `BookPreview` mounted from BRP, or navigates to the service form like Revise (BRP `857-860`). Discard rides on P1.
- **Components:** BRP, `BookPreview`.
- **Desktop / phone:** the same labelled button. On phone it is the dock primary (P5).
- **RTL:** none.
- **Risk:** low.
- **Effort:** S.

**P3 — Papers on the record page (L4)**
- **Change**
  - Add a "Papers" strip above the desk. It reuses `RecordPaperViewer`'s thumbnail row (RPV `193-223`) for the generated, signed, scan and imported papers, plus Add scan.
  - Selecting a paper swaps the desk.
  - Download, Replace and Delete go into the paper toolbar. Their gates must be unified (fixes L28).
- **Components:** BRP, `RecordPaperViewer` (extract the strip), `useManagePaper`.
- **Desktop:** strip under the header, `overflow-x-auto`.
- **Phone:** the same strip, horizontally scrollable, with 56px thumbnails (already `w-14`).
- **RTL:** the strip scrolls from inline-start, and thumbnail order follows reading direction.
- **Risk:** medium, because the desk currently assumes one PDF.
- **Effort:** M.
- **Coordinate:** with the preview tab (signed-first ordering, complaint #5).

**P4 — Record page header: two rows, fixed DOM order (L12, L13, L9)**
- **Change:** restructure the header into a single `flex-wrap` container with explicit rows.
  - **Row A (all widths):** back · QueueNav · identity (`min-w-0 flex-1`, h1 `truncate`, with a tap/hover tooltip for the full subject) · chips · `ms-auto` [Mark] [Tools].
    - Chips move into row A from `md`: `md:basis-auto`, identity floor `md:min-w-[14rem]`. Below `md` they stay on their own line.
  - **Row B (only when a workflow action exists):** the workflow bar at `w-full`.
    - Move the utility div *before* the bar in the DOM, so Mark + Tools never form a third row.
- **Phone (<768):** the workflow bar is not rendered in the header. Its actions move to the dock (P5), Tools collapses into "More" in the dock, and Mark becomes a dock toggle when `canMark`. The header is then row A only (≈60px), plus the `<details>` progress line.
- **Components:** BRP `1029-1386`.
- **RTL:** `ms-auto` and logical gaps already flip. No new physical properties.
- **Risk:** the tests that query header buttons by role/name keep working, but the mobile tests for bar actions must target the dock.
- **Effort:** M.

**P5 — Phone action dock + "More" sheet (L8, L9, L10, L11, L6, L7)**
- **Change:** turn the decide-only dock into a state-driven dock rendered whenever `isMobile && book`. It has one primary slot (or two to three for decide), always a **More** button, and labelled buttons only.

  | State | Dock contents (inline-start → inline-end) |
  |---|---|
  | decide | Return · Reject · **Sign & approve** (unchanged; still auto-hides when the inline panel is ≥40% visible, BRP `745-756`) |
  | draft (`none`, can edit) | More · **Continue editing** · Send for approval |
  | returned/rejected (`revise`) | More · **Revise & regenerate** |
  | awaiting scan / file signed | More · **Scan signed copy** |
  | Word session active | More · Discard (labelled, red outline) · **Finish editing** |
  | review | More · **Review** (opens a sheet with `ReviewerActions`) |
  | approved / read-only | More · **Download signed PDF** (approved) or Print |

  - **More** opens a bottom sheet. Use the existing `.bottom-sheet` motion (`index.css:1662-1690`) via a Radix Dialog, the same pattern as the other record dialogs.
  - The sheet groups the Tools items as Document / Editing / Administration, using the same keys and order as the desktop menu. Each row is ≥48px, with an icon, a label and a one-line hint (helps complaint #3).
  - Disabled items show their reason inline, e.g. "Edit in Word" → `books.word.needsPc`.
  - Delete record is last, in danger tone.
  - The dock keeps `bottom-[calc(5.5rem+var(--safe-bottom))]` above `BottomTabBar` and `pb-[max(0.5rem,var(--safe-bottom))]`.
  - The desk gets matching bottom padding (`pb-[calc(4.5rem+…)]`) so content never hides under the dock.
  - `ScanBackDock` hides on `/books/:id` while the record dock is mounted, or lifts by the dock height.
- **Components:** BRP, `RecordDecisionActions`, `BookWordActions` (labelled mode), a new `RecordMoreSheet`, `ScanBackDock`.
- **Desktop:** no change (Tools dropdown). The labelled Word Finish/Discard applies to desktop too (L7).
- **RTL:** the dock already carries `dir` (BRP `1674`). The grid order flips naturally, the primary sits at inline-end (right in LTR, left in AR), and the sheet's slide-up is direction-neutral.
- **Risk:** tests `BookRecordPage.signConfirm.mobile.test.tsx:136-139` expect ≥2 Sign buttons. That still holds for decide.
- **Effort:** M.

**P6 — Record body per breakpoint (L13, L14, L15, L16)**
- **Change**
  - **<768:** unchanged (stacked, `<details>` progress).
  - **768–1279 (`md`–`xl`):** the aside becomes a **collapsed 48px rail**: a vertical stack of station dots plus a labelled "Progress" toggle at the top. Clicking it expands a 280px overlay drawer from the physical right edge over the desk (a `.drawer-end`-style slide, kept physical to match the pinned layout). The default is collapsed.
  - **≥1280 (`xl`):** the full aside is shown, sized `w-[15rem]` (rem, so it tracks Aa), with a "Hide progress" collapse toggle persisted in `localStorage`.
  - **Desk:** remove the fixed `max-w-[640px]`. The paper uses `max-w-[min(100%,var(--paper-w))]`, where `--paper-w` defaults to 720px at `lg`, 860px at `2xl`, and "Fit width" (100% of the desk) when the user picks Fit. The zoom and Fit controls themselves belong to the preview tab.
  - **Desk padding:** `px-3 md:px-4 lg:px-6`.
  - **RTL fix (L16):** drop `border-s` from the aside and put `md:border-e` on the desk. The desk inherits the pinned `ltr`, so `border-e` faces the aside in both languages and the code stays logical.
- **Components:** BRP `1539-1668`.
- **Risk:** low.
- **Effort:** M.

**P7 — Records list responsive tiers (L17–L21, L23)**
- **Change:** make the desktop branch a size-driven grid with an `@container` on the BP wrapper, so the thresholds track Aa (see §0). Tailwind v4 container variants are `@md`, `@lg`, `@4xl`, etc.

  | Container width | Rail | List | Pane |
  |---|---|---|---|
  | <64rem (≈ viewport 768–1071 at Aa 16) | collapsed into a **Service** popover chip in the list toolbar (reuse the `BooksFilterBar` Service popover) | full width | **end-side drawer** over the list (`.drawer-end`, `max-w-[26rem]`), opened by row click, closed with ×/Esc; no auto-select |
  | 64–80rem (≈1072–1327) | **icon rail** `w-14`: service artwork + count badge, label via tooltip and `aria-label` | `1fr` | `clamp(20rem,38%,26rem)` inline |
  | ≥80rem (≈1328+) | full `15rem` rail | `1fr` | `clamp(22rem,34%,32rem)` inline |

  - Auto-select (BP `397-404`) applies only in the inline-pane tiers.
  - **List rows:** put an `@container` on the list `<section>`. Below `@[26rem]`, hide the paper-count chip and the glyph tile, and stack ref above label (two-line row).
  - Fix L27: move the checkbox out of the `<button>` by using a row `div` containing a checkbox and a row button.
  - **Pane paper:** set `baseWidth` from the measured pane width (`ResizeObserver`) instead of `400`. Let the toolbar wrap (`flex-wrap`), or move Replace/Delete into a `⋯` menu below 26rem.
  - **StatusSpine:** `overflow-x-auto` with `snap-x`, and `min-w-max` segments below `@[48rem]`.
  - **Desktop filters (L24):** add a "Filters" button that opens the mobile `BooksFilterBar` content in a popover (category, direction, dates).
- **Components:** BP `407-616`, RL, RP, RPV, `FormRail`, `StatusSpine`.
- **RTL:** the drawer already flips (`index.css:1705-1706`). The icon rail sits at inline-start, and tooltips use `side="inline-end"` logic (Radix `side` is physical, so compute it from `dir`).
- **Risk:** medium. Mobile is unchanged; three desktop tiers need e2e coverage at 900, 1180 and 1440, in both EN and AR.
- **Effort:** L.

**P8 — Pane labels (L22)**
- **Change:** at the `≥80rem` tier the pane footer shows text labels for the primary action plus one secondary (`PaneBtn` without `iconOnly`). The rest stay icon buttons with tooltips. At narrower tiers it stays icon-only, but Radix tooltips replace `title`.
- **Effort:** S. (The icons tab owns the tooltip pattern; this tab only fixes when labels can fit.)

**P9 — Touch tablets (L25)**
- **Change:** in `IncludedPapersDialog.tsx:652`, replace `sm:opacity-0` with `[@media(hover:hover)]:sm:opacity-0` so touch devices always show row controls.
- **Effort:** S.

**P10 — Remove `BookDetailDrawer` (L26)**
- **Change:** delete the dead component and its tests. Port "Version history" into the More sheet / Tools as **Versions…** only if the user wants it (open question 3).
- **Effort:** S.

## 3. Prototype spec (layout slice)

Build one HTML file with a width switcher (390 / 834 / 1180 / 1440 / 1920), an EN/AR toggle (`dir` on `<html>`), an Aa toggle (16/24), and a state switcher.

### 3.1 `/books/:id` per breakpoint

| Width | Header | Body | Actions |
|---|---|---|---|
| **390 (phone)** | Row A only: ← · `‹ 3/12 ›` · ref/subject (1 line, truncate) · state pill. Under it: the `<details>` progress line. | Papers strip (horizontal) → paper full width (`px-3`) → inline decide panel (decide only) | Fixed dock above the tab bar, per the P5 table. **More** opens a bottom sheet. |
| **834 (tablet, desktop mode)** | Row A: ← · queue · identity (`min-w 14rem`) · chips · `ms-auto` Mark · Tools. Row B: workflow bar (if any). | Papers strip → desk (paper ≈ desk − 32px) + **48px collapsed Progress rail** at the physical right; the toggle opens a 280px overlay | Header buttons labelled; Tools dropdown |
| **1180 (laptop)** | Same 2 rows | Desk with paper up to 720px + collapsed rail (default) | same |
| **1440 / 1920 (desktop)** | Same 2 rows | Desk with paper up to 860px (Fit = full desk) + **15rem Progress aside** with a "Hide progress" toggle | same |

Header rows must stay at **≤2 at every width ≥768**. Verify with the longest Arabic subject plus the decide state.

### 3.2 `/books` list per breakpoint

| Width | Layout |
|---|---|
| 390 | Unchanged: filter bar + cards. Add a "Select" button in the header that turns on checkboxes on the cards, and a bottom bulk bar with **Add to email** · **Delete** (`books.delete`). |
| 834 | Spine (scrollable) · toolbar [search · Service ▾ · Filters ▾ · Drafts] · full-width list · pane as end drawer on row click |
| 1180 | Spine · 56px icon rail · list · inline pane `clamp(20rem,38%,26rem)` |
| 1440+ | Spine · 15rem rail · list · inline pane `clamp(22rem,34%,32rem)`; pane footer primary actions labelled |
| Aa 24 at 1440 | Must fall back to the 1180 tier automatically (container query), with the list never under 26rem |

### 3.3 Controls and labels (EN / AR)

These reuse existing keys unless marked **NEW**.

| Control | EN | AR | Key |
|---|---|---|---|
| Tools trigger (desktop) | Tools | أدوات | `books.record.tools` |
| More (phone dock) **NEW** | More | المزيد | `books.record.more` |
| Sheet groups | Document / Editing / Administration | المستند / التحرير / الإدارة | `books.record.tools{Document,Editing,Admin}` |
| Print | Print | طباعة | `books.record.print` |
| Email via Outlook | Email via Outlook | إرسال عبر Outlook | `books.record.emailViaOutlook` |
| Add to email | Add to email | إضافة إلى البريد | `basket.add` |
| Add to PDF | Add to PDF | إضافة إلى PDF | `books.includedPapers.addToPdf` |
| Download signed PDF | Download signed PDF | تنزيل PDF الموقّع | `books.record.downloadSigned` |
| Original form | Original form | النموذج الأصلي | `books.record.viewOriginal` |
| Edit in Word | Edit in Word (creates a new version) | تعديل في Word (ينشئ إصداراً جديداً) | `books.word.editNewVersion`, with the phone hint `books.word.needsPc` shown inline |
| Replace signed / Remove signed copy | Replace this document / Remove signed copy | استبدال هذا المستند / إزالة النسخة الموقعة | `books.pane.replacePaper` / `books.pane.unfileSignedBtn` |
| State override | State | الحالة | `books.stateOverride.trigger` |
| Revision access | Retained revision access | الوصول المحتفظ به للإصدار | `books.approval.revisionAccess` |
| **Delete record NEW** | Delete record | حذف السجل | `books.record.delete` |
| Delete confirm title **NEW** | Delete {{ref}}? | حذف {{ref}}؟ | `books.record.deleteTitle` |
| Delete confirm body | (reuse) Soft-delete … ref numbers are not reused. | (reuse) | `books.bulk.deleteBody` (singular variant **NEW** `books.record.deleteBody`) |
| Continue editing | Continue editing | متابعة التحرير | `books.pane.continueDraft` |
| Sign & approve / Return / Reject | Sign & approve / Return / Reject | التوقيع والموافقة / إعادة / رفض | `books.approval.*` |
| Revise | Revise & regenerate | تعديل وإعادة الإنشاء | `books.versions.revise` |
| Send for approval | Send for approval | إرسال للموافقة | `books.approval.submitForApproval` |
| Scan signed copy | Scan signed copy | مسح النسخة الموقعة | `books.pane.scanSignedCopy` |
| Word Finish / Discard (labelled) | Finish editing / Discard | إنهاء التحرير / تجاهل | `books.word.finish` / `books.word.discard` |
| Progress toggle | Progress | التقدّم | `books.record.progress` |
| Hide progress **NEW** | Hide progress | إخفاء التقدّم | `books.record.hideProgress` |
| Add scan | Add scan | إضافة مسح | `books.pane.addScan` |
| List: Service / Filters | Service / Filters (**NEW** `books.filters.more`) | النموذج / عوامل التصفية | `books.filters.service` |
| List: Select mode **NEW** | Select / Done | تحديد / تم | `books.list.select` / `common.done` |

### 3.4 States to demo, each at 390 / 834 / 1440, in EN and AR

1. **Pending, manager decide:** dock with 3 buttons on phone; on desktop a 2-row header with the triple in row B and Mark + Tools in row A.
2. **Approved + signed:** phone dock shows More · **Download signed PDF**; the papers strip leads with the signed paper (coordinate with the preview tab); the More sheet shows Remove signed copy and Delete record.
3. **Draft (`none`):** Continue editing + Send for approval on both surfaces; Delete record in More/Tools.
4. **Returned:** Revise & regenerate primary; the progress summary shows the "Returned" station.
5. **Word session active (phone):** dock with labelled Discard + Finish editing, and the More sheet showing "Edit in Word" disabled with its needs-PC hint.
6. **No document:** the desk empty state with the Revise CTA (BRP `1605-1618`); the papers strip shows only Add scan.
7. **List at 834:** drawer pane open over the full-width list. **List at 1180:** icon rail. **List at 1440 with Aa 24:** container query falls back to the icon rail.

## 4. Open questions

1. **Delete scope.** The backend soft-deletes **any** state, approved included (`book_service.py:1043-1046`, gated only by `books.delete`). Should the record-page Delete be offered for approved/signed records too, or only for drafts, returned and rejected ones? Hiding it for approved records is safer; the bulk bar currently allows all states.
2. **Phone bulk selection.** Do you want Select mode with bulk Delete and Add to email on phone (P7, 390 row), or is a per-record Delete in More enough?
3. **Version history.** The only UI for it is in dead `BookDetailDrawer`. Should it come back as a "Versions…" Tools/More item, or be dropped together with the drawer?
4. **768–1023 list behaviour.** Should the pane be an overlay drawer (keeps the list full width; proposed), or should a row tap navigate to `/books/:id` as on phone (simpler, but loses quick scanning)?
