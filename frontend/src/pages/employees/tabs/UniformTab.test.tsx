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
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
import i18n from '@/lib/i18n'
import { UniformTab } from './UniformTab'
import { uniformKeys } from '@/pages/assets/uniform/uniformQueries'

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
  const view = render(
    <QueryClientProvider client={client}>
      <UniformTab employeeId="G1001" />
    </QueryClientProvider>,
  )
  return { ...view, client }
}

beforeEach(async () => {
  vi.clearAllMocks()
  mobile.value = false
  await i18n.changeLanguage('en')
  getUniformEmployee.mockResolvedValue(RECORD)
  listUniformItems.mockResolvedValue(ITEMS)
})

describe('UniformTab', () => {
  it.each([
    ['records', false],
    ['items', false],
    ['records', true],
    ['items', true],
  ] as const)('keeps cached holdings and history mounted after %s refresh failure on mobile=%s and retries inline', async (dependency, isMobile) => {
    mobile.value = isMobile
    const { client } = renderTab()
    const holdings = await screen.findByRole('region', { name: 'Currently holds' })
    const history = screen.getByRole('region', { name: 'History' })
    const held = within(holdings).getByText('Polo shirt')
    const voidReason = within(history).getByText('Wrong person')
    const key = dependency === 'records' ? uniformKeys.employee('G1001') : uniformKeys.items(true)
    if (dependency === 'records') getUniformEmployee.mockRejectedValue(new Error('Refresh offline'))
    else listUniformItems.mockRejectedValue(new Error('Refresh offline'))
    await act(async () => { await client.invalidateQueries({ queryKey: key, exact: true }) })
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not refresh uniform records. Showing the last loaded data.')
    expect(screen.getByRole('region', { name: 'Currently holds' })).toBe(holdings)
    expect(screen.getByRole('region', { name: 'History' })).toBe(history)
    expect(within(holdings).getByText('Polo shirt')).toBe(held)
    expect(holdings).toHaveTextContent('XL')
    expect(within(history).getByText('Wrong person')).toBe(voidReason)
    expect(history).toHaveTextContent('Damaged')
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: /Hand out|Record return|Void record/ })).not.toBeInTheDocument()
    getUniformEmployee.mockResolvedValue(RECORD)
    listUniformItems.mockResolvedValue(ITEMS)
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    expect(client.getQueryState(key)?.status).toBe('success')
    expect(screen.getByRole('region', { name: 'Currently holds' })).toBe(holdings)
    expect(screen.getByRole('region', { name: 'History' })).toBe(history)
    expect(within(holdings).getByText('Polo shirt')).toBe(held)
    expect(within(history).getByText('Wrong person')).toBe(voidReason)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it.each(['records', 'items'] as const)('shows an initial error instead of empty holdings when %s has no cache', async dependency => {
    if (dependency === 'records') getUniformEmployee.mockRejectedValue(new Error('Initial offline'))
    else listUniformItems.mockRejectedValue(new Error('Initial offline'))
    renderTab()
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Currently holds' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'History' })).not.toBeInTheDocument()
    expect(screen.queryByText('No uniform currently held.')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled()
  })

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

  it.each([
    ['en', false],
    ['ar', false],
    ['en', true],
    ['ar', true],
  ] as const)('keeps voided text legible in %s on mobile=%s', async (language, isMobile) => {
    await i18n.changeLanguage(language)
    mobile.value = isMobile
    renderTab()
    const history = await screen.findByRole('region', { name: i18n.t('assets.uniform.history') })
    const badge = within(history).getByText(i18n.t('assets.uniform.voidStatus'))
    const entry = badge.closest('[data-voided]')
    expect(entry).toHaveAttribute('data-voided', 'true')
    expect(entry?.tagName).toBe(isMobile ? 'LI' : 'TR')
    expect(entry).toHaveTextContent('Wrong person')
    expect(badge).toHaveClass('text-destructive-text', 'bg-destructive/10')
    expect(badge).not.toHaveClass('text-destructive')
    // Opacity on any ancestor also fades the badge and the reason, even with the correct token.
    for (let element: HTMLElement | null = badge; element; element = element.parentElement) {
      expect(element.className).not.toMatch(/(?:^|\s)(?:[^\s]+:)?opacity-(?!100(?:\s|$))\S+/)
      expect(element.style.opacity === '' || element.style.opacity === '1').toBe(true)
    }
    expect(entry?.querySelector('.line-through')).not.toBeNull()
    expect(within(history).queryByRole('table') !== null).toBe(!isMobile)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('shows the empty holdings state and offers no mutation controls', async () => {
    getUniformEmployee.mockResolvedValue({ holdings: [], issues: [], returns: [] })
    renderTab()
    expect(await screen.findByText('No uniform currently held.')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('localizes one-size pieces and shows no size for holder pieces', async () => {
    listUniformItems.mockResolvedValue([
      ...ITEMS,
      { id: 3, name_en: 'Belt', name_ar: 'حزام', drawing: 'belt', tracking: 'shelf', sizes: [{ id: 31, label: 'one' }] },
      { id: 4, name_en: 'Suit', name_ar: 'بدلة', drawing: 'suit', tracking: 'holder', sizes: [] },
    ])
    getUniformEmployee.mockResolvedValue({
      holdings: [
        { employee_id: 'G1001', item_id: 3, size_id: 31, qty: 1 },
        { employee_id: 'G1001', item_id: 4, size_id: null, qty: 1 },
      ],
      issues: [],
      returns: [],
    })
    renderTab()
    const holdings = await screen.findByRole('region', { name: 'Currently holds' })
    const [belt, suit] = within(holdings).getAllByRole('listitem')
    expect(belt).toHaveTextContent('One size')
    expect(belt).not.toHaveTextContent(/\bone\b/)
    expect(suit).toHaveTextContent('Suit')
    expect(suit).not.toHaveTextContent('One size')
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
