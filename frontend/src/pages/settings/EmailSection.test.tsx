/**
 * The Drafts folder is what "Draft in Outlook" writes into over IMAP, so a
 * mailbox that names it something other than `Drafts` must be able to say so
 * and have that survive a save.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as ApiModule from '@/lib/api'
import { api } from '@/lib/api'
import { EmailSection } from './EmailSection'

vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof ApiModule>()
  return {
    ...real,
    api: {
      ...real.api,
      getEmailAccount: vi.fn(),
      upsertEmailAccount: vi.fn(),
      testEmailConnection: vi.fn(),
      syncEmail: vi.fn(),
      deleteEmailAccount: vi.fn(),
      linkMyEmployee: vi.fn(),
    },
  }
})
vi.mock('@/lib/useIdentity', () => ({
  useIdentity: () => ({ identity: { email: 'me@gssg.ae', linked: true }, isAdmin: true }),
}))
vi.mock('@/lib/authContext', () => ({ useAuth: () => ({ setUser: vi.fn() }) }))
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}))
vi.mock('./SignatureSection', () => ({ SignatureSection: () => null }))
vi.mock('@/pages/application/EmployeePicker', () => ({ EmployeePicker: () => null }))

const ACCOUNT = {
  email: 'ops@gssg.ae',
  imap_host: 'imap.ionos.com',
  imap_port: 993,
  use_ssl: true,
  username: 'ops@gssg.ae',
  smtp_host: 'smtp.ionos.com',
  smtp_port: 587,
  smtp_use_tls: true,
  sent_folder: 'Sent',
  // A mailbox that does NOT use the default folder name.
  drafts_folder: 'Entwürfe',
  inbox_folder: 'INBOX',
  enabled: true,
  sync_interval_minutes: 5,
  linked_employee_id: 'G-1234',
}

function renderSection(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <EmailSection />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(api.getEmailAccount).mockResolvedValue(ACCOUNT as never)
  vi.mocked(api.upsertEmailAccount).mockResolvedValue(ACCOUNT as never)
})

describe('EmailSection drafts folder', () => {
  it('hydrates the configured drafts folder instead of the default', async () => {
    renderSection()
    const field = await screen.findByLabelText('Drafts folder')
    await waitFor(() => expect(field).toHaveValue('Entwürfe'))
  })

  it('carries an edited drafts folder into the save payload', async () => {
    renderSection()
    const field = await screen.findByLabelText('Drafts folder')
    await waitFor(() => expect(field).toHaveValue('Entwürfe'))

    await userEvent.clear(field)
    await userEvent.type(field, 'INBOX.Drafts')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(api.upsertEmailAccount).toHaveBeenCalledTimes(1))
    expect(vi.mocked(api.upsertEmailAccount).mock.calls[0][0]).toMatchObject({
      drafts_folder: 'INBOX.Drafts',
      // The neighbouring folders are untouched by the new field.
      sent_folder: 'Sent',
      inbox_folder: 'INBOX',
    })
  })
})
