import { useEffect } from 'react'

const openDialogSelector = 'dialog[open], :is([role="dialog"], [role="alertdialog"], [aria-modal="true"]):not([hidden]):not([data-state="closed"])'

export function useArmoryFindShortcut(onOpen: () => void, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== '/' || event.defaultPrevented || event.repeat || event.isComposing ||
        event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      const target = event.target instanceof Element ? event.target : document.activeElement
      if (target?.closest('input, textarea, select')) return
      const editor = target?.closest('[contenteditable]')
      if ((target instanceof HTMLElement && target.isContentEditable) ||
        editor?.matches('[contenteditable=""], [contenteditable="true" i], [contenteditable="plaintext-only" i]')) return
      if (document.querySelector(openDialogSelector)) return
      event.preventDefault()
      onOpen()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [enabled, onOpen])
}
