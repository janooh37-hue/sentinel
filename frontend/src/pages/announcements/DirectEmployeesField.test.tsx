import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { DirectEmployeesField } from './DirectEmployeesField'

vi.mock('@/lib/api', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...mod,
    api: {
      ...mod.api,
      listEmployees: vi.fn().mockResolvedValue({
        items: [
          { id: 'G-1023', name_en: 'Ahmed', name_ar: 'أحمد', contact: '0501234567' },
          { id: 'G-0231', name_en: 'Ali', name_ar: 'علي', contact: null },
        ],
      }),
    },
  }
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, opts?: Record<string, unknown>) => {
    if (opts) return `${k}:${JSON.stringify(opts)}`
    return k
  }, i18n: { language: 'en' } }),
}))

function renderIt(onAdd = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <DirectEmployeesField selected={[]} onAdd={onAdd} onRemove={vi.fn()} />
    </QueryClientProvider>,
  )
  return onAdd
}

describe('DirectEmployeesField', () => {
  it('adds an employee with a mobile; disables one without', async () => {
    const onAdd = renderIt()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '10' } })
    await waitFor(() => expect(api.listEmployees).toHaveBeenCalled())
    const ahmed = await screen.findByRole('button', { name: /Ahmed/ })
    const ali = screen.getByRole('button', { name: /Ali/ })
    expect(ali).toBeDisabled()
    fireEvent.click(ahmed)
    expect(onAdd).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'G-1023', contact: '0501234567' }),
    )
  })
})
