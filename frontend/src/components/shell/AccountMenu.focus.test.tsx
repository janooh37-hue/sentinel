import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api, type SessionUser } from '@/lib/api'
import { AuthProvider } from '@/lib/AuthProvider'
import i18n from '@/lib/i18n'

import { AccountMenu } from './AccountMenu'

const USER: SessionUser = {
  id: 7,
  email: 'abdulla@example.test',
  employee_id: 'G-1007',
  name_en: 'Abdulla Aldhaheri',
  name_ar: 'عبدالله الظاهري',
  position: 'Officer',
  department: 'Operations',
  photo_url: null,
  role: 'operator',
  status: 'active',
  is_admin: false,
  is_manager: false,
  has_signature: false,
  idle_lock_seconds: 1800,
  lock_layout: 'band',
}

function renderMenu(): void {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <AuthProvider>
          <AccountMenu onLock={vi.fn()} />
          <input aria-label="outside field" />
          <p>plain page text</p>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const trigger = (): Promise<HTMLElement> => screen.findByRole('button', { name: USER.email })

// The profile menu is role="dialog": keyboard and touch users must land inside it when it opens and come
// back to the button they used when it closes (the notifications popover already behaves this way).
describe.each([
  ['en', 'Account'],
  ['ar', 'الحساب'],
] as const)('AccountMenu dialog focus (%s)', (lang, dialogName) => {
  beforeEach(async () => {
    localStorage.clear()
    await i18n.changeLanguage(lang)
    vi.spyOn(api, 'authMe').mockResolvedValue(USER)
    vi.spyOn(api, 'getEmailAccount').mockResolvedValue(null)
    vi.spyOn(api, 'myCapabilities').mockResolvedValue([])
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await i18n.changeLanguage('en')
  })

  it('moves focus into the dialog when it opens', async () => {
    const user = userEvent.setup()
    renderMenu()
    await user.click(await trigger())

    const dialog = screen.getByRole('dialog', { name: dialogName })
    expect(dialog).toContainElement(document.activeElement as HTMLElement)
  })

  it('returns focus to the trigger when Escape closes it', async () => {
    const user = userEvent.setup()
    renderMenu()
    const button = await trigger()
    await user.click(button)
    expect(screen.getByRole('dialog', { name: dialogName })).toBeInTheDocument()

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog', { name: dialogName })).not.toBeInTheDocument()
    await waitFor(() => expect(button).toHaveFocus())
  })

  it('returns focus to the trigger when a tap on plain page content closes it', async () => {
    const user = userEvent.setup()
    renderMenu()
    const button = await trigger()
    await user.click(button)

    await user.click(screen.getByText('plain page text'))

    expect(screen.queryByRole('dialog', { name: dialogName })).not.toBeInTheDocument()
    await waitFor(() => expect(button).toHaveFocus())
  })

  it('does not steal focus from another field the outside tap landed on', async () => {
    const user = userEvent.setup()
    renderMenu()
    await user.click(await trigger())

    const field = screen.getByRole('textbox', { name: 'outside field' })
    await user.click(field)

    expect(screen.queryByRole('dialog', { name: dialogName })).not.toBeInTheDocument()
    // Focus return is deferred one task; give a wrongly-restored focus the chance to show up. (The project's
    // ES2023 lib predates Promise.withResolvers, hence the executor form.)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(field).toHaveFocus()
  })
})
