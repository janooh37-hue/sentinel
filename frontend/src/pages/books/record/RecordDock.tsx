/**
 * RecordDock — the phone-only fixed bottom workflow bar, portaled to <body>.
 *
 * DOM order is More · [secondary…] · PRIMARY (`flex-1`), so in RTL the primary
 * sits at the inline-end, under the thumb. What it offers comes from
 * `view.nextStep` (the one "what is this record waiting for" answer):
 *   decide  → More · Return · Reject · Sign & approve
 *   others  → More · ≤1 secondary · primary
 * More is present in every state and opens `RecordMoreSheet`, which carries
 * everything else (print, email, Word, admin, Delete…). The sign-area
 * IntersectionObserver (`view.dockHidden`) may hide only the decide buttons —
 * never More.
 */

import * as Dialog from '@radix-ui/react-dialog'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Check,
  CornerUpLeft,
  Download,
  Loader2,
  Lock,
  MoreHorizontal,
  PenLine,
  Send,
  UserCog,
  Upload,
  X,
} from 'lucide-react'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { WordSessionActions } from '@/components/books/BookWordActions'
import { api, ApiError, apiErrorMessage } from '@/lib/api'
import { cn } from '@/lib/utils'
import type { ActionId, ReasonKey } from '../recordNextStep'
import type { RecordPieceProps } from './recordActions'
import { RecordMoreSheet } from './RecordMoreSheet'

type Tone = 'plain' | 'amber' | 'red' | 'sign' | 'primary'

const TONE: Record<Tone, string> = {
  plain: 'border-hairline bg-surface text-foreground hover:bg-surface-tinted',
  amber: 'border-warning/40 bg-surface text-warning hover:bg-warning/10',
  red: 'border-accent/40 bg-surface text-accent hover:bg-accent/10',
  sign: 'border-transparent bg-success text-white hover:bg-success/90',
  primary: 'border-transparent bg-primary text-primary-foreground hover:bg-primary-hover',
}

const BUTTON =
  'inline-flex min-h-[46px] min-w-0 items-center justify-center gap-1.5 rounded-xl border px-3 text-center text-[0.8em] font-semibold leading-tight transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-disabled:cursor-not-allowed aria-disabled:opacity-60 disabled:opacity-50'

interface DockAction {
  id: ActionId
  tone: Tone
  icon: React.ReactNode
  label: string
  onClick?: () => void
  href?: string
  disabled?: boolean
  pending?: boolean
  /** Why it cannot run: the button stays focusable and the reason prints above the dock. */
  reasonKey?: ReasonKey | 'books.word.needsPc'
  buttonRef?: React.Ref<HTMLButtonElement>
}

const ICON = 'h-4 w-4 shrink-0'

function Spinner(): React.JSX.Element {
  return <Loader2 className={cn(ICON, 'animate-spin motion-reduce:animate-none')} aria-hidden="true" />
}

/** Advisory reviewer verdict. "Request changes" needs a note, so it opens a small sheet. */
function useReviewVerdict(bookId: number, versionId: number | undefined): {
  approve: () => void
  pending: boolean
  mutate: (v: { decision: 'reviewed' | 'changes_requested'; note?: string }, onDone?: () => void) => void
} {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const mut = useMutation({
    mutationFn: (v: { decision: 'reviewed' | 'changes_requested'; note?: string }) =>
      api.reviewBook(bookId, versionId ?? 0, v.decision, v.note),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['books'] })
      toast.success(t('books.reviewers.recorded'))
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'REVISION_CHANGED') {
        void qc.invalidateQueries({ queryKey: ['books', 'detail', bookId] })
        toast.error(t('books.approval.revisionChanged'))
        return
      }
      toast.error(apiErrorMessage(e))
    },
  })
  return {
    approve: () => mut.mutate({ decision: 'reviewed' }),
    pending: mut.isPending,
    mutate: (v, onDone) => mut.mutate(v, { onSuccess: onDone }),
  }
}

