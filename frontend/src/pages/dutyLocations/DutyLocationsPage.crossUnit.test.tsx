/**
 * The selection is a transfer basket, not a per-unit filter: it must survive
 * walking the unit rail, and the tray must let the operator review and drop
 * people who are no longer on screen.
 *
 * Uses the real English bundle (like DutyLocationsPage.completion.test.tsx), so
 * every row's accessible name is unique — no index juggling.
 */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'
import { DutyLocationsPage } from './DutyLocationsPage'

vi.mock('@/lib/api', () => ({ api: { listEmployees: vi.fn() } }))
vi.mock('./AssignPopover', () => ({ AssignPopover: () => null }))
vi.mock('./SupervisorDesignations', () => ({ SupervisorDesignations: () => null }))
vi.mock('./LeaveDigestPanel', () => ({ LeaveDigestPanel: () => null }))
vi.mock('./TransferDialog', () => ({ TransferDialog: () => null }))

const ROSTER = [
  { id: 'G3309', name_en: 'Mohammed Saeed', name_ar: null, duty_unit: 'السرية الأولى', duty_post: 'البوابة الرئيسية' },
  { id: 'G3318', name_en: 'Omar Abdulrahman', name_ar: null, duty_unit: 'السرية الأولى', duty_post: 'برج المراقبة' },
  { id: 'G4030', name_en: 'Saif Mubarak', name_ar: null, duty_unit: 'السرية الثانية', duty_post: 'التفتيش' },
]

beforeEach(() => {
  vi.mocked(api.listEmployees).mockResolvedValue({ items: ROSTER, total: ROSTER.length } as never)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderPage(): void {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/duty-locations']}>
        <DutyLocationsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

test('selection survives switching units and the tray drops an off-screen pick', async () => {
  const user = userEvent.setup()
  renderPage()

  // Two picks in السرية الأولى (the first populated unit, shown by default).
  await user.click(await screen.findByLabelText('Select Mohammed Saeed'))
  await user.click(screen.getByLabelText('Select Omar Abdulrahman'))
  expect(screen.getByRole('button', { name: /2 selected/ })).toBeInTheDocument()

  // Walk the rail — the basket must NOT be cleared.
  await user.click(screen.getByRole('button', { name: /السرية الثانية/ }))
  await screen.findByLabelText('Select Saif Mubarak')
  expect(screen.getByRole('button', { name: /2 selected/ })).toBeInTheDocument()

  // Add one from this unit: 3 people across 2 units.
  await user.click(screen.getByLabelText('Select Saif Mubarak'))
  const counter = screen.getByRole('button', { name: /3 selected/ })
  expect(counter).toHaveAccessibleName(/2 units/)

  // Review the whole basket, grouped by current unit.
  await user.click(counter)
  const panel = screen.getByTestId('duty-selection-panel')
  expect(within(panel).getByText('G3309')).toBeInTheDocument()
  expect(within(panel).getByText('G4030')).toBeInTheDocument()
  expect(within(panel).getByText('السرية الأولى')).toBeInTheDocument()
  expect(within(panel).getByText('السرية الثانية')).toBeInTheDocument()

  // Drop someone from the unit we are NOT standing in.
  await user.click(
    within(panel).getByRole('button', { name: 'Remove Mohammed Saeed from the selection' }),
  )
  await waitFor(() =>
    expect(within(screen.getByTestId('duty-selection-panel')).queryByText('G3309')).toBeNull(),
  )
  expect(screen.getByRole('button', { name: /2 selected/ })).toBeInTheDocument()
})
