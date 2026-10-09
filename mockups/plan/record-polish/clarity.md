# Record page — Action clarity & smart convenience (tab: `clarity`)

All paths are relative to `frontend/src/`. Abbreviations:

| Abbr | File |
|---|---|
| BRP | `pages/books/BookRecordPage.tsx` |
| HB | `pages/books/HeaderBtn.tsx` |
| QN | `pages/books/QueueNav.tsx` |
| RDA | `pages/books/RecordDecisionActions.tsx` |
| RP | `pages/books/RecordPane.tsx` |
| RPV | `pages/books/RecordPaperViewer.tsx` |
| RL | `pages/books/RecordsList.tsx` |
| BP | `pages/books/BooksPage.tsx` |
| IPD | `pages/books/IncludedPapersDialog.tsx` |
| WHD | `pages/books/WordHandoffDialog.tsx` |
| BWA | `components/books/BookWordActions.tsx` |
| BPrev | `components/books/BookPreview.tsx` |
| ANN | `components/books/BookAnnotationLayer.tsx` |
| SFA | `components/books/SubmitForApprovalDialog.tsx` |
| utils | `components/books/book-detail-drawer-utils.ts` |

Breakpoints:
- **phone** is <640.
- **tablet** is 640–1024.
- **laptop** is 1024–1440.
- **desktop** is ≥1440.

The app's own split is `useIsMobile()` = `max-width: 767px` (`lib/useIsMobile.ts:3`). So 640–767 gets the phone layout, and 768–1023 tablets get the desktop list+pane, usually on touch.

What is already shipped and not re-proposed here (commit `b5e7dbd5`):
- the labelled workflow bar and Tools dropdown (BRP:1149-1384);
- the unified sign confirmation (BRP:1409-1434);
- the mobile timeline `<details>` (BRP:1493);
- truthful empty desk states (BRP:1583-1624).

Structural facts that shape everything below:
- `BookDetailDrawer.tsx` is **dead code**: no importer in `src`, only comments reference it. Do not polish it; delete it in the build.
- The record desk renders bare `DocPdfCanvas` (BRP:1548-1577). `RecordPaperViewer`, with its toolbar, is only used by RP and `ApprovalPreviewDialog`.
- `components/ui/tooltip.tsx` (Radix) has **zero importers and no `TooltipProvider`**. Every hint in the app is a native `title=`, which never shows on touch and is not announced on keyboard focus.
- The `destructive` colour token *is* defined (`index.css:51-52,123,293`). The "undefined destructive variant" wart in DESIGN.md §6 is stale.

---

## 1. Findings

