import { useId, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { destinationId, isMessageTemplate, localized, type Decision, type Resource, type Snapshot } from './studioModel'
import { LocalDateTime } from './SettingIdentity'

export interface WhyAccessProps {
  decision: Decision
  snapshot: Snapshot
  resource?: Resource
  baseline?: 'granted' | 'not_granted' | 'mixed'
  children?: ReactNode
  technicalDetails?: ReactNode
  compact?: boolean
}

type Reason = Decision['reasons'][number]
type ReasonNode = Decision['reason_tree']


export function DecisionOutcome({ decision, resource }: { decision: Decision; resource?: Resource }) {
  const { t } = useTranslation()
  const context = decision.required_context ?? []
  const dependency = context.includes('department_id') || context.includes('department') ? 'department'
    : context.includes('unit_id') || context.includes('unit') ? 'unit'
    : context.includes('category_id') ? 'category'
    : context.includes('classification_id') ? 'classification'
    : context.includes('employee_assignment') ? 'employee_assignment'
    : context.includes('grade') ? 'grade' : undefined
  return (
    <span className={cn('inline-flex flex-wrap items-center gap-x-1 rounded-md bg-surface-tinted px-2 py-1 text-xs font-semibold', decision.authorization === 'allowed' && 'text-success', decision.authorization === 'unknown' && 'text-warning', decision.authorization === 'needs_context' && 'text-muted-foreground')}>
      {t(resource && isMessageTemplate(resource) && decision.action === 'view' && decision.authorization === 'denied' ? 'access.studio.templateHidden' : decision.authorization === 'needs_context' && dependency ? `access.studio.outcomes.depends_${dependency}` : `access.studio.outcomes.${decision.authorization}`)}
    </span>
  )
}

export function AccessWarnings({ warnings = [], snapshot }: { warnings: Decision['warnings']; snapshot?: Snapshot }) {
  const { t, i18n } = useTranslation()
  if (!warnings.length) return null
  return (
    <ul className="space-y-2 text-sm" aria-label={t('access.studio.warnings')}>
      {warnings.map((warning, index) => {
        const labels = (warning.capabilities ?? []).map((capability) => {
          const catalog = snapshot?.items.find((item) => item.resource.kind === 'capability' && item.resource.id === capability)
          return catalog ? localized(catalog.label, i18n.language).trim() : ''
        })
        const prerequisite = ['PREREQUISITE_BLOCKED', 'CONDITIONAL_PREREQUISITE_BLOCKED'].includes(warning.code)
        const unnamedPrerequisite = prerequisite && (!labels.length || labels.some((label) => !label))
        return <li key={`${warning.code}:${index}`} className={cn('flex min-w-0 items-start gap-2', warning.severity === 'error' ? 'text-accent' : warning.severity === 'warning' ? 'text-warning' : 'text-muted-foreground')}>
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p className="min-w-0 [overflow-wrap:anywhere]">{unnamedPrerequisite
            ? t(warning.code === 'CONDITIONAL_PREREQUISITE_BLOCKED' && warning.params?.category_exists === false ? 'access.studio.attention.conditionalCategoryMissing' : 'access.studio.attention.prerequisiteUnknown')
            : String(t(`access.studio.issueCodes.${warning.code}`, {
              permission: new Intl.ListFormat(i18n.language).format(labels),
              defaultValue: t('access.studio.attention.unknownWarning'), returnObjects: false,
            }))}</p>
        </li>
      })}
    </ul>
  )
}

export function ReasonText({ reason }: { reason: Reason }) {
  const { t, i18n } = useTranslation()
  return <bdi>{String(t(`access.studio.reasonCodes.${reason.code}`, { ...reason.params, source: localized(reason.source.label, i18n.language), defaultValue: t('access.studio.reasonCode', { source: t(`access.studio.sourceKinds.${reason.source.kind}`) }), returnObjects: false }))}</bdi>
}

function TechnicalParams({ params = {} }: { params?: Reason['params'] }) {
  const { t } = useTranslation()
  return (
    <dl className="mt-1 space-y-1 text-muted-foreground">
      {Object.entries(params).map(([key, value]) => (
        <div key={key} className="flex flex-wrap gap-x-2">
          <dt>{t(`access.studio.reasonParams.${key}`, { defaultValue: t('access.studio.diagnosticContext') })}</dt>
          <dd className="min-w-0 [overflow-wrap:anywhere]">
            {key === 'error_code' && typeof value === 'string'
              ? t(`access.studio.reasonCodes.${value}`, { defaultValue: t('access.studio.issueCode') })
              : <bdi dir="ltr" className="font-mono">{JSON.stringify(value)}</bdi>}
          </dd>
        </div>
      ))}
    </dl>
  )
}

function SourceList({ reasons }: { reasons: Reason[] }) {
  const { t, i18n } = useTranslation()
  return (
    <ul className="space-y-3">
      {reasons.map((reason, index) => (
        <li key={`${reason.code}:${reason.source.kind}:${reason.source.id}:${index}`} className="min-w-0 space-y-1 [overflow-wrap:anywhere]">
          <p className="font-medium"><ReasonText reason={reason} /></p>
          <p className="text-muted-foreground">{reason.source.kind === 'role' ? `${t('access.studio.sourceKinds.role')}: ${t(`access.roleName.${reason.source.id}`, { defaultValue: localized(reason.source.label, i18n.language) })}` : reason.source.kind === 'department' ? localized(reason.source.label, i18n.language) : t(`access.studio.sourceKinds.${reason.source.kind}`)} · {t(`access.studio.contributions.${reason.source.contribution}`)}</p>
          {reason.source.expires_at && <p className="text-muted-foreground">{t('access.studio.expiry.label')}: <LocalDateTime value={reason.source.expires_at} /></p>}
        </li>
      ))}
    </ul>
  )
}

function ReasonTree({ node, reasons }: { node: ReasonNode; reasons: Reason[] }) {
  const { t } = useTranslation()
  return (
    <div className="space-y-2">
      <p className="font-medium">{t(`access.studio.reasonTree.${node.op}`)}</p>
      <ul className="space-y-2 border-s border-border ps-4">
        {node.children.map((child, index) => <li key={index}>{'reason_index' in child ? reasons[child.reason_index] && <ReasonText reason={reasons[child.reason_index]} /> : <ReasonTree node={child} reasons={reasons} />}</li>)}
      </ul>
    </div>
  )
}

export function WhyAccess({ decision, snapshot, resource, baseline, children, technicalDetails, compact = false }: WhyAccessProps) {
  const { t } = useTranslation()
  const id = useId()
  const requiredContext = decision.required_context ?? []
  const boundCount = decision.setting_capabilities.filter((capability) => snapshot.role_defaults.includes(capability)).length
  const roleBaseline = baseline ?? (boundCount === 0 ? 'not_granted' : boundCount === decision.setting_capabilities.length ? 'granted' : 'mixed')
  const sections = [
    { key: 'decisive', reasons: decision.reasons.filter((reason) => reason.decisive) },
    { key: 'contributing', reasons: decision.reasons.filter((reason) => reason.applied && !reason.decisive) },
    { key: 'shadowed', reasons: decision.reasons.filter((reason) => !reason.applied && !reason.decisive) },
  ]
  return (
    <details className={cn('group/why min-w-0', compact ? 'col-start-2 row-start-2 open:col-span-full open:col-start-1 open:row-start-auto lg:col-start-auto lg:row-start-auto' : 'border-t border-hairline pt-2')}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1 rounded-sm text-xs font-medium text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" aria-controls={id} aria-labelledby={compact && resource ? `${id}-label ${destinationId(resource, decision.action)}` : undefined}>
        <ChevronDown className="size-4 shrink-0 -rotate-90 group-open/why:rotate-0 rtl:rotate-90 rtl:group-open/why:rotate-0" aria-hidden="true" />
        <span id={`${id}-label`}>{t(compact ? 'access.studio.why.short' : 'access.studio.why.title')}</span>
      </summary>
      <div id={id} className="space-y-5 border-t border-hairline py-3 text-sm">
        <DecisionOutcome decision={decision} resource={resource} />
        {decision.setting_capabilities.length > 0 && <p><span className="text-muted-foreground">{t('access.studio.roleBaseline')}: </span><span className="font-medium">{t(`access.studio.baseline.${roleBaseline}`)}</span></p>}
        {children}
        <AccessWarnings warnings={decision.warnings} snapshot={snapshot} />
        {sections.filter((section) => section.reasons.length).map((section) => <section key={section.key} className="space-y-2"><h5 className="font-semibold">{t(`access.studio.why.${section.key}`)}</h5><SourceList reasons={section.reasons} /></section>)}
        <section className="space-y-2"><h5 className="font-semibold">{t('access.studio.why.logic')}</h5><ReasonTree node={decision.reason_tree} reasons={decision.reasons} /></section>
        {!!requiredContext.length && <div><p>{t('access.studio.why.requiredContext')}</p><ul>{requiredContext.map((key) => <li key={key}>{t(`access.studio.context.${key}`, { defaultValue: t('access.studio.diagnosticContext') })}</li>)}</ul></div>}
        <dl className="grid gap-3 border-t border-hairline pt-3 text-muted-foreground sm:grid-cols-2">
          <div><dt className="font-medium">{t('access.studio.why.scope')}</dt><dd>{t(`access.studio.scope.${snapshot.scope.mode}`)} · {t(`access.studio.scopeKinds.${snapshot.scope.kind}`, { defaultValue: t('access.studio.scopeKind') })}</dd></div>
          {!!snapshot.scope.reason_codes.length && <div><dt className="font-medium">{t('access.studio.why.scopeReasons')}</dt><dd><ul>{snapshot.scope.reason_codes.map((code) => <li key={code}>{t(`access.studio.reasonCodes.${code}`, { defaultValue: t('access.studio.scopeReason') })}</li>)}</ul></dd></div>}
          <div><dt className="font-medium">{t('access.studio.why.evaluated')}</dt><dd><LocalDateTime value={snapshot.evaluated_at} /></dd></div>
          {snapshot.valid_until && <div><dt className="font-medium">{t('access.studio.why.validUntil')}</dt><dd><LocalDateTime value={snapshot.valid_until} /></dd></div>}
        </dl>
        <details className="group/technical border-t border-hairline pt-2">
          <summary className="flex min-h-11 cursor-pointer items-center gap-2 text-xs font-medium text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">{t('access.studio.why.technical')}</summary>
          <div className="space-y-4 py-3 text-xs">
            <dl className="space-y-2">
              {resource && <div><dt>{t('access.studio.check.resourceId')}</dt><dd><bdi dir="ltr" className="font-mono [overflow-wrap:anywhere]">{resource.kind}:{resource.id}</bdi></dd></div>}
              <div><dt>{t('access.studio.boundSettings')}</dt><dd><ul>{decision.setting_capabilities.map((capability) => <li key={capability}><bdi dir="ltr" className="font-mono [overflow-wrap:anywhere]">{capability}</bdi> · {t(`access.studio.baseline.${snapshot.role_defaults.includes(capability) ? 'granted' : 'not_granted'}`)}</li>)}</ul></dd></div>
              <div><dt>{t('access.studio.why.logic')}</dt><dd><bdi dir="ltr" className="font-mono">{decision.rule_id}</bdi></dd></div>
            </dl>
            <ul className="space-y-2">{decision.reasons.map((reason, index) => <li key={index} className="[overflow-wrap:anywhere]"><ReasonText reason={reason} />{reason.capability && <p dir="ltr" className="font-mono">{reason.capability}</p>}<TechnicalParams params={reason.params} /></li>)}</ul>
            {!!decision.warnings?.length && <ul className="space-y-2">{decision.warnings.map((warning, index) => <li key={index}>{!!warning.capabilities?.length && <p dir="ltr" className="font-mono">{warning.capabilities.join(', ')}</p>}<TechnicalParams params={warning.params} /></li>)}</ul>}
            {technicalDetails}
          </div>
        </details>
      </div>
    </details>
  )
}
