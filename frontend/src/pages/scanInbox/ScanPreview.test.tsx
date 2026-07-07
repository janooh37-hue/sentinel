import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ScanPreview } from './ScanPreview'
import * as apiMod from '../../lib/api'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}))

// pdf.js won't render under jsdom — stub the lazy canvas.
vi.mock('./ScanPdfCanvas', () => ({
  default: () => <div data-testid="pdf-canvas" />,
}))

describe('ScanPreview', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(apiMod.api, 'scanDocumentUrl').mockReturnValue('/api/v1/scan-inbox/7/document')
  })

  it('renders an <img> for an image scan', () => {
    render(<ScanPreview itemId={7} filename="scan.jpg" variant="card" />)
    const img = screen.getByRole('img')
    expect(img).toHaveAttribute('src', '/api/v1/scan-inbox/7/document')
  })

  it('renders the pdf canvas for a pdf scan', async () => {
    render(<ScanPreview itemId={7} filename="scan.pdf" variant="card" />)
    expect(await screen.findByTestId('pdf-canvas')).toBeInTheDocument()
  })

  it('opens the full-screen viewer when the frame is clicked', () => {
    render(<ScanPreview itemId={7} filename="scan.jpg" variant="card" />)
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'scanInbox.openZoom' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
