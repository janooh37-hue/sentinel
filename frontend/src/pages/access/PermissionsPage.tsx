import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { useIsMutating, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import type { StudioDestination, Resource, ResourceSearchProps } from '@/components/access/studio/contracts'
import { api, apiErrorMessage, type AdminUserRead } from '@/lib/api'
import { useAuth } from '@/lib/authContext'
import { accessSnapshotKey } from '@/lib/permissionStudioApi'
import { formatDmy } from '@/lib/formatDmy'
import { Button } from '@/components/ui/button'

const PAGE_SIZE = 25
const controlClass = 'min-h-11 min-w-0 rounded-lg border border-border bg-surface px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary'

function findScrollContainer(element: HTMLElement | null): HTMLElement | null {
  for (let node = element?.parentElement; node; node = node.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight) return node
  }
  return document.scrollingElement instanceof HTMLElement ? document.scrollingElement : null
}

// Search only the authorized account projection; never fetch the employee directory.
function searchableText(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[\u064b-\u065f\u0670\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x660))
    .replace(/\s+/g, ' ').trim()
}
function nameOf(account: AdminUserRead, arabic: boolean): string {
  return (arabic && account.name_ar) || account.display_name || account.name_en || account.email
}
function resourceFromParam(value: string | null): Resource | undefined {
  if (!value) return undefined
  try {
    const parsed: unknown = JSON.parse(value)
    if (typeof parsed !== 'object' || parsed === null || !('kind' in parsed) || !('id' in parsed)) return undefined
    const { kind, id } = parsed
    if (typeof id !== 'string') return undefined
    switch (kind) {
      case 'capability': case 'service': case 'book': case 'notification_template':
      case 'email_template': case 'word_template': case 'editor_template': return { kind, id }
      default: return undefined
    }
  } catch { return undefined }
}

export interface PermissionStudioIntegration {
  renderWorkspace: (props: {
    subjectId: number
    initialResource?: Resource
    onNavigate: (destination: StudioDestination) => void
    renderSearch: (props: ResourceSearchProps) => ReactNode
  }) => ReactNode
  renderSearch: (props: ResourceSearchProps) => ReactNode
  requestNavigation: (proceed: () => void) => boolean
}

