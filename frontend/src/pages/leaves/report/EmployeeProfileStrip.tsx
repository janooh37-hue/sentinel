/**
 * EmployeeProfileStrip — full-width employee leave profile opened from a row's
 * name button (prototype `tr.profile`/`.pwrap`): current leave + last
 * completed leave, balance meters, days-taken-by-kind mini bars, pending
 * count, and a "filter report to this employee" action. Closes on ✕ or
 * Escape (window listener while mounted).
 *
 * Derivation is `employeeProfile` (tested in reportData) over ALL fetched
 * rows — the profile ignores the report scope on purpose: it answers "what
 * is this person's leave situation", not "what matches the filters".
 */
import { useEffect, useId, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'

import type { LeaveListItem } from '@/lib/api'
import { splitBilingual } from '@/lib/bilingualValue'
import { Button } from '@/components/ui/button'

import { leaveEmployeeName } from '../leaveEmployeeName'
import { StatusBadge } from '../StatusBadge'
import { BalanceMeters } from './BalanceMeters'
import { PeriodRun } from './PeriodRun'
import { dateLocale } from './fmt'
import { classifyLeaveType, kindMeta } from './kinds'
import { employeeProfile } from './reportData'

const MICRO_LABEL =
  'text-[0.68em] font-semibold uppercase tracking-[0.1em] text-muted-foreground rtl:tracking-normal'

interface EmployeeProfileStripProps {
  employeeId: string
  /** ALL fetched rows (not the scoped set) — the profile derives from them. */
  rows: LeaveListItem[]
  /** ISO `YYYY-MM-DD` (today). */
  today: string
  onFilterEmployee: (id: string) => void
  onClose: () => void
}

export function EmployeeProfileStrip({
  employeeId,
  rows,
  today,
  onFilterEmployee,
  onClose,
}: EmployeeProfileStripProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const headingId = useId()
  const locale = dateLocale(i18n.language)

  // Escape closes while the strip is open (same pattern as the mobile drawer).
  // Layered like the ledger ComposeWindow: yield to inner surfaces that already
  // handled Escape (defaultPrevented) and claim the key when we consume it.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.defaultPrevented) return
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const profile = useMemo(
    () => employeeProfile(rows, employeeId, today),
    [rows, employeeId, today],
  )

  // Name from the employee's first row's name fields; legacy rows without a
  // name fall back to the G-number (shared leaveEmployeeName helper).
  const firstRow = rows.find((r) => r.employee_id === employeeId)
  const name = firstRow ? leaveEmployeeName(firstRow, i18n.language) : employeeId

  // Displayed kind text keeps the row's stored label (translated when known,
  // bilingual-split otherwise — the TabRecords convention); the emoji comes
  // from the canonical kind.
  const kindLabel = (raw: string): string =>
    t(`leaves.type.${raw}`, { defaultValue: splitBilingual(raw, i18n.language) })

  const year = Number(today.slice(0, 4))
  const bars = profile.daysByKind // at most the 8 canonical kinds — show all
  const maxBarDays = bars.reduce((max, b) => Math.max(max, b.days), 0)
  const barsAria = `${t('leaves.report.profileDaysTaken', { year })}: ${bars
    .map((b) => `${t(kindMeta(b.kind).i18nKey)} ${b.days}`)
    .join(', ')}`

  return (
    <section
      aria-labelledby={headingId}
      className="border-y border-hairline bg-surface-raised px-5 py-4"
    >
      {/* header — name + G-number + close */}
      <div className="flex items-baseline gap-2.5 border-b border-hairline pb-2">
        <h3 id={headingId} className="text-[0.95em] font-bold text-foreground">
          {name}
        </h3>
        {name !== employeeId && (
          <bdi dir="ltr" className="font-mono text-[0.72em] text-faint">
            {employeeId}
          </bdi>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label={t('leaves.report.profileClose')}
          className="ms-auto -my-1 inline-flex h-8 w-8 items-center justify-center self-center rounded-full text-muted-foreground transition-colors hover:bg-surface-tinted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
        >
          <X className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
        </button>
      </div>

      <div className="mt-3 grid grid-cols-[1.1fr_1.2fr_1.2fr_auto] gap-6 max-lg:grid-cols-2">
        {/* 1 — current + last leave */}
        <div>
          <p className={MICRO_LABEL}>{t('leaves.report.profileCurrent')}</p>
          {profile.current ? (
            <div className="mt-1 flex flex-col items-start gap-1">
              <span className="text-[0.82em] font-semibold text-foreground">
                <span className="me-1" aria-hidden="true">
                  {kindMeta(classifyLeaveType(profile.current.leave_type)).emoji}
                </span>
                {kindLabel(profile.current.leave_type)}
              </span>
              <PeriodRun
                start={profile.current.start_date}
                end={profile.current.end_date}
                locale={locale}
                className="text-[0.78em] text-foreground"
              />
              <span className="text-[0.78em] tabular-nums text-muted-foreground">
                {t('leaves.report.profileReturns', { count: profile.daysUntilReturn ?? 0 })}
              </span>
            </div>
          ) : (
            <p className="mt-1 text-[0.82em] text-muted-foreground">
              {t('leaves.report.profileNotOnLeave')}
            </p>
          )}

          <p className={`${MICRO_LABEL} mt-3`}>{t('leaves.report.profileLast')}</p>
          {profile.last ? (
            <div className="mt-1 flex flex-col items-start gap-1">
              <span className="text-[0.82em] font-semibold text-foreground">
                <span className="me-1" aria-hidden="true">
                  {kindMeta(classifyLeaveType(profile.last.leave_type)).emoji}
                </span>
                {kindLabel(profile.last.leave_type)}
              </span>
              <PeriodRun
                start={profile.last.start_date}
                end={profile.last.end_date}
                locale={locale}
                className="text-[0.78em] text-foreground"
              />
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[0.78em] tabular-nums text-muted-foreground">
                  {t('leaves.report.totalsDays', { count: profile.last.days })}
                </span>
                <StatusBadge status={profile.last.status} leaveType={profile.last.leave_type} endDate={profile.last.end_date} hasCertificate={profile.last.has_certificate} />
              </span>
            </div>
          ) : (
            <p className="mt-1 text-[0.82em] text-muted-foreground">
              {t('leaves.report.profileNone')}
            </p>
          )}
        </div>

        {/* 2 — balance context */}
        <BalanceMeters employeeId={employeeId} />

        {/* 3 — days taken this year, by kind (Fig. 1 row pattern at h-1.5) */}
        <div>
          <p className={MICRO_LABEL}>{t('leaves.report.profileDaysTaken', { year })}</p>
          {bars.length === 0 ? (
            <p className="mt-1 text-[0.78em] text-muted-foreground">—</p>
          ) : (
            <div
              role="img"
              aria-label={barsAria}
              className="mt-2 grid grid-cols-[auto_1fr_auto] items-center gap-x-2 gap-y-1.5"
            >
              {bars.map((b) => (
                <div key={b.kind} className="contents">
                  <span className="whitespace-nowrap text-[0.72em] text-muted-foreground">
                    <span className="me-1" aria-hidden="true">
                      {kindMeta(b.kind).emoji}
                    </span>
                    {t(kindMeta(b.kind).i18nKey)}
                  </span>
                  <span className="block h-1.5 min-w-0">
                    <span
                      className="block h-1.5 rounded-full bg-primary"
                      style={{
                        width: `${maxBarDays > 0 ? Math.max((b.days / maxBarDays) * 100, 2) : 2}%`,
                      }}
                    />
                  </span>
                  <span className="text-end font-mono text-[0.72em] tabular-nums text-foreground">
                    {b.days}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 4 — pending count + filter action */}
        <div className="flex flex-col items-start gap-1">
          <p className={MICRO_LABEL}>{t('leaves.report.profilePending')}</p>
          <span className="font-mono text-[1.4em] font-bold tabular-nums text-foreground">
            {profile.pendingCount}
          </span>
          <Button
            variant="secondary"
            size="sm"
            className="mt-2 rounded-full"
            onClick={() => {
              onFilterEmployee(employeeId)
              onClose()
            }}
          >
            {t('leaves.report.profileFilter')}
          </Button>
        </div>
      </div>
    </section>
  )
}
