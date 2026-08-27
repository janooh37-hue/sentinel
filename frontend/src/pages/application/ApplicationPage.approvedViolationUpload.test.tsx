import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import i18n from 'i18next'
import { z } from 'zod'

import en from '@/locales/en.json'
import { api } from '@/lib/api'
import { ApplicationPage } from './ApplicationPage'

vi.mock('@/lib/api', () => ({
  api: {
    listTemplates: vi.fn(),
    getSettings: vi.fn(),
    getTemplateFields: vi.fn(),
  },
  apiErrorMessage: (error: unknown) => String(error),
}))
vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({ capabilities: new Set(), isLoading: false, has: () => true }),
}))
vi.mock('@/lib/applicationFormSchema', () => ({
  buildZodSchema: () => z.object({}),
}))
vi.mock('@/components/application/TemplateForm', () => ({
  TemplateForm: () => <div data-testid="template-form" />,
}))
vi.mock('@/components/application/AttachmentsBlock', () => ({
  AttachmentsBlock: () => null,
}))
vi.mock('./EmployeeHeader', () => ({
  EmployeeHeader: () => null,
}))
vi.mock('./JobStatus', () => ({
  JobStatus: () => null,
}))
vi.mock('@/pages/books/WordHandoffDialog', () => ({
  WordHandoffDialog: () => null,
}))
vi.mock('@/lib/formDrafts', () => ({
  clearAllDrafts: vi.fn(),
  clearDraft: vi.fn(),
  loadDraft: vi.fn(() => null),
  saveDraft: vi.fn(),
}))
vi.mock('@/lib/useKeyboardShortcuts', () => ({
  useShortcutAction: vi.fn(),
}))
vi.mock('@/hooks/useEmailBasket', () => ({
  useEmailBasket: () => ({ baskets: [] }),
}))
vi.mock('@/components/books/SavedRecordActions', () => ({
  SavedRecordActions: ({
    bookId,
    refNumber,
    detail,
  }: {
    bookId: number
    refNumber: string
    detail?: string
  }) => (
    <div data-testid="saved-actions">
      {bookId}:{refNumber}:{detail}
    </div>
  ),
}))
vi.mock('./notifyToggle', () => ({
  shouldShowNotifyToggle: () => false,
}))
vi.mock('./ApprovedViolationUpload', () => ({
  ApprovedViolationUpload: ({
    onSaved,
    onSaveBusyChange,
  }: {
    onSaved: (result: {
      book_id: number
      document_id: number
      ref_number: string
      approval_state: string
      signed_pdf_url: string
    }) => void
    onSaveBusyChange?: (busy: boolean) => void
  }) => (
    <div data-testid="approved-violation-upload">
      <button type="button" onClick={() => onSaveBusyChange?.(true)}>
        Begin approved save
      </button>
      <button type="button" onClick={() => onSaveBusyChange?.(false)}>
        Finish approved save
      </button>
      <button
        type="button"
        onClick={() =>
          onSaved({
            book_id: 42,
            document_id: 9,
            ref_number: 'NAT-0042',
            approval_state: 'approved',
            signed_pdf_url: '/signed.pdf',
          })
        }
      >
        Complete approved upload
      </button>
    </div>
  ),
}))

const mockedApi = vi.mocked(api)

function renderPage(form: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/application?form=${form}`]}>
        <ApplicationPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(async () => {
  await i18n.addResourceBundle('en', 'translation', en, true, true)
  await i18n.changeLanguage('en')
  mockedApi.listTemplates.mockResolvedValue({
    items: [
      {
        id: 'Inmate Conduct Violations',
        name_en: 'Inmate Conduct Violations',
        name_ar: 'مخالفات سلوك النزلاء',
        category: 'admin',
        notifies_employee: false,
      },
      {
        id: 'Demo',
        name_en: 'Demo form',
        name_ar: 'نموذج تجريبي',
        category: 'admin',
        notifies_employee: false,
      },
    ],
  } as never)
  mockedApi.getSettings.mockResolvedValue({ sms_autosend_enabled: false } as never)
  mockedApi.getTemplateFields.mockResolvedValue({
    meta: {},
    needs_manager: false,
    needs_submitter: false,
    fields: [],
    attachment_slots: [],
  } as never)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('ApplicationPage approved violation entry mode', () => {
  it('switches between generated and approved-copy entry and hands off the saved record', async () => {
    const user = userEvent.setup()
    renderPage('inmate_conduct_violations')

    const createMode = await screen.findByRole('button', { name: 'Create form' })
    expect(createMode).toHaveAttribute('aria-pressed', 'true')
    expect(await screen.findByTestId('template-form')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Upload approved copy' }))
    expect(screen.getByTestId('approved-violation-upload')).toBeVisible()
    expect(screen.getByTestId('template-form')).not.toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Complete approved upload' }))
    const success = await screen.findByTestId('approved-import-success')
    await waitFor(() =>
      expect(within(success).getByRole('heading', { name: 'Approved record saved' })).toHaveFocus(),
    )
    expect(screen.getByTestId('saved-actions')).toHaveTextContent(
      '42:NAT-0042:Approved copy filed',
    )

    await user.click(screen.getByRole('button', { name: 'New upload' }))
    expect(screen.getByTestId('approved-violation-upload')).toBeVisible()
    expect(screen.queryByTestId('approved-import-success')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Create form' }))
    expect(screen.getByTestId('template-form')).toBeVisible()
    expect(screen.queryByTestId('approved-violation-upload')).not.toBeInTheDocument()
  })

  it('locks mode switching and Services navigation while an approved save is pending', async () => {
    const user = userEvent.setup()
    renderPage('inmate_conduct_violations')

    await user.click(await screen.findByRole('button', { name: 'Upload approved copy' }))
    await user.click(screen.getByRole('button', { name: 'Begin approved save' }))

    expect(screen.getByRole('button', { name: 'Create form' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Upload approved copy' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Services' })).toBeDisabled()
    expect(screen.getByTestId('approved-violation-upload')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Finish approved save' }))
    expect(screen.getByRole('button', { name: 'Create form' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Upload approved copy' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Services' })).toBeEnabled()
  })

  it('keeps other services on the existing form path', async () => {
    renderPage('demo')

    expect(await screen.findByTestId('template-form')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Create form' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Upload approved copy' })).not.toBeInTheDocument()
  })
})
