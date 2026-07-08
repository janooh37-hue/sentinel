import { describe, it, expect, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'

import { useManagePaper } from './useManagePaper'
import type { Paper } from './recordPapers'
import * as apiMod from '@/lib/api'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

function wrapperFor(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children)
}

const scanPaper: Paper = {
  kind: 'scan',
  url: '/api/v1/books/5/attachments/2',
  downloadUrl: '/api/v1/books/5/attachments/2',
  filename: 'scan.pdf',
  isPdf: true,
  attachmentIndex: 2,
}

const signedPaper: Paper = {
  kind: 'signed',
  url: '/api/v1/documents/9/download?format=pdf',
  downloadUrl: '/api/v1/documents/9/download?format=pdf',
  filename: 'HR-1-signed.pdf',
  isPdf: true,
}

const file = new File([new Uint8Array([1])], 'new.pdf', { type: 'application/pdf' })

describe('useManagePaper', () => {
  it('deletePaper routes a scan paper to deleteBookAttachment(index)', async () => {
    const qc = new QueryClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const spy = vi.spyOn(apiMod.api, 'deleteBookAttachment').mockResolvedValue({} as any)
    const { result } = renderHook(() => useManagePaper(5), { wrapper: wrapperFor(qc) })
    await result.current.deletePaper(scanPaper)
    await waitFor(() => expect(spy).toHaveBeenCalledWith(5, 2))
  })

  it('deletePaper routes a signed paper to unfileSignedCopy', async () => {
    const qc = new QueryClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const spy = vi.spyOn(apiMod.api, 'unfileSignedCopy').mockResolvedValue({} as any)
    const { result } = renderHook(() => useManagePaper(5), { wrapper: wrapperFor(qc) })
    await result.current.deletePaper(signedPaper)
    await waitFor(() => expect(spy).toHaveBeenCalledWith(5))
  })

  it('replacePaper routes a scan paper to replaceBookAttachment(index, file)', async () => {
    const qc = new QueryClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const spy = vi.spyOn(apiMod.api, 'replaceBookAttachment').mockResolvedValue({} as any)
    const { result } = renderHook(() => useManagePaper(5), { wrapper: wrapperFor(qc) })
    await result.current.replacePaper(scanPaper, file)
    await waitFor(() => expect(spy).toHaveBeenCalledWith(5, 2, file))
  })

  it('replacePaper routes a signed paper to replaceSignedCopy(file)', async () => {
    const qc = new QueryClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const spy = vi.spyOn(apiMod.api, 'replaceSignedCopy').mockResolvedValue({} as any)
    const { result } = renderHook(() => useManagePaper(5), { wrapper: wrapperFor(qc) })
    await result.current.replacePaper(signedPaper, file)
    await waitFor(() => expect(spy).toHaveBeenCalledWith(5, file))
  })
})
