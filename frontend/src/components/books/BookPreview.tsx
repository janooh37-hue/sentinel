/**
 * BookPreview — light, centered modal for a NO-CHAIN (draft) book.
 *
 * Unlike BookDetailDrawer (the side-panel/bottom-sheet with the version history
 * and approval timeline), this surface shows just the current document plus a
 * single primary action — "Submit for signature". It is the desktop open target
 * for draft rows (`approval_state === 'none'`); chain rows route to the full
 * record page instead, and mobile keeps the drawer.
 *
 * Props mirror BookDetailDrawer's shape so BooksPage can swap them freely.
 */

import { Suspense, lazy, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import * as Dialog from '@radix-ui/react-dialog'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ExternalLink, Loader2, PencilLine, Send, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'

import { api } from '@/lib/api'
import { useCapabilities } from '@/lib/useCapabilities'
import { cn } from '@/lib/utils'

const DocPdfCanvas = lazy(() => import('@/pages/application/DocPdfCanvas'))

interface Props {
  bookId: number | null
  onClose: () => void
  onSubmitForApproval: (bookId: number) => void
}

export function BookPreview({ bookId, onClose, onSubmitForApproval }: Props): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const isAr = i18n.language.startsWith('ar')
  const { has } = useCapabilities()
  const canManage = has('books.manage')
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [confirming, setConfirming] = useState<{ bookId: number | null; value: boolean }>({ bookId, value: false })
  const isConfirming = confirming.bookId === bookId && confirming.value

  const { data: book, isPending } = useQuery({
    queryKey: ['books', 'detail', bookId],
    queryFn: () => api.getBook(bookId!),
    enabled: bookId !== null,
  })

  const discardMutation = useMutation({
    mutationFn: () => api.deleteBook(book!.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['books'] })
      void qc.invalidateQueries({ queryKey: ['dashboard'] })
      toast.success(t('books.toast.deleted'))
      onClose()
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
  })

  const versions = book?.versions ?? []
  const current = versions.length > 0 ? versions[versions.length - 1] : undefined
  const pdfUrl = current?.document_id
    ? `/api/v1/documents/${current.document_id}/download?format=pdf`
    : null

  return (
    <Dialog.Root open={bookId !== null} onOpenChange={(open) => { if (!open) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay
          className={cn(
            'fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-300',
            'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-200',
            'motion-reduce:animate-none',
          )}
        />
        <Dialog.Content
          className={cn(
            // `.bottom-sheet` carries the motion: slide-up on mobile, zoom+fade
            // (centered) above md — reduced-motion guarded in index.css.
            'bottom-sheet fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col rounded-t-2xl bg-surface shadow-2xl',
            'focus-visible:outline-none',
            'md:inset-auto md:left-1/2 md:top-1/2 md:max-h-[88dvh] md:w-full md:max-w-2xl',
            'md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-2xl',
          )}
          aria-modal
        >
          {/* grabber (mobile) */}
          <span aria-hidden className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-hairline md:hidden" />

          {/* header */}
          <header className="flex items-center gap-2.5 border-b border-hairline px-5 py-3.5">
            {book?.ref_number && (
              <span className="rounded-md bg-surface-tinted px-2 py-0.5 font-mono text-[0.78em] font-semibold text-foreground">
                {book.ref_number}
              </span>
            )}
            <span className="min-w-0 flex-1 truncate text-[0.82em] text-foreground" dir="auto">
              {book?.subject ?? (
                <span className="text-muted-foreground">
                  {isAr ? book?.category?.name_ar ?? book?.category?.name_en : book?.category?.name_en}
                </span>
              )}
            </span>
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-warning-soft px-2 py-0.5 text-[0.7em] font-semibold text-warning">
              <PencilLine className="h-3 w-3" strokeWidth={2} aria-hidden />
              {t('books.preview.draftBadge')}
            </span>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label={t('common.close')}
                className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-surface-tinted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="h-4 w-4" strokeWidth={2} />
              </button>
            </Dialog.Close>
          </header>

          {/* document */}
          <div
            className="min-h-0 flex-1 overflow-y-auto px-5 py-5"
            style={{
              background:
                'radial-gradient(150% 100% at 40% -10%, var(--surface) 0%, var(--surface-tinted) 70%, var(--bg) 100%)',
            }}
          >
            <div className="relative mx-auto w-full max-w-[620px]">
              {pdfUrl ? (
                <Suspense
                  fallback={
                    <div className="flex min-h-[300px] items-center justify-center text-muted-foreground">
                      <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
                    </div>
                  }
                >
                  <DocPdfCanvas pdfUrl={pdfUrl} />
                </Suspense>
              ) : (
                <div className="flex min-h-[300px] items-center justify-center text-[0.85em] text-muted-foreground">
                  {isPending ? (
                    <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
                  ) : (
                    t('books.preview.noDocument')
                  )}
                </div>
              )}
            </div>
          </div>

          {/* footer */}
          {book && (
            <footer className="flex flex-wrap items-center gap-2.5 border-t border-hairline px-5 py-4">
              {isConfirming ? (
                <>
                  <span className="text-[0.82em] text-foreground">{t('books.preview.discardConfirmTitle')}</span>
                  <span className="text-[0.78em] text-muted-foreground">{t('books.preview.discardConfirmBody')}</span>
                  <div className="ms-auto flex items-center gap-2">
                    <button type="button" onClick={() => setConfirming({ bookId, value: false })}
                      className="inline-flex h-9 items-center rounded-lg border border-hairline px-3 text-[0.82em] font-medium text-muted-foreground transition-colors hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      {t('common.cancel')}
                    </button>
                    <button type="button" disabled={discardMutation.isPending} onClick={() => discardMutation.mutate()}
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-destructive px-4 text-[0.82em] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40">
                      <Trash2 className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                      {t('books.preview.discard')}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  {pdfUrl && (
                    <a href={pdfUrl} target="_blank" rel="noopener noreferrer"
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-hairline px-3 text-[0.82em] font-medium text-foreground transition-colors hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
                      {t('books.preview.openPdf')}
                    </a>
                  )}
                  {canManage && (
                    <div className="ms-auto flex items-center gap-2.5">
                      <button type="button" onClick={() => setConfirming({ bookId, value: true })}
                        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-hairline px-3 text-[0.82em] font-medium text-muted-foreground transition-colors hover:border-destructive hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
                        {t('books.preview.discard')}
                      </button>
                      <button type="button"
                        disabled={!current?.has_fields}
                        title={!current?.has_fields ? t('books.preview.editUnavailable') : undefined}
                        onClick={() => {
                          if (!current?.template_id) return
                          onClose()
                          navigate(`/application?form=${encodeURIComponent(current.template_id)}`, { state: { reviseBookId: book.id } })
                        }}
                        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-hairline px-3 text-[0.82em] font-medium text-foreground transition-colors hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40">
                        <PencilLine className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
                        {t('books.preview.editContinue')}
                      </button>
                      <button type="button" onClick={() => onSubmitForApproval(book.id)}
                        className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-[0.82em] font-semibold text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        <Send className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                        {t('books.approval.submitForApproval')}
                      </button>
                    </div>
                  )}
                </>
              )}
            </footer>
          )}

          <Dialog.Title className="sr-only">{book?.ref_number ?? t('books.title')}</Dialog.Title>
          <Dialog.Description className="sr-only">{t('books.preview.description')}</Dialog.Description>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
