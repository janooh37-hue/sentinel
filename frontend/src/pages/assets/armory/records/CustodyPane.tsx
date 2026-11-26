import { ArrowLeft, ChevronLeft, ChevronRight, Printer, Search, X } from 'lucide-react'
import { type ReactNode, type Ref, useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { ApiError, type ArmoryActorRead, type ArmoryAssignmentRead, type ArmoryAssignmentSummary } from '@/lib/api'
import { useDebouncedValue } from '@/lib/useDebouncedValue'
import { useIsMobile } from '@/lib/useIsMobile'
import { cn } from '@/lib/utils'

import { Ltr } from '../ArmoryLtr'
import { actorName, displayDate, licenceStatusKey, orgDateTime, useArmoryLocale } from '../armoryFormat'
import { useArmoryAccess, useArmoryCustody, useArmoryCustodyDetail } from '../armoryQueries'
import { armoryLink, patchArmoryParams, readArmoryId } from '../armoryUrl'
import { CustodyReceipt } from './CustodyReceipt'

const filters = ['active', 'ended', 'all'] as const
const panel = 'min-w-0 rounded-xl border border-border bg-surface'

type CustodyPaneProps = {
  safeId: number | null
  onOpenHandover(opener: HTMLElement): void
  onOpenReturn(assignmentId: number, opener: HTMLElement): void
}

export function CustodyPane(props: CustodyPaneProps): React.JSX.Element {
  const { canView, canEdit } = useArmoryAccess()
  return canView ? <CustodyWorkspace {...props} editable={canEdit} /> : <></>
}

function CustodyWorkspace({ safeId, onOpenHandover, onOpenReturn, editable }: CustodyPaneProps & { editable: boolean }) {
  const { t, name, isAr } = useArmoryLocale()
  const mobile = useIsMobile()
  const [params, setParams] = useSearchParams()
  const [state, setState] = useState<(typeof filters)[number]>('active')
  const [search, setSearch] = useState('')
  const q = useDebouncedValue(search.trim(), 250)
  const [paging, setPaging] = useState({ safeId, state, q, page: 1 })
  const scopeChanged = paging.safeId !== safeId || paging.state !== state || paging.q !== q
  if (scopeChanged) setPaging({ safeId, state, q, page: 1 })
  const page = scopeChanged ? 1 : paging.page

  const searchInput = useRef<HTMLInputElement>(null)
  const listRegion = useRef<HTMLElement>(null)
  const detailHeading = useRef<HTMLHeadingElement>(null)
  const printOpener = useRef<HTMLButtonElement>(null)
  const previewHeading = useRef<HTMLHeadingElement>(null)
  const previousSelection = useRef<{ custody: string | null; receipt: string | null }>({ custody: null, receipt: null })
  const headingId = useId()

  const custody = params.get('custody')
  const receiptParam = params.get('receipt')
  const custodyId = readArmoryId(params, 'custody')
  const receiptId = readArmoryId(params, 'receipt')
  const list = useArmoryCustody({ safe_id: safeId ?? undefined, state, q: q || undefined, page })
  const results = list.isError ? undefined : list.data
  const detailId = custody !== null ? custodyId : mobile ? null : results?.items[0]?.id ?? null
  const readId = receiptParam !== null ? receiptId : detailId
  const detail = useArmoryCustodyDetail(readId)
  const record = !detail.isError && detail.data?.kind === 'custody' ? detail.data : undefined
  const receipt = record && record.state !== 'voided' ? record.receipt : null
  const showDetail = custody !== null || detailId !== null
  const detailFailed = detail.isError && !(detail.error instanceof ApiError && detail.error.status === 404)
  const lastPage = results ? Math.max(1, Math.ceil(results.total / results.page_size)) : 1
  // A return can remove the last row from the current filtered page.
  if (results && page > lastPage) setPaging({ safeId, state, q, page: lastPage })

  useEffect(() => {
    const previous = previousSelection.current
    previousSelection.current = { custody, receipt: receiptParam }
    if (receiptParam !== null) {
      if (receiptParam !== previous.receipt) previewHeading.current?.focus()
    } else if (previous.receipt !== null) {
      (printOpener.current ?? detailHeading.current ?? searchInput.current)?.focus()
    } else if (custody !== null && custody !== previous.custody) {
      detailHeading.current?.focus()
    } else if (custody === null && previous.custody !== null) {
      const row = listRegion.current?.querySelector<HTMLButtonElement>(`[data-custody-id="${Number(previous.custody)}"]`)
      const listFocus = row ?? searchInput.current
      listFocus?.focus()
    }
  }, [custody, receiptParam])

  if (receiptParam !== null) {
    return (
      <section aria-labelledby={headingId} className="space-y-4">
        <div data-print-hide className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="secondary" className="min-h-11 whitespace-normal" onClick={() => {
              setParams((previous) => patchArmoryParams(previous, { receipt: null, custody: receiptId ?? custody }), { replace: true })
            }}>
              <ArrowLeft className="size-4 shrink-0 rtl:-scale-x-100" aria-hidden />
              {t('assets.armory.receiptClose')}
            </Button>
            <h2 id={headingId} ref={previewHeading} tabIndex={-1} className="font-semibold">{t('assets.armory.receiptPreview')}</h2>
          </div>
          {receipt && (
            <Button type="button" className="min-h-11" onClick={() => window.print()}>
              <Printer className="size-4" aria-hidden />
              {t('assets.armory.print')}
            </Button>
          )}
        </div>
        {receipt ? <CustodyReceipt receipt={receipt} language={isAr ? 'ar' : 'en'} />
          : readId !== null && detail.isPending ? <Loading />
          : detailFailed ? <LoadFailure onRetry={() => { void detail.refetch() }} />
          : <p role="alert" className="rounded-xl border border-hairline bg-surface p-4 text-sm">{t('assets.armory.receiptSheet.unavailable')}</p>}
      </section>
    )
  }

  const holder = record && recipient(record)
  return (
    <div className={cn('grid min-w-0 items-start gap-4', showDetail && 'md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]')}>
      <section ref={listRegion} hidden={mobile && custody !== null} aria-label={t('assets.armory.custody')} className={panel}>
        <div className="grid gap-3 border-b border-hairline p-3 sm:p-4">
          {editable && (
            <Button type="button" className="min-h-11 justify-self-start whitespace-normal" onClick={(event) => onOpenHandover(event.currentTarget)}>
              {t('assets.armory.handover')}
            </Button>
          )}
          <div role="group" aria-label={t('assets.armory.status')} className="grid grid-cols-3 gap-1 rounded-lg border border-hairline bg-surface-raised p-1">
            {filters.map((filter) => (
              <Button key={filter} type="button" variant="ghost" aria-pressed={filter === state} onClick={() => setState(filter)}
                className="min-h-11 min-w-0 whitespace-normal px-1 aria-pressed:bg-primary-soft aria-pressed:text-primary-text">
                {t(filter === 'all' ? 'assets.armory.all' : `assets.armory.assignmentState.${filter}`)}
              </Button>
            ))}
          </div>
          <div className="flex min-w-0 items-center rounded-md border border-input focus-within:ring-2 focus-within:ring-ring">
            <Search className="ms-3 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <Input ref={searchInput} type="search" dir="auto" aria-label={t('assets.armory.searchCustody')}
              placeholder={t('assets.armory.searchCustody')} value={search} maxLength={120} autoComplete="off"
              onChange={(event) => setSearch(event.target.value)}
              className="min-h-11 min-w-0 flex-1 border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 [&::-webkit-search-cancel-button]:hidden" />
            {search !== '' && (
              <Button type="button" variant="ghost" size="icon" aria-label={t('assets.armory.clearSearch')}
                className="min-h-11 min-w-11 shrink-0" onClick={() => { setSearch(''); searchInput.current?.focus() }}>
                <X className="size-4" aria-hidden />
              </Button>
            )}
          </div>
        </div>
        {list.isError ? <LoadFailure onRetry={() => { void list.refetch() }} />
          : !results ? <Loading />
          : results.items.length === 0 ? <p className="p-4 text-sm text-muted-foreground">{t('assets.armory.custodyNoRows')}</p>
          : (
            <ul className="divide-y divide-hairline">
              {results.items.map((row) => (
                <li key={row.id}>
                  <CustodyRow record={row} selected={detailId === row.id} onSelect={() => {
                    if (custodyId !== row.id) setParams((previous) => patchArmoryParams(previous, { custody: row.id }))
                  }} />
                </li>
              ))}
            </ul>
          )}
        {results && lastPage > 1 && (
          <nav aria-label={t('assets.armory.custodyPane.pages')} className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline p-3">
            <Button type="button" variant="secondary" className="min-h-11" disabled={results.page <= 1}
              onClick={() => setPaging({ safeId, state, q, page: results.page - 1 })}>
              <ChevronLeft className="size-4 rtl:-scale-x-100" aria-hidden />
              {t('common.previous')}
            </Button>
            <p className="text-sm text-muted-foreground">{t('assets.armory.custodyPane.page')} <Ltr className="tabular-nums">{results.page}/{lastPage}</Ltr></p>
            <Button type="button" variant="secondary" className="min-h-11" disabled={results.page >= lastPage}
              onClick={() => setPaging({ safeId, state, q, page: results.page + 1 })}>
              {t('common.next')}
              <ChevronRight className="size-4 rtl:-scale-x-100" aria-hidden />
            </Button>
          </nav>
        )}
      </section>
      {showDetail && (
        <section aria-labelledby={headingId} className={cn(panel, 'md:sticky md:top-4 md:max-h-[calc(100dvh-2rem)] md:overflow-y-auto')}>
          <div className="space-y-2 border-b border-hairline p-4">
            {mobile && (
              <Button type="button" variant="secondary" className="mb-1 min-h-11 whitespace-normal"
                onClick={() => setParams((previous) => patchArmoryParams(previous, { custody: null }), { replace: true })}>
                <ArrowLeft className="size-4 shrink-0 rtl:-scale-x-100" aria-hidden />
                {t('assets.armory.back')}
              </Button>
            )}
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 ref={detailHeading} id={headingId} tabIndex={-1} className="min-w-0 text-lg font-semibold wrap-anywhere">
                {holder ? <bdi>{name(holder)}</bdi> : t('assets.armory.custodyPane.detail')}
              </h2>
              {record && <CustodyStatus state={record.state} />}
            </div>
            {record && <Ltr className="text-sm text-muted-foreground wrap-anywhere">{record.record_ref}</Ltr>}
          </div>
          {record ? (
            <CustodyRecord record={record} editable={editable} printRef={printOpener} onReturn={onOpenReturn}
              onPrint={() => setParams((previous) => patchArmoryParams(previous, { custody: record.id, receipt: record.id }))} />
          ) : readId !== null && detail.isPending ? <Loading />
            : detailFailed ? <LoadFailure onRetry={() => { void detail.refetch() }} />
            : <p role="alert" className="p-4 text-sm">{t('assets.armory.custodyPane.unavailable')}</p>}
        </section>
      )}
    </div>
  )
}

function recipient(record: ArmoryAssignmentSummary) {
  return record.holder.kind === 'person' ? record.holder.employee : record.holder.site_safe
}

function CustodyRow({ record, selected, onSelect }: { record: ArmoryAssignmentSummary; selected: boolean; onSelect(): void }) {
  const { t, name } = useArmoryLocale()
  const holder = recipient(record)
  const firstLine = record.state === 'active' ? record.lines.find((line) => line.remaining_qty > 0) : record.lines[0]
  return (
    <button type="button" aria-current={selected ? 'true' : undefined} data-custody-id={record.id} onClick={onSelect}
      className="block min-h-11 w-full space-y-1 px-4 py-3 text-start wrap-anywhere hover:bg-surface-tinted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring aria-[current=true]:bg-primary-soft">
      <span className="flex flex-wrap items-baseline justify-between gap-2">
        <bdi className="font-semibold">{holder ? name(holder) : t('assets.armory.none')}</bdi>
        <CustodyStatus state={record.state} />
      </span>
      <span className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
        <Ltr>{record.record_ref}</Ltr>
        <span>{t(`assets.armory.holderKind.${record.holder.kind}`)}</span>
        <Ltr>{orgDateTime(record.issued_at)}</Ltr>
      </span>
      {firstLine && <span className="flex flex-wrap gap-x-2 text-sm"><bdi>{name(firstLine.item)}</bdi>{firstLine.serial_code && <Ltr>{firstLine.serial_code}</Ltr>}</span>}
    </button>
  )
}

function CustodyStatus({ state }: { state: ArmoryAssignmentSummary['state'] }) {
  const { t } = useTranslation()
  return (
    <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', state === 'active' ? 'bg-success-soft text-foreground'
      : state === 'voided' ? 'bg-accent-soft text-destructive-text' : 'bg-surface-tinted text-muted-foreground')}>
      {t(`assets.armory.assignmentState.${state}`)}
    </span>
  )
}

