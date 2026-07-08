/**
 * EmployeeGapsCard — unit tests.
 *
 * Covers:
 *  - Title renders interpolated count/filled/tracked values
 *  - One row per missing field with localized `employee.field.*` label
 *  - Clicking a field row calls onFix with the field name
 *  - Returns nothing (empty DOM) when missing.length === 0
 */
import { render, screen, fireEvent } from '@testing-library/react'
import { vi, test, expect } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, unknown>) => {
      if (k === 'employee.gaps.title' && opts) {
        return `${opts.count} missing — ${opts.filled}/${opts.tracked}`
      }
      return k
    },
    i18n: { language: 'en' },
  }),
}))

import { EmployeeGapsCard } from './EmployeeGapsCard'

const completeness = { filled: 9, tracked: 14 }

test('renders count title from completeness counts', () => {
  render(
    <EmployeeGapsCard
      missing={['nationality', 'iban']}
      completeness={completeness}
      onFix={vi.fn()}
    />,
  )
  expect(screen.getByText('2 missing — 9/14')).toBeInTheDocument()
})

test('renders one row per field with localized label', () => {
  render(
    <EmployeeGapsCard
      missing={['nationality', 'iban']}
      completeness={completeness}
      onFix={vi.fn()}
    />,
  )
  expect(screen.getByText('employee.field.nationality')).toBeInTheDocument()
  expect(screen.getByText('employee.field.iban')).toBeInTheDocument()
})

test('onFix fires with field when row clicked', () => {
  const onFix = vi.fn()
  render(
    <EmployeeGapsCard
      missing={['nationality']}
      completeness={completeness}
      onFix={onFix}
    />,
  )
  fireEvent.click(screen.getByText('employee.field.nationality'))
  expect(onFix).toHaveBeenCalledWith('nationality')
})

test('renders nothing when no gaps', () => {
  const { container } = render(
    <EmployeeGapsCard
      missing={[]}
      completeness={{ filled: 14, tracked: 14 }}
      onFix={vi.fn()}
    />,
  )
  expect(container).toBeEmptyDOMElement()
})
