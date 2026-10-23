import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { ScanInboxCard } from './ScanInboxCard'
import type { ScanInboxItem } from '../../lib/api'
import * as apiMod from '../../lib/api'
import { toast } from '@/lib/toast'

const localeState = vi.hoisted(() => ({ language: 'en' }))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) =>
      o?.dest ? `${k}:${o.dest}` : o?.date ? `${k}:${o.date}` : k,
    i18n: { language: localeState.language },
  }),
}))
// pdf.js needs DOMMatrix, which jsdom lacks; the preview is not under test here.
vi.mock('./ScanPdfCanvas', () => ({ default: () => <div data-testid="pdf-canvas" /> }))
vi.mock('@/lib/toast', () => ({ toast: {
  loading: vi.fn(() => 'scan-job'), success: vi.fn(), error: vi.fn(), dismiss: vi.fn(),
} }))

function base(overrides: Partial<ScanInboxItem>): ScanInboxItem {
  return {
    id: 1, filename: 'scan.pdf', state: 'unrouted', fields: {}, candidates: [],
    proposed_route: null, proposed_ref: null, proposed_employee_id: null,
    proposed_employee_name_en: null, proposed_employee_name_ar: null,
    proposed_book_id: null, confidence_tier: 'manual', document_type: null,
    email_sender: null, email_subject: null, ledger_entry_id: null,
    ...overrides,
  } as ScanInboxItem
}

function renderCard(item: ScanInboxItem) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ScanInboxCard item={item} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('ScanInboxCard', () => {
  beforeEach(() => {
    localeState.language = 'en'
    vi.restoreAllMocks()
    vi.clearAllMocks()
    vi.spyOn(apiMod.api, 'scanDocumentUrl').mockReturnValue('/x')
  })

  it('files an unrouted item via a candidate chip', async () => {
    const route = vi.spyOn(apiMod.api, 'routeScanItem').mockResolvedValue({} as never)
    renderCard(base({
      candidates: [{ employee_id: 'G1', name_en: 'Ahmed Ali', name_ar: null, score: 0.82 }],
    }))
    fireEvent.click(screen.getByText(/scanInbox.fileTo:Ahmed Ali/))
    await waitFor(() => expect(route).toHaveBeenCalledWith(1, { employee_id: 'G1' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('scanInbox.toast.filed', {
      id: 'scan-job', description: 'Ahmed Ali',
    }))
  })

  it('shows a destination deep-link for an auto-filed item', () => {
    renderCard(base({
      state: 'auto_filed', proposed_route: 'employee_doc',
      proposed_employee_id: 'G5', proposed_employee_name_en: 'Sara Omar',
    }))
    const link = screen.getByText('scanInbox.openInFile').closest('a')
    expect(link).toHaveAttribute('href', '/employees/G5')
  })

  it('keeps Undo available for an auto-filed item', async () => {
    const undo = vi.spyOn(apiMod.api, 'undoScanItem').mockResolvedValue({} as never)
    renderCard(base({
      state: 'auto_filed', proposed_route: 'book_attach',
      proposed_ref: 'GS-0410', proposed_book_id: 42,
    }))
    fireEvent.click(screen.getByRole('button', { name: 'scanInbox.actions.undo' }))
    await waitFor(() => expect(undo).toHaveBeenCalledWith(1))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('scanInbox.toast.undone', {
      id: 'scan-job', reference: 'GS-0410',
    }))
  })

  it('re-match: undo is called then ScanMatchDialog opens', async () => {
    const undo = vi.spyOn(apiMod.api, 'undoScanItem').mockResolvedValue({} as never)
    vi.spyOn(apiMod.api, 'lookupEmployees').mockResolvedValue({ items: [], total: 0 } as never)
    vi.spyOn(apiMod.api, 'listBooks').mockResolvedValue({ items: [], total: 0 } as never)
    renderCard(base({
      state: 'auto_filed', proposed_route: 'employee_doc',
      proposed_employee_id: 'G5', proposed_employee_name_en: 'Sara Omar',
    }))
    fireEvent.click(screen.getByText('scanInbox.reMatch'))
    await waitFor(() => expect(undo).toHaveBeenCalledWith(1))
    await screen.findByPlaceholderText('scanInbox.match.searchPlaceholder')
    expect(toast.success).not.toHaveBeenCalled()
    expect(toast.dismiss).toHaveBeenCalledWith('scan-job')
  })

  it('auto-expands an awaiting_confirmation item (preview visible without a click)', () => {
    renderCard(base({
      state: 'awaiting_confirmation', filename: 'scan.jpg',
      proposed_route: 'employee_doc', proposed_employee_id: 'G5',
      proposed_employee_name_en: 'Sara Omar', confidence_tier: 'confirm',
    }))
    expect(screen.getByRole('button', { name: 'scanInbox.openZoom' })).toBeInTheDocument()
  })

  it('keeps an unrouted item collapsed until the chevron is clicked', () => {
    renderCard(base({ state: 'unrouted', filename: 'scan.jpg' }))
    expect(screen.queryByRole('button', { name: 'scanInbox.openZoom' })).toBeNull()
    fireEvent.click(screen.getByLabelText('scanInbox.showDetails'))
    expect(screen.getByRole('button', { name: 'scanInbox.openZoom' })).toBeInTheDocument()
  })

  it('shows the barcode date mismatch as a header hint, not an OCR field', () => {
    renderCard(base({
      state: 'awaiting_confirmation',
      confidence_tier: 'confirm',
      proposed_route: 'book_attach',
      proposed_ref: '1/5/141',
      proposed_book_id: 42,
      fields: { barcode_date_mismatch: '2026-09-21', name_en: 'Ahmed' },
    }))

    expect(screen.getByText(/^scanInbox\.barcodeDateMismatch:/)).toBeInTheDocument()
    expect(screen.queryByText('scanInbox.ocrField.barcode_date_mismatch')).not.toBeInTheDocument()
    expect(screen.getByText('scanInbox.ocrField.name_en')).toBeInTheDocument()
  })

  it('strips directional marks from an Arabic-formatted mismatch date', () => {
    localeState.language = 'ar'
    renderCard(base({
      fields: { barcode_date_mismatch: '2026-09-21' },
    }))

    expect(screen.getByText(/^scanInbox\.barcodeDateMismatch:/).textContent)
      .not.toMatch(/[\u200e\u200f]/)
  })

  it.each(['confirm', 'dismiss'])('shows %s success without an Undo action', async (operation) => {
    vi.spyOn(apiMod.api, 'confirmScanItem').mockResolvedValue({} as never)
    vi.spyOn(apiMod.api, 'dismissScanItem').mockResolvedValue({} as never)
    renderCard(base({
      state: 'awaiting_confirmation', proposed_route: 'book_attach',
      proposed_ref: 'GS-0410', proposed_book_id: 42, confidence_tier: 'confirm',
    }))
    fireEvent.click(screen.getByRole('button', {
      name: operation === 'confirm' ? 'scanInbox.fileTo:GS-0410' : 'scanInbox.actions.dismiss',
    }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(
      operation === 'confirm' ? 'scanInbox.toast.filed' : 'scanInbox.toast.dismissed',
      operation === 'confirm' ? { id: 'scan-job', reference: 'GS-0410' } : { id: 'scan-job' },
    ))
    const options = vi.mocked(toast.success).mock.calls[0][1]!
    expect(options).not.toHaveProperty('action')
    expect(options).not.toHaveProperty('duration')
  })
})
