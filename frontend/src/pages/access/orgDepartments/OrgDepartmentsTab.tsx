/**
 * OrgDepartmentsTab — Permissions → Organization & departments.
 *
 * The one place that edits the org tree. A department is a manager in the
 * tree plus everyone under them, so the tree editor and the department
 * controls sit together:
 *   - supervisor relinking (drag / ✎) needs `employees.edit`;
 *   - department actions on a card, and the side list (departments, people
 *     outside every department, exceptions, the scoping switch), need
 *     `departments.manage`.
 */

import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Building2, Crosshair, MoreHorizontal } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import {
  api,
  type DepartmentExceptionRead,
  type DepartmentRead,
  type OrgNodeRead,
} from '@/lib/api'
import {
  departmentErrorMessage,
  departmentHasReceiver,
  departmentHeadName,
  departmentName,
  invalidateDepartmentData,
  orderDepartments,
} from '@/lib/departments'
import { bidi } from '@/lib/bidi'
import { pickEmployeeName } from '@/lib/employeeName'
import { useCapabilities } from '@/lib/useCapabilities'
import { cn } from '@/lib/utils'
import type { OrgTreeFocus } from '@/pages/employees/orgTree/OrgTreeView'
import { OrgTreeWorkspace } from '@/pages/employees/orgTree/OrgTreeWorkspace'
import {
  DepartmentExceptionDialog,
  DepartmentFormDialog,
  DepartmentPeopleDialog,
  DepartmentServicesDialog,
} from './DepartmentDialogs'
import { DepartmentScopingCard } from './DepartmentScopingCard'

type Action =
  | { kind: 'create'; person: OrgNodeRead }
  | { kind: 'edit' | 'people' | 'services'; department: DepartmentRead }
  | { kind: 'exception'; person: OrgNodeRead }

const CARD = 'rounded-2xl border border-hairline bg-surface p-4'
const HEADING = 'text-[0.72em] font-semibold uppercase tracking-[0.08em] text-muted-foreground rtl:tracking-normal'
const LINK_BUTTON = 'inline-flex min-h-9 items-center gap-1.5 rounded-md px-2 text-[0.78em] font-medium text-primary hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

