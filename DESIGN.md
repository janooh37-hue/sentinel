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
   2.6  Nav-link
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
4. Dashboard page
   4.1  Page shell
   4.2  Hero
   4.3  PendingDocumentsCard
   4.4  WorkspaceCard
   4.5  WidgetCard (base) + 7 variants
   4.6  ServiceTile (Quick Action)
   4.7  SectionCard
   4.8  Row variants (OnLeave / Upcoming / Document / Ledger)
   4.9  Edit dialogs (WidgetEditDialog)
5. Animation appendix
6. Not yet documented
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

Used **sparingly** per the locked TAMM spec — only for: PendingDocumentsCard
progress bar, ledger outgoing-direction dot, error/destructive text, drafts
breakdown, accent chips.

| Tailwind class           | CSS var            | Light       | Dark        |
| ------------------------ | ------------------ | ----------- | ----------- |
| `bg-accent`, `text-accent` | `--accent`       | `#c8102e`   | `#ef4858`   |
| `bg-accent-hover`        | `--accent-hover`   | `#a30d24`   | `#f56b78`   |
| `bg-accent-soft`         | `--accent-soft`    | `#fbe5e8`   | `#3a1820`   |

#### 1.1.4 Status tones (success / warning / info)

| Tailwind class    | CSS var            | Light       | Dark        | Where used                                  |
| ----------------- | ------------------ | ----------- | ----------- | ------------------------------------------- |
| `bg-success`      | `--success`        | `#047857`   | `#34d399`   | Active employee dot, ledger incoming dot    |
| `bg-success-soft` | `--success-soft`   | `#d6f0e4`   | `#142d23`   | "Good" delta pill background, Manager chip  |
| `bg-warning`      | `--warning`        | `#b45309`   | `#fbbf24`   | On-leave dot, link-account CTA              |
| `bg-warning-soft` | `--warning-soft`   | `#fbedd8`   | `#3a2a10`   | "Warn" delta pill, link-account banner bg   |
| `bg-caution`      | `--caution`        | `#ca8a04`   | `#facc15`   | Attendance's middle rung: arrived inside the grace |
| `bg-caution-soft` | `--caution-soft`   | `#fef3c7`   | `#3b2f11`   | The same day's wash in the month grid       |
| `bg-info`         | `--info`           | `#1d4ed8`   | `#60a5fa`   | Defined but unused on the Dashboard         |
| `bg-info-soft`    | `--info-soft`      | `#e0e8f8`   | `#1c2940`   | Defined but unused on the Dashboard         |

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
| `--mountain`  | `rgba(13, 40, 69, 0.18)`                                          | `rgba(87, 120, 207, 0.22)`                                        | MountainAccent SVG fill                                |

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
| `text-[2.4em]`   | Big-number on cards (PendingDocuments, Workspace, WidgetCard)      |
| `text-[1.6em]`   | Hero headline                                                      |
| `text-[1.15em]`  | TopNav logo wordmark, LockOverlay welcome line                     |
| `text-[1.05em]`  | NavBell glyph, WidgetEditDialog title                              |
| `text-[1em]`     | LockOverlay account email                                          |
| `text-[0.95em]`  | TopNav nav links, AccountMenu name                                 |
| `text-[0.92em]`  | LockOverlay Unlock button                                          |
| `text-[0.9em]`   | LanguageToggle label, dropdown actions                             |
| `text-[0.86em]`  | Card header labels, MyWidgets/QuickActions strap                   |
| `text-[0.85em]`  | WidgetEditDialog Save button                                       |
| `text-[0.82em]`  | LockOverlay paragraph, dialog reset link                           |
| `text-[0.78em]`  | Footnotes, breakdown rows, last-sync labels                        |
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

The Dashboard's container is bounded to `max-w-[1180px]` and centered. Outside
that, the page shell stretches edge-to-edge.

**Page shell** (`<DashboardPage>` root):

```
flex flex-1 flex-col overflow-auto bg-background
  └ mx-auto w-full max-w-[1180px] px-7 pb-12 pt-6
```

- Horizontal padding: `px-7` (1.75rem)
- Top padding: `pt-6` (1.5rem)
- Bottom padding: `pb-12` (3rem) — extra space below the last section
- Single column inside, vertical rhythm via per-section margins

> All `rem`-based values scale with the `[data-font-scale]` stops in §1.2.
> At root font-size = 16px, `1rem = 16px`; at root 19px, `1rem = 19px`;
> etc. Don't translate rem to fixed px — the whole point of the rem-first
> approach is that the AaSlider resizes paddings and gaps too.

**Card padding standard:** `p-5` (1.25rem) — every card on the Dashboard
except the Hero (`px-8`) uses `p-5`.

**Card-to-card gap standard:** `gap-3.5` (0.875rem) — used on every grid
row.

**Grid rows on the Dashboard:**

| Grid                                  | Use                                          |
| ------------------------------------- | -------------------------------------------- |
| `grid-cols-1 md:grid-cols-2`          | Top widget pair (Pending + Workspace), Section pairs |
| `grid-cols-1 md:grid-cols-3`          | Bottom widget row (3 WidgetCards)            |
| `grid-cols-2 md:grid-cols-4`          | Quick Action tiles (8 max → 2 rows)          |
| `grid-cols-1 lg:grid-cols-2`          | "On Leave Today" + "Returning soon" pair     |

**Vertical rhythm (margins between sections):**

```
Hero               → mb-6
"My Widgets" strap → mb-3.5
Top widget row     → mb-3.5
Bottom widget row  → mb-6
"Quick Actions"    → mb-3.5  (mt-1.5 above strap)
Tile grid          → mb-8
Section-card rows  → mb-4 between pairs, gap-3.5 within
```

**Chrome (TopNav):** `px-8 py-3.5` with `gap-7` between the logo block and
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
| `rounded-full`  | `--radius-pill`  | `99px` | Pills (delta tags, Review pill, AccountMenu trigger) |

Additionally the Dashboard uses Tailwind's default `rounded-2xl` (1rem)
**heavily** — every card surface on the page: Hero, PendingDocumentsCard,
WorkspaceCard, WidgetCard, ServiceTile, SectionCard, dropdown panels,
LockOverlay form, WidgetEditDialog body. Treat `rounded-2xl` as the
"card radius" — it's a project convention not yet promoted to a named token.

