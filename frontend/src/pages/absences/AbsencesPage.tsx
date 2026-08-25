/**
 * AbsencesPage — the formless absence service (Services gallery tile).
 *
 * Records day-level absence rows on the employee: pick an employee, a first
 * and last day, an optional note, Save. No template, no document — the record
 * is the deliverable, and the time sheet reads it as `AB`. A later sick leave
 * covering the same days supersedes the rows (announced on the generation
 * side, see ApplicationPage's job-done toast).
 *
 * Below the form, the employee's recorded absences are listed newest-first
 * with a per-row remove (ConfirmDialog — window.confirm is dead inside the
 * pywebview shell).
 *
 * Deep-link: `?employee_id=<G-id>` pre-selects the employee (same convention
 * as /application).
 */

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { api, apiErrorMessage } from '@/lib/api'
import type { AbsenceRead } from '@/lib/api'
import { todayIso } from '@/lib/leaveDateMath'
import { useCapabilities } from '@/lib/useCapabilities'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Label } from '@/components/ui/label'
import { LeaveEmployeePicker } from '@/pages/leaves/LeaveEmployeePicker'

export function AbsencesPage(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const isAr = i18n.language.startsWith('ar')
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const qc = useQueryClient()
  const { has } = useCapabilities()
  const canEdit = has('leaves.edit')

  const [employeeId, setEmployeeId] = useState<string | null>(
    () => searchParams.get('employee_id'),
  )
  const [start, setStart] = useState(todayIso)
  const [end, setEnd] = useState(todayIso)
  const [note, setNote] = useState('')
  const [deleting, setDeleting] = useState<AbsenceRead | null>(null)

  const dateFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        weekday: 'short',
      }),
    [i18n.language],
  )

  const absencesQuery = useQuery({
    queryKey: ['employee-absences', employeeId],
    queryFn: () => api.listEmployeeAbsences(employeeId as string),
    enabled: !!employeeId,
  })

  const createMutation = useMutation({
    mutationFn: () =>
      api.createEmployeeAbsences(employeeId as string, {
        start_date: start,
        end_date: end,
        note: note.trim() || null,
      }),
    onSuccess: (result) => {
      void qc.invalidateQueries({ queryKey: ['employee-absences', employeeId] })
      void qc.invalidateQueries({ queryKey: ['employee-detail', employeeId] })
      const created = result.created.length
      const skipped = result.skipped_off_roster.length
      if (created > 0 && skipped > 0) {
        toast.success(t('absences.savedWithSkips', { count: created, skipped }))
      } else if (created > 0) {
        toast.success(t('absences.saved', { count: created }))
      } else if (skipped > 0) {
        toast.warning(t('absences.savedWithSkips', { count: created, skipped }))
      } else {
        toast.info(t('absences.nothingToSave'))
      }
      setNote('')
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  })

  const deleteMutation = useMutation({
    mutationFn: (absenceId: number) =>
      api.deleteEmployeeAbsence(employeeId as string, absenceId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['employee-absences', employeeId] })
      void qc.invalidateQueries({ queryKey: ['employee-detail', employeeId] })
      toast.success(t('absences.deleted'))
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  })

  const canSubmit =
    !!employeeId && !!start && !!end && start <= end && canEdit && !createMutation.isPending
  const absences = absencesQuery.data ?? []

  return (
    <div className="flex flex-1 flex-col overflow-auto bg-background">
      <div className="mx-auto w-full max-w-[1320px] flex-1 px-4 pb-10 pt-6 sm:px-8">
        <div className="anim-fade-up">
          <header className="mb-5">
            <button
              type="button"
              onClick={() => navigate('/application')}
              className="mb-2.5 inline-flex items-center gap-1.5 text-[0.86em] font-medium text-primary transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              {isAr ? (
                <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
              ) : (
                <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
              )}
              {t('application.servicesTitle')}
            </button>
            <div className="flex items-center gap-3">
              <span
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-surface text-[1.5em] leading-none ring-1 ring-hairline"
                aria-hidden
              >
                🚫
              </span>
              <div className="min-w-0">
                <h2 className="truncate text-[1.4em] font-bold leading-snug tracking-tight text-foreground">
                  {t('absences.title')}
                </h2>
                <p className="mt-0.5 text-[0.82em] text-muted-foreground">
                  {t('absences.subtitle')}
                </p>
              </div>
            </div>
          </header>

          <div className="mx-auto w-full max-w-2xl">
            <div className="rounded-2xl border border-hairline bg-surface p-4 sm:p-5">
              <div className="flex flex-col gap-1.5">
                <Label>{t('leaves.filters.employee')}</Label>
                <LeaveEmployeePicker
                  selectedId={employeeId}
                  onSelect={setEmployeeId}
                  placeholder={t('application.employeePicker.placeholder')}
                />
              </div>

              {employeeId && (
                <>
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="absence-start">{t('absences.form.start')}</Label>
                      <input
                        id="absence-start"
                        type="date"
                        value={start}
                        onChange={(e) => setStart(e.target.value)}
                        className="h-9 rounded-md border border-input bg-surface px-3 font-mono text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="absence-end">{t('absences.form.end')}</Label>
                      <input
                        id="absence-end"
                        type="date"
                        value={end}
                        min={start}
                        onChange={(e) => setEnd(e.target.value)}
                        className="h-9 rounded-md border border-input bg-surface px-3 font-mono text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                    </div>
                  </div>

                  <div className="mt-4 flex flex-col gap-1.5">
                    <Label htmlFor="absence-note">{t('absences.form.note')}</Label>
                    <input
                      id="absence-note"
                      type="text"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder={t('absences.form.notePlaceholder')}
                      dir="auto"
                      className="h-9 rounded-md border border-input bg-surface px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </div>

                  <div className="mt-4 flex justify-end">
                    <Button
                      type="button"
                      disabled={!canSubmit}
                      onClick={() => createMutation.mutate()}
                    >
                      {t('absences.form.save')}
                    </Button>
                  </div>
                </>
              )}
            </div>

            {employeeId && (
              <section className="mt-6" aria-label={t('absences.list.title')}>
                <h3 className="mb-2 text-[0.95em] font-semibold text-foreground">
                  {t('absences.list.title')}
                </h3>
                {absences.length === 0 ? (
                  <div className="rounded-2xl bg-surface p-8 text-center text-[0.9em] text-muted-foreground">
                    {t('absences.list.empty')}
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-2xl border border-hairline bg-surface">
                    {absences.map((a) => (
                      <div
                        key={a.id}
                        className="flex items-center gap-3 border-b border-hairline px-4 py-2.5 last:border-b-0"
                      >
                        <div className="font-mono text-[0.86em] text-foreground">
                          {dateFmt.format(new Date(`${a.date}T00:00:00`))}
                        </div>
                        <div className="min-w-0 flex-1 truncate text-[0.86em] text-muted-foreground" dir="auto">
                          {a.note ?? ''}
                        </div>
                        {canEdit && (
                          <button
                            type="button"
                            onClick={() => setDeleting(a)}
                            aria-label={t('common.delete')}
                            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <Trash2 className="h-4 w-4" strokeWidth={1.8} aria-hidden />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
        title={t('absences.list.confirmDelete', {
          date: deleting ? dateFmt.format(new Date(`${deleting.date}T00:00:00`)) : '',
        })}
        confirmLabel={t('common.delete')}
        destructive
        onConfirm={async () => {
          if (deleting) await deleteMutation.mutateAsync(deleting.id)
        }}
      />
    </div>
  )
}
