# Handoff: ux-review — new Store pages (read-only evaluation)

Run: built frontend (`vite preview` :4180, same-origin `/api` → scratch backend :8790, `GSSG_DATA_DIR=/tmp/uxr-data`).
Seed: `alembic upgrade head`, admin user, `store_import_opening.py` (13 items), delivery #1, handover 3× Coffee-mate,
3-item handover, 1 disposal (backup `/tmp/uxr/seed.db`). Synthetic DN: `/tmp/uxr/delivery-note.png`.
Matrix: 390/1440 × en/ar × light/dark; axe-core 4 (WCAG 2.2 AA + best-practice), keyboard passes, slow network (CDP).
Evidence: `/tmp/uxr/shots/<group>/`, raw JSON under `/tmp/uxr/`, per-group notes `/tmp/uxr/findings-*.md`.
No tracked files changed. Not tested: physical camera, real on-screen keyboard (simulated by 500 px height), real screen reader.

## Must-fix

1. **Dark-theme `text-primary` on dark surfaces fails 1.4.3** — Dashboard selected status chip (3.44:1, #5778cf on #1c2849),
   drawer expiry-timeline quantities (4.2:1), Recent handovers "See all" link (4.20:1), In & out selected kind chip + count (4.16:1).
   All viewports, en/ar, dark. Evidence: axe `color-contrast`; `shots/dashboard/shelves-390-en-dark.png`,
   `shots/dashboard/drawer-contrast-390-en-dark.png`, `shots/handout/recent-contrast-390-en-dark.png`, `shots/movements/list-390-en-dark.png`.
   Principle: WCAG 1.4.3. Fix: add a dark-theme `--primary-text` (≥4.5:1 on surface and on `primary-soft`) and use it for
   selected chips in `StoreDashboardPage` / `StoreMovementsPage`, the "See all" link and `ItemDrawer` timeline labels.
2. **Primary hover and destructive confirm fail contrast (dark)** — tray "Record handover" hover 3.96:1 (`hover:bg-primary/90`);
   ConfirmDialog Delete white on #ef4858 3.65:1. 390/1440, en/ar, dark. Evidence: axe `color-contrast`;
   `shots/handout/submit-hover-1440-en-dark.png`, `shots/movements/keyboard-destructive-default-390-en-dark.png`.
   Principle: WCAG 1.4.3. Fix: `Button` primary hover → solid `--primary-hover` token per DESIGN.md; `components/ui/confirm-dialog.tsx`
   drop hard-coded `text-white`, use a theme-aware destructive fg/bg pair.
3. **Error text on tinted error background fails contrast (light)** — In & out feed error (#dc2626 on #f4eae7, 4.08:1);
   scan confirm error summary (#dc2626 on #fce9e9, 4.13:1). 390/1440, en/ar. Evidence: axe `color-contrast` →
   `span > .font-semibold`; `shots/movements/feed-error-settled-1440-en-light.png`, `shots/scan/validation-summary-390-en-light.png`.
   Principle: WCAG 1.4.3. Fix: darker error-foreground token in `StoreQueryState.tsx` and `FormAlert` (`components/forms/DialogShell.tsx`).
4. **Filtered-out shelf tiles at 35 % opacity stay focusable and unreadable** — Dashboard › Expired / Expiring soon / Below minimum
   chips, 1440 (and 390), en/ar, light/dark. A zero-result "Expired" leaves a whole shelf of faint active buttons, no empty message.
   Evidence: axe `color-contrast` on `button[aria-label="Nescafe Classic 12×190g"] .line-clamp-2`; `shots/dashboard/empty-expired-1440-en-light.png`,
   `shots/dashboard/expiring-1440-en-light.png`. Principle: WCAG 1.4.3; visibility of status. Fix: in `StoreShelves.tsx` hide
   non-matching tiles (or render matching items only) and show "No expired items" empty state when the filter yields zero.
5. **Shelf tile accessible name omits visible content** — Dashboard shelves, 390/1440, en/ar: `aria-label` = item name only,
   hides visible quantity, unit and expiry badge ("32 days"). Same pattern: scan "Not a store item: skip" button named
   "Skip line 1: not a store item". Evidence: axe `label-content-name-mismatch` (11 tiles at 1440; every scan row);
   `shots/dashboard/mobile-shelves-390-en.png`, `shots/scan/crop-small-390-en-light.png`. Principle: WCAG 2.5.3 Label in Name.
   Fix: `StoreShelves.tsx` drop `aria-label`, use `aria-labelledby` (name, qty+unit, badge ids); `ScanDeliveryConfirm.tsx`
   `renderLineActions` name = visible label + ", line 1".
6. **Handover tray hides keyboard focus** — Dashboard picking mode, 390 and 1440, en, light: focused Green tea tile (y 526–704) sits
   fully under the fixed tray; chips and Protective shelf also. Evidence: `shots/handout/hidden-focus-shelf-390.png`.
   Principle: WCAG 2.4.11 Focus Not Obscured. Fix: `HandoverTray` → reserve its measured height as `scroll-padding-bottom`/
   bottom padding on the dashboard scroller so `scrollIntoView` clears it.
7. **Item sheet focus wraps to off-screen Close** — Hand-out sheet (`ItemDrawer`), 390/1440, en/ar, light/dark: Tab past last action
   wraps to Close at y = −766 (390) / −938 (1440 en) without scrolling. Evidence: `shots/handout/offscreen-close-390-en-light.png`,
   `shots/handout/offscreen-close-1440-ar-dark.png`. Principle: WCAG 2.4.11. Fix: make the sheet header (title + Close) sticky,
   outside the scrolling body of `SheetContent`.
8. **Enter-Enter from a movement row deletes a record** — In & out › open handover detail focuses Delete; confirm dialog also
   autofocuses Delete. 390/1440, en/ar. Evidence: `shots/movements/keyboard-destructive-default-390-en-dark.png`,
   `/tmp/uxr/scripts/movements/recheck-results.json`. Principle: error prevention (data loss). Fix: `MovementDetailDialog` initial
   focus on title/Close; `confirm-dialog.tsx` destructive variant autofocuses Cancel.
9. **Focus lost to BODY on close (all new dialogs/sheets)** — In & out detail Escape; hand-out sheet Escape; tray Cancel;
   item dialog Escape/Save; "Enter delivery manually" dialog; scan "Cancel reading". Next Tab lands on "Skip to main content".
   390/1440, en/ar, light/dark. Evidence: `shots/movements/focus-return-failure-390-en-dark.png`,
   `shots/handout/close-return-next-tab-390-en-light.png`, `shots/scan/dialog-close-focus-390-en-light.png`, `/tmp/uxr/scan-errors.json`.
   Principle: WCAG 2.4.3 Focus Order. Fix: keep an opener ref and restore it in `onCloseAutoFocus` (Radix) for `MovementDetailDialog`,
   `ItemDrawer`, `HandoverTray`, `DialogShell`; in `StoreDeliveryScanPage.cancelReading` focus the chooser in an effect after
   `reading` becomes false (it is still disabled when focused now).
10. **Loading skeleton has prohibited `aria-label` on a generic div** — Dashboard and In & out first load / slow network,
    390/1440, en/ar. No status text announced. Evidence: axe `aria-prohibited-attr` → `div[aria-label="Loading"]` /
    `div[aria-label="جارٍ التحميل"]`; `shots/dashboard/query-loading-390-en-dark.png`, `shots/movements/loading-390-ar-dark.png`.
    Principle: WCAG 4.1.2 / 4.1.3. Fix: in `StoreQueryState.tsx` skeleton add `role="status"` with visually-hidden localized text.
11. **Search results / no-results not announced** — In & out search, 390/1440, en/ar: no `aria-live`/`role=status` in main.
    Evidence: `shots/movements/no-results-390-en-light.png`, `/tmp/uxr/scripts/movements/recheck-results.json` (`searchStatus`).
    Principle: WCAG 4.1.3 Status Messages. Fix: polite live region in `StoreMovementsPage` with "N records" / no-match text.
12. **Long recipient name breaks drawer layout** — Dashboard item drawer › Recent handovers, 390/1440, en/ar: unbroken taker name
    gives scrollWidth 783 vs 390 (en 390), 935 vs 460 (1440); text clipped. Evidence: `shots/dashboard/drawer-bottom-390-en-light.png`,
    `shots/dashboard/drawer-bottom-1440-en-light.png`. Principle: WCAG 1.4.10 Reflow. Fix: `min-w-0` on the row's text column +
    `break-words`/`[overflow-wrap:anywhere]` on the taker span.

## Should-fix

13. **Drawer recommends "Nothing to request" when usage is unknown** — Dashboard drawer, all: "Used per month: available after the
    second stock count" followed by confident zero. Evidence: `shots/dashboard/drawer-bottom-390-en-light.png`. Principle: status
    visibility. Fix: gate the suggestion in `ItemDrawer` on `dashboard.usage_ready`; else show the prerequisite.
14. **Per-item history shows whole handovers** — Face mask drawer lists Nescafe/Lipton and "3 items / 7 units" instead of −4 cartons
    of Face mask. 390/1440. Evidence: `shots/dashboard/item-history-1440-en.png`. Principle: match real world. Fix: in the item drawer
    render only this item's line (qty + unit), others collapsed as "+2 other items".
15. **Desktop drawer reuses full movement row** — 1440: date/pictures/qty/chevron columns leave a few characters for the text
    ("To Pantry - Level 2 · recorded by UX Admin" wraps word-per-line). Evidence: `shots/dashboard/drawer-bottom-1440-en-light.png`.
    Principle: aesthetic/minimal design. Fix: use the phone (stacked) row variant inside the 460 px drawer.
16. **"Record disposal" from drawer forgets the item** — Opens generic form with empty "Select a Batch"; Cancel returns to shelves,
    not the item. 390/1440. Evidence: `shots/dashboard/disposal-from-item-390-en.png`. Principle: recognition over recall. Fix: pass
    `itemId` into the disposal form from `ItemDrawer`, limit batches to that item, return to the drawer on cancel.
17. **Single → multi-item transfer drops taker and note** — 390/1440, en. Evidence: `shots/handout/transfer-stable-before-390.png`
    vs `…-after-390.png`. Principle: user control. Fix: lift the draft (taker, note) above `HandoverForm` into the tray state.
18. **Tray clips focused input with keyboard up** — 390×500 simulated, en/ar: "Taken by" input y 382–426, tray ends 412; note and
    submit below. Evidence: `shots/handout/keyboard-390-en-light.png`, `shots/handout/keyboard-390-ar-dark.png`. Principle: mobile
    ergonomics. Fix: size tray with `dvh`/`visualViewport` and `scrollIntoView({block:'nearest'})` on focus; keep submit sticky.
19. **Empty tray covers shelves on entering picking mode** — 390: full form opens before any item is picked; no tile visible while
    the hint says "Tap an item on a shelf". Evidence: `shots/handout/empty-390-en-light.png` vs `shots/handout/mockup-390-en.png`.
    Principle: recognition; mockup consistency. Fix: collapsed one-line tray until the first item is added (as in mockup).
20. **No pending state on submit (slow network)** — Hand-out single/multi: button keeps "Record handover", no spinner/`aria-busy`,
    while previous "Recorded" toast is still visible. Double-submit was correctly blocked. Evidence:
    `shots/handout/single-pending-390-en-light.png`, `shots/handout/multi-pending-390-en-light.png`. Principle: status visibility.
    Fix: "Recording…" label + `aria-busy` on the form, as on other app forms.
21. **Arabic: earliest-expiry hint reverses ISO dates** — Hand-out sheet, ar: `2027-09` shows "09-2027", `2026-12-02` shows
    "02-12-2026". Evidence: `shots/handout/single-390-ar-light.png`. Principle: DESIGN.md bidi isolation. Fix: wrap the date in
    `<bdi dir="ltr">` (or `\u2066…\u2069`) in the `assets.store.handovers.fromBatch` interpolation.
22. **Recent handovers omit units** — "Nescafe ×1 · Green tea ×1, 2 units" for 1 carton + 1 packet; ar "وحدتان". Evidence:
    `shots/handout/recent-own-390-ar-dark.png`. Principle: units clarity. Fix: render "1 carton", "1 packet" per line; drop the
    mixed "units" total.
23. **Delete confirm lacks identity and irreversibility** — In & out: "Delete handover? This restores…" — no taker/date/items, no
    undo, record 404 afterwards; disposal confirm does name item + date and says "cannot be undone". Evidence:
    `shots/movements/confirm-390-en-light.png` vs `shots/movements/disposal-delete-confirm-1440-en-light.png`,
    `shots/movements/deleted-toast-390-en-light.png`. Principle: consistency; error prevention. Fix: include taker, date, item summary
    and "This cannot be undone" in `MovementDetailDialog` confirm.
24. **Event date joined to recording time** — In & out: handover on 2026-10-30 shown "Oct 30, 2026 · 04:16 AM" (recorded Oct 31
    04:16). Evidence: `shots/movements/detail-390-en-light.png`. Principle: match real world. Fix: show the event date alone and
    "Recorded Oct 31, 04:16 by …" separately.
25. **Empty store shown as filter failure; chips show 0 while loading/failed** — In & out: true empty feed says "No records match
    this filter"; kind counts read 0 during load and after a 503. Evidence: `shots/movements/true-empty-390-ar-dark.png`,
    `shots/movements/feed-error-1440-ar-dark.png`. Principle: error diagnosis. Fix: separate empty vs filtered-empty copy; show
    "–" counts until a successful response.
26. **Detail/confirm phone targets below 44 px** — In & out 390: Close 24×24, Delete 71×36, Cancel 74×34. Evidence:
    `/tmp/uxr/scripts/movements/delete-results.json`. Principle: DESIGN.md 44 px phone targets. Fix: `min-h-11 min-w-11` on coarse
    pointers in `DialogContent` Close and `confirm-dialog.tsx`.
27. **OCR keeps header lines as items** — Scan review, all: "AL NOOR TRADING LLC" and "Item Qty Unit price Total" become
    unmatched rows needing manual skip (TOTAL row correctly dropped; misspelled "Cofee-mate" matched). Evidence:
    `shots/scan/review-first-390-ar-dark.png`, `/tmp/uxr/scan-matrix.json`. Principle: error prevention. Fix: in
    `backend/app/core/extraction/delivery_note.py` drop lines with no quantity column and column-header lines.
28. **Row crops unreadable on phone** — Scan 390: crops ~322×9 px; "190¢g" check impossible. Evidence:
    `shots/scan/crop-small-390-en-light.png`. Principle: recognition. Fix: `ScanRowCrop` tap-to-enlarge / minimum raster height.
29. **Skip has no undo; all-skipped dead end** — Scan: copy says "Choose another note or enter manually" but neither action is
    shown. Evidence: `shots/scan/all-skipped-390-en-light.png`. Principle: user control. Fix: keep skipped rows restorable in
    `ConfirmForm`; render both actions in the empty state.
30. **Scan validation: stale errors, wrong advice, not linked** — Expiry error says "or select No expiry" (option absent); errors
    persist after correction until Save; inputs `aria-describedby` only the generic summary. Evidence:
    `shots/scan/validation-390-en-light.png`, `shots/scan/confirm-ready-390-en-light.png`, `/tmp/uxr/scan-confirm.json`.
    Principle: WCAG 3.3.1/3.3.3, 1.3.1. Fix: copy per `allowUndated=false`; revalidate field on change in `ConfirmForm`; link
    inline error ids from `Field`.
31. **Rejected file carried into manual fallback** — After rejecting `not-image.txt`, "Enter delivery manually" pre-attaches it;
    delivery #3 saves, then attachment fails with toast. Evidence: `shots/scan/invalid-manual-attached-390-en-light.png`,
    `shots/scan/invalid-manual-save-error-390-en-light.png`. Principle: error prevention. Fix: do not pass rejected files to the fallback.
32. **Expiry mode radios ignore arrow keys** — Scan rows "Full date / Month only": `role=radio` but ArrowRight does nothing, two Tab
    stops. Evidence: `/tmp/uxr/scan-recheck.json` (`expiryKeyboard`). Principle: ARIA radio pattern; consistency with Picture field.
    Fix: native radios / shared RadioGroup in `ExpiryInput.tsx`.
33. **Picture picker: brown drawings illegible in dark** — Item dialog Picture field, dark: jar/box/glove details vanish on dark
    surface; no visible names. Evidence: `shots/scan/picture-390-en-dark.png` vs `shots/scan/picture-edit-390-en-dark.png`.
    Principle: recognition. Fix: neutral light backing tile behind art previews in `StoreItemDialog`.

## Nice

34. **Phone first screen shows no items** — Dashboard 390×844: chrome, intro, 4 month cards, chips fill the viewport; mockup shows
    first shelf row. Evidence: `shots/dashboard/shelves-390-en-light.png` vs `shots/dashboard/mockup-390-en.png`. Fix: collapse the
    month strip to a horizontal scroller on phones.
35. **No date filter on In & out** — searching "2026-10-30"/"Oct 30" returns nothing. Evidence:
    `shots/movements/date-search-no-results-390-en-dark.png`. Fix: add a labelled date-range filter to `StoreMovementsPage`.
