import { describe, it, expect, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { refreshAll, editingRegistry } from '../globalRefresh'

describe('refreshAll', () => {
  it('invalidates active queries and honors the min-spin floor', async () => {
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue()
    const t0 = performance.now()
    await refreshAll(qc, { minSpinMs: 120, ceilingMs: 8000 })
    const elapsed = performance.now() - t0
    expect(spy).toHaveBeenCalledWith({ refetchType: 'active' })
    expect(elapsed).toBeGreaterThanOrEqual(115)
  })
  it('resolves by the ceiling even if invalidate hangs', async () => {
    const qc = new QueryClient()
    vi.spyOn(qc, 'invalidateQueries').mockReturnValue(new Promise(() => {}))
    const t0 = performance.now()
    await refreshAll(qc, { minSpinMs: 0, ceilingMs: 150 })
    expect(performance.now() - t0).toBeLessThan(400)
  })
})

describe('editingRegistry', () => {
  it('reports editing when any registered form is dirty', () => {
    editingRegistry.setEditing('a', true)
    expect(editingRegistry.isAnyEditing()).toBe(true)
    editingRegistry.setEditing('a', false)
    expect(editingRegistry.isAnyEditing()).toBe(false)
  })
})