Other radii used inline:
- `rounded-md` for row hover surfaces inside SectionCards
- `rounded-[30px]` for the ThemeToggle track (hard-coded inside the component)
- `rounded` (4px) for the active-nav underline pseudo-element

---

### 1.5 Motion tokens

There is no `--motion-*` token — motion durations and easings are declared
inline. The Dashboard uses **four** repeating durations and **three**
easings. Treat the table below as the de facto motion vocabulary.

| Duration  | Used by                                                      |
| --------- | ------------------------------------------------------------ |
| `120ms`   | Smart-link chip background fade                              |
| `150ms`   | AaSlider thumb scale hover                                   |
| `200ms`   | Card hover lift, arrow nudge, action-text color shift, NavLink hover, logo scale-up |
| `300ms`   | ServiceTile emoji bob, ThemeToggle slider background swap    |
| `400ms`   | ThemeToggle thumb translate (`transition: transform 0.4s`)   |
| `420ms`   | Dashboard entrance fade-up (`dash-fade-up`)                  |
| `1.4s`    | PendingDocumentsCard progress-bar grow                       |
| `2.8s`    | Workspace active-dot glow + blink                            |
| `3s`      | PendingDocumentsCard progress-bar pulse (loops after grow)   |
| `5s`      | ThemeToggle moon tilt                                        |
| `15s`     | ThemeToggle sun rotation                                     |
| `90s`     | Dashboard hero crest rotation                                |

| Easing                                  | Used by                                                       |
| --------------------------------------- | ------------------------------------------------------------- |
| `cubic-bezier(0.16, 1, 0.3, 1)` (out-expo) | `dash-fade-up` entrance animation                          |
| `ease-out`                              | Progress-bar grow, active-dot glow                           |
| `ease-in-out`                           | Active-dot blink, progress-bar pulse                          |
| `linear`                                | Hero crest rotation, ThemeToggle sun rotate, ThemeToggle moon tilt |
| `transition-colors` default (Tailwind, 150ms ease) | Most hover-tone changes                            |
| `transition-all duration-200`           | Card hover lift + shadow                                      |

**Reduced-motion handling:**

Every animation on the Dashboard has a `@media (prefers-reduced-motion: reduce)`
guard. The pattern looks like this (taken from DashboardPage):

```css
.dash-anim { animation: dash-fade-up 0.42s cubic-bezier(0.16,1,0.3,1) both; }
@media (prefers-reduced-motion: reduce) {
  .dash-anim { animation: none; }
}
```

For Tailwind utilities, the dashboard uses the `motion-reduce:` variant:

```
motion-reduce:!transform-none
motion-reduce:!shadow-sm
motion-reduce:!transition-none
```

The `!important` modifier (`!`) is required because the base utility (e.g.
`hover:-translate-y-1`) loads later in the cascade than the
`motion-reduce:` variant otherwise.

**Stagger pattern:** The hero animates first (delay 0ms). After that, every
direct child of the page shell carries `style={{ animationDelay: '<N>ms' }}`
with N increasing in increments of 40ms for widget rows, 20ms for service
tiles. See §5 for the full ordered table.

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
| Big cards on page background     | `ring-offset-2` (offset = `--bg`)               |
| Section-card rows (inside `bg-surface`) | `ring-offset-1` (offset = `--surface`)   |
| AaSlider buttons (inside tinted pill)   | `ring-offset-1 ring-offset-surface-tinted` |
| TopNav nav-links                 | `ring-offset-2` (offset = `bg-surface` chrome)  |

**ARIA patterns:**

- All decorative icons get `aria-hidden` (Chevrons, MountainAccent SVG, etc.)
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
| WidgetCard action arrow (`→`)                   | `group-hover:translate-x-0.5`    | `rtl:group-hover:-translate-x-0.5`    |
| WidgetEditDialog visibility-switch thumb        | `translate-x-4` when checked     | `rtl:-translate-x-4`                  |
| MountainAccent SVG                              | natural orientation              | `rtl:-scale-x-100` (flips horizontally) |
| NavBellPopover footer "View all" arrow          | `<ArrowRight>` glyph             | `rtl:rotate-180`                      |

**No mirror needed:**

- Hero crest rotation — pure rotation, looks the same.
- Card hover lift (`-translate-y-1`) — vertical, direction-agnostic.
- ChevronRight inside cards is positioned with `end-5 top-5` — that already
  flips. The chevron itself faces right in both LTR and RTL because the
  arrow's *semantic* meaning ("next") follows reading direction; the
  positioning, not the glyph, does the work.

**Arabic numerals:** All numbers (G-IDs, leave-day counts, dates, big
numbers, badge counts) render as Western Arabic numerals (0-9) regardless
of `lang="ar"`. This is enforced by `font-variant-numeric: tabular-nums`
and the lack of any `lang="ar-u-nu-arab"` override.

**Date formatting:** `date-fns` with the `ar` locale renders month names in
Arabic when `i18n.language` starts with `ar`. See `formatStamp` /
`formatDate` in DashboardPage:1073-1087.

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
| `secondary`   | `border border-border bg-surface text-foreground`            | `bg-accent`                    | (no specific active)            | same                  |
| `outline`     | `border border-border bg-transparent text-foreground`        | `bg-accent`                    | (no specific active)            | same                  |
| `ghost`       | `text-muted-foreground`                                      | `bg-accent hover:text-foreground` | (no specific active)         | same                  |
| `destructive` | `bg-destructive text-destructive-foreground` (*see note*)    | `bg-destructive/90`            | (no specific active)            | same                  |
| `link`        | `text-primary underline-offset-4`                            | `underline`                    | (no underline change)           | same                  |

> **Wart:** `secondary`, `outline`, and `ghost` all hover to `bg-accent` —
> which is GSSG red. The intent here predates the Phase-17 color rebind;
> these variants should hover to `bg-surface-tinted`, not `bg-accent`. The
> Dashboard sidesteps this bug by not using these variants (EmptyState's
> secondary button only appears in empty states, where the red flash is
> rare).
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

The biggest pattern on the Dashboard. Every "card" (Hero excluded —
non-interactive) is a `<button type="button">` so the whole surface is the
click target.

**Surfaces using this pattern:** PendingDocumentsCard, WorkspaceCard,
WidgetCard (and its 7 variants), ServiceTile.

**Look (baseline):**

```
group relative w-full overflow-hidden rounded-2xl bg-surface p-5 text-start
```

- `group` — enables `group-hover:*` children (chevron nudge, dot scale, pill
  scale, emoji bob).
