import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from 'i18next'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, type BookRead } from '@/lib/api'
import ar from '@/locales/ar.json'
import { LedgerReferencesPicker } from './LedgerReferencesPicker'
import { LedgerFoldersPicker } from './LedgerFoldersPicker'

const BOOK: BookRead = {
  id: 40, ref_number: 'GS-0040', subject: 'Leave plan', created_at: '2026-10-28T08:00:00Z',
  category_id: null, direction: null, stamp_style: null, deleted_at: null, urgency: null,
  approval_state: 'none', access_scope: 'full', grade: 'unclassified', distribution: 'organization',
  metadata_only: false, can_write: true, can_send: true, can_change_grade: true, can_sign: false,
  can_review: false, is_draft: false,
  doc_manager_has_signature: false, is_word_book: false, included_papers_revision: 0,
  included_papers_fixed_page_count: 0, included_papers_total_page_count: 0,
  current_template_id: 'Ledger Book', service_id: 'ledger',
}
function References({ initial = [] }: { initial?: number[] }): React.JSX.Element {
  const [value, onChange] = useState(initial)
  return <><LedgerReferencesPicker id="references" value={value} onChange={onChange} /><output>{JSON.stringify(value)}</output></>
}
function Folders(): React.JSX.Element {
  const [value, onChange] = useState<number[]>([])
  return <><LedgerFoldersPicker id="folders" value={value} onChange={onChange} /><output>{JSON.stringify(value)}</output></>
}
function mount(node: React.ReactNode): void {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{node}</QueryClientProvider>)
}
afterEach(async () => { cleanup(); vi.restoreAllMocks(); await i18n.changeLanguage('en') })

describe('paper bottom block selections', () => {
  it.each([
    ['en', 'References', 'Remove reference GS-0040'],
    ['ar', 'إشارة إلى', 'إزالة الإشارة إلى GS-0040'],
  ])('searches books, isolates the selected reference and date, and removes it in %s', async (language, label, remove) => {
    i18n.addResourceBundle('ar', 'translation', ar, true, true)
    await i18n.changeLanguage(language)
    const list = vi.spyOn(api, 'listBooks').mockResolvedValue({ items: [BOOK], total: 1, limit: 8, offset: 0 })
    vi.spyOn(api, 'getBook').mockResolvedValue(BOOK)
    mount(<References />)
    await userEvent.type(screen.getByLabelText(label), 'Leave')
    await waitFor(() => expect(list).toHaveBeenCalledWith({ q: 'Leave', limit: 8 }))
    await userEvent.click(await screen.findByRole('button', { name: /GS-0040.*Leave plan/ }))
    expect(screen.getByText('[40]')).toBeInTheDocument()
    expect(screen.getByText('GS-0040').closest('bdi')).toHaveAttribute('dir', 'ltr')
    expect(screen.getByText('28/10/2026')).toHaveAttribute('dir', 'ltr')
    await userEvent.click(screen.getByRole('button', { name: remove }))
    expect(screen.getByText('[]')).toBeInTheDocument()
  })

  it('keeps existing references after reload and stops at twenty', async () => {
    vi.spyOn(api, 'getBook').mockImplementation(async (id) => ({ ...BOOK, id, ref_number: `GS-${id}` }))
    const list = vi.spyOn(api, 'listBooks').mockResolvedValue({ items: [BOOK], total: 1, limit: 8, offset: 0 })
    mount(<References initial={Array.from({ length: 20 }, (_, n) => n + 1)} />)
    expect(await screen.findByRole('button', { name: 'Remove reference GS-1' })).toBeInTheDocument()
    expect(screen.getByLabelText('References')).toBeDisabled()
    expect(list).not.toHaveBeenCalled()
  })
  it('uses the selected book paper date rather than its creation date', async () => {
    vi.spyOn(api, 'getBook').mockResolvedValue({ ...BOOK, versions: [{ id: 71, version_no: 1, trigger: 'initial', status: 'draft', has_fields: true, created_at: BOOK.created_at, manager_sig_embedded: false }] })
    vi.spyOn(api, 'getBookVersionFields').mockResolvedValue({ fields: { date: '2026-11-02' } })
    mount(<References initial={[40]} />)
    expect(await screen.findByText('02/11/2026')).toHaveAttribute('dir', 'ltr')
    expect(api.getBook).toHaveBeenCalledWith(40, undefined, { markRead: false })
  })

  it('limits folder copies to ten while allowing removal', async () => {
    const base = { team: false, count: 0, can_manage: true, created_by_name: 'Writer', created_by_name_ar: null, everyone: false, shared_users: [], shared_departments: [] }
    vi.spyOn(api, 'listBookFolders').mockResolvedValue(Array.from({ length: 11 }, (_, n) => ({ ...base, id: n + 1, name: `File ${n + 1}`, box: 'outgoing' })))
    mount(<Folders />)
    const first = await screen.findByRole('checkbox', { name: 'File 1' })
    for (let n = 1; n <= 10; n++) await userEvent.click(screen.getByRole('checkbox', { name: `File ${n}` }))
    expect(screen.getByRole('checkbox', { name: 'File 11' })).toBeDisabled()
    await userEvent.click(first)
    expect(screen.getByRole('checkbox', { name: 'File 11' })).toBeEnabled()
  })


  it.each([['en', 'Copy to folder'], ['ar', 'نسخة إلى الملف']])('offers only visible outgoing folders in %s', async (language, label) => {
    i18n.addResourceBundle('ar', 'translation', ar, true, true)
    await i18n.changeLanguage(language)
    const base = { team: false, count: 0, can_manage: true, created_by_name: 'Writer', created_by_name_ar: null, everyone: false, shared_users: [], shared_departments: [] }
    vi.spyOn(api, 'listBookFolders').mockResolvedValue([
      { ...base, id: 1, name: 'Outgoing file', box: 'outgoing' },
      { ...base, id: 2, name: 'Incoming file', box: 'incoming' },
      { ...base, id: 3, name: 'Shared team', box: 'outgoing', team: true, can_manage: false },
    ])
    mount(<Folders />)
    const group = screen.getByRole('group', { name: label })
    await userEvent.click(await within(group).findByRole('checkbox', { name: 'Outgoing file' }))
    await userEvent.click(within(group).getByRole('checkbox', { name: 'Shared team' }))
    expect(screen.getByText('[1,3]')).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Incoming file' })).not.toBeInTheDocument()
    await userEvent.click(within(group).getByRole('checkbox', { name: 'Outgoing file' }))
    expect(screen.getByText('[3]')).toBeInTheDocument()
  })
})
