/**
 * Debounced draft autosave. Each pause PATCHes only the fields that differ
 * from what the server last accepted; a failed save keeps those fields
 * pending, so the next edit sends them again.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { UseFormReturn } from 'react-hook-form'
import { useQueryClient } from '@tanstack/react-query'

import { LEDGER_DRAFTS_KEY, ledgerDraftKey } from '@/components/books/ledgerBookKeys'
import { api, type LedgerDraftRead } from '@/lib/api'
import { changedFields, type ComposerValues } from './composerForm'

export type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'failed'

export interface DraftAutosave {
  state: SaveState
  /** Last accepted autosave time, used to bust the PDF cache. */
  savedAt: number | null
  pending: boolean
  isDirty: () => boolean
  /** Saves `values` now if they differ; resolves false when the save failed. */
  flush: (values: ComposerValues) => Promise<boolean>
}

export function useDraftAutosave(draftId: number, form: UseFormReturn<ComposerValues>, initial: ComposerValues, ms: number, onError?: (err: unknown) => boolean): DraftAutosave {
  const qc = useQueryClient()
  const saved = useRef(initial)
  const [pending, setPending] = useState(false)
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
        const accepted = await api.updateLedgerDraft(draftId, patch)
        // A completed Delete/Send removes this entry; late saves must not recreate it.
        qc.setQueryData<LedgerDraftRead>(ledgerDraftKey(draftId), (current) => current ? accepted : undefined)
      } catch (err) {
        onError?.(err)
        setState('failed')
        return false
      }
      saved.current = { ...saved.current, ...patch } as ComposerValues
      const dirty = Object.keys(changedFields(saved.current, form.getValues())).length > 0
      setPending(dirty)
      setState(dirty ? 'pending' : 'saved')
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
  }, [draftId, qc, onError, form])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const subscription = form.watch(() => {
      const dirty = Object.keys(changedFields(saved.current, form.getValues())).length > 0
      setPending(dirty)
      setState((current) => current === 'saving' ? current : !dirty ? 'saved' : current === 'failed' ? 'failed' : 'pending')
      clearTimeout(timer)
      timer = setTimeout(() => void flush(form.getValues()), ms)
    })
    return () => { clearTimeout(timer); subscription.unsubscribe() }
  }, [form, ms, flush])

  const isDirty = useCallback(() => inFlight.current !== null || Object.keys(changedFields(saved.current, form.getValues())).length > 0, [form])
  return { state, savedAt, pending, isDirty, flush }
}
