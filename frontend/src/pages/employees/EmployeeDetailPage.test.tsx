/**
 * EmployeeDetailPage — structural tests for the profile-as-file layout.
 *
 *  - Edit wiring: clicking the ID-card edit button renders EmployeeForm
 *  - Default tab: the chip row starts on 'profile'
 *  - Mini search focus: focusing the mini search input navigates to /employees
 *  - Gaps card: missing_fields from the detail response are passed through
 *  - Time sheet: the ID card's own span reaches the per-employee export
 *
 * Children are stubbed — component internals are covered by their own suites.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, vi, test, expect } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/api', () => ({
  api: {
    getEmployeeDetail: vi.fn(),
    updateEmployee: vi.fn(),
    fetchTimesheetEmployeeExport: vi.fn(),
    documentDownloadUrl: vi.fn(
      (documentId: number, format: 'docx' | 'pdf') =>
        `/api/v1/documents/${documentId}/download?format=${format}`,
    ),
  },
  apiErrorMessage: (e: unknown) => String(e),
}))
vi.mock('@/lib/employeeRecents', () => ({
  recordRecentEmployee: vi.fn(),
}))
/* eslint-disable @typescript-eslint/no-explicit-any */
vi.mock('./EmployeeIdCard', () => ({
  EmployeeIdCard: ({
    onEdit,
    onTimesheet,
  }: {
    onEdit: () => void
    onTimesheet: (args: { year: number; month: number; months: 1 | 2 }) => void
  }) => (
    <>
      <button onClick={onEdit}>employee.card.edit</button>
      {/* The card owns the span — the page only sends what it is handed. */}
      <button onClick={() => onTimesheet({ year: 2026, month: 3, months: 2 })}>
        card-timesheet
      </button>
    </>
  ),
}))
vi.mock('./EmployeeGapsCard', () => ({
  EmployeeGapsCard: ({ missing }: any) => (
    <ul>{missing.map((f: string) => <li key={f}>employee.field.{f}</li>)}</ul>
  ),
}))
vi.mock('./EmployeeTabChips', () => ({
  EmployeeTabChips: ({ active }: any) => (
    <div data-testid="tab-chips" data-active={active} />
  ),
}))
vi.mock('./tabs/DocumentsTab', () => ({
  DocumentsTab: ({
    onPreviewDocs,
  }: {
    onPreviewDocs: (docs: { id: number; name: string }[], index?: number) => void
  }) => (
    <button
      type="button"
      onClick={() => onPreviewDocs([{ id: 73, name: 'Leave application' }])}
    >
      open-document-preview
    </button>
  ),
}))
vi.mock('./tabs/ProfileTab', () => ({ ProfileTab: () => null }))
vi.mock('./tabs/LeavesTab', () => ({ LeavesTab: () => null }))
vi.mock('./tabs/ViolationsTab', () => ({
  ViolationsTab: ({
    openId,
    onOpenConsumed,
  }: {
    openId?: number | null
    onOpenConsumed?: () => void
  }) => (
    <button data-testid="violations-tab" data-open-id={openId ?? ''} onClick={onOpenConsumed}>
      violation-target
    </button>
  ),
}))
vi.mock('./tabs/ActivityTab', () => ({ ActivityTab: () => null }))
vi.mock('@/components/ui/document-viewer-dialog', () => ({
  DocumentViewerDialog: ({
    items,
    startIndex,
    onClose,
  }: {
    items: Array<{
      name: string
      kind: string
      pdfBase64Url?: string
      openUrl?: string
      downloadUrl: string
    }>
    startIndex?: number
    onClose: () => void
  }) => (
    <section
      data-testid="document-viewer"
      data-name={items[0]?.name}
      data-kind={items[0]?.kind}
      data-pdf-base64-url={items[0]?.pdfBase64Url}
      data-open-url={items[0]?.openUrl}
      data-download-url={items[0]?.downloadUrl}
      data-start-index={startIndex}
    >
      <button type="button" onClick={onClose}>close-preview</button>
    </section>
  ),
}))
vi.mock('./tabs/MessagesTab', () => ({ MessagesTab: () => null }))
vi.mock('@/components/employees/EmployeeForm', () => ({
  EmployeeForm: ({ mode }: any) => <div data-testid="employee-form" data-mode={mode} />,
}))
/* eslint-enable @typescript-eslint/no-explicit-any */

import { api } from '@/lib/api'
import { EmployeeDetailPage } from './EmployeeDetailPage'