- `text-start` — first content line aligns to the reading-start edge in
  both LTR and RTL.
- `bg-surface` — except WorkspaceCard which overrides with a linear
  gradient (see §4.4) and ServiceTile which keeps `bg-surface` plus a
  navy top border.

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

**Disabled:** not used on the Dashboard. Cards either render or don't —
there's no "card-but-disabled" state. (Loading state replaces the big
number with `—` instead of disabling the click; the click is still useful
since it navigates.)

**Reduced motion:** `motion-reduce:!transform-none` would suppress the
lift; the dashboard does *not* annotate cards with this variant directly —
it relies on the global `.dash-anim` reduced-motion override and on
Tailwind's `transition-all` becoming inert when `prefers-reduced-motion` is
set (Tailwind doesn't actually suppress transition under reduced-motion;
this is a small inconsistency, flagged in §6).

---

### 2.3 Row-as-button

Section-card rows (OnLeaveRow, UpcomingRow, DocumentRow, LedgerRow) are
also `<button>`s, but use a quieter pattern than full cards.

**Look:**

```
flex w-full items-center gap-3 rounded-md px-2 py-2 text-start text-sm
cursor-pointer
```

- `rounded-md` (12px) — softer than cards.
- `px-2 py-2` — tight padding (rows are dense).
- `gap-3` — 12px between avatar/icon and name block.

**Hover:**

```
transition-colors
hover:bg-surface-tinted
```

- Background fades to `--surface-tinted`. No lift, no shadow, no scale.
- Inner elements (avatar bg, badge tone) don't change.

**Focus:**

```
focus-visible:outline-none
focus-visible:ring-2 focus-visible:ring-ring
focus-visible:ring-offset-1
```

Offset is 1px (the row sits inside a `bg-surface` SectionCard, not on the
page background).

**NavBellPopover row variant** adds `ring-inset` instead of `ring-offset`
because the row is full-width and an outset ring would clip on the dropdown
edge.

---

### 2.4 Inline button-link

Small text-only buttons that look like a link (text + optional icon, no
background, primary color).

**Surfaces using this pattern:**

- "Edit My Widgets" + "Edit Quick Actions" on the Dashboard (with `Pencil`
  icon).
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

Two flavours used on the Dashboard, both fully-rounded:

#### 2.5a Inset "Review" pill (PendingDocumentsCard)

This is a **decorative pill that visually reads as a button but isn't its
own button** — the entire card is the click target. The pill is
`aria-hidden` and shares the card's hover state via `group-hover`.

**Look:**

```
rounded-full bg-primary px-4 py-1.5
text-[0.78em] font-medium text-primary-foreground
shadow-sm
```

**Hover (driven by `group-hover` on the parent card):**

```
transition-all duration-200
group-hover:scale-105
group-hover:bg-primary-hover
group-hover:shadow-md
```

- Grows to 1.05× and brightens by one primary step.
- Shadow upgrades from `sm` to `md`.

**Reduced motion:**

```
motion-reduce:!transform-none motion-reduce:!shadow-sm
```

Pinned at scale-1 and shadow-sm; color still changes.

#### 2.5b Functional pill (LockOverlay Unlock, WidgetEditDialog Save/Cancel)

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
│ <header bg-surface border-b border-border px-8 py-3.5                       │
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
px-8 py-3.5
```

- Total height scales with `[data-font-scale]` — `py-3.5` (0.875rem each
  side) + the wordmark block's line-box determines it. Approximately
  64px at root 16px; ~76px at root 19px.
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
```

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

**`aria-label`:** `"Notifications, ${count} unread"` or `"Notifications"`.

#### NavBellPopover (panel)

```
absolute end-0 top-full z-50 mt-2 w-[380px]
overflow-hidden rounded-2xl
border border-hairline bg-surface
shadow-xl
```

- 380px wide, anchored to the inline-end of the bell.
- `shadow-xl` — heaviest shadow on the page; the panel needs to read
  clearly over arbitrary content beneath it.

**Header:**

```
flex items-center justify-between
border-b border-hairline px-4 py-3
  ├ <h3 text-sm font-semibold text-foreground>Notifications</h3>
  └ "Mark all read" button (§2.4 pattern) — hidden when count = 0
```

**Body (3 states):**

| State              | Render                                                        |
| ------------------ | ------------------------------------------------------------- |
| Loading            | 3 fake rows: animated `bg-border` rounds + bars, gap-2, py-6  |
| Empty              | `<EmptyState icon={Inbox}>` with i18n message, `py-10`        |
| Has items          | `<ul max-h-[360px] overflow-auto>` with row-as-button entries (§2.3) |

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
- `<Link to="/ledger">` styled like the inline-button-link pattern, with
  an `ArrowRight` icon. The arrow rotates 180° in RTL.

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
<button class="flex items-center gap-2 rounded-full p-0.5
               transition-colors hover:bg-surface-tinted">
  <Avatar h-9 w-9 bg-primary-soft text-primary ring-1 ring-border>
    [AvatarImage from identity.photo_url] OR
    [AvatarFallback (initials)]
  </Avatar>
</button>
```

#### Panel

```
absolute end-0 top-full z-50 mt-2 w-80
overflow-hidden rounded-2xl
border border-hairline bg-surface
shadow-xl
```

- 20rem wide (`w-80`) — scales with font-scale.
- `role="dialog"` + `aria-label="Account"`.

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
  ├ "Lock app"        — Lock icon + text
  └ "Email settings"  — Settings icon + text (only when onOpenSettings is passed)
```

Each action button:

```
flex w-full items-center gap-2.5
px-4 py-2.5
text-start text-[0.9em] text-foreground
transition-colors
hover:bg-surface-tinted
```

Icons: `h-4 w-4 text-muted-foreground` stroke 1.7. The icon doesn't shift
color on hover.

**Open/close:** Same `Escape` + outside-click pattern as NavBellPopover.

---

### 3.7 LockOverlay

**Sources:** `components/shell/LockOverlay.tsx`,
`components/shell/LockOverlay.css`, and `lib/useLockState.ts`.

Full-screen privacy lock rendered above all routes at `z-index: 100`. The
authenticated session remains valid behind the overlay; unlocking re-verifies
the signed-in user's password through `/auth/verify-password`.

**Automatic lock:**

- `useLockState(status === 'authed')` locks after 30 minutes without
  `pointerdown`, `keydown`, `wheel`, or `touchstart` activity.
