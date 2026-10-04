/**
 * The Records page's layout tier, measured from the page wrapper's own width
 * (the JS twin of its `@container` rules, so behaviour — auto-select, the
 * drawer, J/K — agrees with what the CSS laid out):
 *
 *   drawer  < 64rem   no rail, full-width list, the pane is a drawer
 *   icons   64–80rem  `w-14` icon rail + inline pane
 *   full    ≥ 80rem   15rem rail + inline pane
 *
 * The thresholds are in rem, so they track the Aa font scale (at 1440 the tier
 * is full at Aa 16, icons at Aa 19, drawer at Aa 22/24).
 */
import { useLayoutEffect, useState } from 'react'

export type ListTier = 'drawer' | 'icons' | 'full'

const ICONS_MIN_REM = 64
const FULL_MIN_REM = 80

export function tierForWidth(widthPx: number, remPx: number): ListTier {
  // An unlaid-out element (width 0: jsdom, display:none) behaves like a roomy desktop.
  if (widthPx <= 0) return 'full'
  const rem = widthPx / remPx
  if (rem >= FULL_MIN_REM) return 'full'
  if (rem >= ICONS_MIN_REM) return 'icons'
  return 'drawer'
}

/** `null` until the first measurement (nothing tier-dependent renders or auto-selects yet). */
export function useListTier(
  element: HTMLElement | null,
): ListTier | null {
  const [tier, setTier] = useState<ListTier | null>(() =>
    typeof ResizeObserver === 'undefined' ? 'full' : null,
  )
  useLayoutEffect(() => {
    if (!element || typeof ResizeObserver === 'undefined') return
    const measure = (): void => {
      const style = getComputedStyle(element)
      const content =
        element.clientWidth - parseFloat(style.paddingLeft || '0') - parseFloat(style.paddingRight || '0')
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
      setTier(tierForWidth(content, rem))
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- measure before first paint
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [element])
  return tier
}
