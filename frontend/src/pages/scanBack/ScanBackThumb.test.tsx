import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

import type { BookRead } from '@/lib/api'
import { ScanBackThumb } from './ScanBackThumb'

// pdf.js can't run in jsdom — same stand-in ScanMatchDialog.test.tsx uses.
vi.mock('@/pages/scanInbox/ScanPdfCanvas', () => ({
  default: ({ pdfUrl }: { pdfUrl: string }) => <div data-testid="pdf-canvas">{pdfUrl}</div>,
}))

const book = (versions: BookRead['versions']): BookRead =>
  ({ id: 7, ref_number: 'GS-0410', subject: 'Ack', created_at: '2026-06-25 12:00:00', versions }) as BookRead

describe('ScanBackThumb', () => {
  it('renders the current version page-1 preview', async () => {
    render(<ScanBackThumb book={book([{ version_no: 1, document_id: 11 }, { version_no: 2, document_id: 22 }] as BookRead['versions'])} />)
    // Newest version wins — the operator files against the paper they printed last.
    expect(await screen.findByTestId('pdf-canvas')).toHaveTextContent('/documents/22/download?format=pdf')
  })

  // Word-authored / conversion-failed records have no generated document; the
  // row must still render rather than blank out.
  it('falls back to an icon tile when the record has no document', () => {
    render(<ScanBackThumb book={book([])} />)
    expect(screen.queryByTestId('pdf-canvas')).not.toBeInTheDocument()
  })
})
