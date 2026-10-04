/**
 * RecordDesk — the paper area: the PDF canvas with its annotation host, the
 * empty states, and the phone inline decide panel.
 */

import { Suspense, lazy } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { RecordDecisionActions } from '../RecordDecisionActions'
import { BookAnnotationLayer } from '@/components/books/BookAnnotationLayer'
import { cn } from '@/lib/utils'
import type { RecordPieceProps } from './recordActions'

const DocPdfCanvas = lazy(() => import('@/pages/application/DocPdfCanvas'))

function DeskLoading(): React.JSX.Element {
  return (
    <div className="flex h-full min-h-[400px] items-center justify-center text-muted-foreground">
      <Loader2 className="h-6 w-6 animate-spin" />
    </div>
  )
}

interface DecisionReasonFormProps {
  act: 'return' | 'reject'
  reason: string
  reasonValid: boolean
  busy: boolean
  inputRef: React.RefObject<HTMLTextAreaElement | null>
  onReasonChange: (reason: string) => void
  onCancel: (act: 'return' | 'reject') => void
  onConfirm: (act: 'return' | 'reject') => void
}

export function DecisionReasonForm({
  act,
  reason,
  reasonValid,
  busy,
  inputRef,
  onReasonChange,
  onCancel,
  onConfirm,
}: DecisionReasonFormProps): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <>
      <label
        htmlFor="rec-reason"
        className="mb-1.5 block text-[0.78em] font-semibold text-foreground"
      >
        {act === 'return'
          ? t('books.approval.return')
          : t('books.approval.reject')}{' '}
        · {t('books.approval.reasonLabel')}
      </label>
      <textarea
        ref={inputRef}
        id="rec-reason"
        rows={2}
        value={reason}
        onChange={(e) => onReasonChange(e.target.value)}
        placeholder={t('books.approval.reasonPlaceholder')}
        dir="auto"
        className="w-full rounded-lg border border-hairline bg-background px-3 py-2 text-[0.88em] text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
      />
      <div className="mt-2 flex items-center justify-end gap-2.5">
        {!reasonValid && (
          <span className="me-auto text-[0.74em] text-muted-foreground">
            {t('books.approval.reasonOrMark')}
          </span>
        )}
        <button
          type="button"
          onClick={() => onCancel(act)}
          className="rounded-lg border border-hairline px-3 py-1.5 text-[0.8em] font-medium text-muted-foreground transition-colors hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t('books.approval.cancelDecision')}
        </button>
        <button
          type="button"
          disabled={!reasonValid || busy}
          onClick={() => onConfirm(act)}
          className={cn(
            'rounded-lg border border-transparent px-4 py-1.5 text-[0.8em] font-semibold text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
            act === 'return' ? 'bg-warning hover:bg-warning/90' : 'bg-accent hover:bg-accent/90',
          )}
        >
          {act === 'return' ? t('books.approval.return') : t('books.approval.reject')}
        </button>
      </div>
    </>
  )
}

