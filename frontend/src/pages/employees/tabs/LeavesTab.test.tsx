import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// LeavesTab uses useQuery only to lazy-load the full list; force the fallback
// to the passed `leaves` prop so the component renders synchronously.
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: undefined }) }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}))

import { LeavesTab } from './LeavesTab'

const legacyBilingualLeave = {
  id: 1,
  leave_type: 'Sick Leave - الإجازة المرضية',
  status: 'Approved - موافق',
  start_date: '2026-03-25',
  end_date: '2026-03-26',
  days: 2,
}

describe('LeavesTab status pill', () => {
  it('normalizes a legacy bilingual status to the success pill (not neutral)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render(<LeavesTab employeeId="G1" leaves={[legacyBilingualLeave as any]} />)
    const pill = screen.getByLabelText('status-Approved')
    expect(pill.className).toContain('text-success')
    expect(pill.className).not.toContain('text-muted-foreground')
  })
})
