# DESIGN.md

Visual + interaction reference for the GSSG Manager web app. **Token-first.**
Read this when you need to know what something looks like, what tokens it
pulls from, or how a button should behave. The first pass covers the
**Dashboard** (route `/`) and the **chrome around it** (TopNav + LockOverlay).
Other pages will be appended under §4 as they're documented.

**Conventions used throughout this file:**

- Color and other design tokens are referenced by CSS custom-property name
  (`--primary`, `--surface-tinted`). The Tailwind class that consumes a token
  is shown alongside (e.g. `text-foreground` → `--text` → `#1c1f24`).
- Pixel and class values are quoted **verbatim from the code**. No rounding,
  no idealisation — if the code says `min-h-[280px]`, this doc says
  `min-h-[280px]`. The doc tracks what *is*, not what *should be*.
- **Light theme + LTR** is the baseline description. Dark theme and RTL
  deltas are called out per section only where they differ.
- All sources are in `frontend/src/`. Paths are relative to that root unless
  noted otherwise.
- Tokens live in `index.css` (`:root` for light, `[data-theme="dark"]` for
  dark, and a Tailwind v4 `@theme inline` block that wires CSS variables to
  utility classes).

---

## Table of contents

```
1. Foundations
   1.1  Color tokens
   1.2  Typography
   1.3  Spacing & layout
   1.4  Radius scale
   1.5  Motion tokens
   1.6  Focus & a11y
   1.7  RTL conventions
2. Button system
   2.1  Shadcn <Button> matrix
   2.2  Card-as-button
   2.3  Row-as-button
   2.4  Inline button-link
   2.5  Pill button
   2.6  Nav-link (TopNav)
   2.7  Icon-button
   2.8  Disabled state convention
3. Chrome
   3.1  TopNav
   3.2  AaSlider
   3.3  LanguageToggle
   3.4  ThemeToggle
   3.5  NavBell + NavBellPopover
   3.6  AccountMenu
   3.7  LockOverlay
   3.8  Toasts (AppToaster)
4. Dashboard page
   4.1  Page shell
   4.2  Hero
   4.3  Records, approvals and unread mail widgets
   4.4  Workforce and operational widget content
   4.5  WidgetFrame
   4.6  ServiceTile (shared service tile)
   4.8  Widget list rows
   4.9  In-place Customize and quick-action tile editor
   4.10 Monthly inmate report workspace
5. Animation appendix
6. Not yet documented
7. Ledger Books workspace
```

---

## 1. Foundations

### 1.1 Color tokens

All colors are defined as CSS custom properties in `index.css`. Light theme is
the default (set on `:root`); dark theme switches them via `[data-theme="dark"]`
on the `<html>` element (driven by `<ThemeToggle>` via `persistTheme`).

The `@theme inline` block at the top of `index.css` aliases each CSS variable
into a Tailwind v4 token, which is how `bg-primary`, `text-foreground` etc.
get their values. **Adding a new color token requires updating both the
variable and the alias.**

#### 1.1.1 Surface & background

| Tailwind class            | CSS var                | Light       | Dark        | Purpose                                                 |
| ------------------------- | ---------------------- | ----------- | ----------- | ------------------------------------------------------- |
| `bg-background`           | `--bg`                 | `#f5f4f1`   | `#0a0e18`   | Page background behind all surfaces (cream / near-black) |
| `bg-surface`              | `--surface`            | `#ffffff`   | `#131826`   | Card and panel background                                |
| `bg-surface-raised`       | `--surface-raised`     | `#fafaf6`   | `#1a2034`   | Slightly elevated row in lists, dialog body items        |
| `bg-surface-tinted`       | `--surface-tinted`     | `#f0eee8`   | `#1f263b`   | Hover wash for rows + interactive surfaces               |

#### 1.1.2 Primary (GSSG navy)

| Tailwind class                | CSS var               | Light       | Dark        | Purpose                                          |
| ----------------------------- | --------------------- | ----------- | ----------- | ------------------------------------------------ |
| `bg-primary`, `text-primary`  | `--primary`           | `#0d2845`   | `#5778cf`   | Brand color. Buttons, active nav, action arrows. |
| `bg-primary-hover`            | `--primary-hover`     | `#1d3a5e`   | `#7491db`   | One step lighter; hover state on primary buttons |
| `bg-primary-soft`             | `--primary-soft`      | `#e8edf3`   | `#1c2849`   | Tinted background for primary-tone chips & avatars |
| `text-primary-foreground`     | `--on-primary`        | `#ffffff`   | `#0a0e18`   | Foreground when on primary bg. **Dark theme flips to dark text** (because primary is now light blue). |

> **Dark-theme note:** primary becomes a mid-blue rather than navy, and
> `--on-primary` flips to near-black. Anywhere code writes white text over
> `bg-primary`, this still reads cleanly in dark mode because Tailwind's
> `text-primary-foreground` resolves to the token, not literal white.

#### 1.1.3 Accent (GSSG red)

Used **sparingly**: `MyDocumentsWidget` returned-state dot,
`SentApprovalsWidget` needs-changes chip, `WaitingApprovalsWidget`
high-priority label, and error/destructive text.

| Tailwind class           | CSS var            | Light       | Dark        |
| ------------------------ | ------------------ | ----------- | ----------- |
| `bg-accent`, `text-accent` | `--accent`       | `#c8102e`   | `#ef4858`   |
| `bg-accent-hover`        | `--accent-hover`   | `#a30d24`   | `#f56b78`   |
| `bg-accent-soft`         | `--accent-soft`    | `#fbe5e8`   | `#3a1820`   |

#### 1.1.4 Status tones (success / warning / info)

| Tailwind class    | CSS var            | Light       | Dark        | Where used                                  |
| ----------------- | ------------------ | ----------- | ----------- | ------------------------------------------- |
| `bg-success`      | `--success`        | `#047857`   | `#34d399`   | WorkforceWidget on-site dot, UnreadMailWidget sync-enabled dot |
| `bg-success-soft` | `--success-soft`   | `#d6f0e4`   | `#142d23`   | ViolationMonthsWidget closable label, Manager chip |
| `bg-warning`      | `--warning`        | `#b45309`   | `#fbbf24`   | WorkforceWidget on-leave dot, UnreadMailWidget sync-off dot |
| `bg-warning-soft` | `--warning-soft`   | `#fbedd8`   | `#3a2a10`   | ViolationMonthsWidget blocked label, link-account banner |
| `bg-caution`      | `--caution`        | `#ca8a04`   | `#facc15`   | Attendance's middle rung: arrived inside the grace |
| `bg-caution-soft` | `--caution-soft`   | `#fef3c7`   | `#3b2f11`   | The same day's wash in the month grid       |
| `bg-info`         | `--info`           | `#1d4ed8`   | `#60a5fa`   | WorkforceWidget loaned dot, MyDocumentsWidget pending dot |
| `bg-info-soft`    | `--info-soft`      | `#e0e8f8`   | `#1c2940`   | NavBellPopover approval and scan-inbox icons |

#### 1.1.5 Text

| Tailwind class           | CSS var          | Light     | Dark      | Use                                      |
| ------------------------ | ---------------- | --------- | --------- | ---------------------------------------- |
| `text-foreground`        | `--text`         | `#1c1f24` | `#e6e9f2` | Default text. Card titles, big numbers.  |
| `text-muted-foreground`  | `--text-muted`   | `#5a6068` | `#8a93a7` | Secondary text, captions, meta lines.    |
| `text-faint`             | `--text-faint`   | `#8b9098` | `#5f6678` | Tertiary — chevron icons in card corners |

#### 1.1.6 Borders & rules

| Tailwind class       | CSS var            | Light     | Dark      | Use                                          |
| -------------------- | ------------------ | --------- | --------- | -------------------------------------------- |
| `border-border`      | `--border`         | `#e6e4dd` | `#2a3148` | Default global border (`* { border-color }`) |
| `border-border-strong` | `--border-strong` | `#d4d1c8` | `#3a4360` | Slider track. Rarely used.                   |
| `border-hairline`    | `--hairline`       | `#efece5` | `#1f263b` | Internal card dividers (header→body, breakdown→action) |

#### 1.1.7 Composite tokens

| CSS var       | Light value                                                       | Dark value                                                        | Used by                                                |
| ------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------ |
| `--hero-grad` | `linear-gradient(135deg, #0a1f3a 0%, #0d2845 50%, #1d3a5e 100%)` | `linear-gradient(135deg, #050816 0%, #0d1428 50%, #1a2540 100%)`  | DashboardHero background, LockOverlay backdrop         |
| `--mountain`  | `rgba(13, 40, 69, 0.18)`                                          | `rgba(87, 120, 207, 0.22)`                                        | Defined in index.css; no current consumer in frontend/src |

> **Smart-link chips** (employee G-numbers and book refs auto-detected in
> ledger email bodies) are defined inline in `index.css` via `color-mix(in
> oklab, var(--primary) 10%, transparent)` (employee) and the same recipe
> with `var(--accent)` (book). Not Tailwind classes — selectors are
> `[data-smart-link='employee']` / `[data-smart-link='book']`.

#### 1.1.8 Token gaps to be aware of

- `bg-muted` and `text-muted` are referenced by `Avatar`, `Badge` (neutral
  tone), `EmptyState` icon container, `Skeleton` — but no `--color-muted`
  exists in `@theme inline`. These render fine in practice because Tailwind
  v4 falls back to a built-in muted shade, but they don't theme via the
  GSSG token system. **Don't introduce new `bg-muted` usages.** Use
  `bg-surface-tinted` instead.
- `Badge` non-neutral tones (`active`, `warning`, `danger`, `info`) hard-code
  Tailwind palette colors (`bg-emerald-50 text-emerald-700` etc.) **and do
  not switch in dark theme**. This is a known wart; flagged in §6.

---

### 1.2 Typography

Three families are bundled offline via `@fontsource`:

| CSS var          | Family                                                                     | Loaded by                                                          |
| ---------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `--font-sans`    | `"Inter Variable", "Inter", ui-sans-serif, system-ui, sans-serif`         | `@fontsource-variable/inter/index.css`                             |
| `--font-mono`    | `"IBM Plex Mono", ui-monospace, "SF Mono", Consolas, monospace`            | `@fontsource/ibm-plex-mono/{400,500}.css`                          |
| `--font-arabic`  | `"Noto Sans Arabic", "Inter Variable", system-ui, sans-serif`              | `@fontsource/noto-sans-arabic/{400,500,700}.css`                   |

**Family switching:**

- Sans is the default applied to `body`.
- Arabic kicks in automatically via `:lang(ar), [dir="rtl"] { font-family:
  var(--font-arabic) }`. **`<html lang="ar">` flips the whole tree.**
- Monospace is applied via the `font-mono` class (and the `[class*="tabular"]`
  selector). Used for: G-numbers, dates, ID labels, ref numbers, counts.
  Always pair with `font-variant-numeric: tabular-nums` (already on by
  default via the `[class*="tabular"]` selector and `tabular-nums` utility).
- Body has `font-feature-settings: "ss01", "cv11"` for Inter — slightly
  geometric `0`/`a` variants.
- `body` has `-webkit-font-smoothing: antialiased` and `text-rendering:
  optimizeLegibility`.

**Font scale (page-level zoom):**

Controlled by `[data-font-scale="N"]` on `<html>`, set by `AaSlider` via
`persistFontScale`. The attribute value is an integer; out-of-band integers
snap to the nearest declared stop.

| `data-font-scale` value | Resolved `html { font-size }` | Use                          |
| ----------------------- | ----------------------------- | ---------------------------- |
| `13`–`16`               | `16px`                        | Smallest                     |
| `17`–`19`               | `19px`                        | Default                      |
| `20`–`22`               | `22px`                        | Larger                       |
| `23`–`24`               | `24px`                        | Largest                      |

`AaSlider` snaps to exactly **16 / 19 / 22 / 24** (see `FONT_SCALE_STOPS` in
`lib/theme.ts`). Legacy persisted values from older builds map to the
nearest stop without a server round-trip.

**em-relative sizing convention:**

The Dashboard does **not** use `text-sm` / `text-base` / `text-lg` for
most labels. It uses Tailwind arbitrary `text-[0.86em]` etc. so the text
scales relative to the inherited size — which means a card label gets
larger as the font scale moves up. Standard em stops seen on the dashboard:

| Class            | Use                                                                |
| ---------------- | ------------------------------------------------------------------ |
| `text-[2em]`     | Record and people widget metrics (`BIG_NUMBER`, `PEOPLE_BIG`) |
| `text-[1.6em]`   | Hero headline                                                      |
| `text-[1.15em]`  | TopNav logo wordmark, LockOverlay welcome line                     |
| `text-[1.05em]`  | NavBell glyph, WidgetEditDialog title                              |
| `text-[1em]`     | LockOverlay account email                                          |
| `text-[0.95em]`  | TopNav nav links, AccountMenu name                                 |
| `text-[0.92em]`  | LockOverlay Unlock button                                          |
| `text-[0.9em]`   | LanguageToggle label, dropdown actions                             |
| `text-[0.86em]`  | WidgetEditDialog description                                       |
| `text-[0.85em]`  | Widget frame titles, people names, WidgetEditDialog Save button    |
| `text-[0.82em]`  | LockOverlay paragraph, dialog reset link                           |
| `text-[0.8em]`   | Quick-action tile labels                                           |
| `text-[0.78em]`  | Footnotes, breakdown rows, last-sync labels                        |
| `text-[0.75em]`  | Widget support copy, record rows, metadata, footers and View all    |
| `text-[0.72em]`  | Service-tile description, smaller meta, role chips                 |
| `text-[0.7em]`   | NavBell-popover row timestamp                                      |
| `text-[0.65em]`  | Admin/Manager role chips                                           |

Standard Tailwind sizes (`text-xs` = 0.75rem, `text-sm` = 0.875rem,
`text-base` = 1rem) are also used, but **rem-based**. Both approaches honor
the font-scale slider; the em-based ones additionally cascade inside cards.

**Tracking & weight conventions:**

- Big numbers: `font-bold` + `tracking-tight` + `tabular-nums`
- Headings (`h2`/`h3`/`h4`): `font-semibold tracking-tight` (rarely
  `font-bold`)
- Card labels (the `header` line above big numbers): `font-medium`,
  muted color
- Tabs / nav links / action arrows: `font-semibold` for active, `font-medium`
  for inactive
- Role chips & uppercase labels: `font-semibold uppercase
  tracking-[0.06em]` (badges) or `tracking-[0.08em]` (Admin/Manager chip) or
  `tracking-[0.18em]` (LockOverlay "APP LOCKED" strap)
- `leading-none` is used on big numbers and pills so the line-box matches
  the glyph height

---

### 1.3 Spacing & layout

The Dashboard supports compact and wide canvases. Compact is centered at
`max-w-[1180px]`; wide uses the available width.

**Page shell** (`<DashboardPage>` root):

