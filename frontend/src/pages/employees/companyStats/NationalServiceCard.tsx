import { useId } from 'react'
import { Trans, useTranslation } from 'react-i18next'

import type { CompanyStats } from '@/lib/api'
import { localized } from '@/lib/language'

import { companyDisplayName, formatStatsDate, formatStatsNumber, formatStatsQuantity } from './companyStatsFormat'

export function NationalServiceCard({ data }: { data: CompanyStats }) {
  const { t, i18n } = useTranslation()
  const titleId = useId()
  const { enrolled, absence_days } = data.national_service
  const language = i18n.language

  return (
    <article aria-labelledby={titleId} className={`flex min-w-0 flex-col gap-2 rounded-md border bg-surface p-3.5 ${enrolled.length < 2 ? 'self-start' : 'self-stretch'}`}>
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 id={titleId} className="flex items-center gap-1.5 text-sm font-semibold">
          <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-smart" />
          {t('companyStats.leaves.national_service')}
        </h3>
        <p className="text-xs text-muted-foreground">
          <Trans
            i18nKey="companyStats.nationalService.enrolled"
            values={{ number: formatStatsNumber(enrolled.length) }}
            components={{ number: <bdi dir="ltr" className="tabular-nums" /> }}
          />
        </p>
      </header>
      {enrolled.length === 0 ? (
        <p className="py-3 text-sm text-muted-foreground">{t('companyStats.nationalService.empty')}</p>
      ) : (
        <ol role="list" className="divide-y">
          {enrolled.map((employee) => {
            const name = localized(employee.name_ar, employee.name_en, language) || employee.employee_id
            const progress = employee.progress * 100
            return (
              <li key={employee.employee_id} className="grid gap-1.5 py-2">
                <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
                  <strong className="text-sm"><bdi dir="auto">{name}</bdi></strong>
                  <span className="text-xs font-semibold text-smart">
                    <Trans
                      i18nKey="companyStats.nationalService.remaining"
                      values={{ days: formatStatsQuantity('day', employee.days_remaining, t) }}
                      components={{ days: <bdi dir="auto" /> }}
                    />
                  </span>
                </div>
                <div
                  role="progressbar"
                  aria-label={t('companyStats.nationalService.progress', { name })}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(progress)}
                  className="h-1 overflow-hidden rounded-full bg-smart-soft"
                >
                  <span aria-hidden="true" className="block h-full rounded-full bg-smart" style={{ inlineSize: `${progress}%` }} />
                </div>
                <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <bdi dir="auto">{companyDisplayName(employee.duty_unit, t)}</bdi>
                  <span>
                    <Trans
                      i18nKey="companyStats.nationalService.returns"
                      values={{ date: formatStatsDate(employee.return_date, language) }}
                      components={{ date: <time dateTime={employee.return_date} /> }}
                    />
                  </span>
                </div>
              </li>
            )
          })}
        </ol>
      )}
      <p className="mt-auto flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1 rounded-sm bg-smart-soft px-2 py-1.5 text-xs text-smart">
        <span>{t('companyStats.nationalService.absenceDays')}</span>
        <strong className="text-sm tabular-nums"><bdi dir="ltr">{formatStatsNumber(absence_days)}</bdi></strong>
      </p>
    </article>
  )
}
