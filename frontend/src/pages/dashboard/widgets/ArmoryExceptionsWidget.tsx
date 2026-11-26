import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { WidgetFrame, WIDGET_SUPPORT } from '@/components/dashboard/WidgetFrame'
import type { ArmoryAssignmentSummary, ArmorySerialRead } from '@/lib/api'
import { Ltr } from '@/pages/assets/armory/ArmoryLtr'
import { orgDateTime, useArmoryLocale } from '@/pages/assets/armory/armoryFormat'
import { useArmoryAccess, useArmorySummary } from '@/pages/assets/armory/armoryQueries'
import { ARMORY_PATH, armoryLink } from '@/pages/assets/armory/armoryUrl'
import { PEOPLE_LINK, PEOPLE_META, PEOPLE_ROW, PeopleFeedback } from './peopleWidgetParts'
import type { WidgetProps } from './types'

const WIDGET = 'assets.armory.widget'
const ALL_SAFES = { safe: 'all' }
const SHIFT_TO = armoryLink('shift', ALL_SAFES)
const ITEMS_TO = armoryLink('items', ALL_SAFES)
const GUARDS_TO = armoryLink('guards', ALL_SAFES)
const DECISIONS_TO = armoryLink('audit', { pane: 'decisions' })
const NUMBER = 'font-mono tabular-nums'

/** Keep number runs LTR without changing the shared copy or the order of Arabic units. */
function isolateNumbers(message: string): ReactNode {
  return message.split(/(\p{Nd}+)/u).map((part, index) =>
    index % 2 === 0 ? part : <Ltr key={index} className={NUMBER}>{part}</Ltr>,
  )
}

function ExceptionGroup({ count, message, to, urgent, children }: {
  count: number
  message: string
  to: string
  urgent?: boolean
  children?: ReactNode
}): React.JSX.Element | null {
  const { t } = useTranslation()
  if (count === 0) return null
  return (
    <li className="min-w-0">
      <Link to={to} className={`${PEOPLE_ROW} ${WIDGET_SUPPORT} min-h-7 font-semibold [@media(pointer:coarse)]:min-h-11`}>
        <span className={urgent ? 'text-destructive-text' : 'text-primary-text'}>
          {isolateNumbers(t(message, { count }))}
        </span>
      </Link>
      {children}
    </li>
  )
}

function MissingSerial({ serial }: { serial: ArmorySerialRead }): React.JSX.Element {
  const { name } = useArmoryLocale()
  return (
    <li>
      <Link to={armoryLink('items', { serial: serial.id })} className={`${PEOPLE_ROW} min-h-11`}>
        <span className="min-w-0">
          <Ltr className={`${NUMBER} break-all text-[0.85em] font-medium text-primary-text`}>{serial.serial_code}</Ltr>
          <span className={`${PEOPLE_META} flex flex-wrap gap-x-2`}>
            <bdi>{name(serial.item)}</bdi>
            {serial.safe && <bdi>{name(serial.safe)}</bdi>}
          </span>
        </span>
      </Link>
    </li>
  )
}

