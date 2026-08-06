import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

import { api } from '@/lib/api'
import type { DutyTransferResult } from '@/lib/api'
import { DutyLocationsPage } from './DutyLocationsPage'

const DOCUMENT_RESULT = {
  book_id: 42,
  ref: '1/12/GSSG/106',
  document_id: 9,
  moved: ['G3309'],
}
const NO_BOOK_RESULT = {
  book_id: null,
  ref: null,
  document_id: null,
  moved: ['G3309'],
}
const REPLACEMENT_RESULT = {
  book_id: 84,
  ref: '2/13/GSSG/107',
  document_id: 10,
  moved: ['G3309'],
}

vi.mock('@/lib/api', () => ({
  api: {
    listEmployees: vi.fn(),
  },
}))
vi.mock('./UnitRail', () => ({ UnitRail: () => <div data-testid="unit-rail" /> }))
vi.mock('./AssignPopover', () => ({ AssignPopover: () => null }))
vi.mock('./SupervisorDesignations', () => ({ SupervisorDesignations: () => null }))
vi.mock('./LeaveDigestPanel', () => ({ LeaveDigestPanel: () => null }))
vi.mock('./RosterTable', () => ({
  RosterTable: ({ onToggle }: { onToggle: (id: string, on: boolean) => void }) => (
    <button type="button" onClick={() => onToggle('G3309', true)}>
      Select employee
    </button>
  ),
}))
vi.mock('./TransferDialog', () => ({
  TransferDialog: ({
    open,
    onOpenChange,
    onTransferred,
  }: {
    open: boolean
    onOpenChange: (open: boolean) => void
    onTransferred: (result: DutyTransferResult) => void
  }) =>
    open ? (
      <div data-testid="transfer-dialog">
        <button type="button" onClick={() => onTransferred(DOCUMENT_RESULT)}>
          Complete document transfer
        </button>
        <button type="button" onClick={() => onTransferred(NO_BOOK_RESULT)}>
          Complete no-book transfer
        </button>
        <button type="button" onClick={() => onTransferred(REPLACEMENT_RESULT)}>
          Complete replacement transfer
        </button>
        <button type="button" onClick={() => onOpenChange(false)}>
          Cancel transfer
        </button>
      </div>
    ) : null,
}))
vi.mock('@/components/books/SavedRecordActions', () => ({
  SavedRecordActions: ({
    bookId,
    refNumber,
  }: {
    bookId: number
    refNumber: string
  }) => <div data-testid="saved-actions">saved:{bookId}:{refNumber}</div>,
}))

const mockedApi = vi.mocked(api)

function renderPage(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/duty-locations']}>
        <DutyLocationsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

async function openTransfer(): Promise<void> {
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'Select employee' }))
  await user.click(screen.getByRole('button', { name: /^Transfer selected/ }))
}

beforeEach(() => {
  mockedApi.listEmployees.mockResolvedValue({
    items: [{ id: 'G3309', name_en: 'Employee One', name_ar: null, duty_unit: 'GSSG', duty_post: null }],
    total: 1,
  } as never)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('DutyLocationsPage transfer completion', () => {
  it('clears selection and renders saved actions for a document result', async () => {
    renderPage()
    await openTransfer()

    await userEvent.click(screen.getByRole('button', { name: 'Complete document transfer' }))

    expect(screen.queryByRole('button', { name: /transfer/i })).not.toBeInTheDocument()
    expect(screen.getByTestId('saved-actions')).toHaveTextContent('saved:42:1/12/GSSG/106')
  })

  it('clears selection and actions for a no-book result', async () => {
    renderPage()
    await openTransfer()

    await userEvent.click(screen.getByRole('button', { name: 'Complete document transfer' }))
    expect(screen.getByTestId('saved-actions')).toBeInTheDocument()

    await openTransfer()
    await userEvent.click(screen.getByRole('button', { name: 'Complete no-book transfer' }))

    expect(screen.queryByRole('button', { name: /transfer/i })).not.toBeInTheDocument()
    expect(screen.queryByTestId('saved-actions')).not.toBeInTheDocument()
  })

  it('replaces prior actions with a later document result and preserves them on cancel', async () => {
    renderPage()
    await openTransfer()
    await userEvent.click(screen.getByRole('button', { name: 'Complete document transfer' }))

    await openTransfer()
    await userEvent.click(screen.getByRole('button', { name: 'Complete replacement transfer' }))
    expect(screen.getByTestId('saved-actions')).toHaveTextContent('saved:84:2/13/GSSG/107')

    await openTransfer()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel transfer' }))
    expect(screen.getByTestId('saved-actions')).toHaveTextContent('saved:84:2/13/GSSG/107')
  })
})
