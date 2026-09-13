import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/lib/i18n'
import { ExportWorkspace } from './ExportWorkspace'
import { workflowMonth } from './workflowFixtures'

afterEach(() => vi.restoreAllMocks())

describe('ExportWorkspace', () => {
  it('offers a fixed Arabic portrait report and exports the month in Arabic', async () => {
    void i18n.changeLanguage('en')
    const download = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => new Promise<Response>(() => {}))
    const client = new QueryClient()
    const { container } = render(
      <QueryClientProvider client={client}>
        <ExportWorkspace month={workflowMonth()} />
      </QueryClientProvider>,
    )

    expect(screen.queryByRole('radio', { name: 'English' })).toBeNull()
    expect(screen.queryByRole('radio', { name: 'Landscape' })).toBeNull()
    expect(
      Array.from(container.querySelectorAll('[data-inmate-register-document]'), (paper) => [
        paper.getAttribute('lang'),
        paper.getAttribute('dir'),
      ]),
    ).toEqual([['ar', 'rtl'], ['ar', 'rtl']])

    await userEvent.click(screen.getByRole('button', { name: 'XLSX file' }))
    await waitFor(() => expect(download).toHaveBeenCalled())
    const request = new URL(String(download.mock.calls[0][0]), 'http://localhost')
    expect(request.pathname).toBe('/api/v1/inmate-violations/statistics/2026/8/export')
    expect(request.searchParams.get('language')).toBe('ar')
  })
})
