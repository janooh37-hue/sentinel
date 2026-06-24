/**
 * UnitRail — the left rail of unit buttons with headcounts.
 *
 * On wide screens it is a vertical list; on ≤720px the parent collapses it to a
 * horizontal scrolling chip-strip (see DutyLocationsPage responsive layout).
 * The Unassigned bucket renders last and is visually muted.
 */

import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'
import { UNASSIGNED } from '@/lib/dutyUnits'

export interface UnitRailItem {
  key: string
  /** Localized label (the unit's Arabic string, or "Unassigned"). */
  label: string
  count: number
}

export interface UnitRailProps {
  units: readonly UnitRailItem[]
  activeKey: string
  totalAssigned: number
  totalEmployees: number
  unassignedCount: number
  onSelect: (key: string) => void
}

export function UnitRail({
  units,
  activeKey,
  totalAssigned,
  totalEmployees,
  unassignedCount,
  onSelect,
}: UnitRailProps): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <nav className="border-b border-hairline bg-surface-raised p-2.5 md:border-b-0 md:border-e">
      <h2 className="mx-2 mb-2.5 mt-1.5 text-[0.69em] font-bold uppercase tracking-[0.12em] text-faint">
        {t('dutyLocations.rail.units')}
      </h2>

      {/* Vertical list (wide) / horizontal chip-strip (≤720px via flex + scroll) */}
      <div className="flex gap-2 overflow-x-auto md:flex-col md:gap-0.5 md:overflow-visible">
        {units.map((u) => {
          const active = u.key === activeKey
          return (
            <button
              key={u.key}
              type="button"
              onClick={() => onSelect(u.key)}
              className={cn(
                'flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2.5 text-start text-sm transition-colors md:w-full md:shrink',
                active
                  ? 'bg-primary text-primary-foreground'
                  : 'text-foreground hover:bg-surface-tinted',
                u.key === UNASSIGNED && !active && 'text-muted-foreground',
              )}
              aria-pressed={active}
            >
              <span className="flex-1 truncate font-semibold" dir="auto">
                {u.label}
              </span>
              <span
                className={cn(
                  'min-w-[24px] rounded-full px-2 py-px text-center font-mono text-xs tabular-nums',
                  active
                    ? 'bg-white/20 text-primary-foreground'
                    : 'bg-surface-tinted text-muted-foreground',
                )}
              >
                {u.count}
              </span>
            </button>
          )
        })}
      </div>

      <div className="mx-2 mt-3 border-t border-dashed border-border pt-2.5 text-xs text-muted-foreground">
        {t('dutyLocations.rail.totalAssigned', {
          assigned: totalAssigned,
          total: totalEmployees,
        })}
      </div>
      <div className="mx-2 pt-0.5 text-xs text-faint">
        {t('dutyLocations.rail.unassignedCount', { count: unassignedCount })}
      </div>
    </nav>
  )
}