| id | problem | evidence | widths | sev |
|---|---|---|---|---|
| C1 | **No record Delete on the record page at any width, and no Delete path at all on phone.** `api.deleteBook` has only two callers: `BPrev:58` and the desktop bulk bar `BP:334`. `BPrev` opens only from the pane's "Continue editing" (`BP:610`), which phone never reaches. Phone cards have no checkbox (`BP:848-928`). Phone rows always go to `/books/:id` (`BP:240-243`). The only red item on the record page is "Remove signed copy" (BRP:1374-1379), which is not a record delete. | grep `deleteBook`; BRP:1347-1381 | all; phone has zero paths | **high** |
| C2 | **Delete is gated inconsistently and labelled inconsistently.**<br>• `BPrev` shows Discard on `canEdit` (`BPrev:71`), but the backend requires `books.delete` (`backend/app/api/v1/books.py:1497`) and the bulk bar uses `books.delete` (`BP:72`). A `books.edit`-only user is offered a button that returns 403.<br>• "Discard" is **"حذف" (delete)** in `BPrev`, but **"تجاهل" (ignore)** for the Word session, which actually *voids* the book (`books.word.discardConfirm`).<br>• Both show the toast "Draft discarded" (`BWA:68`, `BPrev:62`). | `BPrev:71`; `books.py:1493-1500`; en/ar.json keys | all | med |
| C3 | **Every RecordPane action is icon-only, with only a native `title`.** This covers Continue editing, Send for approval, Revise, Scan signed copy, Open full record, Edit in Word, Add to PDF and Add to email. The pane renders `iconOnly` `PaneBtn` (RP:359-407; `PaneBtn` RP:589-605 sets `aria-label` and `title` only). On 768–1024 touch tablets, which get this pane, there is no hint at all. | RP:211-262, 359-407, 573-607 | tablet, laptop, desktop | **high** |
| C4 | **The Word-session main action is an icon-only ✓, and Discard is an icon-only 🗑 that voids the record.**<br>• Finish is solid navy with a Check glyph (reads as "approve") (`BWA:95-104`). Discard is `BWA:106-115`.<br>• Both are rendered in the record workflow bar (BRP:1162), the pane (RP:354) and the list's draft mini-rows (BP:555).<br>• On phone a disabled "Open in Word" stub sits beside them (`BWA:79-92`). | BWA:73-125 | all | **high** |
| C5 | **Header navigation is icon-only with no tooltip.**<br>• Back (BRP:1030-1037) and the QueueNav chevrons (QN:33-58) have only an `aria-label`.<br>• QueueNav reads "Previous awaiting record" even when the queue is a "returned" filter.<br>• Back hard-codes `navigate('/books')` (BRP:1032), **dropping the list's `status`/`service`/`q`/`open` params and the scroll position**. | BRP:1032; QN:38,54 | all | **high** (the context loss) |
| C6 | **Viewer and dialog utilities are icon-only, with title-only hints.**<br>• RPV: zoom ± (RPV:240-261), Replace (RPV:281-289), Delete paper (RPV:290-298), Full preview (RPV:299-303).<br>• "Delete this document" is styled neutral, not red, and is easy to read as "delete record".<br>• "Fit" just resets to 100% (RPV:265).<br>• IPD row Up/Down/Replace/Remove are invisible until hover at ≥sm (IPD:652-700).<br>• Annotation Pin/Highlight have `title` only, no `aria-label`, no `aria-pressed` (ANN:458-468). | as cited | tablet+ | med |
| C7 | **No hint infrastructure.**<br>• The Radix Tooltip is unused and there is no provider (grep `ui/tooltip`).<br>• There is no `Kbd` component. The only key hint in the app is RefreshButton's `title` "· Alt+R" (`components/refresh/RefreshButton.tsx:14`).<br>• `HeaderBtn` titles only when `iconOnly` (HB:55-56), and no BRP call site sets `iconOnly`. | `components/ui/tooltip.tsx`; HB:55-56 | all | med (enabler) |
| C8 | **Ambiguous labels (EN and AR equally):**<br>• Tools › "State" / "الحالة" (admin override, BRP:1362)<br>• "Send for approval" on a *pending* record actually means re-route (BRP:1217; utils:72-74)<br>• "Mark" / "تحديد" (MarkToggle)<br>• "Original form" / "النموذج الأصلي" = the unsigned PDF (BRP:1309)<br>• "Download signed PDF" uses a ✓ icon (BRP:1293)<br>• "Replace this document" replaces the signed scan (BRP:1341)<br>• "Return" / "إعادة" means return to the author for changes | locale keys `books.stateOverride.trigger`, `books.approval.*`, `books.annotations.mark`, `books.record.viewOriginal` | all | med |
| C9 | **There is no single obvious next step per state.** The bar can show 0 or 2 solid primaries:<br>• `pending` + assignee + `books.submit`: green Sign **and** navy "Send for approval".<br>• `none` + an active Word session: navy Send **and** solid ✓ Finish.<br>• `awaiting_scan`: the only move, "Scan signed copy", is `plain`.<br>• `approved`: the bar is hidden entirely; Download signed is buried in Tools.<br>• Pending, not assignee: nothing says who or what it is waiting on. | BRP:1154-1237, 659-708; utils:26-74 | all | **high** |
| C10 | **Destructive styling and confirmation are inconsistent:**<br>• "Remove signed copy" `ConfirmDialog` lacks `destructive` (BRP:1397-1407), while Word Discard has it (BWA:124).<br>• The State override item is not `variant="danger"` (BRP:1357).<br>• The RPV Delete paper icon is neutral (RPV:290-298).<br>• Annotation delete fires immediately, with no confirm and no undo (ANN:252-258).<br>• Replace signed opens the picker with no confirm (BRP:1339).<br>• The WHD discard confirm label is a generic "Confirm" (WHD:437). | as cited | all | med |
| C11 | **Disabled controls give no reason:**<br>• Revise `disabled={!canRevise}` (BRP:1212; the reason derives from template, fields, capability and live revision, BRP:896-902)<br>• Email via Outlook (BRP:1273)<br>• Edit in Word in the Tools menu: the `needsPc` text from BWA:163 is dropped (BRP:1325)<br>• SFA Submit (SFA:355)<br>• IPD Review/Save (IPD:537,550)<br>• Annotation Save (ANN:331)<br>BPrev "Edit" has a reason, but via `title` only (BPrev:203). | as cited | all | med |
| C12 | **There are zero keyboard shortcuts in `pages/books` and `components/books`.**<br>• The global registry knows 3 actions: Ctrl+K, Ctrl+N, Ctrl+/ (`lib/shortcutsContext.ts:21-25`).<br>• List rows: Enter only *selects* (RL:100-105); there is no ↑/↓, J/K or open-row key.<br>• The viewer has no keyboard zoom or page navigation (RPV and DocPdfCanvas). | grep `keydown`/`e.key` | laptop, desktop | med |
| C13 | **Prev/next exists only when arriving from Approvals.** `useAwaitingQueue` needs an `ApprovalContext` (`pages/books/useAwaitingQueue.ts:49`). BooksPage opens plain `/books/:id` (BP:242). On phone, the list is client-filtered (BP:234-237), but every record must be visited back→scroll→tap. The post-sign "Review next" is a low-weight text link, and only appears after a sign in the current session (BRP:1437-1464). | as cited | phone worst; all | **high** |
| C14 | **There is no way to copy the reference number.**<br>• It renders as plain text in the record header (BRP:1063-1065), pane stamp (RP:286-288), row (RL:143-145) and card (BP:879-881).<br>• `copyToClipboard` (`lib/clipboard.ts:12`, LAN-safe) exists and no book file imports it.<br>• The record page never sets `document.title` (grep), so every record tab reads the same. | as cited | all | med |
| C15 | **Rows are not links.**<br>• Desktop rows are `<button>` (RL:100); cards are `<article role=button>` + `navigate` (BP:861-876); the pane's "Open full record" is a button (RP:252-261). None supports middle-click or Ctrl-click.<br>• Drafts get **no** "Open full record" at all (`state !== 'none'` gate, RP:252).<br>• The row checkbox is an `<input>` nested in a `<button>` (RL:117-131), which is invalid. Its `aria-label` is the bare ref. | as cited | tablet+ | med |
| C16 | **View preferences are not remembered on phone.**<br>• Category, direction and date range live in React state only (`rawFilters`, BP:79). Only status, service, q, drafts and open reach the URL (BP:105-108).<br>• Opening a record and coming back resets them; Back (C5) also drops the URL params.<br>• There is no scroll restoration. `lib/useLocalStorage.ts` exists, with no `.tsx` callers. | BP:78-110 | phone | **high** |
| C17 | **Empty states are dead ends.**<br>• The desktop list shows "No book entries match these filters." even with no filters, and offers no action (RL:187-191).<br>• The pane with nothing selected reuses the same string (RP:163-168).<br>• The phone `EmptyState` is rendered without `actionLabel` (BP:709-715), although the component supports one. | as cited | all | low |
| C18 | **There is no pending feedback, optimistic update or undo.**<br>• `HeaderBtn` has no loading prop. Sign/Return/Reject only go `disabled` with no spinner (BRP:895, 1175-1192; RDA:32-53).<br>• Annotation create is silent (BRP:798-813).<br>• No book mutation is optimistic, and there is no undo in books. The repo already has a deferred-commit undo pattern (`pages/ledger/outlook/useDeferredDelete.ts`, used at `LedgerOutlookShell.tsx:419-431`). | as cited | all | med |
| C19 | **The state pill names the state but explains nothing.** `StatePill` shows only a dot and a label (BRP:415-436). There is no "waiting on / since / returned because". The reason is only visible in the timeline sidebar, which is hidden <768 behind `<details>`. | BRP:415-436, 1493-1531 | all | med |
| C20 | **The desk never says which paper is shown.** The record desk shows the signed PDF via the server swap (BRP:635-643) with no badge. The pane opens the **unsigned** original first for digitally-signed approvals (RP:130-134). ApprovalPreviewDialog opens signed. *Cross-ref: preview tab (complaints 4/5); the clarity part is the label.* | as cited | all | med |

