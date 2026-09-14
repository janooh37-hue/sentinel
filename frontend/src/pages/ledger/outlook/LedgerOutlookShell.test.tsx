import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LedgerEntryRead, LedgerListItem } from '@/lib/api'
import { api } from '@/lib/api'
import { LedgerOutlookShell } from './LedgerOutlookShell'
import { activityEmoji } from './contextResolve'

vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof import('@/lib/api')>()
  return {
    ...real,
    api: {
      ...real.api,
      listLedger: vi.fn(),
      getLedgerEntry: vi.fn(),
      getSmartFolderSuggestions: vi.fn().mockResolvedValue([]),
      // Reached through the hosted handoff dialog.
      listLedgerContacts: vi.fn().mockResolvedValue([]),
      listRecipientLists: vi.fn().mockResolvedValue([]),
      listEmployees: vi.fn().mockResolvedValue({ items: [], total: 0 }),
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
vi.mock('@/lib/useIsMobile', () => ({ useIsMobile: () => false }))
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}))
vi.mock('./useSyncStatus', () => ({ useSyncStatus: () => ({ status: null }) }))
vi.mock('./useContextSource', () => ({ useContextSource: () => ({ peopleCount: 0, entry: null }) }))
vi.mock('./useDeferredDelete', () => ({ useDeferredDelete: () => ({ pendingIds: new Set(), scheduleDelete: vi.fn() }) }))
// Stubbed down to the one shell-relevant affordance: the ＋New email button.
// The stub reproduces the real rail's accessible name (`aria-label` →
// `ledger.outlook.newEmail`) so the click target is the same one users hit.
vi.mock('./FolderRail', () => ({
  FolderRail: ({ onNewEmail }: { onNewEmail?: () => void }) => (
    <button type="button" onClick={() => onNewEmail?.()}>ledger.outlook.newEmail</button>
  ),
}))
vi.mock('./ContextPanel', () => ({ ContextPanel: () => null }))
vi.mock('./ReadingPaneSlot', () => ({ ReadingPaneSlot: ({ selectedId }: { selectedId: number | null }) => <div data-testid="reading-pane">{selectedId ?? 'none'}</div> }))
vi.mock('./MessageList', () => ({ MessageList: ({ items, onSelect }: { items: LedgerListItem[]; onSelect: (id: number) => void }) => (
  <div data-testid="message-list">
    {items.map((item) => <button type="button" key={item.id} onClick={() => onSelect(item.id)}>{item.id}</button>)}
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

describe('LedgerOutlookShell activity deep links', () => {
  beforeEach(() => {
    vi.mocked(api.listLedger).mockReset()
    vi.mocked(api.getSmartFolderSuggestions).mockResolvedValue([])
    vi.mocked(api.getLedgerEntry).mockReset()
  })

  it('opens the exact ledger entry, preserves unrelated params, and consumes open', async () => {
    vi.mocked(api.listLedger).mockResolvedValue({ items: [entry(42), entry(7)], total: 2, limit: 500, offset: 0 })
    vi.mocked(api.getLedgerEntry).mockResolvedValue(entry(42) as unknown as LedgerEntryRead)
    renderShell('/ledger?open=42&keep=1')
    await waitFor(() => expect(screen.getByTestId('reading-pane')).toHaveTextContent('42'))
    // `open` is consumed by an effect that lands on a later commit than the
    // reading pane's render, so this needs its own wait — asserted immediately
    // it passes only while the machine is fast enough.
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('?keep=1'))
  })

  it('hydrates an off-list outgoing target independently of the current list', async () => {
    vi.mocked(api.listLedger).mockResolvedValue({ items: [entry(7)], total: 1, limit: 500, offset: 0 })
    vi.mocked(api.getLedgerEntry).mockResolvedValue(entry(42) as unknown as LedgerEntryRead)
    renderShell('/ledger?open=42&keep=1')
    await waitFor(() => expect(screen.getByTestId('reading-pane')).toHaveTextContent('42'))
    expect(api.getLedgerEntry).toHaveBeenCalledWith(42)
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('?keep=1'))
  })

  it('renders an exact-target error and retries without consuming open', async () => {
    vi.mocked(api.listLedger).mockResolvedValue({ items: [entry(7)], total: 1, limit: 500, offset: 0 })
    vi.mocked(api.getLedgerEntry)
      .mockRejectedValueOnce(new Error('not found'))
      .mockResolvedValueOnce(entry(42) as unknown as LedgerEntryRead)
    renderShell('/ledger?open=42&keep=1')
    const retry = await screen.findByRole('button', { name: 'common.retry' })
    expect(screen.getByRole('alert')).toHaveTextContent('common.loadError')
    expect(screen.getByTestId('location')).toHaveTextContent('?open=42&keep=1')
    await userEvent.click(retry)
    await waitFor(() => expect(screen.getByTestId('reading-pane')).toHaveTextContent('42'))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('?keep=1'))
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
