import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
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
