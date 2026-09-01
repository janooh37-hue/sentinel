import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import i18n from 'i18next'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import ar from '@/locales/ar.json'
import en from '@/locales/en.json'
import { FolderRail } from './FolderRail'

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

async function renderRail(language: 'en' | 'ar'): Promise<void> {
  await i18n.changeLanguage(language)
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  render(
    <QueryClientProvider client={queryClient}>
      <FolderRail
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
  })

  afterAll(async () => {
    await i18n.changeLanguage('en')
  })

  it('keeps the supported English folders and removes Drafts', async () => {
    await renderRail('en')

    expect(await screen.findByRole('button', { name: 'Inbox 7' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sent' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Starred' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Trash' })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Follow-ups 2' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Drafts' })).not.toBeInTheDocument()
  })

  it('keeps the supported Arabic folders and removes Drafts', async () => {
    await renderRail('ar')

    expect(await screen.findByRole('button', { name: 'الوارد 7' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'المُرسَل' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'المميّزة' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'المهملات' })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'للمتابعة 2' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'المسودّات' })).not.toBeInTheDocument()
  })
})
