import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { BasketPrefill } from './outlookBridge'
import { prepareBasketInOutlook, launchOutlook } from './outlookBridge'
import { api } from './api'
import { clearBasket } from './emailBasket'

vi.mock('./api', async (original) => {
  const actual = await original<typeof import('./api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      createOutlookHandoff: vi.fn(),
      getOutlookHandoff: vi.fn(),
    },
  }
})

vi.mock('./emailBasket', async (original) => {
  const actual = await original<typeof import('./emailBasket')>()
  return { ...actual, clearBasket: vi.fn() }
})

const prefill: BasketPrefill = {
  to: ['records@example.test'],
  subject: 'Leave documents',
  bodyHtml: '<p>Documents</p>',
  references: [
    { kind: 'book', id: 22, label: 'GB-22', token: 'GB-22', docId: 71, fileName: 'GB-22.pdf' },
  ],
  attachRefPdf: true,
  basketKey: 'leave:Annual',
}

describe('outlookBridge', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(api.createOutlookHandoff).mockReset()
    vi.mocked(api.getOutlookHandoff).mockReset()
    vi.mocked(clearBasket).mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('removes the temporary protocol anchor immediately after launch', () => {
    launchOutlook('gssg-outlook://compose/token')
    expect(document.querySelector('a[href="gssg-outlook://compose/token"]')).toBeNull()
  })

  it('clears only after the bridge confirms draft creation', async () => {
    vi.mocked(api.createOutlookHandoff).mockResolvedValue({
      id: 7,
      kind: 'compose',
      status: 'pending',
      expires_at: '2026-08-23T12:05:00Z',
      token: 'token',
      protocol_url: 'gssg-outlook://compose/token',
    })
    vi.mocked(api.getOutlookHandoff)
      .mockResolvedValueOnce({ status: 'redeemed', id: 7, kind: 'compose' })
      .mockResolvedValueOnce({ status: 'completed', id: 7, kind: 'compose' })

    const promise = prepareBasketInOutlook(prefill, { launch: () => {}, pollIntervalMs: 1 })
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(1)
    await promise

    expect(clearBasket).toHaveBeenCalledWith(prefill.basketKey)
    expect(api.createOutlookHandoff).toHaveBeenCalledWith({
      kind: 'compose',
      payload: {
        to: prefill.to,
        cc: [],
        subject: prefill.subject,
        body_html: prefill.bodyHtml,
        basket_key: prefill.basketKey,
        attachments: [{ kind: 'document_pdf', document_id: 71, filename: 'GB-22.pdf' }],
      },
    })
  })

  it('keeps the basket when handoff fails', async () => {
    vi.mocked(api.createOutlookHandoff).mockResolvedValue({
      id: 8,
      kind: 'compose',
      status: 'pending',
      expires_at: '2026-08-23T12:05:00Z',
      token: 'token',
      protocol_url: 'gssg-outlook://compose/token',
    })
    vi.mocked(api.getOutlookHandoff).mockResolvedValue({
      status: 'failed',
      id: 8,
      kind: 'compose',
      failure_code: 'ATTACHMENT_DOWNLOAD_FAILED',
    })

    await expect(
      prepareBasketInOutlook(prefill, { launch: () => {}, pollIntervalMs: 1 }),
    ).rejects.toThrow('ATTACHMENT_DOWNLOAD_FAILED')
    expect(clearBasket).not.toHaveBeenCalled()
  })
})

