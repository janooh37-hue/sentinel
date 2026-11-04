import { useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { UniformArt } from '@/components/UniformArt'
import { Button } from '@/components/ui/button'
import { type UniformIssueLine, type UniformRecipient, type UniformReturnRead } from '@/lib/api'
import { pickEmployeeName } from '@/lib/employeeName'
import { formatDmy } from '@/lib/formatDmy'
import { cn } from '@/lib/utils'
import { useCapabilities } from '@/lib/useCapabilities'
import { HandOutDialog } from '../HandOutDialog'
import { ReturnDialog } from '../returns/ReturnDialog'
import { useUniformEmployee, useUniformItems } from '../uniformQueries'
import { VoidDialog } from '../VoidDialog'

interface Props {
  person: UniformRecipient
  headingRef: React.RefObject<HTMLHeadingElement | null>
  onBack: () => void
  className?: string
}

/** Balances come from the same canonical ledger used by the shared return form. */
export function PersonPanel({ person, headingRef, onBack, className }: Props): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const editable = useCapabilities().has('uniform.edit')
  const records = useUniformEmployee(person.employee_id)
  const items = useUniformItems(true)
  const [dialog, setDialog] = useState<'give' | 'return' | null>(null)
  const [voiding, setVoiding] = useState<{ kind: 'issue' | 'return'; id: number } | null>(null)
  const opener = useRef<HTMLElement | null>(null)
  const id = useId()
  const employee = { id: person.employee_id, name_en: person.name_en, name_ar: person.name_ar }
  const holdings = records.data?.holdings.filter(line => line.qty > 0) ?? []
  const total = holdings.reduce((sum, line) => sum + line.qty, 0)
  const ready = records.data !== undefined && items.data !== undefined
  const initialError = (records.isError && records.data === undefined) || (items.isError && items.data === undefined)
  const refreshError = (records.isError && records.data !== undefined) || (items.isError && items.data !== undefined)
  const actor = (en: string | null | undefined, ar: string | null | undefined) => `\u2068${pickEmployeeName({ name_en: en || t('assets.uniform.received.unknownActor'), name_ar: ar }, i18n.language)}\u2069`
  const lines = (rows: UniformIssueLine[] | UniformReturnRead['lines']) => <ul className="divide-y divide-hairline">{rows.map((line, index) => {
    const piece = items.data?.find(item => item.id === line.item_id)
    const label = piece?.tracking === 'shelf' ? piece.sizes.find(size => size.id === line.size_id)?.label : undefined
    const condition = 'condition' in line ? line.condition : null
    return <li key={index} className="flex min-w-0 items-center gap-3 py-2">
      {piece && <UniformArt kind={piece.drawing} size={40} className="shrink-0" />}
      <span className="min-w-0 flex-1"><span dir="auto" className="block break-words text-sm font-medium">{piece ? i18n.language.startsWith('ar') ? piece.name_ar : piece.name_en : <>{t('assets.uniform.piece')} <bdi dir="ltr">{line.item_id}</bdi></>}</span>
        {(label || condition) && <span className="block text-xs text-muted-foreground">{label === 'one' ? t('assets.uniform.oneSize') : label ? <bdi dir="ltr">{label}</bdi> : null}{label && condition && ' · '}{condition && <span>{t(`assets.uniform.${condition}`)}</span>}</span>}
      </span>
      <bdi dir="ltr" className="shrink-0 font-semibold tabular-nums">× {line.qty}</bdi>
    </li>
  })}</ul>

  return <section aria-labelledby="uniform-person-h" className={cn('min-w-0 rounded-xl border border-border bg-surface', className)}>
    <div className="border-b border-border p-4">
      <Button type="button" variant="secondary" className="mb-3 min-h-11 min-[1000px]:hidden" onClick={onBack}>{t('assets.uniform.back')}</Button>
      <h2 id="uniform-person-h" ref={headingRef} tabIndex={-1} dir="auto" className="break-words text-lg font-semibold outline-none">{pickEmployeeName(person, i18n.language)}</h2>
      <bdi dir="ltr" className="text-sm text-muted-foreground">{person.employee_id}</bdi>
      {ready && <p className="mt-1 text-sm font-semibold">{t('assets.uniform.holdsN', { count: total })}</p>}
      {editable && <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" className="min-h-11 whitespace-normal" onClick={event => { opener.current = event.currentTarget; setDialog('give') }}>{t('assets.uniform.handOut')}</Button>
        <Button type="button" variant="secondary" className="min-h-11 whitespace-normal" disabled={!ready || total === 0} aria-describedby={ready && total === 0 ? `${id}-return-reason` : undefined} onClick={event => { opener.current = event.currentTarget; setDialog('return') }}>{t('assets.uniform.recordReturn')}</Button>
        {ready && total === 0 && <p id={`${id}-return-reason`} className="w-full text-xs text-muted-foreground">{t('assets.uniform.received.noHoldingsReturn')}</p>}
      </div>}
    </div>
    {refreshError && <div className="border-b border-border p-4"><p role="alert" className="text-sm text-destructive-text">{t('assets.uniform.refreshRecordsError')}</p><Button type="button" variant="ghost" className="min-h-11" onClick={() => { void Promise.all([records.refetch(), items.refetch()]) }}>{t('assets.uniform.retry')}</Button></div>}
    {initialError ? <div className="p-4"><p role="alert" className="text-sm text-destructive-text">{t('assets.uniform.received.errorDetail')}</p><Button type="button" variant="ghost" className="min-h-11" onClick={() => { void Promise.all([records.refetch(), items.refetch()]).then(() => headingRef.current?.focus()) }}>{t('assets.uniform.retry')}</Button></div>
      : !ready ? <p role="status" className="p-4 text-sm text-muted-foreground">{t('assets.uniform.loading')}</p>
      : <>
        <section aria-label={t('assets.uniform.currentlyHolds')} className="border-b border-border p-4">
          <h3 className="mb-2 text-sm font-semibold">{t('assets.uniform.currentlyHolds')}</h3>
          {holdings.length ? lines(holdings) : <p className="text-sm text-muted-foreground">{t('assets.uniform.holdsNone')}</p>}
        </section>
        <section aria-labelledby={`${id}-issues`} className="p-4">
          <h3 id={`${id}-issues`} className="mb-2 text-sm font-semibold">{t('assets.uniform.received.issueHistory')}</h3>
          {records.data.issues.length === 0 ? <p className="text-sm text-muted-foreground">{t('assets.uniform.received.noIssues')}</p> : <ol className="divide-y divide-hairline">{records.data.issues.map(record => <li key={record.id} className="py-3 first:pt-0">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1"><bdi dir="ltr" className="text-sm font-semibold">{formatDmy(record.issued_on)}</bdi><span className="text-xs text-muted-foreground" dir="auto">{t('assets.uniform.handedOutBy', { name: actor(record.given_by_name_en, record.given_by_name_ar) })}</span></div>
            {record.voided_at && <p className="mt-2 text-sm text-muted-foreground"><span className="font-semibold">{t('assets.uniform.voidStatus')}</span>{record.void_reason && <>{' · '}<bdi dir="auto">{record.void_reason}</bdi></>}</p>}
            {lines(record.lines)}
            {record.note && <p dir="auto" className="mt-1 break-words text-sm">{record.note}</p>}
            {editable && !record.voided_at && <Button type="button" variant="ghost" className="mt-1 min-h-11 text-destructive-text" onClick={event => { opener.current = event.currentTarget; setVoiding({ kind: 'issue', id: record.id }) }}>{t('assets.uniform.voidRecord')}</Button>}
          </li>)}</ol>}
        </section>
        <section aria-labelledby={`${id}-returns`} className="border-t border-border p-4">
          <h3 id={`${id}-returns`} className="mb-2 text-sm font-semibold">{t('assets.uniform.received.returnHistory')}</h3>
          {records.data.returns.length === 0 ? <p className="text-sm text-muted-foreground">{t('assets.uniform.received.noReturns')}</p> : <ol className="divide-y divide-hairline">{records.data.returns.map(record => <li key={record.id} className="py-3 first:pt-0">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1"><span className="text-sm font-semibold">{t('assets.uniform.returnLabel')} · <bdi dir="ltr">{formatDmy(record.returned_on)}</bdi></span><span className="text-xs text-muted-foreground" dir="auto">{t('assets.uniform.receivedBy', { name: actor(record.received_by_name_en, record.received_by_name_ar) })}</span></div>
            {record.voided_at && <p className="mt-2 text-sm text-muted-foreground"><span className="font-semibold">{t('assets.uniform.voidStatus')}</span>{record.void_reason && <>{' · '}<bdi dir="auto">{record.void_reason}</bdi></>}</p>}
            {lines(record.lines)}
            {record.note && <p dir="auto" className="mt-1 break-words text-sm">{record.note}</p>}
            {editable && !record.voided_at && <Button type="button" variant="ghost" className="mt-1 min-h-11 text-destructive-text" onClick={event => { opener.current = event.currentTarget; setVoiding({ kind: 'return', id: record.id }) }}>{t('assets.uniform.voidRecord')}</Button>}
          </li>)}</ol>}
        </section>
      </>}
    <HandOutDialog open={dialog === 'give'} employee={employee} returnFocusRef={opener} onOpenChange={open => { if (!open) setDialog(null) }} />
    <ReturnDialog open={dialog === 'return'} employee={employee} returnFocusRef={opener} onOpenChange={open => { if (!open) setDialog(null) }} />
    {voiding !== null && <VoidDialog open kind={voiding.kind} recordId={voiding.id} returnFocusRef={opener} onVoided={() => { if (!opener.current?.isConnected) opener.current = headingRef.current }} onOpenChange={open => { if (!open) setVoiding(null) }} />}
  </section>
}
