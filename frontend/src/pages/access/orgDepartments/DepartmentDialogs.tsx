/**
 * Dialogs behind the org-tree department actions: make a head (names),
 * edit a department (names, active, delete), its deputies and viewers, its
 * services, and a manual exception for one person.
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
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { DialogContent, DialogDescription, DialogHeader, DialogRoot, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { api, type DepartmentRead, type OrgNodeRead } from '@/lib/api'
import { departmentErrorMessage, departmentHeadName, departmentName, invalidateDepartmentData } from '@/lib/departments'
import { bidi } from '@/lib/bidi'
import { pickEmployeeName } from '@/lib/employeeName'

/** Bottom sheet on phones, centred dialog from md up (same as DistributeDialog). */
const SHEET = 'bottom-sheet !inset-x-0 !bottom-0 !top-auto !max-h-[92dvh] !translate-x-0 !translate-y-0 rounded-b-none md:!inset-x-auto md:!start-1/2 md:!bottom-auto md:!top-1/2 md:!max-h-[85dvh] md:!-translate-x-1/2 md:!-translate-y-1/2 md:rounded-b-2xl rtl:md:!translate-x-1/2'
const INPUT = 'mt-1.5 w-full min-h-11 rounded-lg border border-border bg-surface px-3.5 py-2.5 text-[0.9em] text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20'

interface SheetProps {
  title: string
  description?: React.ReactNode
  onClose: () => void
  children: React.ReactNode
}

function Sheet({ title, description, onClose, children }: SheetProps): React.JSX.Element {
  return (
    <DialogRoot open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className={SHEET}>
        <DialogHeader className="pe-12">
          <DialogTitle dir="auto">{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        {children}
      </DialogContent>
    </DialogRoot>
  )
}

function Footer({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <footer className="flex flex-wrap justify-end gap-2 border-t border-hairline px-4 py-3">{children}</footer>
}

// ── Names: make a department head, or edit a department ───────────────────

export function DepartmentFormDialog({ head, department, onClose }: {
  /** Create mode: the employee who becomes the head. */
  head?: OrgNodeRead
  /** Edit mode. */
  department?: DepartmentRead
  onClose: () => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const id = useId()
  const qc = useQueryClient()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const schema = z.object({
    name_en: z.string().trim().min(1, t('orgDepartments.form.nameRequired')).max(128, t('orgDepartments.form.nameTooLong')),
    name_ar: z.string().trim().min(1, t('orgDepartments.form.nameRequired')).max(128, t('orgDepartments.form.nameTooLong')),
    active: z.boolean(),
  })
  type Values = z.infer<typeof schema>
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name_en: department?.name_en ?? '', name_ar: department?.name_ar ?? '', active: department?.active ?? true },
  })
  const save = useMutation({
    mutationFn: ({ name_en, name_ar, active }: Values) => department
      ? api.departments.update(department.id, { name_en, name_ar, active })
      : api.departments.create({ name_en, name_ar, head_employee_id: head!.id }),
    onSuccess: () => {
      invalidateDepartmentData(qc)
      toast.success(t(department ? 'orgDepartments.form.saved' : 'orgDepartments.form.created'))
      onClose()
    },
    onError: (error) => toast.error(departmentErrorMessage(error, t)),
  })
  const remove = useMutation({
    mutationFn: () => api.departments.delete(department!.id),
    onSuccess: () => {
      invalidateDepartmentData(qc)
      toast.success(t('orgDepartments.form.deleted'))
      onClose()
    },
    onError: (error) => toast.error(departmentErrorMessage(error, t)),
  })
  const busy = save.isPending || remove.isPending
  const headName = bidi(head ? pickEmployeeName(head, i18n.language) : department ? departmentHeadName(department, i18n.language) : '')
  const errors = form.formState.errors

  return (
    <Sheet
      title={department
        ? t('orgDepartments.form.editTitle', { name: bidi(departmentName(department, i18n.language)) })
        : t('orgDepartments.form.createTitle', { name: headName })}
      description={department
        ? t('orgDepartments.form.editDescription', { name: headName })
        : t('orgDepartments.form.createDescription', { name: headName })}
      onClose={onClose}
    >
      <form onSubmit={form.handleSubmit((values) => save.mutate(values))} noValidate className="flex min-h-0 flex-col">
        <fieldset disabled={busy} className="grid min-w-0 gap-4 overflow-y-auto px-4 py-4 sm:grid-cols-2">
          {(['name_en', 'name_ar'] as const).map((field) => (
            <div key={field} className="min-w-0">
              <label htmlFor={`${id}-${field}`} className="text-[0.82em] font-medium text-foreground">
                {t(field === 'name_en' ? 'orgDepartments.form.nameEn' : 'orgDepartments.form.nameAr')}
              </label>
              <input
                id={`${id}-${field}`}
                dir={field === 'name_ar' ? 'rtl' : 'ltr'}
                className={INPUT}
                maxLength={128}
                aria-invalid={!!errors[field]}
                aria-describedby={errors[field] ? `${id}-${field}-error` : undefined}
                {...form.register(field)}
              />
              {errors[field] && <p id={`${id}-${field}-error`} role="alert" className="mt-1 text-[0.78em] text-accent">{errors[field]?.message}</p>}
            </div>
          ))}
          {department && (
            <label className="flex min-h-11 items-start gap-2.5 text-[0.86em] text-foreground sm:col-span-2">
              <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-primary" {...form.register('active')} />
              <span>
                <span className="block font-medium">{t('orgDepartments.form.active')}</span>
                <span className="block text-[0.9em] text-muted-foreground">{t('orgDepartments.form.activeHint')}</span>
              </span>
            </label>
          )}
        </fieldset>
        <Footer>
          {department && (
            <Button type="button" variant="ghost" className="me-auto text-accent" disabled={busy} onClick={() => setConfirmDelete(true)}>
              {t('orgDepartments.form.delete')}
            </Button>
          )}
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" disabled={busy} aria-busy={save.isPending || undefined}>
            {t(save.isPending ? 'orgDepartments.form.saving' : department ? 'orgDepartments.form.save' : 'orgDepartments.form.create')}
          </Button>
        </Footer>
      </form>
      {department && (
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title={t('orgDepartments.form.confirmDelete', { name: bidi(departmentName(department, i18n.language)) })}
          description={t('orgDepartments.form.deleteHint')}
          confirmLabel={t('orgDepartments.form.delete')}
          destructive
          onConfirm={() => { if (!remove.isPending) remove.mutate() }}
        />
      )}
    </Sheet>
  )
}

