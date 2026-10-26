import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { toast } from '@/lib/toast'
import { api, ApiError, type ReturnedFormOut } from '@/lib/api'
import { IntakePanel, ReturnedFormCard } from './IntakePanel'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@/lib/toast', () => ({ toast: {
  loading: vi.fn(() => 'intake-job'), success: vi.fn(), error: vi.fn(), dismiss: vi.fn(),
} }))

const result: ReturnedFormOut = {
  mode: 'returned_form', book_id: 42, ref_number: 'GS-0410', approval_state: 'pending',
  category: null, subject: null, employee_id: null, employee_name: null,
}
const file = new File([], 'scan.pdf', { type: 'application/pdf' })

beforeEach(() => { vi.restoreAllMocks(); vi.clearAllMocks() })

describe('IntakePanel toast lifecycle', () => {
  it.each([true, false])('resolves OCR loading (success=%s)', async (success) => {
    const post = vi.spyOn(api, 'postIntake')
    if (success) post.mockResolvedValue(result)
    else post.mockRejectedValue(new ApiError(503, 'OCR_UNAVAILABLE', 'Unavailable'))
    const qc = new QueryClient()
    const view = render(
      <MemoryRouter><QueryClientProvider client={qc}><IntakePanel /></QueryClientProvider></MemoryRouter>,
    )
    fireEvent.change(view.container.querySelector('input[type="file"]')!, { target: { files: [file] } })
    expect(toast.loading).toHaveBeenCalledWith('books.pane.scanReading')
    if (success) {
      await waitFor(() => expect(toast.dismiss).toHaveBeenCalledWith('intake-job'))
      expect(screen.getByText('intake.returnedForm.title')).toBeInTheDocument()
    } else {
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith('intake.error.unavailable', { id: 'intake-job' }))
      expect(toast.dismiss).not.toHaveBeenCalled()
    }
  })

  it.each([true, false])('keeps the returned record reference on completion (success=%s)', async (success) => {
    const attach = vi.spyOn(api, 'addBookAttachment')
    if (success) attach.mockResolvedValue({} as never)
    else attach.mockRejectedValue(new ApiError(422, 'MISMATCH', 'Barcode mismatch'))
    const qc = new QueryClient()
    render(
      <MemoryRouter><QueryClientProvider client={qc}>
        <ReturnedFormCard result={result} file={file} onDismiss={vi.fn()} />
      </QueryClientProvider></MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'intake.returnedForm.approve' }))
    await waitFor(() => expect(success ? toast.success : toast.error).toHaveBeenCalledWith(
      success ? 'intake.returnedForm.approved' : 'Barcode mismatch',
      { id: 'intake-job', reference: 'GS-0410' },
    ))
    expect(attach).toHaveBeenCalledWith(42, file, true)
  })
})
