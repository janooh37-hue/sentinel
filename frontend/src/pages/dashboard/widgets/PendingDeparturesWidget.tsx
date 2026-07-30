/**
 * PendingDeparturesWidget — employees with a scheduled resignation or
 * termination: still Active, but leaving on `end_date`.
 *
 * Cancel sends `{status: 'Active', end_date: null}`, which update_employee
 * treats as cancelling the pending departure — the letter can be refused via
 * the paper's مشروحات مدير المشروع block, so this is a first-class action.
 *
 * Self-gating: renders nothing when the user lacks `employees.view`.
 * Query key: ['employees', 'pending']
 */

import { useNavigate, Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { CalendarClock, UserMinus } from 'lucide-react'

import { api, apiErrorMessage } from '@/lib/api'
import { useCapabilities } from '@/lib/useCapabilities'
import { pickEmployeeName } from '@/lib/employeeName'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'

/** Whole days from today to `iso`, negative when already past. */
function daysUntil(iso: string, now: Date = new Date()): number {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return 0
  const target = Date.UTC(y, m - 1, d)
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((target - today) / 86_400_000)
}

export function PendingDeparturesWidget(): React.JSX.Element | null {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { has } = useCapabilities()

  const query = useQuery({
    queryKey: ['employees', 'pending'],
    queryFn: () => api.listEmployees({ pending: true, limit: 50 }),
    staleTime: 60_000,
  })

  const cancel = useMutation({
    mutationFn: (id: string) =>
      api.updateEmployee(id, { status: 'Active', end_date: null }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['employees'] })
      toast.success(t('pendingDepartures.cancelled'))
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  })

  if (!has('employees.view')) return null

  const all = query.data?.items ?? []
  const rows = all.slice(0, 5)
  const total = query.data?.total ?? 0
  const isEmpty = query.isSuccess && total === 0

  return (
    <section className="mb-6 rounded-2xl border border-hairline bg-surface">
      <div className="flex items-center justify-between border-b border-hairline px-5 py-3.5">
        <h3 className="text-[0.86em] font-semibold text-foreground">
          {t('dashboard.widgetLabels.pending_departures')}
        </h3>
        {(query.isLoading || total > 0) && (
          <span className="rounded-full bg-warning/15 px-2 py-0.5 font-mono text-[0.7em] font-semibold text-warning">
            {query.isLoading ? '…' : total}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-0.5 px-3 py-2">
        {query.isLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 rounded-lg px-2 py-2">
              <div className="flex flex-1 flex-col gap-1.5">
                <Skeleton className="h-3 w-1/3" />
                <Skeleton className="h-2.5 w-1/4" />
              </div>
              <Skeleton className="h-4 w-20" />
            </div>
          ))
        ) : query.isError ? (
          <EmptyState
            icon={CalendarClock}
            message={t('common.loadError')}
            actionLabel={t('common.retry')}
            onAction={() => void query.refetch()}
            className="py-8"
          />
        ) : isEmpty ? (
          <EmptyState icon={CalendarClock} message={t('pendingDepartures.empty')} className="py-8" />
        ) : (
          rows.map((emp) => {
            const endDate = emp.end_date ?? null
            const pendingStatus = emp.pending_status ?? null
            const days = endDate ? daysUntil(endDate) : 0
            const when =
              days < 0
                ? t('pendingDepartures.overdue')
                : days === 0
                  ? t('pendingDepartures.dueToday')
                  : t('pendingDepartures.daysLeft', { count: days })
            return (
              <div
                key={emp.id}
                className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-surface-tinted"
              >
                <button
                  type="button"
                  onClick={() => navigate(`/employees/${encodeURIComponent(emp.id)}`)}
                  className="min-w-0 flex-1 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded-sm"
                >
                  <span className="block truncate text-[0.86em] font-medium text-foreground">
                    {pickEmployeeName(emp, i18n.language)}
                  </span>
                  <span className="font-mono text-[0.72em] text-muted-foreground">{emp.id}</span>
                </button>

                <span className="shrink-0 rounded-md bg-surface-tinted px-1.5 py-0.5 text-[0.68em] font-semibold text-foreground">
                  {pendingStatus ? t(`employees.status.${pendingStatus}`) : ''}
                </span>

                <div className="flex shrink-0 items-center gap-1 text-warning">
                  <UserMinus className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
                  <span className="text-[0.72em] font-medium">{when}</span>
                </div>

                <Button
                  type="button"
                  variant="ghost"
                  className="shrink-0 text-[0.72em]"
                  disabled={cancel.isPending}
                  onClick={() => cancel.mutate(emp.id)}
                >
                  {t('pendingDepartures.cancel')}
                </Button>
              </div>
            )
          })
        )}
      </div>

      {!isEmpty && !query.isLoading && (
        <div className="border-t border-hairline px-5 py-2.5">
          <Link
            to="/employees"
            className="text-[0.82em] font-medium text-primary transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded-sm"
          >
            {t('pendingDepartures.viewAll')}
          </Link>
        </div>
      )}
    </section>
  )
}