- `gssg.lastActivity` lives in `localStorage` so idle time is shared across
  tabs and survives a window restart. Activity writes are throttled to 15
  seconds; the deadline is checked every 30 seconds and whenever a hidden tab
  becomes visible.
- `gssg.locked` remains in `sessionStorage` so an in-app reload stays locked.
  Unlock and fresh login both refresh the activity deadline.

**Frozen Desk visual language:**

- The actual application remains visible but unreadable beneath a dark
  `--hero-grad` scrim and 14px backdrop blur.
- A thin, tabular live clock is paired with Gregorian and Umm al-Qura Hijri
  dates. Arabic uses the same hierarchy in RTL; shift ranges are isolated with
  `<bdi dir="ltr">` so their chronological order never reverses.
- The unlock surface is centered on desktop and becomes a frosted bottom sheet
  at `≤760px`. It contains the linked employee photo/initial, localized welcome,
  pill password field, show/hide control, circular submit control, idle note,
  inline API error, and localized sign-out action.
- All animation is gated by `prefers-reduced-motion: no-preference`.

**Three operator-selectable layouts:**

1. **Command band** — clock above one horizontal operations rail, unlock below.
2. **Central stack** — the same hierarchy inside one large glass instrument
   panel.
3. **Briefing console** — clock and operational context share a compact
   two-column console, with unlock integrated beneath.

The compact A/B/C switcher sits at the bottom-inline-end and uses
`aria-pressed`. The validated preference is stored in
`localStorage['gssg.lockLayout']`; invalid or unavailable storage falls back to
Command band. On mobile the switcher moves immediately above the unlock sheet.

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

## 4. Dashboard page

### 4.1 Page shell

**Source:** `pages/dashboard/DashboardPage.tsx`.

```
<div class="flex flex-1 flex-col overflow-auto bg-background">
  <div class="mx-auto w-full max-w-[1180px] px-7 pb-12 pt-6">
    [Hero]
    [MyWidgets strap]   ← dash-anim, animationDelay 60ms
    [Top widget pair]   ← 2 dash-anims at 80ms / 120ms
    [Bottom widget row] ← N dash-anims at 160 + 40·i ms
    [QuickActions strap] ← dash-anim, 320ms
    [Quick-action tiles] ← N dash-anims at 340 + 20·i ms
    [On-leave + Upcoming pair] ← dash-anims at 460ms / 500ms
    [Recent docs + Recent ledger pair] ← dash-anims at 540ms / 580ms
  </div>
  [WidgetEditDialog × 2 (portal)]
  [Inline <style> with @keyframes]
</div>
```

- Max content width: 1180px.
- Background: `--bg`.
- Entrance animation: every direct child carries `.dash-anim` and a
  staggered `style={{ animationDelay: 'Nms' }}`. The animation itself is
  `dash-fade-up` (`opacity 0→1` + `translateY(8px → 0)`), 420ms,
  `cubic-bezier(0.16, 1, 0.3, 1)`.
- Reduced motion: `.dash-anim { animation: none }` under
  `prefers-reduced-motion: reduce` — surfaces appear without movement.

---

### 4.2 Hero

**Source:** `<DashboardHero>` inside `DashboardPage.tsx` (line 700).

**Anatomy:**

```
┌──────────────────────────────────────────────────────────────────┐
│ "Welcome back, Hamdan"                                  [🪯 crest] │
│ 12 documents · 3 returning this week                                │
│  (white-on-gradient)                            (rotates 90s)       │
└──────────────────────────────────────────────────────────────────┘
   h-[140px] rounded-2xl px-8
   background: var(--hero-grad)
```

**Container:**

```
dash-anim relative mb-6
flex h-[140px] items-center overflow-hidden
rounded-2xl px-8
style={{ background: 'var(--hero-grad)' }}
```

- 140px tall fixed (does NOT scale with font-scale — the headline does).
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

### 4.3 PendingDocumentsCard

**Source:** `<PendingDocumentsCard>` inside DashboardPage.tsx (line 776).

**Surface:**

```
button.group.relative.w-full.overflow-hidden
.rounded-2xl.bg-surface.p-5.text-start
.transition-all.duration-200
.hover:-translate-y-1.hover:shadow-lg
.focus-visible:outline-none.focus-visible:ring-2
.focus-visible:ring-ring.focus-visible:ring-offset-2
```

Standard card-as-button (§2.2).

**Content stack:**

```
1. Header                "Pending documents"
2. Big number            "AED  12"  ← currency prefix + count
3. Progress bar          accent fill, 5px tall
4. Footer row            • bullet + footnote  ◯ pill ("Review")
5. ChevronRight          absolute top-end corner
```

#### Header

```
text-[0.86em] font-medium text-muted-foreground
```

i18n key: `dashboard.pending.title`.

#### Big number

```
mt-2.5 text-[2.4em] font-bold leading-none tracking-tight
text-foreground tabular-nums
```

- Currency span inside: `me-1.5 text-[0.32em] font-medium
  text-muted-foreground align-middle`. That's `0.32 × 2.4em = 0.768em`
  worth of inherited size — feels like a tiny superscript prefix.
- When `isLoading`: shows literal `—` instead of the count.

#### Progress bar

```
<div aria-hidden
     class="my-3.5 h-[5px] overflow-hidden rounded-full bg-surface-tinted">
  <div class="h-full rounded-full bg-accent"
       style="width: {pct}%;
              animation: dash-pending-grow 1.4s ease-out,
                         dash-pending-pulse 3s ease-in-out infinite 1.4s;"/>
</div>
```

- Track: `bg-surface-tinted`, 5px tall.
- Fill: `bg-accent` (red), width = % of month elapsed
  (`(now.getDate() - 1) / daysInMonth * 100`).
- Animation chain:
  - `dash-pending-grow` — width `0% → {pct}%` over 1.4s ease-out (one-shot).
  - `dash-pending-pulse` — opacity `0.85 ↔ 1` over 3s ease-in-out, loops
    forever, delayed 1.4s so it starts after the grow finishes.
- The bar is a **decorative proxy for "month is N% elapsed"**, not a true
  completion percentage. Hidden from AT.
- Reduced motion: a (slightly hacky) selector `.dash-anim
  [style*="dash-pending-grow"] { animation: none !important; }` cancels
  both animations under `prefers-reduced-motion`.

#### Footer

