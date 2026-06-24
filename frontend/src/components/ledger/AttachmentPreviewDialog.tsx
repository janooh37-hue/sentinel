/**
 * AttachmentPreviewDialog — in-app lightbox for ledger attachments.
 *
 * Renders images via <img> and PDFs via <iframe> (served with
 * `Content-Disposition: inline`); other types show a download-only fallback.
 * Prev/next walk every attachment on the entry; Escape / arrow keys + a
 * click-the-backdrop all behave as expected.
 */

import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight, Download, Loader2, X } from 'lucide-react'

import { api } from '@/lib/api'
import type { LedgerAttachmentMeta } from '@/lib/api'
import { FileTypeIcon } from '@/components/ledger/FileTypeIcon'
import { fileKindFromName, fileMeta, formatBytes } from '@/lib/fileTypes'

// Heavy renderers are lazy — pdf.js + the spreadsheet engine only load when a
// preview of that type actually opens (kept out of the initial app chunk).
const PdfViewer = lazy(() => import('@/components/ledger/PdfViewer'))
const XlsxViewer = lazy(() => import('@/components/ledger/XlsxViewer'))

function ViewerSpinner(): React.JSX.Element {
  return (
    <div className="flex h-full w-full items-center justify-center text-white/70">
      <Loader2 className="h-6 w-6 animate-spin" />
    </div>
  )
}

interface AttachmentPreviewDialogProps {
  entryId: number
  attachments: LedgerAttachmentMeta[]
  startIndex: number
  onClose: () => void
}

export function AttachmentPreviewDialog({
  entryId,
  attachments,
  startIndex,
  onClose,
}: AttachmentPreviewDialogProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const count = attachments.length
  const [index, setIndex] = useState(startIndex)
  // The index whose image failed to load — falls back to the download CTA.
  // Keyed by index so navigating to another attachment clears it automatically.
  const [errorIndex, setErrorIndex] = useState<number | null>(null)

  const go = useCallback(
    (delta: number) =>
      setIndex((i) => Math.min(count - 1, Math.max(0, i + delta))),
    [count],
  )

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight') go(1)
      else if (e.key === 'ArrowLeft') go(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, go])

  const current = attachments[index]
  if (!current) return null

  const imgError = errorIndex === index

  const kind = fileKindFromName(current.name)
  const viewUrl = api.ledgerAttachmentUrl(entryId, current.index, { inline: true })
  const downloadUrl = api.ledgerAttachmentUrl(entryId, current.index)
  const sizeLabel = formatBytes(current.size)

  // Portal to <body> so the full-screen lightbox escapes the drawer's stacking
  // context (otherwise the TopNav paints over its top edge).
  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-black/80 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t('ledger.attachments.preview', { defaultValue: 'Preview' })}
      onClick={onClose}
    >
      {/* Header */}
      <div
        className="mx-auto flex w-full max-w-5xl shrink-0 items-center gap-3 py-2 text-white"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="shrink-0">
          <FileTypeIcon kind={kind} size={24} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium" dir="auto" title={current.name}>
            {current.name}
          </div>
          <div className="flex items-center gap-1.5 font-mono text-xs tabular-nums text-white/60">
            <span>{fileMeta(kind).label}</span>
            {sizeLabel && (
              <>
                <span className="text-white/30">·</span>
                <span>{sizeLabel}</span>
              </>
            )}
            {count > 1 && (
              <>
                <span className="text-white/30">·</span>
                <span>
                  {index + 1} / {count}
                </span>
              </>
            )}
          </div>
        </div>
        <a
          href={downloadUrl}
          className="inline-flex h-9 items-center gap-1.5 rounded-full bg-white/10 px-3 text-sm font-medium hover:bg-white/20"
          download
        >
          <Download className="h-4 w-4" strokeWidth={1.7} />
          {t('common.download')}
        </a>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-white/20"
          aria-label={t('common.close')}
        >
          <X className="h-5 w-5" strokeWidth={1.8} />
        </button>
      </div>

      {/* Stage */}
      <div
        className="relative flex min-h-0 flex-1 items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        {count > 1 && (
          <button
            type="button"
            onClick={() => go(-1)}
            disabled={index === 0}
            aria-label={t('common.previous', { defaultValue: 'Previous' })}
            className="absolute start-0 z-10 inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 disabled:opacity-30"
          >
            <ChevronLeft className="h-6 w-6 rtl:rotate-180" strokeWidth={1.8} />
          </button>
        )}

        {kind === 'image' && !imgError ? (
          <img
            src={viewUrl}
            alt={current.name}
            onError={() => setErrorIndex(index)}
            className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
          />
        ) : kind === 'image' && imgError ? (
          <div className="flex flex-col items-center gap-4 rounded-2xl bg-surface px-10 py-12 text-center">
            <FileTypeIcon kind={kind} size={56} />
            <p className="max-w-xs text-sm text-muted-foreground">
              {t('ledger.attachments.previewLoadFailed', {
                defaultValue: "Couldn't load the preview",
              })}
            </p>
            <a
              href={downloadUrl}
              download
              className="inline-flex h-9 items-center gap-1.5 rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
            >
              <Download className="h-4 w-4" strokeWidth={1.7} />
              {t('common.download')}
            </a>
          </div>
        ) : kind === 'pdf' ? (
          <div className="h-full w-full max-w-5xl">
            <Suspense fallback={<ViewerSpinner />}>
              <PdfViewer base64Url={api.ledgerAttachmentUrl(entryId, current.index, { base64: true })} />
            </Suspense>
          </div>
        ) : kind === 'xlsx' ? (
          <div className="h-full w-full">
            <Suspense fallback={<ViewerSpinner />}>
              <XlsxViewer entryId={entryId} index={current.index} name={current.name} />
            </Suspense>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4 rounded-2xl bg-surface px-10 py-12 text-center">
            <FileTypeIcon kind={kind} size={56} />
            <p className="max-w-xs text-sm text-muted-foreground">
              {t('ledger.attachments.previewUnavailable', {
                defaultValue: "Preview isn't available for this file type",
              })}
            </p>
            <a
              href={downloadUrl}
              download
              className="inline-flex h-9 items-center gap-1.5 rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
            >
              <Download className="h-4 w-4" strokeWidth={1.7} />
              {t('common.download')}
            </a>
          </div>
        )}

        {count > 1 && (
          <button
            type="button"
            onClick={() => go(1)}
            disabled={index === count - 1}
            aria-label={t('common.next', { defaultValue: 'Next' })}
            className="absolute end-0 z-10 inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 disabled:opacity-30"
          >
            <ChevronRight className="h-6 w-6 rtl:rotate-180" strokeWidth={1.8} />
          </button>
        )}
      </div>
    </div>,
    document.body,
  )
}
