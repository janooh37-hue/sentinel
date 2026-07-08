# Refresh Experience — Design Spec

**Date:** 2026-07-08
**App:** GSSG Manager (installed PWA, `display: standalone`, Edge/Chrome; Android phone + desktop)
**Stack:** React 19 + Vite + TS + Tailwind 4, React Query v5, bilingual AR/EN + RTL
**Mockups (approved):** `docs/pull-to-refresh-mockup.html` (phone), `docs/pull-to-refresh-desktop-mockup.html` (desktop)

---

## 1. Summary & intent

Give the app a first-class "refresh" experience that feels native and premium on both surfaces, and always refreshes **everything** (all active data), not just the current page.

- **Phone (touch):** an iOS-Safari-quality **pull-to-refresh** — deliberate, hard to trigger by accident, with a ring indicator and a satisfying physical feel.
- **Desktop (installed webapp):** the app **auto-refreshes itself** (on focus, on reconnect, on a periodic heartbeat). There is no pull gesture. A **manual button + `Alt+R`** are quiet fallbacks.
- **Shared feel:** every refresh shows a **thin top progress bar** (default, always on — snappy fill-and-dissolve on fast fetches, indeterminate sweep on slow ones), and the data underneath settles with a **calm "change-pulse"**: only the **new/changed** rows and values highlight; unchanged content stays perfectly still.

Guiding principle (from the motion design): **spend the motion on the _change_, not the fetch.** A highlight always means something actually changed, so users learn to trust it. The top progress bar is the one always-on signal that a refresh ran.

---

## 2. Scope & phasing

One cohesive feature, delivered in two milestones so it can land incrementally.

**Milestone A — Refresh engine + feel (the mechanism):**
- Global "refresh everything" helper + React Query cadence changes.
- Shared **TopProgressBar** (default-on signal, both surfaces).
- Phone **PullToRefresh** gesture + ring indicator.
- Desktop triggers (focus / reconnect / heartbeat) + fallbacks (button, `Alt+R`, `F5`/`Ctrl+R` intercept).

**Milestone B — Delta highlight (the settle):**
- Reusable **change-pulse** primitive: new-row entrance, changed-row tint pulse, in-place value crossfade.
- **"N new" pill** when new rows arrive while scrolled down.
- Initial adoption on the highest-value lists (Records/Books list, Dashboard KPIs, Leaves), then rolled out.

Milestone A is independently shippable and delivers most of the perceived value. Milestone B is the polish layer and is more invasive (touches individual list/row components), so it adopts surface-by-surface.

---

## 3. Codebase grounding (from exploration)

- **App shell** (`frontend/src/App.tsx`): `<div class="flex h-screen flex-col">` → `<main id="main-content" class="flex flex-1 overflow-hidden">` with `key={location.pathname}` (pages remount on nav). **`<main>` is `overflow-hidden`; each page scrolls its own inner container.** ⇒ pull-to-refresh attaches to the **page scroll container**, not `window` — via a reusable wrapper pages opt into.
- **React Query** (`App.tsx` ~L72): `retry:1`, `refetchOnWindowFocus:false`, `staleTime:60_000`, `gcTime:300_000`. Invalidation is scoped per-feature (`invalidateQueries(['books'])`); **no global refresh exists yet.**
- **PWA:** `public/manifest.webmanifest` `display:standalone`; custom `public/sw.js` (push + deep-link only, no cache strategies); **no `overscroll-behavior` CSS set** (native pull is available to suppress).
- **No gesture/animation lib** (no framer-motion). Physics + springs are hand-rolled with pointer/touch events + rAF.
- **i18n/RTL** (`lib/i18n.ts`): sets `<html dir="rtl">` for `ar`; Tailwind logical props (`ms-`/`me-`, `text-start/end`) auto-flip. Locale strings in `locales/{en,ar}.json`.
- **Two detail surfaces** for several record types (desktop inline report/RecordExpansion vs mobile modal TabRecords) — any per-surface behavior must consider both.

---

## 4. Milestone A — the refresh engine & feel

### 4.1 Global refresh — "everything"

New helper `frontend/src/lib/globalRefresh.ts`:

- `refreshAll(queryClient): Promise<void>` — calls `queryClient.invalidateQueries()` (all active queries; `refetchType: 'active'`), awaits `Promise.allSettled` of the triggered refetches.
- Enforces a **500 ms minimum** visible duration (even if refetch resolves in 40 ms — an instant blink reads as broken) and an **8 s ceiling** (resolve the indicator regardless; queries keep fetching in the background).
- Exposes an **`isRefreshing` signal** (React Query `useIsFetching()` is the natural source, wrapped with the min/ceiling timing) so the TopProgressBar and phone ring can subscribe.
- Guard: **skip auto-invalidation while the user is editing** — a global `isEditing` flag (set by any dirty react-hook-form in an open dialog/drawer). Manual refresh still works; auto triggers are suppressed. Applies to **both** detail surfaces.

