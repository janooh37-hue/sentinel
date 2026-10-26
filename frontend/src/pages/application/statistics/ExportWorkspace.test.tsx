import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/lib/i18n'
import { api } from '@/lib/api'
import { toast } from '@/lib/toast'
import { ExportWorkspace } from './ExportWorkspace'
import { workflowMonth } from './workflowFixtures'

vi.mock('@/lib/toast', () => ({ toast: { loading: vi.fn(() => 'pending-export'), dismiss: vi.fn(), success: vi.fn(), error: vi.fn() } }))

beforeEach(() => vi.clearAllMocks())
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

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
    expect(toast.loading).toHaveBeenCalledWith(i18n.t('inmateStats.export.downloading'))
    expect(toast.success).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it.each(['success', 'request error', 'save error'] as const)('resolves the download loading toast on %s', async (outcome) => {
    vi.stubGlobal('URL', class extends URL {
      static createObjectURL = vi.fn(() => 'blob:register')
      static revokeObjectURL = vi.fn()
    })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const request = vi.spyOn(api, 'fetchInmateRegisterExport')
    if (outcome === 'request error') request.mockRejectedValue(new Error('Download failed'))
    else request.mockResolvedValue({ blob: new Blob(['register']), filename: 'register.xlsx' })
    if (outcome === 'save error') {
      vi.spyOn(URL, 'createObjectURL').mockImplementation(() => { throw new Error('Download failed') })
    }
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
        <ExportWorkspace month={workflowMonth()} />
      </QueryClientProvider>,
    )

    await userEvent.click(screen.getByRole('button', { name: 'XLSX file' }))

    if (outcome === 'success') {
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith(i18n.t('inmateStats.export.downloaded'), { id: 'pending-export' }))
      await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:register'))
      expect(toast.error).not.toHaveBeenCalled()
    } else {
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Something went wrong', { id: 'pending-export' }))
      expect(toast.success).not.toHaveBeenCalled()
    }
    expect(toast.loading).toHaveBeenCalledWith(i18n.t('inmateStats.export.downloading'))
  })

  describe('save as pdf', () => {
    // The dialog takes its suggested filename from `document.title` and
    // nowhere else, so the swap has to happen on `beforeprint` and be undone
    // after — matching the register the operator was actually looking at.
    it('suggests the selected month\'s Arabic register name while the dialog is open', () => {
      const original = document.title
      const title = i18n.t('inmateStats.document.titleAr', { lng: 'ar' })
      const client = new QueryClient()
      const { rerender, unmount } = render(
        <QueryClientProvider client={client}>
          <ExportWorkspace month={workflowMonth()} />
        </QueryClientProvider>,
      )

      expect(document.title).toBe(original)

      act(() => window.dispatchEvent(new Event('beforeprint')))
      expect(document.title).toBe(`${title}_2026-08`)

      // A different month rendered while the dialog is still open must not
      // change the title already handed to the in-flight dialog.
      rerender(
        <QueryClientProvider client={client}>
          <ExportWorkspace month={workflowMonth({ month: 9 })} />
        </QueryClientProvider>,
      )
      expect(document.title).toBe(`${title}_2026-08`)

      act(() => window.dispatchEvent(new Event('afterprint')))
      expect(document.title).toBe(original)

      act(() => window.dispatchEvent(new Event('beforeprint')))
      expect(document.title).toBe(`${title}_2026-09`)

      unmount()
      expect(document.title).toBe(original)
    })
  })
})
