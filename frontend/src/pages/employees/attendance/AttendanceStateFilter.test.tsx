import { useState, type ComponentProps } from 'react'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from 'i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AttendanceStateFilter } from './AttendanceStateFilter'
import { STATE_CHIP_ORDER, type RowState, type StateCounts } from './attendanceModel'
import { attendanceStatusLabel } from './attendanceStatusLabel'

const initialDirection = document.documentElement.getAttribute('dir')

const COUNTS: StateCounts = {
  verified: 8, grace: 2, late: 4, unpaired: 1, absent: 3, pending: 0,
  leave: 2, national_service: 1, corrected: 3,
}

type FilterProps = ComponentProps<typeof AttendanceStateFilter>

function renderFilter(overrides: Partial<FilterProps> = {}) {
  const props: FilterProps = {
    counts: COUNTS,
    states: [],
    corrected: false,
    onStatesChange: vi.fn(),
    onCorrectedChange: vi.fn(),
    onClear: vi.fn(),
    ...overrides,
  }
  return { props, ...render(<AttendanceStateFilter {...props} />) }
}

function stateButton(group: HTMLElement, state: RowState): HTMLElement {
  return within(group).getByRole('button', {
    name: (name) => name.startsWith(`${attendanceStatusLabel(i18n.t, state)} `),
  })
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
  document.documentElement.dir = 'ltr'
})

afterEach(() => {
  cleanup()
  if (initialDirection === null) document.documentElement.removeAttribute('dir')
  else document.documentElement.dir = initialDirection
  vi.restoreAllMocks()
})

