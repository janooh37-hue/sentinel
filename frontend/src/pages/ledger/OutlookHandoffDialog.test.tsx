/**
 * OutlookHandoffDialog — the adaptive mode rules are the whole point of this
 * surface, so they get the coverage: what the operator may choose, what the app
 * chooses for them and why, and what actually leaves the browser.
 *
 * Asserted against real English strings (the test setup boots i18n with
 * en.json), so a missing or reworded key fails here rather than shipping.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as ApiModule from '@/lib/api'
import { api } from '@/lib/api'
import {
  OutlookHandoffDialog,
  browserNavigation,
  buildMailtoUrl,
  htmlToPlainText,
  stripQuote,
  MAILTO_MAX,
} from './OutlookHandoffDialog'

vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof ApiModule>()
  return {
    ...real,
    api: {
      ...real.api,
      getEmailAccount: vi.fn(),
      listLedgerContacts: vi.fn().mockResolvedValue([]),
      listRecipientLists: vi.fn().mockResolvedValue([]),
      listEmployees: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      emailHandoff: vi.fn(),
    },
  }
})
vi.mock('@/lib/useIdentity', () => ({
  useIdentity: () => ({ identity: { email: 'me@gssg.ae' }, isAdmin: false }),
}))
// HugeRTE can't mount in jsdom — sentinel div (repo-wide convention).
vi.mock('@/components/ui/rich-editor', () => ({
  RichEditor: ({ name }: { name: string }) => <div data-testid={`rich-editor-${name}`} />,
}))
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}))

const BOOK_REF = {
  kind: 'book' as const,
  id: 48,
  label: 'GS-0048',
  token: 'GS-0048',
  docId: 900,
  fileName: 'GS-0048.pdf',
}

function renderDialog(
  prefill: Parameters<typeof OutlookHandoffDialog>[0]['prefill'] = {},
): { onClose: () => void; onHandedOff: (id: number) => void } {
  const onClose = vi.fn()
  const onHandedOff = vi.fn()
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <OutlookHandoffDialog
        mode="new"
        prefill={prefill}
        onClose={onClose}
        onHandedOff={onHandedOff}
      />
    </QueryClientProvider>,
  )
  return { onClose, onHandedOff }
}

const draftRadio = (): HTMLElement => screen.getByRole('radio', { name: /Draft in Outlook/ })
const mailtoRadio = (): HTMLElement => screen.getByRole('radio', { name: /Open Outlook now/ })

beforeEach(() => {
  // Call history, not just implementations — the no-recipient test asserts
  // `emailHandoff` was never reached.
  vi.clearAllMocks()
  vi.mocked(api.getEmailAccount).mockResolvedValue({ enabled: true } as never)
  vi.mocked(api.emailHandoff).mockResolvedValue({ ledger_entry_id: 77, mode: 'mailto' })
  vi.mocked(api.listLedgerContacts).mockResolvedValue([])
  vi.mocked(api.listRecipientLists).mockResolvedValue([])
  vi.mocked(api.listEmployees).mockResolvedValue({ items: [], total: 0 } as never)
  // The reference-PDF prefetch is a real `fetch`; keep every test offline
  // unless it opts in.
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('OutlookHandoffDialog prefill', () => {
  it('renders the To, Cc, subject and reference a basket prefill carried in', async () => {
    renderDialog({
      to: ['hr@gssg.ae'],
      cc: ['ops@gssg.ae'],
      subject: 'طلب اجازة سنوية',
      bodyHtml: '<p>letter</p>',
      references: [BOOK_REF],
      attachRefPdf: true,
    })

    expect(await screen.findByDisplayValue('طلب اجازة سنوية')).toBeInTheDocument()
    expect(screen.getByText('hr@gssg.ae')).toBeInTheDocument()
    // A prefilled Cc reveals the row instead of hiding recipients behind a toggle.
    expect(screen.getByText('ops@gssg.ae')).toBeInTheDocument()
    expect(screen.getByText('GS-0048')).toBeInTheDocument()
  })
})

describe('OutlookHandoffDialog mode rules', () => {
  it('defaults to a draft and offers both modes when a mailbox is configured', async () => {
    renderDialog({ to: ['hr@gssg.ae'], subject: 'Transfer', bodyHtml: '<p>short</p>' })
    await waitFor(() => expect(draftRadio()).toBeChecked())
    expect(draftRadio()).toBeEnabled()
    expect(mailtoRadio()).toBeEnabled()
  })

  it('leaves mailto as the only option and points at Settings when no mailbox is configured', async () => {
    vi.mocked(api.getEmailAccount).mockResolvedValue(null)
    renderDialog({ to: ['hr@gssg.ae'], subject: 'Transfer', bodyHtml: '<p>short</p>' })

    await waitFor(() => expect(mailtoRadio()).toBeChecked())
    expect(draftRadio()).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent(/Settings/)
  })

  it('forces a draft and says why once a reference PDF is attached', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve(btoa('%PDF-1.4')) }),
    )
    renderDialog({
      to: ['hr@gssg.ae'],
      subject: 'Transfer',
      bodyHtml: '<p>short</p>',
      references: [BOOK_REF],
      attachRefPdf: true,
    })

    await waitFor(() => expect(mailtoRadio()).toBeDisabled())
    expect(draftRadio()).toBeChecked()
    expect(screen.getByRole('status')).toHaveTextContent(/Attachments can only travel/)
    expect(screen.getByText('GS-0048.pdf')).toBeInTheDocument()
  })

  it('forces a draft when the message outgrows a mailto link', async () => {
    renderDialog({
      to: ['hr@gssg.ae'],
      subject: 'Transfer',
      bodyHtml: `<p>${'x'.repeat(MAILTO_MAX + 200)}</p>`,
    })

    await waitFor(() => expect(mailtoRadio()).toBeDisabled())
    expect(draftRadio()).toBeChecked()
    expect(screen.getByRole('status')).toHaveTextContent(/too long/)
  })
})

describe('OutlookHandoffDialog submit', () => {
  it('records the pending row then opens Outlook with an encoded mailto URL', async () => {
    vi.mocked(api.getEmailAccount).mockResolvedValue(null)
    const assign = vi.spyOn(browserNavigation, 'assign').mockImplementation(() => {})
    const { onHandedOff } = renderDialog({
      to: ['hr@gssg.ae'],
      cc: ['ops@gssg.ae'],
      subject: 'كتاب رقم GS-0048',
      bodyHtml: '<p>Please find the record attached.</p>',
      references: [BOOK_REF],
    })

    await waitFor(() => expect(mailtoRadio()).toBeChecked())
    await userEvent.click(screen.getByRole('button', { name: /Hand off to Outlook/ }))

    await waitFor(() => expect(api.emailHandoff).toHaveBeenCalledTimes(1))
    const [body, files] = vi.mocked(api.emailHandoff).mock.calls[0]
    expect(body).toMatchObject({
      to: ['hr@gssg.ae'],
      cc: ['ops@gssg.ae'],
      subject: 'كتاب رقم GS-0048',
      mode: 'mailto',
      related_book_id: 48,
      // Outlook applies its own signature on a mailto compose.
      use_signature: false,
    })
    // Mailto cannot carry attachments; nothing is uploaded for Outlook to lose.
    expect(files).toEqual([])

    const url = assign.mock.calls[0][0]
    expect(url.startsWith('mailto:hr@gssg.ae?')).toBe(true)
    expect(url).toContain(`subject=${encodeURIComponent('كتاب رقم GS-0048')}`)
    expect(url).toContain(`cc=${encodeURIComponent('ops@gssg.ae')}`)
    expect(url).toContain(encodeURIComponent('Please find the record attached.'))
    expect(url.length).toBeLessThanOrEqual(MAILTO_MAX)
    expect(onHandedOff).toHaveBeenCalledWith(77)
  })

  it('refuses to hand off without a recipient', async () => {
    renderDialog({ subject: 'Transfer', bodyHtml: '<p>short</p>' })
    await userEvent.click(screen.getByRole('button', { name: /Hand off to Outlook/ }))
    expect(await screen.findByText('At least one recipient is required')).toBeInTheDocument()
    expect(api.emailHandoff).not.toHaveBeenCalled()
  })
})

describe('OutlookHandoffDialog mailto encoding helpers', () => {
  it('keeps addresses literal and encodes every query value', () => {
    const url = buildMailtoUrl(['a@x.ae', 'b@x.ae'], ['c@x.ae'], 'رقم GS-0048', 'line one\nline two')
    expect(url.startsWith('mailto:a@x.ae,b@x.ae?')).toBe(true)
    expect(url).toContain(`subject=${encodeURIComponent('رقم GS-0048')}`)
    expect(url).toContain(`body=${encodeURIComponent('line one\nline two')}`)
  })

  it('renders HTML as readable plain text with block boundaries preserved', () => {
    expect(htmlToPlainText('<p>Hello</p><p>World<br>again</p>')).toBe('Hello\nWorld\nagain')
  })

  it('drops the quoted original so mailto never re-sends the thread', () => {
    const quoted = '<p>my reply</p><div data-gssg-quote><p>the original</p></div>'
    expect(stripQuote(quoted)).not.toContain('the original')
    expect(stripQuote(quoted)).toContain('my reply')
  })
})
