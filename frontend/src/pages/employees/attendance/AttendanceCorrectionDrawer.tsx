import * as Dialog from '@radix-ui/react-dialog'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { api, ApiError, apiErrorMessage } from '@/lib/api'
import type { AttendanceAdjustmentWrite, AttendanceCase } from '@/lib/api'
import { pickEmployeeName } from '@/lib/employeeName'
import { useCapabilities } from '@/lib/useCapabilities'
import { cn } from '@/lib/utils'

import {
  buildAdjustmentPayload,
  draftFromEffective,
  type AttendanceCorrectionDraft,
  type AttendanceEffective,
  type AttendancePresenceState,
} from './attendanceCorrectionForm'

interface Props {
  caseId: number | null
  onClose: () => void
}

const PRESENCE_STATES: readonly AttendancePresenceState[] = [
  'scheduled',
  'on_duty',
  'completed',
  'absent',
  'excused_leave',
  'off',
  'unknown',
]

function isOptionalString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isOptionalNumber(value: unknown): value is number | null {
  return value === null || typeof value === 'number'
}

function isOptionalBoolean(value: unknown): value is boolean | null {
  return value === null || typeof value === 'boolean'
}

function isOptionalPresenceState(value: unknown): value is AttendancePresenceState | null {
  return value === null || PRESENCE_STATES.some((state) => state === value)
}

function effectiveFromCase(attendanceCase: AttendanceCase | undefined): AttendanceEffective | null {
  const value = attendanceCase?.effective
  if (!value) return null
  const presenceState = value.presence_state
  const firstInAt = value.first_in_at
  const latestInAt = value.latest_in_at
  const finalOutAt = value.final_out_at
  const lateMinutes = value.late_minutes
  const earlyExitMinutes = value.early_exit_minutes
  const missingCheckout = value.missing_checkout
  if (
    !isOptionalPresenceState(presenceState)
    || !isOptionalString(firstInAt)
    || !isOptionalString(latestInAt)
    || !isOptionalString(finalOutAt)
    || !isOptionalNumber(lateMinutes)
    || !isOptionalNumber(earlyExitMinutes)
    || !isOptionalBoolean(missingCheckout)
  ) return null
  return {
    presence_state: presenceState,
    first_in_at: firstInAt,
    latest_in_at: latestInAt,
    final_out_at: finalOutAt,
    late_minutes: lateMinutes,
    early_exit_minutes: earlyExitMinutes,
    missing_checkout: missingCheckout,
  }
}

function effectiveAdjustmentId(attendanceCase: AttendanceCase | undefined): number | null {
  const value = attendanceCase?.effective
  return value && typeof value.adjustment_id === 'number' ? value.adjustment_id : null
}

function display(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  return String(value)
}

function EvidenceSection({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <section className="border-b border-hairline py-4 last:border-b-0">
      <h3 className="text-[0.72em] font-bold uppercase tracking-[0.14em] text-muted-foreground">{title}</h3>
      <div className="mt-2.5">{children}</div>
    </section>
  )
}

function Facts({ items }: { items: ReadonlyArray<readonly [string, unknown]> }): React.JSX.Element {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-[0.8em]">
      {items.map(([label, value]) => (
        <div key={label}>
          <dt className="text-[0.82em] text-faint">{label}</dt>
          <dd className="mt-0.5 font-medium text-foreground">{display(value)}</dd>
        </div>
      ))}
    </dl>
  )
}

