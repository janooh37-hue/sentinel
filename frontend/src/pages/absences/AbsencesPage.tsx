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
import { ChevronLeft, ChevronRight, ClipboardCopy, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { api, apiErrorMessage } from '@/lib/api'
import type { AbsenceEpisodeRead, AbsenceRecordRead } from '@/lib/api'
import { copyTable } from '@/lib/copyTable'
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
  const [deleting, setDeleting] = useState<AbsenceEpisodeRead | null>(null)

  // Register tables want compact dates; the weekday makes cells too wide.
  const dateFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      }),
    [i18n.language],
  )

  const absencesQuery = useQuery({
    queryKey: ['employee-absence-episodes', employeeId],
    queryFn: () => api.listEmployeeAbsenceEpisodes(employeeId as string),
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
      void qc.invalidateQueries({ queryKey: ['employee-absence-episodes', employeeId] })
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
    mutationFn: (episode: AbsenceEpisodeRead) =>
      api.deleteEmployeeAbsenceRange(employeeId as string, episode.start_date, episode.end_date),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['employee-absence-episodes', employeeId] })
      void qc.invalidateQueries({ queryKey: ['employee-absences', employeeId] })
      void qc.invalidateQueries({ queryKey: ['employee-detail', employeeId] })
      toast.success(t('absences.deleted'))
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  })

  const canSubmit =
    !!employeeId && !!start && !!end && start <= end && canEdit && !createMutation.isPending
  const record: AbsenceRecordRead | undefined = absencesQuery.data
  const episodes = record?.episodes ?? []
  const employeeName = isAr
    ? (record?.employee_name_ar ?? record?.employee_name_en ?? '')
    : (record?.employee_name_en ?? '')
  const postUnit = [record?.duty_post, record?.duty_unit].filter(Boolean).join(' / ')

  /** Register copy for the clipboard: HTML keeps the blue header on paste
   * into Word/Excel; the TSV twin keeps plain editors usable. */
  const buildRegisterCopy = (): { html: string; text: string } => {
    const esc = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const headers = [
      '#',
      t('absences.table.id'),
      t('absences.table.name'),
      t('absences.table.start'),
      t('absences.table.end'),
      t('absences.table.totalDays'),
      t('absences.table.postUnit'),
      t('absences.table.notes'),
    ]
    const rows = episodes.map((e, i) => [
      String(i + 1),
      record?.employee_id ?? '',
      employeeName,
      dateFmt.format(new Date(`${e.start_date}T00:00:00`)),
      dateFmt.format(new Date(`${e.end_date}T00:00:00`)),
      String(e.days),
      postUnit,
      e.notes ?? '',
    ])
    const cell = (v: string, extra = '') =>
      `<td style="border:1px solid #d1d5db;padding:6px 12px;color:#000;background:#fff;${extra}">${esc(v)}</td>`
    const head = headers
      .map(
        (h) =>
          `<th style="border:1px solid #1d4ed8;background:#1d4ed8;color:#ffffff;padding:6px 12px;text-align:start">${esc(h)}</th>`,
      )
      .join('')
    const body = rows
      .map((r) => {
        const [num, id, name, startD, endD, total, unit, notes] = r
        // The name column is black on white by request, same as the rest of
        // the body — stated explicitly so a pasted theme can't restyle it.
        return `<tr>${cell(num)}${cell(id, 'font-family:Consolas,monospace')}${cell(name)}${cell(startD)}${cell(endD)}${cell(total)}${cell(unit)}${cell(notes)}</tr>`
      })
      .join('')
    const html = `<table dir="${isAr ? 'rtl' : 'ltr'}" style="border-collapse:collapse;font-family:'Segoe UI',Arial,sans-serif;font-size:11pt"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`
    const text = [headers, ...rows].map((r) => r.join('\t')).join('\n')
    return { html, text }
  }

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

          </div>

          {employeeId && (
            <section className="mt-8" aria-label={t('absences.list.title')}>
              <div className="mb-2 flex items-center justify-between gap-3">
                <h3 className="text-[0.95em] font-semibold text-foreground">
                  {t('absences.list.title')}
                </h3>
                {episodes.length > 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    className="h-8 gap-1.5 px-3 text-[0.82em]"
                    onClick={async () => {
                      await copyTable(buildRegisterCopy())
                      toast.success(t('absences.copied'))
                    }}
                  >
                    <ClipboardCopy className="h-4 w-4" strokeWidth={1.8} aria-hidden />
                    {t('absences.copy')}
                  </Button>
                )}
              </div>
              {episodes.length === 0 ? (
                <div className="rounded-2xl bg-surface p-8 text-center text-[0.9em] text-muted-foreground">
                  {t('absences.list.empty')}
                </div>
              ) : (
                <div className="overflow-x-auto rounded-2xl border border-hairline bg-surface">
                  <table className="w-full min-w-[720px] border-collapse text-[0.86em]">
                    <thead>
                      <tr className="border-b border-hairline bg-primary text-primary-foreground">
                        <th className="px-3 py-2 text-start font-semibold">#</th>
                        <th className="px-3 py-2 text-start font-semibold">{t('absences.table.id')}</th>
                        <th className="px-3 py-2 text-start font-semibold">{t('absences.table.name')}</th>
                        <th className="px-3 py-2 text-start font-semibold">{t('absences.table.start')}</th>
                        <th className="px-3 py-2 text-start font-semibold">{t('absences.table.end')}</th>
                        <th className="px-3 py-2 text-start font-semibold">{t('absences.table.totalDays')}</th>
                        <th className="px-3 py-2 text-start font-semibold">{t('absences.table.postUnit')}</th>
                        <th className="px-3 py-2 text-start font-semibold">{t('absences.table.notes')}</th>
                        {canEdit && <th className="px-3 py-2" aria-label={t('common.delete')} />}
                      </tr>
                    </thead>
                    <tbody>
                      {episodes.map((e, i) => (
                        <tr key={`${e.start_date}-${e.end_date}`} className="border-b border-hairline last:border-b-0">
                          <td className="px-3 py-2 text-muted-foreground">{i + 1}</td>
                          <td className="px-3 py-2 font-mono">{record?.employee_id}</td>
                          <td className="px-3 py-2" dir="auto">{employeeName}</td>
                          <td className="px-3 py-2 font-mono">{dateFmt.format(new Date(`${e.start_date}T00:00:00`))}</td>
                          <td className="px-3 py-2 font-mono">{dateFmt.format(new Date(`${e.end_date}T00:00:00`))}</td>
                          <td className="px-3 py-2 font-mono">{e.days}</td>
                          <td className="px-3 py-2" dir="auto">{postUnit}</td>
                          <td className="max-w-[240px] truncate px-3 py-2 text-muted-foreground" dir="auto">{e.notes ?? ''}</td>
                          {canEdit && (
                            <td className="px-3 py-2 text-end">
                              <button
                                type="button"
                                onClick={() => setDeleting(e)}
                                aria-label={t('common.delete')}
                                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              >
                                <Trash2 className="h-4 w-4" strokeWidth={1.8} aria-hidden />
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
        title={t('absences.list.confirmDeleteRange', {
          start: deleting ? dateFmt.format(new Date(`${deleting.start_date}T00:00:00`)) : '',
          end: deleting ? dateFmt.format(new Date(`${deleting.end_date}T00:00:00`)) : '',
          count: deleting?.days ?? 0,
        })}
        confirmLabel={t('common.delete')}
        destructive
        onConfirm={async () => {
          if (deleting) await deleteMutation.mutateAsync(deleting)
        }}
      />
    </div>
  )
}
