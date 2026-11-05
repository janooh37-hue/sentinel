import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'

import { type UniformHolder } from '@/lib/api'
import { pickEmployeeName } from '@/lib/employeeName'
import { useCapabilities } from '@/lib/useCapabilities'

export function HolderChips({ holders, onGive }: { holders: UniformHolder[]; onGive: (opener: HTMLButtonElement) => void }): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const editable = useCapabilities().has('uniform.edit')
  return <div>
    {holders.length === 0 && <p className="mb-2 text-sm text-muted-foreground">{t('assets.uniform.noHolders')}</p>}
    <ul aria-label={t('assets.uniform.holdersList')} className="flex flex-wrap gap-2">
      {holders.map(holder => <li key={holder.employee_id}><span className="inline-flex min-h-11 items-center gap-1 rounded-md border border-border bg-surface-raised px-2 text-sm">
        <span className="sr-only">{`${pickEmployeeName(holder, i18n.language)} · ${holder.employee_id} · ${t('assets.uniform.suitsN', { count: holder.qty })}`}</span>
        <bdi dir="ltr" aria-hidden>{holder.employee_id}</bdi>{holder.qty > 1 && <bdi dir="ltr" aria-hidden className="tabular-nums">×{holder.qty}</bdi>}
      </span></li>)}
      {editable && <li><button type="button" className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-border hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={t('assets.uniform.addHolder')} onClick={event => onGive(event.currentTarget)}><Plus aria-hidden className="h-4 w-4" /></button></li>}
    </ul>
  </div>
}