const detail = {
  employee: { id: 'G100', name_en: 'John Doe', name_ar: 'جون دو', status: 'Active', has_photo: false },
  stats: { documents: 3, leaves_taken_days: 5, violations: 0, ledger_count: 2 },
  recent_documents: [],
  recent_leaves: [],
  recent_violations: [],
  recent_activity: [],
  recent_sms: [],
  missing_fields: [],
  completeness: { filled: 10, tracked: 14 },
}

function renderPage(initialEntry = '/employees/G100') {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/employees/:id" element={<EmployeeDetailPage />} />
          <Route path="/employees" element={<div>lookup-page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

// FILE-LEVEL hooks: vitest registers these at collection, so they wrap every
// test below whatever their position in the file. They are here, above the
// first one, so that is visible rather than inferred.
//
// The save-as path builds an object URL and clicks a real anchor; jsdom has
// neither, and a real anchor click navigates.
beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:sheet') as unknown as typeof URL.createObjectURL
  URL.revokeObjectURL = vi.fn()
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

test('clicking Edit renders EmployeeForm in edit mode', async () => {
  vi.mocked(api.getEmployeeDetail).mockResolvedValue(detail as never)
  renderPage()
  fireEvent.click(await screen.findByText('employee.card.edit'))
  const form = screen.getByTestId('employee-form')
  expect(form).toBeInTheDocument()
  expect(form.dataset.mode).toBe('edit')
})

test('default tab is profile', async () => {
  vi.mocked(api.getEmployeeDetail).mockResolvedValue(detail as never)
  renderPage()
  await screen.findByTestId('tab-chips')
  expect(screen.getByTestId('tab-chips').dataset.active).toBe('profile')
})

test('mini search focus navigates to /employees', async () => {
  vi.mocked(api.getEmployeeDetail).mockResolvedValue(detail as never)
  renderPage()
  const input = await screen.findByPlaceholderText('employees.lookup.miniPlaceholder')
  fireEvent.focus(input)
  expect(screen.getByText('lookup-page')).toBeInTheDocument()
})

test('gaps card lists missing_fields labels', async () => {
  vi.mocked(api.getEmployeeDetail).mockResolvedValue({
    ...detail,
    missing_fields: ['nationality'],
    completeness: { filled: 9, tracked: 14 },
  } as never)
  renderPage()
  expect(await screen.findByText('employee.field.nationality')).toBeInTheDocument()
})

test('violation deep link activates the tab and forwards the exact row id', async () => {
  vi.mocked(api.getEmployeeDetail).mockResolvedValue(detail as never)
  renderPage('/employees/G100?tab=violations&open=42')
  expect(await screen.findByTestId('tab-chips')).toHaveAttribute('data-active', 'violations')
  expect(screen.getByTestId('violations-tab')).toHaveAttribute('data-open-id', '42')
})

test('document tab callback opens and closes the shared generated-PDF viewer', async () => {
  vi.mocked(api.getEmployeeDetail).mockResolvedValue(detail as never)
  renderPage('/employees/G100?tab=documents')

  fireEvent.click(await screen.findByRole('button', { name: 'open-document-preview' }))

  const viewer = screen.getByTestId('document-viewer')
  expect(viewer).toHaveAttribute('data-name', 'Leave application')
  expect(viewer).toHaveAttribute('data-kind', 'pdf')
  expect(viewer).toHaveAttribute(
    'data-pdf-base64-url',
    '/api/v1/documents/73/download?format=pdf&encoding=base64',
  )
  expect(viewer).toHaveAttribute(
    'data-open-url',
    '/api/v1/documents/73/download?format=pdf',
  )
  expect(viewer).toHaveAttribute(
    'data-download-url',
    '/api/v1/documents/73/download?format=pdf',
  )
  expect(viewer).toHaveAttribute('data-start-index', '0')

  fireEvent.click(screen.getByRole('button', { name: 'close-preview' }))
  expect(screen.queryByTestId('document-viewer')).not.toBeInTheDocument()
})

test('the card time-sheet action exports that employee, with the span the card chose', async () => {
  vi.mocked(api.getEmployeeDetail).mockResolvedValue(detail as never)
  vi.mocked(api.fetchTimesheetEmployeeExport).mockResolvedValue({
    blob: new Blob(['x']),
    filename: 'sheet.xlsx',
  } as never)
  renderPage()

  fireEvent.click(await screen.findByText('card-timesheet'))

  // Employee id from the route, span from the card, fallback name from the one
  // exported template — the page adds nothing of its own.
  await waitFor(() =>
    expect(api.fetchTimesheetEmployeeExport).toHaveBeenCalledWith(
      { employeeId: 'G100', year: 2026, month: 3, months: 2 },
      expect.stringContaining('G100'),
    ),
  )
})