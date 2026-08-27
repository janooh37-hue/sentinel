import { lazy, Suspense } from 'react'
import type { RefObject } from 'react'
import { useNavigate } from 'react-router-dom'
import * as Dialog from '@radix-ui/react-dialog'
import { useTranslation } from 'react-i18next'
import { Loader2, X } from 'lucide-react'

import { api } from '@/lib/api'
import type { ApprovalLogItem } from '@/lib/api'
import { cn } from '@/lib/utils'

const DocPdfCanvas = lazy(() => import('@/pages/application/DocPdfCanvas'))

interface Props {
  item: ApprovalLogItem | null
  triggerRef: RefObject<HTMLButtonElement | null>
  onClose: () => void
}

export function StatusChip({ item }: { item: ApprovalLogItem }): React.JSX.Element {
  const { t } = useTranslation()
  const variants: Record<string, string> = {
    none: 'bg-warning-soft text-warning',
    pending: 'bg-warning-soft text-warning',
    awaiting_scan: 'bg-info-soft text-info',
    approved: 'bg-success-soft text-success',
    rejected: 'bg-destructive/10 text-destructive',
    returned: 'bg-info-soft text-info',
  }
  const key =
    item.verdict != null
      ? `books.approval.state${item.verdict[0].toUpperCase()}${item.verdict.slice(1)}`
      : item.status === 'awaiting_scan'
        ? 'books.approval.stateAwaitingScan'
        : item.status === 'none'
          ? 'books.approval.stateDraft'
          : `books.approval.state${item.status[0].toUpperCase()}${item.status.slice(1)}`

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-[0.72em] font-semibold uppercase tracking-[0.06em]',
        variants[item.status] ?? 'bg-surface-tinted text-muted-foreground',
      )}
    >
      {t(key)}
    </span>
  )
}

export function ApprovalPreviewDialog({ item, triggerRef, onClose }: Props): React.JSX.Element {
  const { t } = useTranslation()
  const navigate = useNavigate()

  return (
    <Dialog.Root open={item !== null} onOpenChange={(open) => !open && onClose()}>
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
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            triggerRef.current?.focus()
          }}
          className={cn(
            'bottom-sheet fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col rounded-t-2xl bg-surface shadow-2xl',
            'focus-visible:outline-none',
            'md:inset-auto md:left-1/2 md:top-1/2 md:max-h-[88dvh] md:w-full md:max-w-4xl',
            'md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-2xl',
          )}
        >
          <span
            aria-hidden
            className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-hairline md:hidden"
          />

          {item && (
            <>
              <header className="flex items-center gap-2.5 border-b border-hairline px-5 py-3.5">
                <span className="shrink-0 rounded-md bg-surface-tinted px-2 py-0.5 font-mono text-[0.78em] font-semibold text-foreground">
                  <bdi dir="ltr">{item.ref_number}</bdi>
                </span>
                <span className="min-w-0 flex-1 truncate text-[0.82em] text-foreground" dir="auto">
                  {item.subject ?? '—'}
                </span>
                <StatusChip item={item} />
                <Dialog.Close asChild>
                  <button
                    type="button"
                    aria-label={t('common.close')}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-surface-tinted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <X className="h-4 w-4" strokeWidth={2} aria-hidden />
                  </button>
                </Dialog.Close>
              </header>

              <div
                className="max-h-[70vh] min-h-0 flex-1 overflow-auto px-5 py-5"
                style={{
                  background:
                    'radial-gradient(150% 100% at 40% -10%, var(--surface) 0%, var(--surface-tinted) 70%, var(--bg) 100%)',
                }}
              >
                <div className="relative mx-auto w-full max-w-[760px]">
                  <Suspense
                    fallback={
                      <div className="flex min-h-[300px] items-center justify-center text-muted-foreground">
                        <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
                      </div>
                    }
                  >
                    <DocPdfCanvas
                      pdfUrl={api.documentDownloadUrl(item.document_id!, 'pdf')}
                    />
                  </Suspense>
                </div>
              </div>

              <footer className="flex items-center justify-end gap-2.5 border-t border-hairline px-5 py-4">
                <Dialog.Close asChild>
                  <button
                    type="button"
                    className="inline-flex h-9 items-center rounded-lg border border-hairline px-3 text-[0.82em] font-medium text-muted-foreground transition-colors hover:bg-surface-tinted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {t('common.close')}
                  </button>
                </Dialog.Close>
                <button
                  type="button"
                  onClick={() => {
                    onClose()
                    navigate(`/books/${item.book_id}`)
                  }}
                  className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-[0.82em] font-semibold text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {t('books.approvals.openRecord')}
                </button>
              </footer>
            </>
          )}

          <Dialog.Title className="sr-only">{t('books.approvals.previewTitle')}</Dialog.Title>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