### 4.2 React Query cadence (desktop auto-refresh) — `App.tsx`

| Setting | Value | Rationale |
|---|---|---|
| `refetchOnWindowFocus` | `true` | Return to the app ⇒ silently fresh. Highest-value desktop trigger. |
| `staleTime` (list/dashboard) | `15_000` | Gate focus-refetch: Alt-Tab flurries to Word/Outlook won't cause refetch storms / pulse-spam. |
| `refetchOnReconnect` | `'always'` | After a network gap, data age is unknown → refetch unconditionally. |
| Heartbeat | one 60 s timer → `refreshAll()` (active only) | Synchronized single commit, not per-query intervals (composed, not twitchy). `refetchIntervalInBackground:false` — never poll a hidden window. |
| Heavy/rare queries (settings, templates, employee profiles) | interval off; `staleTime` 5 min | Don't poll what doesn't churn. |

The 60 s heartbeat is one hook mounted at the shell (`useRefreshHeartbeat`), pausing when `document.hidden` or `isEditing`.

*Phase-2 upgrade (not in this spec):* drive invalidation from the existing SSE channel → near-instant freshness, relax polling to 3–5 min.

### 4.3 Shared TopProgressBar (default-on signal)

Component `frontend/src/components/refresh/TopProgressBar.tsx`, mounted once at the shell, pinned to the top edge of the content pane (below TopNav), `z` above content, `pointer-events:none`. Height **2 px**. Color `--primary` (navy), **never** the alert red `--accent`.

Behavior whenever a global refresh is in flight (this is the **default on every refresh**, the snappy feel the user asked for):

- **Enter:** opacity 0→1, 120 ms.
- **Fast path (typical LAN, resolves quickly):** a quick determinate-style fill to 100%, then **complete + dissolve** (fill accelerates to end 240 ms ease-in, hold one frame at full, fade out 300 ms). Minimum visible ~**450 ms** so the snap is perceptible but crisp.
- **Slow path (still fetching after ~500 ms):** switch to an **indeterminate sweep** — a ~30 %-wide segment (`transparent → --primary 85% → transparent`) traversing inline-start → inline-end, 900 ms `cubic-bezier(0.45,0,0.55,1)`, looping; on resolve, run the complete + dissolve beat.
- A faint rail (`--hairline` @ 50 %) sits under the sweep.
- **RTL:** sweep travels inline-start → inline-end (right→left in Arabic); flip via logical transform, never hardcoded `left`.
- **Reduced motion:** static 2 px line at 60 % opacity, opacity-only fade in/out; no traveling segment.

### 4.4 Phone pull-to-refresh gesture

Component `frontend/src/components/refresh/PullToRefresh.tsx` — wraps a page's scroll container; pages opt in. Enabled only on touch (`matchMedia('(pointer: coarse)')` + touch support). **Not** used inside drawers/dialogs/bottom-sheets (there, pulling down means dismiss). Escape hatch: `data-ptr-ignore` on regions owning their own gestures (horizontal scrollers, rich editor, signature pad, PDF viewer).

**State machine:** `idle → pulling → armed ⇄ pulling → refreshing → done → idle` (plus `cancelled`).

**Physics / thresholds (final numbers):**

| Param | Value | Purpose |
|---|---|---|
| Dead zone | **24 px** raw | first 24 px move nothing — surface feels solid |
| Rubber band | `offset(x) = (c·x·H)/(H + c·x)`, **c = 0.42**, `H = min(vh, 640)` | iOS-style stiffening resistance |
| Render clamp | **160 px** visual | |
| Arm threshold | **112 px** visual (~170 px real travel) | deliberate, ~2× iOS default |
| Disarm hysteresis | **96 px** visual | no flicker at the boundary |
| Hold-to-arm | **120 ms** continuous ≥ threshold | kills fast flicks that whip past |
| Rest-at-top | **≥ 250 ms** at `scrollTop === 0` before a pull can start | kills fling-into-top + habitual next swipe |
| Refreshing rest height | **56 px** | where content settles while spinner runs |

**Anti-accidental-trigger stack (defense in depth):** rest-at-top gate · 24 px dead zone · direction lock in first 12 px (vertical cone `dy > 2·|dx|`, else reject) · deep 112 px threshold · 120 ms hold-to-arm · release-while-armed required · multi-touch cancel (2nd finger aborts) · keyboard-open suppression (`visualViewport.height < 0.8·innerHeight`) · `overscroll-behavior-y: contain` on the scroller.

