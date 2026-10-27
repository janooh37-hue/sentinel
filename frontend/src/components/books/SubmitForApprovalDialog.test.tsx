/**
 * Submit stays focusable but inert, and says why, until an approver is chosen.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as ApiModule from '@/lib/api'
import { api } from '@/lib/api'
import { SubmitForApprovalDialog } from './SubmitForApprovalDialog'

vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof ApiModule>()
  return {
    ...real,
    api: {
      ...real.api,
      getBook: vi.fn().mockResolvedValue({
        id: 48,
        grade: 'unclassified',
        distribution: 'named',
        metadata_only: false,
        can_change_grade: true,
        urgency: 'Normal',
        can_write: true,
        doc_manager_user_id: null,
        doc_manager_name: null,
        doc_manager_has_signature: true,
      }),
      listApprovers: vi.fn().mockResolvedValue([{ id: 2, name: 'Manager Khalid', is_default: false }]),
      listReviewerCandidates: vi.fn().mockResolvedValue([]),
      submitBook: vi.fn().mockResolvedValue({ id: 48, ref_number: 'GS-48' }),
    },
  }
})
vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({
    capabilities: new Set<string>(),
    isLoading: false,
    has: (cap: string) => cap === 'books.submit',
  }),
}))
vi.mock('@/lib/toast', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}))

function renderDialog(): void {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <SubmitForApprovalDialog bookId={48} onClose={vi.fn()} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('SubmitForApprovalDialog — submit reason', () => {
  beforeEach(() => {
    vi.mocked(api.submitBook).mockClear()
  })

  it('explains why Submit is unavailable until an approver is chosen', async () => {
    renderDialog()

    const submit = await screen.findByRole('button', { name: 'Send for approval' })
    expect(submit).toHaveAttribute('aria-disabled', 'true')
    expect(submit).not.toBeDisabled()
    expect(screen.getByText('Choose an approver first.')).toBeVisible()
    await userEvent.click(submit)
    expect(api.submitBook).not.toHaveBeenCalled()
  })

  it('submits once an approver is chosen and the reason disappears', async () => {
    renderDialog()

    await userEvent.selectOptions(await screen.findByRole('combobox'), 'Manager Khalid')
    const submit = screen.getByRole('button', { name: 'Send for approval' })
    expect(submit).not.toHaveAttribute('aria-disabled')
    expect(screen.queryByText('Choose an approver first.')).not.toBeInTheDocument()
    await userEvent.click(submit)
    await waitFor(() => expect(api.submitBook).toHaveBeenCalledTimes(1))
  })

  it('submits the selected Very Urgent urgency', async () => {
    renderDialog()
    await userEvent.selectOptions(await screen.findByRole('combobox'), 'Manager Khalid')
    const veryUrgent = screen.getByRole('button', { name: 'Very Urgent' })
    await userEvent.click(veryUrgent)
    expect(veryUrgent).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Normal' })).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(screen.getByRole('button', { name: 'Send for approval' }))
    await waitFor(() => expect(api.submitBook).toHaveBeenCalledWith(48, expect.objectContaining({
      urgency: 'Very High',
      approver_user_id: 2,
    })))
  })
})