---

## 2. Proposals

Every new string must ship in `en.json` and `ar.json` (peer keys; no `defaultValue` fallbacks — BRP:1287 currently has one).

**Icons:**
- Directional glyphs keep the repo idiom `rtl:-scale-x-100`.
- Kbd caps render inside `<bdi dir="ltr">`.
- Shortcuts match on `KeyboardEvent.code` (physical key), not `key`, so J/K/C/M work on an Arabic layout, where J types "ت".

### P1 — Hint system: `IconAction` + Tooltip + `Kbd` (C3–C7)

**Change:**
- Mount `TooltipProvider` once in `App.tsx`, with `delayDuration={400}` and `skipDelayDuration={150}`.
- Add `components/ui/icon-action.tsx`: a button wrapped in a Radix Tooltip.
  - Content is the label plus an optional `<Kbd>`.
  - It sets `aria-label` and `aria-keyshortcuts`.
  - It drops native `title` to avoid a double tooltip.
- Add `components/ui/kbd.tsx`.
- Migrate the icon-only controls to `IconAction`:
  - Back and QN on the record page;
  - RPV toolbar zoom, full preview, replace and delete;
  - ANN tools, which also gain `aria-pressed`;
  - copy-ref (P6).
- `HeaderBtn` gains an optional `shortcut` prop that shows the tooltip *even when labelled*, so hovering "Sign & approve" shows "S".

**Rule set (the actual answer to complaint 3):**

| class | treatment | examples |
|---|---|---|
| Workflow actions (state moves) | **visible text at every width**; tooltip only for a shortcut | Sign & approve, Return for changes, Reject, Send for approval, Revise & resubmit, Scan signed copy, Finish editing, Discard, Open record |
| Destructive | **visible text, red, always**; never icon-only | Delete record, Remove signed copy, Delete scan, Discard |
| Navigation / chrome | icon + tooltip with key | Back (Esc), Prev (K), Next (J), Copy ref (C), Expand preview (F), Zoom ± |
| Utilities | labelled **menu items** in Tools / More, not icon buttons | Edit in Word, Add to PDF, Add to email, Print, Original PDF |

**Platform behaviour:**
- **Touch:** tooltips don't fire, so every touch-reachable icon-only control must be either labelled or in a labelled menu. That is why P2/P3 move pane utilities into a "More" menu.
- **Desktop:** Radix tooltips also open on keyboard focus, which fixes the keyboard-only gap.
- **RTL:** Radix flips `side="left|right"` per `dir`. Use `side="bottom"` for the header.

