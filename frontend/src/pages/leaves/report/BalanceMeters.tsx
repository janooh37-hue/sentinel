/**
 * BalanceMeters — compact annual/sick balance meters + carry-over line +
 * eligible/probation pill. Shared by the record-expansion strip and the
 * employee profile strip; fetched on demand and cached per employee
 * (react-query `['leave-balance', employeeId]`).
 *
 * Compact variant of TabBalance's ProgressMeter: h-1.5 trough
 * `bg-primary-soft`, fill `bg-primary`, mono values via
 * `leaves.report.balanceOf`.
 */
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'

import { fmtN } from './fmt'

interface BalanceMetersProps {
  employeeId: string
}

export function BalanceMeters({ employeeId }: BalanceMetersProps): React.JSX.Element {
  const { t } = useTranslation()

  const balanceQuery = useQuery({
    queryKey: ['leave-balance', employeeId],
    queryFn: () => api.getLeaveBalance(employeeId),
  })

  if (balanceQuery.isPending) {
    return (
      <div className="flex flex-col gap-2.5" aria-busy="true">
        <Skeleton className="h-1.5 w-full rounded-full" />
        <Skeleton className="h-1.5 w-full rounded-full" />
      </div>
    )
  }

  if (balanceQuery.isError || !balanceQuery.data) {
    return <p className="text-[0.78em] text-muted-foreground">—</p>
  }

  const b = balanceQuery.data
  const meters: { id: 'annual' | 'sick'; label: string; taken: number; total: number; remaining: number }[] = [
    {
      id: 'annual',
      label: t('leaves.report.balanceAnnual'),
      taken: b.annual_taken,
      total: b.annual_total,
      remaining: b.annual_remaining,
    },
    {
      id: 'sick',
      label: t('leaves.report.balanceSick'),
      taken: b.sick_taken,
      total: 90,
      remaining: b.sick_remaining,
    },
  ]

  return (
    <div>
      {/* One grid so label / track / value columns align across both rows. */}
      <div className="grid grid-cols-[auto_1fr_auto] items-center gap-x-2.5 gap-y-2">
        {meters.map((m) => {
          const pct = m.total > 0 ? Math.min(100, (m.taken / m.total) * 100) : 0
          // Guard degenerate data: valuemax never 0, valuenow clamped into range.
          const valueMax = Math.max(m.total, m.taken, 1)
          const valueNow = Math.min(Math.max(Math.round(m.taken * 10) / 10, 0), valueMax)
          return (
            <div key={m.id} className="contents">
              <span className="text-[0.72em] text-muted-foreground">{m.label}</span>
              <div className="h-1.5 overflow-hidden rounded-full bg-primary-soft">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${pct}%` }}
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuenow={valueNow}
                  aria-valuemax={valueMax}
                  aria-label={t('leaves.balance.progressLabel', {
                    taken: fmtN(m.taken),
                    total: fmtN(m.total),
                    defaultValue: '{{taken}} of {{total}} days taken',
                  })}
                />
              </div>
              <span className="font-mono text-[0.78em] tabular-nums text-foreground">
                {t('leaves.report.balanceOf', {
                  remaining: fmtN(m.remaining),
                  total: fmtN(m.total),
                })}
              </span>
            </div>
          )
        })}
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="text-[0.72em] tabular-nums text-muted-foreground">
          {t('leaves.report.balanceCarry', { n: fmtN(b.carry_over) })}
        </span>
        {/* Eligible/probation pill — classes from TabBalance. */}
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[0.72em] font-semibold uppercase tracking-[0.08em] rtl:tracking-normal',
            b.eligible ? 'bg-success-soft text-success' : 'bg-warning-soft text-warning',
          )}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
          {b.eligible ? t('leaves.balance.eligible') : t('leaves.balance.probation')}
        </span>
      </div>
    </div>
  )
}
