/**
 * The progress rail's three shapes (docked ≥1280, 52px strip, 280px overlay),
 * focus hiding it, and the phone full-screen viewer's dialog contract.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Paper } from '../recordPapers'
import { FullscreenViewer } from './FullscreenViewer'
import { RecordChromeProvider, useRecordChrome } from './RecordChrome'
import { RecordRail, type Station } from './RecordRail'
import type { RecordView } from './recordActions'

vi.mock('@/pages/application/DocPdfCanvas', () => ({
  default: ({ pdfUrl }: { pdfUrl: string }) => <div data-testid="doc-pdf-canvas" data-url={pdfUrl} />,
}))

const stations: Station[] = [
  { key: 'created', icon: null, label: 'First version created', meta: 'v1', state: 'done', tone: 'navy' },
  { key: 'await', icon: null, label: 'Awaiting signature', meta: 'manager', state: 'live', tone: 'amber' },
]
const view = { isAr: false, stations, currentSteps: [], current: undefined, liveVersion: undefined } as unknown as RecordView

function FocusToggle(): React.JSX.Element {
  const chrome = useRecordChrome()
  return (
    <button type="button" onClick={() => chrome.setFocus(!chrome.focus)}>
      toggle focus
    </button>
  )
}

function setWidth(width: number): void {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true, writable: true })
}

function renderRail(): void {
  render(
    <RecordChromeProvider>
      <RecordRail book={undefined} view={view} />
      <FocusToggle />
    </RecordChromeProvider>,
  )
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

afterEach(() => setWidth(1024))

describe('RecordRail', () => {
  it('docks at 1280 and up with a Hide control that collapses it to the strip', async () => {
    setWidth(1440)
    renderRail()
    const aside = document.querySelector('[data-record-rail]')
    expect(aside).toHaveAttribute('data-record-rail', 'open')
    expect(aside?.className).toContain('w-[15rem]')
    expect(screen.getByText('First version created')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Hide progress' }))
    expect(document.querySelector('[data-record-rail]')).toHaveAttribute('data-record-rail', 'strip')
    expect(screen.queryByText('First version created')).not.toBeInTheDocument()
    // the strip never relies on colour alone: the current station is in its accessible name's content
    expect(screen.getByRole('button', { name: 'Show progress' })).toHaveTextContent('Awaiting signature')
  })

  it('below 1280 is a 52px strip whose toggle opens a 280px overlay and closes again', async () => {
    setWidth(1024)
    renderRail()
    const strip = document.querySelector('[data-record-rail="strip"]')
    expect(strip?.className).toContain('w-[52px]')

    const toggle = screen.getByRole('button', { name: 'Show progress' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(toggle)

    const overlay = document.querySelector('[data-record-rail="overlay"]')
    expect(overlay?.className).toContain('w-[280px]')
    expect(overlay?.className).toContain('right-0')
    expect(screen.getByRole('button', { name: 'Show progress' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('First version created')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(document.querySelector('[data-record-rail="overlay"]')).toBeNull()
  })

  it('is hidden in focus mode', async () => {
    setWidth(1440)
    renderRail()
    await userEvent.click(screen.getByRole('button', { name: 'toggle focus' }))
    expect(document.querySelector('[data-record-rail]')).toBeNull()
  })
})

describe('FullscreenViewer', () => {
  const papers: Paper[] = [
    { kind: 'signed', url: '/signed.pdf', downloadUrl: '/signed.pdf', filename: 'GS-1-signed.pdf', isPdf: true },
    { kind: 'generated', url: '/orig.pdf', downloadUrl: '/orig.pdf', filename: 'GS-1.pdf', isPdf: true },
  ]
  const labels = ['Signed copy', 'Original (unsigned)']

  it('is a modal dialog showing the same papers, closable by button and Esc', async () => {
    const onClose = vi.fn()
    const onSelect = vi.fn()
    render(
      <FullscreenViewer papers={papers} labels={labels} selectedKey="signed" onSelect={onSelect} onClose={onClose} />,
    )

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect((await screen.findByTestId('doc-pdf-canvas')).dataset.url).toBe('/signed.pdf')
    expect(screen.getByRole('button', { name: 'Signed copy' })).toHaveAttribute('aria-pressed', 'true')

    await userEvent.click(screen.getByRole('button', { name: 'Original (unsigned)' }))
    expect(onSelect).toHaveBeenCalledWith('generated')

    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
