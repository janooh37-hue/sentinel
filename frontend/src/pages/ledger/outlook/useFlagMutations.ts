/**
 * useFlagMutations — set / clear the current user's follow-up flag on a ledger
 * entry (Phase 2, D3b). Per-user flags: each person flags independently.
 *
 * Mirrors `StarButton`'s optimistic-update + cache-walk pattern so the row's 🚩
 * flips immediately, and invalidates the Follow-ups list + flag-count (bell) on
 * settle. Lives in its own hook (not the component file) so the row component
 * and the selection bar can share it.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { api, ApiError } from '@/lib/api'
import type { LedgerListItem } from '@/lib/api'

type LedgerListData = { items: LedgerListItem[]; total: number; limit: number; offset: number }

/** Optimistically patch every cached ['ledger', …] list row matching `id`. */
function patchListCaches(
  qc: ReturnType<typeof useQueryClient>,
  id: number,
  patch: Partial<Pick<LedgerListItem, 'flagged' | 'followup_due'>>,
): void {
  qc.getQueriesData<LedgerListData>({ queryKey: ['ledger'] }).forEach(([key, data]) => {
    if (!data?.items) return
    qc.setQueryData(key, {
      ...data,
      items: data.items.map((it) => (it.id === id ? { ...it, ...patch } : it)),
    })
  })
}

function invalidateFlagQueries(qc: ReturnType<typeof useQueryClient>): void {
  void qc.invalidateQueries({ queryKey: ['ledger'] })
  void qc.invalidateQueries({ queryKey: ['ledger-flag-count'] })
}

export interface FlagMutations {
  /** Set/update the flag; `due` is an ISO `YYYY-MM-DD` or null for undated. */
  setFlag: (id: number, due: string | null) => void
  /** Clear the flag. */
  clearFlag: (id: number) => void
  isPending: boolean
}

export function useFlagMutations(): FlagMutations {
  const qc = useQueryClient()

  const set = useMutation({
    mutationFn: ({ id, due }: { id: number; due: string | null }) =>
      api.flagLedgerEntry(id, due),
    onMutate: ({ id, due }) => {
      patchListCaches(qc, id, { flagged: true, followup_due: due })
    },
    onError: (err) => {
      invalidateFlagQueries(qc)
      toast.error(err instanceof ApiError ? err.message : String(err))
    },
    onSettled: () => invalidateFlagQueries(qc),
  })

  const clear = useMutation({
    mutationFn: (id: number) => api.unflagLedgerEntry(id),
    onMutate: (id) => {
      patchListCaches(qc, id, { flagged: false, followup_due: null })
    },
    onError: (err) => {
      invalidateFlagQueries(qc)
      toast.error(err instanceof ApiError ? err.message : String(err))
    },
    onSettled: () => invalidateFlagQueries(qc),
  })

  return {
    setFlag: (id, due) => set.mutate({ id, due }),
    clearFlag: (id) => clear.mutate(id),
    isPending: set.isPending || clear.isPending,
  }
}

/**
 * Due-date presets for the flag popover. Pure date math so the popover renders
 * the same labels the request carries. Returns ISO `YYYY-MM-DD` (or null).
 */
export interface FlagPreset {
  key: 'today' | 'tomorrow' | 'nextWeek' | 'none'
  /** ISO date or null (undated). */
  due: string | null
}

function isoLocal(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function flagPresets(now: Date = new Date()): FlagPreset[] {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)
  const nextWeek = new Date(today)
  nextWeek.setDate(today.getDate() + 7)
  return [
    { key: 'today', due: isoLocal(today) },
    { key: 'tomorrow', due: isoLocal(tomorrow) },
    { key: 'nextWeek', due: isoLocal(nextWeek) },
    { key: 'none', due: null },
  ]
}

/** True when a `followup_due` ISO date is strictly before today (overdue). */
export function isOverdue(due: string | null | undefined, now: Date = new Date()): boolean {
  if (!due) return false
  const today = isoLocal(new Date(now.getFullYear(), now.getMonth(), now.getDate()))
  return due < today
}
