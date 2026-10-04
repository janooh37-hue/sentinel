import * as React from 'react'

import { Kbd } from './kbd'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip'
import { useHasTooltipProvider } from './tooltip-context'

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
 * `aria-keyshortcuts`; `title` is never set (the tooltip replaces it). The
 * tooltip is a visual hint only: the child must carry its own accessible name.
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
  const hasProvider = useHasTooltipProvider()
  const trigger = shortcut
    ? React.cloneElement(children, { 'aria-keyshortcuts': shortcut })
    : children
  const tip = (
    <Tooltip>
      <TooltipTrigger asChild>{trigger}</TooltipTrigger>
      <TooltipContent side={resolveSide(side)} className="flex items-center gap-2">
        <span>{label}</span>
        {shortcut ? <Kbd>{shortcut}</Kbd> : null}
      </TooltipContent>
    </Tooltip>
  )
  return hasProvider ? (
    tip
  ) : (
    <TooltipProvider delayDuration={400} skipDelayDuration={150}>
      {tip}
    </TooltipProvider>
  )
}
