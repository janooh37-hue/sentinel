import type { TFunction } from 'i18next'
import { Fragment, useId, type ReactNode } from 'react'
import { Trans, useTranslation } from 'react-i18next'

import type { CompanyStats, CompanyStatsRow, CompanyStatsStatus, CompanyStatsTotals } from '@/lib/api'
import { useIsMobile } from '@/lib/useIsMobile'

import {
  companyDisplayName, formatStatsDuration, formatStatsNumber, formatStatsPercent, formatStatsPermitHours, formatStatsQuantity,
} from './companyStatsFormat'
import { absenceRateFill, absenceRateScale, DISCIPLINE_METRICS, disciplineValue, STATUS_TOKENS, type CountUnit, type DisciplineMetric } from './companyStatsModel'

interface Props {
  data: CompanyStats
  unit: CountUnit
  selected: string | null
  onSelect(key: string | null): void
}

const LEAVE_COLUMNS = ['annual', 'administrative', 'sick', 'exit_permits', 'duty', 'national_service'] as const
const STATUSES = ['good', 'normal', 'warn', 'bad'] as const
const WIDE_ORDER = ['leaves', 'discipline', 'rate'] as const
const MOBILE_ORDER = ['discipline', 'rate', 'leaves'] as const
const HEADER = 'border-b bg-surface-raised px-2 py-1.5 text-xs font-semibold text-muted-foreground'
const FIRST = 'sticky start-0 z-10 border-e text-start'
const CELL = 'border-b px-2 py-1.5 align-middle'
const TOTAL_CELL = 'border-b-0 bg-surface-raised'
const NOTE = 'block font-normal text-xs text-muted-foreground'

type LeaveColumn = (typeof LEAVE_COLUMNS)[number]
type Group = (typeof WIDE_ORDER)[number]

function Value({ value, tinted = false }: { value: number; tinted?: boolean }) {
  return <strong dir="ltr" className={`block text-end ${value === 0 && !tinted ? 'text-muted-foreground' : ''}`}>{formatStatsNumber(value)}</strong>
}

function NumericNote({ children, tinted = false }: { children: ReactNode; tinted?: boolean }) {
  return <span dir="ltr" className={tinted ? 'block text-end text-xs' : `${NOTE} text-end`}><bdi dir="auto">{children}</bdi></span>
}

function relativeText(ratio: number, t: TFunction) {
  const change = Math.round((ratio - 1) * 100)
  if (change === 0) return t('companyStats.comparison.atAverage')
  return (
    <Trans
      i18nKey={change < 0 ? 'companyStats.comparison.less' : 'companyStats.comparison.more'}
      values={{ amount: formatStatsPercent(Math.abs(change)) }}
      components={{ amount: <bdi dir="ltr" /> }}
    />
  )
}

function DisciplineCell({ metric, totals, row, unit, t }: {
  metric: DisciplineMetric
  totals: CompanyStatsTotals
  row?: CompanyStatsRow
  unit: CountUnit
  t: TFunction
}) {
  const status = row?.small_sample ? null : row?.status[metric]
  const tone = status && status !== 'normal' ? STATUS_TOKENS[status] : null
  const value = disciplineValue(totals, metric, unit)
  const ratio = row?.ratio[metric]
  const note = value === 0 ? null : status === 'normal' ? t('companyStats.status.normal')
    : ratio != null ? relativeText(ratio, t)
      : row && !row.small_sample ? t('companyStats.comparison.noComparison') : null

  return (
    <td className={`${CELL} ${metric === 'absence' ? 'border-s' : ''} ${row ? '' : TOTAL_CELL}`} style={tone ? { color: tone.fg, backgroundColor: tone.soft } : undefined}>
      <Value value={value} tinted={tone !== null} />
      {metric === 'late' && value > 0 && <NumericNote tinted={tone !== null}>{formatStatsDuration(totals.late.minutes, t)}</NumericNote>}
      {note && <NumericNote tinted={tone !== null}>{note}</NumericNote>}
      {tone && status && <span className="sr-only">{t(`companyStats.status.${status}`)}</span>}
    </td>
  )
}

function LeaveCell({ column, totals, unit, total, t }: {
  column: LeaveColumn
  totals: CompanyStatsTotals
  unit: CountUnit
  total: boolean
  t: TFunction
}) {
  const className = `${CELL} ${column === LEAVE_COLUMNS[0] ? 'border-s' : ''} ${total ? TOTAL_CELL : ''}`
  if (column === 'exit_permits') {
    const permits = totals.leaves.exit_permits
    const hours = formatStatsPermitHours(permits, t)
    return (
      <td className={`${className} min-w-24`}>
        {permits.count > 0 ? (
          <strong dir="ltr" className="block text-end">
            <bdi dir="auto">{formatStatsQuantity('permit', permits.count, t)}{hours && '\u00a0·'}</bdi>
          </strong>
        ) : <Value value={0} />}
        {hours && <NumericNote>{hours}</NumericNote>}
      </td>
    )
  }
  const leave = totals.leaves[column]
  return (
    <td className={className}>
      <Value value={leave[unit]} />
      {leave[unit] > 0 && <NumericNote>{unit === 'days' ? formatStatsQuantity('occurrence', leave.count, t) : formatStatsQuantity('day', leave.days, t)}</NumericNote>}
    </td>
  )
}

