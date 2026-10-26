import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ScanMatchDialog } from './ScanMatchDialog'
import type { ScanInboxItem } from '../../lib/api'
import * as apiMod from '../../lib/api'
import { toast } from '@/lib/toast'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}))

vi.mock('./ScanPdfCanvas', () => ({ default: () => <div data-testid="pdf-canvas" /> }))
vi.mock('@/lib/toast', () => ({ toast: {
  loading: vi.fn(() => 'scan-job'), success: vi.fn(), error: vi.fn(), dismiss: vi.fn(),
} }))

const item = { id: 7, filename: 'scan.pdf', state: 'unrouted' } as unknown as ScanInboxItem

function renderDialog() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <ScanMatchDialog item={item} onClose={vi.fn()} />
    </QueryClientProvider>,
  )
}

describe('ScanMatchDialog', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
    vi.spyOn(apiMod.api, 'scanDocumentUrl').mockReturnValue('/api/v1/scan-inbox/7/document')
    vi.spyOn(apiMod.api, 'listBooks').mockResolvedValue({ items: [], total: 0 } as never)
    vi.spyOn(apiMod.api, 'lookupEmployees').mockResolvedValue({
      items: [{ id: 'G1', name_en: 'Ahmed Ali', name_ar: null }],
      total: 1,
    } as never)
  })

  it('shows the scan preview inside the dialog', () => {
    renderDialog()
    expect(screen.getByRole('button', { name: 'scanInbox.openZoom' })).toBeInTheDocument()
  })

  it('opens the zoom viewer above the match dialog (z-order)', () => {
    // Image fixture so the viewer renders <img>, not the lazy pdf.js PdfViewer.
    const imgItem = { id: 7, filename: 'scan.jpg', state: 'unrouted' } as unknown as ScanInboxItem
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={qc}>
        <ScanMatchDialog item={imgItem} onClose={vi.fn()} />
      </QueryClientProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'scanInbox.openZoom' }))
    // Both dialogs coexist; the full-screen lightbox must sit above the
    // z-[80] match dialog (regression guard for the z-index inversion).
    expect(screen.getAllByRole('dialog')).toHaveLength(2)
    expect(screen.getByRole('dialog', { name: 'viewer.title' }).className).toContain('z-[90]')
  })

  it('searches employees and routes the item on pick', async () => {
    const route = vi.spyOn(apiMod.api, 'routeScanItem').mockResolvedValue({} as never)
    renderDialog()
    fireEvent.change(screen.getByPlaceholderText('scanInbox.match.searchPlaceholder'), {
      target: { value: 'ahmed' },
    })
    const row = await screen.findByText('Ahmed Ali')
    fireEvent.click(row)
    await waitFor(() => expect(route).toHaveBeenCalledWith(7, { employee_id: 'G1' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('scanInbox.toast.filed', {
      id: 'scan-job', description: 'Ahmed Ali', reference: undefined,
    }))
  })

  it('keeps the selected book reference without an Undo action', async () => {
    const route = vi.spyOn(apiMod.api, 'routeScanItem').mockResolvedValue({} as never)
    vi.spyOn(apiMod.api, 'listBooks').mockResolvedValue({
      items: [{ id: 42, ref_number: 'GS-0410', subject: 'Leave' }], total: 1,
    } as never)
    renderDialog()
    fireEvent.change(screen.getByPlaceholderText('scanInbox.match.searchPlaceholder'), {
      target: { value: 'GS-0410' },
    })
    fireEvent.click(await screen.findByText('GS-0410'))
    await waitFor(() => expect(route).toHaveBeenCalledWith(7, { book_id: 42, employee_id: undefined }))
    await waitFor(() => expect(toast.success).toHaveBeenCalled())
    const options = vi.mocked(toast.success).mock.calls[0][1]!
    expect(options).toEqual({ id: 'scan-job', reference: 'GS-0410', description: undefined })
  })
})