/** People subsection integration point. The department branch owns the outer people/org shell. */
export function PeoplePermissionsPanel({ studio }: { studio?: PermissionStudioIntegration } = {}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()
  const routeNavigate = useNavigate()
  const [query, setQuery] = useState('')
  const [role, setRole] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const openedAccount = useRef<number | null>(null)
  const registerRef = useRef<HTMLElement>(null)
  const scrollPosition = useRef(0)
  const arabic = i18n.language.startsWith('ar')
  const usersQuery = useQuery({ queryKey: ['auth-users'], queryFn: api.listAuthUsers })
  const requestsQuery = useQuery({ queryKey: ['permission-requests'], queryFn: api.listPermissionRequests })
  const accounts = useMemo(() => usersQuery.data ?? [], [usersQuery.data])
  const selectedParam = params.get('user')
  const selectedId = selectedParam !== null && /^\d+$/.test(selectedParam) ? Number(selectedParam) : null
  const selected = accounts.find((account) => account.id === selectedId)
  const saving = useIsMutating({ mutationKey: selectedId === null ? ['permission-studio', user?.id, -1, 'save'] : [...accessSnapshotKey(user?.id, selectedId), 'save'] }) > 0
  const filtered = useMemo(() => {
    const needle = searchableText(query)
    return accounts.filter((account) => (!role || account.role === role) && (!status || account.status === status)
      && (!needle || searchableText([account.display_name, account.name_en,
        account.name_ar, account.email, account.employee_id].join(' ')).includes(needle)))
  }, [accounts, query, role, status])
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const rows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
  const pendingCount = (requestsQuery.data ?? []).filter((request) => request.user_id === selectedId && request.status === 'pending').length
  const roles = [...new Set(accounts.map((account) => account.role))].sort()
  const statuses = [...new Set(accounts.map((account) => account.status))].sort()

  useEffect(() => {
    if (selectedParam !== null || openedAccount.current === null) return
    const trigger = registerRef.current?.querySelector<HTMLButtonElement>(`[data-account-id="${openedAccount.current}"]`)
    trigger?.focus({ preventScroll: true })
    const scroller = findScrollContainer(registerRef.current)
    if (scroller) scroller.scrollTop = scrollPosition.current
  }, [selectedParam])

  function navigate(destination: StudioDestination): void {
    if (saving) return
    setParams((previous) => {
      const next = new URLSearchParams(previous)
      if (destination.userId !== undefined) next.set('user', String(destination.userId))
      if (destination.resource) next.set('psResource', JSON.stringify(destination.resource))
      return next
    })
  }
  function openAccount(id: number): void {
    if (saving) return
    openedAccount.current = id
    const scroller = findScrollContainer(registerRef.current)
    scrollPosition.current = scroller?.scrollTop ?? 0
    navigate({ userId: id })
  }
  function back(): void {
    if (saving) return
    const proceed = () => setParams((previous) => {
      const next = new URLSearchParams(previous)
      next.delete('user'); next.delete('psResource'); next.delete('psFilter')
      return next
    })
    if (!studio?.requestNavigation(proceed)) proceed()
  }
  function guardManagementNavigation(event: MouseEvent<HTMLAnchorElement>): void {
    if (saving) { event.preventDefault(); return }
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
    event.preventDefault()
    const destination = event.currentTarget.getAttribute('href')
    if (!destination) return
    const proceed = () => routeNavigate(destination)
    if (!studio?.requestNavigation(proceed)) proceed()
  }
  const managementLink = <Link onClick={guardManagementNavigation} aria-disabled={saving || undefined} tabIndex={saving ? -1 : undefined} className="inline-flex min-h-11 items-center text-primary underline underline-offset-4" to="/access-requests">{t('access.studio.manageAccounts')}</Link>
  return <section ref={registerRef} className="min-w-0 space-y-5 [&_button]:min-h-11" aria-busy={usersQuery.isPending || saving}>
    <header className="flex flex-wrap items-start justify-between gap-3">
      <h1 className="text-2xl font-semibold tracking-tight">{t('access.studio.accounts')}</h1>
      {managementLink}
    </header>
    {usersQuery.isPending ? <p role="status">{t('common.loading')}</p>
      : usersQuery.isError ? <div role="alert"><p>{t('access.loadError')}: {apiErrorMessage(usersQuery.error)}</p><Button onClick={() => void usersQuery.refetch()}>{t('common.retry')}</Button></div>
      : selectedParam !== null ? <>
        <Button variant="ghost" onClick={back} disabled={saving}>{t('access.studio.backToAccounts')}</Button>
        {!selected ? <p role="alert">{t('access.studio.accountUnavailable')}</p> : <>
          <header className="space-y-2 border-b border-border pb-4">
            <h2 className="break-words text-xl font-semibold"><bdi>{nameOf(selected, arabic)}</bdi></h2>
            <p className="flex flex-wrap gap-3 text-sm"><bdi dir="ltr" className="break-all">{selected.email}</bdi><bdi dir="ltr">{selected.employee_id}</bdi><Link onClick={guardManagementNavigation} aria-disabled={saving || undefined} tabIndex={saving ? -1 : undefined} className="inline-flex min-h-11 items-center text-primary underline" to={`/access-requests?tab=${selected.status === 'active' ? 'active' : 'suspended'}&user=${selected.id}`}>{t(`access.roleName.${selected.role}`)}</Link><span>{t(`access.status.${selected.status}`)}</span></p>
            <Link onClick={guardManagementNavigation} aria-disabled={saving || undefined} tabIndex={saving ? -1 : undefined} className="inline-flex min-h-11 items-center text-primary underline" to="/access-requests?tab=permission-requests">{t('access.studio.pendingRequests', { count: pendingCount })}</Link>
          </header>
          {selected.status === 'pending' ? <Link onClick={guardManagementNavigation} aria-disabled={saving || undefined} tabIndex={saving ? -1 : undefined} className="inline-flex min-h-11 items-center text-primary underline" to={`/access-requests?user=${selected.id}`}>{t('access.studio.reviewAccount')}</Link>
            : selected.role === 'admin' ? <p role="status">{t('access.studio.adminLocked')}</p>
            : selected.id === user?.id ? <p role="status">{t('access.studio.selfLocked')}</p>
            : <>
              {selected.status !== 'active' && <p role="status" className="rounded-lg bg-warning-soft p-3 text-warning">{t('access.studio.disabledReadOnly')}</p>}
              {/* Orchestrator wires AccessWorkspace and StudioSearch public exports here after B/C merge. */}
              {studio ? <div key={selected.id}>{studio.renderWorkspace({ subjectId: selected.id, initialResource: resourceFromParam(params.get('psResource')), onNavigate: navigate, renderSearch: studio.renderSearch })}</div> : <p role="status">{t('access.studio.workspaceUnavailable')}</p>}
            </>}
        </>}
      </> : <>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
          <label className="flex min-w-0 flex-col gap-1 text-sm">{t('access.studio.searchAccounts')}<input type="search" dir="auto" value={query} className={controlClass} onChange={(event) => { setQuery(event.target.value); setPage(1) }} /></label>
          <label className="flex flex-col gap-1 text-sm">{t('access.studio.role')}<select value={role} className={controlClass} onChange={(event) => { setRole(event.target.value); setPage(1) }}><option value="">{t('access.studio.allRoles')}</option>{roles.map((value) => <option key={value} value={value}>{t(`access.roleName.${value}`)}</option>)}</select></label>
          <label className="flex flex-col gap-1 text-sm">{t('access.studio.statusLabel')}<select value={status} className={controlClass} onChange={(event) => { setStatus(event.target.value); setPage(1) }}><option value="">{t('access.studio.allStatuses')}</option>{statuses.map((value) => <option key={value} value={value}>{t(`access.status.${value}`)}</option>)}</select></label>
        </div>
        <p role="status" className="text-sm text-muted-foreground">{t('access.studio.accountCount', { count: filtered.length })}</p>
        {filtered.length === 0 ? <div className="space-y-3 py-8"><p>{t(accounts.length ? 'access.studio.noMatchingAccounts' : 'access.studio.noAccounts')}</p>{accounts.length > 0 && <Button variant="outline" onClick={() => { setQuery(''); setRole(''); setStatus(''); setPage(1) }}>{t('access.studio.clearFilters')}</Button>}</div>
          : <table className="w-full table-fixed text-start text-sm">
            <thead className="hidden border-b border-border md:table-header-group"><tr>{['account', 'role', 'statusLabel', 'lastSignIn', 'editAccess'].map((key) => <th key={key} scope="col" className="px-3 py-3 text-start font-medium text-muted-foreground">{t(`access.studio.${key}`)}</th>)}</tr></thead>
            <tbody className="block md:table-row-group">{rows.map((account) => <tr key={account.id} className="mb-3 block border-b border-border py-3 md:table-row md:py-0">
              <th scope="row" className="block min-w-0 px-3 py-2 text-start font-medium md:table-cell"><bdi className="block break-words">{nameOf(account, arabic)}</bdi><span className="block text-xs font-normal text-muted-foreground [overflow-wrap:anywhere]"><bdi dir="ltr">{account.email}</bdi></span><span className="block text-xs font-normal"><bdi dir="ltr">{account.employee_id}</bdi></span></th>
              <td className="inline-block px-3 py-2 align-top md:table-cell">{t(`access.roleName.${account.role}`)}</td><td className="inline-block px-3 py-2 align-top md:table-cell">{t(`access.status.${account.status}`)}</td>
              <td className="block px-3 py-2 align-top md:table-cell"><span className="md:hidden">{t('access.studio.lastSignIn')}: </span>{account.last_login_at ? <time className="inline-block font-mono tabular-nums" dateTime={account.last_login_at} dir="ltr">{formatDmy(account.last_login_at.slice(0, 10))}</time> : t('access.studio.neverSignedIn')}</td>
              <td className="block px-3 py-2 align-top md:table-cell">{account.status === 'pending' ? <Link className="inline-flex min-h-11 items-center text-primary underline" to={`/access-requests?user=${account.id}`}>{t('access.studio.reviewAccount')}</Link> : <Button variant="outline" className="h-auto max-w-full whitespace-normal py-3" data-account-id={account.id} onClick={() => openAccount(account.id)}>{t(account.status === 'active' && account.role !== 'admin' && account.id !== user?.id ? 'access.studio.editAccess' : 'access.studio.viewAccess')}</Button>}</td>
            </tr>)}</tbody>
          </table>}
        <nav aria-label={t('access.studio.pagination')} className="flex flex-wrap items-center justify-end gap-3"><Button variant="outline" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>{t('common.previous')}</Button><span dir="ltr" className="tabular-nums">{currentPage} / {pageCount}</span><Button variant="outline" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>{t('common.next')}</Button></nav>
      </>}
  </section>
}

export function PermissionsPage({ studio }: { studio?: PermissionStudioIntegration } = {}): React.JSX.Element {
  return <div className="min-w-0 flex-1 overflow-auto bg-background"><div className="mx-auto w-full max-w-[1440px] px-4 pb-12 pt-6 md:px-7"><PeoplePermissionsPanel studio={studio} /></div></div>
}
export default PermissionsPage
