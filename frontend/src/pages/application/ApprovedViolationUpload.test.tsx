import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from 'i18next'

import ar from '@/locales/ar.json'
import en from '@/locales/en.json'
import { api } from '@/lib/api'
import { ApprovedViolationUpload } from './ApprovedViolationUpload'

vi.mock('@/lib/api', () => ({
  api: {
    inspectApprovedViolation: vi.fn(),
    commitApprovedViolation: vi.fn(),
  },
  apiErrorMessage: (error: unknown) => String(error),
}))
vi.mock('./ApprovedViolationPreview', () => ({
  ApprovedViolationPreview: ({ file }: { file: File }) => (
    <div data-testid="approved-preview">preview:{file.name}</div>
  ),
}))

const mockedApi = vi.mocked(api)
const inspection = {
  token: 'a'.repeat(32),
  filename: 'approved.pdf',
  size: 1234,
  expires_at: '2026-08-11T08:00:00Z',
  report_date: '2026-08-05',
  inmate_names: [{ name: 'محمد سالم ياسر', confidence: 0.9 }],
  proposed_subject: 'Inmate Conduct Violations — محمد سالم ياسر',
  warnings: ['Confirm the extracted name.'],
}

function renderUpload(onSaved = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return {
    onSaved,
    ...render(
      <QueryClientProvider client={client}>
        <ApprovedViolationUpload onSaved={onSaved} />
      </QueryClientProvider>,
    ),
  }
}

beforeEach(async () => {
  await i18n.addResourceBundle('en', 'translation', en, true, true)
  await i18n.addResourceBundle('ar', 'translation', ar, true, true)
  await i18n.changeLanguage('en')
  mockedApi.inspectApprovedViolation.mockReset()
  mockedApi.commitApprovedViolation.mockReset()
  mockedApi.inspectApprovedViolation.mockResolvedValue(inspection)
  mockedApi.commitApprovedViolation.mockResolvedValue({
    book_id: 42,
    document_id: 9,
    ref_number: 'NAT-0042',
    approval_state: 'approved',
  })
})

afterEach(() => {
  cleanup()
  void i18n.changeLanguage('en')
})

describe('ApprovedViolationUpload', () => {
  it('inspects, exposes corrections, and commits the exact confirmed metadata', async () => {
    const user = userEvent.setup()
    const { onSaved } = renderUpload()
    const file = new File(['pdf'], 'approved.pdf', { type: 'application/pdf' })

    await user.upload(screen.getByLabelText('Choose approved PDF or image'), file)

    await waitFor(() => expect(mockedApi.inspectApprovedViolation).toHaveBeenCalledWith(file))
    expect(screen.getByTestId('approved-preview')).toHaveTextContent('approved.pdf')
    expect(screen.getByText('approved.pdf')).toBeVisible()
    expect(screen.getByText('Confirm the extracted name.')).toBeVisible()
    expect(screen.getByLabelText('Report date')).toHaveValue('2026-08-05')
    expect(screen.getByLabelText('Inmate name 1')).toHaveValue('محمد سالم ياسر')
    expect(screen.getByLabelText('Record subject')).toHaveValue(
      'Inmate Conduct Violations — محمد سالم ياسر',
    )

    await user.clear(screen.getByLabelText('Report date'))
    await user.type(screen.getByLabelText('Report date'), '2026-08-06')
    await user.clear(screen.getByLabelText('Inmate name 1'))
    await user.type(screen.getByLabelText('Inmate name 1'), 'خالد عبدالله')
    await user.click(screen.getByRole('button', { name: 'Add inmate name' }))
    await user.type(screen.getByLabelText('Inmate name 2'), 'محمد سالم ياسر')
    await user.clear(screen.getByLabelText('Record subject'))
    await user.type(
      screen.getByLabelText('Record subject'),
      'مخالفة مسلكية — محمد سالم ياسر، خالد عبدالله',
    )
    await user.click(screen.getByRole('button', { name: 'Save approved record' }))

    await waitFor(() =>
      expect(mockedApi.commitApprovedViolation).toHaveBeenCalledWith({
        token: 'a'.repeat(32),
        report_date: '2026-08-06',
        inmate_names: ['خالد عبدالله', 'محمد سالم ياسر'],
        subject: 'مخالفة مسلكية — محمد سالم ياسر، خالد عبدالله',
      }),
    )
    await waitFor(() =>
      expect(onSaved).toHaveBeenCalledWith({
        book_id: 42,
        document_id: 9,
        ref_number: 'NAT-0042',
        approval_state: 'approved',
      }),
    )
    expect(onSaved).toHaveBeenCalledTimes(1)
  })

  it('rejects unsupported and oversized files before inspection', async () => {
    const user = userEvent.setup({ applyAccept: false })
    renderUpload()
    const unsupported = new File(['x'], 'report.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })

    await user.upload(screen.getByLabelText('Choose approved PDF or image'), unsupported)
    expect(await screen.findByRole('alert')).toHaveTextContent('Use a PDF, PNG, JPG, or JPEG file.')
    expect(mockedApi.inspectApprovedViolation).not.toHaveBeenCalled()

    const oversized = new File(['x'], 'large.pdf', { type: 'application/pdf' })
    Object.defineProperty(oversized, 'size', { value: 25 * 1024 * 1024 + 1 })
    await user.upload(screen.getByLabelText('Choose approved PDF or image'), oversized)
    expect(await screen.findByRole('alert')).toHaveTextContent('File must be 25 MB or smaller.')
    expect(mockedApi.inspectApprovedViolation).not.toHaveBeenCalled()
  })

  it('focuses the first invalid field and keeps selected data after commit failure', async () => {
    const user = userEvent.setup()
    mockedApi.inspectApprovedViolation.mockResolvedValue({
      ...inspection,
      report_date: null,
      inmate_names: [],
      proposed_subject: '',
      warnings: [],
    })
    mockedApi.commitApprovedViolation.mockRejectedValue(new Error('save failed'))
    renderUpload()
    await user.upload(
      screen.getByLabelText('Choose approved PDF or image'),
      new File(['pdf'], 'approved.pdf', { type: 'application/pdf' }),
    )
    await screen.findByText('This copy is already approved. No approval request will be sent.')

    fireEvent.submit(screen.getByTestId('approved-violation-form'))
    expect(screen.getByLabelText('Report date')).toHaveFocus()
    expect(screen.getByText('Enter the report date.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Save approved record' })).toBeDisabled()

    await user.type(screen.getByLabelText('Report date'), '2026-08-05')
    await user.type(screen.getByLabelText('Inmate name 1'), 'محمد سالم ياسر')
    await user.type(screen.getByLabelText('Record subject'), 'Confirmed subject')
    await user.click(screen.getByRole('button', { name: 'Save approved record' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('save failed')
    expect(screen.getByText('approved.pdf')).toBeVisible()
    expect(screen.getByLabelText('Record subject')).toHaveValue('Confirmed subject')
  })

  it('removes staged metadata and exposes explicit Arabic labels', async () => {
    const user = userEvent.setup()
    renderUpload()
    await i18n.changeLanguage('ar')

    const input = screen.getByLabelText('اختر ملف PDF أو صورة معتمدة')
    await user.upload(input, new File(['png'], 'approved.png', { type: 'image/png' }))
    await screen.findByLabelText('تاريخ التقرير')
    expect(screen.getByRole('button', { name: 'حفظ السجل المعتمد' })).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'إزالة الملف' }))
    expect(screen.queryByText('approved.png')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('تاريخ التقرير')).not.toBeInTheDocument()
  })
})
