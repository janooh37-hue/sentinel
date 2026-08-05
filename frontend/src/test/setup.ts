import '@testing-library/jest-dom/vitest'

import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import en from '@/locales/en.json'

// Polyfill localStorage for jsdom (used in tests for basket storage)
const localStorageMock: Storage = {
  getItem: (key: string) => {
    return (localStorageMock as unknown as Record<string, string>)[`__${key}`] ?? null
  },
  setItem: (key: string, value: string) => {
    (localStorageMock as unknown as Record<string, string>)[`__${key}`] = value
  },
  removeItem: (key: string) => {
    delete (localStorageMock as unknown as Record<string, string>)[`__${key}`]
  },
  clear: () => {
    Object.keys(localStorageMock as unknown as Record<string, string>).forEach((k) => {
      if (k.startsWith('__')) delete (localStorageMock as unknown as Record<string, string>)[k]
    })
  },
  key: (index: number) => {
    const keys = Object.keys(localStorageMock as unknown as Record<string, string>).filter((k) =>
      k.startsWith('__'),
    )
    return keys[index]?.slice(2) ?? null
  },
  length: 0,
}

Object.defineProperty(localStorageMock, 'length', {
  get() {
    return Object.keys(localStorageMock as unknown as Record<string, string>).filter((k) =>
      k.startsWith('__'),
    ).length
  },
})

if (!globalThis.localStorage) {
  Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock })
}

// jsdom lacks the pointer-capture / scroll / observer APIs that Radix
// (Select, etc.) calls when opening a popover. Polyfill them so component
// tests can drive Radix-based dropdowns. Harmless no-ops in the real browser.
if (typeof Element !== 'undefined') {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = (): boolean => false
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = (): void => {}
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = (): void => {}
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = (): void => {}
  }
}
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
}
// jsdom has no layout, so it has no IntersectionObserver either. Stub it as
// "everything observed is on screen" — components that defer work until
// visible (ScanBackThumb) then behave in tests as they do in a real viewport
// instead of silently never loading.
if (typeof globalThis.IntersectionObserver === 'undefined') {
  globalThis.IntersectionObserver = class {
    private readonly cb: IntersectionObserverCallback
    constructor(cb: IntersectionObserverCallback) {
      this.cb = cb
    }
    observe(target: Element): void {
      this.cb(
        [{ isIntersecting: true, target } as IntersectionObserverEntry],
        this as unknown as IntersectionObserver,
      )
    }
    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): IntersectionObserverEntry[] {
      return []
    }
    readonly root = null
    readonly rootMargin = ''
    readonly thresholds: readonly number[] = []
  }
}
// jsdom doesn't implement matchMedia at all (not even a stub that always
// misses) — hooks like useIsMobile/useReducedMotion call it unconditionally
// on mount, so without this every such component throws in tests. Default to
// "no match" (desktop / no reduced-motion); tests needing a specific query
// result override window.matchMedia themselves.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList) as typeof window.matchMedia
}

// Initialise i18n synchronously for tests so translation keys resolve to
// English strings without hitting the language detector.
void i18n.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
})
