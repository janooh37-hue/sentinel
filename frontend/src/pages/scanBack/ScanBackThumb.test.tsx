import { useEffect } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { BookRead } from '@/lib/api'
import { ScanBackThumb } from './ScanBackThumb'

// pdf.js can't run in jsdom — same stand-in ScanMatchDialog.test.tsx uses.
// Document 99 stands for a record whose PDF won't render (DOCX->PDF left
// `pdf_path` NULL), so the onError branch is exercised too.
vi.mock('@/pages/scanInbox/ScanPdfCanvas', () => {
  function MockScanPdfCanvas({ pdfUrl, onError }: { pdfUrl: string; onError?: () => void }) {
    const broken = pdfUrl.includes('/99/')
    useEffect(() => {
      if (broken) onError?.()
    }, [broken, onError])
    return broken ? null : <div data-testid="pdf-canvas">{pdfUrl}</div>
  }
  return { default: MockScanPdfCanvas }
})

// The real lightbox portals + lazy-loads pdf.js; here we only care that the
// thumb opens it, and with which document.
vi.mock('@/components/ui/document-viewer-dialog', () => ({
  DocumentViewerDialog: ({ items }: { items: { name: string; downloadUrl: string }[] }) => (
    <div data-testid="viewer">{`${items[0]?.name} | ${items[0]?.downloadUrl}`}</div>
  ),
}))

const book = (versions: BookRead['versions']): BookRead =>
  ({ id: 7, ref_number: 'GS-0410', subject: 'Ack', created_at: '2026-06-25 12:00:00', versions }) as BookRead

const versions = (...docIds: number[]): BookRead['versions'] =>
  docIds.map((document_id, i) => ({ version_no: i + 1, document_id })) as BookRead['versions']

describe('ScanBackThumb', () => {
  it('renders the current version page-1 preview', async () => {
    render(<ScanBackThumb book={book(versions(11, 22))} />)
    // Newest version wins — the operator files against the paper they printed last.
    expect(await screen.findByTestId('pdf-canvas')).toHaveTextContent('/documents/22/download?format=pdf')
  })

  // Word-authored / conversion-failed records must still render a row.
  it('falls back to an icon tile when the record has no document', () => {
    render(<ScanBackThumb book={book([])} />)
    expect(screen.getByTestId('thumb-fallback')).toBeInTheDocument()
    expect(screen.queryByTestId('pdf-canvas')).not.toBeInTheDocument()
  })

  it('falls back to the icon tile when the PDF fails to render', async () => {
    render(<ScanBackThumb book={book(versions(99))} />)
    expect(await screen.findByTestId('thumb-fallback')).toBeInTheDocument()
  })

  // A 128px crop narrows the form down; only the full sheet identifies it.
  it('opens the full-screen viewer on the record document', async () => {
    render(<ScanBackThumb book={book(versions(22))} />)
    expect(screen.queryByTestId('viewer')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button'))
    expect(screen.getByTestId('viewer')).toHaveTextContent(
      'GS-0410 — Ack | /api/v1/documents/22/download?format=pdf',
    )
  })

  // Nothing to open, so the tile must not become a focus stop.
  it('is not clickable when the record has no document', () => {
    render(<ScanBackThumb book={book([])} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