export function AttendanceCorrectionDrawer({ caseId, onClose }: Props): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const { has: hasCapability } = useCapabilities()
  const queryClient = useQueryClient()
  const priorFocusRef = useRef<HTMLElement | null>(null)
  const [draft, setDraft] = useState<AttendanceCorrectionDraft | null>(null)
  const [draftEtag, setDraftEtag] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [conflictWarning, setConflictWarning] = useState<string | null>(null)
  const [liveMessage, setLiveMessage] = useState<string | null>(null)
  const [revokeReason, setRevokeReason] = useState('')
  const [revokeTarget, setRevokeTarget] = useState<{ id: number; reason: string; etag: string } | null>(null)
  const caseQuery = useQuery({
    queryKey: ['attendance-case', caseId] as const,
    queryFn: () => api.getAttendanceCase(caseId as number),
    enabled: caseId !== null,
  })
  const attendanceCase = caseQuery.data?.data
  const effective = effectiveFromCase(attendanceCase)
  const canCorrect = hasCapability('workforce.attendance.correct')
  const etag = caseQuery.data?.etag ?? ''
  const caseSnapshotIsCurrent = caseQuery.isSuccess && !caseQuery.isFetching && etag !== ''
  const draftIsCurrent = caseSnapshotIsCurrent && draft !== null && draftEtag === etag
  const activeAdjustmentId = effectiveAdjustmentId(attendanceCase)
  const effectiveAdjustment = attendanceCase?.adjustments?.find((adjustment) => adjustment.id === activeAdjustmentId)

  useEffect(() => {
    setDraft(null)
    setDraftEtag(null)
    setActionError(null)
    setConflictWarning(null)
    setLiveMessage(null)
    setRevokeReason('')
    if (caseId !== null) {
      priorFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    }
  }, [caseId])

  useEffect(() => {
    if (!caseSnapshotIsCurrent || effective === null || draftEtag === etag) return
    setDraft(draftFromEffective(effective))
    setDraftEtag(etag)
  }, [caseSnapshotIsCurrent, draftEtag, effective, etag])

  const reloadEvidence = async (resetDraft: boolean) => {
    const result = await caseQuery.refetch()
    if (resetDraft && result.data?.data) {
      const refreshedEffective = effectiveFromCase(result.data.data)
      if (refreshedEffective) {
        setDraft(draftFromEffective(refreshedEffective))
        setDraftEtag(result.data.etag)
      }
    }
    return result.data
  }

  const invalidateAttendance = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['attendance-case', caseId] }),
      queryClient.invalidateQueries({ queryKey: ['attendance-exceptions'] }),
      queryClient.invalidateQueries({ queryKey: ['attendance-day'] }),
      queryClient.invalidateQueries({ queryKey: ['employee-attendance'] }),
      queryClient.invalidateQueries({ queryKey: ['workforce', 'snapshot'] }),
      queryClient.invalidateQueries({ queryKey: ['notification-counts'] }),
    ])
  }

  const recoverConflict = async (error: unknown): Promise<void> => {
    if (error instanceof ApiError && error.code === 'ATTENDANCE_CASE_VERSION_CONFLICT') {
      const conflictedDraft = draft
      const refreshed = await reloadEvidence(false)
      if (conflictedDraft && refreshed?.etag) {
        setDraft(conflictedDraft)
        setDraftEtag(refreshed.etag)
      }
      setConflictWarning(t('attendance.review.conflictWarning'))
      return
    }
    setActionError(apiErrorMessage(error))
  }

  const correctionMutation = useMutation({
    mutationFn: ({ etag: mutationEtag, payload }: {
      etag: string
      payload: AttendanceAdjustmentWrite
    }) => api.createAttendanceAdjustment(caseId as number, mutationEtag, payload),
    retry: false,
    onSuccess: async () => {
      await invalidateAttendance()
      await reloadEvidence(true)
      const message = t('attendance.review.correctionSaved')
      setLiveMessage(message)
      toast.success(message)
    },
    onError: recoverConflict,
  })

  const revokeMutation = useMutation({
    mutationFn: (target: { id: number; reason: string; etag: string }) =>
      api.revokeAttendanceAdjustment(caseId as number, target.id, target.etag, { reason: target.reason }),
    retry: false,
    onSuccess: async () => {
      await invalidateAttendance()
      await reloadEvidence(true)
      const message = t('attendance.review.correctionRevoked')
      setLiveMessage(message)
      toast.success(message)
    },
    onError: recoverConflict,
  })

  const restoreFocus = (): void => {
    priorFocusRef.current?.focus()
  }

  const codeLabel = (group: string, value: string | null | undefined): string => {
    if (!value) return '—'
    const key = value.toLowerCase()
    return t(`attendance.review.${group}.${key}`, {
      defaultValue: value.replaceAll('_', ' ').toLowerCase().replace(/^./, (letter) => letter.toUpperCase()),
    })
  }
  return (
    <Dialog.Root open={caseId !== null} onOpenChange={(open) => { if (!open) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]" />
        <Dialog.Content
          aria-modal="true"
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            restoreFocus()
          }}
          className={cn(
            'drawer-end fixed inset-0 z-50 flex h-dvh max-h-none flex-col rounded-none bg-surface shadow-2xl focus-visible:outline-none',
            'md:inset-y-0 md:start-auto md:end-0 md:h-dvh md:w-full md:max-w-xl md:rounded-none md:rounded-s-2xl',
          )}
        >
          <span aria-hidden className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-hairline md:hidden" />
          <header className="flex items-center gap-3 border-b border-hairline px-5 py-3.5">
            <div className="min-w-0 flex-1">
              <Dialog.Title className="truncate text-[0.95em] font-bold">
                {attendanceCase
                  ? pickEmployeeName({ name_en: attendanceCase.name_en, name_ar: attendanceCase.name_ar ?? null }, i18n.language)
                  : t('attendance.review.title')}
              </Dialog.Title>
              {attendanceCase && (
                <p className="mt-0.5 font-mono text-[0.7em] text-muted-foreground">
                  {attendanceCase.employee_id} · {attendanceCase.operational_date}
                </p>
              )}
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label={t('common.close')}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-surface-tinted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
            {caseQuery.isPending ? (
              <p role="status" className="py-5 text-[0.82em] text-muted-foreground">{t('common.loading')}</p>
            ) : caseQuery.isError || !attendanceCase ? (
              <p role="alert" className="py-5 text-[0.82em] text-accent">{t('attendance.review.loadFailed')}</p>
            ) : (
              <>
                <EvidenceSection title={t('attendance.review.sourceFacts')}>
                  <Facts
                    items={[
                      [t('attendance.review.assignment'), `${display(attendanceCase.duty_unit_snapshot)} / ${display(attendanceCase.duty_post_snapshot)}`],
                      [t('attendance.review.department'), attendanceCase.department_snapshot],
                      [t('attendance.review.crew'), attendanceCase.crew_name_snapshot ?? attendanceCase.crew_code_snapshot],
                      [t('attendance.review.shift'), attendanceCase.shift_code_snapshot],
                      [t('attendance.review.scheduledWindow'), `${attendanceCase.scheduled_start_at} — ${attendanceCase.scheduled_end_at}`],
                      [t('attendance.review.effectiveResult'), codeLabel('presence', attendanceCase.effective?.presence_state as string | undefined)],
                      [t('attendance.review.reason'), codeLabel('reasons', attendanceCase.effective?.reason_code as string | undefined)],
                      [t('attendance.review.firstIn'), attendanceCase.effective?.first_in_at],
                      [t('attendance.review.latestIn'), attendanceCase.effective?.latest_in_at],
                      [t('attendance.review.finalOut'), attendanceCase.effective?.final_out_at],
                      [t('attendance.review.lateMinutes'), attendanceCase.effective?.late_minutes],
                      [t('attendance.review.earlyExitMinutes'), attendanceCase.effective?.early_exit_minutes],
                      [t('attendance.review.missingCheckout'), attendanceCase.effective?.missing_checkout === undefined ? null : t(attendanceCase.effective?.missing_checkout ? 'common.yes' : 'common.no')],
                    ]}
                  />
                  <ul className="mt-3 divide-y divide-hairline rounded-lg border border-hairline">
                    {(attendanceCase.punches ?? []).map((punch, index) => (
                      <li key={`${punch.occurred_at}-${index}`} className="flex justify-between gap-3 px-3 py-2 text-[0.78em]">
                        <span>{punch.occurred_at}</span>
                        <span className="text-muted-foreground">{display(punch.device_name)}</span>
                      </li>
                    ))}
                  </ul>
                </EvidenceSection>

                <EvidenceSection title={t('attendance.review.automaticEvaluations')}>
                  <ol className="space-y-2">
                    {(attendanceCase.evaluations ?? []).map((evaluation) => (
                      <li key={evaluation.id} className="rounded-lg bg-surface-tinted px-3 py-2 text-[0.78em]">
                        <span className="font-mono text-muted-foreground">r{evaluation.revision}</span>{' '}
                        <span className="font-semibold">{codeLabel('presence', evaluation.presence_state)}</span>
                        <span className="text-muted-foreground"> · {codeLabel('reasons', evaluation.reason_code)} · {evaluation.evaluated_at}</span>
                      </li>
                    ))}
                  </ol>
                </EvidenceSection>

                <EvidenceSection title={t('attendance.review.humanCorrections')}>
                  <ol className="space-y-2">
                    {(attendanceCase.adjustments ?? []).map((adjustment) => (
                      <li key={adjustment.id} className="rounded-lg bg-surface-tinted px-3 py-2 text-[0.78em]">
                        <p className="font-medium">{adjustment.reason}</p>
                        <Facts
                          items={[
                            [t('attendance.review.baseEvaluation'), adjustment.base_evaluation_id],
                            [t('attendance.review.supersedes'), adjustment.supersedes_adjustment_id],
                            [t('attendance.review.replacementPresence'), codeLabel('presence', adjustment.replacement_presence_state)],
                            [t('attendance.review.firstIn'), adjustment.replacement_first_in_at],
                            [t('attendance.review.latestIn'), adjustment.replacement_latest_in_at],
                            [t('attendance.review.finalOut'), adjustment.replacement_final_out_at],
                            [t('attendance.review.lateMinutes'), adjustment.replacement_late_minutes],
                            [t('attendance.review.earlyExitMinutes'), adjustment.replacement_early_exit_minutes],
                            [t('attendance.review.missingCheckout'), adjustment.replacement_missing_checkout === null || adjustment.replacement_missing_checkout === undefined ? null : t(adjustment.replacement_missing_checkout ? 'common.yes' : 'common.no')],
                          ]}
                        />
                        <p className="mt-2 text-muted-foreground">{adjustment.created_at}{adjustment.revoked_at ? ` · ${t('attendance.review.revoked')} ${adjustment.revoked_at}` : ''}</p>
                      </li>
                    ))}
                    {(attendanceCase.adjustment_audit ?? []).map((audit) => (
                      <li key={`${audit.adjustment_id}-${audit.action}-${audit.occurred_at}`} className="rounded-lg border border-hairline px-3 py-2 text-[0.78em]">
                        <span className="font-semibold">{display(audit.actor)}</span>
                        <span className="text-muted-foreground"> · {codeLabel('auditActions', audit.action)} · {audit.occurred_at} · {audit.reason}</span>
                      </li>
                    ))}
                  </ol>
                </EvidenceSection>

                {canCorrect && effective && draft && (
                  <EvidenceSection title={t('attendance.review.correction')}>
                    {conflictWarning && <p role="alert" className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-[0.8em] text-amber-900">{conflictWarning}</p>}
                    {actionError && <p role="alert" className="mb-3 rounded-md bg-accent/10 px-3 py-2 text-[0.8em] text-accent">{actionError}</p>}
                    {liveMessage && <p role="status" aria-live="polite" className="sr-only">{liveMessage}</p>}
                    <form
                      className="grid gap-3"
                      onSubmit={(event) => {
                        event.preventDefault()
                        setActionError(null)
                        setConflictWarning(null)
                        const baselineEtag = draftEtag
                        if (!draftIsCurrent || baselineEtag === null) return
                        try {
                          correctionMutation.mutate({
                            etag: baselineEtag,
                            payload: buildAdjustmentPayload(effective, draft),
                          })
                        } catch (error) {
                          const code = error instanceof Error ? error.message : ''
                          setActionError(
                            code === 'CORRECTION_REASON_REQUIRED'
                              ? t('attendance.review.reasonRequired')
                              : code === 'CORRECTION_UNCHANGED'
                                ? t('attendance.review.unchanged')
                                : apiErrorMessage(error),
                          )
                        }
                      }}
                    >
                      <div className="grid grid-cols-2 gap-3">
                        <label className="grid gap-1 text-[0.78em] font-medium" htmlFor="correction-presence">
                          {t('attendance.review.correctionPresence')}
                          <select
                            id="correction-presence"
                            value={draft.presenceState ?? ''}
                            onChange={(event) => {
                              const presenceState = PRESENCE_STATES.find((state) => state === event.target.value) ?? null
                              setDraft({ ...draft, presenceState })
                            }}
                            className="h-9 rounded-md border border-input bg-surface px-2 text-sm"
                          >
                            <option value="">{t('attendance.review.noOverride')}</option>
                            {PRESENCE_STATES.map((state) => <option key={state} value={state}>{codeLabel('presence', state)}</option>)}
                          </select>
                        </label>
                        <label className="grid gap-1 text-[0.78em] font-medium" htmlFor="correction-missing-checkout">
                          {t('attendance.review.missingCheckout')}
                          <select
                            id="correction-missing-checkout"
                            value={draft.missingCheckout === null ? '' : String(draft.missingCheckout)}
                            onChange={(event) => setDraft({
                              ...draft,
                              missingCheckout: event.target.value === '' ? null : event.target.value === 'true',
                            })}
                            className="h-9 rounded-md border border-input bg-surface px-2 text-sm"
                          >
                            <option value="">{t('attendance.review.noOverride')}</option>
                            <option value="true">{t('common.yes')}</option>
                            <option value="false">{t('common.no')}</option>
                          </select>
                        </label>
                      </div>
                      <div className="grid grid-cols-3 gap-3">
                        {([
                          ['correction-first-in', 'firstInAt', 'firstIn'],
                          ['correction-latest-in', 'latestInAt', 'latestIn'],
                          ['correction-final-out', 'finalOutAt', 'finalOut'],
                        ] as const).map(([id, field, label]) => (
                          <label key={id} className="grid gap-1 text-[0.78em] font-medium" htmlFor={id}>
                            {t(`attendance.review.${label}`)}
                            <input
                              id={id}
                              type="datetime-local"
                              value={draft[field]}
                              onChange={(event) => setDraft({ ...draft, [field]: event.target.value })}
                              className="h-9 min-w-0 rounded-md border border-input bg-surface px-2 text-sm"
                            />
                          </label>
                        ))}
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        {([
                          ['correction-late-minutes', 'lateMinutes', 'lateMinutes'],
                          ['correction-early-exit-minutes', 'earlyExitMinutes', 'earlyExitMinutes'],
                        ] as const).map(([id, field, label]) => (
                          <label key={id} className="grid gap-1 text-[0.78em] font-medium" htmlFor={id}>
                            {t(`attendance.review.${label}`)}
                            <input
                              id={id}
                              min="0"
                              type="number"
                              value={draft[field]}
                              onChange={(event) => setDraft({ ...draft, [field]: event.target.value })}
                              className="h-9 rounded-md border border-input bg-surface px-2 text-sm"
                            />
                          </label>
                        ))}
                      </div>
                      <label className="grid gap-1 text-[0.78em] font-medium" htmlFor="correction-reason">
                        {t('attendance.review.correctionReason')}
                        <textarea
                          id="correction-reason"
                          required
                          value={draft.reason}
                          onChange={(event) => setDraft({ ...draft, reason: event.target.value })}
                          className="min-h-20 rounded-md border border-input bg-surface px-2 py-1.5 text-sm"
                        />
                      </label>
                      <button
                        type="submit"
                        disabled={correctionMutation.isPending || draft.reason.trim() === '' || !draftIsCurrent}
                        className="h-9 self-start rounded-md bg-primary px-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {correctionMutation.isPending ? t('common.loading') : t('attendance.review.saveCorrection')}
                      </button>
                    </form>

                    {effectiveAdjustment && (
                      <div className="mt-5 border-t border-hairline pt-4">
                        <label className="grid gap-1 text-[0.78em] font-medium" htmlFor="revoke-reason">
                          {t('attendance.review.revokeReason')}
                          <textarea
                            id="revoke-reason"
                            required
                            value={revokeReason}
                            onChange={(event) => setRevokeReason(event.target.value)}
                            className="min-h-16 rounded-md border border-input bg-surface px-2 py-1.5 text-sm"
                          />
                        </label>
                        <button
                          type="button"
                          disabled={revokeMutation.isPending || revokeReason.trim() === '' || !caseSnapshotIsCurrent}
                          onClick={() => {
                            if (caseSnapshotIsCurrent) {
                              setRevokeTarget({ id: effectiveAdjustment.id, reason: revokeReason.trim(), etag })
                            }
                          }}
                          className="mt-3 h-9 rounded-md border border-accent px-3 text-sm font-semibold text-accent disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {t('attendance.review.revokeCorrection')}
                        </button>
                      </div>
                    )}
                  </EvidenceSection>
                )}
              </>
            )}
          </div>
          <ConfirmDialog
            open={revokeTarget !== null}
            onOpenChange={(open) => { if (!open) setRevokeTarget(null) }}
            title={t('attendance.review.confirmRevokeTitle')}
            description={t('attendance.review.confirmRevokeDescription')}
            confirmLabel={t('attendance.review.confirmRevoke')}
            destructive
            onConfirm={() => {
              if (revokeTarget && caseSnapshotIsCurrent && revokeTarget.etag === etag) {
                revokeMutation.mutate(revokeTarget)
              }
              setRevokeTarget(null)
            }}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
