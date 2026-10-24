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

import { DepartmentPage } from './DepartmentPage'
import { DepartmentRegister } from './DepartmentRegister'
import { DepartmentSetup } from './DepartmentSetup'
import { OutsideDepartments, Placements } from './Placements'
import { ReportingLines } from './ReportingLines'
import { useOrgData, useOrgRoute, type OrgView } from './useOrgData'

export function OrgDepartmentsTab(): React.JSX.Element {
  const { canManage, canRelink } = useOrgData()
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

  return (
    <div ref={topRef} className="min-w-0 scroll-mt-4">
      {view === 'register' && <DepartmentRegister go={go} />}
      {view === 'department' && <DepartmentPage route={route} go={go} />}
      {view === 'setup' && <DepartmentSetup step={route.step} go={go} />}
      {view === 'reporting' && <ReportingLines go={go} />}
      {view === 'placements' && <Placements go={go} />}
      {view === 'outside' && <OutsideDepartments go={go} />}
    </div>
  )
}
