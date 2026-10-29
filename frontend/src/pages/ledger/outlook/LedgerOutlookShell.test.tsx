import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
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
const { capabilities, capabilityStatus } = vi.hoisted(() => ({
  capabilities: new Set<string>(), capabilityStatus: { loading: false },
}))
vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({ has: (cap: string) => capabilities.has(cap), isLoading: capabilityStatus.loading }),
}))
beforeEach(() => {
  capabilities.clear()
  capabilityStatus.loading = false
  for (const cap of ['ledger.view', 'ledger.edit', 'ledger.send', 'ledger.delete', 'ledger.create']) capabilities.add(cap)
})
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
  const navigate = useNavigate()
  return <>
    <output data-testid="location">{location.search}</output>
    <output data-testid="route-state">{JSON.stringify(location.state)}</output>
    <button type="button" onClick={() => navigate('/ledger?tab=email', {
      state: { composePrefill: { subject: 'Next record draft', to: ['next@gssg.ae'] } },
    })}>Incoming prefill</button>
  </>
}

function renderShell(initialEntry: string, state?: Record<string, unknown>): { refresh: () => void } {
  const [pathname, search] = initialEntry.split('?')
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const tree = () => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter
        initialEntries={[{ pathname, search: search ? `?${search}` : '', state: state ?? null }]}
      >
        <LedgerOutlookShell />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>
  )
  const view = render(tree())
  return { refresh: () => view.rerender(tree()) }
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

  it('cancels a pushed compose without reopening and accepts the next prefill on the same shell', async () => {
    const view = renderShell('/ledger')
    await userEvent.click(screen.getByRole('button', { name: 'ledger.outlook.newEmail' }))
    await screen.findByTestId('compose-window')
    const reopened: Element[] = []
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof Element && (node.matches('[data-testid="compose-window"]') || node.querySelector('[data-testid="compose-window"]'))) {
            reopened.push(node)
          }
        }
      }
    })
    observer.observe(document.body, { childList: true, subtree: true })
    try {
      await userEvent.click(screen.getByRole('button', { name: 'common.cancel' }))
      await waitFor(() => expect(screen.getByTestId('location').textContent).toBe(''))
      view.refresh()
      expect(screen.queryByTestId('compose-window')).not.toBeInTheDocument()
      expect(reopened).toHaveLength(0)
    } finally {
      observer.disconnect()
    }
    vi.mocked(toast).mockClear()
    await userEvent.click(screen.getByRole('button', { name: 'Incoming prefill' }))
    expect(await screen.findByDisplayValue('Next record draft')).toBeInTheDocument()
    expect(screen.getByText('next@gssg.ae')).toBeInTheDocument()
    expect(toast).not.toHaveBeenCalledWith('ledger.outlook.composeBusy')
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

  it('waits for initial capabilities before consuming an incoming prefill', async () => {
    capabilities.delete('ledger.send')
    capabilityStatus.loading = true
    const view = renderShell('/ledger', { composePrefill: { subject: 'Loading permissions' } })
    expect(screen.getByTestId('route-state')).toHaveTextContent('Loading permissions')
    expect(screen.queryByTestId('compose-window')).not.toBeInTheDocument()
    capabilities.add('ledger.send')
    capabilityStatus.loading = false
    view.refresh()
    expect(await screen.findByDisplayValue('Loading permissions')).toBeInTheDocument()
  })

  it('rejects New email, direct compose URLs and prefills without ledger.send even with ledger.create', async () => {
    capabilities.delete('ledger.send')
    const view = renderShell('/ledger?action=compose&keep=1', { composePrefill: { to: ['hr@gssg.ae'], subject: 'Blocked' } })
    await userEvent.click(screen.getByRole('button', { name: 'ledger.outlook.newEmail' }))
    expect(screen.queryByTestId('compose-window')).not.toBeInTheDocument()
    expect(screen.queryByDisplayValue('Blocked')).not.toBeInTheDocument()
    expect(api.emailHandoff).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByTestId('route-state')).toHaveTextContent('null'))
    expect(screen.getByTestId('location')).toHaveTextContent('?keep=1')
    expect(toast.error).toHaveBeenCalledWith('common.forbidden')
    capabilities.add('ledger.send')
    view.refresh()
    expect(screen.queryByTestId('compose-window')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'ledger.outlook.newEmail' }))
    expect(await screen.findByLabelText('compose.subject')).toHaveValue('')
  })

  it('consumes a denied bare compose URL instead of opening it on regrant', async () => {
    capabilities.delete('ledger.send')
    const view = renderShell('/ledger?action=compose&keep=1')
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('?keep=1'))
    capabilities.add('ledger.send')
    view.refresh()
    expect(screen.queryByTestId('compose-window')).not.toBeInTheDocument()
  })

  it.each([false, true])('retains an open draft and disables handoff after send revocation (mobile=%s)', async (mobile) => {
    isMobile.value = mobile
    try {
      const view = renderShell('/ledger?action=compose')
      const subject = await screen.findByLabelText('compose.subject')
      await userEvent.type(subject, 'Keep my unsent draft')
      capabilities.delete('ledger.send')
      view.refresh()
      expect(screen.getByLabelText('compose.subject')).toBe(subject)
      expect(subject).toHaveValue('Keep my unsent draft')
      const submit = screen.getByRole('button', { name: 'ledger.outlook.handoff.submit' })
      expect(submit).toBeDisabled()
      fireEvent.submit(submit.closest('form')!)
      expect(api.emailHandoff).not.toHaveBeenCalled()
      capabilities.add('ledger.send')
      view.refresh()
      expect(screen.getByLabelText('compose.subject')).toBe(subject)
      expect(subject).toHaveValue('Keep my unsent draft')
      expect(screen.getByRole('button', { name: 'ledger.outlook.handoff.submit' })).toBeEnabled()
    } finally {
      isMobile.value = false
    }
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
    vi.mocked(api.getLedgerEntry).mockResolvedValue({
      ...entry(42),
      notes_html: null,
      attachment_paths: [],
      created_by: null,
    })
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

  it.each(['Trash 42', 'Trash all'])('does not schedule %s or hide rows without ledger.delete', async (action) => {
    capabilities.delete('ledger.delete')
    renderShell('/ledger?mail=42')
    await screen.findByRole('button', { name: '42' })
    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: action }))
    expect(screen.getByRole('button', { name: '42' })).toBeInTheDocument()
    expect(screen.getByTestId('reading-pane')).toHaveTextContent('42')
    expect(toast).not.toHaveBeenCalled()
    await act(() => vi.advanceTimersByTimeAsync(6000))
    expect(api.deleteLedgerEntry).not.toHaveBeenCalled()
  })

  it('rechecks ledger.delete when the Undo window expires', async () => {
    const shell = renderShell('/ledger')
    await screen.findByRole('button', { name: '42' })
    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: 'Trash 42' }))
    expect(screen.queryByRole('button', { name: '42' })).not.toBeInTheDocument()
    capabilities.delete('ledger.delete')
    shell.refresh()
    await act(() => vi.advanceTimersByTimeAsync(6000))
    expect(api.deleteLedgerEntry).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '42' })).toBeInTheDocument()
  })
})
