/**
 * One department: who is in it and why, who can act for it, and its settings.
 * People is the default; Access & services and Settings need
 * `departments.manage`.
 */

import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Network, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api, type DepartmentRead, type OrgNodeRead } from '@/lib/api'
import { bidi } from '@/lib/bidi'
import {
  departmentDescendantIds,
  departmentErrorMessage,
  departmentHasReceiver,
  departmentHeadName,
  departmentName,
  invalidateDepartmentData,
} from '@/lib/departments'
import { pickEmployeeName } from '@/lib/employeeName'
import { cn } from '@/lib/utils'
import {
  ChangeHeadDialog,
  DepartmentPeopleDialog,
  DepartmentServicesDialog,
  PlacementDialog,
  ReportingChartDialog,
  type GrantRole,
} from './DepartmentDialogs'
import { DraftNameFields } from './DepartmentDraft'
import { draftNamesSchema, matchesPerson, serviceLabel, type DraftNames } from './labels'
import { departmentPath, whyIncluded, type OrgIndex, type WhyIncluded } from './model'
import { BackLink, LABEL, LINK_BUTTON, LiveEditsNotice, PANEL, QueryFailure } from './ui'
import { useOrgData, type DepartmentSection, type OrgRoute } from './useOrgData'

export function DepartmentPage({ route, go }: { route: OrgRoute; go: (next: Partial<OrgRoute>) => void }): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const { canManage, departments, departmentsById, limitsOn } = useOrgData()
  const [chart, setChart] = useState(false)
  const department = route.departmentId === null ? undefined : departmentsById.get(route.departmentId)

  if (departments.isPending) return <Skeleton className="h-96 w-full rounded-2xl" />
  if (departments.isError) return <QueryFailure error={departments.error} retry={() => void departments.refetch()} />
  if (!department) {
    return (
      <div className="space-y-3">
        <BackLink onClick={() => go({})} />
        <p className="text-[0.9em] text-muted-foreground">{t('orgDepartments.department.missing')}</p>
      </div>
    )
  }

  const path = departmentPath(departments.data, department.id)
  const section: DepartmentSection = canManage ? route.section : 'people'
  const name = departmentName(department, lang)

  return (
    <div className="space-y-5">
      <BackLink onClick={() => go({})} />
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h2 className="flex flex-wrap items-center gap-2 break-words text-[1.4em] font-semibold tracking-tight text-foreground">
            <bdi>{name}</bdi>
            {!department.active && (
              <span className="rounded-full bg-surface-tinted px-2.5 py-0.5 text-[0.55em] font-semibold text-muted-foreground">{t('orgDepartments.register.inactive')}</span>
            )}
          </h2>
          <p className="mt-1 text-[0.88em] text-foreground">
            {t('orgDepartments.register.headLine', { name: bidi(departmentHeadName(department, lang)) })}
          </p>
          <p className="mt-0.5 text-[0.84em] text-muted-foreground">
            {path.length
              ? t('orgDepartments.preview.partOf', { name: bidi(path.map((item) => departmentName(item, lang)).join(' › ')) })
              : t('orgDepartments.preview.topLevel')}
          </p>
        </div>
        <Button variant="outline" className="min-h-11" onClick={() => setChart(true)}>
          <Network className="h-4 w-4" aria-hidden />
          {t('orgDepartments.chart.open')}
        </Button>
      </header>
      <LiveEditsNotice show={canManage && limitsOn} />

      <Tabs value={section} onValueChange={(next) => go({ view: 'department', departmentId: department.id, section: next as DepartmentSection })}>
        {canManage && (
          <TabsList aria-label={name} className="overflow-x-auto [scrollbar-width:none]">
            <TabsTrigger value="people">{t('orgDepartments.department.tabs.people')}</TabsTrigger>
            <TabsTrigger value="access">{t('orgDepartments.department.tabs.access')}</TabsTrigger>
            <TabsTrigger value="settings">{t('orgDepartments.department.tabs.settings')}</TabsTrigger>
          </TabsList>
        )}
        <div role={canManage ? 'tabpanel' : undefined} className="mt-5">
          {section === 'people' && <PeopleSection department={department} initialQuery={route.query} />}
          {section === 'access' && <AccessSection department={department} />}
          {section === 'settings' && <SettingsSection key={department.id} department={department} onDeleted={() => go({})} />}
        </div>
      </Tabs>

      {chart && <ReportingChartDialog department={department} onClose={() => setChart(false)} />}
    </div>
  )
}

