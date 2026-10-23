import { act, cleanup, render, screen } from '@testing-library/react'
import i18n from 'i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import type * as ApiModule from '@/lib/api'
import ar from '@/locales/ar.json'
import en from '@/locales/en.json'
import { JobStatus } from './JobStatus'

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiModule>()),
  api: { getJob: vi.fn() },
}))

const rawMessage = 'This leave is already issued on record HR-0001'

beforeEach(async () => {
  i18n.addResourceBundle('ar', 'translation', ar, true, true)
  await i18n.changeLanguage('en')
  vi.mocked(api.getJob).mockResolvedValue({
    job_id: 'j1',
    status: 'failed',
    error_code: 'LEAVE_ALREADY_ISSUED',
    error_message: rawMessage,
  })
})

afterEach(async () => {
  cleanup()
  vi.useRealTimers()
  vi.clearAllMocks()
  await i18n.changeLanguage('en')
})

describe('JobStatus failed job messages', () => {
  it.each([
    ['en', en.application.leaveAlreadyIssuedNoRef],
    ['ar', ar.application.leaveAlreadyIssuedNoRef],
  ])('localizes an already-issued leave error in %s', async (language, message) => {
    await i18n.changeLanguage(language)
    render(<JobStatus jobId="j1" />)

    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(screen.queryByText(rawMessage)).not.toBeInTheDocument()
  })

  it('keeps the server message for other error codes', async () => {
    vi.mocked(api.getJob).mockResolvedValue({
      job_id: 'j1',
      status: 'failed',
      error_code: 'GENERATION_ERROR',
      error_message: 'boom',
    })
    render(<JobStatus jobId="j1" />)

    expect(await screen.findByText('boom')).toBeInTheDocument()
  })

  it('reports a failed job once without invoking the success callback', async () => {
    const onDone = vi.fn()
    const onFailed = vi.fn()
    render(<JobStatus jobId="j1" onDone={onDone} onFailed={onFailed} />)
    await screen.findByText(en.application.leaveAlreadyIssuedNoRef)
    expect(onFailed).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ status: 'failed' }))
    expect(onDone).not.toHaveBeenCalled()
  })

  it('keeps successful jobs on the success callback only', async () => {
    vi.mocked(api.getJob).mockResolvedValue({ job_id: 'j1', status: 'done', documents: [] })
    const onDone = vi.fn()
    const onFailed = vi.fn()
    render(<JobStatus jobId="j1" onDone={onDone} onFailed={onFailed} />)
    await vi.waitFor(() => expect(onDone).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ status: 'done' })))
    expect(onFailed).not.toHaveBeenCalled()
  })

  it('reports abandoned polling once after five network errors without claiming the job failed', async () => {
    vi.useFakeTimers()
    vi.mocked(api.getJob).mockRejectedValue(new Error('offline'))
    const onDone = vi.fn()
    const onFailed = vi.fn()
    const onPollingStopped = vi.fn()
    render(<JobStatus jobId="j1" onDone={onDone} onFailed={onFailed} onPollingStopped={onPollingStopped} />)

    await act(async () => vi.advanceTimersByTimeAsync(10_000))

    expect(api.getJob).toHaveBeenCalledTimes(5)
    expect(onPollingStopped).toHaveBeenCalledExactlyOnceWith()
    expect(onFailed).not.toHaveBeenCalled()
    expect(onDone).not.toHaveBeenCalled()
  })
})
