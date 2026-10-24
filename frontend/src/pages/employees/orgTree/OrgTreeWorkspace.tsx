/**
 * OrgTreeWorkspace — the duty-unit rail beside one unit's supervisor tree.
 *
 * Shared by the read-only Employees → Organization page and the optional
 * drag chart in Permissions → Fix reporting lines, so both agree on unit order,
 * headcount and the `?unit=` selection. A reporting structure is per-unit, so
 * the rail drops the Unassigned bucket: those people have no unit to build a
 * tree in.
 */

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'

import { Skeleton } from '@/components/ui/skeleton'
import { api, type EmployeeListItem } from '@/lib/api'
import { UNASSIGNED, groupByUnit, unitTallies } from '@/lib/dutyUnits'
import { UnitRail } from '@/pages/dutyLocations/UnitRail'
import { OrgTreeView, type OrgTreeFocus } from './OrgTreeView'

interface OrgTreeWorkspaceProps {
  editable?: boolean
  focus?: OrgTreeFocus | null
}

export function OrgTreeWorkspace({ editable = false, focus = null }: OrgTreeWorkspaceProps): React.JSX.Element {
  const { t } = useTranslation()
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
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      next.set('unit', key)
      return next
    }, { replace: true })
  }

  if (employeesQuery.isError) {
    return <p className="py-12 text-center text-sm text-accent">{t('employees.orgTree.loadError')}</p>
  }
  if (employeesQuery.isLoading) return <Skeleton className="h-[520px] w-full rounded-2xl" />

  return (
    <div
      data-org-tree-fullscreen-host
      className="grid min-w-0 grid-cols-[minmax(0,1fr)] overflow-hidden rounded-2xl border border-border bg-surface shadow-sm md:grid-cols-[268px_minmax(0,1fr)]"
    >
      <UnitRail
        units={railItems}
        activeKey={activeKey ?? ''}
        totalAssigned={railItems.reduce((total, item) => total + item.count, 0)}
        totalEmployees={employees.length}
        unassignedCount={0}
        onSelect={selectUnit}
      />
      <section className="flex min-h-[520px] min-w-0 flex-col">
        <OrgTreeView
          unit={activeKey ?? ''}
          editable={editable}
          focus={focus}
        />
      </section>
    </div>
  )
}
