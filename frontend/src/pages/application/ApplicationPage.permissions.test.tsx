import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

const capabilityState = vi.hoisted(() => ({ allowed: new Set<string>(), mobile: false }))

vi.mock('@/lib/api', () => ({
  api: {
    listTemplates: vi.fn(),
    getSettings: vi.fn(),
    getTemplateFields: vi.fn(),
    generateDocument: vi.fn(),
    listClassifications: vi.fn(),
    createWordBook: vi.fn(),
  },
  ApiError: class ApiError extends Error {},
  apiErrorMessage: (error: unknown) => String(error),
}))
vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({
    capabilities: capabilityState.allowed,
    isLoading: false,
    has: (capability: string) => capabilityState.allowed.has(capability),
  }),
}))
vi.mock('@/lib/useIsMobile', () => ({ useIsMobile: () => capabilityState.mobile }))
vi.mock('@/lib/applicationFormSchema', () => ({ buildZodSchema: () => z.object({}).passthrough() }))
vi.mock('@/components/application/TemplateForm', () => ({
  TemplateForm: ({ isClassificationAllowed, schema, onClassificationChange, onBodyModeChange, form }: {
    isClassificationAllowed?: (code: string) => boolean
    schema: { fields: { id: string }[] }
    onClassificationChange: (code: string) => void
    onBodyModeChange: (mode: 'editor' | 'word') => void
    form: UseFormReturn
  }) => (
    <FormProvider {...form}>
      {['7/1', '11/1', '1/1'].filter((code) => !isClassificationAllowed || isClassificationAllowed(code)).map((code) => <span key={code}>{code}</span>)}
      <button type="button" onClick={() => onClassificationChange('7/1')}>Choose classification</button>
      <button type="button" onClick={() => onBodyModeChange('editor')}>Use editor</button>
      <TestFormValues />
      {schema.fields.map((field) => <span key={field.id}>{field.id}</span>)}
    </FormProvider>
  ),
}))
vi.mock('@/components/application/AttachmentsBlock', () => ({ AttachmentsBlock: () => null }))
vi.mock('./EmployeeHeader', () => ({ EmployeeHeader: () => null }))
vi.mock('./JobStatus', () => ({ JobStatus: () => null }))
vi.mock('@/lib/formDrafts', () => ({
  clearAllDrafts: vi.fn(),
  clearDraft: vi.fn(),
  loadDraft: vi.fn(() => null),
  saveDraft: vi.fn(),
}))
vi.mock('@/lib/useKeyboardShortcuts', () => ({ useShortcutAction: vi.fn() }))
vi.mock('@/hooks/useEmailBasket', () => ({ useEmailBasket: () => ({ baskets: [] }) }))
vi.mock('@/components/books/SavedRecordActions', () => ({ SavedRecordActions: () => null }))
vi.mock('./notifyToggle', () => ({ shouldShowNotifyToggle: () => false }))
vi.mock('./ApprovedViolationUpload', () => ({ ApprovedViolationUpload: () => null }))

import { api } from '@/lib/api'
import { FormProvider, useFormContext, type UseFormReturn } from 'react-hook-form'
import { ApplicationPage } from './ApplicationPage'
import type { SessionUser } from '@/lib/api'
import { AuthContext, type AuthContextValue } from '@/lib/authContext'


function TestFormValues() {
  const { setValue } = useFormContext()
  return <button type="button" onClick={() => {
    setValue('subject', 'Fleet letter')
    setValue('recipient_id', 42)
    setValue('cc', ['Operations'])
    setValue('hand_sign_manager', true)
    setValue('hand_sign_employee', true)
  }}>Choose recipient</button>
}
const templates = {
  items: [
    {
      id: 'General Book',
      name_en: 'General Book',
      name_ar: 'الكتاب العام',
      form_number: '1',
      category: 'admin' as const,
      signing_path: 'auto' as const,
      has_code: false,
      notifies_employee: false,
      feature_minted: false,
    },
    {
      id: 'Demo companion',
      name_en: 'Demo companion',
      name_ar: 'نموذج مساعد',
      form_number: '2',
      category: 'admin' as const,
      signing_path: 'auto' as const,
      has_code: false,
      notifies_employee: false,
      feature_minted: false,
    },
  ],
}

