import { useTranslation } from 'react-i18next'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import { ACTIVITY_PRESETS, formatStatementRange, type ActivityPreset, type Period } from '../statement/statementModel'

interface Props {
  period: Period
  preset: ActivityPreset
  /** Raw custom bounds as typed; may be incomplete while the operator is editing. */
  customFrom: string
  customTo: string
  onPreset: (preset: ActivityPreset) => void
  onCustom: (from: string, to: string) => void
  language: string
}

export function ActivityPeriodHeader({
  period,
  preset,
  customFrom,
  customTo,
  onPreset,
  onCustom,
  language,
}: Props): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <p className="text-xs font-medium text-muted-foreground">{t('activityStatement.title')}</p>
        <h2 className="text-2xl font-semibold tracking-tight text-foreground" data-testid="activity-period-range">
          {formatStatementRange(period.from, period.to, language, t('activityStatement.startOfRecord'))}
        </h2>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="activity-period">{t('activityStatement.periodLabel')}</Label>
          <select
            id="activity-period"
            value={preset}
            onChange={(event) => onPreset(event.target.value as ActivityPreset)}
            className="h-10 rounded-xl border border-border bg-surface px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {ACTIVITY_PRESETS.map((value) => (
              <option key={value} value={value}>
                {t(`statement.period.${value}`)}
              </option>
            ))}
          </select>
        </div>
        {preset === 'custom' ? (
          <>
            <div className="space-y-1">
              <Label htmlFor="activity-from">{t('activityStatement.from')}</Label>
              <Input
                id="activity-from"
                type="date"
                dir="ltr"
                value={customFrom}
                max={customTo || undefined}
                onChange={(event) => onCustom(event.target.value, customTo)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="activity-to">{t('activityStatement.to')}</Label>
              <Input
                id="activity-to"
                type="date"
                dir="ltr"
                value={customTo}
                min={customFrom || undefined}
                onChange={(event) => onCustom(customFrom, event.target.value)}
              />
            </div>
          </>
        ) : null}
      </div>
    </header>
  )
}

