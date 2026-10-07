import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PermitQuickView } from './PermitQuickView'
import { api } from '@/lib/api'
import i18n from '@/lib/i18n'

vi.mock('@/pages/application/DocPdfCanvas', () => ({
  default: ({ pdfUrl }: { pdfUrl: string }) => <div data-testid="pdf" data-url={pdfUrl} />,
}))

const versions = [
  { id: 1, version_no: 1, document_id: 11, signed_pdf_url: null },
  { id: 3, version_no: 3, document_id: 13, signed_pdf_url: '/v3-signed.pdf' },
  { id: 2, version_no: 2, document_id: 12, signed_pdf_url: null },
]

function renderQuickView(props: Partial<React.ComponentProps<typeof PermitQuickView>> = {}) {
  const onClose = vi.fn()
  const onOpenFull = vi.fn()
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <PermitQuickView
        open
        onClose={onClose}
        onOpenFull={onOpenFull}
        reference="PMT-0042"
        title="Acme Contracting"
        facts={[{ label: 'Valid until', value: '22 Jul 2026' }]}
        bookId={9}
        {...props}
      />
    </QueryClientProvider>,
  )
  return { onClose, onOpenFull }
}

beforeEach(async () => {
  vi.restoreAllMocks()
  await i18n.changeLanguage('en')
})

describe('PermitQuickView', () => {
  it('renders facts immediately, before the book resolves, and names the dialog by reference', () => {
    vi.spyOn(api, 'getBook').mockReturnValue(new Promise<never>(() => {}))
    renderQuickView()
    expect(screen.getByRole('dialog', { name: /PMT-0042/ })).toBeInTheDocument()
    expect(screen.getByText('Valid until')).toBeInTheDocument()
    expect(screen.getByText('22 Jul 2026')).toBeInTheDocument()
    expect(screen.queryByTestId('pdf')).not.toBeInTheDocument()
  })

  it('renders the PDF of the highest version, signed adds rev', async () => {
    const getBook = vi.spyOn(api, 'getBook').mockResolvedValue({ id: 9, versions } as never)
    renderQuickView()
    const pdf = await screen.findByTestId('pdf')
    expect(getBook).toHaveBeenCalledWith(9)
    const url = pdf.getAttribute('data-url') ?? ''
    expect(url).toContain('/documents/13/')
    expect(url).toContain('rev=signed')
    expect(screen.getByRole('link', { name: 'Open PDF' })).toHaveAttribute('href', url)
  })

  it('shows the no-letter message and never fetches when bookId is null', () => {
    const getBook = vi.spyOn(api, 'getBook')
    renderQuickView({ bookId: null })
    expect(screen.getByText(i18n.t('permits.quickView.noLetter'))).toBeInTheDocument()
    expect(getBook).not.toHaveBeenCalled()
  })

  it('offers retry when the letter fails to load', async () => {
    vi.spyOn(api, 'getBook').mockRejectedValue(new Error('boom'))
    renderQuickView()
    expect(await screen.findByText(i18n.t('permits.quickView.letterError'))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  it('Open full details calls onOpenFull', async () => {
    vi.spyOn(api, 'getBook').mockResolvedValue({ id: 9, versions } as never)
    const { onOpenFull } = renderQuickView()
    await userEvent.click(screen.getByRole('button', { name: 'Open full details' }))
    expect(onOpenFull).toHaveBeenCalledTimes(1)
  })

  it('Escape calls onClose', async () => {
    vi.spyOn(api, 'getBook').mockResolvedValue({ id: 9, versions } as never)
    const { onClose } = renderQuickView()
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
