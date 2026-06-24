/**
 * StarButton — toggle the ★ tag on a ledger entry.
 *
 * Optimistic mutation: the icon flips immediately on click and is reverted if
 * the server call fails. The ★ marker lives inside the entry's `tags` array;
 * the backend `POST /ledger/entries/{id}/star` endpoint adds or removes it.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Star } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { api, ApiError } from '@/lib/api'
import type { LedgerEntryRead, LedgerListItem } from '@/lib/api'
import { cn } from '@/lib/utils'

interface StarButtonProps {
  entryId: number
  starred: boolean
  className?: string
}

export function StarButton({ entryId, starred, className }: StarButtonProps): React.JSX.Element {
  const { t } = useTranslation()
  const qc = useQueryClient()

  const mutation = useMutation({
    mutationFn: () => api.toggleLedgerStar(entryId),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: ['ledger-entry', entryId] })
      const prev = qc.getQueryData<LedgerEntryRead>(['ledger-entry', entryId])
      if (prev) {
        const nextTags = starred
          ? prev.tags.filter((x) => x !== 'starred')
          : [...prev.tags, 'starred']
        qc.setQueryData<LedgerEntryRead>(['ledger-entry', entryId], {
          ...prev,
          tags: nextTags,
        })
      }
      // Also tweak any cached list entries so the timeline row updates with
      // no flicker. Lists are stored under variants of the ['ledger', params]
      // key — walk the cache.
      qc.getQueriesData<{ items: LedgerListItem[]; total: number; limit: number; offset: number }>(
        { queryKey: ['ledger'] },
      ).forEach(([key, data]) => {
        if (!data?.items) return
        qc.setQueryData(key, {
          ...data,
          items: data.items.map((it) =>
            it.id === entryId
              ? {
                  ...it,
                  tags: starred
                    ? it.tags.filter((x) => x !== 'starred')
                    : [...it.tags, 'starred'],
                }
              : it,
          ),
        })
      })
      return { prev }
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.prev) {
        qc.setQueryData<LedgerEntryRead>(['ledger-entry', entryId], ctx.prev)
      }
      void qc.invalidateQueries({ queryKey: ['ledger'] })
      toast.error(err instanceof ApiError ? err.message : String(err))
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['ledger-entry', entryId] })
      void qc.invalidateQueries({ queryKey: ['ledger'] })
    },
  })

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        mutation.mutate()
      }}
      aria-label={t('ledger.star.toggle')}
      aria-pressed={starred}
      title={t('ledger.star.toggle')}
      className={cn(
        'inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        starred
          ? 'text-warning hover:bg-warning-soft'
          : 'text-muted-foreground hover:bg-surface-tinted hover:text-foreground',
        className,
      )}
    >
      <Star
        className="h-4 w-4"
        strokeWidth={1.7}
        fill={starred ? 'currentColor' : 'none'}
      />
    </button>
  )
}
