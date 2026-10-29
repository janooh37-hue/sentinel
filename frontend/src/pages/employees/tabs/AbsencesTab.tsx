/**
 * Absences tab — the employee's absence register, one row per contiguous run.
 *
 * Same episodes the /absences service shows (grouped days, start/end/total),
 * scoped to this employee so ID/Name/Post-unit columns would be constant and
 * are left off. Deleting removes the whole run; the time sheet's next live
 * build drops the `AB` cells it covered.
 */

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Trash2 } from 'lucide-react'
import { toast } from '@/lib/toast'

import { api, ApiError, apiErrorMessage } from '@/lib/api'
import type { AbsenceEpisodeRead } from '@/lib/api'
import { useCapabilities } from '@/lib/useCapabilities'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'

interface Props {
  employeeId: string
}

export function AbsencesTab({ employeeId }: Props): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const qc = useQueryClient()
  const { has } = useCapabilities()
  const canView = has('employees.view') && has('leaves.view')
  const canEdit = canView && has('leaves.edit')
  const [deleting, setDeleting] = useState<AbsenceEpisodeRead | null>(null)

  const dateFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      }),
    [i18n.language],
  )

  const { data: record, isLoading, error } = useQuery({
    queryKey: ['employee-absence-episodes', employeeId],
    queryFn: () => api.listEmployeeAbsenceEpisodes(employeeId),
    enabled: canView,
  })
  const episodes = record?.episodes ?? []

  const deleteMutation = useMutation({
    mutationFn: (episode: AbsenceEpisodeRead) => {
      if (!has('employees.view') || !has('leaves.view') || !has('leaves.edit')) {
        throw new Error(t('common.forbidden'))
      }
      return api.deleteEmployeeAbsenceRange(employeeId, episode.start_date, episode.end_date)
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['employee-absence-episodes', employeeId] })
      void qc.invalidateQueries({ queryKey: ['employee-absences', employeeId] })
      void qc.invalidateQueries({ queryKey: ['employee-detail', employeeId] })
      void qc.invalidateQueries({ queryKey: ['absence-register'] })
      toast.success(t('absences.deleted'))
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  })

  if (!canView || (error instanceof ApiError && error.status === 403)) {
    return <p role="alert" className="p-4 text-muted-foreground">{t('common.forbidden')}</p>
  }
  if (error) return <p role="alert" className="p-4 text-accent">{t('common.loadError')}</p>
  if (isLoading) return <p role="status">{t('common.loading')}</p>

  if (!isLoading && episodes.length === 0) {
    return (
      <div className="rounded-2xl bg-surface p-12 text-center text-muted-foreground">
        {t('absences.list.empty')}
      </div>
    )
  }
  return (
    <div className="overflow-hidden rounded-2xl border border-hairline bg-surface">
      <table className="w-full border-collapse text-[0.86em]">
        <thead>
          <tr className="border-b border-hairline text-muted-foreground">
            <th className="px-4 py-2 text-start font-medium">{t('absences.table.start')}</th>
            <th className="px-4 py-2 text-start font-medium">{t('absences.table.end')}</th>
            <th className="px-4 py-2 text-start font-medium">{t('absences.table.totalDays')}</th>
            <th className="px-4 py-2 text-start font-medium">{t('absences.table.notes')}</th>
            {canEdit && <th className="px-4 py-2" aria-label={t('common.delete')} />}
          </tr>
        </thead>
        <tbody>
          {episodes.map((e) => (
            <tr key={`${e.start_date}-${e.end_date}`} className="border-b border-hairline last:border-b-0">
              <td className="px-4 py-2.5 font-mono text-foreground">
                {dateFmt.format(new Date(`${e.start_date}T00:00:00`))}
              </td>
              <td className="px-4 py-2.5 font-mono text-foreground">
                {dateFmt.format(new Date(`${e.end_date}T00:00:00`))}
              </td>
              <td className="px-4 py-2.5 font-mono text-foreground">{e.days}</td>
              <td className="max-w-[280px] truncate px-4 py-2.5 text-muted-foreground" dir="auto">
                {e.notes ?? ''}
              </td>
              {canEdit && (
                <td className="px-4 py-2.5 text-end">
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
      <ConfirmDialog
        open={canEdit && deleting !== null}
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
          if (canEdit && deleting) await deleteMutation.mutateAsync(deleting)
        }}
      />
    </div>
  )
}
