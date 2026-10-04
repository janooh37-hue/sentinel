/**
 * RecordHeader — the record page's header: back + queue navigation, identity
 * block, state/status chips, the hidden Word/adjust-signature/file host mounts,
 * the labelled workflow bar, and the utility row (Mark-up toggle + Tools menu).
 *
 * Three rows at phone width, one row from lg. `basis-full` on the chips and
 * the action cluster is what forces the split: without it they ride on row 1
 * and squeeze the identity block (which is `flex-1`, so it shrinks to a
 * sliver) until a long Latin name in an RTL layout wraps into a five-line
 * column. The `lg:min-w` floor keeps that from happening on desktop too,
 * where a crowded action cluster used to eat the same space — it wraps
 * instead.
 */

import { useTranslation } from 'react-i18next'
import { ArrowLeft, PenLine, Send, Upload, X, CornerUpLeft } from 'lucide-react'
import { HeaderBtn } from '../HeaderBtn'
import { MarkToggle } from '../MarkToggle'
import { QueueNav } from '../QueueNav'
import { sealDescriptor } from '../bookStateLabel'
import { TONE, SEAL_TO_STATION_TONE } from './RecordRail'
import { RecordToolsMenu } from './RecordToolsMenu'
import { BookStatusChips } from '@/components/books/BookStatusChips'
import { WordReopenButton, WordSessionActions } from '@/components/books/BookWordActions'
import { ReviewerActions } from '@/components/books/ReviewerActions'
import { AdjustSignatureAction } from '@/components/signature/AdjustSignatureAction'
import { Hint } from '@/components/ui/hint'
import type { RecordPieceProps } from './recordActions'

function StatePill({
  state,
  signingPath,
  signedSource,
}: {
  state: string
  signingPath?: string | null
  signedSource?: string | null
}): React.JSX.Element {
  const { t } = useTranslation()
  const d = sealDescriptor(state, { signingPath, signedSource })
  const c = TONE[SEAL_TO_STATION_TONE[d.tone]]
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[0.72em] font-bold uppercase tracking-[0.04em]"
      style={{ background: c.bg, color: c.fg }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: c.fg }} />
      {t(d.labelKey)}
    </span>
  )
}

