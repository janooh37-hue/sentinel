import { useEffect } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

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
})
