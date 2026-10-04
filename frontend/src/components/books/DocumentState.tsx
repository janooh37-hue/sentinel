/**
 * The one empty / loading / error / forbidden panel for a record's document
 * area (desk, pane, full-screen viewer). Renders in the UI language's direction
 * so it stays correct inside the pinned-LTR record body. Map a failed fetch to a
 * kind with `documentErrorKind` (401/403 → `forbidden`).
 */
import { AlertTriangle, Download, ExternalLink, FileText, Loader2, Lock, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { buttonVariants } from '@/components/ui/button-variants'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export type DocumentStateKind = 'empty' | 'loading' | 'error' | 'forbidden'

export function DocumentState({
  kind,
  onRetry,
  openUrl,
  docxUrl,
  title,
  body,
  action,
  className,
}: {
  kind: DocumentStateKind
  /** error only: shows Retry */
  onRetry?: () => void
  /** error only: shows "Open in new tab" */
  openUrl?: string
  /** error only: shows "Download DOCX" */
  docxUrl?: string
  /** overrides the kind's default title */
  title?: React.ReactNode
  /** overrides the kind's default body */
  body?: React.ReactNode
  /** extra control (e.g. the empty state's generate/revise button) */
  action?: React.ReactNode
  className?: string
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const dir = i18n.dir()

  if (kind === 'loading') {
    return (
      <div
        role="status"
        aria-label={t('common.loading')}
        dir={dir}
        className={cn(
          'grid min-h-[300px] w-full place-items-center text-muted-foreground',
          className,
        )}
      >
        <Loader2 className="h-6 w-6 animate-spin motion-reduce:animate-none" aria-hidden />
      </div>
    )
  }

  const Icon = kind === 'forbidden' ? Lock : kind === 'error' ? AlertTriangle : FileText
  const heading =
    title ??
    (kind === 'forbidden'
      ? t('books.paper.errorForbidden')
      : kind === 'error'
        ? t('books.paper.errorTitle')
        : t('books.pane.noPapersTitle'))
  const text =
    body ??
    (kind === 'error'
      ? t('books.paper.errorBody')
      : kind === 'empty'
        ? t('books.pane.noPapersBody')
        : null)
  const linkClass = cn(buttonVariants({ variant: 'secondary', size: 'sm' }))

  return (
    <div
      dir={dir}
      className={cn(
        'flex min-h-[300px] w-full flex-col items-center justify-center gap-2 p-6 text-center',
        className,
      )}
    >
      <Icon
        className={cn('h-8 w-8', kind === 'empty' ? 'text-faint' : 'text-accent')}
        strokeWidth={1.6}
        aria-hidden
      />
      <b className="text-[0.9em] text-foreground">{heading}</b>
      {text ? <p className="max-w-[36ch] text-[0.8em] text-muted-foreground">{text}</p> : null}
      {kind === 'error' && (onRetry || openUrl || docxUrl) ? (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          {onRetry && (
            <Button type="button" size="sm" onClick={onRetry}>
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
              {t('common.retry')}
            </Button>
          )}
          {openUrl && (
            <a href={openUrl} target="_blank" rel="noopener noreferrer" className={linkClass}>
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              {t('books.paper.openNewTab')}
            </a>
          )}
          {docxUrl && (
            <a href={docxUrl} download className={linkClass}>
              <Download className="h-3.5 w-3.5" aria-hidden />
              {t('application.downloadDocx')}
            </a>
          )}
        </div>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  )
}
