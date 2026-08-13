/**
 * SelectionTray — the sticky bar for the roster selection plus an expandable
 * review panel.
 *
 * The selection is a transfer basket that spans duty units: the operator ticks
 * people in one unit, walks the rail, and keeps ticking. Earlier picks are then
 * off-screen, so the panel lists everyone currently selected — grouped by their
 * CURRENT unit — and lets them be dropped without navigating back.
 *
 * Selection state is owned by DutyLocationsPage; this component renders it and
 * reports intent.
 */

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronUp, X } from 'lucide-react'

import type { EmployeeListItem } from '@/lib/api'
import { UNASSIGNED, groupByUnit } from '@/lib/dutyUnits'
import { pickEmployeeName } from '@/lib/employeeName'
import { cn } from '@/lib/utils'

export interface SelectionTrayProps {
  /** The resolved selection — may span any number of duty units. */
  employees: readonly EmployeeListItem[]
  onRemove: (id: string) => void
  onClear: () => void
  onTransfer: () => void
}

export function SelectionTray({
  employees,
  onRemove,
  onClear,
  onTransfer,
}: SelectionTrayProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useState(false)

  // Esc collapses the panel. It never clears the basket — that's what Clear is
  // for, and losing a cross-unit selection to a stray keypress would hurt.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  // Seed-first unit order, Unassigned last — the same grouping the roster uses.
  const grouped = groupByUnit(employees)

  return (
    <div className="fixed inset-x-0 bottom-0 z-40">
      {open && (
        <div
          id="duty-selection-panel"
          data-testid="duty-selection-panel"
          className="max-h-[45vh] overflow-y-auto border-t border-border bg-surface shadow-lg"
        >
          {/* Inner column matches the page container so the tray lines up with
              the roster card instead of drifting to the window edges. */}
          <div className="mx-auto w-full max-w-[1240px]">
            <div className="sticky top-0 border-b border-hairline bg-surface px-4 py-2.5 text-[0.78em] font-semibold uppercase tracking-[0.08em] text-muted-foreground sm:px-6">
              {t('dutyLocations.selection.trayTitle')}
            </div>
            {[...grouped.entries()].map(([unit, posts]) => (
              <div key={unit} className="py-1">
                {/* dir="auto" belongs on the inline span, not the block: on the
                    block an Arabic unit name would flip the heading's alignment
                    away from the rows it labels in an LTR page. */}
                <div className="px-4 pb-0.5 pt-2 sm:px-6">
                  <span className="text-[0.8em] font-bold text-primary" dir="auto">
                    {unit === UNASSIGNED ? t('dutyLocations.unassigned') : unit}
                  </span>
                </div>
                {[...posts.values()].flat().map((e) => {
                  const name = pickEmployeeName(e, i18n.language)
                  return (
                    <div
                      key={e.id}
                      className="flex items-center gap-2.5 px-4 py-1.5 text-[0.88em] hover:bg-surface-tinted sm:px-6"
                    >
                      <span className="font-mono font-semibold text-primary">{e.id}</span>
                      <span dir="auto">{name}</span>
                      {e.duty_post && (
                        <span className="text-[0.85em] text-faint" dir="auto">
                          {e.duty_post}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => onRemove(e.id)}
                        aria-label={t('dutyLocations.selection.remove', { name })}
                        className="ms-auto rounded-md p-1 text-faint hover:bg-accent-soft hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                      >
                        <X className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="border-t border-primary/40 bg-primary px-4 py-3 text-primary-foreground shadow-lg sm:px-6">
        <div className="mx-auto flex w-full max-w-[1240px] flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="duty-selection-panel"
            title={t('dutyLocations.selection.trayToggle')}
            className="inline-flex items-center gap-2 rounded-md border border-white/40 px-3 py-1.5 font-semibold hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
          >
            <ChevronUp
              className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')}
              aria-hidden
            />
            {t('dutyLocations.selection.count', { count: employees.length })}
            <span className="text-[0.82em] font-normal opacity-90">
              · {t('dutyLocations.selection.units', { count: grouped.size })}
            </span>
          </button>
          <button
            type="button"
            onClick={onClear}
            className="inline-flex items-center gap-1 rounded-md border border-white/40 px-3 py-1.5 text-sm font-medium hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
            {t('dutyLocations.selection.clear')}
          </button>
          <button
            type="button"
            onClick={onTransfer}
            className="ms-auto rounded-md bg-white px-4 py-1.5 text-sm font-semibold text-primary hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
          >
            {t('dutyLocations.selection.transfer')}
          </button>
        </div>
      </div>
    </div>
  )
}