```
flex flex-1 flex-col overflow-hidden bg-background
  └ min-h-0 flex-1
      └ PullToRefresh
          └ w-full px-4 pb-12 pt-6 md:px-7
             + compact: mx-auto max-w-[1180px]
```

- Horizontal padding: `px-4`, switching to `md:px-7`.
- Top padding: `pt-6`; bottom padding: `pb-12`.
- The packed widget board replaces separate top, bottom and section grids.

> All `rem`-based values scale with the `[data-font-scale]` stops in §1.2.
> At root font-size = 16px, `1rem = 16px`; at root 19px, `1rem = 19px`;
> etc. Don't translate rem to fixed px — the whole point of the rem-first
> approach is that the AaSlider resizes paddings and gaps too.

**Card padding:** `WidgetFrame` uses `p-4`, switching to `px-3 py-2`
while editing; the shared `ServiceTile` uses `p-5`. The Hero uses
`px-4 py-4 md:px-8 md:py-6`.

**Widget board:** `grid w-full min-w-0 flex-1 gap-3.5` with inline
``gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` `` and
`gridAutoRows: '9.25rem'`. Each packed article receives explicit
`gridColumn` and `gridRow`; see §4.1 for sizes and tiers.

**Quick actions:** `QuickActionsWidget` owns an internal
`grid min-h-0 flex-1 auto-rows-fr gap-x-2 gap-y-1`. Glance stacks two
horizontal artwork-and-label links in one column; other tiers center artwork
above labels. The column budget is 2 on a two-column board, otherwise
`Math.min(box.w * 2, 8)`, capped to the number of visible actions. Other tiers
show at most `columns * Math.max(box.h, 1)` actions, not a separate page-level
four-column grid.

**Vertical rhythm:** Hero `mb-4 md:mb-6`; the “My Widgets” heading container
uses `mb-3.5`. The board and Add widgets panel sit in
`flex flex-col items-start gap-4 lg:flex-row`.

**Chrome (TopNav):** `px-8 pb-3.5 pt-[max(0.875rem, safe-top + 0.75rem)]` with `gap-7` between the logo block and
the nav, and `ms-5` extra start margin on the nav itself. Right cluster
uses `ms-auto` + `gap-3.5`.

---

### 1.4 Radius scale

The system declares four radii in `@theme inline`:

| Class           | CSS var          | Value  | Use                                                  |
| --------------- | ---------------- | ------ | ---------------------------------------------------- |
| `rounded-sm`    | `--radius-sm`    | `8px`  | Small interactive surfaces (NavLink, dialog row containers) |
| `rounded-md`    | `--radius-md`    | `12px` | Medium surfaces (shadcn Button, AaSlider buttons, icon-button tiles) |
| `rounded-lg`    | `--radius-lg`    | `16px` | Larger pills (TopNav nav-link, password input)       |
| `rounded-full`  | `--radius-pill`  | `99px` | Pills (approval chips, dialog actions, AccountMenu trigger) |

The Dashboard uses Tailwind's default `rounded-2xl` (1rem) for Hero,
packed widget articles and `WidgetFrame`. Shared surfaces with the same
radius include `ServiceTile`, dropdown panels, LockOverlay form and
WidgetEditDialog body. This is a project convention rather than a named token.

Other radii used inline:
- `rounded-md` for record-widget links; `rounded-lg` for people-widget links
- `rounded-[30px]` for the ThemeToggle track (hard-coded inside the component)
- `rounded` (4px) for the active-nav underline pseudo-element

---

### 1.5 Motion tokens

Shared entrance motion is tokenized in `index.css`:
`--motion-entrance: 220ms` and
`--ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1)`.
Other durations remain local to their components.

| Duration  | Used by                                                      |
| --------- | ------------------------------------------------------------ |
| `120ms`   | Smart-link chip background fade                              |
| `150ms`   | AaSlider thumb scale hover                                   |
| `200ms`   | ServiceTile hover lift, NavLink hover, logo scale-up         |
| `300ms`   | ServiceTile emoji bob, ThemeToggle slider background swap    |
| `400ms`   | ThemeToggle thumb translate (`transition: transform 0.4s`)   |
| `220ms`   | Shared entrance fade-up (`gssg-fade-up`)                      |
| `5s`      | ThemeToggle moon tilt                                        |
| `15s`     | ThemeToggle sun rotation                                     |
| `90s`     | Dashboard hero crest rotation                                |

| Easing                                  | Used by                                                       |
| --------------------------------------- | ------------------------------------------------------------- |
| `cubic-bezier(0.16, 1, 0.3, 1)` (out-expo) | `gssg-fade-up` entrance animation                          |
| `linear`                                | Hero crest rotation, ThemeToggle sun rotate, ThemeToggle moon tilt |
| `transition-colors` default (Tailwind, 150ms ease) | Most hover-tone changes                            |
| `transition-all duration-200`           | Card hover lift + shadow                                      |

**Reduced-motion handling:**

The shared entrance animation and Hero crest rotation have
`@media (prefers-reduced-motion: reduce)` guards. The entrance rule lives
in `index.css`:

```css
.anim-fade-up {
  animation: gssg-fade-up var(--motion-entrance) var(--ease-out-expo) both;
}
```

The shared reduced-motion block includes `.anim-fade-up` and sets
`animation: none`.

`ServiceTile` suppresses its card lift and artwork/emoji translation with
`motion-reduce:!translate-none motion-reduce:transition-none`.
WidgetFrame has no hover lift.

**Entrance timing:** Hero uses `anim-fade-up` with
`style={{ background: 'var(--hero-grad)', animationDelay: '0ms' }}`.
The packed widget articles have no entrance class or stagger delay.

---

### 1.6 Focus & a11y

**Global focus ring** (set in `index.css`):

```css
:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}
```

This applies to **everything** unless a component overrides it. The
override pattern uses Tailwind:

```
focus-visible:outline-none
focus-visible:ring-2
focus-visible:ring-ring          /* ring-ring → --primary */
focus-visible:ring-offset-2      /* offset bg = bg-background by default */
focus-visible:ring-offset-background
```

Variants per surface:

| Surface                          | Offset                                          |
| -------------------------------- | ----------------------------------------------- |
| Shared ServiceTile               | `ring-offset-2`                               |
| Widget list links                | `ring-inset` (inside clipped WidgetFrame content) |
| AaSlider buttons (inside tinted pill)   | `ring-offset-1 ring-offset-surface-tinted` |
| TopNav nav-links                 | `ring-offset-2` (offset = `bg-surface` chrome)  |

**ARIA patterns:**

- All decorative icons get `aria-hidden` (WidgetFrame chevron, Hero crest, etc.)
- All icon-only buttons get `aria-label` (TopNav LanguageToggle, ThemeToggle,
  AaSlider buttons, NavBell, Edit pencils on Dashboard, attachment-paperclip)
- Status pills (delta tags) are plain text — no role, no aria
- `role="dialog"` + `aria-modal` on dropdown panels (AccountMenu, NavBellPopover)
  and the LockOverlay form
- `role="switch"` + `aria-checked` on the WidgetEditDialog visibility switches
- `aria-pressed` on the ledger Star button (not on the Dashboard — used on
  the Ledger row, mentioned for context)

**Keyboard:**

- All interactive surfaces are real `<button>` or `<a>`/`<NavLink>` elements —
  no `<div onClick>`. Tab order is DOM order.
- Dropdowns close on `Escape` and outside click (AccountMenu, NavBellPopover —
  both hand-roll this with `window.addEventListener('keydown'/'mousedown')`).
- WidgetEditDialog uses Radix `<Dialog>` which provides focus trapping,
  Escape-to-close, and overlay click-to-close by default.

---

### 1.7 RTL conventions

**Trigger:** `<LanguageToggle>` calls `i18n.changeLanguage('ar' | 'en')`;
the `applyDir()` listener in `lib/i18n.ts` writes `<html lang="ar" dir="rtl">`
or `<html lang="en" dir="ltr">`. From that point Tailwind's logical-property
utilities and the `rtl:` variant do the work.

**Logical-property utilities (always preferred over directional ones):**

| LTR-only utility | Logical replacement | Notes                                          |
| ---------------- | ------------------- | ---------------------------------------------- |
| `ml-*`           | `ms-*`              | margin-inline-start                            |
| `mr-*`           | `me-*`              | margin-inline-end                              |
| `pl-*`           | `ps-*`              | padding-inline-start                           |
| `pr-*`           | `pe-*`              | padding-inline-end                             |
| `left-*`         | `start-*`           | offset-inline-start                            |
| `right-*`        | `end-*`             | offset-inline-end                              |
| `text-left`      | `text-start`        | text-align: start                              |
| `text-right`     | `text-end`          | text-align: end                                |

**`rtl:` variant** is used **only** when a *physical* transform needs to
mirror — the cases on the Dashboard are:

| Element                                         | LTR                              | RTL override                          |
| ----------------------------------------------- | -------------------------------- | ------------------------------------- |
| WidgetEditDialog visibility-switch thumb        | `translate-x-4` when checked     | `rtl:-translate-x-4`                  |
| WidgetFrame View all chevron                     | `<ChevronRight>` glyph           | `rtl:rotate-180`                      |
| NavBellPopover footer "View all" arrow          | `<ArrowRight>` glyph             | `rtl:rotate-180`                      |

**No mirror needed:**

- Hero crest rotation — pure rotation, looks the same.
- Card hover lift (`-translate-y-1`) — vertical, direction-agnostic.
- Widget list links do not use a card-corner chevron or action-arrow nudge.

**Arabic numerals:** All numbers (G-IDs, leave-day counts, dates, big
numbers, badge counts) render as Western Arabic numerals (0-9) regardless
of `lang="ar"`. This is enforced by `font-variant-numeric: tabular-nums`
and the lack of any `lang="ar-u-nu-arab"` override.

**Date formatting:** DashboardHero uses `date-fns` with
`format(new Date(), 'EEE, dd MMM', { locale: isAr ? arLocale : undefined })`
for its Gregorian label.

---

## 2. Button system

This is the section to read when you need to know what a button looks like,
what it does on hover, what it does on focus, and how it differs in dark
mode. Every clickable surface on the Dashboard falls into one of the
eight patterns below.

### 2.1 Shadcn `<Button>` matrix

The base `<Button>` component lives at `components/ui/button.tsx`; variants
in `components/ui/button-variants.ts`. **On the Dashboard, only `EmptyState`
uses the shadcn `<Button>` directly** (as `variant="secondary" size="sm"`
for its action). Every other button-shaped thing on the Dashboard is a raw
`<button>` styled inline. The matrix is documented anyway because the rest
of the site uses it heavily.

**Base classes (every variant gets these):**

```
inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md
text-sm font-medium leading-none transition-colors
disabled:pointer-events-none disabled:opacity-50
focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
focus-visible:ring-offset-1 focus-visible:ring-offset-background
```

#### Variants

| Variant       | Default                                                      | Hover                          | Active                          | Disabled              |
| ------------- | ------------------------------------------------------------ | ------------------------------ | ------------------------------- | --------------------- |
| `default`     | `bg-primary text-primary-foreground`                         | `bg-primary/90`                | `bg-primary/95`                 | `pointer-events-none opacity-50` |
| `secondary`   | `border border-border bg-surface text-foreground`            | `bg-surface-tinted`            | (no specific active)            | same                  |
| `outline`     | `border border-border bg-transparent text-foreground`        | `bg-surface-tinted`            | (no specific active)            | same                  |
| `ghost`       | `text-muted-foreground`                                      | `bg-surface-tinted hover:text-foreground` | (no specific active) | same                  |
| `destructive` | `bg-destructive text-destructive-foreground` (*see note*)    | `bg-destructive/90`            | (no specific active)            | same                  |
| `link`        | `text-primary underline-offset-4`                            | `underline`                    | (no underline change)           | same                  |

> Neutral variants (`secondary`, `outline`, `ghost`) hover to
> `bg-surface-tinted`. They hovered to GSSG red (`bg-accent`) until the Books
> workspace pass fixed it.
>
> **`destructive` variant** references `bg-destructive` and
> `text-destructive-foreground`, which are **not defined** in the project's
> `@theme inline`. These classes resolve to nothing. Destructive actions on
> the site use raw `text-accent` instead. (Flagged in §6.)

#### Sizes

| Size      | Height | Padding         | Text size  | Use                              |
| --------- | ------ | --------------- | ---------- | -------------------------------- |
| `default` | `h-9`  | `px-3.5`        | `text-sm`  | Standard buttons                 |
| `sm`      | `h-8`  | `px-3`          | `text-xs`  | EmptyState action, secondary CTAs |
| `xs`      | `h-7`  | `px-2.5`        | `text-xs`  | Toolbar buttons                  |
| `lg`      | `h-10` | `px-5`          | `text-sm`  | Hero CTAs                        |
| `icon`    | `h-9 w-9` | `p-0`        | inherited  | Single-icon buttons              |
| `icon-sm` | `h-8 w-8` | `p-0`        | inherited  | Smaller single-icon buttons      |

#### Focus state (all variants)

`ring-2` × `ring-primary` × `ring-offset-1` × offset bg = `--bg`. Light:
crisp navy ring on cream; Dark: light-blue ring on near-black.

---

### 2.2 Card-as-button

The shared `ServiceTile` is a `<button type="button">` whose whole surface
is the click target. Dashboard widgets instead use structural `WidgetFrame`
sections containing explicit links and buttons (§4.5).

**Surfaces using this pattern:** `ServiceTile` (shared component; the packed
dashboard's `QuickActionsWidget` instead renders artwork-and-label link tiles
inside `WidgetFrame`, without the shared button's primary cap or hover lift).

**Look (baseline):**

```
service-tile cursor-pointer group relative flex h-full min-h-[190px] w-full flex-col overflow-hidden rounded-2xl bg-surface p-5 text-start
border-t-[4px] border-t-primary
```

- `group` enables artwork/emoji hover and focus translation.
- `text-start` aligns content to the reading-start edge in LTR and RTL.
- `bg-surface` plus a primary top border defines the shared tile surface.

**Hover (baseline):**

```
transition-all duration-200
hover:-translate-y-1
hover:shadow-lg
```

- Lifts 4px (`-translate-y-1` = `-0.25rem`).
- Adds Tailwind's `shadow-lg` shadow (a soft mid-strength box-shadow).
- Group-hover side effects defined per card — see §4 entries.

**Focus:**

```
focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
focus-visible:ring-offset-2
```

Ring offset is 2px because the card sits on `bg-background` (cream / near-
black). Visible navy/light-blue ring with a clear gap from the card edge.

**Active:** no explicit treatment — the card sits at its hovered position
during the click. The whole interaction relies on the touch/click landing
on the visible target.

**Disabled:** ServiceTile has no disabled prop.

**Reduced motion:** `motion-reduce:!translate-none
motion-reduce:transition-none` suppresses the tile translation and transition.

---

### 2.3 Row-as-button

NavBellPopover entries use real buttons, while dashboard widget lists use
semantic links to their destinations (§4.8).

**NavBellPopover mail-entry look:**

```
flex w-full items-start gap-3 px-4 py-3 text-start
transition-colors hover:bg-surface-tinted focus-visible:bg-surface-tinted
focus-visible:outline-none focus-visible:ring-2
focus-visible:ring-inset focus-visible:ring-ring
```

The inset focus ring stays inside the dropdown edge. Widget row links also
use inset rings so the clipped frame cannot hide their focus indication.
Record links use `rounded-md py-1` plus `WIDGET_SUPPORT`
(`text-[0.75em] leading-tight`); people links use `rounded-lg py-2 text-start`.
Both use `gap-2` and `hover:bg-surface-tinted`, without a hover lift or shadow.

---

### 2.4 Inline button-link

Small text-only buttons that look like a link (text + optional icon, no
background, primary color).

**Surfaces using this pattern:**

- “Customize” on the Dashboard (with `Pencil` icon).
- "Mark all read" inside NavBellPopover.
- "Reset to defaults" inside WidgetEditDialog.
- AccountMenu "View all in inbox" (with `ArrowRight`).
- LockOverlay nothing (uses the Unlock pill — see §2.5).

**Look:**

```
inline-flex items-center gap-1.5
text-[0.85em] font-medium text-primary
transition-colors
```

- Always primary-colored text (`text-primary`).
- Icon stroked 1.8 (consistent with other Lucide icons).
- Icon size `h-3.5 w-3.5` (matches the surrounding small text).

**Hover:**

```
hover:underline
```

- Underline appears. **No color change** — primary color is already
  conspicuous.

**Focus:**

```
focus-visible:outline-none
focus-visible:rounded-sm
focus-visible:ring-2 focus-visible:ring-ring
focus-visible:ring-offset-2
```

- Adds an 8px-radius focus ring around the text. Because the button has no
  background, the offset is 2px from the *text bounding box*, not from a
  card edge.

**Active / Disabled:** no special treatment; relies on Tailwind defaults.
`disabled:opacity-60` appears on the "Mark all read" mutation button to
indicate the network call is in flight.

---

### 2.5 Pill button

Functional pills are used by LockOverlay Unlock and WidgetEditDialog
Save/Cancel.

#### Functional pill (LockOverlay Unlock, WidgetEditDialog Save/Cancel)

These are real `<button type="submit">` or `type="button"` elements.

**Primary pill (Save / Unlock):**

```
inline-flex items-center justify-center gap-2 rounded-full
bg-primary px-5 py-2 text-[0.85em] font-semibold text-primary-foreground
transition-colors
hover:bg-primary-hover
focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary
focus-visible:ring-offset-2
disabled:cursor-not-allowed disabled:opacity-50
```

- LockOverlay uses `px-5 py-2.5 text-[0.92em] font-semibold` and a full-
  width pill (extra emphasis on the lock screen). Otherwise identical.

**Outline pill (Cancel):**

```
inline-flex items-center gap-1.5 rounded-full
border border-hairline bg-surface px-4 py-2
text-[0.82em] font-medium text-muted-foreground
transition-colors
hover:bg-surface-tinted hover:text-foreground
focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary
focus-visible:ring-offset-2
disabled:cursor-not-allowed disabled:opacity-50
```

- Hover *darkens* the text from muted to foreground, *and* tints the
  background. Both at once is intentional — Cancel needs to feel like it
  "wakes up" on hover so users can distinguish it from passive surface text.

---

### 2.6 Nav-link (TopNav)

The five primary nav items in the TopNav use `<NavLink>` from react-router.

**Look (inactive):**

```
relative rounded-lg px-3.5 py-2 font-medium text-foreground
transition-all duration-200
```

**Hover (inactive):**

```
hover:-translate-y-0.5
hover:bg-surface-tinted
hover:text-primary
motion-reduce:!transform-none
```

- 2px upward micro-lift (`-translate-y-0.5` = `-0.125rem`).
- Background tints.
- Text recolors to primary.

**Active:**

```
font-semibold text-primary
after:absolute after:-bottom-[14px] after:left-0 after:right-0
after:h-[3px] after:rounded after:bg-primary
```

- Bold weight + primary color.
- 3px underline pseudo-bar **14px below** the link's baseline (sits inside
  the TopNav border-bottom gap, aligning with the chrome's bottom edge).
- No lift, no background tint — active is its own visual story.

**Focus:**

```
focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
focus-visible:ring-offset-2
```

- Offset 2px against `bg-surface` (TopNav's own background).

**Logo block:**

```
flex items-center gap-7 rounded-md
transition-transform duration-200
hover:scale-[1.02]
focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2
```

- 1.02× scale on hover (subtle — the logo doesn't grow conspicuously).

---

### 2.7 Icon-button

Small square buttons with one icon and no text. Three sub-patterns:

#### 2.7a NavBell glyph-button

```
relative rounded-lg p-2
transition-colors
hover:bg-surface-tinted
```

- 8px padding around the bell emoji (`text-[1.05em]` aria-hidden).
- Badge (accent pill) overlays at `-end-0.5 -top-0.5` when count > 0.
- See §3.5 for badge details.

#### 2.7b AaSlider A / a buttons

```
rounded-md px-1 py-0.5
text-[0.78em] font-semibold leading-none text-muted-foreground (small "A")
text-[1.15em] font-bold leading-none text-foreground (big "A")
transition-colors
hover:bg-surface hover:text-foreground (when not at limit)
focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1
focus-visible:ring-offset-surface-tinted
```

- The small "A" sits on `--surface-tinted` (the slider pill), and its hover
  brightens to `--surface`.
- The big "A" already uses `--foreground`, so hover only adds the surface
  tint behind it.
- At-limit state (atMin / atMax): `cursor-not-allowed opacity-40`.

#### 2.7c Edit-dialog reorder arrows

```
rounded-md p-1.5
text-muted-foreground transition-colors
hover:bg-surface-tinted hover:text-foreground
focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary
disabled:cursor-not-allowed disabled:opacity-40
```

- Lucide `ChevronUp` / `ChevronDown` at `h-4 w-4`, stroke 1.8.

#### 2.7d AccountMenu avatar-trigger

```
flex items-center gap-2 rounded-full p-0.5
transition-colors
hover:bg-surface-tinted
focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary
```

- The whole avatar is the trigger (no chevron). `aria-haspopup="dialog"`
  + `aria-expanded` toggles per state.

---

### 2.8 Disabled state convention

Three idioms in use:

| Idiom                                              | Where                                    |
| -------------------------------------------------- | ---------------------------------------- |
| `disabled:pointer-events-none disabled:opacity-50` | shadcn `<Button>` base, LockOverlay Unlock pill, WidgetEditDialog pills |
| `disabled:cursor-not-allowed disabled:opacity-40`  | AaSlider A buttons (at limit), WidgetEditDialog reorder arrows |
| `disabled:cursor-not-allowed disabled:opacity-50`  | LockOverlay password input + Unlock when no account configured |
| `disabled:opacity-60`                              | NavBellPopover "Mark all read" mid-mutation |

**Pattern guidance:**

- Use `opacity-50` for definitively-not-usable.
- Use `opacity-40` for "soft" disabled where the button is technically
  clickable in some configurations.
- Use `opacity-60` for "loading — be back in a sec".
- Always pair with `cursor-not-allowed` (or `pointer-events-none` when no
  cursor change is needed).

---

## 3. Chrome

The TopNav and LockOverlay always sit above the Dashboard. Documented here
once so the Dashboard sections (§4) don't repeat the chrome description.

### 3.1 TopNav

**Source:** `components/shell/TopNav.tsx`.

**Anatomy:**

```
┌───────────────────────────────────────────────────────────────────────────┐
│ <header bg-surface border-b border-border px-8 pb-3.5 pt-(see Container)    │
│         flex items-center gap-7>                                            │
│                                                                             │
│   [Logo block]   [Nav]                       [Right cluster]                │
│   • gssg crest   • Dashboard                 • AaSlider                     │
│   • GSSG word-   • Employees   ms-5          • LanguageToggle               │
│     mark +       • Ledger                    • ThemeToggle                  │
│     tagline      • Application                 • NavBellPopover             │
│                  • Books                     • AccountMenu (avatar)         │
│                  ms-auto on right cluster                                   │
└───────────────────────────────────────────────────────────────────────────┘
```

**Container:**

```
flex items-center gap-7
border-b border-border bg-surface
px-8 pb-3.5 pt-[max(0.875rem, safe-top + 0.75rem)]
```

- Total height scales with `[data-font-scale]` — the 0.875rem bottom padding, the top padding and the tallest
  control (the avatar trigger) determine it. Approximately 64px at root 16px; ~76px at root 19px.
- The top padding is `max(0.875rem, --safe-top + 0.75rem)`: with no inset (a desktop, a landscape phone) it is
  the unchanged 0.875rem; under a status bar / notch inset (a standalone iPad, any >= 768px touch window with a
  top inset) the controls start >= 12px below it, like the phone bar. `[data-topnav]` side padding already
  follows the side insets.
- `gap-7` (1.75rem) between the logo block and the nav.

**Logo block:**

- `gssg-logo.png` rounded circle, `h-10 w-10`, `object-cover`, `ring-1
  ring-border`.
- Wordmark: `text-[1.15em] font-bold tracking-tight text-primary` —
  bold "GSSG" + a `mt-0.5 block text-[0.72em] font-normal tracking-wider
  text-muted-foreground` tagline beneath it.
- Hover: `hover:scale-[1.02]` on the whole link.

**Nav:**

- 5 items: Dashboard, Employees, Ledger, Application (services), Books.
- Order is fixed in `NAV_ITEMS` at TopNav:32-38.
- `ms-5` extra inline-start margin (separates from logo block).
- `gap-1` between items.
- `text-[0.95em]`.
- Inactive / active states: see §2.6.

**Right cluster:**

- `ms-auto flex items-center gap-3.5` — pinned to the inline-end.
- Order is fixed: AaSlider, LanguageToggle, ThemeToggle, NavBellPopover,
  AccountMenu.

**Dark theme:** TopNav inherits `bg-surface` and `border-border` which both
flip via the dark token set — chrome darkens to `#131826` with a `#2a3148`
underline. The logo + crest images don't theme (they're PNGs).

