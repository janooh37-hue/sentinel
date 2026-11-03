import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import i18n from 'i18next'
import { z } from 'zod'
import type { UseFormReturn } from 'react-hook-form'
import type { AttachmentsState } from '@/components/application/attachmentsState'
import { toast } from '@/lib/toast'

import en from '@/locales/en.json'
import type * as ApiModule from '@/lib/api'
import type { JobStatusResponse } from '@/lib/api'
import { api, ApiError } from '@/lib/api'
import { ApplicationPage } from './ApplicationPage'
import { messageTemplatesApi } from '@/lib/messageTemplates'
import type * as MessageTemplatesModule from '@/lib/messageTemplates'
import { clearDraft } from '@/lib/formDrafts'

const jobStatusState = vi.hoisted(() => ({
  handlers: new Map<string, (job: JobStatusResponse) => void>(),
  failures: new Map<string, (job: JobStatusResponse) => void>(),
  stopped: new Map<string, () => void>(),
}))

vi.mock('@/lib/toast', () => ({
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn(), loading: vi.fn(() => 'loading-toast'), dismiss: vi.fn() },
}))
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiModule>()
  return {
    ...actual,
    api: {
      listTemplates: vi.fn(),
      getEmployeeLookup: vi.fn(),
      getSettings: vi.fn(),
      getTemplateFields: vi.fn(),
      generateDocument: vi.fn(),
      getBook: vi.fn(),
      getBookVersionFields: vi.fn(),
      createWordBook: vi.fn(),
      listBookClassifications: vi.fn().mockResolvedValue({ items: [] }),
    },
    apiErrorMessage: (error: unknown) => String(error),
  }
})
vi.mock('@/lib/messageTemplates', async (importOriginal) => {
  const actual = await importOriginal<typeof MessageTemplatesModule>()
  return {
    ...actual,
    messageTemplatesApi: {
      ...actual.messageTemplatesApi,
      preview: vi.fn().mockResolvedValue({
        event: 'leave_permit',
        language: 'en',
        timing: 'on_approval',
        text: { en: 'Employee message before approval', ar: 'رسالة الموظف قبل الاعتماد' },
        segments: { en: 1, ar: 1 },
      }),
    },
  }
})
vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({ capabilities: new Set(), isLoading: false, has: () => true }),
}))
vi.mock('@/lib/applicationFormSchema', () => ({
  buildZodSchema: () => z.object({}).passthrough(),
}))
vi.mock('./JobStatus', () => ({
  JobStatus: ({ jobId, onDone, onFailed, onPollingStopped }: { jobId: string; onDone: (job: JobStatusResponse) => void; onFailed: (job: JobStatusResponse) => void; onPollingStopped: () => void }) => {
    jobStatusState.handlers.set(jobId, onDone)
    jobStatusState.failures.set(jobId, onFailed)
    jobStatusState.stopped.set(jobId, onPollingStopped)
    return <div data-testid={`job-status-${jobId}`} />
  },
}))
vi.mock('@/components/application/TemplateForm', () => ({
  TemplateForm: ({ templateId, form, onClassificationChange }: { templateId: string; form: UseFormReturn; onClassificationChange: (code: string) => void }) => {
    return (
      <div data-testid="template-form">
        {['General Book', 'Report'].includes(templateId) && <input aria-label="Subject" {...form.register('subject')} />}
        <button type="button" onClick={() => onClassificationChange('5/1')}>Set classification</button>
      </div>
    )
  },
}))
vi.mock('@/components/application/AttachmentsBlock', () => ({
  AttachmentsBlock: ({ state, onChange }: { state: AttachmentsState; onChange: (value: AttachmentsState) => void }) => (
    <button
      type="button"
      onClick={() => onChange({
        ...state,
        extras: [...state.extras, { kind: 'staged', token: 'upload-token', filename: 'evidence.pdf', size: 42 }],
      })}
    >
      Add test attachment ({state.extras.length})
    </button>
  ),
}))
vi.mock('./EmployeeHeader', () => ({
  EmployeeHeader: () => <div data-testid="employee-header" />,
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
  SavedRecordActions: ({ bookId }: { bookId: number }) => (
    <div data-testid="saved-actions">saved:{bookId}</div>
  ),
}))

const mockedApi = vi.mocked(api)

