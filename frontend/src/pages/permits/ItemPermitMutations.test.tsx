import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import type * as ApiModule from '@/lib/api'
import { api, type ItemPermitRead } from '@/lib/api'
import { ItemPermitFormDialog } from './ItemPermitFormDialog'
import { ItemPermitDetailDialog } from './ItemPermitDetailDialog'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/useCapabilities', () => ({ useCapabilities: () => ({ has: () => true }) }))
vi.mock('@/pages/application/EmployeePicker', () => ({
  EmployeePicker: ({ onSelect }: { onSelect: (id: string) => void }) => (
    <button type="button" onClick={() => onSelect('G1')}>Pick employee</button>
  ),
}))
vi.mock('./PermitDocumentVersions', () => ({ PermitDocumentVersions: () => null }))
vi.mock('./PermitSendButton', () => ({ PermitSendButton: () => null }))
vi.mock('@/lib/api', async (importOriginal) => {
  const mod = await importOriginal<typeof ApiModule>()
  return { ...mod, api: { ...mod.api,
    listManagers: vi.fn().mockResolvedValue([]),
    getItemPermit: vi.fn(), createItemPermit: vi.fn(), updateItemPermit: vi.fn(),
    submitItemPermitApproval: vi.fn(), deleteItemPermit: vi.fn(),
  } }
})

const permit: ItemPermitRead = {
  id: 1, employee_id: 'G1', employee_name: 'Aisha', employee_name_en: 'Aisha',
  employee_title: null, recipient: 'Security', zones: ['red'], site: 'Site',
  items: [{ name: 'Laptop', quantity: 1 }], manager_id: null,
  book_id: 10, book_ref: 'REF-1', approval_state: 'none',
  created_at: '2026-10-01T00:00:00', updated_at: null,
}
const zones = [undefined, 'red', 'green', 'work_residence']
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(api.getItemPermit).mockResolvedValue(permit)
  vi.mocked(api.createItemPermit).mockResolvedValue(permit)
  vi.mocked(api.updateItemPermit).mockResolvedValue(permit)
  vi.mocked(api.submitItemPermitApproval).mockResolvedValue(permit)
  vi.mocked(api.deleteItemPermit).mockResolvedValue(undefined)
})

it.each(['create', 'edit', 'submit', 'delete'] as const)('%s invalidates every cached item-permit summary zone', async (action) => {
  const user = userEvent.setup()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000 } } })
  for (const zone of zones) client.setQueryData(['item-permits-summary', zone], { none: 1 })
  client.setQueryData(['unrelated-summary'], { count: 1 })
  render(<QueryClientProvider client={client}>
    {action === 'create' || action === 'edit'
      ? <ItemPermitFormDialog open permit={action === 'edit' ? permit : undefined} onOpenChange={vi.fn()} />
      : <ItemPermitDetailDialog open permitId={permit.id} onOpenChange={vi.fn()} onEdit={vi.fn()} onNotFound={vi.fn()} />}
  </QueryClientProvider>)
  if (action === 'create') {
    await user.click(screen.getByRole('button', { name: 'Pick employee' }))
    await user.type(screen.getByLabelText('Item 1'), 'Laptop')
    await user.click(screen.getByRole('button', { name: 'Create permit' }))
  } else if (action === 'edit') {
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
  } else if (action === 'submit') {
    await user.click(await screen.findByRole('button', { name: 'Send for approval' }))
  } else {
    await user.click(await screen.findByRole('button', { name: 'Delete' }))
    const confirm = screen.getByRole('dialog', { name: 'Delete item permit' })
    await user.click(within(confirm).getByRole('button', { name: 'Delete' }))
  }
  await waitFor(() => {
    for (const zone of zones) expect(client.getQueryState(['item-permits-summary', zone])?.isInvalidated).toBe(true)
  })
  expect(client.getQueryState(['unrelated-summary'])?.isInvalidated).toBe(false)
})
