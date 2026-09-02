/**
 * ApplicationPage — sick/annual leave overwriting recorded absences.
 *
 * The backend removes covered absence rows on the FIRST job that covers them
 * (usually the preview, since generation persists drafts) and carries the
 * dates on the job-status payload; the page announces the overwrite so the
 * operator learns "this employee was absent X → Y, the leave replaced it".
 */
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
const toastWarning = vi.hoisted(() => vi.fn())

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), warning: toastWarning, error: vi.fn(), info: vi.fn() },
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

function previewJob(jobId: string, superseded: string[]): JobStatusResponse {
  return {
    job_id: jobId,
    status: 'done',
    book_id: null,
    documents: [{ role: 'primary', document_id: 7, ref_number: 'DRAFT' }],
    superseded_absence_dates: superseded,
  } as JobStatusResponse
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const rendered = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/application?form=Demo&employee_id=G1']}>
        <ApplicationPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { ...rendered, queryClient }
}

/** Render, start a preview generation, and return its job-done handler. */
async function startPreview(): Promise<(job: JobStatusResponse) => void> {
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
  await waitFor(() => expect(jobStatusState.handlers.has('job-1')).toBe(true))
  return jobStatusState.handlers.get('job-1')!
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
  mockedApi.generateDocument.mockResolvedValue({ job_id: 'job-1' } as never)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('ApplicationPage absence overwrite announcement', () => {
  it('announces the days a generated leave overwrote', async () => {
    const onDone = await startPreview()

    await act(async () => onDone(previewJob('job-1', ['2026-07-09', '2026-07-10'])))

    expect(toastWarning).toHaveBeenCalledTimes(1)
    const message = toastWarning.mock.calls[0][0] as string
    expect(message).toContain('overwrote 2 recorded absence day(s)')
    expect(message).toContain('Jul 9, 2026')
    expect(message).toContain('Jul 10, 2026')
  })

  it('invalidates the global absence register after an overwrite', async () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(['absence-register'], { rows: [{ employee_id: 'G1' }] })
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    const rendered = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/application?form=Demo&employee_id=G1']}>
          <ApplicationPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    const user = userEvent.setup()
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
    await waitFor(() => expect(jobStatusState.handlers.has('job-1')).toBe(true))

    await act(async () =>
      jobStatusState.handlers.get('job-1')!(
        previewJob('job-1', ['2026-07-09', '2026-07-10']),
      ),
    )

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['absence-register'] })
    rendered.unmount()
  })

  it('stays silent when the leave overwrote nothing', async () => {
    const onDone = await startPreview()

    await act(async () => onDone(previewJob('job-1', [])))

    expect(toastWarning).not.toHaveBeenCalled()
  })
})
