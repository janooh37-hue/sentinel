import { useEffect, useState } from 'react'

import { useIsMobile } from '@/lib/useIsMobile'

/** Primary input cannot hover (touch tablets, phones): Radix tooltips never open there. */
const TOUCH_QUERY = '(hover: none), (pointer: coarse)'

function useTouchPrimary(): boolean {
  const [touch, setTouch] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(TOUCH_QUERY).matches,
  )
  useEffect(() => {
    if (typeof window === 'undefined') return
    const mql = window.matchMedia(TOUCH_QUERY)
    const onChange = (): void => setTouch(mql.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])
  return touch
}

/**
 * True when a blocked action's reason must be shown inline instead of in a
 * tooltip: phone-width viewports, or any hover-less / coarse-pointer device
 * (a touch tablet at ≥768px included). Fine-pointer desktops keep the tooltip.
 */
export function useInlineReason(): boolean {
  const isMobile = useIsMobile()
  const touchPrimary = useTouchPrimary()
  return isMobile || touchPrimary
}
