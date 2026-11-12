import { useId } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { api, apiErrorMessage, type Grade, type LedgerAddresseeIn } from '@/lib/api'
import { pickEmployeeName } from '@/lib/employeeName'

export function LedgerAddresseesPicker({ external, grade, value, onChange, toId, error }: {
  external: boolean
  grade: Grade
  value: LedgerAddresseeIn[]
  onChange: (value: LedgerAddresseeIn[]) => void
  toId: string
  error?: string
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const ccId = useId()
  // Asking without a grade retains uncleared users so Secret can explain why
  // they are unavailable, rather than silently removing them from the directory.
  const users = useQuery({ queryKey: ['books', 'recipient-candidates'], queryFn: () => api.listRecipientCandidates(), enabled: !external, staleTime: 300_000 })
  const contacts = useQuery({ queryKey: ['ledger', 'contacts'], queryFn: () => api.listLedgerContacts(), enabled: external, staleTime: 300_000 })
  const options = external
    ? (contacts.data ?? []).map((c) => ({ id: c.id, name: c.display_name || c.address, detail: c.address, cleared: true }))
    : (users.data ?? []).map((u) => ({ id: u.id, name: pickEmployeeName({ name_en: u.name, name_ar: u.name_ar }, i18n.language), detail: u.g_number, cleared: u.has_secret_clearance }))
  const query = external ? contacts : users
  const idOf = (a: LedgerAddresseeIn): number | null | undefined => external ? a.contact_id : a.user_id
  return <div className="grid gap-3 sm:grid-cols-2">
    {(grade === 'addressee_only' ? ['to'] as const : ['to', 'cc'] as const).map((role) => {
      const id = role === 'to' ? toId : ccId
      const label = t(`ledgerBook.composer.fields.${role}`)
      return <div key={role} className="flex min-w-0 flex-col gap-1">
        <label htmlFor={id} className="text-[0.78em] font-semibold text-muted-foreground">{label}</label>
        <select id={id} value="" aria-busy={query.isPending}
          aria-invalid={role === 'to' && Boolean(error)} aria-describedby={role === 'to' && error ? `${toId}-error` : undefined}
          className="min-h-10 w-full rounded-lg border border-hairline bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[invalid=true]:border-destructive"
          onChange={(e) => {
            if (!e.target.value) return
            const recipient = external ? { role, contact_id: Number(e.target.value) } : { role, user_id: Number(e.target.value) }
            onChange([...value, recipient])
          }}>
          <option value="">{t('ledgerBook.composer.fields.addRecipient')}</option>
          {options.filter((o) => !value.some((a) => a.role === role && idOf(a) === o.id)).map((o) => <option key={o.id} value={o.id} disabled={value.length >= 50 || (grade === 'secret' && !o.cleared)}>{o.name}{o.detail ? ` · ${o.detail}` : ''}{grade === 'secret' && !o.cleared ? ` · ${t('ledgerBook.composer.ccRules.secretReason')}` : ''}</option>)}
        </select>
        <ol aria-label={t('ledgerBook.composer.fields.selected', { role: label })} className="flex flex-wrap gap-1.5">
          {value.map((a, index) => a.role !== role ? null : <li key={`${role}-${idOf(a)}`} className="inline-flex max-w-full flex-wrap items-center gap-1 rounded-full bg-surface-tinted px-2 py-1 text-sm">
            <bdi className="truncate">{options.find((o) => o.id === idOf(a))?.name ?? `#${idOf(a)}`}</bdi>
            {grade === 'secret' && options.find((o) => o.id === idOf(a))?.cleared === false && <span className="text-xs text-destructive">{t('ledgerBook.composer.ccRules.secretReason')}</span>}
            <button type="button" className="inline-flex size-10 shrink-0 items-center justify-center rounded-full hover:bg-surface focus-visible:ring-2 focus-visible:ring-ring" aria-label={t('ledgerBook.composer.fields.removeRecipient', { name: options.find((o) => o.id === idOf(a))?.name ?? `#${idOf(a)}`, role: label })} onClick={() => onChange(value.filter((_, i) => i !== index))}><X aria-hidden="true" className="size-3.5" /></button>
          </li>)}
        </ol>
        {role === 'to' && error && <p id={`${toId}-error`} role="alert" className="text-sm text-destructive">{error}</p>}
      </div>
    })}
    {grade === 'addressee_only' && value.some((a) => a.role === 'cc') && <div className="sm:col-span-2">
      <p role="alert" className="text-sm text-destructive">{t('ledgerBook.composer.ccRules.removeBeforeSend')}</p>
      <button type="button" className="min-h-11 rounded-md px-3 text-sm font-medium text-destructive focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onChange(value.filter((a) => a.role !== 'cc'))}>{t('ledgerBook.composer.ccRules.removeAll')}</button>
    </div>}
    {query.isError && <p role="alert" className="text-sm text-destructive sm:col-span-2">{apiErrorMessage(query.error)}</p>}
  </div>
}
