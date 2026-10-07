import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
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

const syntheticTiles = [
  ['National Service', 'services.national_service'],
  ['Duty Locations & Transfers', 'services.duty_locations'],
  ['Employee Absence', 'services.employee_absence'],
] as const

const allTileCapabilities = [
  'documents.generate',
  'books.view',
  'books.service.General Book',
  'leaves.view',
  'leaves.create',
  'leaves.edit',
  ...syntheticTiles.map(([, capability]) => capability),
]

function renderPage(entry = '/services') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/services/:slug?" element={<ApplicationPage />} />
        </Routes>
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
      'books.service.Demo companion',
    ])
    renderPage()

    expect(await screen.findByText('General Book')).toBeVisible()
    expect(screen.getByText('Demo companion')).toBeVisible()
  })

  it('hides a non-dashboard service whose capability is denied', async () => {
    capabilityState.allowed = new Set([
      'documents.generate',
      'books.view',
      'books.service.General Book',
    ])
    renderPage('/services/demo_companion')

    expect(await screen.findByText('General Book')).toBeVisible()
    expect(screen.queryByText('Demo companion')).not.toBeInTheDocument()
  })

  it('hides synthetic tiles whose destination capability is missing', async () => {
    capabilityState.allowed = new Set([
      'documents.generate',
      'books.view',
      ...syntheticTiles.map(([, capability]) => capability),
    ])
    renderPage()

    expect(await screen.findByText('No forms match your search.')).toBeVisible()
    for (const label of ['National Service', 'Duty Locations & Transfers', 'Employee Absence']) {
      expect(screen.queryByText(label)).not.toBeInTheDocument()
    }
  })

  it('uses calibrated artwork for synthetic and supported template tiles', async () => {
    capabilityState.allowed = new Set([
      'documents.generate',
      'books.view',
      'books.service.General Book',
      'leaves.view',
      'leaves.create',
      'leaves.edit',
    ])
    for (const [, capability] of syntheticTiles) capabilityState.allowed.add(capability)
    renderPage()

    for (const [label, artwork] of [
      ['National Service', 'national-service'],
      ['Duty Locations & Transfers', 'duty-locations'],
      ['Employee Absence', 'employee-absence'],
      ['General Book', 'general-book'],
    ]) {
      const text = await screen.findByText(label)
      const tile = text.closest('button')
      expect(tile).not.toBeNull()
      expect(tile?.querySelector(`[data-service-artwork="${artwork}"]`)).toBeInTheDocument()
    }
  })

  it.each(syntheticTiles)('denies and restores the %s tile independently', async (label, capability) => {
    capabilityState.allowed = new Set(allTileCapabilities)
    const initial = renderPage()
    expect(await screen.findByText(label)).toBeVisible()
    initial.unmount()

    capabilityState.allowed.delete(capability)
    const denied = renderPage()
    expect(await screen.findByText('General Book')).toBeVisible()
    expect(screen.queryByText(label)).not.toBeInTheDocument()
    for (const [otherLabel, otherCapability] of syntheticTiles) {
      if (otherCapability !== capability) expect(screen.getByText(otherLabel)).toBeVisible()
    }
    denied.unmount()

    capabilityState.allowed.add(capability)
    renderPage()
    expect(await screen.findByText(label)).toBeVisible()
  })

  it.each([
    ['National Service', 'leaves.view'],
    ['National Service', 'leaves.create'],
    ['Duty Locations & Transfers', 'documents.generate'],
    ['Duty Locations & Transfers', 'books.view'],
    ['Duty Locations & Transfers', 'books.service.General Book'],
    ['Employee Absence', 'leaves.view'],
    ['Employee Absence', 'leaves.edit'],
  ])('keeps %s hidden when destination gate %s is denied', async (label, missing) => {
    capabilityState.allowed = new Set(allTileCapabilities.filter((capability) => capability !== missing))
    renderPage()
    await screen.findByText(label === 'Duty Locations & Transfers' ? 'National Service' : 'Duty Locations & Transfers')
    expect(screen.queryByText(label)).not.toBeInTheDocument()
  })

  it.each([
    ['documents.generate', ['books.view', 'books.service.General Book']],
    ['books.view', ['documents.generate', 'books.service.General Book']],
    ['service access', ['documents.generate', 'books.view']],
  ])('does not show or deep-link a service missing %s', async (_missing, allowed) => {
    capabilityState.allowed = new Set([...allowed, 'leaves.view', 'leaves.create', 'services.national_service'])
    renderPage('/services/general_book')

    expect(await screen.findByText('National Service')).toBeVisible()
    expect(screen.queryByText('General Book')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Services/i })).not.toBeInTheDocument()
  })
})
