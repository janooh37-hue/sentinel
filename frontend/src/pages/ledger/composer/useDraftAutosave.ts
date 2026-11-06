/**
 * Debounced draft autosave. Each pause PATCHes only the fields that differ
 * from what the server last accepted; a failed save keeps those fields
 * pending, so the next edit sends them again.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { LEDGER_DRAFTS_KEY } from '@/components/books/ledgerBookKeys'
import { api } from '@/lib/api'
import { changedFields, type ComposerValues } from './composerForm'

export type SaveState = 'idle' | 'saving' | 'saved' | 'failed'

export interface DraftAutosave {
  state: SaveState
  /** Last accepted autosave time, used to bust the PDF cache. */
  savedAt: number | null
  pending: boolean
  /** Saves `values` now if they differ; resolves false when the save failed. */
  flush: (values: ComposerValues) => Promise<boolean>
}

export function useDraftAutosave(draftId: number, values: ComposerValues, initial: ComposerValues, ms: number, onError?: (err: unknown) => boolean): DraftAutosave {
  const qc = useQueryClient()
  const saved = useRef(initial)
  const [accepted, setAccepted] = useState(initial)
  const [state, setState] = useState<SaveState>('idle')
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const inFlight = useRef<Promise<boolean> | null>(null)

  const flush = useCallback(async (next: ComposerValues): Promise<boolean> => {
    // Preview opening and Save & Send can flush while an autosave is running.
    // Preserve request order so an earlier response cannot mark newer edits saved.
    while (inFlight.current) await inFlight.current
    const patch = changedFields(saved.current, next)
    if (Object.keys(patch).length === 0) return true
    setState('saving')
    const request = (async (): Promise<boolean> => {
      try {
        await api.updateLedgerDraft(draftId, patch)
      } catch (err) {
        onError?.(err)
        setState('failed')
        return false
      }
      saved.current = { ...saved.current, ...patch } as ComposerValues
      setState('saved')
      setAccepted(saved.current)
      setSavedAt((previous) => Math.max(Date.now(), (previous ?? 0) + 1))
      void qc.invalidateQueries({ queryKey: LEDGER_DRAFTS_KEY, exact: true })
      return true
    })()
    inFlight.current = request
    try {
      return await request
    } finally {
      if (inFlight.current === request) inFlight.current = null
    }
  }, [draftId, qc, onError])

  useEffect(() => {
    const timer = setTimeout(() => void flush(values), ms)
    return () => clearTimeout(timer)
  }, [values, ms, flush])

  return { state, savedAt, pending: Object.keys(changedFields(accepted, values)).length > 0, flush }
}
