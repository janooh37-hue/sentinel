/**
 * ScanMatchDialog — match one scanned document to an employee or a record.
 *
 * Left: the incoming scan (inline preview). Right: a debounced search over
 * employees + books; picking a result files the scan there via
 * `POST /scan-inbox/{id}/route`. The load-bearing "couldn't match → route it"
 * action for unrouted / couldn't-read items.
 */

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { api, ApiError } from '@/lib/api'
import type { ScanInboxItem } from '@/lib/api'
import { pickEmployeeName } from '@/lib/employeeName'
import { ScanPreview } from './ScanPreview'

export function ScanMatchDialog({
  item,
  onClose,
}: {
  item: ScanInboxItem
  onClose: () => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const qc = useQueryClient()
  const [raw, setRaw] = useState('')
  const [q, setQ] = useState('')

  useEffect(() => {
    const id = window.setTimeout(() => setQ(raw.trim()), 200)
    return () => window.clearTimeout(id)
  }, [raw])

  const books = useQuery({
    queryKey: ['scan-match-books', q],
    queryFn: () => api.listBooks({ q, limit: 8 }),
    enabled: q.length > 0,
    staleTime: 30_000,
  })
  const employees = useQuery({
    queryKey: ['scan-match-employees', q],
    queryFn: () => api.listEmployees({ q, limit: 8 }),
    enabled: q.length > 0,
    staleTime: 30_000,
  })

  const route = useMutation({
    mutationFn: (body: { employee_id?: string; book_id?: number }) =>
      api.routeScanItem(item.id, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['scan-inbox'] })
      toast.success(t('scanInbox.toast.filed'))
      onClose()
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('scanInbox.toast.error')),
  })

  const bookRows = books.data?.items ?? []
  const empRows = employees.data?.items ?? []

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="flex max-h-[85vh] w-full max-w-[820px] flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-xl md:flex-row">
        {/* Scan preview: strip above search on mobile, side pane on md+ */}
        <div className="flex-none border-b border-hairline bg-surface-raised p-3 md:w-[45%] md:border-b-0 md:border-e">
          <div className="mx-auto max-w-[220px] md:max-w-none">
            <ScanPreview itemId={item.id} filename={item.filename} variant="dialog" />
          </div>
        </div>

        {/* Search */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="border-b border-hairline p-3">
            <div className="mb-2 text-sm font-semibold text-foreground">{t('scanInbox.match.title')}</div>
            <input
              autoFocus
              dir="auto"
              type="text"
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && onClose()}
              placeholder={t('scanInbox.match.searchPlaceholder')}
              aria-label={t('scanInbox.match.searchPlaceholder')}
              className="w-full rounded-md border border-border-strong bg-surface px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto py-1">
            {empRows.length > 0 && (
              <div>
                <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-faint">
                  {t('scanInbox.match.employees')}
                </div>
                {empRows.map((e) => (
                  <button
                    key={`e-${e.id}`}
                    type="button"
                    disabled={route.isPending}
                    onClick={() => route.mutate({ employee_id: e.id })}
                    className="flex w-full items-center gap-2.5 px-3 py-1.5 text-start text-sm hover:bg-surface-tinted"
                  >
                    <span className="flex-none rounded-sm bg-primary-soft px-1.5 py-0.5 font-mono text-[10px] font-bold text-primary">
                      {e.id}
                    </span>
                    <span className="min-w-0 truncate" dir="auto">
                      {pickEmployeeName(e, i18n.language)}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {bookRows.length > 0 && (
              <div>
                <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-faint">
                  {t('scanInbox.match.records')}
                </div>
                {bookRows.map((b) => (
                  <button
                    key={`b-${b.id}`}
                    type="button"
                    disabled={route.isPending}
                    onClick={() => route.mutate({ book_id: b.id })}
                    className="flex w-full items-center gap-2.5 px-3 py-1.5 text-start text-sm hover:bg-surface-tinted"
                  >
                    <span className="flex-none rounded-sm bg-accent-soft px-1.5 py-0.5 font-mono text-[10px] font-bold text-accent">
                      {b.ref_number}
                    </span>
                    <span className="min-w-0 truncate" dir="auto">
                      {b.subject ?? ''}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {q.length > 0 && empRows.length === 0 && bookRows.length === 0 && !employees.isLoading && !books.isLoading && (
              <p className="px-3 py-4 text-center text-xs text-faint">{t('scanInbox.match.noResults')}</p>
            )}
          </div>

          <div className="flex justify-end border-t border-hairline p-2.5">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-surface-tinted"
            >
              {t('scanInbox.match.cancel')}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