function RequestChangesSheet({
  open,
  onOpenChange,
  pending,
  onSubmit,
  isAr,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  pending: boolean
  onSubmit: (note: string) => void
  isAr: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const [note, setNote] = useState('')
  const empty = note.trim().length === 0
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          data-print-hide
          className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] motion-reduce:animate-none"
        />
        <Dialog.Content
          data-print-hide
          dir={isAr ? 'rtl' : 'ltr'}
          aria-describedby={undefined}
          className="bottom-sheet fixed inset-x-0 bottom-0 z-50 flex flex-col gap-3 rounded-t-[22px] bg-surface px-4 pb-[max(1rem,var(--safe-bottom))] pt-3 shadow-2xl focus-visible:outline-none"
        >
          <Dialog.Title className="text-[0.95em] font-semibold text-foreground">
            {t('books.reviewers.requestChanges')}
          </Dialog.Title>
          <label className="flex flex-col gap-1 text-[0.8em] font-medium text-muted-foreground">
            {t('books.approval.reasonLabel')}
            <textarea
              rows={3}
              value={note}
              dir="auto"
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('books.approval.reasonPlaceholder')}
              className="w-full rounded-lg border border-hairline bg-background px-3 py-2 text-[1.05em] text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
            />
          </label>
          {empty && (
            <p className="text-[0.74em] text-muted-foreground">{t('books.approval.reasonRequired')}</p>
          )}
          <div className="flex gap-2">
            <Dialog.Close asChild>
              <button type="button" className={cn(BUTTON, TONE.plain, 'flex-1')}>
                {t('books.approval.cancelDecision')}
              </button>
            </Dialog.Close>
            <button
              type="button"
              disabled={pending || empty}
              onClick={() => onSubmit(note.trim())}
              className={cn(BUTTON, TONE.amber, 'flex-1')}
            >
              <CornerUpLeft className={ICON} aria-hidden="true" />
              {t('books.reviewers.requestChanges')}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export function RecordDock({ book, caps, view, actions }: RecordPieceProps): React.JSX.Element {
  const { t } = useTranslation()
  const { isMobile, isAr, busy, dockHidden, bookId, current, nextStep, pendingAct } = view
  const [sheetOpen, setSheetOpen] = useState(false)
  const [changesOpen, setChangesOpen] = useState(false)
  const verdict = useReviewVerdict(bookId, current?.id)

  if (!isMobile || !book || !nextStep) return <></>

  const decide = Boolean(nextStep.decide)
  const wordSession = nextStep.primary === 'finishEditing'

  const build = (id: ActionId): DockAction | null => {
    switch (id) {
      case 'sign':
        return {
          id,
          tone: 'sign',
          icon: pendingAct === 'sign' ? <Spinner /> : <PenLine className={ICON} aria-hidden="true" />,
          label: pendingAct === 'sign' ? t('books.approval.signing') : t('books.approval.signApprove'),
          disabled: busy,
          pending: pendingAct === 'sign',
          buttonRef: actions.mobileDockSignRef,
          onClick: () => actions.requestSignConfirm(actions.mobileDockSignRef),
        }
      case 'returnForChanges':
        return {
          id,
          tone: 'amber',
          icon: pendingAct === 'return' ? <Spinner /> : <CornerUpLeft className={ICON} aria-hidden="true" />,
          label: pendingAct === 'return' ? t('books.approval.returning') : t('books.approval.return'),
          disabled: busy,
          pending: pendingAct === 'return',
          onClick: () => actions.openMobileDecision('return'),
        }
      case 'reject':
        return {
          id,
          tone: 'red',
          icon: pendingAct === 'reject' ? <Spinner /> : <X className={ICON} strokeWidth={2.4} aria-hidden="true" />,
          label: pendingAct === 'reject' ? t('books.approval.rejecting') : t('books.approval.reject'),
          disabled: busy,
          pending: pendingAct === 'reject',
          onClick: () => actions.openMobileDecision('reject'),
        }
      case 'sendForApproval':
        return {
          id,
          tone: 'primary',
          icon: <Send className={ICON} aria-hidden="true" />,
          label: t('books.approval.submitForApproval'),
          onClick: () => {
            if (caps.isInmateReporter) actions.submitReport(bookId)
            else actions.openOverlay('submit')
          },
        }
      case 'continueEditing': {
        // Continue = reopen the form that made the record. A Word-authored
        // record can only be continued in Word, which needs a PC.
        const reasonKey = book.is_word_book
          ? 'books.word.needsPc'
          : current?.template_id
            ? undefined
            : 'books.reason.reviseNoTemplate'
        return {
          id,
          tone: nextStep.primary === id ? 'primary' : 'plain',
          icon: <PenLine className={ICON} aria-hidden="true" />,
          label: t('books.pane.continueDraft'),
          reasonKey,
          onClick: actions.handleRevise,
        }
      }
      case 'revise':
        return {
          id,
          tone: 'primary',
          icon: <CornerUpLeft className={cn(ICON, '-scale-x-100')} aria-hidden="true" />,
          label: t('books.pane.revise'),
          reasonKey: nextStep.disabled?.revise,
          onClick: actions.handleRevise,
        }
      case 'scanSigned':
        return {
          id,
          tone: nextStep.primary === id ? 'primary' : 'plain',
          icon: <Upload className={ICON} aria-hidden="true" />,
          label: t('books.pane.scanSignedCopy'),
          disabled: view.scanBusy,
          onClick: () => actions.fileSignedRef.current?.click(),
        }
      case 'downloadSigned':
        return {
          id,
          tone: 'primary',
          icon: <Download className={ICON} aria-hidden="true" />,
          label: t('books.record.downloadSigned'),
          href: current?.signed_pdf_url ?? undefined,
        }
      case 'reroute':
        return {
          id,
          tone: 'plain',
          icon: <UserCog className={ICON} aria-hidden="true" />,
          label: t('books.approval.reroute'),
          onClick: () => actions.openOverlay('submit'),
        }
      case 'approveReviewed':
        return {
          id,
          tone: 'sign',
          icon: <Check className={ICON} strokeWidth={2.5} aria-hidden="true" />,
          label: t('books.reviewers.approveReviewed'),
          disabled: verdict.pending || current == null,
          onClick: verdict.approve,
        }
      case 'requestChanges':
        return {
          id,
          tone: 'amber',
          icon: <CornerUpLeft className={ICON} aria-hidden="true" />,
          label: t('books.reviewers.requestChanges'),
          disabled: verdict.pending || current == null,
          onClick: () => setChangesOpen(true),
        }
      default:
        // print / email / addToPdf / delete / admin ids live in the More sheet.
        return null
    }
  }

  const primary = wordSession || !nextStep.primary ? null : build(nextStep.primary)
  // The Word session's Discard is rendered by WordSessionActions itself.
  const secondaries = wordSession
    ? []
    : (decide ? nextStep.secondary : nextStep.secondary.slice(0, 1))
        .map(build)
        .filter((a): a is DockAction => a != null)
  const inline = [...secondaries, ...(primary ? [primary] : [])]
  const reasonKeys = inline.flatMap((a) => (a.reasonKey ? [a.reasonKey] : []))

  const renderAction = (a: DockAction): React.JSX.Element => {
    const hideForObserver = decide && dockHidden
    const className = cn(
      BUTTON,
      TONE[a.tone],
      a === primary ? 'flex-1 min-w-[7rem]' : 'shrink',
      hideForObserver && 'pointer-events-none opacity-0',
    )
    const hiddenProps = hideForObserver ? { 'aria-hidden': true as const, inert: true } : {}
    const content = (
      <>
        {a.icon}
        <span className="min-w-0">{a.label}</span>
      </>
    )
    if (a.href && !a.disabled) {
      return (
        <a
          key={a.id}
          data-dock-primary={a === primary ? '' : undefined}
          href={a.href}
          target="_blank"
          rel="noopener noreferrer"
          className={className}
          {...hiddenProps}
        >
          {content}
        </a>
      )
    }
    const blocked = a.disabled || Boolean(a.reasonKey)
    return (
      <button
        key={a.id}
        ref={a.buttonRef}
        type="button"
        data-dock-primary={a === primary ? '' : undefined}
        // A reasoned button stays focusable (aria-disabled) so the reason is
        // reachable; a plainly disabled one (busy) uses `disabled`.
        disabled={a.disabled && !a.reasonKey}
        aria-disabled={a.reasonKey ? true : undefined}
        aria-busy={a.pending || undefined}
        onClick={blocked ? undefined : a.onClick}
        className={className}
        {...hiddenProps}
      >
        {content}
      </button>
    )
  }

  return (
    <>
      {createPortal(
        <div
          dir={isAr ? 'rtl' : 'ltr'}
          data-print-hide
          className={cn(
            'fixed inset-x-0 bottom-[calc(5.5rem+var(--safe-bottom))] z-40 border-t border-hairline bg-surface/95 px-3 pt-2 backdrop-blur md:hidden',
            'pb-[max(0.5rem,var(--safe-bottom))]',
          )}
        >
          {reasonKeys.map((key) => (
            <p
              key={key}
              className="mb-2 flex items-start gap-1.5 text-[0.76em] leading-snug text-muted-foreground"
            >
              <Lock className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
              <span>{t(key)}</span>
            </p>
          ))}
          <div data-record-dock className="flex items-stretch gap-2">
            <button
              type="button"
              data-dock-more
              aria-haspopup="dialog"
              aria-expanded={sheetOpen}
              onClick={() => setSheetOpen(true)}
              className={cn(
                BUTTON,
                TONE.plain,
                'w-[54px] shrink-0 flex-col gap-0.5 px-0 text-[0.66em]',
              )}
            >
              <MoreHorizontal className="h-[18px] w-[18px]" aria-hidden="true" />
              <span>{t('books.record.more')}</span>
            </button>
            {wordSession ? (
              // Finish editing (solid) is the primary: first in DOM inside
              // WordSessionActions, ordered last visually so it sits under the thumb.
              <div className="contents [&>button]:min-h-[46px] [&>button:first-of-type]:order-2 [&>button:first-of-type]:flex-1 [&>button:nth-of-type(2)]:order-1">
                {book && (
                  <WordSessionActions
                    book={book}
                    labelled
                    onFinished={caps.isInmateReport ? () => actions.submitReport(book.id) : undefined}
                  />
                )}
              </div>
            ) : (
              inline.map(renderAction)
            )}
          </div>
        </div>,
        document.body,
      )}
      <RecordMoreSheet
        book={book}
        caps={caps}
        view={view}
        actions={actions}
        nextStep={nextStep}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
      />
      <RequestChangesSheet
        open={changesOpen}
        onOpenChange={setChangesOpen}
        pending={verdict.pending}
        isAr={isAr}
        onSubmit={(note) =>
          verdict.mutate({ decision: 'changes_requested', note }, () => setChangesOpen(false))
        }
      />
    </>
  )
}
