import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as ApiModule from '@/lib/api'
import { api } from '@/lib/api'
import type { LedgerEntryRead, SmartFolder, SmartFolderSuggestion } from '@/lib/api'
import { StarButton } from '@/components/ledger/StarButton'
import { RecipientChips } from '@/components/ledger/RecipientChips'
import { LedgerAttachments } from '@/components/ledger/LedgerAttachments'
import { SendToVaultDialog } from '@/components/ledger/SendToVaultDialog'
import { FlagPopover } from './FlagPopover'
import { SelectionBar } from './SelectionBar'
import { SmartFolders } from './SmartFolders'
import { SuggestionBanner } from './SuggestionBanner'
import { ReviewSuggestionsSheet } from './ReviewSuggestionsSheet'
import { CreateSmartFolderDialog } from './CreateSmartFolderDialog'
import { RenameSmartFolderDialog } from './RenameSmartFolderDialog'
import { ReadingPane } from './ReadingPane'
import { MessageListRow } from './MessageListRow'

const { capabilities } = vi.hoisted(() => ({ capabilities: new Set<string>() }))
vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({ has: (cap: string) => capabilities.has(cap) }),
}))
vi.mock('@/lib/authContext', () => ({ useAuth: () => ({ user: { id: 1 } }) }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}))
vi.mock('@/lib/toast', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}))
vi.mock('@/pages/application/EmployeePicker', () => ({
  EmployeePicker: ({ onSelect }: { onSelect: (id: string) => void }) => (
    <button type="button" onClick={() => onSelect('G123')}>Choose employee</button>
  ),
}))
vi.mock('@/lib/api', async (original) => {
  const real = await original<typeof ApiModule>()
  return {
    ...real,
    api: {
      ...real.api,
      toggleLedgerStar: vi.fn(),
      flagLedgerEntry: vi.fn(),
      unflagLedgerEntry: vi.fn(),
      markLedgerEntryRead: vi.fn(),
      markLedgerEntryUnread: vi.fn(),
      listSmartFolders: vi.fn(),
      getSmartFolderSuggestions: vi.fn(),
      dismissSmartFolderSuggestion: vi.fn(),
      createSmartFolder: vi.fn(),
      updateSmartFolder: vi.fn(),
      deleteSmartFolder: vi.fn(),
      listLedgerContacts: vi.fn(),
      addLedgerContact: vi.fn(),
      sendAttachmentToVault: vi.fn(),
      getLedgerEntry: vi.fn(),
      listLedgerThread: vi.fn(),
    },
  }
})

const folder: SmartFolder = { id: 3, name_en: 'Transfers', name_ar: 'النقل', count: 5 }
const suggestion: SmartFolderSuggestion = {
  cluster_key: 'transfer', name_suggestion: 'Transfers', count: 5,
  correspondent_count: 2, sample_subjects: ['Transfer request'],
}
const mail: LedgerEntryRead = {
  id: 42, entry_date: '2026-10-29', direction: 'incoming', channel: 'email',
  owner_user_id: 1, counterparty: 'Sender <sender@example.ae>', subject: 'Transfer request',
  notes_html: '<p>Letter</p>', attachment_paths: [], attachments: [], tags: [],
  related_book_id: null, related_employee_id: null, created_at: '2026-10-29T09:00:00Z',
  updated_at: null, created_by: 'Operator', deleted_at: null, read_at: '2026-10-29T09:00:00Z',
  flagged: false, to_recipients: [{ name: 'HR', address: 'hr@example.ae' }],
}

function mount(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const view = render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
  return {
    rerender: (next: ReactNode) => view.rerender(<QueryClientProvider client={client}>{next}</QueryClientProvider>),
  }
}

