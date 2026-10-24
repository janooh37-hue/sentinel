/**
 * The landing view: every department with its head, its people and the one
 * thing it needs, plus coverage and the access-limits state. A table from md
 * up, a list on phones; both open the department page.
 */

import { useMemo, useState } from 'react'
import { AlertTriangle, Check, ChevronDown, ChevronRight, GitBranch, Hand, Plus, Search, ShieldCheck, Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import type { DepartmentRead } from '@/lib/api'
import { bidi } from '@/lib/bidi'
import { departmentHeadName, departmentName, orderDepartments } from '@/lib/departments'
import { pickEmployeeName } from '@/lib/employeeName'
import { cn } from '@/lib/utils'
import { AddDepartmentDialog, DepartmentPeopleDialog, DepartmentServicesDialog } from './DepartmentDialogs'
import { matchesPerson } from './labels'
import { attentionOf, coverageOf, departmentPath, type Attention } from './model'
import { LINK_BUTTON, PANEL, QueryFailure, ViewHeading } from './ui'
import { useOrgData, type OrgRoute } from './useOrgData'

type Fix = { kind: Attention; department: DepartmentRead }

export function DepartmentRegister({ go }: { go: (next: Partial<OrgRoute>) => void }): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const { canManage, canRelink, tree, departments, exceptions, index, departmentsById, scoping } = useOrgData()
  const [search, setSearch] = useState('')
  const [unit, setUnit] = useState('')
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())
  const [adding, setAdding] = useState(false)
  const [fix, setFix] = useState<Fix | null>(null)

  const all = useMemo(() => departments.data ?? [], [departments.data])
  const childCount = useMemo(() => {
    const counts = new Map<number, number>()
    for (const department of all) {
      if (department.parent_id !== null) counts.set(department.parent_id, (counts.get(department.parent_id) ?? 0) + 1)
    }
    return counts
  }, [all])
  const units = useMemo(
    () => [...new Set((tree.data ?? []).map((person) => person.duty_unit?.trim()).filter((value): value is string => !!value))]
      .sort((a, b) => a.localeCompare(b, lang)),
    [lang, tree.data],
  )
  const term = search.trim().toLocaleLowerCase()
  const filtering = term !== '' || unit !== ''
  const rows = useMemo(() => {
    const ordered = orderDepartments(all)
    if (!filtering) {
      // Hide the rows below a collapsed parent.
      const hidden = new Set<number>()
      return ordered.filter(({ department }) => {
        if (department.parent_id !== null && (hidden.has(department.parent_id) || collapsed.has(department.parent_id))) {
          hidden.add(department.id)
          return false
        }
        return true
      })
    }
    return ordered
      .filter(({ department }) => {
        const head = index.byId.get(department.head_employee_id)
        if (unit && head?.duty_unit?.trim() !== unit) return false
        return !term || [department.name_en, department.name_ar, department.head_name_en, department.head_name_ar ?? '']
          .some((value) => value.toLocaleLowerCase().includes(term))
      })
      .map(({ department }) => ({ department, depth: 0 }))
  }, [all, collapsed, filtering, index, term, unit])
  const people = term ? (tree.data ?? []).filter((person) => matchesPerson(person, term)).slice(0, 8) : []
  const coverage = coverageOf(tree.data ?? [])

  function toggle(id: number): void {
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const partOf = (department: DepartmentRead): string | null => {
    const path = departmentPath(all, department.id)
    return path.length ? t('orgDepartments.preview.partOf', { name: bidi(path.map((item) => departmentName(item, lang)).join(' › ')) }) : null
  }

  function attention(department: DepartmentRead, compact = false): React.ReactNode {
    if (!department.active) return <span className="text-muted-foreground">{t('orgDepartments.register.inactive')}</span>
    const issues = attentionOf(department)
    if (issues.length === 0) {
      return (
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <Check className="h-4 w-4 text-success" aria-hidden />
          {t('orgDepartments.attention.ready')}
        </span>
      )
    }
    return (
      <ul className={cn('flex flex-col', compact ? 'gap-0.5' : 'gap-1')}>
        {issues.map((issue) => (
          <li key={issue}>
            {canManage ? (
              <button
                type="button"
                onClick={() => setFix({ kind: issue, department })}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-md text-start font-medium text-warning underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
                {t(`orgDepartments.attention.${issue}`)}
              </button>
            ) : (
              <span className="inline-flex items-center gap-1.5 font-medium text-warning">
                <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
                {t(`orgDepartments.attention.${issue}`)}
              </span>
            )}
          </li>
        ))}
      </ul>
    )
  }

  const hasDepartments = all.length > 0
  const limitsOn = scoping.data?.enabled === true

  return (
    <div className="space-y-5">
      <ViewHeading
        title={t('orgDepartments.register.title')}
        actions={canManage && hasDepartments ? (
          <>
            <Button variant="outline" className="min-h-11" onClick={() => go({ view: 'setup', step: 1 })}>{t('orgDepartments.register.setUp')}</Button>
            <Button className="min-h-11" onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4" aria-hidden />
              {t('orgDepartments.register.add')}
            </Button>
          </>
        ) : undefined}
      >
        {t('orgDepartments.register.intro')}
      </ViewHeading>

      <div className={cn(PANEL, 'divide-y divide-hairline')}>
        {canManage && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
            <ShieldCheck className={cn('h-5 w-5 shrink-0', limitsOn ? 'text-success' : 'text-muted-foreground')} aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-[0.9em] font-semibold text-foreground">
                {scoping.isPending ? t('common.loading') : t(limitsOn ? 'orgDepartments.limits.stateOn' : 'orgDepartments.limits.stateOff')}
              </p>
              <p className="text-[0.8em] text-muted-foreground">{t(limitsOn ? 'orgDepartments.limits.hintOn' : 'orgDepartments.limits.hintOff')}</p>
            </div>
            <Button variant="outline" size="sm" className="min-h-11" disabled={!scoping.isSuccess} onClick={() => go({ view: 'setup', step: 4 })}>
              {t(limitsOn ? 'orgDepartments.limits.review' : 'orgDepartments.limits.reviewAndTurnOn')}
            </Button>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <Users className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
          <p className="min-w-0 flex-1 text-[0.9em] text-foreground">
            {tree.isPending ? t('common.loading') : (
              <>
                <span className="font-semibold">{t('orgDepartments.register.coverage', { count: coverage.total, covered: coverage.inDepartment })}</span>
                {coverage.outside > 0 && <> · {t('orgDepartments.register.outside', { count: coverage.outside })}</>}
              </>
            )}
          </p>
          {canManage && coverage.outside > 0 && (
            <button type="button" className={LINK_BUTTON} onClick={() => go({ view: 'outside' })}>
              {t('orgDepartments.register.reviewOutside')}
              <ChevronRight className="h-4 w-4 rtl:rotate-180" aria-hidden />
            </button>
          )}
        </div>
      </div>

      {departments.isPending || tree.isPending ? <Skeleton className="h-64 w-full rounded-2xl" /> : departments.isError ? (
        <QueryFailure error={departments.error} retry={() => void departments.refetch()} />
      ) : tree.isError ? (
        <QueryFailure error={tree.error} retry={() => void tree.refetch()} />
      ) : !hasDepartments ? (
        <section className={cn(PANEL, 'px-5 py-8 text-center')}>
          <h3 className="text-[1.05em] font-semibold text-foreground">{t('orgDepartments.register.emptyTitle')}</h3>
          <p className="mx-auto mt-1.5 max-w-[56ch] text-[0.88em] text-muted-foreground">{t('orgDepartments.register.empty')}</p>
          {canManage && (
            <div className="mt-4 flex flex-col items-center gap-1">
              <Button className="min-h-11" onClick={() => go({ view: 'setup', step: 1 })}>{t('orgDepartments.register.setUp')}</Button>
              <button type="button" className={LINK_BUTTON} onClick={() => setAdding(true)}>{t('orgDepartments.register.addOne')}</button>
            </div>
          )}
        </section>
      ) : (
        <section aria-labelledby="org-register-list" className="space-y-3">
          <h3 id="org-register-list" className="sr-only">{t('orgDepartments.register.title')}</h3>
          <div className="flex flex-col gap-2 sm:flex-row">
            <label className="flex min-h-11 flex-1 items-center gap-2 rounded-lg border border-border bg-surface px-3 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="sr-only">{t('orgDepartments.register.search')}</span>
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t('orgDepartments.register.search')}
                data-pill-input
                className="min-w-0 flex-1 bg-transparent py-2 text-[0.9em] outline-none placeholder:text-muted-foreground"
              />
            </label>
            <label className="flex min-h-11 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-[0.86em] focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 sm:w-64">
              <span className="shrink-0 text-muted-foreground">{t('orgDepartments.register.unit')}</span>
              <select
                value={unit}
                onChange={(event) => setUnit(event.target.value)}
                data-pill-input
                className="min-w-0 flex-1 bg-transparent py-2 text-foreground outline-none"
              >
                <option value="">{t('orgDepartments.register.allUnits')}</option>
                {units.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
          </div>

          {rows.length === 0 ? (
            <p role="status" className="py-4 text-[0.88em] text-muted-foreground">{t('orgDepartments.register.noMatches')}</p>
          ) : (
            <>
              <div className={cn(PANEL, 'hidden overflow-hidden md:block')}>
                <table className="w-full text-[0.9em]">
                  <thead className="bg-surface-raised text-start">
                    <tr className="border-b border-hairline">
                      <th scope="col" className="px-4 py-2.5 text-start font-medium text-muted-foreground">{t('orgDepartments.register.colDepartment')}</th>
                      <th scope="col" className="px-4 py-2.5 text-start font-medium text-muted-foreground">{t('orgDepartments.register.colHead')}</th>
                      <th scope="col" className="px-4 py-2.5 text-start font-medium text-muted-foreground">{t('orgDepartments.register.colPeople')}</th>
                      <th scope="col" className="px-4 py-2.5 text-start font-medium text-muted-foreground">{t('orgDepartments.register.colAttention')}</th>
                      <th scope="col" className="px-4 py-2.5"><span className="sr-only">{t('orgDepartments.register.colOpen')}</span></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-hairline">
                    {rows.map(({ department, depth }) => {
                      const name = departmentName(department, lang)
                      const children = childCount.get(department.id) ?? 0
                      const context = filtering ? partOf(department) : null
                      return (
                        <tr key={department.id} className="align-top">
                          <td className="px-4 py-3">
                            <div className="flex items-start gap-1" style={{ paddingInlineStart: `${Math.min(depth, 6) * 1.25}rem` }}>
                              {!filtering && children > 0 ? (
                                <button
                                  type="button"
                                  aria-expanded={!collapsed.has(department.id)}
                                  aria-label={t(collapsed.has(department.id) ? 'orgDepartments.register.expand' : 'orgDepartments.register.collapse', { name })}
                                  onClick={() => toggle(department.id)}
                                  className="-ms-1 grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                >
                                  <ChevronDown className={cn('h-4 w-4 transition-transform motion-reduce:transition-none', collapsed.has(department.id) && '-rotate-90 rtl:rotate-90')} aria-hidden />
                                </button>
                              ) : <span className="w-7 shrink-0" aria-hidden />}
                              <div className="min-w-0 pt-1">
                                <button
                                  type="button"
                                  onClick={() => go({ view: 'department', departmentId: department.id })}
                                  className="break-words text-start font-semibold text-foreground underline-offset-4 hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                >
                                  <bdi>{name}</bdi>
                                </button>
                                {context && <p className="mt-0.5 text-[0.84em] text-muted-foreground">{context}</p>}
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 pt-4"><bdi className="break-words">{departmentHeadName(department, lang)}</bdi></td>
                          <td className="px-4 py-3 pt-4">
                            <span className="whitespace-nowrap">{t('orgDepartments.register.people', { count: department.employee_count })}</span>
                            {children > 0 && <span className="block text-[0.84em] text-muted-foreground">{t('orgDepartments.register.subDepartments', { count: children })}</span>}
                          </td>
                          <td className="px-4 py-3 pt-3.5">{attention(department)}</td>
                          <td className="px-4 py-3 text-end">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="min-h-9"
                              onClick={() => go({ view: 'department', departmentId: department.id })}
                              aria-label={t('orgDepartments.register.openNamed', { name })}
                            >
                              {t('orgDepartments.register.open')}
                              <ChevronRight className="h-4 w-4 rtl:rotate-180" aria-hidden />
                            </Button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              <ul className={cn(PANEL, 'divide-y divide-hairline md:hidden')}>
                {rows.map(({ department }) => {
                  const name = departmentName(department, lang)
                  const children = childCount.get(department.id) ?? 0
                  const context = partOf(department)
                  return (
                    <li key={department.id} className="px-4 py-3.5">
                      <button
                        type="button"
                        onClick={() => go({ view: 'department', departmentId: department.id })}
                        className="flex min-h-11 w-full items-start justify-between gap-3 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <span className="min-w-0">
                          <bdi className="block break-words text-[1em] font-semibold text-foreground">{name}</bdi>
                          {context && <span className="mt-0.5 block text-[0.82em] text-muted-foreground">{context}</span>}
                          <span className="mt-1 block text-[0.86em] text-foreground">
                            {t('orgDepartments.register.headLine', { name: bidi(departmentHeadName(department, lang)) })}
                          </span>
                          <span className="mt-0.5 block text-[0.82em] text-muted-foreground">
                            {t('orgDepartments.register.people', { count: department.employee_count })}
                            {children > 0 && <> · {t('orgDepartments.register.subDepartments', { count: children })}</>}
                          </span>
                        </span>
                        <ChevronRight className="mt-1 h-5 w-5 shrink-0 text-muted-foreground rtl:rotate-180" aria-hidden />
                      </button>
                      <div className="mt-1.5 text-[0.84em]">{attention(department, true)}</div>
                    </li>
                  )
                })}
              </ul>
            </>
          )}

          {people.length > 0 && (
            <section aria-labelledby="org-register-people" className="space-y-2 pt-2">
              <h3 id="org-register-people" className="text-[0.95em] font-semibold text-foreground">{t('orgDepartments.register.peopleResults')}</h3>
              <ul className={cn(PANEL, 'divide-y divide-hairline')}>
                {people.map((person) => {
                  const department = person.department_id == null ? undefined : departmentsById.get(person.department_id)
                  return (
                    <li key={person.id}>
                      <button
                        type="button"
                        onClick={() => department
                          ? go({ view: 'department', departmentId: department.id, query: person.id })
                          : canManage ? go({ view: 'outside' }) : undefined}
                        disabled={!department && !canManage}
                        className="flex min-h-12 w-full items-center justify-between gap-3 px-4 py-2.5 text-start hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:hover:bg-transparent"
                      >
                        <span className="min-w-0">
                          <bdi className="block break-words text-[0.9em] font-medium text-foreground">{pickEmployeeName(person, lang)}</bdi>
                          <span className="block text-[0.8em] text-muted-foreground">
                            {department
                              ? t('orgDepartments.register.inDepartment', { name: bidi(departmentName(department, lang)) })
                              : t('orgDepartments.outsideAll')}
                          </span>
                        </span>
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground rtl:rotate-180" aria-hidden />
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          )}
        </section>
      )}

      {(canRelink || canManage) && (
        <nav aria-label={t('orgDepartments.register.tools')} className="flex flex-wrap gap-x-4 gap-y-1 border-t border-hairline pt-3">
          {canRelink && (
            <button type="button" className={LINK_BUTTON} onClick={() => go({ view: 'reporting' })}>
              <GitBranch className="h-4 w-4" aria-hidden />
              {t('orgDepartments.reporting.title')}
            </button>
          )}
          {canManage && (
            <button type="button" className={LINK_BUTTON} onClick={() => go({ view: 'placements' })}>
              <Hand className="h-4 w-4" aria-hidden />
              {t('orgDepartments.placements.linkCount', { count: exceptions.data?.length ?? 0 })}
            </button>
          )}
        </nav>
      )}

      {adding && <AddDepartmentDialog onClose={() => setAdding(false)} onCreated={(created) => go({ view: 'department', departmentId: created.id })} />}
      {fix?.kind === 'noReceiver' && <DepartmentPeopleDialog department={fix.department} role="deputy" onClose={() => setFix(null)} />}
      {fix?.kind === 'noServices' && <DepartmentServicesDialog department={fix.department} onClose={() => setFix(null)} />}
    </div>
  )
}
