import { Trans, useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import type { ArmoryCheckReconciliation, ArmoryCountLineRead, ArmoryCountRead, ArmoryShiftWindowRead } from '@/lib/api'
import { Ltr } from '../ArmoryLtr'
import { serialStateKey, useArmoryLocale } from '../armoryFormat'
import { armoryLink } from '../armoryUrl'
import { AuditActor, AuditFact, AuditInstant, AuditMonth, AuditPerson, AuditPostingTime } from './auditDisplay'

const reconciliationStates = ['signed_out', 'in_custody', 'in_repair', 'missing', 'lost'] as const
const recordLink = 'inline-flex min-h-11 items-center gap-1 text-sm font-medium text-primary-text underline underline-offset-4'

export function CountWindow({ window }: { window: ArmoryShiftWindowRead }) {
  const { t } = useTranslation()
  return (
    <div>
      <p className="font-medium">{t(`assets.armory.shiftKind.${window.shift_kind}`)}</p>
      <div className="text-sm text-muted-foreground">
        <Trans
          i18nKey="assets.armory.auditPane.shiftPeriod"
          components={{
            startTime: <AuditInstant value={window.starts_at} timeZone={window.time_zone} />,
            endTime: <AuditInstant value={window.ends_at} timeZone={window.time_zone} />,
          }}
        />
      </div>
    </div>
  )
}

export function CountResult({ count, onFollowLink }: { count: ArmoryCountRead; onFollowLink?(): void }) {
  const { t, name } = useArmoryLocale()
  const { posting, safe, actor, witness, window, month, reconciliation, lines, discrepancy_ids } = count
  const unknown = lines.some((line) => line.expected_qty === null)
  const quantityChanged = lines.some((line) => line.expected_qty !== null && line.expected_qty !== line.observed_qty)
  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 wrap-anywhere">
          <h3 className="font-semibold">{t(`assets.armory.postingKind.${posting.kind}`)}</h3>
          <p className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <Ltr className="font-mono">{posting.record_ref}</Ltr>
            <bdi>{name(safe)}</bdi>
            <AuditPostingTime posting={posting} />
          </p>
        </div>
        {posting.voided_at && (
          <Link to={armoryLink('audit', { pane: 'movements', movement: posting.id })} className={recordLink} onClick={onFollowLink}>
            {t('assets.armory.discrepancyStatus.voided')}
          </Link>
        )}
      </header>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-md bg-surface-raised p-3 sm:grid-cols-3">
        {window && <AuditFact label={t('assets.armory.shift')}><CountWindow window={window} /></AuditFact>}
        {month && <AuditFact label={t('assets.armory.auditPane.month')}><AuditMonth value={month} /></AuditFact>}
        <AuditFact label={t('assets.armory.actor')}><AuditActor actor={actor} /></AuditFact>
        <AuditFact label={t('assets.armory.countWitness')}><AuditPerson person={witness} /></AuditFact>
      </dl>
      {reconciliation && <CountReconciliation reconciliation={reconciliation} />}
      <section className="space-y-2">
        <h4 className="text-sm font-semibold">{t('assets.armory.auditPane.countComparison')}</h4>
        {lines.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('assets.armory.auditPane.noCountLines')}</p>
        ) : (
          <ul className="divide-y divide-hairline rounded-md border border-border">
            {lines.map((line) => <CountLine key={line.item.id} line={line} />)}
          </ul>
        )}
        {unknown && <p className="text-sm text-muted-foreground">{t('assets.armory.noBaseline')}</p>}
        {!unknown && !quantityChanged && discrepancy_ids.length === 0 && lines.length > 0 && (
          <p className="text-sm text-muted-foreground">{t('assets.armory.noDifferences')}</p>
        )}
      </section>
      {discrepancy_ids.length > 0 && (
        <section>
          <h4 className="text-sm font-semibold">{t('assets.armory.discrepancies')}</h4>
          <ul className="flex flex-wrap gap-x-4">
            {discrepancy_ids.map((id) => (
              <li key={id}>
                <Link to={armoryLink('audit', { pane: 'decisions', decision: id })} className={recordLink} onClick={onFollowLink}>
                  <Trans i18nKey="assets.armory.auditPane.discrepancyLink" values={{ id }} components={{ refId: <bdi dir="ltr" className="tabular-nums" /> }} />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function CountLine({ line }: { line: ArmoryCountLineRead }) {
  const { t, name } = useArmoryLocale()
  const { item, expected_qty, observed_qty, expected_serials, observed_serial_codes, expected_unrecorded_qty, observed_unrecorded_qty } = line
  const difference = expected_qty === null ? null : observed_qty - expected_qty
  const expectedCodes = expected_serials.map(({ serial_code }) => serial_code)
  const expectedSet = new Set(expectedCodes)
  const observedSet = new Set(observed_serial_codes)
  const unexpected = observed_serial_codes.filter((serial) => !expectedSet.has(serial))
  const unobserved = expectedCodes.filter((serial) => !observedSet.has(serial))

  return (
    <li className="space-y-3 px-3 py-3">
      <div className="grid items-start gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] sm:gap-4">
        <p className="text-sm font-medium wrap-anywhere"><bdi>{name(item)}</bdi></p>
        <dl className="grid grid-cols-3 gap-2 text-end">
          <AuditFact label={t('assets.armory.expected')}>
            {expected_qty === null ? t('assets.armory.notCounted') : <Ltr className="tabular-nums">{expected_qty}</Ltr>}
          </AuditFact>
          <AuditFact label={t('assets.armory.found')}><Ltr className="tabular-nums">{observed_qty}</Ltr></AuditFact>
          <AuditFact label={t('assets.armory.difference')}>
            {difference === null ? t('assets.armory.notApplicable') : (
              <Ltr className={difference ? 'font-semibold tabular-nums text-destructive-text' : 'tabular-nums'}>{difference > 0 ? `+${difference}` : difference}</Ltr>
            )}
          </AuditFact>
        </dl>
      </div>
      {(expectedCodes.length > 0 || observed_serial_codes.length > 0 || observed_unrecorded_qty !== null) && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-hairline pt-2">
          <SerialEvidence label={t('assets.armory.auditPane.expectedSerials')} codes={expectedCodes} />
          <SerialEvidence label={t('assets.armory.blindSerials')} codes={observed_serial_codes} />
          {unobserved.length > 0 && <SerialEvidence label={t('assets.armory.auditPane.unobservedSerials')} codes={unobserved} />}
          {unexpected.length > 0 && <SerialEvidence label={t('assets.armory.auditPane.unexpectedSerials')} codes={unexpected} />}
          {observed_unrecorded_qty !== null && (
            <>
              <AuditFact label={t('assets.armory.auditPane.expectedUnrecorded')}>
                {expected_unrecorded_qty === null ? t('assets.armory.notCounted') : <Ltr className="tabular-nums">{expected_unrecorded_qty}</Ltr>}
              </AuditFact>
              <AuditFact label={t('assets.armory.unrecordedQty')}><Ltr className="tabular-nums">{observed_unrecorded_qty}</Ltr></AuditFact>
            </>
          )}
        </dl>
      )}
    </li>
  )
}

function SerialEvidence({ label, codes }: { label: string; codes: readonly string[] }) {
  const { t } = useTranslation()
  return (
    <AuditFact label={label}>
      {codes.length === 0 ? <span className="text-muted-foreground">{t('assets.armory.none')}</span> : (
        <ul className="flex flex-wrap gap-x-2 gap-y-1">
          {codes.map((code) => <li key={code}><Ltr className="font-mono text-xs">{code}</Ltr></li>)}
        </ul>
      )}
    </AuditFact>
  )
}

function CountReconciliation({ reconciliation }: { reconciliation: ArmoryCheckReconciliation }) {
  const { t } = useTranslation()
  return (
    <section className="space-y-2">
      <h4 className="text-sm font-semibold">{t('assets.armory.accountedElsewhere')}</h4>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-y border-border py-3 sm:grid-cols-3">
        <AuditFact label={t('assets.armory.owned')}><Ltr className="tabular-nums">{reconciliation.assigned_count}</Ltr></AuditFact>
        {reconciliationStates.map((state) => <SerialEvidence key={state} label={t(serialStateKey(state))} codes={reconciliation[state].map((serial) => serial.serial_code)} />)}
      </dl>
    </section>
  )
}