**Risk:** low.

**Effort:** M (provider, primitive, around 15 call sites).

### P2 — Label the RecordPane footer (C3, C4)

**Change:**
- Render the `orderedWorkflowActions` (RP:359-374) as **labelled** `PaneBtn` (drop `iconOnly`):
  - at most 2 visible;
  - the primary is solid;
  - the rest go into the overflow.
- Move Edit in Word, Add to PDF and Add to email (RP:382-407) into a labelled "More ▾" `DropdownMenu`, the same component as the Tools menu.
- "Open record" becomes a real `<Link to="/books/:id">`, shown for drafts too. Remove the `state !== 'none'` gate at RP:252.
- `WordSessionActions` takes a `labelled` prop. It renders "Finish editing" (solid) and "Discard…" (red outline, text) everywhere. The icon-only form is deleted, because all three hosts have room once utilities collapse.

**Widths:**
- The pane is `clamp(360px,36%,480px)` (BP:460). At 360px, two labelled buttons plus "More" fit.
- Tablet behaves the same (same pane).
- Phone n/a (no pane).

**RTL:** the primary sits at inline-start (natural reading order); "More" is pinned with `ms-auto`.

**Risk:** Arabic labels are around 20% longer. Cap at 2 visible plus overflow; don't wrap.

**Effort:** S–M.

### P3 — One primary per state + status line (C9, C19, C8)

**Change:**
- Replace the ad-hoc booleans (BRP:1154-1237) with a pure `recordNextStep(state, caps, book)`, next to `footerActionFor` in utils.
  - It returns `{ status: {key, vars}, primary, secondary[], overflow[] }`.
  - Both BRP and RP consume it, which makes the pane and the page agree.
- The workflow bar becomes **[status sentence] … [secondary] [PRIMARY]**.
- Relabels:
  - "Send for approval" on `pending` → **"Change approver…" / "تغيير المعتمِد…"**, demoted to the overflow.
  - Tools › "State" → **"Change state (admin)…" / "تغيير الحالة (للمشرف)…"**, red `variant="danger"`.
  - "Original form" → **"Original (unsigned) PDF" / "النسخة الأصلية (غير الموقّعة)"**.
  - The Download-signed icon ✓ → `Download`.
  - "Mark" → **"Mark up" / "ملاحظات على المستند"**.
  - "Return" → **"Return for changes" / "إعادة للتعديل"**.
  - "Replace this document" (Tools, approved) → **"Replace signed copy" / "استبدال النسخة الموقّعة"**.

| state (viewer) | status line EN / AR | primary (solid) | secondary (labelled) | overflow (Tools/More) |
|---|---|---|---|---|
| draft `none`, can submit | "Draft — not sent yet." / "مسودة — لم تُرسل بعد." | Send for approval | Continue editing; Scan signed copy | Print, Email, Add to PDF, **Delete draft** |
| draft + Word session active | "Being edited in Word." / "قيد التحرير في Word." | Finish editing | Discard… (red) | Print |
| `pending`, I sign | "Waiting for your signature." / "بانتظار توقيعك." | Sign & approve (green) | Return for changes; Reject (red) | Mark up, Change approver…, Scan signed copy, Print |
| `pending`, not me | "Waiting on {{name}} · {{ago}}" / "بانتظار {{name}} · {{ago}}" | — (no fake CTA) | Change approver…; Scan signed copy | Print, Email |
| `pending`, my review | "Your review is requested." / "مطلوب مراجعتك." | Approve as reviewed | Request changes | Print |
| `awaiting_scan` | "Printed for signature — scan the signed copy back." / "مطبوع للتوقيع — امسح النسخة الموقّعة وأرفقها." | **Scan signed copy** (now solid) | Print | Email |
| `approved` | "Signed by {{name}} · {{date}}" / "وقّعه {{name}} · {{date}}" | Download signed PDF | Email; Print | Original (unsigned) PDF, Adjust signature, Replace signed copy, Remove signed copy (red), Change state (admin)… |
| `returned` | "Returned by {{name}}: “{{reason}}”" / "أعاده {{name}}: «{{reason}}»" | Revise & resubmit | — | Print, Delete record |
| `rejected` | "Rejected by {{name}}: “{{reason}}”" / "رفضه {{name}}: «{{reason}}»" | Revise & resubmit | — | Print, Delete record |
| any, `!canRevise` | as above + reason (P5) | Revise (disabled + reason) | — | — |

**Data:** `assignee_name` is on steps (BRP:689-692). Decision timestamp and comment *[INFERENCE: verify field names on `BookApprovalStepRead` before building]*.

**Widths:**
- Desktop/laptop: one header row as today.
- Tablet: the status line wraps above the buttons.
- Phone: the status line stays in the header; actions move to the dock (P4).

**RTL:** quotes «» in AR; names in `<bdi>`.

**Risk:** BRP sign-confirm refs (`desktopSignRef`) must stay wired.

