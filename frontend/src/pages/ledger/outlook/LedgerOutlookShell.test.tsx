import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LedgerEntryRead, LedgerListItem } from '@/lib/api'
import { api } from '@/lib/api'
import { LedgerOutlookShell } from './LedgerOutlookShell'
import { activityEmoji } from './contextResolve'
import { toast } from '@/lib/toast'

vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof import('@/lib/api')>()
  return {
    ...real,
    api: {
      ...real.api,
      listLedger: vi.fn(),
      getLedgerEntry: vi.fn(),
      deleteLedgerEntry: vi.fn().mockResolvedValue(undefined),
      getSmartFolderSuggestions: vi.fn().mockResolvedValue([]),
      // Reached through the hosted handoff dialog.
      listLedgerContacts: vi.fn().mockResolvedValue([]),
      listRecipientLists: vi.fn().mockResolvedValue([]),
      lookupEmployees: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      getEmailAccount: vi.fn().mockResolvedValue({ enabled: true }),
      emailHandoff: vi.fn(),
    },
  }
})
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}))
vi.mock('@/lib/useIdentity', () => ({
  useIdentity: () => ({ identity: { email: 'me@gssg.ae' }, isAdmin: false }),
}))
// HugeRTE can't mount in jsdom — sentinel div (repo-wide convention).
vi.mock('@/components/ui/rich-editor', () => ({
  RichEditor: ({ name }: { name: string }) => <div data-testid={`rich-editor-${name}`} />,
}))
const { isMobile } = vi.hoisted(() => ({ isMobile: { value: false } }))
vi.mock('@/lib/useIsMobile', () => ({ useIsMobile: () => isMobile.value }))
vi.mock('@/lib/toast', () => ({
  toast: Object.assign(vi.fn(() => 'trash-toast-id'), { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() }),
}))
vi.mock('./useSyncStatus', () => ({ useSyncStatus: () => ({ status: null }) }))
vi.mock('./useContextSource', () => ({ useContextSource: () => ({ peopleCount: 0, entry: null }) }))
// Stubbed down to the one shell-relevant affordance: the ＋New email button.
// The stub reproduces the real rail's accessible name (`aria-label` →
// `ledger.outlook.newEmail`) so the click target is the same one users hit.
vi.mock('./FolderRail', () => ({
  FolderRail: ({ onNewEmail, onToggleAllMail }: { onNewEmail?: () => void; onToggleAllMail: (all: boolean) => void }) => (
    <><button type="button" onClick={() => onNewEmail?.()}>ledger.outlook.newEmail</button><button type="button" onClick={() => onToggleAllMail(true)}>All mail</button></>
  ),
}))
vi.mock('./ContextPanel', () => ({ ContextPanel: () => null }))
vi.mock('./ReadingPaneSlot', () => ({ ReadingPaneSlot: ({ selectedId, scope }: { selectedId: number | null; scope?: string }) => <div data-testid="reading-pane" data-scope={scope}>{selectedId ?? 'none'}</div> }))
vi.mock('./MessageList', () => ({ MessageList: ({ items, onSelect, onBulkTrash, onDelete }: {
  items: LedgerListItem[]
  onSelect: (id: number) => void
  onBulkTrash: (ids: number[]) => void
  onDelete: (entry: { id: number }) => void
}) => (
  <div data-testid="message-list">
    <button type="button" onClick={() => onBulkTrash(items.map((item) => item.id))}>Trash all</button>
    {items.map((item) => <span key={item.id}>
      <button type="button" onClick={() => onSelect(item.id)}>{item.id}</button>
      <button type="button" onClick={() => onDelete(item)}>Trash {item.id}</button>
    </span>)}
  </div>
) }))
// (the retired SMTP composer is no longer rendered by the shell)
// Render-prop passthrough: the frame's drag/minimize chrome is not under test,
// but the compose surface it hosts is.
vi.mock('./ComposeWindow', () => ({
  ComposeWindow: ({ children }: { children: (win: unknown) => React.ReactNode }) => (
    <div data-testid="compose-window">
      {children({
        state: 'maximized',
        minimize: () => {},
        maximize: () => {},
        restore: () => {},
        dragHandleProps: { onPointerDown: () => {} },
      })}
    </div>
  ),
}))
vi.mock('./SuggestionBanner', () => ({ SuggestionBanner: () => null }))
vi.mock('./ReviewSuggestionsSheet', () => ({ ReviewSuggestionsSheet: () => null }))
vi.mock('./CreateSmartFolderDialog', () => ({ CreateSmartFolderDialog: () => null }))

const entry = (id: number): LedgerListItem => ({
  id,
  entry_date: '2026-08-10',
  direction: 'incoming',
  channel: 'email',
  counterparty: 'Sender',
  subject: `Entry ${id}`,
  tags: [],
  attachment_count: 0,
  related_book_id: null,
  related_employee_id: null,
  created_at: '2026-08-10T09:00:00Z',
  updated_at: '2026-08-10T09:00:00Z',
  deleted_at: null,
  read_at: null,
  flagged: false,
  snippet: '',
})

