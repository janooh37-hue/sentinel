import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/lib/i18n'
import { ExportWorkspace } from './ExportWorkspace'
import { workflowMonth, workflowSubmission } from './workflowFixtures'

afterEach(() => vi.restoreAllMocks())

describe('ExportWorkspace', () => {
  it('offers a fixed Arabic portrait report and exports the selected submission in Arabic', async () => {
    void i18n.changeLanguage('en')
    const download = vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(() => {}))
    const client = new QueryClient()
    const { container } = render(<QueryClientProvider client={client}><ExportWorkspace month={workflowMonth()} submissionId={42} /></QueryClientProvider>)
    expect(screen.queryByRole('radio', { name: 'English' })).toBeNull()
    expect(screen.queryByRole('radio', { name: 'Landscape' })).toBeNull()
    expect(Array.from(container.querySelectorAll('[data-inmate-register-document]'), (paper) => [paper.getAttribute('lang'), paper.getAttribute('dir')])).toEqual([['ar', 'rtl'], ['ar', 'rtl']])
    await userEvent.click(screen.getByRole('button', { name: 'XLSX file' }))
    await waitFor(() => expect(download).toHaveBeenCalled())
    const request = new URL(String(download.mock.calls[0][0]), 'http://localhost')
    expect(request.pathname).toBe('/api/v1/inmate-violations/statistics/2026/8/export')
    expect(request.searchParams.get('language')).toBe('ar')
    expect(request.searchParams.get('submission_id')).toBe('42')
  })

  it('captures one issue time for both draft print and preview across option changes', async () => {
    const client = new QueryClient()
    const { container } = render(<QueryClientProvider client={client}><ExportWorkspace month={workflowMonth()} /></QueryClientProvider>)
    const stamps = () => Array.from(container.querySelectorAll('[data-report-issued-at]'), (cell) => cell.getAttribute('data-report-issued-at'))
    const initial = stamps()
    expect(initial).toHaveLength(2)
    expect(initial[0]).toBeTruthy()
    expect(initial[0]).toBe(initial[1])
    await userEvent.click(screen.getByRole('radio', { name: 'Full narrative' }))
    expect(stamps()).toEqual(initial)
  })

  it('marks the print-only document for the compact A4 portrait profile', () => {
    const client = new QueryClient()
    const { container } = render(<QueryClientProvider client={client}><ExportWorkspace month={workflowMonth()} submissionId={42} /></QueryClientProvider>)
    const papers = container.querySelectorAll('[data-inmate-register-document]')
    expect(papers).toHaveLength(2)
    expect(papers[0]).not.toHaveAttribute('data-report-print-profile')
    expect(papers[1]).toHaveAttribute('data-report-print-profile', 'a4-portrait-compact')
  })

  it('renders absent legacy issue and actor facts as dashes', () => {
    const client = new QueryClient()
    const legacy = workflowSubmission({
      created_at: null,
      closed_at: '2026-09-01T08:00:00Z',
      workflow: {
        ...workflowMonth().workflow,
        state: 'closed',
        legacy: true,
        legacy_metadata: { closed_at: '2026-09-01T08:00:00Z', closed_by: null, closed_by_name: null },
      },
    })
    const { container } = render(<QueryClientProvider client={client}><ExportWorkspace month={legacy} submissionId={42} /></QueryClientProvider>)
    expect(Array.from(container.querySelectorAll('[data-report-issued-at]'), (cell) => cell.getAttribute('data-report-issued-at'))).toEqual(['', ''])
    expect(Array.from(container.querySelectorAll('[data-report-signatures]'), (signatures) =>
      Array.from(signatures.querySelectorAll('[data-report-stage] dd'), (actor) => actor.textContent),
    )).toEqual([['—', '—', '—'], ['—', '—', '—']])
  })
})