```
flex items-center justify-between text-[0.78em] text-muted-foreground
  ├ flex items-center gap-1.5
  │   ├ <span h-1.5 w-1.5 rounded-full bg-accent aria-hidden/>
  │   └ footnote text (e.g. "12 documents this month")
  └ "Review" pill (decorative, see §2.5a)
```

#### ChevronRight

```
absolute end-5 top-5
h-3.5 w-3.5 text-faint
strokeWidth={1.8}
aria-hidden
```

- Sits 20px from the inline-end and top edges.
- `text-faint` (gray-blue) — quietly indicates "this card is clickable".

#### Hover composite

When the user hovers the card:
- Card lifts 4px + gains `shadow-lg`.
- Review pill scales 1.05× + brightens to `bg-primary-hover` + upgrades
  shadow to `shadow-md`.

#### Dark theme

- Surface flips to `#131826`.
- Header label, footnote, chevron all theme via tokens — no per-component
  overrides.
- Accent fill stays red but uses the dark `--accent` (`#ef4858`, slightly
  brighter to read on the dark surface).

#### Click

`onClick` writes `localStorage.setItem('gssg.books.filter', 'recent')` then
calls `onNavigate('books')`. The Books page reads the storage key to
preselect its "Recent" filter.

---

### 4.4 WorkspaceCard

**Source:** `<WorkspaceCard>` inside DashboardPage.tsx (line 875).

**Surface:**

```
button.group.relative.w-full.overflow-hidden
.rounded-2xl.p-5.text-start
.transition-all.duration-200
.hover:-translate-y-1.hover:shadow-lg
.focus-visible:* (same as §2.2)
style={{ background:
  'linear-gradient(140deg, var(--surface) 0%,
                            var(--surface) 55%,
                            var(--surface-tinted) 100%)' }}
```

- Same shape as PendingDocumentsCard, but the background is a **diagonal
  linear-gradient**, not flat `bg-surface`. The bottom-end corner fades
  toward the tinted shade — emphasizes the MountainAccent that sits there.

**Content stack:**

```
1. Header              "My workspace"
2. Big number          "STAFF  47"
3. Status row          🟢 Active 41   🟡 On leave 6
4. MountainAccent      absolute bottom-end (decorative SVG)
5. ChevronRight        absolute top-end
```

#### Header / Big number

Identical to PendingDocumentsCard (see §4.3). The "currency" prefix span
is the `"STAFF"` label instead of `"AED"`.

#### Status row

```
mt-3.5 flex gap-4 text-[0.78em] text-muted-foreground
  ├ "Active N"   — dash-active-dot bg-success
  └ "On leave N" — bg-warning
```

Each entry:

```
flex items-center gap-1.5
<span h-1.5 w-1.5 rounded-full bg-{success|warning}/>
[label with count from i18n]
```

#### Active dot animation

Only the **success** dot animates ("Active"). The on-leave dot is static.

```
.dash-active-dot {
  animation:
    dash-active-glow 2.8s ease-out infinite,
    dash-active-blink 2.8s ease-in-out infinite;
}
@keyframes dash-active-glow {
  0%   { box-shadow: 0 0 0 0 currentColor; }
  100% { box-shadow: 0 0 0 6px transparent; }
}
@keyframes dash-active-blink {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.6; }
}
```

- Two layered animations running at the same period (2.8s).
- `dash-active-glow` creates a 6px halo that fades out (note the `0 0 0 0
  currentColor → 0 0 0 6px transparent` transition — `currentColor` is
  green here because the dot also has `text-success`).
- `dash-active-blink` dims the dot to 60% opacity at the halfway point.
- Reduced motion: both suppressed.

#### MountainAccent

`absolute bottom-0 end-0 h-[80px] w-[160px]` — 160×80px SVG anchored to
the bottom-end corner. The SVG itself is a stylised 7-vertex mountain
silhouette filled with `var(--mountain)` and outlined with `var(--primary)`
at 40% opacity. In RTL, the whole SVG flips horizontally
(`rtl:-scale-x-100`) so the rising slope still faces "outward" relative
to the reading direction.

#### Click

`onNavigate('employees')`.

---

### 4.5 WidgetCard (base) + 7 variants

**Source:** `components/ui/widget-card.tsx`.

Shared widget surface used by the 3-up "bottom row" on the Dashboard.
Three of the variants (Violations / Drafts / Ledger) construct the
WidgetCard inline inside `DashboardPage`. The other four wrap it in their
own components under `components/dashboard/widgets/`.

#### Base surface

```
button.group.relative.flex.h-full.min-h-[280px].w-full.flex-col
.rounded-2xl.bg-surface.p-5.text-start
.transition-all.duration-200
.hover:-translate-y-1.hover:shadow-lg
.focus-visible:outline-none.focus-visible:ring-2.focus-visible:ring-ring
.focus-visible:ring-offset-2
```

- Same card-as-button base as §2.2.
- `min-h-[280px]` guarantees a consistent 3-up row height even when one
  widget has empty breakdown rows.

#### Anatomy

```
┌─────────────────────────────────────────────┐
│ Header label                  [Delta pill]   │  min-h-[28px] items-center justify-between
│                                              │
│ 42                                           │  text-[2.4em] font-bold tabular-nums
│                                              │
│ ─────────────────────────────────────        │  border-t border-hairline (only when breakdown.length > 0)
│ ● Active           5                          │  text-[0.78em] muted-foreground
│ ● Escalated        3                          │
│ ● Pending close    2                          │
│                                              │
│ Updated · 12 latest          Go to view  →   │  mt-auto pt-3.5 text-[0.78em]
└─────────────────────────────────────────────┘
```

#### Header row

```
flex min-h-[28px] items-center justify-between gap-3
  ├ <span text-[0.86em] font-medium leading-tight text-muted-foreground>
  │   {header}
  │ </span>
  └ Delta pill (optional)
```

- `min-h-[28px]` keeps the row's vertical center stable across cards even
  when the delta pill changes height between variants.

#### Delta pill

```
inline-flex items-center rounded-full
px-2.5 py-1 text-[0.72em] font-semibold leading-none
+ DELTA_CLS[tone]
```

Three tones (`DeltaTone`):

| Tone     | Classes                                       | Light                         | Dark                           |
| -------- | --------------------------------------------- | ----------------------------- | ------------------------------ |
| `good`   | `bg-success-soft text-success`                | pale green / forest green     | deep green / emerald           |
| `warn`   | `bg-accent-soft text-accent`                  | pale red / GSSG red           | deep red / bright red          |
| `steady` | `bg-surface-tinted text-muted-foreground`     | cream tint / dark gray        | navy tint / cool gray          |