**RTL:**

- `ms-/me-` utilities flip correctly.
- The nav itself doesn't reverse — DOM order is preserved; only the
  cluster mirrors via `ms-auto`.
- Active underline (`after:left-0 after:right-0`) spans both edges, so
  it's symmetric in both directions.

---

### 3.2 AaSlider

**Source:** `components/shell/AaSlider.tsx`. Snaps to one of `[16, 19, 22, 24]`.

**Anatomy:**

```
┌─────────────────────────────────────┐
│ [ A ]  ▬▬●▬▬▬▬▬▬▬▬▬▬  [ A ]         │
│  small   track + thumb   large       │
└─────────────────────────────────────┘
   rounded-full bg-surface-tinted px-3 py-1.5 gap-2
```

**Pill (outer container):**

```
inline-flex items-center gap-2
rounded-full bg-surface-tinted
px-3 py-1.5
```

**Small "A" button:** `text-[0.78em] font-semibold text-muted-foreground`.
Click decrements one stop. Disabled at min.

**Big "A" button:** `text-[1.15em] font-bold text-foreground`. Click
increments one stop. Disabled at max.

**Range input:** Native `<input type="range">`, `h-1 w-[100px]`,
`appearance-none rounded-full bg-border`. The thumb is custom-styled via
the `.aa-slider::-webkit-slider-thumb` + `::-moz-range-thumb` rules in
`index.css`:

```css
.aa-slider::-webkit-slider-thumb {
  width: 16px; height: 16px; border-radius: 50%;
  background: var(--primary);
  border: 2px solid var(--surface);
  box-shadow: 0 1px 4px rgba(0,0,0,0.2);
  cursor: pointer;
  transition: transform 0.15s;
}
.aa-slider::-webkit-slider-thumb:hover { transform: scale(1.2); }
```

- Thumb is a navy disc, ringed by `--surface` so it pops against the
  tinted pill.
- Hover scales 1.2× over 150ms.
- Firefox version uses `::-moz-range-thumb` with no transition (Firefox
  parity intentionally simpler).

**a11y:**

- Range carries `aria-label="Text size"`, `aria-valuemin`,
  `aria-valuemax`, `aria-valuenow` (the current snapped px value).
- Buttons carry `aria-label="Decrease text size"` / `"Increase text size"`.

**Dark theme:** Pill stays on `--surface-tinted` (dark navy). Thumb
becomes the dark-mode `--primary` (light blue) ringed by the dark
`--surface`.

---

### 3.3 LanguageToggle

**Source:** `components/shell/LanguageToggle.tsx`.

**Anatomy:** Single button showing 🌐 + the *other* language's name.

```
inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[0.9em]
transition-colors
hover:bg-surface-tinted
```

- When current language is EN: shows `🌐 العربية` (with `text-[0.9em]`
  rendering in Noto Sans Arabic because of `[dir="rtl"]` … wait — the
  *button label* renders in Arabic font even in LTR because the `:lang(ar)`
  selector matches on the *element*'s language attribute. The toggle
  button itself doesn't carry `lang="ar"`, so this *doesn't* auto-swap.
  In practice the Arabic glyphs in "العربية" use whatever font supports
  them in the user agent's fallback — Inter doesn't have Arabic so it
  cascades to a system Arabic font.) **Behavior:** the label is always
  legible in both modes regardless.
- When current language is AR: shows `🌐 English` (LTR-flowed even inside
  an RTL document because the Latin glyphs force LTR layout on the span).

**`aria-label`:** "Switch to English" / "Switch to Arabic" — always
describes the destination, matching the label text's meaning.

**Click handler:**

```
i18n.changeLanguage(isAr ? 'en' : 'ar')
```

`lib/i18n.ts` listens for `languageChanged` and writes `<html lang>` +
`<html dir>`. Tailwind RTL utilities react immediately.

---

### 3.4 ThemeToggle

**Source:** `components/shell/ThemeToggle.tsx`.

**Anatomy:** Sliding switch with a sun on the right and a moon on the left.
The thumb (white circle) hides the active mode and reveals the other.

```
<label class="theme-switch relative inline-block h-[30px] w-[56px] cursor-pointer">
  <input type="checkbox" role="switch" .../>            (visually hidden)
  <span class="theme-switch-slider absolute inset-0 rounded-[30px]"/>  (track)
  <span class="theme-switch-sun absolute left-[32px] top-[6px] h-[18px] w-[18px]">   (sun SVG)
  <span class="theme-switch-moon absolute left-[6px] top-[4px] h-[18px] w-[18px]">    (moon SVG)
</label>
```

**Track:**

- Light theme (checked = false): `background-color: #73C0FC` (a sky blue —
  **hard-coded color, does not theme**).
- Dark theme (checked = true): `background-color: #183153` (a deep navy —
  also hard-coded).
- Transition: `transition-colors duration-300`.

**Thumb (`::before` pseudo-element):**

- `26 × 26 px`, `border-radius: 16px`, `background-color: #e8e8e8` (off-
  white, hard-coded).
