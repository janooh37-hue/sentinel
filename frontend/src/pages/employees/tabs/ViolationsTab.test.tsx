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
})
