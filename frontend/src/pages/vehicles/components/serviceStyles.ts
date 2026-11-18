/**
 * Class strings the Vehicle Services pages share with `ServiceLayout` and
 * `RequestShell`. Kept apart from the components so those files export
 * components only (fast refresh).
 */

import { cn } from '@/lib/utils'

/** The page column every band, counter and register shares. */
export const SERVICE_WRAP = 'mx-auto w-full max-w-[78rem] px-3 sm:px-6'

/** The lift that sets the counter (and the hub's service doors) above the band. */
export const SERVICE_LIFT = 'shadow-[0_10px_26px_rgba(13,40,69,0.14)]'

/** A secondary action that sits on the navy band (print, report, edit). */
export const BAND_BUTTON = cn(
  'inline-flex h-8 items-center gap-2 rounded-md border border-primary-foreground/35 px-3 text-xs font-medium text-primary-foreground',
  'transition-colors hover:bg-primary-foreground/10 motion-reduce:transition-none',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground focus-visible:ring-offset-1 focus-visible:ring-offset-primary',
  'disabled:pointer-events-none disabled:opacity-50',
)