- Positioned `left: 2px; bottom: 2px` when off (sun visible on right).
- `transform: translateX(26px)` when on (moon visible on left).
- Transition: `transition: transform 0.4s`.

**Icons:**

- **Sun**: stroke yellow `#ffd43b`, rotates 360° over 15s (`linear infinite`).
- **Moon**: filled `#73C0FC`, tilts -10°→+10°→0 over 5s (`linear infinite`).
- Both `pointer-events-none` so the click always lands on the underlying
  checkbox.

**Focus:**

- Visible-focus shows `box-shadow: 0 0 0 2px #183153` around the track.

**Reduced motion:**

- Sun rotation and moon tilt both `animation: none`.
- Thumb `transition: none` — the slide-over still happens, just instantly.

**Theme-toggle is the one component in the chrome that does NOT use the
GSSG color tokens.** The colors are intentionally toy-like (sky-blue +
white pill, navy + white) to read as a recognizable "OS settings toggle"
metaphor. Don't tokenize them.

---

### 3.5 NavBell + NavBellPopover

**Source:** `components/shell/NavBell.tsx`, `NavBellPopover.tsx`.

#### NavBell (trigger only)

```
relative rounded-lg p-2
transition-colors
hover:bg-surface-tinted
pointer-coarse: inline-flex min-h-[44px] min-w-[44px] items-center justify-center
```

- On a coarse pointer (touch) the button is a real 44 x 44 CSS px target (px, not rem, so it stays 44px
  at any text size); a mouse keeps the compact box. In the phone bar (`MobileTopBar`) the trigger also
  drops its padding and line-height so the box is exactly 44px at every text size.
- 🔔 emoji at `text-[1.05em]`, `aria-hidden`.
- Badge (when `count > 0`):

```
absolute -end-0.5 -top-0.5
flex h-[18px] min-w-[18px] items-center justify-center
rounded-full bg-accent
px-1 text-[10px] font-bold leading-none text-white
ring-2 ring-surface
```

- `min-w-[18px]` keeps the badge a circle when the count is a single digit
  and an oval when it's two digits.
- Label is `"99+"` when count > 99.
- White text on `--accent` (red) in both themes — the badge is the one
  place red is allowed to glow brightly.
- `ring-2 ring-surface` provides the "punched-out of the chrome" look.

**Accessibility:** `aria-label` is localised (`appBar.notifications` / `appBar.notificationsUnread`:
`"Notifications, N unread"` in English, `"الإشعارات، N غير مقروءة"` in Arabic); `aria-haspopup="dialog"`,
`aria-expanded` reflects the panel.

#### NavBellPopover (panel)

```
absolute end-0 top-full z-50 mt-2 w-[380px]
rounded-2xl
border border-hairline bg-surface
shadow-xl
```

- 380px wide, anchored to the inline-end of the bell on the TopNav. On the phone bar it uses the shared header
  placement (see §3.6 Panel), and the PANEL is the only scroller on a phone/touch screen.
- `shadow-xl` — heaviest shadow on the page; the panel needs to read
  clearly over arbitrary content beneath it.

**Header:**

```
flex items-center justify-between
border-b border-hairline px-4 py-3
  ├ <h3 text-sm font-semibold text-foreground>Notifications</h3>
  └ "Mark all read" button (§2.4 pattern) — hidden when count = 0; 44 x 44 minimum on touch
```

**Body (3 states):**

| State              | Render                                                        |
| ------------------ | ------------------------------------------------------------- |
| Loading            | 3 fake rows: animated `bg-border` rounds + bars, gap-2, py-6  |
| Empty              | `<EmptyState icon={Inbox}>` with i18n message, `py-10`        |
| Has items          | `<ul>` of row-as-button entries (§2.3). Desktop mouse: `md:max-h-[360px] md:overflow-auto`. Phone and any touch screen: no list scroller — the capped panel scrolls, so the footer link is one drag away |

**Row layout:**

- `h-8 w-8` avatar with initials, `bg-primary-soft text-primary`
- Subject line (truncated, `text-[0.9em] font-semibold`, `dir="auto"`)
  + optional Paperclip icon for attachments
- Date stamp on the end: `font-mono text-[0.7em] text-muted-foreground`,
  format = `HH:mm` if today else `dd MMM`
- Counterparty name below subject (truncated, `text-xs`, `dir="auto"`)
- Preview snippet below that (truncated, `text-xs text-muted-foreground/80`,
  `dir="auto"`)

**Footer:**

- Optional `"+ N more unread"` line when `total_unread > items.length`.
- `<Link to="/ledger?tab=email">` styled like the inline-button-link pattern, with
  an `ArrowRight` icon (`min-h-[44px]` on touch). The arrow rotates 180° in RTL.

**Open/close:**

- Toggle on bell click.
- Closes on Escape key or outside click (`mousedown` listener).
- Closes when any row is clicked (after navigation fires).

---

### 3.6 AccountMenu

**Source:** `components/shell/AccountMenu.tsx`.

#### Trigger

Avatar-only button (see §2.7d). Renders the linked employee's photo when
available; falls back to initials from `identity.name_en[0]` or the
configured email's local-part initials.

```
<button class="flex items-center justify-center gap-2 rounded-full p-0.5
               transition-colors hover:bg-surface-tinted
               pointer-coarse:min-h-[44px] pointer-coarse:min-w-[44px]">
  <Avatar h-9 w-9 (phone bar: 36px) bg-primary-soft text-primary ring-1 ring-border>
    [AvatarImage from identity.photo_url] OR
    [AvatarFallback (initials)]
  </Avatar>
</button>
```

#### Panel

```
absolute z-50 mt-2 top-full
rounded-2xl border border-hairline bg-surface shadow-xl
focus-visible:outline-none
TopNav:     end-0 w-80   max-h-[calc(100dvh - safe-bottom - max(0.875rem, safe-top + 0.75rem)
                                    - max(2.5rem, 44px) - 0.5rem - 0.75rem)]
phone bar:  inset-x-[max(0.75rem, safe-left, safe-right)] ms-auto max-w-80
            max-h-[calc(100dvh - safe-top - safe-bottom - 2.75rem - 45px)]
overflow-y-auto overflow-x-hidden overscroll-contain
```

Placement is shared with the notifications popover (`components/shell/headerPopover.ts`) and is chosen by the BAR
THAT RENDERS, not by a breakpoint: `MobileTopBar` passes `phone` to `AccountMenu` / `NavBellPopover`, the TopNav
passes nothing, and no placement class is an `md:` variant. Which bar renders is a JS px query (`useIsMobile`,
767px) while Tailwind's `md` is 48rem, which follows the BROWSER's default font size (864 / 960 / 1152px at
18 / 20 / 24px, 576px at 12px), so a placement keyed on `md` hung the panels off the wrong anchor whenever the
two disagreed. The phone cap mirrors the phone header's real height exactly (`safe-top + 0.75rem + 44px +
0.75rem + 1px` border, then the `mt-2` gap, then 0.75rem of margin above the bottom inset); change `MobileTopBar`
and the cap together. The TopNav cap is the same arithmetic from the TopNav row (`max(0.875rem, safe-top +
0.75rem)` top padding + the `max(2.5rem, 44px)` avatar trigger that sets the row height + `mt-2` + 0.75rem), not
a flat guess, so it grows with the text size and the top inset. At 1024x768 and Aa22 the panel's content
(687px) is taller than the 682px under the header even with no margin, so it scrolls inside itself there (about
20px; every control reachable, nothing clipped): that is the content's height, not the cap's.

- 20rem wide (`w-80`) on the TopNav — scales with font-scale.
- **Phone bar:** the trigger wrapper is `static`, so the panel is positioned against the phone
  `<header>` (`relative`) instead of the 44px avatar. It hangs under the header, spans the width between
  the safe insets (capped at 20rem, flush with the inline-end edge via `ms-auto`, so it mirrors in RTL
  without a variant), is capped to the dynamic viewport and scrolls inside itself. No row can end up
  off-screen at 320px, landscape, or the largest Aa size.
- **Touch targets:** on a coarse pointer every control in the panel is >= 44 x 44 CSS px: the lock-timer
  steppers (`44px` columns), the lock-screen layout segments, the "Link this account" row and all full-width
  rows. The timer and layout rows wrap their stepper under the label instead of overflowing at large text.
  A mouse keeps the compact 28x30 / 36x30 widgets (pinned by the desktop assertion in `mobile-header.spec.ts`).
- `role="dialog"` + `aria-label="Account"`, `tabindex="-1"`. Focus moves into the dialog on open and returns
  to the avatar on Escape, an outside tap or an item (`usePopoverFocus` finds the trigger in the DOM, so it
  works when a tap — as in Safari — never focused the button); a tap that lands on another focusable control
  keeps its focus.

**Identity strip (linked variant):**

```
┌──────────────────────────────────────────────────────────────┐
│ [56px Avatar]   Hamdan Al-Shamsi   [ADMIN]                    │
│                 Operations Manager                            │
│                 G3082 · ops@gssg.ae                          │
│                 ✉ Synced 5 min ago                            │
└──────────────────────────────────────────────────────────────┘
  flex items-center gap-3 border-b border-hairline px-4 py-4
```

- Photo `h-14 w-14`, same `bg-primary-soft text-primary ring-1 ring-border`
  base as the trigger but bigger.
- Name: `text-[0.95em] font-semibold text-foreground truncate`.
- **Role chip** (inline next to name):
  - Admin: `bg-primary-soft text-primary` + `text-[0.65em] font-semibold
    uppercase tracking-[0.08em]` + `rounded-full px-2 py-0.5`. Light: navy
    on pale blue. Dark: light-blue on deep navy.
  - Manager: same shape but `bg-success-soft text-success`. Light:
    forest-green text on pale green. Dark: emerald on deep green.
  - Operator: no chip.
- Position: `text-[0.78em] text-muted-foreground`.
- Employee ID + email: `text-[0.78em] text-muted-foreground`, ID in
  `font-mono`.
- Last sync row: `text-[0.78em] text-muted-foreground` + Mail icon
  (`h-3 w-3` stroke 1.7). Label updates every minute via a local interval
  (`setInterval(setNow, 60_000)`).

**Identity strip (un-linked variant):**

Shows just `account.email` (or "No account configured") + the same last-sync
label below — no name/position/role/G-id rows.

**Link CTA** (renders only when an account is configured but identity is
not linked):

```
flex w-full items-center gap-2
border-b border-hairline bg-warning-soft
px-4 py-2.5
text-start text-[0.82em] font-medium text-warning
transition-colors
hover:bg-warning-soft/80
```

- Amber callout. `LinkIcon` `h-3.5 w-3.5` stroke 1.7.
- Click opens Settings page (parent's `onOpenSettings`).

**Actions block:**

```
flex flex-col py-1.5
  ├ "Lock app"          — Lock icon + text
  ├ LockTimerControl    — Timer icon + discrete stepper
  ├ "Settings"          — Settings icon + text (when onOpenSettings is passed)
  └ "Sign out"          — LogOut icon + text (when onSignOut is passed)
```

Regular action buttons use `flex w-full items-center gap-2.5 px-4 py-2.5
text-start text-[0.9em] text-foreground`, a `bg-surface-tinted` hover, and
`h-4 w-4 text-muted-foreground` icons at stroke 1.7.

The timer row is a `min-h-[54px]` `bg-surface-raised` band between hairline
rules. Its compact `[-] value [+]` stepper moves only through 30 seconds, 1,
2, 5, 15, and 30 minutes. The current value is a mono `role="status"`
output; boundary and in-flight controls are disabled. RTL reverses the
physical order naturally, while Arabic labels keep the app's prevailing
Western digits.

**Open/close:** Same `Escape` + outside-click pattern as NavBellPopover.

---

### 3.7 LockOverlay

**Sources:** `components/shell/LockOverlay.tsx`,
`components/shell/LockOverlay.css`, `lib/useLockState.ts`, and
`lib/appLockContext.ts`.

Full-screen privacy lock rendered above all routes as a controlled,
non-dismissible Radix `Dialog.Root` (`z-index: 99` overlay, lock content
above it). The authenticated session remains valid behind the overlay;
unlocking re-verifies the signed-in user's password through
`/auth/verify-password`. Only a successful verification closes it — Escape,
outside pointer/focus interaction, and any background dialog's own close
control are all suppressed on the lock's root. Toasts are hidden while the
lock is open (`body:has([data-lock-overlay]) [data-sileo-viewport]`).

**Modal focus ownership:** the lock is a real Radix `Dialog.Root`/`Portal`/
`Content`, not a plain `<div>` with dialog ARIA attributes — visual stacking
alone doesn't grant DOM focus/pointer ownership, and an already-open Radix
modal elsewhere in the tree (notably the Word handoff dialog,
`pages/books/WordHandoffDialog.tsx`) keeps its own focus trap and pointer
capture active underneath a lock that isn't itself part of the same
focus-scope stack. Being a real `Dialog.Root` lets the lock join that stack
and reliably become topmost. Password focus is set in `onOpenAutoFocus`
(after the modal has acquired ownership, not on a bare mount effect); a
successful unlock restores focus to the prior workflow's control, or the
next surviving open dialog, or `#main-content` as a last resort — see
`restoreSurvivingWorkflowFocus` in the source. `aria-hidden` on an ancestor
is deliberately **not** treated as non-focusable there: unlike `inert` (see
`CapabilityGate.tsx`), `aria-hidden` alone doesn't remove real DOM focus, and
rejecting it can drop restoration silently when Radix's shared `hideOthers`
bookkeeping has marked a still-usable dialog hidden for an unrelated reason.

**Preserving an in-progress Word handoff across a lock cycle:**
`lib/appLockContext.ts` exposes the shell's existing lock boolean read-only
(`Shell` in `App.tsx` provides it; no second timer or lock store).
`WordHandoffDialog` consumes it to defer presenting a **newly arrived**
session while locked — it keeps polling and retains the session, but
doesn't mount a competing dialog over the password field; unlocking presents
it once, without a second create/reopen request. An already-open handoff
(and any of its own nested dialogs, e.g. the Discard confirmation) stays
mounted through the whole lock cycle untouched. `components/books/
BookWordActions.tsx`'s `WordReopenButton` mounts its dialog whenever it
holds a retained (non-voided) session, not only while the record's
`edit_session` is still absent — that flag can flip active via an
`invalidateQueries` refetch before the user ever sees the dialog, reliably
so once presentation is deferred by a lock, so the button must not read it
as "nothing to show."

**Automatic lock:**

- `useLockState(status === 'authed', timeoutMs)` reads the signed-in user's
  server-persisted timeout. New accounts default to 30 minutes; the profile
  stepper offers 30 seconds, 1, 2, 5, 15, or 30 minutes.
- `gssg.lastActivity` lives in `localStorage` so idle time is shared across
  tabs and survives a window restart. Activity writes are throttled to the
  smaller of 15 seconds or one quarter of the selected timeout.
