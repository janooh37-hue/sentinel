/**
 * Absences tab — the employee's recorded absence days, newest first.
 *
 * Record-side mirror of the /absences service: same list query, same delete.
 * Falls back to the aggregate's `recent_absences` while the full list loads
 * (the LeavesTab convention). Removing a day un-marks it; the time sheet's
 * next live build no longer renders `AB` for it.
 */

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { api, apiErrorMessage } from '@/lib/api'
import type { AbsenceRead, RecentAbsenceRead } from '@/lib/api'
import { useCapabilities } from '@/lib/useCapabilities'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'

interface Props {
  employeeId: string
  /** Initial snapshot from the aggregate response (shown while the list loads). */
  absences: RecentAbsenceRead[]
}

export function AbsencesTab({ employeeId, absences }: Props): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const qc = useQueryClient()
  const { has } = useCapabilities()
  const canEdit = has('leaves.edit')
  const [deletingId, setDeletingId] = useState<number | null>(null)

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

  const { data: fullList } = useQuery({
    queryKey: ['employee-absences', employeeId],
    queryFn: () => api.listEmployeeAbsences(employeeId),
  })
  const rows: Array<AbsenceRead | RecentAbsenceRead> = fullList ?? absences

  const deleteMutation = useMutation({
    mutationFn: (absenceId: number) => api.deleteEmployeeAbsence(employeeId, absenceId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['employee-absences', employeeId] })
      void qc.invalidateQueries({ queryKey: ['employee-detail', employeeId] })
      toast.success(t('absences.deleted'))
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  })

  const deletingRow = rows.find((r) => r.id === deletingId) ?? null

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl bg-surface p-12 text-center text-muted-foreground">
        {t('absences.list.empty')}
      </div>
    )
  }
  return (
    <div className="overflow-hidden rounded-2xl border border-hairline bg-surface">
      {rows.map((a) => (
        <div
          key={a.id}
          className="flex items-center gap-3 border-b border-hairline px-4 py-2.5 last:border-b-0"
        >
          <div className="font-mono text-[0.86em] text-foreground">
            {dateFmt.format(new Date(`${a.date}T00:00:00`))}
          </div>
          <div
            className="min-w-0 flex-1 truncate text-[0.86em] text-muted-foreground"
            dir="auto"
          >
            {a.note ?? ''}
          </div>
          {canEdit && (
            <button
              type="button"
              onClick={() => setDeletingId(a.id)}
              aria-label={t('common.delete')}
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Trash2 className="h-4 w-4" strokeWidth={1.8} aria-hidden />
            </button>
          )}
        </div>
      ))}
      <ConfirmDialog
        open={deletingId !== null}
        onOpenChange={(open) => {
          if (!open) setDeletingId(null)
        }}
        title={t('absences.list.confirmDelete', {
          date: deletingRow ? dateFmt.format(new Date(`${deletingRow.date}T00:00:00`)) : '',
        })}
        confirmLabel={t('common.delete')}
        destructive
        onConfirm={async () => {
          if (deletingId !== null) await deleteMutation.mutateAsync(deletingId)
        }}
      />
    </div>
  )
}
