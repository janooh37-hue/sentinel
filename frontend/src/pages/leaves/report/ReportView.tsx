/**
 * ReportView — the Records page's printable report: one options bar, then the
 * paper exactly as it prints, then Print / Save PDF under it (where reading
 * the sheet ends).
 *
 * It opens with the register's filters (`seed`) and keeps its own choices
 * after that, so shaping a report never disturbs the register. Rows come from
 * the register's already-fetched list; nothing is refetched.
 */
import { useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileDown, Printer } from 'lucide-react'

import type { LeaveListItem } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

import { LeaveEmployeePicker } from '../LeaveEmployeePicker'
import { leaveEmployeeName } from '../leaveEmployeeName'
import {
  CHIP_BASE, CHIP_OFF, CHIP_ON, FIELD_LABEL, GROUP_LABEL_KEYS, NATIVE_SELECT, SEGMENT_BUTTON,
  SEGMENT_GROUP, SEGMENT_OFF, SEGMENT_ON, WORKFLOW_STATUSES, toggleItem,
} from './controls'
import { dateLocale, fmtDayMonthYear, fmtMonthYear } from './fmt'
import { CANONICAL_KINDS, kindMeta, type KindId } from './kinds'
import {
  applyScope, matchesStaff, periodWindow, recordOverlapsWindow, sortRows, REGISTER_COLUMNS,
  type GroupMode, type MonthRef, type ReportPeriod, type SortSpec, type StaffFilter,
} from './reportData'
import { ReportPaper } from './ReportPaper'

/** The register's filters at the moment the report opens. */
export interface ReportSeed {
  kinds: KindId[]
  statuses: string[]
  employeeId: string | null
  month: MonthRef | null
  sort: SortSpec
  group: GroupMode
}

const PERIOD_MODES: ReportPeriod['mode'][] = ['month', 'range', 'year']
const STAFF_OPTIONS: StaffFilter[] = ['all', 'ours', 'loaned']
const GROUP_MODES: GroupMode[] = ['none', 'kind', 'month', 'employee']

interface ReportViewProps {
  all: LeaveListItem[]
  today: string
  seed: ReportSeed
}

