import { useId, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  api,
  ApiError,
  apiErrorMessage,
  type AdminUserRead,
  type EmployeeLookupItem,
  type Versioned,
  type WorkforceScopeReplace,
  type WorkforceScopeWrite,
} from '@/lib/api'
import { postsForUnit, unitOptions } from '@/lib/dutyUnits'
import { toast } from '@/lib/toast'

interface Props {
  user: AdminUserRead
  effective: ReadonlySet<string>
}

type LocationScopeKind = Exclude<WorkforceScopeWrite['scope_kind'], 'organization'>

const SELECT_CLASS = 'min-h-11 w-full min-w-0 rounded-md border border-input bg-surface px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

function scopeKey(entry: WorkforceScopeWrite): string {
  return JSON.stringify([entry.scope_kind, entry.department ?? null, entry.duty_unit ?? null, entry.duty_post ?? null])
}

function scopeSetKey(entries: WorkforceScopeWrite[]): string {
  return entries.map(scopeKey).sort().join('\n')
}

async function loadLocations(): Promise<EmployeeLookupItem[]> {
  const employees: EmployeeLookupItem[] = []
  let offset = 0
  for (;;) {
    const page = await api.lookupEmployees({ limit: 500, offset })
    employees.push(...page.items)
    offset = page.offset + page.items.length
    if (page.items.length === 0 || offset >= page.total) return employees
  }
}

export function WorkforceScopeSection({ user, effective }: Props): React.JSX.Element | null {
  if (user.role === 'admin' || !effective.has('workforce.people.view')) return null
  return <WorkforceScopeEditor key={user.id} userId={user.id} />
}