- Deadline checks run at the smaller of 30 seconds or one sixth of the
  selected timeout (with a 5-second floor), and whenever a hidden tab becomes
  visible. This keeps the 30-second option responsive without waking long
  timers unnecessarily.
- `gssg.locked` remains in `sessionStorage` so an in-app reload stays locked.
  Unlock and fresh login both refresh the activity deadline.

**Frozen Desk visual language:**

- The actual application remains visible but unreadable beneath a dark
  `--hero-grad` scrim and 14px backdrop blur.
- A thin, tabular live clock is paired with Gregorian and Umm al-Qura Hijri
  dates. Arabic uses the same hierarchy in RTL; shift ranges are isolated with
  `<bdi dir="ltr">` so their chronological order never reverses.
- The unlock surface is vertically centered on desktop in all three layouts
  and becomes a frosted bottom sheet at `≤760px`, raised above the on-screen
  keyboard via the Visual Viewport API. It contains the linked employee
  photo/initial, localized welcome, pill password field, show/hide control,
  circular submit control, idle note, inline API error, and localized
  sign-out action.
- All animation is gated by `prefers-reduced-motion: no-preference`.

**Three per-account layouts:**

1. **Command band** — clock above one horizontal operations rail, unlock
   centered below.
2. **Central stack** — the same hierarchy inside one large glass instrument
   panel.
3. **Briefing console** — clock and operational context share a compact
   two-column console; unlock is centered beneath it, with the
   approvals/inbox/expiry digest as a strip below the login.

The layout choice is not made on the lock screen itself — it is a glyph
segmented control (`LockLayoutControl`) grouped with the screen-lock timer in
the account menu, persisted server-side on `User.lock_layout` (mirrors
`idle_lock_seconds`) via `PATCH /auth/me/lock-layout`. The lock screen reads
`SessionUser.lock_layout` once per mount; an unrecognized value falls back to
Command band.

**Privacy-safe operational glance:**

- Current/next shift times come from the existing
  `GET /workforce/dashboard/snapshot` projection and render only when the user
  has `workforce.self.view` or `workforce.dashboard.view`.
- Approvals, inbox, and expiry show aggregate counts only from already-cached
  React Query data. Names, subjects, record references, and notification
  details are never rendered on the lock screen.
- Weather uses the explicitly approved client-side flow: BigDataCloud performs
  approximate IP geolocation, then Open-Meteo receives the returned coordinates
  for current temperature, WMO condition, daily high/low, and humidity. Both
  requests are keyless, cached for 30 minutes, localized, abortable, and fail
  closed by omitting weather.

**Accessibility:**

- Root contract: `role="dialog"`, `aria-modal="true"`, localized `aria-label`,
  explicit `dir`, and password autofocus.
- Every icon-only control has an accessible name. Visible controls retain
  keyboard focus rings; the layout switcher is a named `role="group"`.
- English and Arabic keys are peers under `lockScreen`; no inline language
  ternaries or `defaultValue` fallbacks remain.

### 3.8 Toasts (AppToaster)