beforeEach(() => {
  capabilities.clear()
  capabilities.add('ledger.view')
  vi.clearAllMocks()
  vi.mocked(api.listSmartFolders).mockResolvedValue([folder])
  vi.mocked(api.getSmartFolderSuggestions).mockResolvedValue([suggestion])
  vi.mocked(api.createSmartFolder).mockResolvedValue(folder)
  vi.mocked(api.updateSmartFolder).mockResolvedValue(folder)
  vi.mocked(api.deleteSmartFolder).mockResolvedValue(undefined)
  vi.mocked(api.dismissSmartFolderSuggestion).mockResolvedValue(undefined)
  vi.mocked(api.toggleLedgerStar).mockResolvedValue({ ...mail, tags: ['starred'] })
  vi.mocked(api.flagLedgerEntry).mockResolvedValue({ ...mail, flagged: true })
  vi.mocked(api.unflagLedgerEntry).mockResolvedValue(mail)
  vi.mocked(api.markLedgerEntryRead).mockResolvedValue(mail)
  vi.mocked(api.markLedgerEntryUnread).mockResolvedValue({ ...mail, read_at: null })
  vi.mocked(api.listLedgerContacts).mockResolvedValue([])
  vi.mocked(api.addLedgerContact).mockResolvedValue({ id: 7, display_name: 'HR', address: 'hr@example.ae', created_at: mail.created_at })
  vi.mocked(api.getLedgerEntry).mockResolvedValue(mail)
  vi.mocked(api.listLedgerThread).mockResolvedValue([])
})
afterEach(cleanup)

