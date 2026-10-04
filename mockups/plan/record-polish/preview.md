# Record polish — PREVIEW & DOCUMENT VIEWING (slug: `preview`)

Scope: record-page desk (`BookRecordPage.tsx`), books-list inline pane (`RecordPane.tsx` + `RecordPaperViewer.tsx`), `DocPdfCanvas`, `BookPreview`, `ApprovalPreviewDialog`, `IncludedPapersDialog`, `BookAnnotationLayer`.
Not re-proposed (shipped in `b5e7dbd5`): workflow bar, Tools dropdown, unified sign confirm, mobile timeline `<details>`, truthful desk empty states, `docxUrl` fallback on the record desk.

Facts that shape every proposal:
- The JS "mobile" cutoff is `max-width: 767px` (`frontend/src/lib/useIsMobile.ts:3`). The 640–767 band therefore gets the phone layout, and "desktop" starts at 768.
- The record body is pinned physically LTR (`BookRecordPage.tsx:1534-1539`, `style={{direction:'ltr'}}`): the desk sits on the left and the Progress rail on the right in both languages. This is a deliberate exception. The same pattern is used in Ledger (`ContextPanel.tsx:26-29`).
- `BookDetailDrawer.tsx` has no importers. It shows up only in comments (`grep BookDetailDrawer`) and has no preview. It is dead code: don't design for it.
- `BookPreview` is the draft-only modal opened from the pane's "continue draft" (`BooksPage.tsx:610,749`).

## 1. Findings

