import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { api } from '@/lib/api'
import i18n from '@/lib/i18n'
import { NavBellPopover } from '@/components/shell/NavBellPopover'
import { ApplicationPage } from './ApplicationPage'
import { inmateRegisterHref } from './statistics/registerModel'
import { workflowMonth, workflowSubmission } from './statistics/workflowFixtures'

vi.mock('@/lib/api', async (original) => {
  const actual = await original<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api,
    listTemplates: vi.fn(), getSettings: vi.fn(), getTemplateFields: vi.fn(),
    getInmateRegisterMonth: vi.fn(), getInmateRegisterSubmissions: vi.fn(),
    getInmateRegisterSubmission: vi.fn(), getInmateRegisterTasks: vi.fn(),
  } }
})
vi.mock('@/lib/useCapabilities', () => ({ useCapabilities: () => ({
  isLoading: false,
  has: (capability: string) => capability === 'books.view' || capability === 'documents.generate' || capability.startsWith('books.service.'),
}) }))
vi.mock('@/lib/useIdentity', () => ({ useIdentity: () => ({ isAdmin: false }) }))
vi.mock('@/pages/leaves/useAwaitingReturnCount', () => ({ useAwaitingReturnCount: () => 0 }))
vi.mock('@/pages/ledger/outlook/useFlagCount', () => ({ useFlagCount: () => 0 }))
vi.mock('@/pages/scanBack/useScanBack', () => ({ useScanBack: () => ({ count: 0 }) }))
vi.mock('@/pages/scanInbox/useScanInboxCount', () => ({ useScanInboxCount: () => 0 }))
vi.mock('@/lib/applicationFormSchema', () => ({ buildZodSchema: () => z.object({}) }))
vi.mock('@/components/application/TemplateForm', () => ({ TemplateForm: () => <div data-testid="template-form" /> }))
vi.mock('@/components/application/AttachmentsBlock', () => ({ AttachmentsBlock: () => null }))
vi.mock('./EmployeeHeader', () => ({ EmployeeHeader: () => null }))
vi.mock('./JobStatus', () => ({ JobStatus: () => null }))
vi.mock('@/pages/books/WordHandoffDialog', () => ({ WordHandoffDialog: () => null }))
vi.mock('@/lib/formDrafts', () => ({ clearAllDrafts: vi.fn(), clearDraft: vi.fn(), loadDraft: vi.fn(() => null), saveDraft: vi.fn() }))
vi.mock('@/lib/useKeyboardShortcuts', () => ({ useShortcutAction: vi.fn() }))
vi.mock('@/hooks/useEmailBasket', () => ({ useEmailBasket: () => ({ baskets: [] }) }))
vi.mock('@/components/books/SavedRecordActions', () => ({ SavedRecordActions: () => null }))
vi.mock('./notifyToggle', () => ({ shouldShowNotifyToggle: () => false }))
vi.mock('./ApprovedViolationUpload', () => ({ ApprovedViolationUpload: () => <div data-testid="approved-upload" /> }))

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{location.pathname}{location.search}</output>
}

beforeEach(() => {
  vi.clearAllMocks()
  void i18n.changeLanguage('en')
  vi.mocked(api.listTemplates).mockResolvedValue({ items: ['Inmate Conduct Violations', 'Demo'].map((id) => ({
    id, name_en: id, name_ar: id, category: 'admin', notifies_employee: false,
  })) } as never)
  vi.mocked(api.getSettings).mockResolvedValue({ sms_autosend_enabled: false } as never)
  vi.mocked(api.getTemplateFields).mockResolvedValue({ meta: {}, needs_manager: false, needs_submitter: false, fields: [], attachment_slots: [] } as never)
  const month = workflowMonth()
  month.workflow = { ...month.workflow, state: 'awaiting_manager', active_submission_id: 42, allowed_actions: ['approve'] }
  vi.mocked(api.getInmateRegisterMonth).mockResolvedValue(month)
  vi.mocked(api.getInmateRegisterTasks).mockResolvedValue({ count: 1, items: [
    { year: 2026, month: 8, kind: 'approve', submission_id: 42, code: null, row_count: 0 },
  ] })
  vi.mocked(api.getInmateRegisterSubmissions).mockResolvedValue([
    { id: 42, sequence: 2, origin: 'workflow', created_at: '2026-08-20T08:00:00Z', approved_at: null, report_state: 'reviewed', current: true, stale: false },
  ])
  vi.mocked(api.getInmateRegisterSubmission).mockResolvedValue(workflowSubmission({ submission_id: 42, sequence: 2, report_state: 'reviewed' }))
})

describe('ApplicationPage same-path monthly task navigation', () => {
  it.each(['another form', 'create', 'upload'])('opens exact statistics from the bell while already showing %s', async (mode) => {
    const user = userEvent.setup()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[
      `/application?form=${mode === 'another form' ? 'demo' : 'inmate_conduct_violations'}`,
    ]}><NavBellPopover /><ApplicationPage /><LocationProbe /></MemoryRouter></QueryClientProvider>)
    expect(await screen.findByTestId('template-form')).toBeVisible()
    if (mode === 'upload') {
      await user.click(screen.getByRole('button', { name: 'Upload approved copy' }))
      expect(screen.getByTestId('approved-upload')).toBeVisible()
    }
    await user.click(await screen.findByRole('button', { name: 'Notifications, 1 unread' }))
    await user.click(screen.getByRole('button', { name: /August 2026/ }))
    await waitFor(() => expect(screen.getByRole('button', { name: i18n.t('application.approvedViolation.monthlyStatistics') })).toHaveAttribute('aria-pressed', 'true'))
    await waitFor(() => expect(api.getInmateRegisterSubmission).toHaveBeenCalledWith({ year: 2026, month: 8 }, 42))
    expect(screen.getByRole('button', { name: i18n.t('inmateStats.views.export') })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('template-form')).not.toBeVisible()
    expect(screen.queryByTestId('approved-upload')).not.toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent(inmateRegisterHref(2026, 8, 42))
  })
})
