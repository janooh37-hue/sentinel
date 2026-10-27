import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Search } from 'lucide-react'
import { toast } from '@/lib/toast'

import { api, ApiError, apiErrorMessage, type BookRead } from '@/lib/api'
import { useCapabilities } from '@/lib/useCapabilities'
import {
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogRoot,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { GradeChip } from './GradeChip'

const LINK_ERROR_KEYS: Record<string, string | undefined> = {
  LINK_EXISTS: 'books.thread.errors.linkExists',
  LINK_SELF: 'books.thread.errors.linkSelf',
  GRADE_BELOW_FLOOR: 'books.thread.errors.levelBelowFloor',
  BOOK_NOT_FOUND: 'books.thread.errors.bookNotFound',
}

interface Props {
  book: BookRead
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function LinkRecordDialog({ book, open, onOpenChange }: Props): React.JSX.Element | null {
  const { has } = useCapabilities()
  const canEdit = has('books.edit') && book.can_write
  if (!canEdit || book.access_scope !== 'full') return null
  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      {open ? <LinkBody key={book.id} book={book} close={() => onOpenChange(false)} /> : null}
    </DialogRoot>
  )
}

function LinkBody({ book, close }: { book: BookRead; close: () => void }): React.JSX.Element {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQ(q), 300)
    return () => window.clearTimeout(timer)
  }, [q])

  const booksQuery = useQuery({
    queryKey: ['books', 'link-picker', debouncedQ],
    queryFn: () => api.listBooks({ q: debouncedQ.trim() || undefined, limit: 20 }),
    staleTime: 30_000,
  })
  const books = (booksQuery.data?.items ?? []).filter((candidate) => candidate.id !== book.id && candidate.access_scope === 'full')

  const mutation = useMutation({
    mutationFn: (targetId: number) => api.linkBook(book.id, { target_book_id: targetId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['books', 'thread', book.id] })
      void qc.invalidateQueries({ queryKey: ['books', 'detail', book.id] })
      close()
    },
    onError: (err) => {
      const key = err instanceof ApiError ? LINK_ERROR_KEYS[err.code] : undefined
      toast.error(key ? t(key) : apiErrorMessage(err))
    },
  })

  return (
    <DialogContent className="!inset-x-0 !bottom-0 !top-auto max-w-none !translate-x-0 !translate-y-0 rounded-b-none md:!inset-x-auto md:!start-1/2 md:!bottom-auto md:!top-1/2 md:max-w-xl md:!-translate-x-1/2 md:!-translate-y-1/2 rtl:md:!translate-x-1/2 md:rounded-b-2xl">
      <DialogHeader>
        <DialogTitle>{t('books.thread.linkTitle')}</DialogTitle>
        <DialogDescription>{t('books.thread.linkDescription')}</DialogDescription>
      </DialogHeader>

      <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
        <label className="relative block">
          <Search
            className="pointer-events-none absolute start-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
            strokeWidth={1.8}
            aria-hidden
          />
          <Input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('books.thread.linkSearch')}
            aria-label={t('books.thread.linkSearch')}
            className="ps-9"
            disabled={mutation.isPending}
            autoFocus
          />
        </label>

        {mutation.isPending ? (
          <p role="status" className="text-[0.82em] text-muted-foreground">
            {t('books.thread.linking')}
          </p>
        ) : null}

        <div
          className="min-h-[200px] max-h-[50vh] overflow-y-auto rounded-lg border border-hairline"
          aria-busy={booksQuery.isFetching || mutation.isPending}
        >
          {booksQuery.isLoading ? (
            <div className="space-y-2 p-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full rounded-md" />
              ))}
            </div>
          ) : booksQuery.isError ? (
            <p role="alert" className="px-3 py-8 text-center text-[0.82em] text-accent">
              {apiErrorMessage(booksQuery.error)}
            </p>
          ) : books.length === 0 ? (
            <p className="px-3 py-8 text-center text-[0.82em] text-muted-foreground">
              {t('books.thread.linkEmpty')}
            </p>
          ) : (
            <ul className="divide-y divide-hairline">
              {books.map((candidate) => (
                <li key={candidate.id}>
                  <button
                    type="button"
                    onClick={() => mutation.mutate(candidate.id)}
                    disabled={mutation.isPending}
                    className="flex min-h-11 w-full items-center gap-2.5 px-3 py-2.5 text-start transition-colors hover:bg-surface-tinted active:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block font-mono text-[0.78em] font-semibold tabular-nums text-foreground" dir="ltr">
                        {candidate.ref_number}
                      </span>
                      <span className="block truncate text-[0.82em] text-muted-foreground" dir="auto">
                        {candidate.subject ?? '—'}
                      </span>
                    </span>
                    <GradeChip level={candidate.grade} className="shrink-0" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </DialogContent>
  )
}
