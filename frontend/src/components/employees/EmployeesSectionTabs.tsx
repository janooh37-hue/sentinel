/**
 * EmployeesSectionTabs — the Employees section switcher.
 *
 * Rendered at the foot of the navy band by every page in the section —
 * Directory, Attendance, Organization, Time Sheet, and Company statistics —
 * which is where Sentinel already puts section switching. Deliberately not a top-nav
 * destination: the top nav is a single row at every width and its budget is
 * spent (see the tiers in index.css), and the mobile dock builds its catalogue
 * from NAV_ITEMS.
 *
 * Active state comes from `NavLink`, not from a prop: the route *is* the active
 * tab, and `NavLink` already owns both the styling hook and `aria-current`.
 *
 * Attendance and Company statistics share the roster gate. Only Attendance
 * carries the live count of rows needing a decision.
 *
 * One label per tab, in the active language only. Two tabs used to carry their
 * Arabic name beside the English one, which made a bidi hazard of every label
 * to supply a translation the language switch already gives.
 */

import { useLayoutEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { NavLink, useLocation } from 'react-router-dom'

import { prefetchRouteForPath } from '@/lib/prefetchRoute'
import { useCapabilities } from '@/lib/useCapabilities'
import { canViewAttendanceRoster } from '@/lib/workforceAttendance'

interface Props {
  /** Rows needing a decision today; `null` or `0` renders no badge. */
  attentionCount?: number | null
}

const BASE =
  'inline-flex min-h-[44px] shrink-0 items-center gap-2 whitespace-nowrap rounded-t-xl px-3 py-2.5 text-[0.84em] font-semibold transition-colors focus-visible:outline-none! focus-visible:ring-2 focus-visible:ring-inset motion-reduce:transition-none md:min-h-0 md:px-4'

function tabClass({ isActive }: { isActive: boolean }): string {
  return `${BASE} ${
    isActive
      ? 'bg-background text-primary-text focus-visible:ring-ring'
      : 'text-white/70 hover:bg-white/10 hover:text-white focus-visible:ring-white/70'
  }`
}

export function EmployeesSectionTabs({ attentionCount = null }: Props): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const { has } = useCapabilities()
  const canViewRoster = canViewAttendanceRoster(has)
  const { pathname } = useLocation()
  const navRef = useRef<HTMLElement>(null)

  // The selected tab should be visible on a phone, even at the far end in RTL.
  useLayoutEffect(() => {
    const nav = navRef.current
    if (nav && nav.scrollWidth > nav.clientWidth) {
      nav.querySelector('[aria-current="page"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
    }
  }, [pathname, i18n.language])

  const prefetchCompanyStats = () => prefetchRouteForPath('/employees/company-stats')

  return (
    <nav
      ref={navRef}
      aria-label={t('employees.sectionTabs.aria')}
      className="relative z-[3] mx-auto flex min-w-0 max-w-[1400px] items-end gap-1 overflow-x-auto px-4 [scrollbar-width:none] md:px-8"
    >
      <NavLink to="/employees" end className={tabClass}>
        {t('employees.sectionTabs.directory')}
      </NavLink>

      {canViewRoster && (
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
                  <bdi dir="ltr">{attentionCount}</bdi>
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

      {has('documents.generate') && has('documents.duty_transfer') && (
        <NavLink to="/duty-locations" className={tabClass}>
          {t('employees.sectionTabs.dutyLocations')}
        </NavLink>
      )}

      {has('timesheet.view') && (
        <NavLink to="/employees/timesheet" className={tabClass}>
          {t('employees.sectionTabs.timesheet')}
        </NavLink>
      )}

      {canViewRoster && (
        <NavLink
          to="/employees/company-stats"
          className={tabClass}
          onPointerEnter={prefetchCompanyStats}
          onFocus={prefetchCompanyStats}
        >
          {t('employees.sectionTabs.companyStats')}
        </NavLink>
      )}
    </nav>
  )
}
