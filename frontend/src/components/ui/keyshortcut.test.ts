import { describe, expect, it } from 'vitest'

import { ariaKeyShortcut } from './keyshortcut'

describe('ariaKeyShortcut', () => {
  it('maps display glyphs to ARIA key tokens', () => {
    expect(ariaKeyShortcut('Esc')).toBe('Escape')
    expect(ariaKeyShortcut('Ctrl')).toBe('Control')
    expect(ariaKeyShortcut('⌘')).toBe('Meta')
    expect(ariaKeyShortcut('↑')).toBe('ArrowUp')
    expect(ariaKeyShortcut('→')).toBe('ArrowRight')
  })

  it('leaves tokens that are already valid untouched', () => {
    for (const key of ['Enter', 'Shift', 'J', '-', '=', '0']) expect(ariaKeyShortcut(key)).toBe(key)
  })

  it('maps every part of a combo and keeps the + separator', () => {
    expect(ariaKeyShortcut('Ctrl+K')).toBe('Control+K')
    expect(ariaKeyShortcut('Ctrl+Shift+Esc')).toBe('Control+Shift+Escape')
    expect(ariaKeyShortcut('Ctrl++')).toBe('Control+Plus')
    expect(ariaKeyShortcut('+')).toBe('Plus')
  })
})
