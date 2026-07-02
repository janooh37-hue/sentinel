/**
 * PassportField badge-state contract tests.
 *
 * Three badge states:
 *   - verified  — passportNo has a value
 *   - review    — no value but scan exists
 *   - missing   — no value and no scan
 *
 * Mocks `@/lib/api` so no real network calls are made.
 * `useTranslation` works out of the box via the global test/setup.ts i18n init.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, test, expect } from 'vitest'
import { PassportField } from './PassportField'
import { api } from '@/lib/api'

vi.mock('@/lib/api', () => ({
  api: {
    extractPassport: vi.fn(),
    updateEmployee: vi.fn(),
  },
  ApiError: class ApiError extends Error {},
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

test('shows Missing when no value and no scan', () => {
  render(
    <PassportField
      employeeId="G1"
      passportNo={null}
      source={null}
      hasScan={false}
      canEdit={false}
    />,
  )
  expect(screen.getByText(/missing/i)).toBeInTheDocument()
})

test('shows Needs review when scan exists but no value', () => {
  render(
    <PassportField
      employeeId="G1"
      passportNo={null}
      source={null}
      hasScan={true}
      canEdit={false}
    />,
  )
  expect(screen.getByText(/needs review/i)).toBeInTheDocument()
})

test('shows Verified when value present', () => {
  render(
    <PassportField
      employeeId="G1"
      passportNo="N123"
      source="mrz"
      hasScan={true}
      canEdit={false}
    />,
  )
  expect(screen.getByText(/verified/i)).toBeInTheDocument()
})

test('when OCR returns null number: shows not-found message and hides Confirm', async () => {
  vi.mocked(api.extractPassport).mockResolvedValueOnce({ number: null, method: 'none' } as never)
  render(
    <PassportField
      employeeId="G1"
      passportNo={null}
      source={null}
      hasScan={true}
      canEdit={true}
    />,
  )
  fireEvent.click(screen.getByText(/read from scan/i))
  await waitFor(() =>
    expect(screen.getByText(/no passport number found in the scan/i)).toBeInTheDocument(),
  )
  expect(screen.queryByText(/confirm/i)).not.toBeInTheDocument()
})
