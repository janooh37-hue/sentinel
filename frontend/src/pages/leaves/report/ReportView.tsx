/**
 * ReportView — the Records page's printable leave report: an options panel at
 * the inline start (Print / Save PDF at its foot) and the paper beside it,
 * exactly as it prints.
 *
 * It opens with the register's filters (`seed`) and keeps its own choices
 * after that, so shaping a report never disturbs the register. Rows come from
 * the register's already-fetched list; nothing is refetched. `paperOnly`
 * renders just the paper, hidden on screen: the register's Ctrl+P path.
 *
 * Rejected and cancelled leaves are not days taken, so they count only when
 * the operator picks those statuses explicitly.
 */
import { useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileDown, Printer } from 'lucide-react'

import type { LeaveListItem } from '@/lib/api'
import { UNASSIGNED, unitOptions } from '@/lib/dutyUnits'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

import { LeaveEmployeePicker } from '../LeaveEmployeePicker'
import { canonStatus } from '../lifecycle'
import { leaveEmployeeName } from '../leaveEmployeeName'
import {
  CHIP_BASE, CHIP_OFF, CHIP_ON, FIELD_LABEL, NATIVE_SELECT, SEGMENT_BUTTON, SEGMENT_GROUP,
  SEGMENT_OFF, SEGMENT_ON, WORKFLOW_STATUSES, toggleItem,
} from './controls'
import { dateLocale, fmtDayMonthYear } from './fmt'
import { CANONICAL_KINDS, kindMeta, type KindId } from './kinds'
import {
  applyScope, buildReportSections, isDeparted, matchesCompany, matchesStaff,
  type MonthRef, type ReportPeriod, type ReportSort, type StaffFilter,
} from './reportData'
import { ReportPaper } from './ReportPaper'

/** The register's filters at the moment the report opens. */
export interface ReportSeed {
  kinds: KindId[]
  statuses: string[]
  employeeId: string | null
  month: MonthRef | null
}

const PERIOD_MODES: ReportPeriod['mode'][] = ['month', 'range', 'year']
const STAFF_OPTIONS: StaffFilter[] = ['all', 'ours', 'loaned']
/** Sort choices, labelled with the paper's own column headings. */
const SORT_LABEL_KEYS: Record<ReportSort['key'], string> = {
  days: 'leaves.report.colTotalDays',
  name: 'leaves.report.colName',
  id: 'leaves.report.colId',
  unit: 'leaves.report.colUnit',
}
const NOT_TAKEN = ['Rejected', 'Cancelled']

interface ReportViewProps {
  all: LeaveListItem[]
  today: string
  seed: ReportSeed
  paperOnly?: boolean
}

