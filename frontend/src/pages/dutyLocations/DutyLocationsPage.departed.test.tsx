/**
 * Resigned, Terminated and Transferred staff leave the unit structure: they sit
 * in their own rail groups after Unassigned, are not counted as assigned or in
 * any unit, and cannot be selected or posted.
 *
 * Uses the real English and Arabic bundles.
 */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import i18n from 'i18next'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import ar from '@/locales/ar.json'
import { api } from '@/lib/api'
import { DutyLocationsPage } from './DutyLocationsPage'

vi.mock('@/lib/api', () => ({ api: { lookupEmployees: vi.fn() } }))
vi.mock('./AssignPopover', () => ({ AssignPopover: () => null }))
vi.mock('./SupervisorDesignations', () => ({ SupervisorDesignations: () => <div data-testid="supervisors" /> }))
vi.mock('./LeaveDigestPanel', () => ({ LeaveDigestPanel: () => <div data-testid="leave-digest" /> }))
vi.mock('./TransferDialog', () => ({ TransferDialog: () => null }))

const UNIT = 'السرية الأولى'
const ROSTER = [
  { id: 'G1', name_en: 'Working One', name_ar: null, duty_unit: UNIT, duty_post: 'Gate', status: 'Active' },
  { id: 'G2', name_en: 'Loaned Two', name_ar: null, duty_unit: UNIT, duty_post: 'Gate', status: 'Loaned' },
  { id: 'G3', name_en: 'Unplaced Three', name_ar: null, duty_unit: null, duty_post: null, status: 'Active' },
  // Not yet cleared server-side: the status alone keeps them out of the unit.
  { id: 'G4', name_en: 'Resigned Four', name_ar: null, duty_unit: UNIT, duty_post: 'Gate', status: 'Resigned' },
  { id: 'G5', name_en: 'Terminated Five', name_ar: null, duty_unit: null, duty_post: null, status: 'Terminated' },
  { id: 'G6', name_en: 'Transferred Six', name_ar: null, duty_unit: null, duty_post: null, status: 'Transferred' },
]

beforeEach(async () => {
  await i18n.addResourceBundle('ar', 'translation', ar, true, true)
  await i18n.changeLanguage('en')
  vi.mocked(api.lookupEmployees).mockResolvedValue({ items: ROSTER, total: ROSTER.length } as never)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  void i18n.changeLanguage('en')
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

function railLabels(): string[] {
  return within(screen.getByRole('navigation'))
    .getAllByRole('button')
    .map((button) => button.textContent ?? '')
}

test('departed staff get their own groups after Unassigned and leave the tallies', async () => {
  renderPage()

  await screen.findByLabelText('Select Working One')
  expect(screen.queryByLabelText('Select Resigned Four')).not.toBeInTheDocument()
  expect(railLabels().slice(-3)).toEqual(['Unassigned1', 'Ended service2', 'Transferred1'])
  expect(railLabels().find((label) => label.startsWith(UNIT))).toBe(`${UNIT}2`)
  expect(screen.getByText('Assigned: 2 / 3')).toBeInTheDocument()
  expect(screen.getByText('Unassigned: 1')).toBeInTheDocument()
})

test('a departed group is read-only and has no unit panels', async () => {
  const user = userEvent.setup()
  renderPage()

  await user.click(await screen.findByRole('button', { name: /Ended service/ }))
  expect(screen.getByText('Resigned Four')).toBeInTheDocument()
  expect(screen.getByText('Terminated Five')).toBeInTheDocument()
  expect(screen.getByText('Resigned')).toBeInTheDocument()
  expect(screen.getByText('Terminated')).toBeInTheDocument()
  expect(screen.getByText('2 employees')).toBeInTheDocument()
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Assign / edit duty location' })).not.toBeInTheDocument()
  expect(screen.queryByTestId('supervisors')).not.toBeInTheDocument()
  expect(screen.queryByTestId('leave-digest')).not.toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: /^Transferred/ }))
  expect(screen.getByText('Transferred Six')).toBeInTheDocument()
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
})

test('names the departed groups in Arabic', async () => {
  await i18n.changeLanguage('ar')
  renderPage()

  await screen.findByRole('button', { name: /منتهي الخدمة/ })
  expect(railLabels().slice(-2)).toEqual(['منتهي الخدمة2', 'منقول1'])
})
