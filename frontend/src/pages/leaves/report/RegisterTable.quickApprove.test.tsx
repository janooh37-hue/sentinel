import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { toast } from 'sonner'
import { describe, expect, it, vi } from 'vitest'

import { RegisterTable } from './RegisterTable'
import * as apiMod from '@/lib/api'
import i18n from '@/lib/i18n'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const PENDING_COMPASSIONATE = {
  id: 7,
  employee_id: 'G100',
  leave_type: 'Compassionate Leave',
  start_date: '2026-10-20',
  end_date: '2026-10-21',
  days: 2,
  status: 'Pending',
  created_at: '2026-10-19T00:00:00',
}

function renderTable() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const noop = () => {}
  const rows = [PENDING_COMPASSIONATE] as never
  return render(
    <QueryClientProvider client={qc}>
      <RegisterTable
        rows={rows}
        allRows={rows}
        today="2026-10-19"
        sort={{ key: 'start', dir: 'asc' }}
        onSort={noop}
        group="none"
        onGroup={noop}
        scope={{ month: null, employeeId: null, kinds: [], statuses: [], q: '' }}
        onKindsChange={noop}
        onStatusesChange={noop}
        onQChange={noop}
        onClearScope={noop}
        expandedId={null}
        onExpand={noop}
        profileEmployeeId={null}
        onProfile={noop}
        onFilterEmployee={noop}
        onMutated={noop}
      />
    </QueryClientProvider>,
  )
}

describe('RegisterTable quick approve', () => {
  it.each([
    ['en', 'Record HR-42 decides this leave. It is approved when the manager signs that record.'],
    ['ar', 'يُبتّ في هذه الإجازة عبر السجل HR-42، وتُعتمد عند توقيع المدير على ذلك السجل.'],
  ])('explains a sign-gated leave in %s', async (lang, expected) => {
    await i18n.changeLanguage(lang)
    const rawMessage = 'This leave is controlled by the record signature.'
    vi.spyOn(apiMod.api, 'updateLeave').mockRejectedValueOnce(
      new apiMod.ApiError(422, 'LEAVE_SIGN_GATED', rawMessage, { ref_number: 'HR-42', book_id: 42 }),
    )
    renderTable()

    fireEvent.click(screen.getByRole('button', { name: i18n.t('leaves.report.quickApprove') }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expected))
    expect(toast.error).not.toHaveBeenCalledWith(rawMessage)
  })
})