function completedPreviewJob(jobId: string): JobStatusResponse {
  return {
    job_id: jobId,
    status: 'done',
    book_id: null,
    documents: [{ role: 'primary', document_id: 7, ref_number: 'DRAFT' }],
  } as JobStatusResponse
}

function completedSavedJob(jobId: string): JobStatusResponse {
  return {
    job_id: jobId,
    status: 'done',
    book_id: 42,
    documents: [{ role: 'primary', document_id: 99, ref_number: 'REF-42' }],
  } as JobStatusResponse
}

function renderPage(route = '/services/demo?employee_id=G1') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route path="/services/:slug?" element={<ApplicationPage />} />
          <Route path="/books/:id/word" element={<div>Word session</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

async function startPendingSave(user: UserEvent) {
  await waitFor(() => expect(screen.getAllByRole('button', { name: /^Preview$/ })
    .some((button) => !button.hasAttribute('disabled'))).toBe(true))
  const preview = screen.getAllByRole('button', { name: /^Preview$/ })
    .filter((button) => !button.hasAttribute('disabled')).pop()!
  await user.click(preview)
  await waitFor(() => expect(jobStatusState.handlers.has('job-1')).toBe(true))
  await act(async () => jobStatusState.handlers.get('job-1')?.(completedPreviewJob('job-1')))
  await user.click(await screen.findByRole('button', { name: /^Save to Records$/ }))
  await waitFor(() => expect(jobStatusState.handlers.has('job-2')).toBe(true))
  expect(toast.loading).toHaveBeenCalledWith(en.application.toast.saving)
}

beforeEach(async () => {
  await i18n.addResourceBundle('en', 'translation', en, true, true)
  await i18n.changeLanguage('en')
  jobStatusState.handlers.clear()
  jobStatusState.failures.clear()
  jobStatusState.stopped.clear()
  mockedApi.listTemplates.mockResolvedValue({
    items: [
      {
        id: 'Demo',
        name_en: 'Demo form',
        name_ar: 'نموذج تجريبي',
        category: 'personnel',
        notifies_employee: true,
      },
    ],
  } as never)
  mockedApi.getEmployeeLookup.mockResolvedValue({
    id: 'G1',
    name_en: 'Employee One',
    name_ar: null,
  } as never)
  mockedApi.getSettings.mockResolvedValue({ sms_autosend_enabled: true } as never)
  vi.mocked(messageTemplatesApi.preview).mockResolvedValue({
    event: 'leave_permit',
    language: 'en',
    timing: 'on_approval',
    text: { en: 'Employee message before approval', ar: 'رسالة الموظف قبل الاعتماد' },
    segments: { en: 1, ar: 1 },
  })
  mockedApi.getTemplateFields.mockResolvedValue({
    meta: {},
    needs_manager: false,
    needs_submitter: false,
    fields: [],
    attachment_slots: [],
  } as never)
  let generation = 0
  mockedApi.generateDocument.mockImplementation(async () => ({ job_id: `job-${++generation}` }))
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('ApplicationPage generated handoff reset', () => {
  it('includes staged attachments in Preview and reuses the same specs on Save', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Add test attachment (0)' }))
    await startPendingSave(user)

    const expected = [{
      slot_key: null,
      source: 'staged',
      staged_token: 'upload-token',
      original_name: 'evidence.pdf',
    }]
    expect(mockedApi.generateDocument).toHaveBeenNthCalledWith(1, expect.objectContaining({
      commit: false,
      attachments: expected,
    }))
    expect(mockedApi.generateDocument).toHaveBeenNthCalledWith(2, expect.objectContaining({
      commit: true,
      attachments: expected,
    }))
  })

  it.each(['General Book', 'Report'])('sends attachments when creating %s in Word', async (templateId) => {
    mockedApi.listTemplates.mockResolvedValue({
      items: [{ id: templateId, name_en: templateId, name_ar: templateId, category: 'admin' }],
    } as never)
    mockedApi.getTemplateFields.mockResolvedValue({
      meta: {},
      fields: templateId === 'Report' ? [] : [{ id: 'body', type: 'arabic_rich_full' }],
      attachment_slots: [],
    } as never)
    mockedApi.createWordBook.mockResolvedValue({ book_id: 99 } as never)
    const user = userEvent.setup()
    renderPage(`/services/${templateId === 'Report' ? 'report' : 'general_book'}`)
    await user.type(await screen.findByRole('textbox', { name: 'Subject' }), 'Package subject')
    await user.click(screen.getByRole('button', { name: 'Set classification' }))
    await user.click(screen.getByRole('button', { name: 'Add test attachment (0)' }))
    await user.click(screen.getByRole('button', { name: en.books.word.createAndOpen }))

    await waitFor(() => expect(mockedApi.createWordBook).toHaveBeenCalledWith(expect.objectContaining({
      subject: 'Package subject',
      attachments: [{
        slot_key: null,
        source: 'staged',
        staged_token: 'upload-token',
        original_name: 'evidence.pdf',
      }],
    })))
    expect(clearDraft).toHaveBeenCalledWith(templateId)
    expect(await screen.findByText('Word session')).toBeVisible()
  })

  it.each(['General Book', 'Report'])('blocks Word creation of %s when a required attachment is absent', async (templateId) => {
    mockedApi.listTemplates.mockResolvedValue({
      items: [{ id: templateId, name_en: templateId, name_ar: templateId, category: 'admin' }],
    } as never)
    mockedApi.getTemplateFields.mockResolvedValue({
      meta: {},
      fields: templateId === 'Report' ? [] : [{ id: 'body', type: 'arabic_rich_full' }],
      attachment_slots: [{ key: 'proof', label_en: 'Proof', label_ar: 'إثبات', required: true }],
    } as never)
    const user = userEvent.setup()
    renderPage(`/services/${templateId === 'Report' ? 'report' : 'general_book'}`)
    await user.type(await screen.findByRole('textbox', { name: 'Subject' }), 'Package subject')
    await user.click(screen.getByRole('button', { name: 'Set classification' }))
    await user.click(screen.getByRole('button', { name: en.books.word.createAndOpen }))

    expect(mockedApi.createWordBook).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith(i18n.t('application.attachments.requiredHint', { slot: 'Proof' }))
  })

  it('allows Preview while required attachment slots are empty', async () => {
    mockedApi.getTemplateFields.mockResolvedValue({
      meta: {},
      fields: [],
      attachment_slots: [{ key: 'proof', label_en: 'Proof', label_ar: 'إثبات', required: true }],
    } as never)
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => expect(screen.getAllByRole('button', { name: /^Preview$/ })
      .some((button) => !button.hasAttribute('disabled'))).toBe(true))
    const preview = screen.getAllByRole('button', { name: /^Preview$/ })
      .filter((button) => !button.hasAttribute('disabled')).pop()!
    await user.click(preview)
    await waitFor(() => expect(mockedApi.generateDocument).toHaveBeenCalledWith(expect.objectContaining({
      commit: false,
      attachments: undefined,
    })))
  })

  it('does not request or render a revision message preview when autosend is disabled', async () => {
    mockedApi.getSettings.mockResolvedValue({ sms_autosend_enabled: false } as never)
    mockedApi.getBook.mockResolvedValue({ versions: [{ id: 9 }] } as never)
    mockedApi.getBookVersionFields.mockResolvedValue({ fields: { notes: 'Revised details' } } as never)
    const user = userEvent.setup()
    renderPage('/services/demo?employee_id=G1&revise=42')
    await waitFor(() => expect(mockedApi.getBookVersionFields).toHaveBeenCalledWith(42, 9))
    await waitFor(() => expect(screen.getAllByRole('button', { name: /^Preview$/ })
      .some((button) => !button.hasAttribute('disabled'))).toBe(true))
    const previewButton = screen.getAllByRole('button', { name: /^Preview$/ })
      .filter((button) => !button.hasAttribute('disabled')).pop()!
    await user.click(previewButton)
    await waitFor(() => expect(jobStatusState.handlers.has('job-1')).toBe(true))
    await act(async () => jobStatusState.handlers.get('job-1')?.(completedPreviewJob('job-1')))

    expect(screen.getByRole('button', { name: /^Save to Records$/ })).toBeEnabled()
    expect(messageTemplatesApi.preview).not.toHaveBeenCalled()
    expect(screen.queryByText('Employee message before approval')).not.toBeInTheDocument()
    expect(screen.queryByText(i18n.t('msgTemplates.preview.title'))).not.toBeInTheDocument()
    expect(screen.queryByRole('switch', { name: i18n.t('application.notify.label') })).not.toBeInTheDocument()
  })

  it.each([
    { width: 1440, hasMessage: true },
    { width: 1440, hasMessage: false },
    { width: 390, hasMessage: true },
    { width: 390, hasMessage: false },
  ])('previews a revision without a notify switch at $width px (message: $hasMessage)', async ({
    width,
    hasMessage,
  }) => {
    const originalWidth = window.innerWidth
    window.innerWidth = width
    window.dispatchEvent(new Event('resize'))
    mockedApi.getBook.mockResolvedValue({ versions: [{ id: 9 }] } as never)
    mockedApi.getBookVersionFields.mockResolvedValue({ fields: { notes: 'Revised details' } } as never)
    vi.mocked(messageTemplatesApi.preview).mockResolvedValue({
      event: 'leave_permit',
      language: 'en',
      timing: 'on_approval',
      text: hasMessage ? { en: 'Revision approval message', ar: 'رسالة اعتماد التعديل' } : null,
      segments: hasMessage ? { en: 1, ar: 1 } : null,
    })
    const user = userEvent.setup()
    try {
      renderPage('/services/demo?employee_id=G1&revise=42')
      await waitFor(() => expect(mockedApi.getBookVersionFields).toHaveBeenCalledWith(42, 9))
      await waitFor(() => expect(screen.getAllByRole('button', { name: /^Preview$/ })
        .some((button) => !button.hasAttribute('disabled'))).toBe(true))
      const previewButton = screen.getAllByRole('button', { name: /^Preview$/ })
        .filter((button) => !button.hasAttribute('disabled')).pop()!
      await user.click(previewButton)
      await waitFor(() => expect(jobStatusState.handlers.has('job-1')).toBe(true))
      await act(async () => jobStatusState.handlers.get('job-1')?.(completedPreviewJob('job-1')))

      await waitFor(() => expect(messageTemplatesApi.preview).toHaveBeenCalledWith({
        template_id: 'Demo',
        employee_id: 'G1',
        fields: { notes: 'Revised details' },
        revise_of_book_id: 42,
      }))
      expect(await screen.findByText(
        hasMessage ? 'Revision approval message' : i18n.t('msgTemplates.preview.empty'),
      )).toBeVisible()
      expect(screen.queryByRole('switch', { name: i18n.t('application.notify.label') })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: /^Save to Records$/ })).toBeEnabled()
    } finally {
      window.innerWidth = originalWidth
      window.dispatchEvent(new Event('resize'))
    }
  })

  it('shows the localized existing-record message when the leave is already issued', async () => {
    mockedApi.generateDocument.mockRejectedValueOnce(
      new ApiError(422, 'LEAVE_ALREADY_ISSUED', 'This leave is already issued on record HR-1', {
        ref_number: 'HR-1',
        book_id: 1,
      }),
    )
    const user = userEvent.setup()
    renderPage()

    await waitFor(() =>
      expect(
        screen
          .getAllByRole('button', { name: /^Preview$/ })
          .some((button) => !button.hasAttribute('disabled')),
      ).toBe(true),
    )
    const previewButton = screen
      .getAllByRole('button', { name: /^Preview$/ })
      .filter((button) => !button.hasAttribute('disabled'))
      .pop()
    await user.click(previewButton!)

    const message = en.application.leaveAlreadyIssuedNoRef
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(toast.error).toHaveBeenCalledWith(message, { reference: 'HR-1' })
    expect(screen.queryByText(/This leave is already issued on record HR-1/)).not.toBeInTheDocument()
  })

  it('clears prior saved actions when a new preview job is accepted and completes', async () => {
    const user = userEvent.setup()
    renderPage()

    await waitFor(() =>
      expect(
        screen
          .getAllByRole('button', { name: /^Preview$/ })
          .some((button) => !button.hasAttribute('disabled')),
      ).toBe(true),
    )
    const previewButton = screen
      .getAllByRole('button', { name: /^Preview$/ })
      .filter((button) => !button.hasAttribute('disabled'))
      .pop()
    expect(previewButton).toBeDefined()
    await user.click(previewButton!)
    await waitFor(() => expect(mockedApi.generateDocument).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(jobStatusState.handlers.has('job-1')).toBe(true))
    await act(async () => jobStatusState.handlers.get('job-1')?.(completedPreviewJob('job-1')))

    expect(await screen.findByText('Employee message before approval')).toBeVisible()
    expect(messageTemplatesApi.preview).toHaveBeenCalledWith({
      template_id: 'Demo',
      employee_id: 'G1',
      fields: mockedApi.generateDocument.mock.calls[0][0].fields,
      revise_of_book_id: null,
    })

    await user.click(await screen.findByRole('button', { name: /^Save to Records$/ }))
    await waitFor(() => expect(mockedApi.generateDocument).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(jobStatusState.handlers.has('job-2')).toBe(true))
    expect(toast.loading).toHaveBeenCalledWith(en.application.toast.saving)
    await act(async () => jobStatusState.handlers.get('job-2')?.(completedSavedJob('job-2')))

    expect(await screen.findByTestId('saved-actions')).toHaveTextContent('saved:42')
    expect(toast.success).toHaveBeenCalledWith(en.application.toast.saved, { id: 'loading-toast', reference: 'REF-42' })
    expect(await screen.findByRole('button', { name: /^Add to email$/ })).toBeVisible()

    await user.click(screen.getByRole('button', { name: /^Edit fields$/ }))
    const nextPreview = screen
      .getAllByRole('button', { name: /^Preview$/ })
      .filter((button) => !button.hasAttribute('disabled'))
      .pop()
    expect(nextPreview).toBeDefined()
    await user.click(nextPreview!)
    await waitFor(() => expect(mockedApi.generateDocument).toHaveBeenCalledTimes(3))
    await waitFor(() => expect(jobStatusState.handlers.has('job-3')).toBe(true))
    await act(async () => jobStatusState.handlers.get('job-3')?.(completedPreviewJob('job-3')))

    expect(await screen.findByText('Ready to save to Records')).toBeVisible()
    expect(screen.queryByTestId('saved-actions')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Add to email$/ })).not.toBeInTheDocument()
  })

  it('replaces the save loading toast on a failed job without clearing the draft', async () => {
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => expect(screen.getAllByRole('button', { name: /^Preview$/ })
      .some((button) => !button.hasAttribute('disabled'))).toBe(true))
    const preview = screen.getAllByRole('button', { name: /^Preview$/ })
      .filter((button) => !button.hasAttribute('disabled')).pop()!
    await user.click(preview)
    await waitFor(() => expect(jobStatusState.handlers.has('job-1')).toBe(true))
    await act(async () => jobStatusState.handlers.get('job-1')?.(completedPreviewJob('job-1')))
    expect(toast.loading).not.toHaveBeenCalled()
    await user.click(await screen.findByRole('button', { name: /^Save to Records$/ }))
    await waitFor(() => expect(jobStatusState.failures.has('job-2')).toBe(true))
    expect(toast.loading).toHaveBeenCalledWith(en.application.toast.saving)
    await act(async () => jobStatusState.failures.get('job-2')?.({
      job_id: 'job-2', status: 'failed', error_code: 'GENERATION_ERROR', error_message: 'boom',
    }))
    expect(toast.error).toHaveBeenCalledWith(en.application.toast.generateFailed, { id: 'loading-toast', description: 'boom' })
    expect(toast.success).not.toHaveBeenCalled()
    expect(clearDraft).not.toHaveBeenCalled()
    expect(screen.queryByTestId('saved-actions')).not.toBeInTheDocument()
  })

  it('settles the same save toast with a network warning when polling gives up', async () => {
    const user = userEvent.setup()
    renderPage()
    await startPendingSave(user)

    await act(async () => jobStatusState.stopped.get('job-2')?.())

    expect(toast.warning).toHaveBeenCalledWith(en.errors.network, { id: 'loading-toast' })
    expect(toast.error).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
    expect(clearDraft).not.toHaveBeenCalled()
  })

  it.each(['edit fields', 'new form', 'unmount'])('dismisses the pending save toast on %s', async (action) => {
    const user = userEvent.setup()
    const view = renderPage()
    await startPendingSave(user)

    if (action === 'unmount') view.unmount()
    else await user.click(screen.getByRole('button', { name: action === 'edit fields' ? /^Edit fields$/ : /^New form$/ }))

    expect(toast.dismiss).toHaveBeenCalledExactlyOnceWith('loading-toast')
    expect(toast.error).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
  })
})