function LocationProbe(): React.JSX.Element {
  const location = useLocation()
  return <output data-testid="location">{location.search}</output>
}

function renderShell(initialEntry: string, state?: Record<string, unknown>): void {
  const [pathname, search] = initialEntry.split('?')
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter
        initialEntries={[{ pathname, search: search ? `?${search}` : '', state: state ?? null }]}
      >
        <LedgerOutlookShell />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('LedgerOutlookShell mail URLs', () => {
  beforeEach(() => {
    vi.mocked(api.listLedger).mockResolvedValue({ items: [entry(42)], total: 1, limit: 500, offset: 0 })
    vi.mocked(api.getSmartFolderSuggestions).mockResolvedValue([])
    vi.mocked(api.getLedgerEntry).mockResolvedValue(entry(42) as unknown as LedgerEntryRead)
  })

  it('opens mail from the shareable mail parameter', async () => {
    renderShell('/ledger?mail=42')
    await waitFor(() => expect(screen.getByTestId('reading-pane')).toHaveTextContent('42'))
    expect(screen.getByTestId('location')).toHaveTextContent('?mail=42')
  })

  it.each([false, true])('threads All-mail scope through the shared pane and hydration (mobile=%s)', async (mobile) => {
    isMobile.value = mobile
    try {
      renderShell(mobile ? '/ledger' : '/ledger?mail=42')
      if (mobile) await userEvent.click(screen.getByRole('button', { name: 'ledger.outlook.foldersTrigger' }))
      await userEvent.click(screen.getAllByRole('button', { name: 'All mail' })[0])
      if (mobile) {
        await userEvent.keyboard('{Escape}')
        await userEvent.click(await screen.findByRole('button', { name: '42' }))
      }
      await waitFor(() => expect(screen.getByTestId('reading-pane')).toHaveAttribute('data-scope', 'all'))
      await waitFor(() => expect(api.getLedgerEntry).toHaveBeenCalledWith(42, 'all'))
    } finally {
      isMobile.value = false
    }
  })

  it('mobile mail Back returns to the mailbox list URL', async () => {
    isMobile.value = true
    try {
      renderShell('/ledger')
      await userEvent.click(await screen.findByRole('button', { name: '42' }))
      await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('?mail=42'))
      await userEvent.click(screen.getByRole('button', { name: 'ledger.outlook.back' }))
      await waitFor(() => expect(screen.getByTestId('location').textContent).toBe(''))
      expect(screen.getByTestId('message-list')).toBeInTheDocument()
    } finally {
      isMobile.value = false
    }
  })
})

describe('LedgerOutlookShell activity deep links', () => {
  beforeEach(() => {
    vi.mocked(api.listLedger).mockReset()
    vi.mocked(api.getSmartFolderSuggestions).mockResolvedValue([])
    vi.mocked(api.getLedgerEntry).mockReset()
  })

  it('opens the exact ledger entry and keeps it in the URL', async () => {
    vi.mocked(api.listLedger).mockResolvedValue({ items: [entry(42), entry(7)], total: 2, limit: 500, offset: 0 })
    vi.mocked(api.getLedgerEntry).mockResolvedValue(entry(42) as unknown as LedgerEntryRead)
    renderShell('/ledger?mail=42&keep=1')
    await waitFor(() => expect(screen.getByTestId('reading-pane')).toHaveTextContent('42'))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('?mail=42&keep=1'))
  })

  it('hydrates an off-list outgoing target independently of the current list', async () => {
    vi.mocked(api.listLedger).mockResolvedValue({ items: [entry(7)], total: 1, limit: 500, offset: 0 })
    vi.mocked(api.getLedgerEntry).mockResolvedValue(entry(42) as unknown as LedgerEntryRead)
    renderShell('/ledger?mail=42&keep=1')
    await waitFor(() => expect(screen.getByTestId('reading-pane')).toHaveTextContent('42'))
    expect(api.getLedgerEntry).toHaveBeenCalledWith(42, undefined)
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('?mail=42&keep=1'))
  })

  it('renders an exact-target error and retries without dropping the mail link', async () => {
    vi.mocked(api.listLedger).mockResolvedValue({ items: [entry(7)], total: 1, limit: 500, offset: 0 })
    vi.mocked(api.getLedgerEntry)
      .mockRejectedValueOnce(new Error('not found'))
      .mockResolvedValueOnce(entry(42) as unknown as LedgerEntryRead)
    renderShell('/ledger?mail=42&keep=1')
    const retry = await screen.findByRole('button', { name: 'common.retry' })
    expect(screen.getByRole('alert')).toHaveTextContent('common.loadError')
    expect(screen.getByTestId('location')).toHaveTextContent('?mail=42&keep=1')
    await userEvent.click(retry)
    await waitFor(() => expect(screen.getByTestId('reading-pane')).toHaveTextContent('42'))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('?mail=42&keep=1'))
  })
})

