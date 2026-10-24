/**
 * Accounts: the default view of Organization & departments. Access is managed
 * for a few dozen accounts, not every employee, so this starts from accounts:
 * what each one sees (as if access limits were on), why, and labelled ways to
 * give more or take extras away. Everything comes from reporting lines and
 * per-account grants; nothing is hardcoded.
 */

import { useId, useState } from 'react'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { AlertTriangle, ChevronDown, Info, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { TFunction } from 'i18next'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { api, type AccountAccessRead, type DepartmentRead, type OrgNodeRead, type PermissionEffect } from '@/lib/api'
import { useAuth } from '@/lib/authContext'
import { bidi } from '@/lib/bidi'
import { departmentErrorMessage, departmentName, invalidateDepartmentData, orderDepartments } from '@/lib/departments'
import { pickEmployeeName } from '@/lib/employeeName'
import { pickPosition } from '@/lib/employeePosition'
import { useCapabilities } from '@/lib/useCapabilities'
import { cn } from '@/lib/utils'
import { AddDepartmentDialog } from './DepartmentDialogs'
import { PersonSearch } from './PersonSearch'
import { INPUT, LABEL, LINK_BUTTON, PANEL, QueryFailure, Sheet, SheetFooter, ViewHeading } from './ui'
import { useOrgData, type OrgRoute } from './useOrgData'

type Grant = 'deputy' | 'viewer'
type Choice = Grant | 'organization'

const HINT_KEY = 'orgDepartments.accountsHintDismissed'
const ORGANIZATION_CAPABILITY = 'departments.all'

/** Grants, links and overrides change the account's departments, services and
 *  effective permissions, wherever those are shown. */
function refreshAccount(qc: QueryClient, userId: number): void {
  invalidateDepartmentData(qc)
  void qc.invalidateQueries({ queryKey: ['user-permissions', userId] })
}

function employeeName(account: AccountAccessRead, lang: string): string {
  return pickEmployeeName({ name_en: account.employee_name_en ?? account.display_name, name_ar: account.employee_name_ar }, lang)
}

/** The org tree's title rule: the profile position in the reader's language,
 *  else the roster designation in the reader's language. */
function personTitle(item: { position: string | null; position_ar: string | null; designation_en: string | null; designation_ar: string | null }, lang: string): string | null {
  return pickPosition(item, lang)?.trim() || (lang.startsWith('ar') && item.designation_ar ? item.designation_ar : item.designation_en)
}

/** "Sees", in plain words, for each kind of scope. */
function seesText(account: AccountAccessRead, lang: string, t: TFunction): string {
  const people = t('orgDepartments.register.people', { count: account.visible_count })
  switch (account.sees) {
    case 'organization':
      return t(account.organization_reason === 'admin'
        ? 'orgDepartments.accounts.sees.admin'
        : account.organization_reason === 'all_departments'
          ? 'orgDepartments.accounts.sees.allDepartments'
          : 'orgDepartments.accounts.sees.organization')
    case 'department': {
      const grants = account.departments.filter((item) => item.role !== 'member')
      const first = grants[0] ?? account.departments[0]
      if (!first) return t('orgDepartments.accounts.sees.self')
      const name = bidi(departmentName(first, lang))
      if (grants.length > 1) {
        return t('orgDepartments.accounts.sees.departments', { name, more: t('orgDepartments.accounts.moreDepartments', { count: grants.length - 1 }), people })
      }
      // Heads and deputies include sub-departments; extra access does not.
      const extra = first.role !== 'viewer' && first.sub_department_count > 0
        ? ` (${t('orgDepartments.accounts.subDepartments', { count: first.sub_department_count })})`
        : ''
      return t('orgDepartments.accounts.sees.department', { name, extra, people })
    }
    case 'branch':
      return t('orgDepartments.accounts.sees.branch', { name: bidi(employeeName(account, lang)), people })
    default:
      return t('orgDepartments.accounts.sees.self')
  }
}

function whyLines(account: AccountAccessRead, lang: string, t: TFunction): string[] {
  const lines: string[] = []
  if (account.organization_reason) lines.push(t(`orgDepartments.accounts.why.${account.organization_reason}`))
  if (!account.employee_id) lines.push(t('orgDepartments.accounts.why.unlinked'))
  const reportsTo = lang.startsWith('ar') && account.reports_to_name_ar ? account.reports_to_name_ar : account.reports_to_name_en
  if (reportsTo) lines.push(t('orgDepartments.accounts.why.reportsTo', { name: bidi(reportsTo) }))
  if (account.team_size > 0) lines.push(t('orgDepartments.accounts.why.team', { people: t('orgDepartments.register.people', { count: account.team_size }) }))
  for (const item of account.departments) {
    lines.push(t(`orgDepartments.accounts.why.${item.role}`, { name: bidi(departmentName(item, lang)) }))
  }
  return lines
}

/** The department's grant lists with this account moved into `role` (or out, for null). */
function peopleWith(department: DepartmentRead, userId: number, role: Grant | null): { deputy_user_ids: number[]; viewer_user_ids: number[] } {
  const deputies = department.deputies.map((item) => item.user_id).filter((id) => id !== userId)
  const viewers = department.viewers.map((item) => item.user_id).filter((id) => id !== userId)
  if (role === 'deputy') deputies.push(userId)
  if (role === 'viewer') viewers.push(userId)
  return { deputy_user_ids: deputies, viewer_user_ids: viewers }
}

interface Giving {
  account: AccountAccessRead
  departmentId?: number
  choice?: Choice | null
  /** A department just created for this grant, before the list refetches. */
  created?: DepartmentRead
}

export function Accounts({ go }: { go: (next: Partial<OrgRoute>) => void }): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const qc = useQueryClient()
  const { user } = useAuth()
  const { has } = useCapabilities()
  const canOverride = has('users.manage')
  const isAdmin = user?.role === 'admin'
  const { canRelink, departmentsById } = useOrgData()
  const overview = useQuery({ queryKey: ['departments', 'account-access'], queryFn: api.departments.accountAccess })
  const [hintHidden, setHintHidden] = useState(() => window.localStorage.getItem(HINT_KEY) === '1')
  const [giving, setGiving] = useState<Giving | null>(null)
  const [linking, setLinking] = useState<AccountAccessRead | null>(null)
  const [creating, setCreating] = useState<{ account: AccountAccessRead; headId: string; choice: Choice | null } | null>(null)

  const setPeople = useMutation({
    mutationFn: ({ department, userId, role }: { department: DepartmentRead; userId: number; role: Grant | null }) =>
      api.departments.setPeople(department.id, peopleWith(department, userId, role)),
    onSuccess: (_result, variables) => {
      refreshAccount(qc, variables.userId)
      toast.success(t(variables.role ? 'orgDepartments.accounts.granted' : 'orgDepartments.accounts.removed'))
    },
    onError: (error) => toast.error(departmentErrorMessage(error, t)),
  })
  const setOrganization = useMutation({
    mutationFn: ({ userId, effect }: { userId: number; effect: PermissionEffect | null }) =>
      api.setUserPermission(userId, ORGANIZATION_CAPABILITY, effect),
    onSuccess: (_result, variables) => {
      refreshAccount(qc, variables.userId)
      toast.success(t(variables.effect === 'grant' ? 'orgDepartments.accounts.granted' : 'orgDepartments.accounts.removed'))
    },
    onError: (error) => toast.error(departmentErrorMessage(error, t)),
  })

  function dismissHint(): void {
    window.localStorage.setItem(HINT_KEY, '1')
    setHintHidden(true)
  }

  function actions(account: AccountAccessRead): React.ReactNode {
    const extras = account.departments.filter((item) => item.role === 'deputy' || item.role === 'viewer')
    return (
      <div className="flex flex-wrap gap-x-2 gap-y-1">
        {account.organization_reason !== 'admin' && (
          <Button variant="outline" size="sm" className="min-h-10" onClick={() => setGiving({ account })}>{t('orgDepartments.accounts.giveMore')}</Button>
        )}
        {!account.employee_id && isAdmin && (
          <Button variant="outline" size="sm" className="min-h-10" onClick={() => setLinking(account)}>{t('orgDepartments.accounts.link')}</Button>
        )}
        {extras.map((item) => {
          const department = departmentsById.get(item.department_id)
          if (!department) return null
          return (
            <button
              key={item.department_id}
              type="button"
              className={cn(LINK_BUTTON, 'text-accent')}
              disabled={setPeople.isPending}
              onClick={() => setPeople.mutate({ department, userId: account.user_id, role: null })}
            >
              <X className="h-3.5 w-3.5" aria-hidden />
              {t(item.role === 'deputy' ? 'orgDepartments.accounts.removeDeputy' : 'orgDepartments.accounts.removeExtra', { name: bidi(departmentName(item, lang)) })}
            </button>
          )
        })}
        {account.organization_reason === 'all_departments' && canOverride && (
          <OrganizationSource
            account={account}
            pending={setOrganization.isPending}
            onRemove={(effect) => setOrganization.mutate({ userId: account.user_id, effect })}
          />
        )}
      </div>
    )
  }

  if (overview.isPending) return <Skeleton className="h-80 w-full rounded-2xl" />
  if (overview.isError) return <QueryFailure error={overview.error} retry={() => void overview.refetch()} />
  const { accounts, unattached_units: units, limits_enabled: limitsOn } = overview.data

  return (
    <div className="space-y-5">
      <ViewHeading title={t('orgDepartments.accounts.title')}>
        {t(limitsOn ? 'orgDepartments.accounts.introOn' : 'orgDepartments.accounts.introOff')}
      </ViewHeading>

      {!hintHidden && (
        <p className="flex items-start gap-2 rounded-xl bg-info-soft px-3.5 py-2.5 text-[0.86em] text-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-info" aria-hidden />
          <span className="min-w-0 flex-1">{t('orgDepartments.accounts.hint')}</span>
          <button
            type="button"
            onClick={dismissHint}
            aria-label={t('orgDepartments.accounts.dismissHint')}
            className="-my-1 grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-surface hover:text-foreground"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </p>
      )}

      {units.length > 0 && (
        <section aria-labelledby="accounts-unattached" className={cn(PANEL, 'space-y-2 px-4 py-4')}>
          <h3 id="accounts-unattached" className="flex items-start gap-2 text-[0.95em] font-semibold text-foreground">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
            {t('orgDepartments.accounts.unattached', { count: units.length })}
          </h3>
          <p className="max-w-[72ch] text-[0.84em] text-muted-foreground">
            {t(canRelink ? 'orgDepartments.accounts.unattachedHint' : 'orgDepartments.accounts.reportingNeedsEdit')}
          </p>
          <ul className="divide-y divide-hairline">
            {units.map((unit) => {
              const name = pickEmployeeName({ name_en: unit.name_en, name_ar: unit.name_ar }, lang)
              return (
                <li key={unit.top_employee_id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2">
                  <span className="min-w-0 text-[0.88em]">
                    <bdi className="font-medium text-foreground">{name}</bdi>
                    <span className="text-muted-foreground">
                      {[personTitle(unit, lang), unit.duty_unit]
                        .filter(Boolean).map((value) => <span key={value}> · <bdi>{value}</bdi></span>)}
                      {' · '}{t('orgDepartments.team', { count: unit.team_with_manager })}
                    </span>
                  </span>
                  {canRelink && (
                    <button type="button" className={LINK_BUTTON} onClick={() => go({ view: 'reporting', employeeId: unit.top_employee_id })}>
                      {t('orgDepartments.accounts.setReportsTo', { name: bidi(name) })}
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      )}

      <div className={cn(PANEL, 'hidden overflow-hidden md:block')}>
        <table className="w-full text-[0.88em]">
          <thead className="bg-surface-raised">
            <tr className="border-b border-hairline">
              <th scope="col" className="px-4 py-2.5 text-start font-medium text-muted-foreground">{t('orgDepartments.accounts.colAccount')}</th>
              <th scope="col" className="px-4 py-2.5 text-start font-medium text-muted-foreground">{t('orgDepartments.accounts.colSees')}</th>
              <th scope="col" className="px-4 py-2.5 text-start font-medium text-muted-foreground">{t('orgDepartments.accounts.colRecords')}</th>
              <th scope="col" className="px-4 py-2.5 text-start font-medium text-muted-foreground">{t('common.actions')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {accounts.map((account) => (
              <tr key={account.user_id} data-account={account.display_name} className="align-top">
                <td className="px-4 py-3"><AccountIdentity account={account} /></td>
                <td className="px-4 py-3"><AccountSees account={account} /></td>
                <td className="px-4 py-3"><AccountRecords account={account} /></td>
                <td className="px-4 py-3">{actions(account)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className={cn(PANEL, 'divide-y divide-hairline md:hidden')}>
        {accounts.map((account) => (
          <li key={account.user_id} className="space-y-2 px-4 py-3.5 text-[0.9em]">
            <AccountIdentity account={account} />
            <AccountSees account={account} />
            <p className="text-[0.9em]"><span className="text-muted-foreground">{t('orgDepartments.accounts.colRecords')}: </span><AccountRecords account={account} /></p>
            {actions(account)}
          </li>
        ))}
      </ul>

      {giving && (
        <GiveAccessDialog
          key={`${giving.account.user_id}:${giving.departmentId ?? ''}`}
          giving={giving}
          canOverride={canOverride}
          onClose={() => setGiving(null)}
          onGrant={(department, role) => setPeople.mutate({ department, userId: giving.account.user_id, role })}
          onOrganization={() => setOrganization.mutate({ userId: giving.account.user_id, effect: 'grant' })}
          onCreateFrom={(headId, choice) => {
            setGiving(null)
            setCreating({ account: giving.account, headId, choice })
          }}
        />
      )}
      {creating && (
        <AddDepartmentDialog
          initialHeadId={creating.headId}
          note={t('orgDepartments.accounts.createNote', { name: bidi(creating.account.display_name) })}
          // Cancelling goes back to Give access; creating returns there with the
          // new department chosen, and nothing is granted until confirmed.
          onClose={() => {
            setCreating(null)
            setGiving({ account: creating.account, choice: creating.choice })
          }}
          onCreated={(department) => setGiving({ account: creating.account, choice: creating.choice, departmentId: department.id, created: department })}
        />
      )}
      {linking && <LinkEmployeeDialog account={linking} onClose={() => setLinking(null)} />}
    </div>
  )
}

/** Where whole-organization access comes from, and the removal that actually ends it. */
function OrganizationSource({ account, pending, onRemove }: {
  account: AccountAccessRead
  pending: boolean
  onRemove: (effect: PermissionEffect | null) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const permissions = useQuery({
    queryKey: ['user-permissions', account.user_id],
    queryFn: () => api.getUserPermissions(account.user_id),
  })
  if (permissions.isPending) return <span className="text-[0.84em] text-muted-foreground">{t('common.loading')}</span>
  if (permissions.isError) return <QueryFailure error={permissions.error} retry={() => void permissions.refetch()} className="text-[0.84em]" />
  // A role default can only be switched off with an explicit deny; an account
  // override is cleared, which returns to a role that does not grant it.
  const fromRole = permissions.data.role_defaults.includes(ORGANIZATION_CAPABILITY)
  return (
    <span className="flex basis-full flex-col items-start">
      <span className="text-[0.84em] text-muted-foreground">
        {fromRole
          ? t('orgDepartments.accounts.organizationFromRole', { role: bidi(t(`access.roleName.${permissions.data.role}`, { defaultValue: permissions.data.role })) })
          : t('orgDepartments.accounts.organizationGiven')}
      </span>
      <button
        type="button"
        className={cn(LINK_BUTTON, '-ms-2 text-accent')}
        disabled={pending}
        onClick={() => onRemove(fromRole ? 'deny' : null)}
      >
        <X className="h-3.5 w-3.5" aria-hidden />
        {t(fromRole ? 'orgDepartments.accounts.turnOffOrganization' : 'orgDepartments.accounts.removeOrganization')}
      </button>
    </span>
  )
}

function AccountIdentity({ account }: { account: AccountAccessRead }): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const title = personTitle(account, lang)
  return (
    <div className="min-w-0">
      {/* The block follows the page direction; only the name is isolated. */}
      <span className="block break-words font-semibold text-foreground"><bdi>{account.display_name}</bdi></span>
      <span className="block text-[0.86em] text-muted-foreground">{t(`access.roleName.${account.role}`, { defaultValue: account.role })}</span>
      {account.employee_id ? (
        <span className="block text-[0.86em] text-foreground">
          <bdi>{employeeName(account, lang)}</bdi>
          {title ? <> · <bdi>{title}</bdi></> : null}
        </span>
      ) : account.sees === 'self' ? (
        <span className="block text-[0.84em] text-warning">{t('orgDepartments.accounts.unlinkedSelf')}</span>
      ) : (
        <span className="block text-[0.84em] text-muted-foreground">{t('orgDepartments.accounts.unlinked')}</span>
      )}
    </div>
  )
}

function AccountSees({ account }: { account: AccountAccessRead }): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <div className="min-w-0">
      <p data-sees className="font-medium text-foreground">{seesText(account, i18n.language, t)}</p>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex min-h-8 items-center gap-1 text-[0.86em] font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform motion-reduce:transition-none', open && 'rotate-180')} aria-hidden />
        {t('orgDepartments.accounts.why.label')}
      </button>
      {open && (
        <ul id={id} className="mt-1 list-disc space-y-0.5 ps-5 text-[0.86em] text-muted-foreground">
          {whyLines(account, i18n.language, t).map((line) => <li key={line}>{line}</li>)}
        </ul>
      )}
    </div>
  )
}

function AccountRecords({ account }: { account: AccountAccessRead }): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const names = account.departments
    .filter((item) => account.receives_department_records.includes(item.department_id))
    .map((item) => departmentName(item, i18n.language))
  if (names.length === 0) return <span className="text-muted-foreground">{t('common.no')}</span>
  return (
    <span>
      <span className="font-medium text-foreground">{t('common.yes')}</span>
      <span className="text-muted-foreground"> · <bdi>{new Intl.ListFormat(i18n.language, { type: 'conjunction' }).format(names)}</bdi></span>
    </span>
  )
}

// ── Give more access ───────────────────────────────────────────────────────

function GiveAccessDialog({ giving, canOverride, onClose, onGrant, onOrganization, onCreateFrom }: {
  giving: Giving
  canOverride: boolean
  onClose: () => void
  onGrant: (department: DepartmentRead, role: Grant) => void
  onOrganization: () => void
  onCreateFrom: (headId: string, choice: Choice | null) => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const id = useId()
  const { account, created } = giving
  const { tree, departments, departmentsById, index } = useOrgData()
  // Nothing is preselected: the admin picks what this account gets.
  const [choice, setChoice] = useState<Choice | null>(giving.choice ?? null)
  const [departmentId, setDepartmentId] = useState(giving.departmentId ? String(giving.departmentId) : '')
  const [fromManager, setFromManager] = useState(false)
  const options: Choice[] = canOverride ? ['viewer', 'deputy', 'organization'] : ['viewer', 'deputy']
  // Same rule as the department people picker: a head is not also its deputy or viewer.
  const headed = new Set(account.departments.filter((item) => item.role === 'head').map((item) => item.department_id))
  const all = departments.data ?? []
  const listed = created && !all.some((item) => item.id === created.id) ? [...all, created] : all
  const choices = orderDepartments(listed).filter(({ department: item }) => item.active && !headed.has(item.id))
  const department = departmentId ? departmentsById.get(Number(departmentId)) ?? (created?.id === Number(departmentId) ? created : undefined) : undefined
  const ready = choice === 'organization' || (choice !== null && department !== undefined)

  return (
    <Sheet
      title={t('orgDepartments.accounts.giveTitle', { name: bidi(account.display_name) })}
      description={t('orgDepartments.accounts.giveDescription')}
      onClose={onClose}
    >
      <div className="min-h-0 space-y-4 overflow-y-auto px-4 py-4">
        <fieldset className="space-y-1">
          <legend className="mb-1.5 text-[0.86em] font-medium text-foreground">{t('orgDepartments.accounts.giveWhat')}</legend>
          {options.map((option) => (
            <label key={option} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg px-2 py-2 hover:bg-surface-tinted">
              <input
                type="radio"
                name={`${id}-choice`}
                checked={choice === option}
                onChange={() => setChoice(option)}
                className="mt-1 h-4 w-4 shrink-0 accent-primary"
              />
              <span className="min-w-0">
                <span className="block text-[0.88em] font-medium text-foreground">{t(`orgDepartments.accounts.give.${option}`)}</span>
                <span className="block text-[0.8em] text-muted-foreground">{t(`orgDepartments.accounts.give.${option}Hint`)}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {!canOverride && <p className="text-[0.84em] text-muted-foreground">{t('orgDepartments.accounts.organizationNeedsAdmin')}</p>}

        {choice !== 'organization' && (
          <div className="space-y-3">
            <div>
              <label htmlFor={`${id}-department`} className="text-[0.84em] font-medium text-foreground">{t('orgDepartments.placement.destination')}</label>
              <select
                id={`${id}-department`}
                value={departmentId}
                onChange={(event) => setDepartmentId(event.target.value)}
                className={INPUT}
              >
                <option value="">{t('departments.choose')}</option>
                {choices.map(({ department: item, depth }) => (
                  <option key={item.id} value={item.id}>{`${'\u00a0\u00a0'.repeat(depth)}${departmentName(item, lang)}`}</option>
                ))}
              </select>
            </div>
            <p className={LABEL}>{t('orgDepartments.accounts.or')}</p>
            {!fromManager ? (
              <button type="button" className={cn(LINK_BUTTON, '-ms-2')} onClick={() => setFromManager(true)}>
                {t('orgDepartments.accounts.fromManager')}
              </button>
            ) : (
              <>
                <p className="text-[0.82em] text-muted-foreground">{t('orgDepartments.accounts.fromManagerHint')}</p>
                <PersonSearch
                  autoFocus
                  people={tree.data ?? []}
                  label={t('orgDepartments.accounts.whoseTeam')}
                  meta={(person: OrgNodeRead) => t('orgDepartments.team', { count: index.branchSize(person.id) })}
                  disabledReason={(person: OrgNodeRead) => {
                    if (person.id === account.employee_id) return t('orgDepartments.accounts.ownEmployee')
                    const existing = all.find((item) => item.head_employee_id === person.id)
                    return existing ? t('orgDepartments.headPicker.alreadyHeads', { name: bidi(departmentName(existing, lang)) }) : null
                  }}
                  onPick={(person) => onCreateFrom(person.id, choice)}
                />
              </>
            )}
          </div>
        )}
      </div>
      <SheetFooter>
        <Button type="button" variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
        <Button
          type="button"
          disabled={!ready}
          onClick={() => {
            if (choice === 'organization') onOrganization()
            else if (choice && department) onGrant(department, choice)
            onClose()
          }}
        >
          {t('orgDepartments.accounts.giveSave')}
        </Button>
      </SheetFooter>
    </Sheet>
  )
}

// ── Link to employee (admin) ───────────────────────────────────────────────

function LinkEmployeeDialog({ account, onClose }: { account: AccountAccessRead; onClose: () => void }): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const qc = useQueryClient()
  const { tree } = useOrgData()
  const [person, setPerson] = useState<OrgNodeRead | null>(null)
  const save = useMutation({
    mutationFn: (employeeId: string) => api.setAuthUserLink(account.user_id, employeeId),
    onSuccess: () => {
      refreshAccount(qc, account.user_id)
      toast.success(t('orgDepartments.accounts.linked'))
      onClose()
    },
    onError: (error) => toast.error(departmentErrorMessage(error, t)),
  })
  return (
    <Sheet
      title={t('orgDepartments.accounts.linkTitle', { name: bidi(account.display_name) })}
      description={t('orgDepartments.accounts.linkDescription')}
      onClose={onClose}
    >
      <div className="min-h-0 space-y-3 overflow-y-auto px-4 py-4">
        {person ? (
          <p className="text-[0.9em] text-foreground">
            {t('orgDepartments.accounts.linkTo', { name: bidi(pickEmployeeName(person, i18n.language)) })}
            {' '}
            <button type="button" className={LINK_BUTTON} onClick={() => setPerson(null)}>{t('orgDepartments.add.chooseOther')}</button>
          </p>
        ) : (
          <PersonSearch autoFocus people={tree.data ?? []} label={t('orgDepartments.accounts.employee')} onPick={setPerson} />
        )}
      </div>
      <SheetFooter>
        <Button type="button" variant="outline" disabled={save.isPending} onClick={onClose}>{t('common.cancel')}</Button>
        <Button type="button" disabled={!person || save.isPending} aria-busy={save.isPending || undefined} onClick={() => { if (person) save.mutate(person.id) }}>
          {t('orgDepartments.accounts.linkSave')}
        </Button>
      </SheetFooter>
    </Sheet>
  )
}
