import type { ReactNode, RefObject } from 'react'
import { X } from 'lucide-react'
import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { Ltr } from '../ArmoryLtr'
import { displayDate, licenceStatusKey, orgDateTime, useArmoryLocale } from '../armoryFormat'
import { useArmoryAccess, useArmoryIssue, useArmoryMovement } from '../armoryQueries'
import { armoryLink } from '../armoryUrl'
import { PostedReturnLines, ShiftActor, ShiftCopy, ShiftHolder, ShiftPerson, ShiftReadError } from './shiftPresentation'

interface Props {
  issueId: number
  open: boolean
  onClose: () => void
  onReturn: (issueId: number, opener: HTMLElement) => void
  returnFocusRef: RefObject<HTMLElement | null>
  fallbackFocusRef: RefObject<HTMLElement | null>
}

export function IssueDetail({ issueId, open, onClose, onReturn, returnFocusRef, fallbackFocusRef }: Props) {
  const { t, name, overdue } = useArmoryLocale()
  const { canView, canEdit } = useArmoryAccess()
  const query = useArmoryIssue(open ? issueId : null)
  if (!canView) return null
  const issue = query.isError ? undefined : query.data
  const zone = issue?.shift_window?.time_zone
  const canReturn = canEdit && issue?.state === 'active' && issue.lines.some(line => line.remaining_qty > 0)
  return <Sheet open={open} onOpenChange={next => { if (!next) onClose() }}>
    <SheetContent aria-describedby={undefined} className="w-full max-w-xl" onCloseAutoFocus={event => {
      event.preventDefault()
      const opener = returnFocusRef.current
      const target = opener?.isConnected ? opener : fallbackFocusRef.current
      target?.focus()
    }}>
      <header className="flex items-start justify-between gap-2 border-b border-hairline p-4">
        <div className="min-w-0">
          <SheetTitle className="text-lg font-semibold">{t('assets.armory.issueDetail')}</SheetTitle>
          {issue && <p className="text-sm text-muted-foreground"><Ltr className="font-mono">{issue.record_ref}</Ltr> · <bdi>{name(issue.safe)}</bdi></p>}
        </div>
        <Button type="button" variant="ghost" size="icon" className="size-11 shrink-0" aria-label={t('assets.armory.close')} onClick={onClose}><X aria-hidden /></Button>
      </header>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 text-sm">
        {query.isPending && <p role="status" className="text-muted-foreground">{t('assets.armory.loadingText')}</p>}
        {query.isError && <ShiftReadError error={query.error} retry={() => void query.refetch()} />}
        {issue && <>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
            <IssueFact label={t('assets.armory.holder')}><ShiftHolder holder={issue.holder} /></IssueFact>
            <IssueFact label={t('assets.armory.status')}>{t(`assets.armory.assignmentState.${issue.state}`)}</IssueFact>
            <IssueFact label={t('assets.armory.signedOutAt')}><Ltr>{orgDateTime(issue.issued_at, zone)}</Ltr></IssueFact>
            {issue.due_at && <IssueFact label={t('assets.armory.dueBack')}>
              <Ltr>{orgDateTime(issue.due_at, zone)}</Ltr>
              {issue.overdue_minutes !== null && <p className="font-medium text-destructive-text"><bdi>{overdue(issue.overdue_minutes)}</bdi></p>}
            </IssueFact>}
            {issue.licence_status_at_issue && <IssueFact label={t('assets.armory.licenceState')}>{t(licenceStatusKey(issue.licence_status_at_issue))}</IssueFact>}
            {issue.off_duty_reason && <IssueFact label={t('assets.armory.offDutyReason')}>
              {t(`assets.armory.${issue.off_duty_reason}`)}
              {issue.off_duty_note && <p><bdi>{issue.off_duty_note}</bdi></p>}
            </IssueFact>}
          </dl>
          <p><ShiftCopy id="issuedBy" values={{ name: <ShiftActor actor={issue.issuer} /> }} /></p>
          {issue.licence_warning_acknowledged && <div className="rounded-md bg-warning-soft p-3 text-warning">
            <p className="font-medium">{t('assets.armory.shiftPane.licenceWarningRecorded')}</p>
            <p>{t('assets.armory.releaseNotAuthorized')}</p>
          </div>}
          <section>
            <h3 className="mb-1 font-semibold">{t('assets.armory.options')}</h3>
            {issue.changed_kit && <p className="mb-1 text-muted-foreground">{t('assets.armory.changedKit')}</p>}
            <table className="w-full table-fixed text-start">
              <thead className="border-b border-hairline text-muted-foreground">
                <tr><th scope="col" className="w-1/2 py-2 text-start font-medium">{t('assets.armory.item')}</th>
                  <th scope="col" className="p-1 text-end font-medium">{t('assets.armory.shiftPane.originalQty')}</th>
                  <th scope="col" className="p-1 text-end font-medium">{t('assets.armory.shiftPane.remainingQty')}</th></tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {issue.lines.map(line => <tr key={line.id}>
                  <th scope="row" className="py-2 pe-2 text-start font-medium [overflow-wrap:anywhere]">
                    <bdi>{name(line.item)}</bdi>
                    {line.serial_code && <Ltr className="block font-mono text-xs font-normal">{line.serial_code}</Ltr>}
                    {line.batch && <Ltr className="block font-mono text-xs font-normal">{line.batch.batch_ref}</Ltr>}
                  </th>
                  <td className="p-1 text-end"><Ltr>{line.qty}</Ltr></td>
                  <td className="p-1 text-end"><Ltr>{line.remaining_qty}</Ltr></td>
                </tr>)}
              </tbody>
            </table>
          </section>
          <section>
            <h3 className="mb-1 font-semibold">{t('assets.armory.returned')}</h3>
            {issue.return_ids.length ? <ul className="divide-y divide-hairline">
              {issue.return_ids.map(id => <IssueReturn key={id} postingId={id} zone={zone} />)}
            </ul> : <p className="text-muted-foreground">{t('assets.armory.shiftPane.noReturns')}</p>}
          </section>
        </>}
      </div>
      {canReturn && <footer className="flex justify-end border-t border-hairline p-4">
        <Button type="button" className="min-h-11" onClick={event => onReturn(issueId, event.currentTarget)}>{t('assets.armory.signin')}</Button>
      </footer>}
    </SheetContent>
  </Sheet>
}

