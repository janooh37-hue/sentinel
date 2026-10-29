import { render, screen } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import { EmployeeTabChips } from './EmployeeTabChips'

const hasCapability = vi.hoisted(() => vi.fn<(cap: string) => boolean>(() => true))
vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({ has: hasCapability }),
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
beforeEach(() => hasCapability.mockReturnValue(true))

const counts = {
  documents: 8,
  leaves: '37d',
  absences: 19,
  violations: 2,
  activity: 4,
  messages: 3,
  profileGaps: 1,
  attendance: null,
}

test.each(['leaves.view', 'employees.view'])('hides both sensitive tabs and their counts without %s, preserving unrelated tabs', (denied) => {
  hasCapability.mockImplementation((cap) => cap !== denied)
  render(<EmployeeTabChips active="profile" counts={counts} onChange={vi.fn()} />)
  expect(screen.queryByRole('tab', { name: /employee.tab.leaves/ })).not.toBeInTheDocument()
  expect(screen.queryByRole('tab', { name: /employee.tab.absences/ })).not.toBeInTheDocument()
  expect(screen.queryByText('37d')).not.toBeInTheDocument()
  expect(screen.queryByText('19')).not.toBeInTheDocument()
  expect(screen.getByRole('tab', { name: /employee.tab.documents/ })).toHaveTextContent('8')
  expect(screen.getByRole('tab', { name: /employee.tab.messages/ })).toHaveTextContent('3')
})

test('revocation removes sensitive tab counts already rendered from cached employee detail', () => {
  const { rerender } = render(<EmployeeTabChips active="profile" counts={counts} onChange={vi.fn()} />)
  expect(screen.getByRole('tab', { name: /employee.tab.leaves/ })).toHaveTextContent('37d')
  hasCapability.mockImplementation((cap) => cap !== 'leaves.view')
  rerender(<EmployeeTabChips active="profile" counts={counts} onChange={vi.fn()} />)
  expect(screen.queryByRole('tab', { name: /employee.tab.leaves/ })).not.toBeInTheDocument()
  expect(screen.queryByRole('tab', { name: /employee.tab.absences/ })).not.toBeInTheDocument()
})
