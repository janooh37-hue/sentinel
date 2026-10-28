/**
 * Debounced draft autosave. Each pause PATCHes only the fields that differ
 * from what the server last accepted; a failed save keeps those fields
 * pending, so the next edit sends them again.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { LEDGER_DRAFTS_KEY } from '@/components/books/ledgerBookKeys'
import { api } from '@/lib/api'
import { useDebouncedValue } from '@/lib/useDebouncedValue'
import { changedFields, type ComposerValues } from './composerForm'

export type SaveState = 'idle' | 'saving' | 'saved' | 'failed'

export interface DraftAutosave {
  state: SaveState
  /** Bumps after every accepted save (the paper preview reloads on it). */
  savedCount: number
  /** Saves pending changes now; resolves false when the save failed. */
  flush: () => Promise<boolean>
}

export function useDraftAutosave(draftId: number, values: ComposerValues, initial: ComposerValues, ms: number): DraftAutosave {
  const qc = useQueryClient()
  const saved = useRef(initial)
  const latest = useRef(values)
  latest.current = values
  const [state, setState] = useState<SaveState>('idle')
  const [savedCount, setSavedCount] = useState(0)

  const save = useCallback(async (next: ComposerValues): Promise<boolean> => {
    const patch = changedFields(saved.current, next)
    if (Object.keys(patch).length === 0) return true
    setState('saving')
    try {
      await api.updateLedgerDraft(draftId, patch)
    } catch {
      setState('failed')
      return false
    }
    saved.current = { ...saved.current, ...patch } as ComposerValues
    setState('saved')
    setSavedCount((n) => n + 1)
    void qc.invalidateQueries({ queryKey: LEDGER_DRAFTS_KEY, exact: true })
    return true
  }, [draftId, qc])

  const debounced = useDebouncedValue(values, ms)
  useEffect(() => { void save(debounced) }, [debounced, save])

  const flush = useCallback(() => save(latest.current), [save])
  return { state, savedCount, flush }
}
