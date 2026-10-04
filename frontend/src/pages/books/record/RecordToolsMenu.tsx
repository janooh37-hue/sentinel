/**
 * RecordToolsMenu — the header's Tools dropdown (document / editing / admin
 * groups). Rendered inside RecordHeader's utility row.
 */

import { Check, FileStack, FileText, Loader2, Mail, Printer, RefreshCw, ShieldAlert, ShieldCheck, Trash2, Wrench } from 'lucide-react'
import { HeaderBtn } from '../HeaderBtn'
import { paperUrl } from '../recordPapers'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import type { RecordPieceProps } from './recordActions'
import { useTranslation } from 'react-i18next'


export function RecordToolsMenu({ caps, view, actions }: RecordPieceProps): React.JSX.Element {
  const { t } = useTranslation()
  const { canMutateCurrent, isInmateReporter, canOverrideState, canManageRevisionAccess, canManageIncludedPapers, canManageSignedPaper } = caps
  const { state, current, recordHasPapers, emailingRecord, wordReopenTrigger, adjustSigTrigger } = view
  const { openOverlay, emailViaOutlook, setUnfileOpen, replaceSignedRef } = actions
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <HeaderBtn
          icon={<Wrench className="h-3.5 w-3.5" aria-hidden="true" />}
          label={t('books.record.tools')}
          tone="plain"
        />
      </DropdownMenuTrigger>
      {/* Portaled outside the print-hidden header: without the marker the
          still-open menu lands on the sheet when Print runs from it. */}
      <DropdownMenuContent align="end" data-print-hide>
        <div className="px-2.5 pb-1 pt-1.5 text-[0.62em] font-bold uppercase tracking-[0.1em] text-muted-foreground">
          {t('books.record.toolsDocument')}
        </div>
        <DropdownMenuItem onSelect={() => window.print()}>
          <Printer className="h-3.5 w-3.5" aria-hidden="true" />
          {t('books.record.print')}
        </DropdownMenuItem>
        {/* Hand this record to Outlook. Same one-item basket prefill the
            tray builds, so subject/body/reference PDF and the book link
            are identical whether you email one record or a whole basket. */}
        {!isInmateReporter && (
          <DropdownMenuItem
            disabled={!recordHasPapers || emailingRecord}
            onSelect={() => void emailViaOutlook()}
          >
            {emailingRecord ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Mail className="h-3.5 w-3.5" aria-hidden="true" />
            )}
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
              <Check className="h-3.5 w-3.5" strokeWidth={2.6} aria-hidden="true" />
              {t('books.record.downloadSigned')}
            </a>
          </DropdownMenuItem>
        )}
        {!isInmateReporter &&
          state === 'approved' &&
          current?.signed_pdf_url &&
          current?.document_id != null && (
            <DropdownMenuItem asChild>
              <a
                href={paperUrl({ documentId: current.document_id, original: true })}
                target="_blank"
                rel="noopener noreferrer"
              >
                <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                {t('books.record.viewOriginal')}
              </a>
            </DropdownMenuItem>
          )}

        {!isInmateReporter &&
          (wordReopenTrigger != null ||
            adjustSigTrigger != null ||
            canManageSignedPaper) && (
          <>
            <DropdownMenuSeparator />
            <div className="px-2.5 pb-1 pt-1.5 text-[0.62em] font-bold uppercase tracking-[0.1em] text-muted-foreground">
              {t('books.record.toolsEditing')}
            </div>
            {wordReopenTrigger && (
              <DropdownMenuItem
                disabled={wordReopenTrigger.disabled}
                onSelect={() => wordReopenTrigger.onClick()}
              >
                {wordReopenTrigger.icon}
                {wordReopenTrigger.label}
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
                {t('books.pane.replacePaper')}
              </DropdownMenuItem>
            )}
          </>
        )}

        {!isInmateReporter &&
          ((canOverrideState && canMutateCurrent) ||
            canManageRevisionAccess ||
            canManageSignedPaper) && (
          <>
            <DropdownMenuSeparator />
            <div className="px-2.5 pb-1 pt-1.5 text-[0.62em] font-bold uppercase tracking-[0.1em] text-muted-foreground">
              {t('books.record.toolsAdmin')}
            </div>
            {canOverrideState && canMutateCurrent && (
              <DropdownMenuItem
                data-testid="state-override-trigger"
                onSelect={() => openOverlay('override')}
              >
                <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
                {t('books.stateOverride.trigger')}
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
                {t('books.pane.unfileSignedBtn')}
              </DropdownMenuItem>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
