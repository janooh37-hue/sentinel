import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { ARMORY_EDIT_CAP, ARMORY_VIEW_CAP } from '@/lib/armory'
import i18n from '@/lib/i18n'
import { AuditPane } from './AuditPane'
import { renderAudit, testAccessory, testCount, testDiscrepancy, testSafe } from './auditTestFixtures'

const caps = vi.hoisted(() => ({ view: true, edit: true }))
vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({ has: (cap: string) => (
    (cap === ARMORY_VIEW_CAP && caps.view) || (cap === ARMORY_EDIT_CAP && caps.edit)
  ) }),
}))
vi.mock(import('@/lib/api'), async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: {
      ...actual.api,
      listArmoryDiscrepancies: vi.fn(),
      listArmoryCounts: vi.fn(),
      getArmoryCount: vi.fn(),
      listArmoryMovements: vi.fn(),
      listArmorySafes: vi.fn(),
      getArmoryMonthlyCountDraft: vi.fn(),
      listArmoryPeople: vi.fn(),
    },
  }
})

function LocationSearch() {
  const { search } = useLocation()
  return <output data-testid="search">{search}</output>
}

beforeEach(async () => {
  vi.resetAllMocks()
  caps.view = true
  caps.edit = true
  await i18n.changeLanguage('en')
  vi.mocked(api.listArmoryDiscrepancies).mockResolvedValue({
    items: [testDiscrepancy()], page: 1, page_size: 50, total: 1,
  })
  vi.mocked(api.listArmoryCounts).mockResolvedValue({ items: [], page: 1, page_size: 50, total: 0 })
  vi.mocked(api.listArmoryMovements).mockResolvedValue({ items: [], page: 1, page_size: 50, total: 0 })
  vi.mocked(api.getArmoryCount).mockResolvedValue(testCount)
  vi.mocked(api.listArmorySafes).mockResolvedValue([testSafe])
  vi.mocked(api.getArmoryMonthlyCountDraft).mockResolvedValue({
    safe: testSafe, month: '2025-02', snapshot_token: 'test-count-draft', items: [testAccessory],
  })
  vi.mocked(api.listArmoryPeople).mockResolvedValue([])
})

describe('AuditPane', () => {
  it('selects audit tabs with the keyboard and preserves unrelated URL parameters', async () => {
    const user = userEvent.setup()
    renderAudit(<><AuditPane safeId={7} /><LocationSearch /></>, '/holdings/armory?tab=audit&safe=7&extra=kept')

    const decisions = screen.getByRole('tab', { name: 'Decisions' })
    expect(decisions).toHaveAttribute('aria-selected', 'true')
    decisions.focus()
    await user.keyboard('{ArrowRight}')

    const counts = screen.getByRole('tab', { name: 'Counts' })
    expect(counts).toHaveFocus()
    expect(counts).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('search')).toHaveTextContent('tab=audit&safe=7&extra=kept&pane=counts')
    await waitFor(() => expect(api.listArmoryCounts).toHaveBeenCalledWith({ safe_id: 7, page: 1 }))

    await user.click(screen.getByRole('tab', { name: 'Movements' }))
    expect(screen.getByRole('tab', { name: 'Movements' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('search')).toHaveTextContent('pane=movements')
  })

  it('looks up a decision deep link regardless of the list status or safe', async () => {
    caps.edit = false
    vi.mocked(api.listArmoryDiscrepancies).mockImplementation(async (filters) => ({
      items: filters?.discrepancy_id === 51 ? [testDiscrepancy({ status: 'resolved' })] : [],
      page: 1, page_size: 50, total: filters?.discrepancy_id === 51 ? 1 : 0,
    }))
    renderAudit(<AuditPane safeId={8} />, '/holdings/armory?tab=audit&status=open&decision=51&safe=8')

    expect(await screen.findByText('TEST-A-01')).toBeVisible()
    expect(api.listArmoryDiscrepancies).toHaveBeenCalledWith({ discrepancy_id: 51, status: 'all' })
    expect(screen.getByRole('link', { name: 'TEST-CHECK-01' })).toHaveAttribute(
      'href', '/holdings/armory?tab=audit&pane=counts&count=42',
    )
  })

  it('shows open evidence but no decision action to a viewer', async () => {
    caps.edit = false
    renderAudit(<AuditPane safeId={null} />)

    expect(await screen.findByText('TEST-A-01')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Record decision' })).not.toBeInTheDocument()
  })

  it('explains why an editor cannot decide without rendering a decision action', async () => {
    vi.mocked(api.listArmoryDiscrepancies).mockResolvedValue({
      items: [testDiscrepancy({ can_decide: false })], page: 1, page_size: 50, total: 1,
    })
    renderAudit(<AuditPane safeId={null} />)

    expect(await screen.findByText('Needs a decision by a second authorised person.')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Record decision' })).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('uses the requested decision status and keeps the safe filter', async () => {
    const user = userEvent.setup()
    renderAudit(<AuditPane safeId={7} />)

    expect(screen.getByRole('button', { name: 'Open' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'Resolved' }))
    await waitFor(() => expect(api.listArmoryDiscrepancies).toHaveBeenCalledWith({
      safe_id: 7, status: 'resolved', page: 1,
    }))
  })

  it('opens count details independently and links to the resulting finding', async () => {
    renderAudit(<AuditPane safeId={8} />, '/holdings/armory?tab=audit&pane=counts&count=43&safe=8')

    expect(await screen.findByText('Test Accessory')).toBeVisible()
    expect(api.getArmoryCount).toHaveBeenCalledWith(43)
    expect(screen.getByRole('link', { name: 'Discrepancy 51' })).toHaveAttribute(
      'href', '/holdings/armory?tab=audit&pane=decisions&decision=51',
    )
  })

  it('requires choosing a concrete safe before reading a count draft from All safes', async () => {
    const user = userEvent.setup()
    renderAudit(<AuditPane safeId={null} />, '/holdings/armory?tab=audit&pane=counts&safe=all')

    await user.click(screen.getByRole('button', { name: 'New monthly count' }))
    const chooser = await screen.findByRole('combobox', { name: 'Safe' })
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
    expect(api.getArmoryMonthlyCountDraft).not.toHaveBeenCalled()
    await user.selectOptions(chooser, '7')
    await user.click(screen.getByRole('button', { name: 'Next' }))

    expect(await screen.findByLabelText('Counted quantity')).toBeVisible()
    expect(api.getArmoryMonthlyCountDraft).toHaveBeenCalledExactlyOnceWith(7)
  })

  it('does not render a pane or fetch evidence for edit-only users', () => {
    caps.view = false
    renderAudit(<AuditPane safeId={7} />)

    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    expect(api.listArmoryDiscrepancies).not.toHaveBeenCalled()
  })
})