export function ReportView({ all, today, seed }: ReportViewProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const locale = dateLocale(i18n.language)
  const ids = useId()

  const [periodMode, setPeriodMode] = useState<ReportPeriod['mode']>(seed.month ? 'month' : 'year')
  const [month, setMonth] = useState(
    seed.month
      ? `${seed.month.year}-${String(seed.month.monthIndex + 1).padStart(2, '0')}`
      : today.slice(0, 7),
  )
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [year, setYear] = useState(seed.month?.year ?? Number(today.slice(0, 4)))
  const [kinds, setKinds] = useState(seed.kinds)
  const [statuses, setStatuses] = useState(seed.statuses)
  const [employeeId, setEmployeeId] = useState(seed.employeeId)
  const [staff, setStaff] = useState<StaffFilter>('all')
  const [group, setGroup] = useState(seed.group)
  const [sort, setSort] = useState(seed.sort)
  const [withTotals, setWithTotals] = useState(false)
  const [withSignatures, setWithSignatures] = useState(false)

  const rows = useMemo(() => {
    const period: ReportPeriod =
      periodMode === 'year'
        ? { mode: 'year', year }
        : periodMode === 'month'
          ? { mode: 'month', month }
          : { mode: 'range', from, to }
    const span = periodWindow(period)
    const picked = applyScope(all, { month: null, employeeId, kinds, statuses, q: '' }).filter(
      (r) => recordOverlapsWindow(r, span) && matchesStaff(r, staff),
    )
    return sortRows(picked, sort, (r) => leaveEmployeeName(r, i18n.language), i18n.language)
  }, [all, periodMode, year, month, from, to, employeeId, kinds, statuses, staff, sort, i18n.language])

  const years = useMemo(
    () =>
      [...new Set([Number(today.slice(0, 4)), ...all.map((r) => Number(r.start_date.slice(0, 4)))])].sort(
        (a, b) => b - a,
      ),
    [all, today],
  )

  const periodLabel =
    periodMode === 'year'
      ? String(year)
      : periodMode === 'month'
        ? month && fmtMonthYear(month, locale)
        : (from || to) &&
          t('leaves.report.rangeLabel', {
            from: from ? fmtDayMonthYear(from, locale) : '…',
            to: to ? fmtDayMonthYear(to, locale) : '…',
          })
  const employeeRow = employeeId ? all.find((r) => r.employee_id === employeeId) : undefined
  const facts = [
    periodLabel,
    staff !== 'all' && t(`leaves.report.staff.${staff}`),
    statuses.map((s) => t(`leaves.status.${s}`)).join(', '),
    employeeRow ? leaveEmployeeName(employeeRow, i18n.language) : employeeId,
  ].filter((f): f is string => !!f)
  const title = t('leaves.report.paperTitle', {
    topic:
      kinds.length > 0
        ? kinds.map((k) => t(kindMeta(k).i18nKey)).join(', ')
        : t('leaves.report.allKinds'),
  })

  return (
    <>
      <section
        aria-label={t('leaves.report.optionsLabel')}
        className="flex flex-col gap-4 rounded-2xl border border-hairline bg-surface p-4"
        data-print-hide
      >
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
          <fieldset className="min-w-0">
            <legend className={FIELD_LABEL}>{t('leaves.report.optPeriod')}</legend>
            <div className="flex flex-wrap items-center gap-2">
              <div className={SEGMENT_GROUP}>
                {PERIOD_MODES.map((m) => (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={periodMode === m}
                    onClick={() => setPeriodMode(m)}
                    className={cn(SEGMENT_BUTTON, periodMode === m ? SEGMENT_ON : SEGMENT_OFF)}
                  >
                    {t(`leaves.report.period_${m}`)}
                  </button>
                ))}
              </div>
              {periodMode === 'month' && (
                <Input
                  type="month"
                  aria-label={t('leaves.report.period_month')}
                  value={month}
                  onChange={(e) => setMonth(e.target.value)}
                  className="h-9 w-auto font-mono tabular-nums"
                />
              )}
              {periodMode === 'range' && (
                <>
                  {/* The bounds cap each other, so a range can't be inverted
                      into a silently empty report. */}
                  <Input
                    type="date"
                    aria-label={t('leaves.report.rangeFrom')}
                    value={from}
                    max={to || undefined}
                    onChange={(e) => setFrom(e.target.value)}
                    className="h-9 w-auto font-mono tabular-nums"
                  />
                  <span className="text-[0.8em] text-muted-foreground">{t('leaves.report.rangeTo')}</span>
                  <Input
                    type="date"
                    aria-label={t('leaves.report.rangeToLabel')}
                    value={to}
                    min={from || undefined}
                    onChange={(e) => setTo(e.target.value)}
                    className="h-9 w-auto font-mono tabular-nums"
                  />
                </>
              )}
              {periodMode === 'year' && (
                <select
                  aria-label={t('leaves.report.period_year')}
                  value={year}
                  onChange={(e) => setYear(Number(e.target.value))}
                  className={NATIVE_SELECT}
                >
                  {years.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </fieldset>

          <fieldset className="min-w-0">
            <legend className={FIELD_LABEL}>{t('leaves.report.optStaff')}</legend>
            <div className={SEGMENT_GROUP}>
              {STAFF_OPTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={staff === s}
                  onClick={() => setStaff(s)}
                  className={cn(SEGMENT_BUTTON, staff === s ? SEGMENT_ON : SEGMENT_OFF)}
                >
                  {t(`leaves.report.staff.${s}`)}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="min-w-[14rem]">
            <span className={FIELD_LABEL}>{t('leaves.columns.employee')}</span>
            <LeaveEmployeePicker selectedId={employeeId} onSelect={setEmployeeId} />
          </div>
        </div>

        <fieldset>
          <legend className={FIELD_LABEL}>{t('leaves.report.colKind')}</legend>
          <div className="flex flex-wrap items-center gap-1.5">
            {CANONICAL_KINDS.map((k) => {
              const active = kinds.includes(k.id)
              return (
                <button
                  key={k.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setKinds(toggleItem(kinds, k.id))}
                  className={cn(CHIP_BASE, 'gap-1', active ? CHIP_ON : CHIP_OFF)}
                >
                  <span aria-hidden="true">{k.emoji}</span>
                  {t(k.i18nKey)}
                </button>
              )
            })}
          </div>
        </fieldset>

        <fieldset>
          <legend className={FIELD_LABEL}>{t('leaves.columns.status')}</legend>
          <div className="flex flex-wrap items-center gap-1.5">
            {WORKFLOW_STATUSES.map((s) => {
              const active = statuses.includes(s)
              return (
                <button
                  key={s}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setStatuses(toggleItem(statuses, s))}
                  className={cn(CHIP_BASE, active ? CHIP_ON : CHIP_OFF)}
                >
                  {t(`leaves.status.${s}`)}
                </button>
              )
            })}
          </div>
        </fieldset>

        <div className="flex flex-wrap items-end gap-x-6 gap-y-3 border-t border-hairline pt-4">
          <div>
            <label htmlFor={`${ids}-group`} className={FIELD_LABEL}>
              {t('leaves.report.groupLabel')}
            </label>
            <select
              id={`${ids}-group`}
              value={group}
              onChange={(e) => setGroup(e.target.value as GroupMode)}
              className={NATIVE_SELECT}
            >
              {GROUP_MODES.map((m) => (
                <option key={m} value={m}>
                  {t(GROUP_LABEL_KEYS[m])}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor={`${ids}-sort`} className={FIELD_LABEL}>
              {t('leaves.report.optSort')}
            </label>
            <div className="flex gap-2">
              <select
                id={`${ids}-sort`}
                value={sort.key}
                onChange={(e) => setSort({ ...sort, key: e.target.value as SortSpec['key'] })}
                className={NATIVE_SELECT}
              >
                {REGISTER_COLUMNS.map((c) => (
                  <option key={c.key} value={c.key}>
                    {t(c.labelKey)}
                  </option>
                ))}
              </select>
              <select
                aria-label={t('leaves.report.optSortDir')}
                value={sort.dir}
                onChange={(e) => setSort({ ...sort, dir: e.target.value as SortSpec['dir'] })}
                className={NATIVE_SELECT}
              >
                <option value="asc">{t('leaves.report.sortAsc')}</option>
                <option value="desc">{t('leaves.report.sortDesc')}</option>
              </select>
            </div>
          </div>

          <fieldset>
            <legend className={FIELD_LABEL}>{t('leaves.report.optInclude')}</legend>
            <div className="flex h-9 flex-wrap items-center gap-x-5 gap-y-1 text-[0.85em] text-foreground">
              <label className="inline-flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={withTotals}
                  onChange={(e) => setWithTotals(e.target.checked)}
                  className="h-4 w-4 accent-primary"
                />
                {t('leaves.report.includeTotals')}
              </label>
              <label className="inline-flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={withSignatures}
                  onChange={(e) => setWithSignatures(e.target.checked)}
                  className="h-4 w-4 accent-primary"
                />
                {t('leaves.report.includeSignatures')}
              </label>
            </div>
          </fieldset>
        </div>
      </section>

      <ReportPaper
        rows={rows}
        group={group}
        sort={sort}
        today={today}
        title={title}
        facts={facts}
        employeeTotals={withTotals}
        signatures={withSignatures}
        onScreen
      />

      {/* «Save PDF» is the print dialog's own PDF target, as on every other
          document in the app, so both actions open the same dialog. */}
      <div className="mx-auto flex w-full max-w-[210mm] justify-end gap-2" data-print-hide>
        <Button type="button" variant="secondary" disabled={rows.length === 0} onClick={() => window.print()}>
          <FileDown className="h-4 w-4" aria-hidden />
          {t('leaves.report.savePdf')}
        </Button>
        <Button type="button" disabled={rows.length === 0} onClick={() => window.print()}>
          <Printer className="h-4 w-4" aria-hidden />
          {t('leaves.report.print')}
        </Button>
      </div>
    </>
  )
}
