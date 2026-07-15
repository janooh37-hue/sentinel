# Send-to-Group Composer Redesign — Design Spec

**Date:** 2026-07-15
**Status:** Approved by operator (mockup-driven; final mockup: `docs/send-to-group-composer-final.html`)
**Mockup lineage:** `send-to-group-mockups.html` (3 layouts) → `send-to-group-hybrid-mockups.html` (A+B hybrids) → `send-to-group-phoneview-mockups.html` (3 phone-view variants) → **`send-to-group-composer-final.html` (approved)**

## Problem

`/announcements/send` (SendToGroupPage) is a narrow `max-w-2xl` single column stranded
in a wide viewport. Recipients scroll away while composing; there is no sense of what
the message will look like on arrival, no sense of reach, and the employee-mention
insert is plain text only.

## Approved design

Full-width 3-column layout inside the app frame:

```
| Recipients rail            | Composer card                | Live phone preview   |
| - search groups            | - Message label + view      | - iPhone-14 framed   |
| - group rows w/ checkbox   |   switch: Normal | Extended  |   WA chat render     |
| - reach meter (navy)       | - text box (the ONE input)  | - live text sync     |
|                            | - mention bar w/ mode switch| - doc chip when      |
|                            | - attachment section        |   attachment chosen  |
|                            | - send row                  |                      |
```

### View modes (the signature interaction)

Typing ALWAYS happens in the real text box. The two modes only change what surrounds it:

- **Normal (default)** — full-height textarea in the composer card; live iPhone preview
  standing in the third column. AR label: **عادي**.
- **Extended view** — one coordinated animation: the side-phone column collapses
  (fade + translate) while a **WhatsApp Web/desktop-style chat window** unfolds above
  the text box inside the composer card, and the text box melts into that window's
  composer bar (emoji/attach/mic icons appear, textarea becomes the pill input).
  AR label: **عرض موسّع**.
- Animations: CSS-only (grid-template-columns, height, opacity, transform transitions,
  ~0.4–0.55s cubic-bezier). `prefers-reduced-motion` disables all of it.

### Live preview requirements

- Renders the exact outgoing message as a WA bubble: attachment doc chip (when a
  record/upload is chosen), message text, mention spans in WhatsApp blue, time + ticks.
- Updates on every keystroke (input event, plain state — no debounce needed).
- **Normal-view phone:** true iPhone 14 screen proportions — 390×844 CSS pt (19.5:9),
  dark bezel + notch. **The message bubble must use the available screen width:
  `max-width: 94%` of the chat surface (`width: fit-content`) — long broadcasts fill
  the phone width like real WhatsApp; no wasted side gutter.**
- **Extended-view window:** WhatsApp Web look — gray desktop header (`#f0f2f5` light /
  `#202c33` dark) with dark text, wide chat surface, bubbles capped at ~62% width,
  composer bar at the bottom (`#f0f2f5`/`#202c33`) hosting the real textarea.
- Preview shows the FIRST selected group's name in the chat header; hint clarifies it
  sends identically to all selected groups.

### Mention insert modes (must-have)

The mention bar gets a two-position mode switch:

- **@ Mention — notifies him** (default): inserts `@<Name>` and, on send, the backend
  passes the employee's linked WhatsApp number so WhatsApp renders a real tappable
  mention and notifies the person. AR: **إشارة — يصله تنبيه**.
- **Plain name**: inserts the bare name text, no tag, no notification. AR: **اسم فقط**.
- Both modes insert at the caret position of the text box.
- Preview renders `@Name` tokens of mention-mode-inserted employees in WA blue;
  plain names stay plain.
- Real-mention backend: broadcast request carries the mentioned employees' numbers;
  the WAHA send payload includes them (gateway mention support). If the gateway/engine
  ignores mentions, message still delivers with the literal `@Name` text — graceful
  degradation, no hard failure.

### Recipients rail + reach meter

- Card with search input filtering groups client-side; rows = checkbox + green avatar
  (initials) + name; selected rows tinted navy.
- Reach meter (navy gradient card): count of selected groups; if the gateway exposes
  participant counts, also total people reached. If counts are unavailable, show
  groups-only (no fake numbers).

### Unchanged / preserved behavior

- Capability gating (`messages.broadcast` route gate, `settings.edit` admin controls),
  gateway status pill + Re-scan/Unlink, blocked banner states, attachment modes
  (none/record/upload) with RecordAnnouncePicker, result panel after send, all
  existing i18n keys still used where copy is unchanged.
- Bilingual + RTL first-class: all new strings in `en.json`+`ar.json`, logical CSS
  only (`ms-/me-`, `inset-inline-`), `dir="auto"` on user content; the whole layout
  mirrors under `dir="rtl"`.
- Mobile: columns stack (recipients → composer → phone below); Extended view hides
  the stacked side phone.

## Out of scope

- Per-group preview tabs, delivery metrics, scheduled sends.
- Group member counts if WAHA doesn't already provide them (meter degrades gracefully).
