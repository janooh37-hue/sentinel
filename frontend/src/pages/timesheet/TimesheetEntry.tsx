/**
 * The monthly time sheet's entry point — a strip inside Employees, not a top-nav
 * destination.
 *
 * Same call as the scan-back queue (see the comment in
 * `components/shell/navItems.ts`): two workbooks produced once a month is an
 * Employees chore, and one monthly chore is a task line, not an eighth place to
 * go. `NAV_ITEMS` keeps its seven entries; the label lives under the `timesheet`
 * namespace with every other string for this feature, so there is no `nav.*` key
 * either. Please do not "fix" the omission by adding one.
 *
 * Gated on `timesheet.view` through `CapabilityGate`, so an operator without the
 * capability never sees a link that would bounce them, and the strip is also
 * safe to render in a unit test with no `AuthProvider` above it.
 */

import { CalendarClock, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { CapabilityGate } from '@/components/shell/CapabilityGate'

export function TimesheetEntry(): React.JSX.Element {
  const { t } = useTranslation()
  const navigate = useNavigate()

  return (
    <CapabilityGate cap="timesheet.view">
      <div className="mx-auto w-full max-w-[1180px] px-4 pt-5 md:px-8">
        <button
          type="button"
          onClick={() => navigate('/employees/timesheet')}
          className="flex w-full items-center gap-2.5 rounded-2xl border border-hairline bg-surface px-3.5 py-2.5 text-start transition-colors hover:border-primary/50 hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <CalendarClock className="h-4 w-4 shrink-0 text-primary" strokeWidth={2} aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[0.82em] font-semibold text-foreground">
              {t('timesheet.entry.label')}
            </span>
            <span className="block truncate text-[0.75em] text-muted-foreground">
              {t('timesheet.entry.hint')}
            </span>
          </span>
          <ChevronRight
            className="h-4 w-4 shrink-0 text-muted-foreground rtl:rotate-180"
            strokeWidth={2}
            aria-hidden
          />
        </button>
      </div>
    </CapabilityGate>
  )
}
