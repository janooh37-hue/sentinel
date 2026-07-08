import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { refreshAll } from '../lib/globalRefresh'

function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null
  if (!el) return false
  return /^(input|textarea|select)$/i.test(el.tagName) || el.isContentEditable
}

export function useRefreshHotkeys(): void {
  const qc = useQueryClient()
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Ctrl+Shift+R stays the native hard reload escape hatch
      if (e.code === 'KeyR' && (e.ctrlKey || e.metaKey) && e.shiftKey) return
      const altR = e.code === 'KeyR' && e.altKey && !e.ctrlKey && !e.metaKey
      const softReload = e.code === 'F5' && !e.ctrlKey && !e.shiftKey
      const ctrlR = e.code === 'KeyR' && (e.ctrlKey || e.metaKey) && !e.shiftKey
      if ((altR && !isTyping(e.target)) || softReload || ctrlR) {
        e.preventDefault()
        void refreshAll(qc)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [qc])
}