**Release:**
- from `armed` → `refreshing`: spring settle to 56 px, **stiffness 260 / damping 26 / mass 1** (one ~4 px overshoot — the premium beat). Then `refreshAll()`.
- from `pulling` (below threshold) → `cancelled`: snap to 0, 280 ms `cubic-bezier(0.33,1,0.68,1)`, no overshoot.
- Interruptible: touching down mid-snap yields to the finger at the current offset.

**Ring indicator (Direction A — approved):** 28 px circle, 2 px stroke, in the revealed band.
- **Pulling:** arc draws 0°→270° proportional to `offset/112`, glyph fades+scales in (complete by 40 px offset).
- **Armed:** arc completes to 360°, color snaps to `--primary`, one 15° tick + scale pop (1→1.08→1), **haptic `vibrate(10)`**.
- **Disarm:** quick reverse, **`vibrate(5)`**.
- **Refreshing:** ring opens to 270° arc, rotates indeterminate 900 ms/turn, clockwise in both LTR **and RTL**.
- **Done:** arc morphs to a checkmark (200 ms), holds 200 ms, band collapses 250 ms, **`vibrate(12)`**.
- Haptics via `navigator.vibrate` (no-op on iOS — fine), feature-detected + try/catch. None during pulling/refreshing.

The TopProgressBar (§4.3) also runs during the `refreshing` phase, unifying the feel with desktop.

### 4.5 Desktop fallbacks

- **Ghost refresh button:** 16 px refresh glyph, `--text-faint`, no border/fill until hover, at the **inline-end of the page-content header** (logical positioning ⇒ left in Arabic). Not in TopNav (that scopes to "the app"; header scopes to "this data"). On click: glyph rotates 360° once (500 ms) + `refreshAll()` + a full-page **"veil breath"** feedback (pane dips to opacity 0.85 + `saturate(0.92)`, min hold 300 ms, restores 250 ms with a `scale(0.998→1)` settle). Manual refresh is the one moment a whole-page acknowledgment is warranted — the user asked, the app visibly obeys. Change-pulses still play on commit.
- **Keyboard:** **`Alt+R`** (match `event.code === 'KeyR' && altKey` — layout-independent, works on the Arabic keyboard; unclaimed; safe while typing). **Intercept `F5` and `Ctrl+R`** in the standalone window (`preventDefault` → soft `refreshAll()`) so reload muscle-memory no longer hard-reloads and nukes state. **`Ctrl+Shift+R`** stays the native hard-reload escape hatch (also the "get new app version" path).
- Tooltip on the button: `Refresh · Alt+R` / `تحديث · Alt+R`, second line `Updated Nm ago` in faint text (data age lives here **only** — no persistent freshness chip anywhere).

---

## 5. Milestone B — the delta highlight (settle)

Applied to opted-in list surfaces. Requires **stable keys** (record IDs, never indices) + `React.memo` on row components + React Query structural sharing (unchanged rows keep object identity ⇒ never re-render ⇒ cannot flicker — 80 % of "premium," and free).

**The highlight always lands on the NEW / changed content, never the old** (explicit user requirement):

- **Changed row — tint pulse in place:** overlay to `--primary-soft` @ 70 % + a 2 px `border-inline-start` bar in `--primary`; in 150 ms `ease-out-expo`, **hold 400 ms**, fade out 800 ms `cubic-bezier(0.4,0,0.2,1)`. Opacity/background only — **never** shifts neighbors. (~1,350 ms total.)
- **New row — fade + slide in AND carry the pulse:** height 0→auto (200 ms) + opacity 0→1 + `translateY(-6px)→0` (250 ms `ease-out-expo`), **stagger 40 ms, capped at 5** (rows 6+ enter together). The new row glows so it clearly reads as new.
- **Changed value in a kept row (counts, statuses, KPI figures) — the NEW value animates in:** new value opacity 0→1 + `translateY(-3px)→0`, 180 ms `ease-out-expo` (old value is **not** dwelt on). `font-variant-numeric: tabular-nums` prevents width jitter. Arabic-Indic digits via `toLocaleString(locale)`.
- **Removed row:** opacity→0 (150 ms), height collapse (200 ms). No theatrics.
- **Reorder:** FLIP translate 300 ms; **circuit breaker** — if >8 rows moved or >20 % changed, skip choreography, one quiet container crossfade (150/200 ms).
- **Identical data: nothing plays.** The diff keys off *referential* change, never "a fetch completed."

**"N new" pill (scrolled-down case):** if new rows would land above the viewport while the user is scrolled down, **do not insert visibly / do not move their scroll.** Float a center-top pill — `"N new ↑"` / `"N جديد ↑"` (localized digits) — entering 200 ms `ease-out-expo`. Click → smooth-scroll to top (~350 ms) → release the staggered entrance. Also auto-releases if the user scrolls back to top.

