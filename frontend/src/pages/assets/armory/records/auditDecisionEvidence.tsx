import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import type { ArmoryDiscrepancyRead, ArmoryDecisionRead } from '@/lib/api'
import { Ltr, useArmoryLocale } from '../armoryFormat'
import { armoryLink } from '../armoryUrl'
import { AuditActor, AuditFact, AuditInstant, AuditPerson, AuditPostingTime } from './auditDisplay'

export function DecisionSource({ finding }: { finding: ArmoryDiscrepancyRead }) {
  const { t, name } = useArmoryLocale()
  const { source, safe } = finding
  const isCount = source.kind === 'shift_check' || source.kind === 'monthly_count'
  const href = armoryLink('audit', isCount
    ? { pane: 'counts', count: source.id }
    : { pane: 'movements', movement: source.id })
  return (
    <div className="flex flex-wrap items-center gap-x-3 text-sm text-muted-foreground">
      <Link to={href} className="inline-flex min-h-11 items-center font-medium text-primary-text underline underline-offset-4">
        <Ltr className="font-mono">{source.record_ref}</Ltr>
      </Link>
      <span>{t(`assets.armory.postingKind.${source.kind}`)}</span>
      <bdi>{name(safe)}</bdi>
      <AuditPostingTime posting={source} />
      {source.voided_at && <span>{t('assets.armory.discrepancyStatus.voided')}</span>}
    </div>
  )
}

export function DecisionQuantities({ finding }: { finding: ArmoryDiscrepancyRead }) {
  const { t } = useTranslation()
  const shortfall = finding.kind === 'rounds_shortfall'
  return (
    <dl className="flex flex-wrap gap-x-8 gap-y-2 rounded-md bg-surface-raised px-3 py-2">
      <AuditFact label={t(shortfall ? 'assets.armory.auditPane.issued' : 'assets.armory.expected')}>
        <Ltr className="font-semibold tabular-nums">{finding.expected_qty}</Ltr>
      </AuditFact>
      <AuditFact label={t(shortfall ? 'assets.armory.roundsReturned' : 'assets.armory.found')}>
        <Ltr className="font-semibold tabular-nums">{finding.observed_qty}</Ltr>
      </AuditFact>
      {shortfall && (
        <AuditFact label={t('assets.armory.auditPane.shortfallQuantity')}>
          <Ltr className="font-semibold tabular-nums">{finding.expected_qty - finding.observed_qty}</Ltr>
        </AuditFact>
      )}
    </dl>
  )
}

export function DecisionEvidence({ finding }: { finding: ArmoryDiscrepancyRead }) {
  const { t } = useTranslation()
  return (
    <>
      <DecisionQuantities finding={finding} />
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
        {finding.person && <AuditFact label={t('assets.armory.person')}><AuditPerson person={finding.person} /></AuditFact>}
        <AuditFact label={t('assets.armory.auditPane.sourceRecorder')}><AuditActor actor={finding.recorder} /></AuditFact>
        <AuditFact label={t('assets.armory.auditPane.sourceWitness')}><AuditPerson person={finding.source_witness} /></AuditFact>
        {finding.shortfall_reason && (
          <AuditFact label={t('assets.armory.reason')}>{t(`assets.armory.shortfallReason.${finding.shortfall_reason}`)}</AuditFact>
        )}
        {finding.reference && <AuditFact label={t('assets.armory.reference')}><Ltr className="font-mono">{finding.reference}</Ltr></AuditFact>}
        {finding.note && <AuditFact label={t('assets.armory.notes')}><bdi>{finding.note}</bdi></AuditFact>}
      </dl>
    </>
  )
}

export function DecisionHistory({ decision }: { decision: ArmoryDecisionRead }) {
  const { t } = useTranslation()
  const { posting, outcome } = decision
  return (
    <section className="space-y-3 border-t border-hairline pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">{t('assets.armory.auditPane.decisionHistory')}</h4>
        {posting.voided_at && (
          <span className="rounded-md bg-surface-tinted px-2 py-1 text-xs font-semibold">{t('assets.armory.discrepancyStatus.voided')}</span>
        )}
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
        <AuditFact label={t('assets.armory.outcome')}>{t(`assets.armory.decisionOutcome.${outcome}`)}</AuditFact>
        <AuditFact label={t('assets.armory.auditPane.decidingActor')}><AuditActor actor={posting.actor} /></AuditFact>
        <AuditFact label={t('assets.armory.decisionWitness')}><AuditPerson person={posting.witness} /></AuditFact>
        <AuditFact label={t('assets.armory.date')}><AuditInstant value={posting.occurred_at ?? posting.created_at} /></AuditFact>
        {posting.note && <AuditFact label={t('assets.armory.decisionNote')}><bdi>{posting.note}</bdi></AuditFact>}
      </dl>
      {posting.voided_at && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-md bg-surface-raised p-3 sm:grid-cols-3">
          <AuditFact label={t('assets.armory.auditPane.voidedAt')}><AuditInstant value={posting.voided_at} /></AuditFact>
          <AuditFact label={t('assets.armory.auditPane.voidedBy')}><AuditActor actor={posting.voided_by} /></AuditFact>
          <AuditFact label={t('assets.armory.auditPane.voidWitness')}><AuditPerson person={posting.void_witness} /></AuditFact>
          {posting.void_reason && <AuditFact label={t('assets.armory.auditPane.voidReason')}><bdi>{posting.void_reason}</bdi></AuditFact>}
        </dl>
      )}
      <Link to={armoryLink('audit', { pane: 'movements', movement: posting.id })} className="inline-flex min-h-11 items-center text-sm font-medium text-primary-text underline underline-offset-4">
        <Ltr className="font-mono">{posting.record_ref}</Ltr>
      </Link>
    </section>
  )
}
