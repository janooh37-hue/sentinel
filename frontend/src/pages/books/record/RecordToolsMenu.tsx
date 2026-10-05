/**
 * RecordToolsMenu — the header's Tools dropdown. Three groups, in this order
 * (the phone More sheet mirrors it): Document / Editing / Administration,
 * with Delete record / Delete draft last, after a separator.
 *
 * Disabled items stay focusable and show their reason on a second line
 * (`DropdownMenuItem reason`). Destructive items are red and carry their
 * one-line hint (prototype `menuHTML`).
 */

import { useTranslation } from 'react-i18next'
import {
  Download,
  FileStack,
  Mail,
  Printer,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Upload,
  UserCog,
  Wrench,
} from 'lucide-react'
import { HeaderBtn } from '../HeaderBtn'
import { deleteBlockReason, deleteReasonKey } from '../recordDelete'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { RecordPieceProps } from './recordActions'
import { useRecordPrint } from '../useRecordPrintMode'

function GroupLabel({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div
      role="presentation"
      className="px-2.5 pb-1 pt-1.5 text-[0.62em] font-bold uppercase tracking-[0.1em] text-muted-foreground"
    >
      {children}
    </div>
  )
}

/** Item label plus the one-line hint destructive items carry on desktop. */
function Labelled({ label, hint }: { label: string; hint?: string }): React.JSX.Element {
  if (!hint) return <>{label}</>
  return (
    <span className="flex min-w-0 flex-col">
      <span>{label}</span>
      <span className="text-[0.85em] font-normal leading-snug text-muted-foreground">{hint}</span>
    </span>
  )
}