#### Big number

```
mt-1.5 text-[2.4em] font-bold leading-none tracking-tight
text-foreground tabular-nums
```

Same scale as §4.3/§4.4 big numbers — the 280px-min-height widget row
keeps the trio visually aligned.

#### Breakdown rows

```
mt-3 flex flex-col gap-1 border-t border-hairline pt-3
text-[0.78em] text-muted-foreground
  └ for each row:
     flex items-center gap-1.5
     ├ <span h-1.5 w-1.5 rounded-full bg-{color}/>
     ├ <span>{label}</span>
     └ <span ms-auto font-mono font-semibold text-foreground>{value}</span>
```

Four `BreakdownColor` choices — `primary` / `accent` / `success` /
`warning` — applied to the leading 6×6px dot. Theme follows token system.

#### Footer / action row

```
mt-auto flex items-center justify-between gap-2 pt-3.5 text-[0.78em]
  ├ meta line (optional): text-[0.72em] text-muted-foreground
  └ Action: ms-auto inline-flex items-center gap-1
            font-semibold text-primary
            transition-colors duration-200
            group-hover:text-primary-hover
            <span aria-hidden
                  ltr:group-hover:translate-x-0.5
                  rtl:group-hover:-translate-x-0.5
                  motion-reduce:!transform-none>→</span>
```

- Arrow is a literal `→` glyph (Unicode `U+2192`). Doesn't rotate in RTL —
  the `rtl:group-hover:-translate-x-0.5` flips the horizontal nudge
  direction so the arrow still moves "toward the end" of the reading line.
  The glyph itself is bidi-neutral.
- `motion-reduce:!transform-none` pins it.

#### Variant matrix

| Variant            | Source                                        | Big number                          | Delta logic                                                              | Breakdown                                            | Meta line                            | Action                                                |
| ------------------ | --------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------- | ------------------------------------ | ----------------------------------------------------- |
| `violations`       | inline in DashboardPage                       | `0` (placeholder until backend)     | always `steady` "Steady"                                                 | Active (accent), Escalated (warning), Pending close (success), all 0 | —                                    | "Go to employees" → `employees`                       |
| `drafts`           | inline in DashboardPage                       | `0` (placeholder until backend)     | always `steady` "No drafts"                                              | Promotion (primary), Leave (success), Violation (accent), all 0 | —                                    | "Go to ledger" → `ledger`                             |
| `ledger`           | inline in DashboardPage                       | sum of incoming+outgoing+internal from `recent_ledger` | `warn` when incoming>0 (parameterized count), else `steady` | Incoming (success), Outgoing (accent), Internal (primary)            | "{count} latest"                     | "Go to ledger" → `ledger`                             |
| `on_leave_today`   | `OnLeaveTodayWidget.tsx`                      | `summary.totals.on_leave_today`     | `warn` when > 5 ("High coverage gap"), else `steady` ("Normal")          | Top 3 leave types (rotating dot colors: primary, accent, success) | —                                    | "Go to leaves" → `leaves`                             |
| `upcoming_leave`   | `UpcomingLeaveWidget.tsx`                     | total upcoming leaves               | `warn` when returningTomorrow > 0 ("Returning soon"), else `steady`      | Returning tomorrow (accent), This week (primary)     | —                                    | "Go to leaves" → `leaves`                             |
| `recent_docs`      | `RecentDocsWidget.tsx`                        | `summary.totals.forms_this_month`   | `steady` (label changes: "Active this month" if total>0 else "Idle")     | Top 3 template_ids prettified (rotating colors)      | "{count} recent"                     | "Go to books" → `books`                               |
| `email_sync_status` | `EmailSyncStatusWidget.tsx`                  | `email_sync.incoming_today`         | `warn` "Off" if disabled, `steady` "Live" if last sync <5min, else `steady` "Synced" | Last sync (primary), Interval (accent), Status (success when enabled / warning when off) | —                                    | "Sync now" (when enabled) → fires mutation, or "Configure" → `ledger` |

#### States

| State        | Look                                                                          |
| ------------ | ----------------------------------------------------------------------------- |
| Default      | flat, no shadow                                                               |
| Hover        | `-translate-y-1` + `shadow-lg`; action arrow nudges 0.125rem toward end       |
| Focus        | navy ring (ring-2 ring-primary ring-offset-2 vs `--bg`)                       |
| Loading      | variants render `0` or `—`; no spinner. Cards are still clickable.            |
| Empty data   | breakdown rows render with `0` values; the separator line still appears       |

#### a11y

- The whole card is one `<button>` → one tab stop.
- Header + action label are read sequentially by AT.
- Delta pill is plain text — no role, no aria.
- Dot SVGs are `aria-hidden`.

#### RTL

- All `me-/ms-` and `start-/end-` logical utilities handle direction.
- Arrow glyph nudge inverts via the `rtl:` variant.
- Breakdown value (`ms-auto`) sits at the inline-end.

---

### 4.6 ServiceTile (Quick Action)

**Source:** `components/ui/service-tile.tsx`.

Used by the 4-up quick-action row (max 8 visible → wraps to 2 rows).

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
1. Emoji         text-[2em] leading-none, aria-hidden
                 group-hover:-translate-y-1.5  (0.375rem bob upward)
                 transition-transform duration-300
2. Title         mt-3 text-[0.95em] font-semibold tracking-tight text-foreground
3. Description   mt-1 text-[0.72em] leading-relaxed text-muted-foreground
```

- Emoji is the variant's icon (defined in `lib/quickActions.ts` —
  📄 / 🌴 / ⚠️ / 📚 / etc.).
- Title and description come from `dashboard.quickActionLabels.*` /
  `dashboard.quickActionDesc.*` i18n keys.

**Hover composite:**

- Card lifts 4px + `shadow-lg`.
- Emoji bobs upward 0.375rem over 300ms (slower than the card lift's 200ms
  — the emoji visibly settles after the card).

**RTL:** No physical-direction utilities used. The whole tile flips
naturally with `dir="rtl"`.

**Empty state:** When `visibleQuickActions.length === 0`:

```
mb-8 rounded-2xl border border-dashed border-hairline
bg-surface px-5 py-8 text-center
  └ <p text-[0.86em] text-muted-foreground>{quickActionsEmpty}</p>
