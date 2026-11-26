import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import type { ArmoryDiscrepancyFilters, ArmoryDiscrepancyRead } from '@/lib/api'
import { Ltr } from '../ArmoryLtr'
import { useArmoryLocale } from '../armoryFormat'
import { useArmoryDiscrepancies } from '../armoryQueries'
import { patchArmoryParams, readArmoryId } from '../armoryUrl'
import { DecisionDialog } from './DecisionDialog'
import { DecisionEvidence, DecisionHistory, DecisionSource } from './auditDecisionEvidence'
import { AuditLoadError, AuditLoading, AuditPageControls } from './auditDisplay'

const statuses = [
  { value: 'open', label: 'assets.armory.auditPane.openFilter' },
  { value: 'resolved', label: 'assets.armory.resolved' },
  { value: 'all', label: 'assets.armory.all' },
] as const

type Status = NonNullable<ArmoryDiscrepancyFilters['status']>
type RecordAction = (finding: ArmoryDiscrepancyRead, opener: HTMLButtonElement) => void

export function AuditDecisions({ safeId, canEdit }: { safeId: number | null; canEdit: boolean }) {
  const { t } = useTranslation()
  const [params, setParams] = useSearchParams()
  const id = useId()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const openerRef = useRef<HTMLButtonElement | null>(null)
  const decisionId = readArmoryId(params, 'decision')
  const previousDetail = useRef(decisionId)
  const requested = params.get('status')
  const status: Status = requested === 'resolved' || requested === 'all' ? requested : 'open'
  const [pages, setPages] = useState<{ status: Status; page: number }>({ status, page: 1 })
  const page = pages.status === status ? pages.page : 1
  const [target, setTarget] = useState<{ finding: ArmoryDiscrepancyRead; decisionId: number | null; status: Status } | null>(null)
  const [saved, setSaved] = useState(false)
  if (target && (target.decisionId !== decisionId || target.status !== status)) setTarget(null)

  useEffect(() => {
    if (previousDetail.current === decisionId) return
    const previous = previousDetail.current
    previousDetail.current = decisionId
    const rowLink = decisionId === null && previous !== null
      ? document.getElementById(`${id}-finding-${previous}`)
      : null
    const destination = rowLink ?? headingRef.current
    destination?.focus()
  }, [decisionId, id])

  function startDecision(finding: ArmoryDiscrepancyRead, opener: HTMLButtonElement) {
    openerRef.current = opener
    setSaved(false)
    setTarget({ finding, decisionId, status })
  }

  return (
    <section aria-labelledby={`${id}-heading`} className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 ref={headingRef} id={`${id}-heading`} tabIndex={-1} className="font-semibold tracking-tight">{t('assets.armory.discrepancies')}</h2>
        {decisionId === null ? (
          <div role="group" aria-label={t('assets.armory.status')} className="flex flex-wrap gap-1">
            {statuses.map(({ value, label }) => (
              <Button key={value} type="button" variant={value === status ? 'secondary' : 'ghost'} className="min-h-11" aria-pressed={value === status} onClick={() => {
                setPages({ status: value, page: 1 })
                setParams((current) => patchArmoryParams(current, { status: value }))
              }}>{t(label)}</Button>
            ))}
          </div>
        ) : (
          <Link to={`?${patchArmoryParams(params, { decision: null })}`} className="inline-flex min-h-11 items-center text-sm font-medium text-primary-text underline underline-offset-4">
            {t('assets.armory.back')}
          </Link>
        )}
      </div>
      {saved && <p role="status" className="rounded-md bg-success-soft px-3 py-2 text-sm">{t('assets.armory.savedDecision')}</p>}
      {decisionId === null ? (
        <DecisionsList safeId={safeId} status={status} page={page} setPage={(next) => setPages({ status, page: next })} canEdit={canEdit} onRecord={startDecision} params={params} linkPrefix={id} />
      ) : (
        <DecisionDetail id={decisionId} canEdit={canEdit} onRecord={startDecision} />
      )}
      {canEdit && target && (
        <DecisionDialog
          key={target.finding.id}
          discrepancy={target.finding}
          onClose={() => setTarget(null)}
          onSaved={() => setSaved(true)}
          onRestoreFocus={() => {
            const opener = openerRef.current
            if (opener?.isConnected) opener.focus()
            else headingRef.current?.focus()
          }}
        />
      )}
    </section>
  )
}

