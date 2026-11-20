import { useEffect, useId, useState } from 'react'
import { flushSync } from 'react-dom'
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { EmployeesSectionTabs } from '@/components/employees/EmployeesSectionTabs'
import { siteToday, useAttendanceAttention } from '@/components/employees/useAttendanceAttention'
import { Button } from '@/components/ui/button'
import { api, apiErrorMessage, type CompanyStats, type CompanyStatsParams } from '@/lib/api'
import { toast } from '@/lib/toast'

import { CompanyCards } from './CompanyCards'
import { CompanyComparisonTable } from './CompanyComparisonTable'
import { companyDisplayName, formatStatsDate, formatStatsQuantity } from './companyStatsFormat'
import { addDays, COUNT_UNITS, PERIOD_PRESETS, type CountUnit, type RankingSort } from './companyStatsModel'
import { CompanyStatsPrintSheet } from './CompanyStatsPrintSheet'
import { CompanyStatsTrend } from './CompanyStatsTrend'
import { EmployeeRanking } from './EmployeeRanking'
import { NationalServiceCard } from './NationalServiceCard'
import { PeriodSummary, StatsPeriodLabel } from './PeriodSummary'
import { customRangeError, useCompanyStatsParams, type CompanyStatsFilters } from './useCompanyStatsParams'

type ExportParams = CompanyStatsParams & { language: 'ar' | 'en' }
type PrintJob = { data: CompanyStats; unit: CountUnit; sort: RankingSort }

const CONTROL = 'min-h-[44px] w-full min-w-0 rounded-sm border bg-surface px-2.5 text-sm focus-visible:outline-2 focus-visible:outline-ring lg:min-h-9'
const EXPORT_BUTTON = 'min-h-[44px] lg:min-h-9'

function SegmentedFilter<T extends string>({ label, choices, value, onChange, optionLabel, className }: {
  label: string
  choices: readonly T[]
  value: T
  onChange(value: T): void
  optionLabel(value: T): string
  className?: string
}) {
  return (
    <div className={`grid min-w-0 gap-1 lg:flex lg:items-center lg:gap-2 ${className ?? ''}`}>
      <span aria-hidden="true" className="whitespace-nowrap text-xs font-bold">{label}</span>
      <div role="group" aria-label={label} className="flex max-w-full flex-wrap items-stretch gap-0.5 rounded-md bg-surface-tinted p-0.5">
        {choices.map((choice) => (
          <button
            key={choice}
            type="button"
            aria-pressed={choice === value}
            onClick={() => onChange(choice)}
            className="min-h-[44px] min-w-[44px] flex-1 whitespace-nowrap rounded-sm px-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring aria-pressed:bg-surface aria-pressed:text-primary-text motion-reduce:transition-none lg:min-h-8 lg:min-w-0 lg:px-2.5"
          >
            {optionLabel(choice)}
          </button>
        ))}
      </div>
    </div>
  )
}

function CustomDates({ range, closedThrough, update }: Pick<CompanyStatsFilters, 'range' | 'update'> & { closedThrough: string }) {
  const { t, i18n } = useTranslation()
  const description = useId()
  const errorId = `${description}-error`
  const base = `${range.from}/${range.to}`
  const [draft, setDraft] = useState<{ base: string; dates: CompanyStatsFilters['range'] } | null>(null)
  const dates = draft?.base === base ? draft.dates : range
  const error = customRangeError(dates, closedThrough)

  const changeDate = (edge: 'from' | 'to', value: string): void => {
    if (value > closedThrough) return
    const next = { ...dates, [edge]: value }
    // Opening a future-ended deep link is allowed; a user edit adopts the closed end.
    if (next.to > closedThrough) next.to = closedThrough
    setDraft({ base, dates: next })
    // Keep partial or reversed edits local until both native date fields are valid.
    if (customRangeError(next, closedThrough) === null) update(next)
  }

  return (
    <div className="mt-2.5 grid grid-cols-2 gap-2.5 border-t pt-2.5 lg:flex lg:flex-wrap lg:items-center" style={{ borderColor: 'var(--hairline)' }}>
      {(['from', 'to'] as const).map((edge) => (
        <label key={edge} className="grid min-w-0 gap-1 lg:flex lg:items-center lg:gap-2">
          <span className="text-xs font-bold">{t(`companyStats.filters.${edge}`)}</span>
          <input
            type="date"
            dir="ltr"
            value={dates[edge]}
            max={closedThrough}
            required
            aria-describedby={error ? `${description} ${errorId}` : description}
            aria-invalid={error ? true : undefined}
            className={`${CONTROL} lg:w-36`}
            style={{ borderColor: error ? 'var(--accent)' : 'var(--border-strong)' }}
            onChange={(event) => changeDate(edge, event.currentTarget.value)}
          />
        </label>
      ))}
      <p id={description} className="col-span-2 text-xs text-muted-foreground">
        {t('companyStats.filters.closedThrough', { date: formatStatsDate(closedThrough, i18n.language) })}
      </p>
      {error && <p id={errorId} role="alert" className="col-span-2 text-xs font-semibold text-destructive-text">{t(`companyStats.filters.${error}`)}</p>}
    </div>
  )
}