```

— a dashed-outline card with centered hint text.

---

### 4.7 SectionCard

**Source:** `<SectionCard>` inside DashboardPage.tsx (line 951).

Used for the four "preserved-from-Phase-12, restyled" sections at the
bottom of the dashboard: On Leave Today · Returning soon · Recent
documents · Recent ledger.

**Surface:**

```
<section class="rounded-2xl bg-surface">
  <div class="flex items-center justify-between
              border-b border-hairline px-5 py-3.5">
    [Icon + Title]
    [optional Badge — pill, neutral]
  </div>
  <div class="px-3 py-2">
    {children}
  </div>
</section>
```

- Card radius `rounded-2xl`, no hover state (the *rows inside* are the
  interactive surfaces — the section card itself is structural).
- Header has its own `border-b border-hairline` separating title from body.

**Header:**

```
<Icon h-4 w-4 text-muted-foreground strokeWidth={1.6} aria-hidden/>
<h3 text-sm font-semibold text-foreground>{title}</h3>
```

Lucide icon stroked at 1.6 (thinner than the 1.8 used elsewhere — softer
because it sits next to a heading).

**Count badge:**

```
<Badge shape="pill" tone="neutral">{count}</Badge>
```

Only renders when `count > 0`. See `Badge` neutral tone in §1.1.8.

**Body container:**

`px-3 py-2` — 12px horizontal, 8px vertical padding around the row list.

**Loading state:** delegates to `<PanelSkeleton>`:

```
flex flex-col gap-2 p-2
  └ 3 placeholder rows:
     flex items-center gap-3 px-2 py-2
     ├ Skeleton h-8 w-8 rounded-full
     └ Skeleton h-3 w-1/2 + Skeleton h-2.5 w-1/3 (stacked, gap-1.5)
```

**Empty state:** delegates to `<EmptyState icon={...} message={...}/>`
(see `components/ui/empty-state.tsx`).

---

### 4.8 Row variants

All four row variants share the row-as-button base from §2.3:

```
flex w-full items-center gap-3 rounded-md px-2 py-2 text-start text-sm
transition-colors
hover:bg-surface-tinted
focus-visible:* (ring-offset-1)
cursor-pointer
```

They differ in the **leading visual** and the **trailing metadata**.

#### 4.8a OnLeaveRow

```
[Avatar h-8 w-8 bg-primary-soft text-primary, initials fallback]
  Name (font-medium text-foreground)
  G-id (font-mono text-xs text-muted-foreground)
[trailing column, items-end gap-1]
  <Badge shape="square" tone="info">{leave_type}</Badge>
  "until 2026-06-04" (font-mono text-xs text-muted-foreground)
```

Badge tone `info` → `bg-blue-50 text-blue-700` (hard-coded Tailwind palette
per §1.1.8 — doesn't theme).

#### 4.8b UpcomingRow

Same shape as OnLeaveRow, but:

- The badge tone is `warning` when `days_remaining <= 1`, else `neutral`.
- The trailing line is the localized "Ends today" / "Ends tomorrow" /
  "Ends in N days" string.

`warning` tone: `bg-amber-50 text-amber-700` — hard-coded, doesn't theme.
`neutral` tone: `bg-muted text-muted-foreground` (also a token-gap per
§1.1.8).

#### 4.8c DocumentRow

```
[Icon block h-8 w-8 rounded-md bg-primary-soft text-primary,
   contains FileText h-3.5 w-3.5 strokeWidth=1.8]
  Title line (truncate, font-medium text-foreground):
    [if ref_number] <span font-mono text-primary>{ref_number}</span>
                   <span mx-1.5 text-muted-foreground>·</span>
                   {template_id}
    [else]         {template_id}
  Employee name (truncate text-xs text-muted-foreground)
[trailing column]
  Timestamp (font-mono text-xs text-muted-foreground)
  Format: "dd MMM HH:mm" via date-fns + arabic locale when AR
```

- Leading element is a *square* tinted block holding the file icon — not
  a round avatar. Same color scheme (`bg-primary-soft text-primary`)
  signals "internal artifact" rather than "person".

#### 4.8d LedgerRow

```
[Square block h-8 w-8 rounded-md bg-surface-tinted,
   contains a 10×10px colored dot:
     incoming → bg-success
     outgoing → bg-accent
     internal → bg-primary]
  Subject (truncate font-medium text-foreground)
  Counterparty (truncate text-xs text-muted-foreground)
[trailing]
  Entry date (font-mono text-xs text-muted-foreground)
  Format: "dd MMM yyyy"
```

- Leading element is a *tinted square* with a small colored dot inside —
  the dot color encodes the direction (matches the WidgetCard ledger
  breakdown colors exactly).

#### Click handling (all rows)

Every row calls `openItem(target, id)` which `navigate`s to
`/{target}?open={id}`. The destination page reads `?open=` on mount and
auto-opens the detail drawer (or scrolls to the row). When a destination
doesn't support per-item opening the query param is silently ignored.

---

### 4.9 Edit dialogs (WidgetEditDialog)

**Source:** `components/dashboard/WidgetEditDialog.tsx`.

One generic dialog drives both "Edit My Widgets" and "Edit Quick Actions"
flows. Built on Radix `<Dialog>` so it gets focus trapping, Escape close,
and overlay click-to-dismiss for free.

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
       ├ Cancel (outline pill, §2.5b)
       └ Save   (primary pill, §2.5b; shows Loader2 spinner when isSaving)
```

**Save behavior:**

- Clamps visibility to `maxVisible` before persisting (belt-and-braces
  guard — the dialog also blocks the off→on toggle once the cap is hit).
- For the widgets dialog, `Save` merges the dialog's bottom-row draft
  back onto the top-row pair (which is *never* edited in this dialog —
  PendingDocuments + Workspace are locked).
- For the quick-actions dialog, the merge is trivial (no locked items).

**Open/close behavior:**

- Each dialog mounts its `<DialogBody>` only when `open === true`, so the
  local draft state is fresh on every open. Avoids a `useEffect` to sync
  props → state.
- Outside-click / Escape / overlay-click all close.

---

## 5. Animation appendix

Every named animation on the Dashboard and chrome.

