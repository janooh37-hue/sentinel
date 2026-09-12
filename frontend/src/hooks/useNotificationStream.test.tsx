import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, expect, it, vi } from 'vitest'

import { api, type NotificationCounts } from '@/lib/api'
import { useNotificationStream } from './useNotificationStream'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('invalidates monthly tasks on SSE and notifies assigned increases after the baseline', () => {
  let receive: (event: MessageEvent) => void = () => undefined
  vi.stubGlobal('EventSource', class {
    addEventListener(_type: string, listener: (event: MessageEvent) => void) {
      receive = listener
    }
    close() {}
  })
  const show = vi.fn()
  vi.stubGlobal('Notification', class {
    static permission = 'granted'
    constructor(title: string) {
      show(title)
    }
  })
  const baseline: NotificationCounts = {
    approvals: 0, leaves: 0, emails: 0, scans: 0, monthly_reviews: 1, monthly_approvals: 0,
  }
  vi.spyOn(api, 'getNotificationCounts').mockResolvedValue(baseline)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const hook = renderHook(() => useNotificationStream(), { wrapper })
  act(() => receive(new MessageEvent('counts', { data: JSON.stringify(baseline) })))
  expect(show).not.toHaveBeenCalled()
  act(() => receive(new MessageEvent('counts', {
    data: JSON.stringify({ ...baseline, monthly_approvals: 1 }),
  })))
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['inmate-register', 'tasks'] })
  expect(show).toHaveBeenCalledExactlyOnceWith('nav.bell.notify.monthlyApproval')
  hook.unmount()
  client.clear()
})
