/**
 * ManagersSection component tests — add and deactivate flows.
 *
 * Covers:
 *  - Add flow: clicking Add, entering a name, clicking addAction → createManager called
 *  - Deactivate flow: clicking Deactivate, confirming in ConfirmDialog → updateManager(id, { active: false })
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/api', () => ({
  api: {
    listManagers: vi.fn(),
    listAuthUsers: vi.fn(),
    createManager: vi.fn(),
    updateManager: vi.fn(),
    linkManagerAccount: vi.fn(),
    uploadManagerSignature: vi.fn(),
    getManagerSignature: vi.fn(),
    deleteManagerSignature: vi.fn(),
  },
  apiErrorMessage: (e: unknown) => String(e),
}))
vi.mock('@/components/signature/SignatureDrawPanel', () => ({
  SignatureDrawPanel: () => null,
}))

import { api } from '@/lib/api'
import { ManagersSection } from './ManagersSection'

const MANAGER_ROW = {
  id: 1,
  name_en: 'Ada',
  name_ar: null,
  title: 'Director',
  active: true,
  user_id: null,
  user_name: null,
  has_signature: false,
}

function renderSection(): void {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <ManagersSection />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(api.listManagers).mockResolvedValue([MANAGER_ROW])
  vi.mocked(api.listAuthUsers).mockResolvedValue([])
})

describe('ManagersSection', () => {
  it('adds a manager — createManager called with entered name', async () => {
    vi.mocked(api.createManager).mockResolvedValue({
      id: 2,
      name_en: 'Grace',
      name_ar: null,
      title: null,
      active: true,
      user_id: null,
      user_name: null,
      has_signature: false,
    })

    renderSection()

    // Wait for the list to load, then open the add form
    fireEvent.click(await screen.findByText('settings.managers.add'))

    // Fill in the English name
    const nameInput = screen.getByPlaceholderText('settings.managers.nameEn')
    fireEvent.change(nameInput, { target: { value: 'Grace' } })

    // Submit
    fireEvent.click(screen.getByText('settings.managers.addAction'))

    await waitFor(() =>
      expect(api.createManager).toHaveBeenCalledWith(
        expect.objectContaining({ name_en: 'Grace' }),
      ),
    )
  })

  it('deactivates a manager after confirming in ConfirmDialog', async () => {
    vi.mocked(api.updateManager).mockResolvedValue({} as never)

    renderSection()

    // Wait for manager row to render, then click its Deactivate button
    fireEvent.click(await screen.findByText('settings.managers.deactivate'))

    // ConfirmDialog has the same confirmLabel ('settings.managers.deactivate')
    // There will now be two — the original row button (hidden behind dialog) and the dialog confirm button.
    const deactivateButtons = await screen.findAllByText('settings.managers.deactivate')
    // The last one is the AlertDialogAction (confirm button in the dialog)
    fireEvent.click(deactivateButtons[deactivateButtons.length - 1])

    await waitFor(() =>
      expect(api.updateManager).toHaveBeenCalledWith(1, { active: false }),
    )
  })
})
