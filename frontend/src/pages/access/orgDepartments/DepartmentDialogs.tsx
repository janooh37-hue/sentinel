/**
 * Sheets behind Organization & departments: add one department, choose
 * deputies or extra department access, choose services, change the head,
 * place someone by hand, and the read-only reporting chart of a department.
 *
 * Every write changes the derived tree, so each success refreshes the
 * department, tree, employee and session-scoped caches together.
 */

import { useId, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { DepartmentPicker } from '@/components/departments/DepartmentPicker'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { api, type DepartmentRead, type OrgNodeRead } from '@/lib/api'
import { bidi } from '@/lib/bidi'
import { departmentErrorMessage, departmentHeadName, departmentName, invalidateDepartmentData } from '@/lib/departments'
import { pickEmployeeName } from '@/lib/employeeName'
import { OrgTreeView } from '@/pages/employees/orgTree/OrgTreeView'
import { DraftNameFields, DraftPreviewSummary } from './DepartmentDraft'
import { draftNamesSchema, serviceLabel, type DraftNames } from './labels'
import { deriveMembership, deriveParents, membershipChanges, previewDrafts, type Placement } from './model'
import { PersonSearch } from './PersonSearch'
import { LINK_BUTTON, LiveEditsNotice, QueryFailure, Sheet, SheetFooter } from './ui'
import { useOrgData } from './useOrgData'

function useHeadLabels() {
  const { t, i18n } = useTranslation()
  const { departments, exceptions } = useOrgData()
  const lang = i18n.language
  /** Why someone can't become a head, in the words the admin acts on. */
  return (person: OrgNodeRead, current?: DepartmentRead): string | null => {
    const headed = (departments.data ?? []).find((department) => department.head_employee_id === person.id)
    if (headed && headed.id === current?.id) return t('orgDepartments.headPicker.currentHead')
    if (headed) return t('orgDepartments.headPicker.alreadyHeads', { name: bidi(departmentName(headed, lang)) })
    if ((exceptions.data ?? []).some((exception) => exception.employee_id === person.id)) return t('orgDepartments.headPicker.placedByHand')
    return null
  }
}

// ── Add one department ─────────────────────────────────────────────────────

export function AddDepartmentDialog({ initialHeadId, note, onClose, onCreated }: {
  initialHeadId?: string
  /** What happens after creation, e.g. the account waiting for a grant here. */
  note?: React.ReactNode
  onClose: () => void
  onCreated?: (department: DepartmentRead) => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const qc = useQueryClient()
  const { tree, departments, exceptions, index, departmentsById, limitsOn } = useOrgData()
  const headBlock = useHeadLabels()
  const [headId, setHeadId] = useState<string | null>(initialHeadId ?? null)
  const head = headId ? index.byId.get(headId) : undefined
  const form = useForm<DraftNames>({ resolver: zodResolver(draftNamesSchema(t)), defaultValues: { name_en: '', name_ar: '' } })
  const preview = useMemo(
    () => head ? previewDrafts(index, departments.data ?? [], exceptions.data ?? [], [head.id])[0] : undefined,
    [departments.data, exceptions.data, head, index],
  )
  const create = useMutation({
    mutationFn: (values: DraftNames) => api.departments.create({ ...values, head_employee_id: head!.id }),
    onSuccess: (created) => {
      invalidateDepartmentData(qc)
      toast.success(t('orgDepartments.form.created'))
      onClose()
      onCreated?.(created)
    },
    onError: (error) => toast.error(departmentErrorMessage(error, t)),
  })
  const blocked = head ? headBlock(head) : null

  return (
    <Sheet
      title={t('orgDepartments.add.title')}
      description={t('orgDepartments.add.description')}
      onClose={onClose}
    >
      {!head ? (
        <div className="min-h-0 overflow-y-auto px-4 py-4">
          {tree.isError ? <QueryFailure error={tree.error} retry={() => void tree.refetch()} /> : (
            <PersonSearch
              autoFocus
              people={tree.data ?? []}
              label={t('orgDepartments.add.chooseHead')}
              onPick={(person) => setHeadId(person.id)}
              meta={(person) => t('orgDepartments.team', { count: index.branchSize(person.id) })}
              disabledReason={(person) => headBlock(person)}
            />
          )}
        </div>
      ) : (
        <form onSubmit={form.handleSubmit((values) => create.mutate(values))} noValidate className="flex min-h-0 flex-col">
          <div className="min-h-0 space-y-4 overflow-y-auto px-4 py-4">
            <LiveEditsNotice show={limitsOn} />
            {note ? <p className="rounded-xl bg-surface-tinted/60 px-3.5 py-2.5 text-[0.86em] text-foreground">{note}</p> : null}
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-[0.9em] text-foreground">
                {t('orgDepartments.add.headIs', { name: bidi(pickEmployeeName(head, lang)) })}
              </p>
              {!initialHeadId && (
                <button type="button" className={LINK_BUTTON} onClick={() => setHeadId(null)}>
                  {t('orgDepartments.add.chooseOther')}
                </button>
              )}
            </div>
            {blocked && <p role="alert" className="text-[0.86em] text-warning">{blocked}</p>}
            <DraftNameFields
              person={head}
              disabled={create.isPending}
              fields={{ name_en: form.register('name_en'), name_ar: form.register('name_ar') }}
              errors={{ name_en: form.formState.errors.name_en?.message, name_ar: form.formState.errors.name_ar?.message }}
              onSuggest={(field, value) => form.setValue(field, value, { shouldValidate: true })}
            />
            {preview && (
              <section aria-label={t('orgDepartments.preview.title')} className="rounded-xl bg-surface-tinted/60 px-3.5 py-3">
                <DraftPreviewSummary preview={preview} index={index} departmentsById={departmentsById} draftName={() => ''} />
              </section>
            )}
          </div>
          <SheetFooter>
            <Button type="button" variant="outline" disabled={create.isPending} onClick={onClose}>{t('common.cancel')}</Button>
            <Button type="submit" disabled={create.isPending || blocked !== null} aria-busy={create.isPending || undefined}>
              {t(create.isPending ? 'orgDepartments.form.saving' : 'orgDepartments.form.create')}
            </Button>
          </SheetFooter>
        </form>
      )}
    </Sheet>
  )
}

// ── Change the head ────────────────────────────────────────────────────────

export function ChangeHeadDialog({ department, onClose }: {
  department: DepartmentRead
  onClose: () => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const qc = useQueryClient()
  const { tree, departments, exceptions, index, departmentsById, limitsOn } = useOrgData()
  const headBlock = useHeadLabels()
  const [candidate, setCandidate] = useState<OrgNodeRead | null>(null)
  const impact = useMemo(() => {
    if (!candidate) return null
    const all = departments.data ?? []
    const before = deriveMembership(index, all, exceptions.data ?? [])
    const edited = all.map((item) => item.id === department.id ? { ...item, head_employee_id: candidate.id } : item)
    const after = deriveMembership(index, edited, exceptions.data ?? [])
    const count = (membership: Map<string, number | null>): number => [...membership].filter(([id, value]) => value === department.id && index.isWorking(id)).length
    const parentId = deriveParents(index, edited, after).get(department.id) ?? null
    return {
      before: count(before),
      after: count(after),
      moved: membershipChanges(before, after, index.isWorking).length,
      parent: parentId === null ? undefined : departmentsById.get(parentId),
    }
  }, [candidate, department.id, departments.data, departmentsById, exceptions.data, index])
  const save = useMutation({
    mutationFn: (headId: string) => api.departments.update(department.id, { head_employee_id: headId }),
    onSuccess: () => {
      invalidateDepartmentData(qc)
      toast.success(t('orgDepartments.form.saved'))
      onClose()
    },
    onError: (error) => toast.error(departmentErrorMessage(error, t)),
  })
  const name = bidi(departmentName(department, lang))

  return (
    <Sheet
      title={t('orgDepartments.changeHead.title', { name })}
      description={t('orgDepartments.changeHead.description', { name: bidi(departmentHeadName(department, lang)) })}
      onClose={onClose}
    >
      <div className="min-h-0 space-y-4 overflow-y-auto px-4 py-4">
        <LiveEditsNotice show={limitsOn} />
        {!candidate ? (
          tree.isError ? <QueryFailure error={tree.error} retry={() => void tree.refetch()} /> : (
            <PersonSearch
              autoFocus
              people={tree.data ?? []}
              label={t('orgDepartments.changeHead.search')}
              onPick={setCandidate}
              meta={(person) => t('orgDepartments.team', { count: index.branchSize(person.id) })}
              disabledReason={(person) => headBlock(person, department)}
            />
          )
        ) : (
          <div className="space-y-2 text-[0.88em] text-foreground">
            <p className="font-semibold">{t('orgDepartments.changeHead.newHead', { name: bidi(pickEmployeeName(candidate, lang)) })}</p>
            {impact && (
              <>
                <p>{t('orgDepartments.changeHead.people', { count: impact.after, before: impact.before })}</p>
                <p className="text-muted-foreground">
                  {impact.parent
                    ? t('orgDepartments.preview.partOf', { name: bidi(departmentName(impact.parent, lang)) })
                    : t('orgDepartments.preview.topLevel')}
                </p>
                {impact.moved > 0 && <p className="text-muted-foreground">{t('orgDepartments.changeHead.moved', { count: impact.moved })}</p>}
              </>
            )}
            <button type="button" className={LINK_BUTTON} onClick={() => setCandidate(null)}>{t('orgDepartments.add.chooseOther')}</button>
          </div>
        )}
      </div>
      <SheetFooter>
        <Button type="button" variant="outline" disabled={save.isPending} onClick={onClose}>{t('common.cancel')}</Button>
        <Button
          type="button"
          disabled={!candidate || save.isPending}
          aria-busy={save.isPending || undefined}
          onClick={() => { if (candidate) save.mutate(candidate.id) }}
        >
          {t(save.isPending ? 'orgDepartments.form.saving' : 'orgDepartments.changeHead.save')}
        </Button>
      </SheetFooter>
    </Sheet>
  )
}

// ── Deputies, or extra department access ───────────────────────────────────

export type GrantRole = 'deputy' | 'viewer'

interface GrantRow {
  userId: number
  label: string
  email: string | null
}

export function DepartmentPeopleDialog({ department, role, onClose }: {
  department: DepartmentRead
  role: GrantRole
  onClose: () => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const id = useId()
  const qc = useQueryClient()
  const { limitsOn } = useOrgData()
  const [query, setQuery] = useState('')
  const own = role === 'deputy' ? department.deputies : department.viewers
  const other = role === 'deputy' ? department.viewers : department.deputies
  const otherIds = new Set(other.map((person) => person.user_id))
  // Existing grants come from the department itself, so a deputy whose
  // account went inactive stays visible (and removable).
  const [chosen, setChosen] = useState<Set<number>>(() => new Set(own.map((person) => person.user_id)))
  // The endpoint lists active accounts only: new grants never go to inactive users.
  const users = useQuery({ queryKey: ['departments', 'candidate-users'], queryFn: api.departments.candidateUsers })
  const rows = useMemo<GrantRow[]>(() => {
    const byId = new Map<number, GrantRow>(own.map((person) => [person.user_id, { userId: person.user_id, label: person.display_name, email: null }]))
    for (const user of users.data ?? []) {
      if (user.user_id === department.head_user_id) continue
      byId.set(user.user_id, { userId: user.user_id, label: user.display_name, email: user.email })
    }
    return [...byId.values()]
  }, [department.head_user_id, own, users.data])
  const needle = query.trim().toLocaleLowerCase()
  const assigned = rows.filter((row) => chosen.has(row.userId) || own.some((person) => person.user_id === row.userId))
  const matches = rows
    .filter((row) => !assigned.includes(row) && (!needle || [row.label, row.email ?? ''].some((value) => value.toLocaleLowerCase().includes(needle))))
    .slice(0, needle ? 50 : 12)
  const save = useMutation({
    mutationFn: () => {
      const mine = [...chosen]
      const theirs = other.map((person) => person.user_id)
      return api.departments.setPeople(department.id, role === 'deputy'
        ? { deputy_user_ids: mine, viewer_user_ids: theirs }
        : { deputy_user_ids: theirs, viewer_user_ids: mine })
    },
    onSuccess: () => {
      invalidateDepartmentData(qc)
      toast.success(t(`orgDepartments.grants.${role}.saved`))
      onClose()
    },
    onError: (error) => toast.error(departmentErrorMessage(error, t)),
  })
  const name = bidi(departmentName(department, i18n.language))

  function row(person: GrantRow): React.JSX.Element {
    const busyElsewhere = otherIds.has(person.userId)
    return (
      <li key={person.userId} className="border-b border-hairline last:border-0">
        <label className="flex min-h-12 cursor-pointer items-start gap-3 px-3 py-2.5 has-[:disabled]:cursor-not-allowed">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 shrink-0 accent-primary"
            checked={chosen.has(person.userId)}
            disabled={busyElsewhere}
            onChange={(event) => setChosen((current) => {
              const next = new Set(current)
              if (event.target.checked) next.add(person.userId)
              else next.delete(person.userId)
              return next
            })}
          />
          <span className="min-w-0 flex-1">
            <bdi className="block break-words text-[0.88em] font-medium text-foreground">{person.label}</bdi>
            {person.email && <bdi dir="ltr" className="block break-all text-[0.76em] text-muted-foreground">{person.email}</bdi>}
            {busyElsewhere && <span className="block text-[0.76em] text-muted-foreground">{t(`orgDepartments.grants.${role}.hasOther`)}</span>}
          </span>
        </label>
      </li>
    )
  }

  return (
    <Sheet
      title={t(`orgDepartments.grants.${role}.title`, { name })}
      description={t(`orgDepartments.grants.${role}.description`)}
      onClose={onClose}
    >
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto px-4 py-4">
        <LiveEditsNotice show={limitsOn} />
        {users.isPending ? <Skeleton className="h-40 w-full rounded-xl" /> : users.isError ? (
          <QueryFailure error={users.error} retry={() => void users.refetch()} />
        ) : (
          <fieldset disabled={save.isPending} className="min-w-0 space-y-3">
            <legend className="sr-only">{t(`orgDepartments.grants.${role}.title`, { name })}</legend>
            {assigned.length > 0 && <ul aria-label={t('orgDepartments.grants.chosen')} className="rounded-lg border border-hairline">{assigned.map(row)}</ul>}
            <label htmlFor={`${id}-q`} className="sr-only">{t('orgDepartments.grants.search')}</label>
            <div className="flex min-h-11 items-center gap-2 rounded-lg border border-border bg-surface px-2.5 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <input
                id={`${id}-q`}
                type="search"
                dir="auto"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('orgDepartments.grants.search')}
                data-pill-input
                className="min-w-0 flex-1 bg-transparent text-[0.88em] outline-none placeholder:text-muted-foreground"
              />
            </div>
            {matches.length === 0 ? (
              <p role="status" className="text-[0.84em] text-muted-foreground">{t('common.noResults')}</p>
            ) : (
              <ul className="max-h-72 overflow-y-auto rounded-lg border border-hairline">{matches.map(row)}</ul>
            )}
          </fieldset>
        )}
      </div>
      <SheetFooter>
        <Button type="button" variant="outline" disabled={save.isPending} onClick={onClose}>{t('common.cancel')}</Button>
        <Button type="button" disabled={save.isPending || !users.isSuccess} aria-busy={save.isPending || undefined} onClick={() => save.mutate()}>
          {t(save.isPending ? 'orgDepartments.form.saving' : 'common.save')}
        </Button>
      </SheetFooter>
    </Sheet>
  )
}

// ── Services ───────────────────────────────────────────────────────────────

export function DepartmentServicesDialog({ department, onClose }: {
  department: DepartmentRead
  onClose: () => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const qc = useQueryClient()
  const { limitsOn } = useOrgData()
  const options = useQuery({ queryKey: ['departments', 'service-options'], queryFn: () => api.departments.serviceOptions() })
  const schema = z.object({ service_ids: z.array(z.string()) })
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { service_ids: department.service_ids } })
  const save = useMutation({
    mutationFn: (values: z.infer<typeof schema>) => api.departments.setServices(department.id, values),
    onSuccess: () => {
      invalidateDepartmentData(qc)
      toast.success(t('orgDepartments.services.saved'))
      onClose()
    },
    onError: (error) => toast.error(departmentErrorMessage(error, t)),
  })
  return (
    <Sheet
      title={t('orgDepartments.services.title', { name: bidi(departmentName(department, i18n.language)) })}
      description={t('orgDepartments.services.hint')}
      onClose={onClose}
    >
      <form onSubmit={form.handleSubmit((values) => save.mutate(values))} className="flex min-h-0 flex-col">
        <div className="min-h-0 space-y-3 overflow-y-auto px-4 py-4">
          <LiveEditsNotice show={limitsOn} />
          {options.isPending ? <Skeleton className="h-28 w-full rounded-xl" /> : options.isError ? (
            <QueryFailure error={options.error} retry={() => void options.refetch()} />
          ) : (
            <fieldset disabled={save.isPending} className="grid min-w-0 gap-1 sm:grid-cols-2">
              <legend className="sr-only">{t('orgDepartments.services.title', { name: departmentName(department, i18n.language) })}</legend>
              {options.data.length === 0 && <p className="text-[0.86em] text-muted-foreground">{t('orgDepartments.services.noOptions')}</p>}
              {options.data.map((service) => (
                <label key={service.id} className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 text-[0.86em] text-foreground hover:bg-surface-tinted">
                  <input type="checkbox" value={service.id} {...form.register('service_ids')} className="h-4 w-4 shrink-0 accent-primary" />
                  <span dir="auto">{serviceLabel(service, i18n.language)}</span>
                </label>
              ))}
            </fieldset>
          )}
        </div>
        <SheetFooter>
          <Button type="button" variant="outline" disabled={save.isPending} onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" disabled={!form.formState.isDirty || save.isPending || !options.isSuccess} aria-busy={save.isPending || undefined}>
            {t(save.isPending ? 'orgDepartments.form.saving' : 'orgDepartments.services.save')}
          </Button>
        </SheetFooter>
      </form>
    </Sheet>
  )
}

// ── Placed by hand ─────────────────────────────────────────────────────────

type PlacementChoice = 'tree' | 'department' | 'outside'

export function PlacementDialog({ person, onClose }: {
  person: OrgNodeRead
  onClose: () => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const id = useId()
  const qc = useQueryClient()
  const { departments, exceptions, index, departmentsById, limitsOn } = useOrgData()
  const current = (exceptions.data ?? []).find((exception) => exception.employee_id === person.id)
  const headed = (departments.data ?? []).find((department) => department.active && department.head_employee_id === person.id)
  const [choice, setChoice] = useState<PlacementChoice>(current ? (current.department_id === null ? 'outside' : 'department') : 'department')
  const [departmentId, setDepartmentId] = useState<number | null>(current?.department_id ?? null)
  const name = bidi(pickEmployeeName(person, lang))

  const next = useMemo<Placement[]>(() => {
    const rest: Placement[] = (exceptions.data ?? []).filter((exception) => exception.employee_id !== person.id)
    if (choice === 'outside') return [...rest, { employee_id: person.id, department_id: null }]
    if (choice === 'department' && departmentId !== null) return [...rest, { employee_id: person.id, department_id: departmentId }]
    return rest
  }, [choice, departmentId, exceptions.data, person.id])
  const impact = useMemo(() => {
    const all = departments.data ?? []
    const before = deriveMembership(index, all, exceptions.data ?? [])
    const after = deriveMembership(index, all, next)
    return {
      before: before.get(person.id) ?? null,
      after: after.get(person.id) ?? null,
      others: membershipChanges(before, after, index.isWorking).filter((change) => change.employeeId !== person.id).length,
    }
  }, [departments.data, exceptions.data, index, next, person.id])
  const unchanged = choice === 'tree'
    ? !current
    : choice === 'outside'
      ? current?.department_id === null
      : departmentId === null || current?.department_id === departmentId
  const save = useMutation({
    mutationFn: async () => {
      if (choice === 'tree') await api.departments.deleteException(person.id)
      else await api.departments.putException(person.id, choice === 'outside' ? null : departmentId)
    },
    onSuccess: () => {
      invalidateDepartmentData(qc)
      toast.success(t(choice === 'tree' ? 'orgDepartments.placement.cleared' : 'orgDepartments.placement.saved'))
      onClose()
    },
    onError: (error) => toast.error(departmentErrorMessage(error, t)),
  })
  const label = (value: number | null): string => {
    if (value === null) return t('orgDepartments.outsideAll')
    const department = departmentsById.get(value)
    return department ? departmentName(department, lang) : ''
  }

  return (
    <Sheet title={t('orgDepartments.placement.title', { name })} description={t('orgDepartments.placement.description')} onClose={onClose}>
      <div className="min-h-0 space-y-4 overflow-y-auto px-4 py-4">
        <LiveEditsNotice show={limitsOn} />
        {headed ? (
          <p role="alert" className="text-[0.88em] text-foreground">
            {t('orgDepartments.placement.isHead', { name, department: bidi(departmentName(headed, lang)) })}
          </p>
        ) : (
          <>
            <fieldset disabled={save.isPending} className="space-y-1">
              <legend className="mb-1.5 text-[0.86em] font-medium text-foreground">{t('orgDepartments.placement.choose')}</legend>
              {(current ? (['tree', 'department', 'outside'] as const) : (['department', 'outside'] as const)).map((option) => (
                <div key={option}>
                  <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg px-2 py-2 hover:bg-surface-tinted">
                    <input
                      type="radio"
                      name={`${id}-choice`}
                      value={option}
                      checked={choice === option}
                      onChange={() => setChoice(option)}
                      className="mt-1 h-4 w-4 shrink-0 accent-primary"
                    />
                    <span className="min-w-0">
                      <span className="block text-[0.88em] font-medium text-foreground">{t(`orgDepartments.placement.options.${option}`)}</span>
                      <span className="block text-[0.8em] text-muted-foreground">{t(`orgDepartments.placement.options.${option}Hint`)}</span>
                    </span>
                  </label>
                  {option === 'department' && choice === 'department' && (
                    <div className="ps-9 pt-1">
                      <DepartmentPicker
                        value={departmentId}
                        onChange={setDepartmentId}
                        allowNone={false}
                        label={t('orgDepartments.placement.destination')}
                        disabled={save.isPending}
                      />
                    </div>
                  )}
                </div>
              ))}
            </fieldset>
            <section aria-label={t('orgDepartments.placement.summary')} className="space-y-1 rounded-xl bg-surface-tinted/60 px-3.5 py-3 text-[0.86em] text-foreground">
              <p>{t('orgDepartments.placement.now', { name: bidi(label(impact.before)) })}</p>
              <p className="font-semibold">{t('orgDepartments.placement.after', { name: bidi(label(impact.after)) })}</p>
              {impact.others > 0 && <p>{t('orgDepartments.placement.alsoMoves', { count: impact.others })}</p>}
              <p className="text-muted-foreground">{t('orgDepartments.placement.keepsReporting')}</p>
            </section>
          </>
        )}
      </div>
      <SheetFooter>
        <Button type="button" variant="outline" disabled={save.isPending} onClick={onClose}>{t('common.cancel')}</Button>
        {!headed && (
          <Button type="button" disabled={unchanged || save.isPending} aria-busy={save.isPending || undefined} onClick={() => save.mutate()}>
            {t(save.isPending ? 'orgDepartments.form.saving' : 'orgDepartments.placement.save')}
          </Button>
        )}
      </SheetFooter>
    </Sheet>
  )
}

// ── Reporting chart (read-only) ────────────────────────────────────────────

export function ReportingChartDialog({ department, onClose }: {
  department: DepartmentRead
  onClose: () => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  return (
    <Sheet
      wide
      title={t('orgDepartments.chart.title', { name: bidi(departmentName(department, i18n.language)) })}
      description={t('orgDepartments.chart.description')}
      onClose={onClose}
    >
      <div data-org-tree-fullscreen-host className="flex min-h-0 flex-1 flex-col overflow-hidden border-t border-hairline">
        <OrgTreeView branchRootId={department.head_employee_id} />
      </div>
    </Sheet>
  )
}
