/**
 * PermitQuickView — light summary of a permit: header + facts render instantly
 * from the list row; the letter PDF loads in parallel from the shared permit
 * book query. Bottom sheet below md, centred modal from md up.
 */
import { Suspense, lazy } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ExternalLink, Loader2, X } from 'lucide-react'

import { paperUrl } from '@/pages/books/recordPapers'
import { cn } from '@/lib/utils'
import { permitBookQuery } from './permitUtils'

const DocPdfCanvas = lazy(() => import('@/pages/application/DocPdfCanvas'))

interface Props {
  open: boolean
  onClose: () => void
  /** permit_no / book_ref, shown in a mono LTR chip. */
  reference: string
  /** Company / employee name. */
  title: string
  status?: React.ReactNode
  facts: { label: string; value: React.ReactNode }[]
  /** Letter source; null → "no letter yet". */
  bookId: number | null
  /** Opens the existing full detail dialog. */
  onOpenFull: () => void
}

const btnBase =
  'inline-flex items-center justify-center gap-1.5 rounded-lg px-3 text-[0.82em] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring h-9 max-md:min-h-11'

function Spinner(): React.JSX.Element {
  return (
    <div className="flex min-h-[300px] items-center justify-center text-muted-foreground">
      <Loader2 className="h-6 w-6 animate-spin motion-reduce:animate-none" aria-hidden />
    </div>
  )
}

export function PermitQuickView({
  open,
  onClose,
  reference,
  title,
  status,
  facts,
  bookId,
  onOpenFull,
}: Props): React.JSX.Element {
  const { t } = useTranslation()

  const {
    data: book,
    isPending,
    isError,
    refetch,
  } = useQuery({ ...permitBookQuery(bookId ?? 0), enabled: open && bookId !== null })

  const versions = book?.versions ?? []
  const current =
    versions.length > 0 ? versions.reduce((a, b) => (b.version_no >= a.version_no ? b : a)) : undefined
  const pdfUrl = current?.document_id
    ? paperUrl({ documentId: current.document_id, signed: Boolean(current.signed_pdf_url) })
    : null

  let letter: React.ReactNode
  if (bookId === null) {
    letter = <Empty>{t('permits.quickView.noLetter')}</Empty>
  } else if (isError) {
    letter = (
      <div className="flex min-h-[300px] flex-col items-center justify-center gap-3 text-center">
        <p role="alert" className="text-[0.85em] text-muted-foreground">
          {t('permits.quickView.letterError')}
        </p>
        <button
          type="button"
          onClick={() => void refetch()}
          className={cn(btnBase, 'border border-hairline text-foreground hover:bg-surface-tinted')}
        >
          {t('common.retry')}
        </button>
      </div>
    )
  } else if (isPending) {
    letter = <Spinner />
  } else if (pdfUrl) {
    letter = (
      <Suspense fallback={<Spinner />}>
        <DocPdfCanvas pdfUrl={pdfUrl} />
      </Suspense>
    )
  } else {
    letter = <Empty>{t('permits.quickView.noLetter')}</Empty>
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose() }}>
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
            'bottom-sheet fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col rounded-t-2xl bg-surface shadow-2xl',
            'focus-visible:outline-none',
            'md:inset-auto md:left-1/2 md:top-1/2 md:max-h-[88dvh] md:w-full md:max-w-3xl',
            'md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-2xl',
          )}
        >
          <span aria-hidden className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-hairline md:hidden" />

          <header className="flex items-center gap-2.5 border-b border-hairline px-5 py-3.5">
            <Dialog.Title className="flex min-w-0 flex-1 items-center gap-2.5 text-[0.82em] font-normal">
              <span
                dir="ltr"
                className="shrink-0 rounded-md bg-surface-tinted px-2 py-0.5 font-mono text-[0.95em] font-semibold text-foreground"
              >
                {reference}
              </span>
              <span className="min-w-0 truncate text-foreground" dir="auto">
                {title}
              </span>
            </Dialog.Title>
            {status && <div className="flex shrink-0 items-center gap-1.5">{status}</div>}
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label={t('common.close')}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-surface-tinted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:h-8 md:w-8"
              >
                <X className="h-4 w-4" strokeWidth={2} aria-hidden />
              </button>
            </Dialog.Close>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 px-5 py-4 sm:grid-cols-4">
              {facts.map((f, i) => (
                <div key={i} className="min-w-0">
                  <dt className="text-[0.72em] text-muted-foreground">{f.label}</dt>
                  <dd className="mt-0.5 text-[0.85em] text-foreground">
                    {f.value}
                  </dd>
                </div>
              ))}
            </dl>

            <section
              aria-label={t('permits.quickView.letter')}
              className="border-t border-hairline px-5 py-4"
              style={{
                background:
                  'radial-gradient(150% 100% at 40% -10%, var(--surface) 0%, var(--surface-tinted) 70%, var(--bg) 100%)',
              }}
            >
              <h3 className="mb-3 text-[0.78em] font-semibold text-muted-foreground">
                {t('permits.quickView.letter')}
              </h3>
              <div className="relative mx-auto w-full max-w-[620px]">{letter}</div>
            </section>
          </div>

          <footer className="flex flex-wrap items-center gap-2.5 border-t border-hairline px-5 py-4">
            {pdfUrl && (
              <a
                href={pdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(btnBase, 'border border-hairline text-foreground hover:bg-surface-tinted')}
              >
                <ExternalLink className="h-3.5 w-3.5 rtl:-scale-x-100" strokeWidth={1.8} aria-hidden />
                {t('permits.quickView.openPdf')}
              </a>
            )}
            <button
              type="button"
              onClick={onOpenFull}
              className={cn(btnBase, 'ms-auto bg-primary px-4 font-semibold text-primary-foreground hover:bg-primary-hover')}
            >
              {t('permits.quickView.openFull')}
            </button>
          </footer>

          <Dialog.Description className="sr-only">{t('permits.quickView.description')}</Dialog.Description>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function Empty({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex min-h-[200px] items-center justify-center text-center text-[0.85em] text-muted-foreground">
      {children}
    </div>
  )
}
