import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { LeaveListItem } from '@/lib/api'
import i18n from '@/lib/i18n'
import { RecordExpansion } from './RecordExpansion'

vi.mock('./BalanceMeters', () => ({ BalanceMeters: () => null }))
vi.mock('@/components/notify/SendButton', () => ({ SendButton: () => null }))

const row: LeaveListItem = {
  id: 1,
  employee_id: 'G100',
  employee_name_en: 'Leave subject',
  employee_name_ar: 'الموظف',
  leave_type: 'Annual Leave',
  start_date: '2026-11-20',
  end_date: '2026-11-29',
  days: 10,
  status: 'Approved',
  has_certificate: false,
  created_at: '2026-10-19T10:00:00',
  submitted_by_g: 'G200',
}

function renderExpansion(submittedBy: string | null = 'G200') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <RecordExpansion row={{ ...row, submitted_by_g: submittedBy }} today="2026-11-02" onMutated={() => {}} />
    </QueryClientProvider>,
  )
}

afterEach(async () => { await i18n.changeLanguage('en') })

describe('submission date provenance', () => {
  it.each([
    ['en', 'Filed', 'Submitted by'],
    ['ar', 'تاريخ التقديم', 'مقدَّم من'],
  ])('keeps the filer next to the date in %s', async (language, filed, submittedBy) => {
    await i18n.changeLanguage(language)
    renderExpansion()
    const dateArea = screen.getByText(filed).parentElement!
    expect(within(dateArea).getByText(submittedBy)).toBeVisible()
    const gNumber = within(dateArea).getByText('G200')
    expect(gNumber.tagName).toBe('BDI')
    expect(gNumber).toHaveAttribute('dir', 'ltr')
    expect(within(dateArea).getByText(/2026/)).toBeVisible()
    expect(within(dateArea).queryByText('G100')).not.toBeInTheDocument()
  })

  it.each(['en', 'ar'])('omits unknown provenance without inventing a filer in %s', async (language) => {
    await i18n.changeLanguage(language)
    renderExpansion(null)
    expect(screen.queryByText('G100')).not.toBeInTheDocument()
    expect(screen.queryByText('G200')).not.toBeInTheDocument()
    expect(screen.queryByText(i18n.t('leaves.report.submittedBy'))).not.toBeInTheDocument()
    expect(screen.getByText(/2026/)).toBeVisible()
  })
})
