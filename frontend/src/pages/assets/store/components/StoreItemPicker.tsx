import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { api, type StorePickerItem } from '@/lib/api'
import { itemName, storeErrorMessage, storeKeys } from '../storeUtils'

interface Props {
  id: string
  value: number | null
  onChange: (item: StorePickerItem | null) => void
  disabled?: boolean
  invalid?: boolean
  describedBy?: string
}

export function StoreItemPicker({ id, value, onChange, disabled, invalid, describedBy }: Props): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const query = useQuery({ queryKey: storeKeys.picker, queryFn: api.listStorePickerItems, staleTime: 60_000 })
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
        <option value="">{t(query.isPending ? 'assets.store.state.loading' : 'assets.store.deliveries.selectItem')}</option>
        {query.data?.map((item) => (
          <option key={item.id} value={item.id}>{`\u2066${item.code}\u2069 — ${itemName(item, i18n.language)}`}</option>
        ))}
      </select>
      {query.error && (
        <div role="alert" className="text-sm text-accent">
          <p>{storeErrorMessage(query.error, t)}</p>
          <Button type="button" variant="secondary" className="min-h-11" onClick={() => void query.refetch()}>{t('assets.store.state.retry')}</Button>
        </div>
      )}
      {query.data?.length === 0 && <p className="text-sm text-muted-foreground">{t('assets.store.deliveries.noItems')}</p>}
    </div>
  )
}