**Motion-fatigue rules:** a row pulses at most once / 30 s (coalesce rapid changes); no choreography during the first 2 s after route entrance; global ceiling — a commit touching 3+ panes pulses pane counters, not every row.

**Reduced motion:** keep tint pulse (it's the accessibility signal for "changed") but drop the edge-bar entrance; new rows insert instantly + tint (no slide/stagger/height); FLIP off; button rotation off; veil = simple 150 ms opacity dip, no scale. Screen readers: one polite `aria-live` per commit-with-changes ("List updated, N new records / تم تحديث القائمة، N سجلات جديدة"); never announce no-op refreshes.

---

## 6. Component / file inventory

New (`frontend/src/components/refresh/` + `lib/`):
- `lib/globalRefresh.ts` — `refreshAll()`, `isRefreshing` signal, `isEditing` flag, min-spin/ceiling timing.
- `hooks/useRefreshHeartbeat.ts` — 60 s heartbeat (pauses on hidden/editing).
- `hooks/useRefreshHotkeys.ts` — `Alt+R`, `F5`/`Ctrl+R` intercept.
- `components/refresh/TopProgressBar.tsx` — shared default signal.
- `components/refresh/PullToRefresh.tsx` — phone gesture + ring.
- `components/refresh/RefreshButton.tsx` — desktop ghost fallback.
- `components/refresh/RefreshRing.tsx` — the ring SVG/stages (shared by gesture; reused inline by button spinner if desired).
- (Milestone B) `hooks/usePulseOnChange.ts` / `components/refresh/PulseRow.tsx` + `NewItemsPill.tsx` — the delta primitive.

Edited:
- `App.tsx` — QueryClient cadence, mount TopProgressBar + heartbeat + hotkeys at shell.
- `index.css` — refresh motion tokens (sweep, pulse, row-enter, veil), `overscroll-behavior` on page scrollers.
- Page scroll containers (Records/Books, Dashboard, Leaves, …) — wrap in `<PullToRefresh>`, add `RefreshButton` to page headers.
- `locales/{en,ar}.json` — pill, tooltip, aria-live strings (both keys landed together).

---

## 7. i18n / RTL / a11y checklist

- All new copy (pill, tooltip, aria-live) added to `en.json` **and** `ar.json` in the same change; run the `i18n-rtl-reviewer` pass.
- Ring is symmetric (no mirroring); spinner clockwise in both languages.
- Sweep, edge-bar, pill use logical properties; digits via `toLocaleString(locale)`.
- Full `prefers-reduced-motion` handling per §4–5; Tailwind `motion-reduce:` variants + JS gates on FLIP/stagger orchestration.
- `aria-live` announces only commits-with-changes, once each.

---

## 8. Edge cases

- **Nested scrollers:** on touchstart walk `composedPath()`; if an inner element can scroll up, don't claim the gesture.
- **Keyboard open (phone):** suppress the gesture entirely.
- **Mid-edit:** pause auto-refresh (heartbeat + focus) while a dirty form is open (both detail surfaces). If a record changed server-side while its editor was open, show a static inline notice, don't silently merge.
- **Mid-scroll (desktop):** "N new" pill; never adjust scrollTop under the user (rely on `overflow-anchor`; virtualized lists pin by anchor item).
- **Identical data:** no top-bar sweep beyond the quick default fill, no pulse, no announcement.
- **Template/PDF/rich-editor regions:** `data-ptr-ignore`.

---

## 9. Testing

- **Unit (vitest):** rubber-band curve values; gate logic (rest-at-top, dead zone, direction lock, hold-to-arm, multi-touch cancel); `refreshAll` min-spin/ceiling; diff classification (new/changed/removed/reorder/no-op); reduced-motion branches.
- **Component:** TopProgressBar fast vs slow paths; ring stage transitions; pill show/release; veil on manual.
- **e2e (playwright):** desktop — button + `Alt+R` + `F5`-intercept trigger a soft refresh (no full reload, state preserved); focus/reconnect refetch; mid-edit suppression. (Touch gesture physics tuned on a real office Android device — devtools always feels too stiff.)
- Strict gates apply: mypy strict (backend untouched here), `pytest filterwarnings=error`, eslint, `tsc -b`.

---

## 10. Open decisions (defaults chosen; confirm during planning)

1. **Milestone B adoption order** — proposed: Records/Books list → Dashboard KPIs → Leaves → the rest. (Default: this order.)
2. **Aurora glow** style was offered as an alternative to the calm settle — **rejected** in favor of calm + top progress bar (per approval).
3. **SSE-driven invalidation** — deferred to a later phase.
