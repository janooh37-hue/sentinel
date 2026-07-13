/**
 * SupervisorDesignations component tests — list, add, and remove flows.
 *
 * Covers:
 *  - List: renders the unit's configured designations
 *  - Empty: shows the empty string when none exist
 *  - Add flow: filling in a designation and clicking Add → addDutySupervisor called
 *  - Remove flow: clicking Remove → deleteDutySupervisor called
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'ar' } }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/api', () => ({
  api: {
    listDutySupervisors: vi.fn(),
    addDutySupervisor: vi.fn(),
    deleteDutySupervisor: vi.fn(),
  },
  apiErrorMessage: (e: unknown) => String(e),
}))

import { api } from '@/lib/api'
import { SupervisorDesignations } from './SupervisorDesignations'

const DESIGNATION_ROW = {
  id: 1,
  duty_unit: 'السرية الأولى',
  recipient_duty_post: 'مسؤول سرية',
  created_at: '2026-07-13T00:00:00',
}

function renderSection(): void {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <SupervisorDesignations unit="السرية الأولى" posts={['مسؤول سرية', 'جندي']} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(api.listDutySupervisors).mockResolvedValue([DESIGNATION_ROW])
})

describe('SupervisorDesignations', () => {
  it('lists the unit\'s configured designations', async () => {
    renderSection()
    expect(await screen.findByText('مسؤول سرية')).toBeInTheDocument()
  })

  it('shows the empty state when no designations exist', async () => {
    vi.mocked(api.listDutySupervisors).mockResolvedValue([])
    renderSection()
    expect(await screen.findByText('dutySupervisors.empty')).toBeInTheDocument()
  })

  it('calls addDutySupervisor with unit + post when Add is clicked', async () => {
    vi.mocked(api.addDutySupervisor).mockResolvedValue({
      id: 2,
      duty_unit: 'السرية الأولى',
      recipient_duty_post: 'جندي',
      created_at: '2026-07-13T00:00:00',
    })

    renderSection()

    // Wait for list to load
    await screen.findByText('مسؤول سرية')

    // Fill in the designation input
    const input = screen.getByPlaceholderText('dutySupervisors.designation')
    fireEvent.change(input, { target: { value: 'جندي' } })

    // Click Add
    fireEvent.click(screen.getByText('dutySupervisors.add'))

    await waitFor(() =>
      expect(api.addDutySupervisor).toHaveBeenCalledWith(
        expect.objectContaining({ duty_unit: 'السرية الأولى', recipient_duty_post: 'جندي' }),
      ),
    )

    // After success the component clears the input (setDesignation(''))
    await waitFor(() => expect(input).toHaveValue(''))
  })

  it('calls deleteDutySupervisor when Remove is clicked', async () => {
    // First render shows the row; after deletion the refetch returns empty list
    vi.mocked(api.listDutySupervisors)
      .mockResolvedValueOnce([DESIGNATION_ROW])
      .mockResolvedValue([])
    vi.mocked(api.deleteDutySupervisor).mockResolvedValue(undefined)

    renderSection()

    fireEvent.click(await screen.findByText('dutySupervisors.remove'))

    await waitFor(() =>
      expect(api.deleteDutySupervisor).toHaveBeenCalledWith(1),
    )

    // After invalidation/refetch the empty-state text must appear
    await waitFor(() =>
      expect(screen.getByText('dutySupervisors.empty')).toBeInTheDocument(),
    )
  })
})
