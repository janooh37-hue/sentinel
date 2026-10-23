import { useId, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { api, type DepartmentRead, type UnassignedEmployeeGroup } from '@/lib/api'
import { departmentErrorMessage, departmentName, orderDepartments } from '@/lib/departments'
import { DepartmentPicker } from '@/components/departments/DepartmentPicker'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { OutlineButton, PrimaryButton, SectionCard } from './SettingsPage'

const INPUT = 'mt-1.5 w-full rounded-lg border border-border bg-surface px-3.5 py-2.5 text-[0.86em] text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20'
const BADGE = 'rounded-full bg-surface-tinted px-2 py-0.5 text-[0.72em] font-medium text-muted-foreground'

function QueryFailure({ error, retry }: { error: unknown; retry: () => void }): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div role="alert" className="space-y-2 py-3">
      <p className="text-[0.86em] text-accent">{departmentErrorMessage(error, t)}</p>
      <OutlineButton onClick={retry}>{t('departmentSettings.retry')}</OutlineButton>
    </div>
  )
}

export function DepartmentsSection(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const qc = useQueryClient()
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [editing, setEditing] = useState(false)
  const [creating, setCreating] = useState(false)
  const [confirmAction, setConfirmAction] = useState<'deactivate' | 'delete' | null>(null)
  const departments = useQuery({ queryKey: ['departments'], queryFn: () => api.departments.list() })
  const unassigned = useQuery({
    queryKey: ['departments', 'unassigned-employees'],
    queryFn: () => api.departments.unassignedEmployees(),
  })
  const selected = departments.data?.find((department) => department.id === selectedId)
  const invalidate = (): void => { void qc.invalidateQueries({ queryKey: ['departments'] }) }
  const activeMutation = useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) => api.departments.update(id, { active }),
    onSuccess: () => { invalidate(); toast.success(t('departmentSettings.saved')) },
    onError: (error) => toast.error(departmentErrorMessage(error, t)),
  })
  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.departments.delete(id),
    onSuccess: () => {
      invalidate()
      setSelectedId(null)
      setEditing(false)
      toast.success(t('departmentSettings.deleted'))
    },
    onError: (error) => toast.error(departmentErrorMessage(error, t)),
  })
  const busy = activeMutation.isPending || deleteMutation.isPending

  return (
    <div className="space-y-5">
      <SectionCard title={t('departmentSettings.title')} description={t('departmentSettings.description')}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-prose text-[0.82em] text-muted-foreground">{t('departmentSettings.phaseNote')}</p>
          <OutlineButton onClick={() => { setCreating(true); setEditing(false) }} disabled={creating || busy}>
            {t('departmentSettings.create')}
          </OutlineButton>
        </div>
        {creating && (
          <div className="mb-5 border-b border-hairline pb-5">
            <DepartmentForm onCancel={() => setCreating(false)} onSaved={(department) => {
              setCreating(false)
              setSelectedId(department.id)
              invalidate()
            }} />
          </div>
        )}
        {departments.isPending ? <Skeleton className="h-40 w-full rounded-xl" /> : departments.isError ? (
          <QueryFailure error={departments.error} retry={() => { void departments.refetch() }} />
        ) : departments.data.length === 0 ? (
          <p className="py-4 text-[0.86em] text-muted-foreground">{t('departmentSettings.empty')}</p>
        ) : (
          <ul className="divide-y divide-hairline" aria-label={t('departmentSettings.tree')}>
            {orderDepartments(departments.data).map(({ department, depth }) => (
              <li key={department.id}>
                <button type="button" aria-pressed={selectedId === department.id}
                  onClick={() => { setSelectedId(department.id); setEditing(false); setCreating(false) }}
                  className={`w-full rounded-lg py-3 pe-3 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${selectedId === department.id ? 'bg-primary-soft' : 'hover:bg-surface-tinted'}`}
                  style={{ paddingInlineStart: `${0.75 + depth * 1.25}rem` }}>
                  <span className="flex flex-wrap items-center gap-2">
                    <span dir="auto" className="min-w-0 break-words text-[0.9em] font-semibold text-foreground">{departmentName(department, i18n.language)}</span>
                    {!department.active && <span className={BADGE}>{t('departmentSettings.inactive')}</span>}
                  </span>
                  <span className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[0.76em] text-muted-foreground">
                    <span>{t('departmentSettings.memberCount', { count: department.member_count })}</span>
                    <span>{t('departmentSettings.employeeCount', { count: department.employee_count })}</span>
                  </span>
                  <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[0.76em] text-muted-foreground">
                    {department.heads.length === 0 ? t('departmentSettings.noHeads') : department.heads.map((head) => (
                      <span key={head.user_id}><span dir="auto">{head.display_name}</span> · {t(`departmentSettings.roles.${head.role}`)}</span>
                    ))}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {selected && !creating && (
        <SectionCard title={departmentName(selected, i18n.language)} description={t('departmentSettings.details')}>
          {editing ? (
            <DepartmentForm key={selected.id} department={selected} onCancel={() => setEditing(false)} onSaved={() => {
              setEditing(false)
              invalidate()
            }} />
          ) : (
            <div className="mb-5 flex flex-wrap gap-2">
              <OutlineButton onClick={() => setEditing(true)} disabled={busy}>{t('departmentSettings.edit')}</OutlineButton>
              <OutlineButton disabled={busy} onClick={() => selected.active
                ? setConfirmAction('deactivate')
                : activeMutation.mutate({ id: selected.id, active: true })}>
                {t(selected.active ? 'departmentSettings.deactivate' : 'departmentSettings.reactivate')}
              </OutlineButton>
              <OutlineButton className="text-accent" disabled={busy} onClick={() => setConfirmAction('delete')}>
                {t('departmentSettings.delete')}
              </OutlineButton>
            </div>
          )}
          <DepartmentMembers key={`members-${selected.id}`} departmentId={selected.id} />
          <DepartmentServices key={`services-${selected.id}`} department={selected} />
        </SectionCard>
      )}

      <SectionCard title={t('departmentSettings.unassigned.title')} description={t('departmentSettings.unassigned.description')}>
        {unassigned.isPending ? <Skeleton className="h-24 w-full rounded-xl" /> : unassigned.isError ? (
          <QueryFailure error={unassigned.error} retry={() => { void unassigned.refetch() }} />
        ) : unassigned.data.length === 0 ? (
          <p className="text-[0.86em] text-muted-foreground">{t('departmentSettings.unassigned.empty')}</p>
        ) : (
          <div className="divide-y divide-hairline">
            {unassigned.data.map((group) => <UnassignedGroup key={JSON.stringify([group.duty_unit, group.legacy_department])} group={group} />)}
          </div>
        )}
      </SectionCard>
      <ConfirmDialog open={confirmAction !== null && selected !== undefined}
        onOpenChange={(open) => { if (!open) setConfirmAction(null) }}
        title={t(confirmAction === 'delete' ? 'departmentSettings.confirmDelete' : 'departmentSettings.confirmDeactivate', {
          name: selected ? departmentName(selected, i18n.language) : '',
        })}
        description={t(confirmAction === 'delete' ? 'departmentSettings.deleteHint' : 'departmentSettings.deactivateHint')}
        confirmLabel={t(confirmAction === 'delete' ? 'departmentSettings.delete' : 'departmentSettings.deactivate')}
        destructive onConfirm={() => {
          if (!selected || busy) return
          if (confirmAction === 'delete') deleteMutation.mutate(selected.id)
          else activeMutation.mutate({ id: selected.id, active: false })
        }} />
    </div>
  )
}

function DepartmentForm({ department, onCancel, onSaved }: {
  department?: DepartmentRead
  onCancel: () => void
  onSaved: (department: DepartmentRead) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const id = useId()
  const schema = z.object({
    name_en: z.string().trim().min(1, t('departmentSettings.nameRequired')).max(128, t('departmentSettings.nameTooLong')),
    name_ar: z.string().trim().min(1, t('departmentSettings.nameRequired')).max(128, t('departmentSettings.nameTooLong')),
    parent_id: z.number().int().positive().nullable(),
  })
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { name_en: department?.name_en ?? '', name_ar: department?.name_ar ?? '', parent_id: department?.parent_id ?? null },
  })
  const save = useMutation({
    mutationFn: (values: z.infer<typeof schema>) => department
      ? api.departments.update(department.id, values)
      : api.departments.create(values),
    onSuccess: (result) => { toast.success(t('departmentSettings.saved')); onSaved(result) },
    onError: (error) => toast.error(departmentErrorMessage(error, t)),
  })
  return (
    <form onSubmit={form.handleSubmit((values) => save.mutate(values))} className="space-y-4" noValidate>
      <h4 className="font-semibold text-foreground">{t(department ? 'departmentSettings.edit' : 'departmentSettings.create')}</h4>
      <fieldset disabled={save.isPending} className="grid min-w-0 gap-4 sm:grid-cols-2">
        {(['name_en', 'name_ar'] as const).map((field) => (
          <div key={field}>
            <label htmlFor={`${id}-${field}`} className="text-[0.82em] font-medium text-foreground">{t(field === 'name_en' ? 'departmentSettings.nameEn' : 'departmentSettings.nameAr')}</label>
            <input id={`${id}-${field}`} dir={field === 'name_ar' ? 'rtl' : 'ltr'} className={INPUT} maxLength={128}
              aria-invalid={!!form.formState.errors[field]} aria-describedby={form.formState.errors[field] ? `${id}-${field}-error` : undefined}
              {...form.register(field)} />
            {form.formState.errors[field] && <p id={`${id}-${field}-error`} role="alert" className="mt-1 text-[0.78em] text-accent">{form.formState.errors[field]?.message}</p>}
          </div>
        ))}
        <div className="sm:col-span-2">
          <Controller control={form.control} name="parent_id" render={({ field }) => (
            <DepartmentPicker id={`${id}-parent`} label={t('departmentSettings.parent')} value={field.value} onChange={field.onChange}
              excludeDepartmentId={department?.id} disabled={save.isPending} />
          )} />
        </div>
      </fieldset>
      <div className="flex flex-wrap justify-end gap-2">
        <OutlineButton onClick={onCancel} disabled={save.isPending}>{t('departmentSettings.cancel')}</OutlineButton>
        <PrimaryButton type="submit" disabled={save.isPending}>{t(save.isPending ? 'departmentSettings.saving' : 'departmentSettings.save')}</PrimaryButton>
      </div>
    </form>
  )
}

function DepartmentMembers({ departmentId }: { departmentId: number }): React.JSX.Element {
  const { t } = useTranslation()
  const members = useQuery({ queryKey: ['departments', departmentId, 'members'], queryFn: () => api.departments.members(departmentId) })
  return (
    <div className="mt-5 border-t border-hairline pt-5">
      <h4 className="mb-3 font-semibold text-foreground">{t('departmentSettings.members')}</h4>
      {members.isPending ? <Skeleton className="h-24 w-full rounded-xl" /> : members.isError ? (
        <QueryFailure error={members.error} retry={() => { void members.refetch() }} />
      ) : members.data.length === 0 ? (
        <p className="text-[0.86em] text-muted-foreground">{t('departmentSettings.noMembers')}</p>
      ) : (
        <ul className="divide-y divide-hairline">
          {members.data.map((member) => (
            <li key={member.user_id} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <div className="min-w-0">
                <p dir="auto" className="break-words text-[0.86em] font-medium text-foreground">{member.display_name}</p>
                <p dir="ltr" className="break-all text-start text-[0.76em] text-muted-foreground">{member.email}</p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <span className={BADGE}>{t(`departmentSettings.roles.${member.role}`)}</span>
                {member.is_primary && <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[0.72em] font-medium text-primary">{t('departmentSettings.primary')}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[0.78em] text-muted-foreground">{t('departmentSettings.membersHint')}</p>
    </div>
  )
}

function DepartmentServices({ department }: { department: DepartmentRead }): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const qc = useQueryClient()
  const options = useQuery({ queryKey: ['departments', 'service-options'], queryFn: () => api.departments.serviceOptions() })
  const schema = z.object({ service_ids: z.array(z.string()) })
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { service_ids: department.service_ids } })
  const save = useMutation({
    mutationFn: (values: z.infer<typeof schema>) => api.departments.setServices(department.id, values),
    onSuccess: (updated) => {
      form.reset({ service_ids: updated.service_ids })
      void qc.invalidateQueries({ queryKey: ['departments'] })
      toast.success(t('departmentSettings.saved'))
    },
    onError: (error) => toast.error(departmentErrorMessage(error, t)),
  })
  return (
    <form onSubmit={form.handleSubmit((values) => save.mutate(values))} className="mt-5 border-t border-hairline pt-5">
      <h4 className="font-semibold text-foreground">{t('departmentSettings.services')}</h4>
      <p className="mb-4 mt-1 max-w-prose text-[0.82em] text-muted-foreground">{t('departmentSettings.servicesHint')}</p>
      {options.isPending ? <Skeleton className="h-28 w-full rounded-xl" /> : options.isError ? (
        <QueryFailure error={options.error} retry={() => { void options.refetch() }} />
      ) : (
        <>
          <fieldset disabled={save.isPending} className="grid min-w-0 gap-1 sm:grid-cols-2">
            <legend className="sr-only">{t('departmentSettings.services')}</legend>
            {options.data.length === 0 && <p className="text-[0.86em] text-muted-foreground">{t('departmentSettings.noServiceOptions')}</p>}
            {options.data.map((service) => (
              <label key={service.id} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-[0.82em] text-foreground hover:bg-surface-tinted">
                <input type="checkbox" value={service.id} {...form.register('service_ids')} className="h-4 w-4 shrink-0 accent-primary" />
                <span dir="auto">{i18n.language.startsWith('ar') ? service.label_ar || service.label_en : service.label_en || service.label_ar}</span>
              </label>
            ))}
          </fieldset>
          <div className="mt-4 flex justify-end">
            <PrimaryButton type="submit" disabled={!form.formState.isDirty || save.isPending}>
              {t(save.isPending ? 'departmentSettings.saving' : 'departmentSettings.saveServices')}
            </PrimaryButton>
          </div>
        </>
      )}
    </form>
  )
}

function UnassignedGroup({ group }: { group: UnassignedEmployeeGroup }): React.JSX.Element {
  const { t } = useTranslation()
  const id = useId()
  const qc = useQueryClient()
  const schema = z.object({ department_id: z.number().int().positive().nullable().refine((value) => value !== null, t('departmentSettings.unassigned.required')) })
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { department_id: null } })
  const assign = useMutation({
    mutationFn: ({ department_id }: z.infer<typeof schema>) => api.departments.assignEmployees({ employee_ids: group.employee_ids, department_id }),
    onSuccess: () => {
      for (const queryKey of [['departments'], ['employees'], ['employee-detail'], ['auth-users'], ['auth', 'users'], ['users'], ['org-tree']]) {
        void qc.invalidateQueries({ queryKey })
      }
      form.reset()
      toast.success(t('departmentSettings.unassigned.assigned', { count: group.count }))
    },
    onError: (error) => toast.error(departmentErrorMessage(error, t)),
  })
  return (
    <form onSubmit={form.handleSubmit((values) => assign.mutate(values))} className="grid min-w-0 gap-3 py-4 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
      <div className="min-w-0 space-y-1 text-[0.82em]">
        <p className="break-words font-medium text-foreground"><span className="text-muted-foreground">{t('departmentSettings.unassigned.dutyUnit')}: </span><span dir="auto">{group.duty_unit || t('departmentSettings.unassigned.notSet')}</span></p>
        <p className="break-words text-muted-foreground">{t('departmentSettings.unassigned.legacy')}: <span dir="auto">{group.legacy_department || t('departmentSettings.unassigned.notSet')}</span></p>
        <p className="text-muted-foreground">{t('departmentSettings.employeeCount', { count: group.count })}</p>
      </div>
      <div className="min-w-0">
        <Controller control={form.control} name="department_id" render={({ field }) => (
          <DepartmentPicker id={`${id}-department`} label={t('departmentSettings.unassigned.destination')} value={field.value} onChange={field.onChange} disabled={assign.isPending} />
        )} />
        {form.formState.errors.department_id && <p role="alert" className="mt-1 text-[0.78em] text-accent">{form.formState.errors.department_id.message}</p>}
      </div>
      <div className="flex justify-end">
        <PrimaryButton type="submit" disabled={assign.isPending}>{t(assign.isPending ? 'departmentSettings.unassigned.assigning' : 'departmentSettings.unassigned.assign')}</PrimaryButton>
      </div>
    </form>
  )
}
