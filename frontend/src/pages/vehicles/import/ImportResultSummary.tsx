import { CheckCircle2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import type { VehicleImportCounts, VehicleImportResult } from '@/lib/api'

import { formatNumber } from '../vehicleUtils'

const PREVIEW_COUNT_KEYS: readonly (keyof VehicleImportCounts)[] = [
  'create',
  'update',
  'unchanged',
  'invalid',
  'archived',
  'excluded',
]

export function ImportPreviewCounts({ counts }: { counts: VehicleImportCounts }): React.JSX.Element {
  const { t, i18n } = useTranslation()
  return (
    <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-6">
      {PREVIEW_COUNT_KEYS.map((key) => (
        <div key={key} className="bg-surface px-3 py-2 text-center">
          <dt className="text-[0.7em] font-medium text-muted-foreground">
            {t(`vehicles.import.counts.${key}`)}
          </dt>
          <dd className="mt-0.5 font-mono text-lg font-bold tabular-nums text-foreground">
            {formatNumber(counts[key], i18n.language)}
          </dd>
        </div>
      ))}
    </dl>
  )
}

export function ImportResultSummary({
  result,
  onRestart,
}: {
  result: VehicleImportResult
  onRestart: () => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const counts = [
    ['created', result.created],
    ['updated', result.updated],
    ['unchanged', result.unchanged],
    ['images_added', result.images_added],
    ['images_skipped', result.images_skipped],
  ] as const

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 items-center px-4 py-10 md:px-6">
      <Card className="w-full overflow-hidden">
        <CardContent className="p-0">
          <div className="flex flex-col items-center border-b border-hairline bg-success-soft px-6 py-8 text-center">
            <CheckCircle2 className="h-10 w-10 text-success" strokeWidth={1.6} aria-hidden />
            <h2 className="mt-3 text-xl font-bold tracking-tight text-foreground">
              {t('vehicles.import.resultTitle')}
            </h2>
            <p className="mt-1 max-w-lg text-sm text-muted-foreground">
              {t('vehicles.import.resultDescription')}
            </p>
          </div>
          <dl className="grid grid-cols-2 gap-px bg-border sm:grid-cols-5">
            {counts.map(([key, value]) => (
              <div key={key} className="bg-surface px-4 py-4 text-center">
                <dt className="text-xs text-muted-foreground">
                  {t(`vehicles.import.result.${key}`)}
                </dt>
                <dd className="mt-1 font-mono text-xl font-bold tabular-nums text-foreground">
                  {formatNumber(value, i18n.language)}
                </dd>
              </div>
            ))}
          </dl>
          {result.vehicle_ids.length > 0 ? (
            <div className="border-t border-hairline px-6 py-4">
              <h3 className="text-sm font-semibold text-foreground">
                {t('vehicles.import.result.affectedVehicles')}
              </h3>
              <ul className="mt-2 flex flex-wrap gap-2">
                {result.vehicle_ids.map((vehicleId, index) => (
                  <li key={`${vehicleId}-${index}`}>
                    <Link
                      to={`/vehicles/${vehicleId}`}
                      className="inline-flex rounded-md border border-border bg-surface-raised px-3 py-2 text-xs font-semibold text-primary hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {t('vehicles.import.result.openVehicle', {
                        id: formatNumber(vehicleId, i18n.language),
                      })}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="flex flex-wrap justify-center gap-2 border-t border-hairline px-6 py-5">
            <Button type="button" variant="secondary" onClick={onRestart}>
              {t('vehicles.import.importAnother')}
            </Button>
            <Link
              to="/vehicles"
              className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {t('vehicles.import.backToVehicles')}
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