| id | problem | evidence | widths | sev |
|---|---|---|---|---|
| PV-01 | **Approved + in-app-signed record opens on the UNSIGNED original in the inline pane** (user complaint 5). `papersOf` always puts `generated` (`&original=true`) first and `signed` second. `initialPaperIndex` only jumps to the signed paper when `signedSourceOf(book)==='scan'`. | `recordPapers.ts:52-66` (original first), `:90-98` (signed second); `RecordPane.tsx:128-134` | ≥768 (pane is desktop-only, `BooksPage.tsx:76`) | high |
| PV-02 | **Four surfaces disagree on the default document.** Full page shows signed via a server-side swap. The pane shows the original. The approval dialog shows signed. `BookPreview` uses the latest version with no `rev`. There are four separate URL builders. | `BookRecordPage.tsx:639-643` + `documents.py:662-684` (swap unless `original=true`); `recordPapers.ts:58`; `ApprovalPreviewDialog.tsx:62-69`; `BookPreview.tsx:74-76` | all | med |
| PV-03 | Pane never re-picks the default when the **same** record changes state (signed copy lands, scan filed, signed copy unfiled). The reset is keyed on `book.id` only, so the index can stay on the original or point at a shifted paper. | `RecordPane.tsx:144-152`; viewer tolerates `papers[i]` undefined `RecordPaperViewer.tsx:139` | ≥768 | med |
| PV-04 | **Full record page has no paper switcher.** It renders one `DocPdfCanvas`. The original is reachable only via Tools → "Original form" in a new tab. Filed scans (`attachment_paths`) are unviewable on `/books/:id` at any width. | `BookRecordPage.tsx:1548-1578`, `:1298-1312` (original link), `recordPapers.ts:100-112` (scans exist only in the pane) | all | high |
| PV-05 | **Preview area can't grow on the record page.** The paper is hard-capped at 640px, `DocPdfCanvas` rasterizes at a fixed scale 1.5 with no zoom/fit/page counter, and the rail is a fixed 236px with no toggle. At 1440 about 560px is blank. At 768 the paper is about 484px. | `BookRecordPage.tsx:1548` `max-w-[640px]`; `:1656-1658` `w-[236px] … md:block`; `DocPdfCanvas.tsx:147,151-152`; grep `collapse|maximi|fullscreen|Maximize2` finds no hits in page/canvas | 768–∞ | high |
| PV-06 | **No focus/maximize mode on the record page.** The header (1–4 rows) and the banners are fixed, non-scrolling flex children above the desk. Only the desk scrolls. A short laptop window leaves roughly 570px for the paper [INFERENCE, unmeasured]. | `BookRecordPage.tsx:1013` (`overflow-hidden`), `:1029` header, `:1438-1482` bands, `:1541` sole scroller | all | high |
| PV-07 | **Books-list pane is a fixed third grid column** with no collapse, widen or splitter. The list column is about 96px at 768, 148px at 820 and 352px at 1024. It goes to 0 at font-scale 22–24px (the 15rem rail scales). | `BooksPage.tsx:455-461` `grid-cols-[15rem_minmax(0,1fr)_clamp(360px,36%,480px)]` | 768–1280 | high |
| PV-08 | Pane viewer: "Fit" is a reset to `baseWidth` 400, not fit-to-container. The usable width at the 360px pane floor is about 328px, so the default view overflows horizontally. The film-strip (≈110px tall) shows even for one paper. The toolbar doesn't wrap, so the filename collapses when Replace/Delete appear. | `RecordPaperViewer.tsx:262-267` (`setZoom(1)`), `:193`, `:226-231`; `RecordPane.tsx:331` | 768–1280 | med |
| PV-09 | "Full preview" overlay isn't full: it is fixed at 620px on any screen, and it **hides the paper strip**, so you can't switch signed/original/scan without closing it. | `RecordPane.tsx:533-563` (`baseWidth={620}`); strip gated `!isOverlay` `RecordPaperViewer.tsx:193` | all ≥768 | med |
| PV-10 | `ApprovalPreviewDialog` on phone opens a 620px page inside a ~320px sheet, and Fit returns it to 620. It has a single paper and no switcher (`onPaperIndexChange={() => undefined}`). Nothing on screen says signed vs unsigned beyond the status chip. | `ApprovalPreviewDialog.tsx:131,141-147`, `:62-79` | phone, 640–767 | high |
| PV-11 | **Word session active + existing document:** the desk shows the last generated PDF with no "stale / being edited" marker, because `pdfUrl` wins over the `edit_session` branch. A live preview endpoint exists (`books.edit` + full access) but only the handoff dialog uses it. | `BookRecordPage.tsx:1549` precedes `:1598`; `api.ts:2072` `wordSessionPreviewUrl`; `books.py:427-447`; `WordHandoffDialog.tsx:382`; `BookEditSessionRead.user_name/last_put_at` `api.types.ts:7795-7803` | all | med |
| PV-12 | Pane empty state is a single generic "No papers yet / Generate the document…". It lacks the record page's Word-active / revise / imported-non-PDF split. | `RecordPane.tsx:343-349` vs `BookRecordPage.tsx:1583-1624` | ≥768 | low |
| PV-13 | Error states are dead ends. There is no Retry anywhere. `DocPdfCanvas` without `docxUrl` (BookPreview, IncludedPapers) shows only an icon and text. 401/403/500 all read "Couldn't render this file". `PaperCanvas` error shows **only the filename**. Image papers have no `onError`. | `DocPdfCanvas.tsx:128-131,203-229`; `RecordPaperViewer.tsx:84-96`; `BookPreview.tsx:149` | all | med |
| PV-14 | **Arabic shows English**: `application.pdfNotGenerated` is missing from both locales, so the `defaultValue` English is displayed. `books.record.title` is also missing (IncludedPapers subject fallback "Record"). | `DocPdfCanvas.tsx:209-212`; `en.json:3404-3409` / `ar.json:3642-3647` have only `pdfUnavailable*`; `IncludedPapersDialog.tsx:177`; verified `books.record.title` → `None` in both | all (AR) | high (S fix) |
| PV-15 | Loading is a bare unlabelled spinner (no `role=status`). Pages paint underneath it, then the layout jumps. The whole base64 body is read before any page appears. | `DocPdfCanvas.tsx:133,155,163-166,198-202`; `RecordPaperViewer.tsx:89-93` | all | low |
| PV-16 | Perf: every zoom click **refetches and re-parses** the whole PDF (effect deps `[paper, width]`). `ApprovalPreviewDialog` rebuilds `papers` each render, so any parent re-render refetches. There is no `doc.destroy()`. All pages are rendered eagerly at device DPR. | `RecordPaperViewer.tsx:33-82`; `ApprovalPreviewDialog.tsx:70-79`; `DocPdfCanvas.tsx:144-162` | all (phones worst) | med |
| PV-17 | Strip tiles are indistinguishable: hard-coded `PDF`/`IMG` text (untranslated), every scan labelled "Scan", ~9px labels, no `title`, no page count. | `RecordPaperViewer.tsx:182-189,209,213` | ≥768 | med |
| PV-18 | Annotation toolbar is `absolute top-2` over the whole stacked document, so it scrolls away on page 2+. `ToolBtn` has `title` only (no `aria-label`/`aria-pressed`). The submitter sees scattered 24px badges with no count or next-mark stepping. | `BookAnnotationLayer.tsx:173,185,231,458-466` | all | med |
| PV-19 | **IncludedPapersDialog on phone:** "Review PDF" switches to the Preview tab, which hides the footer (Cancel/Review/Save live inside the Order section). The dialog sets `hideClose`, so the Preview tab has no visible exit or Save. | `IncludedPapersDialog.tsx:127,155,277,510-556` | phone, 640–767 | high |
| PV-20 | IncludedPapers preview goes stale after a reorder/remove with no hint: the hint shows only when a staged file exists. Save is disabled without explanation. Row actions are hover-only at ≥640 (invisible on touch tablets). | `IncludedPapersDialog.tsx:259-263`, `:652` | all / tablet | med |
| PV-21 | Phone record page: header and status are fixed above the only scroller. Expanded `<details>` has no `max-h`, so it can starve the desk. The decide dock (`fixed`, ~62px) overlays the paper with no reserved padding. | `BookRecordPage.tsx:1013,1494-1531,1542` (`max-md:pb-4`), `:1679` | phone, 640–767 | med |
| PV-22 | RTL nits inside the pinned-LTR body. (a) The aside sets `dir=rtl` and uses `border-s`, which resolves to its outer (right) edge in AR, so the desk/rail seam disappears. (b) Desk empty/error text inherits the LTR base direction, so the AR trailing period lands on the wrong side. | `BookRecordPage.tsx:1657-1658`; `:1539` vs `:1587,1603,1610,1623`; `DocPdfCanvas.tsx:206` | ≥768 / all | low |

