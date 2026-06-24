/**
 * Slim 4-metric strip above the master/detail. Single row, ~64px tall.
 *
 * Values are derived from the list response (total, status counts) so the
 * strip never makes its own API calls — keeping payloads predictable for
 * Phase 03. Phase 08 introduces a real dashboard surface; the placeholder
 * metrics here are intentionally minimal.
 */

import type { LucideIcon } from 'lucide-react'
import { AlertTriangle, PauseCircle, UserCheck, Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { EmployeeListResponse } from '@/lib/api'

interface KpiProps {
  list: EmployeeListResponse | undefined
}

interface Tile {
  label: string
  value: string | number
  Icon: LucideIcon
  tone?: 'default' | 'danger'
  hint?: string
}

export function KpiStrip({ list }: KpiProps): React.JSX.Element {
  const { t } = useTranslation()

  const total = list?.total ?? 0
  const items = list?.items ?? []
  const resigned = items.filter((e) => e.status === 'Resigned').length
  const terminated = items.filter((e) => e.status === 'Terminated').length

  const active = items.filter((e) => e.status === 'Active').length
  const tiles: Tile[] = [
    {
      label: t('employees.kpi.total'),
      value: total,
      Icon: Users,
    },
    {
      label: t('employees.kpi.active'),
      value: active,
      Icon: UserCheck,
    },
    {
      label: t('employees.kpi.resigned'),
      value: resigned,
      Icon: PauseCircle,
    },
    {
      label: t('employees.kpi.terminated'),
      value: terminated,
      Icon: AlertTriangle,
      tone: terminated > 0 ? 'danger' : 'default',
    },
  ]

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {tiles.map((tile) => (
        <Tile key={tile.label} tile={tile} />
      ))}
    </div>
  )
}

function Tile({ tile }: { tile: Tile }): React.JSX.Element {
  return (
    <div className="flex items-center justify-between rounded-md border border-border bg-surface px-4 py-3">
      <div>
        <div className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
          {tile.label}
        </div>
        <div className="mt-1 flex items-baseline gap-1.5">
          <span
            className={
              tile.tone === 'danger'
                ? 'font-mono text-xl font-semibold leading-none text-destructive'
                : 'font-mono text-xl font-semibold leading-none text-foreground'
            }
          >
            {tile.value}
          </span>
          {tile.hint && (
            <span className="text-xs text-muted-foreground">{tile.hint}</span>
          )}
        </div>
      </div>
      <tile.Icon
        className={
          tile.tone === 'danger'
            ? 'h-5 w-5 text-destructive'
            : 'h-5 w-5 text-muted-foreground'
        }
        strokeWidth={1.6}
      />
    </div>
  )
}
