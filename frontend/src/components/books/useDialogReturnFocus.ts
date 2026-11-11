import { useState } from 'react'

/**
 * Where focus should go back to when a dialog closes. A dialog opened from a menu
 * item cannot rely on Radix's own return: the focused menu item is gone by then, so
 * focus falls to <body>. A menu item resolves to its menu's trigger (Radix labels
 * every menu with `aria-labelledby` = the trigger's id).
 */
function focusOrigin(): HTMLElement | null {
  const active = document.activeElement
  if (!(active instanceof HTMLElement) || active === document.body) return null
  const triggerId = active.closest('[role="menu"]')?.getAttribute('aria-labelledby')
  return (triggerId ? document.getElementById(triggerId) : null) ?? active
}

/**
 * Call in the component that owns `open`, before any early return. The origin is
 * captured during the render that flips `open` on, while the opener (a menu item)
 * is still in the DOM. Pass the result to `DialogContent`'s `onCloseAutoFocus`;
 * if the origin has since left the page the event is left alone.
 */
export function useDialogReturnFocus(open: boolean): (event: Event) => void {
  const [wasOpen, setWasOpen] = useState(false)
  const [origin, setOrigin] = useState<HTMLElement | null>(null)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setOrigin(focusOrigin())
  }
  return (event) => {
    if (!origin?.isConnected) return
    event.preventDefault()
    origin.focus()
  }
}