// ── Deputies and department viewers ────────────────────────────────────────

type Grant = 'deputy' | 'viewer'

interface PersonRow {
  userId: number
  label: string
  email: string | null
}

export function DepartmentPeopleDialog({ department, onClose }: {
  department: DepartmentRead
  onClose: () => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const id = useId()
  const qc = useQueryClient()
  const [query, setQuery] = useState('')
  // Existing grants come from the department itself, so a deputy whose
  // account went inactive stays visible (and removable) instead of riding
  // along unseen in the save payload.
  const existing = useMemo<PersonRow[]>(
    () => [...department.deputies, ...department.viewers].map((person) => ({ userId: person.user_id, label: person.display_name, email: null })),
    [department.deputies, department.viewers],
  )
  const [grants, setGrants] = useState<Map<number, Grant>>(() => new Map([
    ...department.deputies.map((person) => [person.user_id, 'deputy'] as const),
    ...department.viewers.map((person) => [person.user_id, 'viewer'] as const),
  ]))
  // The endpoint lists active accounts only: new grants never go to inactive users.
  const users = useQuery({ queryKey: ['departments', 'candidate-users'], queryFn: api.departments.candidateUsers })
  const candidates = useMemo<PersonRow[]>(
    () => (users.data ?? [])
      .filter((user) => user.user_id !== department.head_user_id)
      .map((user) => ({ userId: user.user_id, label: user.display_name, email: user.email })),
    [department.head_user_id, users.data],
  )
  const needle = query.trim().toLowerCase()
  const known = new Map([...existing, ...candidates].map((person) => [person.userId, person]))
  const assignedIds = [...new Set([...existing.map((person) => person.userId), ...grants.keys()])]
  const assigned = assignedIds.flatMap((userId) => known.get(userId) ?? [])
  const matches = (users.data ?? [])
    .filter((user) => user.user_id !== department.head_user_id && !assignedIds.includes(user.user_id)
      && (!needle || [user.display_name, user.email, user.employee_id ?? ''].some((value) => value.toLowerCase().includes(needle))))
    .slice(0, needle ? 50 : 12)
    .map((user) => known.get(user.user_id)!)
  const save = useMutation({
    mutationFn: () => api.departments.setPeople(department.id, {
      deputy_user_ids: [...grants].filter(([, grant]) => grant === 'deputy').map(([userId]) => userId),
      viewer_user_ids: [...grants].filter(([, grant]) => grant === 'viewer').map(([userId]) => userId),
    }),
    onSuccess: () => {
      invalidateDepartmentData(qc)
      toast.success(t('orgDepartments.people.saved'))
      onClose()
    },
    onError: (error) => toast.error(departmentErrorMessage(error, t)),
  })

  function setGrant(userId: number, grant: Grant | 'none'): void {
    setGrants((current) => {
      const next = new Map(current)
      if (grant === 'none') next.delete(userId)
      else next.set(userId, grant)
      return next
    })
  }

  function row(person: PersonRow): React.JSX.Element {
    const label = person.label
    return (
      <li key={person.userId} className="flex min-h-11 flex-wrap items-center gap-2 border-b border-hairline px-3 py-2 last:border-0">
        <span className="min-w-0 flex-1">
          <span className="block break-words text-[0.86em] font-medium text-foreground"><bdi>{label}</bdi></span>
          {person.email && <span className="block break-all text-[0.74em] text-muted-foreground"><bdi dir="ltr">{person.email}</bdi></span>}
        </span>
        <select
          value={grants.get(person.userId) ?? 'none'}
          onChange={(event) => setGrant(person.userId, event.target.value as Grant | 'none')}
          aria-label={t('orgDepartments.people.roleFor', { name: label })}
          className="min-h-11 rounded-lg border border-border bg-surface px-2.5 text-[0.82em] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="none">{t('orgDepartments.people.noRole')}</option>
          <option value="deputy">{t('departmentAccess.roles.deputy')}</option>
          <option value="viewer">{t('departmentAccess.roles.viewer')}</option>
        </select>
      </li>
    )
  }

  return (
    <Sheet
      title={t('orgDepartments.people.title', { name: bidi(departmentName(department, i18n.language)) })}
      description={t('orgDepartments.people.description')}
      onClose={onClose}
    >
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto px-4 py-4">
        <p className="text-[0.82em] text-muted-foreground">
          {t('orgDepartments.people.head', { name: bidi(departmentHeadName(department, i18n.language)) })}
          {department.head_user_id === null && <> · <span className="text-warning">{t('orgDepartments.people.headNoAccount')}</span></>}
        </p>
        {users.isPending ? <Skeleton className="h-40 w-full rounded-xl" /> : users.isError ? (
          <p role="alert" className="text-sm text-accent">
            {departmentErrorMessage(users.error, t)}{' '}
            <button type="button" className="underline" onClick={() => void users.refetch()}>{t('departments.retry')}</button>
          </p>
        ) : (
          <fieldset disabled={save.isPending} className="min-w-0 space-y-3">
            <legend className="sr-only">{t('orgDepartments.people.title', { name: departmentName(department, i18n.language) })}</legend>
            {assigned.length > 0 && (
              <section aria-labelledby={`${id}-assigned`}>
                <h3 id={`${id}-assigned`} className="mb-1.5 text-[0.72em] font-semibold uppercase tracking-[0.08em] text-muted-foreground rtl:tracking-normal">
                  {t('orgDepartments.people.assigned', { count: assigned.length })}
                </h3>
                <ul className="rounded-lg border border-hairline">{assigned.map(row)}</ul>
              </section>
            )}
            <label className="flex min-h-11 items-center gap-2 rounded-lg border border-border bg-surface px-2.5 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/10">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('orgDepartments.people.search')}
                aria-label={t('orgDepartments.people.search')}
                className="min-w-0 flex-1 bg-transparent text-[0.86em] outline-none placeholder:text-muted-foreground"
              />
            </label>
            {matches.length === 0 ? (
              <p role="status" className="text-[0.82em] text-muted-foreground">{t('common.noResults')}</p>
            ) : (
              <ul className="max-h-72 overflow-y-auto rounded-lg border border-hairline">{matches.map(row)}</ul>
            )}
          </fieldset>
        )}
      </div>
      <Footer>
        <Button type="button" variant="outline" disabled={save.isPending} onClick={onClose}>{t('common.cancel')}</Button>
        <Button type="button" disabled={save.isPending || !users.isSuccess} aria-busy={save.isPending || undefined} onClick={() => save.mutate()}>
          {t(save.isPending ? 'orgDepartments.form.saving' : 'orgDepartments.people.save')}
        </Button>
      </Footer>
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
        <div className="min-h-0 overflow-y-auto px-4 py-4">
          {options.isPending ? <Skeleton className="h-28 w-full rounded-xl" /> : options.isError ? (
            <p role="alert" className="text-sm text-accent">
              {departmentErrorMessage(options.error, t)}{' '}
              <button type="button" className="underline" onClick={() => void options.refetch()}>{t('departments.retry')}</button>
            </p>
          ) : (
            <fieldset disabled={save.isPending} className="grid min-w-0 gap-1 sm:grid-cols-2">
              <legend className="sr-only">{t('orgDepartments.services.title', { name: departmentName(department, i18n.language) })}</legend>
              {options.data.length === 0 && <p className="text-[0.86em] text-muted-foreground">{t('orgDepartments.services.noOptions')}</p>}
              {options.data.map((service) => (
                <label key={service.id} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-[0.84em] text-foreground hover:bg-surface-tinted">
                  <input type="checkbox" value={service.id} {...form.register('service_ids')} className="h-4 w-4 shrink-0 accent-primary" />
                  <span dir="auto">{i18n.language.startsWith('ar') ? service.label_ar || service.label_en : service.label_en || service.label_ar}</span>
                </label>
              ))}
            </fieldset>
          )}
        </div>
        <Footer>
          <Button type="button" variant="outline" disabled={save.isPending} onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" disabled={!form.formState.isDirty || save.isPending || !options.isSuccess} aria-busy={save.isPending || undefined}>
            {t(save.isPending ? 'orgDepartments.form.saving' : 'orgDepartments.services.save')}
          </Button>
        </Footer>
      </form>
    </Sheet>
  )
}

