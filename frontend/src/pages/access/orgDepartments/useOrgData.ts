/**
 * Shared reads and in-tab navigation for Organization & departments.
 *
 * Every view reads the same three sources (org tree, departments, hand
 * placements); React Query dedupes them, so views stay independent. The view
 * lives in the URL, so a phone's back button and a reload both return to the
 * same task.
 */

import { useCallback, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'

import { api } from '@/lib/api'
import { useCapabilities } from '@/lib/useCapabilities'
import { buildOrgIndex } from './model'

export function useOrgData() {
  const { has } = useCapabilities()
  const canManage = has('departments.manage')
  const canRelink = has('employees.edit')
  const tree = useQuery({ queryKey: ['org-tree'], queryFn: api.listOrgTree })
  const departments = useQuery({ queryKey: ['departments'], queryFn: api.departments.list })
  const exceptions = useQuery({
    queryKey: ['departments', 'exceptions'],
    queryFn: api.departments.listExceptions,
    enabled: canManage,
  })
  const scoping = useQuery({
    queryKey: ['department-scoping'],
    queryFn: api.departments.getScoping,
    enabled: canManage,
  })
  const index = useMemo(() => buildOrgIndex(tree.data ?? []), [tree.data])
  const departmentsById = useMemo(
    () => new Map((departments.data ?? []).map((department) => [department.id, department])),
    [departments.data],
  )
  return {
    canManage,
    canRelink,
    tree,
    departments,
    exceptions,
    scoping,
    index,
    departmentsById,
    limitsOn: scoping.data?.enabled === true,
  }
}

export type OrgView = 'register' | 'setup' | 'department' | 'reporting' | 'placements' | 'outside'
export type DepartmentSection = 'people' | 'access' | 'settings'
export type SetupStep = 1 | 2 | 3 | 4

export interface OrgRoute {
  view: OrgView
  step: SetupStep
  departmentId: number | null
  section: DepartmentSection
  query: string
}

const VIEWS: readonly OrgView[] = ['register', 'setup', 'department', 'reporting', 'placements', 'outside']
const SECTIONS: readonly DepartmentSection[] = ['people', 'access', 'settings']

/** Route keys this tab owns; everything else in the URL (`tab`, `user`) is kept. */
const KEYS = ['view', 'step', 'dept', 'section', 'q'] as const

export function useOrgRoute(): { route: OrgRoute; go: (next: Partial<OrgRoute>) => void } {
  const [params, setParams] = useSearchParams()
  const rawView = params.get('view')
  const rawStep = Number(params.get('step'))
  const rawDept = Number(params.get('dept'))
  const rawSection = params.get('section')
  const route: OrgRoute = {
    view: VIEWS.includes(rawView as OrgView) ? (rawView as OrgView) : 'register',
    step: rawStep >= 1 && rawStep <= 4 ? (rawStep as SetupStep) : 1,
    departmentId: Number.isInteger(rawDept) && rawDept > 0 ? rawDept : null,
    section: SECTIONS.includes(rawSection as DepartmentSection) ? (rawSection as DepartmentSection) : 'people',
    query: params.get('q') ?? '',
  }
  const go = useCallback((next: Partial<OrgRoute>) => {
    setParams((prev) => {
      const merged = new URLSearchParams(prev)
      for (const key of KEYS) merged.delete(key)
      const view = next.view ?? 'register'
      if (view !== 'register') merged.set('view', view)
      if (view === 'setup') merged.set('step', String(next.step ?? 1))
      if (view === 'department' && next.departmentId != null) {
        merged.set('dept', String(next.departmentId))
        if (next.section && next.section !== 'people') merged.set('section', next.section)
      }
      if (next.query) merged.set('q', next.query)
      return merged
    })
  }, [setParams])
  return { route, go }
}
