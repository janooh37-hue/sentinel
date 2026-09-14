import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as RouteLoaders from '@/lib/routeLoaders'

import { prefetchRouteForPath } from './prefetchRoute'

const routeMocks = vi.hoisted(() => ({
  importPage: vi.fn(() => Promise.resolve()),
  vehicleDetail: vi.fn(() => Promise.resolve()),
}))

vi.mock('@/lib/routeLoaders', async (importOriginal) => {
  const actual = await importOriginal<typeof RouteLoaders>()
  return {
    ...actual,
    loadVehicleImportPage: routeMocks.importPage,
    loadVehicleDetailPage: routeMocks.vehicleDetail,
  }
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('prefetchRouteForPath', () => {
  it('prefetches the import chunk before the generic vehicle detail route can match it', () => {
    prefetchRouteForPath('/vehicles/import')

    expect(routeMocks.importPage).toHaveBeenCalledOnce()
    expect(routeMocks.vehicleDetail).not.toHaveBeenCalled()
  })
})