// ── Exception: place one person (and their branch) in another department ───

export function DepartmentExceptionDialog({ person, onClose }: {
  person: OrgNodeRead
  onClose: () => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const qc = useQueryClient()
  const [departmentId, setDepartmentId] = useState<number | null>(null)
  const name = pickEmployeeName(person, i18n.language)
  const save = useMutation({
    mutationFn: (id: number) => api.departments.putException(person.id, id),
    onSuccess: () => {
      invalidateDepartmentData(qc)
      toast.success(t('orgDepartments.exceptions.saved'))
      onClose()
    },
    onError: (error) => toast.error(departmentErrorMessage(error, t)),
  })
  return (
    <Sheet
      title={t('orgDepartments.exceptions.placeTitle', { name: bidi(name) })}
      description={t('orgDepartments.exceptions.placeDescription', { name: bidi(name) })}
      onClose={onClose}
    >
      <div className="px-4 py-4">
        <DepartmentPicker
          value={departmentId}
          onChange={setDepartmentId}
          allowNone={false}
          label={t('orgDepartments.exceptions.destination')}
          disabled={save.isPending}
        />
      </div>
      <Footer>
        <Button type="button" variant="outline" disabled={save.isPending} onClick={onClose}>{t('common.cancel')}</Button>
        <Button
          type="button"
          disabled={departmentId === null || save.isPending}
          aria-busy={save.isPending || undefined}
          onClick={() => { if (departmentId !== null) save.mutate(departmentId) }}
        >
          {t(save.isPending ? 'orgDepartments.form.saving' : 'orgDepartments.exceptions.place')}
        </Button>
      </Footer>
    </Sheet>
  )
}
