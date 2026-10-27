import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, it, vi } from 'vitest'
import { api, type OrgNodeRead } from '@/lib/api'
import type * as ApiModule from '@/lib/api'
import { bidi } from '@/lib/bidi'
import { toast } from '@/lib/toast'
import { OrgTreeView } from './OrgTreeView'

vi.mock('@/lib/api', async (original) => {
  const real = await original<typeof ApiModule>()
  return { ...real, api: { ...real.api, listOrgTree: vi.fn(), setOrgSupervisor: vi.fn() } }
})
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/useCapabilities', () => ({ useCapabilities: () => ({ has: () => true }) }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({
  t: (key: string, values?: { name?: string }) => values?.name ? `${key}: ${values.name}` : key,
  i18n: { language: 'en' },
}) }))
vi.mock('./SupervisorPicker', () => ({ SupervisorPicker: ({ onPick }: { onPick: (id: string | null) => void }) => (
  <button type="button" onClick={() => onPick(null)}>Remove supervisor</button>
) }))

const person = (id: string, supervisor_id: string | null): OrgNodeRead => ({
  id, supervisor_id, name_en: id, name_ar: null, position: 'Guard', position_ar: null,
  department: null, duty_unit: 'Unit A', duty_post: null, status: 'Active',
  designation_en: null, designation_ar: null, rank_order: null,
})

it('isolates the changed name and never offers Undo of an Undo', async () => {
  vi.mocked(api.listOrgTree).mockResolvedValue([person('Manager', null), person('Employee', 'Manager')])
  vi.mocked(api.setOrgSupervisor).mockImplementation(async (id, body) => person(id, body.supervisor_id ?? null))
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={qc}><OrgTreeView unit="Unit A" editable /></QueryClientProvider>)
  fireEvent.click(await screen.findByRole('button', { name: 'employees.orgTree.editLinks' }))
  fireEvent.click(screen.getAllByRole('button', { name: 'employees.orgTree.pickTitle' })[1])
  fireEvent.click(screen.getByRole('button', { name: 'Remove supervisor' }))
  await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1))
  const options = vi.mocked(toast.success).mock.calls[0][1]
  expect(options?.description).toContain(bidi('Employee'))
  expect(options?.duration).toBe(8000)
  await act(async () => options?.action?.onClick())
  await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(2))
  expect(api.setOrgSupervisor).toHaveBeenLastCalledWith('Employee', { supervisor_id: 'Manager' })
  expect(vi.mocked(toast.success).mock.calls[1][1]?.action).toBeUndefined()
})
