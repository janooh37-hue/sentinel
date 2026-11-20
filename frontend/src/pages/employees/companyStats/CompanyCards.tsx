import { useId, useRef } from 'react'
import { Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import type { CompanyStatsRow } from '@/lib/api'

import { companyDisplayName, formatStatsNumber, formatStatsPercent, formatStatsQuantity } from './companyStatsFormat'
import { absenceRateFill, absenceRateScale, DISCIPLINE_METRICS, disciplineValue, STATUS_TOKENS, type CountUnit, type StatusTone } from './companyStatsModel'

interface Props {
  companies: CompanyStatsRow[]
  unit: CountUnit
  selected: string | null
  onSelect(key: string | null): void
}

function CompanyCard({ row, unit, rateMax, selected, selectedCard, onSelect }: {
  row: CompanyStatsRow
  unit: CountUnit
  rateMax: number
  selected: boolean
  selectedCard: React.Ref<HTMLButtonElement>
  onSelect(key: string | null): void
}) {
  const { t } = useTranslation()
  const id = useId()
  const { totals } = row
  const tone: StatusTone | null = row.small_sample ? 'small' : row.status.overall
  const driver = tone === null || tone === 'small' ? null : DISCIPLINE_METRICS.reduce((worst, metric) =>
    (row.ratio[metric] ?? -1) > (row.ratio[worst] ?? -1) ? metric : worst,
  )
  const colors = STATUS_TOKENS[tone ?? 'normal']
  const roster = row.shift_codes.includes('office_day') ? t('companyStats.companies.officeRoster')
    : row.shift_codes.length ? t('companyStats.companies.shiftRoster') : null
  const absenceRate = totals.absence_rate
  const rateWidth = absenceRateFill(absenceRate, rateMax)

  return (
    <button
      ref={selected ? selectedCard : undefined}
      type="button"
      aria-pressed={selected}
      aria-labelledby={`${id}-name`}
      aria-describedby={`${id}-meta ${id}-status ${id}-rate ${id}-figures`}
      onClick={() => onSelect(selected ? null : row.key)}
      className={`flex min-w-0 flex-col items-stretch rounded-md border bg-surface p-2.5 text-start ring-inset transition-colors focus-visible:outline-none! focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none ${selected ? 'ring-1 ring-ring' : 'hover:ring-1 hover:ring-ring/60'}`}
      style={selected ? { borderColor: 'var(--primary)' } : undefined}
    >
      <span id={`${id}-name`} className="flex items-start justify-between gap-1 text-sm font-bold">
        <bdi className="min-w-0 [overflow-wrap:anywhere]">{companyDisplayName(row.key, t)}</bdi>
        {selected && <Check aria-hidden="true" className="size-4 shrink-0 text-primary-text" />}
      </span>
      <span id={`${id}-meta`} className="mb-1.5 mt-0.5 text-xs leading-snug text-muted-foreground">
        <bdi>{formatStatsQuantity('person', totals.strength, t)}</bdi>{roster && <> · {roster}</>}
      </span>
      <span
        id={`${id}-status`}
        className="mb-1.5 w-fit max-w-full rounded-full px-1.5 py-0.5 text-xs font-semibold leading-snug"
        style={{ color: colors.fg, backgroundColor: colors.soft }}
      >
        {t(`companyStats.status.${tone === 'small' ? 'smallSample' : tone ?? 'unknown'}`)}
        {driver !== null && <span> · {t(`companyStats.metric.${driver}`)}</span>}
      </span>
      <span id={`${id}-rate`} className="mt-auto flex flex-wrap items-baseline gap-x-1.5">
        <strong className="text-xl leading-tight text-foreground">
          {absenceRate === null ? (
            <><span aria-hidden="true">—</span><span className="sr-only">{t('companyStats.companies.noDuties')}</span></>
          ) : <bdi dir="ltr" className="tabular-nums">{formatStatsPercent(absenceRate, 1)}</bdi>}
        </strong>
        <span className="text-xs text-muted-foreground">{t('companyStats.companies.rate')}</span>
      </span>
      <span aria-hidden="true" className="mb-2 mt-1 block h-1 overflow-hidden rounded-full bg-border">
        <span className="block h-full rounded-full bg-muted-foreground" style={{ inlineSize: `${rateWidth}%` }} />
      </span>
      <span id={`${id}-figures`} className="grid grid-cols-3 items-start gap-x-1 border-t pt-1.5 text-center" style={{ borderColor: 'var(--hairline)' }}>
        {DISCIPLINE_METRICS.map((metric) => {
          const status = row.small_sample ? 'small' : row.status[metric] ?? 'normal'
          return (
            <span key={metric} className="flex min-w-0 flex-col gap-0.5">
              <strong className="text-sm leading-none" style={{ color: STATUS_TOKENS[status].fg }}>
                <bdi dir="ltr" className="tabular-nums">{formatStatsNumber(disciplineValue(totals, metric, unit))}</bdi>
              </strong>
              <span className="text-xs leading-tight text-muted-foreground">{t(`companyStats.metric.${metric}`)}</span>
            </span>
          )
        })}
      </span>
    </button>
  )
}

export function CompanyCards({ companies, unit, selected, onSelect }: Props): React.JSX.Element {
  const { t } = useTranslation()
  const heading = useId()
  const selectedCard = useRef<HTMLButtonElement>(null)
  const rateMax = absenceRateScale(companies)
  return (
    <section aria-labelledby={heading} className="min-w-0">
      <div className="mb-2.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id={heading} className="flex items-baseline gap-2 text-base font-bold">
          <bdi dir="ltr" className="text-xs font-semibold text-muted-foreground" aria-hidden="true">02</bdi>
          {t('companyStats.companies.title')}
        </h2>
        <span className="self-center border-t" style={{ flex: '1 1 1rem' }} aria-hidden="true" />
        <div className="flex basis-full flex-wrap items-center gap-x-2.5 gap-y-1 sm:basis-auto">
          {companies.length > 0 && <p className="text-xs text-muted-foreground">{t('companyStats.companies.select')}</p>}
          {selected !== null && (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="min-h-[44px] bg-primary-soft text-primary-text focus-visible:outline-none! focus-visible:ring-inset focus-visible:ring-offset-0 lg:min-h-0"
              onClick={() => {
                selectedCard.current?.focus()
                onSelect(null)
              }}
            >
              {t('companyStats.companies.showAll')}
            </Button>
          )}
        </div>
      </div>
      {companies.length === 0 ? (
        <p className="rounded-md border bg-surface p-3.5 text-sm text-muted-foreground">{t('companyStats.companies.empty')}</p>
      ) : (
        <div className={`grid gap-2.5 min-[360px]:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 ${companies.length > 8 ? 'xl:grid-cols-5' : ''}`}>
          {companies.map((row) => (
            <CompanyCard key={row.key} row={row} unit={unit} rateMax={rateMax} selected={row.key === selected} selectedCard={selectedCard} onSelect={onSelect} />
          ))}
        </div>
      )}
    </section>
  )
}