function RateCell({ totals, maximum, status, total, direction, t }: {
  totals: CompanyStatsTotals
  maximum: number
  status?: CompanyStatsStatus | null
  total: boolean
  direction: string
  t: TFunction
}) {
  const rate = totals.absence_rate
  const fill = absenceRateFill(rate, maximum)
  const tone = STATUS_TOKENS[status ?? 'normal']
  return (
    <td className={`${CELL} min-w-[108px] border-s ${total ? TOTAL_CELL : ''}`}>
      <div dir="ltr" className="flex items-center justify-end gap-1.5">
        <span dir={direction} aria-hidden="true" className="h-1 max-w-14 min-w-7 flex-1 rounded-full bg-border">
          <span className="block h-full rounded-full" style={{ inlineSize: `${fill}%`, backgroundColor: tone.bar }} />
        </span>
        <strong style={{ color: tone.fg }}><bdi dir="ltr">{rate === null ? '—' : formatStatsPercent(rate, 1)}</bdi></strong>
      </div>
      <NumericNote>
        {rate === null ? t('companyStats.companies.noDuties') : (
          <Trans
            i18nKey="companyStats.comparison.due"
            count={totals.duties_due}
            values={{ number: formatStatsNumber(totals.duties_due) }}
            components={{ number: <bdi dir="ltr" /> }}
          />
        )}
      </NumericNote>
    </td>
  )
}

function DataCells({ totals, row, groups, maximum, unit, direction, t }: {
  totals: CompanyStatsTotals
  row?: CompanyStatsRow
  groups: readonly Group[]
  maximum: number
  unit: CountUnit
  direction: string
  t: TFunction
}) {
  return groups.map((group) => {
    if (group === 'rate') {
      return <RateCell key={group} totals={totals} maximum={maximum} status={row?.small_sample ? null : row?.status.absence} total={!row} direction={direction} t={t} />
    }
    if (group === 'discipline') {
      return DISCIPLINE_METRICS.map((metric) => <DisciplineCell key={metric} metric={metric} totals={totals} row={row} unit={unit} t={t} />)
    }
    return LEAVE_COLUMNS.map((column) => <LeaveCell key={column} column={column} totals={totals} unit={unit} total={!row} t={t} />)
  })
}

