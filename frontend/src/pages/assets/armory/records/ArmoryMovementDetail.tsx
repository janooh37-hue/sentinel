import { useId, useRef, useState, type ReactNode, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import type { ArmoryMovementLineRead, ArmoryPersonRead, ArmoryPostingRead } from '@/lib/api'
import { Ltr } from '../ArmoryLtr'
import { displayDate, orgDateTime, orgTime, serialStateKey, useArmoryLocale } from '../armoryFormat'
import { armoryErrorMessage, useArmoryAccess, useArmoryMovement } from '../armoryQueries'
import { armoryLink } from '../armoryUrl'
import { ArmoryVoidDialog } from './ArmoryVoidDialog'
import { actorName } from './recordFormat'

const linkClass = 'inline-flex min-h-11 max-w-full items-center text-primary-text underline underline-offset-4'
const factsClass = 'grid grid-cols-2 gap-x-4 gap-y-3 text-sm'

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 [overflow-wrap:anywhere]">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-wrap">{children}</dd>
    </div>
  )
}

function Person({ person }: { person: ArmoryPersonRead }) {
  const { name } = useArmoryLocale()
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-2">
      <bdi>{name(person)}</bdi>
      <Ltr className="text-xs tabular-nums text-muted-foreground">{person.employee_id}</Ltr>
    </span>
  )
}

function MovementLine({ line, posting }: { line: ArmoryMovementLineRead; posting: ArmoryPostingRead }) {
  const { t, name } = useArmoryLocale()
  const none = t('assets.armory.none')
  const unknown = t('assets.armory.notCounted')
  const serialized = line.serial_id !== null || line.before_state !== null || line.after_state !== null
  const showBalance = line.before_on_hand !== null || line.after_on_hand !== null || (!serialized && line.stock_delta !== 0)

  function safeName(id: number | null) {
    if (id === null) return none
    const safe = id === posting.safe.id ? posting.safe : id === posting.destination_safe?.id ? posting.destination_safe : null
    return safe ? <bdi>{name(safe)}</bdi> : <Ltr>{id}</Ltr>
  }

  function serialState(state: ArmoryMovementLineRead['before_state']) {
    return state === null ? none : t(serialStateKey(state))
  }

  return (
    <li className="space-y-2 py-3 first:pt-0 last:pb-0">
      <Link className={`${linkClass} text-sm font-semibold [overflow-wrap:anywhere]`} to={armoryLink('items', { item: line.item.id })}>
        <bdi>{name(line.item)}</bdi>
      </Link>
      <dl className={factsClass}>
        {line.serial_code !== null && (
          <Fact label={t('assets.armory.serialNumber')}>
            {line.serial_id === null ? <Ltr>{line.serial_code}</Ltr> : (
              <Link className={linkClass} to={armoryLink('items', { serial: line.serial_id })}><Ltr>{line.serial_code}</Ltr></Link>
            )}
          </Fact>
        )}
        {line.batch && (
          <Fact label={t('assets.armory.batchNumber')}><Ltr>{line.batch.batch_ref}</Ltr></Fact>
        )}
        <Fact label={t('assets.armory.quantity')}><Ltr>{line.qty}</Ltr></Fact>
        <Fact label={t('assets.armory.movementsPane.stockDelta')}>
          <Ltr>{line.stock_delta > 0 ? `+${line.stock_delta}` : line.stock_delta}</Ltr>
        </Fact>
        {showBalance && (
          <>
            <Fact label={t('assets.armory.movementsPane.onHandBefore')}>{line.before_on_hand === null ? unknown : <Ltr>{line.before_on_hand}</Ltr>}</Fact>
            <Fact label={t('assets.armory.movementsPane.onHandAfter')}>{line.after_on_hand === null ? unknown : <Ltr>{line.after_on_hand}</Ltr>}</Fact>
          </>
        )}
        {serialized && (
          <>
            <Fact label={t('assets.armory.movementsPane.stateBefore')}>{serialState(line.before_state)}</Fact>
            <Fact label={t('assets.armory.movementsPane.stateAfter')}>{serialState(line.after_state)}</Fact>
            <Fact label={t('assets.armory.movementsPane.safeBefore')}>{safeName(line.before_safe_id)}</Fact>
            <Fact label={t('assets.armory.movementsPane.safeAfter')}>{safeName(line.after_safe_id)}</Fact>
          </>
        )}
        {(line.remaining_before !== null || line.remaining_after !== null) && (
          <>
            <Fact label={t('assets.armory.movementsPane.remainingBefore')}>{line.remaining_before === null ? none : <Ltr>{line.remaining_before}</Ltr>}</Fact>
            <Fact label={t('assets.armory.movementsPane.remainingAfter')}>{line.remaining_after === null ? none : <Ltr>{line.remaining_after}</Ltr>}</Fact>
          </>
        )}
        {line.condition && <Fact label={t('assets.armory.condition')}>{line.condition === 'ok' ? t('assets.armory.ok') : t('assets.armory.needsRepair')}</Fact>}
        {line.fault_note && <Fact label={t('assets.armory.fault')}><bdi>{line.fault_note}</bdi></Fact>}
      </dl>
    </li>
  )
}