export function RecordToolsMenu({ book, caps, view, actions }: RecordPieceProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const print = useRecordPrint()
  const {
    has,
    canMutateCurrent,
    isInmateReporter,
    canOverrideState,
    canManageRevisionAccess,
    canManageIncludedPapers,
    canManageSignedPaper,
  } = caps
  const { state, current, recordHasPapers, emailingRecord, scanBusy, wordReopenTrigger, adjustSigTrigger, nextStep } = view
  const { openOverlay, emailViaOutlook, setUnfileOpen, replaceSignedRef, fileSignedRef, requestDelete } = actions
  if (!book) return null

  const overflow = nextStep?.overflow ?? []
  const canReroute = overflow.includes('reroute')
  const canScanSigned = overflow.includes('scanSigned')
  const deleteReason = deleteBlockReason(book, { has, isInmateReporter })
  const deleteVisible = deleteReason !== 'noCapability' && deleteReason !== 'restricted'
  const deleteReasonText = deleteReasonKey(deleteReason)

  const showEditing =
    !isInmateReporter &&
    (wordReopenTrigger != null ||
      adjustSigTrigger != null ||
      canReroute ||
      canScanSigned ||
      canManageSignedPaper)
  const showAdmin =
    !isInmateReporter &&
    ((canOverrideState && canMutateCurrent) || canManageRevisionAccess || canManageSignedPaper || deleteVisible)

  // modal={false}: its items open confirm dialogs, and Radix's modal menu leaves
  // `pointer-events: none` on <body> when a dialog opens from it (page dead after Cancel/Delete).
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <HeaderBtn
          icon={<Wrench className="h-3.5 w-3.5" aria-hidden="true" />}
          label={t('books.record.tools')}
          tone="plain"
        />
      </DropdownMenuTrigger>
      {/* Portaled outside the print-hidden header: without the marker the
          still-open menu lands on the sheet when Print runs from it. */}
      <DropdownMenuContent align="end" side="bottom" data-print-hide>
        <GroupLabel>{t('books.record.toolsDocument')}</GroupLabel>
        <DropdownMenuItem onSelect={print}>
          <Printer className="h-3.5 w-3.5" aria-hidden="true" />
          {t('books.record.print')}
        </DropdownMenuItem>
        {/* Hand this record to Outlook. Same one-item basket prefill the
            tray builds, so subject/body/reference PDF and the book link
            are identical whether you email one record or a whole basket. */}
        {!isInmateReporter && (
          <DropdownMenuItem
            reason={recordHasPapers ? undefined : t('books.reason.emailNoDoc')}
            pending={emailingRecord}
            onSelect={() => void emailViaOutlook()}
          >
            <Mail className="h-3.5 w-3.5" aria-hidden="true" />
            {t('books.record.emailViaOutlook')}
          </DropdownMenuItem>
        )}
        {canManageIncludedPapers && (
          <DropdownMenuItem onSelect={() => openOverlay('papers')}>
            <FileStack className="h-3.5 w-3.5" aria-hidden="true" />
            {t('books.includedPapers.addToPdf')}
          </DropdownMenuItem>
        )}
        {state === 'approved' && current?.signed_pdf_url && (
          <DropdownMenuItem asChild>
            <a href={current.signed_pdf_url} target="_blank" rel="noopener noreferrer">
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              {t('books.record.downloadSigned')}
            </a>
          </DropdownMenuItem>
        )}

        {showEditing && (
          <>
            <DropdownMenuSeparator />
            <GroupLabel>{t('books.record.toolsEditing')}</GroupLabel>
            {wordReopenTrigger && (
              <DropdownMenuItem
                pending={wordReopenTrigger.disabled}
                onSelect={() => wordReopenTrigger.onClick()}
              >
                {wordReopenTrigger.icon}
                {wordReopenTrigger.label}
              </DropdownMenuItem>
            )}
            {canReroute && (
              <DropdownMenuItem onSelect={() => openOverlay('submit')}>
                <UserCog className="h-3.5 w-3.5" aria-hidden="true" />
                {t('books.approval.reroute')}
              </DropdownMenuItem>
            )}
            {canScanSigned && (
              <DropdownMenuItem
                pending={scanBusy}
                onSelect={() => fileSignedRef.current?.click()}
              >
                <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                {t('books.pane.scanSignedCopy')}
              </DropdownMenuItem>
            )}
            {adjustSigTrigger && (
              <DropdownMenuItem onSelect={() => adjustSigTrigger.onClick()}>
                {adjustSigTrigger.icon}
                {adjustSigTrigger.label}
              </DropdownMenuItem>
            )}
            {canManageSignedPaper && (
              <DropdownMenuItem onSelect={() => replaceSignedRef.current?.click()}>
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                {t('books.pane.replaceSigned')}
              </DropdownMenuItem>
            )}
          </>
        )}

        {showAdmin && (
          <>
            <DropdownMenuSeparator />
            <GroupLabel>{t('books.record.toolsAdmin')}</GroupLabel>
            {canOverrideState && canMutateCurrent && (
              <DropdownMenuItem
                variant="danger"
                data-testid="state-override-trigger"
                onSelect={() => openOverlay('override')}
              >
                <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
                <Labelled
                  label={t('books.stateOverride.trigger')}
                  hint={t('books.record.hint.state')}
                />
              </DropdownMenuItem>
            )}
            {canManageRevisionAccess && (
              <DropdownMenuItem
                data-testid="revision-access-trigger"
                onSelect={() => openOverlay('revision-access')}
              >
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                {t('books.approval.revisionAccess')}
              </DropdownMenuItem>
            )}
            {canManageSignedPaper && (
              <DropdownMenuItem variant="danger" onSelect={() => setUnfileOpen(true)}>
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                <Labelled
                  label={t('books.pane.unfileSignedBtn')}
                  hint={t('books.record.hint.unfile')}
                />
              </DropdownMenuItem>
            )}
            {deleteVisible && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="danger"
                  data-testid="record-delete-trigger"
                  reason={deleteReasonText ? t(deleteReasonText) : undefined}
                  onSelect={requestDelete}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  <Labelled
                    label={state === 'none' ? t('books.record.deleteDraft') : t('books.record.delete')}
                    hint={deleteReasonText ? undefined : t('books.record.hint.delete')}
                  />
                </DropdownMenuItem>
              </>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
