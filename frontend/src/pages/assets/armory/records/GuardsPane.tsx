import { ArrowLeft, Plus, Search, X } from 'lucide-react'
import type { TFunction } from 'i18next'
import { useEffect, useId, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SkeletonRow } from '@/components/ui/skeleton'
import type { ArmoryAssignmentSummary, ArmoryGuardPage, ArmoryGuardRead, ArmoryQualificationRead } from '@/lib/api'
import { useDebouncedValue } from '@/lib/useDebouncedValue'
import { cn } from '@/lib/utils'

import { Ltr } from '../ArmoryLtr'
import { displayDate, licenceStatusKey, useArmoryLocale, type ArmoryLicenceStatus } from '../armoryFormat'
import { armoryErrorMessage, useArmoryAccess, useArmoryGuard, useArmoryGuards } from '../armoryQueries'
import { armoryLink, patchArmoryParams } from '../armoryUrl'
import { GuardQualificationDialog } from './GuardQualificationDialog'

interface Props {
  safeId: number | null
  qualificationEmployeeId: string | null
  onQualificationDone(): void
}

type OpenEditor = (employeeId: string | null, opener: HTMLElement) => void

const licenceFilters = ['missing', 'expiring', 'expired', 'valid'] as const
const facts = ['courseRound', 'securityNumber', 'securityExpiry', 'licenceState'] as const
const licenceTone: Record<ArmoryLicenceStatus, string> = {
  missing: 'bg-warning-soft text-foreground',
  expiring: 'bg-warning-soft text-foreground',
  expired: 'bg-accent-soft text-destructive-text',
  valid: 'bg-success-soft text-foreground',
}
const tableCell = 'min-w-0 text-start align-top md:table-cell md:px-2 md:py-2 lg:px-3'

function LicenceState({ qualification }: { qualification: ArmoryQualificationRead }): React.JSX.Element {
  const { t } = useTranslation()
  const status = qualification.licence_status
  const days = qualification.licence_days_left
  return (
    <div className="space-y-1">
      <Badge className={cn('max-w-full whitespace-normal normal-case tracking-normal', licenceTone[status])}>{t(licenceStatusKey(status))}</Badge>
      {days !== null && (
        <p className="text-xs text-muted-foreground">
          <Trans
            i18nKey={days < 0 ? 'assets.armory.guardsPane.expiredDays' : 'assets.armory.guardsPane.daysLeft'}
            count={Math.abs(days)}
            components={{ count: <bdi dir="ltr" className="tabular-nums" /> }}
          />
        </p>
      )}
    </div>
  )
}

function qualificationFacts(qualification: ArmoryQualificationRead, t: TFunction): Record<(typeof facts)[number], ReactNode> {
  const none = <span className="text-muted-foreground">{t('assets.armory.none')}</span>
  return {
    courseRound: qualification.course_round === null ? none : <Ltr className="tabular-nums">{qualification.course_round}</Ltr>,
    securityNumber: qualification.licence_number === null ? none : <Ltr className="[overflow-wrap:anywhere]">{qualification.licence_number}</Ltr>,
    securityExpiry: qualification.licence_expires_on === null ? none : <Ltr className="tabular-nums">{displayDate(qualification.licence_expires_on)}</Ltr>,
    licenceState: <LicenceState qualification={qualification} />,
  }
}

function FormerStatus({ status }: { status: string }): React.JSX.Element {
  const { t } = useTranslation()
  const key = status.toLowerCase()
  return (
    <Badge className="bg-surface-tinted text-foreground normal-case tracking-normal">
      {t(key === 'resigned' || key === 'terminated' || key === 'transferred' ? `assets.armory.${key}` : 'assets.armory.employeeStatus.former')}
    </Badge>
  )
}

