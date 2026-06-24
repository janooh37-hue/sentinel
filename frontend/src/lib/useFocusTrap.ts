/**
 * useFocusTrap — minimal focus management for hand-rolled modal overlays that
 * can't easily move onto Radix Dialog (e.g. a portaled full-bleed preview with
 * a custom backdrop + lazy content).
 *
 * Radix Dialog gives this for free; only reach for this hook when an overlay is
 * NOT a Radix Dialog. When `active`:
 *   - moves initial focus into the container (the element matching
 *     `initialSelector`, else the first focusable, else the container itself);
 *   - traps Tab / Shift+Tab so focus cycles first↔last within the container,
 *     so keyboard/SR users can't reach obscured background content;
 *   - restores focus to the element that was focused before activation on
 *     deactivate/unmount.
 *
 * Escape handling is intentionally left to the caller (the overlay usually
 * already wires it). Returns a ref to attach to the container element.
 */
import { useEffect, useRef } from 'react'

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function useFocusTrap<T extends HTMLElement = HTMLElement>(
  active: boolean,
  initialSelector?: string,
): React.RefObject<T | null> {
  const ref = useRef<T | null>(null)

  useEffect(() => {
    if (!active) return
    const container = ref.current
    if (!container) return

    const previouslyFocused = document.activeElement as HTMLElement | null

    const focusables = (): HTMLElement[] =>
      Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      )

    // Move initial focus in. Defer a frame so lazily-rendered content (Suspense)
    // has a chance to mount its focusable controls first.
    const focusFirst = (): void => {
      const initial = initialSelector
        ? container.querySelector<HTMLElement>(initialSelector)
        : null
      const target = initial ?? focusables()[0] ?? container
      target.focus()
    }
    const raf = window.requestAnimationFrame(focusFirst)

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Tab') return
      const items = focusables()
      if (items.length === 0) {
        // Keep focus pinned to the container so Tab can't escape behind it.
        e.preventDefault()
        container.focus()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const current = document.activeElement
      if (e.shiftKey) {
        if (current === first || !container.contains(current)) {
          e.preventDefault()
          last.focus()
        }
      } else if (current === last || !container.contains(current)) {
        e.preventDefault()
        first.focus()
      }
    }

    container.addEventListener('keydown', onKeyDown)
    return () => {
      window.cancelAnimationFrame(raf)
      container.removeEventListener('keydown', onKeyDown)
      previouslyFocused?.focus?.()
    }
  }, [active, initialSelector])

  return ref
}
