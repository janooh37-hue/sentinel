/**
 * OutlookHandoffDialog — the adaptive mode rules are the whole point of this
 * surface, so they get the coverage: what the operator may choose, what the app
 * chooses for them and why, and what actually leaves the browser.
 *
 * Asserted against real English strings (the test setup boots i18n with
 * en.json), so a missing or reworded key fails here rather than shipping.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as ApiModule from '@/lib/api'
import { api } from '@/lib/api'
import i18n from '@/lib/i18n'
import * as refPdfAttachments from '@/lib/refPdfAttachments'
import { toast } from '@/lib/toast'
import { OutlookHandoffDialog } from './OutlookHandoffDialog'
import {
  browserNavigation,
  buildMailtoUrl,
  htmlToPlainText,
  MAILTO_MAX,
  stripQuote,
} from './outlookHandoffUtils'

vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof ApiModule>()
  return {
    ...real,
    api: {
      ...real.api,
      getEmailAccount: vi.fn(),
      listLedgerContacts: vi.fn().mockResolvedValue([]),
      listRecipientLists: vi.fn().mockResolvedValue([]),
      lookupEmployees: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      emailHandoff: vi.fn(),
    },
  }
})
vi.mock('@/lib/useIdentity', () => ({
  useIdentity: () => ({ identity: { email: 'me@gssg.ae' }, isAdmin: false }),
}))
const { capabilities } = vi.hoisted(() => ({ capabilities: new Set<string>() }))
vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({ has: (cap: string) => capabilities.has(cap) }),
}))
// HugeRTE can't mount in jsdom — sentinel div (repo-wide convention).
vi.mock('@/components/ui/rich-editor', () => ({
  RichEditor: ({ name }: { name: string }) => <div data-testid={`rich-editor-${name}`} />,
}))
vi.mock('@/lib/toast', () => ({
  toast: Object.assign(vi.fn(), { loading: vi.fn(), dismiss: vi.fn(), success: vi.fn(), error: vi.fn() }),
}))

const BOOK_REF = {
  kind: 'book' as const,
  id: 48,
  label: 'GS-0048',
  token: 'GS-0048',
  docId: 900,
  fileName: 'GS-0048.pdf',
}

type DialogProps = Parameters<typeof OutlookHandoffDialog>[0]

function renderDialog(
  opts: { mode?: DialogProps['mode']; source?: DialogProps['source']; prefill?: DialogProps['prefill'] } = {},
): { onClose: () => void; onHandedOff: (id: number) => void; refresh: () => void } {
  const onClose = vi.fn()
  const onHandedOff = vi.fn()
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const tree = () => (
    <QueryClientProvider client={queryClient}>
      <OutlookHandoffDialog
        mode={opts.mode ?? 'new'}
        source={opts.source}
        prefill={opts.prefill ?? {}}
        onClose={onClose}
        onHandedOff={onHandedOff}
      />
    </QueryClientProvider>
  )
  const view = render(tree())
  return { onClose, onHandedOff, refresh: () => view.rerender(tree()) }
}

const draftRadio = (): HTMLElement => screen.getByRole('radio', { name: /Draft in Outlook/ })
const mailtoRadio = (): HTMLElement => screen.getByRole('radio', { name: /Open Outlook now/ })

beforeEach(() => {
  capabilities.clear()
  capabilities.add('ledger.send')
  // Call history, not just implementations — the no-recipient test asserts
  // `emailHandoff` was never reached.
  vi.clearAllMocks()
  vi.mocked(api.getEmailAccount).mockResolvedValue({ enabled: true } as never)
  vi.mocked(api.emailHandoff).mockResolvedValue({ ledger_entry_id: 77, mode: 'mailto' })
  vi.mocked(api.listLedgerContacts).mockResolvedValue([])
  vi.mocked(api.listRecipientLists).mockResolvedValue([])
  vi.mocked(api.lookupEmployees).mockResolvedValue({ items: [], total: 0 } as never)
  // The reference-PDF prefetch is a real `fetch`; keep every test offline
  // unless it opts in.
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
})

afterEach(async () => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  await i18n.changeLanguage('en')
})

describe('OutlookHandoffDialog prefill', () => {
  it('renders the To, Cc, subject and reference a basket prefill carried in', async () => {
    renderDialog({
      prefill: {
        to: ['hr@gssg.ae'],
        cc: ['ops@gssg.ae'],
        subject: 'طلب اجازة سنوية',
        bodyHtml: '<p>letter</p>',
        references: [BOOK_REF],
        attachRefPdf: true,
      },
    })

    expect(await screen.findByDisplayValue('طلب اجازة سنوية')).toBeInTheDocument()
    expect(screen.getByText('hr@gssg.ae')).toBeInTheDocument()
    // A prefilled Cc reveals the row instead of hiding recipients behind a toggle.
    expect(screen.getByText('ops@gssg.ae')).toBeInTheDocument()
    expect(screen.getByText('GS-0048')).toBeInTheDocument()
  })
})

describe('Outlook handoff authorization', () => {
  it.each(['new', 'reply', 'replyall', 'forward'] as const)('blocks %s handoff submit without ledger.send, not ledger.create', async (mode) => {
    capabilities.delete('ledger.send')
    capabilities.add('ledger.create')
    renderDialog({ mode, prefill: { to: ['hr@gssg.ae'], subject: 'Draft' } })
    const submit = screen.getByRole('button', { name: i18n.t('ledger.outlook.handoff.submit') })
    expect(submit).toBeDisabled()
    fireEvent.submit(submit.closest('form')!)
    await waitFor(() => expect(api.getEmailAccount).toHaveBeenCalled())
    expect(api.emailHandoff).not.toHaveBeenCalled()
    expect(screen.getByDisplayValue('Draft')).toBeInTheDocument()
  })

  it('retains the draft but blocks submit when send access is revoked after opening', async () => {
    const dialog = renderDialog({ prefill: { to: ['hr@gssg.ae'], subject: 'Reviewed draft' } })
    await waitFor(() => expect(draftRadio()).toBeChecked())
    capabilities.delete('ledger.send')
    dialog.refresh()
    const submit = screen.getByRole('button', { name: i18n.t('ledger.outlook.handoff.submit') })
    expect(submit).toBeDisabled()
    fireEvent.submit(submit.closest('form')!)
    await waitFor(() => expect(screen.getByDisplayValue('Reviewed draft')).toBeInTheDocument())
    expect(screen.getByText('hr@gssg.ae')).toBeInTheDocument()
    expect(api.emailHandoff).not.toHaveBeenCalled()
  })
})

describe('OutlookHandoffDialog mode rules', () => {
  it('defaults to a draft and offers both modes when a mailbox is configured', async () => {
    renderDialog({ prefill: { to: ['hr@gssg.ae'], subject: 'Transfer', bodyHtml: '<p>short</p>' } })
    await waitFor(() => expect(draftRadio()).toBeChecked())
    expect(draftRadio()).toBeEnabled()
    expect(mailtoRadio()).toBeEnabled()
  })

  it('leaves mailto as the only option and points at Settings when no mailbox is configured', async () => {
    vi.mocked(api.getEmailAccount).mockResolvedValue(null)
    renderDialog({ prefill: { to: ['hr@gssg.ae'], subject: 'Transfer', bodyHtml: '<p>short</p>' } })

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
      prefill: {
        to: ['hr@gssg.ae'],
        subject: 'Transfer',
        bodyHtml: '<p>short</p>',
        references: [BOOK_REF],
        attachRefPdf: true,
      },
    })

    await waitFor(() => expect(mailtoRadio()).toBeDisabled())
    expect(draftRadio()).toBeChecked()
    expect(screen.getByRole('status')).toHaveTextContent(/Attachments can only travel/)
    expect(screen.getByText('GS-0048.pdf')).toBeInTheDocument()
  })

  it('forces a draft when the message outgrows a mailto link', async () => {
    renderDialog({
      prefill: {
        to: ['hr@gssg.ae'],
        subject: 'Transfer',
        bodyHtml: `<p>${'x'.repeat(MAILTO_MAX + 200)}</p>`,
      },
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
      prefill: {
        to: ['hr@gssg.ae'],
        cc: ['ops@gssg.ae'],
        subject: 'كتاب رقم GS-0048',
        bodyHtml: '<p>Please find the record attached.</p>',
        references: [BOOK_REF],
      },
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
    // Cc addresses are encoded per segment now, so `@` stays readable.
    expect(url).toContain('cc=ops@gssg.ae')
    expect(url).toContain(encodeURIComponent('Please find the record attached.'))
    expect(url.length).toBeLessThanOrEqual(MAILTO_MAX)
    expect(onHandedOff).toHaveBeenCalledWith(77)
  })

  it('refuses to hand off without a recipient', async () => {
    renderDialog({ prefill: { subject: 'Transfer', bodyHtml: '<p>short</p>' } })
    await userEvent.click(screen.getByRole('button', { name: /Hand off to Outlook/ }))
    expect(await screen.findByText('At least one recipient is required')).toBeInTheDocument()
    expect(api.emailHandoff).not.toHaveBeenCalled()
  })

  it.each(['en', 'ar'])('keeps the combined attachment-size validation localized in %s', async (language) => {
    await i18n.changeLanguage(language)
    const reference = new File(['pdf'], 'GS-0048.pdf', { type: 'application/pdf' })
    const manual = new File(['pdf'], 'manual.pdf', { type: 'application/pdf' })
    Object.defineProperty(reference, 'size', { value: 11 * 1024 * 1024 })
    Object.defineProperty(manual, 'size', { value: 11 * 1024 * 1024 })
    vi.spyOn(refPdfAttachments, 'base64PdfToFile').mockReturnValue(reference)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => btoa('pdf') }))
    renderDialog({
      prefill: {
        to: ['hr@gssg.ae'],
        subject: 'Transfer',
        references: [BOOK_REF],
        attachRefPdf: true,
      },
    })
    await screen.findByText(reference.name)
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!
    await userEvent.upload(input, manual)
    await screen.findByText(manual.name)
    expect(toast.error).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: i18n.t('ledger.outlook.handoff.submit') }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      i18n.t('compose.attachmentsTooLarge', { max: '20.0 MB' }),
    ))
    expect(api.emailHandoff).not.toHaveBeenCalled()
  })
})

describe('OutlookHandoffDialog reply all', () => {
  const source = {
    id: 5,
    entry_date: '2026-08-10',
    direction: 'incoming',
    channel: 'email',
    counterparty: 'Sender <sender@x.ae>',
    subject: 'Original',
    tags: [],
    notes_html: '<p>original</p>',
    to_recipients: [
      { name: '', address: 'ops@gssg.ae' },
      { name: '', address: 'peer@x.ae' },
    ],
    cc_recipients: [{ name: '', address: 'cc1@x.ae' }],
    email_references: null,
  } as unknown as DialogProps['source']

  it('drops the configured mailbox address, not just the signed-in identity', async () => {
    // The signed-in identity ('me@gssg.ae', from the module mock) is nowhere in
    // this thread, so only the CONFIGURED account address can explain
    // 'ops@gssg.ae' disappearing — which is the point: replying all must not
    // mail the mailbox the reply is sent from.
    vi.mocked(api.getEmailAccount).mockResolvedValue({
      enabled: true,
      email: 'ops@gssg.ae',
    } as never)

    renderDialog({ mode: 'replyall', source })

    expect(await screen.findByText('sender@x.ae')).toBeInTheDocument()
    expect(screen.getByText('peer@x.ae')).toBeInTheDocument()
    expect(screen.getByText('cc1@x.ae')).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.queryByText('ops@gssg.ae')).not.toBeInTheDocument(),
    )
  })
})

describe('OutlookHandoffDialog mailto encoding helpers', () => {
  it('leaves ordinary addresses readable and encodes every query value', () => {
    const url = buildMailtoUrl(['a@x.ae', 'b@x.ae'], ['c@x.ae'], 'رقم GS-0048', 'line one\nline two')
    expect(url.startsWith('mailto:a@x.ae,b@x.ae?')).toBe(true)
    expect(url).toContain(`subject=${encodeURIComponent('رقم GS-0048')}`)
    expect(url).toContain(`body=${encodeURIComponent('line one\nline two')}`)
  })

  it('percent-encodes reserved characters inside an address but not the separators', () => {
    // A display-name-free address can still carry characters that would end the
    // mailto path early ("?" starts the query, "&" splits params). Encoding
    // them keeps one address one address; the comma separators and the literal
    // "@" stay put so Outlook still parses the list.
    const url = buildMailtoUrl(['a?b&c@x.ae', 'b@x.ae'], [], 'Transfer', '')
    const path = url.slice('mailto:'.length).split('?')[0]
    expect(path.split(',')).toHaveLength(2)
    expect(path).toContain('@x.ae')
    expect(path).not.toContain('&')
    expect(decodeURIComponent(path.split(',')[0])).toBe('a?b&c@x.ae')
    expect(decodeURIComponent(path.split(',')[1])).toBe('b@x.ae')
    // The query still starts exactly once, at the real boundary.
    expect(url.split('?')).toHaveLength(2)
    expect(url).toContain('subject=Transfer')
  })

  it('percent-encodes a space rather than emitting a broken URL', () => {
    const url = buildMailtoUrl(['od d@x.ae'], [], '', '')
    expect(url).toBe('mailto:od%20d@x.ae')
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
