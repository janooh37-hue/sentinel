/**
 * SendToGroupPage tests — group listing flow + gateway status banner.
 *
 * Mirrors the harness in SupervisorDesignations.test.tsx:
 *   QueryClientProvider + i18n stub + vi.mock('../../lib/api') + sonner mock.
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, opts?: Record<string, unknown>) => {
    if (opts && typeof opts.count === 'number') return `${k}:${opts.count}`
    return k
  }, i18n: { language: 'ar' } }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const mockHas = vi.fn((cap: string) => cap === 'messages.broadcast')
vi.mock('../../lib/useCapabilities', () => ({
  useCapabilities: () => ({ has: mockHas }),
}))
vi.mock('../../lib/api', () => ({
  api: {
    gatewayStatus: vi.fn().mockResolvedValue({ state: 'connected' }),
    listGroups: vi.fn().mockResolvedValue([{ id: '1@g.us', name: 'Alpha' }]),
    sendAnnouncement: vi.fn(),
    unlinkGateway: vi.fn().mockResolvedValue({ ok: true }),
  },
}))
vi.mock('./RecordAnnouncePicker', () => ({
  RecordAnnouncePicker: ({ open, onPick }: { open: boolean; onPick: (b: unknown) => void }) =>
    open ? (
      <button type="button" onClick={() => onPick({ id: 42, ref: 'GS-0042', subject: 'Memo' })}>
        stub-pick-record
      </button>
    ) : null,
}))
vi.mock('./EmployeeMentionField', () => ({
  EmployeeMentionField: ({
    onInsert,
  }: {
    onInsert: (t: string, mention?: { name: string; number: string }) => void
  }) => (
    <>
      <button type="button" onClick={() => onInsert('Ahmed Al-Sayed (G-1234)')}>
        stub-mention
      </button>
      <button
        type="button"
        onClick={() => onInsert('@Omar ', { name: 'Omar', number: '+971509059931' })}
      >
        stub-mention-tag
      </button>
    </>
  ),
}))
// Light preview stubs — keep page tests DOM-cheap.
vi.mock('./MessagePreview', () => ({
  PhonePreview: () => <div data-testid="phone-preview">phone</div>,
  WebChatWindow: () => <div data-testid="web-chat-window">web</div>,
}))

import { api } from '../../lib/api'
import { SendToGroupPage } from './SendToGroupPage'

function renderPage(): void {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <SendToGroupPage />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(api.gatewayStatus).mockResolvedValue({ state: 'connected' })
  vi.mocked(api.listGroups).mockResolvedValue([{ id: '1@g.us', name: 'Alpha' }])
  // Reset capabilities: non-admin by default (only messages.broadcast)
  mockHas.mockImplementation((cap: string) => cap === 'messages.broadcast')
})

describe('SendToGroupPage', () => {
  it('lists groups from the gateway when connected', async () => {
    renderPage()
    expect(await screen.findByText('Alpha')).toBeInTheDocument()
  })

  // The app shell's <main> is a flex container with overflow-hidden, so every
  // page must stretch (flex-1) and own its scrolling (overflow-auto) — without
  // this the page content-sizes (extended view can't widen) and the bottom of
  // the form is clipped with no way to scroll to it.
  it('page root stretches and owns scrolling inside the flex shell', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { container } = render(
      <QueryClientProvider client={qc}>
        <SendToGroupPage />
      </QueryClientProvider>,
    )
    await screen.findByText('Alpha')
    const root = container.firstElementChild as HTMLElement
    expect(root.className).toContain('flex-1')
    expect(root.className).toContain('overflow-auto')
  })

  it('shows the empty state when no groups exist (connected, empty list)', async () => {
    vi.mocked(api.listGroups).mockResolvedValue([])
    renderPage()
    expect(await screen.findByText('sendToGroup.noGroupsForNumber')).toBeInTheDocument()
  })

  // Case A: disconnected → blocked banner, no group list, Send disabled
  it('shows blocked banner when state is disconnected', async () => {
    vi.mocked(api.gatewayStatus).mockResolvedValue({ state: 'disconnected' })
    renderPage()
    expect(await screen.findByText('sendToGroup.gatewayDisconnected')).toBeInTheDocument()
    expect(screen.queryByText('Alpha')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'sendToGroup.send' })).toBeDisabled()
  })

  // Case B: connected + empty groups → neutral noGroupsForNumber, NOT the blocked banner
  it('shows neutral empty message (not blocked banner) when connected but no groups', async () => {
    vi.mocked(api.gatewayStatus).mockResolvedValue({ state: 'connected' })
    vi.mocked(api.listGroups).mockResolvedValue([])
    renderPage()
    expect(await screen.findByText('sendToGroup.noGroupsForNumber')).toBeInTheDocument()
    expect(screen.queryByText('sendToGroup.gatewayDisconnected')).not.toBeInTheDocument()
    expect(screen.queryByText('sendToGroup.blockedTitle')).not.toBeInTheDocument()
  })

  it('shows blocked banner with gatewayDisabled message', async () => {
    vi.mocked(api.gatewayStatus).mockResolvedValue({ state: 'disabled' })
    renderPage()
    expect(await screen.findByText('sendToGroup.gatewayDisabled')).toBeInTheDocument()
    expect(screen.queryByText('Alpha')).not.toBeInTheDocument()
  })

  it('shows blocked banner with gatewayUnreachable message', async () => {
    vi.mocked(api.gatewayStatus).mockResolvedValue({ state: 'unreachable' })
    renderPage()
    expect(await screen.findByText('sendToGroup.gatewayUnreachable')).toBeInTheDocument()
    expect(screen.queryByText('Alpha')).not.toBeInTheDocument()
  })

  it('shows askAdmin copy (not reconnect button) when disconnected and non-admin', async () => {
    vi.mocked(api.gatewayStatus).mockResolvedValue({ state: 'disconnected' })
    renderPage()
    expect(await screen.findByText('sendToGroup.askAdmin')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'sendToGroup.reconnect' })).not.toBeInTheDocument()
  })

  // Case C: connected but groups-fetch errors → groupsLoadError banner, NOT gatewayDisconnected,
  // and no Reconnect button (a groups-fetch error is a network/API problem, not a WhatsApp issue).
  it('shows groupsLoadError banner (not gatewayDisconnected) when connected but groups fetch fails', async () => {
    vi.mocked(api.gatewayStatus).mockResolvedValue({ state: 'connected' })
    vi.mocked(api.listGroups).mockRejectedValue(new Error('boom'))
    renderPage()
    expect(await screen.findByText('sendToGroup.groupsLoadError')).toBeInTheDocument()
    expect(screen.queryByText('sendToGroup.gatewayDisconnected')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'sendToGroup.reconnect' })).not.toBeInTheDocument()
  })

  it('attaches a picked record as book_id in the send payload', async () => {
    vi.mocked(api.sendAnnouncement).mockResolvedValue({
      announcement_id: 1, sent: 1, failed: 0, results: [],
    })
    renderPage()
    // select the group (select-all + per-group checkboxes now coexist)
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Alpha' }))
    // switch attach mode to "book"
    await userEvent.click(screen.getByRole('radio', { name: 'sendToGroup.attachBook' }))
    // open picker + pick
    await userEvent.click(screen.getByRole('button', { name: 'sendToGroup.picker.choose' }))
    await userEvent.click(screen.getByRole('button', { name: 'stub-pick-record' }))
    // chip shows the picked ref
    expect(await screen.findByText('GS-0042')).toBeInTheDocument()
    // send
    await userEvent.click(screen.getByRole('button', { name: 'sendToGroup.send' }))
    await waitFor(() => expect(api.sendAnnouncement).toHaveBeenCalled())
    const form = vi.mocked(api.sendAnnouncement).mock.calls[0][0] as FormData
    expect(form.get('book_id')).toBe('42')
  })

  it('inserts an employee mention into the message and sends it as text', async () => {
    vi.mocked(api.sendAnnouncement).mockResolvedValue({
      announcement_id: 1, sent: 1, failed: 0, results: [],
    })
    renderPage()
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Alpha' }))
    await userEvent.click(screen.getByRole('button', { name: 'stub-mention' }))
    // the mention text is now in the message textarea
    expect(screen.getByRole('textbox', { name: 'sendToGroup.message' })).toHaveValue(
      'Ahmed Al-Sayed (G-1234)',
    )
    await userEvent.click(screen.getByRole('button', { name: 'sendToGroup.send' }))
    await waitFor(() => expect(api.sendAnnouncement).toHaveBeenCalled())
    const form = vi.mocked(api.sendAnnouncement).mock.calls[0][0] as FormData
    expect(form.get('text')).toBe('Ahmed Al-Sayed (G-1234)')
  })

  it('admin sees an unlink action when connected', async () => {
    // Arrange: gatewayStatus → connected, listGroups → [], useCapabilities grants settings.edit.
    mockHas.mockImplementation((cap: string) =>
      cap === 'messages.broadcast' || cap === 'settings.edit',
    )
    vi.mocked(api.gatewayStatus).mockResolvedValue({ state: 'connected' })
    vi.mocked(api.listGroups).mockResolvedValue([])
    renderPage()
    expect(await screen.findByText('sendToGroup.connectedTitle')).toBeInTheDocument()
    const unlink = screen.getByRole('button', { name: /sendToGroup\.unlink/i })
    await userEvent.click(unlink)
    expect(await screen.findByText('sendToGroup.unlinkTitle')).toBeInTheDocument()
  })

  // ── Recipients rail: search filter ──
  it('filters groups by search', async () => {
    vi.mocked(api.listGroups).mockResolvedValue([
      { id: '1@g.us', name: 'Alpha' },
      { id: '2@g.us', name: 'Beta' },
      { id: '3@g.us', name: 'Gamma' },
    ])
    renderPage()
    expect(await screen.findByText('Alpha')).toBeInTheDocument()
    const search = screen.getByRole('textbox', { name: 'sendToGroup.searchGroups' })
    await userEvent.type(search, 'bet')
    expect(screen.getByText('Beta')).toBeInTheDocument()
    expect(screen.queryByText('Alpha')).not.toBeInTheDocument()
    expect(screen.queryByText('Gamma')).not.toBeInTheDocument()
  })

  // ── Recipients rail: select-all ──
  it('select all toggles every filtered group', async () => {
    vi.mocked(api.listGroups).mockResolvedValue([
      { id: '1@g.us', name: 'Alpha' },
      { id: '2@g.us', name: 'Beta' },
      { id: '3@g.us', name: 'Gamma' },
    ])
    renderPage()
    await screen.findByText('Alpha')
    const selectAll = screen.getByRole('checkbox', { name: 'sendToGroup.selectAll' })
    await userEvent.click(selectAll)
    for (const name of ['Alpha', 'Beta', 'Gamma']) {
      expect(screen.getByRole('checkbox', { name })).toBeChecked()
    }
    expect(selectAll).toBeChecked()
    // toggle off
    await userEvent.click(selectAll)
    for (const name of ['Alpha', 'Beta', 'Gamma']) {
      expect(screen.getByRole('checkbox', { name })).not.toBeChecked()
    }
  })

  // ── Reach meter ──
  it('shows reach meter count for selected groups', async () => {
    vi.mocked(api.listGroups).mockResolvedValue([
      { id: '1@g.us', name: 'Alpha' },
      { id: '2@g.us', name: 'Beta' },
    ])
    renderPage()
    await screen.findByText('Alpha')
    await userEvent.click(screen.getByRole('checkbox', { name: 'Alpha' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Beta' }))
    expect(screen.getByText('sendToGroup.reach.groups:2')).toBeInTheDocument()
  })

  // ── Normal / Extended view switch ──
  it('switches to extended view and back, preserving the message', async () => {
    renderPage()
    await screen.findByText('Alpha')
    const textarea = screen.getByRole('textbox', { name: 'sendToGroup.message' })
    await userEvent.type(textarea, 'Draft copy')

    // WebChatWindow stub is present (collapsible zone); phone column visible in normal.
    expect(screen.getByTestId('web-chat-window')).toBeInTheDocument()
    expect(screen.getByTestId('phone-column').className).not.toContain('pointer-events-none')

    await userEvent.click(screen.getByRole('button', { name: 'sendToGroup.viewExtended' }))
    expect(screen.getByTestId('phone-column').className).toContain('pointer-events-none')
    expect(textarea).toHaveValue('Draft copy')

    await userEvent.click(screen.getByRole('button', { name: 'sendToGroup.viewNormal' }))
    expect(screen.getByTestId('phone-column').className).not.toContain('pointer-events-none')
    expect(textarea).toHaveValue('Draft copy')
  })

  // ── Real mention wiring: transformed text + mention numbers ──
  // ── Mention chips: visible + easy delete (mockup behavior) ──
  it('shows an inserted mention as a removable chip', async () => {
    renderPage()
    await screen.findByText('Alpha')
    await userEvent.click(screen.getByRole('button', { name: 'stub-mention-tag' }))
    expect(screen.getByTestId('mention-chip')).toHaveTextContent('@Omar')
    await userEvent.click(screen.getByRole('button', { name: 'sendToGroup.mention.remove' }))
    expect(screen.queryByTestId('mention-chip')).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'sendToGroup.message' })).toHaveValue('')
  })

  it('chip disappears when the token is edited out of the message', async () => {
    renderPage()
    await screen.findByText('Alpha')
    await userEvent.click(screen.getByRole('button', { name: 'stub-mention-tag' }))
    expect(screen.getByTestId('mention-chip')).toBeInTheDocument()
    await userEvent.clear(screen.getByRole('textbox', { name: 'sendToGroup.message' }))
    expect(screen.queryByTestId('mention-chip')).not.toBeInTheDocument()
  })

  it('sends transformed text and mention numbers', async () => {
    vi.mocked(api.sendAnnouncement).mockResolvedValue({
      announcement_id: 1, sent: 1, failed: 0, results: [],
    })
    renderPage()
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Alpha' }))
    // register the mention target, then author the message ourselves
    await userEvent.click(screen.getByRole('button', { name: 'stub-mention-tag' }))
    const textarea = screen.getByRole('textbox', { name: 'sendToGroup.message' })
    await userEvent.clear(textarea)
    await userEvent.type(textarea, 'Hi @Omar')
    await userEvent.click(screen.getByRole('button', { name: 'sendToGroup.send' }))
    await waitFor(() => expect(api.sendAnnouncement).toHaveBeenCalled())
    const form = vi.mocked(api.sendAnnouncement).mock.calls[0][0] as FormData
    expect(form.get('text')).toBe('Hi @971509059931')
    expect(form.getAll('mentions')).toEqual(['971509059931'])
  })

  // ── Real mention wiring: edited-out mention is dropped ──
  it('drops mentions the operator edited out', async () => {
    vi.mocked(api.sendAnnouncement).mockResolvedValue({
      announcement_id: 1, sent: 1, failed: 0, results: [],
    })
    renderPage()
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Alpha' }))
    await userEvent.click(screen.getByRole('button', { name: 'stub-mention-tag' }))
    const textarea = screen.getByRole('textbox', { name: 'sendToGroup.message' })
    await userEvent.clear(textarea)
    await userEvent.type(textarea, 'Hello team')
    await userEvent.click(screen.getByRole('button', { name: 'sendToGroup.send' }))
    await waitFor(() => expect(api.sendAnnouncement).toHaveBeenCalled())
    const form = vi.mocked(api.sendAnnouncement).mock.calls[0][0] as FormData
    expect(form.get('text')).toBe('Hello team')
    expect(form.getAll('mentions')).toEqual([])
  })
})
