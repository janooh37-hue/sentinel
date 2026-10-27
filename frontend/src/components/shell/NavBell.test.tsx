import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import i18n from '@/lib/i18n'

import { NavBell } from './NavBell'

afterEach(async () => {
  await i18n.changeLanguage('en')
})

// The bell's accessible name must follow the UI language: the notifications trigger used to be a hard-coded
// English string in the Arabic UI, which also forced tests to locate it by English text.
describe.each([
  ['en', 'Notifications', 'Notifications, 3 unread'],
  ['ar', 'الإشعارات', 'الإشعارات، 3 غير مقروءة'],
] as const)('NavBell accessible name (%s)', (lang, plain, withCount) => {
  it('names the button in the active language, with and without an unread count', async () => {
    await i18n.changeLanguage(lang)
    const { rerender } = render(<NavBell count={0} />)
    expect(screen.getByRole('button', { name: plain })).toBeInTheDocument()
    rerender(<NavBell count={3} />)
    expect(screen.getByRole('button', { name: withCount })).toBeInTheDocument()
  })

  it('announces the dialog it opens and its expanded state', async () => {
    await i18n.changeLanguage(lang)
    const { rerender } = render(<NavBell count={0} expanded={false} />)
    const bell = screen.getByRole('button', { name: plain })
    expect(bell).toHaveAttribute('aria-haspopup', 'dialog')
    expect(bell).toHaveAttribute('aria-expanded', 'false')
    rerender(<NavBell count={0} expanded />)
    expect(bell).toHaveAttribute('aria-expanded', 'true')
  })
})