function DecisionsList({ safeId, status, page, setPage, canEdit, onRecord, params, linkPrefix }: {
  safeId: number | null
  status: Status
  page: number
  setPage(page: number): void
  canEdit: boolean
  onRecord: RecordAction
  params: URLSearchParams
  linkPrefix: string
}) {
  const { t } = useTranslation()
  const query = useArmoryDiscrepancies({ ...(safeId !== null ? { safe_id: safeId } : {}), status, page })
  if (query.isError) return <AuditLoadError error={query.error} onRetry={() => void query.refetch()} />
  if (!query.data) return <AuditLoading />

  const groups = new Map<string, ArmoryDiscrepancyRead[]>()
  for (const finding of query.data.items) {
    const key = `${finding.source.id}:${finding.item.id}`
    const group = groups.get(key)
    if (group) group.push(finding)
    else groups.set(key, [finding])
  }

  return (
    <>
      {groups.size === 0 ? (
        <p className="rounded-md border border-border bg-surface p-4 text-sm text-muted-foreground">{t('assets.armory.noDiscrepancies')}</p>
      ) : [...groups].map(([key, group]) => (
        <FindingGroup key={key} findings={group} canEdit={canEdit} onRecord={onRecord} params={params} linkPrefix={linkPrefix} />
      ))}
      <AuditPageControls page={query.data.page} pageSize={query.data.page_size} total={query.data.total} onPage={setPage} />
    </>
  )
}

function DecisionDetail({ id, canEdit, onRecord }: { id: number; canEdit: boolean; onRecord: RecordAction }) {
  const { t } = useTranslation()
  const query = useArmoryDiscrepancies({ discrepancy_id: id, status: 'all' })
  if (query.isError) return <AuditLoadError error={query.error} onRetry={() => void query.refetch()} />
  if (!query.data) return <AuditLoading />
  const finding = query.data.items.find((row) => row.id === id)
  return finding ? (
    <FindingGroup findings={[finding]} canEdit={canEdit} onRecord={onRecord} />
  ) : <p className="rounded-md border border-border bg-surface p-4 text-sm text-muted-foreground">{t('assets.armory.errors.notFound.discrepancy')}</p>
}

function FindingGroup({ findings, canEdit, onRecord, params, linkPrefix }: {
  findings: ArmoryDiscrepancyRead[]
  canEdit: boolean
  onRecord: RecordAction
  params?: URLSearchParams
  linkPrefix?: string
}) {
  const { t, name } = useArmoryLocale()
  return (
    <article className="rounded-lg border border-border bg-surface">
      <header className="border-b border-hairline px-4 pb-1 pt-3">
        <h3 className="font-semibold wrap-anywhere"><bdi>{name(findings[0].item)}</bdi></h3>
        <DecisionSource finding={findings[0]} />
      </header>
      <ul className="divide-y divide-hairline">
        {findings.map((finding) => (
          <li key={finding.id} className="space-y-3 p-4">
            <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
              <div className="min-w-0 space-y-0.5 wrap-anywhere">
                <h4 className="text-sm font-semibold">{t(`assets.armory.discrepancyKind.${finding.kind}`)}</h4>
                {finding.serial_code && <Ltr className="font-mono text-sm">{finding.serial_code}</Ltr>}
              </div>
              <span className={`rounded-md px-2 py-1 text-xs font-semibold ${finding.status === 'open' ? 'bg-warning-soft' : finding.status === 'resolved' ? 'bg-success-soft' : 'bg-surface-tinted'}`}>
                {t(finding.status === 'open' ? 'assets.armory.needsDecision' : `assets.armory.discrepancyStatus.${finding.status}`)}
              </span>
            </div>
            <DecisionEvidence finding={finding} />
            {finding.decision && <DecisionHistory decision={finding.decision} />}
            <div className="flex flex-wrap items-center justify-between gap-2">
              {params && (
                <Link id={`${linkPrefix}-finding-${finding.id}`} to={`?${patchArmoryParams(params, { pane: 'decisions', decision: finding.id })}`} className="inline-flex min-h-11 items-center text-sm font-medium text-primary-text underline underline-offset-4">
                  {t('assets.armory.viewRecord')}
                </Link>
              )}
              {canEdit && finding.status === 'open' && (finding.can_decide ? (
                <Button className="min-h-11" type="button" onClick={(event) => onRecord(finding, event.currentTarget)}>
                  {t('assets.armory.review')}
                </Button>
              ) : <p className="text-sm text-muted-foreground">{t('assets.armory.pendingAuthorisation')}</p>)}
            </div>
          </li>
        ))}
      </ul>
    </article>
  )
}
