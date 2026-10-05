/**
 * RecordHeader — the record page's header, in three shapes:
 *
 *  - Desktop (from 768): at most TWO rows. Row A: Back · queue arrows · identity
 *    block (ref line = copy-ref + state pill + status chips, h1, meta line) ·
 *    utilities (Mark up when deciding, rail toggle, Tools). Row B (the next
 *    step): status sentence + quote … secondary actions … PRIMARY. The chips
 *    live inside the identity refline — a separate chips row would wrap Row A
 *    to three rows at 834.
 *  - Phone (<768): Back · copy-ref · queue `i/n`, a 2-line h1 (tap expands),
 *    and a status line. No workflow bar and no Tools: the dock owns them.
 *  - Focus mode: one compact bar (back · ref · pill · status · primary · Exit).
 *
 * The hidden Word / adjust-signature / file-input hosts mount in every shape:
 * the components owning those mutations and dialogs must outlive any menu.
 *
 * Every action comes from `view.nextStep` (`recordNextStep`), the same model the
 * dock and the Records pane read.
 */

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeft,
  Copy,
  CornerUpLeft,
  Download,
  PanelRightClose,
  PanelRightOpen,
  PenLine,
  Send,
  Upload,
  UserCog,
  X,
} from 'lucide-react'
import { HeaderBtn, headerBtnClass } from '../HeaderBtn'
import { MarkToggle } from '../MarkToggle'
import { QueueNav } from '../QueueNav'
import { recordStateOf, sealDescriptor } from '../bookStateLabel'
import type { ActionId, NextStep } from '../recordNextStep'
import { RAIL_BREAKPOINT, useRecordChrome } from './RecordChrome'
import { TONE, SEAL_TO_STATION_TONE } from './recordTones'
import { Quote } from './Quote'
import { RecordToolsMenu } from './RecordToolsMenu'
import { BookStatusChips } from '@/components/books/BookStatusChips'
import { WordReopenButton, WordSessionActions } from '@/components/books/BookWordActions'
import { ReviewerActions } from '@/components/books/ReviewerActions'
import { AdjustSignatureAction } from '@/components/signature/AdjustSignatureAction'
import { Hint } from '@/components/ui/hint'
import { IconAction } from '@/components/ui/icon-action'
import { bidi } from '@/lib/bidi'
import { cn } from '@/lib/utils'
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
      data-testid="record-state-pill"
      className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[0.72em] font-bold uppercase tracking-[0.04em]"
      style={{ background: c.bg, color: c.fg }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: c.fg }} aria-hidden="true" />
      {t(d.labelKey)}
    </span>
  )
}

/** Copy-reference button: the ref itself, always LTR, plus a copy glyph. */
function CopyRef({
  refNumber,
  onCopy,
  className,
}: {
  refNumber: string
  onCopy: () => void
  className?: string
}): React.JSX.Element {
  const { t } = useTranslation()
  const label = `${t('books.record.copyRef')} ${bidi(refNumber)}`
  return (
    <Hint label={t('books.record.copyRef')} shortcut="C" side="bottom">
      <button
        type="button"
        data-testid="record-copy-ref"
        aria-label={label}
        onClick={onCopy}
        className={cn(
          'group inline-flex min-h-6 min-w-0 max-w-full items-center gap-1.5 rounded-md border border-transparent px-1.5 py-0.5 font-mono text-[0.75em] font-semibold tracking-wide text-primary transition-colors hover:border-hairline hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none',
          className,
        )}
      >
        <bdi dir="ltr" className="truncate tabular-nums">
          {refNumber}
        </bdi>
        <Copy
          className="h-3 w-3 shrink-0 opacity-60 group-hover:opacity-100"
          aria-hidden="true"
        />
      </button>
    </Hint>
  )
}

// Private-use delimiters: placeholders survive translation and are swapped for isolated values.
const STATUS_OPEN = '\uE000'
const STATUS_CLOSE = '\uE001'
const STATUS_TOKEN = new RegExp(`(${STATUS_OPEN}\\w+${STATUS_CLOSE})`)
const STATUS_TOKEN_ONE = new RegExp(`^${STATUS_OPEN}(\\w+)${STATUS_CLOSE}$`)