function FilterBar({ filters, companies, closedThrough }: {
  filters: CompanyStatsFilters
  companies: CompanyStats['companies']
  closedThrough: string
}) {
  const { t } = useTranslation()
  const { preset, range, company, unit, update } = filters
  const showSelected = company !== null && !companies.some((row) => row.key === company)
  return (
    <div className="rounded-md border bg-surface px-2.5 py-2 lg:px-3">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-x-3 gap-y-2 lg:flex lg:flex-wrap lg:items-center lg:gap-x-5">
        <SegmentedFilter
          className="col-span-2"
          label={t('companyStats.filters.period')}
          choices={PERIOD_PRESETS}
          value={preset}
          onChange={(value) => update({ preset: value })}
          optionLabel={(value) => t(`companyStats.period.${value}`)}
        />
        <label className="grid min-w-0 gap-1 lg:flex lg:items-center lg:gap-2">
          <span className="text-xs font-bold">{t('companyStats.filters.company')}</span>
          <select
            value={company ?? ''}
            disabled={companies.length === 0 && company === null}
            onChange={(event) => update({ company: event.currentTarget.value || null })}
            className={`${CONTROL} disabled:opacity-60 lg:w-40`}
            style={{ borderColor: 'var(--border-strong)' }}
          >
            <option value="">{t('companyStats.filters.all')}</option>
            {showSelected && <option value={company} dir="auto">{companyDisplayName(company, t)}</option>}
            {companies.map(({ key }) => <option key={key} value={key} dir="auto">{companyDisplayName(key, t)}</option>)}
          </select>
        </label>
        <SegmentedFilter
          className="lg:ms-auto"
          label={t('companyStats.unit.label')}
          choices={COUNT_UNITS}
          value={unit}
          onChange={(value) => update({ unit: value })}
          optionLabel={(value) => t(`companyStats.unit.${value}`)}
        />
      </div>
      {preset === 'custom' && <CustomDates range={range} closedThrough={closedThrough} update={update} />}
    </div>
  )
}

