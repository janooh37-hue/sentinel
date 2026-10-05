/**
 * RecordMoreSheet — the phone "More" bottom sheet behind the record dock.
 *
 * Same groups, keys and order as the desktop Tools menu (Document / Editing /
 * Administration, Delete last), plus Mark up for a decider (the desktop header
 * has a standalone toggle; the phone dock has no room for one). Rows are
 * ≥48px with icon + label + hint; a row that cannot run stays focusable
 * (`aria-disabled`) and shows its reason inline instead of the hint.
 */

import * as Dialog from '@radix-ui/react-dialog'
import {
  Check,
  FileStack,
  Loader2,
  type LucideIcon,
  Mail,
  MessageSquare,
  Printer,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Upload,
  UserCog,
  X,
} from 'lucide-react'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'
import { deleteBlockReason, deleteReasonKey } from '../recordDelete'
import type { NextStep } from '../recordNextStep'
import { useRecordPrint } from '../useRecordPrintMode'
import type { RecordPieceProps } from './recordActions'

interface SheetRow {
  id: string
  icon: React.ReactNode
  label: string
  hint?: string
  /** Why the row cannot run; shown in place of the hint. */
  reason?: string
  danger?: boolean
  pending?: boolean
  href?: string
  testId?: string
  onSelect?: () => void
}

interface SheetGroup {
  id: string
  title: string
  rows: SheetRow[]
}

const ICON = 'h-5 w-5 shrink-0'

function iconOf(Icon: LucideIcon, extra?: string): React.ReactNode {
  return <Icon className={cn(ICON, extra)} aria-hidden="true" />
}

function Row({ row, close }: { row: SheetRow; close: () => void }): React.JSX.Element {
  const reasonId = useId()
  const blocked = Boolean(row.reason) || row.pending
  const body = (
    <>
      <span className={cn('mt-0.5', row.reason ? 'text-muted-foreground' : row.danger ? 'text-accent' : 'text-muted-foreground')}>
        {row.pending ? iconOf(Loader2, 'animate-spin motion-reduce:animate-none') : row.icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn('block text-[0.95em] font-medium leading-snug', row.danger && !row.reason && 'text-accent', row.reason && 'text-muted-foreground')}>
          {row.label}
        </span>
        {(row.reason ?? row.hint) && (
          <span
            id={reasonId}
            className={cn('mt-0.5 block text-[0.78em] leading-snug', row.reason ? 'text-foreground/70' : 'text-muted-foreground')}
          >
            {row.reason ?? row.hint}
          </span>
        )}
      </span>
    </>
  )
  const className = cn(
    'flex min-h-[52px] w-full items-start gap-3 rounded-xl px-3 py-3 text-start transition-colors motion-reduce:transition-none',
    'hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    blocked && 'cursor-not-allowed',
  )

  if (row.href && !blocked) {
    return (
      <a
        href={row.href}
        target="_blank"
        rel="noopener noreferrer"
        data-testid={row.testId}
        aria-describedby={row.hint ? reasonId : undefined}
        onClick={close}
        className={className}
      >
        {body}
      </a>
    )
  }
  return (
    <button
      type="button"
      data-testid={row.testId}
      aria-disabled={blocked || undefined}
      aria-busy={row.pending || undefined}
      aria-describedby={row.reason || row.hint ? reasonId : undefined}
      onClick={() => {
        if (blocked) return
        close()
        row.onSelect?.()
      }}
      className={className}
    >
      {body}
    </button>
  )
}

export interface RecordMoreSheetProps extends RecordPieceProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  nextStep: NextStep
}