export function OrgDepartmentsTab(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const qc = useQueryClient()
  const { has } = useCapabilities()
  const canManage = has('departments.manage')
  const [, setParams] = useSearchParams()
  const [action, setAction] = useState<Action | null>(null)
  const [focus, setFocus] = useState<OrgTreeFocus | null>(null)
  const treeRef = useRef<HTMLDivElement>(null)

  const tree = useQuery({ queryKey: ['org-tree'], queryFn: api.listOrgTree })
  const departments = useQuery({ queryKey: ['departments'], queryFn: api.departments.list })
  const exceptions = useQuery({
    queryKey: ['departments', 'exceptions'],
    queryFn: api.departments.listExceptions,
    enabled: canManage,
  })
  const unassigned = useQuery({
    queryKey: ['departments', 'unassigned-employees'],
    queryFn: api.departments.unassignedEmployees,
    enabled: canManage,
  })

  const peopleById = new Map((tree.data ?? []).map((person) => [person.id, person]))
  const departmentsById = new Map((departments.data ?? []).map((department) => [department.id, department]))
  const exceptionsById = new Map((exceptions.data ?? []).map((exception) => [exception.employee_id, exception]))

  const clearException = useMutation({
    mutationFn: (employeeId: string) => api.departments.deleteException(employeeId),
    onSuccess: () => {
      invalidateDepartmentData(qc)
      toast.success(t('orgDepartments.exceptions.cleared'))
    },
    onError: (error) => toast.error(departmentErrorMessage(error, t)),
  })
  const placeOutside = useMutation({
    mutationFn: (employeeId: string) => api.departments.putException(employeeId, null),
    onSuccess: () => {
      invalidateDepartmentData(qc)
      toast.success(t('orgDepartments.exceptions.saved'))
    },
    onError: (error) => toast.error(departmentErrorMessage(error, t)),
  })

  function showInTree(employeeId: string): void {
    const person = peopleById.get(employeeId)
    if (!person?.duty_unit) {
      toast.error(t('orgDepartments.notOnTree'))
      return
    }
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      next.set('unit', person.duty_unit!)
      return next
    }, { replace: true })
    setFocus({ id: employeeId, nonce: (focus?.nonce ?? 0) + 1 })
    treeRef.current?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }

  /** Dialogs portal to <body>, which a fullscreen tree would hide. */
  function openAction(next: Action): void {
    if (document.fullscreenElement) void document.exitFullscreen()
    setAction(next)
  }

  const nameOf = (person: { name_en: string; name_ar?: string | null }): string => pickEmployeeName(person, lang)

  function personMenu(person: OrgNodeRead, trigger: React.ReactNode): React.JSX.Element {
    const headed = person.head_of_department_id == null ? undefined : departmentsById.get(person.head_of_department_id)
    const exception = exceptionsById.get(person.id)
    const exceptionAllowed = !headed?.active
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
        <DropdownMenuContent
          container={document.fullscreenElement instanceof HTMLElement ? document.fullscreenElement : null}
          // Menu events bubble through the portal to the card: keep them from
          // toggling its trace or starting a drag.
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {headed ? (
            <>
              <DropdownMenuItem onSelect={() => openAction({ kind: 'edit', department: headed })}>
                {t('orgDepartments.actions.editDepartment')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => openAction({ kind: 'people', department: headed })}>
                {t('orgDepartments.actions.people')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => openAction({ kind: 'services', department: headed })}>
                {t('orgDepartments.actions.services')}
              </DropdownMenuItem>
            </>
          ) : (
            <DropdownMenuItem onSelect={() => openAction({ kind: 'create', person })}>
              {t('orgDepartments.actions.makeHead')}
            </DropdownMenuItem>
          )}
          {exceptionAllowed && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => openAction({ kind: 'exception', person })}>
                {t('orgDepartments.actions.placeIn')}
              </DropdownMenuItem>
              {!(exception && exception.department_id === null) && (
                <DropdownMenuItem pending={placeOutside.isPending} onSelect={() => placeOutside.mutate(person.id)}>
                  {t('orgDepartments.actions.outside')}
                </DropdownMenuItem>
              )}
              {exception && (
                <DropdownMenuItem pending={clearException.isPending} onSelect={() => clearException.mutate(person.id)}>
                  {t('orgDepartments.actions.clearException')}
                </DropdownMenuItem>
              )}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  const renderCardAction = canManage
    ? (person: OrgNodeRead): React.ReactNode => personMenu(
        person,
        <button
          type="button"
          data-org-no-drag
          className="org-edit-button"
          aria-label={t('orgDepartments.actions.menu', { name: nameOf(person) })}
          onClick={(event) => event.stopPropagation()}
        >
          <Building2 size={12} aria-hidden />
        </button>,
      )
    : undefined

  const renderCardMarker = canManage
    ? (person: OrgNodeRead): React.ReactNode => {
        const exception = exceptionsById.get(person.id)
        if (!exception) return null
        const target = exception.department_id === null ? undefined : departmentsById.get(exception.department_id)
        const label = target
          ? t('orgDepartments.exceptions.placedIn', { name: bidi(departmentName(target, lang)) })
          : t('orgDepartments.exceptions.outside')
        return (
          <span className="org-card-marker" title={label}>
            <span aria-hidden>{t('orgDepartments.badge.exception')}</span>
            <span className="sr-only">{label}</span>
          </span>
        )
      }
    : undefined

  return (
    <div className={cn('grid gap-4', canManage && 'min-[1200px]:grid-cols-[minmax(0,1fr)_360px]')}>
      <div ref={treeRef} className="min-w-0 scroll-mt-4 space-y-3">
        <p className="max-w-[80ch] text-[0.84em] leading-relaxed text-muted-foreground">
          {t(!canManage ? 'orgDepartments.introLinksOnly' : has('employees.edit') ? 'orgDepartments.intro' : 'orgDepartments.introDepartmentsOnly')}
        </p>
        <OrgTreeWorkspace
          editable
          renderCardAction={renderCardAction}
          renderCardMarker={renderCardMarker}
          focus={focus}
        />
      </div>

      {canManage && (
        <aside aria-label={t('orgDepartments.side.label')} className="min-w-0 space-y-4 min-[1200px]:sticky min-[1200px]:top-4 min-[1200px]:max-h-[calc(100dvh-2rem)] min-[1200px]:self-start min-[1200px]:overflow-y-auto min-[1200px]:[scrollbar-width:thin]">
          <DepartmentScopingCard />

          <section aria-labelledby="org-dept-list" className={CARD}>
            <h2 id="org-dept-list" className={HEADING}>{t('orgDepartments.side.departments')}</h2>
            {departments.isPending ? <Skeleton className="mt-3 h-24 w-full rounded-xl" /> : departments.isError ? (
              <QueryFailure error={departments.error} retry={() => void departments.refetch()} />
            ) : departments.data.length === 0 ? (
              <p className="mt-2 text-[0.82em] text-muted-foreground">{t('orgDepartments.side.empty')}</p>
            ) : (
              <ul className="mt-2 divide-y divide-hairline">
                {orderDepartments(departments.data).map(({ department, depth }) => {
                  const head = peopleById.get(department.head_employee_id)
                  return (
                    <li key={department.id} className="flex items-start gap-2 py-2.5" style={{ paddingInlineStart: `${depth * 1.1}rem` }}>
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-1.5">
                          <bdi className="break-words text-[0.88em] font-semibold text-foreground">{departmentName(department, lang)}</bdi>
                          {!department.active && <span className="rounded-full bg-surface-tinted px-2 py-px text-[0.7em] font-medium text-muted-foreground">{t('orgDepartments.side.inactive')}</span>}
                        </p>
                        <p className="mt-0.5 text-[0.76em] text-muted-foreground">
                          {t('orgDepartments.side.head', { name: bidi(departmentHeadName(department, lang)) })}
                        </p>
                        <p className="mt-0.5 flex flex-wrap gap-x-3 text-[0.74em] text-muted-foreground">
                          <span>{t('orgDepartments.side.employeeCount', { count: department.employee_count })}</span>
                          {department.deputies.length > 0 && <span>{t('orgDepartments.side.deputyCount', { count: department.deputies.length })}</span>}
                          {department.viewers.length > 0 && <span>{t('orgDepartments.side.viewerCount', { count: department.viewers.length })}</span>}
                        </p>
                        {(!departmentHasReceiver(department) || department.service_ids.length === 0) && (
                          <p className="mt-1 flex flex-wrap gap-x-3 text-[0.74em] font-medium text-warning">
                            {!departmentHasReceiver(department) && <span className="inline-flex items-center gap-1"><AlertTriangle className="h-3 w-3" aria-hidden />{t('orgDepartments.side.noReceiver')}</span>}
                            {department.service_ids.length === 0 && <span className="inline-flex items-center gap-1"><AlertTriangle className="h-3 w-3" aria-hidden />{t('orgDepartments.side.noServices')}</span>}
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center">
                        <button type="button" className={LINK_BUTTON} onClick={() => showInTree(department.head_employee_id)} aria-label={t('orgDepartments.showPersonInTree', { name: departmentHeadName(department, lang) })}>
                          <Crosshair className="h-3.5 w-3.5" aria-hidden />
                        </button>
                        {head && personMenu(
                          head,
                          <button type="button" className={LINK_BUTTON} aria-label={t('orgDepartments.actions.menu', { name: nameOf(head) })}>
                            <MoreHorizontal className="h-4 w-4" aria-hidden />
                          </button>,
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          <section aria-labelledby="org-dept-unassigned" className={CARD}>
            <h2 id="org-dept-unassigned" className={HEADING}>{t('orgDepartments.unassigned.title')}</h2>
            <p className="mt-1 text-[0.78em] text-muted-foreground">{t('orgDepartments.unassigned.description')}</p>
            {unassigned.isPending ? <Skeleton className="mt-3 h-16 w-full rounded-xl" /> : unassigned.isError ? (
              <QueryFailure error={unassigned.error} retry={() => void unassigned.refetch()} />
            ) : unassigned.data.length === 0 ? (
              <p className="mt-2 text-[0.82em] text-muted-foreground">{t('orgDepartments.unassigned.empty')}</p>
            ) : (
              <ul className="mt-2 divide-y divide-hairline">
                {unassigned.data.map((group) => {
                  const top = nameOf({ name_en: group.top_name_en, name_ar: group.top_name_ar })
                  return (
                    <li key={group.top_employee_id} className="flex items-start gap-2 py-2.5">
                      <div className="min-w-0 flex-1 text-[0.8em]">
                        <p className="break-words font-medium text-foreground">{t('orgDepartments.unassigned.under', { name: bidi(top) })}</p>
                        <p className="mt-0.5 text-muted-foreground">
                          <bdi>{group.duty_unit || t('orgDepartments.unassigned.noUnit')}</bdi>
                          {' · '}
                          {t('orgDepartments.side.employeeCount', { count: group.count })}
                        </p>
                      </div>
                      <button type="button" className={LINK_BUTTON} onClick={() => showInTree(group.top_employee_id)}>
                        <Crosshair className="h-3.5 w-3.5" aria-hidden />
                        {t('orgDepartments.showInTree')}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          <section aria-labelledby="org-dept-exceptions" className={CARD}>
            <h2 id="org-dept-exceptions" className={HEADING}>{t('orgDepartments.exceptions.title')}</h2>
            <p className="mt-1 text-[0.78em] text-muted-foreground">{t('orgDepartments.exceptions.description')}</p>
            {exceptions.isPending ? <Skeleton className="mt-3 h-16 w-full rounded-xl" /> : exceptions.isError ? (
              <QueryFailure error={exceptions.error} retry={() => void exceptions.refetch()} />
            ) : exceptions.data.length === 0 ? (
              <p className="mt-2 text-[0.82em] text-muted-foreground">{t('orgDepartments.exceptions.empty')}</p>
            ) : (
              <ul className="mt-2 divide-y divide-hairline">
                {exceptions.data.map((exception) => (
                  <ExceptionRow
                    key={exception.employee_id}
                    exception={exception}
                    departmentsById={departmentsById}
                    clearing={clearException.isPending && clearException.variables === exception.employee_id}
                    onShow={() => showInTree(exception.employee_id)}
                    onClear={() => clearException.mutate(exception.employee_id)}
                  />
                ))}
              </ul>
            )}
          </section>
        </aside>
      )}

      {action?.kind === 'create' && <DepartmentFormDialog head={action.person} onClose={() => setAction(null)} />}
      {action?.kind === 'edit' && <DepartmentFormDialog department={action.department} onClose={() => setAction(null)} />}
      {action?.kind === 'people' && <DepartmentPeopleDialog department={action.department} onClose={() => setAction(null)} />}
      {action?.kind === 'services' && <DepartmentServicesDialog department={action.department} onClose={() => setAction(null)} />}
      {action?.kind === 'exception' && <DepartmentExceptionDialog person={action.person} onClose={() => setAction(null)} />}
    </div>
  )
}

function ExceptionRow({ exception, departmentsById, clearing, onShow, onClear }: {
  exception: DepartmentExceptionRead
  departmentsById: Map<number, DepartmentRead>
  clearing: boolean
  onShow: () => void
  onClear: () => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const target = exception.department_id === null ? undefined : departmentsById.get(exception.department_id)
  const fromTree = exception.tree_department_id === null ? undefined : departmentsById.get(exception.tree_department_id)
  return (
    <li className="flex items-start gap-2 py-2.5">
      <div className="min-w-0 flex-1 text-[0.8em]">
        <bdi className="block break-words font-medium text-foreground">{pickEmployeeName(exception, lang)}</bdi>
        <p className="mt-0.5 text-foreground">
          {target
            ? t('orgDepartments.exceptions.placedIn', { name: bidi(departmentName(target, lang)) })
            : t('orgDepartments.exceptions.outside')}
        </p>
        <p className="mt-0.5 text-muted-foreground">
          {fromTree
            ? t('orgDepartments.exceptions.treeGives', { name: bidi(departmentName(fromTree, lang)) })
            : t('orgDepartments.exceptions.treeGivesNone')}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end">
        <button type="button" className={LINK_BUTTON} onClick={onShow}>
          <Crosshair className="h-3.5 w-3.5" aria-hidden />
          {t('orgDepartments.showInTree')}
        </button>
        <button type="button" className={cn(LINK_BUTTON, 'text-accent')} disabled={clearing} aria-busy={clearing || undefined} onClick={onClear}>
          {t('orgDepartments.exceptions.clear')}
        </button>
      </div>
    </li>
  )
}

function QueryFailure({ error, retry }: { error: unknown; retry: () => void }): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <p role="alert" className="mt-2 text-[0.82em] text-accent">
      {departmentErrorMessage(error, t)}{' '}
      <button type="button" className="underline" onClick={retry}>{t('departments.retry')}</button>
    </p>
  )
}
