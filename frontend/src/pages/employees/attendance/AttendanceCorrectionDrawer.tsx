import * as Dialog from '@radix-ui/react-dialog'
import { useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { api } from '@/lib/api'
import { pickEmployeeName } from '@/lib/employeeName'
import { cn } from '@/lib/utils'

interface Props {
  caseId: number | null
  onClose: () => void
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
  const priorFocusRef = useRef<HTMLElement | null>(null)
  const caseQuery = useQuery({
    queryKey: ['attendance-case', caseId] as const,
    queryFn: () => api.getAttendanceCase(caseId as number),
    enabled: caseId !== null,
  })
  const attendanceCase = caseQuery.data?.data

  useEffect(() => {
    if (caseId !== null) {
      priorFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    }
  }, [caseId])

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
              </>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
