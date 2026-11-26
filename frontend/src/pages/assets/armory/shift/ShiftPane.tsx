import { useId, useRef, useState } from 'react'
import { AlertTriangle, ChevronRight, Clock3 } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import type { ArmoryAssignmentSummary, ArmoryReturnRead, ArmorySafeRead, ArmoryShiftRead, ArmoryShiftSafeRead, ArmoryShiftWindowRead } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Ltr } from '../ArmoryLtr'
import { displayDate, licenceStatusKey, orgDateIso, orgDateTime, orgTime, useArmoryLocale } from '../armoryFormat'
import { useArmoryAccess, useArmoryShift } from '../armoryQueries'
import { armoryLink, patchArmoryParams, readArmoryId } from '../armoryUrl'
import { FirearmRack, FirearmSerialSheet } from './FirearmRack'
import { IssueDetail } from './IssueDetail'
import { PostedReturnLines, ShiftActor, ShiftCopy, ShiftHolder, ShiftPerson, ShiftReadError, ShiftWindowMeta } from './shiftPresentation'

interface Props {
  safeId: number | null
  safes: ArmorySafeRead[]
  checkPaused: boolean
  onIssue(opener: HTMLElement): void
  onHandover(opener: HTMLElement): void
  onReturn(issueId: number, opener: HTMLElement): void
  onBulkReturn(opener: HTMLElement): void
  onShiftCheck(safeId: number, opener: HTMLElement): void
}

const segments = ['out', 'dutyRoster', 'returnedToday'] as const
type Segment = (typeof segments)[number]
const emptySegments = { out: 'noneOut', dutyRoster: 'noRoster', returnedToday: 'noneBack' } as const

export function ShiftPane(props: Props) {
  const { canView, canEdit, principal } = useArmoryAccess()
  if (!canView || principal === null) return null
  return <ShiftDesk key={`${principal}:${props.safeId}`} {...props} canEdit={canEdit} />
}

