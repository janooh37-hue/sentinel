import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from 'i18next'

import ar from '@/locales/ar.json'
import en from '@/locales/en.json'
import { ApiError, api } from '@/lib/api'
import { ApprovedViolationUpload } from './ApprovedViolationUpload'

vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {
    readonly code: string

    constructor(_status: number, code: string, message: string) {
      super(message)
      this.code = code
    }
  },
  api: {
    inspectApprovedViolation: vi.fn(),
    commitApprovedViolation: vi.fn(),
  },
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
  warnings: ['APPROVED_IMPORT_WARNING_OCR_UNAVAILABLE'],
}

function renderUpload(onSaved = vi.fn(), onSaveBusyChange = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return {
    onSaved,
    onSaveBusyChange,
    ...render(
      <QueryClientProvider client={client}>
        <ApprovedViolationUpload onSaved={onSaved} onSaveBusyChange={onSaveBusyChange} />
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
    expect(
      screen.getByText('OCR is unavailable; enter the report date and inmate names.'),
    ).toBeVisible()
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
    expect(screen.getByLabelText('Inmate name 2')).toHaveFocus()
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

    const empty = new File([], 'empty.pdf', { type: 'application/pdf' })
    await user.upload(screen.getByLabelText('Choose approved PDF or image'), empty)
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose a file that is not empty.')
    expect(mockedApi.inspectApprovedViolation).not.toHaveBeenCalled()
  })

  it('restores controls after a failed commit and keeps selected data', async () => {
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

    const save = screen.getByRole('button', { name: 'Save approved record' })
    expect(save).toBeEnabled()
    await user.click(save)
    const reportDate = screen.getByLabelText('Report date')
    expect(reportDate).toHaveFocus()
    expect(screen.getByText('Enter the report date.')).toBeVisible()
    expect(reportDate).toHaveAttribute('aria-describedby', 'approved-violation-report-date-error')
    await user.click(screen.getByRole('button', { name: 'Add inmate name' }))
    expect(screen.getByLabelText('Inmate name 2')).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'Remove inmate name 2' }))
    expect(screen.getByLabelText('Inmate name 1')).toHaveFocus()
    await user.type(screen.getByLabelText('Report date'), '2026-08-05')
    await user.type(screen.getByLabelText('Inmate name 1'), 'محمد سالم ياسر')
    await user.type(screen.getByLabelText('Record subject'), 'Confirmed subject')
    await user.click(screen.getByRole('button', { name: 'Save approved record' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not save the approved record. Try again.',
    )
    expect(screen.getByText('approved.pdf')).toBeVisible()
    expect(screen.getByLabelText('Record subject')).toHaveValue('Confirmed subject')
    expect(screen.getByRole('button', { name: 'Replace file' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Remove file' })).toBeEnabled()
  })

  it('blocks replacement, removal, and duplicate commits while save is pending', async () => {
    const user = userEvent.setup()
    const result = {
      book_id: 42,
      document_id: 9,
      ref_number: 'NAT-0042',
      approval_state: 'approved',
    } as const
    let resolveCommit!: (value: typeof result) => void
    const commitPromise = new Promise<typeof result>((resolve) => {
      resolveCommit = resolve
    })
    mockedApi.commitApprovedViolation.mockReturnValue(commitPromise)
    const { onSaveBusyChange, onSaved } = renderUpload()
    const input = screen.getByLabelText('Choose approved PDF or image')
    const file = new File(['pdf'], 'approved.pdf', { type: 'application/pdf' })

    await user.upload(input, file)
    await screen.findByText('This copy is already approved. No approval request will be sent.')

    const save = screen.getByRole('button', { name: 'Save approved record' })
    await user.click(save)
    expect(mockedApi.commitApprovedViolation).toHaveBeenCalledTimes(1)
    expect(onSaveBusyChange).toHaveBeenLastCalledWith(true)
    expect(screen.getByRole('button', { name: 'Replace file' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Remove file' })).toBeDisabled()
    expect(input).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Replace file' }))
    await user.click(screen.getByRole('button', { name: 'Remove file' }))
    await user.click(save)
    await user.upload(input, new File(['pdf'], 'replacement.pdf', { type: 'application/pdf' }))
    expect(mockedApi.inspectApprovedViolation).toHaveBeenCalledTimes(1)
    expect(mockedApi.commitApprovedViolation).toHaveBeenCalledTimes(1)
    expect(screen.getByText('approved.pdf')).toBeVisible()

    resolveCommit(result)
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(result))
    expect(onSaveBusyChange).toHaveBeenLastCalledWith(false)
  })

  it('keeps the hidden chooser out of the tab order and reports failed inspection honestly', async () => {
    const user = userEvent.setup()
    mockedApi.inspectApprovedViolation.mockRejectedValue(
      new ApiError(422, 'APPROVED_IMPORT_BAD_FILE', 'Upload a valid file'),
    )
    renderUpload()
    const input = screen.getByLabelText('Choose approved PDF or image')
    expect(input).toHaveAttribute('tabindex', '-1')

    await user.upload(input, new File(['bad'], 'approved.pdf', { type: 'application/pdf' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This PDF or image is unreadable. Choose a valid file.',
    )
    expect(screen.getByText(/Inspection failed/)).toBeVisible()
    expect(screen.getByRole('status')).toHaveFocus()
    expect(screen.queryByText('Ready to review')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Replace file' }))
    expect(input).toHaveValue('')
  })

  it('removes staged metadata and exposes explicit Arabic labels', async () => {
    const user = userEvent.setup()
    renderUpload()
    await i18n.changeLanguage('ar')

    const input = screen.getByLabelText('اختر ملف PDF أو صورة معتمدة')
    await user.upload(input, new File(['png'], 'approved.png', { type: 'image/png' }))
    await screen.findByLabelText('تاريخ التقرير')
    expect(
      screen.getByText('تعذر تشغيل التعرّف الضوئي؛ أدخل تاريخ التقرير وأسماء النزلاء.'),
    ).toBeVisible()
    expect(screen.getByRole('button', { name: 'حفظ السجل المعتمد' })).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'إزالة الملف' }))
    expect(screen.queryByText('approved.png')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'اسحب النسخة المطبوعة والموقعة هنا أو اختر ملفًا.' })).toHaveFocus()
    expect(screen.queryByLabelText('تاريخ التقرير')).not.toBeInTheDocument()
  })
})
