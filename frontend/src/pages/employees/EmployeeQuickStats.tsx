/**
 * 5-card clickable stats strip below the hero.
 * Each card deep-links to one of the inner tabs.
 */

import { useTranslation } from 'react-i18next'

import type { EmployeeStatsRead } from '@/lib/api'

export type StatTabTarget = 'documents' | 'leaves' | 'violations' | 'activity' | 'profile'

interface Props {
  stats: EmployeeStatsRead
  onTabClick: (tab: StatTabTarget) => void
}

export function EmployeeQuickStats({ stats, onTabClick }: Props): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="mb-5 grid grid-cols-2 gap-3.5 sm:grid-cols-3 md:grid-cols-5">
      <StatCard
        k={t('employee.stats.documents')}
        n={stats.documents}
        delta={t('employee.stats.documentsDelta', { count: stats.documents })}
        onClick={() => onTabClick('documents')}
      />
      <StatCard
        k={t('employee.stats.leaves')}
        n={t('employee.stats.daysUnit', { n: stats.leaves_taken_days, defaultValue: '{{n}}d' })}
        delta={t('employee.stats.leavesDelta', { allowed: stats.leaves_allowed_days })}
        onClick={() => onTabClick('leaves')}
      />
      <StatCard
        k={t('employee.stats.violations')}
        n={stats.violations}
        delta={
          stats.violations === 0
            ? t('employee.stats.violationsClean')
            : t('employee.stats.violationsCount', { count: stats.violations })
        }
        good={stats.violations === 0}
        warn={stats.violations > 0}
        onClick={() => onTabClick('violations')}
      />
      <StatCard
        k={t('employee.stats.ledger')}
        n={stats.ledger_count}
        delta={t('employee.stats.ledgerDelta')}
        onClick={() => onTabClick('activity')}
      />
      <StatCard
        k={t('employee.stats.tenure')}
        n={t('employee.stats.yearsUnit', { n: stats.tenure_years, defaultValue: '{{n}}y' })}
        delta={t('employee.stats.tenureDelta')}
        onClick={() => onTabClick('profile')}
      />
    </div>
  )
}

interface StatCardProps {
  k: string
  n: string | number
  delta: string
  good?: boolean
  warn?: boolean
  onClick: () => void
}

function StatCard({ k, n, delta, good, warn, onClick }: StatCardProps): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-2xl bg-surface p-4 text-start transition-all hover:-translate-y-0.5 hover:shadow-md"
    >
      <div className="text-[0.78em] font-semibold uppercase tracking-wider text-muted-foreground">{k}</div>
      <div className="mt-1 text-[1.55em] font-bold leading-none tracking-tight text-foreground">{n}</div>
      <div
        className={`mt-1 text-[0.72em] ${
          good ? 'text-success' : warn ? 'text-accent' : 'text-muted-foreground'
        }`}
      >
        {delta}
      </div>
    </button>
  )
}
