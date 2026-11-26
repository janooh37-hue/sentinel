import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useLocation } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import i18n from '@/lib/i18n'
import { issue, otherSafe, renderArmory, returnPosting, testSafe, testShift } from './shiftFixtures'
import { ShiftPane } from './ShiftPane'

const caps = vi.hoisted(() => ({ view: true, edit: true }))
vi.mock('@/lib/useCapabilities', () => ({ useCapabilities: () => ({
  has: (cap: string) => cap === 'armory.view' ? caps.view : caps.edit,
  isLoading: false,
}) }))
vi.mock('@/lib/authContext', () => ({ useAuth: () => ({ user: { id: 1, email: 'armorer@example.test', employee_id: 'T-0001' }, status: 'authed' }) }))

beforeEach(async () => {
  vi.restoreAllMocks()
  caps.view = true
  caps.edit = true
  await i18n.changeLanguage('en')
  vi.spyOn(api, 'getArmoryShift').mockResolvedValue(testShift)
  vi.spyOn(api, 'getArmoryIssue').mockResolvedValue(issue)
  vi.spyOn(api, 'getArmoryMovement').mockResolvedValue(returnPosting)
})

function Location() {
  return <output aria-label="Current route">{useLocation().search}</output>
}

function mount(entry?: string, safeId: number | null = testSafe.id) {
  const actions = { onIssue: vi.fn(), onReturn: vi.fn(), onHandover: vi.fn(), onBulkReturn: vi.fn(), onShiftCheck: vi.fn() }
  renderArmory(<><ShiftPane safeId={safeId} safes={[testSafe, otherSafe]} checkPaused={false} {...actions} /><Location /></>, entry)
  return actions
}

it('puts the global missing strip before overdue and identifies each rack tile by full serial', async () => {
  mount()
  const missing = await screen.findByText('firearm missing', { exact: false })
  const overdue = screen.getByText('Overdue:', { exact: false })
  expect(missing.compareDocumentPosition(overdue) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
  expect(screen.getByText('Test Safe B')).toBeVisible()
  expect(screen.getByRole('button', { name: /TEST-R-0001.*Overdue/ })).toBeVisible()
  expect(screen.getByText('06:00', { selector: 'bdi[dir=ltr]' })).toBeVisible()
  expect(api.getArmoryShift).toHaveBeenCalledWith(1)
})

it('uses the posting quantities on Returned and shows no write buttons to a viewer', async () => {
  caps.edit = false
  mount()
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: /Returned.*1/ }))
  const activity = screen.getByRole('region', { name: 'Shift activity' })
  expect(within(activity).getByText('rounds', { exact: false }).closest('li')).toHaveTextContent('2 rounds (Test Ammunition)')
  expect(within(activity).queryByText('9')).not.toBeInTheDocument()
  for (const name of ['Record issues', 'Record returns', 'Check the safe', 'Hand over custody', 'Return']) {
    expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
  }
})

it('loads a deep-linked issue, shows its evidence and removes the flag on close', async () => {
  caps.edit = false
  mount('/holdings/armory?tab=shift&safe=1&issue=10')
  const dialog = await screen.findByRole('dialog', { name: 'Issue record' })
  expect(await within(dialog).findByText('TEST-ISSUE-10')).toBeVisible()
  expect(within(dialog).getByText('Test duty change')).toBeVisible()
  expect(within(dialog).getByText('Licence warning acknowledgement recorded.')).toBeVisible()
  expect(within(dialog).getByRole('columnheader', { name: 'Originally issued' })).toBeVisible()
  expect(await within(dialog).findByText('TEST-RETURN-20')).toBeVisible()
  expect(within(dialog).queryByRole('button', { name: 'Return' })).not.toBeInTheDocument()
  await userEvent.setup().keyboard('{Escape}')
  await waitFor(() => expect(screen.getByLabelText('Current route')).toHaveTextContent(/^\?tab=shift&safe=1$/))
})

it('opens a rack serial history and links through to the issue or Items register', async () => {
  const load = vi.spyOn(api, 'getArmorySerial').mockResolvedValue({
    ...testShift.safes[0].firearms[0], recent_movements: [returnPosting],
  })
  mount()
  const user = userEvent.setup()
  const tile = await screen.findByRole('button', { name: /TEST-R-0001.*Overdue/ })
  await user.click(tile)
  const sheet = await screen.findByRole('dialog', { name: 'TEST-R-0001' })
  expect(load).toHaveBeenCalledWith(1)
  expect(within(sheet).getByRole('link', { name: /TEST-RETURN-20/ })).toHaveAttribute('href', '/holdings/armory?tab=audit&pane=movements&movement=20')
  expect(within(sheet).getByRole('link', { name: 'Open item' })).toHaveAttribute('href', '/holdings/armory?tab=items&item=1&serial=1')
  await user.click(within(sheet).getByRole('link', { name: 'Issue record' }))
  const detail = await screen.findByRole('dialog', { name: 'Issue record' })
  expect(screen.getAllByRole('dialog')).toHaveLength(1)
  expect(await within(detail).findByText('TEST-ISSUE-10')).toBeVisible()
  await user.keyboard('{Escape}')
  await waitFor(() => expect(tile).toHaveFocus())
})

it('keeps Arabic labels RTL and time and serial evidence explicitly LTR', async () => {
  await i18n.changeLanguage('ar')
  try {
    mount()
    const rack = await screen.findByRole('region', { name: 'لوحة الأسلحة' })
    const tile = within(rack).getByRole('button', { name: /TEST-R-0001/ })
    expect(document.documentElement).toHaveAttribute('dir', 'rtl')
    expect(tile.querySelector('bdi[dir=ltr]')).toHaveTextContent('TEST-R-0001')
    expect(screen.getByText('06:00', { selector: 'bdi[dir=ltr]' })).toBeVisible()
  } finally {
    await act(async () => { await i18n.changeLanguage('en') })
  }
})

it('returns focus to the issue row and never guesses a safe for the bulk action', async () => {
  const actions = mount('/holdings/armory?tab=shift&safe=all', null)
  const user = userEvent.setup()
  const opener = (await screen.findAllByRole('button', { name: /View record/ }))[0]
  await user.click(opener)
  await screen.findByRole('dialog', { name: 'Issue record' })
  await user.keyboard('{Escape}')
  await waitFor(() => expect(opener).toHaveFocus())
  const returns = screen.getByRole('button', { name: 'Record returns' })
  await user.click(returns)
  expect(actions.onBulkReturn).toHaveBeenCalledExactlyOnceWith(returns)
  const check = screen.getByRole('button', { name: 'Check the safe: Test Safe A' })
  await user.click(check)
  expect(actions.onShiftCheck).toHaveBeenCalledExactlyOnceWith(1, check)
})
