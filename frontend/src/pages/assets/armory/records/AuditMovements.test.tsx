import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as transport from '@/lib/api'
import { ARMORY_EDIT_CAP, ARMORY_VIEW_CAP } from '@/lib/armory'
import { AuthContext } from '@/lib/authContext'
import i18n from '@/lib/i18n'
import { AuditMovements } from './AuditMovements'
import { movementAuth, movementFixture, movementInstant, movementLineFixture, movementSafe, voidWitness } from './movementFixtures'

const { api } = transport
const caps = vi.hoisted(() => new Set<string>())
vi.mock('@/lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof transport>()
  return {
    ...original,
    api: { ...original.api, listArmoryMovements: vi.fn(), getArmoryMovement: vi.fn(), voidArmoryMovement: vi.fn() },
  }
})
vi.mock('@/lib/useCapabilities', () => ({ useCapabilities: () => ({ has: (cap: string) => caps.has(cap) }) }))

function LocationProbe() {
  const { search } = useLocation()
  return <output data-testid="movement-url">{search}</output>
}

function renderMovements(params: string, safeId: number | null = 6) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <AuthContext.Provider value={movementAuth}>
          <MemoryRouter initialEntries={[`/holdings/armory?tab=audit&pane=movements&${params}`]}>
            <AuditMovements safeId={safeId} />
            <LocationProbe />
          </MemoryRouter>
        </AuthContext.Provider>
      </I18nextProvider>
    </QueryClientProvider>,
  )
}

beforeEach(async () => {
  vi.resetAllMocks()
  await i18n.changeLanguage('en')
  caps.clear()
  caps.add(ARMORY_VIEW_CAP)
  vi.mocked(api.listArmoryMovements).mockResolvedValue({ items: [], page: 1, page_size: 50, total: 0 })
  vi.mocked(api.getArmoryMovement).mockResolvedValue(movementFixture())
})

