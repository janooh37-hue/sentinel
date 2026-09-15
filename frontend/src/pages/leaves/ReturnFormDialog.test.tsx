/**
 * ReturnFormDialog — the "include manager signature" checkbox transition
 * (approval-signature-placement plan §4.5-4.6, defect #1).
 *
 * `EmbedSignatureCheckbox` defaults ON for this dialog (mirrors the Services
 * Duty Resumption template's `hand_sign_manager` default), so the untouched
 * submit is the dangerous path: it must still send `embed_manager_signature:
 * true`, not silently regress to "no signature" because nothing was clicked.
 * Unchecking must flip the same field to `false` on submit. A
 * `MANAGER_SIGNATURE_REQUIRED` failure must render inline next to the
 * controls, not just as a toast.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError, api } from '@/lib/api'
import { ReturnFormDialog } from './ReturnFormDialog'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/components/application/fields/ManagerPickerField', () => ({
  ManagerPickerField: () => null,
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
const checkbox = () => screen.getByLabelText('Include manager signature') as HTMLInputElement

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  cleanup()
})

describe('ReturnFormDialog — manager signature checkbox', () => {
  it('renders checked by default, before any interaction', () => {
    renderDialog()
    expect(checkbox()).toBeChecked()
  })

  it('an untouched submit still sends embed_manager_signature: true', async () => {
    const user = userEvent.setup()
    const spy = vi.spyOn(api, 'fileLeaveReturn').mockResolvedValue({} as never)
    renderDialog()

    await user.click(submitBtn())

    await waitFor(() => expect(spy).toHaveBeenCalled())
    expect(spy).toHaveBeenCalledWith(
      42,
      expect.objectContaining({ embed_manager_signature: true }),
    )
  })

  it('unchecking the box sends embed_manager_signature: false', async () => {
    const user = userEvent.setup()
    const spy = vi.spyOn(api, 'fileLeaveReturn').mockResolvedValue({} as never)
    renderDialog()

    await user.click(checkbox())
    expect(checkbox()).not.toBeChecked()
    await user.click(submitBtn())

    await waitFor(() => expect(spy).toHaveBeenCalled())
    expect(spy).toHaveBeenCalledWith(
      42,
      expect.objectContaining({ embed_manager_signature: false }),
    )
  })

  it('a MANAGER_SIGNATURE_REQUIRED failure renders inline next to the controls', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'fileLeaveReturn').mockRejectedValue(
      new ApiError(422, 'MANAGER_SIGNATURE_REQUIRED', 'No valid manager signature is available'),
    )
    renderDialog()

    await user.click(submitBtn())

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Select a manager with a saved signature, or turn off "Include manager signature".',
    )
  })
})
