import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import i18n from 'i18next'
import { z } from 'zod'

import en from '@/locales/en.json'
import type { JobStatusResponse } from '@/lib/api'
import { api } from '@/lib/api'
import { ApplicationPage } from './ApplicationPage'

const jobStatusState = vi.hoisted(() => ({
  handlers: new Map<string, (job: JobStatusResponse) => void>(),
}))

vi.mock('@/lib/api', () => ({
  api: {
    listTemplates: vi.fn(),
    getEmployee: vi.fn(),
    getSettings: vi.fn(),
    getTemplateFields: vi.fn(),
    generateDocument: vi.fn(),
    getBook: vi.fn(),
    getBookVersionFields: vi.fn(),
  },
  apiErrorMessage: (error: unknown) => String(error),
}))
vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({ capabilities: new Set(), isLoading: false, has: () => true }),
}))
vi.mock('@/lib/applicationFormSchema', () => ({
  buildZodSchema: () => z.object({}),
}))
vi.mock('./JobStatus', () => ({
  JobStatus: ({ jobId, onDone }: { jobId: string; onDone: (job: JobStatusResponse) => void }) => {
    jobStatusState.handlers.set(jobId, onDone)
    return <div data-testid={`job-status-${jobId}`} />
  },
}))
vi.mock('@/components/application/TemplateForm', () => ({
  TemplateForm: () => <div data-testid="template-form" />,
}))
vi.mock('@/components/application/AttachmentsBlock', () => ({
  AttachmentsBlock: () => null,
}))
vi.mock('./EmployeeHeader', () => ({
  EmployeeHeader: () => <div data-testid="employee-header" />,
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
  SavedRecordActions: ({ bookId }: { bookId: number }) => (
    <div data-testid="saved-actions">saved:{bookId}</div>
  ),
}))
vi.mock('./notifyToggle', () => ({
  shouldShowNotifyToggle: () => true,
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

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/application?form=Demo&employee_id=G1']}>
        <ApplicationPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(async () => {
  await i18n.addResourceBundle('en', 'translation', en, true, true)
  await i18n.changeLanguage('en')
  jobStatusState.handlers.clear()
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
  mockedApi.getEmployee.mockResolvedValue({
    id: 'G1',
    name_en: 'Employee One',
    name_ar: null,
  } as never)
  mockedApi.getSettings.mockResolvedValue({ sms_autosend_enabled: true } as never)
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

    await user.click(await screen.findByRole('button', { name: /^Save to Records$/ }))
    await waitFor(() => expect(mockedApi.generateDocument).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(jobStatusState.handlers.has('job-2')).toBe(true))
    await act(async () => jobStatusState.handlers.get('job-2')?.(completedSavedJob('job-2')))

    expect(await screen.findByTestId('saved-actions')).toHaveTextContent('saved:42')
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
})