**Effort:** M.

### P4 — Phone action dock for every state + "More" sheet with Delete (C1, C9)

**Change:**
- Generalise the decide-only dock (BRP:1670-1694) to every state.
  - Dock layout: `[secondary] [PRIMARY — flex-1] [⋯ More]`, all labelled, `min-h-[46px]` (RDA idiom).
  - "More" opens a bottom sheet with the P3 overflow, grouped Document / Editing / Admin like the Tools menu.
- On phone, the header workflow bar and the Tools button are removed (the dock owns them). This frees around 2 header rows on phone (crowding cross-ref).
- Keep the existing inline decision panel and the `dockHidden` IntersectionObserver.

**RTL:** the dock already sets `dir` (BRP:1674). Primary sits at the visual centre-to-end.

**Risk:** the dock overlays content. The desk already has `max-md:pb-4`; it needs `pb-[dock height]` for every state, not only decide.

**Effort:** M.

### P5 — Delete record, everywhere, with the correct gate and undo (C1, C2, C10, C18)

**Change:**
- Add **"Delete record" / "حذف السجل"** (Trash2, `variant="danger"`, last item of Tools › Administration and the phone "More" sheet).
- Gate: `has('books.delete') && canMutateCurrent && state ∈ {none, returned, rejected}` (see Q1).
- Fix `BPrev:71` to `has('books.delete')`.
- Confirm uses `ConfirmDialog destructive`:
  - Title: "Delete record {{ref}}?" / "حذف السجل {{ref}}؟"
  - Body: "It leaves the records list. Its reference number stays reserved." / "سيُزال من قائمة السجلات ويبقى رقمه المرجعي محجوزاً."
- On confirm:
  - navigate to the list (with restored context, P7);
  - hide the row;
  - fire `api.deleteBook` after 6 s via the existing `useDeferredDelete` pattern (no backend restore exists: `book_service.delete_book` sets `deleted_at` only, `backend/app/services/book_service.py:1043-1047`);
  - toast "Record {{ref}} deleted" + **Undo / تراجع**.
- Also:
  - add `destructive` to the unfile confirm (BRP:1397);
  - name the WHD confirm button (WHD:437);
  - give annotation delete the same undo toast instead of a confirm (ANN:255).
- Labels:
  - BPrev "Discard" → "Delete draft" / "حذف المسودة".
  - Word session "Discard" → **"Discard draft…" / "إلغاء المسودة…"**, keeping the existing void confirm body.
  - Fix the toast keys so void ≠ delete.

**Risk:** the deferred commit must flush on unmount/navigation (the hook already does `flushAll`).

**Effort:** M.

### P6 — Copy reference + tab title (C14)

**Change:**
- The ref chip in BRP:1063 and RP:286 becomes a button: ref + Copy icon.
  - Tooltip: "Copy reference number · C" / "نسخ الرقم المرجعي · C".
  - It uses `copyToClipboard`; toast "Copied {{ref}}" / "تم نسخ {{ref}}".
- `useEffect` sets `document.title = "{{ref}} · {{subject}} — GSSG"`. Skip this in `?print=1` mode, because `usePrintFilename` owns it there.

**Widths:** all. On phone, the chip has a 44px tap target via padding.

**RTL:** ref in `<bdi dir="ltr">`.

**Risk:** none.

**Effort:** S.

### P7 — Context-preserving Back + prev/next from any list (C5, C13, C16)

**Change:**
1. BooksPage passes `navigate(url, { state: { from: location.pathname + location.search, queue: orderedIds } })` from rows, cards and the pane's "Open". `orderedIds` is `mobileRows` / `desktopRows` ids, already in memory.
2. Back:
   - with `location.state?.from`, use `navigate(-1)` (restores the URL and lets the browser restore scroll);
   - otherwise `/books`.
3. QueueNav falls back to `state.queue` when there is no `ApprovalContext`.
   - Labels become context-neutral: "Previous record" / "السجل السابق", "Next record" / "السجل التالي", with tooltips K / J.
   - Position text stays "3 of 12" / "3 من 12".
4. Move the phone-only filters (category, direction, fromDate, toDate) into the URL (BP:105-108), like the rest.
5. The post-sign "Review next" becomes a primary button in the success strip, with ref and subject.

**RTL:**
- The chevrons already mirror (QN:41,57).
- J/K are physical keys and are not mirrored. Document "J = next" in both languages.

**Risk:** router state is lost on reload. The nav then hides itself (QN:26 already handles `total < 2`).

**Effort:** S–M.

### P8 — Disabled-with-reason (C11)

**Change:**
- Add a `reason?: string` prop to `HeaderBtn`, `PaneBtn` and the menu items.
- With a reason:
  - render `aria-disabled` instead of `disabled`, so the control stays focusable;
  - on desktop show a tooltip;
  - on touch show a one-line helper under the control (the existing `needsPc` idiom, BWA:89).
- Reasons:

| control | EN / AR |
|---|---|
| Revise | "Can't revise: not made from a form template." / "لا يمكن التعديل: لم يُنشأ من نموذج." — or the permission variant "Needs document-generation permission." / "يتطلب صلاحية إنشاء المستندات." |
| Email | "No document to attach yet." / "لا يوجد مستند لإرفاقه بعد." |
| Edit in Word (phone) | existing `books.word.needsPc` |
| SFA Submit | "Choose an approver first." / "اختر المعتمِد أولاً." |

**Risk:** `canRevise` collapses 4 conditions (BRP:896-902). Split them to pick the reason.

**Effort:** S.

### P9 — Keyboard layer for books (C12)

**Change:**
- Extend `ShortcutAction` (`lib/shortcutsContext.ts:10-25`) with a "Records" group.
- Register from BRP and BP via `useShortcutAction`.
- Shortcuts are bare keys, ignored in inputs (the existing `isEditableTarget`), and matched on `code`.

| key | where | action |
|---|---|---|
| J / K | list, record | next / previous record (list: move selection; record: P7 queue) |
| Enter / Ctrl+Enter | list | open full record / in new tab |
| Esc | record (no dialog/menu open) | Back (P7) |
| C | list, record | copy reference |
| S | record, decide | open **sign confirm** (never signs directly) |
| M | record, decide | toggle Mark up |
| F | record, pane | expand preview (cross-ref preview tab) |
| + / − / 0 | viewer | zoom in / out / reset |
| ? (Shift+/) | global | open existing shortcuts help (`components/ui/shortcuts-help.tsx`), now listing Records |

- No key for Return, Reject or Delete; those destructive actions stay mouse/tap plus confirm.
- Hints appear via P1 tooltips on Back, QN, copy ref, Sign and Mark.

**Risk:** a conflict with the annotation draft textarea, which `isEditableTarget` covers.

**Effort:** M.

### P10 — Pending and optimistic feedback (C18)

**Change:**
- `HeaderBtn` and RDA get `pending` → spinner + "Signing…" / "جارٍ التوقيع…", "Returning…" / "جارٍ الإعادة…".
- Annotation create becomes optimistic (`onMutate` + `setQueryData` + rollback, the `StarButton.tsx:30-67` idiom). Its success toast stays silent.
- Scan upload already has `toast.loading` (`useAddScan.ts:46`). Mirror it on the bar button.

**Risk:** low.

**Effort:** S.

### P11 — Rows as links, empty states with a way out (C15, C17)

**Change:**
- Desktop row: keep the `<button>` select, but make the ref cell a `<Link to="/books/:id">`. This gives middle-click and Ctrl-click and fixes the nested checkbox: move the checkbox out of the button, as a sibling cell.
- Checkbox `aria-label` becomes "Select {{ref}}" / "تحديد {{ref}}".
- Phone card: wrap it in `<Link>` instead of `role=button`.
- Empty states:
  - filtered: "No records match these filters." + **Clear filters** (existing `books.filters.clear`);
  - unfiltered: existing `books.emptyUnfiltered` + **New record** (Ctrl+N route);
  - pane with nothing selected: "Select a record to preview it." / "اختر سجلاً لمعاينته."

**Risk:** low.

**Effort:** S.

### P12 — "Which paper am I looking at" badge (C20)

**Change:** a small pill top-inline-start on the desk and the pane viewer: **"Signed copy" / "النسخة الموقّعة"** (success tone + ✓) or **"Original (unsigned)" / "الأصل (غير موقّع)"** (neutral). On approved records it links to the other paper. The paper-order decision itself belongs to the preview tab; this is only the label.

**Effort:** S.

### Top 10 "feels smart" wins (impact ÷ effort)

| # | win | impact | effort | proposals |
|---|---|---|---|---|
| 1 | **Back returns to the exact list you left** (filters, selection, scroll), and phone filters persist | high — every phone round-trip today resets the list | S | P7 (2, 4) |
| 2 | **Delete record reachable on phone and the record page, with Undo** | high — complaint 1 | M | P4, P5 |
| 3 | **Labels on every workflow action; tooltips + key hints on the rest** | high — complaint 3 | M | P1, P2 |
| 4 | **One primary per state + "Waiting on X · 2 days" status line** | high | M | P3 |
| 5 | **Prev/next through whatever list you came from (J/K)** | high on phone, med desktop | S–M | P7 (1, 3) |
| 6 | **Click ref to copy; browser tab shows the ref** | med, used constantly | S | P6 |
| 7 | **Disabled buttons say why** | med | S | P8 |
| 8 | **Spinners/"Signing…" on pending buttons; optimistic marks** | med | S | P10 |
| 9 | **Keyboard layer + `?` help listing it** | med (desk users) | M | P9 |
| 10 | **Rows open in a new tab; empty states offer Clear/New; signed/original badge** | med | S | P11, P12 |

---

## 3. Prototype spec (clarity layer)

Build on the shipped Option B header. Tokens per DESIGN.md:
- navy `--primary` for the primary;
- `--success` for Sign;
- `--accent` red for destructive;
- 9-unit (`h-9`) controls on desktop, `min-h-[46px]` on phone.

### Desktop ≥1440 / laptop 1024–1440 — record page header