describe('Ledger edit and read boundaries', () => {
  it('keeps the star state visible but cannot toggle without ledger.edit', async () => {
    const view = mount(<StarButton entryId={42} starred />)
    const star = screen.getByRole('button', { name: 'ledger.star.toggle' })
    expect(star).toHaveAttribute('aria-pressed', 'true')
    expect(star).toBeDisabled()
    await userEvent.click(star)
    expect(api.toggleLedgerStar).not.toHaveBeenCalled()
    capabilities.add('ledger.edit')
    view.rerender(<StarButton entryId={42} starred />)
    await userEvent.click(screen.getByRole('button', { name: 'ledger.star.toggle' }))
    await waitFor(() => expect(api.toggleLedgerStar).toHaveBeenCalledWith(42))
  })

  it('guards setting due dates and clearing flags with ledger.edit', async () => {
    const view = mount(<FlagPopover entryId={42} flagged={false} />)
    expect(screen.getByRole('button', { name: 'ledger.flag.set' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'ledger.flag.set' }))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    capabilities.add('ledger.edit')
    view.rerender(<FlagPopover entryId={42} flagged={false} />)
    await userEvent.click(screen.getByRole('button', { name: 'ledger.flag.set' }))
    await userEvent.click(screen.getByRole('menuitem', { name: /ledger.flag.presets.today/ }))
    await waitFor(() => expect(api.flagLedgerEntry).toHaveBeenCalledWith(42, expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/)))
    capabilities.delete('ledger.edit')
    view.rerender(<FlagPopover entryId={42} flagged />)
    expect(screen.getByRole('button', { name: 'ledger.flag.clear' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'ledger.flag.clear' }))
    expect(api.unflagLedgerEntry).not.toHaveBeenCalled()
    capabilities.add('ledger.edit')
    view.rerender(<FlagPopover entryId={42} flagged />)
    await userEvent.click(screen.getByRole('button', { name: 'ledger.flag.clear' }))
    await waitFor(() => expect(api.unflagLedgerEntry).toHaveBeenCalledWith(42))
  })

  it('keeps bulk read and unread available to viewers but separates edit and trash', async () => {
    const onTrash = vi.fn()
    const onClear = vi.fn()
    const view = mount(<SelectionBar ids={[42, 7]} onClear={onClear} onTrash={onTrash} />)
    for (const name of ['ledger.bulk.star', 'ledger.bulk.flag', 'ledger.bulk.trash']) {
      expect(screen.getByRole('button', { name })).toBeDisabled()
      await userEvent.click(screen.getByRole('button', { name }))
    }
    expect(api.toggleLedgerStar).not.toHaveBeenCalled()
    expect(api.flagLedgerEntry).not.toHaveBeenCalled()
    expect(onTrash).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'ledger.bulk.read' }))
    await waitFor(() => expect(api.markLedgerEntryRead).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByRole('button', { name: 'ledger.bulk.unread' })).toBeEnabled())
    await userEvent.click(screen.getByRole('button', { name: 'ledger.bulk.unread' }))
    await waitFor(() => expect(api.markLedgerEntryUnread).toHaveBeenCalledTimes(2))
    capabilities.add('ledger.edit')
    view.rerender(<SelectionBar ids={[42, 7]} onClear={onClear} onTrash={onTrash} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'ledger.bulk.flag' })).toBeEnabled())
    await userEvent.click(screen.getByRole('button', { name: 'ledger.bulk.flag' }))
    await waitFor(() => expect(api.flagLedgerEntry).toHaveBeenCalledWith(42, null))
    expect(api.flagLedgerEntry).toHaveBeenCalledWith(7, null)
    expect(screen.getByRole('button', { name: 'ledger.bulk.trash' })).toBeDisabled()
  })

  it('keeps reading available but hides Reply/all, Forward and Delete from a view-only pane', async () => {
    capabilities.add('ledger.create')
    const onReply = vi.fn()
    const onReplyAll = vi.fn()
    const onForward = vi.fn()
    const onDelete = vi.fn()
    const pane = () => <ReadingPane entryId={42} onReply={onReply} onReplyAll={onReplyAll} onForward={onForward} onDelete={onDelete} />
    const view = mount(pane())
    await screen.findByRole('region', { name: mail.subject })
    for (const name of ['ledger.outlook.reply', 'ledger.outlook.replyAll', 'ledger.outlook.forward', 'ledger.outlook.delete']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
    }
    capabilities.add('ledger.send')
    view.rerender(pane())
    await userEvent.click(screen.getByRole('button', { name: 'ledger.outlook.reply' }))
    await userEvent.click(screen.getByRole('button', { name: 'ledger.outlook.replyAll' }))
    await userEvent.click(screen.getByRole('button', { name: 'ledger.outlook.forward' }))
    expect(onReply).toHaveBeenCalledWith(mail)
    expect(onReplyAll).toHaveBeenCalledWith(mail)
    expect(onForward).toHaveBeenCalledWith(mail)
    expect(onDelete).not.toHaveBeenCalled()
  })

  it('does not expose row trash to a viewer', () => {
    const onDelete = vi.fn()
    mount(<MessageListRow entry={{ ...mail, attachment_count: 0, snippet: '' }} selected={false} onSelect={vi.fn()} onDelete={onDelete} />)
    expect(screen.queryByRole('button', { name: 'ledger.outlook.delete' })).not.toBeInTheDocument()
    expect(onDelete).not.toHaveBeenCalled()
  })
})

