import type { TFunction } from 'i18next'
import { ExternalLink } from 'lucide-react'
import { useId } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import type { CompanyStats, CompanyStatsEmployee, CompanyStatsTotals } from '@/lib/api'
import { localized } from '@/lib/language'
import { useCapabilities } from '@/lib/useCapabilities'
import { useIsMobile } from '@/lib/useIsMobile'

import { companyDisplayName, formatStatsDate, formatStatsDuration, formatStatsNumber, formatStatsQuantity } from './companyStatsFormat'
import { disciplineValue, RANKING_SORTS, STATUS_TOKENS, type CountUnit, type RankingSort } from './companyStatsModel'

interface Props {
  data: CompanyStats
  sort: RankingSort
  onSortChange(sort: RankingSort): void
  unit: CountUnit
  companyName: string | null
}

const METRIC_COLUMNS = ['absence', 'sickDays', 'late', 'single_punch', 'leaves', 'score'] as const
const DESKTOP_COLUMNS = ['company', ...METRIC_COLUMNS] as const
const HEADER = 'border-b px-2 py-2 text-xs font-semibold'
const FIRST = 'sticky start-0 z-10 border-e px-2 py-2 text-start'
const NOTE = 'block text-xs font-normal text-muted-foreground'
const SORTED = 'bg-primary-soft font-semibold text-foreground'

type Column = (typeof DESKTOP_COLUMNS)[number]
type Discipline = Pick<CompanyStatsTotals, 'absence' | 'single_punch' | 'late'>

function columnLabel(column: Column, t: TFunction): string {
  if (column === 'company') return t('companyStats.filters.company')
  if (column === 'score' || column === 'sickDays' || column === 'leaves') return t(`companyStats.ranking.${column}`)
  return t(`companyStats.metric.${column}`)
}

function RankingValue({ column, row, discipline, sorted, unit, t }: {
  column: Exclude<Column, 'score' | 'company'>
  row: CompanyStatsEmployee
  discipline: Discipline
  sorted: boolean
  unit: CountUnit
  t: TFunction
}) {
  const value = column === 'sickDays' ? row.sick_days
    : column === 'leaves' ? unit === 'days' ? row.leave_days : row.leave_count
      : disciplineValue(discipline, column, sorted && column === 'absence' ? 'days' : unit)
  const note = value > 0 && column === 'late' ? formatStatsDuration(row.late_minutes, t)
    : value > 0 && column === 'absence' && sorted ? formatStatsQuantity('episode', row.absence_episodes, t) : null
  return (
    <>
      <bdi dir="ltr" className={value === 0 ? 'text-muted-foreground' : undefined}>{formatStatsNumber(value)}</bdi>
      {note && <span className={NOTE}><bdi dir="auto">{note}</bdi></span>}
    </>
  )
}

function Score({ employee, maximum, t }: { employee: CompanyStatsEmployee; maximum: number; t: TFunction }) {
  const { tier, small_sample: smallSample, score } = employee
  const tone = STATUS_TOKENS[smallSample ? 'small' : tier === 'needs_intervention' ? 'bad' : tier === 'above_average' ? 'warn' : 'normal']
  const badge = smallSample ? t('companyStats.status.smallSample') : tier ? t(`companyStats.tier.${tier}`) : null
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_3ch] items-center gap-x-1.5 gap-y-1 md:grid-cols-[minmax(0,1fr)_3ch_minmax(0,8.5rem)]">
      <div aria-hidden="true" className="h-1 min-w-0 rounded-full bg-border">
        <div className="h-full rounded-full" style={{ inlineSize: `${score / maximum * 100}%`, backgroundColor: tone.bar }} />
      </div>
      <bdi dir="ltr" className={score === 0 ? 'text-muted-foreground' : undefined}>{formatStatsNumber(score)}</bdi>
      <div className="col-span-2 flex justify-end empty:hidden md:col-span-1 md:empty:block">
        {badge && <span className="rounded-full px-1.5 py-0.5 text-xs leading-snug font-semibold" style={{ color: tone.fg, backgroundColor: tone.soft }}>{badge}</span>}
      </div>
    </div>
  )
}