// ── People ─────────────────────────────────────────────────────────────────

function whyLabel(why: WhyIncluded, index: OrgIndex, lang: string, t: (key: string, options?: Record<string, unknown>) => string): string {
  switch (why.kind) {
    case 'placedThrough':
    case 'outsideThrough': {
      const through = index.byId.get(why.employeeId)
      return t(`orgDepartments.why.${why.kind}`, { name: bidi(through ? pickEmployeeName(through, lang) : why.employeeId) })
    }
    default:
      return t(`orgDepartments.why.${why.kind}`)
  }
}

function PeopleSection({ department, initialQuery }: { department: DepartmentRead; initialQuery: string }): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const { canManage, tree, departments, exceptions, index, departmentsById } = useOrgData()
  const [scope, setScope] = useState<'this' | 'all'>('this')
  const [query, setQuery] = useState(initialQuery)
  const [placing, setPlacing] = useState<OrgNodeRead | null>(null)

  const ids = useMemo(
    () => scope === 'this' ? new Set([department.id]) : departmentDescendantIds(departments.data ?? [], department.id),
    [department.id, departments.data, scope],
  )
  // The head first, then sub-department heads, then everyone else in tree order.
  const members = useMemo(() => {
    const rank = (person: OrgNodeRead): number => person.id === department.head_employee_id
      ? 0
      : person.head_of_department_id != null && ids.has(person.head_of_department_id) ? 1 : 2
    return (tree.data ?? [])
      .filter((person) => person.department_id != null && ids.has(person.department_id))
      .sort((a, b) => rank(a) - rank(b))
  }, [department.head_employee_id, ids, tree.data])
  const ownCount = useMemo(() => (tree.data ?? []).filter((person) => person.department_id === department.id).length, [department.id, tree.data])
  const allCount = useMemo(() => {
    const every = departmentDescendantIds(departments.data ?? [], department.id)
    return (tree.data ?? []).filter((person) => person.department_id != null && every.has(person.department_id)).length
  }, [department.id, departments.data, tree.data])
  const hasSubDepartments = allCount !== ownCount || (departments.data ?? []).some((item) => item.parent_id === department.id)
  const visible = members.filter((person) => matchesPerson(person, query))
  const showWhy = canManage && exceptions.isSuccess
  const why = (person: OrgNodeRead): WhyIncluded => whyIncluded(index, departments.data ?? [], exceptions.data ?? [], person.id)
  const supervisorName = (person: OrgNodeRead): string => {
    const supervisor = index.supervisorOf(person.id)
    const found = supervisor ? index.byId.get(supervisor) : undefined
    return found ? pickEmployeeName(found, lang) : t('orgDepartments.reporting.noSupervisor')
  }
  const departmentOf = (person: OrgNodeRead): string => {
    const item = person.department_id == null ? undefined : departmentsById.get(person.department_id)
    return item ? departmentName(item, lang) : ''
  }

  if (tree.isPending) return <Skeleton className="h-64 w-full rounded-2xl" />
  if (tree.isError) return <QueryFailure error={tree.error} retry={() => void tree.refetch()} />

  return (
    <div className="space-y-3">
      {canManage && <p className="max-w-[72ch] text-[0.86em] text-muted-foreground">{t('orgDepartments.people.intro')}</p>}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        {hasSubDepartments && (
          <div role="group" aria-label={t('orgDepartments.people.scope')} className="inline-flex shrink-0 overflow-hidden rounded-lg border border-border">
            {(['this', 'all'] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={scope === value}
                onClick={() => setScope(value)}
                className={cn(
                  'min-h-11 px-3.5 text-[0.86em] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                  scope === value ? 'bg-primary text-primary-foreground' : 'bg-surface text-muted-foreground hover:bg-surface-tinted',
                )}
              >
                {t(value === 'this' ? 'orgDepartments.people.thisDepartment' : 'orgDepartments.people.withSub', { count: value === 'this' ? ownCount : allCount })}
              </button>
            ))}
          </div>
        )}
        <label className="flex min-h-11 flex-1 items-center gap-2 rounded-lg border border-border bg-surface px-3 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="sr-only">{t('orgDepartments.people.search')}</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('orgDepartments.people.search')}
            data-pill-input
            className="min-w-0 flex-1 bg-transparent py-2 text-[0.9em] outline-none placeholder:text-muted-foreground"
          />
        </label>
      </div>
      <p role="status" className="text-[0.8em] text-muted-foreground">{t('orgDepartments.people.count', { count: visible.length })}</p>

      {visible.length === 0 ? (
        <p className="py-3 text-[0.88em] text-muted-foreground">{t(members.length ? 'common.noResults' : 'orgDepartments.people.empty')}</p>
      ) : (
        <>
          <div className={cn(PANEL, 'hidden overflow-hidden md:block')}>
            <table className="w-full text-[0.88em]">
              <thead className="bg-surface-raised">
                <tr className="border-b border-hairline">
                  <th scope="col" className="px-4 py-2.5 text-start font-medium text-muted-foreground">{t('orgDepartments.people.colName')}</th>
                  <th scope="col" className="px-4 py-2.5 text-start font-medium text-muted-foreground">{t('orgDepartments.people.colSupervisor')}</th>
                  {scope === 'all' && <th scope="col" className="px-4 py-2.5 text-start font-medium text-muted-foreground">{t('orgDepartments.people.colDepartment')}</th>}
                  {showWhy && <th scope="col" className="px-4 py-2.5 text-start font-medium text-muted-foreground">{t('orgDepartments.people.colWhy')}</th>}
                  {canManage && <th scope="col" className="px-4 py-2.5"><span className="sr-only">{t('common.actions')}</span></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {visible.map((person) => {
                  const reason = showWhy ? why(person) : undefined
                  const byHand = reason && reason.kind !== 'head' && reason.kind !== 'reporting'
                  return (
                    <tr key={person.id} className="align-top">
                      <td className="px-4 py-2.5">
                        <bdi className="block break-words font-medium text-foreground">{pickEmployeeName(person, lang)}</bdi>
                        <bdi dir="ltr" className="font-mono text-[0.84em] text-muted-foreground">{person.id}</bdi>
                      </td>
                      <td className="px-4 py-2.5"><bdi className="break-words">{supervisorName(person)}</bdi></td>
                      {scope === 'all' && <td className="px-4 py-2.5"><bdi>{departmentOf(person)}</bdi></td>}
                      {reason && <td className={cn('px-4 py-2.5', byHand ? 'font-medium text-foreground' : 'text-muted-foreground')}>{whyLabel(reason, index, lang, t)}</td>}
                      {canManage && (
                        <td className="px-4 py-1.5 text-end">
                          {reason?.kind !== 'head' && (
                            <button type="button" className={LINK_BUTTON} onClick={() => setPlacing(person)}>
                              {t('orgDepartments.people.reviewPlacement')}
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <ul className={cn(PANEL, 'divide-y divide-hairline md:hidden')}>
            {visible.map((person) => {
              const reason = showWhy ? why(person) : undefined
              return (
                <li key={person.id} className="px-4 py-3 text-[0.88em]">
                  <bdi className="block break-words font-medium text-foreground">{pickEmployeeName(person, lang)}</bdi>
                  <p className="mt-0.5 text-[0.9em] text-muted-foreground">
                    {t('orgDepartments.people.reportsTo', { name: bidi(supervisorName(person)) })}
                    {scope === 'all' && <> · <bdi>{departmentOf(person)}</bdi></>}
                  </p>
                  {reason && <p className="mt-0.5 text-[0.9em] text-foreground">{whyLabel(reason, index, lang, t)}</p>}
                  {canManage && reason?.kind !== 'head' && (
                    <button type="button" className={cn(LINK_BUTTON, '-ms-2')} onClick={() => setPlacing(person)}>
                      {t('orgDepartments.people.reviewPlacement')}
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        </>
      )}
      {placing && <PlacementDialog person={placing} onClose={() => setPlacing(null)} />}
    </div>
  )
}

// ── Access & services ──────────────────────────────────────────────────────

function AccessSection({ department }: { department: DepartmentRead }): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const [editing, setEditing] = useState<GrantRole | 'services' | null>(null)
  const [extraOpen, setExtraOpen] = useState(department.viewers.length > 0)
  const options = useQuery({ queryKey: ['departments', 'service-options'], queryFn: () => api.departments.serviceOptions() })
  const services = (options.data ?? []).filter((service) => department.service_ids.includes(service.id))
  const SECTION = cn(PANEL, 'space-y-2.5 px-4 py-4')

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section aria-labelledby="dept-receivers" className={SECTION}>
        <h3 id="dept-receivers" className="text-[1em] font-semibold text-foreground">{t('orgDepartments.access.receiversTitle')}</h3>
        <p className="text-[0.84em] text-muted-foreground">{t('orgDepartments.access.receiversHint')}</p>
        <p className="text-[0.88em] text-foreground">
          {t('orgDepartments.register.headLine', { name: bidi(departmentHeadName(department, lang)) })}
          {' · '}
          <span className={department.head_user_id === null ? 'font-medium text-warning' : 'text-muted-foreground'}>
            {t(department.head_user_id === null ? 'orgDepartments.access.headNoAccount' : 'orgDepartments.access.headHasAccount')}
          </span>
        </p>
        <p className={LABEL}>{t('orgDepartments.access.deputies')}</p>
        {department.deputies.length === 0 ? (
          <p className="text-[0.86em] text-muted-foreground">{t('orgDepartments.access.noDeputies')}</p>
        ) : (
          <ul className="space-y-0.5 text-[0.88em]">{department.deputies.map((person) => <li key={person.user_id}><bdi>{person.display_name}</bdi></li>)}</ul>
        )}
        {!departmentHasReceiver(department) && (
          <p className="flex items-start gap-1.5 text-[0.84em] font-medium text-warning">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            {t('orgDepartments.attention.noReceiverLong')}
          </p>
        )}
        <Button variant="outline" className="min-h-11" onClick={() => setEditing('deputy')}>{t('orgDepartments.access.chooseDeputies')}</Button>
      </section>

      <section aria-labelledby="dept-services" className={SECTION}>
        <h3 id="dept-services" className="text-[1em] font-semibold text-foreground">{t('orgDepartments.access.servicesTitle')}</h3>
        <p className="text-[0.84em] text-muted-foreground">{t('orgDepartments.services.hint')}</p>
        {options.isError ? <QueryFailure error={options.error} retry={() => void options.refetch()} /> : department.service_ids.length === 0 ? (
          <p className="flex items-start gap-1.5 text-[0.86em] font-medium text-warning">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            {t('orgDepartments.access.noServices')}
          </p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {services.map((service) => (
              <li key={service.id} className="rounded-full bg-surface-tinted px-2.5 py-1 text-[0.82em] text-foreground"><bdi>{serviceLabel(service, lang)}</bdi></li>
            ))}
          </ul>
        )}
        <Button variant="outline" className="min-h-11" onClick={() => setEditing('services')}>{t('orgDepartments.attention.noServices')}</Button>
      </section>

      <section aria-labelledby="dept-extra" className={cn(SECTION, 'lg:col-span-2')}>
        <h3 id="dept-extra" className="text-[1em] font-semibold text-foreground">{t('orgDepartments.access.extraTitle')}</h3>
        {!extraOpen ? (
          <>
            <p className="text-[0.84em] text-muted-foreground">{t('orgDepartments.access.extraCollapsed')}</p>
            <button type="button" className={cn(LINK_BUTTON, '-ms-2')} aria-expanded={false} onClick={() => setExtraOpen(true)}>
              {t('orgDepartments.access.extraShow')}
            </button>
          </>
        ) : (
          <>
            <p className="max-w-[80ch] text-[0.84em] text-muted-foreground">{t('orgDepartments.access.extraHint')}</p>
            {department.viewers.length === 0 ? (
              <p className="text-[0.86em] text-muted-foreground">{t('orgDepartments.access.noExtra')}</p>
            ) : (
              <ul className="space-y-0.5 text-[0.88em]">{department.viewers.map((person) => <li key={person.user_id}><bdi>{person.display_name}</bdi></li>)}</ul>
            )}
            <Button variant="outline" className="min-h-11" onClick={() => setEditing('viewer')}>{t('orgDepartments.access.chooseExtra')}</Button>
          </>
        )}
      </section>

      {(editing === 'deputy' || editing === 'viewer') && <DepartmentPeopleDialog department={department} role={editing} onClose={() => setEditing(null)} />}
      {editing === 'services' && <DepartmentServicesDialog department={department} onClose={() => setEditing(null)} />}
    </div>
  )
}

// ── Settings ───────────────────────────────────────────────────────────────

function SettingsSection({ department, onDeleted }: { department: DepartmentRead; onDeleted: () => void }): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const qc = useQueryClient()
  const { index } = useOrgData()
  const [changingHead, setChangingHead] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const form = useForm<DraftNames>({
    resolver: zodResolver(draftNamesSchema(t)),
    defaultValues: { name_en: department.name_en, name_ar: department.name_ar },
  })
  const saveNames = useMutation({
    mutationFn: (values: DraftNames) => api.departments.update(department.id, values),
    onSuccess: (updated) => {
      invalidateDepartmentData(qc)
      form.reset({ name_en: updated.name_en, name_ar: updated.name_ar })
      toast.success(t('orgDepartments.form.saved'))
    },
    onError: (error) => toast.error(departmentErrorMessage(error, t)),
  })
  const setActive = useMutation({
    mutationFn: (active: boolean) => api.departments.update(department.id, { active }),
    onSuccess: (updated) => {
      invalidateDepartmentData(qc)
      toast.success(t(updated.active ? 'orgDepartments.settings.activated' : 'orgDepartments.settings.deactivated'))
    },
    onError: (error) => toast.error(departmentErrorMessage(error, t)),
  })
  const remove = useMutation({
    mutationFn: () => api.departments.delete(department.id),
    onSuccess: () => {
      invalidateDepartmentData(qc)
      toast.success(t('orgDepartments.form.deleted'))
      onDeleted()
    },
    onError: (error) => toast.error(departmentErrorMessage(error, t)),
  })
  const head = index.byId.get(department.head_employee_id)
  const SECTION = cn(PANEL, 'space-y-3 px-4 py-4')
  const name = bidi(departmentName(department, lang))

  return (
    <div className="max-w-[880px] space-y-4">
      <section aria-labelledby="dept-names" className={SECTION}>
        <h3 id="dept-names" className="text-[1em] font-semibold text-foreground">{t('orgDepartments.settings.namesTitle')}</h3>
        <form onSubmit={form.handleSubmit((values) => saveNames.mutate(values))} noValidate className="space-y-3">
          {head ? (
            <DraftNameFields
              person={head}
              disabled={saveNames.isPending}
              fields={{ name_en: form.register('name_en'), name_ar: form.register('name_ar') }}
              errors={{ name_en: form.formState.errors.name_en?.message, name_ar: form.formState.errors.name_ar?.message }}
              onSuggest={(field, value) => form.setValue(field, value, { shouldDirty: true, shouldValidate: true })}
            />
          ) : null}
          <Button type="submit" className="min-h-11" disabled={!form.formState.isDirty || saveNames.isPending} aria-busy={saveNames.isPending || undefined}>
            {t(saveNames.isPending ? 'orgDepartments.form.saving' : 'orgDepartments.form.save')}
          </Button>
        </form>
      </section>

      <section aria-labelledby="dept-head" className={SECTION}>
        <h3 id="dept-head" className="text-[1em] font-semibold text-foreground">{t('orgDepartments.settings.headTitle')}</h3>
        <p className="text-[0.88em] text-foreground">{t('orgDepartments.register.headLine', { name: bidi(departmentHeadName(department, lang)) })}</p>
        <p className="max-w-[72ch] text-[0.84em] text-muted-foreground">{t('orgDepartments.settings.headHint')}</p>
        <Button variant="outline" className="min-h-11" onClick={() => setChangingHead(true)}>{t('orgDepartments.changeHead.open')}</Button>
      </section>

      <section aria-labelledby="dept-active" className={SECTION}>
        <h3 id="dept-active" className="text-[1em] font-semibold text-foreground">{t('orgDepartments.settings.activeTitle')}</h3>
        <p className="max-w-[72ch] text-[0.84em] text-muted-foreground">{t('orgDepartments.form.activeHint')}</p>
        <Button
          variant="outline"
          className="min-h-11"
          disabled={setActive.isPending}
          aria-busy={setActive.isPending || undefined}
          onClick={() => setActive.mutate(!department.active)}
        >
          {t(department.active ? 'orgDepartments.settings.deactivate' : 'orgDepartments.settings.activate')}
        </Button>
      </section>

      <section aria-labelledby="dept-delete" className={SECTION}>
        <h3 id="dept-delete" className="text-[1em] font-semibold text-foreground">{t('orgDepartments.settings.deleteTitle')}</h3>
        <p className="max-w-[72ch] text-[0.84em] text-muted-foreground">{t('orgDepartments.form.deleteHint')}</p>
        <Button variant="outline" className="min-h-11 border-accent/40 text-accent hover:bg-accent-soft" disabled={remove.isPending} onClick={() => setConfirmDelete(true)}>
          {t('orgDepartments.settings.delete')}
        </Button>
      </section>

      {changingHead && <ChangeHeadDialog department={department} onClose={() => setChangingHead(false)} />}
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t('orgDepartments.form.confirmDelete', { name })}
        description={t('orgDepartments.form.deleteHint')}
        confirmLabel={t('orgDepartments.settings.delete')}
        destructive
        onConfirm={() => { if (!remove.isPending) remove.mutate() }}
      />
    </div>
  )
}
