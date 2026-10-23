/**
 * The department-scoping switch, with its preflight confirmation: turning it
 * on first lists who would lose visibility, so the admin can fix the tree
 * before anyone is surprised.
 */

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { api } from '@/lib/api'
import { departmentErrorMessage, departmentName } from '@/lib/departments'

export function DepartmentScopingCard(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const qc = useQueryClient()
  const [confirming, setConfirming] = useState(false)
  const scoping = useQuery({ queryKey: ['department-scoping'], queryFn: api.departments.getScoping })
  const save = useMutation({
    mutationFn: api.departments.setScoping,
    onSuccess: (updated) => {
      qc.setQueryData(['department-scoping'], updated)
      // Scope changes affect all session-bound lists and counts, not just this panel.
      void qc.invalidateQueries()
      toast.success(t(updated.enabled ? 'departmentScope.turnedOn' : 'departmentScope.turnedOff'))
    },
    onError: (error) => toast.error(departmentErrorMessage(error, t)),
  })
  const report = scoping.data

  return (
    <section aria-labelledby="org-dept-scoping" className="rounded-2xl border border-hairline bg-surface p-4">
      <h2 id="org-dept-scoping" className="text-[0.72em] font-semibold uppercase tracking-[0.08em] text-muted-foreground rtl:tracking-normal">
        {t('departmentScope.title')}
      </h2>
      <p className="mt-1 text-[0.78em] text-muted-foreground">{t('departmentScope.description')}</p>
      {scoping.isPending ? <Skeleton className="mt-3 h-10 w-full rounded-xl" /> : scoping.isError ? (
        <p role="alert" className="mt-2 text-[0.82em] text-accent">
          {departmentErrorMessage(scoping.error, t)}{' '}
          <button type="button" className="underline" onClick={() => void scoping.refetch()}>{t('departments.retry')}</button>
        </p>
      ) : (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p role="status" className="text-[0.86em] font-medium text-foreground">
            {t(scoping.data.enabled ? 'departmentScope.enabled' : 'departmentScope.disabled')}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-11"
            disabled={save.isPending || scoping.isFetching}
            onClick={() => {
              void scoping.refetch().then((result) => { if (result.isSuccess) setConfirming(true) })
            }}
          >
            {t(scoping.data.enabled ? 'departmentScope.turnOff' : 'departmentScope.turnOn')}
          </Button>
        </div>
      )}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t(report?.enabled ? 'departmentScope.confirmOff' : 'departmentScope.confirmOn')}
        confirmLabel={t(report?.enabled ? 'departmentScope.turnOff' : 'departmentScope.turnOn')}
        onConfirm={() => { if (report && !save.isPending) save.mutate(!report.enabled) }}
        description={report?.enabled ? t('departmentScope.offWarning') : report ? (
          <div className="max-h-[55vh] space-y-4 overflow-y-auto break-words pe-1 text-start [overflow-wrap:anywhere]">
            <p>{t('departmentScope.warning')}</p>
            <section>
              <h4 className="font-semibold">{t('departmentScope.usersWithoutDepartment', { count: report.users_without_department.length })}</h4>
              {report.users_without_department.length === 0 ? <p>{t('departmentScope.none')}</p> : (
                <ul className="list-inside list-disc">
                  {report.users_without_department.map((user) => <li key={user.user_id}><bdi>{user.display_name}</bdi> (<bdi>{user.email}</bdi>)</li>)}
                </ul>
              )}
            </section>
            {(['departments_without_receiver', 'departments_without_services'] as const).map((key) => (
              <section key={key}>
                <h4 className="font-semibold">{t(`departmentScope.${key}`, { count: report[key].length })}</h4>
                {report[key].length === 0 ? <p>{t('departmentScope.none')}</p> : (
                  <ul className="list-inside list-disc">
                    {report[key].map((department) => <li key={department.id}><bdi>{departmentName(department, i18n.language)}</bdi></li>)}
                  </ul>
                )}
              </section>
            ))}
          </div>
        ) : undefined}
      />
    </section>
  )
}
