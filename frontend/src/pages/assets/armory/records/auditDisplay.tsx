import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import type { ArmoryActorRead, ArmoryPersonRead, ArmoryPostingRef } from '@/lib/api'
import { Ltr } from '../ArmoryLtr'
import { displayDate, orgDateTime, useArmoryLocale } from '../armoryFormat'
import { armoryErrorMessage } from '../armoryQueries'
import { actorName } from './recordFormat'

export function AuditFact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-wrap wrap-anywhere text-sm">{children}</dd>
    </div>
  )
}

export function AuditActor({ actor }: { actor: ArmoryActorRead | null }) {
  const { t, i18n } = useTranslation()
  const name = actorName(actor, i18n.language)
  return actor?.employee ? <AuditPerson person={actor.employee} /> : <bdi>{name ?? t('assets.armory.auditPane.unknownActor')}</bdi>
}

export function AuditPerson({ person }: { person: ArmoryPersonRead | null }) {
  const { t, name } = useArmoryLocale()
  return person ? (
    <span className="inline-flex flex-wrap items-baseline gap-x-2">
      <bdi>{name(person)}</bdi>
      <Ltr className="font-mono text-xs text-muted-foreground">{person.employee_id}</Ltr>
    </span>
  ) : <span className="text-muted-foreground">{t('assets.armory.none')}</span>
}

export function AuditPostingTime({ posting }: { posting: ArmoryPostingRef }) {
  return posting.occurred_at ? <AuditInstant value={posting.occurred_at} /> : (
    <time dateTime={posting.occurred_on}><Ltr className="tabular-nums">{displayDate(posting.occurred_on)}</Ltr></time>
  )
}

export function AuditInstant({ value, timeZone }: { value: string; timeZone?: string }) {
  return <time dateTime={value}><Ltr className="tabular-nums">{orgDateTime(value, timeZone)}</Ltr></time>
}

export function AuditMonth({ value }: { value: string }) {
  const [year, month] = value.split('-')
  return <time dateTime={value}><Ltr className="tabular-nums">{`${month}/${year}`}</Ltr></time>
}

export function AuditLoading() {
  const { t } = useTranslation()
  return (
    <div role="status" className="space-y-3 px-4 py-5">
      <span className="sr-only">{t('assets.armory.loadingText')}</span>
      <Skeleton className="h-5 w-1/3 motion-reduce:animate-none" />
      <Skeleton className="h-9 w-full motion-reduce:animate-none" />
    </div>
  )
}

export function AuditLoadError({ error, onRetry }: { error: unknown; onRetry(): void }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
      <p role="alert" className="text-sm text-destructive-text">{armoryErrorMessage(error)}</p>
      <Button type="button" variant="outline" className="min-h-11" onClick={onRetry}>{t('assets.armory.retry')}</Button>
    </div>
  )
}

export function AuditPageControls({ page, pageSize, total, onPage }: {
  page: number
  pageSize: number
  total: number
  onPage(page: number): void
}) {
  const { t } = useTranslation()
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (page === 1 && pages === 1) return null
  return (
    <nav aria-label={t('assets.armory.auditPane.pagination')} className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-sm">
      <Button type="button" variant="outline" className="min-h-11" disabled={page <= 1} onClick={() => onPage(Math.min(page - 1, pages))}>
        {t('assets.armory.auditPane.previousPage')}
      </Button>
      <Ltr className="tabular-nums">{page} / {pages}</Ltr>
      <Button type="button" variant="outline" className="min-h-11" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        {t('assets.armory.auditPane.nextPage')}
      </Button>
    </nav>
  )
}