function IssueFact({ label, children }: { label: string; children: ReactNode }) {
  return <div className="min-w-0 [overflow-wrap:anywhere]"><dt className="text-muted-foreground">{label}</dt><dd>{children}</dd></div>
}

function IssueReturn({ postingId, zone }: { postingId: number; zone: string | undefined }) {
  const { t } = useArmoryLocale()
  const query = useArmoryMovement(postingId)
  if (query.isError) return <li className="py-2"><ShiftReadError error={query.error} retry={() => void query.refetch()} /></li>
  const posting = query.data
  if (!posting) return <li className="py-2" role="status">{t('assets.armory.loadingText')}</li>
  return <li className="space-y-1 py-2">
    <div className="flex flex-wrap items-center gap-x-2">
      <Link className="inline-flex min-h-11 items-center rounded-sm text-primary-text underline underline-offset-2" to={armoryLink('audit', { pane: 'movements', movement: posting.id })}><Ltr className="font-mono">{posting.record_ref}</Ltr></Link>
      <Ltr>{posting.occurred_at ? orgDateTime(posting.occurred_at, zone) : displayDate(posting.occurred_on)}</Ltr>
      {posting.voided_at ? <span className="text-destructive-text">{t('assets.armory.shiftPane.voidedReturn')}</span> : posting.discrepancy_ids.length > 0 && <span className="text-warning">{t('assets.armory.returnReview')}</span>}
    </div>
    <p>{t('assets.armory.actor')}: <ShiftActor actor={posting.actor} /></p>
    {posting.witness && <p>{t('assets.armory.witness')}: <ShiftPerson person={posting.witness} /></p>}
    <PostedReturnLines lines={posting.lines} />
  </li>
}