async function downloadWorkbook(params: ExportParams): Promise<void> {
  const fallback = `company-statistics-${params.from_date}-${params.to_date}.xlsx`
  const { blob, filename } = await api.fetchCompanyStatsExport(params, fallback)
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.append(anchor)
  try {
    anchor.click()
  } finally {
    anchor.remove()
    // Give the browser a task to begin the download before releasing its URL.
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
}

export function CompanyStatsPage(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const trendHeading = useId()
  const today = siteToday()
  const filters = useCompanyStatsParams(today)
  const { range, company, unit, trend, sort, update } = filters
  const attention = useAttendanceAttention(today)
  const [printJob, setPrintJob] = useState<PrintJob | null>(null)

  const params: CompanyStatsParams = { from_date: range.from, to_date: range.to, ...(company !== null && { duty_unit: company }) }
  const query = useQuery({
    queryKey: ['company-stats', params],
    queryFn: () => api.getCompanyStats(params),
    // The company list is unfiltered. Keep it and the pressed card in the
    // DOM while loading a new scope; label the report with the loaded scope.
    placeholderData: keepPreviousData,
  })
  const { data } = query
  const download = useMutation({
    mutationFn: downloadWorkbook,
    onMutate: () => toast.loading(t('companyStats.export.downloading')),
    onSuccess: (_result, _vars, id) => toast.success(t('companyStats.export.downloaded'), { id }),
    onError: (error, _vars, id) => toast.error(apiErrorMessage(error), { id }),
  })
  useEffect(() => {
    const clearPrint = (): void => setPrintJob(null)
    window.addEventListener('afterprint', clearPrint)
    return () => window.removeEventListener('afterprint', clearPrint)
  }, [])

  const closedThrough = addDays(today, -1)
  const displayedCompany = data === undefined ? company : data.duty_unit
  const companyName = displayedCompany === null ? null : companyDisplayName(displayedCompany, t)
  const scope = companyName ?? t('companyStats.filters.all')
  const canExport = data !== undefined && !query.isPlaceholderData && !query.isError
  const current = data?.summary.current
  const empty = current?.duties_scheduled === 0 && !Object.values(current.leaves).some((leave) => leave.count > 0)
  const onSelectCompany = (next: string | null): void => update({ company: next })

  function requestPrint(): void {
    if (!canExport) return
    // Put the scope and paper in the DOM before the blocking print dialog.
    flushSync(() => setPrintJob({ data, unit, sort }))
    window.print()
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-auto bg-background">
      <div data-print-hide className="shrink-0 pt-1.5 text-white" style={{ background: 'var(--hero-grad)' }}>
        <EmployeesSectionTabs attentionCount={attention.attention} />
      </div>
      <div data-print-hide className="mx-auto w-full max-w-[1400px] px-4 pb-10 pt-4 md:px-8 md:pt-5">
        <header className="mb-3.5 flex flex-wrap items-end justify-between gap-x-5 gap-y-2.5">
          <div className="min-w-0" aria-live="polite" aria-atomic="true">
            <h1 className="text-[1.55em] font-bold leading-tight [overflow-wrap:anywhere] sm:text-[1.7em]">
              <bdi>{scope}</bdi>
            </h1>
            {data !== undefined && (
              <>
                <div className="mt-1 flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
                  <p className="text-sm font-semibold"><StatsPeriodLabel period={data.period} /></p>
                  <span className="text-xs text-muted-foreground">
                    <bdi>{formatStatsQuantity('day', data.period.days, t)}</bdi> · <bdi>{formatStatsQuantity('person', data.summary.current.strength, t)}</bdi>
                  </span>
                </div>
                {(data.period.clamped || data.summary.current.duties_pending > 0) && (
                  <div className="mt-0.5 flex flex-wrap gap-x-2.5 text-xs text-muted-foreground">
                    {data.period.clamped && <span>{t('companyStats.header.closedOnly')}</span>}
                    {data.summary.current.duties_pending > 0 && (
                      <span className="text-warning">{t('companyStats.header.pendingDuties', { duties: formatStatsQuantity('duty', data.summary.current.duties_pending, t) })}</span>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
          <div role="group" aria-label={t('companyStats.export.label')} className="flex items-center gap-1.5">
            <Button type="button" variant="secondary" size="sm" className={EXPORT_BUTTON} disabled={!canExport} onClick={requestPrint}>
              <Download aria-hidden="true" className="size-4" /> <bdi dir="ltr">{t('companyStats.export.pdf')}</bdi>
            </Button>
            <Button
              type="button"
              size="sm"
              className={EXPORT_BUTTON}
              disabled={!canExport || download.isPending}
              onClick={() => {
                if (!canExport) return
                download.mutate({
                  from_date: data.period.from_date, to_date: data.period.to_date,
                  ...(data.duty_unit !== null && { duty_unit: data.duty_unit }),
                  language: i18n.language.startsWith('ar') ? 'ar' : 'en',
                })
              }}
            >
              <Download aria-hidden="true" className="size-4" /> <bdi dir="ltr">{t('companyStats.export.excel')}</bdi>
            </Button>
          </div>
        </header>

        <FilterBar filters={filters} companies={data?.companies ?? []} closedThrough={closedThrough} />
        {query.isPending ? (
          <div role="status" className="mt-5 rounded-md border bg-surface p-4 text-sm text-muted-foreground">
            {t('companyStats.states.loading')}
            <div aria-hidden="true" className="mt-3 grid gap-2 lg:grid-cols-2">
              <div className="h-24 rounded-sm bg-surface-tinted" />
              <div className="h-24 rounded-sm bg-surface-tinted" />
            </div>
          </div>
        ) : query.isError ? (
          <div role="alert" className="mt-5 flex flex-wrap items-center gap-2.5 rounded-md border bg-surface p-4 text-sm text-destructive-text">
            <p>{t('companyStats.states.error')}</p>
            <Button type="button" variant="secondary" size="xs" className="min-h-[44px] lg:min-h-0" onClick={() => void query.refetch()}>
              {t('companyStats.states.retry')}
            </Button>
          </div>
        ) : data !== undefined && (
          <>
            {query.isPlaceholderData && <p role="status" className="sr-only">{t('companyStats.states.loading')}</p>}
            <div className="mt-5 grid min-w-0 gap-5 md:gap-6" aria-busy={query.isPlaceholderData}>
              {empty && <p className="rounded-md border bg-surface p-3.5 text-sm text-muted-foreground">{t('companyStats.states.empty')}</p>}
              <PeriodSummary data={data} unit={unit} />
              <CompanyCards companies={data.companies} unit={unit} selected={company} onSelect={onSelectCompany} />
              <section aria-labelledby={trendHeading} className="min-w-0">
                <div className="mb-2.5 flex items-center gap-3">
                  <h2 id={trendHeading} className="flex items-baseline gap-2 text-base font-bold">
                    <bdi dir="ltr" className="text-xs font-semibold text-muted-foreground" aria-hidden="true">03</bdi>
                    {t('companyStats.trend.title')}
                  </h2>
                  <span className="grow border-t" aria-hidden="true" />
                </div>
                <div className="grid min-w-0 items-start gap-3 lg:grid-cols-[minmax(0,2.15fr)_minmax(0,1fr)]">
                  <CompanyStatsTrend data={data} metric={trend} unit={unit} onMetricChange={(metric) => update({ trend: metric })} />
                  <NationalServiceCard data={data} />
                </div>
              </section>
              <CompanyComparisonTable data={data} unit={unit} selected={company} onSelect={onSelectCompany} />
              <EmployeeRanking data={data} sort={sort} onSortChange={(value) => update({ sort: value })} unit={unit} companyName={companyName} />
            </div>
          </>
        )}
      </div>
      {printJob && <CompanyStatsPrintSheet {...printJob} />}
    </div>
  )
}
