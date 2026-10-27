/**
 * Placement shared by the account and notifications popovers, chosen by the bar that RENDERS them.
 *
 * Which bar renders is decided in JS (`useIsMobile`, a px query: 767px). Tailwind's `md` is 48rem, and `rem` inside
 * a media query follows the BROWSER's default font size (not the html font-size the Aa control sets), so with a
 * larger browser font `md` sits at 864 / 960 / 1152px while the TopNav already renders from 768px. A placement
 * keyed on `md:` therefore hung the panels off the wrong anchor (below the viewport, scrolling the whole page).
 * `MobileTopBar` passes `phone`; the TopNav passes nothing. No class here is a breakpoint variant.
 *
 * Phone bar: the trigger wrappers are `static`, so the panel is positioned against the phone `<header>` (it is
 * `relative`, see MobileTopBar). The panel hangs under the header, spans the width between the safe insets (the
 * env() values are physical; taking the larger of the two keeps it symmetric, so it needs no LTR/RTL variants),
 * and `ms-auto` + the panel's own `max-w` keep it flush with the inline-end edge. The panel is the ONLY scroller
 * on a phone: its height is capped to the dynamic viewport minus the header and a margin, so no control is ever
 * stranded off-screen in landscape or at large text sizes (content inside it, e.g. the notifications list, must
 * not add a second scroller).
 *
 * The phone cap mirrors MobileTopBar's header height exactly, so a change to one needs the other:
 *   header      = safe-top + 0.75rem + 44px control + 0.75rem + 1px border
 *   panel gap   = 0.5rem (`mt-2`)
 *   bottom gap  = 0.75rem
 *   => safe-top + safe-bottom + 2.75rem + 45px
 *
 * TopNav: the trigger wrapper is `relative` and the panel is anchored to its trigger with `end-0` at a fixed
 * width. Its cap is the same arithmetic as the phone's, from the TopNav row's real geometry (the row's height
 * follows the avatar trigger, the tallest control, which is 2.5rem or the 44px touch target):
 *   panel top   = TopNav top padding max(0.875rem, safe-top + 0.75rem) + trigger max(2.5rem, 44px) + 0.5rem (`mt-2`)
 *   bottom gap  = 0.75rem
 *   => 100dvh - safe-bottom - panel top - 0.75rem
 * The bell sits centred in the same row, so its panel starts higher and keeps a little more room than the cap.
 * This replaced a flat `6rem`, which wasted ~30px at Aa22 and ignored the top inset.
 */
const PHONE_PANEL = [
  'absolute top-full z-50 mt-2',
  'inset-x-[max(0.75rem,var(--safe-left),var(--safe-right))] ms-auto',
  'max-h-[calc(100dvh-var(--safe-top)-var(--safe-bottom)-2.75rem-45px)] overflow-y-auto overflow-x-hidden overscroll-contain',
].join(' ')

const TOPNAV_PANEL = [
  'absolute top-full z-50 mt-2 end-0',
  'max-h-[calc(100dvh-var(--safe-bottom)-max(0.875rem,calc(var(--safe-top)+0.75rem))-max(2.5rem,44px)-0.5rem-0.75rem)] overflow-y-auto overflow-x-hidden overscroll-contain',
].join(' ')

export interface HeaderPopoverStyle {
  /** The trigger wrapper: the panel's containing block on the TopNav, not on the phone bar. */
  root: string
  /** Position, offset and height cap of the panel. */
  panel: string
  /** Width of the account panel / of the notifications panel. */
  accountWidth: string
  bellWidth: string
  /** The notifications `<ul>`: capped, internal scroller for a mouse on the TopNav only. */
  list: string
  /** Avatar boxes: pinned px on the phone bar (so a 44px trigger never grows with text), rem on the TopNav. */
  avatar: string
  identityAvatar: string
}

const PHONE: HeaderPopoverStyle = {
  root: '',
  panel: PHONE_PANEL,
  accountWidth: 'max-w-80',
  bellWidth: 'max-w-[380px]',
  list: '',
  avatar: 'h-[36px] w-[36px]',
  identityAvatar: 'h-[56px] w-[56px]',
}

const TOPNAV: HeaderPopoverStyle = {
  root: 'relative',
  panel: TOPNAV_PANEL,
  accountWidth: 'max-w-80 w-80',
  bellWidth: 'max-w-[380px] w-[380px]',
  list: 'max-h-[360px] overflow-auto pointer-coarse:max-h-none pointer-coarse:overflow-visible',
  avatar: 'h-9 w-9',
  identityAvatar: 'h-14 w-14',
}

export const headerPopoverStyle = (phone: boolean): HeaderPopoverStyle => (phone ? PHONE : TOPNAV)
