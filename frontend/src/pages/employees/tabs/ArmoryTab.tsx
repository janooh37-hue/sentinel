import { useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import type { ArmoryAssignmentSummary } from '@/lib/api'
import { Ltr, displayDate, licenceStatusKey, orgDateTime, useArmoryLocale } from '@/pages/assets/armory/armoryFormat'
import { useArmoryEmployee } from '@/pages/assets/armory/armoryQueries'
import { armoryLink } from '@/pages/assets/armory/armoryUrl'

const recordLink = 'inline-flex min-h-11 items-center rounded-sm font-semibold text-primary underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'
const panel = 'space-y-3 rounded-2xl border border-hairline bg-surface p-4 text-sm'

function AssignmentList({ assignments, open }: {
  assignments: ArmoryAssignmentSummary[]
  open?: boolean
}) {
  const { t, name } = useArmoryLocale()
  return (
    <ul className="divide-y divide-hairline border-t border-hairline">
      {assignments.map(({ id, record_ref, kind, state, safe, holder, issued_at, due_at, lines }) => (
        <li key={id} className="min-w-0 py-2">
          <div className="flex flex-wrap items-center gap-x-3 text-muted-foreground">
            <Link className={recordLink} to={kind === 'custody' ? armoryLink('custody', { custody: id }) : armoryLink('shift', { issue: id })}>
              <Ltr>{record_ref}</Ltr>
            </Link>
            <span>{t(`assets.armory.assignmentKind.${kind}`)}</span>
            {!open && <span>{t(`assets.armory.assignmentState.${state}`)}</span>}
          </div>
          <dl className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
            <div className="flex flex-wrap gap-x-1">
              <dt>{t('assets.armory.safe')}:</dt>
              <dd><bdi>{name(safe)}</bdi></dd>
            </div>
            <div className="flex flex-wrap gap-x-1">
              <dt>{t('assets.armory.signedOutAt')}:</dt>
              <dd><Ltr>{orgDateTime(issued_at)}</Ltr></dd>
            </div>
            {due_at && (
              <div className="flex flex-wrap gap-x-1">
                <dt>{t('assets.armory.dueBack')}:</dt>
                <dd><Ltr>{orgDateTime(due_at)}</Ltr></dd>
              </div>
            )}
            {holder.kind === 'site' && holder.site_safe && (
              <div className="flex flex-wrap gap-x-1">
                <dt>{t('assets.armory.holderKind.site')}:</dt>
                <dd><bdi>{name(holder.site_safe)}</bdi></dd>
              </div>
            )}
            {holder.kind === 'site' && holder.supervisor && (
              <div className="flex flex-wrap gap-x-1">
                <dt>{t('assets.armory.siteSupervisor')}:</dt>
                <dd><bdi>{name(holder.supervisor)}</bdi></dd>
              </div>
            )}
          </dl>
          {open && (
            <ul className="mt-2 space-y-1">
              {lines.map((line) => line.remaining_qty > 0 && (
                <li key={line.id} className="flex flex-wrap items-baseline gap-x-3">
                  <bdi>{name(line.item)}</bdi>
                  {line.serial_code && <Ltr className="wrap-anywhere text-muted-foreground">{line.serial_code}</Ltr>}
                  <span className="text-muted-foreground">
                    {t('assets.armory.clearance.remainingQuantity')}: <Ltr className="tabular-nums">{line.remaining_qty}</Ltr>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  )
}

export function ArmoryTab({ employeeId }: { employeeId: string }): React.JSX.Element {
  const { t } = useTranslation()
  const [page, setPage] = useState(1)
  const query = useArmoryEmployee(employeeId, { page })
  const data = query.isError || query.isPlaceholderData ? undefined : query.data
  const qualification = data?.qualification
  const history = data?.history
  const daysLeft = qualification?.licence_days_left
  const hasNextPage = !!history && history.page * history.page_size < history.total

  return (
    <div className="space-y-4">
      {query.isError ? (
        <div className={panel}>
          <p role="alert" className="text-destructive-text">
            {t(query.isRefetchError ? 'assets.armory.employeeTab.refreshError' : 'assets.armory.employeeTab.loadError')}
          </p>
          <Button type="button" variant="outline" className="min-h-11" disabled={query.isFetching} onClick={() => void query.refetch()}>
            {t('assets.armory.retry')}
          </Button>
        </div>
      ) : !data ? (
        <p role="status" className={`${panel} text-muted-foreground`}>{t('assets.armory.loadingText')}</p>
      ) : null}

      {data && qualification && (
        <>
          <section aria-labelledby="armory-qualification-heading" className={panel}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h2 id="armory-qualification-heading" className="font-semibold">{t('assets.armory.employeeTab.qualification')}</h2>
              {data.person.is_former && <span className="text-muted-foreground">{t('assets.armory.employeeStatus.former')}</span>}
            </div>
            <dl className="grid gap-x-4 gap-y-3 sm:grid-cols-2 xl:grid-cols-4 [&_dt]:text-muted-foreground [&_dd]:font-medium">
              <div>
                <dt>{t('assets.armory.courseRound')}</dt>
                <dd>{qualification.course_round === null ? t('assets.armory.noCourse') : <Ltr>{qualification.course_round}</Ltr>}</dd>
              </div>
              <div>
                <dt>{t('assets.armory.securityNumber')}</dt>
                <dd>{qualification.licence_number ? <Ltr className="wrap-anywhere">{qualification.licence_number}</Ltr> : t('assets.armory.licenceStatus.missing')}</dd>
              </div>
              <div>
                <dt>{t('assets.armory.securityExpiry')}</dt>
                <dd>{qualification.licence_expires_on ? <Ltr>{displayDate(qualification.licence_expires_on)}</Ltr> : t('assets.armory.licenceStatus.missing')}</dd>
              </div>
              <div>
                <dt>{t('assets.armory.licenceState')}</dt>
                <dd>{t(licenceStatusKey(qualification.licence_status))}</dd>
              </div>
              {daysLeft != null && (
                <div>
                  <dt>{t(daysLeft < 0 ? 'assets.armory.employeeTab.daysSinceExpiry' : 'assets.armory.employeeTab.daysUntilExpiry')}</dt>
                  <dd><Ltr>{Math.abs(daysLeft)}</Ltr></dd>
                </div>
              )}
            </dl>
          </section>

          <section aria-labelledby="armory-holdings-heading" className={panel}>
            <h2 id="armory-holdings-heading" className="font-semibold">{t('assets.armory.holdsNow')}</h2>
            {data.open_assignments.length > 0 ? (
              <AssignmentList assignments={data.open_assignments} open />
            ) : <p className="text-muted-foreground">{t('assets.armory.holdsNone')}</p>}
          </section>
        </>
      )}

      {(history || page > 1) && (
        <section aria-labelledby="armory-history-heading" className={panel}>
          <h2 id="armory-history-heading" className="font-semibold">{t('assets.armory.history')}</h2>
          {history && (history.items.length > 0 ? (
            <AssignmentList assignments={history.items} />
          ) : <p className="text-muted-foreground">{t('assets.armory.employeeTab.historyEmpty')}</p>)}
          {(page > 1 || hasNextPage) && (
            <nav aria-labelledby="armory-history-heading" className="flex flex-wrap items-center gap-2">
              <Button
                type="button" variant="outline" className="min-h-11 aria-disabled:opacity-50" aria-disabled={page === 1}
                onClick={() => { if (page > 1) setPage(page - 1) }}
              >
                {t('assets.armory.employeeTab.previousPage')}
              </Button>
              <span aria-live="polite" className="text-muted-foreground">
                <Trans i18nKey="assets.armory.employeeTab.historyPage" t={t} values={{ page }} components={{ number: <bdi dir="ltr" /> }} />
              </span>
              <Button
                type="button" variant="outline" className="min-h-11 aria-disabled:opacity-50" aria-disabled={!hasNextPage}
                onClick={() => { if (hasNextPage) setPage(page + 1) }}
              >
                {t('assets.armory.employeeTab.nextPage')}
              </Button>
            </nav>
          )}
          <Link className={recordLink} to={armoryLink('audit', { pane: 'movements', employee_id: employeeId })}>
            {t('assets.armory.employeeTab.viewMovementHistory')}
          </Link>
        </section>
      )}
    </div>
  )
}
