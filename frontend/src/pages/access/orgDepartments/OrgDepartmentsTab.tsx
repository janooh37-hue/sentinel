/**
 * OrgDepartmentsTab — Permissions → Organization & departments.
 *
 * A department is a manager plus everyone who reports to them, so this tab is
 * task-first: it lands on the department register, and every other job opens
 * as its own view (`?view=`): guided setup, one department, fixing reporting
 * lines, people placed by hand, and people outside all departments.
 *
 * Gates (unchanged): opening the tab needs `employees.view` plus
 * `employees.edit` or `departments.manage`; reporting lines need
 * `employees.edit`; every department action needs `departments.manage`.
 */

import { useEffect, useRef } from 'react'
import { GitBranch, Info } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { DepartmentPage } from './DepartmentPage'
import { DepartmentRegister } from './DepartmentRegister'
import { DepartmentSetup } from './DepartmentSetup'
import { OutsideDepartments, Placements } from './Placements'
import { ReportingLines } from './ReportingLines'
import { LINK_BUTTON, PANEL, QueryFailure } from './ui'
import { useOrgData, useOrgRoute, type OrgView } from './useOrgData'

export function OrgDepartmentsTab(): React.JSX.Element {
  const { t } = useTranslation()
  const { canManage, canRelink, orgWide, reads } = useOrgData()
  const { route, go } = useOrgRoute()
  const topRef = useRef<HTMLDivElement>(null)

  // Views a user may not open fall back to the register.
  const allowed: Record<OrgView, boolean> = {
    register: true,
    department: true,
    setup: canManage,
    placements: canManage,
    outside: canManage,
    reporting: canRelink,
  }
  const view: OrgView = allowed[route.view] ? route.view : 'register'

  // Each view is a new page: when the admin moves between views, bring the
  // top back into sight. A first load keeps the page header where it is.
  const viewKey = `${view}:${route.step}:${route.departmentId}`
  const shownKey = useRef(viewKey)
  useEffect(() => {
    if (shownKey.current === viewKey) return
    shownKey.current = viewKey
    topRef.current?.scrollIntoView({ block: 'nearest' })
  }, [viewKey])

  // Reporting lines work on whatever part of the tree the user can see;
  // everything else derives organization-wide numbers and needs the whole tree.
  const derived = view !== 'reporting'

  return (
    <div ref={topRef} className="min-w-0 scroll-mt-4">
      {derived && !orgWide ? (
        <div className={cn(PANEL, 'space-y-2 px-5 py-6')}>
          <p role="status" className="flex items-start gap-2 text-[0.92em] text-foreground">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-info" aria-hidden />
            {t('orgDepartments.orgWideRequired')}
          </p>
          {canRelink && (
            <button type="button" className={cn(LINK_BUTTON, '-ms-2')} onClick={() => go({ view: 'reporting' })}>
              <GitBranch className="h-4 w-4" aria-hidden />
              {t('orgDepartments.reporting.title')}
            </button>
          )}
        </div>
      ) : derived && !reads.ready ? (
        reads.failed ? <QueryFailure error={reads.failed.error} retry={reads.retry} /> : (
          <div role="status" aria-label={t('orgDepartments.dataLoading')}><Skeleton className="h-64 w-full rounded-2xl" /></div>
        )
      ) : (
        <>
          {view === 'register' && <DepartmentRegister go={go} />}
          {view === 'department' && <DepartmentPage route={route} go={go} />}
          {view === 'setup' && <DepartmentSetup step={route.step} go={go} />}
          {view === 'reporting' && <ReportingLines go={go} />}
          {view === 'placements' && <Placements go={go} />}
          {view === 'outside' && <OutsideDepartments go={go} />}
        </>
      )}
    </div>
  )
}
