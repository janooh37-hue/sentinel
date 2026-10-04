import { createContext, useContext } from 'react'

/** True below a `TooltipProvider` from `./tooltip`. `Hint` uses it to mount a
 *  local provider when none exists above it (isolated renders, portals). */
export const TooltipProviderContext = createContext(false)

export function useHasTooltipProvider(): boolean {
  return useContext(TooltipProviderContext)
}
