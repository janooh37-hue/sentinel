import { useId } from 'react'
import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { ARMORY_VIEW_CAP } from '@/lib/armory'
import { useCapabilities } from '@/lib/useCapabilities'
import { Ltr } from '@/pages/assets/armory/ArmoryLtr'
import { orgDateTime, useArmoryLocale } from '@/pages/assets/armory/armoryFormat'
import { useArmoryClearance } from '@/pages/assets/armory/armoryQueries'
import { armoryLink } from '@/pages/assets/armory/armoryUrl'

export function ArmoryClearanceNotice({ employeeId }: { employeeId?: string | null }): React.JSX.Element | null {
  const { has } = useCapabilities()
  if (!employeeId?.trim() || !has(ARMORY_VIEW_CAP) || !has('documents.generate') || !has('books.view') || !has('books.service.Employee Clearance Form')) {
    return null
  }
  return <ClearanceLookup key={employeeId} employeeId={employeeId} />
}

function ClearanceLookup({ employeeId }: { employeeId: string }) {
  const { t, name } = useArmoryLocale()
  const headingId = useId()
  const query = useArmoryClearance(employeeId, true)
  const records = query.data?.records

  return (
    <section aria-labelledby={headingId} className="col-span-full min-w-0 space-y-2 rounded-lg border border-hairline bg-surface p-4 text-sm print:hidden">
      <h2 id={headingId} className="font-semibold">{t('assets.armory.clearance.heading')}</h2>
      {query.isError ? (
        <>
          <p role="alert" className="text-destructive-text">{t('assets.armory.clearance.loadError')}</p>
          <Button type="button" variant="outline" className="min-h-11" disabled={query.isFetching} onClick={() => void query.refetch()}>
            {t('assets.armory.retry')}
          </Button>
        </>
      ) : !records ? (
        <p role="status" className="text-muted-foreground">{t('assets.armory.loadingText')}</p>
      ) : records.length === 0 ? (
        <p role="status" className="text-muted-foreground">{t('assets.armory.clearance.empty')}</p>
      ) : (
        <>
          <p className="text-muted-foreground">{t('assets.armory.clearance.guidance')}</p>
          <ul className="divide-y divide-hairline border-t border-hairline">
            {records.map(({ id, record_ref, kind, safe, issued_at, due_at, lines }) => (
              <li key={id} className="min-w-0 py-2">
                <div className="flex flex-wrap items-center gap-x-3">
                  <Link
                    to={kind === 'custody' ? armoryLink('custody', { custody: id }) : armoryLink('shift', { issue: id })}
                    className="inline-flex min-h-11 items-center rounded-sm font-semibold text-primary underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    <Ltr>{record_ref}</Ltr>
                  </Link>
                  <span className="text-muted-foreground">{t(`assets.armory.assignmentKind.${kind}`)}</span>
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
                </dl>
                <ul className="mt-2 space-y-1">
                  {lines.map((line, index) => (
                    <li key={index} className="flex flex-wrap items-baseline gap-x-3">
                      <bdi>{name(line.item)}</bdi>
                      {line.serial_code && <Ltr className="wrap-anywhere text-muted-foreground">{line.serial_code}</Ltr>}
                      <span className="text-muted-foreground">
                        {t('assets.armory.clearance.remainingQuantity')}: <Ltr className="tabular-nums">{line.remaining_qty}</Ltr>
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
