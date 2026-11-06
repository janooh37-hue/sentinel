import { lazy, Suspense, useState } from 'react'
import { Maximize, ZoomIn, ZoomOut } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// Keep pdf.js and its worker in the preview chunk, as in the document viewer.
const DocPdfCanvas = lazy(() => import('@/pages/application/DocPdfCanvas'))

export function LedgerPaperPdf({ url, title, className }: {
  url: string | null
  title?: string
  className?: string
}): React.JSX.Element {
  return <PaperPreview key={url} url={url} title={title} className={className} />
}

function PaperPreview({ url, title, className }: {
  url: string | null
  title?: string
  className?: string
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const [zoom, setZoom] = useState(100)
  const [position, setPosition] = useState({ page: 1, total: 0 })
  const label = title ?? t('ledgerBook.paper.title')
  const loading = <div role="status" aria-label={t('ledgerBook.paper.loading')} className="grid min-h-64 place-items-center p-6 text-sm text-muted-foreground">{t('ledgerBook.paper.loading')}</div>

  return (
    <section role="region" aria-label={label} dir={i18n.dir()} className={cn('flex min-h-0 min-w-0 flex-col overflow-hidden rounded-md border border-border bg-surface-tinted', className)}>
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border bg-surface px-2 py-1.5">
        <span role="status" className="me-auto px-1 text-sm tabular-nums">
          {position.total > 0 ? t('ledgerBook.paper.pageCount', position) : t('ledgerBook.paper.title')}
        </span>
        <Button type="button" size="icon" variant="ghost" className="min-h-11 min-w-11" aria-label={t('ledgerBook.paper.fitWidth')} onClick={() => setZoom(100)}>
          <Maximize className="size-4" aria-hidden="true" />
        </Button>
        <Button type="button" size="icon" variant="ghost" className="min-h-11 min-w-11" aria-label={t('ledgerBook.paper.zoomOut')} disabled={zoom <= 50} onClick={() => setZoom((value) => Math.max(50, value - 25))}>
          <ZoomOut className="size-4" aria-hidden="true" />
        </Button>
        <bdi dir="ltr" className="text-xs tabular-nums">{zoom}%</bdi>
        <Button type="button" size="icon" variant="ghost" className="min-h-11 min-w-11" aria-label={t('ledgerBook.paper.zoomIn')} disabled={zoom >= 250} onClick={() => setZoom((value) => Math.min(250, value + 25))}>
          <ZoomIn className="size-4" aria-hidden="true" />
        </Button>
      </div>
      <div role="region" aria-label={t('ledgerBook.paper.pagesLabel', { title: label })} tabIndex={0} className="min-h-0 min-w-0 flex-1 overflow-auto p-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
        {url ? (
          <div data-ledger-pdf-width className="mx-auto" style={{ width: `${zoom}%` }}>
            <Suspense fallback={loading}>
              <DocPdfCanvas pdfUrl={url} bare sizing="fit" onPageChange={(page, total) => setPosition((current) => current.page === page && current.total === total ? current : { page, total })} />
            </Suspense>
          </div>
        ) : loading}
      </div>
    </section>
  )
}
