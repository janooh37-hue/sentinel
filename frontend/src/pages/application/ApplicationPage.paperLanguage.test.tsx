import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import type * as ApiModule from '@/lib/api'
import { api } from '@/lib/api'
import { loadDraft, saveDraft } from '@/lib/formDrafts'
import i18n from '@/lib/i18n'
import { ApplicationPage } from './ApplicationPage'

vi.mock('@/lib/api', async (original) => {
  const actual = await original<typeof ApiModule>()
  return {
    ...actual,
    api: { ...actual.api, listTemplates: vi.fn(), getSettings: vi.fn(), getTemplateFields: vi.fn() },
  }
})
vi.mock('@/lib/useCapabilities', () => ({ useCapabilities: () => ({ isLoading: false, has: () => true }) }))
vi.mock('@/lib/applicationFormSchema', () => ({ buildZodSchema: () => z.object({}) }))
vi.mock('@/components/application/TemplateForm', () => ({ TemplateForm: () => <div data-testid="template-form" /> }))
vi.mock('@/components/application/AttachmentsBlock', () => ({ AttachmentsBlock: () => null }))
vi.mock('./EmployeeHeader', () => ({ EmployeeHeader: () => null }))
vi.mock('./JobStatus', () => ({ JobStatus: () => null }))
vi.mock('@/lib/formDrafts', () => ({ clearAllDrafts: vi.fn(), clearDraft: vi.fn(), loadDraft: vi.fn(() => null), saveDraft: vi.fn() }))
vi.mock('@/lib/useKeyboardShortcuts', () => ({ useShortcutAction: vi.fn() }))
vi.mock('@/hooks/useEmailBasket', () => ({ useEmailBasket: () => ({ baskets: [] }) }))
vi.mock('./notifyToggle', () => ({ shouldShowNotifyToggle: () => false }))

const EN = 'Material Request Form'
const AR = 'Material Request Form (Arabic)'
const field = (id: string) => ({ id, type: 'text', label_en: id, label_ar: id, required: false })

function LocationProbe(): React.JSX.Element {
  const location = useLocation()
  return <output data-testid="location">{location.pathname}</output>
}

function renderServices(entry: string): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/services/:slug?" element={<ApplicationPage />} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(async () => {
  vi.clearAllMocks()
  await i18n.changeLanguage('en')
  vi.mocked(api.listTemplates).mockResolvedValue({
    items: [
      { id: EN, name_en: 'Material Request Form', name_ar: 'طلب مواد', category: 'admin', notifies_employee: false },
      { id: AR, name_en: AR, name_ar: 'طلب مواد (عربي)', category: 'admin', notifies_employee: false },
    ],
  } as never)
  vi.mocked(api.getSettings).mockResolvedValue({ sms_autosend_enabled: false } as never)
  vi.mocked(api.getTemplateFields).mockImplementation(async (id: string) => ({
    meta: {},
    needs_manager: false,
    needs_submitter: false,
    fields: id === AR ? [field('delivery_date'), field('items')] : [field('delivery_date'), field('items'), field('motivation')],
    attachment_slots: [],
  }) as never)
})

describe('Material Request paper language tab', () => {
  it('shows one gallery tile for the two papers', async () => {
    renderServices('/services?group=logistics')

    expect(await screen.findByRole('button', { name: /Material Request Form/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: new RegExp(AR.replace(/[()]/g, '\\$&')) })).not.toBeInTheDocument()
  })

  it('opens on the Arabic paper when the UI is Arabic', async () => {
    await i18n.changeLanguage('ar')
    renderServices('/services/material_request')

    expect(await screen.findByRole('tab', { name: 'العربية' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('location')).toHaveTextContent('/services/material_request_arabic')
    expect(screen.getByRole('heading', { name: 'طلب مواد' })).toBeInTheDocument()
  })

  it('carries the shared fields to the other paper and keeps its own', async () => {
    vi.mocked(loadDraft).mockImplementation((id) =>
      id === EN ? { delivery_date: '2026-10-20', items: [{ description: 'Gloves' }], motivation: 'Stock' } : { delivery_date: 'old' },
    )
    const user = userEvent.setup()
    renderServices('/services/material_request')

    await user.click(await screen.findByRole('tab', { name: 'العربية' }))

    await waitFor(() => expect(screen.getByRole('tab', { name: 'العربية' })).toHaveAttribute('aria-selected', 'true'))
    expect(screen.getByTestId('location')).toHaveTextContent('/services/material_request_arabic')
    expect(saveDraft).toHaveBeenCalledWith(AR, {
      delivery_date: '2026-10-20',
      items: [{ description: 'Gloves' }],
      __attachments: expect.anything(),
    })
    expect(saveDraft).toHaveBeenCalledWith(EN, expect.objectContaining({ motivation: 'Stock' }))
  })

  it('keeps the English paper in the Arabic UI when the link asks for it', async () => {
    await i18n.changeLanguage('ar')
    renderServices('/services/material_request?paper=en')

    expect(await screen.findByRole('tab', { name: 'English' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/services\/material_request$/)
  })
})
