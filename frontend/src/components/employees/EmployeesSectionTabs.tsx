/**
 * EmployeesSectionTabs — the Employees section switcher.
 *
 * Rendered at the foot of the navy band by every page in the section —
 * Directory (`EmployeeLookupPage`), Attendance (`AttendancePage`), Organization
 * (`EmployeesOrgTreePage`) and the Time Sheet (`TimesheetPage`) — which is where
 * Sentinel already puts section switching. Deliberately not a top-nav
 * destination: the top nav is a single row at every width and its budget is
 * spent (see the tiers in index.css), and the mobile dock builds its catalogue
 * from NAV_ITEMS.
 *
 * Active state comes from `NavLink`, not from a prop: the route *is* the active
 * tab, and `NavLink` already owns both the styling hook and `aria-current`.
 *
 * The Attendance tab is capability-gated and carries the live count of rows
 * needing a decision, so a clean day shows no badge at all.
 *
 * One label per tab, in the active language only. Two tabs used to carry their
 * Arabic name beside the English one, which made a bidi hazard of every label
 * to supply a translation the language switch already gives.
 */

import { useTranslation } from 'react-i18next'
import { NavLink } from 'react-router-dom'

import { useCapabilities } from '@/lib/useCapabilities'

interface Props {
  /** Rows needing a decision today; `null` or `0` renders no badge. */
  attentionCount?: number | null
}

const BASE =
  'inline-flex items-center gap-2 rounded-t-xl px-4 py-2.5 text-[0.84em] font-semibold transition-colors motion-reduce:transition-none'

function tabClass({ isActive }: { isActive: boolean }): string {
  return `${BASE} ${
    isActive ? 'bg-background text-primary' : 'text-white/70 hover:bg-white/10 hover:text-white'
  }`
}

export function EmployeesSectionTabs({ attentionCount = null }: Props): React.JSX.Element {
  const { t } = useTranslation()
  const { has } = useCapabilities()

  return (
    <nav
      aria-label={t('employees.sectionTabs.aria')}
      className="relative z-[3] mx-auto flex max-w-[1400px] items-end gap-1 px-8"
    >
      <NavLink to="/employees" end className={tabClass}>
        {t('employees.sectionTabs.directory')}
      </NavLink>

      {has('workforce.people.view') && (
        <NavLink to="/employees/attendance" className={tabClass}>
          {({ isActive }) => (
            <>
              {t('employees.sectionTabs.attendance')}
              {attentionCount != null && attentionCount > 0 && (
                <span
                  data-testid="attendance-attention-badge"
                  className={`rounded-full px-2 py-[1px] font-mono text-[0.85em] font-bold ${
                    isActive ? 'bg-accent text-white' : 'bg-white/20 text-white'
                  }`}
                >
                  {attentionCount}
                </span>
              )}
            </>
          )}
        </NavLink>
      )}

      {has('employees.view') && (
        <NavLink to="/employees/org-tree" className={tabClass}>
          {t('employees.sectionTabs.orgTree')}
        </NavLink>
      )}

      <NavLink to="/duty-locations" className={tabClass}>
        {t('employees.sectionTabs.dutyLocations')}
      </NavLink>

      {has('timesheet.view') && (
        <NavLink to="/employees/timesheet" className={tabClass}>
          {t('employees.sectionTabs.timesheet')}
        </NavLink>
      )}
    </nav>
  )
}
