import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from 'i18next'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import ar from '@/locales/ar.json'
import en from '@/locales/en.json'
import { FolderButton, FolderRail } from './FolderRail'

vi.mock('@/lib/api', () => ({
  api: {
    getLedgerUnreadCount: vi.fn().mockResolvedValue({ count: 7 }),
    getLedgerFlagCount: vi.fn().mockResolvedValue({ count: 2 }),
  },
}))

vi.mock('@/lib/useIdentity', () => ({
  useIdentity: () => ({
    identity: { email: 'operator@gssg.ae', name_en: 'Operator', name_ar: 'المشغّل' },
    isAdmin: false,
  }),
}))

vi.mock('./SmartFolders', () => ({ SmartFolders: () => null }))
const { capabilities } = vi.hoisted(() => ({ capabilities: new Set<string>(['ledger.view', 'ledger.send']) }))
vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({ has: (cap: string) => capabilities.has(cap) }),
}))

async function renderRail(language: 'en' | 'ar', header?: ReactNode): Promise<void> {
  await i18n.changeLanguage(language)
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  render(
    <QueryClientProvider client={queryClient}>
      <FolderRail
        header={header}
        activeView={{ kind: 'folder', folder: 'inbox' }}
        onSelectView={vi.fn()}
      />
    </QueryClientProvider>,
  )
}

describe('FolderRail personal folders after the Outlook cutover', () => {
  beforeAll(() => {
    i18n.addResourceBundle('en', 'translation', en, true, true)
    i18n.addResourceBundle('ar', 'translation', ar, true, true)
  })

  beforeEach(() => {
    localStorage.clear()
    capabilities.clear()
    capabilities.add('ledger.view')
    capabilities.add('ledger.send')
  })

  afterEach(cleanup)

  afterAll(async () => {
    await i18n.changeLanguage('en')
  })

  it('keeps the supported English folders and removes Drafts', async () => {
    await renderRail('en')

    const inbox = screen.getByRole('button', { name: /^Inbox/ })
    expect(await within(inbox).findByText('7')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sent' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Starred' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Trash' })).toBeInTheDocument()
    const followups = screen.getByRole('button', { name: /^Follow-ups/ })
    expect(await within(followups).findByText('2')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Drafts' })).not.toBeInTheDocument()
  })

  it('keeps the supported Arabic folders and removes Drafts', async () => {
    await renderRail('ar')

    const inbox = screen.getByRole('button', { name: /^الوارد/ })
    expect(await within(inbox).findByText('7')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'المُرسَل' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'المميّزة' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'المهملات' })).toBeInTheDocument()
    const followups = screen.getByRole('button', { name: /^للمتابعة/ })
    expect(await within(followups).findByText('2')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'المسودّات' })).not.toBeInTheDocument()
  })

  it('keeps mailbox browsing but hides New email without ledger.send even with ledger.create', async () => {
    capabilities.delete('ledger.send')
    capabilities.add('ledger.create')
    await renderRail('en')
    expect(screen.getByRole('button', { name: /^Inbox/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New email' })).not.toBeInTheDocument()
  })

  it.each(['en', 'ar'] as const)('shows its header first only while expanded in %s', async (language) => {
    await renderRail(language, <div data-testid="rail-header">Books | Email</div>)
    const rail = screen.getByRole('navigation', { name: i18n.t('ledger.title') })
    expect(rail.firstElementChild).toContainElement(screen.getByTestId('rail-header'))
    await userEvent.click(screen.getByRole('button', { name: i18n.t('ledger.outlook.collapseFolders') }))
    expect(screen.queryByTestId('rail-header')).not.toBeInTheDocument()
    expect(localStorage.getItem('ledger.railCollapsed')).toBe('1')
    await userEvent.click(screen.getByRole('button', { name: i18n.t('ledger.outlook.expandFolders') }))
    expect(screen.getByTestId('rail-header')).toBeVisible()
    expect(localStorage.getItem('ledger.railCollapsed')).toBe('0')
  })

  it('keeps the header hidden for a persisted collapsed rail', async () => {
    localStorage.setItem('ledger.railCollapsed', '1')
    await renderRail('en', <div data-testid="rail-header">Books | Email</div>)
    expect(screen.queryByTestId('rail-header')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Expand folders' })).toHaveAttribute('aria-expanded', 'false')
  })

  it.each(['en', 'ar'] as const)('exports an icon button with a muted zero count and active semantics in %s', async (language) => {
    await i18n.changeLanguage(language)
    const onClick = vi.fn()
    const label = i18n.t('ledger.outlook.folders.inbox')
    render(<FolderButton icon={<svg data-testid="folder-icon" />} label={label} active count={0} onClick={onClick} />)
    const button = screen.getByRole('button', { name: `${label} 0` })
    expect(button).toHaveAttribute('aria-current', 'page')
    expect(within(button).getByTestId('folder-icon').parentElement).toHaveAttribute('aria-hidden', 'true')
    expect(within(button).getByText('0')).toHaveClass('text-rail-faint', 'tabular-nums')
    await userEvent.click(button)
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('hides counts and keeps the accessible label and badge indicator when collapsed', () => {
    render(<FolderButton icon={<svg data-testid="folder-icon" />} label="Inbox" active={false} count={15} badge={2} collapsed onClick={vi.fn()} />)
    const button = screen.getByRole('button', { name: 'Inbox' })
    expect(button).toHaveAttribute('title', 'Inbox')
    expect(button).not.toHaveAttribute('aria-current')
    expect(within(button).queryByText('15')).not.toBeInTheDocument()
    expect(within(button).queryByText('2')).not.toBeInTheDocument()
    expect(within(button).getByTestId('folder-icon').parentElement?.querySelector('.bg-info')).not.toBeNull()
  })
})
