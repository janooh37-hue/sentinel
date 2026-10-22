/**
 * Duty Resumption selects a manager for the signing chain without embedding
 * their signature at filing time.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useFormContext } from 'react-hook-form'
import { toast } from '@/lib/toast'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError, api } from '@/lib/api'
import { ReturnFormDialog } from './ReturnFormDialog'

vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/components/application/fields/ManagerPickerField', () => ({
  ManagerPickerField: ({ name, label_en }: { name: string; label_en: string }) => {
    const { register } = useFormContext()
    return (
      <label>
        {label_en}
        <select
          {...register(name, {
            setValueAs: (value: string) => (value ? Number(value) : null),
          })}
        >
          <option value="">Select manager</option>
          <option value="7">Test manager</option>
        </select>
      </label>
    )
  },
}))

const LEAVE = {
  id: 42,
  employee_id: 'G1001',
  leave_type: 'annual',
  start_date: '2026-01-01',
  end_date: '2026-01-10',
}

function renderDialog(onFiled = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <ReturnFormDialog
        open
        leave={LEAVE}
        onOpenChange={() => {}}
        onFiled={onFiled}
      />
    </QueryClientProvider>,
  )
  return { onFiled }
}

const submitBtn = () => screen.getByRole('button', { name: 'File & complete' })

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  cleanup()
})

describe('ReturnFormDialog — chain signing', () => {
  it('keeps manager selection without a manager signature toggle', () => {
    renderDialog()
    expect(screen.getByRole('combobox', { name: 'Line Manager' })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.queryByText('Include manager signature')).not.toBeInTheDocument()
  })

  it('submits the return date, delay reason and manager without embedding a signature', async () => {
    const user = userEvent.setup()
    const spy = vi.spyOn(api, 'fileLeaveReturn').mockResolvedValue({} as never)
    const { onFiled } = renderDialog()

    fireEvent.change(screen.getByLabelText('Return (resumption) date'), {
      target: { value: '2026-01-12' },
    })
    await user.type(screen.getByLabelText('Reason for delay (if any)'), '  Travel delay  ')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Line Manager' }), '7')
    await user.click(submitBtn())

    await waitFor(() => expect(onFiled).toHaveBeenCalledOnce())
    expect(spy).toHaveBeenCalledWith(42, {
      resumption_date: '2026-01-12',
      delay_reason: 'Travel delay',
      manager_id: 7,
    })
    expect(spy.mock.calls[0][1]).not.toHaveProperty('embed_manager_signature')
  })

  it('still reports ordinary filing errors and preserves entered values', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'fileLeaveReturn').mockRejectedValue(
      new ApiError(422, 'RETURN_FORM_FAILED', 'Unable to file the return form'),
    )
    const { onFiled } = renderDialog()

    fireEvent.change(screen.getByLabelText('Return (resumption) date'), {
      target: { value: '2026-01-12' },
    })
    await user.selectOptions(screen.getByRole('combobox', { name: 'Line Manager' }), '7')
    await user.click(submitBtn())

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Unable to file the return form'),
    )
    expect(onFiled).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Return (resumption) date')).toHaveValue('2026-01-12')
    expect(screen.getByRole('combobox', { name: 'Line Manager' })).toHaveValue('7')
  })
})