function ShiftDesk({ canEdit, ...props }: Props & { canEdit: boolean }) {
  const { t, name } = useArmoryLocale()
  const [params, setParams] = useSearchParams()
  const [section, setSection] = useState<Segment>('out')
  const [serialId, setSerialId] = useState<number | null>(null)
  const shift = useArmoryShift(props.safeId)
  const rootFocus = useRef<HTMLDivElement>(null)
  const activityTitle = useRef<HTMLHeadingElement>(null)
  const serialOpener = useRef<HTMLElement>(null)
  const issueOpener = useRef<HTMLElement>(null)
  const activityId = useId()
  const issueId = readArmoryId(params, 'issue')
  const result = shift.isError ? undefined : shift.data

  function openIssue(id: number, opener: HTMLElement) {
    issueOpener.current = opener
    setParams(prev => patchArmoryParams(prev, { issue: id, return: null }))
  }

  function openSerial(id: number, opener: HTMLElement) {
    serialOpener.current = opener
    setSerialId(id)
  }

  const serialIssue = serialId === null ? undefined : result?.safes.flatMap(safe => safe.out).find(record =>
    record.lines.some(line => line.serial_id === serialId && line.remaining_qty > 0),
  )
  const counts = { out: 0, dutyRoster: 0, returnedToday: 0 }
  for (const safe of result?.safes ?? []) {
    counts.out += safe.out.length
    counts.dutyRoster += safe.on_duty.length
    counts.returnedToday += safe.returned_today.length
  }
  function goToActivity(segment: Segment) {
    setSection(segment)
    activityTitle.current?.focus()
  }

  return <div ref={rootFocus} tabIndex={-1} aria-label={t('assets.armory.shiftDesk')} className="min-w-0 space-y-4 focus:outline-none">
    {!!result?.attention.missing_firearm_count && <div role="status" className="flex flex-wrap items-start gap-x-3 rounded-lg border border-border bg-accent-soft px-3 py-2 text-destructive-text">
      <AlertTriangle aria-hidden className="mt-1 size-5 shrink-0" />
      <div className="min-w-0 flex-1 basis-40">
        <p className="font-semibold"><ShiftCopy id="missingFirearmN" count={result.attention.missing_firearm_count} /></p>
        <ul className="flex flex-wrap gap-x-2">
          {result.attention.missing_firearms.map(serial => <li key={serial.id} className="max-w-full">
            <Button type="button" variant="ghost" className="h-auto min-h-11 flex-wrap justify-start gap-x-1.5 whitespace-normal px-1 text-start text-destructive-text" onClick={event => openSerial(serial.id, event.currentTarget)}>
              <Ltr className="font-mono [overflow-wrap:anywhere]">{serial.serial_code}</Ltr>
              {serial.safe && <> · <bdi>{name(serial.safe)}</bdi></>}
            </Button>
          </li>)}
        </ul>
      </div>
      <Link className="inline-flex min-h-11 items-center gap-1 rounded-sm text-sm font-medium underline underline-offset-2" to={armoryLink('audit', { pane: 'decisions', safe: 'all' })}>
        {t('assets.armory.discrepancies')}<ChevronRight aria-hidden className="size-4 rtl:-scale-x-100" />
      </Link>
    </div>}
    {shift.isPending && <div role="status" className="space-y-2 rounded-lg border border-border bg-surface p-4">
      <span className="text-sm text-muted-foreground">{t('assets.armory.loadingText')}</span>
      <Skeleton className="h-20 w-full" />
    </div>}
    {shift.isError && <ShiftReadError error={shift.error} retry={() => void shift.refetch()} />}
    {result && <>
      <p className="text-sm text-muted-foreground"><ShiftWindowMeta window={result.window} /></p>
      <FirearmRack safes={result.safes} window={result.window} onSerial={openSerial} />
      <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(15rem,20rem)]">
        <section aria-labelledby={activityId} className="min-w-0 rounded-lg border border-border bg-surface">
          <header className="flex flex-wrap items-center justify-between gap-x-2 border-b border-hairline px-4 py-2">
            <h2 id={activityId} tabIndex={-1} ref={activityTitle} className="font-semibold">{t('assets.armory.shiftActivity')}</h2>
            <div role="group" aria-label={t('assets.armory.shiftActivity')} className="flex flex-wrap gap-1">
              {segments.map(segment => <Button key={segment} type="button" variant="ghost" aria-pressed={section === segment}
                className={cn('min-h-11 gap-1 px-2 text-xs sm:text-sm', section === segment && 'bg-primary-soft text-primary-text')}
                onClick={() => setSection(segment)}>{t(`assets.armory.${segment}`)} <Ltr>{counts[segment]}</Ltr></Button>)}
            </div>
          </header>
          {counts[section] === 0 ? <p className="p-4 text-sm text-muted-foreground">{t(`assets.armory.${emptySegments[section]}`)}</p> :
            result.safes.map(safe => <ActivityGroup key={safe.safe.id} group={safe} section={section} multiSafe={props.safeId === null}
              window={result.window} canEdit={canEdit} onIssueDetail={openIssue} onReturn={props.onReturn} onSerial={openSerial} />)}
        </section>
        <aside className="grid gap-3 sm:max-lg:grid-cols-2 lg:grid-cols-1">
          {canEdit && props.safes.length > 0 && <HandoverRail {...props} shift={result} outCount={counts.out} />}
          <AttentionRail attention={result.attention} safeId={props.safeId} onOverdue={() => goToActivity('out')} />
        </aside>
      </div>
    </>}
    {issueId !== null && <IssueDetail key={issueId} issueId={issueId} open={!(canEdit && params.get('return') === '1')}
      onClose={() => setParams(prev => patchArmoryParams(prev, { issue: null, return: null }), { replace: true })}
      onReturn={props.onReturn} returnFocusRef={issueOpener} fallbackFocusRef={result ? activityTitle : rootFocus} />}
    {issueId === null && serialId !== null && result && <FirearmSerialSheet key={serialId} serialId={serialId} windowZone={result.window.time_zone}
      dueAt={serialIssue?.due_at ?? null} scope={params.get('safe')} onClose={() => setSerialId(null)}
      onIssueLink={() => { issueOpener.current = serialOpener.current; setSerialId(null) }} returnFocusRef={serialOpener} fallbackFocusRef={activityTitle} />}
  </div>
}

interface ActivityProps {
  group: ArmoryShiftSafeRead
  section: Segment
  multiSafe: boolean
  window: ArmoryShiftWindowRead
  canEdit: boolean
  onIssueDetail: (id: number, opener: HTMLElement) => void
  onReturn: Props['onReturn']
  onSerial: (id: number, opener: HTMLElement) => void
}