/**
 * The compose entry point now hands the mail off to the user's Outlook instead
 * of sending over SMTP, so the surface the shell opens must offer the two
 * handoff modes and a handoff submit — never the composer's "Send".
 * `t` is stubbed key-as-text above, so the names asserted here are the i18n
 * keys the dialog must use (same convention as `common.retry` above).
 */
describe('LedgerOutlookShell Outlook handoff surface', () => {
  beforeEach(() => {
    vi.mocked(api.listLedger).mockResolvedValue({ items: [], total: 0, limit: 500, offset: 0 })
    vi.mocked(api.getSmartFolderSuggestions).mockResolvedValue([])
    vi.mocked(api.getLedgerEntry).mockReset()
    // The reference-PDF prefetch is a real `fetch` against a relative URL; keep
    // it offline so the dialog exercises its skip-on-failure path.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('New email opens the handoff surface with both modes, not the SMTP composer', async () => {
    renderShell('/ledger')
    await userEvent.click(
      await screen.findByRole('button', { name: 'ledger.outlook.newEmail' }),
    )
    // Two mutually exclusive modes, explicitly chosen — never a hidden default.
    expect(
      await screen.findByRole('radio', { name: 'ledger.outlook.handoff.modeDraft' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('radio', { name: 'ledger.outlook.handoff.modeMailto' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'ledger.outlook.handoff.submit' }),
    ).toBeInTheDocument()
    // This surface hands off; it never sends. The composer's Send must be gone.
    expect(screen.queryByRole('button', { name: 'compose.send' })).not.toBeInTheDocument()
  })

  it('opens compose from ?action=compose and keeps one compose window', async () => {
    renderShell('/ledger?action=compose')
    expect(await screen.findByTestId('compose-window')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'ledger.outlook.newEmail' }))
    expect(screen.getAllByTestId('compose-window')).toHaveLength(1)
  })

  it('consumes a route-state basket prefill into the handoff surface', async () => {
    // Exactly what BookRecordPage / EmailBasketTray push through navigate state.
    renderShell('/ledger', {
      composePrefill: {
        to: ['hr@gssg.ae'],
        subject: 'طلب اجازة سنوية',
        bodyHtml: '<p>body</p>',
        references: [
          { kind: 'book', id: 48, label: 'GS-0048', token: 'GS-0048', docId: 900 },
        ],
        attachRefPdf: true,
      },
    })
    expect(await screen.findByDisplayValue('طلب اجازة سنوية')).toBeInTheDocument()
    expect(screen.getByText('hr@gssg.ae')).toBeInTheDocument()
    expect(screen.getByText('GS-0048')).toBeInTheDocument()
  })
})

describe('activityEmoji', () => {
  it('supports duty location history in the unified activity feed', () => {
    expect(activityEmoji('duty_location')).toBe('📍')
  })
})

describe('LedgerOutlookShell deferred Trash', () => {
  beforeEach(() => {
    vi.mocked(toast).mockClear()
    vi.mocked(toast.dismiss).mockClear()
    vi.mocked(toast.error).mockClear()
    vi.mocked(api.deleteLedgerEntry).mockClear()
    vi.mocked(api.listLedger).mockResolvedValue({ items: [entry(42), entry(7)], total: 2, limit: 500, offset: 0 })
    vi.mocked(api.getSmartFolderSuggestions).mockResolvedValue([])
  })

  afterEach(() => vi.useRealTimers())

  it('offers one Undo restoring the entire bulk selection without deleting anything', async () => {
    renderShell('/ledger')
    await screen.findByRole('button', { name: '42' })
    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: 'Trash all' }))
    expect(toast).toHaveBeenCalledTimes(1)
    expect(toast).toHaveBeenCalledWith('ledger.outlook.movedToTrashMany', expect.objectContaining({ duration: 6000 }))
    expect(screen.queryByRole('button', { name: '42' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '7' })).not.toBeInTheDocument()
    act(() => vi.mocked(toast).mock.calls[0][1]?.action?.onClick())
    expect(screen.getByRole('button', { name: '42' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '7' })).toBeInTheDocument()
    await act(() => vi.advanceTimersByTimeAsync(6000))
    expect(api.deleteLedgerEntry).not.toHaveBeenCalled()
  })

  it('dismisses the returned toast id on commit and explains a late Undo', async () => {
    renderShell('/ledger')
    await screen.findByRole('button', { name: '42' })
    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: 'Trash 42' }))
    const undo = vi.mocked(toast).mock.calls[0][1]?.action?.onClick
    await act(() => vi.advanceTimersByTimeAsync(6000))
    expect(api.deleteLedgerEntry).toHaveBeenCalledWith(42)
    expect(toast.dismiss).toHaveBeenCalledWith('trash-toast-id')
    act(() => undo?.())
    expect(toast.error).toHaveBeenCalledWith('ledger.outlook.undoTooLate')
  })
})
