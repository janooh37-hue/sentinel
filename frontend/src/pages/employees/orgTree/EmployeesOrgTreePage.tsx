/**
 * EmployeesOrgTreePage — the supervisor hierarchy, as a section of Employees.
 *
 * Sits beside Directory and Attendance in `EmployeesSectionTabs` (route
 * `/employees/org-tree`), because "who reports to whom" is a fact about people,
 * not about the transfer-letter workflow that owns /duty-locations. Living here
 * also means it is two clicks from anywhere: the top nav's Employees entry, then
 * one section tab.
 *
 * Read-only on `employees.view` (the route gate), re-linkable on
 * `employees.edit` — `OrgTreeView` owns that distinction.
 *
 * A reporting structure is per-unit, so the page keeps the duty rail as its
 * selector but drops the Unassigned bucket: those people have no unit to build
 * a tree in. The rail is shared with the roster via `unitTallies`, so both
 * pages agree on unit order and headcount.
 *
 * `?unit=` carries the selection so a company is linkable and survives reload.
 */

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'

import { EmployeesSectionTabs } from '@/components/employees/EmployeesSectionTabs'
import { useAttendanceAttention } from '@/components/employees/useAttendanceAttention'
import { Skeleton } from '@/components/ui/skeleton'
import { api, type EmployeeListItem } from '@/lib/api'
import { UNASSIGNED, groupByUnit, unitTallies } from '@/lib/dutyUnits'
import { UnitRail } from '@/pages/dutyLocations/UnitRail'
import { OrgTreeView } from './OrgTreeView'

export function EmployeesOrgTreePage(): React.JSX.Element {
  const { t } = useTranslation()
  const { attention } = useAttendanceAttention()
  const [params, setParams] = useSearchParams()

  const employeesQuery = useQuery({
    queryKey: ['employees', { limit: 500 }],
    queryFn: () => api.listEmployees({ limit: 500 }),
  })

  const employees = useMemo<EmployeeListItem[]>(
    () => employeesQuery.data?.items ?? [],
    [employeesQuery.data],
  )
  const grouped = useMemo(() => groupByUnit(employees), [employees])

  const railItems = useMemo(
    () => unitTallies(grouped, t('dutyLocations.unassigned')).filter((r) => r.key !== UNASSIGNED),
    [grouped, t],
  )

  // The URL wins when it names a real unit; otherwise fall back to the first
  // unit that actually has people, so a fresh visit never opens an empty chart.
  const requested = params.get('unit')
  const activeKey = useMemo(() => {
    if (requested && railItems.some((r) => r.key === requested)) return requested
    return railItems.find((r) => r.count > 0)?.key ?? railItems[0]?.key ?? null
  }, [requested, railItems])

  function selectUnit(key: string): void {
    const next = new URLSearchParams(params)
    next.set('unit', key)
    setParams(next, { replace: true })
  }

  const totalEmployees = employees.length
  const totalAssigned = railItems.reduce((total, item) => total + item.count, 0)

  return (
    <div className="flex flex-1 flex-col overflow-auto bg-background">
      {/* shrink-0: sibling content is tall, and without it this band collapses
          and swallows the title and the section tabs. */}
      <section
        className="relative shrink-0 overflow-hidden pt-[18px] text-white"
        style={{ background: 'var(--hero-grad)' }}
      >
        <div
          aria-hidden
          className="absolute -end-[60px] -top-[130px] h-[300px] w-[300px] rounded-full bg-white/[.05]"
        />
        <div className="relative mx-auto max-w-[1400px] px-8">
          <div className="text-[0.7em] font-semibold uppercase tracking-[.2em] opacity-[.62]">
            {t('employees.lookup.eyebrow')}
          </div>
          <h1 className="mt-1.5 flex items-baseline gap-2.5 text-[1.45em] font-bold tracking-[-0.01em]">
            {t('employees.orgTree.title')}
            <span dir="rtl" className="isolate-bidi text-[0.74em] font-normal opacity-[.72]">
              {t('employees.orgTree.titleAr')}
            </span>
          </h1>
          <p className="mt-1 text-[0.8em] opacity-[.76]">{t('employees.orgTree.subtitle')}</p>
        </div>
        <div className="mt-3.5">
          <EmployeesSectionTabs attentionCount={attention} />
        </div>
      </section>

      <div className="mx-auto w-full max-w-[1400px] flex-1 px-8 pb-10 pt-4">
        {employeesQuery.isError ? (
          <p className="py-12 text-center text-sm text-accent">{t('employees.orgTree.loadError')}</p>
        ) : employeesQuery.isLoading ? (
          <Skeleton className="h-[520px] w-full rounded-2xl" />
        ) : (
          <div
            data-org-tree-fullscreen-host
            className="grid overflow-hidden rounded-2xl border border-border bg-surface shadow-sm md:grid-cols-[268px_1fr]"
          >
            <UnitRail
              units={railItems}
              activeKey={activeKey}
              totalAssigned={totalAssigned}
              totalEmployees={totalEmployees}
              unassignedCount={0}
              onSelect={selectUnit}
            />
            <section className="flex min-h-[520px] flex-col">
              <OrgTreeView unit={activeKey ?? ''} />
            </section>
          </div>
        )}
      </div>
    </div>
  )
}
