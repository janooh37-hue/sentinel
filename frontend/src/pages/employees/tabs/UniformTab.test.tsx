/**
 * UniformTab and its chip gate on the employee file.
 *
 * Behaviours pinned here:
 *   1. Net holdings render before the history, and zero holdings are omitted.
 *   2. History is newest first across hand-outs and returns, voided rows marked with reason.
 *   3. Phone renders cards with the same voided marking.
 *   4. The Uniform chip appears only when the user has uniform.view.
 *   5. The tab is read-only: no mutation controls.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getUniformEmployee, listUniformItems, mobile } = vi.hoisted(() => ({
  getUniformEmployee: vi.fn(),
  listUniformItems: vi.fn(),
  mobile: { value: false },
}))

vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof import('@/lib/api')>()
  return { ...real, api: { ...real.api, getUniformEmployee, listUniformItems } }
})
vi.mock('@/lib/useIsMobile', () => ({ useIsMobile: () => mobile.value }))

import { EmployeeTabChips } from '../EmployeeTabChips'
import { UniformTab } from './UniformTab'

const ITEMS = [
  {
    id: 1, name_en: 'Polo shirt', name_ar: 'قميص بولو', drawing: 'polo', tracking: 'shelf',
    sizes: [{ id: 11, label: 'XL' }, { id: 12, label: 'L' }],
  },
  { id: 2, name_en: 'Boots', name_ar: 'حذاء', drawing: 'boots', tracking: 'shelf', sizes: [{ id: 21, label: '42' }] },
]

const base = { created_by_id: 1, voided_by_id: null, employee_id: 'G1001', note: null }
const RECORD = {
  holdings: [
    { employee_id: 'G1001', item_id: 1, size_id: 11, qty: 2 },
    { employee_id: 'G1001', item_id: 2, size_id: 21, qty: 0 },
  ],
  issues: [
    { ...base, id: 1, created_at: '2026-01-05T08:00:00', voided_at: null, void_reason: null, issued_on: '2026-01-05',
      lines: [{ item_id: 1, size_id: 11, qty: 2 }] },
    { ...base, id: 2, created_at: '2026-03-01T08:00:00', voided_at: '2026-03-02T08:00:00', void_reason: 'Wrong person',
      issued_on: '2026-03-01', lines: [{ item_id: 2, size_id: 21, qty: 1 }] },
  ],
  returns: [
    { ...base, id: 7, created_at: '2026-02-10T08:00:00', voided_at: null, void_reason: null, returned_on: '2026-02-10',
      lines: [{ item_id: 1, size_id: 12, qty: 1, condition: 'damaged' }] },
  ],
}

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <UniformTab employeeId="G1001" />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mobile.value = false
  getUniformEmployee.mockResolvedValue(RECORD)
  listUniformItems.mockResolvedValue(ITEMS)
})

describe('UniformTab', () => {
  it('lists net holdings before history and drops zero holdings', async () => {
    renderTab()
    const holdings = await screen.findByRole('region', { name: 'Currently holds' })
    const history = screen.getByRole('region', { name: 'History' })
    expect(holdings.compareDocumentPosition(history) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const held = within(holdings).getAllByRole('listitem')
    expect(held).toHaveLength(1)
    expect(held[0]).toHaveTextContent('Polo shirt')
    expect(held[0]).toHaveTextContent('XL')
    expect(held[0]).toHaveTextContent('2')
    expect(within(holdings).queryByText('Boots')).not.toBeInTheDocument()
  })

  it('orders history newest first and marks voided rows with their reason', async () => {
    renderTab()
    const history = await screen.findByRole('region', { name: 'History' })
    const rows = within(history).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(3)
    expect(rows[0]).toHaveTextContent('Boots')
    expect(rows[0]).toHaveAttribute('data-voided', 'true')
    expect(rows[0]).toHaveTextContent('Voided')
    expect(rows[0]).toHaveTextContent('Wrong person')
    expect(rows[1]).toHaveTextContent('Return date')
    expect(rows[1]).toHaveTextContent('Damaged')
    expect(rows[1]).toHaveTextContent('L')
    expect(rows[1]).not.toHaveAttribute('data-voided')
    expect(rows[2]).toHaveTextContent('Hand-out date')
  })

  it('shows cards on phone with the voided marking', async () => {
    mobile.value = true
    renderTab()
    const history = await screen.findByRole('region', { name: 'History' })
    expect(within(history).queryByRole('table')).not.toBeInTheDocument()
    const cards = within(history).getAllByRole('listitem').filter((el) => el.parentElement?.parentElement === history)
    expect(cards).toHaveLength(3)
    expect(cards[0]).toHaveAttribute('data-voided', 'true')
    expect(cards[0]).toHaveTextContent('Wrong person')
  })

  it('shows the empty holdings state and offers no mutation controls', async () => {
    getUniformEmployee.mockResolvedValue({ holdings: [], issues: [], returns: [] })
    renderTab()
    expect(await screen.findByText('No uniform currently held.')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})

describe('EmployeeTabChips uniform gate', () => {
  const counts = {
    documents: 0, leaves: '0d', absences: 0, violations: 0, activity: 0, messages: 0, profileGaps: 0, attendance: null,
  }
  it('hides the Uniform chip without uniform.view', () => {
    render(<EmployeeTabChips active="profile" counts={counts} onChange={() => {}} />)
    expect(screen.queryByRole('tab', { name: 'Uniform' })).not.toBeInTheDocument()
  })
  it('shows the Uniform chip with uniform.view', () => {
    render(<EmployeeTabChips active="profile" counts={counts} onChange={() => {}} showUniform />)
    expect(screen.getByRole('tab', { name: 'Uniform' })).toBeInTheDocument()
  })
})
