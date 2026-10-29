import { AlertTriangle, ArrowLeftRight, ChevronDown, FileText, MailIcon, MapPin, Plane, UserX } from 'lucide-react'
import { Fragment, useId, type ComponentType } from 'react'
import { useTranslation } from 'react-i18next'

import { DutyLocationActivity } from '@/components/employees/DutyLocationActivity'
import { StatusActivity } from '@/components/employees/StatusActivity'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import { formatStatementDate, formatStatementTime } from '../statement/statementModel'
import type { ActivityStatementItem, StatementKind } from '../statement/statementTypes'
import { documentName, entryFacts, entrySentence } from './activitySentence'

const ICONS: Record<StatementKind, ComponentType<{ className?: string }>> = {
  document: FileText,
  leave: Plane,
  violation: AlertTriangle,
  ledger: MailIcon,
  absence: UserX,
  duty_location: MapPin,
  status: ArrowLeftRight,
}

/** Render `<b>` markers from a translated sentence as bold text. */
function Rich({ text }: { text: string }): React.JSX.Element {
  const pieces = text.split(/<b>(.*?)<\/b>/g)
  return (
    <>
      {pieces.map((piece, index) =>
        index % 2 === 1 ? (
          <b key={index} className="font-semibold text-foreground">
            <bdi>{piece}</bdi>
          </b>
        ) : (
          <Fragment key={index}>{piece}</Fragment>
        ),
      )}
    </>
  )
}

export interface EntryActions {
  /** Label key under `activityStatement.action.*` and the handler, or null when the entry has none. */
  action: { label: string; run: () => void } | null
  linkedDocuments: { id: number; name: string }[]
  previewLinked: (index: number) => void
}

interface Props {
  item: ActivityStatementItem
  expanded: boolean
  onToggle: () => void
  language: string
  actions: EntryActions
}

export function ActivityEntry({ item, expanded, onToggle, language, actions }: Props): React.JSX.Element {
  const { t } = useTranslation()
  const panelId = useId()
  const Icon = ICONS[item.kind]
  const sentence = entrySentence(item, t, language)
  const facts = entryFacts(item, t, language)
  const date = formatStatementDate(item.occurred_at, language)
  const time = item.date_only ? null : formatStatementTime(item.occurred_at)
  const kindLabel = t(`activityStatement.kind.${item.kind}`)

  return (
    <li className="border-b border-hairline last:border-b-0" data-testid={`activity-entry-${item.kind}-${item.source_id}`}>
      <div className="grid grid-cols-[1.75rem_minmax(0,1fr)_1.75rem] items-start gap-x-3 gap-y-1 px-4 py-3 sm:grid-cols-[1.75rem_minmax(0,1fr)_auto_1.75rem]">
        <span
          className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface-tinted text-muted-foreground"
          title={kindLabel}
        >
          <Icon className="h-4 w-4" aria-hidden />
          <span className="sr-only">{kindLabel}</span>
        </span>
        <div className="min-w-0 flex-1 text-sm leading-relaxed text-muted-foreground">
          {sentence !== null ? (
            <p className="break-words">
              <Rich text={sentence} />
            </p>
          ) : item.kind === 'duty_location' ? (
            <DutyLocationActivity item={item} />
          ) : (
                        <StatusActivity item={item} />
          )}
        </div>
        <div className="col-start-2 row-start-2 flex items-center gap-2 text-xs text-muted-foreground sm:col-start-3 sm:row-start-1 sm:flex-col sm:items-end sm:gap-0.5">
          <span className="inline-flex items-baseline gap-2">
            <bdi>{date}</bdi>
            {time ? (
              <bdi dir="ltr">
                {time}
              </bdi>
            ) : null}
          </span>
          {item.reference ? (
            <bdi dir="ltr" className="font-mono">
              {item.reference}
            </bdi>
          ) : null}
        </div>
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={panelId}
          aria-label={t(expanded ? 'activityStatement.collapse' : 'activityStatement.expand')}
          onClick={onToggle}
          className="col-start-3 row-start-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-surface-tinted sm:col-start-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronDown className={cn('h-4 w-4 transition-transform', expanded && 'rotate-180')} aria-hidden />
        </button>
      </div>
      {expanded ? (
        <div id={panelId} className="space-y-3 bg-surface-tinted/40 px-4 py-3 ps-14 text-sm">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            {facts.map((fact) => (
              <Fragment key={fact.label}>
                <dt className="text-muted-foreground">{fact.label}</dt>
                <dd className="min-w-0 break-words text-foreground">
                  <bdi dir="auto">{fact.value}</bdi>
                </dd>
              </Fragment>
            ))}
            {item.actor_name ? (
              <>
                <dt className="text-muted-foreground">{t('activityStatement.fact.recordedBy')}</dt>
                <dd className="text-foreground">
                  <bdi dir="auto">{item.actor_name}</bdi>
                </dd>
              </>
            ) : null}
            {item.reference ? (
              <>
                <dt className="text-muted-foreground">{t('activityStatement.fact.reference')}</dt>
                <dd>
                  <bdi dir="ltr" className="font-mono text-foreground">
                    {item.reference}
                  </bdi>
                </dd>
              </>
            ) : null}
          </dl>
          {actions.linkedDocuments.length > 0 ? (
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">{t('activityStatement.linkedDocuments')}</p>
              <ul className="flex flex-wrap gap-2">
                {actions.linkedDocuments.map((doc, index) => (
                  <li key={doc.id}>
                    <Button type="button" variant="secondary" size="sm" onClick={() => actions.previewLinked(index)}>
                      <FileText className="h-3.5 w-3.5" aria-hidden />
                      {doc.name}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {actions.action ? (
            <Button type="button" variant="outline" size="sm" onClick={actions.action.run}>
              {t(`activityStatement.action.${actions.action.label}`, { name: documentName(item, language) })}
            </Button>
          ) : null}
        </div>
      ) : null}
    </li>
  )
}
