import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/lib/api'
import type { LedgerEntryRead } from '@/lib/api'
import { ReadingPane } from './ReadingPane'
import { useContextSource } from './useContextSource'
import { rewriteCidReferences } from '@/lib/cidRewrite'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }))
vi.mock('@/lib/useIsMobile', () => ({ useIsMobile: () => false }))
vi.mock('@/lib/authContext', () => ({ useAuth: () => ({ user: { id: 1 } }) }))
vi.mock('@/lib/api', async (original) => {
  const real = await original<typeof import('@/lib/api')>()
  return { ...real, api: { ...real.api, getLedgerEntry: vi.fn(), listLedgerThread: vi.fn().mockResolvedValue([]), markLedgerEntryRead: vi.fn().mockResolvedValue({}) } }
})
afterEach(() => { cleanup(); vi.clearAllMocks() })
const entry = (owner: number | null) => ({ id: 42, owner_user_id: owner, channel: 'email', direction: 'incoming', read_at: null, subject: 'Scoped email', counterparty: 'Sender', entry_date: '2026-10-23', tags: [], attachments: [], attachment_paths: [] }) as unknown as LedgerEntryRead
function ContextProbe({ scope }: { scope?: 'mine' | 'all' }) { useContextSource(42, 'mail', scope); return null }
function open(owner: number | null) {
  vi.mocked(api.getLedgerEntry).mockResolvedValue(entry(owner))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><ReadingPane entryId={42} scope="all" /><ContextProbe scope="all" /></QueryClientProvider>)
  return client
}
describe('All-mail read scope', () => {
  it.each([2, null])('does not mark foreign or legacy owner %s mail read', async (owner) => {
    open(owner)
    await screen.findByRole('region', { name: 'Scoped email' })
    expect(api.markLedgerEntryRead).not.toHaveBeenCalled()
  })
  it('still marks own mail read in All mail', async () => {
    open(1)
    await waitFor(() => expect(api.markLedgerEntryRead).toHaveBeenCalledWith(42))
  })
  it('scopes detail hydration, thread reads and cache keys', async () => {
    const client = open(2)
    await screen.findByRole('region', { name: 'Scoped email' })
    expect(api.getLedgerEntry).toHaveBeenCalledWith(42, 'all')
    expect(api.listLedgerThread).toHaveBeenCalledWith(42, 50, 'all')
    expect(client.getQueryData(['ledger-entry', 42, 'all'])).toBeDefined()
    expect(client.getQueryData(['ledger-entry', 42])).toBeUndefined()
  })
  it('scopes all attachment URL variants and inline cid images', () => {
    expect(api.ledgerAttachmentUrl(42, 0, { scope: 'all' })).toContain('?scope=all')
    expect(api.ledgerAttachmentUrl(42, 0, { inline: true, scope: 'all' })).toContain('scope=all')
    expect(api.ledgerAttachmentUrl(42, 0, { base64: true, scope: 'all' })).toContain('scope=all')
    expect(api.ledgerAttachmentsZipUrl(42, 'all')).toContain('?scope=all')
    expect(rewriteCidReferences('<img src="cid:logo">', { logo: 'logo.png' }, 42, ['logo.png'], 'all')).toContain('?scope=all')
  })
})
