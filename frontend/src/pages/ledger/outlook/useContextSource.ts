/**
 * useContextSource — resolve the open mail/record into its people + linked
 * references for the Ledger context panel (Phase 7).
 *
 * Lives in its own file (not ContextPanel.tsx) so the component file only
 * exports components — the react-refresh/only-export-components rule forbids
 * sharing a non-component export from a component module (same discipline as
 * the `*-variants.ts` split; see CLAUDE.md).
 *
 * Shared by the desktop 4th-column `ContextPanel` and the mobile Sheet (Task 4)
 * so the "People (N)" button count and the panel body can never drift. Runs the
 * SAME `['ledger-entry', id]` query the reading pane uses (TanStack de-dupes —
 * no double fetch).
 *
 * (The Correspondence-Log `'log'` record branch was removed 2026-06-25 — every
 * selected row is now an email.)
 */

import { useQuery } from '@tanstack/react-query'

import { api } from '@/lib/api'
import type { LedgerEntryRead } from '@/lib/api'
import { extractBookRefs } from '@/lib/smartLinks'
import { resolvePeople } from './contextResolve'

export interface ContextSource {
  entry: LedgerEntryRead | undefined
  people: { primary: string | null; siblings: string[] }
  peopleCount: number
  bookRefs: string[]
  attachments: NonNullable<LedgerEntryRead['attachments']>
  isLoading: boolean
}

export function useContextSource(
  selectedId: number | null,
  selectedKind: 'mail' | null,
): ContextSource {
  const entryQuery = useQuery({
    queryKey: ['ledger-entry', selectedId],
    queryFn: () => api.getLedgerEntry(selectedId!),
    enabled: selectedId != null && selectedKind === 'mail',
  })

  const entry = selectedKind === 'mail' ? entryQuery.data : undefined
  const source = entry ?? null

  const people = source ? resolvePeople(source) : { primary: null, siblings: [] }
  const peopleCount = people.primary ? 1 + people.siblings.length : 0
  const bookRefs = entry ? extractBookRefs(entry.notes_html ?? '') : []
  const attachments = entry?.attachments ?? []

  const isLoading =
    selectedKind === 'mail' && entryQuery.isPending && selectedId != null

  return { entry, people, peopleCount, bookRefs, attachments, isLoading }
}
