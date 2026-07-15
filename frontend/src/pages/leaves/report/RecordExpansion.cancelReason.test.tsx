/**
 * RecordExpansion — cancel-requires-a-reason gate.
 *
 * Rendering setup mirrors SendToGroupPage.test.tsx:
 *   QueryClientProvider wraps the component; i18n is initialised globally in
 *   src/test/setup.ts (real English translations, no per-file mock needed).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { RecordExpansion } from './RecordExpansion'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

vi.mock('@/lib/api', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...mod,
    api: {
      ...mod.api,
      getLeave: vi.fn(),
      getLeaveBalance: vi.fn().mockResolvedValue({}),
      updateLeave: vi.fn().mockResolvedValue({}),
    },
  }
})

// SendButton uses useCapabilities → useAuth which needs a full auth context.
// Stub it out — this test is only about the cancel-reason gate.
vi.mock('@/components/notify/SendButton', () => ({
  SendButton: () => null,
}))

const row = {
  id: 1,
  employee_id: 'G1',
  leave_type: 'Annual Leave',
  start_date: '2026-08-01',
  end_date: '2026-08-25',
  days: 25,
  status: 'Approved',
  created_at: '2026-07-01T00:00:00',
} as never

function renderIt() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <RecordExpansion row={row} today="2026-07-15" onMutated={() => {}} />
    </QueryClientProvider>,
  )
}

describe('cancel requires a reason', () => {
  it('disables Cancel until notes are typed', () => {
    renderIt()
    // "Cancel leave" is the only button matching /cancel/i at this point
    // (the delete-confirm Cancel is inside a conditional branch that starts hidden).
    const cancelBtn = screen.getByRole('button', { name: /cancel/i })
    expect(cancelBtn).toBeDisabled()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'shortage' } })
    expect(cancelBtn).not.toBeDisabled()
  })
})
