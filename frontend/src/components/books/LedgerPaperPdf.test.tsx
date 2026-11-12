import { useEffect } from 'react'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import i18n from '@/lib/i18n'
import { leasePdfUrl } from '@/lib/pdfDocCache'
import { LedgerPaperPdf } from './LedgerPaperPdf'

let autoPaint = true
let paint: () => void

vi.mock('@/lib/pdfDocCache', () => ({ leasePdfUrl: vi.fn(), PdfFetchError: class extends Error {} }))
// PdfPages is the rendering seam: these host tests need only the lease lifetime,
// while its stub supplies page-position events instead of a PDFDocumentProxy.
vi.mock('./PdfPages', () => {
  return { PdfPages: ({ onCurrentPage, onPainted }: { onCurrentPage: (page: number, total: number) => void; onPainted: () => void }) => {
    useEffect(() => { onCurrentPage(2, 3) }, [onCurrentPage])
    paint = onPainted
    useEffect(() => { if (autoPaint) onPainted() }, [onPainted])
    return <canvas aria-label="PDF pages" />
  } }
})

afterEach(async () => { autoPaint = true; cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); await i18n.changeLanguage('en') })

it.each([
  ['en', 'Page 2 of 3', 'Fit width', 'Zoom in', 'Zoom out'],
  ['ar', 'صفحة 2 من 3', 'ملاءمة العرض', 'تكبير', 'تصغير'],
])('renders scrollable pages and zoom controls in %s', async (lng, count, fit, zoomIn, zoomOut) => {
  await i18n.changeLanguage(lng)
  const release = vi.fn()
  const onReady = vi.fn()
  vi.mocked(leasePdfUrl, { partial: true }).mockResolvedValue({ release })
  const { rerender } = render(<LedgerPaperPdf url="/paper.pdf?revision=71" title="Proof" onReady={onReady} />)
  expect(await screen.findByText(count)).toBeInTheDocument()
  expect(onReady).toHaveBeenCalledTimes(1)
  const region = screen.getByRole('region', { name: 'Proof' })
  expect(region).toHaveAttribute('dir', lng === 'ar' ? 'rtl' : 'ltr')
  expect(leasePdfUrl).toHaveBeenCalledWith('/paper.pdf?revision=71', expect.any(AbortSignal))
  const scroll = screen.getByRole('region', { name: i18n.t('ledgerBook.paper.pagesLabel', { title: 'Proof' }) })
  expect(scroll).toHaveClass('overflow-auto', 'min-w-0')
  const pages = screen.getByLabelText('PDF pages').closest('[data-ledger-pdf-width]')
  await userEvent.click(screen.getByRole('button', { name: zoomIn }))
  expect(pages).toHaveStyle({ width: '125%' })
  await userEvent.click(screen.getByRole('button', { name: zoomOut }))
  expect(pages).toHaveStyle({ width: '100%' })
  await userEvent.click(screen.getByRole('button', { name: zoomIn }))
  await userEvent.click(screen.getByRole('button', { name: fit }))
  expect(pages).toHaveStyle({ width: '100%' })
  rerender(<LedgerPaperPdf url="/paper.pdf?revision=72" title="Proof" />)
  await waitFor(() => expect(leasePdfUrl).toHaveBeenCalledWith('/paper.pdf?revision=72', expect.any(AbortSignal)))
  await waitFor(() => expect(release).toHaveBeenCalled())
})

it('swaps the document in place for the same book, keeping zoom; another book starts afresh', async () => {
  const releases: ReturnType<typeof vi.fn>[] = []
  vi.mocked(leasePdfUrl, { partial: true }).mockImplementation(() => {
    const release = vi.fn()
    releases.push(release)
    return Promise.resolve({ release })
  })
  const { rerender } = render(<LedgerPaperPdf url="/api/v1/ledger/drafts/5/paper.pdf?ts=1" title="Proof" />)
  await screen.findByLabelText('PDF pages')
  const pages = screen.getByLabelText('PDF pages').closest('[data-ledger-pdf-width]')
  await userEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
  expect(pages).toHaveStyle({ width: '125%' })

  // An autosave re-issues the URL with a new ts: same element, same zoom, old lease held until the new one lands.
  rerender(<LedgerPaperPdf url="/api/v1/ledger/drafts/5/paper.pdf?ts=2" title="Proof" />)
  await waitFor(() => expect(leasePdfUrl).toHaveBeenCalledWith('/api/v1/ledger/drafts/5/paper.pdf?ts=2', expect.any(AbortSignal)))
  await waitFor(() => expect(releases[0]).toHaveBeenCalled())
  expect(screen.getByLabelText('PDF pages').closest('[data-ledger-pdf-width]')).toBe(pages)
  expect(pages).toHaveStyle({ width: '125%' })
  expect(releases[1]).not.toHaveBeenCalled()

  rerender(<LedgerPaperPdf url="/api/v1/ledger/drafts/6/paper.pdf?ts=1" title="Proof" />)
  await waitFor(() => expect(screen.getByLabelText('PDF pages').closest('[data-ledger-pdf-width]')).toHaveStyle({ width: '100%' }))
  expect(screen.getByLabelText('PDF pages').closest('[data-ledger-pdf-width]')).not.toBe(pages)
})

it.each(['en', 'ar'])('shows loading and a retryable rendering error in %s', async (lng) => {
  await i18n.changeLanguage(lng)
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const { rerender } = render(<LedgerPaperPdf url={null} />)
  expect(screen.getByRole('status', { name: i18n.t('ledgerBook.paper.loading') })).toBeInTheDocument()
  vi.mocked(leasePdfUrl).mockRejectedValue(new Error('Unavailable'))
  rerender(<LedgerPaperPdf url="/failed.pdf" />)
  const retry = await screen.findByRole('button', { name: i18n.t('common.retry') })
  expect(screen.getByText(i18n.t('books.paper.errorTitle'))).toBeInTheDocument()
  vi.mocked(leasePdfUrl, { partial: true }).mockResolvedValue({ release: vi.fn() })
  await userEvent.click(retry)
  expect(await screen.findByText(i18n.t('ledgerBook.paper.pageCount', { page: 2, total: 3 }))).toBeInTheDocument()
})

it('acknowledges each requested hash only after its own pages paint', async () => {
  autoPaint = false
  const firstReady = vi.fn()
  const nextReady = vi.fn()
  vi.mocked(leasePdfUrl, { partial: true }).mockResolvedValueOnce({ release: vi.fn() })
  const view = render(<LedgerPaperPdf url="/paper.pdf?revision=71&content_sha256=first" onReady={firstReady} />)
  await screen.findByLabelText('PDF pages')
  expect(firstReady).not.toHaveBeenCalled()
  act(() => paint())
  expect(firstReady).toHaveBeenCalledTimes(1)
  let accept!: () => void
  vi.mocked(leasePdfUrl, { partial: true }).mockImplementationOnce(() => new Promise((resolve) => { accept = () => resolve({ release: vi.fn() }) }))
  view.rerender(<LedgerPaperPdf url="/paper.pdf?revision=71&content_sha256=next" onReady={nextReady} />)
  await waitFor(() => expect(leasePdfUrl).toHaveBeenLastCalledWith('/paper.pdf?revision=71&content_sha256=next', expect.any(AbortSignal)))
  act(() => paint())
  expect(nextReady).not.toHaveBeenCalled()
  await act(async () => { accept() })
  expect(nextReady).not.toHaveBeenCalled()
  act(() => paint())
  expect(nextReady).toHaveBeenCalledTimes(1)
  act(() => paint())
  expect(nextReady).toHaveBeenCalledTimes(1)
})
