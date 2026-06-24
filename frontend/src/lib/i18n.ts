/**
 * i18next bootstrap.
 *
 * Two responsibilities beyond plain language switching:
 *   * Persist the user's choice in localStorage so the next pywebview launch
 *     comes up in their language without a server round-trip.
 *   * Sync `<html lang>` and `<html dir>` whenever the language changes so
 *     Tailwind's RTL utilities (`ms-*`, `me-*`) and the browser's bidi engine
 *     do the right thing automatically.
 */

import i18n from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'

import ar from '@/locales/ar.json'
import en from '@/locales/en.json'

export const RTL_LANGS = new Set(['ar'])
export type Lang = 'en' | 'ar'

export const SUPPORTED_LANGS: readonly Lang[] = ['en', 'ar']

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      ar: { translation: ar },
    },
    fallbackLng: 'en',
    supportedLngs: SUPPORTED_LANGS,
    nonExplicitSupportedLngs: true,
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'gssg.lang',
    },
  })

function applyDir(lang: string): void {
  const root = document.documentElement
  root.lang = lang
  root.dir = RTL_LANGS.has(lang) ? 'rtl' : 'ltr'
}

applyDir(i18n.language)
i18n.on('languageChanged', applyDir)

export function setLanguage(lang: Lang): void {
  void i18n.changeLanguage(lang)
}

export default i18n