```
[←]  [‹] 3 of 12 [›]   1-0042 [⧉]   Leave application — SAEED A…     [● PENDING] [Classified]
                       Submitted by NAME · G1234
┌ status: Waiting for your signature.          [Mark up] [Return for changes] [Reject] [✎ Sign & approve] ┐
└──────────────────────────────────────────────────────────────────────────────────────────── [Tools ▾] ┘
```

- **Tooltips:**
  - ← "Back to records · Esc"
  - ‹ "Previous record · K"
  - › "Next record · J"
  - ⧉ "Copy reference number · C"
  - Sign "S"
  - Mark up "M"
- **Tools ▾ groups:**
  - Document: Print · Email via Outlook · Add to PDF · Download signed PDF · Original (unsigned) PDF.
  - Editing: Edit in Word (new version) · Adjust signature · Replace signed copy.
  - Administration: Change state (admin)… [red] · Retained revision access · Remove signed copy [red] · Delete record [red, last, separated].
- Disabled items show a grey second line with the reason.

### Tablet 640–1024

- Same content. The header wraps into 3 rows (identity / chips + status line / actions).
- Mark up moves into Tools.
- Secondary buttons keep their labels.
- No icon-only control without a menu equivalent (touch).

### Phone <640 (app phone layout to 767)

- Header: [←] ref [⧉] [‹ 3/12 ›], subject (wraps), pill + status line.
- No workflow bar and no Tools in the header.
- **Bottom dock:** `[Return] [Reject] [✎ Sign & approve]` for decide (existing). For other states: `[secondary] [PRIMARY] [⋯ More]`.
- **More sheet:** grouped list; Delete record is the last row, red, then the confirm, then the undo toast at the bottom above the dock.

### Records pane footer (≥768)

```
[✎ Send for approval] [Continue editing]                 [Open ↗] [More ▾]
```

More ▾ holds Edit in Word · Add to PDF · Add to email · Delete draft (red).

### States to demo (each EN and AR)

1. draft, can submit
2. draft + Word session active (Finish editing / Discard draft…)
3. pending — I sign, with the post-click "Signing…" spinner
4. pending — waiting on someone else (no primary, status line only)
5. pending — my review
6. awaiting_scan (Scan signed copy is solid)
7. approved + signed (Download signed primary; "Signed copy" badge on desk; Tools open)
8. returned with reason (Revise & resubmit)
9. rejected, Revise disabled with reason "not made from a form template"
10. no document (existing empty state)

### Interaction demos

- copy-ref toast "Copied 1-0042" / "تم نسخ 1-0042";
- delete flow: menu → confirm → list with the row hidden and an Undo toast;
- the `?` help sheet with a Records section;
- phone prev/next arriving from a filtered list;
- Back returning to the same filtered list.

### New / changed strings (EN / AR)

| key (suggested) | EN | AR |
|---|---|---|
| books.record.copyRef | Copy reference number | نسخ الرقم المرجعي |
| books.record.copiedRef | Copied {{ref}} | تم نسخ {{ref}} |
| books.record.prevRecord / nextRecord | Previous record / Next record | السجل السابق / السجل التالي |
| books.record.delete | Delete record | حذف السجل |
| books.record.deleteTitle | Delete record {{ref}}? | حذف السجل {{ref}}؟ |
| books.record.deleteBody | It leaves the records list. Its reference number stays reserved. | سيُزال من قائمة السجلات ويبقى رقمه المرجعي محجوزاً. |
| books.record.deleted | Record {{ref}} deleted | تم حذف السجل {{ref}} |
| books.preview.discard (relabel) | Delete draft | حذف المسودة |
| books.word.discard (relabel) | Discard draft… | إلغاء المسودة… |
| books.stateOverride.trigger (relabel) | Change state (admin)… | تغيير الحالة (للمشرف)… |
| books.approval.reroute | Change approver… | تغيير المعتمِد… |
| books.approval.return (relabel) | Return for changes | إعادة للتعديل |
| books.annotations.mark (relabel) | Mark up | ملاحظات على المستند |
| books.record.viewOriginal (relabel) | Original (unsigned) PDF | النسخة الأصلية (غير الموقّعة) |
| books.pane.replaceSigned | Replace signed copy | استبدال النسخة الموقّعة |
| books.status.* | see the P3 table | see the P3 table |
| books.reason.* | see the P8 table | see the P8 table |
| books.approval.signing | Signing… | جارٍ التوقيع… |
| books.pane.selectToPreview | Select a record to preview it. | اختر سجلاً لمعاينته. |
| books.paper.signedBadge / originalBadge | Signed copy / Original (unsigned) | النسخة الموقّعة / الأصل (غير موقّع) |
| shortcuts.group.records | Records | السجلات |

---

## 4. Open questions

1. **Which states may be deleted?** The backend allows any state with `books.delete` (soft delete; ref not released).
   - Recommended: draft, returned and rejected only. Pending, awaiting-scan and approved must go through "Change state (admin)… → Voided", so a signed record never disappears with one tap.
   - Alternative: any state, with a typed-ref confirm.