function Holdings({ assignments, former }: { assignments: ArmoryAssignmentSummary[]; former: boolean }): React.JSX.Element {
  const { t, name } = useArmoryLocale()
  if (assignments.length === 0) return <p className="text-sm text-muted-foreground">{t('assets.armory.holdsNone')}</p>
  return (
    <div className="space-y-2 text-sm">
      <ul className="space-y-2">
        {assignments.map((assignment) => (
          <li key={assignment.id}>
            <Link
              to={assignment.kind === 'custody' ? armoryLink('custody', { custody: assignment.id }) : armoryLink('shift', { issue: assignment.id })}
              className="inline-flex min-h-11 flex-wrap items-center gap-x-1 rounded-sm font-medium text-primary-text underline-offset-4 hover:underline"
            >
              <span>{t(`assets.armory.assignmentKind.${assignment.kind}`)}</span>{' '}
              <Ltr className="tabular-nums">{assignment.record_ref}</Ltr>
            </Link>
            <ul className="space-y-0.5 text-xs text-muted-foreground">
              {assignment.lines.filter((line) => line.remaining_qty > 0).map((line) => (
                <li key={line.id} className="flex flex-wrap gap-x-1 [overflow-wrap:anywhere]">
                  <span>
                    <Trans i18nKey="assets.armory.guardsPane.lineQty" count={line.remaining_qty}
                      values={{ item: name(line.item) }}
                      components={{ count: <bdi dir="ltr" className="tabular-nums" />, item: <bdi /> }} />
                  </span>
                  {line.serial_code && <Ltr className="tabular-nums">{line.serial_code}</Ltr>}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      {former && (
        <p className="rounded-md bg-warning-soft px-2 py-1.5 text-xs font-medium">
          {t(assignments.some(({ kind }) => kind === 'custody') ? 'assets.armory.clearanceCustody' : 'assets.armory.guardsPane.clearanceHoldings')}
        </p>
      )}
    </div>
  )
}

function EditLicence({ guard, onEdit, inRow }: { guard: ArmoryGuardRead; onEdit: OpenEditor; inRow?: boolean }): React.JSX.Element {
  const { t, name } = useArmoryLocale()
  const action = t(guard.qualification.licence_number === null ? 'assets.armory.addLicence' : 'assets.armory.updateLicence')
  return (
    <Button
      type="button"
      variant={inRow ? 'link' : 'outline'}
      className={cn('min-h-11', inRow && 'whitespace-normal px-0 text-start text-primary-text')}
      aria-label={inRow ? t('assets.armory.guardsPane.editFor', { action, name: name(guard.person) }) : undefined}
      onClick={(event) => onEdit(guard.person.employee_id, event.currentTarget)}
    >
      {action}
    </Button>
  )
}

function GuardRow({ guard, canEdit, detailPrefix, onOpen, onEdit }: {
  guard: ArmoryGuardRead
  canEdit: boolean
  detailPrefix: string
  onOpen(event: MouseEvent<HTMLAnchorElement>): void
  onEdit: OpenEditor
}): React.JSX.Element {
  const { t, name } = useArmoryLocale()
  const { person, qualification, open_assignments } = guard
  const values = qualificationFacts(qualification, t)
  return (
    <tr role="row" className="grid grid-cols-2 gap-x-3 gap-y-2 border-t border-hairline p-3 md:table-row md:p-0">
      <th role="rowheader" scope="row" className={cn(tableCell, 'col-span-2 font-normal')}>
        <Link className="flex min-h-11 flex-col items-start justify-center rounded-sm font-semibold text-primary-text underline-offset-4 hover:underline"
          to={`${detailPrefix}${encodeURIComponent(person.employee_id)}`} onClick={onOpen}>
          <bdi className="[overflow-wrap:anywhere]">{name(person)}</bdi>
          <Ltr className="text-xs font-normal text-muted-foreground tabular-nums [overflow-wrap:anywhere]">{person.employee_id}</Ltr>
        </Link>
        {person.is_former && <FormerStatus status={person.employee_status} />}
      </th>
      {facts.map((field) => (
        <td role="cell" key={field} className={cn(tableCell, 'text-sm md:py-3')}>
          <span aria-hidden className="mb-0.5 block text-xs text-muted-foreground md:hidden">{t(`assets.armory.${field}`)}</span>
          {values[field]}
        </td>
      ))}
      <td role="cell" className={cn(tableCell, 'col-span-2')}>
        <span aria-hidden className="block text-xs text-muted-foreground md:hidden">{t('assets.armory.holdsNow')}</span>
        <Holdings assignments={open_assignments} former={person.is_former} />
      </td>
      {canEdit && (
        <td role="cell" className={cn(tableCell, 'col-span-2', person.is_former && 'hidden')}>
          {!person.is_former && <EditLicence guard={guard} onEdit={onEdit} inRow />}
        </td>
      )}
    </tr>
  )
}

function GuardTable({ items, canEdit, detailPrefix, onOpen, onEdit }: {
  items: ArmoryGuardPage['items']
  canEdit: boolean
  detailPrefix: string
  onOpen(event: MouseEvent<HTMLAnchorElement>): void
  onEdit: OpenEditor
}): React.JSX.Element {
  const { t } = useTranslation()
  const active: ArmoryGuardRead[] = []
  const former: ArmoryGuardRead[] = []
  for (const guard of items) (guard.person.is_former ? former : active).push(guard)
  const row = (guard: ArmoryGuardRead) => (
    <GuardRow key={guard.person.employee_id} guard={guard} canEdit={canEdit} detailPrefix={detailPrefix} onOpen={onOpen} onEdit={onEdit} />
  )
  const headingClass = 'px-2 py-2 text-start font-medium lg:px-3'
  return (
    <table role="table" aria-label={t('assets.armory.guards')} className="block w-full md:table md:table-fixed">
      <thead role="rowgroup" className="sr-only text-xs text-muted-foreground md:not-sr-only md:table-header-group">
        <tr role="row">
          <th role="columnheader" scope="col" className={`${headingClass} md:w-[20%]`}>{t('assets.armory.guard')}</th>
          {facts.map((field) => (
            <th role="columnheader" scope="col" key={field} className={`${headingClass} md:w-[12%]`}>{t(`assets.armory.${field}`)}</th>
          ))}
          <th role="columnheader" scope="col" className={headingClass}>{t('assets.armory.holdsNow')}</th>
          {canEdit && <th role="columnheader" scope="col" className={`${headingClass} md:w-[13%]`}><span className="sr-only">{t('assets.armory.action')}</span></th>}
        </tr>
      </thead>
      {active.length > 0 && <tbody role="rowgroup" className="block md:table-row-group">{active.map(row)}</tbody>}
      {former.length > 0 && (
        <tbody role="rowgroup" aria-label={t('assets.armory.formerGuards')} className="block md:table-row-group">
          <tr role="row" className="block md:table-row">
            <th role="rowheader" scope="rowgroup" colSpan={facts.length + (canEdit ? 3 : 2)} className="block border-t border-hairline bg-surface-raised px-3 py-2 text-start text-sm font-semibold md:table-cell">
              {t('assets.armory.formerGuards')}
            </th>
          </tr>
          {former.map(row)}
        </tbody>
      )}
    </table>
  )
}

function GuardDetail({ employeeId, canEdit, onEdit }: { employeeId: string; canEdit: boolean; onEdit: OpenEditor }): React.JSX.Element {
  const { t, name } = useArmoryLocale()
  const query = useArmoryGuard(employeeId)
  if (query.isError) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <p role="alert" className="text-sm text-destructive-text">{armoryErrorMessage(query.error)}</p>
        <Button type="button" variant="ghost" className="min-h-11" onClick={() => void query.refetch()}>{t('assets.armory.retry')}</Button>
      </div>
    )
  }
  if (!query.data || query.isPlaceholderData) {
    return <div role="status"><span className="sr-only">{t('assets.armory.loadingText')}</span><SkeletonRow cols={3} /></div>
  }
  const guard = query.data.data
  const values = qualificationFacts(guard.qualification, t)
  return (
    <article className="space-y-5 rounded-lg border border-border bg-surface p-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold [overflow-wrap:anywhere]"><bdi>{name(guard.person)}</bdi></h2>
          <p className="mt-0.5 text-sm text-muted-foreground"><Ltr className="tabular-nums">{guard.person.employee_id}</Ltr></p>
        </div>
        {guard.person.is_former ? <FormerStatus status={guard.person.employee_status} /> : canEdit && <EditLicence guard={guard} onEdit={onEdit} />}
      </header>
      <dl className="grid grid-cols-2 gap-4 border-y border-hairline py-4 md:grid-cols-4">
        {facts.map((field) => (
          <div key={field} className="min-w-0 space-y-1">
            <dt className="text-xs text-muted-foreground">{t(`assets.armory.${field}`)}</dt>
            <dd className="text-sm">{values[field]}</dd>
          </div>
        ))}
      </dl>
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">{t('assets.armory.holdsNow')}</h3>
        <Holdings assignments={guard.open_assignments} former={guard.person.is_former} />
      </section>
    </article>
  )
}

export function GuardsPane(props: Props): React.JSX.Element {
  const { t } = useTranslation()
  const { canView, canEdit, isLoading, principal } = useArmoryAccess()
  if (!canView || principal === null) {
    return isLoading
      ? <p role="status" className="text-sm text-muted-foreground">{t('assets.armory.loadingText')}</p>
      : <p role="alert" className="text-sm">{t('common.forbidden')}</p>
  }
  return <GuardDirectory key={principal} qualificationEmployeeId={props.qualificationEmployeeId} onQualificationDone={props.onQualificationDone} canEdit={canEdit} />
}

function GuardDirectory({ qualificationEmployeeId, onQualificationDone, canEdit }: Omit<Props, 'safeId'> & { canEdit: boolean }): React.JSX.Element {
  const { t } = useTranslation()
  const filterLabel = useId()
  const [params, setParams] = useSearchParams()
  const guardId = params.get('guard')?.trim() || null
  const listParams = patchArmoryParams(params, { guard: null })
  const listSearch = listParams.toString()
  const detailPrefix = listSearch ? `?${listSearch}&guard=` : '?guard='
  const [search, setSearch] = useState('')
  const trimmedSearch = search.trim()
  const delayedSearch = useDebouncedValue(trimmedSearch, 250)
  const q = trimmedSearch ? delayedSearch || undefined : undefined
  const searching = trimmedSearch !== (q ?? '')
  const [licenceStatus, setLicenceStatus] = useState<ArmoryLicenceStatus>()
  const [includeFormer, setIncludeFormer] = useState(false)
  const [page, setPage] = useState(1)
  // Qualifications and outstanding holdings are global; the Guards API is not safe-scoped.
  const query = useArmoryGuards({ q, licence_status: licenceStatus, include_former: includeFormer, page })
  const data = query.isSuccess && !query.isPlaceholderData && !searching ? query.data : undefined
  const applied = Number(trimmedSearch !== '') + Number(licenceStatus !== undefined) + Number(includeFormer)
  const searchInput = useRef<HTMLInputElement>(null)
  const back = useRef<HTMLButtonElement>(null)
  const detailOpener = useRef<HTMLAnchorElement | null>(null)
  const previousDetail = useRef<string | null>(null)
  const [editor, setEditor] = useState<{ employeeId: string | null; opener: HTMLElement } | null>(null)
  const [closedRequest, setClosedRequest] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const suspended = canEdit && qualificationEmployeeId !== null && qualificationEmployeeId !== closedRequest

  if (closedRequest !== null && closedRequest !== qualificationEmployeeId) setClosedRequest(null)
  if (editor !== null && (!canEdit || suspended)) setEditor(null)

  useEffect(() => {
    if (guardId !== null && !suspended) back.current?.focus()
    if (guardId === null && previousDetail.current !== null) {
      const opener = detailOpener.current
      const target = opener?.isConnected ? opener : searchInput.current
      target?.focus()
      detailOpener.current = null
    }
    previousDetail.current = guardId
  }, [guardId, suspended])

  function openEditor(employeeId: string | null, opener: HTMLElement) {
    setSaved(false)
    setEditor({ employeeId, opener })
  }

  function finishQualification(didSave: boolean) {
    if (didSave) setSaved(true)
    if (suspended) {
      setClosedRequest(qualificationEmployeeId)
      onQualificationDone()
    } else {
      setEditor(null)
    }
  }

  const pending = searching || query.isPending || query.isPlaceholderData
  const searchableError = !searching && query.isError
  const restoreFocus = !suspended && editor !== null ? () => {
    const target = editor.opener.isConnected && !editor.opener.closest('[hidden]')
      ? editor.opener
      : back.current ?? searchInput.current
    target?.focus()
  } : undefined

  return (
    <section aria-label={t('assets.armory.guards')} className="space-y-3">
      <p role="status" className={saved ? 'rounded-md bg-success-soft px-3 py-2 text-sm' : 'sr-only'}>{saved && t('assets.armory.guardsPane.savedQualification')}</p>
      <div hidden={guardId !== null} className="rounded-lg border border-border bg-surface">
        <div className="space-y-3 px-3 py-3 sm:px-4">
          <header className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold">{t('assets.armory.guards')}</h2>
            {canEdit && (
              <Button type="button" className="min-h-11" onClick={(event) => openEditor(null, event.currentTarget)}>
                <Plus className="size-4" aria-hidden />{t('assets.armory.guardsPane.addGuard')}
              </Button>
            )}
          </header>
          <div className="relative min-w-0 sm:max-w-md">
            <Search aria-hidden className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input ref={searchInput} type="search" dir="auto" maxLength={120} className="min-h-11 ps-9 pe-11 [&::-webkit-search-cancel-button]:appearance-none"
              aria-label={t('assets.armory.searchGuard')} placeholder={t('assets.armory.searchGuard')} value={search}
              onChange={(event) => { setSearch(event.target.value); setPage(1) }} />
            {search !== '' && (
              <Button type="button" size="icon" variant="ghost" aria-label={t('assets.armory.clearSearch')} className="absolute end-0 top-0 min-h-11 min-w-11"
                onClick={() => { setSearch(''); setPage(1); searchInput.current?.focus() }}>
                <X aria-hidden className="size-4" />
              </Button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span id={filterLabel} className="text-sm font-medium">
              <Trans i18nKey="assets.armory.guardsPane.filters" count={applied} components={{ count: <bdi dir="ltr" className="tabular-nums" /> }} />
            </span>
            <div role="group" aria-labelledby={filterLabel} className="flex flex-wrap gap-1.5">
              <Button type="button" variant="outline" size="sm" className="min-h-11 aria-pressed:border-primary aria-pressed:bg-primary-soft aria-pressed:text-primary-text"
                aria-pressed={licenceStatus === undefined} onClick={() => { setLicenceStatus(undefined); setPage(1) }}>
                {t('assets.armory.all')}
              </Button>
              {licenceFilters.map((status) => (
                <Button key={status} type="button" variant="outline" size="sm" className="min-h-11 aria-pressed:border-primary aria-pressed:bg-primary-soft aria-pressed:text-primary-text"
                  aria-pressed={licenceStatus === status} onClick={() => { setLicenceStatus(status); setPage(1) }}>
                  <span>{t(status === 'missing' ? 'assets.armory.missingFilter' : status === 'expiring' ? 'assets.armory.expiringFilter' : licenceStatusKey(status))}</span>{' '}
                  {data && <Ltr className="tabular-nums">{data.filter_counts[status]}</Ltr>}
                </Button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <label className="inline-flex min-h-11 items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-primary" checked={includeFormer} onChange={(event) => { setIncludeFormer(event.target.checked); setPage(1) }} />
              {t('assets.armory.showFormer')}
            </label>
            {applied > 0 && (
              <Button type="button" variant="ghost" className="min-h-11" onClick={() => { setSearch(''); setLicenceStatus(undefined); setIncludeFormer(false); setPage(1); searchInput.current?.focus() }}>
                {t('assets.armory.clearFilters')}
              </Button>
            )}
            {data && (
              <p role="status" className="text-sm text-muted-foreground sm:ms-auto">
                <Trans i18nKey="assets.armory.guardsPane.guardCount" count={data.total} components={{ count: <bdi dir="ltr" className="tabular-nums" /> }} />
              </p>
            )}
          </div>
        </div>
        {searchableError ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-hairline p-3">
            <p role="alert" className="text-sm text-destructive-text">{armoryErrorMessage(query.error)}</p>
            <Button type="button" variant="ghost" className="min-h-11" onClick={() => void query.refetch()}>{t('assets.armory.retry')}</Button>
          </div>
        ) : pending ? (
          <div role="status"><span className="sr-only">{t('assets.armory.loadingText')}</span><SkeletonRow /><SkeletonRow /></div>
        ) : data && data.items.length > 0 ? (
          <GuardTable items={data.items} canEdit={canEdit} detailPrefix={detailPrefix} onEdit={openEditor}
            onOpen={(event) => {
              if (!event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) detailOpener.current = event.currentTarget
            }} />
        ) : (
          <p className="border-t border-hairline px-3 py-5 text-sm text-muted-foreground">
            {t(applied ? 'assets.armory.noGuardsMatch' : 'assets.armory.guardsPane.empty')}
          </p>
        )}
        {data && (page > 1 || page * data.page_size < data.total) && (
          <nav aria-label={t('assets.armory.guardsPane.pagination')} className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline px-3 py-2">
            <Button type="button" variant="outline" className="min-h-11" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t('common.previous')}</Button>
            <p className="text-sm text-muted-foreground"><Trans i18nKey="assets.armory.guardsPane.pageOf" values={{ page, pages: Math.ceil(data.total / data.page_size) }} components={{ page: <bdi dir="ltr" />, pages: <bdi dir="ltr" /> }} /></p>
            <Button type="button" variant="outline" className="min-h-11" disabled={page * data.page_size >= data.total} onClick={() => setPage(page + 1)}>{t('common.next')}</Button>
          </nav>
        )}
      </div>
      {guardId !== null && (
        <>
          <Button ref={back} type="button" variant="ghost" className="min-h-11" onClick={() => setParams(listParams, { replace: true })}>
            <ArrowLeft aria-hidden className="size-4 rtl:-scale-x-100" />{t('assets.armory.back')}
          </Button>
          <GuardDetail employeeId={guardId} canEdit={canEdit} onEdit={openEditor} />
        </>
      )}
      {canEdit && (suspended || editor !== null) && (
        <GuardQualificationDialog key={suspended ? 'shell' : 'directory'} open employeeId={suspended ? qualificationEmployeeId : editor?.employeeId ?? null}
          onClose={finishQualification} restoreFocus={restoreFocus} />
      )}
    </section>
  )
}
