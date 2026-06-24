/**
 * LanguageToggle — TopNav button that flips i18next between EN and AR
 * and keeps `<html lang>` + `<html dir>` in sync so Tailwind RTL utilities
 * react correctly. The label always shows the *other* language so the
 * action is unambiguous (`English` when currently AR, `العربية` when EN).
 */

import { useTranslation } from 'react-i18next'

export function LanguageToggle(): React.JSX.Element {
  const { i18n } = useTranslation()
  const isAr = i18n.language.startsWith('ar')
  const toggle = (): void => {
    void i18n.changeLanguage(isAr ? 'en' : 'ar')
    // applyDir() listener in lib/i18n.ts sets <html lang+dir>
  }
  return (
    <button
      type="button"
      onClick={toggle}
      className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[0.9em] transition-colors hover:bg-surface-tinted"
      aria-label={isAr ? 'Switch to English' : 'Switch to Arabic'}
    >
      <span aria-hidden>🌐</span>
      <span>{isAr ? 'العربية' : 'English'}</span>
    </button>
  )
}
