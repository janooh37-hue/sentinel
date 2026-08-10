import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const capabilityState = vi.hoisted(() => ({ canManage: false }))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({
    capabilities: new Set(capabilityState.canManage ? ['violations.manage'] : []),
    isLoading: false,
    has: (capability: string) => capability === 'violations.manage' && capabilityState.canManage,
  }),
}))
vi.mock('@/lib/api', () => ({
  api: {
    listViolations: vi.fn(),
    createViolation: vi.fn(),
    updateViolation: vi.fn(),
    deleteViolation: vi.fn(),
    getNotifyStatus: vi.fn().mockResolvedValue({ enabled: false, last: null }),
    sendNotify: vi.fn(),
  },
  getNotifyStatus: vi.fn().mockResolvedValue({ enabled: false, last: null }),
  sendNotify: vi.fn(),
  apiErrorMessage: (error: unknown) => String(error),
}))

import { api } from '@/lib/api'
import type { RecentViolationRead, ViolationRead } from '@/lib/api'
import { ViolationsTab } from './ViolationsTab'

const snapshotRows: RecentViolationRead[] = [
  { id: 41, date: '2026-07-01', violation_type: 'Late arrival', status: 'Open', description: null },
]
const fullRows: ViolationRead[] = [
  {
    id: 41,
    employee_id: 'G100',
    violation_type: 'Late arrival',
    date: '2026-07-01',
    description: null,
    action_taken: null,
    deduction_days: 1,
    status: 'Open',
    doc_path: null,
    created_at: '2026-07-01T00:00:00Z',
  },
  {
    id: 42,
    employee_id: 'G100',
    violation_type: 'Absent',
    date: '2026-07-02',
    description: 'Unexcused absence',
    action_taken: null,
    deduction_days: 2,
    status: 'Closed',
    doc_path: null,
    created_at: '2026-07-02T00:00:00Z',
  },
]

const originalRequestAnimationFrame = globalThis.requestAnimationFrame
const originalCancelAnimationFrame = globalThis.cancelAnimationFrame
const originalScrollIntoView = Element.prototype.scrollIntoView

function wrap(ui: ReactNode) {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {ui}
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  capabilityState.canManage = false
  vi.mocked(api.listViolations).mockResolvedValue(fullRows)
  globalThis.requestAnimationFrame = (callback: FrameRequestCallback) => {
    callback(0)
    return 0
  }
  globalThis.cancelAnimationFrame = () => {}
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  vi.restoreAllMocks()
  globalThis.requestAnimationFrame = originalRequestAnimationFrame
  globalThis.cancelAnimationFrame = originalCancelAnimationFrame
  Element.prototype.scrollIntoView = originalScrollIntoView
})