/** The localized status sentence with its values isolated: names in `<bdi>`,
 *  dates and "2 days ago" in `<bdi dir="ltr">` (same shape the prototype uses). */
function StatusText({ status }: { status: NextStep['status'] }): React.JSX.Element {
  const { t } = useTranslation()
  const placeholders: Record<string, string> = {}
  for (const key of Object.keys(status.vars)) placeholders[key] = `${STATUS_OPEN}${key}${STATUS_CLOSE}`
  const text = t(`books.status.${status.key}`, placeholders)
  return (
    <b className="font-semibold">
      {text.split(STATUS_TOKEN).map((part, i) => {
        const match = STATUS_TOKEN_ONE.exec(part)
        if (!match) return part
        const key = match[1]
        const value = status.vars[key] ?? ''
        return key === 'name' ? (
          <bdi key={i}>{value}</bdi>
        ) : (
          <bdi key={i} dir="ltr" className="tabular-nums">
            {value}
          </bdi>
        )
      })}
    </b>
  )
}

/** True from the width where the rail docks beside the desk (below it the
 *  toggle opens the overlay drawer). */
function useRailDocked(): boolean {
  const [docked, setDocked] = useState(() => window.innerWidth >= RAIL_BREAKPOINT)
  useEffect(() => {
    const onResize = (): void => setDocked(window.innerWidth >= RAIL_BREAKPOINT)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return docked
}

export function RecordHeader({ book, caps, view, actions }: RecordPieceProps): React.JSX.Element {
  const { t } = useTranslation()
  const chrome = useRecordChrome()
  const railDocked = useRailDocked()
  const [subjectOpen, setSubjectOpen] = useState(false)
  const { canMutateCurrent, isInmateReporter, isInmateReport, canMark } = caps
  const {
    bookId,
    isMobile,
    isPending,
    state,
    action,
    busy,
    pendingAct,
    signedSource,
    current,
    backLabel,
    queue,
    nextStep,
    creator,
    armed,
    scanBusy,
  } = view
  const {
    back,
    step,
    setArmedFor,
    setReason,
    openOverlay,
    handleRevise,
    requestSignConfirm,
    submitReport,
    fileSignedCopy,
    replaceSignedPaper,
    setWordReopenTrigger,
    setAdjustSigTrigger,
    fileSignedRef,
    replaceSignedRef,
    desktopSignRef,
    copyRef,
  } = actions

  const subject = book?.subject ?? (isPending ? t('books.record.loading') : t('books.record.untitled'))
  const shownState = book ? recordStateOf(book) : state
  const focusMode = chrome.focus && !isMobile
  const decide = nextStep?.decide === true && action === 'decide'
  const railExpanded = railDocked ? chrome.rail === 'open' : chrome.railDrawerOpen
  const railLabel = railExpanded ? t('books.record.hideProgress') : t('books.record.showProgress')

  const pill = book ? (
    <StatePill state={shownState} signingPath={book.signing_path} signedSource={signedSource} />
  ) : null

  const onPrev = (): void => {
    setArmedFor(null)
    if (queue.prevId == null) return
    step(queue.prevId, queue.prevVersionId)
  }
  const onNext = (): void => {
    setArmedFor(null)
    if (queue.nextId == null) return
    step(queue.nextId, queue.nextVersionId)
  }

  /** Created by <creator> · G · date, then Submitted by <submitter> only when it differs. */
  const createdDate = book?.created_at?.slice(0, 10)
  const submitterName = book?.submitted_by_name
  const submitterDiffers =
    book?.submitted_by_user_id != null &&
    book.submitted_by_user_id !== book.created_by_user_id &&
    Boolean(submitterName)
  const metaLine = book ? (
    <div
      data-testid="record-meta"
      className="mt-0.5 flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-[0.72em] text-muted-foreground"
    >
      <span className="shrink-0">{t('books.record.createdBy')}</span>
      <bdi
        data-testid="record-creator"
        className={cn('min-w-0 truncate font-semibold', book.created_by_name ? 'text-foreground' : 'font-normal italic')}
      >
        {creator}
      </bdi>
      {book.created_by_g && (
        <span className="shrink-0">
          · <bdi dir="ltr" className="font-mono tabular-nums text-primary">{book.created_by_g}</bdi>
        </span>
      )}
      {createdDate && (
        <span className="shrink-0">
          · <bdi dir="ltr" className="tabular-nums">{createdDate}</bdi>
        </span>
      )}
      {submitterDiffers && (
        <>
          <span className="shrink-0">· {t('books.record.submittedBy')}</span>
          <bdi data-testid="record-submitter" className="min-w-0 truncate font-semibold text-foreground">
            {submitterName}
          </bdi>
        </>
      )}
    </div>
  ) : null

  const reviewerBlock =
    book && current ? (
      <div key="reviewer" data-testid="record-reviewer-actions">
        <ReviewerActions bookId={book.id} versionId={current.id} />
      </div>
    ) : null

  /** One next-step action as a labelled header button. */
  const renderAction = (id: ActionId, step_: NextStep, primary: boolean): React.JSX.Element | null => {
    const reasonKey = step_.disabled?.[id]
    const reason = reasonKey ? t(reasonKey) : undefined
    switch (id) {
      case 'sign':
        return (
          <HeaderBtn
            key={id}
            ref={desktopSignRef}
            icon={<PenLine className="h-3.5 w-3.5" aria-hidden="true" />}
            label={t('books.approval.signApprove')}
            tone="green-solid"
            shortcut="S"
            pending={pendingAct === 'sign'}
            pendingLabel={t('books.approval.signing')}
            disabled={busy && pendingAct !== 'sign'}
            onClick={() => requestSignConfirm(desktopSignRef)}
          />
        )
      case 'returnForChanges':
        return (
          <HeaderBtn
            key={id}
            icon={<CornerUpLeft className="h-3.5 w-3.5" aria-hidden="true" />}
            label={t('books.approval.return')}
            tone="amber"
            pending={pendingAct === 'return'}
            pendingLabel={t('books.approval.returning')}
            disabled={busy && pendingAct !== 'return'}
            onClick={() => {
              setReason('')
              openOverlay('decision', { decision: 'return' })
            }}
          />
        )
      case 'reject':
        return (
          <HeaderBtn
            key={id}
            icon={<X className="h-3.5 w-3.5" strokeWidth={2.4} aria-hidden="true" />}
            label={t('books.approval.reject')}
            tone="red"
            pending={pendingAct === 'reject'}
            pendingLabel={t('books.approval.rejecting')}
            disabled={busy && pendingAct !== 'reject'}
            onClick={() => {
              setReason('')
              openOverlay('decision', { decision: 'reject' })
            }}
          />
        )
      case 'reroute':
        return (
          <HeaderBtn
            key={id}
            icon={<UserCog className="h-3.5 w-3.5" aria-hidden="true" />}
            label={t('books.approval.reroute')}
            tone="plain"
            onClick={() => openOverlay('submit')}
          />
        )
      case 'sendForApproval':
        return (
          <HeaderBtn
            key={id}
            icon={<Send className="h-3.5 w-3.5" aria-hidden="true" />}
            label={t('books.approval.submitForApproval')}
            tone="navy-solid"
            onClick={() => {
              if (isInmateReporter) submitReport(bookId)
              else openOverlay('submit')
            }}
          />
        )
      case 'continueEditing':
        return (
          <HeaderBtn
            key={id}
            icon={<PenLine className="h-3.5 w-3.5" aria-hidden="true" />}
            label={t('books.pane.continueDraft')}
            tone={primary ? 'navy-solid' : 'plain'}
            reason={current?.template_id ? undefined : t('books.reason.reviseNoTemplate')}
            onClick={handleRevise}
          />
        )
      case 'revise':
        return (
          <HeaderBtn
            key={id}
            icon={<CornerUpLeft className="h-3.5 w-3.5 -scale-x-100" aria-hidden="true" />}
            label={t('books.pane.revise')}
            tone="navy-solid"
            reason={reason}
            onClick={handleRevise}
          />
        )
      case 'scanSigned':
        return (
          <HeaderBtn
            key={id}
            icon={<Upload className="h-3.5 w-3.5" aria-hidden="true" />}
            label={t('books.pane.scanSignedCopy')}
            tone={primary ? 'navy-solid' : 'plain'}
            pending={scanBusy}
            pendingLabel={t('books.pane.scanReading')}
            onClick={() => fileSignedRef.current?.click()}
          />
        )
      case 'downloadSigned':
        return current?.signed_pdf_url ? (
          <a
            key={id}
            href={current.signed_pdf_url}
            target="_blank"
            rel="noopener noreferrer"
            className={headerBtnClass(primary ? 'navy-solid' : 'plain')}
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            {t('books.record.downloadSigned')}
          </a>
        ) : null
      case 'approveReviewed':
        return reviewerBlock
      case 'finishEditing':
        return book ? (
          <WordSessionActions
            key={id}
            book={book}
            isMobile={isMobile}
            labelled
            onFinished={isInmateReport ? () => submitReport(book.id) : undefined}
          />
        ) : null
      default:
        // requestChanges rides with ReviewerActions; discardDraft with
        // WordSessionActions; print / email / admin ids live in Tools.
        return null
    }
  }

  const renderActions = (step_: NextStep): React.JSX.Element[] => {
    const ids: Array<[ActionId, boolean]> = [
      ...step_.secondary.map((id): [ActionId, boolean] => [id, false]),
      ...(step_.primary ? [[step_.primary, true] as [ActionId, boolean]] : []),
    ]
    return ids.flatMap(([id, primary]) => {
      const node = renderAction(id, step_, primary)
      return node ? [node] : []
    })
  }

  // Reopen-in-Word and adjust-signature render as Tools / More items, but the
  // components owning their mutation / dialog / eligibility query mount here
  // unconditionally — independent of any menu being open (see their own docs).
  const hosts = (
    <>
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
    </>
  )

  const descriptor = book ? sealDescriptor(shownState, { signingPath: book.signing_path, signedSource }) : null
  const statusTone = descriptor ? TONE[SEAL_TO_STATION_TONE[descriptor.tone]] : null

  // ── Focus mode: one compact bar ────────────────────────────────────────────
  if (focusMode) {
    return (
      <header
        data-record-header="focus"
        data-print-hide
        className="flex h-[52px] shrink-0 items-center gap-2.5 border-b border-hairline bg-surface px-3.5"
      >
        <IconAction
          aria-label={backLabel}
          hint={backLabel}
          shortcut="Esc"
          hintSide="bottom"
          onClick={back}
        >
          <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" strokeWidth={2.2} aria-hidden="true" />
        </IconAction>
        {book && <CopyRef refNumber={book.ref_number} onCopy={copyRef} />}
        {pill}
        <span className="min-w-0 flex-1 truncate text-[0.82em] text-muted-foreground">
          {nextStep && <StatusText status={nextStep.status} />}
        </span>
        {nextStep?.primary && (
          <div className="flex shrink-0 items-center gap-2">
            {renderAction(nextStep.primary, nextStep, true)}
          </div>
        )}
        <HeaderBtn
          icon={<X className="h-3.5 w-3.5" aria-hidden="true" />}
          label={t('books.record.exitFocus')}
          shortcut="Esc"
          tone="plain"
          testId="record-exit-focus"
          onClick={() => chrome.setFocus(false)}
        />
        {hosts}
      </header>
    )
  }

  // ── Phone: back · ref · i/n, clamped subject, status line ─────────────────
  if (isMobile) {
    return (
      <header
        data-record-header="phone"
        data-print-hide
        className="shrink-0 border-b border-hairline bg-surface px-3 pb-2.5 pt-2"
      >
        <div className="flex items-center gap-2">
          <IconAction
            aria-label={backLabel}
            onClick={back}
            className="h-11 w-11 border-transparent bg-transparent"
          >
            <ArrowLeft className="h-5 w-5 rtl:-scale-x-100" strokeWidth={2.2} aria-hidden="true" />
          </IconAction>
          <div className="min-w-0 flex-1">
            {book && <CopyRef refNumber={book.ref_number} onCopy={copyRef} className="min-h-11" />}
          </div>
          {!isInmateReporter && (
            <QueueNav
              compact
              position={queue.position}
              total={queue.total}
              onPrev={onPrev}
              onNext={onNext}
            />
          )}
        </div>
        <h1 className="mt-0.5 text-[1em] font-bold leading-snug tracking-tight text-foreground">
          <button
            type="button"
            aria-expanded={subjectOpen}
            onClick={() => setSubjectOpen((open) => !open)}
            className="block w-full rounded-md text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className={cn('block', !subjectOpen && 'line-clamp-2')}>{subject}</span>
          </button>
        </h1>
        {metaLine}
        {book && nextStep && (
          <>
            <div
              data-testid="record-status-line"
              className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.82em]"
            >
              {pill}
              <BookStatusChips book={book} />
              <span className="min-w-0 flex-1 basis-40 text-muted-foreground">
                <StatusText status={nextStep.status} />
              </span>
            </div>
            {nextStep.quote && (
              <Quote text={nextStep.quote} className="mt-1.5 block text-[0.82em] italic text-muted-foreground" />
            )}
          </>
        )}
        {hosts}
      </header>
    )
  }

  // ── Desktop: Row A (identity + utilities), Row B (next step) ───────────────
  const actionNodes = nextStep ? renderActions(nextStep) : []
  const reviseReason = nextStep?.disabled?.revise ? t(nextStep.disabled.revise) : null
  return (
    <header
      data-record-header="desktop"
      data-print-hide
      className="shrink-0 border-b border-hairline bg-gradient-to-b from-surface to-surface-tinted/40"
    >
      <div
        data-header-row="a"
        className="flex flex-nowrap items-start gap-x-3 px-4 py-3 sm:px-5"
      >
        <IconAction
          aria-label={backLabel}
          hint={backLabel}
          shortcut="Esc"
          hintSide="bottom"
          onClick={back}
        >
          <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" strokeWidth={2.2} aria-hidden="true" />
        </IconAction>
        {!isInmateReporter && (
          <QueueNav position={queue.position} total={queue.total} onPrev={onPrev} onNext={onNext} />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            {book && <CopyRef refNumber={book.ref_number} onCopy={copyRef} />}
            {pill}
            {book && <BookStatusChips book={book} />}
          </div>
          <Hint label={subject} side="bottom">
            <h1 className="truncate text-[1.1em] font-bold leading-snug tracking-tight text-foreground">
              {subject}
            </h1>
          </Hint>
          {metaLine}
        </div>
        <div className="ms-auto flex shrink-0 items-center gap-1.5">
          {decide && canMark && (
            <MarkToggle armed={armed} onToggle={() => setArmedFor(armed ? null : bookId)} />
          )}
          <IconAction
            aria-label={railLabel}
            aria-expanded={railExpanded}
            hint={railLabel}
            hintSide="bottom"
            onClick={chrome.toggleRail}
          >
            {railExpanded ? (
              <PanelRightClose className="h-4 w-4" aria-hidden="true" />
            ) : (
              <PanelRightOpen className="h-4 w-4" aria-hidden="true" />
            )}
          </IconAction>
          {book && <RecordToolsMenu book={book} caps={caps} view={view} actions={actions} />}
        </div>
      </div>

      {book && nextStep && (
        <div
          data-header-row="b"
          className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-hairline bg-surface-tinted/40 px-4 py-2.5 sm:px-5"
        >
          <div
            data-testid="record-status-line"
            className="flex min-w-0 flex-1 basis-72 items-center gap-2.5 text-[0.82em]"
          >
            {descriptor && statusTone && (
              <span
                className="grid h-7 w-7 shrink-0 place-items-center rounded-full"
                style={{ background: statusTone.bg, color: statusTone.fg }}
                aria-hidden="true"
              >
                <descriptor.Icon className="h-[15px] w-[15px]" />
              </span>
            )}
            <span className="min-w-0 text-foreground">
              <StatusText status={nextStep.status} />
              {nextStep.quote && (
                <>
                  {' '}
                  <Quote text={nextStep.quote} className="italic text-muted-foreground" />
                </>
              )}
            </span>
          </div>
          {actionNodes.length > 0 && (
            <div className="flex flex-wrap items-center justify-end gap-2">{actionNodes}</div>
          )}
          {reviseReason && (
            <p className="basis-full text-end text-[0.75em] text-muted-foreground">{reviseReason}</p>
          )}
        </div>
      )}
      {hosts}
    </header>
  )
}
