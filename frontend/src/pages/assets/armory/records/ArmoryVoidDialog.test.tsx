import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as transport from '@/lib/api'
import type { ArmoryPostingRead } from '@/lib/api'
import { ARMORY_EDIT_CAP, ARMORY_VIEW_CAP } from '@/lib/armory'
import { AuthContext } from '@/lib/authContext'
import i18n from '@/lib/i18n'
import { AuditMovements } from './AuditMovements'
import { movementAuth, movementFixture, movementInstant, movementWitness, voidWitness } from './movementFixtures'

const { api, ApiError } = transport
vi.mock('@/lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof transport>()
  return {
    ...original,
    api: {
      ...original.api, listArmoryMovements: vi.fn(), getArmoryMovement: vi.fn(),
      voidArmoryMovement: vi.fn(), listArmoryPeople: vi.fn(),
    },
  }
})
vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({ has: (cap: string) => cap === ARMORY_VIEW_CAP || cap === ARMORY_EDIT_CAP }),
}))

async function openVoid() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <AuthContext.Provider value={movementAuth}>
          <MemoryRouter initialEntries={['/holdings/armory?tab=audit&pane=movements&movement=31']}>
            <AuditMovements safeId={null} />
          </MemoryRouter>
        </AuthContext.Provider>
      </I18nextProvider>
    </QueryClientProvider>,
  )
  fireEvent.click(await screen.findByRole('button', { name: 'Void' }))
  return within(screen.getByRole('dialog', { name: 'Void movement' }))
}

function voidedFixture(overrides: Partial<ArmoryPostingRead> = {}) {
  return movementFixture({
    voided_at: movementInstant,
    voided_by: { user_id: 3, employee: null, display_name: 'Test Recorder Two' },
    void_reason: 'Test reason',
    ...overrides,
  })
}

beforeEach(async () => {
  vi.resetAllMocks()
  await i18n.changeLanguage('en')
  vi.mocked(api.listArmoryMovements).mockResolvedValue({ items: [], page: 1, page_size: 50, total: 0 })
  vi.mocked(api.getArmoryMovement).mockResolvedValue(movementFixture())
  vi.mocked(api.listArmoryPeople).mockResolvedValue([{
    person: voidWitness, on_duty_here: true, course_round: null, licence_status: 'missing',
    licence_expires_on: null, open_firearm: null,
  }])
})

describe('Void movement', () => {
  it('requires a valid reason and a fresh witness for a witnessed posting; records the explicit confirmation', async () => {
    vi.mocked(api.getArmoryMovement).mockResolvedValue(movementFixture({ witness: movementWitness }))
    const reversed = voidedFixture({ witness: movementWitness, void_witness: voidWitness })
    vi.mocked(api.voidArmoryMovement).mockImplementation(async () => {
      vi.mocked(api.getArmoryMovement).mockResolvedValue(reversed)
      return reversed
    })
    const dialog = await openVoid()
    expect(dialog.getByText(/reverses this record’s live effect and keeps the original in the audit history/)).toBeVisible()
    const reason = dialog.getByLabelText('Reason')
    const confirm = dialog.getByRole('button', { name: 'Confirm void' })
    fireEvent.change(reason, { target: { value: ' ab ' } })
    fireEvent.click(confirm)
    expect(reason).toBeInvalid()
    expect(reason).toHaveFocus()
    expect(api.voidArmoryMovement).not.toHaveBeenCalled()

    fireEvent.change(reason, { target: { value: ' Test reason ' } })
    fireEvent.click(confirm)
    expect(dialog.getByText('Choose a new witness to void this movement.')).toBeVisible()
    expect(api.voidArmoryMovement).not.toHaveBeenCalled()

    fireEvent.change(dialog.getByLabelText('New witness (required)'), { target: { value: 'Test Witness Two' } })
    await waitFor(() => expect(api.listArmoryPeople).toHaveBeenCalledWith({ purpose: 'witness', safe_id: 6, q: 'Test Witness Two' }))
    fireEvent.click(await dialog.findByText('Test Witness Two'))
    fireEvent.click(confirm)
    expect(await screen.findByText('Movement voided.')).toBeVisible()
    expect(api.voidArmoryMovement).toHaveBeenCalledExactlyOnceWith(31, { reason: 'Test reason', witness_employee_id: 'T-0002' })
    expect(screen.queryByRole('button', { name: 'Void' })).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Void details' })).toHaveTextContent('Test Witness Two')
  })

  it('displays the dependency conflict with its blocker link without retrying', async () => {
    vi.mocked(api.voidArmoryMovement).mockRejectedValue(new ApiError(409, 'armory_void_dependency', 'Raw test message', { posting_id: 31, blocking_posting_id: 32 }))
    const dialog = await openVoid()
    fireEvent.change(dialog.getByLabelText('Reason'), { target: { value: 'Test reason' } })
    fireEvent.click(dialog.getByRole('button', { name: 'Confirm void' }))
    const alert = await dialog.findByRole('alert')
    expect(alert).toHaveTextContent('This movement cannot be voided while another record or a current balance depends on it.')
    expect(alert).not.toHaveTextContent('Raw test message')
    const blocker = within(alert).getByRole('link', { name: 'View blocking movement' })
    expect(blocker).toHaveAttribute('href', '/holdings/armory?tab=audit&pane=movements&movement=32')
    expect(api.voidArmoryMovement).toHaveBeenCalledExactlyOnceWith(31, { reason: 'Test reason', witness_employee_id: null })

    vi.mocked(api.getArmoryMovement).mockResolvedValue(movementFixture({ id: 32, record_ref: 'TEST-MOV-032' }))
    fireEvent.click(blocker)
    expect(await screen.findByRole('heading', { name: 'TEST-MOV-032' })).toBeVisible()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(api.voidArmoryMovement).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['armory_already_voided', 'This record is already voided.'],
    ['armory_write_conflict', 'Another change was saved at the same time. Review the current data.'],
  ])('shows %s and refreshes the posting without resubmitting', async (code, message) => {
    vi.mocked(api.voidArmoryMovement).mockImplementation(async () => {
      if (code === 'armory_already_voided') vi.mocked(api.getArmoryMovement).mockResolvedValue(voidedFixture())
      throw new ApiError(409, code, 'Raw test message')
    })
    const dialog = await openVoid()
    fireEvent.change(dialog.getByLabelText('Reason'), { target: { value: 'Test reason' } })
    fireEvent.click(dialog.getByRole('button', { name: 'Confirm void' }))
    expect(await dialog.findByRole('alert')).toHaveTextContent(message)
    await waitFor(() => expect(api.getArmoryMovement).toHaveBeenCalledTimes(2))
    expect(dialog.getByLabelText('Reason')).toHaveValue('Test reason')
    expect(api.voidArmoryMovement).toHaveBeenCalledTimes(1)
  })
})
