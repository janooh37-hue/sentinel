import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LedgerEntryRead, LedgerListItem } from '@/lib/api'
import { api } from '@/lib/api'
import { LedgerOutlookShell } from './LedgerOutlookShell'

vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof import('@/lib/api')>()
  return {
    ...real,
    api: {
      ...real.api,
      listLedger: vi.fn(),
      getLedgerEntry: vi.fn(),
      getSmartFolderSuggestions: vi.fn().mockResolvedValue([]),
    },
  }
})
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@/lib/useIsMobile', () => ({ useIsMobile: () => false }))
vi.mock('sonner', () => ({ toast: vi.fn() }))
vi.mock('./useSyncStatus', () => ({ useSyncStatus: () => ({ status: null }) }))
vi.mock('./useContextSource', () => ({ useContextSource: () => ({ peopleCount: 0, entry: null }) }))
vi.mock('./useDeferredDelete', () => ({ useDeferredDelete: () => ({ pendingIds: new Set(), scheduleDelete: vi.fn() }) }))
vi.mock('./FolderRail', () => ({ FolderRail: () => null }))
vi.mock('./ContextPanel', () => ({ ContextPanel: () => null }))
vi.mock('./ReadingPaneSlot', () => ({ ReadingPaneSlot: ({ selectedId }: { selectedId: number | null }) => <div data-testid="reading-pane">{selectedId ?? 'none'}</div> }))
vi.mock('./MessageList', () => ({ MessageList: ({ items, onSelect }: { items: LedgerListItem[]; onSelect: (id: number) => void }) => (
  <div data-testid="message-list">
    {items.map((item) => <button type="button" key={item.id} onClick={() => onSelect(item.id)}>{item.id}</button>)}
  </div>
) }))
vi.mock('../LedgerEmailCompose', () => ({ LedgerEmailCompose: () => null }))
vi.mock('./ComposeWindow', () => ({ ComposeWindow: () => null }))
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

function renderShell(initialEntry: string): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
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
    expect(screen.getByTestId('location')).toHaveTextContent('?keep=1')
  })

  it('hydrates an off-list outgoing target independently of the current list', async () => {
    vi.mocked(api.listLedger).mockResolvedValue({ items: [entry(7)], total: 1, limit: 500, offset: 0 })
    vi.mocked(api.getLedgerEntry).mockResolvedValue(entry(42) as unknown as LedgerEntryRead)
    renderShell('/ledger?open=42&keep=1')
    await waitFor(() => expect(screen.getByTestId('reading-pane')).toHaveTextContent('42'))
    expect(api.getLedgerEntry).toHaveBeenCalledWith(42)
    expect(screen.getByTestId('location')).toHaveTextContent('?keep=1')
  })

  it('keeps open and selection unchanged when exact target hydration fails', async () => {
    vi.mocked(api.listLedger).mockResolvedValue({ items: [entry(7)], total: 1, limit: 500, offset: 0 })
    vi.mocked(api.getLedgerEntry).mockRejectedValue(new Error('not found'))
    renderShell('/ledger?open=42&keep=1')
    await waitFor(() => expect(api.getLedgerEntry).toHaveBeenCalledWith(42))
    expect(screen.getByTestId('reading-pane')).toHaveTextContent('none')
    expect(screen.getByTestId('location')).toHaveTextContent('?open=42&keep=1')
  })
})