export function ArmoryMovementDetail({ postingId, safeId, focusFallback }: {
  postingId: number
  safeId: number | null
  focusFallback: RefObject<HTMLElement | null>
}): React.JSX.Element {
  const { t } = useTranslation()
  const query = useArmoryMovement(postingId)
  const { principal } = useArmoryAccess()
  if (query.error) return (
    <div className="space-y-2 p-4 text-sm">
      <p role="alert" className="text-destructive-text">{armoryErrorMessage(query.error)}</p>
      <Button type="button" variant="outline" className="min-h-11" onClick={() => void query.refetch()}>{t('assets.armory.retry')}</Button>
    </div>
  )
  if (!query.data) return (
    <div role="status" className="space-y-3 p-4">
      <span className="sr-only">{t('assets.armory.loadingText')}</span>
      <Skeleton className="h-5 w-1/3" />
      <Skeleton className="h-20 w-full" />
    </div>
  )
  return <MovementEvidence key={`${principal}:${safeId}`} posting={query.data} focusFallback={focusFallback} />
}

function MovementEvidence({ posting: queriedPosting, focusFallback }: {
  posting: ArmoryPostingRead
  focusFallback: RefObject<HTMLElement | null>
}) {
  const { t, isAr, name } = useArmoryLocale()
  const { canEdit } = useArmoryAccess()
  const [confirmedVoid, setConfirmedVoid] = useState<ArmoryPostingRead | null>(null)
  const posting = queriedPosting.voided_at ? queriedPosting : confirmedVoid ?? queriedPosting
  const voidFactsId = useId()
  const language = isAr ? 'ar' : 'en'
  const voided = posting.voided_at !== null
  const actor = actorName(posting.actor, language)
  const voidedBy = actorName(posting.voided_by, language)
  const none = t('assets.armory.none')
  const assignmentLink = posting.kind === 'shift_issue'
    ? { href: armoryLink('shift', { issue: posting.id }), label: t('assets.armory.movementsPane.viewIssue') }
    : posting.kind === 'custody'
      ? { href: armoryLink('custody', { custody: posting.id }), label: t('assets.armory.movementsPane.viewCustody') }
      : null

  return (
    <div className="divide-y divide-border">
      <div className="space-y-4 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <h4 className="text-lg font-semibold [overflow-wrap:anywhere]"><Ltr>{posting.record_ref}</Ltr></h4>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span>{t(`assets.armory.postingKind.${posting.kind}`)}</span>
              <Badge tone={voided ? 'danger' : 'neutral'} className="normal-case tracking-normal">
                {t(voided ? 'assets.armory.movementsPane.voided' : 'assets.armory.movementsPane.live')}
              </Badge>
            </div>
          </div>
          {canEdit && <VoidAction posting={posting} onVoided={setConfirmedVoid} focusFallback={focusFallback} />}
        </div>
        {confirmedVoid && <p role="status" className="text-sm font-medium text-success">{t('assets.armory.movementsPane.voidSaved')}</p>}
        <dl className={factsClass}>
          <Fact label={t('assets.armory.safe')}><bdi>{name(posting.safe)}</bdi></Fact>
          {posting.destination_safe && (
            <Fact label={t('assets.armory.destination')}><bdi>{name(posting.destination_safe)}</bdi></Fact>
          )}
          <Fact label={t('assets.armory.date')}><Ltr>{displayDate(posting.occurred_on)}</Ltr></Fact>
          {posting.occurred_at && <Fact label={t('assets.armory.movementsPane.occurredAt')}><Ltr>{orgTime(posting.occurred_at)}</Ltr></Fact>}
          <Fact label={t('assets.armory.movementsPane.createdAt')}><Ltr>{orgDateTime(posting.created_at)}</Ltr></Fact>
          <Fact label={t('assets.armory.actor')}>
            {posting.actor.employee ? <Person person={posting.actor.employee} /> : actor ? <bdi>{actor}</bdi> : none}
          </Fact>
          <Fact label={t('assets.armory.witness')}>{posting.witness ? <Person person={posting.witness} /> : none}</Fact>
          {posting.person && <Fact label={t('assets.armory.person')}><Person person={posting.person} /></Fact>}
          {posting.reference && <Fact label={t('assets.armory.reference')}><Ltr>{posting.reference}</Ltr></Fact>}
          {posting.source && (
            <Fact label={t('assets.armory.deliverySource')}>
              {t(posting.source === 'head_office' ? 'assets.armory.headOffice' : `assets.armory.${posting.source}`)}
            </Fact>
          )}
          {posting.reason && <Fact label={t('assets.armory.reason')}><bdi>{posting.reason}</bdi></Fact>}
          {posting.note && <Fact label={t('assets.armory.notes')}><bdi>{posting.note}</bdi></Fact>}
          {posting.serial_action && <Fact label={t('assets.armory.movementsPane.serialAction')}>{t(`assets.armory.serialAction.${posting.serial_action}`)}</Fact>}
          {posting.decision_outcome && <Fact label={t('assets.armory.outcome')}>{t(`assets.armory.decisionOutcome.${posting.decision_outcome}`)}</Fact>}
        </dl>
      </div>
      {posting.voided_at && (
        <section aria-labelledby={voidFactsId} className="space-y-3 bg-surface-tinted p-4">
          <h4 id={voidFactsId} className="text-sm font-semibold">{t('assets.armory.movementsPane.voidDetails')}</h4>
          <p className="text-sm text-muted-foreground">{t('assets.armory.movementsPane.historyOnly')}</p>
          <dl className={factsClass}>
            <Fact label={t('assets.armory.movementsPane.voidedAt')}><Ltr>{orgDateTime(posting.voided_at)}</Ltr></Fact>
            <Fact label={t('assets.armory.movementsPane.voidedBy')}>
              {posting.voided_by?.employee ? <Person person={posting.voided_by.employee} /> : voidedBy ? <bdi>{voidedBy}</bdi> : none}
            </Fact>
            <Fact label={t('assets.armory.movementsPane.voidReason')}>{posting.void_reason ? <bdi>{posting.void_reason}</bdi> : none}</Fact>
            <Fact label={t('assets.armory.movementsPane.voidWitness')}>{posting.void_witness ? <Person person={posting.void_witness} /> : none}</Fact>
          </dl>
        </section>
      )}
      <section className="space-y-3 p-4">
        <h4 className="text-sm font-semibold">{t('assets.armory.movementsPane.recordedLines')}</h4>
        {posting.lines.length === 0 ? <p className="text-sm text-muted-foreground">{t('assets.armory.noLines')}</p> : (
          <>
            <p className="text-sm text-muted-foreground">{t('assets.armory.movementsPane.recordedLineHint')}</p>
            <ul className="divide-y divide-border">{posting.lines.map((line) => <MovementLine key={line.id} line={line} posting={posting} />)}</ul>
          </>
        )}
      </section>
      {(assignmentLink || posting.related_posting_id !== null || posting.discrepancy_ids.length > 0) && (
        <section className="space-y-1 p-4">
          <h4 className="text-sm font-semibold">{t('assets.armory.movementsPane.linkedRecords')}</h4>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {assignmentLink && <li><Link className={linkClass} to={assignmentLink.href}>{assignmentLink.label}</Link></li>}
            {posting.related_posting_id !== null && (
              <li><Link className={linkClass} to={armoryLink('audit', { pane: 'movements', movement: posting.related_posting_id })}>{t('assets.armory.movementsPane.relatedPosting')}</Link></li>
            )}
            {posting.discrepancy_ids.map((id) => (
              <li key={id}>
                <Link className={`${linkClass} gap-1`} to={armoryLink('audit', { pane: 'decisions', decision: id })}>
                  {t('assets.armory.movementsPane.discrepancy')} <Ltr>{id}</Ltr>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function VoidAction({ posting, onVoided, focusFallback }: {
  posting: ArmoryPostingRead
  onVoided(posting: ArmoryPostingRead): void
  focusFallback: RefObject<HTMLElement | null>
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const opener = useRef<HTMLButtonElement>(null)
  return (
    <>
      {!posting.voided_at && (
        <Button ref={opener} type="button" variant="outline" className="min-h-11 text-destructive-text" onClick={() => setOpen(true)}>
          {t('assets.armory.movementsPane.voidAction')}
        </Button>
      )}
      <ArmoryVoidDialog posting={posting} open={open} returnFocusRef={opener} focusFallback={focusFallback}
        onClose={(result) => {
          setOpen(false)
          if (result) onVoided(result)
        }} />
    </>
  )
}
