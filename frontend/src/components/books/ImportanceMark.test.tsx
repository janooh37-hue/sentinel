import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from 'i18next'
import { afterEach, describe, expect, it } from 'vitest'
import ar from '@/locales/ar.json'

import { ImportanceMark, importanceOf } from './ImportanceMark'

afterEach(async () => {
  cleanup()
  await i18n.changeLanguage('en')
})

describe('ImportanceMark', () => {
  // T-F1
  it('marks high importance red with its own glyph and a slow pulse', () => {
    render(<ImportanceMark importance="high" />)
    const mark = screen.getByRole('img', { name: 'Importance: High' })
    expect(mark).toHaveAttribute('data-importance', 'high')
    expect(mark).toHaveClass('text-destructive', 'gssg-importance-pulse')
    expect(mark.querySelector('svg')).not.toBeNull()
  })

  // T-F2
  it('marks medium importance in caution with a different, static glyph', () => {
    render(<><ImportanceMark importance="medium" /><ImportanceMark importance="high" /></>)
    const medium = screen.getByRole('img', { name: 'Importance: Medium' })
    const high = screen.getByRole('img', { name: 'Importance: High' })
    expect(medium).toHaveClass('text-caution')
    expect(medium).not.toHaveClass('gssg-importance-pulse')
    expect(medium.querySelector('svg')!.getAttribute('class')).not.toBe(high.querySelector('svg')!.getAttribute('class'))
  })

  // T-F3
  it('renders nothing without importance', () => {
    const { container } = render(<ImportanceMark importance={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  // T-F3 (D7 mapping)
  it.each([
    [{ current_template_id: 'Ledger Book', importance: 'high', urgency: 'Normal' }, 'high'],
    [{ current_template_id: 'Ledger Book', importance: 'medium', urgency: 'Very High' }, 'medium'],
    [{ current_template_id: 'Ledger Book', importance: null, urgency: 'Very High' }, null],
    [{ current_template_id: null, importance: 'high', urgency: 'Normal' }, 'medium'],
    [{ current_template_id: 'Other', urgency: 'High' }, 'medium'],
    [{ current_template_id: null, urgency: 'Very High' }, 'high'],
    [{ current_template_id: null, urgency: null }, null],
    [{ current_template_id: null, urgency: 'Whatever' }, null],
  ] as const)('maps %o to %s', (book, expected) => {
    expect(importanceOf(book)).toBe(expected)
  })

  // T-F4
  it('standalone, it is a focusable trigger whose tooltip opens on focus, in both languages', async () => {
    render(<ImportanceMark importance="high" interactive />)
    await userEvent.tab()
    const trigger = screen.getByRole('button', { name: 'Importance: High' })
    expect(trigger).toHaveFocus()
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Importance: High')
    cleanup()
    i18n.addResourceBundle('ar', 'translation', ar, true, true)
    await i18n.changeLanguage('ar')
    render(<ImportanceMark importance="medium" interactive />)
    await userEvent.tab()
    expect(screen.getByRole('button', { name: 'الأهمية: متوسطة' })).toHaveFocus()
    expect(await screen.findByRole('tooltip')).toHaveTextContent('الأهمية: متوسطة')
  })

  it('standalone, it opens on tap', async () => {
    render(<ImportanceMark importance="medium" interactive />)
    await userEvent.click(screen.getByRole('button', { name: 'Importance: Medium' }))
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Importance: Medium')
  })
})