export function ReportView({ all, today, seed, paperOnly = false }: ReportViewProps): React.JSX.Element {
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
  const [company, setCompany] = useState<string | null>(null)
  const [excludeDeparted, setExcludeDeparted] = useState(true)
  const [sort, setSort] = useState<ReportSort>({ key: 'days', dir: 'desc' })
  const [withSignatures, setWithSignatures] = useState(false)

  const sections = useMemo(() => {
    const period: ReportPeriod =
      periodMode === 'year'
        ? { mode: 'year', year }
        : periodMode === 'month'
          ? { mode: 'month', month }
          : { mode: 'range', from, to }
    const picked = applyScope(all, { month: null, employeeId, kinds, statuses, q: '' }).filter(
      (r) =>
        matchesStaff(r, staff) &&
        matchesCompany(r, company) &&
        !(excludeDeparted && isDeparted(r)) &&
        (statuses.length > 0 || !NOT_TAKEN.includes(canonStatus(r.status))),
    )
    return buildReportSections(picked, period, sort, (r) => leaveEmployeeName(r, i18n.language), i18n.language)
  }, [all, periodMode, year, month, from, to, employeeId, kinds, statuses, staff, company, excludeDeparted, sort, i18n.language])

  const companies = useMemo(() => unitOptions(all.map((r) => ({ duty_unit: r.employee_duty_unit }))), [all])
  const companyLabel = (c: string): string => (c === UNASSIGNED ? t('dutyLocations.unassigned') : c)

  const years = useMemo(
    () =>
      [...new Set([Number(today.slice(0, 4)), ...all.map((r) => Number(r.start_date.slice(0, 4)))])].sort(
        (a, b) => b - a,
      ),
    [all, today],
  )

  // Each sheet names its own month; the facts carry the wider period only
  // when it spans more than one month.
  const periodLabel =
    periodMode === 'year'
      ? String(year)
      : periodMode === 'range' && (from || to)
        ? t('leaves.report.rangeLabel', {
            from: from ? fmtDayMonthYear(from, locale) : '…',
            to: to ? fmtDayMonthYear(to, locale) : '…',
          })
        : null
  const employeeRow = employeeId ? all.find((r) => r.employee_id === employeeId) : undefined
  const facts = [
    periodLabel,
    staff !== 'all' && t(`leaves.report.staff.${staff}`),
    company !== null && companyLabel(company),
    excludeDeparted && t('leaves.report.departedExcluded'),
    statuses.map((s) => t(`leaves.status.${s}`)).join(', '),
    employeeRow ? leaveEmployeeName(employeeRow, i18n.language) : employeeId,
  ].filter((f): f is string => !!f)
  const title = t('leaves.report.paperTitle', {
    topic:
      kinds.length > 0
        ? kinds.map((k) => t(kindMeta(k).i18nKey)).join(', ')
        : t('leaves.report.allKinds'),
  })

  const paper = (
    <ReportPaper
      sections={sections}
      title={title}
      facts={facts}
      emptyHeading={periodLabel ?? title}
      today={today}
      signatures={withSignatures}
      onScreen={!paperOnly}
    />
  )
  if (paperOnly) return paper

  return (
    <div className="grid grid-cols-[19rem_minmax(0,1fr)] items-start gap-6 max-lg:grid-cols-1 print:block">
      <section
        aria-label={t('leaves.report.optionsLabel')}
        className="flex flex-col gap-5 rounded-2xl border border-hairline bg-surface p-4 lg:sticky lg:top-0"
        data-print-hide
      >
        <fieldset className="min-w-0">
          <legend className={FIELD_LABEL}>{t('leaves.report.optPeriod')}</legend>
          <div className={cn(SEGMENT_GROUP, 'mb-2')}>
            {PERIOD_MODES.map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={periodMode === m}
                onClick={() => setPeriodMode(m)}
                className={cn(SEGMENT_BUTTON, 'flex-1 justify-center whitespace-nowrap px-2', periodMode === m ? SEGMENT_ON : SEGMENT_OFF)}
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
              className="h-9 font-mono tabular-nums"
            />
          )}
          {periodMode === 'range' && (
            // The bounds cap each other, so a range can't be inverted into a
            // silently empty report.
            <div className="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-2 text-[0.8em] text-muted-foreground">
              <span>{t('leaves.report.rangeFrom')}</span>
              <Input
                type="date"
                aria-label={t('leaves.report.rangeFrom')}
                value={from}
                max={to || undefined}
                onChange={(e) => setFrom(e.target.value)}
                className="h-9 font-mono tabular-nums"
              />
              <span>{t('leaves.report.rangeTo')}</span>
              <Input
                type="date"
                aria-label={t('leaves.report.rangeToLabel')}
                value={to}
                min={from || undefined}
                onChange={(e) => setTo(e.target.value)}
                className="h-9 font-mono tabular-nums"
              />
            </div>
          )}
          {periodMode === 'year' && (
            <select
              aria-label={t('leaves.report.period_year')}
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className={cn(NATIVE_SELECT, 'w-full')}
            >
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          )}
        </fieldset>

        <fieldset className="min-w-0">
          <legend className={FIELD_LABEL}>{t('leaves.report.colKind')}</legend>
          <div className="flex flex-wrap gap-1.5">
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

        <fieldset className="min-w-0">
          <legend className={FIELD_LABEL}>{t('leaves.report.optStaff')}</legend>
          <div className={SEGMENT_GROUP}>
            {STAFF_OPTIONS.map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={staff === s}
                onClick={() => setStaff(s)}
                className={cn(SEGMENT_BUTTON, 'flex-1 justify-center whitespace-nowrap px-2', staff === s ? SEGMENT_ON : SEGMENT_OFF)}
              >
                {t(`leaves.report.staff.${s}`)}
              </button>
            ))}
          </div>
          <label className="mt-2 inline-flex cursor-pointer items-center gap-2 text-[0.85em] text-foreground">
            <input
              type="checkbox"
              checked={excludeDeparted}
              onChange={(e) => setExcludeDeparted(e.target.checked)}
              className="h-4 w-4 accent-primary"
            />
            {t('leaves.report.excludeDeparted')}
          </label>
        </fieldset>

        <div className="min-w-0">
          <label htmlFor={`${ids}-company`} className={FIELD_LABEL}>
            {t('leaves.report.optCompany')}
          </label>
          <select
            id={`${ids}-company`}
            value={company ?? ''}
            onChange={(e) => setCompany(e.target.value || null)}
            className={cn(NATIVE_SELECT, 'w-full')}
          >
            <option value="">{t('leaves.report.allCompanies')}</option>
            {[...companies, UNASSIGNED].map((c) => (
              <option key={c} value={c}>
                {companyLabel(c)}
              </option>
            ))}
          </select>
        </div>

        <fieldset className="min-w-0">
          <legend className={FIELD_LABEL}>{t('leaves.columns.status')}</legend>
          <div className="flex flex-wrap gap-1.5">
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

        <div className="min-w-0">
          <span className={FIELD_LABEL}>{t('leaves.columns.employee')}</span>
          <LeaveEmployeePicker selectedId={employeeId} onSelect={setEmployeeId} />
        </div>

        <div>
          <label htmlFor={`${ids}-sort`} className={FIELD_LABEL}>
            {t('leaves.report.optSort')}
          </label>
          <div className="flex gap-2">
            <select
              id={`${ids}-sort`}
              value={sort.key}
              onChange={(e) => setSort({ ...sort, key: e.target.value as ReportSort['key'] })}
              className={cn(NATIVE_SELECT, 'min-w-0 flex-1')}
            >
              {(Object.keys(SORT_LABEL_KEYS) as ReportSort['key'][]).map((k) => (
                <option key={k} value={k}>
                  {t(SORT_LABEL_KEYS[k])}
                </option>
              ))}
            </select>
            <select
              aria-label={t('leaves.report.optSortDir')}
              value={sort.dir}
              onChange={(e) => setSort({ ...sort, dir: e.target.value as ReportSort['dir'] })}
              className={NATIVE_SELECT}
            >
              <option value="desc">{t('leaves.report.sortDesc')}</option>
              <option value="asc">{t('leaves.report.sortAsc')}</option>
            </select>
          </div>
        </div>

        <label className="inline-flex cursor-pointer items-center gap-2 text-[0.85em] text-foreground">
          <input
            type="checkbox"
            checked={withSignatures}
            onChange={(e) => setWithSignatures(e.target.checked)}
            className="h-4 w-4 accent-primary"
          />
          {t('leaves.report.includeSignatures')}
        </label>

        {/* «Save PDF» is the print dialog's own PDF target, as on every other
            document in the app, so both actions open the same dialog. */}
        <div className="flex flex-col gap-2 border-t border-hairline pt-4">
          <Button type="button" disabled={sections.length === 0} onClick={() => window.print()}>
            <Printer className="h-4 w-4" aria-hidden />
            {t('leaves.report.print')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={sections.length === 0}
            onClick={() => window.print()}
          >
            <FileDown className="h-4 w-4" aria-hidden />
            {t('leaves.report.savePdf')}
          </Button>
        </div>
      </section>

      {paper}
    </div>
  )
}
