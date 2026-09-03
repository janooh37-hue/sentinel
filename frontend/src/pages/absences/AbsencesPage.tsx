/**
 * AbsencesPage — the formless absence service (Services gallery tile).
 *
 * Records day-level absence rows on the employee: pick an employee, a first
 * and last day, an optional note, Save. No template, no document — the record
 * is the deliverable, and the time sheet reads it as `AB`. A superseding
 * leave covering the same days removes those rows.
 *
 * Below the form, the global absence register is searchable, selectable, and
 * supports copy, email, edit, extend-through-today, and confirmed removal
 * actions.
 *
 * Deep-link: `?employee_id=<G-id>` pre-selects the employee (same convention
 * as /application).
 */

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  ClipboardCopy,
  Mail,
  Pencil,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'

import { api, apiErrorMessage } from '@/lib/api'
import type { AbsenceRegisterRowRead } from '@/lib/api'
import { copyTable } from '@/lib/copyTable'
import { computeEndDate, todayIso } from '@/lib/leaveDateMath'
import { useCapabilities } from '@/lib/useCapabilities'
import { Button } from '@/components/ui/button'
import { ServiceArtwork } from '@/components/ui/service-artwork'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Label } from '@/components/ui/label'
import {
  ABSENCE_TABLE_HEADERS,
  absenceTableCells,
  buildAbsenceTableHtml,
} from '@/pages/absences/absenceEmail'
import { AbsenceEmailDialog } from '@/pages/absences/AbsenceEmailDialog'
import { EditAbsenceDialog } from '@/pages/absences/EditAbsenceDialog'
import { LeaveEmployeePicker } from '@/pages/leaves/LeaveEmployeePicker'

