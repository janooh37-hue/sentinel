/**
 * Balance inner tab — employee picker + as-of date → accrual summary card
 * with CSS progress bars.
 *
 * TAMM redesign: filter row sits on a rounded-2xl surface, balance shown
 * as three TAMM-vocabulary cards (rounded-2xl, big foreground numbers in
 * `font-bold`, uppercase muted labels, primary-soft progress trough).
 */

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { api } from '@/lib/api'
import type { LeaveBalanceRead } from '@/lib/api'
import { cn } from '@/lib/utils'
import { todayIso } from '@/lib/leaveDateMath'
import { splitBilingualMessage } from '@/lib/bilingualValue'
import { LeaveEmployeePicker } from './LeaveEmployeePicker'

// Progress bar: filled portion = taken / total, remainder = remaining
function ProgressMeter({
  label,
  taken,
  total,
  remaining,
}: {
  label: string
  taken: number
  total: number
  remaining: number
}): React.JSX.Element {
  const pct = total > 0 ? Math.min(100, (taken / total) * 100) : 0
  const { t } = useTranslation()

  return (
    <div className="rounded-2xl border border-hairline bg-surface p-6">
      <div className="flex items-end justify-between gap-2">
        <span className="text-[0.7em] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          {label}
        </span>
        <span className="font-mono text-[0.78em] text-muted-foreground">
          {remaining.toFixed(1)} / {total}
        </span>
      </div>
      <div
        className="mt-3 text-[2.2em] font-bold leading-none tabular-nums text-foreground"
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {remaining.toFixed(1)}
      </div>
      <span className="mt-1 block text-[0.78em] text-muted-foreground">
        {t('leaves.balance.daysRemaining', { defaultValue: 'days remaining' })}
      </span>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-primary-soft">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${pct}%` }}
          role="progressbar"
          aria-valuemin={0}
          aria-valuenow={taken}
          aria-valuemax={total}
          aria-label={t('leaves.balance.progressLabel', {
            taken: taken.toFixed(1),
            total,
            defaultValue: '{{taken}} of {{total}} days taken',
          })}
        />
      </div>
      <span className="mt-2 block text-[0.78em] text-muted-foreground">
        {t('leaves.balance.takenLabel', {
          taken: taken.toFixed(1),
          defaultValue: '{{taken}} taken',
        })}
      </span>
    </div>
  )
}

function CarryOverCard({ value }: { value: number }): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="rounded-2xl border border-hairline bg-surface p-6">
      <span className="text-[0.7em] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {t('leaves.balance.carryOver')}
      </span>
      <div
        className="mt-3 text-[2.2em] font-bold leading-none tabular-nums text-foreground"
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {value.toFixed(1)}
      </div>
      <span className="mt-1 block text-[0.78em] text-muted-foreground">
        {t('leaves.balance.daysLabel', { defaultValue: 'days' })}
      </span>
    </div>
  )
}

function BalanceCard({ balance }: { balance: LeaveBalanceRead }): React.JSX.Element {
  const { t, i18n } = useTranslation()

  // Annual progress-meter denominator = available annual days (accrual +
  // carry-over, capped server-side at 45 — NOT a hardcoded 30). Prefer the
  // backend `annual_total`; fall back to remaining+taken (the same capped
  // value) for clients on an older generated API type that lacks the field.
  const annualTotal =
    (balance as { annual_total?: number }).annual_total ??
    balance.annual_remaining + balance.annual_taken

  return (
    <div className="flex flex-col gap-4">
      {/* As-of header row */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-surface px-4 py-3">
        <div>
          <p className="text-[0.7em] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            {t('leaves.balance.asOf')}
          </p>
          <p className="mt-0.5 font-mono text-[0.95em] text-foreground">{balance.as_of}</p>
        </div>
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[0.72em] font-semibold uppercase tracking-[0.08em]',
            balance.eligible
              ? 'bg-success-soft text-success'
              : 'bg-warning-soft text-warning',
          )}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
          {balance.eligible ? t('leaves.balance.eligible') : t('leaves.balance.probation')}
        </span>
      </div>

      {/* Three TAMM cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <ProgressMeter
          label={t('leaves.balance.annualRemaining')}
          taken={balance.annual_taken}
          total={annualTotal}
          remaining={balance.annual_remaining}
        />
        <ProgressMeter
          label={t('leaves.balance.sickRemaining')}
          taken={balance.sick_taken}
          total={90}
          remaining={balance.sick_remaining}
        />
        <CarryOverCard value={balance.carry_over} />
      </div>

      {/* Optional message */}
      {balance.message && (
        <p className="rounded-2xl border border-hairline bg-surface-tinted px-4 py-3 text-[0.85em] text-muted-foreground">
          {splitBilingualMessage(balance.message, i18n.language)}
        </p>
      )}
    </div>
  )
}

export function TabBalance(): React.JSX.Element {
  const { t } = useTranslation()
  const [employeeId, setEmployeeId] = useState<string | null>(null)
  const [asOf, setAsOf] = useState<string>(todayIso())

  const balanceQuery = useQuery({
    queryKey: ['leave-balance', employeeId, asOf],
    queryFn: () => api.getLeaveBalance(employeeId!, asOf),
    enabled: !!employeeId,
  })

  return (
    <div className="flex max-w-5xl flex-col gap-4 px-6 pb-6 pt-4">
      {/* Filters row */}
      <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-surface px-3 py-2">
        <LeaveEmployeePicker
          selectedId={employeeId}
          onSelect={setEmployeeId}
        />
        <div className="flex items-center gap-2">
          <label className="text-[0.7em] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            {t('leaves.balance.asOf')}
          </label>
          <input
            type="date"
            value={asOf}
            onChange={(e) => setAsOf(e.target.value || todayIso())}
            className="h-8 rounded-full border border-hairline bg-surface px-3 font-mono text-[0.78em] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      </div>

      {/* Result */}
      {!employeeId ? (
        <p className="rounded-2xl border border-hairline bg-surface px-4 py-8 text-center text-sm text-muted-foreground">
          {t('leaves.balance.selectEmployee')}
        </p>
      ) : balanceQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
      ) : balanceQuery.isError ? (
        <p className="text-sm text-accent">{t('errors.generic')}</p>
      ) : balanceQuery.data ? (
        <BalanceCard balance={balanceQuery.data} />
      ) : null}
    </div>
  )
}