describe('ViolationsTab deep-link targeting', () => {
  it.each([false, true])('scrolls to and consumes exact violation in manage=%s mode', async (canManage) => {
    capabilityState.canManage = canManage
    const onConsumed = vi.fn()
    wrap(
      <ViolationsTab
        employeeId="G100"
        violations={snapshotRows}
        openId={42}
        onOpenConsumed={onConsumed}
      />,
    )
    const row = await screen.findByTestId('violation-row-42')
    await waitFor(() => expect(row.scrollIntoView).toHaveBeenCalled())
    expect(row).toHaveAttribute('data-highlighted', 'true')
    expect(onConsumed).toHaveBeenCalledOnce()
  })

  it('fetches the full list when a read-only target is absent from the detail snapshot', async () => {
    capabilityState.canManage = false
    const onConsumed = vi.fn()
    wrap(
      <ViolationsTab
        employeeId="G100"
        violations={snapshotRows}
        openId={42}
        onOpenConsumed={onConsumed}
      />,
    )
    expect(await screen.findByTestId('violation-row-42')).toHaveAttribute('data-highlighted', 'true')
    expect(api.listViolations).toHaveBeenCalledWith('G100')
    expect(onConsumed).toHaveBeenCalledOnce()
  })

  it('consumes a missing id only after rows are ready without targeting another row', async () => {
    const onConsumed = vi.fn()
    wrap(
      <ViolationsTab
        employeeId="G100"
        violations={snapshotRows}
        openId={999}
        onOpenConsumed={onConsumed}
      />,
    )
    await screen.findByTestId('violation-row-42')
    await waitFor(() => expect(onConsumed).toHaveBeenCalledOnce())
    expect(screen.getByTestId('violation-row-41')).toHaveAttribute('data-highlighted', 'false')
    expect(screen.getByTestId('violation-row-42')).toHaveAttribute('data-highlighted', 'false')
  })
  it('refreshes cached full rows before consuming an absent target', async () => {
    const onConsumed = vi.fn()
    vi.mocked(api.listViolations)
      .mockClear()
      .mockResolvedValueOnce([fullRows[0]])
      .mockResolvedValueOnce(fullRows)
    wrap(
      <ViolationsTab
        employeeId="G100"
        violations={snapshotRows}
        openId={42}
        onOpenConsumed={onConsumed}
      />,
    )
    const row = await screen.findByTestId('violation-row-42')
    await waitFor(() => expect(api.listViolations).toHaveBeenCalledTimes(2))
    expect(row).toHaveAttribute('data-highlighted', 'true')
    expect(onConsumed).toHaveBeenCalledOnce()
  })
  it('retains the target and shows refresh failure with cached rows', async () => {
    const onConsumed = vi.fn()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(['violations', 'G100'], [fullRows[0]])
    vi.mocked(api.listViolations).mockRejectedValue(new Error('refresh failed'))
    render(
      <QueryClientProvider client={client}>
        <ViolationsTab
          employeeId="G100"
          violations={snapshotRows}
          openId={42}
          onOpenConsumed={onConsumed}
        />
      </QueryClientProvider>,
    )
    expect(await screen.findByTestId('violation-row-41')).toBeInTheDocument()
    expect(await screen.findByRole('alert')).toHaveTextContent('refresh failed')
    expect(onConsumed).not.toHaveBeenCalled()
    expect(screen.getByText('Retry')).toBeInTheDocument()
  })

  it('keeps cached manage rows and controls after a background refresh error', async () => {
    capabilityState.canManage = true
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(['violations', 'G100'], fullRows)
    vi.mocked(api.listViolations).mockClear().mockRejectedValue(new Error('background failed'))
    render(
      <QueryClientProvider client={client}>
        <ViolationsTab employeeId="G100" violations={snapshotRows} />
      </QueryClientProvider>,
    )
    await waitFor(() => expect(api.listViolations).toHaveBeenCalledOnce())
    await waitFor(() => expect(client.getQueryState(['violations', 'G100'])?.status).toBe('error'))
    expect(screen.getByTestId('violation-row-42')).toBeInTheDocument()
    expect(screen.getAllByText('common.edit')).toHaveLength(2)
  })

  it('does not suppress a target when an effect cleanup cancels its frame', async () => {
    const callbacks = new Map<number, FrameRequestCallback>()
    let nextFrame = 0
    globalThis.requestAnimationFrame = (callback: FrameRequestCallback) => {
      const frame = ++nextFrame
      callbacks.set(frame, callback)
      return frame
    }
    globalThis.cancelAnimationFrame = (frame: number) => {
      callbacks.delete(frame)
    }
    const onFirstConsumed = vi.fn()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const view = render(
      <QueryClientProvider client={client}>
        <ViolationsTab
          employeeId="G100"
          violations={snapshotRows}
          openId={42}
          onOpenConsumed={onFirstConsumed}
        />
      </QueryClientProvider>,
    )
    await screen.findByTestId('violation-row-42')
    await waitFor(() => expect(callbacks.size).toBe(1))

    const onRetriedConsumed = vi.fn()
    view.rerender(
      <QueryClientProvider client={client}>
        <ViolationsTab
          employeeId="G100"
          violations={snapshotRows}
          openId={42}
          onOpenConsumed={onRetriedConsumed}
        />
      </QueryClientProvider>,
    )
    await waitFor(() => expect(callbacks.size).toBe(1))
    const callback = [...callbacks.values()][0]
    callback?.(0)
    expect(onFirstConsumed).not.toHaveBeenCalled()
    expect(onRetriedConsumed).toHaveBeenCalledOnce()
  })

  it('clears an old highlight when a subsequent target is absent', async () => {
    const onConsumed = vi.fn()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const view = render(
      <QueryClientProvider client={client}>
        <ViolationsTab
          employeeId="G100"
          violations={snapshotRows}
          openId={42}
          onOpenConsumed={onConsumed}
        />
      </QueryClientProvider>,
    )
    const row = await screen.findByTestId('violation-row-42')
    await waitFor(() => expect(row).toHaveAttribute('data-highlighted', 'true'))

    view.rerender(
      <QueryClientProvider client={client}>
        <ViolationsTab
          employeeId="G100"
          violations={snapshotRows}
          openId={999}
          onOpenConsumed={onConsumed}
        />
      </QueryClientProvider>,
    )
    await waitFor(() => expect(onConsumed).toHaveBeenCalledTimes(2))
    expect(row).toHaveAttribute('data-highlighted', 'false')
  })
})