export function RecordMoreSheet({
  book,
  caps,
  view,
  actions,
  nextStep,
  open,
  onOpenChange,
}: RecordMoreSheetProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const print = useRecordPrint()
  if (!book) return null

  const { isInmateReporter, canMark, canMutateCurrent, canOverrideState, canManageRevisionAccess, canManageIncludedPapers, canManageSignedPaper } = caps
  const { bookId, state, current, recordHasPapers, emailingRecord, wordReopenTrigger, adjustSigTrigger, armed } = view
  const { openOverlay, emailViaOutlook, setUnfileOpen, pickSignedFile, pickReplacementFile, setArmedFor } = actions
  const close = (): void => onOpenChange(false)
  const reasonOf = (key: string | undefined): string | undefined =>
    key ? t(key, { action: t('books.stateOverride.trigger') }) : undefined
  const hasSignedCopy = state === 'approved' && Boolean(current?.signed_pdf_url)

  const documentRows: SheetRow[] = [
    {
      id: 'print',
      icon: iconOf(Printer),
      label: t('books.record.print'),
      hint: t('books.record.hint.print'),
      onSelect: print,
    },
  ]
  if (!isInmateReporter) {
    documentRows.push({
      id: 'email',
      icon: iconOf(Mail),
      label: t('books.record.emailViaOutlook'),
      hint: t('books.record.hint.email'),
      reason: recordHasPapers ? undefined : reasonOf(nextStep.disabled?.email ?? 'books.reason.emailNoDoc'),
      pending: emailingRecord,
      onSelect: () => void emailViaOutlook(),
    })
  }
  if (canManageIncludedPapers) {
    documentRows.push({
      id: 'addToPdf',
      icon: iconOf(FileStack),
      label: t('books.includedPapers.addToPdf'),
      hint: t('books.record.hint.pdf'),
      onSelect: () => openOverlay('papers'),
    })
  }
  if (hasSignedCopy && current?.signed_pdf_url) {
    documentRows.push({
      id: 'downloadSigned',
      icon: iconOf(Check),
      label: t('books.record.downloadSigned'),
      href: current.signed_pdf_url,
    })
  }

  const editingRows: SheetRow[] = []
  if (nextStep.decide && canMark) {
    editingRows.push({
      id: 'markUp',
      icon: iconOf(MessageSquare),
      label: t('books.annotations.mark'),
      hint: armed ? t('books.annotations.markingOn') : undefined,
      testId: 'record-more-markup',
      onSelect: () => setArmedFor(armed ? null : bookId),
    })
  }
  if (!isInmateReporter) {
    if (wordReopenTrigger) {
      editingRows.push({
        id: 'word',
        icon: wordReopenTrigger.icon,
        label: wordReopenTrigger.label,
        hint: t('books.record.hint.word', { v: (current?.version_no ?? 0) + 1 }),
        // Word needs a PC; the trigger is disabled on a phone, and that is the
        // reason worth showing (a pending reopen is not a reason).
        reason: wordReopenTrigger.disabled ? t('books.word.needsPc') : undefined,
        onSelect: () => wordReopenTrigger.onClick(),
      })
    }
    if (nextStep.overflow.includes('reroute') || nextStep.secondary.includes('reroute')) {
      editingRows.push({
        id: 'reroute',
        icon: iconOf(UserCog),
        label: t('books.approval.reroute'),
        hint: t('books.record.hint.reroute'),
        onSelect: () => openOverlay('submit'),
      })
    }
    if (nextStep.overflow.includes('scanSigned')) {
      editingRows.push({
        id: 'scanSigned',
        icon: iconOf(Upload),
        label: t('books.pane.scanSignedCopy'),
        pending: view.scanBusy,
        onSelect: pickSignedFile,
      })
    }
    if (adjustSigTrigger) {
      editingRows.push({
        id: 'adjust',
        icon: adjustSigTrigger.icon,
        label: adjustSigTrigger.label,
        hint: t('books.record.hint.adjust'),
        onSelect: () => adjustSigTrigger.onClick(),
      })
    }
    if (canManageSignedPaper) {
      editingRows.push({
        id: 'replace',
        icon: iconOf(RefreshCw),
        label: t('books.pane.replaceSigned'),
        hint: t('books.record.hint.replace'),
        onSelect: pickReplacementFile,
      })
    }
  }

  const adminRows: SheetRow[] = []
  if (!isInmateReporter) {
    if (canOverrideState && canMutateCurrent) {
      adminRows.push({
        id: 'state',
        icon: iconOf(ShieldAlert),
        label: t('books.stateOverride.trigger'),
        hint: t('books.record.hint.state'),
        testId: 'state-override-trigger',
        onSelect: () => openOverlay('override'),
      })
    }
    if (canManageRevisionAccess) {
      adminRows.push({
        id: 'access',
        icon: iconOf(ShieldCheck),
        label: t('books.approval.revisionAccess'),
        hint: t('books.record.hint.access'),
        testId: 'revision-access-trigger',
        onSelect: () => openOverlay('revision-access'),
      })
    }
    if (canManageSignedPaper) {
      adminRows.push({
        id: 'unfile',
        icon: iconOf(Trash2),
        label: t('books.pane.unfileSignedBtn'),
        hint: t('books.record.hint.unfile'),
        danger: true,
        onSelect: () => setUnfileOpen(true),
      })
    }
  }
  // Delete is always the last row of the sheet. noCapability / restricted hide
  // it; inFlight / wordSession keep it, disabled, with the reason.
  const blockReason = deleteBlockReason(book, { has: caps.has, isInmateReporter })
  if (blockReason !== 'noCapability' && blockReason !== 'restricted') {
    adminRows.push({
      id: 'delete',
      icon: iconOf(Trash2),
      label: state === 'none' ? t('books.record.deleteDraft') : t('books.record.delete'),
      hint: t('books.record.hint.delete'),
      reason: reasonOf(deleteReasonKey(blockReason) ?? undefined),
      danger: true,
      testId: 'record-more-delete',
      onSelect: () => actions.requestDelete(),
    })
  }

  const groups: SheetGroup[] = [
    { id: 'document', title: t('books.record.toolsDocument'), rows: documentRows },
    { id: 'editing', title: t('books.record.toolsEditing'), rows: editingRows },
    { id: 'admin', title: t('books.record.toolsAdmin'), rows: adminRows },
  ].filter((g) => g.rows.length > 0)

  return (
    <>
      <Dialog.Root open={open} onOpenChange={onOpenChange}>
        <Dialog.Portal>
          <Dialog.Overlay
            data-print-hide
            className={cn(
              'fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]',
              'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-300',
              'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-200',
              'motion-reduce:animate-none',
            )}
          />
          <Dialog.Content
            data-print-hide
            dir={view.isAr ? 'rtl' : 'ltr'}
            aria-describedby={undefined}
            className={cn(
              // `.bottom-sheet` carries the motion (index.css), reduced-motion guarded there.
              'bottom-sheet fixed inset-x-0 bottom-0 z-50 flex max-h-[82dvh] flex-col rounded-t-[22px] bg-surface shadow-2xl',
              'focus-visible:outline-none',
              'md:inset-auto md:left-1/2 md:top-1/2 md:max-h-[88dvh] md:w-full md:max-w-md md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-2xl',
            )}
          >
            <span aria-hidden className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-hairline md:hidden" />
            <header className="flex items-center gap-2.5 border-b border-hairline px-4 pb-3 pt-2">
              <Dialog.Title className="sr-only">{t('books.record.more')}</Dialog.Title>
              <bdi dir="ltr" className="font-mono text-[0.82em] font-semibold tabular-nums text-primary">
                {book.ref_number}
              </bdi>
              <span aria-hidden className="min-w-0 flex-1" />
              <Dialog.Close asChild>
                <button
                  type="button"
                  aria-label={t('common.close')}
                  className="flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-surface-tinted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
                >
                  <X className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                </button>
              </Dialog.Close>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-[max(1.5rem,var(--safe-bottom))] pt-1">
              {groups.map((g, i) => (
                <section key={g.id} aria-label={g.title} className={cn(i > 0 && 'mt-1 border-t border-hairline pt-1')}>
                  <h2 className="px-3 pb-1 pt-2.5 text-[0.62em] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                    {g.title}
                  </h2>
                  {g.rows.map((row) => (
                    <Row key={row.id} row={row} close={close} />
                  ))}
                </section>
              ))}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  )
}
