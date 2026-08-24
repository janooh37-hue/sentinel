# PR: Mobile approval — arm-to-mark + queue navigation

**Open at:** https://github.com/janooh37-hue/sentinel/pull/new/feature/mobile-approval-marking

**Base:** `main` ← **Compare:** `feature/mobile-approval-marking`

---

## Title

```
fix(books): make the approval paper readable on a phone + walk the queue
```

## Body

```markdown
A manager reviewing documents for approval on a phone could not read them.

Measured on the live build at a 390×844 viewport before this change:

- An invisible 332×482 overlay with `pointer-events:auto; touch-action:none`
  covered the whole document, so `elementFromPoint` at the paper's centre
  returned the overlay, not the PDF canvas. Pinch-zoom and scroll were dead —
  and an A4 page renders ~332px wide on a phone, unreadable without zoom.
- Marking was forced on for the deciding manager (`annMode` hardcoded to
  `'mark'`) with no way to turn it off, so the Pin/Highlight pill sat
  permanently on top of the paper's header.
- Tapping to comment opened the composer at y 698–825, while the iPhone
  keyboard starts at y 508 and Android's at ~574 — fully buried on both.
- The composer positioned against `window.innerHeight` and listened only to
  `window`'s `resize`, which iOS never fires when the keyboard opens.

## What changed

**Marking is now opt-in.** The overlay is `pointer-events:none` until the
manager taps **Mark** (تحديد) in the header. One arm yields one mark: saving
or cancelling disarms. `touch-action:none` applies only when the Highlight
tool is selected — it keys off the tool rather than a live drag, because the
browser commits to scroll-vs-gesture on `pointerdown`. Pin is the default, so
arming alone never costs pinch-zoom.

**The composer is keyboard-aware.** On phones it becomes a bottom sheet
positioned from `visualViewport`, listening to both its `resize` and `scroll`
events (iOS fires `scroll`, not `resize`). `blur()` runs before the draft
clears so the keyboard comes down with the box. Dismissing the keyboard by
hand leaves the draft and its text intact.

**Prev/next arrows** walk the manager's approval queue (`‹ 3 of 7 ›`) so they
never return to the list. Return/reject auto-advance to the next awaiting
record; **Sign & approve deliberately does not** — the signer stays put to
watch their signature land on the reloaded PDF.

## Notes for review

- **No backend changes**, no `openapi.json` / `api.types.ts` regeneration. The
  arrows reuse the existing `GET /books/awaiting` and the `['books','awaiting']`
  query key, sharing one cache entry with the dashboard widget (and gated on the
  same `books.approve` capability).
- **No transform-based zoom, deliberately.** `usePanZoom` looks like the obvious
  reuse and is wrong here: mark placement is measured in untransformed CSS
  pixels, so any `transform` desyncs every mark and `ResizeObserver` never fires
  to correct it. Native browser pinch already works once we stop blocking it.
  This is written into the spec so nobody re-adds it.
- Arm state is derived (`armedFor === bookId`), not a boolean — `/books/:id` has
  no `key` on its route, so it does not remount when only the id param changes.

## Verification

Full suite **471 passed**; the single failure
(`TemplateForm.bodyMode.test.tsx > "picker renders base and custom options as
separate groups"`) is pre-existing on `main` and unrelated. Baseline before this
work was 437 passing, so +34 tests and no regressions.

`tsc -b --noEmit` clean. Lint unchanged from the `main` baseline (8 pre-existing
problems in untouched files; none of the files this branch adds or edits appear).

Manually verified on a dev server at 390×844 against a real record:

| Check | Result |
|---|---|
| Disarmed: touch at paper centre | `CANVAS` — reaches the PDF (was: the overlay) |
| Disarmed: overlay | `pointer-events: none`, `touch-action: auto` |
| Mark button | `"Mark"` → `"Marking on — tap to cancel"`, `aria-pressed` false → true |
| Armed with Pin (default) | `touch-action: auto` — pinch-zoom survives arming |
| Composer | full-width `position: fixed` sheet pinned above the keyboard inset |

An `i18n-rtl-reviewer` pass returned no must-fix items: en/ar key parity, Arabic
values correct, chevrons use the repo's `rtl:-scale-x-100` idiom and sit in the
header outside the `direction: ltr`-pinned desk subtree, logical CSS throughout.
The Arabic tests assert the Arabic strings themselves, not translation keys.

## Caught in review, worth knowing

- **Cross-record write (blocking, fixed in `aab66df`).** The draft-reset effect
  keyed off `mode`, but disarming changes `armed`. Arm on record A, open the
  composer, tap a queue arrow → `armed` flips false while `mode` stays `'mark'`
  (the next record is also pending — that is what the queue contains), so the
  composer survived with A's text and Save wrote the annotation to **B**. Now
  keyed off `live`, with a test that fails against the old condition.
- **Safe-area padding (fixed in `97998e6`).** The first attempt used
  `pb-[env(safe-area-inset-bottom)]` with no fallback, which beat `p-3` and then
  resolved to `0` on every device without a bottom inset — removing the sheet's
  padding rather than adding to it. Only visible by loading the real page; now
  `max(0.75rem, env(safe-area-inset-bottom))`.

## Deploy

Frontend-only. After merge: `scripts\mng.ps1 update` on the office server (or
`deploy` for a local build). This checkout is the live build, so this must reach
`origin/main` or the next pull overwrites it.
```