describe('Smart-folder permission boundaries', () => {
  it('shows existing folders without offering edit actions even with ledger.delete', async () => {
    capabilities.add('ledger.delete')
    const onSelectView = vi.fn()
    mount(<SmartFolders activeView={{ kind: 'folder', folder: 'inbox' }} onSelectView={onSelectView} onReviewSuggestions={vi.fn()} suggestionCount={0} />)
    await userEvent.click(await screen.findByRole('button', { name: /Transfers/ }))
    expect(onSelectView).toHaveBeenCalledWith({ kind: 'smart', folderId: 3 })
    expect(screen.queryByRole('button', { name: 'ledger.smart.rowActions' })).not.toBeInTheDocument()
  })

  it('uses ledger.edit, not ledger.delete, to delete a smart folder', async () => {
    capabilities.add('ledger.edit')
    mount(<SmartFolders activeView={{ kind: 'smart', folderId: 3 }} onSelectView={vi.fn()} onReviewSuggestions={vi.fn()} suggestionCount={0} />)
    await userEvent.click(await screen.findByRole('button', { name: 'ledger.smart.rowActions' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'ledger.smart.delete' }))
    await userEvent.click(within(screen.getByRole('dialog', { name: 'ledger.smart.deleteTitle' })).getByRole('button', { name: 'ledger.smart.delete' }))
    await waitFor(() => expect(api.deleteSmartFolder).toHaveBeenCalledWith(3))
  })

  it('rechecks edit permission when confirming folder deletion', async () => {
    capabilities.add('ledger.edit')
    const props = { activeView: { kind: 'smart' as const, folderId: 3 }, onSelectView: vi.fn(), onReviewSuggestions: vi.fn(), suggestionCount: 0 }
    const view = mount(<SmartFolders {...props} />)
    await userEvent.click(await screen.findByRole('button', { name: 'ledger.smart.rowActions' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'ledger.smart.delete' }))
    capabilities.delete('ledger.edit')
    view.rerender(<SmartFolders {...props} />)
    await userEvent.click(within(screen.getByRole('dialog', { name: 'ledger.smart.deleteTitle' })).getByRole('button', { name: 'ledger.smart.delete' }))
    expect(api.deleteSmartFolder).not.toHaveBeenCalled()
  })

  it('guards rename submission after edit access changes', async () => {
    capabilities.add('ledger.edit')
    const props = { folder, open: true, onOpenChange: vi.fn() }
    const view = mount(<RenameSmartFolderDialog {...props} />)
    await userEvent.clear(screen.getByLabelText('ledger.smart.nameEn'))
    await userEvent.type(screen.getByLabelText('ledger.smart.nameEn'), 'Reviewed transfers')
    capabilities.delete('ledger.edit')
    view.rerender(<RenameSmartFolderDialog {...props} />)
    const save = screen.getByRole('button', { name: 'common.save' })
    expect(save).toBeDisabled()
    fireEvent.submit(save.closest('form')!)
    expect(api.updateSmartFolder).not.toHaveBeenCalled()
    capabilities.add('ledger.edit')
    view.rerender(<RenameSmartFolderDialog {...props} />)
    await userEvent.click(screen.getByRole('button', { name: 'common.save' }))
    await waitFor(() => expect(api.updateSmartFolder).toHaveBeenCalledWith(3, { name_en: 'Reviewed transfers', name_ar: folder.name_ar }))
  })

  it('separates suggestion dismissal (edit) from creation (create)', async () => {
    capabilities.add('ledger.create')
    const props = { suggestion, total: 1, onReview: vi.fn() }
    const view = mount(<SuggestionBanner {...props} />)
    expect(screen.getByRole('button', { name: 'ledger.smart.dismiss' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'ledger.smart.dismiss' }))
    expect(api.dismissSmartFolderSuggestion).not.toHaveBeenCalled()
    capabilities.add('ledger.edit')
    view.rerender(<SuggestionBanner {...props} />)
    await userEvent.click(screen.getByRole('button', { name: 'ledger.smart.dismiss' }))
    await waitFor(() => expect(api.dismissSmartFolderSuggestion).toHaveBeenCalledWith('transfer'))
  })

  it('gates both review-sheet actions independently', async () => {
    const onCreate = vi.fn()
    const props = { open: true, onOpenChange: vi.fn(), onCreate }
    const view = mount(<ReviewSuggestionsSheet {...props} />)
    expect(await screen.findByRole('button', { name: 'ledger.smart.createDots' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'ledger.smart.dismiss' })).toBeDisabled()
    capabilities.add('ledger.create')
    view.rerender(<ReviewSuggestionsSheet {...props} />)
    await userEvent.click(screen.getByRole('button', { name: 'ledger.smart.createDots' }))
    expect(onCreate).toHaveBeenCalledWith(suggestion)
    expect(screen.getByRole('button', { name: 'ledger.smart.dismiss' })).toBeDisabled()
    capabilities.delete('ledger.create')
    capabilities.add('ledger.edit')
    view.rerender(<ReviewSuggestionsSheet {...props} />)
    expect(screen.getByRole('button', { name: 'ledger.smart.createDots' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'ledger.smart.dismiss' }))
    await waitFor(() => expect(api.dismissSmartFolderSuggestion).toHaveBeenCalledWith('transfer'))
  })

  it('rechecks create on suggestion confirmation before writing a folder', async () => {
    capabilities.add('ledger.create')
    const props = { suggestion, open: true, onOpenChange: vi.fn(), onCreated: vi.fn() }
    const view = mount(<CreateSmartFolderDialog {...props} />)
    await screen.findAllByDisplayValue('Transfers')
    capabilities.delete('ledger.create')
    capabilities.add('ledger.edit')
    view.rerender(<CreateSmartFolderDialog {...props} />)
    const create = screen.getByRole('button', { name: 'ledger.smart.createConfirm' })
    expect(create).toBeDisabled()
    fireEvent.submit(create.closest('form')!)
    expect(api.createSmartFolder).not.toHaveBeenCalled()
    capabilities.add('ledger.create')
    view.rerender(<CreateSmartFolderDialog {...props} />)
    await userEvent.click(screen.getByRole('button', { name: 'ledger.smart.createConfirm' }))
    await waitFor(() => expect(api.createSmartFolder).toHaveBeenCalledWith({ name_en: 'Transfers', name_ar: 'Transfers', rule_kind: 'subject', rule_value: 'transfer' }))
  })
})