function ActivityGroup({ group, section, multiSafe, window, canEdit, onIssueDetail, onReturn, onSerial }: ActivityProps) {
  const { name, t } = useArmoryLocale()
  const rows = section === 'out' ? group.out : section === 'dutyRoster' ? group.on_duty : group.returned_today
  if (rows.length === 0) return null
  return <div>
    {multiSafe && <h3 className="border-b border-hairline bg-surface-raised px-4 py-2 text-sm font-semibold"><bdi>{name(group.safe)}</bdi></h3>}
    <ul className="divide-y divide-hairline text-sm">
      {section === 'out' && group.out.map(record => <OutRow key={record.id} record={record} window={window} canEdit={canEdit}
        onOpen={onIssueDetail} onReturn={onReturn} onSerial={onSerial} />)}
      {section === 'returnedToday' && group.returned_today.map(record => <ReturnedRow key={record.posting.id} record={record} zone={window.time_zone} onOpen={onIssueDetail} />)}
      {section === 'dutyRoster' && group.on_duty.map(row => <li key={row.person.employee_id} className="grid items-center gap-2 px-4 py-2 sm:grid-cols-3">
        <Link className="flex min-h-11 flex-wrap content-center items-center gap-x-1 rounded-sm text-primary-text hover:underline" to={armoryLink('guards', { guard: row.person.employee_id })}><ShiftPerson person={row.person} /></Link>
        <div className="text-muted-foreground">
          <p>{row.course_round === null ? t('assets.armory.noCourse') : <>{t('assets.armory.courseRound')}: <Ltr>{row.course_round}</Ltr></>}</p>
          <p>{t('assets.armory.licenceState')}: {t(licenceStatusKey(row.licence_status))}</p>
        </div>
        {row.open_firearm ? <span className="[overflow-wrap:anywhere]">
          {t(`assets.armory.assignmentKind.${row.open_firearm.assignment_kind}`)} · <bdi>{name(row.open_firearm.item)}</bdi>{' '}<Ltr className="font-mono">{row.open_firearm.serial_code}</Ltr>
        </span> : <span className="text-muted-foreground">{t('assets.armory.shiftPane.noOpenFirearm')}</span>}
      </li>)}
    </ul>
  </div>
}

function IssueOpenButton({ record, onOpen }: { record: ArmoryAssignmentSummary; onOpen: ActivityProps['onIssueDetail'] }) {
  const { t } = useArmoryLocale()
  return <Button type="button" variant="ghost" size="icon" className="size-11" aria-label={`${t('assets.armory.viewRecord')}: \u2066${record.record_ref}\u2069`}
    onClick={event => onOpen(record.id, event.currentTarget)}><ChevronRight aria-hidden className="size-4 rtl:-scale-x-100" /></Button>
}