function renderPage(entry = '/services', scopedRole: 'inmate_reporter' | 'fleet_reporter' | null = null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const user = { id: 7, employee_id: 'G7', role: scopedRole ?? 'operator', scoped_role: scopedRole } as SessionUser
  const auth: AuthContextValue = {
    user, status: 'authed', login: async () => user, logout: async () => undefined,
    refetch: async () => undefined, setUser: () => undefined,
  }
  return render(
    <QueryClientProvider client={client}>
      <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/services/:slug?" element={<ApplicationPage />} />
        </Routes>
      </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  )
}

describe('ApplicationPage service permissions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    capabilityState.allowed = new Set()
    capabilityState.mobile = false
    vi.mocked(api.listTemplates).mockResolvedValue(templates)
    vi.mocked(api.getSettings).mockResolvedValue({} as never)
    vi.mocked(api.listClassifications).mockResolvedValue([])
    vi.mocked(api.getTemplateFields).mockResolvedValue({
      meta: templates.items[0], needs_manager: true, needs_submitter: false,
      fields: [
        { id: 'subject', type: 'text', label_en: 'Subject', label_ar: 'الموضوع', required: true },
        { id: 'body', type: 'arabic_rich_full', label_en: 'Body', label_ar: 'نص الكتاب', required: true },
        { id: 'manager_id', type: 'manager_picker', label_en: 'Manager', label_ar: 'المدير', required: false },
        { id: 'recipient_id', type: 'recipient_picker', label_en: 'Recipient', label_ar: 'المستلم', required: false },
        { id: 'cc', type: 'recipient_multi_picker', label_en: 'CC', label_ar: 'نسخة إلى', required: false },
        { id: 'hand_sign_manager', type: 'hand_sign_checkbox', label_en: 'Manager signature', label_ar: 'توقيع المدير', required: false, default: 'true' },
        { id: 'hand_sign_employee', type: 'hand_sign_checkbox', label_en: 'Employee signature', label_ar: 'توقيع الموظف', required: false, default: 'true' },
      ],
    } as never)
  })

  it('shows service templates when all creation capabilities are granted', async () => {
    capabilityState.allowed = new Set([
      'documents.generate',
      'books.view',
      'books.service.General Book',
      'books.service.Demo companion',
    ])
    renderPage()

    fireEvent.click(await screen.findByText('Administration'))
    expect(screen.getByText('General Book')).toBeVisible()
    fireEvent.click(screen.getByText('All services'))
    fireEvent.click(screen.getByText('Other'))
    expect(screen.getByText('Demo companion')).toBeVisible()
  })

  it('hides a non-dashboard service whose capability is denied', async () => {
    capabilityState.allowed = new Set([
      'documents.generate',
      'books.view',
      'books.service.General Book',
    ])
    renderPage('/services/demo_companion')

    expect(await screen.findByText('Administration')).toBeVisible()
    expect(screen.queryByText('Other')).not.toBeInTheDocument()
  })

  it('hides synthetic tiles whose destination capability is missing', async () => {
    capabilityState.allowed = new Set(['documents.generate', 'books.view'])
    renderPage()

    expect(await screen.findByText('No forms match your search.')).toBeVisible()
    for (const label of ['National Service', 'Duty Locations & Transfers', 'Employee Absence']) {
      expect(screen.queryByText(label)).not.toBeInTheDocument()
    }
  })

  it('hides Duty Locations when duty transfer is denied even with General Book access', async () => {
    capabilityState.allowed = new Set([
      'documents.generate',
      'books.view',
      'books.service.General Book',
    ])
    renderPage()

    expect(await screen.findByText('Administration')).toBeVisible()
    expect(screen.queryByText('Employee Affairs')).not.toBeInTheDocument()
  })

  it('uses calibrated artwork for synthetic and supported template tiles', async () => {
    capabilityState.allowed = new Set([
      'documents.generate',
      'books.view',
      'books.service.General Book',
      'documents.duty_transfer',
      'leaves.view',
      'leaves.create',
      'leaves.edit',
    ])
    for (const [group, label, artwork] of [
      ['leave', 'National Service', 'national-service'],
      ['employee-affairs', 'Duty Locations & Transfers', 'duty-locations'],
      ['leave', 'Employee Absence', 'employee-absence'],
      ['administration', 'General Book', 'general-book'],
    ]) {
      renderPage(`/services?group=${group}`)
      const text = await screen.findByText(label)
      const tile = text.closest('button')
      expect(tile).not.toBeNull()
      expect(tile?.querySelector(`[data-service-artwork="${artwork}"]`)).toBeInTheDocument()
      cleanup()
    }
  })

  it.each([
    ['documents.generate', ['books.view', 'books.service.General Book']],
    ['books.view', ['documents.generate', 'books.service.General Book']],
    ['service access', ['documents.generate', 'books.view']],
  ])('does not show or deep-link a service missing %s', async (_missing, allowed) => {
    capabilityState.allowed = new Set([...allowed, 'leaves.view', 'leaves.create'])
    renderPage('/services/general_book')

    expect(await screen.findByText('Leave & Attendance')).toBeVisible()
    expect(screen.queryByText('Administration')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Services/i })).not.toBeInTheDocument()
  })

  it.each([false, true])('shows exactly the fleet General Book and Report tiles (mobile=%s)', (mobile) => {
    capabilityState.mobile = mobile
    capabilityState.allowed = new Set(['documents.generate', 'books.view', 'books.service.General Book', 'books.service.Report', 'books.service.Vehicle Fines'])
    renderPage('/services', 'fleet_reporter')
    const tiles = screen.getAllByRole('button')
    expect(tiles).toHaveLength(2)
    expect(tiles[0]).toHaveTextContent('General Book')
    expect(tiles[1]).toHaveTextContent('Report')
    expect(tiles[1]).toHaveProperty('disabled', mobile)
  })

  it.each([false, true])('keeps the inmate violations and Report tiles unchanged (mobile=%s)', (mobile) => {
    capabilityState.mobile = mobile
    renderPage('/services', 'inmate_reporter')
    const tiles = screen.getAllByRole('button')
    expect(tiles).toHaveLength(2)
    expect(tiles[0]).toHaveTextContent('Inmate Conduct Violations')
    expect(tiles[1]).toHaveTextContent('Report')
    expect(tiles[1]).toHaveProperty('disabled', mobile)
    expect(screen.queryByText('General Book')).not.toBeInTheDocument()
  })

  it('filters scoped General Book classifications and manager controls but keeps addressees', async () => {
    capabilityState.allowed = new Set(['documents.generate', 'books.view', 'books.service.General Book', 'books.category.7/1', 'books.category.11/1'])
    renderPage('/services/general_book', 'fleet_reporter')
    expect(await screen.findByText('7/1')).toBeVisible()
    expect(screen.getByText('11/1')).toBeVisible()
    expect(screen.queryByText('1/1')).not.toBeInTheDocument()
    for (const picker of ['manager_id', 'hand_sign_manager']) expect(screen.queryByText(picker)).not.toBeInTheDocument()
    for (const picker of ['recipient_id', 'cc']) expect(screen.getByText(picker)).toBeVisible()
    expect(api.getSettings).not.toHaveBeenCalled()
  })

  it.each(['word', 'editor'])('keeps scoped General Book addressees without manager embed (%s)', async (mode) => {
    capabilityState.allowed = new Set(['documents.generate', 'books.view', 'books.service.General Book', 'books.category.7/1'])
    // Keep the mutation pending: this test asserts the outgoing create, not job polling.
    vi.mocked(api.generateDocument).mockImplementation(() => new Promise(() => {}))
    vi.mocked(api.createWordBook).mockImplementation(() => new Promise(() => {}))
    renderPage('/services/general_book', 'fleet_reporter')
    fireEvent.click(await screen.findByText('Choose classification'))
    fireEvent.click(screen.getByText('Choose recipient'))
    if (mode === 'editor') fireEvent.click(screen.getByText('Use editor'))
    const submitButton = screen.getAllByRole('button', { name: mode === 'editor' ? /Preview/i : /Create.*Word/i })
      .find((button) => button.getAttribute('type') === 'submit')
    expect(submitButton).toBeDefined()
    fireEvent.click(submitButton!)
    await vi.waitFor(() => {
      const mutation = mode === 'editor' ? api.generateDocument : api.createWordBook
      expect(mutation).toHaveBeenCalled()
    })
    if (mode === 'editor') {
      const payload = vi.mocked(api.generateDocument).mock.calls[0][0]
      expect(payload.embed_signature).not.toHaveProperty('manager')
      expect(payload.fields).toMatchObject({ recipient_id: 42, cc: ['Operations'] })
    } else {
      expect(api.createWordBook).toHaveBeenCalledWith(expect.objectContaining({ recipient_id: 42, cc: ['Operations'], manager_id: null }))
    }
  })
})