function WorkforceScopeEditor({ userId }: { userId: number }): React.JSX.Element {
  const { t } = useTranslation()
  const headingId = useId()
  const queryClient = useQueryClient()
  const queryKey = ['user-workforce-scopes', userId] as const
  const [draft, setDraft] = useState<Versioned<WorkforceScopeReplace> | null>(null)
  const [conflict, setConflict] = useState(false)
  const [kind, setKind] = useState<LocationScopeKind>('department')
  const [department, setDepartment] = useState('')
  const [unit, setUnit] = useState('')
  const [post, setPost] = useState('')
  const scopesQuery = useQuery({
    queryKey,
    queryFn: () => api.getUserWorkforceScopes(userId),
  })
  const snapshot = draft ?? scopesQuery.data
  const scopes = snapshot?.data.scopes ?? []
  const organization = scopes.some((entry) => entry.scope_kind === 'organization')
  const dirty = scopeSetKey(scopes) !== scopeSetKey(scopesQuery.data?.data.scopes ?? [])
  const locationsQuery = useQuery({
    queryKey: ['employees', 'lookup', 'workforce-scope-locations'],
    queryFn: loadLocations,
    staleTime: 60_000,
    enabled: !organization,
  })
  const employees = locationsQuery.data ?? []
  const departments = [...new Set(employees.map((employee) => employee.department?.trim()).filter((value): value is string => !!value))]
  const departmentEmployees = department
    ? employees.filter((employee) => employee.department?.trim() === department)
    : employees
  const units = unitOptions(departmentEmployees)
  const posts = postsForUnit(departmentEmployees, unit)
  const candidate: WorkforceScopeWrite = {
    scope_kind: kind,
    department: department || null,
    duty_unit: kind === 'department' ? null : unit || null,
    duty_post: kind === 'duty_post' ? post || null : null,
  }
  const candidateValid = kind === 'department' ? department !== '' : unit !== '' && (kind !== 'duty_post' || post !== '')
  const duplicate = scopes.some((entry) => scopeKey(entry) === scopeKey(candidate))
  const refreshConflict = async (): Promise<void> => {
    const latest = await scopesQuery.refetch()
    if (!latest.isError && latest.data) {
      const etag = latest.data.etag
      setDraft((current) => current ? { ...current, etag } : current)
    }
  }
  const mutation = useMutation({
    mutationFn: (next: Versioned<WorkforceScopeReplace>) =>
      api.replaceUserWorkforceScopes(userId, next.etag, next.data),
    retry: false,
    onSuccess: async (saved) => {
      queryClient.setQueryData(queryKey, saved)
      setDraft(null)
      setConflict(false)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey }),
        queryClient.invalidateQueries({ queryKey: ['workforce'] }),
      ])
      toast.success(t('access.permissions.scope.saved'))
    },
    onError: async (error) => {
      if (error instanceof ApiError && (error.status === 409 || error.status === 412 || error.code === 'WORKFORCE_VERSION_CONFLICT')) {
        setConflict(true)
        await refreshConflict()
        toast.error(t('access.permissions.scope.conflict'))
      } else {
        toast.error(apiErrorMessage(error))
      }
    },
  })

  const changeScopes = (next: WorkforceScopeWrite[]): void => {
    if (snapshot) setDraft({ etag: snapshot.etag, data: { scopes: next } })
  }
  const chooseOrganization = (wholeOrganization: boolean): void => {
    changeScopes(wholeOrganization
      ? [{ scope_kind: 'organization', department: null, duty_unit: null, duty_post: null }]
      : scopes.filter((entry) => entry.scope_kind !== 'organization'))
  }
  const scopeLabel = (entry: WorkforceScopeWrite): string =>
    [t(`access.permissions.scope.kinds.${entry.scope_kind}`), entry.department, entry.duty_unit, entry.duty_post]
      .filter(Boolean).join(' · ')

  return (
    <section aria-labelledby={headingId} className="mb-5 border-b border-hairline pb-5">
      <h3 id={headingId} className="font-semibold tracking-tight text-foreground">
        {t('access.permissions.scope.title')}
      </h3>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
        {t('access.permissions.scope.selfHint')}
      </p>
      {conflict ? (
        <div className="mt-3 space-y-2 text-sm text-destructive-text">
          <p role="alert">{t('access.permissions.scope.conflict')}</p>
          {scopesQuery.isFetching ? (
            <p role="status">{t('access.permissions.scope.latestLoading')}</p>
          ) : scopesQuery.isError ? (
            <>
              <p role="alert">{t('access.permissions.scope.refreshError')}</p>
              <Button type="button" variant="ghost" onClick={() => void refreshConflict()} className="min-h-11">
                {t('access.permissions.scope.retry')}
              </Button>
            </>
          ) : (
            <div className="text-foreground">
              <p id={`${headingId}-server`} className="font-semibold">{t('access.permissions.scope.serverScope')}</p>
              <ul aria-labelledby={`${headingId}-server`} className="mt-1 space-y-1">
                {scopesQuery.data?.data.scopes?.length ? scopesQuery.data.data.scopes.map((entry) => (
                  <li key={scopeKey(entry)} className="min-w-0 break-words">
                    <bdi dir="auto">{entry.scope_kind === 'organization' ? t('access.permissions.scope.organization') : scopeLabel(entry)}</bdi>
                  </li>
                )) : <li>{t('access.permissions.scope.selfOnly')}</li>}
              </ul>
            </div>
          )}
        </div>
      ) : null}
      {scopesQuery.isError && !conflict ? (
        <div className="mt-3">
          <p role="alert" className="text-sm text-destructive-text">{t('access.permissions.scope.loadError')}</p>
          <Button type="button" variant="ghost" onClick={() => void scopesQuery.refetch()}>
            {t('access.permissions.scope.retry')}
          </Button>
        </div>
      ) : null}
      {!snapshot ? (
        scopesQuery.isError ? null : <Skeleton className="mt-4 h-24 w-full rounded-lg" />
      ) : (
        <div className="mt-4 space-y-4">
          <fieldset disabled={mutation.isPending} className="space-y-2">
            <legend className="sr-only">{t('access.permissions.scope.title')}</legend>
            <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
              <input
                type="radio"
                name={headingId}
                checked={!organization}
                onChange={() => chooseOrganization(false)}
                className="h-4 w-4 shrink-0 accent-primary"
              />
              {t('access.permissions.scope.selected')}
            </label>
            <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
              <input
                type="radio"
                name={headingId}
                checked={organization}
                onChange={() => chooseOrganization(true)}
                className="h-4 w-4 shrink-0 accent-primary"
              />
              {t('access.permissions.scope.organization')}
            </label>
          </fieldset>
          {!organization ? (
            <div className="space-y-4">
              {scopes.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('access.permissions.scope.selfOnly')}</p>
              ) : (
                <ul aria-label={t('access.permissions.scope.entries')} className="divide-y divide-hairline">
                  {scopes.map((entry) => (
                    <li key={scopeKey(entry)} className="flex min-w-0 items-start justify-between gap-2 py-2">
                      <bdi dir="auto" className="min-w-0 break-words pt-2 text-sm">{scopeLabel(entry)}</bdi>
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={mutation.isPending}
                        aria-label={t('access.permissions.scope.remove', { name: scopeLabel(entry) })}
                        onClick={() => changeScopes(scopes.filter((item) => scopeKey(item) !== scopeKey(entry)))}
                        className="min-h-11 shrink-0"
                      >
                        {t('access.permissions.scope.removeEntry')}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              {locationsQuery.isError ? (
                <div>
                  <p role="alert" className="text-sm text-destructive-text">{t('access.permissions.scope.locationsError')}</p>
                  <Button type="button" variant="ghost" onClick={() => void locationsQuery.refetch()}>
                    {t('access.permissions.scope.retry')}
                  </Button>
                </div>
              ) : locationsQuery.isPending ? (
                <p role="status" className="text-sm text-muted-foreground">{t('access.permissions.scope.locationsLoading')}</p>
              ) : (
                <fieldset disabled={mutation.isPending} className="grid min-w-0 gap-3 sm:grid-cols-2">
                  <legend className="sr-only">{t('access.permissions.scope.add')}</legend>
                  <label className="grid min-w-0 gap-1.5 text-xs font-semibold text-muted-foreground">
                    {t('access.permissions.scope.type')}
                    <select
                      value={kind}
                      onChange={(event) => {
                        const next = event.target.value
                        if (next === 'department' || next === 'duty_unit' || next === 'duty_post') setKind(next)
                        setUnit('')
                        setPost('')
                      }}
                      className={SELECT_CLASS}
                    >
                      <option value="department">{t('access.permissions.scope.kinds.department')}</option>
                      <option value="duty_unit">{t('access.permissions.scope.kinds.duty_unit')}</option>
                      <option value="duty_post">{t('access.permissions.scope.kinds.duty_post')}</option>
                    </select>
                  </label>
                  <label className="grid min-w-0 gap-1.5 text-xs font-semibold text-muted-foreground">
                    {t(kind === 'department' ? 'access.permissions.scope.kinds.department' : 'access.permissions.scope.departmentOptional')}
                    <select
                      value={department}
                      onChange={(event) => {
                        setDepartment(event.target.value)
                        setUnit('')
                        setPost('')
                      }}
                      className={SELECT_CLASS}
                    >
                      <option value="">{t(kind === 'department' ? 'access.permissions.scope.chooseDepartment' : 'access.permissions.scope.allDepartments')}</option>
                      {departments.map((value) => <option key={value} value={value}>{value}</option>)}
                    </select>
                  </label>
                  {kind !== 'department' ? (
                    <label className="grid min-w-0 gap-1.5 text-xs font-semibold text-muted-foreground">
                      {t('access.permissions.scope.kinds.duty_unit')}
                      <select
                        value={unit}
                        onChange={(event) => {
                          setUnit(event.target.value)
                          setPost('')
                        }}
                        className={SELECT_CLASS}
                      >
                        <option value="">{t('access.permissions.scope.chooseUnit')}</option>
                        {units.map((value) => <option key={value} value={value}>{value}</option>)}
                      </select>
                    </label>
                  ) : null}
                  {kind === 'duty_post' ? (
                    <label className="grid min-w-0 gap-1.5 text-xs font-semibold text-muted-foreground">
                      {t('access.permissions.scope.kinds.duty_post')}
                      <select value={post} onChange={(event) => setPost(event.target.value)} className={SELECT_CLASS}>
                        <option value="">{t('access.permissions.scope.choosePost')}</option>
                        {posts.map((value) => <option key={value} value={value}>{value}</option>)}
                      </select>
                    </label>
                  ) : null}
                  {duplicate ? (
                    <p role="status" className="text-sm text-muted-foreground sm:col-span-2">{t('access.permissions.scope.duplicate')}</p>
                  ) : null}
                  <div className="sm:col-span-2">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!candidateValid || duplicate}
                      onClick={() => changeScopes([...scopes, candidate])}
                      className="min-h-11"
                    >
                      {t('access.permissions.scope.add')}
                    </Button>
                  </div>
                </fieldset>
              )}
            </div>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            {conflict ? (
              <Button
                type="button"
                variant="outline"
                disabled={mutation.isPending || scopesQuery.isFetching || scopesQuery.isError}
                onClick={() => {
                  setDraft(null)
                  setConflict(false)
                }}
                className="min-h-11"
              >
                {t('access.permissions.scope.discard')}
              </Button>
            ) : null}
            <Button
              type="button"
              disabled={!dirty || mutation.isPending || scopesQuery.isFetching || scopesQuery.isError}
              onClick={() => mutation.mutate(snapshot)}
              className="min-h-11"
            >
              {mutation.isPending ? t('access.permissions.scope.saving') : t('access.permissions.scope.save')}
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}
