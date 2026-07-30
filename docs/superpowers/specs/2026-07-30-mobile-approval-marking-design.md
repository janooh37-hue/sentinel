# Mobile approval: arm-to-mark + queue navigation

**Date:** 2026-07-30
**Surface:** `/books/:id` (`frontend/src/pages/books/BookRecordPage.tsx`) on phones
**Reported by:** operator (manager reviewing documents for approval on a phone)

## Problem

A manager opening a book that awaits their decision cannot read the paper. The
annotation overlay is forced on with no way to turn it off, and it swallows
every touch on the document.

Reproduced on the live build at 390×844 (screenshots in `docs/repro/`):

| Symptom | Measured evidence |
|---|---|
| Pinch-zoom and drag are dead | A 332×482 layer with `touch-action:none; pointer-events:auto` covers the whole document. `document.elementFromPoint()` at the paper's centre returns the overlay, never the canvas. `BookAnnotationLayer.tsx:140,144` |
| Pin/Highlight toolbar never goes away | `annMode` is hardcoded to `'mark'` for the deciding manager — there is no off switch. `BookRecordPage.tsx:353` |
| Comment box opens behind the keyboard | Tapping the signature row opened the composer at y 698–825. The iPhone keyboard starts at y 508, Android at ~574 — the box is fully buried on both. |
| Box does not track the keyboard | `MarkPopover` clamps against `window.innerHeight` and listens only to `window` `scroll`/`resize`. No `visualViewport` listener. `BookAnnotationLayer.tsx:341-375` |
| Keyboard stays up after the box closes | No `blur()` before the draft is cleared; iOS keeps the keyboard raised when a focused element unmounts. |

The document is A4 rendered to ~332px wide on a phone. It is unreadable without
zoom, and zoom is exactly what the overlay blocks.

## Assumptions

Confirmed with the operator:

1. Marking stays on mobile — it becomes opt-in, not always-on.
2. After a decision the page auto-advances to the next book still awaiting the
   manager, falling back to the records list only when the queue empties.
3. Managers use both iPhone/Safari and Android/Chrome; the keyboard fix must
   work on both.

## Explicitly out of scope

**No transform-based zoom control.** `frontend/src/lib/usePanZoom.ts` is the
obvious reuse and it is wrong here. It scales via CSS `transform`, but
`DocPdfCanvas.measure()` derives page boxes from `getBoundingClientRect()` while
`BookAnnotationLayer` places marks as `position:absolute` in untransformed CSS
pixels — scaling the wrapper would offset every mark, and `ResizeObserver` does
not fire on transforms so it would never self-correct.

`frontend/index.html` sets `width=device-width, initial-scale=1.0` with no
`user-scalable=no`, so native browser pinch already works. Native visual zoom
does not change `getBoundingClientRect()` CSS pixels, so marks stay anchored for
free. The fix is to stop blocking the gesture, not to reimplement it.

Anyone tempted to add a zoom layer later should read this paragraph first.

---

## Section 1 — Arm-to-mark (the reported defect)

### Behaviour

The overlay is **disarmed** by default. The paper behaves like a plain document:
native pinch-zoom, scroll and drag all work, and nothing floats over the page
header.

A single **Mark** (`تحديد`) button in the record page header arms it. While
armed:

- The Pin/Highlight tool pill appears (unchanged from today).
- A tap places a pin; a drag places a highlight.
- The composer opens, the manager types, and Save or Cancel **disarms** the
  overlay again.

One arm = one mark. To add a second, tap Mark again. This is deliberate: it
makes the read-the-paper state the default and the marking state the exception.

### Touch handling

`touch-action: none` is applied **only while a highlight drag is in flight** —
not for the whole armed mode, and never for pins. A tap works fine under
`touch-action: auto`, so a manager who only ever pins never loses the gesture.

Disarmed, the overlay root is `pointer-events: none`. Persisted mark badges keep
`pointer-events: auto` so a manager can still tap a numbered badge to read an
existing comment without arming anything.

### Composer on phones

Below the `md` breakpoint the composer stops being a card anchored to the mark
and becomes a **bottom sheet**, pinned above the keyboard:

```
bottom = (window.innerHeight - visualViewport.height - visualViewport.offsetTop)
```

It carries the mark number (`Mark 3`) so the manager knows what they are
commenting on without the card sitting on top of it. Above `md` the existing
anchored card is unchanged.

This deletes the clamping problem rather than teaching the clamp about
keyboards, and it removes `autoFocus` as a first-paint hazard.

### Keyboard event sources

Listen to **both** `visualViewport.resize` and `visualViewport.scroll`.
`window.resize` does not fire on iOS when the keyboard opens — a resize-only fix
would silently no-op on half the fleet. Fall back to the current `window`
listeners when `visualViewport` is undefined (jsdom, old browsers).

### Keyboard dismissal

- Save and Cancel call `blur()` on the textarea **before** clearing the draft,
  so the keyboard comes down with the box.
- If the manager dismisses the keyboard by hand mid-typing, the draft **stays
  open with its text intact**. Losing typed text to a stray swipe is worse than
  an extra tap on Cancel.

### Files

- `frontend/src/components/books/BookAnnotationLayer.tsx` — armed state, touch
  handling, bottom-sheet composer, `visualViewport`, `blur()`.
- `frontend/src/pages/books/BookRecordPage.tsx` — the Mark button in the header;
  `annMode` becomes `'mark'` only when armed.

---

## Section 2 — Prev/next through the approval queue

### Behaviour

Arrows beside the back button in the record page header:

```
‹   3 of 7   ›
```

They walk the manager's awaiting queue so they never have to return to the list
to reach the next document.

Hidden entirely when the queue holds fewer than two books, so nothing changes
for anyone who is not working a stack.

### Data

Reuses what already exists — no backend change, no `openapi.json` /
`api.types.ts` regeneration:

- `GET /books/awaiting` (`backend/app/api/v1/books.py:429`), already returning
  books whose pending step is assigned to the caller.
- `api.listAwaitingBooks` under query key `['books','awaiting']`, already
  consumed by `BooksAwaitingWidget`.
- Order is `Book.created_at DESC` (`book_service.py:833`) — the same order the
  dashboard's "Awaiting your approval" list shows, so the arrows walk the list
  the manager already knows and they never lose their place.

Position is derived by finding the current `bookId` in that array. A book that
is not in the queue (an approved record opened from search) shows no arrows.

### After a decision

The two decision paths are not symmetric today, and the asymmetry is deliberate:

- **Return / Reject** (`onDecided`) currently navigates to `/books`
  (`BookRecordPage.tsx:380-384`). Auto-advance replaces that navigation with the
  next awaiting book — strictly better, since it already leaves the record.
- **Sign & approve** (`onSigned`) deliberately **stays on the record**
  (`BookRecordPage.tsx:385-389`): the refetch flips the state to approved and
  the desk reloads the signed PDF, so the signer watches their signature land on
  the document. That confirmation is the whole reason the handler is a no-op.

Auto-advancing on approve would destroy that confirmation. So: approve keeps
standing still, and the queue counter simply updates underneath it — the decided
book drops out and `›` is one tap away. Return and reject advance immediately.

When the queue empties, fall back to `/books`.

`useBookApprovalActions.ts:36` already invalidates `['books','awaiting']` on both
paths, so the queue is re-fetched before the next target is chosen — the decided
book removes itself and the index shifts naturally.

### Placement and RTL

The arrows go in the **header**, next to the back button — not on the desk.
`BookRecordPage.tsx:711` deliberately pins the desk to `direction: ltr` so the
Progress rail does not flip sides in Arabic; chevrons placed inside it would
point the wrong way. In the header they inherit page direction and flip
correctly.

Use logical CSS (`ms-`/`me-`, `text-start`) throughout, per the repo convention.

### Files

- `frontend/src/pages/books/BookRecordPage.tsx` — arrows, counter, auto-advance.

---

## i18n

New keys under `books.annotations` and `books.record`, added to **both**
`en.json` and `ar.json`:

| Key | EN | AR |
|---|---|---|
| `books.annotations.mark` | Mark | تحديد |
| `books.annotations.markHint` | Tap the spot that needs fixing | انقر على الموضع الذي يحتاج تصحيحاً |
| `books.annotations.markingOn` | Marking on — tap to cancel | التحديد مُفعّل — انقر للإلغاء |
| `books.record.prevAwaiting` | Previous awaiting record | السجل السابق بانتظار الاعتماد |
| `books.record.nextAwaiting` | Next awaiting record | السجل التالي بانتظار الاعتماد |
| `books.record.queuePosition` | {{n}} of {{total}} | {{n}} من {{total}} |

Existing `books.annotations.hint` ("Click to pin · drag to highlight") is
mouse-worded and stays for desktop; `markHint` is its touch equivalent.

Wording follows the existing Arabic annotation vocabulary already in `ar.json`
(دبوس / تظليل / علامة).

## Testing

Backend: unchanged, so no new backend tests.

Frontend (vitest), the real check for both sections:

1. **Disarmed by default** — on a pending book the manager can decide, the
   overlay root has `pointer-events: none` and no tool pill is rendered.
2. **Arming** — clicking Mark renders the pill and makes the overlay
   interactive.
3. **Touch-action** — armed with the pin tool, `touch-action` is not `none`;
   it becomes `none` only during a highlight drag.
4. **Disarm on save and on cancel** — one arm yields one mark.
5. **Keyboard** — with a stubbed `window.visualViewport`, the composer's bottom
   offset tracks `height`/`offsetTop`; changing them repositions it.
6. **Blur before clear** — Cancel and Save blur the textarea before the draft
   clears.
7. **Draft survives a manual keyboard dismissal** — text is retained.
8. **Arrows** — with a mocked `/books/awaiting` of 3 books, position reads
   "2 of 3", both arrows navigate, and the arrows are absent for a 1-book queue.
9. **Auto-advance** — return/reject move the route to the next awaiting book;
   with an emptied queue they land on `/books`. Approve stays on the record
   (asserting the existing signature-confirmation behaviour is not regressed).
10. **Arabic** — every new string asserted under `lng: ar` against the **Arabic**
    text, not the key. An English-only assertion cannot catch an AR leak when the
    EN label equals the key — that is exactly how the leave-type leak shipped
    green (fixed in c0db9fb).

Manual verification runs on a dev server against a scratch copy of the SQLite
database, never production: this checkout is the live build, and production
currently holds 0 pending and 0 awaiting books, so there is nothing to walk with
real data.

Gates: `pnpm -C frontend run lint`, `pnpm -C frontend exec tsc -b --noEmit`,
`pnpm -C frontend test`. Run the `i18n-rtl-reviewer` agent afterwards — bilingual
leaks are this repo's most frequent defect class.

## Rollout

Section 1 is the reported defect and ships first. Section 2 is a new feature and
must not delay it. Both are frontend-only, so deployment is
`scripts\mng.ps1 deploy` (or `update` after the push to `origin/main`).
