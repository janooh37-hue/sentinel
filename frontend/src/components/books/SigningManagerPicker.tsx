import { useId } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { api, apiErrorMessage } from '@/lib/api'
import { pickEmployeeName } from '@/lib/employeeName'

export function SigningManagerPicker({ value, onChange, id, error }: {
  value: number | null
  onChange: (id: number | null) => void
  id?: string
  error?: string
}): React.JSX.Element {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const { t, i18n } = useTranslation()
  const query = useQuery({ queryKey: ['managers'], queryFn: () => api.listManagers(), staleTime: 300_000 })
  return <div className="flex min-w-0 flex-col gap-1">
    <label htmlFor={inputId} className="text-[0.78em] font-semibold text-muted-foreground">{t('ledgerBook.composer.fields.signer')}</label>
    <select id={inputId} value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)} aria-busy={query.isPending}
      aria-invalid={Boolean(error)} aria-describedby={error ? `${inputId}-error` : undefined}
      className="min-h-10 w-full rounded-lg border border-hairline bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[invalid=true]:border-destructive">
      <option value="">{t('ledgerBook.composer.fields.signerPlaceholder')}</option>
      {(query.data ?? []).filter((m) => m.active && m.user_id != null).map((m) => <option key={m.id} value={m.id}>{pickEmployeeName({ name_en: m.name_en ?? '', name_ar: m.name_ar }, i18n.language)}{m.title ? ` · ${m.title}` : ''}</option>)}
    </select>
    {error && <p id={`${inputId}-error`} role="alert" className="text-sm text-destructive">{error}</p>}
    {query.isError && <p role="alert" className="text-sm text-destructive">{apiErrorMessage(query.error)}</p>}
  </div>
}
