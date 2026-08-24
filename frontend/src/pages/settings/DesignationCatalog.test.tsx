/**
 * DesignationCatalog — the printed rank order of the two monthly workbooks.
 *
 * Wrapper is `QueryClientProvider` alone: the panel does not navigate, and it
 * is registered behind `has('timesheet.edit')` in `SettingsPage` rather than
 * behind a `CapabilityGate`, so it renders no capability branch of its own.
 * That boundary is pinned in `SettingsPage.test.tsx`, where the granted set is
 * the knob.
 *
 * The real i18n is left in place (`src/test/setup.ts` initialises `en`
 * synchronously) because every move control's accessible name interpolates the
 * row it moves; a `t: (k) => k` stub would assert the key and prove nothing.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/api', () => ({
  api: {
    listDesignations: vi.fn(),
    reorderDesignations: vi.fn(),
  },
  apiErrorMessage: (e: unknown) => String(e),
  ApiError: class ApiError extends Error {
    readonly code: string
    constructor(_status: number, code: string, message: string) {
      super(message)
      this.code = code
    }
  },
}))

import { toast } from 'sonner'
import { api, ApiError, type TimesheetDesignationRead } from '@/lib/api'
import { DesignationCatalog } from './DesignationCatalog'

/**
 * The 16 rows migration 0070 seeds, ids deliberately offset from their ranks so
 * a reorder that posts ranks instead of ids cannot pass.
 */
const SEED: [string, string, string][] = [
  ['Prisons Director', 'مدير عام الحراسات الأمنية', 'main'],
  ['Ass. Director', 'نائب عام مدير الحراسات الأمنية', 'main'],
  ['Project Manager', 'مديرمركز الإصلاح والتأهيل', 'main'],
  ['Branche Manager', 'مدير فرع', 'main'],
  ['Duty In charge', 'مناوب عام', 'main'],
  ['Security Supervisor', 'مشرف', 'main'],
  ['Armory Officer', 'مسؤول قطعة سلاح', 'main'],
  ['assistant security supervisor', 'مساعد مشرف', 'main'],
  ['Armory Keeper', 'خازن سلاح', 'main'],
  ['Control room Security Guard', 'حارس امن عرفة العمليات', 'main'],
  ['Clinic Security Guard', 'حارس امن حرس العيادة', 'main'],
  ['Habilitation Security Guard', 'حارس امن حرس التأهيل', 'main'],
  ['Escort Security Guard', 'حارس امن تنويم مستشفيات', 'main'],
  ['Messengers', 'حارس امن الارساليات', 'main'],
  ['Security Guard', 'حارس امن', 'main'],
  ['Driver', 'سائق', 'drivers'],
]

const CATALOG: TimesheetDesignationRead[] = SEED.map(([name_en, name_ar, sheet], i) => ({
  id: 101 + i,
  name_en,
  name_ar,
  rank_order: i + 1,
  sheet,
  active: true,
  system_key: null,
}))
const IDS = CATALOG.map((d) => d.id)

function wrap() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={qc}>
      <DesignationCatalog />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(api.listDesignations).mockReset()
  vi.mocked(api.reorderDesignations).mockReset()
  vi.mocked(toast.success).mockReset()
  vi.mocked(toast.error).mockReset()
  vi.mocked(api.listDesignations).mockResolvedValue(CATALOG)
  vi.mocked(api.reorderDesignations).mockResolvedValue(CATALOG)
})

describe('DesignationCatalog', () => {
  it('lists all sixteen designations in rank order, both names, and the sheet each prints on', async () => {
    wrap()

    const rows = await screen.findAllByRole('listitem')
    expect(rows).toHaveLength(16)
    // Rank order, not response order by accident: first and last are the two
    // ends of the catalog the client accepted.
    expect(rows[0]).toHaveTextContent('Prisons Director')
    expect(rows[0]).toHaveTextContent('مدير عام الحراسات الأمنية')
    expect(rows[15]).toHaveTextContent('Driver')
    expect(rows[15]).toHaveTextContent('سائق')
    // The badge names the workbook the designation lists on.
    expect(rows[15]).toHaveTextContent('Drivers')
    expect(rows[0]).toHaveTextContent('All staff')
  })

  it('sends every id exactly once when an order is saved', async () => {
    wrap()

    fireEvent.click(await screen.findByRole('button', { name: 'Move Prisons Director down' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save order' }))

    await waitFor(() => expect(api.reorderDesignations).toHaveBeenCalledTimes(1))
    const sent = vi.mocked(api.reorderDesignations).mock.calls[0]![0]
    // A full permutation — the endpoint refuses anything else with
    // DESIGNATION_ORDER_INCOMPLETE.
    expect(sent).toHaveLength(16)
    expect([...sent].sort((a, b) => a - b)).toEqual([...IDS].sort((a, b) => a - b))
    expect(sent).toEqual([102, 101, ...IDS.slice(2)])
    expect(toast.success).toHaveBeenCalled()
  })

  it('offers nothing to save until a row actually moves, and nothing to save after a revert', async () => {
    wrap()

    await screen.findAllByRole('listitem')
    expect(screen.queryByRole('button', { name: 'Save order' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Move Prisons Director down' }))
    expect(screen.getByRole('button', { name: 'Save order' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Revert' }))
    expect(screen.queryByRole('button', { name: 'Save order' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('Prisons Director')
    expect(api.reorderDesignations).not.toHaveBeenCalled()
  })

  it('keeps the first row from moving up and the last from moving down', async () => {
    wrap()

    await screen.findAllByRole('listitem')
    expect(screen.getByRole('button', { name: 'Move Prisons Director up' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move Driver down' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move Prisons Director down' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Move Driver up' })).toBeEnabled()
  })

  it('reloads the catalog and says so when the server refuses the order as incomplete', async () => {
    // The one way a full permutation can still be refused: the catalog changed
    // under the operator — a row was seeded or removed while the draft was
    // being built — so the ids in hand are no longer every id.
    vi.mocked(api.reorderDesignations).mockRejectedValue(
      new ApiError(422, 'DESIGNATION_ORDER_INCOMPLETE', 'The order must list every designation exactly once.'),
    )
    wrap()

    fireEvent.click(await screen.findByRole('button', { name: 'Move Prisons Director down' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save order' }))

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('catalog changed')),
    )
    // Reloaded, not left showing a draft the server has rejected.
    await waitFor(() => expect(api.listDesignations).toHaveBeenCalledTimes(2))
  })
})
