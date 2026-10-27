import { useEffect, type RefObject } from 'react'

/**
 * Focus contract for a header popover (`role="dialog"` toggled by a button): focus moves into the panel
 * when it opens and returns to the trigger when it closes — Escape, a tap outside, or picking an item.
 *
 * - The trigger is the first `<button>` inside `rootRef`; it precedes the panel in both popovers. Touch taps
 *   do not focus a button in Safari, so `document.activeElement` is not a reliable way to find it.
 * - Focus is only restored when nothing else holds it. A tap on a different focusable control (an input
 *   under the popover) keeps its focus; a tap on plain page content leaves it on `<body>`. The browser
 *   moves focus for a tap *after* the `mousedown` handler that closed the popover has run, so the check
 *   waits one task instead of racing the tap.
 */
export function usePopoverFocus(
  open: boolean,
  rootRef: RefObject<HTMLElement | null>,
  panelRef: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    if (!open) return
    const trigger = rootRef.current?.querySelector('button') ?? null
    panelRef.current?.focus()
    return () => {
      window.setTimeout(() => {
        const active = document.activeElement
        if (trigger?.isConnected && (!active || active === document.body)) trigger.focus()
      }, 0)
    }
  }, [open, rootRef, panelRef])
}