describe('Audit movement records', () => {
  it('sends URL filters and resets paging when a filter changes', async () => {
    renderMovements('kind=serial_state&from=2026-02-01&to=2026-02-28&serial=TEST&q=Test+Guard&employee_id=T-0003&item=28&page=2')
    await screen.findByText('No movements match these filters.')
    expect(api.listArmoryMovements).toHaveBeenLastCalledWith({
      safe_id: 6, kind: 'serial_state', from: '2026-02-01', to: '2026-02-28', serial: 'TEST',
      q: 'Test Guard', employee_id: 'T-0003', item_id: 28, page: 2,
    })

    fireEvent.change(screen.getByLabelText('Serial number'), { target: { value: 'TEST-NEXT' } })
    await waitFor(() => expect(api.listArmoryMovements).toHaveBeenLastCalledWith(expect.objectContaining({ serial: 'TEST-NEXT', page: 1 })))
    expect(screen.getByTestId('movement-url')).toHaveTextContent('serial=TEST-NEXT')
    expect(screen.getByTestId('movement-url')).not.toHaveTextContent('page=')
    expect(screen.getByTestId('movement-url')).toHaveTextContent('pane=movements')
  })

  it('does not fetch results for a reversed date range and resumes on correction', async () => {
    renderMovements('from=2026-02-14&to=2026-02-13')
    expect(screen.getByRole('alert')).toHaveTextContent('The end date must be on or after the start date.')
    expect(screen.getByLabelText('To date')).toHaveAccessibleDescription('The end date must be on or after the start date.')
    expect(api.listArmoryMovements).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('To date'), { target: { value: '2026-02-14' } })
    await screen.findByText('No movements match these filters.')
    expect(api.listArmoryMovements).toHaveBeenCalledWith(expect.objectContaining({ from: '2026-02-14', to: '2026-02-14' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('pages in server order and restores a row’s focus after closing the detail', async () => {
    const first = movementFixture({ id: 32, record_ref: 'TEST-MOV-032' })
    const second = movementFixture({ id: 33, record_ref: 'TEST-MOV-033', occurred_on: '2026-02-12' })
    vi.mocked(api.listArmoryMovements).mockImplementation(async (filters) => filters?.page === 2
      ? { items: [movementFixture()], page: 2, page_size: 2, total: 3 }
      : { items: [first, second], page: 1, page_size: 2, total: 3 })
    renderMovements('')
    const list = within(screen.getByRole('region', { name: 'Movements' }))
    await list.findByRole('link', { name: /TEST-MOV-032/ })
    expect(list.getByRole('status')).toHaveTextContent('3 movements')
    expect(list.getAllByRole('link').map((link) => link.querySelector('bdi')?.textContent)).toEqual(['TEST-MOV-032', 'TEST-MOV-033'])
    expect(list.getByRole('link', { name: /TEST-MOV-032/ })).toHaveTextContent('13/02/2026 18:05')

    fireEvent.click(list.getByRole('button', { name: 'Next page' }))
    const row = await list.findByRole('link', { name: /TEST-MOV-031/ })
    fireEvent.click(row)
    await screen.findByRole('heading', { name: 'TEST-MOV-031' })
    expect(screen.getByRole('heading', { name: 'Movement detail' })).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: 'Back to the list' }))
    await waitFor(() => expect(row).toHaveFocus())
    expect(screen.getByTestId('movement-url')).toHaveTextContent('page=2')
    expect(screen.getByTestId('movement-url')).not.toHaveTextContent('movement=31')
  })

  it('shows filtered-out voided history and links from the independent detail', async () => {
    caps.add(ARMORY_EDIT_CAP)
    vi.mocked(api.getArmoryMovement).mockResolvedValue(movementFixture({
      kind: 'serial_state', serial_action: 'transfer', lines: [movementLineFixture()],
      destination_safe: { ...movementSafe, id: 7, name_en: 'Test Safe Two' },
      related_posting_id: 29, discrepancy_ids: [34],
      voided_at: movementInstant, void_reason: 'Test historical correction',
      voided_by: { user_id: 3, employee: null, display_name: 'Test Recorder Two' },
      void_witness: voidWitness,
    }))
    renderMovements('movement=31&kind=receipt&serial=TEST-ABSENT')
    const detail = within(screen.getByRole('region', { name: 'Movement detail' }))
    await detail.findByRole('heading', { name: 'TEST-MOV-031' })
    expect(api.getArmoryMovement).toHaveBeenCalledWith(31)
    await screen.findByText('No movements match these filters.')
    expect(detail.getByText('Voided')).toBeVisible()
    expect(detail.getByText('Test historical correction')).toBeVisible()
    expect(detail.getByText('Test Recorder Two')).toBeVisible()
    expect(detail.getByText('Test Witness Two')).toBeVisible()
    expect(detail.getAllByText('13/02/2026 18:05')).toHaveLength(2)
    expect(detail.getByRole('link', { name: 'Test Radio' })).toHaveAttribute('href', '/holdings/armory?tab=items&item=28')
    expect(detail.getByRole('link', { name: 'TEST-SERIAL-019' })).toHaveAttribute('href', '/holdings/armory?tab=items&serial=19')
    expect(detail.getByRole('link', { name: 'Related movement' })).toHaveAttribute('href', '/holdings/armory?tab=audit&pane=movements&movement=29')
    expect(detail.getByRole('link', { name: 'Discrepancy 34' })).toHaveAttribute('href', '/holdings/armory?tab=audit&pane=decisions&decision=34')
    expect(detail.queryByRole('button', { name: 'Void' })).not.toBeInTheDocument()
  })

  it('isolates the Arabic result count, record reference and organization timestamp', async () => {
    await i18n.changeLanguage('ar')
    vi.mocked(api.listArmoryMovements).mockResolvedValue({ items: [movementFixture()], page: 1, page_size: 50, total: 1 })
    renderMovements('')
    const row = await screen.findByRole('link', { name: /TEST-MOV-031/ })
    expect(within(row).getByText('TEST-MOV-031')).toHaveAttribute('dir', 'ltr')
    expect(within(row).getByText('13/02/2026 18:05')).toHaveAttribute('dir', 'ltr')
    expect(within(row).getByText('خزنة اختبار أولى')).toBeVisible()
    const count = screen.getByRole('region', { name: 'الحركات' }).querySelector('[role="status"]')
    expect(count).toHaveTextContent('الحركات: 1')
    expect(count?.querySelector('bdi')).toHaveAttribute('dir', 'ltr')
  })

  it('hides Void from a viewer of a live posting', async () => {
    vi.mocked(api.getArmoryMovement).mockResolvedValue(movementFixture({ kind: 'shift_issue' }))
    renderMovements('movement=31')
    expect(await screen.findByRole('link', { name: 'View shift issue' })).toHaveAttribute('href', '/holdings/armory?tab=shift&issue=31')
    expect(screen.queryByRole('button', { name: 'Void' })).not.toBeInTheDocument()
    expect(api.voidArmoryMovement).not.toHaveBeenCalled()
  })

  it('does not read movements for an edit-only user', () => {
    caps.delete(ARMORY_VIEW_CAP)
    caps.add(ARMORY_EDIT_CAP)
    renderMovements('movement=31')
    expect(screen.queryByRole('region', { name: 'Movement detail' })).not.toBeInTheDocument()
    expect(api.listArmoryMovements).not.toHaveBeenCalled()
    expect(api.getArmoryMovement).not.toHaveBeenCalled()
  })
})
