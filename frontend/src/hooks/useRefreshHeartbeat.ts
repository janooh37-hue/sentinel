import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { editingRegistry } from '../lib/globalRefresh'

/** One synchronized 60s heartbeat that refreshes everything, paused when the
 *  window is hidden or the user is editing a form. */
export function useRefreshHeartbeat(intervalMs = 60_000): void {
  const qc = useQueryClient()
  useEffect(() => {
    const id = setInterval(() => {
      if (document.hidden) return
      if (editingRegistry.isAnyEditing()) return
      void qc.invalidateQueries({ refetchType: 'active' })
    }, intervalMs)
    return () => clearInterval(id)
  }, [qc, intervalMs])
}