## 2. Proposals

### PV-01/02/03 — One smart-default helper, used by every surface
- **Change:** add `defaultPaperIndex(book, papers)` next to `papersOf` in `recordPapers.ts` (pure, unit-testable). Rule table:

| state | default | caption under the switcher (EN / AR) |
|---|---|---|
| `approved` + signed paper (`in_app` or `scan`) | **Signed copy** | "Signed copy · {{date}}" / "النسخة الموقعة · {{date}}" |
| `approved`, no signed paper (imported-approved, override) | Generated | — |
| `awaiting_scan` | Generated (original) | "Print, sign, then scan the signed copy" / "اطبع، وقّع، ثم امسح النسخة الموقعة" + existing Scan CTA (`books.pane.scanSignedCopy`) |
| `pending` | Generated | "Unsigned — awaiting signature" / "غير موقّع — بانتظار التوقيع" |
| `returned` / `rejected` | Generated (latest version); open marks summary if marks exist (PV-18) | "Returned with {{count}} marks" (AR plural forms) |
| `none` draft | Generated | — |
| Word session active | Generated + stale banner (PV-11) | see PV-11 |
| no document | existing empty-state split (PV-12) | — |

- Keep `papersOf` order as is (original, signed, scans) so tab positions are stable. Only the **selected** default changes.
- `RecordPane.tsx:130-134` uses the helper. The reset at `:144-152` keys on `${book.id}:${approval_state}:${papers.map(p=>p.kind+p.url).join()}` so a state flip re-picks the default. An explicit user pick holds until that signature changes.
- `ApprovalPreviewDialog` and `BookPreview` call the same builder. The four URL builders collapse into `recordPapers.ts`.
- Don't persist the paper choice across records: the state-driven default is the smart behaviour.
- **Desktop/mobile/RTL:** behaviour only. Captions are new i18n keys in both locales. Dates are Western digits in `<bdi dir="ltr">`.
- **Risk:** the inmate-reporter filter (`RecordPane.tsx:110-125`) already drops the original when signed exists, so the helper must run on the filtered list. Existing `recordPapers.test.ts` covers ordering. Add default-rule cases.
- **Effort:** S.