2. **Undo vs an immediate delete.** The recommended deferred commit (6 s, the ledger pattern) needs no backend change. The record is truly deleted only after the toast. A server-side restore endpoint would allow longer undo windows, but it is new API surface.
3. **Bare-letter shortcuts (J/K/C/S/M)** vs modifier-only (Alt+J…). Bare letters are faster and match Gmail/Linear conventions. They are already safe-guarded in inputs, but a stray key in a non-input focus could open the sign confirm (never sign).

---

## Appendix — icon-only and ambiguous control inventory

Tooltip column:
- "title" = native `title` (hover only, invisible on touch).
- No Radix Tooltip is used anywhere in scope.

The target column is the proposal: **Text** = visible label; **Tip+key** = `IconAction` tooltip with a shortcut; **Menu** = labelled menu item; **Delete** = remove.

| control | file:line | visible label | tooltip | aria-label | target |
|---|---|---|---|---|---|
| Back | BRP:1030-1037 | no | none | `books.record.back` | Tip+key (Esc), context-preserving |
| Queue prev / next | QN:33-58 | no | none | `prevAwaiting` / `nextAwaiting` | Tip+key (K/J), neutral wording |
| Ref number | BRP:1063-1065 | text, not actionable | — | — | add copy button, Tip+key (C) |
| Word Finish ✓ | BWA:95-104 | no | title | `books.word.finish` | Text, solid primary |
| Word Discard 🗑 | BWA:106-115 | no | title | `books.word.discard` | Text "Discard draft…", red |
| Word "Open in Word" (phone stub) | BWA:79-92 | yes (disabled) | — | — | keep, reason line exists |
| Mark toggle | MarkToggle.tsx:21-28 | "Mark" (ambiguous) | none | aria-pressed | Text "Mark up", key M |
| Tools › State | BRP:1356-1363 | "State" (ambiguous) | — | — | "Change state (admin)…", danger |
| Tools › Download signed (✓ icon) | BRP:1290-1296 | yes | — | — | Download icon |
| Tools › Original form | BRP:1298-1312 | ambiguous | — | — | "Original (unsigned) PDF" |
| Tools › Replace this document | BRP:1338-1342 | ambiguous | — | — | "Replace signed copy" |
| Tools › Email (disabled) | BRP:1272-1282 | yes | none | — | + reason |
| Tools › Edit in Word (disabled on phone) | BRP:1323-1330 | yes | none (needsPc dropped) | — | + reason |
| Bar › Send for approval (pending) | BRP:1217-1227 | ambiguous (re-route) | — | — | "Change approver…", overflow |
| Bar › Revise (disabled) | BRP:1207-1215 | yes | none | — | + reason |
| Pane › Continue editing | RP:211-220, 359 | no | title | label | Text |
| Pane › Send for approval | RP:222-231 | no | title | label | Text |
| Pane › Revise | RP:232-241 | no | title | label | Text |
| Pane › Scan signed copy | RP:242-251 | no | title | label | Text |
| Pane › Open full record | RP:252-261 | no | title | label | Text + real `<Link>`, also for drafts |
| Pane › Edit in Word | RP:382-388; BWA:191-203 | no | title | label | Menu |
| Pane › Add to PDF | RP:389-402 | no | title | label | Menu |
| Pane › Add to email | RP:403-407 | no | title | `basket.add` | Menu |
| Pane › Add-scan tile | RP:268-281 | 0.56em text | title | none | keep, enlarge label |
| Viewer › Zoom − / + | RPV:240-261 | no | title | label | Tip+key (− / +) |
| Viewer › Fit | RPV:262-267 | "Fit" (actually 100%) | title | label | "100%", key 0 |
| Viewer › Replace | RPV:281-289 | no | title | label | Tip, "Replace this scan" |
| Viewer › Delete paper | RPV:290-298 | no | title | label | red, Tip "Delete this scan" |
| Viewer › Full preview | RPV:299-303 | no | title | label | Tip+key (F) |
| Annotation › Pin / Highlight | ANN:186-197, 458-468 | no | title | **none** | Tip + aria-label + aria-pressed |
| Annotation › Delete mark | ANN:252-264 | no | none | `books.annotations.delete` | Tip + undo toast |
| IPD row Up/Down/Replace/Remove | IPD:652-700 | no; invisible until hover ≥sm | none | yes (with filename) | always visible on touch, Tip |
| Row checkbox | RL:117-131 | no | none | bare ref | "Select {{ref}}", move out of `<button>` |
| Row paper count | RL:168-176 | number only | title | none | Tip "{{n}} papers" |
| BookPreview Close / APD Close / SFA Close / RAP Close | BPrev:121-129 etc. | no | none | `common.close` | Tip (Esc) |
| Mobile date from / to | BooksFilterBar.tsx:407-419 | no | none | yes | visible "From / To" labels |
| Drafts card "Drafts" / "+N Drafts" | BP:541, 564 | duplicate text | none | none | distinct labels |
| `BookDetailDrawer` (all) | BookDetailDrawer.tsx | — | — | — | Delete (dead code) |
