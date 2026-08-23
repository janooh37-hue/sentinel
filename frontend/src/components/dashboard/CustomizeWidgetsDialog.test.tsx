/**
 * CustomizeWidgetsDialog — the two contracts the markup cannot state itself.
 *
 * 1. The source-page grouping must show EVERY widget. It is a find-it view, so
 *    a widget that falls through the source map would be invisible there while
 *    still sitting on the dashboard.
 * 2. The canvas measure must survive Save and Reset. It rides along with the
 *    widget list in one PATCH, so a handler that forgets it silently reverts
 *    the operator's choice.
 */

import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { CustomizeWidgetsDialog } from '@/components/dashboard/CustomizeWidgetsDialog'
import { DEFAULT_LAYOUT, WIDGET_IDS, type CanvasWidth } from '@/lib/dashboardLayout'

const LABELS = Object.fromEntries(WIDGET_IDS.map((id) => [id, id]))

function renderDialog(canvasWidth: CanvasWidth = 'compact') {
  const onSave = vi.fn()
  render(
    <CustomizeWidgetsDialog
      open
      onOpenChange={() => {}}
      items={DEFAULT_LAYOUT.widgets}
      labels={LABELS}
      canvasWidth={canvasWidth}
      onSave={onSave}
    />,
  )
  return { onSave }
}

const groupOf = (heading: string): HTMLElement =>
  screen.getByRole('heading', { name: new RegExp(heading, 'i') }).closest('section')!

describe('CustomizeWidgetsDialog', () => {
  it('lists every widget when grouped by source page, without reorder arrows', async () => {
    const user = userEvent.setup()
    renderDialog()

    await user.click(screen.getByRole('radio', { name: 'Source page' }))

    const listed = screen
      .getAllByRole('listitem')
      .map((li) => li.firstElementChild!.textContent)
      .sort()
    expect(listed).toEqual([...WIDGET_IDS].sort())

    // Placement-only affordance: reordering inside a source group is meaningless.
    expect(screen.queryByRole('button', { name: 'Move up' })).not.toBeInTheDocument()

    expect(within(groupOf('From Records')).getByText('pending')).toBeInTheDocument()
    expect(within(groupOf('From Leaves')).getByText('on_leave_today')).toBeInTheDocument()
    expect(within(groupOf('From Employees')).getByText('workspace')).toBeInTheDocument()
  })

  it('saves the chosen canvas width alongside the widgets', async () => {
    const user = userEvent.setup()
    const { onSave } = renderDialog('compact')

    await user.click(screen.getByRole('radio', { name: 'Wide' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(onSave).toHaveBeenCalledTimes(1)
    const [widgets, canvasWidth] = onSave.mock.calls[0]!
    expect(canvasWidth).toBe('wide')
    expect(widgets).toHaveLength(WIDGET_IDS.length)
  })

  it('returns the canvas to compact when the layout is reset', async () => {
    const user = userEvent.setup()
    const { onSave } = renderDialog('wide')

    await user.click(screen.getByRole('button', { name: 'Reset to defaults' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(onSave.mock.calls[0]![1]).toBe('compact')
  })
})
