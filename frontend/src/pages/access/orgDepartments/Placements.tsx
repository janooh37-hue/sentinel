/**
 * People placed by hand (the department exceptions) and the review of people
 * outside all departments. A placement changes only department membership,
 * never who someone reports to.
 */

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/lib/toast'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { api, type OrgNodeRead } from '@/lib/api'
import { bidi } from '@/lib/bidi'
import { departmentErrorMessage, departmentName, invalidateDepartmentData } from '@/lib/departments'
import { pickEmployeeName } from '@/lib/employeeName'
import { cn } from '@/lib/utils'
import { AddDepartmentDialog, PlacementDialog } from './DepartmentDialogs'
import { deriveMembership, membershipChanges } from './model'
import { PersonSearch } from './PersonSearch'
import { BackLink, LINK_BUTTON, LiveEditsNotice, PANEL, QueryFailure, ViewHeading } from './ui'
import { useOrgData, type OrgRoute } from './useOrgData'

export function Placements(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const qc = useQueryClient()
  const { tree, departments, exceptions, index, departmentsById, limitsOn } = useOrgData()
  const [searching, setSearching] = useState(false)
  const [placing, setPlacing] = useState<OrgNodeRead | null>(null)
  const clear = useMutation({
    mutationFn: (employeeId: string) => api.departments.deleteException(employeeId),
    onSuccess: () => {
      invalidateDepartmentData(qc)
      toast.success(t('orgDepartments.placement.cleared'))
    },
    onError: (error) => toast.error(departmentErrorMessage(error, t)),
  })
  // How many people each placement moves today: the change if it were cleared.
  const affected = useMemo(() => {
    const all = exceptions.data ?? []
    const current = deriveMembership(index, departments.data ?? [], all)
    return new Map(all.map((exception) => [
      exception.employee_id,
      membershipChanges(current, deriveMembership(index, departments.data ?? [], all.filter((item) => item !== exception)), index.isWorking).length,
    ]))
  }, [departments.data, exceptions.data, index])
  const label = (id: number | null): string => {
    if (id === null) return t('orgDepartments.outsideAll')
    const department = departmentsById.get(id)
    return department ? departmentName(department, lang) : ''
  }

  return (
    <div className="space-y-5">
      <ViewHeading
        title={t('orgDepartments.placements.title')}
        actions={<Button className="min-h-11" aria-expanded={searching} onClick={() => setSearching((value) => !value)}>{t('orgDepartments.placements.add')}</Button>}
      >
        <p>{t('orgDepartments.placements.intro')}</p>
        <p className="mt-1">{t('orgDepartments.placement.keepsReporting')}</p>
      </ViewHeading>
      <LiveEditsNotice show={limitsOn} />

      {searching && (
        <div className={cn(PANEL, 'px-4 py-4')}>
          <PersonSearch
            autoFocus
            people={tree.data ?? []}
            label={t('orgDepartments.placements.find')}
            onPick={setPlacing}
            meta={(person) => label(person.department_id ?? null)}
          />
        </div>
      )}

      {exceptions.isPending || tree.isPending ? <Skeleton className="h-48 w-full rounded-2xl" /> : exceptions.isError ? (
        <QueryFailure error={exceptions.error} retry={() => void exceptions.refetch()} />
      ) : exceptions.data.length === 0 ? (
        <p className={cn(PANEL, 'px-4 py-6 text-center text-[0.9em] text-muted-foreground')}>{t('orgDepartments.placements.empty')}</p>
      ) : (
        <ul className={cn(PANEL, 'divide-y divide-hairline')}>
          {exceptions.data.map((exception) => {
            const person = index.byId.get(exception.employee_id)
            const count = affected.get(exception.employee_id) ?? 0
            return (
              <li key={exception.employee_id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 py-3.5">
                <div className="min-w-0 flex-1 space-y-0.5 text-[0.86em]">
                  <bdi className="block break-words text-[1.05em] font-semibold text-foreground">{pickEmployeeName(exception, lang)}</bdi>
                  <p className="font-medium text-foreground">
                    {exception.department_id === null
                      ? t('orgDepartments.placements.outside')
                      : t('orgDepartments.placements.placedIn', { name: bidi(label(exception.department_id)) })}
                  </p>
                  <p className="text-muted-foreground">{t('orgDepartments.placements.treeGives', { name: bidi(label(exception.tree_department_id)) })}</p>
                  <p className="text-muted-foreground">{t('orgDepartments.placements.affects', { count })}</p>
                </div>
                <div className="flex flex-wrap gap-x-2">
                  {person && (
                    <button type="button" className={LINK_BUTTON} onClick={() => setPlacing(person)}>{t('orgDepartments.placements.change')}</button>
                  )}
                  <button
                    type="button"
                    className={LINK_BUTTON}
                    disabled={clear.isPending && clear.variables === exception.employee_id}
                    onClick={() => clear.mutate(exception.employee_id)}
                  >
                    {t('orgDepartments.placement.options.tree')}
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {placing && <PlacementDialog person={placing} onClose={() => setPlacing(null)} />}
    </div>
  )
}

export function OutsideDepartments({ go }: { go: (next: Partial<OrgRoute>) => void }): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const { index } = useOrgData()
  const groups = useQuery({ queryKey: ['departments', 'unassigned-employees'], queryFn: api.departments.unassignedEmployees })
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [heading, setHeading] = useState<string | null>(null)
  const [placing, setPlacing] = useState<OrgNodeRead | null>(null)
  const total = (groups.data ?? []).reduce((sum, group) => sum + group.count, 0)

  return (
    <div className="space-y-5">
      <BackLink onClick={() => go({ view: 'register' })} />
      <ViewHeading title={t('orgDepartments.outside.title', { count: total })}>
        <p>{t('orgDepartments.outside.intro')}</p>
      </ViewHeading>

      {groups.isPending ? <Skeleton className="h-48 w-full rounded-2xl" /> : groups.isError ? (
        <QueryFailure error={groups.error} retry={() => void groups.refetch()} />
      ) : groups.data.length === 0 ? (
        <p className={cn(PANEL, 'px-4 py-6 text-center text-[0.9em] text-muted-foreground')}>{t('orgDepartments.outside.empty')}</p>
      ) : (
        <ul className={cn(PANEL, 'divide-y divide-hairline')}>
          {groups.data.map((group) => {
            const top = index.byId.get(group.top_employee_id)
            const name = pickEmployeeName({ name_en: group.top_name_en, name_ar: group.top_name_ar }, lang)
            const expanded = open.has(group.top_employee_id)
            const members = group.employee_ids.map((id) => index.byId.get(id)).filter((person): person is OrgNodeRead => !!person)
            return (
              <li key={group.top_employee_id} className="space-y-2 px-4 py-3.5">
                <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                  <div className="min-w-0 flex-1 text-[0.86em]">
                    <p className="break-words text-[1.05em] font-semibold text-foreground">{t('orgDepartments.outside.under', { name: bidi(name) })}</p>
                    <p className="text-muted-foreground">
                      <bdi>{group.duty_unit || t('orgDepartments.outside.noUnit')}</bdi>
                      {' · '}
                      {t('orgDepartments.register.people', { count: group.count })}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-x-2">
                    <button type="button" className={LINK_BUTTON} onClick={() => setHeading(group.top_employee_id)}>
                      {t('orgDepartments.outside.makeHead', { name: bidi(name) })}
                    </button>
                    {top && <button type="button" className={LINK_BUTTON} onClick={() => setPlacing(top)}>{t('orgDepartments.outside.place')}</button>}
                  </div>
                </div>
                {members.length > 0 && (
                  <>
                    <button
                      type="button"
                      aria-expanded={expanded}
                      onClick={() => setOpen((current) => {
                        const next = new Set(current)
                        if (next.has(group.top_employee_id)) next.delete(group.top_employee_id)
                        else next.add(group.top_employee_id)
                        return next
                      })}
                      className={cn(LINK_BUTTON, '-ms-2')}
                    >
                      <ChevronDown className={cn('h-4 w-4 transition-transform motion-reduce:transition-none', expanded && 'rotate-180')} aria-hidden />
                      {t(expanded ? 'orgDepartments.preview.hidePeople' : 'orgDepartments.preview.showPeople')}
                    </button>
                    {expanded && (
                      <ul className="max-h-64 columns-1 gap-6 overflow-y-auto rounded-lg bg-surface-tinted/60 px-3 py-2 text-[0.84em] sm:columns-2 lg:columns-3">
                        {members.map((person) => <li key={person.id} className="break-inside-avoid py-0.5"><bdi>{pickEmployeeName(person, lang)}</bdi></li>)}
                      </ul>
                    )}
                  </>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {heading && (
        <AddDepartmentDialog
          initialHeadId={heading}
          onClose={() => setHeading(null)}
          onCreated={(created) => go({ view: 'department', departmentId: created.id })}
        />
      )}
      {placing && <PlacementDialog person={placing} onClose={() => setPlacing(null)} />}
    </div>
  )
}
