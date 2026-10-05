/** The phone full-screen viewer starts each paper fit-to-width. */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { Paper } from '../recordPapers'
import { FullscreenViewer } from './FullscreenViewer'

vi.mock('@/pages/application/DocPdfCanvas', () => ({
  default: ({ pdfUrl, onPageChange }: { pdfUrl: string; onPageChange?: (p: number, total: number) => void }) => (
    <button type="button" data-testid="doc-pdf-canvas" data-url={pdfUrl} onClick={() => onPageChange?.(3, 5)} />
  ),
}))

const papers: Paper[] = [
  { kind: 'generated', url: '/a.pdf', downloadUrl: '/a.pdf', filename: 'a.pdf', isPdf: true },
  { kind: 'signed', url: '/b.pdf', downloadUrl: '/b.pdf', filename: 'b.pdf', isPdf: true },
]

function mount(selectedKey: 'generated' | 'signed'): React.JSX.Element {
  return (
    <FullscreenViewer
      papers={papers}
      labels={['Original', 'Signed']}
      selectedKey={selectedKey}
      onSelect={vi.fn()}
      onClose={vi.fn()}
    />
  )
}

describe('FullscreenViewer', () => {
  it('resets the page counter and zoom when the paper changes', async () => {
    const { rerender } = render(mount('generated'))
    fireEvent.click(await screen.findByTestId('doc-pdf-canvas'))
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    expect(screen.getByText('3 / 5')).toBeInTheDocument()
    expect(screen.getByTestId('doc-pdf-canvas').parentElement!.style.width).toBe('150%')

    rerender(mount('signed'))
    expect(screen.queryByText('3 / 5')).not.toBeInTheDocument()
    expect((await screen.findByTestId('doc-pdf-canvas')).parentElement!.style.width).toBe('100%')
  })
})
