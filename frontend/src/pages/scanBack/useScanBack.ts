/**
 * Shared data layer for every scan-back surface (page, dock, gate).
 *
 * One query key so filing from any surface refreshes all of them. Gated on
 * `books.manage` — the capability POST /books/{id}/attachments requires. A user
 * without it would get rows whose upload 403s, so they get nothing instead;
 * their stranded records surface under the Everyone scope for an admin.
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { api, apiErrorMessage, type BookRead } from '@/lib/api'
import { useCapabilities } from '@/lib/useCapabilities'

export type AgeGroup = 'overMonth' | 'weeks' | 'recent'

/**
 * Whole days since `iso`. `Book.created_at` is stored naive LOCAL (Asia/Dubai,
 * `datetime.now()`, not UTC) but is never serialized bare: `ORMBase._tag_timezone`
 * (`backend/app/schemas/_base.py`) tags it with an explicit `+04:00` offset before
 * it hits the wire (`backend/app/schemas/book.py` LOCAL_WALLCLOCK_FIELDS), so JS
 * parses it as the correct absolute instant. The `' '`→`'T'` swap is a defensive
 * fallback for any legacy naive ("YYYY-MM-DD HH:MM:SS") shape, which also keeps
 * Safari from returning NaN. We deliberately never append 'Z': for a naive local
 * value that's the +4h regression this field once shipped (f111177); for an
 * already-offset-tagged value it produces an invalid, doubly-suffixed string.
 */
export function ageDays(iso: string): number {
  const ms = Date.now() - new Date(iso.replace(' ', 'T')).getTime()
  return Math.floor(ms / 86_400_000)
}

export function ageGroup(days: number): AgeGroup {
  if (days >= 30) return 'overMonth'
  if (days >= 14) return 'weeks'
  return 'recent'
}

export function useScanBack(scope: 'mine' | 'all' = 'mine'): {
  books: BookRead[]
  isLoading: boolean
  count: number
  enabled: boolean
} {
  const { has } = useCapabilities()
  const enabled = has('books.manage')
  const query = useQuery({
    queryKey: ['books', 'awaiting-scan', scope],
    queryFn: () => api.listAwaitingScanBooks(scope),
    staleTime: 30_000,
    enabled,
  })
  const books = query.data ?? []
  return { books, isLoading: query.isLoading, count: books.length, enabled }
}

export function useFileSignedCopy(): {
  file: (bookId: number, ref: string, f: File) => Promise<void>
  busy: boolean
} {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)

  // as_signed=true is the scan-back flip: the backend approves the record.
  // Same call `useAddScan.fileSignedCopy` makes — no OCR ref matching, because
  // the operator picked this record deliberately and OCR cannot be trusted to
  // re-read a stamped ref off a gov-form scan (GS-0333 -> "65-3").
  const mutation = useMutation({
    // `ref` is unused by the call itself — it rides along so onSuccess can name
    // the record in the toast without a second lookup.
    mutationFn: ({ bookId, f }: { bookId: number; ref: string; f: File }) =>
      api.addBookAttachment(bookId, f, true),
    onSuccess: (_data: unknown, vars: { bookId: number; ref: string; f: File }) => {
      void qc.invalidateQueries({ queryKey: ['books'] })
      void qc.invalidateQueries({ queryKey: ['notifications', 'counts'] })
      toast.success(t('scanBack.filed', { ref: vars.ref }))
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  })

  return {
    busy,
    file: async (bookId, ref, f) => {
      setBusy(true)
      try {
        await mutation.mutateAsync({ bookId, ref, f })
      } finally {
        setBusy(false)
      }
    },
  }
}