function OverdueIssue({ issue, canEdit }: { issue: ArmoryAssignmentSummary; canEdit: boolean }): React.JSX.Element {
  const { t, name, overdue } = useArmoryLocale()
  const holder = issue.holder.employee ?? issue.holder.site_safe
  const mainLine = issue.lines.find((line) => line.remaining_qty > 0 && line.item.kind === 'firearm')
    ?? issue.lines.find((line) => line.remaining_qty > 0)
  return (
    <li className="flex flex-wrap items-center gap-x-2">
      <Link to={armoryLink('shift', { issue: issue.id })} className={`${PEOPLE_ROW} min-h-11 flex-1`}>
        <span className="min-w-0 space-y-1">
          <span className="flex flex-wrap items-baseline gap-x-2 text-[0.85em] font-medium text-primary-text">
            {holder && <bdi>{name(holder)}</bdi>}
            <Ltr className={`${NUMBER} break-all`}>{issue.record_ref}</Ltr>
          </span>
          <span className={`${WIDGET_SUPPORT} block text-destructive-text`}>
            {issue.overdue_minutes === null ? t('assets.armory.overdue') : isolateNumbers(overdue(issue.overdue_minutes))}
          </span>
          <span className={`${PEOPLE_META} flex flex-wrap gap-x-2`}>
            {mainLine && <bdi>{name(mainLine.item)}</bdi>}
            {mainLine?.serial_code && <Ltr className={`${NUMBER} break-all`}>{mainLine.serial_code}</Ltr>}
            <bdi>{name(issue.safe)}</bdi>
          </span>
          {issue.due_at && <span className={`${PEOPLE_META} block`}>{t('assets.armory.dueBack')}: <Ltr className={NUMBER}>{orgDateTime(issue.due_at)}</Ltr></span>}
        </span>
      </Link>
      {canEdit && (
        <Link to={armoryLink('shift', { issue: issue.id, return: 1 })}
          aria-label={t(`${WIDGET}.returnIssue`, { ref: issue.record_ref })}
          className={`${PEOPLE_LINK} ${WIDGET_SUPPORT} inline-flex min-h-11 shrink-0 items-center px-2 font-semibold`}>
          {t('assets.armory.signin')}
        </Link>
      )}
    </li>
  )
}

export function ArmoryExceptionsWidget({ tier, rows }: WidgetProps): React.JSX.Element {
  const { t } = useTranslation()
  const { canView, canEdit } = useArmoryAccess()
  const query = useArmorySummary(null)
  if (!canView) return <></>

  const data = query.data
  const showRecords = tier === 'list' || tier === 'tall'
  const licenceCount = data ? data.licences.missing + data.licences.expired + data.licences.expiring : 0
  const hasAlerts = data && (data.missing_firearm_count || data.overdue_count || data.decision_count || data.due_check_count
    || data.expired_batch_count || data.expiring_batch_count || licenceCount || data.former_open_count) > 0

  return (
    <WidgetFrame title={t('assets.armory.widgetTitle')} viewAllTo={ARMORY_PATH} compact={tier === 'glance'}>
      {query.isError || !data ? <PeopleFeedback pending={query.isPending} retry={query.refetch} /> : !hasAlerts ? (
        <p className={PEOPLE_META} role="status">{t('assets.armory.noAlerts')}</p>
      ) : (
        <ul className={`min-h-0 flex-1 overflow-y-auto ${tier === 'summary' ? 'grid grid-cols-2 content-start gap-x-2' : 'divide-y divide-hairline'}`}>
          <ExceptionGroup count={data.missing_firearm_count} message="assets.armory.missingFirearmN" to={SHIFT_TO} urgent>
            {showRecords && rows > 0 && data.missing_firearms.length > 0 && (
              <ul className="ms-2">
                {data.missing_firearms.slice(0, rows).map((serial) => <MissingSerial key={serial.id} serial={serial} />)}
              </ul>
            )}
          </ExceptionGroup>
          <ExceptionGroup count={data.overdue_count} message="assets.armory.overdueN" to={SHIFT_TO} urgent>
            {showRecords && rows > 0 && data.overdue.length > 0 && (
              <ul className="ms-2 divide-y divide-hairline">
                {data.overdue.slice(0, rows).map((issue) => <OverdueIssue key={issue.id} issue={issue} canEdit={canEdit} />)}
              </ul>
            )}
          </ExceptionGroup>
          <ExceptionGroup count={data.decision_count} message="assets.armory.decisionN" to={DECISIONS_TO} />
          <ExceptionGroup count={data.due_check_count} message={`${WIDGET}.dueChecks`} to={SHIFT_TO} />
          <ExceptionGroup count={data.expired_batch_count} message="assets.armory.expiredBatchN" to={ITEMS_TO} />
          <ExceptionGroup count={data.expiring_batch_count} message="assets.armory.expiringBatchN" to={ITEMS_TO} />
          <ExceptionGroup count={licenceCount} message="assets.armory.licenceAttentionN" to={GUARDS_TO} />
          <ExceptionGroup count={data.former_open_count} message={`${WIDGET}.formerOpenHoldings`} to={GUARDS_TO} />
        </ul>
      )}
    </WidgetFrame>
  )
}
