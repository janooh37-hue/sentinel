import type { i18n as I18n } from 'i18next'
import type { KeyboardEvent } from 'react'

export function pageDirection(i18n: Pick<I18n, 'dir'>): 'rtl' | 'ltr' {
  return (document.documentElement.dir || i18n.dir()) === 'rtl' ? 'rtl' : 'ltr'
}

/** Move focus in DOM order, with horizontal arrows mirrored in RTL. */
export function moveRovingFocus(
  event: KeyboardEvent<HTMLDivElement>,
  i18n: Pick<I18n, 'dir'>,
  order: 'all' | 'enabled' = 'all',
): void {
  const { key } = event
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(key)) return
  const current = event.target instanceof Element ? event.target.closest('button') : null
  if (order === 'enabled' && !current) return
  event.preventDefault()
  event.stopPropagation()

  // State chips retain the origin if a focused chip becomes disabled; People keys rove in enabled order.
  const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>(
    order === 'enabled' ? 'button:not([aria-disabled="true"])' : 'button',
  ))
  const index = buttons.findIndex((button) => button === current)
  if (order === 'all' && index < 0) return

  const forward = key === 'ArrowDown' || key === (pageDirection(i18n) === 'rtl' ? 'ArrowLeft' : 'ArrowRight')
  const step = key === 'Home' ? 1 : key === 'End' ? -1 : forward ? 1 : -1
  const origin = key === 'Home' ? -1 : key === 'End' ? buttons.length : index
  for (let offset = 1; offset <= buttons.length; offset += 1) {
    const next = buttons[(origin + step * offset + buttons.length) % buttons.length]
    if (next?.getAttribute('aria-disabled') === 'true') continue
    next?.focus()
    return
  }
}