**Sources:** `lib/toast.ts` (the API), `lib/toastFit.ts` (pill measuring and
clause split), `lib/toastHold.ts` (hover/focus hold), `components/shell/AppToaster.tsx` +
`AppToaster.css` (the Sileo host), `components/shell/toastParts.tsx` (badge
glyphs, countdown, reference chip, server text), `lib/toastAnnouncements.ts`
(screen-reader channel). Notices come from [Sileo](https://sileo.aaryan.design)
`0.1.6`, pinned and patched (`frontend/patches/sileo@0.1.6.patch`, see Hover),
mounted once in `App.tsx` for both the signed-out and signed-in shells.
**Never import `sileo` outside `lib/toast.ts` / `AppToaster.tsx`.**

**API.** `toast`, `toast.success|error|warning|info|loading`, `toast.promise`
and `toast.dismiss(id?)` from `@/lib/toast`; options `id`, `description`,
`reference`, `duration`, `action: { label, onClick }`, `icon`. Behaviour the
adapter owns:

| Concern | Rule |
| ------- | ---- |
| Identity | Every call gets a unique id, so notices stack, and every id a call returns can be passed back as `id` to update that toast in place (`const id = toast.loading(…)` then `toast.success(…, { id })`; `timesheet-cell-locked`). A fixed id raised again after its toast closed is a fresh toast. Sileo's own default shares one id and would replace every notice. |
| Duration | 4 s default (Sonner's, unchanged by the Sileo migration; Sileo's own is 6 s). An explicit `duration` overrides it. `Infinity` stays until dismissed; `loading` always does. A deferred-delete Undo passes its own commit window as `duration`. The body stays open until the toast closes. |
| Pill vs body | The collapsed pill holds one line, measured in the page's font (about 284px of title; 36 characters where nothing can be measured). A message too wide for it leads with its first clause (split after `.` `:` `;` `؛`, after `?` `!` `؟`, or at a spaced dash) and the rest moves into the body; with no clause that fits, the whole message moves into the body under a localized state title (`common.toastState.*`). A short message with a `description` keeps the message as the title. The newest toast opens its body by itself; any toast opens on hover or keyboard focus. |
| Server text | In the Arabic UI, a message with Latin letters and no Arabic (the server's English error detail, a file name, a status) is not used as the title: an error is titled `common.toastServerError` ("تعذّر إكمال الطلب") and the text sits in the body as `lang="en" dir="ltr"`, aligned to the body's start edge. Loading toasts are exempt: Sileo never opens their body, so the text stays in the pill. A 403 never reaches a toast as server text: `apiErrorMessage` (`lib/api.ts`) first maps refusal codes that say more than "no permission" (`ACCOUNT_REJECTED`, `DOCX_LOCKED_AFTER_SIGNING`, … in `CODE_MESSAGE_KEYS`) to their own translated message, and turns any other 403 into `common.forbiddenError` ("لا تملك صلاحية لهذا الإجراء" / "You don't have permission for this") in both languages. A new 403 code with a specific meaning gets a `CODE_MESSAGE_KEYS` entry and EN/AR keys. Error toasts take their text from `apiErrorMessage`, never `err.message`. |
| Reference | `reference` (a record number) rides in the pill as `message · REF`, direction-isolated with U+2068/U+2069, when the toast has no other body and it fits; otherwise it is a mono chip (`.toast-ref`) in the body. Announced either way. |
| Repeats | An id-less, action-less notice raised again while its toast is up updates that toast in place with a count (`Network error ×3`) and restarts its timer. A fixed id or an action is never merged. |
| Neutral | `toast(msg)` is `info`, or `action` when it carries an action. |
| Action | Runs `onClick`, then closes the toast (Sileo does not). The button is sized to its label on its own row at the start of the body; with no body text it is centred in the body (`toast-action-only`). A timed action toast (an Undo) wraps its badge glyph in a countdown ring that drains over the toast's window, pauses while the stack is held by pointer or focus, and restarts with Sileo's timers on release (they restart from the full duration). A follow-up action (open the record, open the Scan Inbox, continue editing, an Undo that is not a deferred delete) passes `duration: 8000`; a deferred-delete Undo passes its commit window and returns `() => toast.dismiss(id)` so the toast never outlives the commit. |
| Glyphs | The badge carries the app's lucide set: Check, X, TriangleAlert, Info, LoaderCircle (spinning), and ArrowRight for actions, mirrored in Arabic (`rtl:-scale-x-100`). `icon` replaces it. |
| Dismiss | Swipe, click (not on a loading toast), or Escape while focused. `dismiss()` with no id clears all. |

**Scan inbox.** Only `auto_filed` scans can be undone. Operator-filed (`filed`)
and dismissed scans are terminal: their success toasts carry no Undo action
and use the default duration. Keep destination references/descriptions and
per-call toast ids; the auto-file follow-up to open the record keeps its 8 s window.

**Save monitoring.** The application preview owns its save loading toast. A
terminal job result updates that same id; five consecutive polling errors
replace it with the localized network warning, not a claim that saving failed.
Leaving the preview or page, replacing the tracked job, or starting another
generation dismisses any unresolved save notice.

**Theme and colour.** The host passes the app theme (`<html data-theme>`) to
Sileo, which draws the *inverse* pill. The pill is filled from the app, not
Sileo's neutrals: the navy `--rail` on the cream page, the light theme's raised
cream `#fafaf6` on the near-black page; the light pill's body text is
`--rail-text`. State tones in `AppToaster.css` are the inverse
theme's `--success`/`--accent`/`--warning`/`--info` values, tuned for ≥ 4.5:1
against the pill (warning on the light pill is `#9a4507`, a shade darker than
`--warning`). A theme change flips live toasts.

**Position and scale.** Placement is the same in both languages. Desktop uses
`bottom-center`, 90px above the bottom edge, at 110% zoom; bodies expand upward.
Phones use `top-center`, 12px plus `env(safe-area-inset-top)` below the top edge,
at 105% zoom; bodies expand downward and may briefly overlay the header. The
existing `useIsMobile` breakpoint (below 768px) chooses the placement. Phone
zoom is capped to `viewport width / 350px` so even a narrow screen holds the
whole toast. Sileo's viewport padding is removed and offsets are divided by
zoom, so the requested distances are rendered pixels. Zoom covers only the
viewport; title-fit probing and Sileo's width/height measurements stay in CSS
pixels. A resize updates the placement for new toasts; Sileo pins existing
toasts to the edge where they were raised until they close.

**RTL.** Position does not change with language. Text, the badge and the
action follow `<html dir>`; the body uses `text-align: start` and Arabic body
text a 1.6 line height. Titles are not title-cased. Sileo positions the pill
header by physical `left` and leaves its 10px of spare room on the right, so in
Arabic the host shifts the header right by that room: the badge sits 8px from the
pill's right edge and the room trails the title, mirroring English.

**Scan-back dock.** `ScanBackDock` (`pages/scanBack/ScanBackDock.tsx` +
`ScanBackDock.css`) is drawn as a toast, collapsed or open, in its own bottom
inline-end corner. Its collapsed pill uses the toast pill's fill (navy `--rail`
on the cream page, `#fafaf6` on the dark page), 40px height, a 24px round badge
(Printer, warning tone at 20% behind it) and the toast title type (0.825em,
500) in the warning tone (`#fbbf24` / `#9a4507`); all Arabic dock text is 5%
smaller than English, in both the collapsed pill and the open body, without
shrinking thumbnails, icons or hit targets. The chevron and dismiss are
the toast description colour. Open, it is an expanded toast: the body grows up
out of the pill in the same fill with Sileo's 16px radius, square at its
inline-end bottom corner where the pill continues it; the pill's top corners go
square and a 16px concave fillet fills the inside corner beside it (the join
Sileo's gooey filter draws). The body re-points the app's colour tokens
(`--text`, `--text-muted`, `--surface-tinted`, `--hairline`, `--border`,
`--border-strong`, `--info`, `--info-soft`, `--primary`) to the toast palette,
so rows, mono ref chips, dashed drop targets and focus rings follow the
toasts: description colour for text, `--rail-faint` / 72% ink for muted text,
the info tone for hover and drop, and "View all" as Sileo's action button
(action tone on a 15% wash). Thumbnails keep their white paper. The body opens
with the toasts' spring (none under reduced motion). `items-end` is logical, so
the pill sits in the corner in both directions; never add an `rtl:` alignment
override. The dock rests 1.5rem from the bottom on desktop and 5.5rem plus the
safe area on mobile (above the BottomTabBar), independently of the toast stack.
The open body is capped to `50dvh` and the available room above the dock; its
rows scroll.

**Hover.** Sileo 0.1.6 gave the hovered toast the single "open" slot, collapsing
the newest under it; when their bodies differed in height the stack shifted, slid
the hovered pill from under the pointer and closed it again. The patch removes
that hand-off: a hovered toast opens on its own and the newest stays open, so
nothing below the pointer moves. On a Sileo upgrade, re-check the patch applies and
`AppToaster.test.tsx` "keeps the newest toast open…" still passes (it fails without it).

**Motion.** Sileo's CSS honours `prefers-reduced-motion`; its pill is animated
by motion's JS springs, which the host switches off with
`MotionGlobalConfig.skipAnimations` when the preference is `reduce`. Two
animations stay under `reduce`: the loading spinner and the Undo countdown, a
slow in-place drain that says how long Undo is on offer.

**Accessibility.** Sileo's viewport is `aria-live` only while a toast exists and
its SVG titles would name the toast, so the host (1) silences the viewport and
hides the canvas and state icon, and (2) announces every notice through two
always-mounted regions — `role="status"` (polite) and `role="alert"` (errors).
Focusing a toast replays Sileo's hover path, so the body opens and the timer
pauses for keyboard users. A collapsed body is `visibility: hidden`, so its
action is neither visible nor tabbable until the toast opens.

**Stacking, lock, print.** `z-index: 999999999` (above dialogs and the document
viewer). The lock overlay hides the viewport and the announcers
(`LockOverlay.css`); print hides both and the wrapper carries `data-print-hide`.

**Known limits (Sileo 0.1.6).** Only the newest toast shows its body without
hover, so in a stack older toasts read as their title until hovered (the
announcers still carry their full text).
`Infinity`-duration toasts with a description open on hover/focus only. Sileo's
body is always its full 350px wide, which is why a lone reference goes in the pill.

## 4. Dashboard page

### 4.1 Page shell

**Source:** `pages/dashboard/DashboardPage.tsx`.

The hero is unchanged. Below the “My widgets” strap, one packed CSS grid
replaces the former zones and separate quick-actions band.

- Compact canvas: centered `max-w-[1180px]`, 4 logical columns.
- Wide canvas: full available width, 6 logical columns.
- Below `md`: 2 logical columns. Grid rows are fixed at `9.25rem`, with
  `gap-3.5` (`0.875rem`), not fractional-height rows.
- Sizes: S = 1×1, M = 2×1, L = 2×2, W = full-width×1, XL = full-width×3.
  On phones W is full-width×2. `lib/dashboardLayout.ts` places each box explicitly, then
  grows neighbours to absorb gaps. CSS grid mirrors logical columns in RTL.
- `pages/dashboard/widgetRegistry.tsx` removes unavailable widgets before
  packing. The final box determines glance, summary, tall, or list content.
- `components/dashboard/WidgetFrame.tsx` is the shared card frame: two-line
  title, optional count and View all, then a filling, clipped body. Narrow
  cards and compact/glance frames show only the labelled View all chevron.
  While editing, the frame header is omitted in favor of the named in-flow
  controls header (§4.9).
- Quick actions are a regular `quick_actions` widget with `ServiceArtwork`
  link tiles. Tile count follows its final box and every tile retains its
  service-specific capability gate.
- Private layouts use `{ id, visible, order, size }`; legacy zones are read
  only for migration and never written.
  Empty legacy layouts (including those pruned to no surviving ids) restore
  visible W quick actions; explicit v2 visibility, including hidden, wins.

---

### 4.2 Hero

**Source:** `<DashboardHero>` inside `DashboardPage.tsx`.

**Anatomy:**

```
┌──────────────────────────────────────────────────────────────────┐
│ "Welcome back, Hamdan"                                  [🪯 crest] │
│ 12 documents · 3 returning this week                                │
│  (white-on-gradient)                            (rotates 90s)       │
└──────────────────────────────────────────────────────────────────┘
   rounded-2xl px-4 py-4 md:px-8 md:py-6
   background: var(--hero-grad)
```

**Container:**

```
anim-fade-up relative mb-4 flex min-h-0 flex-col gap-4 overflow-hidden rounded-2xl px-4 py-4 md:mb-6 md:min-h-[150px] md:flex-row md:items-stretch md:gap-5 md:px-8 md:py-6
style={{ background: 'var(--hero-grad)', animationDelay: '0ms' }}
```

- Content-driven height, with `md:min-h-[150px]` on wider screens.
- `overflow-hidden` because the upper-right circle highlight extends
  beyond the rounded corners.

**Upper-right highlight:**

```
<span aria-hidden
      class="pointer-events-none absolute -top-20 end-[-80px]
             h-[280px] w-[280px] rounded-full bg-white/[0.06]"/>
```

- A faint 6%-white circle, half-clipped by the hero edge. RTL-aware
  positioning via `end-[-80px]` (sits at the inline-end corner in both
  directions).

**Headline:**

```
m-0 text-[1.6em] font-semibold tracking-tight text-white
```

Composition (`headline` in code):

- Linked: `"Welcome back, {name}"` (the linked employee's `name_ar` when
  AR, else `name_en`).
- Un-linked: i18n string `dashboard.welcomeBackGuest`.

While `summaryQuery.isPending && !name`:

```
<Skeleton class="h-7 w-72 bg-white/20"/>
```

(28px tall × 288px wide bar, white at 20% opacity.)

**Subtitle (`sub`):**

```
mt-1.5 text-[0.86em] opacity-90 text-white
```

Built from two optional parts joined by ` · `:

- `i18n('dashboard.heroSubtitle', { count: docsCount })` — only when
  `docsCount > 0`.
- `i18n('dashboard.heroLeavesReturning', { count: leavesReturning })` —
  only when `leavesReturning > 0`.

If both are 0, the subtitle node doesn't render.

**Crest:**

```
<img src="/brand/gssg-logo.png" aria-hidden
     class="dashboard-crest
            h-[84px] w-[84px] rounded-full object-cover
            shadow-[0_0_0_2px_rgba(255,255,255,0.18)]"/>
```

- 84px circle.
- Drop shadow is a 2px ring at 18%-white (acts as a subtle ring outline
  against the gradient).
- Animates `transform: rotate(0deg → 360deg)` over 90s, linear, infinite.
- Reduced-motion: rotation suppressed.

**Dark theme:** hero gradient deepens (`--hero-grad` flips to its dark
recipe). Text stays explicit `text-white`. Skeleton bar uses `bg-white/20`
in both themes — slightly more washed-out against the dark hero, but
still readable.

**RTL:** Crest moves to the *start* edge implicitly (it follows DOM order
inside a flex container — flex-direction flips with `dir="rtl"`). The
upper-right highlight uses `end-[-80px]` so it lives at the *inline-end*
corner in both modes.

**a11y:**

- Headline is a real `<h2>` (semantic page heading).
- Crest is `alt=""` + `aria-hidden` — purely decorative.
- Subtitle is a plain `<p>`.

---

### 4.3 Records, approvals and unread mail widgets

**Sources:** `pages/dashboard/widgets/MyDocumentsWidget.tsx`,
`WaitingApprovalsWidget.tsx`, `SentApprovalsWidget.tsx`, `InboxWidget.tsx`,
`MyDraftsWidget.tsx`, `UnreadMailWidget.tsx`.

Every size uses `WidgetFrame`, never a nested card or a self-hidden body.
Glance and summary show linked metrics; tall and list use compact two-line
rows, capped by the packed box's `rows`. The remainder stays in a separate
`shrink-0` “+N more” link outside the clipped list. Loading skeletons and
load-error/retry feedback remain inside the same frame. Empty states use
short copy plus a direct, capability-appropriate action, not a long
instruction sentence squeezed into a truncated line (§4.5).
Colors, focus rings and surfaces use the existing tokens;
references and numeric metrics use isolated Western digits.

Preview lists share `components/dashboard/useFitCount.ts`: viewport and row
measurements reserve whole rows after each resize or font-scale change.
`WidgetProps.rows` limits preview fetching/candidates, not measured capacity;
remainder links subtract only rows actually displayed.

Glance and summary secondary text uses the shared support scale. Compact
state labels truncate with complete tooltip text; oldest-approval details
can use `line-clamp-2`. My documents shows at most one secondary state in
glance and two legend states in summary; +N opens that month's complete
Records breakdown. Frame titles use two lines while preserving the full
accessible name.

- **My documents:** title includes the localized month from `my_records.month`.
  The large completed count is `my_records.approved`, not generated-document
  activity. Nonzero approval states form the segmented bar and linked legend.
  Each state opens `/books?mine=1&status=…&from=…&to=…` using the summary's
  exact bounds (`not_submitted` maps to `none`). The tall/list preview shows
  `latest_approved`, links to `/books?open=<book_id>`, and uses a general-record
  label when there is no employee.
  Dashboard-linked mine/status/date/draft filters run server-side before the
  500-row page window; Records loads every matching page. Other entry paths
  retain their existing client filtering.
- **Needs your signature / To review:** received signing work takes priority,
  then received review work. Idle reviewers retain their received queue.
  Glance shows oldest age; summary adds its subject; tall/list preview the
  existing approval log. Queue and assigned-revision row links use
  `approvalQueueUrl` and `approvalRecordUrl`, preserving kind, version and
  pending status. Additional review work has its own filtered link.
- **Sent for approval:** number, View all and remainder use the pending sent
  queue. The needs-changes chip is a separate returned queue. Summary shows
  the oldest submission and signer; tall/list show real approval-log rows.
- **Sent to me:** keeps unread, incoming/outgoing and purpose summaries.
  Tall/list use the existing received-books query; rows open the supported
  `/ledger?tab=books&scope=incoming&book=<id>` overlay. Purpose counts describe
  the received set, not the unread count.
- **My drafts:** `my_records.drafts`, all months, links to
  `/books?mine=1&drafts=1`. All sizes intentionally remain summary-only: the
  existing Books list API has no exact drafts filter, so an arbitrary page
  must not be presented as a complete drafts preview.
- **Unread mail:** count and rows come from owner-scoped `unread_mail`, gated
  by `ledger.view`; linked Records the caller cannot read are excluded from
  both the count and preview before the row limit.
  View all opens `/ledger?tab=email`; rows open `/ledger?mail=<id>`.
  Email sync is the footer, not a separate widget. Its received-today value
  is explicitly separate from unread. Sync now requires `ledger.view` and
  refreshes dashboard, email-account and ledger caches; Configure requires
  `settings.view`. Sync failure offers an inline retry.

---

### 4.4 Workforce and operational widget content

**Sources:** `pages/dashboard/widgets/WorkforceWidget.tsx`,
`OnLeaveTodayWidget.tsx`, `ReturningWidget.tsx`, `OpenViolationsWidget.tsx`,
`ExpiringSoonWidget.tsx`, `PendingDeparturesWidget.tsx`,
`ViolationMonthsWidget.tsx`, `PermitsWidget.tsx`, `WorkforcePulseWidget.tsx`.

Every widget uses `WidgetFrame` and its packed-box tier. Glance and summary
show compact metrics; tall/list preview candidates are capped by the supplied
`rows`, with whole visible rows measured by `useFitCount` and a separate
`+N more` footer. Loading skeletons, errors with Retry, and short empty-state
copy with direct actions stay inside the same clipped frame.

- **Workforce:** working headcount links to `working=true`; our staff to
  `status=Active`, on site to `present=true`, loaned to `status=Loaned`, and
  on leave to `status=Approved&on=…` in Leaves. Employee-derived destinations
  need `employees.view`; on-site filtering additionally needs `leaves.view`,
  and the leave chip needs `leaves.view`. Denied links remain count/label text.
  The API likewise denies leave-derived filters without `leaves.view` and
  open-violation filters without `violations.view`. The filtered Employees
  section displays the total, paginates and scopes roster search.
- **Leave:** the Dubai operational day drives links. `status=Approved&on=…`
  means date overlap, not a leave starting that day. Returning uses inclusive
  `end_from`/`end_to` covering today through today+7. Both the mobile list and
  desktop report read these filters. Counts represent leave records (one
  employee can have more than one record); rows open `/leaves?open=<id>`.
  The desktop report's filter chip bidi-isolates each interpolated ISO date
  with the shared `bidi()` helper, preserving YYYY-MM-DD order in Arabic text.
  Dashboard leave-row end dates use Western-digit `DD/MM/YYYY` via
  `formatDmy`, wrapped in `bidi()` before interpolation into the translated
  “Until” label. Returning rows keep translated relative-end labels.
- **Expiring documents:** all working-employee documents within 90 days,
  including expired ones. Rows open the employee Documents tab only with
  `employees.view`; otherwise they remain informational.
- **Pending departures:** all scheduled departures, with a true next-seven-day
  count. View all keeps `pending=1`. Cancel is offered only with
  `employees.edit` and clears only `end_date`, never reactivating an employee.
- **Open violations:** use `open_violations.count/latest`, not fabricated
  breakdown states. `violations.view` gates this projection and its legacy
  total independently of employee access; denied totals remain `null`, not zero.
  Rows open the exact employee violation; View all selects employees with an open violation.
  Employee destinations require `employees.view`; otherwise counts, labels,
  and violation previews remain informational.
- **Monthly inmate reports:** real awaiting-close months, workflow stage,
  row/pending counts and closability, linked to that month's statistics.
- **Permits:** zone-scoped security and item summaries; no 500-row item count
  proxy. Every count/preview/register link retains zone. List previews share
  the row budget; security and item remainders link to their own register.
  An XL box (≥3 columns × ≥3 rows; the default size, and the size legacy
  layouts migrate to) shows a zone toggle above two panes, security and
  item permits, each with linked count tiles and its own fitted latest list.
  Narrower XL boxes on phones use the compact list.
  Item-permit create, edit, submit and delete invalidate the summary prefix,
  refreshing every cached zone alongside the register.
- **Store:** `store_expiring` combines expired batches first with batches expiring
  within the server-provided window (60 days by default), retaining explicit
  expiry-state labels. `store_low_stock` shows items below their Minimum level.
  Both require `store.view`, share the `store-dashboard` query, link to
  `/assets/store`, and use fitted previews for tall/list boxes. Names and
  quantity units follow the UI language with bilingual fallback.
- **Workforce pulse:** glance shows coverage as a percentage; other aggregate
  tiers show scheduled/on-duty/coverage. Missing values remain unknown, reason
  codes are translated, and Open coverage opens the existing coverage sheet.

Count-dependent month, leave-record and needs-changes labels use English
one/other and all six Arabic plural categories.

---


### 4.5 WidgetFrame

**Source:** `components/dashboard/WidgetFrame.tsx`.

One `section` fills every packed widget box using
`@container/widget flex h-full min-h-0 min-w-0 flex-col overflow-hidden`,
`rounded-2xl border border-hairline bg-surface` and `p-4`.
Its accessible name is the translated title.

- Header: `flex shrink-0 items-start justify-between gap-1 pb-2`.
- `h3`: `flex min-w-0 items-start text-[0.85em] font-medium leading-snug text-muted-foreground`;
  title span: `line-clamp-2`, with the complete title in `title`.
- Optional count: `ms-1.5 inline-flex shrink-0 rounded-full bg-surface-tinted px-1.5 font-mono tabular-nums text-foreground`.
- View all: `inline-flex min-h-7 min-w-7 shrink-0 items-center justify-center rounded-sm text-[0.75em] font-medium text-primary`,
  with hover underline and a visible focus ring. The text uses
  `hidden @[20rem]/widget:inline` and is omitted entirely with `compact`.
  The `size-3.5 rtl:rotate-180` chevron remains; translated `aria-label` and
  tooltip name the destination even when text is hidden.
- Editing: omit the entire frame header and use `px-3 py-2`. The named
  in-flow controls header supplies the title, without duplicating it (§4.9).

The filling body is `flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden`.
There is no fixed minimum content height and no card-wide button containing
other links. Widgets own their explicit metric, row, state and footer
contents. Every actual action has a visible focus ring; dots are decorative
and always accompanied by a textual status.

**Shared widget type scale:**

- `BIG_NUMBER` / `PEOPLE_BIG`: `font-mono text-[2em] font-bold leading-none tracking-tight`,
  `tabular-nums text-foreground`.
- Frame titles and `PEOPLE_NAME`: `text-[0.85em] font-medium`;
  names also use `block truncate`.
- `WIDGET_SUPPORT`: `text-[0.75em] leading-tight`, shared by record rows,
  people metadata, remainder links and empty-state copy. Metadata adds
  `text-muted-foreground`; direct actions use `text-primary`.

**Empty states:** `WidgetEmpty` keeps a short message and a direct action in
`flex shrink-0 flex-col items-start gap-0.5 pt-1` with `WIDGET_SUPPORT`.
Its link uses `rounded-sm font-medium text-primary hover:underline` and
the shared visible focus ring. Omit the link when no permitted destination
is supplied. Create-oriented record actions open Services only when allowed;
otherwise they open the relevant register. Keep the state inside the existing
frame, not a nested or dashed card. Quick actions retains its own instructional
empty state (§4.6).

---

### 4.6 ServiceTile (shared service tile)

**Source:** `components/ui/service-tile.tsx`.

Shared whole-surface service button. The packed dashboard does not render
this component: `QuickActionsWidget` uses `ServiceArtwork` link tiles inside
`WidgetFrame`, with a tier-dependent count and column layout (§1.3).

**Surface:**

```
button.group.relative
.flex.min-h-[190px].w-full.flex-col.overflow-hidden
.rounded-2xl.bg-surface.p-5.text-start
.border-t-[4px].border-t-primary
.transition-all.duration-200
.hover:-translate-y-1.hover:shadow-lg
.focus-visible:* (same as §2.2)
```

- **Distinctive feature:** `border-t-[4px] border-t-primary` — a 4px navy
  cap on the top edge. Every service tile shares the same primary cap;
  the visual rhythm reads as a "rail" of uniform GSSG-branded tiles.

**Content:**

```
1. Artwork       ServiceArtwork when artwork is supplied; otherwise
                 emoji text-[2em] leading-none, aria-hidden
                 wrapper: block w-14 transition-transform duration-300
                 group-hover:-translate-y-1.5 group-focus-visible:-translate-y-1.5
2. Title         mt-3 text-[0.95em] font-semibold tracking-tight text-foreground
3. Description   mt-1 text-[0.72em] leading-relaxed text-muted-foreground
```

- `ServiceTile` receives `artwork`, fallback `emoji`, `title` and `description`
  as props. It does not select dashboard translation keys itself.
- Dashboard tiles use `QUICK_ACTION_META` from `lib/quickActions.ts`:
  `ServiceArtwork` with `size="gallery"` and `className="shrink-0"`,
  then `dashboard.quickActionLabels.${meta.slug}`. They have no description;
  `dashboard.quickActionDesc.*` keys have been removed.
- Dashboard links use `rounded-md px-2 py-0.5 text-[0.8em] font-semibold leading-normal text-foreground`,
  `hover:bg-surface-tinted`, `focus-visible:bg-surface-tinted` and an inset
  focus ring. Glance uses `gap-2 text-start`; other tiers use
  `flex-col justify-center gap-1 text-center`. No shared `ServiceTile`
  border cap, lift or shadow is applied.

**Hover composite:**

- Card lifts 4px + `shadow-lg`.
- Artwork/emoji wrapper bobs upward 0.375rem over 300ms on hover and keyboard
  focus, slower than the shared card lift's 200ms.

**RTL:** No physical-direction utilities used. The whole tile flips
naturally with `dir="rtl"`.

**Dashboard quick-action empty state:** no selected/allowed tiles renders
`text-[0.78em] text-muted-foreground` copy inside the existing frame,
directing the user to Customize, then Edit tiles. The frame's View all
destination remains `/services`; there is no separate dashed-outline card
or inline `WidgetEmpty` action.

**Reduced motion:** Card and artwork/emoji translations use
`motion-reduce:!translate-none motion-reduce:transition-none`.

---

### 4.8 Widget list rows

The current rows are links inside `WidgetFrame`, not card-wide buttons.
Shared primitives live in `pages/dashboard/widgets/peopleWidgetParts.tsx`
and `recordWidgetParts.tsx`; their compact hover and inset-focus patterns
are summarized in §2.3.

#### 4.8a LeaveWidgetRow

`peopleWidgetParts.tsx` supplies both leave lists with a compact semantic
link: token-colored initials avatar, locale-selected name, G-number, translated
leave type and a trailing end-date/relative-end label. Names and metadata
truncate inside the available inline size; the trailing label uses
`WIDGET_SUPPORT max-w-[45%] text-end text-warning`. Leave end dates use
`bidi(formatDmy(item.end_date))` for isolated Western-digit `DD/MM/YYYY`
inside translated copy. Focus rings are inset so clipping does not hide
them. Each row opens `/leaves?open=<leave_id>`.

#### 4.8b Returning rows

Returning uses the same row shape with translated Ends today / Ends tomorrow /
Ends in N days labels. Lists clip to the packed box's supplied row allowance
and expose the remainder as a separate matching filtered-list link.


#### 4.8c Approved-record rows

`MyDocumentsWidget` renders compact links, not the retired Recent Documents
card. Each row shows the record reference in a left-to-right `bdi`, subject,
employee name (or general-record label), completed state and creation date.
The record reference and date use `font-mono`; metadata uses
`text-muted-foreground`. The supported destination is `/books?open=<book_id>`,
never an employee URL with a nullable employee id.

#### 4.8d Unread-mail rows

`UnreadMailWidget` shows only the caller's unread-mail summary rows. Subject
and counterparty truncate inside `min-w-0 flex-1`; the entry-date label
uses an isolated Western-digit date. A small primary dot indicates unread
mail, not a fabricated incoming/outgoing breakdown. Rows link to
`/ledger?mail=<id>`, which selects the Email tab and opens the mail overlay.

#### Row navigation

Use the destination's supported overlay parameter: leaves and Records read
`open`, the Books routing desk reads `book`, Email reads `mail`, and
approvals carry the canonical assigned-version context. Do not use a
generic `?open=` link for unrelated pages.

### 4.9 In-place Customize and quick-action tile editor

**Sources:** `components/dashboard/CustomizeWidgets.tsx`,
`pages/dashboard/DashboardPage.tsx`, `components/dashboard/WidgetEditDialog.tsx`.

Customize edits the dashboard in place, not in a modal. Gap filling is
always on; the packed boxes remain the preview.

- Banner: Compact/Wide native radios and Reset, Cancel, Save layout.
  Below `sm`, instructions use `basis-full` and width/reset controls wrap.
  Reset only replaces the draft with `DEFAULT_LAYOUT`; it never saves.
- Each box has a named in-flow controls header:
  `flex min-h-11 shrink-0 items-center gap-1 border-b border-hairline bg-surface-raised px-2 sm:min-h-10`.
  The title uses `min-w-0 flex-1 truncate text-start text-[0.8125em] font-semibold text-foreground`.
  It replaces the regular frame header, not an overlay over the preview.
- At `sm` and above, show a native drag handle, footprint/chevron menu
  trigger and separate Remove button. On phones, hide drag and the separate
  Remove button; the menu trigger is `MoreHorizontal`.
- The menu offers localized Small · 1×1, Summary · 2×1, Large · 2×2 and
  Full width, plus Extra large · full width (full width, three rows; the
  permits two-pane panel), names (`dashboard.customize.sizes.*`), each with an `aria-hidden`
  SVG footprint. Selected size is `menuitemradio` with `aria-checked` and
  a checkmark. Earlier, Later and Remove share this menu; quick actions
  also includes Edit tiles. Boundary moves and saving controls are disabled.
- Control targets use `min-h-11 min-w-11`, shrinking to
  `sm:min-h-7 sm:min-w-7` on fine pointers; coarse pointers keep
  `[@media(pointer:coarse)]:min-h-11` / `min-w-11`. Menu items use
  `min-h-11 sm:min-h-8 [@media(pointer:coarse)]:min-h-11`.
- Previews stay at full opacity. Their wrapper is `min-h-0 flex-1 overflow-hidden`
  plus `pointer-events-none` and `inert` while editing; content is readable
  but cannot receive pointer or keyboard interaction.
- The available-first Add panel groups addable widgets by source page.
  Already-added widgets move into a collapsed native `details` list with a
  translated on-dashboard count and checkmarks, not disabled Add rows.
  Add appends the widget at S. At `sm` it sits below the board; at `lg`
  it is a sticky `lg:w-64` side panel with `lg:max-h-[75vh] lg:overflow-y-auto`.
- Below `sm`, hide the inline Add panel. Add widget opens a Radix Sheet,
  `w-[min(100%,24rem)] overflow-y-auto`, with safe-area top/bottom padding.
  Add, Cancel and Save layout stay in a phone action bar:
  `fixed inset-x-3 bottom-[calc(5.5rem+var(--safe-bottom))] z-40`.
  The bar is portalled to `document.body`; at `sm` it becomes static.
  The editing canvas adds `max-sm:pb-24` for clearance.
- Moving keeps focus on the moved widget's menu or drag control. Removing
  focuses its enabled Add button, or the phone Add widget trigger; Save
  layout is the fallback. Exiting restores focus to Customize.
- Cancel discards the entire draft, including width, Reset and tile edits.
  Only Save layout persists the full private layout.

Edit tiles opens the existing Radix `WidgetEditDialog` from the quick-actions
menu. Its Save changes only the in-place draft. Its retained visual treatment
follows.

#### Overlay

```
fixed inset-0 z-40 bg-black/40
data-[state=closed]:animate-out data-[state=closed]:fade-out-0
data-[state=open]:animate-in data-[state=open]:fade-in-0
```

- 40%-black scrim, Radix-driven fade in/out.

#### Body

```
Dialog.Content
fixed left-1/2 top-1/2 z-50 w-full max-w-md
-translate-x-1/2 -translate-y-1/2
rounded-2xl bg-surface p-6 shadow-xl
focus:outline-none
```

- 28rem max width (`max-w-md`), centered with negative-half translate.
- `shadow-xl`.

#### Header

```
mb-4 border-b border-hairline pb-4
  ├ Title:         text-[1.05em] font-semibold tracking-tight text-foreground
  ├ Description:   mt-1 text-[0.86em] text-muted-foreground (optional)
  └ Cap hint:      mt-2 text-[0.78em] font-medium text-muted-foreground
                     "Max N visible · 2/3" (only when maxVisible is set)
                   The "2/3" segment is font-mono and text-foreground for emphasis.
```

#### List

```
flex max-h-[60vh] flex-col gap-2 overflow-y-auto
  └ each item:
     flex items-center gap-2.5 rounded-lg
     border border-hairline bg-surface-raised
     px-3 py-2.5
     ├ [GripVertical h-4 w-4 text-faint stroke 1.6, aria-hidden]
     ├ [label flex-1 text-[0.9em] font-medium text-foreground]
     ├ [ChevronUp icon-button] + [ChevronDown icon-button]   (§2.7c)
     └ [VisibilitySwitch]                                     (custom switch, below)
```

- Row background is `bg-surface-raised` (subtly lighter than the dialog
  body's `bg-surface`) → reads as a "card-on-card" rhythm.
- Up/down arrows are disabled at row boundaries (opacity-40, cursor-not-
  allowed).
- The "Up/down arrows" approach was chosen over drag-and-drop to avoid
  pulling in `@dnd-kit` for a short list (per the source comment).

#### VisibilitySwitch (custom)

Hand-rolled because the codebase doesn't ship a shadcn `Switch`.

**Track:**

```
relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border
transition-colors
+ [checked]   border-primary bg-primary
+ [unchecked] border-hairline bg-surface-tinted
```

- 36×20px track (`w-9 h-5`).
- Checked: navy fill + matching border.
- Unchecked: cream tint with a hairline border.

**Thumb (`absolute start-[2px]`):**

```
inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm
transition-transform
+ [checked]   translate-x-4 rtl:-translate-x-4
+ [unchecked] translate-x-0
```

- 14×14px white disc.
- `start-[2px]` anchors to the inline-start edge so the translate math is
  identical in LTR and RTL. The `rtl:-translate-x-4` flips the sign so
  the thumb slides toward the inline-end direction.

**`role="switch" aria-checked"`** — proper switch semantics.

#### Footer

```
mt-5 flex items-center justify-between border-t border-hairline pt-4
  ├ "Reset to defaults" (inline-button-link, §2.4)
  └ flex items-center gap-2
       ├ Cancel (outline pill, §2.5)
       └ Save   (primary pill, §2.5; shows Loader2 spinner when isSaving)
```

**Save behavior:**

- Clamps visibility to `maxVisible` before calling `onSave`; the dialog also
  blocks the off→on toggle once the cap is hit.
- Saves the quick-action tile list into the in-place layout draft. No widget
  pair is locked outside this editor; Save layout persists the full draft.

**Open/close behavior:**

- The dialog mounts its `<DialogBody>` only when `open === true`, so the
  local draft state is fresh on every open. Avoids a `useEffect` to sync
  props → state.
- Outside-click / Escape / overlay-click all close.

---

### 4.10 Monthly inmate report workspace

**Sources:** `pages/application/statistics/StatisticsTab.tsx`,
`WorkflowControls.tsx`, `ExportWorkspace.tsx`, `RegisterDocument.tsx`, and
`registerPresentation.ts`.

The surrounding workspace is ordinary bilingual application UI: controls,
task labels, validation, actor selection, history, and notifications resolve
from the active English or Arabic locale and follow the document direction.
Control layout uses logical start/end properties, action labels may wrap, and
the same preparation, review, approval, return, and reasoned-reopen controls
must remain reachable at desktop and narrow widths and at every supported font
scale.

The report paper is intentionally different from its shell. Preview, print,
PDF, and rich clipboard table content initiated by this workspace are always
Arabic and RTL. The paper is fixed to A4 portrait and retains physical
reference proportions; application language, theme, and font scale do not
change the official document's language, colors, measurements, or typography.
IDs, dates, references, and wing codes inside the RTL report use explicit LTR
change the official document's language, colors, measurements, or typography.
IDs, dates, references, and wing codes inside the RTL report use explicit LTR
direction. There are no report language or orientation controls. Save as PDF
suggests the Arabic report title plus the selected year and month
(`سجل مخالفات المسلكية الشهـري_2026-09`), never the application's generic tab
title, and the tab title is restored once the print dialog closes.

Save as PDF suggests the Arabic report title plus the selected year and month
(`سجل مخالفات المسلكية الشهـري_2026-09`), never the application's generic tab
title, and the tab title is restored once the print dialog closes.

The report contains an Arabic masthead, exactly two four-cell metadata rows,
the selected population tables, an optional eight-row whole-month summary,
and three performed-actor identity blocks. A partial extract keeps its extract
caption even when the summary is disabled. Rich clipboard output includes the
selected tables, extract caption when applicable, and optional summary, but
excludes masthead, metadata, and actor blocks. Its plain-text twin preserves
the same values. Table headers repeat across printed pages; rows have no fixed
height or clipping, and the complete actor block appears once at the end.

Workflow status is separate from the paper. The controls show the month's
current state and the server's allowed actions and blockers remain
authoritative; a draft shows no performed actors and no closure timestamp. A
month closed before this lifecycle existed prints empty actor blocks rather
than invented approvals.

---

## 5. Animation appendix

Every named animation on the Dashboard and chrome.

| Keyframe                  | Where (selector)                                                  | Property animated            | Duration | Easing                   | Iterations | Reduced-motion handling                                          |
| ------------------------- | ----------------------------------------------------------------- | ---------------------------- | -------- | ------------------------ | ---------- | ---------------------------------------------------------------- |
| `gssg-fade-up`           | `.anim-fade-up` (app main and Dashboard Hero)                     | opacity 0→1 + translateY 8px→0 | `220ms` | `cubic-bezier(0.16, 1, 0.3, 1)` | once (`both`) | `animation: none` under `prefers-reduced-motion` |
| `gssg-crest-spin`         | `.dashboard-crest` (Hero crest img)                               | rotate 0→360deg              | `90s`    | `linear`                 | infinite   | rotation cancelled                                               |
| `theme-switch-sun-rotate` | `.theme-switch-sun svg`                                           | rotate 0→360deg              | `15s`    | `linear`                 | infinite   | `animation: none !important` under reduced-motion                |
| `theme-switch-moon-tilt`  | `.theme-switch-moon svg`                                          | rotate 0→-10°→+10°→0          | `5s`    | `linear`                 | infinite   | as above                                                         |
| (thumb slide)             | `.theme-switch .theme-switch-slider::before`                      | transform translateX 0↔26px  | `0.4s`   | default (ease)           | once per toggle | `transition: none !important` under reduced-motion              |
| (sun↔moon track bg)       | `.theme-switch .theme-switch-slider`                              | background-color             | `0.3s`   | default                  | once per toggle | not overridden (color change is harmless under reduced-motion)  |
| (slider thumb hover)      | `.aa-slider::-webkit-slider-thumb`                                | transform scale 1→1.2        | `0.15s`  | default                  | once per hover  | not overridden                                                  |
| Card hover lift           | ServiceTile `transition-all duration-200`                       | translateY 0→-4px + shadow change | `200ms` | default                  | once per hover  | `motion-reduce:!translate-none motion-reduce:transition-none` |
| Service artwork/emoji bob | ServiceTile `group-hover:-translate-y-1.5`                      | translateY 0→-6px             | `300ms`  | default                  | once per hover  | `motion-reduce:!translate-none motion-reduce:transition-none` |
| TopNav link micro-lift    | `.hover:-translate-y-0.5` on inactive NavLinks                    | translateY 0→-2px             | `200ms`  | default                  | once per hover  | `motion-reduce:!transform-none` applied                          |
| Logo scale-up             | `.hover:scale-[1.02]` on TopNav logo                              | scale 1→1.02                  | `200ms`  | default                  | once per hover  | not overridden                                                   |
| Skeleton pulse            | Tailwind `animate-pulse` on Skeleton                              | opacity 1↔0.5                 | `2s`     | cubic-bezier(.4,0,.6,1)  | infinite        | Tailwind suppresses under reduced-motion                         |
| Smart-link chip hover     | `[data-smart-link='*']:hover` background-color shift              | background-color              | `120ms`  | default                  | once per hover  | not overridden (subtle color shift)                              |

**Dashboard entrance timing:** Hero sets `animationDelay: '0ms'`.
The My Widgets heading, packed widget articles and quick-action links have
no per-element entrance delays. There is no dashboard card-stagger schedule.

---

## 6. Not yet documented

Things observed in the code that this first pass intentionally doesn't
cover. Add to this list as you discover more — and remove items as they're
documented.

### Out of scope for this pass

- **Mobile / narrow-viewport chrome.** Dashboard compact/wide packing and phone sizes are covered
  in §4.1, and Hero uses responsive padding and layout. The phone chrome — `MobileTopBar`, the
  account / notifications popovers, `NavDrawer` and, for landscape phones >= 768px, the desktop
  `TopNav` — follows these rules (asserted in Chromium by `frontend/e2e/mobile-header.spec.ts`;
  see "Not verified" below for what that cannot show):
  - The header is a non-scrolling sibling above the page scroller (`[data-ptr-scroller]`); nothing is
    `position: fixed` to it. The shell root is `h-dvh` (not `h-screen`), so on a browser whose dynamic toolbars
    make 100vh taller than the visible area the shell still matches the visible viewport.
  - Phone bar padding: inline `max(1rem, --safe-left, --safe-right)`, top `--safe-top + 0.75rem`, bottom
    `0.75rem` — i.e. >= 12px of breathing room above the 44px controls beyond the safe inset (also with no inset,
    e.g. Android or landscape). The `env()` insets are physical, so the larger side is used on both — no LTR/RTL
    variants (`viewport-fit=cover` is set in `index.html`). Pinch zoom stays enabled.
  - Targets are 44 CSS px (px, not rem, so they stay 44px at any text size). Menu, bell and avatar are 44px; the
    brand takes the remaining width and sheds first the wordmark (container query) and then the 32px logo
    (never squeezed: it is a fixed, `max-w-none` circle) before a control would leave the screen. Below 180 CSS px
    (a 360px phone at 200% zoom) gaps and side padding collapse so three 44px targets still fit. The wordmark is
    `leading-none` like the bell glyph: at 200% text its inherited 1.5 line box (50px) would otherwise stretch the
    header past the height arithmetic the popover cap mirrors (99px instead of 93 at 667x375, root 32px).
  - On a coarse pointer (`pointer-coarse:`), EVERY control in the header, the account / notifications panels
    and the drawer is >= 44 x 44: the Aa A / slider / A, language toggle, theme switch, lock-timer steppers,
    layout segments, "Mark all read", "View all in inbox", the nav links and the TopNav utilities. A mouse keeps
    the compact desktop widgets (asserted at 1280 x 800).
  - Narrow panels reflow instead of clipping (a 320 / 390px phone at 200% zoom is a 160 / 195 CSS px viewport, so
    a 136 / 171px panel; root text 32px at 320px is the same problem in rem). The account, notifications and
    drawer panels are `@container`s: below 200 CSS px the lock-timer stepper, the layout segments and the Aa
    A / slider / A stack at the row's full width (every part still 44px); below 11rem the account identity
    strip stacks (avatar, then name, role chip, e-mail) and below 13rem each notification row puts its icon and
    chevron on one line and the text under them. The thresholds are in rem where the cause is rem-sized padding
    and icons (so they follow the text size) and in px where it is the fixed 44px targets. Every label, name,
    role chip and count wraps (`[overflow-wrap:anywhere]`); the only intentional single-line ellipsis is
    message text (e-mail subject / sender / preview, `data-message-text`), which opens in full from the row.
    No panel adds horizontal page overflow at any of these sizes, and zoom is never disabled.
  - Landscape phones (844x390, 932x430) and tablets get `TopNav`: its side padding is `max(1rem, --safe-left/--safe-right)`
    per side, its top padding clears the top inset (see §3.1), and the destination strip scrolls sideways on touch
    when 44px targets do not all fit. A strip with destinations hidden past one physical edge paints a soft
    scroll-shadow on that edge only (`index.css`, `@media (pointer: coarse)`): nothing shows when it fits and the
    shadow moves to the other edge once scrolled, in RTL too.
  - Popover panels are anchored to the header, height-capped to the exact header height and scroll inside
    themselves (see §3.6); the placement follows the bar that renders (`phone` prop), never an `md:` variant,
    so a larger or smaller BROWSER default font size (which moves Tailwind's rem-based `md`, not the px query that
    picks the bar) cannot detach them. On a phone/touch screen the panel is the only scroller (no nested
    notification list scroller). The drawer is capped at `100% − 48px`, scrolls, clears the notch on its
    inline-start side, keeps scrolled-to controls clear of the status bar / home indicator (`scroll-pt/pb`),
    reveals whatever the focus trap focuses (Radix wraps Tab with `preventScroll`), and returns focus to
    the menu button BY REFERENCE (`returnFocusRef`), not by remembering `document.activeElement`. The phone bar is
    not `md:hidden` either. Still keyed on `md` (unchanged, out of this pass): the bottom tab bar and the main
    area's bottom padding, which at a browser font under 16px stop applying between 48rem and 768px.
  - Not verified without a device: real iOS Safari (toolbar/notch/home indicator, whether `100vh` vs `dvh`
    matters, tap-focus and mouse-event synthesis, whether an outside tap on plain content closes the popovers
    — they close on `window` `mousedown`) and real Android Chrome. The e2e emulates `env()` insets with CDP and
    emulates "taps do not focus buttons" by cancelling `mousedown`; both are Chromium models, not WebKit.
    The `h-dvh` change is a spec-based expectation, unverified on a phone. At 1240–1400px with all eight destinations on a mouse desktop the existing TopNav row already
    overflows (unrelated, unchanged).
- **Pages other than Dashboard.** Employees / Application / Ledger /
  Books / Settings each get their own §4.x section in a follow-up pass.
- **AccountMenu when on Settings page.** AccountMenu hides the "Email
  settings" action when `onOpenSettings` isn't passed — happens on the
  Settings page itself but not documented above.

### Token gaps to clean up

- `bg-muted` references in `Avatar`, `Badge` (neutral tone), `EmptyState`
  icon container, `Skeleton`. The token doesn't exist in `@theme inline`.
  Likely renders via a Tailwind v4 default. Should be migrated to
  `bg-surface-tinted` everywhere.
- `Badge` non-neutral tones (`active`, `warning`, `danger`, `info`) hard-
  code the Tailwind palette and **do not theme in dark mode**. The pale
  green / amber / red / blue backgrounds become harsh against `#131826`.
  Migrate to semantic soft-tones (`bg-success-soft text-success` etc.) —
  `ViolationMonthsWidget` already uses those success/warning label pairs.
- (Fixed) shadcn Button `secondary` / `outline` / `ghost` variants now hover to
  `bg-surface-tinted` instead of `bg-accent` (GSSG red).
- shadcn Button `destructive` variant references `bg-destructive` and
  `text-destructive-foreground` which **don't exist in @theme inline** —
  the variant is effectively unstyled. Either delete the variant or wire
  it to `--accent` / `--accent-soft`.

### Legacy color tokens (per CLAUDE.md "durable architectural notes")

The following CSS variables exist in older files but no longer have
definitions in the active token set (`--sand-100`, `--sand-200`,
`--navy-700`, `--navy-900`, `--crimson-600`, `--rule`). They no-op
against Phase 17 tokens. Affected files (per CLAUDE.md): LedgerEntryForm,
ItemsTableField, ClearanceTableField, ViolationCheckboxesField,
CounterpartyPicker, StarButton, SendToVaultDialog. None of these render
on the Dashboard, but worth noting since a future "this section also" pass
will trip over them.

### Documentation gaps

- The serif font used in LockOverlay's welcome line ("Georgia, Noto Naskh
  Arabic, serif") is the only serif on the site, and the Naskh family is
  no longer imported (replaced by Sans Arabic per Phase 12 decision §1).
  In Arabic mode the line falls back through the system stack until
  something with Naskh-like proportions is found. Decide whether this is
  intentional (ceremonial fallback) or to be retired.

## 7. Ledger Books workspace

**Sources:** `pages/ledger/LedgerPage.tsx`, `pages/ledger/BooksRoutingDesk.tsx`,
`components/books/PurposeMark.tsx`.

- Books is the first Ledger tab and the landing tab. Email opens for
  `?tab=email`, `?mail=` or `?action=`; the resolved tab is pinned in the URL
  with replace. Email hand-offs (`composePrefill`, `ledgerView` state) navigate
  to `/ledger?tab=email` so the pin never rewrites their entry. Users without
  `books.view` (and inmate reporters) land on Email.
- Incoming / Done / Outgoing / Archived are personal routing scopes. Done means
  the caller marked their received book done; Archived takes precedence over
  Incoming and Done. Incoming shows the unread count as plain mono text.
- **List.** One full-width list, no placeholder pane. Scope tabs and the search
  field share one bar. From `lg` up, a sticky `aria-hidden` header and every row
  share one grid template (`RECEIVED_GRID`):
  `9.5rem` purpose, `10.5rem` reference, `1fr` subject, `minmax(7rem,12rem)`
  sender, `6.5rem` confidentiality, `6rem` status, `6rem` sent date (end
  aligned). Outgoing (`OUTGOING_GRID`) drops purpose and status and shows the
  creator and created date. Below `lg` the same row stacks in three lines:
  purpose, reference and date; subject; sender, confidentiality and status.
  Rows are `<button>`s: `px-4 py-3 lg:px-6`, `hover:bg-surface-tinted`, inset
  focus ring. Unread subjects are `font-semibold`. A paper count (`FileText` +
  mono number + sr-only plural) follows the subject only when there is more
  than one paper.
- **Status** is text plus shape, never colour alone: New = `h-2 w-2` primary dot +
  `font-semibold`; Read = muted text; Done = `CheckCheck` + `text-success`;
  Archived = `Archive` icon.
- **Purpose mark** (`PurposeMark`): bare lucide glyph (`h-4 w-4`, stroke 1.8) +
  label, no background, no border, no radius. It sits in a fixed column so it
  never competes with the confidentiality chip, which keeps its existing pill
  (`ConfidentialityChip`, uppercase, tinted background; General renders nothing).
  The glyph shape and label carry the meaning; the tone only helps scanning.
  No new tokens.

  | Purpose     | Glyph                | Glyph tone              | Label weight    | RTL                |
  | ----------- | -------------------- | ----------------------- | --------------- | ------------------ |
  | `info`      | `Eye`                | `text-muted-foreground` | `font-medium`   | unchanged          |
  | `action`    | `ClipboardCheck`     | `text-primary`          | `font-semibold` | unchanged          |
  | `reply`     | `MessageSquareReply` | `text-warning`          | `font-medium`   | `rtl:-scale-x-100` |
  | `circulate` | `Megaphone`          | `text-success`          | `font-medium`   | `rtl:-scale-x-100` |

  Glyphs avoid `Flag` (Email follow-up) and the chip icons (`Lock`, `UserRound`,
  `Send`).
- **Book view.** Clicking a row pushes `?book=` (`useUrlOverlay('book', ['view'])`)
  and replaces the list and the Ledger tabs with a full-page view; the list stays
  mounted but hidden. Toolbar Back and browser Back both pop to the list, which
  keeps scope, search and scroll and returns focus to the opened row
  (`aria-current`, `bg-primary-soft`), or to the scope tab when that row left
  the scope.
  1. One toolbar, `bg-surface-raised border-b px-3 py-2 lg:px-4`, `flex-wrap`:
     Back to books (ghost), hairline divider, inbox actions (Mark as done is the
     only `default` button), Send / Forward, reply actions; then at the inline
     end Expand / Collapse (desktop) and Open in Records (ghost link,
     `BookText`). On mobile the toolbar is sticky and wraps.
  2. Title band `px-4 py-4 lg:px-6`: purpose mark, mono reference, confidentiality
     chip, then the subject as `h2 text-xl font-semibold` (`max-w-[75ch]`,
     wrapped in `<bdi>` so it aligns to the page start).
  3. Body: the reused `RecordPaperViewer` (`mode="pane"`, `compact`,
     `initialFit="width"`, capped at actual size) beside a Details aside
     (`w-80 xl:w-96`, `border-s`, own scroll) holding the sender note, a
     two-column `dl` (From, Sent, Opened, Done, Papers; outgoing books show
     Created by, Created, Papers), recipients and thread. Mobile stacks the aside below a `65dvh`
     (min `24rem`) document area and scrolls as a page.
- Expand toggles `view=reader` with replace (not a history step) and hides the
  Details aside so the document takes the full width.
- List queries keep a 30-second fresh cache. Opening patches read state in that
  cache rather than refetching the list, without clearing pending mutation
  invalidation. Queue actions remove the completed row locally and open the next
  book in place (replace), or return to the list when the scope is empty.
- Dates are `DD/MM/YYYY` with Western digits (`formatDmy`, `dir="ltr"` mono) in
  both languages, per §1.7.

## 8. Store delivery-note scanning

**Sources:** `pages/assets/store/StoreDeliveryScanPage.tsx`,
`components/ScanDeliveryConfirm.tsx`, `components/ScanNotePreview.tsx`.

- `/holdings/store/deliveries/scan` stays under the Deliveries tab and requires
  `store.edit`. Desktop uses the header entry; phones have a list-level entry.
- The local photo/PDF is scanned once. Reading is announced and cancellable;
  unavailable OCR or an empty result offers the manual delivery dialog with
  the chosen file already attached.
- Confirmation reuses `DeliveryLines` through optional props and slots. Local
  row crops retain document coordinates in either UI direction. Unmatched,
  uncertain and missing-quantity rows sort first; the focused summary and
  each flagged row pair warning icons with text.
- On-note crops and quantities stay together beside Received; both quantities
  use the same pluralised units. Differences require a reason, expiry is
  required, and received zero is accepted only for positive noted quantities.
- Skipping is a secondary end-of-line action. Skipped rows retain edits and
  can be restored with focus returning to the item. If every row is skipped,
  offer both another-note selection and manual entry with the valid photo.
- Delivery creation and file attachment are separate durable steps. Attachment
  failure retains the confirmed rows, disables edits and offers attachment-only
  retry or an explicit finish without the file; retry never creates a second
  delivery. English and Arabic scan copy live under `assets.store.scan`.
