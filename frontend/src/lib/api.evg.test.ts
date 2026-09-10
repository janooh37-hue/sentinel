import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => vi.unstubAllGlobals())

import { ApiError, api } from '@/lib/api'

async function rejectedApiError(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise
    throw new Error('Expected the API request to reject')
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError)
    return error as ApiError
  }
}

function expectNoRawHtml(error: ApiError): void {
  const details = JSON.stringify(error.details)
  for (const fragment of ['<!DOCTYPE', '<html', 'Gateway timeout']) {
    expect(error.message).not.toContain(fragment)
    expect(details).not.toContain(fragment)
  }
}

describe('EVG API client', () => {
  it('turns an HTML gateway timeout into a safe HTTP error', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('<!DOCTYPE html><html><title>Gateway timeout</title></html>', {
        status: 524,
        headers: { 'content-type': 'text/html' },
      }),
    )

    const error = await rejectedApiError(
      api.evgPreview({ traffic_codes: ['0000000000'] }),
    )

    expect(error).toMatchObject({ status: 524, code: 'HTTP_524' })
    expectNoRawHtml(error)
  })

  it('rejects an HTML success response as invalid without disclosing its body', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('<!DOCTYPE html><html><title>Gateway timeout</title></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    )

    const error = await rejectedApiError(
      api.evgPreview({ traffic_codes: ['0000000000'] }),
    )

    expect(error).toMatchObject({ status: 200, code: 'INVALID_RESPONSE' })
    expectNoRawHtml(error)
  })

  it('preserves a JSON error envelope', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: {
            code: 'EVG_UNAVAILABLE',
            message: 'EVG could not be reached.',
            details: { text: 'boom' },
          },
        }),
        {
          status: 502,
          headers: { 'content-type': 'application/json' },
        },
      ),
    )

    const error = await rejectedApiError(
      api.evgPreview({ traffic_codes: ['0000000000'] }),
    )

    expect(error).toMatchObject({
      status: 502,
      code: 'EVG_UNAVAILABLE',
      message: 'EVG could not be reached.',
      details: { text: 'boom' },
    })
  })

  it('accepts valid JSON without a content-type header', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ job_id: 'job-1' }), { status: 202 }),
    )

    const created = (await api.evgPreview({ traffic_codes: [] })) as unknown as {
      job_id: string
    }

    expect(created.job_id).toBe('job-1')
  })
})