| Keyframe                  | Where (selector)                                                  | Property animated            | Duration | Easing                   | Iterations | Reduced-motion handling                                          |
| ------------------------- | ----------------------------------------------------------------- | ---------------------------- | -------- | ------------------------ | ---------- | ---------------------------------------------------------------- |
| `dash-fade-up`            | `.dash-anim` (every direct child of dashboard shell + hero)       | opacity 0→1 + translateY 8→0 | `0.42s`  | `cubic-bezier(.16,1,.3,1)` | once (`both`) | `.dash-anim { animation: none }` under `prefers-reduced-motion` |
| `gssg-crest-spin`         | `.dashboard-crest` (Hero crest img)                               | rotate 0→360deg              | `90s`    | `linear`                 | infinite   | rotation cancelled                                               |
| `dash-pending-grow`       | inline style on PendingDocumentsCard progress fill                | width 0%→{pct}%              | `1.4s`   | `ease-out`               | once       | both animations cancelled via attribute-selector override        |
| `dash-pending-pulse`      | same (delayed `1.4s` so it follows the grow)                      | opacity 0.85↔1               | `3s`     | `ease-in-out`            | infinite   | as above                                                         |
| `dash-active-glow`        | `.dash-active-dot` (WorkspaceCard "Active" dot)                   | box-shadow ring 0px→6px transparent | `2.8s`   | `ease-out`               | infinite   | both animations cancelled                                        |
| `dash-active-blink`       | same                                                              | opacity 1↔0.6                 | `2.8s`   | `ease-in-out`            | infinite   | as above                                                         |
| `theme-switch-sun-rotate` | `.theme-switch-sun svg`                                           | rotate 0→360deg              | `15s`    | `linear`                 | infinite   | `animation: none !important` under reduced-motion                |
| `theme-switch-moon-tilt`  | `.theme-switch-moon svg`                                          | rotate 0→-10°→+10°→0          | `5s`    | `linear`                 | infinite   | as above                                                         |
| (thumb slide)             | `.theme-switch .theme-switch-slider::before`                      | transform translateX 0↔26px  | `0.4s`   | default (ease)           | once per toggle | `transition: none !important` under reduced-motion              |
| (sun↔moon track bg)       | `.theme-switch .theme-switch-slider`                              | background-color             | `0.3s`   | default                  | once per toggle | not overridden (color change is harmless under reduced-motion)  |
| (slider thumb hover)      | `.aa-slider::-webkit-slider-thumb`                                | transform scale 1→1.2        | `0.15s`  | default                  | once per hover  | not overridden                                                  |
| Card hover lift           | Tailwind `transition-all duration-200` on card-as-button surfaces | translateY 0→-4px + shadow change | `200ms` | default                  | once per hover  | `motion-reduce:!transform-none` advised but not always applied — see §6 |
| Arrow nudge               | WidgetCard action `→` glyph                                       | translateX 0↔2px              | `200ms`  | default                  | once per hover  | `motion-reduce:!transform-none`                                  |
| Service emoji bob         | `.group-hover:-translate-y-1.5` on emoji                          | translateY 0→-6px             | `300ms`  | default                  | once per hover  | `motion-reduce:!transform-none` not applied — known gap          |
| TopNav link micro-lift    | `.hover:-translate-y-0.5` on inactive NavLinks                    | translateY 0→-2px             | `200ms`  | default                  | once per hover  | `motion-reduce:!transform-none` applied                          |
| Logo scale-up             | `.hover:scale-[1.02]` on TopNav logo                              | scale 1→1.02                  | `200ms`  | default                  | once per hover  | not overridden                                                   |
| Skeleton pulse            | Tailwind `animate-pulse` on Skeleton                              | opacity 1↔0.5                 | `2s`     | cubic-bezier(.4,0,.6,1)  | infinite        | Tailwind suppresses under reduced-motion                         |
| Smart-link chip hover     | `[data-smart-link='*']:hover` background-color shift              | background-color              | `120ms`  | default                  | once per hover  | not overridden (subtle color shift)                              |

**Stagger schedule for the entrance animation (`dash-fade-up`):**

| Element                                          | `animationDelay` |
| ------------------------------------------------ | ---------------- |
| Hero                                             | `0ms`            |
| "My Widgets" strap                               | `60ms`           |
| PendingDocumentsCard                             | `80ms`           |
| WorkspaceCard                                    | `120ms`          |
| Bottom widget #1                                 | `160ms`          |
| Bottom widget #2                                 | `200ms`          |
| Bottom widget #3                                 | `240ms`          |
| "Quick Actions" strap                            | `320ms`          |
| Quick-action tile #1                             | `340ms`          |
| Quick-action tile #2                             | `360ms`          |
| Quick-action tile #3                             | `380ms`          |
| Quick-action tile #4                             | `400ms`          |
| Quick-action tile #5..N (each)                   | `+20ms`          |
| Empty-quick-actions card (if shown)              | `340ms`          |
| On Leave Today card                              | `460ms`          |
| Returning soon card                              | `500ms`          |
| Recent docs card                                 | `540ms`          |
| Recent ledger card                               | `580ms`          |

Total wall-clock: from page open to last card settled ≈ **1000ms** (the
580ms last delay + 420ms animation length). Feels brisk, not slow.

---

## 6. Not yet documented

Things observed in the code that this first pass intentionally doesn't
cover. Add to this list as you discover more — and remove items as they're
documented.

### Out of scope for this pass

- **Mobile / narrow-viewport behavior.** The dashboard's grids drop to
  `grid-cols-1` below the `md` breakpoint (768px), but the TopNav and
  Hero have no narrow-viewport adaptations. Behavior at <768px is
  unspecified — confirm with operator whether mobile is supported before
  documenting.
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
  the WidgetCard delta pills already do this.
- shadcn Button `secondary` / `outline` / `ghost` variants hover to
  `bg-accent` (GSSG red) which is almost certainly a bug. Should hover
  to `bg-surface-tinted`.
- shadcn Button `destructive` variant references `bg-destructive` and
  `text-destructive-foreground` which **don't exist in @theme inline** —
  the variant is effectively unstyled. Either delete the variant or wire
  it to `--accent` / `--accent-soft`.
- Reduced-motion: card hover lifts (`hover:-translate-y-1`) on
  Dashboard cards don't carry `motion-reduce:!transform-none`. The
  ServiceTile emoji bob is also unmarked. Add the variant for full
  parity with the rest of the page.

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
- The placeholder "0" rendering for Violations / Drafts WidgetCards is
  intentional (per source comment) until a dedicated backend summary
  endpoint lands. Worth flagging in the variant matrix as "placeholder"
  rather than "live data".