function rowKey(row: AbsenceRegisterRowRead): string {
  return `${row.employee_id}|${row.start_date}|${row.end_date}`
}

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
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [editing, setEditing] = useState<AbsenceRegisterRowRead | null>(null)
  const [emailOpen, setEmailOpen] = useState(false)
  const [deleting, setDeleting] = useState<AbsenceRegisterRowRead | null>(null)

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

  const registerQuery = useQuery({
    queryKey: ['absence-register'],
    queryFn: () => api.listAbsenceRegister(),
  })

  useEffect(() => {
    if (registerQuery.error) {
      toast.error(apiErrorMessage(registerQuery.error))
    }
  }, [registerQuery.error])

  const invalidateAbsences = (targetEmployeeId: string): void => {
    void qc.invalidateQueries({ queryKey: ['absence-register'] })
    void qc.invalidateQueries({
      queryKey: ['employee-absence-episodes', targetEmployeeId],
    })
    void qc.invalidateQueries({ queryKey: ['employee-absences', targetEmployeeId] })
    void qc.invalidateQueries({ queryKey: ['employee-detail', targetEmployeeId] })
  }

  const createMutation = useMutation({
    mutationFn: (targetEmployeeId: string) =>
      api.createEmployeeAbsences(targetEmployeeId, {
        start_date: start,
        end_date: end,
        note: note.trim() || null,
      }),
    onSuccess: (result, targetEmployeeId) => {
      invalidateAbsences(targetEmployeeId)
      const created = result.created.length
      const skipped = result.skipped_off_roster.length
      const skippedOnLeave = result.skipped_on_leave ?? []
      if (created > 0 && skipped > 0) {
        toast.success(t('absences.savedWithSkips', { count: created, skipped }))
      } else if (created > 0) {
        toast.success(t('absences.saved', { count: created }))
      } else if (skipped > 0) {
        toast.warning(t('absences.savedWithSkips', { count: created, skipped }))
      } else {
        toast.info(t('absences.nothingToSave'))
      }
      if (skippedOnLeave.length > 0) {
        toast.warning(t('absences.skippedOnLeave', { count: skippedOnLeave.length }))
      }
      setNote('')
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  })

  const extendMutation = useMutation({
    mutationFn: (row: AbsenceRegisterRowRead) =>
      api.createEmployeeAbsences(row.employee_id, {
        start_date: computeEndDate(row.end_date, 2),
        end_date: todayIso(),
        note: null,
      }),
    onSuccess: (result, row) => {
      invalidateAbsences(row.employee_id)
      const created = result.created.length
      const skippedOffRoster = result.skipped_off_roster.length
      const skippedOnLeave = result.skipped_on_leave ?? []
      if (created > 0) {
        toast.success(t('absences.extended', { count: created }))
      }
      if (skippedOnLeave.length > 0) {
        toast.warning(t('absences.skippedOnLeave', { count: skippedOnLeave.length }))
      }
      if (skippedOffRoster > 0) {
        toast.warning(
          t('absences.savedWithSkips', {
            count: created,
            skipped: skippedOffRoster,
          }),
        )
      }
      if (created === 0 && skippedOnLeave.length === 0 && skippedOffRoster === 0) {
        toast.info(t('absences.nothingToSave'))
      }
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  })

  const deleteMutation = useMutation({
    mutationFn: (row: AbsenceRegisterRowRead) =>
      api.deleteEmployeeAbsenceRange(row.employee_id, row.start_date, row.end_date),
    onSuccess: (_result, row) => {
      invalidateAbsences(row.employee_id)
      toast.success(t('absences.deleted'))
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  })

  const canSubmit =
    !!employeeId && !!start && !!end && start <= end && canEdit && !createMutation.isPending
  const rows = registerQuery.data?.rows ?? []
  const normalizedSearch = search.trim().toLowerCase()
  const filteredRows = normalizedSearch
    ? rows.filter(
        (row) =>
          row.employee_id.toLowerCase().includes(normalizedSearch) ||
          (row.employee_name_en ?? '').toLowerCase().includes(normalizedSearch) ||
          (row.employee_name_ar ?? '').toLowerCase().includes(normalizedSearch),
      )
    : rows
  const selectedRows = filteredRows.filter((row) => selected.has(rowKey(row)))
  const allFilteredSelected =
    filteredRows.length > 0 && filteredRows.every((row) => selected.has(rowKey(row)))
  const today = todayIso()

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
                <ServiceArtwork artwork="employee-absence" size="gallery" />
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
                      onClick={() => createMutation.mutate(employeeId as string)}
                    >
                      {t('absences.form.save')}
                    </Button>
                  </div>
                </>
              )}
            </div>

          </div>

          <section className="mt-8" aria-label={t('absences.list.title')}>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-[0.95em] font-semibold text-foreground">
                {t('absences.list.title')}
              </h3>
              <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  aria-label={t('absences.list.search')}
                  placeholder={t('absences.list.search')}
                  className="h-9 min-w-0 flex-1 rounded-md border border-input bg-surface px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-64 sm:flex-none"
                />
                {rows.length > 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    className="h-8 gap-1.5 px-3 text-[0.82em]"
                    onClick={async () => {
                      const copyRows = selectedRows.length > 0 ? selectedRows : filteredRows
                      await copyTable({
                        html: buildAbsenceTableHtml(copyRows),
                        text: [ABSENCE_TABLE_HEADERS, ...absenceTableCells(copyRows)]
                          .map((row) => row.join('\t'))
                          .join('\n'),
                      })
                      toast.success(t('absences.copied'))
                    }}
                  >
                    <ClipboardCopy className="h-4 w-4" strokeWidth={1.8} aria-hidden />
                    {t('absences.copy')}
                  </Button>
                )}
                {selectedRows.length > 0 && has('ledger.send') && has('ledger.view') && (
                  <Button
                    type="button"
                    variant="default"
                    className="h-8 gap-1.5 px-3 text-[0.82em]"
                    onClick={() => setEmailOpen(true)}
                  >
                    <Mail className="h-4 w-4" strokeWidth={1.8} aria-hidden />
                    {t('absences.email.button', { count: selectedRows.length })}
                  </Button>
                )}
              </div>
            </div>
            {rows.length === 0 ? (
              <div className="rounded-2xl bg-surface p-8 text-center text-[0.9em] text-muted-foreground">
                {t('absences.list.empty')}
              </div>
            ) : filteredRows.length === 0 ? (
              <div className="rounded-2xl bg-surface p-8 text-center text-[0.9em] text-muted-foreground">
                {t('absences.list.noMatch')}
              </div>
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-hairline bg-surface">
                <table className="w-full min-w-[880px] border-collapse text-[0.86em]">
                  <thead>
                    <tr className="border-b border-hairline bg-primary text-primary-foreground">
                      <th className="px-3 py-2 text-start font-semibold">
                        <input
                          type="checkbox"
                          checked={allFilteredSelected}
                          onChange={(event) => {
                            const checked = event.target.checked
                            setSelected((current) => {
                              const next = new Set(current)
                              filteredRows.forEach((row) => {
                                const key = rowKey(row)
                                if (checked) next.add(key)
                                else next.delete(key)
                              })
                              return next
                            })
                          }}
                          aria-label={t('absences.list.selectAll')}
                          className="h-4 w-4 accent-primary"
                        />
                      </th>
                      <th className="px-3 py-2 text-start font-semibold">#</th>
                      <th className="px-3 py-2 text-start font-semibold">
                        {t('absences.table.id')}
                      </th>
                      <th className="px-3 py-2 text-start font-semibold">
                        {t('absences.table.name')}
                      </th>
                      <th className="px-3 py-2 text-start font-semibold">
                        {t('absences.table.unit')}
                      </th>
                      <th className="px-3 py-2 text-start font-semibold">
                        {t('absences.table.start')}
                      </th>
                      <th className="px-3 py-2 text-start font-semibold">
                        {t('absences.table.end')}
                      </th>
                      <th className="px-3 py-2 text-start font-semibold">
                        {t('absences.table.totalDays')}
                      </th>
                      <th className="px-3 py-2 text-start font-semibold">
                        {t('absences.table.notes')}
                      </th>
                      {canEdit && (
                        <th className="px-3 py-2" aria-label={t('common.actions')} />
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map((row, index) => {
                      const key = rowKey(row)
                      const displayName = isAr
                        ? (row.employee_name_ar ?? row.employee_name_en ?? '')
                        : (row.employee_name_en ?? '')
                      const isSelected = selected.has(key)
                      const upToDate = row.end_date >= today
                      const displayStart = dateFmt.format(
                        new Date(`${row.start_date}T00:00:00`),
                      )
                      const displayEnd = dateFmt.format(new Date(`${row.end_date}T00:00:00`))
                      return (
                        <tr
                          key={key}
                          className={`border-b border-hairline last:border-b-0 ${
                            isSelected ? 'bg-primary-soft' : ''
                          }`}
                        >
                          <td className="px-3 py-2">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={(event) => {
                                const checked = event.target.checked
                                setSelected((current) => {
                                  const next = new Set(current)
                                  if (checked) next.add(key)
                                  else next.delete(key)
                                  return next
                                })
                              }}
                              aria-label={t('absences.list.selectRow', {
                                name: displayName,
                                id: row.employee_id,
                                start: displayStart,
                                end: displayEnd,
                              })}
                              className="h-4 w-4 accent-primary"
                            />
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">{index + 1}</td>
                          <td className="px-3 py-2 font-mono">{row.employee_id}</td>
                          <td className="px-3 py-2" dir="auto">
                            {displayName}
                          </td>
                          <td className="px-3 py-2" dir="auto">
                            {row.duty_unit ?? ''}
                          </td>
                          <td className="px-3 py-2 font-mono">{displayStart}</td>
                          <td className="px-3 py-2 font-mono">{displayEnd}</td>
                          <td className="px-3 py-2 font-mono">{row.days}</td>
                          <td
                            className="max-w-[240px] truncate px-3 py-2 text-muted-foreground"
                            dir="auto"
                          >
                            {row.notes ?? ''}
                          </td>
                          {canEdit && (
                            <td className="px-3 py-2 text-end">
                              <div className="inline-flex items-center justify-end gap-1">
                                <button
                                  type="button"
                                  onClick={() => setEditing(row)}
                                  aria-label={t('absences.actions.edit')}
                                  className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-surface-tinted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                >
                                  <Pencil
                                    className="h-4 w-4"
                                    strokeWidth={1.8}
                                    aria-hidden
                                  />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => extendMutation.mutate(row)}
                                  disabled={upToDate || extendMutation.isPending}
                                  title={
                                    upToDate
                                      ? t('absences.actions.stillAbsentUpToDate')
                                      : undefined
                                  }
                                  aria-label={t('absences.actions.stillAbsent')}
                                  className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-surface-tinted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  <CalendarPlus
                                    className="h-4 w-4"
                                    strokeWidth={1.8}
                                    aria-hidden
                                  />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setDeleting(row)}
                                  aria-label={t('common.delete')}
                                  className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                >
                                  <Trash2
                                    className="h-4 w-4"
                                    strokeWidth={1.8}
                                    aria-hidden
                                  />
                                </button>
                              </div>
                            </td>
                          )}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </div>

      <EditAbsenceDialog
        open={editing !== null}
        row={editing}
        onOpenChange={(open) => {
          if (!open) setEditing(null)
        }}
        onSaved={invalidateAbsences}
      />
      <AbsenceEmailDialog open={emailOpen} rows={selectedRows} onOpenChange={setEmailOpen} />

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