describe('Contacts and vault submission boundaries', () => {
  it('shows recipients without save-contact controls until ledger.create is allowed', async () => {
    capabilities.add('ledger.edit')
    const view = mount(<RecipientChips entry={mail} />)
    expect(screen.getByText('HR')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'hr@example.ae' })).not.toBeInTheDocument()
    capabilities.add('ledger.create')
    view.rerender(<RecipientChips entry={mail} />)
    await userEvent.click(screen.getByRole('button', { name: 'hr@example.ae' }))
    await waitFor(() => expect(api.addLedgerContact).toHaveBeenCalledWith({ display_name: 'HR', address: 'hr@example.ae' }))
  })

  it('keeps attachments downloadable but removes Send to vault without vault manage', () => {
    mount(<LedgerAttachments entryId={42} attachments={[{ index: 0, name: 'Letter.pdf', size: 42 }]} />)
    expect(screen.getAllByRole('link', { name: 'common.download' })).toHaveLength(2)
    expect(screen.queryByRole('button', { name: 'ledger.vault.sendToVault' })).not.toBeInTheDocument()
  })

  it('gates Send to vault at entry and rechecks at submission after revocation', async () => {
    capabilities.add('employees.vault.manage')
    const props = { entryId: 42, attachments: [{ index: 0, name: 'Letter.pdf', size: 42 }] }
    const view = mount(<LedgerAttachments {...props} />)
    await userEvent.click(screen.getByRole('button', { name: 'ledger.vault.sendToVault' }))
    await userEvent.click(screen.getByRole('button', { name: 'Choose employee' }))
    expect(screen.getByRole('button', { name: 'ledger.vault.dialog.confirm' })).toBeEnabled()
    capabilities.delete('employees.vault.manage')
    view.rerender(<LedgerAttachments {...props} />)
    expect(screen.getByRole('button', { name: 'ledger.vault.dialog.confirm' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'ledger.vault.dialog.confirm' }))
    expect(api.sendAttachmentToVault).not.toHaveBeenCalled()
  })

  it('allows vault submission with the actual vault capability', async () => {
    capabilities.add('employees.vault.manage')
    mount(<SendToVaultDialog open entryId={42} attachmentIndex={0} filename="Letter.pdf" onClose={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Choose employee' }))
    await userEvent.click(screen.getByRole('button', { name: 'ledger.vault.dialog.confirm' }))
    await waitFor(() => expect(api.sendAttachmentToVault).toHaveBeenCalledWith(42, 0, 'G123', 'other'))
  })
})
