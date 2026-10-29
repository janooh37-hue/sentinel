import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { localized, type Decision, type Snapshot } from './studioModel'

export interface WhyAccessProps {
  decision: Decision
  snapshot: Snapshot
}

type Reason = Decision['reasons'][number]
type ReasonNode = Decision['reason_tree']

export function DecisionOutcome({ decision }: { decision: Decision }) {
  const { t } = useTranslation()
  return (
    <span
      className={cn(
        'font-semibold',
        decision.authorization === 'allowed' && 'text-success',
        (decision.authorization === 'unknown' ||
          decision.authorization === 'needs_context') &&
          'text-warning',
      )}
    >
      {t(`access.studio.outcomes.${decision.authorization}`)}
      {decision.authorization === 'allowed' &&
        decision.executable_now === false && (
          <span className="font-normal text-warning">
            {' '}
            · {t('access.studio.outcomes.not_ready')}
          </span>
        )}
    </span>
  )
}

export function AccessWarnings({
  warnings,
}: {
  warnings: Decision['warnings']
}) {
  const { t } = useTranslation()
  if (!warnings.length) return null
  return (
    <ul className="space-y-2 text-sm" aria-label={t('access.studio.warnings')}>
      {warnings.map((warning: Decision['warnings'][number], index: number) => (
        <li
          key={`${warning.code}:${index}`}
          className={cn(
            'flex min-w-0 items-start gap-2',
            warning.severity === 'error'
              ? 'text-accent'
              : warning.severity === 'warning'
                ? 'text-warning'
                : 'text-muted-foreground',
          )}
        >
          <AlertTriangle
            className="mt-0.5 size-4 shrink-0"
            aria-hidden="true"
          />
          <div className="min-w-0 [overflow-wrap:anywhere]">
            <p>
              {String(
                t(`access.studio.issueCodes.${warning.code}`, {
                  defaultValue: t('access.studio.issueCode'),
                  returnObjects: false,
                }),
              )}{' '}
              <bdi dir="ltr">
                <code className="text-xs">{warning.code}</code>
              </bdi>
            </p>
            {!!warning.capabilities.length && (
              <p className="font-mono text-xs" dir="ltr">
                {warning.capabilities.join(', ')}
              </p>
            )}
            {Object.keys(warning.params).length > 0 && (
              <dl className="mt-1 space-y-1 text-xs">
                {Object.entries(warning.params).map(([key, value]) => (
                  <div key={key} className="flex flex-wrap gap-x-2">
                    <dt>
                      {t(`access.studio.reasonParams.${key}`, {
                        defaultValue: t('access.studio.diagnosticContext'),
                      })}{' '}
                      <bdi dir="ltr">
                        <code>{key}</code>
                      </bdi>
                    </dt>
                    <dd className="min-w-0 [overflow-wrap:anywhere]">
                      <bdi dir="ltr">
                        <code>{JSON.stringify(value)}</code>
                      </bdi>
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        </li>
      ))}
    </ul>
  )
}

export function ReasonText({ reason }: { reason: Reason }) {
  const { t, i18n } = useTranslation()
  return (
    <>
      <bdi>
        {String(
          t(`access.studio.reasonCodes.${reason.code}`, {
            ...reason.params,
            source: localized(reason.source.label, i18n.language),
            defaultValue: localized(reason.source.label, i18n.language),
            returnObjects: false,
          }),
        )}
      </bdi>{' '}
      <bdi dir="ltr">
        <code className="text-xs">{reason.code}</code>
      </bdi>
    </>
  )
}

function SourceList({ reasons }: { reasons: Reason[] }) {
  const { t, i18n } = useTranslation()
  return (
    <ul className="space-y-3">
      {reasons.map((reason: Reason, index: number) => (
        <li
          key={`${reason.code}:${reason.source.kind}:${reason.source.id}:${index}`}
          className="min-w-0 space-y-1 [overflow-wrap:anywhere]"
        >
          <p className="font-medium">
            <ReasonText reason={reason} />
          </p>
          <p className="text-muted-foreground">
            {localized(reason.source.label, i18n.language)} ·{' '}
            {t(`access.studio.sourceKinds.${reason.source.kind}`)} ·{' '}
            {t(`access.studio.contributions.${reason.source.contribution}`)}
          </p>
          {reason.capability && (
            <p dir="ltr" className="font-mono text-xs">
              {reason.capability}
            </p>
          )}
          <p className="text-muted-foreground">
            {t('access.studio.expiry.label')}:{' '}
            {reason.source.expires_at ? (
              <time
                dir="ltr"
                dateTime={reason.source.expires_at}
                className="font-mono text-xs"
              >
                {reason.source.expires_at}
              </time>
            ) : (
              t('access.studio.expiry.none')
            )}
          </p>
          {Object.keys(reason.params).length > 0 && (
            <dl className="grid gap-1 text-xs text-muted-foreground">
              {Object.entries(reason.params).map(([key, value]) => (
                <div key={key} className="flex flex-wrap gap-x-2">
                  <dt>
                    {t(`access.studio.reasonParams.${key}`, {
                      defaultValue: t('access.studio.diagnosticContext'),
                    })}{' '}
                    <bdi dir="ltr">
                      <code>{key}</code>
                    </bdi>
                  </dt>
                  <dd className="min-w-0 [overflow-wrap:anywhere]">
                    <bdi dir="ltr">
                      <code>{JSON.stringify(value)}</code>
                    </bdi>
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </li>
      ))}
    </ul>
  )
}

function ReasonTree({
  node,
  reasons,
}: {
  node: ReasonNode
  reasons: Reason[]
}) {
  const { t } = useTranslation()
  return (
    <div className="space-y-2">
      <p className="font-medium">{t(`access.studio.reasonTree.${node.op}`)}</p>
      <ul className="space-y-2 border-s border-border ps-4">
        {node.children.map(
          (child: ReasonNode['children'][number], index: number) => (
            <li key={index}>
              {'reason_index' in child ? (
                reasons[child.reason_index] && (
                  <ReasonText reason={reasons[child.reason_index]} />
                )
              ) : (
                <ReasonTree node={child} reasons={reasons} />
              )}
            </li>
          ),
        )}
      </ul>
    </div>
  )
}

export function WhyAccess({ decision, snapshot }: WhyAccessProps) {
  const { t } = useTranslation()
  const id = useId()
  const sections: { key: string; reasons: Reason[] }[] = [
    {
      key: 'decisive',
      reasons: decision.reasons.filter((reason: Reason) => reason.decisive),
    },
    {
      key: 'contributing',
      reasons: decision.reasons.filter(
        (reason: Reason) => reason.applied && !reason.decisive,
      ),
    },
    {
      key: 'shadowed',
      reasons: decision.reasons.filter(
        (reason: Reason) => !reason.applied && !reason.decisive,
      ),
    },
  ]
  return (
    <details className="group min-w-0 border-t border-hairline pt-2">
      <summary
        className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-sm text-sm font-medium text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        aria-controls={id}
      >
        <ChevronDown
          className="size-4 shrink-0 -rotate-90 group-open:rotate-0 rtl:rotate-90 rtl:group-open:rotate-0"
          aria-hidden="true"
        />
        {t('access.studio.why.title')}
      </summary>
      <div id={id} className="space-y-5 py-3 text-sm">
        <DecisionOutcome decision={decision} />
        {sections
          .filter((section) => section.reasons.length)
          .map((section) => (
            <section key={section.key} className="space-y-2">
              <h5 className="font-semibold">
                {t(`access.studio.why.${section.key}`)}
              </h5>
              <SourceList reasons={section.reasons} />
            </section>
          ))}
        <section className="space-y-2">
          <h5 className="font-semibold">{t('access.studio.why.logic')}</h5>
          <ReasonTree node={decision.reason_tree} reasons={decision.reasons} />
        </section>
        {!!decision.required_context.length && (
          <div>
            <p>{t('access.studio.why.requiredContext')}</p>
            <ul>
              {decision.required_context.map(
                (key: Decision['required_context'][number]) => (
                  <li key={key}>
                    {t(`access.studio.context.${key}`, {
                      defaultValue: t('access.studio.diagnosticContext'),
                    })}{' '}
                    <bdi dir="ltr">
                      <code className="text-xs">{key}</code>
                    </bdi>
                  </li>
                ),
              )}
            </ul>
          </div>
        )}
        <dl className="grid gap-3 border-t border-hairline pt-3 text-muted-foreground">
          <div>
            <dt className="font-medium">{t('access.studio.why.scope')}</dt>
            <dd>
              {t(`access.studio.scope.${snapshot.scope.mode}`)} ·{' '}
              {t(`access.studio.scopeKinds.${snapshot.scope.kind}`, {
                defaultValue: t('access.studio.scopeKind'),
              })}{' '}
              <bdi dir="ltr">
                <code className="text-xs">{snapshot.scope.kind}</code>
              </bdi>
            </dd>
          </div>
          {!!snapshot.scope.reason_codes.length && (
            <div>
              <dt className="font-medium">
                {t('access.studio.why.scopeReasons')}
              </dt>
              <dd>
                <ul>
                  {snapshot.scope.reason_codes.map(
                    (code: Snapshot['scope']['reason_codes'][number]) => (
                      <li key={code} className="[overflow-wrap:anywhere]">
                        {t(`access.studio.reasonCodes.${code}`, {
                          defaultValue: t('access.studio.scopeReason'),
                        })}{' '}
                        <bdi dir="ltr">
                          <code className="text-xs">{code}</code>
                        </bdi>
                      </li>
                    ),
                  )}
                </ul>
              </dd>
            </div>
          )}
          <div>
            <dt className="font-medium">{t('access.studio.why.evaluated')}</dt>
            <dd>
              <time
                dateTime={snapshot.evaluated_at}
                dir="ltr"
                className="font-mono text-xs [overflow-wrap:anywhere]"
              >
                {snapshot.evaluated_at}
              </time>
            </dd>
          </div>
          {snapshot.valid_until && (
            <div>
              <dt className="font-medium">
                {t('access.studio.why.validUntil')}
              </dt>
              <dd>
                <time
                  dateTime={snapshot.valid_until}
                  dir="ltr"
                  className="font-mono text-xs [overflow-wrap:anywhere]"
                >
                  {snapshot.valid_until}
                </time>
              </dd>
            </div>
          )}
        </dl>
      </div>
    </details>
  )
}
