import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { CompanyStatsRow } from '@/lib/api'

import { CompanyCards } from './CompanyCards'

const zero = { days: 0, count: 0 }
const company: CompanyStatsRow = {
  duty_unit: 'Alpha', key: 'Alpha', shift_codes: ['morning'], small_sample: false,
  totals: {
    strength: 10, duties_scheduled: 150, duties_excused: 0, duties_pending: 0, duties_due: 150,
    absence: { days: 6, episodes: 3 }, absence_rate: 4,
    single_punch: 2, late: { count: 1, minutes: 15 },
    leaves: {
      annual: zero, administrative: zero, sick: zero, duty: zero, national_service: zero, other: zero,
      exit_permits: { count: 0, with_hours: 0, hours: null },
    },
  },
  status: { absence: 'bad', single_punch: 'normal', late: 'good', overall: 'bad' },
  ratio: { absence: 1.5, single_punch: 1, late: 0.8 },
}

describe('CompanyCards', () => {
  it('names the driving metric, shows the absence rate, and toggles or clears selection', () => {
    const onSelect = vi.fn()
    const { rerender } = render(<CompanyCards companies={[company]} unit="days" selected={null} onSelect={onSelect} />)

    const card = screen.getByRole('button', { name: 'Alpha' })
    expect(card).toHaveAttribute('aria-pressed', 'false')
    expect(card).toHaveTextContent('Needs intervention · Absence')
    expect(within(card).getByText('4.0%')).toBeInTheDocument()
    expect(within(card).getByText('6')).toBeInTheDocument()
    fireEvent.click(card)
    expect(onSelect).toHaveBeenLastCalledWith('Alpha')

    rerender(<CompanyCards companies={[company]} unit="count" selected="Alpha" onSelect={onSelect} />)
    expect(card).toHaveAttribute('aria-pressed', 'true')
    expect(within(card).getByText('3')).toBeInTheDocument()
    fireEvent.click(card)
    expect(onSelect).toHaveBeenLastCalledWith(null)
    fireEvent.click(screen.getByRole('button', { name: 'Show all companies' }))
    expect(onSelect).toHaveBeenCalledTimes(3)
    expect(onSelect).toHaveBeenLastCalledWith(null)
    expect(card).toHaveFocus()
  })

  it('keeps small-sample figures and rate but suppresses the status colours and judgement', () => {
    const unassigned: CompanyStatsRow = {
      ...company, key: '__unassigned__', duty_unit: null, small_sample: true,
      totals: { ...company.totals, duties_due: 10, absence_rate: 60 },
      status: { absence: null, single_punch: null, late: null, overall: null },
    }
    render(<CompanyCards companies={[unassigned]} unit="days" selected={null} onSelect={vi.fn()} />)

    const card = within(screen.getByRole('button', { name: 'Unassigned' }))
    expect(card.getByText('Small sample')).toHaveStyle({ backgroundColor: 'var(--surface-tinted)', color: 'var(--text-muted)' })
    expect(card.getByText('60.0%')).toBeInTheDocument()
    expect(card.getByText('6').closest('strong')).toHaveStyle({ color: 'var(--text-muted)' })
    expect(card.queryByText('Needs intervention')).not.toBeInTheDocument()
  })
})
