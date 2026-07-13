/**
 * RecordExpansion — the inline record detail strip rendered under an expanded
 * register row (prototype `tr.detail`/`.dwrap`): filed/period/days/status
 * facts, the employee's balance meters, and the decision actions (notes +
 * status transitions + two-step delete).
 *
 * Available actions are driven by the lifecycle module (actionsFor), so every
 * kind gets the right controls: request rows → Approve/Reject/Cancel; NS rows
 * → Delay / Extend / Add certificate (via NsControls); all others → none
 * except delete.
 */
import { useEffect, useId, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { api } from '@/lib/api'
import type { LeaveListItem } from '@/lib/api'
import { Button } from '@/components/ui/button'

import { SendButton } from '@/components/notify/SendButton'
import { SendWhatsAppButton } from '@/components/whatsapp/SendWhatsAppButton'

import { actionsFor, canonStatus, displayState, lifecycleGroup } from '../lifecycle'
import { useLeaveDecisionActions } from '../useLeaveDecisionActions'
import { NsControls } from '../NsControls'
import { ReturnFormDialog } from '../ReturnFormDialog'
import { StatusBadge } from '../StatusBadge'
import { BalanceMeters } from './BalanceMeters'
import { PeriodRun } from './PeriodRun'
import { dateLocale, fmtDayMonthYear } from './fmt'

const MICRO_LABEL =
  'text-[0.68em] font-semibold uppercase tracking-[0.1em] text-muted-foreground rtl:tracking-normal'

interface RecordExpansionProps {
  row: LeaveListItem
  /** ISO `YYYY-MM-DD` (today) — used to derive available actions. */
  today: string
  onMutated: () => void
  /**
   * Escape-close request. The parent (RegisterTable via LeavesReport's
   * `expandedId`) owns the open state — closing through it keeps the
   * focus-return effect working (focus goes back to the row's chevron).
   */
  onRequestClose?: () => void
}

export function RecordExpansion({
  row,
  today,
  onMutated,
  onRequestClose,
}: RecordExpansionProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const notesId = useId()
  const [notes, setNotes] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [returnOpen, setReturnOpen] = useState(false)
  const cancelDeleteRef = useRef<HTMLButtonElement>(null)

  // When the two-step delete swaps to confirm mode, the Delete button that
  // held focus unmounts — move focus to Cancel so keyboard users stay in the
  // confirm strip (and Escape/Enter act on the safe choice first).
  useEffect(() => {
    if (confirmDelete) cancelDeleteRef.current?.focus()
  }, [confirmDelete])

  // Escape collapses the expansion while it's open. Layered like the profile
  // strip / ledger ComposeWindow: yield to inner surfaces that already handled
  // Escape (defaultPrevented) and claim the key when we consume it. While the
  // two-step delete confirm strip is showing, Escape backs out of the confirm
  // (the safe choice) instead of collapsing the whole expansion.
  useEffect(() => {
    if (!onRequestClose) return
    function onKey(e: KeyboardEvent): void {
      if (e.defaultPrevented) return
      if (e.key === 'Escape') {
        e.preventDefault()
        if (confirmDelete) {
          setConfirmDelete(false)
          return
        }
        onRequestClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onRequestClose, confirmDelete])

  const locale = dateLocale(i18n.language)

  // Lifecycle-driven actions.
  const isNs = lifecycleGroup(row.leave_type) === 'ns'

  // Fetch NS detail (certificate_path) only for NS rows.
  const nsDetailQuery = useQuery({
    queryKey: ['leave', row.id],
    queryFn: () => api.getLeave(row.id),
    enabled: isNs,
  })

  const hasCertificate = !!nsDetailQuery.data?.certificate_path
  const acts = actionsFor(row.leave_type, row.status, row.end_date, today, hasCertificate)
  const hasRequestActions =
    acts.includes('approve') || acts.includes('reject') || acts.includes('cancel')

  const { updateMutation, deleteMutation } = useLeaveDecisionActions({
    leaveId: row.id,
    employeeId: row.employee_id,
    onMutated,
  })

  const awaitingCert =
    isNs &&
    displayState(row.leave_type, row.status, row.end_date, today, hasCertificate) === 'AwaitingCertificate'

  return (
    <>
    <div className="border-t border-hairline bg-surface-raised px-5 py-4">
      <div className="grid grid-cols-[1fr_1fr_auto] gap-6 max-lg:grid-cols-1">
        {/* 1 — record facts */}
        <dl className="grid grid-cols-2 content-start gap-x-4 gap-y-3">
          <div className="flex flex-col gap-0.5">
            <dt className={MICRO_LABEL}>{t('leaves.report.filed')}</dt>
            <dd>
              <bdi dir="ltr" className="font-mono text-[0.82em] text-foreground">
                {fmtDayMonthYear(row.created_at, locale)}
              </bdi>
            </dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className={MICRO_LABEL}>{t('leaves.report.period')}</dt>
            <dd>
              <PeriodRun
                start={row.start_date}
                end={row.end_date}
                locale={locale}
                className="text-[0.82em] text-foreground"
              />
            </dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className={MICRO_LABEL}>{t('leaves.columns.days')}</dt>
            <dd className="font-mono text-[0.82em] tabular-nums text-foreground">{row.days}</dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className={MICRO_LABEL}>{t('leaves.columns.status')}</dt>
            <dd>
              <StatusBadge status={row.status} leaveType={row.leave_type} endDate={row.end_date} hasCertificate={hasCertificate} />
            </dd>
          </div>
        </dl>

        {/* 2 — balance context */}
        <BalanceMeters employeeId={row.employee_id} />

        {/* 3 — actions */}
        <div className="flex min-w-[240px] flex-col gap-3">
          {/* Notes textarea — only shown alongside Approve/Reject/Cancel */}
          {hasRequestActions && (
            <div className="flex flex-col gap-1.5">
              <label htmlFor={notesId} className={MICRO_LABEL}>
                {t('leaves.report.notes')}
              </label>
              <textarea
                id={notesId}
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full rounded-md border border-hairline bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
          )}

          {/* Request actions: Approve / Reject / Cancel */}
          {hasRequestActions && (
            <div className="flex flex-wrap items-center gap-2">
              {acts.includes('approve') && (
                <Button
                  size="sm"
                  onClick={() => updateMutation.mutate({ status: 'Approved', n: notes })}
                  disabled={updateMutation.isPending}
                  className="rounded-full"
                >
                  {t('leaves.report.approve')}
                </Button>
              )}
              {acts.includes('reject') && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => updateMutation.mutate({ status: 'Rejected', n: notes })}
                  disabled={updateMutation.isPending}
                  className="rounded-full text-accent"
                >
                  {t('leaves.report.reject')}
                </Button>
              )}
              {acts.includes('cancel') && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => updateMutation.mutate({ status: 'Cancelled', n: notes })}
                  disabled={updateMutation.isPending}
                  className="rounded-full"
                >
                  {t('leaves.report.cancel')}
                </Button>
              )}
            </div>
          )}

          {/* File return form */}
          {acts.includes('return') && (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                onClick={() => setReturnOpen(true)}
                className="rounded-full"
              >
                {t('leaves.report.fileReturn')}
              </Button>
            </div>
          )}

          {/* Notify the employee on approval. canonStatus() normalises the
              stored bilingual/legacy status ("Approved - موافق", "Generated …")
              to "Approved" — a raw === would hide the button on every real
              record. Mirrors the mobile drawer (TabRecords). */}
          {canonStatus(row.status) === 'Approved' && (
            <div className="flex flex-wrap items-center gap-2">
              <SendWhatsAppButton eventType="leave_approved" recordId={row.id} />
              <SendButton eventType="leave_approved" recordId={row.id} />
            </div>
          )}

          {/* NS controls: Delay / Extend / Certificate.
              Also rendered for Completed NS rows with a certificate so the
              user can always access View certificate (acts=[] once Completed,
              but hasCertificate is true). */}
          {isNs && (acts.length > 0 || hasCertificate) && (
            <div className="border-t border-hairline pt-3">
              <NsControls
                row={row}
                hasCertificate={hasCertificate}
                awaitingCert={awaitingCert}
                onMutated={onMutated}
              />
            </div>
          )}

          {/* delete — two-step confirm, ported from the drawer */}
          <div className="mt-auto border-t border-hairline pt-3">
            {confirmDelete ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[0.78em] text-accent">
                  {t('leaves.actions.confirmDelete')}
                </span>
                <Button
                  ref={cancelDeleteRef}
                  variant="secondary"
                  size="sm"
                  onClick={() => setConfirmDelete(false)}
                  className="rounded-full"
                >
                  {t('common.cancel')}
                </Button>
                <Button
                  size="sm"
                  className="rounded-full bg-accent text-white hover:bg-accent-hover"
                  onClick={() => deleteMutation.mutate()}
                  disabled={deleteMutation.isPending}
                >
                  {t('leaves.actions.softDelete')}
                </Button>
              </div>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="rounded-full text-accent hover:text-accent"
                onClick={() => setConfirmDelete(true)}
              >
                {t('common.delete')}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
    <ReturnFormDialog
      open={returnOpen}
      leave={row}
      onOpenChange={setReturnOpen}
      onFiled={onMutated}
    />
    </>
  )
}