describe('AttendanceStateFilter', () => {
  it('adds and removes states as an OR set in the shared chip order', async () => {
    const user = userEvent.setup()
    const { props, rerender } = renderFilter({ states: ['late'] })
    const group = screen.getByRole('group', { name: i18n.t('attendance.filter.rowStatus') })
    const buttons = within(group).getAllByRole('button')
    expect(buttons.slice(0, STATE_CHIP_ORDER.length).map((button) => button.getAttribute('data-state-filter')))
      .toEqual(STATE_CHIP_ORDER)
    expect(stateButton(group, 'late')).toHaveAttribute('aria-pressed', 'true')
    await user.click(stateButton(group, 'unpaired'))
    expect(props.onStatesChange).toHaveBeenLastCalledWith(['late', 'unpaired'])

    rerender(<AttendanceStateFilter {...props} states={['late', 'unpaired']} />)
    await user.click(stateButton(group, 'late'))
    expect(props.onStatesChange).toHaveBeenLastCalledWith(['unpaired'])
    expect(props.onCorrectedChange).not.toHaveBeenCalled()
  })

  it('retains a zero-count chip as aria-disabled but permits clearing a pressed zero chip', async () => {
    const user = userEvent.setup()
    const { props, rerender } = renderFilter()
    const group = screen.getByRole('group', { name: i18n.t('attendance.filter.rowStatus') })
    const pending = stateButton(group, 'pending')
    expect(pending).toHaveAttribute('aria-disabled', 'true')
    await user.click(pending)
    expect(props.onStatesChange).not.toHaveBeenCalled()

    rerender(<AttendanceStateFilter {...props} states={['pending']} />)
    expect(pending).toHaveAttribute('aria-pressed', 'true')
    expect(pending).toHaveAttribute('aria-disabled', 'false')
    await user.click(pending)
    expect(props.onStatesChange).toHaveBeenLastCalledWith([])

    rerender(<AttendanceStateFilter {...props} />)
    pending.focus()
    await user.keyboard('{ArrowLeft}')
    expect(stateButton(group, 'absent')).toHaveFocus()
  })

  it('toggles Corrected independently, including clearing a pressed zero-count modifier', async () => {
    const user = userEvent.setup()
    const { props, rerender } = renderFilter({ states: ['late'] })
    const group = screen.getByRole('group', { name: i18n.t('attendance.filter.rowStatus') })
    const corrected = within(group).getByRole('button', { name: `${i18n.t('attendance.state.corrected')} ${COUNTS.corrected}` })
    expect(corrected).toHaveAttribute('aria-pressed', 'false')
    await user.click(corrected)
    expect(props.onCorrectedChange).toHaveBeenLastCalledWith(true)
    expect(props.onStatesChange).not.toHaveBeenCalled()

    rerender(<AttendanceStateFilter {...props} counts={{ ...COUNTS, corrected: 0 }} corrected />)
    expect(corrected).toHaveAttribute('aria-disabled', 'false')
    await user.click(corrected)
    expect(props.onCorrectedChange).toHaveBeenLastCalledWith(false)
  })

  it.each(['en', 'ar'])('roves with mirrored arrows and Home/End without bubbling day shortcuts (%s)', async (language) => {
    await i18n.changeLanguage(language)
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr'
    const user = userEvent.setup()
    const onKeyDown = vi.fn()
    const onStatesChange = vi.fn()
    render(<div onKeyDown={onKeyDown}>
      <AttendanceStateFilter counts={{ ...COUNTS, grace: 0 }} states={[]} corrected={false}
        onStatesChange={onStatesChange} onCorrectedChange={vi.fn()} onClear={vi.fn()} />
    </div>)
    const group = screen.getByRole('group', { name: i18n.t('attendance.filter.rowStatus') })
    expect(group.closest('[dir]')).toHaveAttribute('dir', document.documentElement.dir)
    const first = stateButton(group, 'verified')
    const late = stateButton(group, 'late')
    const corrected = within(group).getByRole('button', { name: `${i18n.t('attendance.state.corrected')} ${COUNTS.corrected}` })
    expect(within(group).getAllByRole('button').filter((button) => button.tabIndex === 0)).toEqual([first])
    first.focus()
    await user.keyboard(language === 'ar' ? '{ArrowLeft}' : '{ArrowRight}')
    expect(late).toHaveFocus()
    expect(late.tabIndex).toBe(0)
    expect(first.tabIndex).toBe(-1)
    await user.keyboard(language === 'ar' ? '{ArrowRight}' : '{ArrowLeft}')
    expect(first).toHaveFocus()
    await user.keyboard('{End}')
    expect(corrected).toHaveFocus()
    await user.keyboard('{Home}')
    expect(first).toHaveFocus()
    expect(onStatesChange).not.toHaveBeenCalled()
    expect(onKeyDown).not.toHaveBeenCalled()
  })

  it('removes active mobile tokens through the corresponding controlled callback', async () => {
    const user = userEvent.setup()
    const { props } = renderFilter({ states: ['late', 'unpaired'], corrected: true })
    const tokens = screen.getByRole('group', { name: i18n.t('attendance.filter.active') })
    await user.click(within(tokens).getByRole('button', {
      name: i18n.t('attendance.filter.remove', { label: attendanceStatusLabel(i18n.t, 'late') }),
    }))
    expect(props.onStatesChange).toHaveBeenLastCalledWith(['unpaired'])
    await user.click(within(tokens).getByRole('button', {
      name: i18n.t('attendance.filter.remove', { label: i18n.t('attendance.state.corrected') }),
    }))
    expect(props.onCorrectedChange).toHaveBeenLastCalledWith(false)
  })

  it('opens a labelled mobile sheet, traps and returns focus, and keeps picks on Escape', async () => {
    const user = userEvent.setup()
    const onClear = vi.fn()
    function ControlledFilter(): React.JSX.Element {
      const [states, setStates] = useState<RowState[]>(['late'])
      return <AttendanceStateFilter counts={COUNTS} states={states} corrected={false}
        onStatesChange={setStates} onCorrectedChange={vi.fn()} onClear={onClear} />
    }
    render(<ControlledFilter />)
    const opener = screen.getByRole('button', { name: `${i18n.t('attendance.filter.button')} (1)` })
    await user.click(opener)
    const dialog = await screen.findByRole('dialog', { name: i18n.t('attendance.filter.rowStatus') })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    const group = within(dialog).getByRole('group', { name: i18n.t('attendance.filter.rowStatus') })
    await user.click(stateButton(group, 'unpaired'))
    expect(stateButton(group, 'late')).toHaveAttribute('aria-pressed', 'true')
    expect(stateButton(group, 'unpaired')).toHaveAttribute('aria-pressed', 'true')

    within(dialog).getByRole('button', { name: (name) => name.startsWith(i18n.t('attendance.filter.showResults')) }).focus()
    await user.tab()
    expect(within(dialog).getByRole('button', { name: i18n.t('attendance.filter.close') })).toHaveFocus()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(opener).toHaveFocus())
    expect(onClear).not.toHaveBeenCalled()
    expect(opener).toHaveAccessibleName(`${i18n.t('attendance.filter.button')} (2)`)

    await user.click(opener)
    const reopened = await screen.findByRole('dialog', { name: i18n.t('attendance.filter.rowStatus') })
    expect(stateButton(reopened, 'late')).toHaveAttribute('aria-pressed', 'true')
    expect(stateButton(reopened, 'unpaired')).toHaveAttribute('aria-pressed', 'true')
  })

  it('delegates the sheet Clear action without changing company, shift or search itself', async () => {
    const user = userEvent.setup()
    const { props } = renderFilter({ states: ['late'] })
    await user.click(screen.getByRole('button', { name: `${i18n.t('attendance.filter.button')} (1)` }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: i18n.t('attendance.filter.clear', { defaultValue: 'Clear filters' }) }))
    expect(props.onClear).toHaveBeenCalledOnce()
    expect(props.onStatesChange).not.toHaveBeenCalled()
    expect(props.onCorrectedChange).not.toHaveBeenCalled()
  })
})