export function RecordHeader({ book, caps, view, actions }: RecordPieceProps): React.JSX.Element {
  const { t } = useTranslation()
  const { canMutateCurrent, isInmateReporter, isInmateReport, canRevise, canMark, showSendForApproval, showFileSigned } = caps
  const { bookId, isMobile, isPending, state, action, busy, submitter, signedSource, current, backLabel, queue, armed, scanBusy } = view
  const { back, step, setArmedFor, setReason, openOverlay, handleRevise, requestSignConfirm, submitReport, fileSignedCopy, replaceSignedPaper, setWordReopenTrigger, setAdjustSigTrigger, fileSignedRef, replaceSignedRef, desktopSignRef } = actions
  return (
    <header className="flex flex-wrap items-center gap-x-3.5 gap-y-2.5 border-b border-hairline bg-gradient-to-b from-surface to-surface-tinted/40 px-4 py-3 sm:px-5 sm:py-3.5">
      <Hint label={backLabel}>
        <button
          type="button"
          onClick={back}
          aria-label={backLabel}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-hairline bg-surface text-primary transition-colors hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" strokeWidth={2.2} />
        </button>
      </Hint>
      {!isInmateReporter && (
        <QueueNav
          position={queue.position}
          total={queue.total}
          onPrev={() => {
            setArmedFor(null)
            if (queue.prevId == null) return
            step(queue.prevId, queue.prevVersionId)
          }}
          onNext={() => {
            setArmedFor(null)
            if (queue.nextId == null) return
            step(queue.nextId, queue.nextVersionId)
          }}
        />
      )}
      <div className="min-w-0 flex-1 lg:min-w-[18rem]">
        <div className="font-mono text-[0.72em] font-semibold tracking-wide text-primary">
          {book?.ref_number ?? '—'}
        </div>
        {/* Wraps freely below `lg` so the complete subject is readable on
            phone/tablet; the one-row desktop header keeps the single-line
            truncate it always had. */}
        <h1 className="text-[1.05em] font-bold tracking-tight text-foreground lg:truncate">
          {book?.subject ?? (isPending ? t('books.record.loading') : t('books.record.untitled'))}
        </h1>
        {/* One line, and the G number wins the space fight: the label and the
            G stay whole (`shrink-0`) while the name — the only unbounded part,
            and long in practice ("SAEED ASHED SANAD KHALFAN ALYAHYAEE") —
            truncates. Truncating the whole line instead would drop the G,
            which is the identifier people actually search on.
            The name is its own `dir="ltr"` bdi so the ellipsis lands at the
            END of the Latin run ("SAEED ASHED SANAD…"); left to inherit RTL,
            the browser clips the run's head instead and it reads as gibberish. */}
        <div
          className="mt-0.5 flex items-baseline gap-1 text-[0.72em] text-muted-foreground"
          title={submitter}
        >
          <span className="shrink-0">{t('books.record.submittedBy')}</span>
          <bdi dir="ltr" className="min-w-0 truncate font-semibold text-foreground">
            {submitter}
          </bdi>
          {book?.submitted_by_g && (
            <span className="shrink-0 font-mono text-primary">
              · <bdi dir="ltr">{book.submitted_by_g}</bdi>
            </span>
          )}
        </div>
      </div>
      <div className="flex basis-full flex-wrap items-center gap-1.5 lg:ms-1 lg:basis-auto">
        {book && (
          <StatePill state={state} signingPath={book.signing_path} signedSource={signedSource} />
        )}
        {/* Classification / draft / editing / voided chips */}
        {book && (
          <BookStatusChips book={book} />
        )}
      </div>
      {/* Reopen-in-Word and adjust-signature render as Tools menu items
          below, but the components owning their mutation/dialog/eligibility
          query are mounted here unconditionally — independent of the
          dropdown's open/closed state (see the components' own docs). */}
      {(!isInmateReporter || isInmateReport) && book && canMutateCurrent && (
        <WordReopenButton
          book={book}
          isMobile={isMobile}
          hideTrigger
          onTriggerChange={setWordReopenTrigger}
          onFinished={isInmateReport ? () => submitReport(book.id) : undefined}
        />
      )}
      {!isInmateReporter && canMutateCurrent && current?.document_id != null && (
        <AdjustSignatureAction
          documentId={current.document_id}
          hideTrigger
          onTriggerChange={setAdjustSigTrigger}
        />
      )}
      <input
        ref={fileSignedRef}
        type="file"
        accept="application/pdf,image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f && book) {
            void fileSignedCopy(f, book.ref_number)
          }
          e.target.value = ''
        }}
      />
      <input
        ref={replaceSignedRef}
        type="file"
        accept="application/pdf,image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void replaceSignedPaper(f)
          e.target.value = ''
        }}
      />

      {/* Persistent workflow bar: the current record's next step(s), always
          labelled — never icon-only. Same content set on mobile (minus the
          decide triple, which the dock + inline reason panel below already
          own) so revise/submit/scan-signed/Word-session stay reachable with
          readable labels on phone, not just desktop. */}
      {(Boolean(book && canMutateCurrent && book.edit_session?.state === 'active') ||
        (action === 'decide' && !isMobile) ||
        (action === 'review' && book && current) ||
        action === 'revise' ||
        showSendForApproval ||
        showFileSigned) && (
        <div className="flex w-full flex-wrap items-center gap-2 rounded-xl bg-primary-soft/60 px-3 py-2.5">
          {(!isInmateReporter || isInmateReport) && book && canMutateCurrent && (
            <WordSessionActions
              book={book}
              isMobile={isMobile}
              onFinished={isInmateReport ? () => submitReport(book.id) : undefined}
            />
          )}
          {action === 'decide' && !isMobile && (
            <>
              <HeaderBtn
                ref={desktopSignRef}
                icon={<PenLine className="h-3.5 w-3.5" />}
                label={t('books.approval.signApprove')}
                tone="green-solid"
                disabled={busy}
                onClick={() => requestSignConfirm(desktopSignRef)}
              />
              <HeaderBtn
                icon={<CornerUpLeft className="h-3.5 w-3.5" />}
                label={t('books.approval.return')}
                tone="amber"
                disabled={busy}
                onClick={() => {
                  setReason('')
                  openOverlay('decision', { decision: 'return' })
                }}
              />
              <HeaderBtn
                icon={<X className="h-3.5 w-3.5" strokeWidth={2.4} />}
                label={t('books.approval.reject')}
                tone="red"
                disabled={busy}
                onClick={() => {
                  setReason('')
                  openOverlay('decision', { decision: 'reject' })
                }}
              />
            </>
          )}

          {action === 'review' && book && current && (
            <div data-testid="record-reviewer-actions">
              <ReviewerActions bookId={book.id} versionId={current.id} />
            </div>
          )}

          {action === 'revise' && (
            <HeaderBtn
              icon={<CornerUpLeft className="h-3.5 w-3.5 -scale-x-100" />}
              label={t('books.versions.revise')}
              tone="navy-solid"
              disabled={!canRevise}
              onClick={handleRevise}
            />
          )}

          {showSendForApproval && (
            <HeaderBtn
              icon={<Send className="h-3.5 w-3.5" />}
              label={t('books.approval.submitForApproval')}
              tone="navy-solid"
              onClick={() => {
                if (isInmateReporter) submitReport(bookId)
                else openOverlay('submit')
              }}
            />
          )}

          {showFileSigned && (
            <HeaderBtn
              icon={<Upload className="h-3.5 w-3.5" />}
              label={t('books.pane.scanSignedCopy')}
              tone="plain"
              disabled={scanBusy}
              onClick={() => fileSignedRef.current?.click()}
            />
          )}
        </div>
      )}

      {/* Viewer/workflow utility row: the annotation-mode toggle stays a
          standalone, always-visible control (its armed state must never
          hide inside a closed menu) next to the Tools dropdown, which holds
          every other tool grouped by purpose. */}
      <div className="flex w-full items-center justify-end gap-1.5 lg:ms-auto lg:w-auto">
        {canMark && (
          <MarkToggle armed={armed} onToggle={() => setArmedFor(armed ? null : bookId)} />
        )}
        {book && (
        <RecordToolsMenu book={book} caps={caps} view={view} actions={actions} />
        )}
      </div>
    </header>
  )
}
