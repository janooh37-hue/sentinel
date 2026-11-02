import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import type { StorePickerItem } from '@/lib/api'
import { storeErrorMessage, useStorePickerItems } from '../storeUtils'
import { StoreItemSummary } from './RecordParts'
import { storeDisplayName } from '../storePresentation'

interface Props {
  id: string
  value: number | null
  onChange: (item: StorePickerItem | null) => void
  disabled?: boolean
  invalid?: boolean
  describedBy?: string
  /** Empty-option copy; defaults to the delivery wording. */
  placeholder?: string
}

export function StoreItemPicker({ id, value, onChange, disabled, invalid, describedBy, placeholder }: Props): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const query = useStorePickerItems()
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <select
        id={id}
        value={value ?? ''}
        onChange={(event) => onChange(query.data?.find((item) => item.id === Number(event.target.value)) ?? null)}
        disabled={disabled || query.isPending || !!query.error}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        aria-busy={query.isPending}
        className="min-h-11 w-full min-w-0 rounded-md border border-border bg-surface px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
      >
        <option value="">{query.isPending ? t('assets.store.state.loading') : placeholder ?? t('assets.store.deliveries.selectItem')}</option>
        {query.data?.map((item) => (
          <option key={item.id} value={item.id}>{`\u2066${item.code}\u2069 — ${storeDisplayName(item, i18n.language)}`}</option>
        ))}
      </select>
      <div role="group" aria-label={placeholder ?? t('assets.store.deliveries.selectItem')} className="grid max-h-64 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
        {query.data?.map(item => <button key={item.id} type="button" disabled={disabled || query.isPending || !!query.error} aria-pressed={value === item.id} onClick={() => onChange(item)} className="rounded-2xl border border-border p-2 text-start hover:bg-surface-tinted aria-pressed:border-primary aria-pressed:bg-surface-tinted disabled:opacity-60">
          <StoreItemSummary item={item} size={52} showCode />
        </button>)}
      </div>
      {query.error && (
        <div role="alert" className="text-sm text-accent">
          <p>{storeErrorMessage(query.error)}</p>
          <Button type="button" variant="secondary" className="min-h-11" onClick={() => void query.refetch()}>{t('assets.store.state.retry')}</Button>
        </div>
      )}
      {query.data?.length === 0 && <p className="text-sm text-muted-foreground">{t('assets.store.deliveries.noItems')}</p>}
    </div>
  )
}