### PV-04 — Paper switcher on the full record page
- **Change:** feed the desk from `papersOf(book)` and the PV-01 default instead of the single `pdfUrl`. Put a segmented switcher in a new sticky **desk toolbar**: `Signed copy | Original | Scan 1 | Scan 2`.
  - Hide it when there is only one paper.
  - Store the paper in the search param `?paper=signed|original|scan-N`, alongside the existing `version_id` (`lib/approvals.ts:164-178`). Keep both params on the non-queue prev/next (`BookRecordPage.tsx:1046-1048,1055-1057`).
  - The Tools item "Original form" (`:1298-1312`) becomes redundant. Remove it (clean cutover). Keep "Download signed PDF" in Tools or move it to the toolbar Download.
  - The annotation overlay attaches only when the selected paper is `generated` (marks belong to the version's generated PDF).
  - Print prints the selected paper; `.print-paper` stays the wrapper.
- **Components:** `BookRecordPage.tsx` desk, `recordPapers.ts`, `DocPdfCanvas` (or reuse `PaperCanvas`).
- **Phone:** the switcher becomes a horizontally scrollable chip row above the paper with 44px targets.
- **RTL:** the toolbar sits inside the pinned-LTR body, so set `dir={isAr?'rtl':'ltr'}` on the toolbar so chip order follows reading direction. Use physical classes and no `rtl:` utilities inside (see PV-22).
- **Risk:** `IncludedPapersDialog` receives `currentPdfUrl={pdfUrl}` (`:1393`), and that must stay the current-package URL, not the selected paper. Tests query `.print-paper` and `details > summary` (`BookRecordPage.timelineAndEmptyStates.test.tsx:165,195,249,350`).
- **Effort:** M.

### PV-05 — Collapsible rail + fit/zoom paper (record page)
- **Rail:** `w-[236px]` ⇄ `w-12`, moved to rem so it follows font scale. Collapsed it shows station dots (reuse the `RecordTimelineContent` node markup) with `title`, plus a vertical "Progress" label (the `ContextPanel.tsx:163-185` pattern).
  - Toggle: `HeaderBtn iconOnly` in the header utility row next to Tools (`:1245`), icon `PanelRightClose/Open`, `aria-expanded` + `aria-controls`.
  - Persist in `localStorage['gssg.books.record.rail']`, following the `FolderRail.tsx:37` / `ContextPanel.tsx:51` try/catch idiom (`lib/useLocalStorage.ts` exists but has zero callers).
  - Default: collapsed at 768–1023, expanded ≥1024.
  - Animate `transition-[width] duration-200 ease-[var(--ease-out-expo)] motion-reduce:transition-none`.
- **Paper:** replace `max-w-[640px]` with a mode. **Fit width** (default) is `min(available, 1000px)`. **Zoom** steps 50–240% (reuse the `RecordPaperViewer.tsx:147-149` clamps) and allow ctrl+wheel.
  - `DocPdfCanvas` gains `width` + ResizeObserver and re-rasterizes at `displayWidth×dpr` (capped), debounced, scaling via CSS during the gesture.
  - Add a page counter "2 / 5" driven by the already-measured `PageBox[]` (`DocPdfCanvas.tsx:96-106`) + IntersectionObserver.
  - Persist the zoom mode in `gssg.books.record.zoom` (`fit` | number).
- **RTL:** the rail stays physically right in AR (current product decision). The toggle lives in the header, so it inherits page `dir`. The glyph is physical (`PanelRight*`) and is not mirrored.
- **Risk:** the annotation layer must re-measure on zoom. It already observes the wrapper (`DocPdfCanvas.tsx:187-194`). Print CSS unconstrains `.print-paper` (`index.css:2025-2028`), so zoom doesn't affect print.
- **Effort:** M.

### PV-06 — Focus mode (maximize) on the record page
- **Change:** a `Maximize2` toolbar button (label "Focus on document"), plus the shortcut `F` when no input has focus.
  - Focus collapses the header to one compact bar: back, ref, state pill, the **primary workflow action** (sign/decide/scan/submit from the existing workflow bar), and Exit. The rail and banners are hidden, and the paper fills the viewport at Fit width.
  - `Esc` exits. It is non-modal (the page stays the page), so no focus trap is needed.
  - Persist in `localStorage['gssg.books.record.focus']` (see Open Q1).
- **Phone:** focus is a full-screen `100dvh` viewer with the switcher chips, page counter, Download and Close. Pinch is preserved: no overlay intercepts touch unless Highlight is armed (`BookAnnotationLayer.tsx:181`). The decide dock stays visible when `action==='decide'`.
- **Shortcuts:** if `F` ships, register it in `lib/shortcutsContext.ts:10-24` + `shortcuts-help.tsx` with i18n labels.
- **Risk:** the workflow bar must remain reachable. Never hide the sign/decide action in focus.
- **Effort:** M.

### PV-07 — Books-list pane: collapse / normal / wide
- **Change:** a three-state pane control in the pane header: **Collapsed** (48px strip showing a vertical ref + state seal; click to expand), **Normal** (`clamp(320px,34%,480px)`), and **Wide** (`clamp(480px,55%,900px)`, the list switches to compact rows).
  - Change the list track to `minmax(280px,1fr)`.
  - Persist in `localStorage['gssg.books.pane.size']`.
  - Default at 768–1023: Collapsed until a row is selected, then Normal. Selecting another row keeps the chosen size.
  - Rail (`FormRail`) collapse is the tablet tab's call. Flag it as a dependency.
- **Components:** `BooksPage.tsx:455-461`, `RecordPane.tsx:284-312`.
- **RTL:** the books grid is not direction-pinned, so in AR the pane sits on the inline-end (left). Collapse glyph: `PanelRightClose` in LTR, `PanelLeftClose` in AR (or `ChevronsRight` with `rtl:rotate-180`). Use logical `border-s`.
- **Risk:** the grid has a separate inmate-reporter variant (`:459`).
- **Effort:** M.

### PV-08/09/10/17 — Make RecordPaperViewer honest
- **Fit:** measure the container (ResizeObserver) and set `zoom = (containerW − 32)/baseWidth`. Default to Fit everywhere: pane, overlay, approval dialog. Show "Fit width" and "100%" as separate actions.
- **Strip:** hide it when there is one paper and no add-scan slot. Label scans "Scan 1", "Scan 2" (`title=filename`). Replace `PDF/IMG` with a real first-page thumbnail rendered once at about 56px, plus a page-count badge. Raise the label to ≥11px.
- **Overlay and approval dialog:** show the switcher as a compact segmented row in the overlay toolbar. The approval dialog passes signed + original papers when approved.
- **Toolbar:** `flex-wrap`; Replace/Delete move into a `⋯` menu when width is under 420px.
- **RTL:** −/+ are not mirrored. The `%` readout gets `tabular-nums` + `aria-live="polite"`.
- **Effort:** M.

### PV-11 — Word session awareness
- **Change:** when `edit_session.state==='active'` and a document exists, show a banner above the paper:
  - Text: "Being edited in Word by {{name}} — showing the last saved version." / "قيد التحرير في Word بواسطة {{name}} — يُعرض آخر إصدار محفوظ."
  - For `books.edit` + full-access users only, add a button "Show live draft" / "عرض المسودة الحية". It swaps the paper to `wordSessionPreviewUrl(bookId, last_put_at)`, keyed on `last_put_at` as `WordHandoffDialog.tsx:381-383` does.
  - The live draft is opt-in, not the default: each fetch triggers a Word COM render server-side (`books.py:440`).
  - The pane shows the same banner, compact.
- **Risk:** COM load. Never auto-poll from the record page.
- **Effort:** S–M.

### PV-12/13/15 — States
- **Pane empty states:** port the record page's split (Word active → `books.word.bodyInWord`; revise-eligible → Revise CTA; imported non-PDF → download CTA). Move it into a shared `<DocumentEmptyState>`.
- **Error:** one shared block with icon + message + **Retry** (`common.retry`, which bumps a nonce in effect deps) + "Open in new tab" + DOCX when available.
  - Map 401/403 to "You don't have access to this file" / "ليست لديك صلاحية الوصول إلى هذا الملف".
  - `PaperCanvas` and `<img>` use the same block (`onError`).
- **Loading:** an A4-aspect skeleton with `role="status"` + `common.loading`, removed on first page paint.
- **AR direction:** add `dir={isAr?'rtl':'ltr'}` (or `dir="auto"`) on desk empty/error text.
- **Effort:** S.

### PV-14 — Missing keys (ship first)
- Add `application.pdfNotGenerated` to both locales. EN as the current default. AR: "لم يتم إنشاء ملف PDF لهذا المستند — نزّل ملف DOCX بدلاً من ذلك."
- Add `books.record.title` ("Record" / "السجل").
- While there, reword `application.pdfUnavailableNoDocx` from "report" to "document" ("PDF not available for this document" / "ملف PDF غير متاح لهذا المستند").
- **Effort:** S.

### PV-16 — Viewer performance
- Cache `PDFDocumentProxy` per URL (module-level LRU of about 3). Depend on `paper.url`, not the object. On zoom, re-render pages only, debounced, and use CSS scale while stepping.
- Render pages lazily with IntersectionObserver into aspect-correct placeholders. Cap the backing store at about 8 MP per page.
- Call `doc.destroy()` on cleanup in both `DocPdfCanvas` and `PaperCanvas`.
- **Risk:** the annotation layer needs page boxes for placeholders, which already have the correct size.
- **Effort:** M.

### PV-18 — Annotations
- Move the Pin/Highlight tools into the sticky desk toolbar, shown only while `MarkToggle` is armed. Add `aria-pressed` + `aria-label` to `ToolBtn`. Hide the hint text below 640.
- Submitter (view mode): a summary chip "{{count}} marks from {{name}}" with ‹ › stepping that scrolls to and opens each mark.
  - Desktop ≥1280 can list marks in the rail's slot when the rail is expanded.
- Add Esc to close the card/composer. Place a pin on pointerup with less than 8px movement, so a touch scroll doesn't open a composer.
- **RTL:** stepping arrows sit in the toolbar (`dir` re-asserted). Use `ChevronLeft/Right` with `rtl:rotate-180` only there, never inside the pinned subtree without `dir`.
- **AR plural:** i18next `_zero/_one/_two/_few/_many/_other`.
- **Effort:** M.

### PV-19/20 — IncludedPapersDialog
- Move the footer out of the Order section into a sticky dialog footer visible on both tabs. Add a header X close (`hideClose` removed or replaced).
- Show "Preview is out of date — Review PDF" / "المعاينة غير محدّثة — راجِع ملف PDF" whenever `dirty && !preview`. Give the disabled Save a reason line.
- Show row actions always under `@media (hover:none)`. Enlarge targets to 40px.
- **Effort:** S–M.

### PV-21 — Phone record layout
- Make header + status + desk one scroller on phone, or cap expanded `<details>` at `max-h-[40dvh] overflow-auto`.
- Reserve dock height (`pb-[calc(4.5rem+var(--safe-bottom))]`) when `isMobile && action==='decide'`.
- The paper card gets an "Expand" button that opens PV-06's full-screen viewer.
- **Effort:** S.

### PV-22 — RTL nits
- Use a physical `border-l` on the aside (the body is intentionally pinned), or put the border on the desk.
- Set text `dir` on desk messages (covered in PV-13).
- **Effort:** S.

## 3. Prototype spec (preview area)

### Layout per breakpoint

| width | `/books/:id` | `/books` list pane |
|---|---|---|
| phone <640 | Single column, one scroller: compact header (back, ref, state pill, workflow bar) → status summary line → **switcher chips** (if >1 paper) → paper at Fit width → inline decide panel. Paper card corner: Expand ⤢ → full-screen viewer (`100dvh`, dark stage) with top bar [Close ✕] [chips] and bottom bar [‹ 2 / 5 ›] [Download]. Decide dock stays fixed above the tab bar when deciding. | n/a (cards → record page) |
| 640–767 | Same as phone (the app's mobile cutoff is 768). Paper at Fit width up to 720. | n/a |
| tablet 768–1023 | Desk + **rail collapsed to 48px** by default. Sticky desk toolbar. Paper at Fit width. | Pane **Collapsed** strip until a row is picked, then Normal (≥320). Wide on demand. |
| laptop 1024–1439 | Desk + rail expanded (236→rem). Fit width up to 1000. | Normal `clamp(320,34%,480)`. Wide `clamp(480,55%,900)`. |
| desktop ≥1440 | Same, plus a marks list in the rail when the submitter views a returned record. | Same; Wide default allowed. |

### Desk toolbar
The toolbar is sticky at the top of the desk. Its `dir` follows the language and its order follows reading direction. Left to right in EN:

| control | EN | AR | notes |
|---|---|---|---|
| Paper switcher (segmented; chips on phone) | Signed copy · Original · Scan 1 · Scan 2 | النسخة الموقعة · الأصل · مسح ضوئي 1 · مسح ضوئي 2 | hidden when 1 paper; `?paper=` param |
| State caption (small, muted) | e.g. "Signed copy · 2026-10-02" / "Unsigned — awaiting signature" | "النسخة الموقعة · 2026-10-02" / "غير موقّع — بانتظار التوقيع" | from PV-01 table |
| Page counter | Page 2 of 5 (visible "2 / 5") | صفحة 2 من 5 | `<bdi>`, Western digits |
| Zoom − / % / + | Zoom out · 100% · Zoom in | تصغير · ‎100%‎ · تكبير | existing `books.pane.zoomOut/zoomIn` |
| Fit width | Fit width | ملاءمة العرض | default mode |
| Mark (when allowed) + Pin / Highlight while armed | Mark · Pin · Highlight | تحديد · دبوس · تظليل | existing `books.annotations.*` |
| Download | Download | تنزيل | selected paper |
| Open in new tab | Open in new tab | فتح في علامة تبويب جديدة | icon-only + `aria-label`/`title` |
| Focus | Focus on document / Exit focus | التركيز على المستند / إنهاء التركيز | `Maximize2`/`Minimize2`, Esc |

The header utility row gets the rail toggle: "Hide progress" / "إخفاء التقدّم" and "Show progress" / "إظهار التقدّم" (`PanelRightClose/Open`).

The books pane header gets "Collapse preview" / "طيّ المعاينة", "Wider preview" / "معاينة أعرض" and "Full preview" / "معاينة كاملة" (existing key).

All icon buttons need `aria-label` + `title` (the app convention; Radix Tooltip isn't mounted). Touch targets are 44px on phone.

### States to demo (each in EN-LTR and AR-RTL, at desktop and phone)
1. **Approved + signed (in-app):** opens on Signed copy. Caption "Signed copy · date". Switcher shows Original second. Tools has no "Original form" item.
2. **Approved + signed (scan-back) with 1 extra scan:** Signed copy selected. Chips: Signed copy · Original · Scan 1.
3. **Approved, awaiting scan:** Original shown. Caption "Print, sign, then scan the signed copy" with the Scan signed copy CTA.
4. **Pending (signer view, Mark armed):** Original, toolbar shows Pin/Highlight, sticky while scrolled to page 3.
5. **Returned (submitter view):** "3 marks from Manager ‹ ›" chip. Mark 1 opened.
6. **Draft:** Original only, no switcher.
7. **Word session active with existing doc:** banner "Being edited in Word by Ahmed — showing the last saved version." with the "Show live draft" button.
8. **Word session active, no doc yet:** existing "The body is written in Word" empty state.
9. **No document / render error:** error block with Retry · Open in new tab · Download DOCX.
10. **Focus mode** (desktop) and **full-screen viewer** (phone).
11. **Books list at 820px:** pane Collapsed → Normal after picking a row → Wide.

## 4. Open questions
1. **Remember focus mode across records?** Remembering suits a signer working a queue (stays maximized on next/prev). Not remembering keeps the full header visible each time a record opens. Recommend remembering rail + zoom always, and remembering focus only for the current tab session (`sessionStorage`).
2. **Should the original stay reachable for inmate reporters on signed records?** Today they lose it by design (`RecordPane.tsx:110-115`). Recommend keeping that as is.
3. **Rail side in Arabic:** the current product decision pins the rail physically right in both languages (`BookRecordPage.tsx:1534-1538`). PRODUCT/DESIGN say layouts mirror. Keep the pin (no change), or mirror the rail to the left in AR, which drops `direction:ltr` and requires reworking QueueNav glyphs?