function OutRow({ record, window, onOpen, canEdit, onReturn, onSerial }: { record: ArmoryAssignmentSummary; window: ArmoryShiftWindowRead; onOpen: ActivityProps['onIssueDetail']; canEdit: boolean; onReturn: Props['onReturn']; onSerial: ActivityProps['onSerial'] }) {
  const { t, name, overdue } = useArmoryLocale()
  const zone = window.time_zone
  const due = record.due_at && (orgDateIso(record.due_at, zone) === window.shift_date ? orgTime(record.due_at, zone) : orgDateTime(record.due_at, zone))
  return <li className="grid min-w-0 items-start gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto]">
    <div className="min-w-0 [overflow-wrap:anywhere]">
      <p className="font-semibold"><ShiftHolder holder={record.holder} /></p>
      <p className="mt-1 text-xs text-muted-foreground"><ShiftCopy id="issuedBy" values={{ name: <ShiftActor actor={record.issuer} /> }} /></p>
      {record.overdue_minutes !== null && <p className="mt-1 flex items-center gap-1 font-medium text-destructive-text"><Clock3 aria-hidden className="size-4 shrink-0" /><bdi>{overdue(record.overdue_minutes)}</bdi></p>}
      {due && <p className="text-xs text-muted-foreground"><ShiftCopy id="dueAt" values={{ time: <Ltr>{due}</Ltr> }} /></p>}
    </div>
    <div className="min-w-0 [overflow-wrap:anywhere]">
      <ul className="space-y-1">
        {record.lines.filter(line => line.remaining_qty > 0).map(line => <li key={line.id}>
          <ShiftCopy id="lineQty" count={line.remaining_qty} values={{ item: <bdi>{name(line.item)}</bdi> }} />
          {line.serial_id !== null && line.serial_code && <Button type="button" variant="ghost" className="ms-1 h-auto min-h-11 whitespace-normal px-1 text-primary-text underline underline-offset-2"
            onClick={event => { if (line.serial_id !== null) onSerial(line.serial_id, event.currentTarget) }}><Ltr className="font-mono [overflow-wrap:anywhere]">{line.serial_code}</Ltr></Button>}
          {line.batch && <> · <Ltr>{line.batch.batch_ref}</Ltr></>}
        </li>)}
      </ul>
      {record.changed_kit && <p className="text-xs text-warning">{t('assets.armory.changedKit')}</p>}
      {record.licence_warning_acknowledged && <p className="text-xs text-warning">{t('assets.armory.shiftPane.licenceWarningRecorded')}</p>}
      {record.lines.some(line => line.remaining_qty < line.qty) && <p className="text-xs text-muted-foreground">{t('assets.armory.partialReturn')}</p>}
    </div>
    <div className="flex flex-wrap items-center justify-end gap-1">
      {canEdit && record.state === 'active' && <Button type="button" variant="secondary" className="min-h-11" onClick={event => onReturn(record.id, event.currentTarget)}>{t('assets.armory.signin')}</Button>}
      <IssueOpenButton record={record} onOpen={onOpen} />
    </div>
  </li>
}

function ReturnedRow({ record, zone, onOpen }: { record: ArmoryReturnRead; zone: string; onOpen: ActivityProps['onIssueDetail'] }) {
  const { t } = useArmoryLocale()
  const { posting, assignment } = record
  return <li className="grid min-w-0 items-start gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto]">
    <div className="min-w-0 [overflow-wrap:anywhere]">
      <p className="font-semibold"><ShiftHolder holder={assignment.holder} /></p>
      <p className="text-xs text-muted-foreground"><Ltr>{posting.occurred_at ? orgDateTime(posting.occurred_at, zone) : displayDate(posting.occurred_on)}</Ltr></p>
      {posting.discrepancy_ids.length > 0 && <p className="text-xs text-warning">{t('assets.armory.returnReview')}</p>}
    </div>
    <PostedReturnLines lines={posting.lines} />
    <div className="flex justify-end"><IssueOpenButton record={assignment} onOpen={onOpen} /></div>
  </li>
}