export function RecordDesk({ book, caps, view, actions }: RecordPieceProps): React.JSX.Element {
  const { t } = useTranslation()
  const { isInmateReporter, canRevise } = caps
  const { isMobile, isAr, isPending, action, decision, busy, current, pdfUrl, userId, armed, annotatable, annMode, annotations, markBusy, decisionReasonFormProps } = view
  const { setArmedFor, handleRevise, requestSignConfirm, openMobileDecision, createMark, deleteMark, onPdfReady, mobileInlineSignRef, decisionPanelRef, panelReturnButtonRef, panelRejectButtonRef } = actions
  return (
    <div
      className="flex flex-1 justify-center overflow-auto px-6 py-7 max-md:flex-col max-md:items-center max-md:justify-start max-md:pb-4"
      style={{
        background:
          'radial-gradient(150% 100% at 40% -10%, var(--surface) 0%, var(--surface-tinted) 70%, var(--bg) 100%)',
      }}
    >
      <div className="print-paper relative w-full max-w-[640px]">
        {pdfUrl ? (
          <Suspense fallback={<DeskLoading />}>
            <DocPdfCanvas
              pdfUrl={pdfUrl}
              docxUrl={current?.docx_url ?? undefined}
              onReady={onPdfReady}
              renderOverlay={
                annotatable
                  ? (pages) => (
                      // Annotation pins are screen-only review marks — hidden
                      // on the printed copy (display:contents keeps placement
                      // math anchored to the canvas wrapper on screen).
                      <div data-print-hide style={{ display: 'contents' }}>
                        <BookAnnotationLayer
                          pages={pages}
                          annotations={annotations}
                          mode={annMode}
                          armed={armed}
                          currentUserId={userId}
                          busy={markBusy}
                          onCreate={(m) => createMark(m)}
                          onDelete={(id) => deleteMark(id)}
                          onDisarm={() => setArmedFor(null)}
                        />
                      </div>
                    )
                  : undefined
              }
            />
          </Suspense>
        ) : isPending ? (
          <div className="flex h-full min-h-[400px] items-center justify-center text-[0.85em] text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : !isInmateReporter && book?.imported_doc ? (
          // Imported record whose vault file isn't a PDF (e.g. .docx) — no
          // inline preview, so offer the original for download.
          <div className="flex h-full min-h-[400px] flex-col items-center justify-center gap-3 text-center text-[0.85em] text-muted-foreground">
            <span className="max-w-[40ch]">{t('books.record.importedNoPreview')}</span>
            <a
              href={book.imported_doc.download_url}
              download={book.imported_doc.filename}
              className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-1.5 text-[0.95em] font-semibold text-primary-foreground hover:bg-primary-hover"
            >
              {t('books.record.downloadImported', {
                format: book.imported_doc.format.toUpperCase(),
              })}
            </a>
          </div>
        ) : book?.edit_session?.state === 'active' ? (
          // The body is still being written in Word — there is genuinely no
          // document yet, but that's expected, not an error; the Word-session
          // controls (Finish editing / Discard) are already visible above.
          <div className="flex h-full min-h-[400px] items-center justify-center text-[0.85em] text-muted-foreground">
            {t('books.word.bodyInWord')}
          </div>
        ) : action === 'revise' && canRevise ? (
          // A returned/rejected record whose document isn't on file (or was
          // removed) — the one real recovery already available from this
          // page is the same Revise action the workflow bar offers.
          <div className="flex h-full min-h-[400px] flex-col items-center justify-center gap-3 text-center text-[0.85em] text-muted-foreground">
            <span className="max-w-[36ch]">{t('books.record.noDocument')}</span>
            <button
              type="button"
              onClick={handleRevise}
              className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-1.5 text-[0.95em] font-semibold text-primary-foreground hover:bg-primary-hover"
            >
              {t('books.versions.revise')}
            </button>
          </div>
        ) : (
          // Nothing produced this document and no action on this page would
          // fix that — submitting doesn't create one, so no CTA is offered.
          <div className="flex h-full min-h-[400px] items-center justify-center text-[0.85em] text-muted-foreground">
            {t('books.record.noDocument')}
          </div>
        )}
      </div>
      {isMobile && action === 'decide' && (
        <div
          ref={decisionPanelRef}
          dir={isAr ? 'rtl' : 'ltr'}
          data-print-hide
          className="mt-5 w-full max-w-[640px] md:hidden"
        >
          <RecordDecisionActions
            returnButtonRef={panelReturnButtonRef}
            rejectButtonRef={panelRejectButtonRef}
            signButtonRef={mobileInlineSignRef}
            busy={busy}
            onSign={() => requestSignConfirm(mobileInlineSignRef)}
            onReturn={() => openMobileDecision('return')}
            onReject={() => openMobileDecision('reject')}
          />
          {decision !== null && (
            <div className="mt-3 rounded-xl border border-hairline bg-surface p-3.5">
              <DecisionReasonForm {...decisionReasonFormProps} act={decision} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
