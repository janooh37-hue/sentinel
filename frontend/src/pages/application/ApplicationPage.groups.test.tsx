import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as ApiModule from '@/lib/api'
import type * as AuthContextModule from '@/lib/authContext'
import { api } from '@/lib/api'
import i18n from '@/lib/i18n'
import { ApplicationPage } from './ApplicationPage'

vi.mock('@/lib/api', async (original) => {
  const actual = await original<typeof ApiModule>()
  return { ...actual, api: { ...actual.api, listTemplates: vi.fn(), getSettings: vi.fn(), getTemplateFields: vi.fn() } }
})
vi.mock('@/lib/authContext', async (importOriginal) => ({
  ...(await importOriginal<typeof AuthContextModule>()),
  useAuth: () => ({ user: { id: 1 }, status: 'authed' }),
}))
vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({ isLoading: false, has: () => true }),
}))
vi.mock('@/lib/useIdentity', () => ({ useIdentity: () => ({ isAdmin: false }) }))
vi.mock('@/lib/useKeyboardShortcuts', () => ({ useShortcutAction: vi.fn() }))
vi.mock('@/hooks/useEmailBasket', () => ({ useEmailBasket: () => ({ baskets: [] }) }))

function LocationProbe(): React.JSX.Element {
  const location = useLocation()
  return <output data-testid="location">{location.pathname}{location.search}</output>
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

function template(id: string): Record<string, unknown> {
  return { id, name_en: id, name_ar: id, category: 'admin', notifies_employee: false, has_code: true }
}

beforeEach(() => {
  vi.clearAllMocks()
  void i18n.changeLanguage('en')
  vi.mocked(api.listTemplates).mockResolvedValue({
    items: ['Inmate Conduct Violations', 'General Book', 'Brand New Form'].map(template),
  } as never)
  vi.mocked(api.getSettings).mockResolvedValue({ sms_autosend_enabled: false } as never)
  vi.mocked(api.getTemplateFields).mockResolvedValue(
    { meta: {}, needs_manager: false, needs_submitter: false, fields: [], attachment_slots: [] } as never,
  )
})

describe('Services gallery folders', () => {
  it('opens on folders, hides services until a folder is opened, and counts only openable services', async () => {
    const user = userEvent.setup()
    renderServices('/services')


    // Inmates: the form plus its two split-out entry modes (import + monthly stats).
    expect(await screen.findByRole('button', { name: /Inmates.*3 services/ })).toBeVisible()
    expect(screen.queryByRole('button', { name: /General Book/ })).toBeNull()

    await user.click(screen.getByRole('button', { name: /Administration/ }))
    expect(screen.getByRole('button', { name: /General Book/ })).toBeVisible()
    expect(screen.getByTestId('location')).toHaveTextContent('?group=administration')
  })

  it('lists a template no folder claims under Other so it is never invisible', async () => {
    const user = userEvent.setup()
    renderServices('/services')

    await user.click(await screen.findByRole('button', { name: /Other.*1 service/ }))
    expect(screen.getByRole('button', { name: /Brand New Form/ })).toBeVisible()
  })

  it('searches across every folder', async () => {
    renderServices('/services?q=general')

    expect(await screen.findByRole('button', { name: /General Book/ })).toBeVisible()
    expect(screen.queryByRole('button', { name: /Inmates/ })).toBeNull()
  })

  it('opens the signed-violation import and the monthly statistics as their own services', async () => {
    const user = userEvent.setup()
    renderServices('/services?group=inmates')

    await user.click(await screen.findByRole('button', { name: new RegExp(i18n.t('application.importSignedViolation')) }))
    expect(screen.getByTestId('location')).toHaveTextContent('/services/inmate_conduct_violations?mode=upload')
  })
})

describe('Folder preview panel', () => {
  it('previews three services and counts the rest, hidden from assistive tech', async () => {
    vi.mocked(api.listTemplates).mockResolvedValue({
      items: [
        'Leave Application Form',
        'Leave Permit Form',
        'Administrative Leave Form',
        'Duty Resumption Form',
        'Staff Attendance Form',
        'Leave Encashment Form',
      ].map(template),
    } as never)
    renderServices('/services')

    const folder = await screen.findByRole('button', { name: /Leave & Attendance/ })
    const panel = folder.querySelector('[aria-hidden="true"]')
    expect(panel).not.toBeNull()
    // 6 templates + 2 synthetic services (absence, national service) = 8 → 3 icons + "+5".
    expect(panel).toHaveTextContent('+5')
    expect(folder).toHaveAccessibleName(/Leave & Attendance 8 services/)
  })

  it('shows no overflow cell when a folder has three or fewer services', async () => {
    renderServices('/services')

    const folder = await screen.findByRole('button', { name: /Administration/ })
    expect(folder.querySelector('[aria-hidden="true"]')?.textContent ?? '').not.toContain('+')
  })
})
