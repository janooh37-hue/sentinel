import * as React from 'react'

import { cn } from '@/lib/utils'

import { Kbd } from './kbd'
import { ariaKeyShortcut } from './keyshortcut'
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip'

/** Vertical and physical `left`/`right` sides are direction-safe; `start`/`end` resolve against the
 *  document direction because Radix `side` is physical. */
export type HintSide = 'top' | 'bottom' | 'start' | 'end' | 'left' | 'right'

function resolveSide(side: HintSide): 'top' | 'bottom' | 'left' | 'right' {
  if (side === 'top' || side === 'bottom' || side === 'left' || side === 'right') return side
  const rtl = typeof document !== 'undefined' && document.documentElement.dir === 'rtl'
  if (side === 'start') return rtl ? 'right' : 'left'
  return rtl ? 'left' : 'right'
}

/**
 * Tooltip with a label and an optional shortcut. The trigger child gets
 * `aria-keyshortcuts` (ARIA key tokens derived from the display glyph, unless the
 * child already sets one); `title` is never set (the tooltip replaces it). The
 * tooltip is a visual hint only: the child must carry its own accessible name.
 * A `disabled` child is wrapped in a focusable `<span>` so the tooltip (the
 * reason it is blocked) still opens on hover and Tab. Requires an ancestor
 * `TooltipProvider`.
 */
export function Hint({
  label,
  shortcut,
  side = 'top',
  children,
}: {
  label: string
  shortcut?: string
  side?: HintSide
  children: React.ReactElement<Record<string, unknown>>
}): React.JSX.Element {
  // A child's own `aria-keyshortcuts` (e.g. a modifier combo) wins over the displayed key.
  const keyed =
    shortcut && children.props['aria-keyshortcuts'] === undefined
      ? React.cloneElement(children, { 'aria-keyshortcuts': ariaKeyShortcut(shortcut) })
      : children
  // A disabled button fires no pointer or focus events, so it can never open the tooltip itself.
  // Its wrapper takes the trigger role (hover + Tab) and the button stops swallowing pointer events.
  const blocked = keyed.props.disabled === true
  const trigger = blocked ? (
    <span tabIndex={0} role="group" aria-label={label} className="inline-flex">
      {React.cloneElement(keyed, {
        className: cn(keyed.props.className as string | undefined, 'pointer-events-none'),
      })}
    </span>
  ) : (
    keyed
  )
  return (
    <Tooltip>
      <TooltipTrigger asChild>{trigger}</TooltipTrigger>
      <TooltipContent side={resolveSide(side)} className="flex items-center gap-2">
        <span>{label}</span>
        {shortcut ? <Kbd>{shortcut}</Kbd> : null}
      </TooltipContent>
    </Tooltip>
  )
}