function HandoverRail({ shift, outCount, safeId, checkPaused, onIssue, onBulkReturn, onShiftCheck, onHandover }: Props & { shift: ArmoryShiftRead; outCount: number }) {
  const { t, name } = useArmoryLocale()
  const { window } = shift
  const title = useId()
  const checks = shift.safes.filter(safe => safe.check_history.some(slot => slot.status === 'due'))
  const scopedSafe = safeId === null ? null : shift.safes.find(group => group.safe.id === safeId)?.safe
  const resumeSafe = checkPaused ? scopedSafe : null
  return <section aria-labelledby={title} className="rounded-lg border border-border bg-surface px-3 py-2">
    <h2 id={title} className="font-semibold">{t('assets.armory.handoverShift')}</h2>
    <p className="text-sm text-muted-foreground"><ShiftCopy id="shiftEndsAt" values={{ time: <Ltr>{orgTime(window.ends_at, window.time_zone)}</Ltr> }} /></p>
    {safeId === null && <p className="pt-1 text-xs text-muted-foreground">{t('assets.armory.chooseSafeForAction')}</p>}
    <ol className="mt-2 divide-y divide-hairline">
      <li className="py-1"><Button type="button" variant="ghost" className="min-h-11 w-full justify-start whitespace-normal text-start" onClick={event => onIssue(event.currentTarget)}>{t('assets.armory.issueEquipment')}</Button></li>
      <li className="py-1">
        {outCount > 0 ? <Button type="button" variant="ghost" className="min-h-11 w-full flex-wrap justify-between whitespace-normal text-start"
          aria-describedby={`${title}-out`} onClick={event => onBulkReturn(event.currentTarget)}>
          {t('assets.armory.takeBack')} <span id={`${title}-out`} aria-hidden className="text-xs text-muted-foreground"><ShiftCopy id="outWithCount" count={outCount} /></span>
        </Button> : <p className="px-3 py-2 text-sm text-muted-foreground">{t('assets.armory.noneOut')}</p>}
      </li>
      <li className="py-1">
        {resumeSafe ? <>
          <Button type="button" variant="secondary" className="min-h-11 w-full whitespace-normal" onClick={event => onShiftCheck(resumeSafe.id, event.currentTarget)}>{t('assets.armory.resumeCheck')}</Button>
          <p role="status" className="px-3 pt-1 text-xs text-muted-foreground">{t('assets.armory.checkPaused')}</p>
        </> : checks.length ? <ul className="space-y-1">
          {checks.map(({ safe }) => <li key={safe.id}>
            <Button type="button" variant="ghost" className="min-h-11 w-full flex-wrap justify-start gap-x-1 whitespace-normal text-start"
              aria-label={safeId === null ? `${t('assets.armory.checkSafe')}: ${name(safe)}` : undefined} onClick={event => onShiftCheck(safe.id, event.currentTarget)}>
              {t('assets.armory.checkSafe')}{safeId === null && <> · <bdi>{name(safe)}</bdi></>}
            </Button>
          </li>)}
        </ul> : <p className="px-3 py-2 text-sm text-muted-foreground">
          {shift.safes.some(group => group.check_history[0]?.status === 'completed') ? <>{t('assets.armory.shiftCheck')}: {t('assets.armory.done')}</> : t('assets.armory.shiftPane.noCheckHistory')}
        </p>}
      </li>
      <li className="py-1"><Button type="button" variant="ghost" className="min-h-11 w-full justify-start whitespace-normal text-start" onClick={event => onHandover(event.currentTarget)}>{t('assets.armory.handover')}</Button></li>
    </ol>
  </section>
}

function AttentionRail({ attention, safeId, onOverdue }: { attention: ArmoryShiftRead['attention']; safeId: number | null; onOverdue: () => void }) {
  const { t } = useArmoryLocale()
  const title = useId()
  const scope = safeId === null ? 'all' : safeId
  const licences = attention.licences.missing + attention.licences.expired + attention.licences.expiring
  const rows = [
    { id: 'decisionN', count: attention.decision_count, to: armoryLink('audit', { pane: 'decisions', safe: scope }) },
    { id: 'missingCheckN', count: attention.due_check_count, to: armoryLink('audit', { pane: 'counts', safe: scope }) },
    { id: 'expiredBatchN', count: attention.expired_batch_count, to: armoryLink('items', { safe: scope }) },
    { id: 'expiringBatchN', count: attention.expiring_batch_count, to: armoryLink('items', { safe: scope }) },
    { id: 'licenceAttentionN', count: licences, to: armoryLink('guards') },
    { id: 'clearanceCustody', count: attention.former_open_count, to: armoryLink('custody', { safe: scope }) },
  ].filter(row => row.count > 0)
  return <section aria-labelledby={title} className="rounded-lg border border-border bg-surface px-3 py-2">
    <h2 id={title} className="font-semibold">{t('assets.armory.needsAttention')}</h2>
    {attention.overdue_count || rows.length ? <ul className="mt-2 divide-y divide-hairline">
      {attention.overdue_count > 0 && <li><Button type="button" variant="ghost" className="min-h-11 w-full justify-start px-1 text-destructive-text" onClick={onOverdue}><Clock3 aria-hidden className="size-4" /><span><ShiftCopy id="overdueN" count={attention.overdue_count} /></span></Button></li>}
      {rows.map(({ id, count, to }) => <li key={id}>
        <Link to={to} className="flex min-h-11 items-center justify-between gap-1 rounded-sm px-1 text-sm text-primary-text hover:underline">
          <span><ShiftCopy id={id} count={count} /></span><ChevronRight aria-hidden className="size-4 shrink-0 rtl:-scale-x-100" />
        </Link>
      </li>)}
    </ul> : <p className="py-2 text-sm text-muted-foreground">{t('assets.armory.noAlerts')}</p>}
  </section>
}
