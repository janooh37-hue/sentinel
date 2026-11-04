import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { type UniformIssueLine } from '@/lib/api'
import { useCapabilities } from '@/lib/useCapabilities'
import { HandOutDialog } from './HandOutDialog'
import { StockTab } from './stock/StockTab'
import { UniformShell } from './UniformShell'
import { useUniformItems } from './uniformQueries'

export function UniformPage(): React.JSX.Element {
  const { t } = useTranslation()
  const editable = useCapabilities().has('uniform.edit')
  const items = useUniformItems()
  const [dialog, setDialog] = useState<{ itemId?: number } | null>(null)
  const [stockChange, setStockChange] = useState<{ sizes: number[]; sequence: number }>({ sizes: [], sequence: 0 })
  const opener = useRef<HTMLElement | null>(null)
  const out = items.data?.filter(item => !item.archived_at).flatMap(item => item.sizes.filter(size => !size.archived_at && size.on_hand === 0).map(size => ({ itemId: item.id, size }))) ?? []
  const description = items.isSuccess ? out.length ? t('assets.uniform.finding', { count: out.length, pieces: t('assets.uniform.findingPieces', { count: new Set(out.map(row => row.itemId)).size }) }) : t('assets.uniform.findingNone') : undefined
  function handOut(trigger: HTMLButtonElement, itemId?: number) {
    opener.current = trigger
    setDialog({ itemId })
  }
  function issued(lines: UniformIssueLine[]) {
    setStockChange(previous => ({ sizes: lines.flatMap(line => line.size_id == null ? [] : [line.size_id]), sequence: previous.sequence + 1 }))
  }
  return <UniformShell tab="stock" description={description} actions={editable && <Button type="button" className="min-h-11" onClick={event => handOut(event.currentTarget)}>{t('assets.uniform.handOut')}</Button>}>
    <StockTab onHandOut={handOut} changedSizes={stockChange.sizes} changeSequence={stockChange.sequence} />
    {editable && dialog && <HandOutDialog open itemId={dialog.itemId} returnFocusRef={opener} onSuccess={issued} onOpenChange={open => { if (!open) setDialog(null) }} />}
  </UniformShell>
}
