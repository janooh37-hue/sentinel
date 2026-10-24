/**
 * OrgDepartmentsTab — Permissions → Organization & departments.
 *
 * Four sub-sections, Accounts first: access is managed for a few dozen
 * accounts, so the tab starts from what each account sees and why.
 *   - Accounts (`departments.manage`, the default);
 *   - Departments: the register, guided setup, one department, and people
 *     outside all departments (`?view=` register/setup/department/outside);
 *   - Reporting lines (`employees.edit`), optionally opened on one employee;
 *   - Placed by hand (`departments.manage`).
 *
 * Gates: opening the tab needs `employees.view` plus `employees.edit` or
 * `departments.manage`; every derived number also needs organization-wide
 * session scope.
 */

import { useEffect, useRef, useState } from 'react'
import { GitBranch, Info } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { Accounts } from './Accounts'
import { LeaveGuardContext, NO_PENDING_WORK, type LeaveState } from './leaveGuard'
import { DepartmentPage } from './DepartmentPage'
import { DepartmentRegister } from './DepartmentRegister'
import { DepartmentSetup } from './DepartmentSetup'
import { OutsideDepartments, Placements } from './Placements'
import { ReportingLines } from './ReportingLines'
import { INPUT, LINK_BUTTON, PANEL, QueryFailure } from './ui'
import { useOrgData, useOrgRoute, type OrgView } from './useOrgData'

type Section = 'accounts' | 'departments' | 'reporting' | 'placements'

const SECTION_OF: Record<OrgView, Section> = {
  accounts: 'accounts',
  register: 'departments',
  setup: 'departments',
  department: 'departments',
  outside: 'departments',
  reporting: 'reporting',
  placements: 'placements',
}

/** The view each sub-section opens on. */
const ENTRY: Record<Section, OrgView> = { accounts: 'accounts', departments: 'register', reporting: 'reporting', placements: 'placements' }

export function OrgDepartmentsTab(): React.JSX.Element {
  const { t } = useTranslation()
  const { canManage, canRelink, orgWide, reads } = useOrgData()
  const { route, go } = useOrgRoute()
  const topRef = useRef<HTMLDivElement>(null)

  const allowed: Record<Section, boolean> = { accounts: canManage, departments: true, reporting: canRelink, placements: canManage }
  const sections = (['accounts', 'departments', 'reporting', 'placements'] as const).filter((section) => allowed[section])
  const viewAllowed = allowed[SECTION_OF[route.view]] && (canManage || !['setup', 'outside'].includes(route.view))
  const view: OrgView = viewAllowed ? route.view : canManage ? 'accounts' : 'register'
  const section = SECTION_OF[view]

  // Each view is a new page: when the admin moves between views, bring the
  // top back into sight. A first load keeps the page header where it is.
  const viewKey = `${view}:${route.step}:${route.departmentId}:${route.employeeId}`
  const shownKey = useRef(viewKey)
  useEffect(() => {
    if (shownKey.current === viewKey) return
    shownKey.current = viewKey
    topRef.current?.scrollIntoView({ block: 'nearest' })
  }, [viewKey])

  // Reporting lines work on whatever part of the tree the user can see;
  // everything else derives organization-wide numbers and needs the whole tree.
  const derived = view !== 'reporting'

  // Guided setup reports unsaved choices and running batches; switching
  // sections asks first, and waits while a batch runs.
  const [leave, setLeave] = useState<LeaveState>(NO_PENDING_WORK)
  const [pendingSection, setPendingSection] = useState<Section | null>(null)
  function openSection(next: Section): void {
    if (leave.busy) return
    if (leave.unsaved > 0) setPendingSection(next)
    else go({ view: ENTRY[next] })
  }

  return (
    <div ref={topRef} className="min-w-0 scroll-mt-4 space-y-5">
      {sections.length > 1 && (
        <>
          {/* Phones: four labels don't fit one row in either language, so the
              same sections, through the same guard, become a compact picker. */}
          <select
            aria-label={t('orgDepartments.sections.label')}
            value={section}
            disabled={leave.busy}
            onChange={(event) => openSection(event.target.value as Section)}
            className={cn(INPUT, 'mt-0 font-medium disabled:opacity-50 sm:hidden')}
          >
            {sections.map((item) => <option key={item} value={item}>{t(`orgDepartments.sections.${item}`)}</option>)}
          </select>
          <Tabs value={section} onValueChange={(next) => openSection(next as Section)} className="hidden sm:block">
            <TabsList aria-label={t('orgDepartments.sections.label')} className="flex-wrap gap-x-6">
              {sections.map((item) => (
                <TabsTrigger key={item} value={item} disabled={leave.busy} className="disabled:opacity-50">{t(`orgDepartments.sections.${item}`)}</TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </>
      )}
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
        <div role={sections.length > 1 ? 'tabpanel' : undefined}>
          <LeaveGuardContext.Provider value={setLeave}>
            {view === 'accounts' && <Accounts go={go} />}
            {view === 'register' && <DepartmentRegister go={go} />}
            {view === 'department' && <DepartmentPage route={route} go={go} />}
            {view === 'setup' && <DepartmentSetup step={route.step} go={go} />}
            {view === 'reporting' && <ReportingLines key={route.employeeId ?? ''} initialEmployeeId={route.employeeId} />}
            {view === 'placements' && <Placements />}
            {view === 'outside' && <OutsideDepartments go={go} />}
          </LeaveGuardContext.Provider>
        </div>
      )}
      <ConfirmDialog
        open={pendingSection !== null}
        onOpenChange={(open) => { if (!open) setPendingSection(null) }}
        title={t('orgDepartments.setup.leaveTitle')}
        description={t('orgDepartments.setup.leaveHint', { count: leave.unsaved })}
        confirmLabel={t('orgDepartments.setup.leave')}
        onConfirm={() => { if (pendingSection) go({ view: ENTRY[pendingSection] }) }}
      />
    </div>
  )
}
