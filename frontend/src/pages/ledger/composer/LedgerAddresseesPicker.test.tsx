import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from 'i18next'
import { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { api, type Grade, type LedgerAddresseeIn } from '@/lib/api'
import ar from '@/locales/ar.json'
import { LedgerAddresseesPicker } from './LedgerAddresseesPicker'

function Picker({ grade, initial = [] }: { grade: Grade; initial?: LedgerAddresseeIn[] }): React.JSX.Element {
  const [value, onChange] = useState(initial)
  return <LedgerAddresseesPicker grade={grade} external={false} value={value} onChange={onChange} toId="to" />
}
function mount(grade: Grade, initial?: LedgerAddresseeIn[]): void {
  vi.spyOn(api, 'listRecipientCandidates').mockResolvedValue([
    { id: 8, name: 'Ali', name_ar: 'علي', role: 'employee', has_secret_clearance: true },
    { id: 9, name: 'Sara', name_ar: 'سارة', role: 'employee', has_secret_clearance: false },
  ])
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Picker grade={grade} initial={initial} /></QueryClientProvider>)
}
afterEach(async () => { cleanup(); vi.restoreAllMocks(); await i18n.changeLanguage('en') })

it.each([
  ['en', 'CC', 'Sara', 'Requires Secret clearance.'],
  ['ar', 'نسخة إلى', 'سارة', 'يتطلب تصريح الكتب السرية.'],
])('keeps uncleared Secret CC candidates visible but disabled with a reason in %s', async (language, cc, name, reason) => {
  i18n.addResourceBundle('ar', 'translation', ar, true, true)
  await i18n.changeLanguage(language)
  mount('secret')
  const option = await within(screen.getByLabelText(cc)).findByRole('option', { name: `${name} · ${reason}` })
  expect(option).toBeDisabled()
  expect(api.listRecipientCandidates).toHaveBeenCalledWith()
})

it.each([
  ['en', 'CC', 'Remove all CC recipients', 'Remove CC recipients before Save & Send.'],
  ['ar', 'نسخة إلى', 'إزالة جميع مستلمي النسخة', 'أزل مستلمي النسخة قبل الحفظ والإرسال.'],
])('hides CC at Addressee Only and flags existing CC for explicit removal in %s', async (language, cc, remove, warning) => {
  i18n.addResourceBundle('ar', 'translation', ar, true, true)
  await i18n.changeLanguage(language)
  mount('addressee_only', [{ role: 'to', user_id: 8 }, { role: 'cc', user_id: 9 }])
  expect(screen.queryByLabelText(cc)).not.toBeInTheDocument()
  expect(screen.getByRole('alert')).toHaveTextContent(warning)
  await userEvent.click(screen.getByRole('button', { name: remove }))
  expect(screen.queryByText(warning)).not.toBeInTheDocument()
  expect(screen.getByLabelText(language === 'ar' ? 'إلى' : 'To')).toBeInTheDocument()
})