function CustodyRecord({ record, editable, printRef, onPrint, onReturn }: {
  record: ArmoryAssignmentRead
  editable: boolean
  printRef: Ref<HTMLButtonElement>
  onPrint(): void
  onReturn(assignmentId: number, opener: HTMLElement): void
}) {
  const { t, name, isAr } = useArmoryLocale()
  const holder = recipient(record)
  const person = record.holder.employee
  const supervisor = record.holder.supervisor
  const hasFormerHolder = person?.is_former || supervisor?.is_former
  const status = record.licence_status_at_issue
  const actor = (value: ArmoryActorRead | null) => {
    const displayName = actorName(value, isAr ? 'ar' : 'en')
    return displayName ? <bdi>{displayName}</bdi>
      : value ? <>{t('assets.armory.custodyPane.accountId')} <Ltr>{value.user_id}</Ltr></>
        : t('assets.armory.none')
  }
  return (
    <div className="space-y-4 p-4">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <Field label={t('assets.armory.receivedFrom')}><bdi>{name(record.safe)}</bdi></Field>
        <Field label={t(record.holder.kind === 'site' ? 'assets.armory.holderKind.site' : 'assets.armory.holder')}>
          {holder ? <bdi>{name(holder)}</bdi> : t('assets.armory.none')}
          {person && <span className="block"><Ltr>{person.employee_id}</Ltr></span>}
          {person?.is_former && <span className="block text-muted-foreground">{t('assets.armory.employeeStatus.former')}</span>}
        </Field>
        {supervisor && (
          <Field label={t('assets.armory.siteSupervisor')}>
            <bdi>{name(supervisor)}</bdi>
            <span className="block"><Ltr>{supervisor.employee_id}</Ltr></span>
            {supervisor.is_former && <span className="block text-muted-foreground">{t('assets.armory.employeeStatus.former')}</span>}
          </Field>
        )}
        <Field label={t('assets.armory.actor')}>{actor(record.issuer)}</Field>
        <Field label={t('assets.armory.signedOutAt')}><Ltr>{orgDateTime(record.issued_at)}</Ltr></Field>
        {record.ended_at && <Field label={t('assets.armory.endedOn')}><Ltr>{orgDateTime(record.ended_at)}</Ltr></Field>}
        {record.ended_by && <Field label={t('assets.armory.custodyPane.endedBy')}>{actor(record.ended_by)}</Field>}
        {record.voided_at && <Field label={t('assets.armory.custodyPane.voidedAt')}><Ltr>{orgDateTime(record.voided_at)}</Ltr></Field>}
        {record.voided_by && <Field label={t('assets.armory.custodyPane.voidedBy')}>{actor(record.voided_by)}</Field>}
        {record.void_reason && <Field label={t('assets.armory.custodyPane.voidReason')} wide><bdi>{record.void_reason}</bdi></Field>}
        <Field label={t('assets.armory.custodyPane.licenceAtIssue')}>{t(status === null ? 'assets.armory.notApplicable' : licenceStatusKey(status))}</Field>
        <Field label={t('assets.armory.custodyPane.licenceAcknowledgement')}>
          {t(record.licence_warning_acknowledged ? 'assets.armory.custodyPane.licenceAcknowledged'
            : status === 'missing' || status === 'expired' ? 'assets.armory.custodyPane.licenceNotAcknowledged' : 'assets.armory.notApplicable')}
        </Field>
        {record.condition_note && <Field label={t('assets.armory.custodyCondition')} wide><bdi>{record.condition_note}</bdi></Field>}
      </dl>
      {hasFormerHolder && record.state === 'active' && <p className="rounded-md bg-warning-soft p-3 text-sm">{t('assets.armory.clearanceCustody')}</p>}
      <table className="w-full table-fixed border-y border-hairline text-sm wrap-anywhere">
        <caption className="sr-only">{t('assets.armory.custodyPane.lines')}</caption>
        <thead className="border-b border-hairline text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="w-1/2 py-2 text-start font-medium">{t('assets.armory.item')}</th>
            <th scope="col" className="ps-2 py-2 text-end font-medium">{t('assets.armory.custodyPane.held')}</th>
            <th scope="col" className="ps-2 py-2 text-end font-medium">{t('assets.armory.custodyPane.original')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-hairline">
          {record.lines.map((line) => (
            <tr key={line.id} className="align-top">
              <th scope="row" className="space-y-1 py-2 text-start font-medium">
                <bdi>{name(line.item)}</bdi>
                {line.serial_code && <div className="text-xs font-normal text-muted-foreground">{t('assets.armory.serialNumber')}{' '}<Ltr>{line.serial_code}</Ltr></div>}
                {line.batch && (
                  <div className="text-xs font-normal text-muted-foreground">
                    <p>{t('assets.armory.batchNumber')}{' '}<Ltr>{line.batch.batch_ref}</Ltr></p>
                    <p>{t('assets.armory.batchExpiry')}{' '}<Ltr>{displayDate(line.batch.expires_on)}</Ltr></p>
                  </div>
                )}
              </th>
              <td className="ps-2 py-2 text-end"><Ltr className="tabular-nums">{line.remaining_qty}</Ltr></td>
              <td className="ps-2 py-2 text-end"><Ltr className="tabular-nums">{line.qty}</Ltr></td>
            </tr>
          ))}
        </tbody>
      </table>
      {record.return_ids.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold">{t('assets.armory.custodyPane.returnMovements')}</h3>
          <ul className="flex flex-wrap gap-x-4">
            {record.return_ids.map((id) => (
              <li key={id}>
                <Link to={armoryLink('audit', { pane: 'movements', movement: id })} className="inline-flex min-h-11 items-center gap-1 text-sm text-primary-text underline underline-offset-4">
                  {t('assets.armory.postingKind.return')} <Ltr>{id}</Ltr>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {record.state !== 'voided' && (
          <Button type="button" ref={printRef} variant="secondary" className="min-h-11 whitespace-normal" onClick={onPrint}>
            <Printer className="size-4 shrink-0" aria-hidden />
            {t('assets.armory.printReceipt')}
          </Button>
        )}
        {editable && record.state === 'active' && (
          <Button type="button" className="min-h-11 whitespace-normal" onClick={(event) => onReturn(record.id, event.currentTarget)}>
            {t('assets.armory.endCustody')}
          </Button>
        )}
      </div>
    </div>
  )
}

function Field({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={cn('min-w-0 wrap-anywhere', wide && 'col-span-full')}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 whitespace-pre-wrap">{children}</dd>
    </div>
  )
}

function Loading() {
  const { t } = useTranslation()
  return (
    <div className="space-y-2 p-4">
      <p role="status" className="text-sm text-muted-foreground">{t('assets.armory.loadingText')}</p>
      <Skeleton aria-hidden className="h-10 w-full bg-surface-tinted motion-reduce:animate-none" />
    </div>
  )
}

function LoadFailure({ onRetry }: { onRetry(): void }) {
  const { t } = useTranslation()
  return (
    <div className="space-y-2 p-4">
      <p role="alert" className="text-sm text-destructive-text">{t('assets.armory.loadFailed')}</p>
      <Button type="button" variant="secondary" className="min-h-11" onClick={onRetry}>{t('assets.armory.retry')}</Button>
    </div>
  )
}
