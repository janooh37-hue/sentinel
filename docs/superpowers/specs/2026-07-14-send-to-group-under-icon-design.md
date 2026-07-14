# Send to Group under the WhatsApp icon — Design

**Date:** 2026-07-14
**Status:** Design approved.

## Goal

Two Send-to-Group improvements shipped together:
1. **Bug fix** — WhatsApp groups don't show on the Send-to-Group page. Root cause:
   WAHA's NOWEB engine returns `GET /api/{session}/groups` as a JSON object keyed by
   group id, but `openwa_client.list_groups()` only handles a list / `{"groups":[...]}`,
   so a bare dict-of-groups yields `[]`. Fix: iterate `data.values()` for the
   dict-keyed shape (name = `subject`). Verified against the live gateway.
2. **Nav change** — remove the redundant "Send to Group" horizontal nav tab and make
   the page reachable via a dropdown popover under the WhatsApp `GatewayIndicator`
   icon in the TopNav right cluster.

## Current state

- `navItems.ts:27` — a `/messages/broadcast` nav tab (icon `MessageSquare`, gated
  `messages.broadcast`).
- `GatewayIndicator.tsx` — a `NavLink` (the WhatsApp `MessageCircle` icon + 4-state
  status dot) that navigates directly to `/messages/broadcast`. Both point at the
  same route — redundant.

## Design

1. **Remove the nav tab** — delete the `/messages/broadcast` entry from `NAV_ITEMS`
   (`navItems.ts:27`) and drop the now-unused `MessageSquare` import.

2. **`GatewayIndicator` → dropdown popover** (mirror the hand-rolled pattern in
   `NavBellPopover.tsx`: a `relative` wrapper, a trigger button, an
   `absolute end-0 top-full` `role="dialog"` panel with `anim-pop-in`, outside-click
   + Escape close, and focus-return to the trigger).
   - **Trigger:** the `MessageCircle` icon + the live 4-state status dot
     (green / amber-pulse / red), `aria-label` = `gateway.indicator.menuLabel`;
     toggles `open`.
   - **Panel:**
     - **Status header** — the dot + `gateway.indicator.{connected|disconnected|unreachable}`
       label + `gateway.indicator.checkedAgo` ("checked Xs ago").
     - **"Send to Group" row** — a `Megaphone` icon + `nav.sendToGroup` label +
       trailing `ArrowRight` (`rtl:rotate-180`); on click `navigate('/messages/broadcast')`
       and close the popover.
   - **Unchanged:** renders nothing when `isLoading` / no data / `state === 'disabled'`;
     only mounts for `messages.broadcast` holders (via the `useGatewayStatus` hook's
     `enabled`). The 4-state enum stays intact (never collapse red vs amber).

3. **Accepted consequence:** with the tab removed and the icon hidden when
   `disabled`, Send-to-Group has no nav entry point while `openwa_enabled` is off.
   The broadcast feature is non-functional when the gateway is disabled, so this is
   acceptable; production has the gateway enabled (icon visible).

## i18n

- Reuse `gateway.indicator.{connected,disconnected,unreachable,checkedAgo}` and
  `nav.sendToGroup`.
- Add one new key pair `gateway.indicator.menuLabel` — en "WhatsApp" / ar "واتساب"
  — for the trigger/panel `aria-label`. en/ar parity.

## Testing

Rewrite `GatewayIndicator.test.tsx`:
- renders nothing when `disabled` and when loading/no-data (unchanged);
- the trigger renders the correct `data-state` dot for connected/disconnected/unreachable
  (no red-vs-amber collapse);
- clicking the trigger opens the panel; the panel contains a "Send to Group" control
  that navigates to `/messages/broadcast`.

## Constraints

- Bilingual en/ar parity; logical CSS (`end-*`, `ms-`/`me-`, `rtl:rotate-180`);
  lucide icons, no emoji; `dir="auto"` on any free text.
- Follow `NavBellPopover`'s outside-click/Escape/focus pattern (no new popover lib).
- Strict gates (ruff/mypy not applicable — frontend only; tsc, vitest, eslint).
  Live checkout: worktree → merge to `main` → push.

## Out of scope

- Reconnect/QR/unlink actions inside the popover (those already live on the
  Send-to-Group page; the popover only links there).
- Mobile top bar (unchanged; keeps relying on the page).
