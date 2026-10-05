import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, describe, expect, it, vi } from 'vitest'
import i18n from 'i18next'
import ar from '@/locales/ar.json'
import { EmployeeSearchHero } from './EmployeeSearchHero'

vi.mock('@/lib/api', async (orig) => ({
  ...(await orig()),
  api: {
    listEmployees: vi.fn().mockResolvedValue({
      items: [
        { id: 'G3190', name_en: 'ABDULLA ALABRI', name_ar: 'عبدالله العبرى', status: 'Active', position: 'Guard', has_photo: false },
      ],
      total: 1,
    }),
  },
}))

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

describe('EmployeeSearchHero', () => {
  it('searches on typing and fires onSelect with the employee id', async () => {
    const onSelect = vi.fn()
    wrap(<EmployeeSearchHero onSelect={onSelect} onCreate={() => {}} onLeaveIds={new Set()} />)
    await userEvent.type(screen.getByRole('searchbox'), 'عبد')
    await waitFor(() => expect(screen.getByText(/G3190/)).toBeInTheDocument())
    await userEvent.click(screen.getByText(/G3190/))
    expect(onSelect).toHaveBeenCalledWith('G3190')
  })

  it('offers create from the empty state', async () => {
    const { api } = await import('@/lib/api')
    vi.mocked(api.listEmployees).mockResolvedValueOnce({ items: [], total: 0 } as never)
    const onCreate = vi.fn()
    wrap(<EmployeeSearchHero onSelect={() => {}} onCreate={onCreate} onLeaveIds={new Set()} />)
    await userEvent.type(screen.getByRole('searchbox'), 'zzz')
    await userEvent.click(await screen.findByRole('button', { name: /إنشاء ملف موظف جديد|Create a new employee file/ }))
    expect(onCreate).toHaveBeenCalled()
  })
})

describe('EmployeeSearchHero transferred pill', () => {
  const transferred = {
    items: [
      {
        id: 'G3191',
        name_en: 'SALEM',
        name_ar: 'سالم',
        status: 'Transferred',
        end_date: '2026-08-15',
        transfer_site: 'Dubai',
        transfer_return_date: '2026-11-15',
        position: 'Guard',
        has_photo: false,
      },
    ],
    total: 1,
  }

  afterAll(async () => {
    await i18n.changeLanguage('en')
  })

  it('shows status, site and dates in English', async () => {
    const { api } = await import('@/lib/api')
    vi.mocked(api.listEmployees).mockResolvedValueOnce(transferred as never)
    wrap(<EmployeeSearchHero onSelect={() => {}} onCreate={() => {}} onLeaveIds={new Set()} />)
    await userEvent.type(screen.getByRole('searchbox'), 'sal')
    const pill = await screen.findByText(/Transferred/)
    expect(pill.textContent).toContain('Transferred')
    expect(pill.textContent).toContain('Dubai')
    expect(pill.textContent).toContain('15/08/2026')
    expect(pill.textContent).toContain('15/11/2026')
  })

  it('shows Arabic wording with no English status leak in Arabic', async () => {
    i18n.addResourceBundle('ar', 'translation', ar, true, true)
    await i18n.changeLanguage('ar')
    const { api } = await import('@/lib/api')
    vi.mocked(api.listEmployees).mockResolvedValueOnce(transferred as never)
    wrap(<EmployeeSearchHero onSelect={() => {}} onCreate={() => {}} onLeaveIds={new Set()} />)
    await userEvent.type(screen.getByRole('searchbox'), 'سالم')
    const pill = await screen.findByText(/منقول/)
    expect(pill.textContent).toContain('Dubai')
    expect(pill.textContent).toContain('15/08/2026')
    expect(pill.textContent).toContain('15/11/2026')
    expect(pill.textContent).not.toContain('Transferred')
  })
})
