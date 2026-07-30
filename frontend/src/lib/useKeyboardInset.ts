/**
 * useKeyboardInset — px of the layout viewport currently hidden behind the
 * on-screen keyboard.
 *
 * Why not `window.resize`: iOS Safari does NOT resize the layout viewport when
 * the keyboard opens, so `resize` never fires and any listener based on it is a
 * silent no-op on iPhones. `visualViewport` is the only signal both platforms
 * agree on — and it fires `scroll` (not `resize`) in some iOS cases, so we
 * listen to both.
 *
 * Returns 0 when the keyboard is closed or `visualViewport` is unavailable
 * (jsdom, older browsers), which makes callers degrade to today's behaviour.
 */
import { useEffect, useState } from 'react'

export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0)

  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const read = (): void => {
      // Whatever the visual viewport doesn't cover at the bottom is keyboard.
      setInset(Math.max(0, window.innerHeight - vv.height - vv.offsetTop))
    }
    read()
    vv.addEventListener('resize', read)
    vv.addEventListener('scroll', read)
    return () => {
      vv.removeEventListener('resize', read)
      vv.removeEventListener('scroll', read)
    }
  }, [])

  return inset
}
