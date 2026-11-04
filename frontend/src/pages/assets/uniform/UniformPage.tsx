import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { type UniformIssueLine, type UniformReturnRead } from '@/lib/api'
import { useCapabilities } from '@/lib/useCapabilities'
import { HandOutDialog } from './HandOutDialog'
import { ReturnDialog } from './returns/ReturnDialog'
import { ReturnsTab } from './returns/ReturnsTab'
import { StockTab } from './stock/StockTab'
import { UniformShell } from './UniformShell'
import { useUniformItems, useUniformReturns } from './uniformQueries'

export function UniformPage(): React.JSX.Element {
  const { t } = useTranslation()
  const editable = useCapabilities().has('uniform.edit')
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'returns' ? 'returns' : 'stock'
  const items = useUniformItems()
  const returns = useUniformReturns()
  const [dialog, setDialog] = useState<{ itemId?: number } | null>(null)
  const [returning, setReturning] = useState(false)
  const [stockChange, setStockChange] = useState<{ sizes: number[]; sequence: number }>({ sizes: [], sequence: 0 })
  const opener = useRef<HTMLElement | null>(null)
  const out = items.data?.filter(item => !item.archived_at).flatMap(item => item.sizes.filter(size => !size.archived_at && size.on_hand === 0).map(size => ({ itemId: item.id, size }))) ?? []
  const stockDescription = items.isSuccess ? out.length ? t('assets.uniform.finding', { count: out.length, pieces: t('assets.uniform.findingPieces', { count: new Set(out.map(row => row.itemId)).size }) }) : t('assets.uniform.findingNone') : undefined
  const activeReturns = returns.data?.filter(record => !record.voided_at).length ?? 0
  const returnsDescription = returns.isSuccess ? activeReturns ? t('assets.uniform.returnFinding', { count: activeReturns }) : t('assets.uniform.returnsNone') : undefined
  function handOut(trigger: HTMLButtonElement, itemId?: number) {
    opener.current = trigger
    setDialog({ itemId })
  }
  function issued(lines: UniformIssueLine[]) {
    setStockChange(previous => ({ sizes: lines.flatMap(line => line.size_id == null ? [] : [line.size_id]), sequence: previous.sequence + 1 }))
  }
  function returned(record: UniformReturnRead) {
    setParams(previous => { const next = new URLSearchParams(previous); next.set('tab', 'returns'); next.set('return', String(record.id)); return next })
  }
  const handOutButton = <Button type="button" variant={tab === 'returns' ? 'secondary' : 'default'} className="min-h-11" onClick={event => handOut(event.currentTarget)}>{t('assets.uniform.handOut')}</Button>
  const actions = editable && (tab === 'returns' ? <>{handOutButton}<Button type="button" className="min-h-11" onClick={event => { opener.current = event.currentTarget; setReturning(true) }}>{t('assets.uniform.recordReturn')}</Button></> : handOutButton)
  return <UniformShell tab={tab} tabs={['stock', 'returns']} description={tab === 'returns' ? returnsDescription : stockDescription} actions={actions}>
    {tab === 'returns' ? <ReturnsTab /> : <StockTab onHandOut={handOut} changedSizes={stockChange.sizes} changeSequence={stockChange.sequence} />}
    {editable && dialog && <HandOutDialog open itemId={dialog.itemId} returnFocusRef={opener} onSuccess={issued} onOpenChange={open => { if (!open) setDialog(null) }} />}
    <ReturnDialog open={returning} returnFocusRef={opener} onSuccess={returned} onOpenChange={setReturning} />
  </UniformShell>
}
