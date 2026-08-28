import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

const capabilityState = vi.hoisted(() => ({ allowed: new Set<string>() }))

vi.mock('@/lib/api', () => ({
  api: {
    listTemplates: vi.fn(),
    getSettings: vi.fn(),
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
vi.mock('@/lib/applicationFormSchema', () => ({ buildZodSchema: () => z.object({}) }))
vi.mock('@/components/application/TemplateForm', () => ({ TemplateForm: () => null }))
vi.mock('@/components/application/AttachmentsBlock', () => ({ AttachmentsBlock: () => null }))
vi.mock('./EmployeeHeader', () => ({ EmployeeHeader: () => null }))
vi.mock('./JobStatus', () => ({ JobStatus: () => null }))
vi.mock('@/pages/books/WordHandoffDialog', () => ({ WordHandoffDialog: () => null }))
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
import { ApplicationPage } from './ApplicationPage'

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
    },
  ],
}

function renderPage(entry = '/application') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <ApplicationPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('ApplicationPage service permissions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    capabilityState.allowed = new Set()
    vi.mocked(api.listTemplates).mockResolvedValue(templates)
    vi.mocked(api.getSettings).mockResolvedValue({} as never)
  })

  it('shows service templates when all creation capabilities are granted', async () => {
    capabilityState.allowed = new Set([
      'documents.generate',
      'books.view',
      'books.service.General Book',
    ])
    renderPage()

    expect(await screen.findByText('General Book')).toBeVisible()
    expect(screen.getByText('Demo companion')).toBeVisible()
  })

  it.each([
    ['documents.generate', ['books.view', 'books.service.General Book']],
    ['books.view', ['documents.generate', 'books.service.General Book']],
    ['service access', ['documents.generate', 'books.view']],
  ])('does not show or deep-link a service missing %s', async (_missing, allowed) => {
    capabilityState.allowed = new Set(allowed)
    renderPage('/application?form=General%20Book')

    expect(await screen.findByText('Demo companion')).toBeVisible()
    expect(screen.queryByText('General Book')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Services/i })).not.toBeInTheDocument()
  })
})
