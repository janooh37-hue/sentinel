import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { AmendLeaveDialog } from './AmendLeaveDialog'

vi.mock('@/lib/api', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...mod,
    api: { ...mod.api, amendLeave: vi.fn().mockResolvedValue({}) },
  }
})

const leave = {
  id: 5,
  employee_id: 'G1',
  leave_type: 'Annual Leave',
  start_date: '2026-08-01',
  end_date: '2026-08-25',
  days: 25,
  status: 'Approved',
} as never

function renderIt() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <AmendLeaveDialog open leave={leave} onOpenChange={() => {}} onAmended={() => {}} />
    </QueryClientProvider>,
  )
}

describe('AmendLeaveDialog', () => {
  it('disables save until a reason is given, then submits end_date + reason', async () => {
    renderIt()
    const save = screen.getByRole('button', { name: /save|حفظ/i })
    expect(save).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/reason|سبب/i), { target: { value: 'balance' } })
    expect(save).not.toBeDisabled()
    fireEvent.click(save)
    await waitFor(() =>
      expect(api.amendLeave).toHaveBeenCalledWith(5, {
        end_date: '2026-08-25',
        reason: 'balance',
      }),
    )
  })
})
