import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useFieldArray, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { api, type AdminUserRead, type DepartmentMembershipsUpdate } from '@/lib/api'
import { departmentErrorMessage, departmentName } from '@/lib/departments'
import { DepartmentPicker } from '@/components/departments/DepartmentPicker'
import { Button } from '@/components/ui/button'
import { membershipsSchema, removeMembership } from './departmentMemberships'

export function DepartmentMembershipEditor({ user, onCancel, onSaved }: {
  user: AdminUserRead
  onCancel: () => void
  onSaved: () => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const qc = useQueryClient()
  const [addingId, setAddingId] = useState<number | null>(null)
  const departments = useQuery({ queryKey: ['departments'], queryFn: () => api.departments.list() })
  const form = useForm<DepartmentMembershipsUpdate>({
    resolver: zodResolver(membershipsSchema),
    defaultValues: { memberships: (user.departments ?? []).map(({ department_id, role, is_primary }) => ({ department_id, role, is_primary })) },
  })
  const { fields, append, replace } = useFieldArray({ control: form.control, name: 'memberships' })
  const memberships = useWatch({ control: form.control, name: 'memberships' })
  const save = useMutation({
    mutationFn: (body: DepartmentMembershipsUpdate) => api.departments.setMemberships(user.id, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['auth-users'] })
      void qc.invalidateQueries({ queryKey: ['auth-audit'] })
      void qc.invalidateQueries({ queryKey: ['departments'] })
      void qc.invalidateQueries({ queryKey: ['my-capabilities'] })
      toast.success(t('departmentAccess.saved'))
      onSaved()
    },
    onError: (error) => toast.error(departmentErrorMessage(error, t)),
  })
  const available = (departments.data ?? []).filter((department) => department.active && !memberships.some((m) => m.department_id === department.id))
  const validationError = form.formState.errors.memberships
  const errorMessage = validationError?.root?.message ?? validationError?.message

  return (
    <form onSubmit={form.handleSubmit((body) => save.mutate(body))} className="flex min-h-0 flex-col gap-4">
      <p className="break-all text-sm text-muted-foreground" dir="auto">{user.display_name || user.name_en || user.email}</p>
      <p className="text-sm text-muted-foreground">{t('departmentAccess.primaryHint')}</p>
      <fieldset disabled={save.isPending} className="min-w-0 space-y-3">
        <div className="max-h-[45vh] space-y-3 overflow-y-auto">
          {fields.map((field, index) => {
            const department = departments.data?.find((d) => d.id === field.department_id) ?? user.departments?.find((d) => d.department_id === field.department_id)
            return (
              <div key={field.id} className="space-y-2 border-b border-hairline pb-3">
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0 break-words text-sm font-semibold" dir="auto">{department ? departmentName(department, i18n.language) : field.department_id}</span>
                  <button type="button" className="shrink-0 rounded text-sm text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => replace(removeMembership(form.getValues('memberships'), field.department_id))}>{t('departmentAccess.remove')}</button>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2 text-sm">
                    <span>{t('departmentAccess.role')}</span>
                    <select {...form.register(`memberships.${index}.role`)} className="rounded-lg border border-border bg-surface px-2 py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      {(['head', 'deputy', 'member'] as const).map((role) => <option key={role} value={role}>{t(`departmentAccess.roles.${role}`)}</option>)}
                    </select>
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="radio" name="primary-membership" checked={memberships[index]?.is_primary ?? false} onChange={() => memberships.forEach((_, i) => form.setValue(`memberships.${i}.is_primary`, i === index, { shouldDirty: true, shouldValidate: true }))} />
                    {t('departmentAccess.primary')}
                  </label>
                </div>
              </div>
            )
          })}
          {fields.length === 0 && <p className="rounded-lg bg-warning-soft p-3 text-sm text-warning">{t('departmentAccess.noDepartment')}</p>}
        </div>
        {departments.isError ? (
          <div role="alert" className="text-sm text-accent">{departmentErrorMessage(departments.error, t)} <button type="button" className="underline" onClick={() => void departments.refetch()}>{t('departmentAccess.retry')}</button></div>
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1">
              <DepartmentPicker
                value={addingId}
                onChange={setAddingId}
                allowNone={false}
                excludeDepartmentIds={memberships.map((membership) => membership.department_id)}
                label={t('departmentAccess.addDepartment')}
                disabled={departments.isPending || available.length === 0}
              />
            </div>
            <Button type="button" variant="outline" disabled={addingId === null || !available.some((department) => department.id === addingId)} onClick={() => {
              if (addingId === null) return
              append({ department_id: addingId, role: 'member', is_primary: memberships.length === 0 })
              setAddingId(null)
            }}>{t('departmentAccess.add')}</Button>
          </div>
        )}
      </fieldset>
      {errorMessage && <p role="alert" className="text-sm text-accent">{t(errorMessage)}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" disabled={save.isPending} onClick={onCancel}>{t('common.cancel')}</Button>
        <Button type="submit" disabled={save.isPending}>{t(save.isPending ? 'common.saving' : 'common.save')}</Button>
      </div>
    </form>
  )
}
