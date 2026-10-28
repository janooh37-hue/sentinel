import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from 'i18next'
import { afterEach, describe, expect, it } from 'vitest'
import ar from '@/locales/ar.json'

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { ImportanceMark, importanceOf } from './ImportanceMark'

// Vitest is run from frontend/ (pnpm -C frontend).
const css = readFileSync(resolve('src/index.css'), 'utf8')

afterEach(async () => {
  cleanup()
  await i18n.changeLanguage('en')
})

describe('ImportanceMark', () => {
  // T-F1
  it('marks high importance red with its own glyph and a slow pulse that reduced motion stops', async () => {
    render(<ImportanceMark importance="high" />)
    const mark = screen.getByRole('img', { name: 'Importance: High' })
    expect(mark).toHaveAttribute('data-importance', 'high')
    expect(mark).toHaveClass('text-destructive', 'gssg-importance-pulse')
    expect(mark.querySelector('svg')).not.toBeNull()
    const reduced = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/g)].map((m) => m[1]).join('\n')
    expect(reduced).toMatch(/\.gssg-importance-pulse\s*\{[^}]*animation: none/)
    cleanup()
    i18n.addResourceBundle('ar', 'translation', ar, true, true)
    await i18n.changeLanguage('ar')
    render(<ImportanceMark importance="high" />)
    expect(screen.getByRole('img', { name: 'الأهمية: عالية' })).toBeInTheDocument()
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

  // T-F4
  it('shows its tooltip on hover inside a row, without becoming focusable', async () => {
    render(<ImportanceMark importance="high" />)
    const mark = screen.getByRole('img', { name: 'Importance: High' })
    expect(mark).not.toHaveAttribute('tabindex')
    await userEvent.hover(mark)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Importance: High')
  })

  it('standalone, it opens on tap', async () => {
    render(<ImportanceMark importance="medium" interactive />)
    await userEvent.click(screen.getByRole('button', { name: 'Importance: Medium' }))
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Importance: Medium')
  })
})