export function CompanyComparisonTable({ data, unit, selected, onSelect }: Props) {
  const { t, i18n } = useTranslation()
  const direction = document.documentElement.dir || i18n.dir()
  const titleId = useId()
  const mobile = useIsMobile()
  const groups = mobile ? MOBILE_ORDER : WIDE_ORDER
  const title = t('companyStats.comparison.title')
  const unitLabel = t(unit === 'days' ? 'companyStats.unit.byDays' : 'companyStats.unit.byCount')
  const { companies, overall } = data
  const maximum = absenceRateScale(companies)

  return (
    <section aria-labelledby={titleId} className="min-w-0">
      <header className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 id={titleId} className="flex items-baseline gap-2 text-base font-bold">
          <bdi dir="ltr" aria-hidden="true" className="text-xs text-muted-foreground">04</bdi>{title}
        </h2>
        <span aria-hidden="true" className="min-w-4 flex-1 border-t" />
        <ul role="list" aria-label={t('companyStats.comparison.relative')} className="flex basis-full flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground lg:basis-auto">
          {STATUSES.map((status) => (
            <li key={status} className="inline-flex items-center gap-1">
              <span aria-hidden="true" className="size-2.5 shrink-0 rounded-sm border" style={{ borderColor: STATUS_TOKENS[status].bar, backgroundColor: STATUS_TOKENS[status].soft }} />
              {t(`companyStats.status.${status}`)}
            </li>
          ))}
        </ul>
      </header>
      <p className="mb-2 text-xs text-muted-foreground">{t('companyStats.comparison.relative')}{'\u00a0· '}{unitLabel}</p>
      <p className="mb-1.5 text-xs text-muted-foreground xl:hidden">{t('companyStats.comparison.scrollHint')}</p>
      <div
        tabIndex={0}
        role="region"
        aria-labelledby={titleId}
        className="overflow-x-auto rounded-md border bg-surface [scrollbar-color:var(--border-strong)_var(--surface)] [scrollbar-width:thin] focus-visible:-outline-offset-2!"
      >
        <table className={`w-full border-separate border-spacing-0 text-sm ${mobile ? 'min-w-[1074px] table-fixed' : 'min-w-[1040px]'}`} style={{ fontVariantNumeric: 'tabular-nums' }}>
          <caption className="sr-only">{title}{'\u00a0· '}{unitLabel}</caption>
          <colgroup><col style={{ inlineSize: mobile ? 116 : 161 }} /></colgroup>
          {groups.map((group) => (
            <colgroup key={group}>
              {group === 'rate' ? <col style={mobile ? { inlineSize: 127 } : undefined} />
                : group === 'discipline' ? <col span={3} style={mobile ? { inlineSize: 79 } : undefined} />
                  : LEAVE_COLUMNS.map((column) => <col key={column} style={mobile ? { inlineSize: column === 'exit_permits' ? 144 : 90 } : undefined} />)}
            </colgroup>
          ))}
          <thead>
            <tr>
              <th scope="col" rowSpan={2} className={`${HEADER} ${FIRST}`}>{t('companyStats.filters.company')}</th>
              {groups.map((group) => group === 'rate' ? (
                <th key={group} scope="col" rowSpan={2} className={`${HEADER} border-s`}>
                  <span dir="ltr" className="block text-end"><bdi dir="auto">{t('companyStats.companies.rate')}</bdi></span>
                </th>
              ) : (
                <th key={group} scope="colgroup" colSpan={group === 'leaves' ? LEAVE_COLUMNS.length : DISCIPLINE_METRICS.length} className={`${HEADER} border-s text-center`}>
                  {t(group === 'leaves' ? 'companyStats.comparison.leavesGroup' : 'companyStats.comparison.disciplineGroup')}
                </th>
              ))}
            </tr>
            <tr>
              {groups.map((group) => group === 'rate' ? null : (
                <Fragment key={group}>
                  {(group === 'leaves' ? LEAVE_COLUMNS : DISCIPLINE_METRICS).map((column, index) => (
                    <th key={column} scope="col" className={`${HEADER} ${index === 0 ? 'border-s' : ''}`}>
                      <span dir="ltr" className="block text-end"><bdi dir="auto">{t(group === 'leaves' ? `companyStats.leaves.${column}` : `companyStats.metric.${column}`)}</bdi></span>
                    </th>
                  ))}
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {companies.map((row) => {
              const active = row.key === selected
              const company = companyDisplayName(row.duty_unit, t)
              const roster = row.shift_codes.includes('office_day') ? t('companyStats.companies.officeRoster')
                : row.shift_codes.length ? t('companyStats.companies.shiftRoster') : null
              return (
                <tr key={row.key}>
                  <th scope="row" className={`${FIRST} border-b p-0 ${active ? 'bg-primary-soft text-primary-text before:absolute before:inset-y-0 before:start-0 before:w-[3px] before:bg-primary' : 'bg-surface'}`}>
                    <button
                      type="button"
                      aria-label={company}
                      aria-pressed={active}
                      onClick={() => onSelect(active ? null : row.key)}
                      className="block min-h-[44px] w-full cursor-pointer px-2 py-1.5 text-start hover:underline focus-visible:outline-none! focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring md:min-h-0"
                    >
                      <bdi dir="auto" className="font-semibold">{company}</bdi>
                      <span className={NOTE}>
                        <bdi dir="auto">{formatStatsQuantity('person', row.totals.strength, t)}</bdi>
                        {roster && <span className="block md:inline"><span aria-hidden="true" className="hidden md:inline">{'\u00a0· '}</span>{roster}</span>}
                      </span>
                    </button>
                    {row.small_sample && <span className="mx-2 mb-1.5 block text-xs font-medium text-muted-foreground">{t('companyStats.status.smallSample')}</span>}
                  </th>
                  <DataCells totals={row.totals} row={row} groups={groups} maximum={maximum} unit={unit} direction={direction} t={t} />
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" className={`${FIRST} bg-surface-raised px-2 py-1.5 font-semibold`}>
                {t('companyStats.comparison.total')}
                <span className={NOTE}><bdi dir="auto">{formatStatsQuantity('person', overall.strength, t)}</bdi></span>
              </th>
              <DataCells totals={overall} groups={groups} maximum={maximum} unit={unit} direction={direction} t={t} />
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {t('companyStats.leaves.other')}: {overall.leaves.other.days === 0 ? <bdi dir="ltr">0</bdi> : (
          <><bdi dir="auto">{formatStatsQuantity('day', overall.leaves.other.days, t)}</bdi>{'\u00a0· '}<bdi dir="auto">{formatStatsQuantity('record', overall.leaves.other.count, t)}</bdi></>
        )}
      </p>
    </section>
  )
}