export function EmployeeRanking({ data, sort, onSortChange, unit, companyName }: Props) {
  const { t, i18n } = useTranslation()
  const { has } = useCapabilities()
  const canViewEmployee = has('employees.view')
  const mobile = useIsMobile()
  const titleId = useId()
  const title = t('companyStats.ranking.title')
  const language = i18n.language
  const columns = mobile ? [sort, ...METRIC_COLUMNS.filter((column) => column !== sort)] : DESKTOP_COLUMNS
  const employeeWidth = 'min(158px, 44vw)'
  const scoreWidth = mobile ? 'clamp(145px, 47vw, 185px)' : 296
  const { ranking } = data
  const byId = new Map<string, CompanyStatsEmployee>()
  let maximum = 1
  for (const employee of ranking.rows) {
    byId.set(employee.employee_id, employee)
    maximum = Math.max(maximum, employee.score)
  }
  const ordered = []
  for (const id of ranking.order[sort]) {
    const employee = byId.get(id)
    if (employee) ordered.push(employee)
  }

  return (
    <section aria-labelledby={titleId} className="min-w-0">
      <header className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <h2 id={titleId} className="flex items-baseline gap-2 text-base font-bold">
          <bdi dir="ltr" aria-hidden="true" className="text-xs text-muted-foreground">05</bdi>{title}
        </h2>
        <span aria-hidden="true" className="min-w-4 flex-1 border-t" />
        <div className="basis-full md:basis-auto">
          <div role="group" aria-label={t('companyStats.ranking.sort')} className="inline-flex max-w-full flex-wrap items-stretch gap-0.5 rounded-md border bg-surface-tinted p-0.5">
            {RANKING_SORTS.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={option === sort}
                onClick={() => onSortChange(option)}
                className="min-h-[44px] min-w-[44px] cursor-pointer rounded-sm px-2 text-xs text-muted-foreground hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring aria-pressed:bg-surface aria-pressed:font-semibold aria-pressed:text-primary-text md:min-h-8"
              >
                {columnLabel(option, t)}
              </button>
            ))}
          </div>
        </div>
      </header>
      <p className="mb-2 text-xs text-muted-foreground">
        {companyName !== null && (
          <><Trans i18nKey="companyStats.ranking.scope" components={{ company: <bdi dir="auto">{companyName}</bdi> }} /> · </>
        )}
        <Trans
          i18nKey="companyStats.ranking.summary"
          count={ranking.total}
          values={{ shown: formatStatsNumber(ordered.length), total: formatStatsNumber(ranking.total), average: formatStatsNumber(ranking.average_score, 1) }}
          components={{ number: <bdi dir="ltr" className="tabular-nums" /> }}
        />
      </p>
      {ordered.length === 0 ? (
        <p className="rounded-md border bg-surface p-3.5 text-sm text-muted-foreground">{t('companyStats.ranking.empty')}</p>
      ) : (
        <>
          <p className="mb-1.5 text-xs text-muted-foreground xl:hidden">{t('companyStats.comparison.scrollHint')}</p>
          <div
            key={mobile ? sort : 'wide'}
            tabIndex={0}
            role="region"
            aria-labelledby={titleId}
            className="overflow-x-auto rounded-md border bg-surface [scrollbar-color:var(--border-strong)_var(--surface)] [scrollbar-width:thin] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
          >
            <table
              className="w-full table-fixed border-separate border-spacing-0 text-sm tabular-nums"
              style={{ minWidth: mobile ? `calc(${employeeWidth} + ${scoreWidth} + ${4 * 88 + 116}px)` : 1040 }}
            >
              <caption className="sr-only">{title}{companyName !== null ? <> · <bdi dir="auto">{companyName}</bdi></> : null}</caption>
              <colgroup>
                <col style={mobile ? { inlineSize: employeeWidth } : undefined} />
                {columns.map((column) => <col key={column} style={{ inlineSize: column === 'score' ? scoreWidth : column === 'company' ? 160 : column === 'leaves' ? 116 : 88 }} />)}
              </colgroup>
              <thead>
                <tr>
                  <th scope="col" className={`${HEADER} ${FIRST} bg-surface-raised text-muted-foreground`}>{t('companyStats.ranking.employee')}</th>
                  {columns.map((column) => {
                    const sorted = sort === column
                    return (
                      <th key={column} scope="col" aria-sort={sorted ? 'descending' : undefined} className={`${HEADER} ${column === 'company' ? 'text-start' : 'text-end'} ${sorted ? SORTED : 'bg-surface-raised text-muted-foreground'}`}>
                        {columnLabel(column, t)}
                        {column === 'absence' && <span className={NOTE}>{t(sorted || unit === 'days' ? 'companyStats.unit.days' : 'companyStats.ranking.episodes')}</span>}
                        {column === 'leaves' && <span className={NOTE}>{t(`companyStats.unit.${unit}`)} · {t('companyStats.ranking.allLeaveKinds')}</span>}
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {ordered.map((employee, index) => {
                  const name = localized(employee.name_ar, employee.name_en, language) || employee.employee_id
                  const position = localized(employee.position_ar, employee.position, language)
                  const company = companyDisplayName(employee.duty_unit, t)
                  const shift = employee.shift_code ? t(`attendance.shift.${employee.shift_code}`, employee.shift_code) : null
                  const transfer = employee.transfer
                  const movedOut = transfer?.from_unit === employee.duty_unit
                  const discipline = {
                    absence: { days: employee.absence_days, episodes: employee.absence_episodes },
                    single_punch: employee.single_punch,
                    late: { count: employee.late_count, minutes: employee.late_minutes },
                  }
                  return (
                    <tr key={employee.employee_id} className="last:[&>*]:border-b-0">
                      <th scope="row" className={`${FIRST} border-b bg-surface font-medium align-middle`}>
                        <div className="flex items-start gap-1.5">
                          <bdi dir="ltr" className="min-w-[2ch] self-center text-xs font-semibold text-muted-foreground">{formatStatsNumber(index + 1)}</bdi>
                          <span aria-hidden="true" className="mt-0.5 hidden size-7 shrink-0 place-items-center rounded-full bg-primary-soft text-xs font-semibold text-primary-text md:grid">{String.fromCodePoint(name.codePointAt(0) ?? 0x2014)}</span>
                          <div className="min-w-0 break-words">
                            {canViewEmployee ? (
                              <Link
                                to={`/employees/${encodeURIComponent(employee.employee_id)}?tab=attendance`}
                                className="font-semibold text-primary-text underline underline-offset-2 after:absolute after:inset-0 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-ring md:no-underline md:after:hidden"
                              >
                                <bdi dir="auto">{name}</bdi><ExternalLink aria-hidden="true" className="ms-1 hidden size-3 align-middle md:inline rtl:-scale-x-100" />
                              </Link>
                            ) : <bdi dir="auto" className="font-semibold">{name}</bdi>}
                            <span className={NOTE}><bdi dir="ltr">{employee.employee_id}</bdi>{position && <> · <bdi dir="auto">{position}</bdi></>}</span>
                            {mobile && <span className={NOTE}><bdi dir="auto">{company}</bdi>{shift && <> · <bdi dir="auto">{shift}</bdi></>}</span>}
                            {transfer && (
                              <span className="mt-0.5 block w-fit rounded-sm bg-surface-tinted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
                                <Trans
                                  i18nKey={movedOut ? 'companyStats.ranking.transferTo' : 'companyStats.ranking.transferFrom'}
                                  components={{
                                    company: <bdi dir="auto">{companyDisplayName(movedOut ? transfer.to_unit : transfer.from_unit, t)}</bdi>,
                                    date: <time dateTime={transfer.on_date}>{formatStatsDate(transfer.on_date, language, false)}</time>,
                                  }}
                                />
                              </span>
                            )}
                          </div>
                        </div>
                      </th>
                      {columns.map((column) => (
                        <td key={column} className={`border-b px-2 py-2 align-middle ${column === 'company' ? 'text-start' : 'text-end'} ${sort === column ? SORTED : ''}`}>
                          {column === 'company' ? <><bdi dir="auto">{company}</bdi>{shift && <span className={NOTE}><bdi dir="auto">{shift}</bdi></span>}</>
                            : column === 'score' ? <Score employee={employee} maximum={maximum} t={t} />
                              : <RankingValue column={column} row={employee} discipline={discipline} sorted={sort === column} unit={unit} t={t} />}
                        </td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
      <footer className="mt-4 flex flex-wrap justify-between gap-x-4 gap-y-2 border-t pt-3 text-xs text-muted-foreground">
        <p>{t('companyStats.ranking.formula')}</p>
        <p>{t('companyStats.ranking.method')}</p>
      </footer>
    </section>
  )
}
