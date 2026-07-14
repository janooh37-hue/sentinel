// frontend/src/pages/announcements/RecordAnnouncePicker.tsx
/**
 * RecordAnnouncePicker — search records and attach one to a group announcement.
 *
 * Left: debounced record search (api.listBooks). Right: a pdf.js preview of the
 * selected record's current PDF (DocPdfCanvas — WebView2-safe base64 canvas,
 * same renderer the doc-generation preview uses). Records with no resolvable
 * PDF can't be confirmed — we fail here instead of after the send, which is
 * where the backend would raise BookPdfError.
 *
 * Bilingual via useTranslation(); logical CSS; dir="auto" on record text.
 */
import { lazy, Suspense, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'

import { api, type BookRead } from '@/lib/api'
import { currentBookDocId } from '@/lib/bookDocument'

const DocPdfCanvas = lazy(() => import('@/pages/application/DocPdfCanvas'))

export interface PickedBook {
  id: number
  ref: string
  subject: string
}

export function RecordAnnouncePicker({
  open,
  onClose,
  onPick,
}: {
  open: boolean
  onClose: () => void
  onPick: (book: PickedBook) => void
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState<BookRead | null>(null)

  const booksQuery = useQuery({
    queryKey: ['announce-record-picker', q],
    queryFn: () => api.listBooks({ q, limit: 20 }),
    enabled: open,
    staleTime: 30_000,
  })

  const docId = selected ? currentBookDocId(selected) : undefined
  const pdfUrl = docId != null ? api.documentDownloadUrl(docId, 'pdf') : null

  if (!open) return null

  const rowCls = (active: boolean): string =>
    `w-full rounded-md border px-3 py-2 text-start ${
      active ? 'border-primary bg-primary/5' : 'border-border hover:bg-surface-tinted'
    }`

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t('sendToGroup.picker.title')}
    >
      <div className="flex max-h-[85vh] w-full max-w-[820px] flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-xl md:flex-row">
        {/* Left: search + results */}
        <div className="flex min-h-0 flex-1 flex-col border-b border-hairline p-3 md:border-b-0 md:border-e">
          <div className="mb-2 flex items-center gap-2">
            <input
              type="text"
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('sendToGroup.picker.searchPlaceholder')}
              dir="auto"
              className="h-9 flex-1 rounded-md border border-border bg-surface px-3 text-[0.85em] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            />
            <button
              type="button"
              onClick={onClose}
              aria-label={t('sendToGroup.picker.close')}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-surface-tinted"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
          <ul className="min-h-0 flex-1 space-y-1 overflow-auto">
            {(booksQuery.data?.items ?? []).map((b) => (
              <li key={b.id}>
                <button type="button" onClick={() => setSelected(b)} className={rowCls(selected?.id === b.id)}>
                  <span className="block text-[0.85em] font-medium text-foreground" dir="auto">
                    {b.ref_number}
                  </span>
                  <span className="block text-[0.78em] text-muted-foreground" dir="auto">
                    {b.subject ?? ''}
                  </span>
                </button>
              </li>
            ))}
            {booksQuery.data && booksQuery.data.items.length === 0 && (
              <li className="px-3 py-2 text-[0.82em] text-muted-foreground" dir="auto">
                {t('sendToGroup.picker.noResults')}
              </li>
            )}
          </ul>
        </div>

        {/* Right: preview + confirm */}
        <div className="flex min-h-0 flex-1 flex-col p-3 md:w-[48%]">
          <div className="min-h-0 flex-1">
            {!selected ? (
              <p className="flex h-full items-center justify-center text-[0.82em] text-muted-foreground" dir="auto">
                {t('sendToGroup.picker.selectHint')}
              </p>
            ) : pdfUrl ? (
              <Suspense fallback={<div className="h-full w-full animate-pulse bg-surface-tinted" />}>
                <DocPdfCanvas pdfUrl={pdfUrl} />
              </Suspense>
            ) : (
              <p className="flex h-full items-center justify-center text-center text-[0.82em] text-muted-foreground" dir="auto">
                {t('sendToGroup.picker.noDocument')}
              </p>
            )}
          </div>
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              disabled={!selected || !pdfUrl}
              onClick={() => {
                if (selected && pdfUrl) {
                  onPick({ id: selected.id, ref: selected.ref_number, subject: selected.subject ?? '' })
                }
              }}
              className="rounded-md bg-primary px-4 py-2 text-[0.85em] font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {t('sendToGroup.picker.confirm')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
